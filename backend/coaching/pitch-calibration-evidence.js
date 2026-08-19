'use strict';

const { invalidatingFlags, normalizeObservation } = require('./metric-observations');
const { MIN_PITCH_VALID_FRAME_COUNT } = require('../voice-measurement-validity');
const {
  COMFORT_EFFORT_BOUND,
  parseFivePoint,
} = require('./voice-self-report');

const PITCH_CALIBRATION_EVIDENCE_SCHEMA = 'transvoice.pitch_calibration_evidence.v1';

// Named calibration policy constants (versioned with the schema; never hidden
// engineering steps inside logic).
const MIN_CALIBRATION_TAKES = 5;
// R1-001: the comfort bound now comes from the canonical five-point
// self-report contract (1-5 scale; effort <= 3 is comfortable — the midpoint
// equivalent of the old 0-10 bound of 5).
const DEFAULT_EFFORT_BOUND = COMFORT_EFFORT_BOUND;
// Named plausibility bounds for human speaking-voice median F0 (Hz). A take
// outside this range with clean frames is an octave error or non-speech
// input, never a baseline sample.
const PLAUSIBLE_MIN_PITCH_HZ = 60;
const PLAUSIBLE_MAX_PITCH_HZ = 500;

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * STRICT effort evidence (checkpoint lens-2 F1): self-report effort must be
 * an actual finite number. Booleans, arrays, strings, NaN, Infinity are
 * MISSING evidence — never coerced measurements. A forged `true` must not
 * become effort 1 and earn `effortVerified`; `[]` must not become 0.
 * R1-001: now consumes the canonical five-point contract (parseFivePoint),
 * which adds the 1-5 range check on top of the type check.
 */
function strictEffortNumber(value) {
  return parseFivePoint(value);
}

function textOrNull(value, maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function semitonesBetweenHz(from, to) {
  if (from == null || to == null || from <= 0 || to <= 0) return null;
  return 12 * Math.log2(to / from);
}

function nearestRankQuantile(sortedValues, q) {
  if (!sortedValues.length) return null;
  const index = Math.min(
    sortedValues.length - 1,
    Math.max(0, Math.ceil((q / 100) * sortedValues.length) - 1),
  );
  return sortedValues[index];
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Build versioned pitch calibration EVIDENCE from a calibration session.
 *
 * This module records what the learner's voice actually did and how reliably
 * it was measured. It deliberately derives NO target: no universal Hz band,
 * no population norm, no pass line. A reachable training target may only be
 * derived later by a named, versioned policy (see training-target.js) acting
 * on this evidence.
 *
 * Unknown evidence is never zero: movement without an effort reading is
 * recorded but never counted as comfortable; insufficient sessions return
 * nulls with explicit reasons.
 */
function buildPitchCalibrationEvidence({
  observations = [],
  effortBound = DEFAULT_EFFORT_BOUND,
} = {}) {
  const normalized = (Array.isArray(observations) ? observations : [])
    .map((raw) => ({
      raw,
      normalized: normalizeObservation(raw),
      // normalizeObservation drops caller-supplied self-report fields; effort
      // evidence must be captured from the RAW observation, not the normalized
      // one (unknown stays unknown — never defaulted to zero).
      rawEffort: strictEffortNumber(
        raw && typeof raw === 'object' && !Array.isArray(raw)
          ? raw.selfReport?.effort
          : null,
      ),
    }));

  const reasons = [];
  let excludedNonPitch = 0;
  let excludedUnusable = 0;
  const pitchTakes = [];
  for (const entry of normalized) {
    const observation = entry.normalized;
    if (observation.dimension !== 'pitch.register') {
      excludedNonPitch += 1;
      continue;
    }
    // Calibration validity is CAPTURE validity, not coaching validity: a
    // calibration take has no target band by design (the plan forbids scoring
    // a baseline), so isUsableObservation — which requires target distance —
    // is deliberately NOT used here. A take is calibration-usable when it is
    // not capture-invalid and carries detector evidence. Short-frame takes
    // stay IN the record and are surfaced as tracker risk, not hidden.
    const value = finiteOrNull(observation.value);
    const frames = finiteOrNull(observation.metadata?.pitchValidFrameCount);
    if (
      value == null
      || value <= 0
      || value < PLAUSIBLE_MIN_PITCH_HZ
      || value > PLAUSIBLE_MAX_PITCH_HZ
      || frames == null
      || invalidatingFlags(observation).length > 0
    ) {
      excludedUnusable += 1;
      continue;
    }
    pitchTakes.push({ observation, value, rawEffort: entry.rawEffort });
  }
  if (excludedNonPitch) reasons.push('non_pitch_observations_excluded');
  if (excludedUnusable) reasons.push('unusable_observations_excluded');
  if (pitchTakes.length < MIN_CALIBRATION_TAKES) {
    reasons.push('minimum_calibration_takes_not_met');
    return {
      schema: PITCH_CALIBRATION_EVIDENCE_SCHEMA,
      status: 'insufficient_evidence',
      reasons,
      usableTakeCount: pitchTakes.length,
      minimumTakesRequired: MIN_CALIBRATION_TAKES,
      baseline: null,
      comfortableMovement: null,
      tracker: null,
      effortBound,
    };
  }

  const sortedValues = pitchTakes.map((take) => take.value).sort((a, b) => a - b);
  const baseline = {
    n: sortedValues.length,
    p10: nearestRankQuantile(sortedValues, 10),
    p50: nearestRankQuantile(sortedValues, 50),
    p90: nearestRankQuantile(sortedValues, 90),
    unit: 'Hz',
    // Provenance: small-n nearest-rank quantiles have degenerate tails
    // (n=5 -> p10=min, p90=max). Consumers must gate on spread; the record
    // carries both so the gate is explicit, not implicit.
    quantileMethod: 'nearest_rank',
    spreadSemitones: Math.round(
      12 * Math.log2(sortedValues[sortedValues.length - 1] / sortedValues[0]) * 1e6,
    ) / 1e6,
  };

  // Comfortable movement: consecutive calibration takes, upward or downward,
  // verified by an effort reading at or below the bound. Takes appear in the
  // order supplied (caller orders by time). Missing effort is unknown, never
  // zero — such movement is recorded with effortVerified: false.
  const comfortableMovement = [];
  for (let i = 1; i < pitchTakes.length; i += 1) {
    const before = pitchTakes[i - 1];
    const after = pitchTakes[i];
    const deltaSemitones = semitonesBetweenHz(before.value, after.value);
    if (deltaSemitones == null || deltaSemitones === 0) continue;
    const effort = after.rawEffort;
    const effortVerified = effort != null && effort <= effortBound;
    comfortableMovement.push({
      beforeAttemptArtifactId: textOrNull(before.observation.attemptArtifactId),
      afterAttemptArtifactId: textOrNull(after.observation.attemptArtifactId),
      deltaSemitones: Math.round(deltaSemitones * 1e6) / 1e6,
      direction: deltaSemitones > 0 ? 'up' : 'down',
      effort,
      effortVerified,
    });
  }
  const verifiedMovement = comfortableMovement.filter((m) => m.effortVerified);
  const verifiedUpward = verifiedMovement.filter((m) => m.deltaSemitones > 0);
  const comfortableMovementSummary = {
    verifiedCount: verifiedMovement.length,
    verifiedUpwardCount: verifiedUpward.length,
    maxVerifiedUpwardSemitones: verifiedUpward.length
      ? Math.max(...verifiedUpward.map((m) => m.deltaSemitones))
      : null,
    // Median of verified upward movements: robust against a single artifact
    // take. Policies must treat ONE lucky movement as insufficient (plan 6.4:
    // one lucky attempt never advances stable mastery).
    // Median over ALL verified upward movements (policy consumers: this is
    // NOT the salience-filtered basis — use resolvePitchStepPolicy, which
    // filters to salient verified glides per the named step policy).
    medianAllVerifiedUpwardSemitones: verifiedUpward.length
      ? Math.round(median(verifiedUpward.map((m) => m.deltaSemitones)) * 1e6) / 1e6
      : null,
    maxVerifiedDownwardSemitones: verifiedMovement.length
      ? Math.min(...verifiedMovement.map((m) => m.deltaSemitones))
      : null,
  };

  const frameCounts = pitchTakes
    .map((take) => finiteOrNull(take.observation.metadata?.pitchValidFrameCount))
    .filter((value) => value != null);
  const confidences = pitchTakes
    .map((take) => finiteOrNull(take.observation.confidence?.signal))
    .filter((value) => value != null && value > 0);
  const tracker = {
    detectorFamilies: [...new Set(pitchTakes
      .map((take) => textOrNull(take.observation.metadata?.detectorFamily, 80))
      .filter(Boolean))],
    ceilingHitCount: pitchTakes
      .filter((take) => take.observation.metadata?.hitPitchCeiling === true).length,
    minValidFrameCount: frameCounts.length ? Math.min(...frameCounts) : null,
    medianConfidence: confidences.length ? median(confidences) : null,
    octaveErrorRisk: pitchTakes.some((take) => take.observation.metadata?.hitPitchCeiling === true)
      || (frameCounts.length > 0 && Math.min(...frameCounts) < MIN_PITCH_VALID_FRAME_COUNT)
      ? 'elevated'
      : 'nominal',
  };

  return {
    schema: PITCH_CALIBRATION_EVIDENCE_SCHEMA,
    status: 'valid',
    reasons,
    usableTakeCount: pitchTakes.length,
    baseline,
    comfortableMovement,
    comfortableMovementSummary,
    tracker,
    effortBound,
  };
}

module.exports = {
  DEFAULT_EFFORT_BOUND,
  MIN_CALIBRATION_TAKES,
  PLAUSIBLE_MAX_PITCH_HZ,
  PLAUSIBLE_MIN_PITCH_HZ,
  PITCH_CALIBRATION_EVIDENCE_SCHEMA,
  buildPitchCalibrationEvidence,
};
