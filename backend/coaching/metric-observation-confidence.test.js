'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { targetDistance, isUsableObservation } = require('./metric-observations');

test('target confidence is fail-closed to the weaker declared source', () => {
  const observation = {
    metricId: 'resonance.global_scale',
    dimension: 'resonance.global_scale',
    value: 0.2,
    unit: 'score',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.9 },
    target: {
      low: 0.4,
      high: 0.6,
      scale: 0.1,
      source: 'reference',
      confidence: 0.3,
    },
  };
  const distance = targetDistance(observation);
  assert.equal(distance.confidence.target, 0.3);
  assert.equal(distance.effectiveConfidence, 0.3);
  assert.equal(isUsableObservation(observation), false);
});
