'use strict';

/**
 * One backend contract for deciding whether an acoustic observation is safe to
 * score, remember, trend, or expose to a coach. `measurementAvailable` answers
 * only whether the analyzer found a pitched observation; these thresholds
 * answer whether that observation is reliable enough to drive product state.
 *
 * The bars intentionally match coaching/safety-gates.js so a take that the
 * capture policy asks the learner to repeat cannot simultaneously train the
 * learner model or appear in Fable history.
 */
const MIN_SCORE_CONFIDENCE = 0.48;
const MIN_VOICED_FRAME_PCT = 0.45;
const MIN_CONFIDENT_FRAME_PCT = 0.5;
const MIN_CAPTURE_RELIABILITY = 0.5;
const MIN_PITCH_VALID_FRAME_COUNT = 20;
const MIN_SNR_DB = 12;
const MAX_CLIPPING_PCT = 0.02;
const SCORING_REJECTION_REASONS = new Set([
  'no_voiced_frames',
  'low_snr',
  'sustained_clipping',
]);

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}

function readAdvancedMetrics(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  if (value.metrics?.advanced && typeof value.metrics.advanced === 'object') {
    return value.metrics.advanced;
  }
  if (value.advanced && typeof value.advanced === 'object') {
    return value.advanced;
  }
  return value;
}

function resolveVoiceMeasurementUsability(value) {
  const advanced = readAdvancedMetrics(value);
  const reliabilityFlags = uniqueStrings(advanced.reliabilityFlags);
  const suppliedRejections = uniqueStrings([
    ...(Array.isArray(advanced.measurementRejectionReasons)
      ? advanced.measurementRejectionReasons : []),
    ...(Array.isArray(advanced.rejectionReasons) ? advanced.rejectionReasons : []),
  ]);
  const reasons = [...suppliedRejections];
  const measurementAvailable = advanced.measurementAvailable === true
    ? true
    : advanced.measurementAvailable === false ? false : null;
  const scoreConfidence = finiteOrNull(advanced.scoreConfidence);
  const voicedFramePct = finiteOrNull(advanced.voicedFramePct);
  const confidentFramePct = finiteOrNull(advanced.confidentFramePct);
  const captureReliability = finiteOrNull(advanced.captureReliability);
  const pitchValidFrameCount = finiteOrNull(advanced.pitchValidFrameCount);
  const snrDb = finiteOrNull(advanced.snrDb);
  const clippingPct = finiteOrNull(advanced.clippingPct);
  const lowVoicedEvidence = voicedFramePct != null
    && voicedFramePct < MIN_VOICED_FRAME_PCT
    && !(pitchValidFrameCount != null && pitchValidFrameCount >= MIN_PITCH_VALID_FRAME_COUNT);
  const suppliedScoringRejection = suppliedRejections.some((reason) => (
    SCORING_REJECTION_REASONS.has(reason)
  ));

  if (measurementAvailable === false && reasons.length === 0) {
    reasons.push('measurement_unavailable');
  }
  if (reliabilityFlags.includes('no_voiced_frames') && !reasons.includes('no_voiced_frames')) {
    reasons.push('no_voiced_frames');
  }
  if (scoreConfidence != null && scoreConfidence < MIN_SCORE_CONFIDENCE) {
    reasons.push('low_score_confidence');
  }
  if (lowVoicedEvidence) {
    reasons.push('low_voiced_coverage');
  }
  if (confidentFramePct != null && confidentFramePct < MIN_CONFIDENT_FRAME_PCT) {
    reasons.push('low_confident_coverage');
  }
  if (captureReliability != null && captureReliability < MIN_CAPTURE_RELIABILITY) {
    reasons.push('low_capture_reliability');
  }
  if (snrDb != null && snrDb < MIN_SNR_DB) {
    reasons.push('low_snr');
  }
  if (clippingPct != null && clippingPct >= MAX_CLIPPING_PCT) {
    reasons.push('sustained_clipping');
  }
  if (scoreConfidence == null && reliabilityFlags.includes('low_score_confidence')) {
    reasons.push('low_score_confidence');
  }
  if (voicedFramePct == null && reliabilityFlags.includes('low_voiced_coverage')) {
    reasons.push('low_voiced_coverage');
  }
  if (confidentFramePct == null && reliabilityFlags.includes('low_confidence')) {
    reasons.push('low_confident_coverage');
  }
  if (captureReliability == null && reliabilityFlags.includes('low_capture_reliability')) {
    reasons.push('low_capture_reliability');
  }

  return {
    measurementAvailable,
    usableForScoring: measurementAvailable !== false
      && !reliabilityFlags.includes('no_voiced_frames')
      && !suppliedScoringRejection
      && !(scoreConfidence != null && scoreConfidence < MIN_SCORE_CONFIDENCE)
      && !lowVoicedEvidence
      && !(confidentFramePct != null && confidentFramePct < MIN_CONFIDENT_FRAME_PCT)
      && !(captureReliability != null && captureReliability < MIN_CAPTURE_RELIABILITY)
      && !(snrDb != null && snrDb < MIN_SNR_DB)
      && !(clippingPct != null && clippingPct >= MAX_CLIPPING_PCT)
      && !(scoreConfidence == null && reliabilityFlags.includes('low_score_confidence'))
      && !(voicedFramePct == null && reliabilityFlags.includes('low_voiced_coverage'))
      && !(confidentFramePct == null && reliabilityFlags.includes('low_confidence'))
      && !(captureReliability == null && reliabilityFlags.includes('low_capture_reliability')),
    reasons: uniqueStrings(reasons),
    reliabilityFlags,
    scoreConfidence,
    voicedFramePct,
    confidentFramePct,
    captureReliability,
    pitchValidFrameCount,
    snrDb,
    clippingPct,
  };
}

function isVoiceAttemptUsable(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.usableForLearning === false || value.usableForScoring === false) return false;
  return resolveVoiceMeasurementUsability(value).usableForScoring;
}

/**
 * Did the analyzer actually hear a VOICE in this take? (2026-07-26)
 *
 * Deliberately NOT `usableForScoring`. That predicate answers "is this reading
 * safe to score/remember/trend", and it treats an ABSENT measurement as usable
 * — correct for its job, wrong for this one. This answers a narrower, harder
 * question: is there POSITIVE evidence of phonation in this take?
 *
 * It is the bar for acknowledging a wordless practice turn when the session's
 * own drill state does NOT say a vocalise is running. Overriding the state is a
 * claim ("I heard you"), so it must rest on evidence, not on the absence of a
 * rejection. Three properties follow from that:
 *
 *   1. A silence rejection disqualifies outright. MEASURED against the live
 *      analyzer (2026-07-26): digital silence returns measurementAvailable
 *      false with measurementRejectionReasons ['no_voiced_frames'].
 *   2. A REPORTED zero disqualifies outright — 0% voiced frames is the
 *      analyzer saying "nothing was voiced", not a missing field.
 *   3. Silence about voicing is NOT evidence of voicing. A take that reports no
 *      voicedFramePct and no pitchValidFrameCount returns false, so the drill
 *      state keeps the last word exactly as it does today.
 *
 * The two positive bars are this module's own constants, not new numbers: the
 * same coverage bar `lowVoicedEvidence` uses, and the same pitched-frame count
 * that already rescues a short-but-real take from it.
 */
function hasVoicedPracticeEvidence(value) {
  const validity = resolveVoiceMeasurementUsability(value);
  if (validity.measurementAvailable === false) return false;
  if (validity.reliabilityFlags.includes('no_voiced_frames')) return false;
  if (validity.reasons.includes('no_voiced_frames')) return false;
  if (validity.voicedFramePct != null && validity.voicedFramePct <= 0) return false;
  if (validity.pitchValidFrameCount != null && validity.pitchValidFrameCount <= 0) return false;
  return (validity.voicedFramePct != null && validity.voicedFramePct >= MIN_VOICED_FRAME_PCT)
    || (validity.pitchValidFrameCount != null && validity.pitchValidFrameCount >= MIN_PITCH_VALID_FRAME_COUNT);
}

module.exports = {
  MAX_CLIPPING_PCT,
  MIN_CAPTURE_RELIABILITY,
  MIN_CONFIDENT_FRAME_PCT,
  MIN_PITCH_VALID_FRAME_COUNT,
  MIN_SCORE_CONFIDENCE,
  MIN_SNR_DB,
  MIN_VOICED_FRAME_PCT,
  hasVoicedPracticeEvidence,
  isVoiceAttemptUsable,
  resolveVoiceMeasurementUsability,
};
