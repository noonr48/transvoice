'use strict';

const FEMINIZATION_V1_POLICY_SCHEMA = 'transvoice.feminization_v1_policy.v1';
const FEMINIZATION_V1_DOMAIN = 'feminization_v1';

const CURRICULUM_PHASES = Object.freeze([
  'calibration',
  'awareness',
  'pitch_foundation',
  'pitch_repeatability',
  'resonance_foundation',
  'integration',
  'transfer',
  // R1-004: first release ends at short-phrase transfer; prosody is a later
  // extension (see beginner-mastery PHASE_ORDER — the two lists must match).
  'prosody',
]);

const DEFAULT_CURRICULUM_PHASE = 'pitch_foundation';

const SCOPE = Object.freeze({
  direction: 'male_to_female',
  audience: 'adult_beginner',
  modality: 'spoken_voice',
  language: 'english_prompt_matched_v1',
  targetPhilosophy: 'smallest_safe_controllable_step_toward_user_goal',
  referenceUploadRequired: false,
  aggregateGenderScoreAllowed: false,
  anatomicalInferenceAllowed: false,
  universalPitchThresholdAllowed: false,
});

// Roles are deliberately separate from detector availability. A metric can be
// measured and retained for research without being allowed to choose the next
// beginner lesson.
const METRIC_RULES = Object.freeze({
  'pitch.register': Object.freeze({
    role: 'coaching',
    phases: Object.freeze(['pitch_foundation', 'pitch_repeatability', 'integration', 'prosody', 'transfer']),
  }),
  'pitch.lower_edge': Object.freeze({
    role: 'coaching',
    phases: Object.freeze(['pitch_repeatability', 'integration', 'prosody', 'transfer']),
  }),
  'pitch.upper_edge': Object.freeze({
    role: 'supporting',
    phases: Object.freeze([]),
  }),
  'resonance.global_scale': Object.freeze({
    role: 'coaching_controlled_context_only',
    phases: Object.freeze(['resonance_foundation', 'integration']),
  }),
  'resonance.frontness_proxy': Object.freeze({
    role: 'coaching_controlled_context_only',
    phases: Object.freeze(['resonance_foundation', 'integration']),
  }),
  'prosody.pitch_variability': Object.freeze({
    role: 'coaching_later',
    phases: Object.freeze(['prosody', 'transfer']),
  }),
  'prosody.phrase_ending': Object.freeze({
    role: 'coaching_later',
    phases: Object.freeze(['prosody', 'transfer']),
  }),
  'transfer.retention': Object.freeze({
    role: 'coaching',
    phases: Object.freeze(['transfer']),
  }),
  'production.stability': Object.freeze({
    role: 'supporting',
    phases: Object.freeze([]),
  }),
  'resonance.legacy_proxy': Object.freeze({
    role: 'research_only',
    phases: Object.freeze([]),
  }),
  'phonation.legacy_weight_proxy': Object.freeze({
    role: 'research_only',
    phases: Object.freeze([]),
  }),
  'phonation.source_weight': Object.freeze({
    role: 'research_only',
    phases: Object.freeze([]),
  }),
  'phonation.breathiness': Object.freeze({
    role: 'research_only',
    phases: Object.freeze([]),
  }),
  'phonation.pressedness': Object.freeze({
    role: 'safety_advisory_only',
    phases: Object.freeze([]),
  }),
  'phonation.periodicity': Object.freeze({
    role: 'research_only',
    phases: Object.freeze([]),
  }),
  'phonation.harmonic_presence': Object.freeze({
    role: 'research_only',
    phases: Object.freeze([]),
  }),
});

const SAFETY_AND_CAPTURE_CHANNELS = Object.freeze([
  'reported_pain',
  'reported_throat_pain',
  'reported_discomfort',
  'reported_effort',
  'reported_fatigue',
  'reported_strain',
  'capture_reliability',
  'snr',
  'clipping',
  'voiced_coverage',
  'extractor_confidence',
  'prompt_context_match',
]);

const OUTCOME_CHANNELS = Object.freeze([
  'voice_satisfaction',
  'voice_congruence',
  'comfort',
  'sustainability',
  'confidence_using_voice',
  'social_participation',
  'no_feedback_retention',
  'real_world_transfer',
]);

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function normalizeCurriculumPhase(value) {
  const phase = textOrNull(value, 80);
  return CURRICULUM_PHASES.includes(phase) ? phase : DEFAULT_CURRICULUM_PHASE;
}

function observationDimension(observation) {
  return textOrNull(observation?.dimension || observation?.metricId, 160);
}

function hasVerifiedControlledResonanceContext(observation) {
  const metadata = observation?.metadata && typeof observation.metadata === 'object'
    ? observation.metadata
    : {};
  const comparisonContextKey = textOrNull(
    observation?.comparisonContextKey || metadata.comparisonContextKey,
    200,
  );
  return Boolean(
    metadata.contextComparable === true
    && comparisonContextKey
    && textOrNull(metadata.controlledProbeId, 120)
    && observation?.contextKind === 'controlled_probe_formant'
  );
}

function hasSupportedProsodyContext(observation) {
  const takeKind = textOrNull(observation?.takeKind, 80);
  return ['phrase', 'reading', 'spontaneous'].includes(takeKind);
}

function classifyFeminizationV1Observation(observation, { phase = DEFAULT_CURRICULUM_PHASE } = {}) {
  const dimension = observationDimension(observation);
  const resolvedPhase = normalizeCurriculumPhase(phase);
  const rule = dimension && Object.prototype.hasOwnProperty.call(METRIC_RULES, dimension)
    ? METRIC_RULES[dimension]
    : null;

  if (!rule) {
    return {
      eligible: false,
      dimension,
      role: 'unregistered',
      phase: resolvedPhase,
      reason: 'dimension_not_in_feminization_v1',
    };
  }
  if (!rule.phases.includes(resolvedPhase)) {
    return {
      eligible: false,
      dimension,
      role: rule.role,
      phase: resolvedPhase,
      reason: rule.role === 'research_only' || rule.role === 'safety_advisory_only'
        ? 'metric_not_beginner_coaching_authority'
        : 'metric_not_unlocked_for_phase',
    };
  }
  if (rule.role === 'coaching_controlled_context_only'
    && !hasVerifiedControlledResonanceContext(observation)) {
    return {
      eligible: false,
      dimension,
      role: rule.role,
      phase: resolvedPhase,
      reason: 'controlled_resonance_context_not_verified',
    };
  }
  if (rule.role === 'coaching_later' && !hasSupportedProsodyContext(observation)) {
    return {
      eligible: false,
      dimension,
      role: rule.role,
      phase: resolvedPhase,
      reason: 'prosody_context_not_supported',
    };
  }
  return {
    eligible: true,
    dimension,
    role: rule.role,
    phase: resolvedPhase,
    reason: null,
  };
}

function filterFeminizationV1Observations(observations, options = {}) {
  const eligible = [];
  const excluded = [];
  for (const observation of Array.isArray(observations) ? observations : []) {
    const classification = classifyFeminizationV1Observation(observation, options);
    if (classification.eligible) eligible.push(observation);
    else excluded.push({
      dimension: classification.dimension,
      role: classification.role,
      reason: classification.reason,
    });
  }
  return {
    schema: FEMINIZATION_V1_POLICY_SCHEMA,
    domain: FEMINIZATION_V1_DOMAIN,
    phase: normalizeCurriculumPhase(options.phase),
    eligible,
    excluded,
  };
}

function metricRole(dimension) {
  const key = textOrNull(dimension, 160);
  const rule = key && Object.prototype.hasOwnProperty.call(METRIC_RULES, key)
    ? METRIC_RULES[key]
    : null;
  return rule?.role || 'unregistered';
}

module.exports = {
  CURRICULUM_PHASES,
  DEFAULT_CURRICULUM_PHASE,
  FEMINIZATION_V1_DOMAIN,
  FEMINIZATION_V1_POLICY_SCHEMA,
  METRIC_RULES,
  OUTCOME_CHANNELS,
  SAFETY_AND_CAPTURE_CHANNELS,
  SCOPE,
  classifyFeminizationV1Observation,
  filterFeminizationV1Observations,
  hasSupportedProsodyContext,
  hasVerifiedControlledResonanceContext,
  metricRole,
  normalizeCurriculumPhase,
};
