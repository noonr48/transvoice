'use strict';

const {
  FEMINIZATION_V1_DOMAIN,
  classifyFeminizationV1Observation,
  metricRole,
  normalizeCurriculumPhase,
} = require('./feminization-v1-policy');

const METRIC_ELIGIBILITY_SCHEMA = 'transvoice.metric_eligibility.v1';

// Dimensions that may never select a beginner lesson, regardless of phase.
// They remain measurable for research/shadow evaluation only.
const RESEARCH_ONLY_DIMENSIONS = Object.freeze(Object.entries(
  require('./feminization-v1-policy').METRIC_RULES,
)
  .filter(([, rule]) => rule.role === 'research_only')
  .map(([dimension]) => dimension));

/**
 * Hard metric eligibility for the feminization v1 controller.
 *
 * This is the gate BETWEEN the curriculum phase and any ranking: observations
 * that are not eligible for the current phase never reach the generic engine.
 * It composes the versioned domain policy; it must not be weakened per call
 * site. There is deliberately no "override" option.
 */
function eligibleObservationsForPhase(observations, { phase } = {}) {
  const resolvedPhase = normalizeCurriculumPhase(phase);
  const eligible = [];
  const rejected = [];
  for (const observation of Array.isArray(observations) ? observations : []) {
    const classification = classifyFeminizationV1Observation(observation, { phase: resolvedPhase });
    if (classification.eligible) eligible.push(observation);
    else {
      rejected.push({
        dimension: classification.dimension,
        role: classification.role,
        reason: classification.reason,
      });
    }
  }
  return {
    schema: METRIC_ELIGIBILITY_SCHEMA,
    domain: FEMINIZATION_V1_DOMAIN,
    phase: resolvedPhase,
    eligible,
    rejected,
  };
}

function isMetricEligibleForPhase(observation, { phase } = {}) {
  return classifyFeminizationV1Observation(observation, { phase }).eligible === true;
}

module.exports = {
  METRIC_ELIGIBILITY_SCHEMA,
  RESEARCH_ONLY_DIMENSIONS,
  eligibleObservationsForPhase,
  isMetricEligibleForPhase,
  metricRole,
};
