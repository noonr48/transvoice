'use strict';

/**
 * 2026-07-26 breath-nag repair — the per-word cue sheet.
 *
 * Every rest word used to print 'easy steady airflow', so a 9-word practice
 * line showed six or seven airflow reminders under words where no breath event
 * happens, and the whole sheet read as breathing advice. A breath-in cue now
 * belongs ONLY to the first word (the one real inhale point); rest words rotate
 * short, target-aligned, actionable micro-cues.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { buildVoiceCueSheet } = require('./voice-cue-sheet');

const PHRASE = 'I can do that today for you now';
// A breath-in cue is any instruction to take air in.
const BREATH_IN = /\b(sigh in|breath in|gasp)\b/i;

function cuesFor(targetPreset) {
  const sheet = buildVoiceCueSheet({ phrase: PHRASE, targetPreset, focus: 'steady' });
  assert.ok(sheet && Array.isArray(sheet.tokens) && sheet.tokens.length > 3, targetPreset);
  return sheet.tokens.map((t) => t.airflowCue);
}

// These two loops only need a SPREAD of preset ids — the invariant (one inhale
// point per line, no filler cue) is preset-agnostic. 2026-07-30: the fourth slot
// was 'androgynous', used purely as "another lane"; re-pointed to a live
// feminine preset so no retired id is referenced here.
test('a breath-in cue appears on the FIRST word only', () => {
  for (const preset of ['cute-feminine', 'soft-feminine', 'masculine', 'australian-bright-feminine']) {
    const cues = cuesFor(preset);
    assert.match(cues[0], BREATH_IN, `${preset}: first word is the real inhale point`);
    for (let i = 1; i < cues.length; i += 1) {
      assert.doesNotMatch(cues[i], BREATH_IN, `${preset}: word ${i} must not ask for a breath`);
    }
  }
});

test("no word carries the old 'easy steady airflow' filler", () => {
  for (const preset of ['cute-feminine', 'soft-feminine', 'masculine', 'australian-bright-feminine']) {
    for (const cue of cuesFor(preset)) {
      assert.doesNotMatch(cue, /airflow/i, preset);
      assert.ok(cue && cue.trim().length > 0, `${preset}: every word keeps a cue`);
    }
  }
});

test('rest-word cues ROTATE instead of repeating one string', () => {
  // The defect was one cue cloned under every rest word. Rotation is keyed to
  // word position, so a line long enough to reach several rest words must show
  // more than one distinct rest cue.
  const cues = cuesFor('cute-feminine');
  const restCues = cues.slice(1).filter((c) => !/soften the hit|float the release|let the rise stay easy/i.test(c));
  assert.ok(restCues.length >= 2, `expected several rest words, got ${restCues.length}`);
  assert.ok(new Set(restCues).size >= 2, `rest cues did not rotate: ${JSON.stringify(restCues)}`);
});

test('rest-word cues are TARGET-ALIGNED, never cross-direction', () => {
  const feminine = cuesFor('cute-feminine').join(' | ');
  assert.match(feminine, /forward|brightness|pitch/i);
  // A feminizing target must not be told to add low warmth or fullness.
  assert.doesNotMatch(feminine, /warmth low|fullness/i);
});

// REWRITTEN 2026-07-30. This test used to carry a `masculine` block and an
// `androgynous` block asserting their own cue lanes. Both were VACUOUS, and
// measurably so: a retired or removed preset falls back to cute-feminine, whose
// cues are `… | steady the pitch | …`, and every one of those assertions was
// satisfied by the fallback. The `|pitch` alternative made each `match` pass, and
// the fallback happens to contain neither "brightness" nor "warmth low" so each
// `doesNotMatch` passed too. So the masculine block had been testing the
// cute-feminine fallback ever since that direction was retired — printing
// `[voice-cue-sheet] unknown targetPreset "masculine" — falling back to
// cute-feminine` on every run — and the neutral block was about to join it
// silently rather than turn red.
//
// A test that cannot fail is worse than no test: it reads as coverage. What is
// actually worth pinning is the FALLBACK CONTRACT itself, so that is what this
// asserts, and it is written so it fails if the fallback ever stops being
// cute-feminine.
test('a preset outside the offered set falls back to the default lane, exactly', () => {
  const expected = cuesFor('cute-feminine').join(' | ');
  for (const outside of ['masculine', 'mystery-voice', '']) {
    assert.equal(
      cuesFor(outside).join(' | '), expected,
      `"${outside}" must produce the cute-feminine cue lane verbatim — the app never substitutes a different target, it falls back to its default`,
    );
  }
  // And the default lane really is the feminizing one, so the equality above is
  // not quietly comparing two copies of something wrong.
  assert.match(expected, /tongue high and forward/i);
});

test('the cue sheet is deterministic — the same phrase renders the same sheet', () => {
  assert.deepEqual(cuesFor('cute-feminine'), cuesFor('cute-feminine'));
  assert.deepEqual(cuesFor('masculine'), cuesFor('masculine'));
});

test('the legacy first-word behaviour for a hard onset is unchanged', () => {
  // Regression guard for the existing contract in test-voice-cue-sheet.js.
  const sheet = buildVoiceCueSheet({
    phrase: 'Could you say that again?',
    targetPreset: 'cute-feminine',
    focus: 'Playful intonation',
  });
  assert.equal(sheet.tokens[0].airflowCue, 'tiny gasp start');
});
