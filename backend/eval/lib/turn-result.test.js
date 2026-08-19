'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  getEvalTurnFailure,
  resultHasEvalFailure,
} = require('./turn-result');

test('evaluation turns fail closed on response errors and deterministic fallbacks', () => {
  assert.equal(getEvalTurnFailure({ success: true, fallbackReply: false }), null);
  assert.equal(getEvalTurnFailure({ success: false, error: 'synthetic turn failure' }), 'synthetic turn failure');
  assert.equal(
    getEvalTurnFailure({ success: true, fallbackReply: true }),
    'turn used a deterministic fallback reply',
  );
  assert.equal(getEvalTurnFailure(null), 'invalid or missing turn response');
});

test('nested turn errors and fallbacks make a learner result non-evidence', () => {
  assert.equal(resultHasEvalFailure({ turns: [{ error: null, fallbackReply: false }] }), false);
  assert.equal(resultHasEvalFailure({ turns: [{ error: 'failed' }] }), true);
  assert.equal(resultHasEvalFailure({ turns: [{ fallbackReply: true }] }), true);
  assert.equal(resultHasEvalFailure({ error: 'learner failed', turns: [] }), true);
});
