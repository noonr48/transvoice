'use strict';

const crypto = require('crypto');

const FEM_V1_STATE_TRANSACTION_SCHEMA = 'transvoice.fem_v1_state_transaction.v2';
const FEM_V1_PERSISTED_STATE_SCHEMA = 'transvoice.fem_v1_persisted_state.v1';
const MAX_APPLIED_TRANSACTIONS = 2048;
const MAX_ID_LENGTH = 160;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value, path = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}_non_finite`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error(`${path}.${key}_undefined`);
      out[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`${path}_not_json`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(canonicalize(value)));
}

function digestJson(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function strictId(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}_required`);
  const text = value.trim();
  if (text.length > MAX_ID_LENGTH) throw new Error(`${field}_too_long`);
  return text;
}

function structuredKey(prefix, values) {
  return `${prefix}:${crypto.createHash('sha256')
    .update(JSON.stringify(values))
    .digest('hex')
    .slice(0, 40)}`;
}

function buildStateKey({ sessionId } = {}) {
  return structuredKey('fem-v1-session', ['session', strictId(sessionId, 'session_id')]);
}

function buildIdempotencyKey({ sessionId, attemptArtifactId } = {}) {
  return structuredKey('fem-v1-attempt', [
    'attempt', strictId(sessionId, 'session_id'), strictId(attemptArtifactId, 'attempt_artifact_id'),
  ]);
}

function proposalDigest(proposal) {
  return digestJson(proposal || {});
}

function normalizeAppliedTransactions(value) {
  if (!Array.isArray(value)) throw new Error('applied_transactions_invalid');
  return value.map((entry) => {
    if (!isPlainObject(entry)
      || typeof entry.idempotencyKey !== 'string'
      || typeof entry.proposalDigest !== 'string'
      || !Number.isInteger(entry.revision)
      || entry.revision < 1) {
      throw new Error('applied_transaction_invalid');
    }
    return {
      idempotencyKey: entry.idempotencyKey,
      proposalDigest: entry.proposalDigest,
      revision: entry.revision,
    };
  });
}

function createFemV1PersistedState({
  revision = 0, sessionState = {}, learnerState = {}, appliedTransactions = [],
} = {}) {
  if (!Number.isInteger(revision) || revision < 0) throw new Error('state_revision_invalid');
  return {
    schema: FEM_V1_PERSISTED_STATE_SCHEMA,
    revision,
    sessionState: cloneJson(isPlainObject(sessionState) ? sessionState : {}),
    learnerState: cloneJson(isPlainObject(learnerState) ? learnerState : {}),
    appliedTransactions: normalizeAppliedTransactions(appliedTransactions),
  };
}

function normalizeFemV1PersistedState(value) {
  if (!isPlainObject(value) || value.schema !== FEM_V1_PERSISTED_STATE_SCHEMA) {
    throw new Error('fem_v1_persisted_state_required');
  }
  return createFemV1PersistedState(value);
}

const SESSION_DELTA_KEYS = new Set(['attemptSequence', 'attemptOrdinal', 'pendingTrial']);
const LEARNER_DELTA_KEYS = new Set(['motorResponseMap']);

function applyFemV1StateDelta(currentState, proposedStateDelta = {}) {
  const state = normalizeFemV1PersistedState(currentState);
  if (!isPlainObject(proposedStateDelta)) throw new Error('proposed_state_delta_invalid');

  const nextSession = cloneJson(state.sessionState);
  const nextLearner = cloneJson(state.learnerState);
  for (const [key, value] of Object.entries(proposedStateDelta)) {
    if (SESSION_DELTA_KEYS.has(key)) {
      nextSession[key === 'attemptOrdinal' ? 'lastAttemptOrdinal' : key] = cloneJson(value);
    } else if (LEARNER_DELTA_KEYS.has(key)) {
      nextLearner[key] = cloneJson(value);
    } else {
      throw new Error(`unsupported_state_delta_key:${key}`);
    }
  }

  return { ...state, sessionState: nextSession, learnerState: nextLearner };
}

function planFemV1StateTransaction({
  sessionId,
  attemptArtifactId,
  currentState = null,
  currentRevision = null,
  expectedRevision,
  proposedStateDelta,
  appliedTransactions = [],
} = {}) {
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('expected_revision_required');
  }

  let state;
  if (currentState) {
    state = normalizeFemV1PersistedState(currentState);
    if (currentRevision != null && currentRevision !== state.revision) {
      throw new Error('current_revision_state_mismatch');
    }
  } else {
    if (!Number.isInteger(currentRevision) || currentRevision < 0) throw new Error('current_revision_required');
    state = createFemV1PersistedState({ revision: currentRevision, appliedTransactions });
  }

  const stateKey = buildStateKey({ sessionId });
  const idempotencyKey = buildIdempotencyKey({ sessionId, attemptArtifactId });
  const digest = proposalDigest(proposedStateDelta || {});
  const prior = state.appliedTransactions.find((entry) => entry.idempotencyKey === idempotencyKey);

  if (prior) {
    if (prior.proposalDigest !== digest) throw new Error('idempotency_conflict');
    return {
      schema: FEM_V1_STATE_TRANSACTION_SCHEMA, status: 'already_applied', stateKey, idempotencyKey,
      proposalDigest: digest, expectedRevision, currentRevision: state.revision,
      nextRevision: state.revision, replacement: null,
    };
  }

  if (state.revision !== expectedRevision) {
    return {
      schema: FEM_V1_STATE_TRANSACTION_SCHEMA, status: 'revision_conflict', stateKey, idempotencyKey,
      proposalDigest: digest, expectedRevision, currentRevision: state.revision,
      nextRevision: state.revision, replacement: null,
    };
  }

  if (state.appliedTransactions.length >= MAX_APPLIED_TRANSACTIONS) {
    throw new Error('idempotency_history_capacity_reached');
  }

  const nextRevision = state.revision + 1;
  const reduced = applyFemV1StateDelta(state, proposedStateDelta || {});
  const replacement = {
    ...reduced,
    revision: nextRevision,
    appliedTransactions: [
      ...state.appliedTransactions,
      { idempotencyKey, proposalDigest: digest, revision: nextRevision },
    ],
  };

  return {
    schema: FEM_V1_STATE_TRANSACTION_SCHEMA, status: 'ready', stateKey, idempotencyKey,
    proposalDigest: digest, expectedRevision, currentRevision: state.revision,
    nextRevision, replacement,
  };
}

async function commitFemV1StateTransaction(store, transaction) {
  if (!transaction || transaction.schema !== FEM_V1_STATE_TRANSACTION_SCHEMA) {
    throw new Error('fem_v1_transaction_required');
  }
  if (transaction.status === 'already_applied') {
    return { status: 'already_applied', revision: transaction.nextRevision };
  }
  if (transaction.status !== 'ready' || !transaction.replacement) {
    return { status: transaction.status || 'not_ready', revision: transaction.currentRevision ?? null };
  }
  if (!store || typeof store.compareAndSwap !== 'function') {
    throw new Error('atomic_compare_and_swap_store_required');
  }

  try {
    const result = await store.compareAndSwap({
      key: transaction.stateKey,
      expectedRevision: transaction.expectedRevision,
      nextValue: cloneJson(transaction.replacement),
    });
    if (result?.applied === true) {
      return {
        status: 'committed', revision: transaction.nextRevision,
        value: result.value ?? transaction.replacement,
      };
    }
    return {
      status: 'revision_conflict',
      revision: Number.isInteger(result?.currentRevision) ? result.currentRevision : null,
    };
  } catch (_) {
    // A transport failure can happen after storage committed. Never blind-retry.
    return { status: 'commit_unknown', revision: null, recoveryRequired: true };
  }
}

async function recoverFemV1StateTransaction(store, transaction) {
  if (!transaction || transaction.schema !== FEM_V1_STATE_TRANSACTION_SCHEMA) {
    throw new Error('fem_v1_transaction_required');
  }
  if (!store || typeof store.get !== 'function') throw new Error('state_read_store_required');

  const result = await store.get({ key: transaction.stateKey });
  const rawState = isPlainObject(result) && Object.prototype.hasOwnProperty.call(result, 'value')
    ? result.value : result;
  const state = normalizeFemV1PersistedState(rawState);
  const prior = state.appliedTransactions.find(
    (entry) => entry.idempotencyKey === transaction.idempotencyKey,
  );
  if (prior) {
    if (prior.proposalDigest !== transaction.proposalDigest) {
      return { status: 'idempotency_conflict', revision: state.revision };
    }
    return { status: 'committed', revision: prior.revision };
  }
  if (state.revision <= transaction.expectedRevision) {
    return { status: 'not_committed', revision: state.revision };
  }
  return { status: 'indeterminate', revision: state.revision };
}

module.exports = {
  FEM_V1_PERSISTED_STATE_SCHEMA,
  FEM_V1_STATE_TRANSACTION_SCHEMA,
  MAX_APPLIED_TRANSACTIONS,
  applyFemV1StateDelta,
  buildIdempotencyKey,
  buildStateKey,
  commitFemV1StateTransaction,
  createFemV1PersistedState,
  normalizeFemV1PersistedState,
  planFemV1StateTransaction,
  proposalDigest,
  recoverFemV1StateTransaction,
};
