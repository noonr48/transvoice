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
const { resolvePitchAlphaCueForShadow } = require('./cue-alpha-authority');
const { resolveFemV1RuntimeTurn } = require('./fem-v1-runtime-turn');
const { resolveFemV1ShadowSessionTurn } = require('./fem-v1-shadow-state');

const TARGET_METRIC_RUNTIME_SCHEMA = 'transvoice.target_metric_runtime.v3';
const FEM_V1_RUNTIME_MODES = Object.freeze(['off', 'shadow']);

function resolveTargetMetricStage(repContext, signal) {
  const kind = String(repContext?.kind || signal?.takeKind || '').trim().toLowerCase();
  if (['sustained', 'vowel', 'hum', 'sovt', 'sound'].some((token) => kind.includes(token))) return 'sound';
  if (kind.includes('word')) return 'word';
  if (kind.includes('reading')) return 'reading';
  if (kind.includes('spontaneous') || kind.includes('conversation')) return 'spontaneous';
  return 'phrase';
}

function resolveRuntimeContextComparability(repContext, explicit = {}) {
  const probe = resolveProbeContextComparability(repContext);
  const supplied = explicit && typeof explicit === 'object' && !Array.isArray(explicit) ? explicit : {};
  return {
    formants: supplied.formants === true || probe.formants === true,
    phraseProsody: supplied.phraseProsody === true || probe.phraseProsody === true,
    verified: supplied.verified === true || probe.verified === true,
    source: supplied.source || probe.source || null,
    probeId: supplied.probeId || probe.probeId || null,
    comparisonContextKey: supplied.comparisonContextKey || probe.comparisonContextKey || null,
    targetEvidenceKind: supplied.targetEvidenceKind || probe.targetEvidenceKind || null,
  };
}

function resolveRuntimeCurriculumPhase({ curriculumPhase = null, masteryState = null, voiceState = {} } = {}) {
  if (typeof curriculumPhase === 'string' && curriculumPhase.trim()) return normalizeCurriculumPhase(curriculumPhase);
  const persisted = masteryState || voiceState?.targetMetric?.mastery || voiceState?.beginnerMastery || null;
  if (persisted && typeof persisted === 'object' && !Array.isArray(persisted)) {
    return normalizeBeginnerMasteryState(persisted).curriculumPhase;
  }
  return DEFAULT_CURRICULUM_PHASE;
}

function normalizeFemV1RuntimeMode(mode) {
  if (mode === 'off') return 'off';
  // Active FEM is deliberately unavailable at this shared seam. Unknown and
  // attempted active values fail closed to shadow until the release gates pass.
  return 'shadow';
}

function captureEvidenceFromSignal(signal) {
  const reliability = typeof signal?.capture?.reliability === 'string'
    ? signal.capture.reliability
    : null;
  return {
    usable: signal?.takeQuality?.usable === true,
    reasons: reliability && reliability !== 'good' ? [`capture_${reliability}`] : [],
  };
}

function finalizedAttemptFromVoiceState(voiceState, captureEvidence, observations) {
  const artifact = voiceState?.lastAttemptArtifact;
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) return null;
  const rawId = artifact.attemptArtifactId || artifact.artifactId || artifact.id || null;
  const attemptArtifactId = typeof rawId === 'string' && rawId.trim() ? rawId.trim() : null;
  if (!attemptArtifactId) return null;
  if (attemptArtifactId.length > 160) throw new Error('attempt_artifact_id_too_long');
  const eligible = captureEvidence.usable === true;
  return {
    attemptArtifactId,
    eligible,
    ineligibleReason: eligible ? null : (captureEvidence.reasons[0] || 'capture_unusable'),
    observations,
    selfReport: artifact.selfReport || voiceState?.selfReport || {},
    captureEvidence,
  };
}

function resolveFemV1ShadowRuntime({ voiceState, signal, bridge, stage, motorMap, masteryState }) {
  const observations = Array.isArray(bridge?.observations) ? bridge.observations : [];
  const captureEvidence = captureEvidenceFromSignal(signal);
  const selfReport = voiceState?.lastAttemptArtifact?.selfReport || voiceState?.selfReport || {};
  const explicitEvent = voiceState?.lastAttemptFinalizedEvent || null;
  const finalizedAttempt = explicitEvent
    ? null
    : finalizedAttemptFromVoiceState(voiceState, captureEvidence, observations);
  const sessionId = voiceState?.sessionId || explicitEvent?.sessionId || null;
  const learnerState = {
    mastery: masteryState || voiceState?.beginnerMastery || null,
    motorResponseMap: motorMap || voiceState?.motorResponseMap || null,
    goalCueOverlay: voiceState?.goalCueOverlay || null,
    goalProfile: voiceState?.goalProfile || null,
    capabilityProfile: voiceState?.capabilityProfile || null,
  };
  const sessionState = {
    sessionId,
    stage,
    pendingTrial: voiceState?.pendingTrial || null,
    revision: Number.isInteger(voiceState?.femV1Revision) ? voiceState.femV1Revision : null,
    attemptSequence: voiceState?.attemptSequence || voiceState?.attempSequence || null,
  };
  const runtimeArgs = {
    learnerState,
    sessionState,
    finalizedAttemptEvent: explicitEvent,
    finalizedAttempt,
    turnEvidence: explicitEvent ? null : { selfReport, captureEvidence, observations },
    cueResolver: resolvePitchAlphaCueForShadow,
  };

  if (!sessionId) {
    return {
      ...resolveFemV1RuntimeTurn({ mode: 'shadow', ...runtimeArgs }),
      nextShadowState: null,
    };
  }

  const resolved = resolveFemV1ShadowSessionTurn({
    shadowState: voiceState?.femV1ShadowState || null,
    ...runtimeArgs,
    sourceSessionRevision: Number.isInteger(voiceState?.femV1Revision) ? voiceState.femV1Revision : null,
  });
  return {
    ...resolved.turn,
    nextShadowState: resolved.nextShadowState,
  };
}

function evaluateTargetMetricRuntime({
  voiceState = {}, signal = null, repContext = null, mode = 'shadow', motorMap = null,
  observations = null, persistenceByDimension = {}, allowUnreviewedCues = false,
  turnWindowStartedAt = undefined, contextComparability = {}, sectionLoopActive = false,
  productDomain = FEMINIZATION_V1_DOMAIN, curriculumPhase = null, masteryState = null,
  femV1Mode = 'shadow',
} = {}) {
  const resolvedMode = ['off', 'shadow', 'active'].includes(mode) ? mode : 'shadow';
  const resolvedFemV1Mode = normalizeFemV1RuntimeMode(femV1Mode);
  if (resolvedMode === 'off') {
    return {
      schema: TARGET_METRIC_RUNTIME_SCHEMA, mode: 'off', stage: null, productDomain,
      curriculumPhase: null, bridge: null, witness: null, femV1Mode: 'off',
      femV1RuntimeTurn: null, femV1NextShadowState: null, applied: false,
    };
  }

  const stage = resolveTargetMetricStage(repContext, signal);
  const resolvedContextComparability = resolveRuntimeContextComparability(repContext, contextComparability);
  const resolvedCurriculumPhase = resolveRuntimeCurriculumPhase({ curriculumPhase, masteryState, voiceState });
  const researchBridge = safeBuildTargetMetricBridge({
    voiceState, motorMap, stage, mode: resolvedMode, observations, persistenceByDimension,
    allowUnreviewedCues, turnWindowStartedAt, repContext,
    practiceMode: signal?.mode || 'active_drill', contextComparability: resolvedContextComparability,
  });
  const bridge = applyProductPolicyToBridge(researchBridge, {
    productDomain, curriculumPhase: resolvedCurriculumPhase, voiceState, motorMap, stage,
  });

  const femV1RuntimeTurn = resolvedFemV1Mode === 'off'
    ? null
    : resolveFemV1ShadowRuntime({ voiceState, signal, bridge, stage, motorMap, masteryState });

  const baseWitness = buildTargetMetricShadowWitness(bridge, signal);
  const witness = baseWitness ? {
    ...baseWitness,
    product_domain: bridge?.productPolicy?.domain || productDomain || null,
    curriculum_phase: bridge?.productPolicy?.curriculumPhase || resolvedCurriculumPhase || null,
    product_decision_observation_count: bridge?.productPolicy?.decisionObservationCount ?? null,
    product_excluded_observation_count: bridge?.productPolicy?.excludedObservationCount ?? null,
    product_exclusion_reasons: bridge?.productPolicy?.exclusionReasons || {},
    fem_v1: femV1RuntimeTurn?.witness || null,
  } : null;

  let applied = false;
  if (resolvedMode === 'active' && signal && typeof signal === 'object') {
    applyTargetMetricDecision(signal, bridge, { sectionLoopActive });
    applied = signal.targetMetricV3?.mode === 'active' && signal.targetMetricV3?.activation?.eligible === true;
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
    femV1Mode: resolvedFemV1Mode,
    femV1RuntimeTurn,
    femV1NextShadowState: femV1RuntimeTurn?.nextShadowState || null,
    applied,
  };
}

module.exports = {
  FEM_V1_RUNTIME_MODES,
  TARGET_METRIC_RUNTIME_SCHEMA,
  evaluateTargetMetricRuntime,
  normalizeFemV1RuntimeMode,
  resolveFemV1ShadowRuntime,
  resolveRuntimeContextComparability,
  resolveRuntimeCurriculumPhase,
  resolveTargetMetricStage,
};
