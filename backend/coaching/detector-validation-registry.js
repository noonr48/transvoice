'use strict';

const DETECTOR_VALIDATION_SCHEMA = 'transvoice.detector_validation_registry.v1';

function freezeEntry(value) {
  return Object.freeze({
    schema: DETECTOR_VALIDATION_SCHEMA,
    validationId: value.validationId,
    status: value.status,
    decisionEligible: value.decisionEligible === true,
    activeReleaseEligible: value.activeReleaseEligible === true,
    humanBenchmarkRequired: value.humanBenchmarkRequired !== false,
    evidenceBasis: Object.freeze([...(value.evidenceBasis || [])]),
    pendingEvidence: Object.freeze([...(value.pendingEvidence || [])]),
  });
}

/**
 * Validation is controlled outside the detector implementation. A DSP result
 * may report objective evidence (frame counts, dispersion, saturation), but it
 * cannot certify itself for learner-facing use.
 *
 * `decisionEligible` means the detector may drive SHADOW/product-policy
 * decisions while we evaluate the curriculum. `activeReleaseEligible` is the
 * stronger release gate and stays false until a held-out human/device benchmark
 * has been reviewed. This keeps "synthetic tests pass" distinct from
 * "safe enough to control beginner instruction".
 */
const DEFAULT_DETECTOR_VALIDATION_REGISTRY = Object.freeze({
  'voice-metrics-v4-formants': Object.freeze({
    yin: freezeEntry({
      validationId: 'yin-v4-synthetic-regression-v1',
      status: 'synthetic_regression_validated',
      decisionEligible: true,
      activeReleaseEligible: false,
      humanBenchmarkRequired: true,
      evidenceBasis: [
        'synthetic_harmonic_sweep_80_400_hz',
        '20db_noise_sweep',
        'missing_fundamental_regression',
        'domain_edge_coverage',
        'white_noise_rejection',
      ],
      pendingEvidence: [
        'held_out_human_expert_pitch_corpus',
        'supported_device_challenge_corpus',
        'octave_error_rate_on_real_speech',
      ],
    }),
    lpc_formant_lite_v4: freezeEntry({
      validationId: 'lpc-formant-v4-synthetic-regression-v1',
      status: 'research_only_pending_human_validation',
      decisionEligible: false,
      activeReleaseEligible: false,
      humanBenchmarkRequired: true,
      evidenceBasis: [
        'source_filter_vowel_ground_truth',
        'prominence_ranked_pole_selection',
        'high_f0_f2_shunt_regression',
        'clipped_window_rejection',
      ],
      pendingEvidence: [
        'held_out_human_expert_formant_corpus',
        'supported_device_challenge_corpus',
        'controlled_probe_test_retest_reliability',
        'false_valid_rate_on_wrong_vowel_and_noise',
      ],
    }),
  }),
});

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function normalizeValidationEntry(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const validationId = textOrNull(value.validationId, 200);
  const status = textOrNull(value.status, 120);
  if (!validationId || !status) return null;
  return {
    schema: DETECTOR_VALIDATION_SCHEMA,
    validationId,
    status,
    decisionEligible: value.decisionEligible === true,
    activeReleaseEligible: value.activeReleaseEligible === true,
    humanBenchmarkRequired: value.humanBenchmarkRequired !== false,
    evidenceBasis: Array.isArray(value.evidenceBasis)
      ? value.evidenceBasis.map((item) => textOrNull(item, 160)).filter(Boolean).slice(0, 16)
      : [],
    pendingEvidence: Array.isArray(value.pendingEvidence)
      ? value.pendingEvidence.map((item) => textOrNull(item, 160)).filter(Boolean).slice(0, 16)
      : [],
  };
}

function lookupDetectorValidation({
  analysisVersion = null,
  detectorFamily = null,
  registry = DEFAULT_DETECTOR_VALIDATION_REGISTRY,
} = {}) {
  const version = textOrNull(analysisVersion, 160);
  const family = textOrNull(detectorFamily, 120);
  if (!version || !family || !registry || typeof registry !== 'object') return null;
  return normalizeValidationEntry(registry?.[version]?.[family]);
}

function validationForObservation(observation, {
  registry = DEFAULT_DETECTOR_VALIDATION_REGISTRY,
} = {}) {
  const metadata = observation?.metadata && typeof observation.metadata === 'object'
    ? observation.metadata
    : {};
  return lookupDetectorValidation({
    analysisVersion: observation?.metricDefinitionVersion
      || metadata.takeAnalysisVersion
      || metadata.analysisVersion
      || null,
    detectorFamily: metadata.detectorFamily || null,
    registry,
  });
}

module.exports = {
  DEFAULT_DETECTOR_VALIDATION_REGISTRY,
  DETECTOR_VALIDATION_SCHEMA,
  lookupDetectorValidation,
  normalizeValidationEntry,
  validationForObservation,
};
