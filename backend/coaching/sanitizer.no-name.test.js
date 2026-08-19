'use strict';

// 2026-07-26: the coach must NEVER address the learner by name.
//
// Removing the memo's Name line was necessary but NOT sufficient — a name still
// reaches the model through the practice line (the self-introduction exercise,
// "Hi, I'm <Name> — nice to meet you.") and through model-authored memo free
// text ("What worked: <Name> kept the tongue forward"). The fine-tuned renderer
// uses a name whenever it sees one, so the system-prompt prohibition is
// best-effort. stripLearnerVocative is the deterministic contract behind it.
//
// The guard is deliberately NARROW: vocative position only, case-sensitive on
// the stored capitalization, so a learner whose name is an ordinary word
// (Grace, Will, May, Hope) never has ordinary prose mangled.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { stripLearnerVocative, sanitizeCoachReply } = require('./sanitizer');

const withName = (displayName) => ({
  personalization: { learnerMemoFields: { displayName } },
});

test('a vocative address is removed wherever it sits in the line', () => {
  const cases = [
    ['Robin', 'I hear you, Robin. Keep the jaw loose.', 'I hear you. Keep the jaw loose.'],
    ['Robin', 'Robin, keep the jaw loose.', 'Keep the jaw loose.'],
    ['Robin', 'Nice one, Robin — keep the jaw loose.', 'Nice one — keep the jaw loose.'],
    ['Robin', 'That was lovely, Robin!', 'That was lovely!'],
    // a full name addresses by first name
    ['Mara Chen', 'Lovely, Mara. Spread the lips a touch.', 'Lovely. Spread the lips a touch.'],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(stripLearnerVocative(input, withName(name)), expected, input);
  }
});

test('a learner whose name is an ordinary word keeps ordinary prose intact', () => {
  // This is the whole reason the guard is vocative-only and case-sensitive.
  const cases = [
    ['Grace', 'Take it with grace, Grace.', 'Take it with grace.'],
    ['Will', 'Will you keep the jaw loose?', 'Will you keep the jaw loose?'],
    ['Hope', 'I hope that felt easy.', 'I hope that felt easy.'],
    ['May', 'You may find the jaw looser now.', 'You may find the jaw looser now.'],
    ['Robin', 'A robin sings brightly.', 'A robin sings brightly.'],
  ];
  for (const [name, input, expected] of cases) {
    assert.equal(stripLearnerVocative(input, withName(name)), expected, `${name}: ${input}`);
  }
  // ...but a genuine address is still caught for the same learner.
  assert.equal(stripLearnerVocative('Will, keep the jaw loose.', withName('Will')), 'Keep the jaw loose.');
});

test('the guard is inert without a stored name and never empties a reply', () => {
  const reply = 'I hear you, Robin. Keep the jaw loose.';
  assert.equal(stripLearnerVocative(reply, withName('')), reply);
  assert.equal(stripLearnerVocative(reply, {}), reply);
  // A reply that is nothing BUT the address survives rather than becoming empty.
  const bare = stripLearnerVocative('Robin.', withName('Robin'));
  assert.ok(bare.length >= 2, `guard emptied the reply: ${JSON.stringify(bare)}`);
});

test('adversarial names and repeated addresses leave clean, well-punctuated text', () => {
  const cases = [
    // punctuation and diacritics in the name
    ["O'Brien", 'Nice work, O’Brien. Keep the jaw loose.', 'Nice work. Keep the jaw loose.'],
    ["O'Brien", "Nice work, O'Brien. Keep the jaw loose.", 'Nice work. Keep the jaw loose.'],
    ['Anne-Marie', 'Lovely, Anne-Marie. Spread the lips.', 'Lovely. Spread the lips.'],
    ['José', 'I hear you, José. Keep the jaw loose.', 'I hear you. Keep the jaw loose.'],
    // repeated addresses: a single non-overlapping pass used to orphan the comma
    ['Ann', 'I hear you, Ann. Ann, keep the jaw loose. Well done, Ann!', 'I hear you. Keep the jaw loose. Well done!'],
    ['Robin', 'Robin, Robin, keep the jaw loose.', 'Keep the jaw loose.'],
    // a mid-sentence address followed by a comma
    ['Robin', 'I hear you, Robin, and keep going.', 'I hear you, and keep going.'],
  ];
  for (const [name, input, expected] of cases) {
    const got = stripLearnerVocative(input, withName(name));
    assert.equal(got, expected, `${name}: ${input}`);
    assert.doesNotMatch(got, / {2,}/, 'no double spaces');
    assert.doesNotMatch(got, /\s[.,!?;:]/, 'no space before punctuation');
    assert.doesNotMatch(got, /^[a-z]/, 'sentence stays capitalized');
  }
});

test('a LOWERCASE-stored name never corrupts ordinary coach speech', () => {
  // displayName is stored raw — learner-context-service normalizeText only trims
  // and slices, it never capitalizes — so a learner who types "grace" is stored
  // as "grace". Matching the stored casing put the lowercase token in the match
  // set and ate ordinary words out of the middle of sentences.
  const intact = [
    ['grace', 'Keep the jaw loose and take it with grace, then let the line settle.'],
    ['hope', 'I hope, once the jaw loosens, the tone gets easier to hold.'],
    ['rose', 'Your pitch rose, then settled — keep the tongue forward.'],
    ['will', 'Will you keep the jaw loose, and let the lips spread?'],
    ['mark', 'Let the tongue mark the spot, then keep the jaw loose.'],
  ];
  for (const [name, reply] of intact) {
    assert.equal(stripLearnerVocative(reply, withName(name)), reply, `${name}: ${reply}`);
  }
  // ...and a genuine, capitalized address is still stripped for the same learner.
  assert.equal(
    stripLearnerVocative('Nice work, Grace. Keep the jaw loose.', withName('grace')),
    'Nice work. Keep the jaw loose.',
  );
});

test('the guard never edits wording when it removed nothing', () => {
  // Cleanup and re-capitalization exist to repair damage this function caused.
  // Running them unconditionally rewrote the coach's own sentences.
  for (const reply of ['Try e.g. the hum first.', 'Open the jaw... then release.']) {
    assert.equal(stripLearnerVocative(reply, withName('Robin')), reply);
  }
});

test('a multi-word name is matched in full as well as by first name', () => {
  assert.equal(
    stripLearnerVocative('Nice one, Ana Maria. Keep the jaw loose.', withName('Ana Maria')),
    'Nice one. Keep the jaw loose.',
  );
  assert.equal(stripLearnerVocative('Keep going, Mary Beth!', withName('Mary Beth')), 'Keep going!');
  // first-name-only address still works
  assert.equal(
    stripLearnerVocative('Nice one, Ana. Keep the jaw loose.', withName('Ana Maria')),
    'Nice one. Keep the jaw loose.',
  );
});

test('a name that is not a plain word can never build a regex', () => {
  // Regex metacharacters in a stored name must not inject, throw, or match.
  const hostile = 'a.*+?[](){}|^$\\';
  const input = `I hear you, ${hostile}. Keep the jaw loose.`;
  assert.doesNotThrow(() => stripLearnerVocative(input, withName(hostile)));
  assert.equal(stripLearnerVocative(input, withName(hostile)), input);
  // A single character is also refused — too dangerous to strip.
  assert.equal(
    stripLearnerVocative('I hear you, R. Keep going.', withName('R')),
    'I hear you, R. Keep going.',
  );
});

test('the guard is linear on pathological input', () => {
  const long = 'I hear you, Robin. '.repeat(3000);
  const started = Date.now();
  stripLearnerVocative(long, withName('Robin'));
  const elapsed = Date.now() - started;
  assert.ok(elapsed < 2000, `vocative guard took ${elapsed}ms on ${long.length} chars`);
});

test('the full sanitizer pipeline never speaks the learner name', () => {
  const out = sanitizeCoachReply(
    'I hear you, Robin. Keep the jaw loose and spread the lips a touch.',
    {
      policy: { coachingAction: 'coach', shouldCorrect: true },
      personalization: { learnerMemoFields: { displayName: 'Robin' } },
    },
    { witness: {} },
  );
  assert.doesNotMatch(out, /Robin/);
  // ...and the coaching content survives intact.
  assert.match(out, /jaw/i);
  assert.match(out, /lips/i);
});
