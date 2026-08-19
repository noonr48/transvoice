'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFemV1RuntimeTurn } = require('./fem-v1-runtime-turn');
const { createBeginnerMasteryState } = require('./beginner-mastery');
const { createAttemptSequence, recordFinalizedAttempt } = require('./session-attempt-sequence');

function pendingTrial(overrides = {}) {
  return {
    schema: 'transvoice.pending_motor_trial.v1',
    status: 'pending',
    trialId: 'trial-new',
    sessionId: 'session-1',
    attemptSequenceBound: true,
    baselineAttemptOrdinal: 2,
    ...overrides,
  };
}

function replayedSession() {
  const attemptSequence = createAttemptSequence();
  recordFinalizedAttempt(attemptSequence, {
    attemptArtifactId: 'baseline-1',
    eligible: true,
  });
  recordFinalizedAttempt(attemptSequence, {
    attemptArtifactId: 'already-consumed',
    eligible: true,
  });
  return {
    sessionId: 'session-1',
    stage: 'phrase',
    revision: 7,
    pendingTrial: pendingTrial(),
    attemptSequence,
  };
}

function learnerState() {
  return {
    mastery: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    motorResponseMap: null,
  };
}

function replayedAttempt(overrides = {}) {
  return {
    attemptArtifactId: 'already-consumed',
    eligible: true,
    ineligibleReason: null,
    observations: [],
    selfReport: { effort: 2 },
    captureEvidence: { usable: true, reasons: [] },
    ...overrides,
  };
}

test('a replayed finalized artifact cannot settle or invalidate a later pending trial', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: replayedSession(),
    finalizedAttempt: replayedAttempt(),
    now: 1755400000000,
  });

  assert.equal(result.finalizedAttemptDisposition.replayed, true);
  assert.equal(result.finalizedAttemptDisposition.ordinal, 2);
  assert.deepEqual(result.settlement, {
    status: 'not_applicable',
    result: 'attempt_replayed',
    trialId: 'trial-new',
  });
  assert.equal(result.controllerTurn.action, 'verify_attempt');
  assert.equal(result.shadowStateDelta.pendingTrial, undefined);
  assert.equal(result.shadowStateDelta.attemptSequence, undefined);
});

test('replayed pain remains safety-visible but still cannot close the new causal trial', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: replayedSession(),
    finalizedAttempt: replayedAttempt({ selfReport: { pain: true } }),
    now: 1755400000000,
  });

  assert.equal(result.settlement.result, 'attempt_replayed');
  assert.equal(result.controllerTurn.action, 'stop_for_safety');
  assert.equal(result.safetyReason, 'pain');
  assert.equal(result.shadowStateDelta.pendingTrial, undefined);
});

test('a genuinely new finalized artifact remains eligible to settle the pending causal trial', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: replayedSession(),
    finalizedAttempt: {
      ...replayedAttempt(),
      attemptArtifactId: 'new-attempt',
    },
    now: 1755400000000,
  });

  assert.equal(result.finalizedAttemptDisposition.replayed, false);
  assert.equal(result.finalizedAttemptDisposition.ordinal, 3);
  assert.notEqual(result.settlement.result, 'attempt_replayed');
});
