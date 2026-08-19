'use strict';

const { decideTargetCoaching } = require('./target-coaching-engine');
const { filterDetectorAuthoritativeObservations } = require('./detector-authority');
const {
  DEFAULT_CURRICULUM_PHASE,
  FEMINIZATION_V1_DOMAIN,
  filterFeminizationV1Observations,
  normalizeCurriculumPhase,
} = require('./feminization-v1-policy');

const PRODUCT_POLICY_BRIDGE_SCHEMA = 'transvoice.product_policy_bridge.v3';
const GENERIC_RESEARCH_DOMAIN = 'generic_research';

function selfReportFromVoiceState(voiceState = {}) {
  return voiceState.lastAttemptArtifact?.selfReport || voiceState.selfReport || {};
}

function compactExclusions(excluded) {
  const counts = {};
  for (const item of Array.isArray(excluded) ? excluded : []) {
    const reason = String(item?.reason || 'unknown').slice(0, 120);
    counts[reason] = (counts[reason] || 0) + 1;
  }
  return counts;
}

function compactDetectorAuthority(authority) {
  if (!authority || typeof authority !== 'object') return null;
  return {
    authority: authority.authority || null,
    reason: authority.reason || null,
    activeReleaseEligible: authority.activeReleaseEligible === true,
    validationId: authority.validation?.validationId || null,
    validationStatus: authority.validation?.status || null,
    humanBenchmarkRequired: authority.validation?.humanBenchmarkRequired !== false,
  };
}

/**
 * Preserve the full observation vector for research/audit, but constrain which
 * observations may choose a learner-facing decision through TWO independent
 * gates:
 *   1. product/curriculum eligibility -- should this skill be taught now?
 *   2. detector authority -- is this particular measurement trustworthy enough
 *      to control a SHADOW instructional decision?
 *
 * Active release is deliberately stronger still. The selected detector's
 * external validation record is surfaced on productPolicy and the activation
 * bridge refuses learner-facing use until `activeReleaseEligible === true`.
 */
function applyProductPolicyToBridge(bridge, {
  productDomain = FEMINIZATION_V1_DOMAIN,
  curriculumPhase = DEFAULT_CURRICULUM_PHASE,
  voiceState = {},
  motorMap = null,
  stage = 'phrase',
  detectorAuthorityOptions = {},
} = {}) {
  if (!bridge || typeof bridge !== 'object' || bridge.error) return bridge;

  if (productDomain === GENERIC_RESEARCH_DOMAIN) {
    return {
      ...bridge,
      productPolicy: {
        schema: PRODUCT_POLICY_BRIDGE_SCHEMA,
        domain: GENERIC_RESEARCH_DOMAIN,
        curriculumPhase: null,
        domainEligibleObservationCount: Array.isArray(bridge.observations) ? bridge.observations.length : 0,
        decisionObservationCount: Array.isArray(bridge.observations) ? bridge.observations.length : 0,
        excludedObservationCount: 0,
        detectorExploratoryCount: 0,
        detectorUnavailableCount: 0,
        selectedDetectorAuthority: null,
        exclusionReasons: {},
        detectorExclusionReasons: {},
      },
    };
  }

  const phase = normalizeCurriculumPhase(curriculumPhase);
  const domainFiltered = filterFeminizationV1Observations(bridge.observations, { phase });
  const detectorFiltered = filterDetectorAuthoritativeObservations(
    domainFiltered.eligible,
    detectorAuthorityOptions,
  );
  const decision = decideTargetCoaching({
    observations: detectorFiltered.authoritative,
    selfReport: selfReportFromVoiceState(voiceState),
    stage,
    motorMap,
  });
  const selectedDetectorAuthority = decision?.focus?.comparisonKey
    ? detectorFiltered.authorityByComparisonKey?.[decision.focus.comparisonKey] || null
    : null;

  return {
    ...bridge,
    // Keep the complete evidence vector. Only decision authority is filtered.
    decision,
    productPolicy: {
      schema: PRODUCT_POLICY_BRIDGE_SCHEMA,
      domain: FEMINIZATION_V1_DOMAIN,
      curriculumPhase: phase,
      domainEligibleObservationCount: domainFiltered.eligible.length,
      decisionObservationCount: detectorFiltered.authoritative.length,
      excludedObservationCount: domainFiltered.excluded.length
        + detectorFiltered.exploratory.length
        + detectorFiltered.unavailable.length,
      detectorExploratoryCount: detectorFiltered.exploratory.length,
      detectorUnavailableCount: detectorFiltered.unavailable.length,
      selectedDetectorAuthority: compactDetectorAuthority(selectedDetectorAuthority),
      eligibleDimensions: [...new Set(
        detectorFiltered.authoritative.map((item) => item.dimension).filter(Boolean),
      )],
      exclusionReasons: compactExclusions(domainFiltered.excluded),
      detectorExclusionReasons: detectorFiltered.exclusionReasons,
    },
  };
}

module.exports = {
  GENERIC_RESEARCH_DOMAIN,
  PRODUCT_POLICY_BRIDGE_SCHEMA,
  applyProductPolicyToBridge,
  compactDetectorAuthority,
};
