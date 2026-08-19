'use strict';

const crypto = require('crypto');
const {
  FEM_V1_SHADOW_STATE_SCHEMA,
  normalizeFemV1ShadowState,
} = require('./fem-v1-shadow-state');

const FEM_V1_SHADOW_WRITE_SCHEMA = 'transvoice.fem_v1_shadow_write.v1';

function digestShadowState(value) {
  const state = normalizeFemV1ShadowState(value);
  return crypto.createHash('sha256')
    .update(JSON.stringify(state))
    .digest('hex');
}

function planFemV1ShadowStateWrite({ currentState, nextState } = {}) {
  const current = normalizeFemV1ShadowState(currentState);
  const next = normalizeFemV1ShadowState(nextState);
  if (current.sessionId !== next.sessionId || current.stateKey !== next.stateKey) {
    throw new Error('shadow_write_session_mismatch');
  }
  if (next.revision !== current.revision + 1) {
    throw new Error('shadow_write_revision_not_next');
  }

  return Object.freeze({
    schema: FEM_V1_SHADOW_WRITE_SCHEMA,
    stateKey: current.stateKey,
    sessionId: current.sessionId,
    expectedRevision: current.revision,
    nextRevision: next.revision,
    currentDigest: digestShadowState(current),
    nextDigest: digestShadowState(next),
    nextState: next,
  });
}

async function commitFemV1ShadowStateWrite(store, write) {
  if (!write || write.schema !== FEM_V1_SHADOW_WRITE_SCHEMA) {
    throw new Error('fem_v1_shadow_write_required');
  }
  if (!store || typeof store.compareAndSwap !== 'function') {
    throw new Error('shadow_atomic_compare_and_swap_store_required');
  }
  try {
    const result = await store.compareAndSwap({
      key: write.stateKey,
      expectedRevision: write.expectedRevision,
      nextValue: write.nextState,
    });
    if (result?.applied === true) {
      return Object.freeze({ status: 'committed', revision: write.nextRevision });
    }
    return Object.freeze({
      status: 'revision_conflict',
      revision: Number.isInteger(result?.currentRevision) ? result.currentRevision : null,
    });
  } catch (_) {
    // Storage may have committed before the transport failed. Never retry
    // blindly; recover by reading the private shadow namespace.
    return Object.freeze({ status: 'commit_unknown', recoveryRequired: true });
  }
}

async function recoverFemV1ShadowStateWrite(store, write) {
  if (!write || write.schema !== FEM_V1_SHADOW_WRITE_SCHEMA) {
    throw new Error('fem_v1_shadow_write_required');
  }
  if (!store || typeof store.get !== 'function') throw new Error('shadow_state_read_store_required');

  const result = await store.get({ key: write.stateKey });
  const raw = result && typeof result === 'object' && Object.prototype.hasOwnProperty.call(result, 'value')
    ? result.value
    : result;
  const persisted = normalizeFemV1ShadowState(raw);
  const digest = digestShadowState(persisted);
  if (digest === write.nextDigest) {
    return Object.freeze({ status: 'committed', revision: persisted.revision });
  }
  if (digest === write.currentDigest) {
    return Object.freeze({ status: 'not_committed', revision: persisted.revision });
  }
  if (persisted.revision > write.expectedRevision) {
    return Object.freeze({ status: 'superseded_or_conflict', revision: persisted.revision });
  }
  return Object.freeze({ status: 'indeterminate', revision: persisted.revision });
}

module.exports = {
  FEM_V1_SHADOW_STATE_SCHEMA,
  FEM_V1_SHADOW_WRITE_SCHEMA,
  commitFemV1ShadowStateWrite,
  digestShadowState,
  planFemV1ShadowStateWrite,
  recoverFemV1ShadowStateWrite,
};
