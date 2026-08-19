'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FEM_V1_PERSISTED_STATE_SCHEMA,
  FEM_V1_STATE_TRANSACTION_SCHEMA,
  buildIdempotencyKey,
  buildStateKey,
  commitFemV1StateTransaction,
  createFemV1PersistedState,
  planFemV1StateTransaction,
  proposalDigest,
  recoverFemV1StateTransaction,
} = require('./fem-v1-state-transaction');

function proposal(overrides = {}) {
  return {
    attemptOrdinal: 2,
    attemptSequence: {
      schema: 'transvoice.session_attempt_sequence.v1', nextOrdinal: 3,
      attempts: [
        { ordinal: 1, attemptArtifactId: 'baseline', eligible: true, ineligibleReason: null },
        { ordinal: 2, attemptArtifactId: 'attempt-1', eligible: true, ineligibleReason: null },
      ],
    },
    ...overrides,
  };
}

function currentState(overrides = {}) {
  return createFemV1PersistedState({
    revision: 4,
    sessionState: {
      sessionId: 's1', stage: 'phrase', pendingTrial: { status: 'pending', trialId: 't1' },
    },
    learnerState: {
      mastery: { curriculumPhase: 'pitch_foundation' }, motorResponseMap: { existing: true },
    },
    ...overrides,
  });
}

function plan(overrides = {}) {
  return planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentState: currentState(),
    expectedRevision: 4, proposedStateDelta: proposal(), ...overrides,
  });
}

test('transaction writes a complete next state rather than a delta wrapper', () => {
  const result = plan();
  assert.equal(result.schema, FEM_V1_STATE_TRANSACTION_SCHEMA);
  assert.equal(result.status, 'ready');
  assert.equal(result.replacement.schema, FEM_V1_PERSISTED_STATE_SCHEMA);
  assert.equal(result.replacement.revision, 5);
  assert.equal(result.replacement.sessionState.stage, 'phrase');
  assert.equal(result.replacement.sessionState.lastAttemptOrdinal, 2);
  assert.equal(result.replacement.sessionState.attemptSequence.attempts.length, 2);
  assert.equal(result.replacement.learnerState.mastery.curriculumPhase, 'pitch_foundation');
  assert.deepEqual(result.replacement.learnerState.motorResponseMap, { existing: true });
  assert.equal(result.replacement.proposedStateDelta, undefined);
});

test('state and idempotency keys are structured hashes, not raw identifiers', () => {
  const stateKey = buildStateKey({ sessionId: 'sensitive-session-id' });
  const idempotencyKey = buildIdempotencyKey({
    sessionId: 'sensitive-session-id', attemptArtifactId: 'attempt:with:delimiters',
  });
  assert.ok(!stateKey.includes('sensitive-session-id'));
  assert.ok(!idempotencyKey.includes('sensitive-session-id'));
  assert.ok(!idempotencyKey.includes('attempt:with:delimiters'));
  assert.notEqual(
    buildIdempotencyKey({ sessionId: 'a:b', attemptArtifactId: 'c' }),
    buildIdempotencyKey({ sessionId: 'a', attemptArtifactId: 'b:c' }),
  );
});

test('identifiers are rejected rather than silently truncated', () => {
  assert.throws(() => buildStateKey({ sessionId: 'x'.repeat(161) }), /session_id_too_long/);
});

test('stale writer gets revision_conflict and no replacement', () => {
  const result = plan({ expectedRevision: 3 });
  assert.equal(result.status, 'revision_conflict');
  assert.equal(result.replacement, null);
});

test('same attempt and same proposal replays idempotently even after revision advances', () => {
  const digest = proposalDigest(proposal());
  const state = currentState({
    revision: 5,
    appliedTransactions: [{
      idempotencyKey: buildIdempotencyKey({ sessionId: 's1', attemptArtifactId: 'attempt-1' }),
      proposalDigest: digest, revision: 5,
    }],
  });
  const result = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentState: state,
    expectedRevision: 4, proposedStateDelta: proposal(),
  });
  assert.equal(result.status, 'already_applied');
});

test('same attempt with a different proposal fails closed', () => {
  const digest = proposalDigest(proposal());
  const state = currentState({
    revision: 5,
    appliedTransactions: [{
      idempotencyKey: buildIdempotencyKey({ sessionId: 's1', attemptArtifactId: 'attempt-1' }),
      proposalDigest: digest, revision: 5,
    }],
  });
  assert.throws(() => planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'attempt-1', currentState: state,
    expectedRevision: 5, proposedStateDelta: proposal({ attemptOrdinal: 99 }),
  }), /idempotency_conflict/);
});

test('different attempts in one session contend on one CAS key', async () => {
  const storeState = new Map();
  const initial = createFemV1PersistedState({ revision: 0 });
  const stateKey = buildStateKey({ sessionId: 's1' });
  storeState.set(stateKey, initial);
  const store = {
    async compareAndSwap({ key, expectedRevision, nextValue }) {
      const value = storeState.get(key);
      if (value.revision !== expectedRevision) return { applied: false, currentRevision: value.revision };
      storeState.set(key, nextValue);
      return { applied: true, value: nextValue };
    },
  };
  const first = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'a1', currentState: initial,
    expectedRevision: 0, proposedStateDelta: { attemptOrdinal: 1 },
  });
  const second = planFemV1StateTransaction({
    sessionId: 's1', attemptArtifactId: 'a2', currentState: initial,
    expectedRevision: 0, proposedStateDelta: { attemptOrdinal: 2 },
  });
  assert.equal(first.stateKey, second.stateKey);
  assert.notEqual(first.idempotencyKey, second.idempotencyKey);
  assert.equal((await commitFemV1StateTransaction(store, first)).status, 'committed');
  assert.deepEqual(await commitFemV1StateTransaction(store, second), {
    status: 'revision_conflict', revision: 1,
  });
});

test('commit transport failure is unknown, never silently retried', async () => {
  let calls = 0;
  const store = { async compareAndSwap() { calls += 1; throw new Error('network_timeout'); } };
  const result = await commitFemV1StateTransaction(store, plan());
  assert.deepEqual(result, { status: 'commit_unknown', revision: null, recoveryRequired: true });
  assert.equal(calls, 1);
});

test('read-after-unknown recovers a committed transaction by idempotency record', async () => {
  const transaction = plan();
  const store = { async get() { return { value: transaction.replacement }; } };
  assert.deepEqual(await recoverFemV1StateTransaction(store, transaction), {
    status: 'committed', revision: 5,
  });
});

test('read-after-unknown distinguishes an uncommitted unchanged state', async () => {
  const transaction = plan();
  const store = { async get() { return { value: currentState() }; } };
  assert.deepEqual(await recoverFemV1StateTransaction(store, transaction), {
    status: 'not_committed', revision: 4,
  });
});

test('unsupported state delta keys fail closed', () => {
  assert.throws(
    () => plan({ proposedStateDelta: { arbitraryMutation: true } }),
    /unsupported_state_delta_key:arbitraryMutation/,
  );
});
