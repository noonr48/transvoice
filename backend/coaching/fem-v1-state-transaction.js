'use strict';

const crypto = require('crypto');

const FEM_V1_STATE_TRANSACTION_SCHEMA = 'transvoice.fem_v1_state_transaction.v1';
const MAX_APPLIED_KEYS = 512;

function deepCloneJson(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function proposalDigest(proposal) {
  return crypto.createHash('sha256').update(JSON.stringify(canonicalize(proposal || {}))).digest('hex');
}

function normalizeSessionId(sessionId) {
  const value = typeof sessionId === 'string' ? sessionId.trim().slice(0, 120) : '';
  if (!value) throw new Error('session_id_required');
  return value;
}

function buildStateKey({ sessionId } = {}) {
  return `fem-v1-session:${normalizeSessionId(sessionId)}`;
}

function buildIdempotencyKey({ sessionId, attemptArtifactId } = {}) {
  const session = normalizeSessionId(sessionId);
  const attempt = typeof attemptArtifactId === 'string' ? attemptArtifactId.trim().slice(0, 160) : '';
  if (!attempt) throw new Error('attempt_artifact_id_required');
  return `${session}:${attempt}`;
}

function normalizeAppliedTransactions(value) {
  if (!Array.isArray(value)) return [];
  return value.slice(-MAX_APPLIED_KEYS).map((entry) => ({
    idempotencyKey: typeof entry?.idempotencyKey === 'string' ? entry.idempotencyKey.slice(0, 220) : null,
    proposalDigest: typeof entry?.proposalDigest === 'string' ? entry.proposalDigest.slice(0, 80) : null,
    revision: Number.isInteger(entry?.revision) && entry.revision >= 0 ? entry.revision : null,
  })).filter((entry) => entry.idempotencyKey && entry.proposalDigest && entry.revision != null);
}

function planFemV1StateTransaction({
  sessionId,
  attemptArtifactId,
  currentRevision,
  expectedRevision,
  proposedStateDelta,
  appliedTransactions = [],
} = {}) {
  if (!Number.isInteger(currentRevision) || currentRevision < 0) throw new Error('current_revision_required');
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new Error('expected_revision_required');

  const stateKey = buildStateKey({ sessionId });
  const idempotencyKey = buildIdempotencyKey({ sessionId, attemptArtifactId });
  const digest = proposalDigest(proposedStateDelta || {});
  const history = normalizeAppliedTransactions(appliedTransactions);
  const prior = history.find((entry) => entry.idempotencyKey === idempotencyKey);

  if (prior) {
    if (prior.proposalDigest !== digest) throw new Error('idempotency_conflict');
    return { schema: FEM_V1_STATE_TRANSACTION_SCHEMA, status: 'already_applied', stateKey, idempotencyKey, proposalDigest: digest, expectedRevision, currentRevision, nextRevision: currentRevision, replacement: null };
  }

  if (currentRevision !== expectedRevision) {
    return { schema: FEM_V1_STATE_TRANSACTION_SCHEMA, status: 'revision_conflict', stateKey, idempotencyKey, proposalDigest: digest, expectedRevision, currentRevision, nextRevision: currentRevision, replacement: null };
  }

  const nextRevision = currentRevision + 1;
  const nextHistory = [...history, { idempotencyKey, proposalDigest: digest, revision: nextRevision }].slice(-MAX_APPLIED_KEYS);
  return {
    schema: FEM_V1_STATE_TRANSACTION_SCHEMA,
    status: 'ready',
    stateKey,
    idempotencyKey,
    proposalDigest: digest,
    expectedRevision,
    currentRevision,
    nextRevision,
    replacement: { revision: nextRevision, proposedStateDelta: deepCloneJson(proposedStateDelta || {}), appliedTransactions: nextHistory },
  };
}

async function commitFemV1StateTransaction(store, transaction) {
  if (!transaction || transaction.schema !== FEM_V1_STATE_TRANSACTION_SCHEMA) throw new Error('fem_v1_transaction_required');
  if (transaction.status === 'already_applied') return { status: 'already_applied', revision: transaction.nextRevision };
  if (transaction.status !== 'ready' || !transaction.replacement) return { status: transaction.status || 'not_ready', revision: transaction.currentRevision ?? null };
  if (!store || typeof store.compareAndSwap !== 'function') throw new Error('atomic_compare_and_swap_store_required');

  const result = await store.compareAndSwap({ key: transaction.stateKey, expectedRevision: transaction.expectedRevision, nextValue: deepCloneJson(transaction.replacement) });
  if (result?.applied === true) return { status: 'committed', revision: transaction.nextRevision, value: result.value ?? null };
  return { status: 'revision_conflict', revision: Number.isInteger(result?.currentRevision) ? result.currentRevision : null };
}

module.exports = { FEM_V1_STATE_TRANSACTION_SCHEMA, buildIdempotencyKey, buildStateKey, commitFemV1StateTransaction, planFemV1StateTransaction, proposalDigest };
