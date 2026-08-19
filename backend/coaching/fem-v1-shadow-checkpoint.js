'use strict';

const {
  createFemV1ShadowState,
  normalizeFemV1ShadowState,
} = require('./fem-v1-shadow-state');
const { planFemV1ShadowStateWrite } = require('./fem-v1-shadow-store');

const FEM_V1_SHADOW_CHECKPOINT_SCHEMA = 'transvoice.fem_v1_shadow_checkpoint.v1';

function initialShadowStateFromLiveSnapshot({ sessionState = {}, learnerState = {} } = {}) {
  if (typeof sessionState?.sessionId !== 'string' || !sessionState.sessionId.trim()) {
    throw new Error('shadow_checkpoint_session_id_required');
  }
  return createFemV1ShadowState({
    sessionId: sessionState.sessionId,
    sourceSessionRevision: Number.isInteger(sessionState.revision) ? sessionState.revision : null,
    sessionState,
    learnerState,
  });
}

function planFemV1ShadowCheckpoint({
  currentShadowState = null,
  nextShadowState,
  liveSessionState = {},
  liveLearnerState = {},
} = {}) {
  const next = normalizeFemV1ShadowState(nextShadowState);
  const current = currentShadowState
    ? normalizeFemV1ShadowState(currentShadowState)
    : initialShadowStateFromLiveSnapshot({
      sessionState: liveSessionState,
      learnerState: liveLearnerState,
    });

  if (current.sessionId !== next.sessionId) throw new Error('shadow_checkpoint_session_mismatch');
  const write = planFemV1ShadowStateWrite({ currentState: current, nextState: next });
  return Object.freeze({
    schema: FEM_V1_SHADOW_CHECKPOINT_SCHEMA,
    stateKey: write.stateKey,
    expectedRevision: write.expectedRevision,
    nextRevision: write.nextRevision,
    write,
  });
}

module.exports = {
  FEM_V1_SHADOW_CHECKPOINT_SCHEMA,
  initialShadowStateFromLiveSnapshot,
  planFemV1ShadowCheckpoint,
};
