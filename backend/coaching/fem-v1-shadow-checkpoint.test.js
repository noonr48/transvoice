'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyFemV1ShadowTurn,
  createFemV1ShadowState,
} = require('./fem-v1-shadow-state');
const {
  initialShadowStateFromLiveSnapshot,
  planFemV1ShadowCheckpoint,
} = require('./fem-v1-shadow-checkpoint');

function liveSession() {
  return {
    sessionId: 'live-session-1',
    revision: 11,
    stage: 'phrase',
    pendingTrial: null,
    attemptSequence: null,
  };
}

function liveLearner() {
  return { mastery: { curriculumPhase: 'pitch_foundation' } };
}

function shadowTurn() {
  return {
    mode: 'shadow',
    proposedStateDelta: {},
    shadowStateDelta: { attemptOrdinal: 1 },
    witness: { finalizedAttempt: { evidenceDigest: null } },
  };
}

test('first live shadow checkpoint starts from a private revision-zero snapshot', () => {
  const initial = initialShadowStateFromLiveSnapshot({
    sessionState: liveSession(), learnerState: liveLearner(),
  });
  assert.equal(initial.revision, 0);
  assert.equal(initial.sourceSessionRevision, 11);
  assert.equal(initial.sessionState.sessionId, 'live-session-1');

  const next = applyFemV1ShadowTurn(initial, shadowTurn(), { sourceSessionRevision: 11 });
  const checkpoint = planFemV1ShadowCheckpoint({
    nextShadowState: next,
    liveSessionState: liveSession(),
    liveLearnerState: liveLearner(),
  });
  assert.equal(checkpoint.expectedRevision, 0);
  assert.equal(checkpoint.nextRevision, 1);
});

test('subsequent checkpoint uses the persisted private shadow revision', () => {
  const initial = initialShadowStateFromLiveSnapshot({
    sessionState: liveSession(), learnerState: liveLearner(),
  });
  const first = applyFemV1ShadowTurn(initial, shadowTurn());
  const second = applyFemV1ShadowTurn(first, {
    ...shadowTurn(), shadowStateDelta: { attemptOrdinal: 2 },
  });
  const checkpoint = planFemV1ShadowCheckpoint({
    currentShadowState: first,
    nextShadowState: second,
    liveSessionState: liveSession(),
    liveLearnerState: liveLearner(),
  });
  assert.equal(checkpoint.expectedRevision, 1);
  assert.equal(checkpoint.nextRevision, 2);
});

test('checkpoint never accepts a next state from another session', () => {
  const initial = initialShadowStateFromLiveSnapshot({
    sessionState: liveSession(), learnerState: liveLearner(),
  });
  const other = createFemV1ShadowState({
    sessionId: 'other-session',
    revision: 1,
    sessionState: { sessionId: 'other-session' },
    learnerState: {},
  });
  assert.throws(() => planFemV1ShadowCheckpoint({
    currentShadowState: initial,
    nextShadowState: other,
    liveSessionState: liveSession(),
    liveLearnerState: liveLearner(),
  }), /shadow_checkpoint_session_mismatch/);
});
