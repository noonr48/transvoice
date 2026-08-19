'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { containsInternalJargon } = require('./beginner-feedback');
const { buildFemV1ShadowCard } = require('./fem-v1-shadow-card');

test('shadow card renders a typed safety stop without a record affordance', () => {
  const card = buildFemV1ShadowCard({
    action: 'stop_for_safety',
    phase: 'pitch_foundation',
    safetyReason: 'pain',
    focus: { dimension: 'pitch.register' },
  });
  assert.equal(card.result.state, 'safety_stop');
  assert.equal(card.safetyReason, 'pain');
  assert.equal(card.record, null);
  assert.equal(card.focus.label, null);
  assert.equal(containsInternalJargon(card), false);
});

test('shadow card maps pitch focus to beginner language', () => {
  const card = buildFemV1ShadowCard({
    action: 'serve_exercise',
    phase: 'pitch_foundation',
    focus: { dimension: 'pitch.register' },
  });
  assert.equal(card.result.state, 'ready_for_instruction');
  assert.equal(card.focus.label, 'Comfortable pitch');
  assert.deepEqual(card.try.steps, []);
  assert.equal(containsInternalJargon(card), false);
});

test('unknown controller action cannot manufacture a learner card', () => {
  assert.equal(buildFemV1ShadowCard({ action: 'future_action' }), null);
});
