'use strict';

const {
  invalidatingFlags,
  isUsableObservation,
  normalizeObservation,
} = require('./metric-observations');
const { MIN_PITCH_VALID_FRAME_COUNT } = require('../voice-measurement-validity');
const {
  DEFAULT_DETECTOR_VALIDATION_REGISTRY,
  validationForObservation,
} = require('./detector-validation-registry');

const DETECTOR_AUTHORITY_SCHEMA = 'transvoice.detector_authority.v2';
const AUTHORITY_STATES = Object.freeze([
  'authoritative',
  'exploratory',
  'unavailable',
]);

const YIN_DERIVED_DIMENSIONS = new Set([
  'pitch.register',
  'pitch.lower_edge',
  'pitch.upper_edge',
  'prosody.pitch_variability',
  'prosody.phrase_ending',
]);

const FORMANT_DIMENSIONS = new Set([
  'resonance.global_scale',
  'resonance.frontness_proxy',
  'resonance.vowel.frontness',
]);

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function metadataOf(observation) {
  return observation?.metadata && typeof observation.metadata === 'object' && !Array.isArray(observation.metadata)
    ? observation.metadata
    : {};
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

function result(observation, authority, reason, evidence = {}, validation = null) {
  return {
    schema: DETECTOR_AUTHORITY_SCHEMA,
    authority,
    reason,
    metricId: observation?.metricId || null,
    dimension: observation?.dimension || null,
    activeReleaseEligible: validation?.activeReleaseEligible === true,
    validation: compactValidation(validation),
    evidence,
  };
}

function classifyYinAuthority(observation, validation) {
  const metadata = metadataOf(observation);
  const detectorFamily = textOrNull(metadata.detectorFamily, 80);
  const pitchValidFrameCount = finiteOrNull(metadata.pitchValidFrameCount);
  const hitPitchCeiling = metadata.hitPitchCeiling === true;

  if (detectorFamily !== 'yin') {
    return result(observation, 'exploratory', 'pitch_detector_provenance_missing', {
      detectorFamily,
      pitchValidFrameCount,
      hitPitchCeiling,
    }, validation);
  }
  if (pitchValidFrameCount == null) {
    return result(observation, 'exploratory', 'pitch_valid_frame_count_missing', {
      detectorFamily,
      pitchValidFrameCount,
      hitPitchCeiling,
    }, validation);
  }
  if (pitchValidFrameCount < MIN_PITCH_VALID_FRAME_COUNT) {
    return result(observation, 'exploratory', 'pitch_detector_evidence_too_short', {
      detectorFamily,
      pitchValidFrameCount,
      requiredPitchValidFrameCount: MIN_PITCH_VALID_FRAME_COUNT,
      hitPitchCeiling,
    }, validation);
  }
  if (hitPitchCeiling) {
    return result(observation, 'exploratory', 'pitch_tracker_ceiling_reached', {
      detectorFamily,
      pitchValidFrameCount,
      hitPitchCeiling,
    }, validation);
  }
  if (!validation) {
    return result(observation, 'exploratory', 'pitch_detector_validation_registry_missing', {
      detectorFamily,
      pitchValidFrameCount,
      hitPitchCeiling,
      analysisVersion: observation.metricDefinitionVersion || null,
    });
  }
  if (validation.decisionEligible !== true) {
    return result(observation, 'exploratory', 'pitch_detector_not_validated_for_shadow_decision', {
      detectorFamily,
      pitchValidFrameCount,
      hitPitchCeiling,
      analysisVersion: observation.metricDefinitionVersion || null,
    }, validation);
  }
  return result(observation, 'authoritative', null, {
    detectorFamily,
    pitchValidFrameCount,
    requiredPitchValidFrameCount: MIN_PITCH_VALID_FRAME_COUNT,
    hitPitchCeiling,
    analysisVersion: observation.metricDefinitionVersion || null,
  }, validation);
}

function formantReliabilityEvidence(observation) {
  const metadata = metadataOf(observation);
  const formantEvidence = metadata.formantEvidence
    && typeof metadata.formantEvidence === 'object'
    && !Array.isArray(metadata.formantEvidence)
    ? metadata.formantEvidence
    : {};
  return {
    detectorFamily: textOrNull(metadata.detectorFamily, 80),
    analysisWindowCount: finiteOrNull(formantEvidence.analysisWindowCount),
    validWindowCount: finiteOrNull(formantEvidence.validWindowCount),
    validWindowPct: finiteOrNull(formantEvidence.validWindowPct),
    f2IqrHz: finiteOrNull(formantEvidence.f2IqrHz),
    f2MadHz: finiteOrNull(formantEvidence.f2MadHz),
    medianWindowPitchHz: finiteOrNull(formantEvidence.medianWindowPitchHz),
    maxWindowPitchHz: finiteOrNull(formantEvidence.maxWindowPitchHz),
  };
}

function hasCompleteFormantReliabilityEvidence(evidence) {
  const countOk = evidence.analysisWindowCount != null
    && evidence.validWindowCount != null
    && evidence.analysisWindowCount > 0
    && evidence.validWindowCount >= 3
    && evidence.validWindowCount <= evidence.analysisWindowCount;
  const pctOk = evidence.validWindowPct != null
    && evidence.validWindowPct >= 0
    && evidence.validWindowPct <= 1;
  const dispersionOk = evidence.f2IqrHz != null
    && evidence.f2IqrHz >= 0
    && evidence.f2MadHz != null
    && evidence.f2MadHz >= 0;
  const pitchContextOk = evidence.medianWindowPitchHz != null
    && evidence.medianWindowPitchHz > 0
    && evidence.maxWindowPitchHz != null
    && evidence.maxWindowPitchHz >= evidence.medianWindowPitchHz;
  return countOk && pctOk && dispersionOk && pitchContextOk;
}

function classifyFormantAuthority(observation, validation) {
  const metadata = metadataOf(observation);
  const evidence = formantReliabilityEvidence(observation);

  if (metadata.contextComparable !== true
      || observation.contextKind !== 'controlled_probe_formant'
      || !textOrNull(observation.comparisonContextKey || metadata.comparisonContextKey, 200)) {
    return result(observation, 'unavailable', 'controlled_formant_context_not_verified', evidence, validation);
  }
  if (evidence.detectorFamily !== 'lpc_formant_lite_v4') {
    return result(observation, 'exploratory', 'formant_detector_provenance_missing', evidence, validation);
  }
  if (!hasCompleteFormantReliabilityEvidence(evidence)) {
    return result(observation, 'exploratory', 'formant_reliability_evidence_incomplete', evidence, validation);
  }

  // Objective extraction evidence belongs to the DSP result. Release/validation
  // status does not: it comes only from the external versioned registry so an
  // analyzer cannot self-certify by emitting `authorityEligible: true`.
  if (!validation) {
    return result(observation, 'exploratory', 'formant_detector_validation_registry_missing', evidence);
  }
  if (validation.decisionEligible !== true) {
    return result(observation, 'exploratory', 'formant_detector_not_validated_for_shadow_decision', evidence, validation);
  }
  return result(observation, 'authoritative', null, evidence, validation);
}

/**
 * Classify whether one already-usable acoustic observation has enough detector
 * evidence to choose a beginner-facing SHADOW decision. Active release is a
 * separate, stronger property exposed as `activeReleaseEligible`.
 *
 * This is intentionally stricter than `isUsableObservation`: generic capture
 * validity answers whether a number is safe to retain/compare; detector
 * authority answers whether that estimator has enough local evidence AND an
 * external versioned validation record for instructional evaluation.
 */
function classifyDetectorAuthority(rawObservation, {
  validationRegistry = DEFAULT_DETECTOR_VALIDATION_REGISTRY,
} = {}) {
  const observation = normalizeObservation(rawObservation);
  const invalid = invalidatingFlags(observation);
  if (!observation.metricId || !observation.dimension || !isUsableObservation(observation)) {
    return result(observation, 'unavailable', invalid[0] || 'observation_not_usable', {
      invalidatingFlags: invalid,
    });
  }

  const validation = validationForObservation(observation, { registry: validationRegistry });
  if (YIN_DERIVED_DIMENSIONS.has(observation.dimension)) {
    return classifyYinAuthority(observation, validation);
  }
  if (FORMANT_DIMENSIONS.has(observation.dimension)) {
    return classifyFormantAuthority(observation, validation);
  }
  return result(observation, 'exploratory', 'detector_not_beginner_authoritative', {}, validation);
}

function compactReasons(items) {
  const counts = {};
  for (const item of items) {
    const reason = String(item?.authority?.reason || 'unknown').slice(0, 120);
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function filterDetectorAuthoritativeObservations(observations, options = {}) {
  const authoritative = [];
  const exploratory = [];
  const unavailable = [];
  const authorityByComparisonKey = {};
  for (const observation of Array.isArray(observations) ? observations : []) {
    const normalized = normalizeObservation(observation);
    const authority = classifyDetectorAuthority(normalized, options);
    const entry = { observation, authority };
    if (normalized.comparisonKey) authorityByComparisonKey[normalized.comparisonKey] = authority;
    if (authority.authority === 'authoritative') authoritative.push(observation);
    else if (authority.authority === 'unavailable') unavailable.push(entry);
    else exploratory.push(entry);
  }
  return {
    schema: DETECTOR_AUTHORITY_SCHEMA,
    authoritative,
    exploratory,
    unavailable,
    authorityByComparisonKey,
    exclusionReasons: compactReasons([...exploratory, ...unavailable]),
  };
}

module.exports = {
  AUTHORITY_STATES,
  DETECTOR_AUTHORITY_SCHEMA,
  FORMANT_DIMENSIONS,
  YIN_DERIVED_DIMENSIONS,
  classifyDetectorAuthority,
  filterDetectorAuthoritativeObservations,
  formantReliabilityEvidence,
  hasCompleteFormantReliabilityEvidence,
};
