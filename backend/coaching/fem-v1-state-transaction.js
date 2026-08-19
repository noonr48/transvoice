'use strict';

const crypto = require('crypto');

/**
 * Atomic-application contract for future FEM v1 active mode.
 *
 * The coaching orchestrator remains pure and returns a proposedStateDelta.
 * This module turns that proposal into a revision-checked, idempotent
 * transaction plan. Storage adapters must commit the COMPLETE replacement in
 * one compare-and-swap operation; there is deliberately no per-field writer.
 *
 * Nothing in this module enables learner-facing active coaching.
 */

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
  const canonical = JSON.stringify(canonicalize(proposal || {}));
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function normalizeAppliedTransactions(appliedTransactions) {
  if (!Array.isArray(appliedTransactions)) return [];
  return appliedTransactions.slice(-MAX_APPLIED_KEYS).map((entry) => ({
    idempotencyKey: typeof entry?.idempotencyKey === 'string' ? entry.idempotencyKey.slice(0, 220) : null,
    proposalDigest: typeof entry?.proposalDigest === 'string' ? entry.proposalDigest.slice(0, 80) : null,
    revision: Number.isInteger(entry?.revision) && entry.revision >= 0 ? entry.revision : null,
  })).filter((entry) => entry.idempotencyKey && entry.proposalDigest && entry.revision != null);
}

function buildIdempotencyKey({ sessionId, attemptArtifactId }) {
  const session = typeof sessionId === 'string' ? sessionId.trim().slice(0, 120) : '';
  const attempt = typeof attemptArtifactId === 'string' ? attemptArtifactId.trim().slice(0, 160) : '';
  if (!session) throw new Error('session_id_required');
  if (!attempt) throw new Error('attempt_artifact_id_required');
  return `${session}:${attempt}`;
}

/**
 * Plan an all-or-nothing state transaction.
 *
 * `currentRevision` and `expectedRevision` are intentionally explicit; a
 * stale caller cannot silently overwrite newer mastery/trial state.
 */
function planFemV1StateTransaction({
  sessionId,
  attemptArtifactId,
  currentRevision,
  expectedRevision,
  proposedStateDelta,
  appliedTransactions = [],
} = {}) {
  if (!Number.isInteger(currentRevision) || currentRevision < 0) {
    throw new Error('current_revision_required');
  }
  if (!Number.isInteger(expectedRevision) || expectedRevision < 0) {
    throw new Error('expected_revision_required');
  }
  const idempotencyKey = buildIdempotencyKey({ sessionId, attemptArtifactId });
  const digest = proposalDigest(proposedStateDelta || {});
  const history = normalizeAppliedTransactions(appliedTransactions);
  const prior = history.find((entry) => entry.idempotencyKey === idempotencyKey);

  if (prior) {
    if (prior.proposalDigest !== digest) throw new Error('idempotency_conflict');
    return {
      schema: FEM_V1_STATE_TRANSACTION_SCHEMA,
      status: 'already_applied',
      idempotencyKey,
      proposalDigest: digest,
      expectedRevision,
      currentRevision,
      nextRevision: currentRevision,
      replacement: null,
    };
  }

  if (currentRevision !== expectedRevision) {
    return {
      schema: FEM_V1_STATE_TRANSACTION_SCHEMA,
      status: 'revision_conflict',
      idempotencyKey,
      proposalDigest: digest,
      expectedRevision,
      currentRevision,
      nextRevision: currentRevision,
      replacement: null,
    };
  }

  const nextRevision = currentRevision + 1;
  const nextHistory = [
    ...history,
    { idempotencyKey, proposalDigest: digest, revision: nextRevision },
  ].slice(-MAX_APPLIED_KEYS);

  return {
    schema: FEM_V1_STATE_TRANSACTION_SCHEMA,
    status: 'ready',
    idempotencyKey,
    proposalDigest: digest,
    expectedRevision,
    currentRevision,
    nextRevision,
    replacement: {
      revision: nextRevision,
      proposedStateDelta: deepCloneJson(proposedStateDelta || {}),
      appliedTransactions: nextHistory,
    },
  };
}

/**
 * Storage adapter contract:
 *
 *   store.compareAndSwap({ key, expectedRevision, nextValue })
 *     -> { applied: true, value }
 *     -> { applied: false, currentRevision }
 *
 * The adapter owns durability/fsync/database semantics. We require ONE CAS so
 * trial settlement, attempt sequence and later mastery/motor-map changes cannot
 * partially commit through this boundary.
 */
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

  const result = await store.compareAndSwap({
    key: transaction.idempotencyKey,
    expectedRevision: transaction.expectedRevision,
    nextValue: deepCloneJson(transaction.replacement),
  });
  if (result?.applied === true) {
    return { status: 'committed', revision: transaction.nextRevision, value: result.value ?? null };
  }
  return {
    status: 'revision_conflict',
    revision: Number.isInteger(result?.currentRevision) ? result.currentRevision : null,
  };
}

module.exports = {
  FEM_V1_STATE_TRANSACTION_SCHEMA,
  buildIdempotencyKey,
  commitFemV1StateTransaction,
  planFemV1StateTransaction,
  proposalDigest,
};
