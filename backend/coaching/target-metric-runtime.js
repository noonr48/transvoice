'use strict';

const {
  applyTargetMetricDecision,
  buildTargetMetricShadowWitness,
  safeBuildTargetMetricBridge,
} = require('./target-metric-bridge');
const { resolveProbeContextComparability } = require('./controlled-probes');
const {
  DEFAULT_CURRICULUM_PHASE,
  FEMINIZATION_V1_DOMAIN,
  normalizeCurriculumPhase,
} = require('./feminization-v1-policy');
const { normalizeBeginnerMasteryState } = require('./beginner-mastery');
const { applyProductPolicyToBridge } = require('./product-policy-bridge');

const TARGET_METRIC_RUNTIME_SCHEMA = 'transvoice.target_metric_runtime.v2';

function resolveTargetMetricStage(repContext, signal) {
  const kind = String(repContext?.kind || signal?.takeKind || '').trim().toLowerCase();
  if (['sustained', 'vowel', 'hum', 'sovt', 'sound'].some((token) => kind.includes(token))) {
    return 'sound';
  }
  if (kind.includes('word')) return 'word';
  if (kind.includes('reading')) return 'reading';
  if (kind.includes('spontaneous') || kind.includes('conversation')) return 'spontaneous';
  return 'phrase';
}

function resolveRuntimeContextComparability(repContext, explicit = {}) {
  const probe = resolveProbeContextComparability(repContext);
  const supplied = explicit && typeof explicit === 'object' && !Array.isArray(explicit)
    ? explicit
    : {};
  return {
    // Explicit comparability remains available for future validated alignment
    // callers. Controlled-probe inference never upgrades arbitrary speech.
    formants: supplied.formants === true || probe.formants === true,
    phraseProsody: supplied.phraseProsody === true || probe.phraseProsody === true,
    verified: supplied.verified === true || probe.verified === true,
    source: supplied.source || probe.source || null,
    probeId: supplied.probeId || probe.probeId || null,
    comparisonContextKey: supplied.comparisonContextKey || probe.comparisonContextKey || null,
    targetEvidenceKind: supplied.targetEvidenceKind || probe.targetEvidenceKind || null,
  };
}

function resolveRuntimeCurriculumPhase({
  curriculumPhase = null,
  masteryState = null,
  voiceState = {},
} = {}) {
  if (typeof curriculumPhase === 'string' && curriculumPhase.trim()) {
    return normalizeCurriculumPhase(curriculumPhase);
  }
  const persisted = masteryState
    || voiceState?.targetMetric?.mastery
    || voiceState?.beginnerMastery
    || null;
  if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
    return normalizeBeginnerMasteryState(persisted).curriculumPhase;
  }
  return DEFAULT_CURRICULUM_PHASE;
}

/**
 * Shared target-metric runtime boundary for buffered and SSE coaching.
 *
 * In shadow mode this function is observational only: it never mutates the
 * CoachingSignal. In active mode it delegates to the bridge's positive
 * activation gates; the helper itself does not weaken or duplicate them.
 *
 * The full observation vector remains available to research/evaluation. The
 * product policy separately decides which measurements have enough authority
 * to choose the beginner's next coaching action.
 */
function evaluateTargetMetricRuntime({
  voiceState = {},
  signal = null,
  repContext = null,
  mode = 'shadow',
  motorMap = null,
  observations = null,
  persistenceByDimension = {},
  allowUnreviewedCues = false,
  turnWindowStartedAt = undefined,
  contextComparability = {},
  sectionLoopActive = false,
  productDomain = FEMINIZATION_V1_DOMAIN,
  curriculumPhase = null,
  masteryState = null,
} = {}) {
  const resolvedMode = ['off', 'shadow', 'active'].includes(mode) ? mode : 'shadow';
  if (resolvedMode === 'off') {
    return {
      schema: TARGET_METRIC_RUNTIME_SCHEMA,
      mode: 'off',
      stage: null,
      productDomain,
      curriculumPhase: null,
      bridge: null,
      witness: null,
      applied: false,
    };
  }

  const stage = resolveTargetMetricStage(repContext, signal);
  const resolvedContextComparability = resolveRuntimeContextComparability(
    repContext,
    contextComparability,
  );
  const resolvedCurriculumPhase = resolveRuntimeCurriculumPhase({
    curriculumPhase,
    masteryState,
    voiceState,
  });
  const researchBridge = safeBuildTargetMetricBridge({
    voiceState,
    motorMap,
    stage,
    mode: resolvedMode,
    observations,
    persistenceByDimension,
    allowUnreviewedCues,
    turnWindowStartedAt,
    repContext,
    practiceMode: signal?.mode || 'active_drill',
    contextComparability: resolvedContextComparability,
  });
  const bridge = applyProductPolicyToBridge(researchBridge, {
    productDomain,
    curriculumPhase: resolvedCurriculumPhase,
    voiceState,
    motorMap,
    stage,
  });

  const baseWitness = buildTargetMetricShadowWitness(bridge, signal);
  const witness = baseWitness ? {
    ...baseWitness,
    product_domain: bridge?.productPolicy?.domain || productDomain || null,
    curriculum_phase: bridge?.productPolicy?.curriculumPhase || resolvedCurriculumPhase || null,
    product_decision_observation_count: bridge?.productPolicy?.decisionObservationCount ?? null,
    product_excluded_observation_count: bridge?.productPolicy?.excludedObservationCount ?? null,
    product_exclusion_reasons: bridge?.productPolicy?.exclusionReasons || {},
  } : null;
  let applied = false;
  if (resolvedMode === 'active' && signal && typeof signal === 'object') {
    applyTargetMetricDecision(signal, bridge, { sectionLoopActive });
    applied = signal.targetMetricV3?.mode === 'active'
      && signal.targetMetricV3?.activation?.eligible === true;
  }

  return {
    schema: TARGET_METRIC_RUNTIME_SCHEMA,
    mode: resolvedMode,
    stage,
    productDomain: bridge?.productPolicy?.domain || productDomain,
    curriculumPhase: bridge?.productPolicy?.curriculumPhase || resolvedCurriculumPhase,
    contextComparability: resolvedContextComparability,
    bridge,
    witness,
    applied,
  };
}

module.exports = {
  TARGET_METRIC_RUNTIME_SCHEMA,
  evaluateTargetMetricRuntime,
  resolveRuntimeContextComparability,
  resolveRuntimeCurriculumPhase,
  resolveTargetMetricStage,
};
