'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FEM_V1_STATE_TRANSACTION_SCHEMA, buildIdempotencyKey, buildStateKey, commitFemV1StateTransaction, planFemV1StateTransaction, proposalDigest } = require('./fem-v1-state-transaction');

function proposal(overrides = {}) {
  return { attemptOrdinal: 2, attemptSequence: { schema: 'transvoice.session_attempt_sequence.v1', nextOrdinal: 3, attempts: [{ ordinal: 1, attemptArtifactId: 'baseline', eligible: true, ineligibleReason: null }, { ordinal: 2, attemptArtifactId: 'attempt-1', eligible: true, ineligibleReason: null }] }, ...overrides };
}

function plan(overrides = {}) {
  return planFemV1StateTransaction({ sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 4, expectedRevision: 4, proposedStateDelta: proposal(), appliedTransactions: [], ...overrides });
}

test('transaction plan is revision checked and carries one complete replacement', () => {
  const result = plan();
  assert.equal(result.schema, FEM_V1_STATE_TRANSACTION_SCHEMA);
  assert.equal(result.status, 'ready');
  assert.equal(result.stateKey, 'fem-v1-session:s1');
  assert.equal(result.nextRevision, 5);
  assert.equal(result.replacement.revision, 5);
  assert.deepEqual(result.replacement.proposedStateDelta, proposal());
});

test('state key is session scoped while idempotency remains attempt scoped', () => {
  assert.equal(buildStateKey({ sessionId: 's1' }), buildStateKey({ sessionId: 's1' }));
  assert.notEqual(buildIdempotencyKey({ sessionId: 's1', attemptArtifactId: 'a1' }), buildIdempotencyKey({ sessionId: 's1', attemptArtifactId: 'a2' }));
  assert.notEqual(buildStateKey({ sessionId: 's1' }), buildStateKey({ sessionId: 's2' }));
});

test('stale writer gets revision_conflict and no replacement', () => {
  const result = plan({ currentRevision: 5, expectedRevision: 4 });
  assert.equal(result.status, 'revision_conflict');
  assert.equal(result.replacement, null);
});

test('same attempt and same proposal replays idempotently', () => {
  const digest = proposalDigest(proposal());
  const result = plan({ currentRevision: 5, expectedRevision: 5, appliedTransactions: [{ idempotencyKey: 's1:attempt-1', proposalDigest: digest, revision: 5 }] });
  assert.equal(result.status, 'already_applied');
});

test('same attempt with a different proposal fails closed', () => {
  const digest = proposalDigest(proposal());
  assert.throws(() => plan({ currentRevision: 5, expectedRevision: 5, proposedStateDelta: proposal({ attemptOrdinal: 99 }), appliedTransactions: [{ idempotencyKey: 's1:attempt-1', proposalDigest: digest, revision: 5 }] }), /idempotency_conflict/);
});

test('digest is deterministic across object key order', () => {
  assert.equal(proposalDigest({ b: 2, a: { d: 4, c: 3 } }), proposalDigest({ a: { c: 3, d: 4 }, b: 2 }));
});

test('different attempts in one session contend on one CAS key', async () => {
  const current = new Map([['fem-v1-session:s1', { revision: 0 }]]);
  const store = { async compareAndSwap({ key, expectedRevision, nextValue }) { const value = current.get(key) || { revision: 0 }; if (value.revision !== expectedRevision) return { applied: false, currentRevision: value.revision }; current.set(key, nextValue); return { applied: true, value: nextValue }; } };
  const first = plan({ currentRevision: 0, expectedRevision: 0, attemptArtifactId: 'a1' });
  const second = plan({ currentRevision: 0, expectedRevision: 0, attemptArtifactId: 'a2' });
  assert.equal(first.stateKey, second.stateKey);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.equal((await commitFemV1StateTransaction(store, first)).status, 'committed');
  assert.deepEqual(await commitFemV1StateTransaction(store, second), { status: 'revision_conflict', revision: 1 });
});

test('commit uses exactly one compare-and-swap call', async () => {
  const calls = [];
  const store = { async compareAndSwap(args) { calls.push(args); return { applied: true, value: args.nextValue }; } };
  const result = await commitFemV1StateTransaction(store, plan({ currentRevision: 0, expectedRevision: 0 }));
  assert.equal(result.status, 'committed');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].key, 'fem-v1-session:s1');
});

test('store CAS rejection is surfaced without a hidden retry', async () => {
  let calls = 0;
  const store = { async compareAndSwap() { calls += 1; return { applied: false, currentRevision: 9 }; } };
  assert.deepEqual(await commitFemV1StateTransaction(store, plan({ currentRevision: 8, expectedRevision: 8 })), { status: 'revision_conflict', revision: 9 });
  assert.equal(calls, 1);
});

test('non atomic storage adapters are rejected', async () => {
  await assert.rejects(() => commitFemV1StateTransaction({ write: async () => {} }, plan()), /atomic_compare_and_swap_store_required/);
});
