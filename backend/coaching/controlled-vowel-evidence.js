'use strict';

const {
  lookupDetectorValidation,
} = require('./detector-validation-registry');
const { hasCompleteFormantReliabilityEvidence } = require('./detector-authority');

const CONTROLLED_VOWEL_EVIDENCE_SCHEMA = 'transvoice.controlled_vowel_evidence.v1';

// Named policy constants (master plan 10.3/10.5 — reviewable, not hidden).
// Conventional formant tracking degrades as F0 approaches the F1 region and
// the common upper ceiling of reliable LPC analysis; this threshold marks
// where evidence must fail closed rather than silently pick a track.
const DEFAULT_HIGH_F0_RISK_HZ = 300;
const MIN_STABLE_SEGMENT_MS = 150;
// Estimator agreement tolerance: 5% of the median estimate per formant.
const ESTIMATOR_RELATIVE_TOLERANCE = 0.05;
// Pitch-context consistency: the take's median F0 and the analysis windows'
// median pitch must agree within this relative tolerance, or the two pitch
// witnesses describe different audio — unknown, never zero.
const PITCH_CONTEXT_RELATIVE_TOLERANCE = 0.15;

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value, maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function segmentDurationMs(stableSegment) {
  const start = finiteOrNull(stableSegment?.startMs);
  const end = finiteOrNull(stableSegment?.endMs);
  if (start == null || end == null || end <= start) return null;
  return end - start;
}

function formantRecord(valueHz, confidence) {
  return {
    valueHz: finiteOrNull(valueHz),
    confidence: finiteOrNull(confidence),
  };
}

/**
 * Estimator agreement across retained candidate estimates per formant
 * (master plan 10.5: more than one estimator/configuration where practical).
 * A formant with fewer than two estimates has NO agreement evidence —
 * unknown, never silently passing. Agreement is judged per formant against
 * a relative tolerance (5% of the median estimate) so tolerance scales with
 * formant frequency.
 */
function evaluateEstimatorAgreement(estimates) {
  if (!estimates || typeof estimates !== 'object' || Array.isArray(estimates)) {
    return { agreementOk: false, reason: 'estimator_agreement_unavailable', perFormant: {} };
  }
  const perFormant = {};
  let unavailable = false;
  let disagreement = false;
  for (const key of ['f1', 'f2', 'f3']) {
    const values = (Array.isArray(estimates[key]) ? estimates[key] : [])
      .map(finiteOrNull)
      .filter((value) => value != null && value > 0);
    if (values.length < 2) {
      unavailable = true;
      perFormant[key] = { count: values.length, spreadHz: null, toleranceHz: null, ok: null };
      continue;
    }
    const sorted = [...values].sort((a, b) => a - b);
    const spreadHz = sorted[sorted.length - 1] - sorted[0];
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
    const toleranceHz = median * ESTIMATOR_RELATIVE_TOLERANCE;
    const ok = spreadHz <= toleranceHz;
    if (!ok) disagreement = true;
    perFormant[key] = {
      count: values.length,
      spreadHz: Math.round(spreadHz * 1000) / 1000,
      toleranceHz: Math.round(toleranceHz * 1000) / 1000,
      ok,
    };
  }
  if (unavailable) {
    return { agreementOk: false, reason: 'estimator_agreement_unavailable', perFormant };
  }
  if (disagreement) {
    return { agreementOk: false, reason: 'estimator_disagreement', perFormant };
  }
  return { agreementOk: true, reason: null, perFormant };
}

function compactValidation(validation) {
  if (!validation) return null;
  return {
    validationId: validation.validationId || null,
    status: validation.status || null,
    decisionEligible: validation.decisionEligible === true,
    activeReleaseEligible: validation.activeReleaseEligible === true,
    humanBenchmarkRequired: validation.humanBenchmarkRequired !== false,
  };
}

/**
 * Build the authoritative controlled-vowel evidence record (master plan
 * 10.3). EVERY gate fails closed with an explicit invalidity reason; the
 * record retains the measurement values as research evidence even when not
 * validForCoaching, but nothing here may be used for learner-facing formant
 * coaching unless every gate passes — including the external versioned
 * detector-validation registry marking the exact analyzerVersion +
 * detectorFamily active-release eligible (an analyzer cannot self-certify).
 */
function buildControlledVowelEvidence(rawBundle, { validationRegistry = null } = {}) {
  const bundle = rawBundle && typeof rawBundle === 'object' && !Array.isArray(rawBundle)
    ? rawBundle
    : null;
  if (!bundle) {
    return {
      schema: CONTROLLED_VOWEL_EVIDENCE_SCHEMA,
      validForCoaching: false,
      invalidityReasons: ['input_bundle_invalid'],
      probeId: null,
      languagePackId: null,
      formants: null,
      detectorValidation: null,
    };
  }

  const invalidityReasons = [];

  // Stable segment (plan 10.4): analyse the stable vowel centre only.
  const stableSegmentRaw = bundle.stableSegment
    && typeof bundle.stableSegment === 'object'
    && !Array.isArray(bundle.stableSegment)
    ? bundle.stableSegment
    : null;
  const durationMs = stableSegmentRaw ? segmentDurationMs(stableSegmentRaw) : null;
  const stableSegment = stableSegmentRaw
    ? {
      startMs: finiteOrNull(stableSegmentRaw.startMs),
      endMs: finiteOrNull(stableSegmentRaw.endMs),
      durationMs,
      confidence: finiteOrNull(stableSegmentRaw.confidence),
    }
    : null;
  if (!stableSegment || stableSegment.durationMs == null) {
    invalidityReasons.push('stable_segment_missing');
  } else if (stableSegment.durationMs < MIN_STABLE_SEGMENT_MS) {
    invalidityReasons.push('stable_segment_too_short');
  }

  // Reliability raw extraction must precede the F0 gates (pitch-context
  // witnesses come from the per-window evidence).
  const rawReliability = bundle.reliability
    && typeof bundle.reliability === 'object'
    && !Array.isArray(bundle.reliability)
    ? bundle.reliability
    : {};

  // Evidence identity is REQUIRED (plan 10.3): probe, pack, attempt,
  // recording context and analyzer version must all be present.
  const identityPresent = [
    textOrNull(bundle.probeId, 120),
    textOrNull(bundle.languagePackId, 160),
    textOrNull(bundle.attemptArtifactId, 200),
    textOrNull(bundle.recordingContextId, 200),
    textOrNull(bundle.analyzerVersion, 160),
  ].every(Boolean);
  if (!identityPresent) {
    invalidityReasons.push('evidence_identity_missing');
  }

  // F0 + formants F1-F3 (F4 optional): value AND per-formant confidence.
  const f0MedianHz = finiteOrNull(bundle.f0MedianHz);
  const rawFormants = bundle.formants
    && typeof bundle.formants === 'object'
    && !Array.isArray(bundle.formants)
    ? bundle.formants
    : {};
  const formants = {
    f1: formantRecord(rawFormants.f1?.valueHz, rawFormants.f1?.confidence),
    f2: formantRecord(rawFormants.f2?.valueHz, rawFormants.f2?.confidence),
    f3: formantRecord(rawFormants.f3?.valueHz, rawFormants.f3?.confidence),
    f4: rawFormants.f4 ? formantRecord(rawFormants.f4.valueHz, rawFormants.f4.confidence) : null,
  };
  for (const key of ['f1', 'f2', 'f3']) {
    if (formants[key].valueHz == null || formants[key].valueHz <= 0) {
      invalidityReasons.push('formant_value_missing');
      break;
    }
  }
  for (const key of ['f1', 'f2', 'f3']) {
    if (formants[key].confidence == null) {
      invalidityReasons.push('per_formant_confidence_missing');
      break;
    }
  }

  // F0 evidence is REQUIRED, not defaulted: unknown is never zero. The risk
  // verdict derives from the MAXIMUM pitch witness available (take median
  // and per-window pitch context) so a low median cannot mask a high-pitch
  // analysis context.
  const windowMedianPitchHz = finiteOrNull(rawReliability.medianWindowPitchHz);
  const windowMaxPitchHz = finiteOrNull(rawReliability.maxWindowPitchHz);
  if (f0MedianHz == null || f0MedianHz <= 0) {
    invalidityReasons.push('f0_median_missing');
  }
  if (
    f0MedianHz != null && f0MedianHz > 0 && windowMedianPitchHz != null
    && Math.abs(f0MedianHz - windowMedianPitchHz) > f0MedianHz * PITCH_CONTEXT_RELATIVE_TOLERANCE
  ) {
    invalidityReasons.push('f0_pitch_context_inconsistent');
  }
  const pitchWitnesses = [f0MedianHz, windowMedianPitchHz, windowMaxPitchHz]
    .filter((value) => value != null && value > 0);
  const maxPitchWitness = pitchWitnesses.length ? Math.max(...pitchWitnesses) : null;
  // High-F0 risk: conventional formant tracking degrades at high F0 — a
  // transfeminine-relevant case — so evidence fails closed above the line.
  const highF0Risk = maxPitchWitness != null && maxPitchWitness >= DEFAULT_HIGH_F0_RISK_HZ
    ? 'elevated'
    : 'nominal';
  if (highF0Risk === 'elevated') {
    invalidityReasons.push('high_f0_reliability_risk');
  }

  // Estimator agreement (plan 10.5): multiple frames/candidate tracks.
  const estimatorAgreement = evaluateEstimatorAgreement(bundle.estimates);
  if (estimatorAgreement.reason) {
    invalidityReasons.push(estimatorAgreement.reason);
  }

  // Track continuity (plan 10.5, backlog P3-002): candidate-track
  // retention witness from the analyzer. A missing witness is unknown,
  // never passing; analyzer-reported degraded continuity fails closed.
  // NOTE shape divergence: feminization-v1-policy gates comparability from
  // observation metadata (contextComparable/controlledProbeId); this record
  // gates the analyzer-side continuity witness. Both must hold for coaching.
  const trackContinuityRaw = bundle.trackContinuity
    && typeof bundle.trackContinuity === 'object'
    && !Array.isArray(bundle.trackContinuity)
    ? bundle.trackContinuity
    : null;
  const trackContinuity = trackContinuityRaw
    ? {
      gapCount: finiteOrNull(trackContinuityRaw.gapCount),
      maxGapMs: finiteOrNull(trackContinuityRaw.maxGapMs),
      ok: trackContinuityRaw.ok === true,
    }
    : null;
  if (!trackContinuity) {
    invalidityReasons.push('track_continuity_missing');
  } else if (trackContinuity.ok !== true) {
    invalidityReasons.push('track_continuity_degraded');
  }

  // Controlled context: same probe, verified comparability, controlled kind.
  const contextVerified = bundle.contextComparable === true
    && bundle.contextKind === 'controlled_probe_formant'
    && Boolean(textOrNull(bundle.comparisonContextKey, 200));
  if (!contextVerified) {
    invalidityReasons.push('controlled_context_not_verified');
  }

  // Prompt verification (plan 10.3: prompt identity is part of evidence).
  const promptMatched = bundle.promptMatched === true;
  if (!promptMatched) {
    invalidityReasons.push('prompt_not_matched');
  }

  // Reliability evidence completeness (window counts, dispersion, pitch
  // context) — the same objective-evidence contract detector-authority uses.
  const reliability = rawReliability;
  const reliabilityComplete = hasCompleteFormantReliabilityEvidence({
    metadata: { detectorFamily: textOrNull(reliability.detectorFamily, 120) || null },
    ...reliability,
  });
  if (!reliabilityComplete) {
    invalidityReasons.push('reliability_evidence_incomplete');
  }

  // External detector validation (release gate): the analyzer cannot
  // self-certify; only the versioned registry can mark release eligibility.
  const validation = lookupDetectorValidation({
    analysisVersion: textOrNull(bundle.analyzerVersion, 160),
    detectorFamily: textOrNull(reliability.detectorFamily, 120),
    ...(validationRegistry ? { registry: validationRegistry } : {}),
  });
  const detectorValidation = compactValidation(validation);
  if (!validation || validation.activeReleaseEligible !== true) {
    invalidityReasons.push('detector_not_release_validated');
  }

  return {
    schema: CONTROLLED_VOWEL_EVIDENCE_SCHEMA,
    probeId: textOrNull(bundle.probeId, 120),
    languagePackId: textOrNull(bundle.languagePackId, 160),
    attemptArtifactId: textOrNull(bundle.attemptArtifactId, 200),
    recordingContextId: textOrNull(bundle.recordingContextId, 200),
    analyzerVersion: textOrNull(bundle.analyzerVersion, 160),
    analysisProfile: textOrNull(bundle.analysisProfile, 120),
    comparisonContextKey: textOrNull(bundle.comparisonContextKey, 200),
    promptMatched,
    promptConfidence: finiteOrNull(bundle.promptConfidence),
    stableSegment,
    f0MedianHz,
    formants,
    reliability: {
      detectorFamily: textOrNull(reliability.detectorFamily, 120),
      analysisWindowCount: finiteOrNull(reliability.analysisWindowCount),
      validWindowCount: finiteOrNull(reliability.validWindowCount),
      validWindowPct: finiteOrNull(reliability.validWindowPct),
      f2IqrHz: finiteOrNull(reliability.f2IqrHz),
      f2MadHz: finiteOrNull(reliability.f2MadHz),
      medianWindowPitchHz: finiteOrNull(reliability.medianWindowPitchHz),
      maxWindowPitchHz: finiteOrNull(reliability.maxWindowPitchHz),
    },
    estimatorAgreement,
    trackContinuity,
    highF0Risk,
    detectorValidation,
    validForCoaching: invalidityReasons.length === 0,
    invalidityReasons,
  };
}

module.exports = {
  CONTROLLED_VOWEL_EVIDENCE_SCHEMA,
  DEFAULT_HIGH_F0_RISK_HZ,
  ESTIMATOR_RELATIVE_TOLERANCE,
  MIN_STABLE_SEGMENT_MS,
  PITCH_CONTEXT_RELATIVE_TOLERANCE,
  buildControlledVowelEvidence,
  evaluateEstimatorAgreement,
};
