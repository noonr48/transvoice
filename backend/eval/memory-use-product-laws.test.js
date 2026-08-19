'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  scorePrefObey,
  scoreFaithfulOps,
  scorePreferenceRuntimeEffect,
  scoreNoCoachSuggestedStop,
  scoreNoForcedWarmup,
  scoreNoMessagingFrame,
} = require('./memory-use-eval');

test('memory evaluator rejects forced warm-up language', () => {
  assert.equal(scoreNoForcedWarmup('Start with a quick warm-up.'), false);
  assert.equal(scoreNoForcedWarmup("Let's begin with lip trills before the lesson."), false);
  assert.equal(scoreNoForcedWarmup('Keep the sound light and forward.'), true);
});

test('memory evaluator rejects coach-owned stop/rest suggestions without blocking technique wording', () => {
  assert.equal(scoreNoCoachSuggestedStop("Let's take a break and come back later."), false);
  assert.equal(scoreNoCoachSuggestedStop("Let's call it a day."), false);
  assert.equal(scoreNoCoachSuggestedStop("We'll close with one easy line."), false);
  assert.equal(scoreNoCoachSuggestedStop("Let's pick this up tomorrow."), false);
  assert.equal(scoreNoCoachSuggestedStop("That's enough for today."), false);
  assert.equal(scoreNoCoachSuggestedStop('Stop pushing the onset; let it arrive cleanly.'), true);
});

test('memory evaluator rejects text/chat framing', () => {
  assert.equal(scoreNoMessagingFrame('Message me back with your answer.'), false);
  assert.equal(scoreNoMessagingFrame('Send me your answer in the box.'), false);
  assert.equal(scoreNoMessagingFrame('Say the phrase when you are ready.'), true);
});

test('memory evaluator fails every visible remember-ops block, even when grounded', () => {
  const grounded = [
    'Keep the phrase forward.',
    '```remember-ops',
    '{"remember":[{"kind":"moment","value":"I ordered coffee today"}]}',
    '```',
  ].join('\n');
  const leaked = scoreFaithfulOps(grounded, 'I ordered coffee today');
  assert.equal(leaked.leaked, true);
  assert.equal(leaked.ungrounded.length, 0);
  assert.equal(leaked.score, false);

  for (const malformed of [
    'Keep the phrase forward. ```remember-ops {not-json} ```',
    'Keep the phrase forward. ```remember-ops\n{"remember":[]}',
    '```remember-ops\n{"remember":[]}\n```\nKeep the phrase forward.',
  ]) {
    const malformedLeak = scoreFaithfulOps(malformed, 'I ordered coffee today');
    assert.equal(malformedLeak.leaked, true);
    assert.equal(malformedLeak.score, false);
  }

  const clean = scoreFaithfulOps('Keep the phrase forward.', 'I ordered coffee today');
  assert.equal(clean.leaked, false);
  assert.equal(clean.score, true);
});

test('memory evaluator recognizes direct voice-domain correction language', () => {
  assert.equal(
    scorePrefObey('Your vocal weight is too light. Add more weight on the displayed line.', 'direct-feedback'),
    true,
  );
  assert.equal(
    scorePrefObey('That was lovely; maybe try something slightly different.', 'direct-feedback'),
    false,
  );
});

test('memory evaluator recognizes grounded encouragement without requiring praise', () => {
  assert.equal(
    scorePrefObey('I hear you, Robin. Give one word a gentle pitch change.', 'fewer-corrections'),
    true,
  );
});

test('memory evaluator proves slower pace through runtime policy rather than guessing from prose', () => {
  assert.equal(
    scorePreferenceRuntimeEffect(
      'Keep the displayed line steady and unforced.',
      'slower-pace',
      {
        ids: ['slower-pace'],
        pacing: 'slow',
        speechRate: 0.65,
        maxSpokenWords: 32,
      },
    ),
    true,
  );
  assert.equal(
    scorePreferenceRuntimeEffect(
      'Keep the displayed line steady and unforced.',
      'slower-pace',
      {
        ids: ['slower-pace'],
        pacing: 'normal',
        speechRate: 0.76,
        maxSpokenWords: 45,
      },
    ),
    false,
  );
});
