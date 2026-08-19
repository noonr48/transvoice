'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateTargetMetricRuntime,
  normalizeFemV1RuntimeMode,
} = require('./target-metric-runtime');

function signal() {
  return {
    mode: 'active_drill',
    takeKind: 'phrase',
    takeQuality: { usable: true },
    capture: { reliability: 'good' },
  };
}

test('shared FEM mode has only off and shadow authority', () => {
  assert.equal(normalizeFemV1RuntimeMode('off'), 'off');
  assert.equal(normalizeFemV1RuntimeMode('shadow'), 'shadow');
  assert.equal(normalizeFemV1RuntimeMode('active'), 'shadow');
  assert.equal(normalizeFemV1RuntimeMode('unexpected'), 'shadow');
});

test('explicit FEM off suppresses the shared FEM turn and nested witness', () => {
  const result = evaluateTargetMetricRuntime({
    voiceState: { sessionId: 'mode-session' },
    signal: signal(),
    mode: 'shadow',
    femV1Mode: 'off',
  });
  assert.equal(result.femV1Mode, 'off');
  assert.equal(result.femV1RuntimeTurn, null);
  assert.equal(result.femV1NextShadowState, null);
  if (result.witness) assert.equal(result.witness.fem_v1, null);
});

test('attempted FEM active mode fails closed to shadow at the shared seam', () => {
  const result = evaluateTargetMetricRuntime({
    voiceState: { sessionId: 'mode-session' },
    signal: signal(),
    mode: 'active',
    femV1Mode: 'active',
  });
  assert.equal(result.femV1Mode, 'shadow');
  assert.ok(result.femV1RuntimeTurn);
  assert.equal(result.femV1RuntimeTurn.mode, 'shadow');
  assert.deepEqual(result.femV1RuntimeTurn.proposedStateDelta, {});
});
