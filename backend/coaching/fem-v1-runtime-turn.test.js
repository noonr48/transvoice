'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FEM_V1_RUNTIME_SCHEMA, resolveFemV1RuntimeTurn } = require('./fem-v1-runtime-turn');
const { createAttemptFinalizedEvent } = require('./attempt-finalized-event');
const { createBeginnerMasteryState } = require('./beginner-mastery');
const { createAttemptSequence, recordFinalizedAttempt } = require('./session-attempt-sequence');

function learnerState(overrides = {}) {
  return {
    mastery: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    motorResponseMap: null,
    goalCueOverlay: null,
    ...overrides,
  };
}

function sessionState(overrides = {}) {
  const seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline-1', eligible: true });
  return {
    sessionId: 'session-1',
    stage: 'phrase',
    revision: 4,
    pendingTrial: null,
    attemptSequence: seq,
    baselineAttemptOrdinal: 1,
    feedbackMode: null,
    ...overrides,
  };
}

function attempt(overrides = {}) {
  return {
    attemptArtifactId: 'attempt-1',
    ordinal: 999,
    eligible: true,
    ineligibleReason: null,
    observations: [],
    selfReport: { effort: 2 },
    captureEvidence: { usable: true, reasons: [] },
    ...overrides,
  };
}

function pendingTrial(overrides = {}) {
  return {
    schema: 'transvoice.pending_motor_trial.v1',
    status: 'pending',
    trialId: 'trial-1',
    sessionId: 'session-1',
    attemptSequenceBound: true,
    baselineAttemptOrdinal: 1,
    ...overrides,
  };
}

test('safety stop short-circuits coaching', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({ selfReport: { pain: true } }), now: 1755400000000,
  });
  assert.equal(result.action, 'stop_for_safety');
  assert.equal(result.safetyReason, 'pain');
});

test('pain terminally invalidates a real pending causal trial', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(),
    sessionState: sessionState({ pendingTrial: pendingTrial() }),
    finalizedAttempt: attempt({ selfReport: { pain: true } }), now: 1755400000000,
  });
  assert.equal(result.action, 'stop_for_safety');
  assert.equal(result.settlement.status, 'invalidated');
  assert.equal(result.settlement.result, 'pain_reported');
  assert.equal(result.shadowStateDelta.pendingTrial.status, 'invalidated');
});

test('terminal settlement is applied to working state before controller resolution', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(),
    sessionState: sessionState({ pendingTrial: pendingTrial({ sessionId: 'different-session' }) }),
    finalizedAttempt: attempt(), now: 1755400001000,
  });
  assert.equal(result.settlement.status, 'invalidated');
  assert.equal(result.settlement.result, 'session_changed');
  assert.notEqual(result.controllerTurn.action, 'verify_attempt');
  assert.equal(result.shadowStateDelta.pendingTrial.status, 'invalidated');
});

test('shadow computes a private next-state delta without mutating production state', () => {
  const session = sessionState();
  const before = structuredClone(session);
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: session,
    finalizedAttempt: attempt(), now: 1755400000000,
  });
  assert.equal(result.mode, 'shadow');
  assert.deepEqual(result.proposedStateDelta, {});
  assert.equal(result.shadowStateDelta.attemptOrdinal, 2);
  assert.equal(result.shadowStateDelta.attemptSequence.attempts.length, 2);
  assert.deepEqual(session, before);
});

test('active mode proposes the same causal sequence state but never mutates caller state', () => {
  const session = sessionState();
  const before = structuredClone(session);
  const result = resolveFemV1RuntimeTurn({
    mode: 'active', learnerState: learnerState(), sessionState: session,
    finalizedAttempt: attempt(), now: 1755400000000,
  });
  assert.deepEqual(result.shadowStateDelta, {});
  assert.equal(result.proposedStateDelta.attemptOrdinal, 2);
  assert.equal(result.proposedStateDelta.attemptSequence.attempts.length, 2);
  assert.deepEqual(session, before);
});

test('unknown mode fails closed to shadow', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'turbo', learnerState: learnerState(), sessionState: sessionState(), finalizedAttempt: attempt(),
  });
  assert.equal(result.mode, 'shadow');
});

test('witness is privacy bounded', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({ observations: [{ metricId: 'pitch.median_hz', value: 155, secret: 'do-not-copy' }] }),
  });
  const json = JSON.stringify(result.witness);
  assert.equal(result.witness.schema, FEM_V1_RUNTIME_SCHEMA);
  assert.ok(!json.includes('observations'));
  assert.ok(!json.includes('instruction'));
  assert.ok(!json.includes('secret'));
});

test('capture-unusable attempt repairs before coaching', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({
      eligible: false, ineligibleReason: 'capture_unusable',
      captureEvidence: { usable: false, reasons: ['low_snr'] },
    }),
  });
  assert.equal(result.controllerTurn.action, 'repair_capture');
});

test('all typed stop/reduce fields survive orchestration', () => {
  const stop = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({ selfReport: { effort: 2, voiceLoss: true } }),
  });
  assert.equal(stop.action, 'stop_for_safety');
  assert.equal(stop.safetyReason, 'voice_loss');

  const reduce = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({ selfReport: { effort: 2, newOrIncreasedHoarseness: true } }),
  });
  assert.equal(reduce.action, 'reduce_difficulty');
});

test('runtime ordinal is authoritative even if caller spoofs an ordinal', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'active', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({ ordinal: 999 }),
  });
  assert.equal(result.finalizedAttemptDisposition.ordinal, 2);
  assert.equal(result.proposedStateDelta.attemptOrdinal, 2);
});

test('duplicate finalized attempt replay is idempotent', () => {
  const session = sessionState();
  recordFinalizedAttempt(session.attemptSequence, { attemptArtifactId: 'attempt-1', eligible: true });
  const result = resolveFemV1RuntimeTurn({
    mode: 'active', learnerState: learnerState(), sessionState: session, finalizedAttempt: attempt(),
  });
  assert.equal(result.finalizedAttemptDisposition.ordinal, 2);
  assert.equal(result.finalizedAttemptDisposition.replayed, true);
  assert.equal(result.proposedStateDelta.attemptSequence, undefined);
});

test('conflicting reuse of an attempt artifact id fails closed', () => {
  const session = sessionState();
  recordFinalizedAttempt(session.attemptSequence, { attemptArtifactId: 'attempt-1', eligible: true });
  assert.throws(() => resolveFemV1RuntimeTurn({
    mode: 'active', learnerState: learnerState(), sessionState: session,
    finalizedAttempt: attempt({ eligible: false, ineligibleReason: 'capture_unusable' }),
  }), /attempt_artifact_conflict/);
});

test('partial turn evidence can add effort but cannot erase finalized pain', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({ selfReport: { pain: true } }),
    turnEvidence: { selfReport: { effort: 2 } },
  });
  assert.equal(result.action, 'stop_for_safety');
  assert.equal(result.safetyReason, 'pain');
});

test('contradictory self-report surfaces fail closed', () => {
  assert.throws(() => resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttempt: attempt({ selfReport: { pain: true } }),
    turnEvidence: { selfReport: { pain: false } },
  }), /attempt_evidence_conflict:selfReport\.pain/);
});

test('malformed persisted attempt sequence fails closed instead of becoming empty state', () => {
  const bad = sessionState({
    attemptSequence: {
      schema: 'transvoice.session_attempt_sequence.v1', nextOrdinal: 2,
      attempts: [
        { ordinal: 1, attemptArtifactId: 'a', eligible: true, ineligibleReason: null },
        { ordinal: 1, attemptArtifactId: 'b', eligible: true, ineligibleReason: null },
      ],
    },
  });
  assert.throws(() => resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: bad,
  }), /attempt_sequence_invalid/);
});

test('explicit finalized event is the sealed evidence authority', () => {
  const event = createAttemptFinalizedEvent({
    eventId: 'evt-1', sessionId: 'session-1', attemptArtifactId: 'attempt-event-1',
    finalizedAt: 1755400000000, expectedSessionRevision: 4, eligible: true,
    evidence: {
      selfReport: { effort: 2 }, captureEvidence: { usable: true, reasons: [] }, observations: [],
    },
  });
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(), finalizedAttemptEvent: event,
  });
  assert.equal(result.finalizedAttemptDisposition.attemptArtifactId, 'attempt-event-1');
  assert.equal(result.witness.finalizedAttempt.source, 'explicit_event');
  assert.equal(result.witness.finalizedAttempt.evidenceDigest, event.evidenceDigest);
});

test('supplemental evidence cannot alter a sealed finalized event', () => {
  const event = createAttemptFinalizedEvent({
    eventId: 'evt-1', sessionId: 'session-1', attemptArtifactId: 'attempt-event-1', eligible: true,
    evidence: {
      selfReport: { effort: 2 }, captureEvidence: { usable: true, reasons: [] }, observations: [],
    },
  });
  assert.throws(() => resolveFemV1RuntimeTurn({
    mode: 'shadow', learnerState: learnerState(), sessionState: sessionState(),
    finalizedAttemptEvent: event, turnEvidence: { selfReport: { pain: true } },
  }), /attempt_evidence_conflict:sealed_event/);
});
