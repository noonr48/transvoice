'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideTargetCoaching } = require('./target-coaching-engine');
const { emptyMotorMap } = require('./motor-map');
const {
  MOTOR_TRIAL_SCHEMA,
  createPendingMotorTrial,
  deterministicTrialId,
  invalidatePendingMotorTrial,
  settlePendingMotorTrial,
} = require('./motor-trial');
const { recordCueServed, acknowledgeCueServe } = require('./cue-served-lifecycle');

function boundTrialBundle() {
  const before = resonanceBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const served = recordCueServed({
    cue: { cueId: decision.action.cueId, reviewStatus: 'approved_internal' },
    sessionId: 'session-1',
    servedAt: 1000,
    mode: 'active',
  });
  const ack = acknowledgeCueServe({ event: served.event, acknowledgedAt: 1500 });
  const created = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    issuedAt: 2000,
    cueServeEvent: ack.event,
    requireCueServeEvent: true,
  });
  assert.equal(created.status, 'created');
  return created.trial;
}

function obs(dimension, value, low, high, {
  attempt = 'attempt-before',
  taskId = 'task-1',
  takeKind = 'phrase',
  targetKey = 'target-1',
  unit = 'score',
  scale = 0.1,
  metadata = {},
  importance = 0.7,
  controllability = 0.8,
} = {}) {
  return {
    metricId: dimension,
    metricDefinitionVersion: 'v1',
    dimension,
    value,
    unit,
    attemptArtifactId: attempt,
    taskId,
    takeKind,
    analysisProfile: 'standard',
    confidence: { signal: 0.95, segmentation: 0.95, extractor: 0.95, target: 0.95 },
    target: { low, high, scale, source: 'reference', targetKey, confidence: 0.95 },
    persistenceCount: 2,
    importance,
    controllability,
    metadata,
    flags: [],
  };
}

function resonanceBundle({
  attempt = 'attempt-before',
  targetKey = 'target-1',
  taskId = 'task-1',
  takeKind = 'phrase',
  resonance = 0.2,
  pitch = 200,
  pressedness = 0.2,
  pitchAttempt = attempt,
} = {}) {
  return [
    obs('resonance.global_scale', resonance, 0.4, 0.6, {
      attempt, targetKey, taskId, takeKind, importance: 0.9,
    }),
    obs('pitch.register', pitch, 185, 220, {
      attempt: pitchAttempt,
      targetKey,
      taskId,
      takeKind,
      unit: 'Hz',
      scale: 1,
      metadata: { targetScaleUnit: 'semitone' },
      importance: 0.4,
    }),
    obs('phonation.pressedness', pressedness, 0, 0.5, {
      attempt, targetKey, taskId, takeKind, importance: 0.4,
    }),
  ];
}

function buildTrial() {
  const before = resonanceBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  assert.equal(decision.status, 'coach');
  assert.equal(decision.focus.dimension, 'resonance.global_scale');
  const created = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2, strain: 1 },
    issuedAt: 1234,
  });
  assert.equal(created.status, 'created');
  return { before, decision, trial: created.trial };
}

test('cue-serve binding: required trials demand an eligible acknowledged serve', () => {
  const before = resonanceBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const base = {
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    issuedAt: 2000,
  };

  const missing = createPendingMotorTrial({ ...base, requireCueServeEvent: true });
  assert.equal(missing.status, 'not_created');
  assert.equal(missing.reason, 'cue_serve_event_required');

  const served = recordCueServed({
    cue: { cueId: decision.action.cueId, reviewStatus: 'approved_internal' },
    sessionId: 'session-1',
    servedAt: 1000,
  });
  const unacknowledged = createPendingMotorTrial({
    ...base,
    cueServeEvent: served.event,
    requireCueServeEvent: true,
  });
  assert.equal(unacknowledged.status, 'not_created');
  assert.equal(unacknowledged.reason, 'cue_serve_event_not_eligible');

  const acknowledged = acknowledgeCueServe({ event: served.event, acknowledgedAt: 1500 });
  const bound = createPendingMotorTrial({
    ...base,
    cueServeEvent: acknowledged.event,
    requireCueServeEvent: true,
  });
  assert.equal(bound.status, 'created');
  assert.equal(bound.trial.cueServe.cueId, decision.action.cueId);
  assert.equal(bound.trial.cueServe.acknowledgedAt, 1500);

  // Creation is idempotent with respect to the binding: identical decision
  // evidence yields the same deterministic trial id with or without a serve.
  const withoutServe = createPendingMotorTrial({ ...base });
  assert.equal(withoutServe.status, 'created');
  assert.equal(bound.trial.trialId, withoutServe.trial.trialId);
});

test('cue-serve binding: a serve event for a DIFFERENT cue cannot attest this trial', () => {
  const before = resonanceBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const otherCue = recordCueServed({
    cue: { cueId: 'some.other.cue.v1', reviewStatus: 'approved_internal' },
    sessionId: 'session-1',
    servedAt: 1000,
  });
  const acknowledgedOther = acknowledgeCueServe({ event: otherCue.event, acknowledgedAt: 1500 });
  const mismatch = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    issuedAt: 2000,
    cueServeEvent: acknowledgedOther.event,
    requireCueServeEvent: true,
  });
  assert.equal(mismatch.status, 'not_created');
  assert.equal(mismatch.reason, 'cue_serve_event_cue_mismatch');
});

test('cue-serve binding: a serve event from a DIFFERENT session cannot attest this trial', () => {
  const before = resonanceBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const served = recordCueServed({
    cue: { cueId: decision.action.cueId, reviewStatus: 'approved_internal' },
    sessionId: 'session-OTHER',
    servedAt: 1000,
  });
  const acknowledged = acknowledgeCueServe({ event: served.event, acknowledgedAt: 1500 });
  const mismatch = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    issuedAt: 2000,
    cueServeEvent: acknowledged.event,
    requireCueServeEvent: true,
  });
  assert.equal(mismatch.status, 'not_created');
  assert.equal(mismatch.reason, 'cue_serve_event_session_mismatch');
});

test('a pending trial stores only exact baseline evidence and no learner/cue prose', () => {
  const { decision, trial } = buildTrial();
  assert.equal(trial.schema, MOTOR_TRIAL_SCHEMA);
  assert.equal(trial.status, 'pending');
  assert.equal(trial.beforeAttemptArtifactId, 'attempt-before');
  assert.equal(trial.targetKey, 'target-1');
  assert.equal(trial.taskId, 'task-1');
  assert.equal(trial.takeKind, 'phrase');
  assert.equal(trial.stage, 'phrase');
  assert.equal(trial.candidatePolicy.allowSkipToLaterAttempt, false);
  assert.ok(trial.beforeObservations.length >= 3);
  assert.ok(trial.beforeObservations.every((item) => item.attemptArtifactId === 'attempt-before'));
  const serialized = JSON.stringify(trial);
  assert.doesNotMatch(serialized, new RegExp(decision.action.instruction.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.equal(Object.hasOwn(trial.decision.action, 'instruction'), false);
  assert.equal(Object.hasOwn(trial.decision.action, 'rationale'), false);
});

test('trial id is deterministic for the same causal binding', () => {
  const args = {
    sessionId: 'session-1',
    cueId: 'cue-1',
    beforeAttemptArtifactId: 'attempt-1',
    comparisonKey: 'metric|dimension|context',
  };
  assert.equal(deterministicTrialId(args), deterministicTrialId(args));
  assert.notEqual(
    deterministicTrialId(args),
    deterministicTrialId({ ...args, beforeAttemptArtifactId: 'attempt-2' }),
  );
});

test('controlled-probe before-evidence retains its comparison context so resonance settles can verify', () => {
  // Regression (found by the 8B loop proof): safeObservationSnapshot used to
  // drop the top-level comparisonContextKey, so verifyCueEffect re-derived
  // the before identity WITHOUT the context component and every controlled-
  // vowel settle invalidated as context_changed.
  const controlled = [
    obs('resonance.global_scale', 0.24, 0.4, 0.6, {
      attempt: 'attempt-before',
      takeKind: 'sustained_vowel',
      metadata: {
        contextComparable: true,
        controlledProbeId: 'vowel.ee.steady.v1',
        comparisonContextKey: 'ee-steady-same-note-v1',
      },
    }),
    // Protected metrics the cue requires (pitch + pressedness + effort via
    // selfReport) so the settle can reach worked_verified, not partial.
    obs('pitch.register', 200, 180, 220, {
      attempt: 'attempt-before', takeKind: 'sustained_vowel', unit: 'Hz', scale: 1,
      metadata: { targetScaleUnit: 'semitone' },
    }),
    obs('phonation.pressedness', 0.2, 0, 0.5, {
      attempt: 'attempt-before', takeKind: 'sustained_vowel',
    }),
  ];
  // Give the raw observations the controlled context the snapshot must retain.
  controlled[0].contextKind = 'controlled_probe_formant';
  controlled[0].comparisonContextKey = 'ee-steady-same-note-v1';
  const decision = decideTargetCoaching({ observations: controlled, stage: 'sound' });
  assert.equal(decision.status, 'coach');
  const created = createPendingMotorTrial({
    decision,
    beforeObservations: controlled,
    sessionId: 'session-1',
    stage: 'sound',
    selfReport: { effort: 2 },
    issuedAt: 2000,
  });
  assert.equal(created.status, 'created');
  const snapshot = created.trial.beforeObservations[0];
  assert.equal(snapshot.comparisonContextKey, 'ee-steady-same-note-v1');
  assert.equal(snapshot.contextKind, 'controlled_probe_formant');

  const after = [
    { ...controlled[0], value: 0.31, attemptArtifactId: 'attempt-after' },
    { ...controlled[1], attemptArtifactId: 'attempt-after' },
    { ...controlled[2], value: 0.21, attemptArtifactId: 'attempt-after' },
  ];
  const settled = settlePendingMotorTrial({
    trial: created.trial,
    sessionId: 'session-1',
    stage: 'sound',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
  });
  assert.equal(settled.status, 'settled');
  assert.equal(settled.result, 'worked_verified');
});

test('safety lens F1: pain reported at the after-take invalidates — no credit from a take that hurt', () => {
  const trial = boundTrialBundle();
  const after = resonanceBundle({ attempt: 'attempt-after', resonance: 0.36 });
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2, pain: true }, // plan 13: pain is terminal
    motorMap: emptyMotorMap(),
    settledAt: 3000,
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'pain_reported');
  assert.equal(result.motorMapUpdated, false);
});

test('safety lens F2: a cue-serve-bound trial expires outside the 10-minute window', () => {
  const trial = boundTrialBundle();
  const after = resonanceBundle({ attempt: 'attempt-after', resonance: 0.36 });
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 1000 + 10 * 60 * 1000 + 1, // just past the window
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'take_outside_cue_serve_window');
  assert.equal(result.motorMapUpdated, false);
});

test('safety lens F2: unknown take time on a serve-bound trial fails closed', () => {
  const trial = boundTrialBundle();
  const after = resonanceBundle({ attempt: 'attempt-after', resonance: 0.36 });
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    // no settledAt — unknown take time is unknown, never assumed in-window
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'take_time_unknown');
  assert.equal(result.motorMapUpdated, false);
});

test('the exact next comparable attempt can settle worked_verified and update the motor map', () => {
  const { trial } = buildTrial();
  const after = resonanceBundle({ attempt: 'attempt-after', resonance: 0.36 });
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
  });
  assert.equal(result.status, 'settled');
  assert.equal(result.result, 'worked_verified');
  assert.equal(result.trial.status, 'settled');
  assert.equal(result.trial.afterAttemptArtifactId, 'attempt-after');
  assert.equal(result.verification.beforeAttemptArtifactId, 'attempt-before');
  assert.equal(result.verification.afterAttemptArtifactId, 'attempt-after');
  assert.equal(result.motorMapUpdated, true);
  assert.equal(result.motorMap.byCue[trial.cueId].successes, 1);
});

test('the baseline attempt cannot be reused as its own after-take', () => {
  const { trial, before } = buildTrial();
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-before',
    afterObservations: before,
    motorMap: emptyMotorMap(),
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'before_attempt_repeated');
  assert.equal(result.trial.status, 'invalidated');
  assert.equal(result.motorMapUpdated, false);
});

test('target, task, take-kind, stage and analysis-profile drift each invalidate immediately', () => {
  const cases = [
    [{ targetKey: 'target-2' }, 'target_changed'],
    [{ taskId: 'task-2' }, 'task_changed'],
    [{ takeKind: 'reading' }, 'take_kind_changed'],
    [{ stage: 'reading' }, 'stage_changed'],
    [{ analysisProfile: 'no_formants' }, 'analysis_profile_changed'],
  ];
  for (const [override, expected] of cases) {
    const { trial } = buildTrial();
    const after = resonanceBundle({ attempt: 'attempt-after', resonance: 0.35 });
    const result = settlePendingMotorTrial({
      trial,
      sessionId: 'session-1',
      stage: 'phrase',
      afterAttemptArtifactId: 'attempt-after',
      afterObservations: after,
      motorMap: emptyMotorMap(),
      ...override,
    });
    assert.equal(result.status, 'invalidated', expected);
    assert.equal(result.result, expected);
    assert.equal(result.trial.status, 'invalidated');
    assert.equal(result.motorMapUpdated, false);
  }
});

test('a different session invalidates rather than borrowing another session take', () => {
  const { trial } = buildTrial();
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-2',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: resonanceBundle({ attempt: 'attempt-after', resonance: 0.35 }),
    motorMap: emptyMotorMap(),
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'session_changed');
});

test('mixed measurements from two after-attempts invalidate the trial', () => {
  const { trial } = buildTrial();
  const after = resonanceBundle({
    attempt: 'attempt-after',
    pitchAttempt: 'some-other-attempt',
    resonance: 0.35,
  });
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    motorMap: emptyMotorMap(),
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'mixed_after_attempt_evidence');
  assert.equal(result.motorMapUpdated, false);
});

test('a next take without the bound focus evidence consumes the trial instead of allowing later cherry-picking', () => {
  const { trial } = buildTrial();
  const unrelatedNextTake = resonanceBundle({ attempt: 'attempt-after' }).slice(1);
  const first = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: unrelatedNextTake,
    motorMap: emptyMotorMap(),
  });
  assert.equal(first.status, 'invalidated');
  assert.equal(first.result, 'no_comparable_focus_evidence');
  assert.equal(first.trial.status, 'invalidated');

  const temptingLaterTake = resonanceBundle({ attempt: 'attempt-later', resonance: 0.4 });
  const second = settlePendingMotorTrial({
    trial: first.trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-later',
    afterObservations: temptingLaterTake,
    motorMap: emptyMotorMap(),
  });
  assert.equal(second.status, 'not_applicable');
  assert.equal(second.result, 'pending_trial_required');
});

test('issuing another cue can explicitly supersede and terminally close a pending trial', () => {
  const { trial } = buildTrial();
  const result = invalidatePendingMotorTrial(trial, 'cue_superseded');
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'cue_superseded');
  assert.equal(result.trial.status, 'invalidated');

  const reuse = settlePendingMotorTrial({
    trial: result.trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: resonanceBundle({ attempt: 'attempt-after', resonance: 0.35 }),
  });
  assert.equal(reuse.status, 'not_applicable');
});
