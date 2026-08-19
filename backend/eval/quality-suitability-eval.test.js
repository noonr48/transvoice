'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRunCoverage } = require('./quality-suitability-eval');

test('quality evaluator run coverage fails every partial, errored, fatal, or raw-incomplete roster', () => {
  assert.deepEqual(
    buildRunCoverage(2, [
      { rawComplete: true },
      { rawComplete: true },
    ]),
    {
      expectedLearners: 2,
      completedLearners: 2,
      erroredLearners: 0,
      fatalError: null,
      rosterComplete: true,
      rawComplete: true,
    },
  );

  assert.equal(buildRunCoverage(2, [{ rawComplete: true }]).rosterComplete, false);
  assert.equal(buildRunCoverage(2, [
    { rawComplete: true },
    { error: 'failed learner', rawComplete: true },
  ]).rosterComplete, false);
  assert.equal(buildRunCoverage(2, [
    { rawComplete: true },
    { rawComplete: true },
  ], 'fatal').rosterComplete, false);
  assert.equal(buildRunCoverage(2, [
    { rawComplete: true },
    { rawComplete: false },
  ]).rawComplete, false);
  assert.equal(buildRunCoverage(2, [
    { rawComplete: true, turns: [{ fallbackReply: true }] },
    { rawComplete: true, turns: [{ error: null }] },
  ]).rosterComplete, false);
  assert.equal(buildRunCoverage(2, [
    { rawComplete: true, turns: [{ error: 'synthetic turn failure' }] },
    { rawComplete: true, turns: [{ error: null }] },
  ]).rawComplete, false);
});
