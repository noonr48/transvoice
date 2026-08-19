'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyFemV1ShadowTurn,
  createFemV1ShadowState,
} = require('./fem-v1-shadow-state');
const {
  commitFemV1ShadowStateWrite,
  planFemV1ShadowStateWrite,
  recoverFemV1ShadowStateWrite,
} = require('./fem-v1-shadow-store');

function current() {
  return createFemV1ShadowState({
    sessionId: 'private-session',
    sourceSessionRevision: 3,
    sessionState: { sessionId: 'private-session', stage: 'phrase' },
    learnerState: {},
  });
}

function fakeTurn(ordinal = 1) {
  return {
    mode: 'shadow',
    proposedStateDelta: {},
    shadowStateDelta: { attemptOrdinal: ordinal },
    witness: {
      finalizedAttempt: { evidenceDigest: null },
      turn: { action: 'end_block' },
    },
  };
}

function write() {
  const before = current();
  const after = applyFemV1ShadowTurn(before, fakeTurn(), { sourceSessionRevision: 3 });
  return planFemV1ShadowStateWrite({ currentState: before, nextState: after });
}

test('shadow write is a one-revision CAS in the private hashed namespace', () => {
  const planned = write();
  assert.match(planned.stateKey, /^fem-v1-shadow:[0-9a-f]{40}$/);
  assert.ok(!planned.stateKey.includes('private-session'));
  assert.equal(planned.expectedRevision, 0);
  assert.equal(planned.nextRevision, 1);
});

test('two writers from one revision contend on the same shadow key', async () => {
  const initial = current();
  const firstNext = applyFemV1ShadowTurn(initial, fakeTurn(1));
  const secondNext = applyFemV1ShadowTurn(initial, fakeTurn(2));
  const first = planFemV1ShadowStateWrite({ currentState: initial, nextState: firstNext });
  const second = planFemV1ShadowStateWrite({ currentState: initial, nextState: secondNext });
  let value = initial;
  const store = {
    async compareAndSwap({ expectedRevision, nextValue }) {
      if (value.revision !== expectedRevision) {
        return { applied: false, currentRevision: value.revision };
      }
      value = nextValue;
      return { applied: true };
    },
  };
  assert.deepEqual(await commitFemV1ShadowStateWrite(store, first), {
    status: 'committed', revision: 1,
  });
  assert.deepEqual(await commitFemV1ShadowStateWrite(store, second), {
    status: 'revision_conflict', revision: 1,
  });
});

test('transport ambiguity requires read recovery rather than retry', async () => {
  let calls = 0;
  const planned = write();
  const result = await commitFemV1ShadowStateWrite({
    async compareAndSwap() {
      calls += 1;
      throw new Error('transport_timeout');
    },
  }, planned);
  assert.deepEqual(result, { status: 'commit_unknown', recoveryRequired: true });
  assert.equal(calls, 1);
});

test('recovery recognizes the already-committed private shadow state', async () => {
  const planned = write();
  const result = await recoverFemV1ShadowStateWrite({
    async get() { return { value: planned.nextState }; },
  }, planned);
  assert.deepEqual(result, { status: 'committed', revision: 1 });
});

test('recovery distinguishes unchanged state from committed state', async () => {
  const initial = current();
  const next = applyFemV1ShadowTurn(initial, fakeTurn());
  const planned = planFemV1ShadowStateWrite({ currentState: initial, nextState: next });
  const result = await recoverFemV1ShadowStateWrite({
    async get() { return initial; },
  }, planned);
  assert.deepEqual(result, { status: 'not_committed', revision: 0 });
});

test('write refuses session crossing or skipped revisions', () => {
  const initial = current();
  const other = createFemV1ShadowState({
    sessionId: 'other-session', sessionState: { sessionId: 'other-session' }, learnerState: {}, revision: 1,
  });
  assert.throws(
    () => planFemV1ShadowStateWrite({ currentState: initial, nextState: other }),
    /shadow_write_session_mismatch/,
  );
  const skipped = createFemV1ShadowState({
    sessionId: 'private-session', sessionState: { sessionId: 'private-session' }, learnerState: {}, revision: 2,
  });
  assert.throws(
    () => planFemV1ShadowStateWrite({ currentState: initial, nextState: skipped }),
    /shadow_write_revision_not_next/,
  );
});
