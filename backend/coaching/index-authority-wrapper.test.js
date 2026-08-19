'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const coaching = require('./index');
const legacy = require('./index-legacy');

test('public barrel preserves legacy exports while overriding coachingTurn only', () => {
  for (const [name, value] of Object.entries(legacy)) {
    if (name === 'coachingTurn') continue;
    assert.equal(coaching[name], value, name);
  }
  assert.notEqual(coaching.coachingTurn, legacy.coachingTurn);
});

test('canonical wrapper suppresses the legacy direct FEM calculation', async () => {
  const original = legacy.coachingTurn;
  let observedMode = null;
  legacy.coachingTurn = async (options = {}) => {
    observedMode = options.femV1ControllerMode;
    return {
      signal: null,
      targetMetricBridge: null,
      targetMetricShadowWitness: null,
    };
  };
  try {
    const result = await coaching.coachingTurn({
      voiceState: { sessionId: 'single-authority-session' },
      femV1ControllerMode: 'active',
    });
    assert.equal(observedMode, 'off');
    assert.ok(result.femV1RuntimeTurn);
    assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  } finally {
    legacy.coachingTurn = original;
  }
});

test('public coachingTurn exposes the shared FEM runtime as its one returned authority', async () => {
  const result = await coaching.coachingTurn({
    voiceState: {
      sessionId: 'wrapper-session',
      lastAttemptArtifact: {
        attemptArtifactId: 'wrapper-attempt-1',
        selfReport: { pain: true },
      },
    },
    callModel: null,
  });
  assert.ok(result.femV1RuntimeTurn);
  assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  assert.equal(result.femV1ControllerTurn, result.femV1RuntimeTurn.controllerTurn);
  assert.equal(result.femV1ControllerTurn.action, 'stop_for_safety');
  assert.equal(result.femV1ControllerTurn.safetyReason, 'pain');
  assert.ok(result.femV1NextShadowState);
  assert.equal(result.femV1NextShadowState.sessionId, 'wrapper-session');
  assert.equal(result.femV1BeginnerCard.result.state, 'safety_stop');
  if (result.targetMetricShadowWitness) {
    assert.deepEqual(result.targetMetricShadowWitness.fem_v1, result.femV1RuntimeTurn.witness);
  }
});

test('FEM off removes returned controller, card, runtime, state and nested witness', async () => {
  const result = await coaching.coachingTurn({
    voiceState: { sessionId: 'wrapper-off-session' },
    callModel: null,
    femV1ControllerMode: 'off',
  });
  assert.equal(result.femV1ControllerTurn, null);
  assert.equal(result.femV1BeginnerCard, null);
  assert.equal(result.femV1RuntimeTurn, null);
  assert.equal(result.femV1NextShadowState, null);
  if (result.targetMetricShadowWitness) assert.equal(result.targetMetricShadowWitness.fem_v1, null);
});

test('legacy active request cannot promote the public FEM runtime out of shadow', async () => {
  const result = await coaching.coachingTurn({
    voiceState: { sessionId: 'wrapper-active-session' },
    callModel: null,
    femV1ControllerMode: 'active',
  });
  assert.ok(result.femV1RuntimeTurn);
  assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  assert.deepEqual(result.femV1RuntimeTurn.proposedStateDelta, {});
});
