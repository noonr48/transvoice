'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FEM_V1_STATE_TRANSACTION_SCHEMA,
  commitFemV1StateTransaction,
  planFemV1StateTransaction,
  proposalDigest,
} = require('./fem-v1-state-transaction');

function proposal(overrides = {}) {
  return {
    attemptOrdinal: 2,
    attemptSequence: {
      schema: 'transvoice.session_attempt_sequence.v1',
      nextOrdinal: 3,
      attempts: [
        { ordinal: 1, attemptArtifactId: 'baseline', eligible: true, ineligibleReason: null },
        { ordinal: 2, attemptArtifactId: 'attempt-1', eligible: true, ineligibleReason: null },
      ],
    },
    ...overrides,
  };
}

test('transaction plan is revision-checked and carries one complete replacement', () => {
  const plan = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 4,
    expectedRevision: 4, proposedStateDelta: proposal(), appliedTransactions: [],
  });
  assert.equal(plan.schema, FEM_V1_STATE_TRANSACTION_SCHEMA);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.nextRevision, 5);
  assert.equal(plan.replacement.revision, 5);
  assert.deepEqual(plan.replacement.proposedStateDelta, proposal());
  assert.equal(plan.replacement.appliedTransactions.length, 1);
});

test('stale writer gets revision_conflict and no replacement', () => {
  const plan = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 5,
    expectedRevision: 4, proposedStateDelta: proposal(), appliedTransactions: [],
  });
  assert.equal(plan.status, 'revision_conflict');
  assert.equal(plan.replacement, null);
  assert.equal(plan.nextRevision, 5);
});

test('same attempt + same proposal replays idempotently', () => {
  const digest = proposalDigest(proposal());
  const plan = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 5,
    expectedRevision: 5, proposedStateDelta: proposal(),
    appliedTransactions: [{ idempotencyKey: 's1:attempt-1', proposalDigest: digest, revision: 5 }],
  });
  assert.equal(plan.status, 'already_applied');
  assert.equal(plan.replacement, null);
});

test('same attempt id with a different proposal fails closed', () => {
  const digest = proposalDigest(proposal());
  assert.throws(() => planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 5,
    expectedRevision: 5, proposedStateDelta: proposal({ attemptOrdinal: 99 }),
    appliedTransactions: [{ idempotencyKey: 's1:attempt-1', proposalDigest: digest, revision: 5 }],
  }), /idempotency_conflict/);
});

test('digest is deterministic across object-key order', () => {
  assert.equal(
    proposalDigest({ b: 2, a: { d: 4, c: 3 } }),
    proposalDigest({ a: { c: 3, d: 4 }, b: 2 }),
  );
});

test('commit uses exactly one compare-and-swap call', async () => {
  const calls = [];
  const store = {
    async compareAndSwap(args) {
      calls.push(args);
      return { applied: true, value: args.nextValue };
    },
  };
  const plan = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 0,
    expectedRevision: 0, proposedStateDelta: proposal(), appliedTransactions: [],
  });
  const result = await commitFemV1StateTransaction(store, plan);
  assert.equal(result.status, 'committed');
  assert.equal(result.revision, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].expectedRevision, 0);
  assert.equal(calls[0].nextValue.revision, 1);
});

test('store CAS rejection remains a conflict; no retry is hidden inside boundary', async () => {
  let calls = 0;
  const store = {
    async compareAndSwap() {
      calls += 1;
      return { applied: false, currentRevision: 9 };
    },
  };
  const plan = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 8,
    expectedRevision: 8, proposedStateDelta: proposal(), appliedTransactions: [],
  });
  const result = await commitFemV1StateTransaction(store, plan);
  assert.deepEqual(result, { status: 'revision_conflict', revision: 9 });
  assert.equal(calls, 1);
});

test('non-atomic storage adapters are rejected', async () => {
  const plan = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentRevision: 0,
    expectedRevision: 0, proposedStateDelta: proposal(), appliedTransactions: [],
  });
  await assert.rejects(() => commitFemV1StateTransaction({ write: async () => {} }, plan), /atomic_compare_and_swap_store_required/);
});
