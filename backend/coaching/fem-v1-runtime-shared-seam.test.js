'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTargetMetricRuntime } = require('./target-metric-runtime');
const { createAttemptSequence, recordFinalizedAttempt } = require('./session-attempt-sequence');

function signal(overrides = {}) {
  return {
    mode: 'active_drill',
    takeKind: 'phrase',
    takeQuality: { usable: true },
    capture: { reliability: 'good' },
    ...overrides,
  };
}

test('shared target runtime always computes FEM through the pure shadow seam', () => {
  const voiceState = { lastAttemptArtifact: { selfReport: { pain: true } } };
  const before = structuredClone(voiceState);
  const result = evaluateTargetMetricRuntime({ voiceState, signal: signal(), mode: 'shadow' });
  assert.ok(result.femV1RuntimeTurn);
  assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  assert.equal(result.femV1RuntimeTurn.action, 'stop_for_safety');
  assert.deepEqual(voiceState, before);
  if (result.witness) assert.equal(result.witness.fem_v1.turn.action, 'stop_for_safety');
});

test('even target-metric active mode does not promote FEM out of shadow', () => {
  const sig = signal();
  const result = evaluateTargetMetricRuntime({ voiceState: {}, signal: sig, mode: 'active' });
  assert.equal(result.mode, 'active');
  assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  assert.deepEqual(result.femV1RuntimeTurn.proposedStateDelta, {});
});

test('capture failure from the shared signal reaches the FEM controller without inventing an attempt', () => {
  const result = evaluateTargetMetricRuntime({
    voiceState: {},
    signal: signal({ takeQuality: { usable: false }, capture: { reliability: 'unusable' } }),
    mode: 'shadow',
  });
  assert.equal(result.femV1RuntimeTurn.action, 'repair_capture');
  assert.equal(result.femV1RuntimeTurn.finalizedAttemptDisposition, null);
});

test('only a real attempt identity enters the exact-next sequence and shadow still cannot mutate it', () => {
  const seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true });
  const voiceState = {
    sessionId: 's1',
    attemptSequence: seq,
    lastAttemptArtifact: { attemptArtifactId: 'a2', selfReport: { effort: 2 } },
  };
  const before = structuredClone(voiceState);
  const result = evaluateTargetMetricRuntime({ voiceState, signal: signal(), mode: 'shadow' });
  assert.equal(result.femV1RuntimeTurn.finalizedAttemptDisposition.attemptArtifactId, 'a2');
  assert.equal(result.femV1RuntimeTurn.finalizedAttemptDisposition.ordinal, 2);
  assert.deepEqual(result.femV1RuntimeTurn.proposedStateDelta, {});
  assert.deepEqual(voiceState, before);
});

test('pending trial + no finalized attempt stays awaiting; a conversational turn cannot consume it', () => {
  const voiceState = {
    sessionId: 's1',
    pendingTrial: { status: 'pending', trialId: 't1' },
  };
  const result = evaluateTargetMetricRuntime({ voiceState, signal: signal(), mode: 'shadow' });
  assert.equal(result.femV1RuntimeTurn.settlement.result, 'awaiting_next_attempt');
  assert.equal(result.femV1RuntimeTurn.settlement.trialId, 't1');
});
