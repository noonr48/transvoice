'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MOTOR_TRIAL_SCHEMA,
  createPendingMotorTrial,
  settlePendingMotorTrial,
} = require('./motor-trial');
const {
  normalizeTargetMetricSessionState,
} = require('./target-metric-session-state');
const {
  recordCueServed,
  acknowledgeCueServe,
} = require('./cue-served-lifecycle');
const { getCue } = require('./cue-library-v3');
const { decideTargetCoaching } = require('./target-coaching-engine');
const { emptyMotorMap } = require('./motor-map');

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

function resonanceBundle() {
  return [
    obs('resonance.global_scale', 0.2, 0.4, 0.6, { importance: 0.9 }),
    obs('pitch.register', 200, 185, 220, {
      unit: 'Hz', scale: 1, importance: 0.4, metadata: { targetScaleUnit: 'semitone' },
    }),
    obs('phonation.pressedness', 0.2, 0, 0.5, { importance: 0.4 }),
  ];
}

function buildBoundTrial() {
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
  assert.ok(created.trial.cueServe);
  return { before, decision, trial: created.trial };
}

test('R1-002: a bound cue-serve binding SURVIVES session-state normalization', () => {
  const { trial } = buildBoundTrial();
  // The persistence round-trip the review found broken:
  const state = { pendingTrial: trial };
  const normalized = normalizeTargetMetricSessionState(state);
  const restored = normalized.pendingTrial;
  assert.ok(restored, 'trial survives');
  assert.equal(restored.cueServe.cueId, trial.cueServe.cueId);
  assert.equal(restored.cueServe.cueReviewStatus, 'approved_internal');
  assert.equal(restored.cueServe.servedAt, 1000);
  assert.equal(restored.cueServe.acknowledgedAt, 1500);
});

test('R1-002: settlement after restart still enforces the serve window', () => {
  const { trial } = buildBoundTrial();
  const normalized = normalizeTargetMetricSessionState({ pendingTrial: trial });
  const restored = normalized.pendingTrial;
  const after = resonanceBundle().map((o) => ({ ...o, attemptArtifactId: 'attempt-after', value: o.dimension === 'resonance.global_scale' ? 0.36 : o.value }));

  // Inside the window: settles.
  const inWindow = settlePendingMotorTrial({
    trial: restored,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 3000,
  });
  assert.equal(inWindow.status, 'settled');
  assert.equal(inWindow.result, 'worked_verified');

  // Outside the window: invalidates (the binding's window is enforced
  // post-restart — this is exactly what the review said was lost).
  const normalizedAgain = normalizeTargetMetricSessionState({ pendingTrial: trial });
  const outWindow = settlePendingMotorTrial({
    trial: normalizedAgain.pendingTrial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 1000 + 10 * 60 * 1000 + 1, // past window
  });
  assert.equal(outWindow.status, 'invalidated');
  assert.equal(outWindow.result, 'take_outside_cue_serve_window');
});

test('R1-002: a corrupted binding fails closed at normalization (no silent drop)', () => {
  const { trial } = buildBoundTrial();
  // Corrupt the binding: mismatched cue id
  const corrupted = {
    ...trial,
    cueServe: { ...trial.cueServe, cueId: 'different.cue.v1' },
  };
  const normalized = normalizeTargetMetricSessionState({ pendingTrial: corrupted });
  // The corrupted trial must NOT come back as a valid bound trial:
  const restored = normalized.pendingTrial;
  if (restored && restored.cueServe) {
    // If it round-trips, the binding must have been checked
    assert.notEqual(restored.cueServe.cueId, 'different.cue.v1');
  }
  // Either the trial is dropped (fail-closed) or the binding is stripped
  // (settlement then fails on cue_serve_event_not_eligible path) — it
  // must never settle as if a valid serve existed.
  const after = resonanceBundle().map((o) => ({ ...o, attemptArtifactId: 'attempt-after', value: o.dimension === 'resonance.global_scale' ? 0.36 : o.value }));
  if (restored) {
    const result = settlePendingMotorTrial({
      trial: restored,
      sessionId: 'session-1',
      stage: 'phrase',
      afterAttemptArtifactId: 'attempt-after',
      afterObservations: after,
      selfReport: { effort: 2 },
      motorMap: emptyMotorMap(),
      settledAt: 3000,
    });
    // Must NOT be worked_verified with a corrupted binding
    assert.notEqual(result.result, 'worked_verified');
  }
});

test('R1-002: legacy trials (no binding) still normalize for research settlement', () => {
  const before = resonanceBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const legacy = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    issuedAt: 2000,
    // requireCueServeEvent: false (default) — legacy research path
  });
  assert.equal(legacy.status, 'created');
  assert.equal(legacy.trial.cueServe, null);
  const normalized = normalizeTargetMetricSessionState({ pendingTrial: legacy.trial });
  assert.ok(normalized.pendingTrial);
  assert.equal(normalized.pendingTrial.cueServe, null);
});
