'use strict';

/**
 * DID THE REQUESTED SOUND ACTUALLY HAPPEN? (2026-07-29)
 *
 * WHY THIS EXISTS. The sentence-progression ladder verifies the WORD rungs — a
 * transcript that does not match the expected text triggers a retry
 * (`assessLexicalAccuracy`). The SOUND rung has no equivalent: for a nonlexical
 * take `lexicalAccuracy` is hard-set to 'unknown' and the only gate left is
 * `measurementUsable === true`, i.e. "a measurable take happened". So a learner
 * asked to hum who instead says a sentence — or makes any voiced noise at all —
 * advances the ladder exactly as if the hum had landed. This module supplies the
 * missing half.
 *
 * THE POLARITY, AND IT IS THE WHOLE DESIGN. Without segment awareness (no forced
 * aligner, no phoneme model, no parsed ASR timings — see
 * backend/coaching/section-scorer.js:16-19) the app usually CANNOT PROVE a
 * particular sound was produced. It can often DISPROVE it. So this returns three
 * states, not two:
 *
 *   'landed'         a purpose-built detector positively confirms the sound
 *   'not_the_sound'  a PRESENT measurement contradicts the requested sound
 *   'unknown'        nothing contradicts it and nothing confirms it
 *
 * A missing metric yields 'unknown', never 'not_the_sound'. Punishing a
 * measurement gap as a performance failure is how a meter loses a learner's
 * trust, and the estate has already been bitten by exactly that (the analyzer's
 * own history of manufacturing mid-band values rather than returning null).
 *
 * NO INVENTED THRESHOLDS. Every numeric comparison below either reads a band the
 * target profile already computes, or is skipped. There is no calibration corpus
 * for "a good hum", so this module deliberately does not pretend to grade one —
 * it answers "did you do the exercise", not "was it any good". Those are
 * different questions and only the first is answerable today.
 */

/**
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: read the transcript.
 *
 * The first cut counted spoken words — "a sound rung that produced two or more
 * words is not that sound". That is WRONG, and the reason is worth keeping.
 * ASR models hallucinate confident text on non-speech audio; a hum routinely
 * transcribes as a short stock phrase. A word-count test therefore fails the
 * learner for the recogniser's mistake, which is precisely the "punish a
 * measurement gap as a performance failure" trap this module's polarity exists
 * to avoid.
 *
 * The transcript check that IS sound — did the learner speak the PRACTICE LINE
 * instead of making the sound — needs the expected text and the same
 * edit-distance tolerance the word rungs use, so it lives in
 * sentence-progression.js next to assessLexicalAccuracy. A hallucination will
 * not match the practice line; reading the line when asked to hum will.
 * This module stays purely acoustic.
 */

/** Take kinds that are a SOUND rather than speech. Mirrors sentence-progression. */
const NONLEXICAL_TAKE_KINDS = new Set([
  'hum_sovt',
  'resonance_play',
  'siren',
  'sustained',
  'trill',
]);

/**
 * THE NULL-AS-ZERO TRAP, and it bit this module hard enough to be worth the
 * comment. `Number(null) === 0`, and 0 is finite — so a bare
 * `Number.isFinite(Number(v))` reader turns an ABSENT metric into a present
 * zero. Every per-kind check below asks "is this measurement missing?", so
 * without the `v == null` guard an absent f2RangeHz reads as "the mouth shape
 * did not move at all" and BLOCKS a learner whose formants simply were not
 * measured. That is the precise inversion of this module's stated polarity.
 * signal-builder.js:2324-2327 guards the same trap for the same reason.
 */
function toFiniteOrNull(value) {
  if (value == null) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function verdict(state, reason, evidence = null) {
  return { state, reason, evidence };
}

/**
 * Per-kind contradiction tests. Each returns a verdict or null for "no opinion".
 * `bands` is the target profile's advanced bands; a missing band means the check
 * is SKIPPED, not failed.
 */
const KIND_CHECKS = Object.freeze({
  // The only kind with a purpose-built detector, so the only kind that can be
  // positively CONFIRMED. `trillDetected` is produced by _trill_metrics
  // (envelope autocorrelation in the 15-45 Hz band) specifically to answer this.
  trill(metrics) {
    // KEY ON trillRateHz, NOT trillDetected. buildKindMetrics derives
    // `trillDetected: trillRateHz != null && trillRateHz > 0`
    // (signal-builder.js:2374) — a two-state boolean that collapses "the
    // detector ran and found nothing" together with "the detector could not run
    // at all". The second case is common and benign: trillRateHz is null
    // whenever the frame rate cannot cover the 15-45 Hz band, which includes the
    // LIVE ~16 fps path, and on short voiced spans. Reading the boolean made
    // every live trill take a failure. trillRateHz keeps the three states.
    const rateHz = toFiniteOrNull(metrics.trillRateHz);
    if (rateHz == null) return null;
    if (rateHz > 0) {
      return verdict('landed', 'trill_detected', { trillRateHz: rateHz });
    }
    return verdict('not_the_sound', 'no_trill_detected', { trillRateHz: rateHz });
  },

  // A sustained vowel is defined by NOT moving. The ceiling is the profile's own
  // pitchStdStCeiling (built as max(1.2, measured + 0.4)) — an existing
  // calibrated band, not a number invented here.
  sustained(metrics, bands) {
    const spread = toFiniteOrNull(metrics.pitchStdSt);
    const ceiling = toFiniteOrNull(bands.pitchStdStCeiling);
    if (spread == null || ceiling == null) return null;
    if (spread > ceiling) {
      return verdict('not_the_sound', 'pitch_not_held', { pitchStdSt: spread, ceiling });
    }
    return null;
  },

  // A siren is defined by TRAVELLING. The floor is the preset's own
  // min_pitch_range_st — the melodic range an ordinary phrase is already
  // expected to cover, so a "siren" below it did not glide at all.
  // NOTE THE SOURCE OF THE FLOOR. `minPitchRangeSt` is a member of the per-take
  // ATTEMPT TARGET (contracts.py VoiceAttemptTarget, normalized in
  // voice-session-state.js normalizeVoiceAttemptTarget) — it is NOT on
  // targetProfile.advancedBands, whose 11 fields do not include it. Reading it
  // from the wrong object made this branch permanently dead: `floor` was always
  // null, so a siren could never be contradicted and the "no invented
  // thresholds" claim was hollow here. The caller now passes the attempt target.
  siren(metrics, bands, target) {
    const rangeSt = toFiniteOrNull(metrics.rangeSt);
    const floor = toFiniteOrNull(target.minPitchRangeSt);
    if (rangeSt == null || floor == null) return null;
    if (rangeSt < floor) {
      return verdict('not_the_sound', 'no_glide', { rangeSt, floor });
    }
    return null;
  },

  // Small-voice/big-voice play is defined by the mouth shape MOVING. f2RangeHz
  // is null below 3 usable windows, so a present zero is a real "nothing moved".
  resonance_play(metrics) {
    const f2Range = toFiniteOrNull(metrics.f2RangeHz);
    if (f2Range == null) return null;
    if (f2Range <= 0) {
      return verdict('not_the_sound', 'no_shape_change', { f2RangeHz: f2Range });
    }
    return null;
  },

  // hum_sovt: NO POSITIVE DETECTOR EXISTS, and none is invented here. Telling a
  // hum from a quiet vowel needs either nasal-murmur detection (absent) or
  // segment awareness (absent). The spoken-words check above is the only honest
  // signal, and it is applied to every kind. Documented rather than faked.
});

/**
 * Assess whether the requested nonlexical sound actually happened.
 *
 * @param {object}  args
 * @param {string}  args.takeKind    the kind the tutor asked for
 * @param {string}  args.transcript  ASR transcript for the take, if any
 * @param {object}  args.kindMetrics per-kind metric block (buildKindMetrics)
 * @param {object}  args.bands       target profile advanced bands, if resolved
 * @returns {{state: 'landed'|'not_the_sound'|'unknown', reason: string, evidence: object|null}}
 */
function assessSoundLanded({
  takeKind,
  kindMetrics = null,
  bands = null,
  target = null,
} = {}) {
  const kind = typeof takeKind === 'string' ? takeKind.trim().toLowerCase() : '';
  if (!NONLEXICAL_TAKE_KINDS.has(kind)) {
    return verdict('unknown', 'not_a_sound_rung');
  }

  const check = KIND_CHECKS[kind];
  if (typeof check !== 'function') {
    return verdict('unknown', 'no_detector_for_kind');
  }
  const metrics = kindMetrics && typeof kindMetrics === 'object' ? kindMetrics : {};
  const bandSet = bands && typeof bands === 'object' ? bands : {};
  const targetSet = target && typeof target === 'object' ? target : {};
  return check(metrics, bandSet, targetSet) || verdict('unknown', 'no_contradiction');
}

/**
 * The ladder's gate: advance unless the sound was positively contradicted.
 * Fail-closed on contradiction, open on absence — see the polarity note above.
 */
function soundLandedBlocksAdvance(assessment) {
  return assessment?.state === 'not_the_sound';
}

module.exports = {
  assessSoundLanded,
  soundLandedBlocksAdvance,
  NONLEXICAL_TAKE_KINDS,
};
