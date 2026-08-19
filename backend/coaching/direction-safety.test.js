'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  crossDirectionReason,
  normalizeDirection,
  stripCrossDirectionSentences,
} = require('./direction-safety');

test('only the surviving feminizing direction activates the guard', () => {
  assert.equal(normalizeDirection('feminizing'), 'feminizing');
  assert.equal(normalizeDirection('mtf'), 'feminizing');
  assert.equal(normalizeDirection('ftm'), null);
  assert.equal(normalizeDirection('masculinizing'), null);
  assert.equal(normalizeDirection('neutral'), null);
  assert.equal(normalizeDirection(null), null);
});

test('clear larynx-lowering and weight-adding instructions are cross-direction', () => {
  assert.ok(crossDirectionReason('Lower your larynx for a fuller sound.', 'feminizing'));
  assert.ok(crossDirectionReason('Let the larynx settle lower and add weight to the vowels.', 'feminizing'));
  assert.ok(crossDirectionReason('Add more vocal weight to this vowel.', 'feminizing'));
});

test('negated cautions are preserved rather than misread as instructions', () => {
  const text = "Don't lower your larynx — keep the voice box riding up with the tone.";
  const result = stripCrossDirectionSentences(text, 'feminizing');
  assert.equal(result.stripped, false);
  assert.equal(result.text, text);
});

test('a mixed reply strips only the wrong-direction sentence', () => {
  const result = stripCrossDirectionSentences(
    'Lower your larynx for depth. Also, remember to breathe steadily.',
    'feminizing',
  );
  assert.equal(result.stripped, true);
  assert.equal(result.strippedCount, 1);
  assert.match(result.text, /breathe steadily/i);
  assert.doesNotMatch(result.text, /larynx/i);
});

test('correct-direction and unrelated body instructions are not removed', () => {
  for (const text of [
    'Raise your larynx and press the sides of your tongue against your upper back teeth.',
    'Lower your jaw slightly and let the lips stay easy.',
    'Let the shoulders settle lower while the voice stays where it is.',
  ]) {
    const result = stripCrossDirectionSentences(text, 'feminizing');
    assert.equal(result.stripped, false, text);
    assert.equal(result.text, text);
  }
});

test('retired or unknown directions are strict no-ops', () => {
  const unsafeForFeminizing = 'Let the larynx settle lower and add weight to the vowels.';
  for (const direction of [null, 'ftm', 'masculinizing', 'neutral', 'unknown']) {
    const result = stripCrossDirectionSentences(unsafeForFeminizing, direction);
    assert.equal(result.stripped, false, String(direction));
    assert.equal(result.text, unsafeForFeminizing);
  }
});
