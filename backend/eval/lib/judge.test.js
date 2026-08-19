'use strict';

// Locks in the 'gentle' coachingAction integration in the eval judge: gentle is a
// cue-EXPECTED action (scored on its own bar, not the coach bar), distinct from
// breather/converse which null actionability. See judge.js + policy-gates.js gentle mode.

const { test } = require('node:test');
const assert = require('node:assert');

const {
  normalizeAction, actionabilityApplies, COACHING_ACTIONS, normalizeScores, buildMessages,
} = require('./judge');

test('judge recognizes the gentle action', () => {
  assert.ok(COACHING_ACTIONS.includes('gentle'));
  assert.strictEqual(normalizeAction('gentle'), 'gentle');
  assert.strictEqual(normalizeAction('GENTLE'), 'gentle');
  assert.strictEqual(normalizeAction('bogus'), 'coach'); // unknown -> default
});

test('gentle is a cue-expected action (actionability applies, like coach/adapt)', () => {
  assert.strictEqual(actionabilityApplies('gentle'), true);
  assert.strictEqual(actionabilityApplies('coach'), true);
  assert.strictEqual(actionabilityApplies('adapt'), true);
  assert.strictEqual(actionabilityApplies('breather'), false);
  assert.strictEqual(actionabilityApplies('converse'), false);
});

test('normalizeScores keeps actionability for gentle, nulls it for breather', () => {
  const raw = {
    coaching_correctness: 4, actionability: 4, approach_fit: 5, groundedness: 4,
    tone_affirmation: 5, direction_correctness: 5, pronoun_fidelity: 5, holistic: 4, flags: [],
  };
  assert.strictEqual(normalizeScores(raw, 'gentle').actionability, 4);
  assert.strictEqual(normalizeScores(raw, 'breather').actionability, null);
});

test('buildMessages hands the judge the GENTLE COACH brief', () => {
  const msgs = buildMessages({
    reply: 'Let\'s just do one easy hum to start.',
    learner: { profile: { direction: 'mtf', pronouns: 'she/her', displayName: 'Bea' } },
    userTurn: 'go easy on me today',
    memo: '',
    coachingAction: 'gentle',
  });
  const user = msgs.find((m) => m.role === 'user').content;
  assert.ok(/GENTLE COACH/.test(user), 'user message should carry the GENTLE COACH brief');
});
