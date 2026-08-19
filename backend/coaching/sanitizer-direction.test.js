'use strict';
/**
 * Direction-correctness filter in sanitizeCoachReply (Step 6.5, added 2026-06-25).
 * The model can emit a cross-direction technique cue at sampling temp (e.g. "lower
 * your larynx" told to an MTF/feminizing learner). The sanitizer strips those sentences
 * so the cue never reaches the learner/TTS; if the whole reply was cross-direction it
 * falls back to a safe neutral cue. Direction is derived from signal.styleTarget.
 *
 * 2026-07-26 MTF-ONLY: the masculinizing (FTM) learner direction is retired, so the
 * FTM half of this suite is RE-POINTED, not deleted. The guarantee it protected —
 * a cue must never push a learner the wrong way — still binds the surviving
 * feminizing path, and the tests below now prove it against the two live states:
 *   feminizing -> a masculinizing cue IS stripped
 *   neutral / retired-FTM preset -> the filter is a NO-OP, never a substitution
 * The retired-preset cases are the load-bearing new coverage: a stored `masc-*`
 * session must SKIP the filter, not be silently treated as feminizing (which would
 * strip the learner's own historical cues).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sanitizeCoachReply, SAFE_FALLBACK } = require('./sanitizer');

const MTF = { styleTarget: 'cute-feminine' };      // feminizing -> drop MASC cues
const RETIRED_FTM = { styleTarget: 'masc-natural' }; // retired preset -> no-op (never feminizing)
const NEUTRAL = { styleTarget: 'androgynous' };    // neutral -> no-op

test('MTF: whole-reply cross-direction -> safe fallback', () => {
  const out = sanitizeCoachReply('Lower your larynx and add chest resonance for a fuller, deeper sound.', MTF);
  assert.equal(out, SAFE_FALLBACK);
});

test('MTF: strips the cross-direction sentence, keeps the benign one', () => {
  const out = sanitizeCoachReply('Lower your larynx for depth. Also, remember to breathe steadily.', MTF);
  assert.ok(out.toLowerCase().includes('breathe'));
  assert.ok(!/larynx/i.test(out));
});

// 2026-07-27 cue-vocabulary law: these fixtures used to be written in the
// metaphor register ("Brighten your vowels…", "…use head voice", "Drop into
// chest resonance…"). Every one of those phrases is now banned outright by
// CUE_VOCABULARY_RULES, so the fixtures were rewritten in the body register.
// MEASURED, and this is the point: with the OLD wording each of these three
// tests failed because the cue-vocabulary law stripped the fixture before the
// direction filter was ever exercised — the tests were measuring the wrong law.
// The direction semantics being asserted are byte-for-byte unchanged.
test('MTF: correct-direction reply passes through unchanged (content-wise)', () => {
  const out = sanitizeCoachReply('Raise your larynx and press the sides of your tongue against your upper back teeth.', MTF);
  assert.ok(/larynx/i.test(out));
  assert.ok(/tongue/i.test(out));
});

test('retired FTM preset: the filter is a NO-OP, never re-read as feminizing', () => {
  // The substitution guard. A stored `masc-*` session must not have the filter
  // applied as if the learner were feminizing — that would strip the learner's
  // own historical cues. It skips, exactly as an unknown preset does.
  const feminizing = 'Raise your larynx and press the sides of your tongue against your upper back teeth.';
  assert.equal(sanitizeCoachReply(feminizing, RETIRED_FTM), feminizing);

  const masculinizing = 'Let the larynx settle lower and add weight to the vowels.';
  assert.equal(sanitizeCoachReply(masculinizing, RETIRED_FTM), masculinizing);
});

test('feminizing: a masculinizing cue IS stripped (the surviving wrong-way guard)', () => {
  const out = sanitizeCoachReply('Let the larynx settle lower and add weight to the vowels.', MTF);
  assert.equal(out, SAFE_FALLBACK);
});

test('neutral learner: direction filter is a no-op (no wrong direction)', () => {
  const reply = 'Lower your larynx a little if it feels tight.';
  const out = sanitizeCoachReply(reply, NEUTRAL);
  assert.ok(/larynx/i.test(out));
});

test('direction filter does not fire when styleTarget is absent', () => {
  const out = sanitizeCoachReply('Lower your larynx for depth.', {});
  assert.ok(/larynx/i.test(out));
});

test('signal.direction is authoritative: filter fires even with an unknown preset "x" (MTF)', () => {
  // profile.direction must NOT be bypassed by an unmapped styleTarget.
  const out = sanitizeCoachReply('Lower your larynx for a fuller, deeper sound.', { styleTarget: 'x', direction: 'mtf' });
  assert.equal(out, SAFE_FALLBACK);
});

test('a retired ftm signal.direction is unrecognized, so the PRESET decides', () => {
  // Precedence contract, unchanged: signal.direction wins only while it is a
  // recognized value. 'ftm' is retired, so it is simply unrecognized and the
  // styleTarget governs — exactly as an unknown direction string always has.
  const masculinizing = 'Let the larynx settle lower and add weight to the vowels.';

  // Retired preset too -> no direction anywhere -> no-op (never substituted).
  assert.equal(
    sanitizeCoachReply(masculinizing, { styleTarget: 'masc-natural', direction: 'ftm' }),
    masculinizing,
  );
  // Live FEMININE preset -> the live target still earns its wrong-way guard.
  assert.equal(
    sanitizeCoachReply(masculinizing, { styleTarget: 'cute-feminine', direction: 'ftm' }),
    SAFE_FALLBACK,
  );
});

test('negation: a correct caution ("don\'t lower your larynx") is NOT stripped (MTF)', () => {
  // 2026-07-27: the tail used to read "keep it lifted and bright" — a banned
  // quality word, so the cue-vocabulary law dropped the whole sentence and this
  // test failed for a reason that had nothing to do with negation handling.
  const reply = "Don't lower your larynx — that would push your voice the wrong way; keep the voice box riding up with the tone.";
  const out = sanitizeCoachReply(reply, { styleTarget: 'cute-feminine', direction: 'mtf' });
  assert.ok(/voice box/i.test(out) || /larynx/i.test(out), `caution wrongly stripped -> "${out}"`);
});
