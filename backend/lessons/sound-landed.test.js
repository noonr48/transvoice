/**
 * Sound-rung verification (2026-07-29).
 *
 * The ladder's word rungs are checked against the transcript; the SOUND rung had
 * no check at all — `measurementUsable === true` ("a measurable take happened")
 * was the whole gate, so a learner asked to hum who made any voiced noise
 * advanced exactly as if the hum had landed.
 *
 * THE POLARITY UNDER TEST. Without segment awareness the app usually cannot
 * PROVE a sound was produced, but it can often DISPROVE it. So absence of a
 * metric must yield 'unknown' and PASS; only a present, contradicting
 * measurement may block. These tests exist mostly to pin that asymmetry, because
 * getting it backwards fails learners for the analyzer's gaps.
 */
const test = require('node:test');
const assert = require('node:assert');

const { assessSoundLanded, soundLandedBlocksAdvance } = require('./sound-landed');
const { beginSentenceProgression, resolveSentenceProgressionTurn } = require('./sentence-progression');
const { buildKindMetrics } = require('../coaching/signal-builder');

// --- the asymmetry itself, driven by REAL buildKindMetrics output ---------
//
// An earlier version of these tests hand-wrote `kindMetrics: {}` — a shape
// buildKindMetrics never emits. That made them pass against a do-nothing module
// while the shapes it ACTUALLY emits ({trillDetected:false,…}, {f2RangeHz:null,…})
// were the ones blocking real learners. Every unmeasured case below is now the
// genuine output of the real builder on an empty take.

test('THE INVERSION GUARD: real unmeasured metrics never block, for any kind', () => {
  // This is the failure that shipped in the first cut: Number(null) === 0, so an
  // absent f2RangeHz read as "the mouth shape did not move" and failed a learner
  // whose formants simply were not measured.
  for (const takeKind of ['hum_sovt', 'sustained', 'siren', 'trill', 'resonance_play']) {
    const kindMetrics = buildKindMetrics(takeKind, {});
    const assessment = assessSoundLanded({ takeKind, kindMetrics, bands: {}, target: {} });
    assert.equal(
      soundLandedBlocksAdvance(assessment), false,
      `${takeKind} blocked on genuinely unmeasured metrics: ${JSON.stringify(assessment)}`,
    );
  }
});

test('an EXPLICIT null band or target is as safe as an absent one', () => {
  // `bands: {pitchStdStCeiling: null}` must behave like `bands: {}`. It did not:
  // the null collapsed to a ceiling of 0 and any positive spread blocked.
  const explicitNull = assessSoundLanded({
    takeKind: 'sustained',
    kindMetrics: { pitchStdSt: 1.5 },
    bands: { pitchStdStCeiling: null },
  });
  assert.equal(explicitNull.state, 'unknown', 'a null ceiling was read as 0');

  const absent = assessSoundLanded({
    takeKind: 'sustained', kindMetrics: { pitchStdSt: 99 }, bands: {},
  });
  assert.equal(absent.state, 'unknown');
});

test('a trill the detector COULD NOT RUN is unknown, not a failure', () => {
  // trillRateHz is null whenever the frame rate cannot cover the 15-45 Hz band —
  // which includes the live ~16 fps path, i.e. most real takes. Keying on
  // buildKindMetrics' derived `trillDetected` boolean failed every one of them.
  const liveTake = buildKindMetrics('trill', {
    advanced: { trillRateHz: null, trillDurationMs: null },
  });
  assert.equal(liveTake.trillDetected, false, 'the derived boolean is still two-state');
  const assessment = assessSoundLanded({ takeKind: 'trill', kindMetrics: liveTake });
  assert.equal(assessment.state, 'unknown', 'a live-path trill was scored as a failure');
});

test('assessSoundLanded has no opinion about a spoken take', () => {
  const assessment = assessSoundLanded({ takeKind: 'phrase', kindMetrics: {}, bands: {} });
  assert.equal(assessment.state, 'unknown');
  assert.equal(assessment.reason, 'not_a_sound_rung');
});

// --- per-kind contradictions ---------------------------------------------

test('trill is the one kind that can be positively CONFIRMED', () => {
  const landed = assessSoundLanded({ takeKind: 'trill', kindMetrics: { trillRateHz: 28 } });
  assert.equal(landed.state, 'landed');
  assert.equal(landed.reason, 'trill_detected');
});

test('a measured-but-zero trill rate blocks; an unmeasured one does not', () => {
  const ranAndFoundNothing = assessSoundLanded({ takeKind: 'trill', kindMetrics: { trillRateHz: 0 } });
  assert.equal(ranAndFoundNothing.state, 'not_the_sound');
  assert.equal(soundLandedBlocksAdvance(ranAndFoundNothing), true);

  const couldNotRun = assessSoundLanded({ takeKind: 'trill', kindMetrics: { trillRateHz: null } });
  assert.equal(couldNotRun.state, 'unknown');
  assert.equal(soundLandedBlocksAdvance(couldNotRun), false);
});

test('a sustained vowel that did not stay put is contradicted — using the profile own ceiling', () => {
  const bands = { pitchStdStCeiling: 1.2 };
  const wobbled = assessSoundLanded({
    takeKind: 'sustained', kindMetrics: { pitchStdSt: 4.0 }, bands,
  });
  assert.equal(wobbled.state, 'not_the_sound');
  assert.equal(wobbled.reason, 'pitch_not_held');

  const held = assessSoundLanded({
    takeKind: 'sustained', kindMetrics: { pitchStdSt: 0.6 }, bands,
  });
  assert.equal(held.state, 'unknown', 'a held vowel is not contradicted, but is not provable either');
});

test('a siren that never travelled is contradicted — floor read from the ATTEMPT TARGET', () => {
  // minPitchRangeSt is on the per-take attempt target, NOT on advancedBands.
  // Passing it as a band left this branch permanently dead.
  const target = { minPitchRangeSt: 2.4 };
  const flat = assessSoundLanded({ takeKind: 'siren', kindMetrics: { rangeSt: 0.3 }, target });
  assert.equal(flat.state, 'not_the_sound');
  assert.equal(flat.reason, 'no_glide');

  const glided = assessSoundLanded({ takeKind: 'siren', kindMetrics: { rangeSt: 9 }, target });
  assert.equal(glided.state, 'unknown');

  const wrongObject = assessSoundLanded({
    takeKind: 'siren', kindMetrics: { rangeSt: 0.3 }, bands: { minPitchRangeSt: 2.4 },
  });
  assert.equal(wrongObject.state, 'unknown', 'the floor must come from the target, not the bands');
});

test('small-voice/big-voice with no shape change at all is contradicted', () => {
  const still = assessSoundLanded({ takeKind: 'resonance_play', kindMetrics: { f2RangeHz: 0 } });
  assert.equal(still.state, 'not_the_sound');

  const moved = assessSoundLanded({ takeKind: 'resonance_play', kindMetrics: { f2RangeHz: 320 } });
  assert.equal(moved.state, 'unknown');
});

test('hum has NO positive detector and must never be blocked acoustically', () => {
  // Documented limitation, pinned so nobody "fixes" it with an invented
  // centroid threshold: telling a hum from a quiet vowel needs nasal-murmur
  // detection or segment awareness, and the app has neither.
  const assessment = assessSoundLanded({
    takeKind: 'hum_sovt',
    kindMetrics: { pitchStdSt: 9, hnr: 2, centroidHz: 4000 },
    bands: { pitchStdStCeiling: 1.2 },
  });
  assert.equal(assessment.state, 'unknown');
  assert.equal(soundLandedBlocksAdvance(assessment), false);
});

// --- wired into the ladder ------------------------------------------------

const RETURN_SENTENCE = 'The morning light is easy on the eyes';

function begin() {
  return beginSentenceProgression({
    returnLineId: 'line-1',
    returnText: RETURN_SENTENCE,
    cueFamilyId: 'tongue-brace',
    cueText: 'Keep the sides of your tongue touching your upper back teeth',
    startedAt: 1_700_000_000_000,
  });
}

function soundTurn(progression, takeKind, evidence = {}) {
  return resolveSentenceProgressionTurn({
    progression,
    takeKind,
    evidence: {
      resolution: 'measured_only',
      measurementUsable: true,
      safety: 'safe',
      transcript: '',
      ...evidence,
    },
  });
}

test('THE GAP THIS CLOSES: a contradicted sound holds the rung instead of advancing', () => {
  // trillRateHz: 0 means the detector RAN and found no trill. (An absent rate
  // means it could not run, which must not block — covered above.)
  const held = soundTurn(begin(), 'trill', { kindMetrics: { trillRateHz: 0 } });
  assert.equal(held.transition, 'sound_retry');
  assert.equal(held.progression.phase, 'acquire', 'a failed sound must not advance the ladder');
  assert.equal(held.soundLanded.reason, 'no_trill_detected');
  assert.equal(held.coachLine, begin().cueText, 'the retry repeats the cue, it does not scold');
});

test('reading the practice line instead of making the sound is caught', () => {
  // The check is a MATCH test, not a word count — see the note in
  // sentence-progression.js. Reading the line matches; a hallucination will not.
  const read = soundTurn(begin(), 'hum_sovt', { transcript: RETURN_SENTENCE });
  assert.equal(read.transition, 'sound_retry');
  assert.equal(read.soundLanded.reason, 'read_the_line_instead');
  assert.equal(read.progression.phase, 'acquire');
});

test('an ASR HALLUCINATION on a wordless take does NOT block', () => {
  // This is why the check is match-based. Whisper-class models emit confident
  // stock phrases on non-speech audio; failing the learner for that would be
  // punishing the recogniser's mistake.
  const hallucinated = soundTurn(begin(), 'hum_sovt', { transcript: 'Thank you for watching.' });
  assert.equal(hallucinated.transition, 'bridge', 'a hallucinated transcript blocked a valid hum');
  assert.equal(hallucinated.progression.phase, 'stabilise');
});

test('a clean sound still advances exactly as before', () => {
  const advanced = soundTurn(begin(), 'hum_sovt');
  assert.equal(advanced.transition, 'bridge');
  assert.equal(advanced.progression.phase, 'stabilise');
  assert.equal(advanced.progression.consecutiveNonlexical, 1);
});

test('the acoustic check is gated on the RUNG, not just the take kind', () => {
  // The earlier version of this test passed takeKind 'phrase', which
  // short-circuits before any rung logic runs — so it proved nothing. A
  // NONLEXICAL kind arriving on a WORD rung is the reachable case (the ladder
  // already has a branch for it), and a contradicting metric there must not
  // block a correctly-spoken bridge.
  const bridged = soundTurn(begin(), 'hum_sovt');
  assert.equal(bridged.progression.expectedUnit, 'phrase');

  const spokenBridge = resolveSentenceProgressionTurn({
    progression: bridged.progression,
    takeKind: 'trill',
    evidence: {
      resolution: 'semantic_measured',
      measurementUsable: true,
      safety: 'safe',
      transcript: bridged.progression.bridgeText,
      kindMetrics: { trillRateHz: 0 },
    },
  });
  assert.notEqual(
    spokenBridge.transition, 'sound_retry',
    'an acoustic contradiction blocked a correctly-spoken word rung',
  );
});

test('a blocked sound rung RETRIES but can never strand the learner', () => {
  // Every hold used to return before the attempt counter incremented, so a
  // learner who could not produce the sound — or whose take the detector
  // misread — was locked on this rung with no exit but changing the drill by
  // hand. The retry now carries the count and falls through at the bound.
  let progression = begin();
  const seen = [];
  for (let turn = 0; turn < 6 && progression; turn += 1) {
    const result = soundTurn(progression, 'trill', { kindMetrics: { trillRateHz: 0 } });
    seen.push(result.transition);
    progression = result.progression;
    if (result.transition !== 'sound_retry') break;
  }
  assert.ok(
    seen.some((t) => t !== 'sound_retry'),
    `the ladder never escaped a failing sound rung: ${seen.join(' -> ')}`,
  );
  assert.ok(seen.filter((t) => t === 'sound_retry').length >= 1, 'it should retry at least once');
});
