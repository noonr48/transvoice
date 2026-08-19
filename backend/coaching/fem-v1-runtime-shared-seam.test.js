'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { evaluateTargetMetricRuntime } = require('./target-metric-runtime');
const { createAttemptSequence, recordFinalizedAttempt } = require('./session-attempt-sequence');

test('shared target runtime always computes FEM through the pure shadow seam', () => {
  const voiceState = { sessionId: 's1', lastAttemptArtifact: { attemptArtifactId: 'a1', selfReport: { pain: true } } };
  const before = structuredClone(voiceState);
  const result = evaluateTargetMetricRuntime({
    voiceState,
    signal: { mode: 'active_drill', takeKind: 'phrase', takeQuality: { usable: true }, capture: { reliability: 'good' } },
    mode: 'shadow',
  });
  assert.ok(result.femV1RuntimeTurn);
  assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  assert.equal(result.femV1RuntimeTurn.action, 'stop_for_safety');
  assert.ok(result.femV1NextShadowState);
  assert.equal(result.femV1NextShadowState.sessionId, 's1');
  assert.deepEqual(voiceState, before);
  if (result.witness) assert.equal(result.witness.fem_v1.turn.action, 'stop_for_safety');
});

test('even target-metric active mode does not promote FEM out of shadow', () => {
  const sig = { mode: 'active_drill', takeKind: 'phrase', takeQuality: { usable: true }, capture: { reliability: 'good' } };
  const result = evaluateTargetMetricRuntime({ voiceState: { sessionId: 's1' }, signal: sig, mode: 'active' });
  assert.equal(result.mode, 'active');
  assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  assert.deepEqual(result.femV1RuntimeTurn.proposedStateDelta, {});
  assert.ok(result.femV1NextShadowState);
});

test('capture failure from the shared signal reaches the FEM controller without inventing an attempt', () => {
  const result = evaluateTargetMetricRuntime({
    voiceState: { sessionId: 's1' },
    signal: { mode: 'active_drill', takeKind: 'phrase', takeQuality: { usable: false }, capture: { reliability: 'unusable' } },
    mode: 'shadow',
  });
  assert.equal(result.femV1RuntimeTurn.action, 'repair_capture');
  assert.equal(result.femV1RuntimeTurn.finalizedAttemptDisposition, null);
});

test('only a real attempt identity enters the exact-next sequence and production state stays untouched', () => {
  const seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true });
  const voiceState = {
    sessionId: 's1',
    attemptSequence: seq,
    lastAttemptArtifact: { attemptArtifactId: 'a2', selfReport: { effort: 2 } },
  };
  const before = structuredClone(voiceState);
  const result = evaluateTargetMetricRuntime({
    voiceState,
    signal: { mode: 'active_drill', takeKind: 'phrase', takeQuality: { usable: true }, capture: { reliability: 'good' } },
    mode: 'shadow',
  });
  assert.equal(result.femV1RuntimeTurn.finalizedAttemptDisposition.attemptArtifactId, 'a2');
  assert.equal(result.femV1RuntimeTurn.finalizedAttemptDisposition.ordinal, 2);
  assert.equal(result.femV1NextShadowState.sessionState.attemptSequence.nextOrdinal, 3);
  assert.deepEqual(result.femV1RuntimeTurn.proposedStateDelta, {});
  assert.deepEqual(voiceState, before);
});

test('pending trial + no finalized attempt stays awaiting; a conversational turn cannot consume it', () => {
  const voiceState = {
    sessionId: 's1',
    pendingTrial: { status: 'pending', trialId: 't1' },
  };
  const result = evaluateTargetMetricRuntime({
    voiceState,
    signal: { mode: 'active_drill', takeKind: 'phrase', takeQuality: { usable: true }, capture: { reliability: 'good' } },
    mode: 'shadow',
  });
  assert.equal(result.femV1RuntimeTurn.settlement.result, 'awaiting_next_attempt');
  assert.equal(result.femV1RuntimeTurn.settlement.trialId, 't1');
});

test('serialized shadow state can be supplied to the next call without mutating production voice state', () => {
  const firstVoice = {
    sessionId: 's1',
    lastAttemptArtifact: { attemptArtifactId: 'a1', selfReport: { effort: 2 } },
  };
  const first = evaluateTargetMetricRuntime({
    voiceState: firstVoice,
    signal: { mode: 'active_drill', takeKind: 'phrase', takeQuality: { usable: true }, capture: { reliability: 'good' } },
    mode: 'shadow',
  });
  const shadow = JSON.parse(JSON.stringify(first.femV1NextShadowState));
  const secondVoice = {
    sessionId: 's1',
    femV1ShadowState: shadow,
    lastAttemptArtifact: { attemptArtifactId: 'a2', selfReport: { effort: 2 } },
  };
  const before = structuredClone(secondVoice);
  const second = evaluateTargetMetricRuntime({
    voiceState: secondVoice,
    signal: { mode: 'active_drill', takeKind: 'phrase', takeQuality: { usable: true }, capture: { reliability: 'good' } },
    mode: 'shadow',
  });
  assert.equal(second.femV1RuntimeTurn.finalizedAttemptDisposition.ordinal, 2);
  assert.equal(second.femV1NextShadowState.sessionState.attemptSequence.nextOrdinal, 3);
  assert.deepEqual(secondVoice, before);
});
