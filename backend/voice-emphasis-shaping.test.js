'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_EMPHASIS_SHAPED_LENGTH,
  shapeEmphasisClause,
  normalizeEmphasisWord,
} = require('./voice-emphasis-shaping');

// The one invariant the whole channel rests on: shaping may only ADD commas.
// Same words, same order, same casing — otherwise the learner hears a different
// sentence than the one on their practice card.
function wordSequence(text) {
  return text
    .split(/\s+/)
    .map((chunk) => chunk.replace(/[^\p{L}\p{N}'’-]/gu, ''))
    .filter(Boolean);
}

function assertSameWords(before, after) {
  assert.deepEqual(wordSequence(after), wordSequence(before), 'word sequence must be preserved');
  assert.equal(
    after.replace(/,/g, ''),
    before.replace(/,/g, ''),
    'only commas may differ between the original and the shaped text',
  );
}

test('word at the END gets a comma before it and rides the existing period', () => {
  const text = 'I can do that for you today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.text, 'I can do that for you, today.');
  assert.equal(result.matched, true);
  assert.equal(result.shaped, true);
  assert.equal(result.reason, 'shaped');
  assertSameWords(text, result.text);
});

test('word in the MIDDLE is isolated by commas on both sides', () => {
  const text = 'I can do that today for you.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.text, 'I can do that, today, for you.');
  assert.equal(result.shaped, true);
  assertSameWords(text, result.text);
});

test('word at the START only gets a trailing comma', () => {
  const text = 'Today I can do that for you.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'Today' });
  assert.equal(result.text, 'Today, I can do that for you.');
  assert.equal(result.shaped, true);
  assertSameWords(text, result.text);
});

test('matching is case-insensitive and never re-cases the phrase', () => {
  const text = 'I can do that for you Today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.text, 'I can do that for you, Today.');
  // Real invariant (not "no caps appear in a fixture that had none"): every
  // character of the output except the added commas is identical to the input.
  assert.equal([...result.text].filter((ch) => ch !== ',').join(''), text.replace(/,/g, ''));
});

test('a word already bounded by punctuation on BOTH sides is left unchanged', () => {
  const text = 'I can do that, today, for you.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.text, text);
  assert.equal(result.matched, true);
  assert.equal(result.shaped, false);
  assert.equal(result.reason, 'already_bounded');
});

test('a single-word phrase is bounded by both text edges and stays unchanged', () => {
  const result = shapeEmphasisClause({ text: 'Today', emphasisWord: 'Today' });
  assert.equal(result.text, 'Today');
  assert.equal(result.shaped, false);
  assert.equal(result.reason, 'already_bounded');
});

test('a half-bounded word still gets its missing comma only', () => {
  const text = 'Well, today I can do that.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.text, 'Well, today, I can do that.');
  assert.equal(result.shaped, true);
  assert.ok(!result.text.includes(',,'), 'must never stack commas');
  assertSameWords(text, result.text);
});

test('multi-occurrence: no tokenIndex picks the FIRST occurrence', () => {
  const text = 'I can do that today and finish it today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.text, 'I can do that, today, and finish it today.');
  assert.equal(result.selector, 'first');
  assertSameWords(text, result.text);
});

test('multi-occurrence: tokenIndex selects that occurrence, not the first', () => {
  const text = 'I can do that today and finish it today.';
  // token 0 "I" 1 "can" 2 "do" 3 "that" 4 "today" 5 "and" 6 "finish" 7 "it" 8 "today"
  const result = shapeEmphasisClause({ text, emphasisWord: 'today', tokenIndex: 8 });
  assert.equal(result.text, 'I can do that today and finish it, today.');
  assert.equal(result.selector, 'token_index');
  assert.equal(result.occurrenceUsed, 1);
  assert.equal(result.shaped, true);
  assertSameWords(text, result.text);
});

test('multi-occurrence: occurrence selects that occurrence and OUTRANKS tokenIndex', () => {
  const text = 'I can do that today and finish it today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today', occurrence: 1, tokenIndex: 4 });
  assert.equal(result.text, 'I can do that today and finish it, today.');
  assert.equal(result.selector, 'occurrence');
  assert.equal(result.occurrenceUsed, 1);
  assert.equal(result.occurrenceCount, 2);
});

test('a tokenIndex that does not resolve to the word falls back to the first occurrence', () => {
  const text = 'I can do that today and finish it today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today', tokenIndex: 2 });
  assert.equal(result.text, 'I can do that, today, and finish it today.');
  assert.equal(result.selector, 'first', 'a mismatched index is discarded, not trusted');
  assert.equal(result.occurrenceUsed, 0);
});

test('an out-of-range tokenIndex falls back to the first occurrence', () => {
  const text = 'I can do that today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today', tokenIndex: 99 });
  assert.equal(result.text, 'I can do that, today.');
  assert.equal(result.selector, 'first');
});

// --- REGRESSIONS: defects found by the independent review -------------------

test('REGRESSION: an out-of-range OCCURRENCE refuses to guess a different word', () => {
  const text = 'Hold the line.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'line', occurrence: 9 });
  assert.equal(result.text, text, 'must not shape a word the caller did not mean');
  assert.equal(result.matched, true);
  assert.equal(result.shaped, false);
  assert.equal(result.reason, 'occurrence_out_of_range');
  assert.equal(result.occurrenceUsed, null, 'the witness must not claim an occurrence it discarded');
});

test('REGRESSION: an announcement prefix cannot steal the emphasis', () => {
  // The eyes-free demo speaks "New line: <phrase>." — "line" appears in the
  // PREFIX as well as the phrase. Occurrence 1 is the phrase's own word.
  const text = 'New line: Hold the line. Keep it light.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'line', occurrence: 1 });
  assert.equal(result.text, 'New line: Hold the, line. Keep it light.');
  assert.ok(!result.text.startsWith('New,'), 'the comma must never land in the prefix');
});

test('REGRESSION: a repeated word inside the phrase picks the authored copy', () => {
  const text = 'New line: hello small hello big.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'hello', occurrence: 1 });
  assert.equal(result.text, 'New line: hello small, hello, big.');
  assert.equal(result.occurrenceUsed, 1);
});

test('REGRESSION: a character that grows when lowercased does not shift offsets', () => {
  // 'İ'.toLowerCase() is TWO code units. Matching against a lowercased copy
  // desynced every later offset and produced a stacked comma.
  const text = 'İstanbul, fine hello';
  const result = shapeEmphasisClause({ text, emphasisWord: 'İstanbul' });
  assert.ok(!result.text.includes(',,'), `stacked comma in "${result.text}"`);
  assert.equal(result.matched, true);
  assert.equal(result.reason, 'already_bounded');

  const later = shapeEmphasisClause({ text: 'İstanbul and hello there', emphasisWord: 'hello' });
  assert.equal(later.matched, true, 'a word after the growing character must still be found');
  assert.equal(later.text, 'İstanbul and, hello, there');
});

test('REGRESSION: junk index values are not coerced into index 0', () => {
  const text = 'a b hello c hello';
  for (const junk of [null, '', false, [], '1', undefined, NaN, 1.5, -1]) {
    const byToken = shapeEmphasisClause({ text, emphasisWord: 'hello', tokenIndex: junk });
    assert.equal(byToken.selector, 'first', `tokenIndex ${JSON.stringify(junk)} must not select`);
    const byOccurrence = shapeEmphasisClause({ text, emphasisWord: 'hello', occurrence: junk });
    assert.equal(byOccurrence.selector, 'first', `occurrence ${JSON.stringify(junk)} must not select`);
  }
});

test('REGRESSION: a bracket or ellipsis already opens the clause — no "(,word"', () => {
  const openParen = shapeEmphasisClause({
    text: 'New line: ahh… ehh (steady holds).', emphasisWord: 'steady',
  });
  assert.equal(openParen.text, 'New line: ahh… ehh (steady, holds).');
  assert.ok(!openParen.text.includes('(,'), 'a comma must never follow an opening bracket');

  const afterEllipsis = shapeEmphasisClause({
    text: 'brrr… lips or rrr… tongue.', emphasisWord: 'lips',
  });
  assert.ok(!afterEllipsis.text.includes(',…'), 'a comma must never precede an ellipsis');
  assert.ok(!afterEllipsis.text.includes('…,'), 'an ellipsis already opens the clause');
});

test('word NOT found passes the text through untouched and reports matched:false', () => {
  const text = 'I can do that for you.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'tomorrow' });
  assert.equal(result.text, text);
  assert.equal(result.matched, false);
  assert.equal(result.shaped, false);
  assert.equal(result.reason, 'not_found');
});

test('a substring is not a match — word boundaries are respected', () => {
  const text = 'I can do that today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'day' });
  assert.equal(result.matched, false, '"day" inside "today" must not match');
  assert.equal(result.text, text);
});

test('a hyphenated token matches whole and its halves do not', () => {
  const text = 'That was a well-known problem.';
  assert.equal(
    shapeEmphasisClause({ text, emphasisWord: 'well-known' }).text,
    'That was a, well-known, problem.',
  );
  assert.equal(shapeEmphasisClause({ text, emphasisWord: 'known' }).matched, false);
});

test('an emphasis word carrying card punctuation still matches', () => {
  const text = 'I can do that for you today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today.' });
  assert.equal(result.text, 'I can do that for you, today.');
  assert.equal(result.matched, true);
});

test('the 700-char cap is enforced AFTER shaping — an over-cap shaping falls back', () => {
  // A phrase sitting exactly ON the cap whose emphasized word needs two commas:
  // the shaping would reach 702, so the original must come back untouched.
  const filler = 'ab '.repeat(231).trim(); // 692 chars, 231 tokens
  const text = `${filler} today x`; // 700 chars
  assert.ok(text.length <= MAX_EMPHASIS_SHAPED_LENGTH, `fixture must start within the cap (${text.length})`);
  assert.ok(text.length > MAX_EMPHASIS_SHAPED_LENGTH - 2, 'fixture must be within 2 chars of the cap');

  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.text, text, 'over-cap shaping must return the original');
  assert.equal(result.matched, true);
  assert.equal(result.shaped, false);
  assert.equal(result.reason, 'length_cap');
  assert.ok(result.text.length <= MAX_EMPHASIS_SHAPED_LENGTH);
});

test('a shaping that still fits the cap is applied', () => {
  const filler = 'ab '.repeat(200).trim(); // 599 chars
  const text = `${filler} today x`;
  const result = shapeEmphasisClause({ text, emphasisWord: 'today' });
  assert.equal(result.shaped, true);
  assert.ok(result.text.length <= MAX_EMPHASIS_SHAPED_LENGTH);
  assertSameWords(text, result.text);
});

test('a custom maxLength is honoured', () => {
  const text = 'I can do that for you today.';
  const result = shapeEmphasisClause({ text, emphasisWord: 'today', maxLength: text.length });
  assert.equal(result.text, text);
  assert.equal(result.reason, 'length_cap');
});

test('shaping adds ONLY commas — the constraint behind "never SSML or markdown"', () => {
  // The real evidence is character-level: the output minus its added commas is
  // byte-identical to the input, so no markup character can ever be introduced
  // regardless of what the input contains.
  const cases = [
    ['I can do that for you today.', 'today'],
    ['I can do that today for you.', 'today'],
    ['Today I can do that.', 'Today'],
    ['Say <b>this</b> *now* today.', 'today'],
    ['A [bracket] and a `tick` today here.', 'today'],
  ];
  for (const [text, word] of cases) {
    const { text: shaped } = shapeEmphasisClause({ text, emphasisWord: word });
    assert.equal(
      shaped.replace(/,/g, ''),
      text.replace(/,/g, ''),
      `only commas may differ for "${text}"`,
    );
    const addedCommas = [...shaped].filter((ch) => ch === ',').length
      - [...text].filter((ch) => ch === ',').length;
    assert.ok(addedCommas >= 0 && addedCommas <= 2, 'at most one comma per side');
  }
});

test('empty / absent inputs degrade to a clean pass-through', () => {
  assert.deepEqual(
    shapeEmphasisClause({ text: '', emphasisWord: 'today' }),
    { text: '', matched: false, shaped: false, reason: 'empty_text', selector: 'none', occurrenceUsed: null, occurrenceCount: 0 },
  );
  assert.deepEqual(
    shapeEmphasisClause({ text: 'A line.', emphasisWord: '' }),
    { text: 'A line.', matched: false, shaped: false, reason: 'empty_word', selector: 'none', occurrenceUsed: null, occurrenceCount: 0 },
  );
  assert.deepEqual(
    shapeEmphasisClause({ text: 'A line.', emphasisWord: '  ,,  ' }),
    { text: 'A line.', matched: false, shaped: false, reason: 'empty_word', selector: 'none', occurrenceUsed: null, occurrenceCount: 0 },
  );
  assert.equal(shapeEmphasisClause().text, '');
});

test('normalizeEmphasisWord strips surrounding punctuation and keeps the core', () => {
  assert.equal(normalizeEmphasisWord('  "today," '), 'today');
  assert.equal(normalizeEmphasisWord("don't."), "don't");
  assert.equal(normalizeEmphasisWord('...'), '');
  assert.equal(normalizeEmphasisWord(null), '');
});
