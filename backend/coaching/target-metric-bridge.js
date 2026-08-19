'use strict';

const { legacyObservationsFromVoiceState } = require('./legacy-observation-adapter');
const { normalizeObservation } = require('./metric-observations');
const { decideTargetCoaching, verifyCueEffect } = require('./target-coaching-engine');
const { recordCueOutcome } = require('./motor-map');

const BRIDGE_SCHEMA = 'transvoice.target_metric_bridge.v4';
const FEMINIZATION_V1_DOMAIN = 'feminization_v1';

function selfReportFromVoiceState(voiceState = {}) {
  return voiceState.lastAttemptArtifact?.selfReport || voiceState.selfReport || {};
}
function legacyFocusForDecision(decision) {
  const dimension = decision?.focus?.dimension;
  const direction = decision?.focus?.direction;
  if (dimension === 'pitch.register') return direction === 'above' ? 'pitch_lower' : 'pitch_floor';
  if ((dimension === 'resonance.global_scale' || dimension === 'resonance.legacy_proxy')
    && direction === 'below') return 'resonance_forward';
  if ((dimension === 'phonation.source_weight' || dimension === 'phonation.legacy_weight_proxy')
    && direction === 'above') return 'vocal_weight';
  if (dimension === 'phonation.breathiness') return 'tone_clarity';
  if (dimension === 'prosody.phrase_ending') return 'phrase_ending';
  return null;
}
function compactCanonicalContext(context = {}) {
  return {
    freshness: {
      fresh: context.freshness?.fresh === true,
      reason: context.freshness?.reason || null,
      takeFinalizedAt: context.freshness?.takeFinalizedAt ?? null,
      turnWindowStartedAt: context.freshness?.turnWindowStartedAt ?? null,
    },
    measurementUsable: context.usability?.usableForScoring === true,
    measurementReasons: Array.isArray(context.usability?.reasons)
      ? context.usability.reasons.slice(0, 12)
      : [],
    hasTargetContract: context.contract?.hasTargetContract === true,
    targetIdentityFailures: Array.isArray(context.contract?.targetIdentityFailures)
      ? context.contract.targetIdentityFailures.slice(0, 8)
      : [],
    targetValidationFailures: Array.isArray(context.contract?.targetValidationFailures)
      ? context.contract.targetValidationFailures.slice(0, 8)
      : [],
    targetKey: context.contract?.target?.targetKey || null,
    targetSource: context.contract?.target?.source || null,
    attemptArtifactId: context.attemptArtifactId || null,
    taskId: context.taskId || null,
    takeKind: context.takeKind || null,
    takeKindSource: context.takeKindSource || null,
    analysisProfile: context.analysisProfile || null,
  };
}

function _buildTargetMetricBridge({
  voiceState = {},
  motorMap = null,
  stage = 'phrase',
  mode = 'shadow',
  observations = null,
  persistenceByDimension = {},
  allowUnreviewedCues = false,
  turnWindowStartedAt = undefined,
  repContext = null,
  practiceMode = 'active_drill',
  contextComparability = {},
} = {}) {
  let resolvedObservations = observations;
  let canonicalContext = null;
  if (!Array.isArray(resolvedObservations)) {
    const adapted = legacyObservationsFromVoiceState(voiceState, {
      persistenceByDimension,
      turnWindowStartedAt,
      repContext,
      practiceMode,
      contextComparability,
      returnContext: true,
    });
    resolvedObservations = adapted.observations;
    canonicalContext = adapted.canonicalContext;
  }
  const decision = decideTargetCoaching({
    observations: resolvedObservations,
    selfReport: selfReportFromVoiceState(voiceState),
    stage,
    motorMap,
  });
  return {
    schema: BRIDGE_SCHEMA,
    mode,
    observations: resolvedObservations,
    decision,
    canonicalContext: compactCanonicalContext(canonicalContext || {}),
    allowUnreviewedCues,
    error: null,
  };
}

function buildTargetMetricBridge(options = {}) {
  try {
    return _buildTargetMetricBridge(options);
  } catch (error) {
    return {
      schema: BRIDGE_SCHEMA,
      mode: options.mode || 'shadow',
      observations: [],
      decision: null,
      canonicalContext: null,
      allowUnreviewedCues: options.allowUnreviewedCues === true,
      error: {
        code: 'target_metric_bridge_error',
        name: error && error.name ? String(error.name).slice(0, 80) : 'Error',
      },
    };
  }
}
const safeBuildTargetMetricBridge = buildTargetMetricBridge;

function focusObservationForDecision(bridge) {
  const focus = bridge?.decision?.focus || null;
  const observations = Array.isArray(bridge?.observations) ? bridge.observations : [];
  if (!focus || !observations.length) return null;
  const normalized = observations.map((item) => normalizeObservation(item));
  if (focus.comparisonKey) {
    const exact = normalized.find((item) => item.comparisonKey === focus.comparisonKey);
    if (exact) return exact;
  }
  const candidates = normalized.filter((item) => (
    item.dimension === focus.dimension
    && (!focus.targetKey || item.target?.targetKey === focus.targetKey)
    && (!focus.taskId || item.taskId === focus.taskId)
    && (!focus.takeKind || item.takeKind === focus.takeKind)
  ));
  return candidates.length === 1 ? candidates[0] : null;
}

function reachableTrainingTargetEvidence(bridge) {
  const observation = focusObservationForDecision(bridge);
  const metadata = observation?.metadata && typeof observation.metadata === 'object'
    ? observation.metadata
    : {};
  return {
    required: bridge?.productPolicy?.domain === FEMINIZATION_V1_DOMAIN,
    applied: metadata.trainingTargetApplied === true,
    status: typeof metadata.trainingTargetStatus === 'string'
      ? metadata.trainingTargetStatus
      : null,
    policyId: typeof metadata.trainingTargetPolicyId === 'string'
      ? metadata.trainingTargetPolicyId
      : null,
    policyVersion: typeof metadata.trainingTargetPolicyVersion === 'string'
      ? metadata.trainingTargetPolicyVersion
      : null,
  };
}

function detectorReleaseEvidence(bridge) {
  const selected = bridge?.productPolicy?.selectedDetectorAuthority || null;
  const required = bridge?.productPolicy?.domain === FEMINIZATION_V1_DOMAIN;
  return {
    required,
    shadowAuthority: selected?.authority || null,
    activeReleaseEligible: selected?.activeReleaseEligible === true,
    validationId: selected?.validationId || null,
    validationStatus: selected?.validationStatus || null,
    humanBenchmarkRequired: selected?.humanBenchmarkRequired !== false,
  };
}

function activationEligibility(signal, bridge, { sectionLoopActive = false } = {}) {
  const reasons = [];
  const legacyFocus = legacyFocusForDecision(bridge?.decision);
  const cueApproved = bridge?.decision?.action?.reviewStatus === 'approved'
    || bridge?.allowUnreviewedCues === true;
  const context = bridge?.canonicalContext || {};
  const takeKind = context.takeKind;
  const trainingTarget = reachableTrainingTargetEvidence(bridge);
  const detectorRelease = detectorReleaseEvidence(bridge);

  if (bridge?.mode !== 'active') reasons.push('mode_not_active');
  if (bridge?.error) reasons.push('bridge_error');
  if (bridge?.decision?.status !== 'coach' || !bridge?.decision?.action) reasons.push('no_coach_action');
  if (!legacyFocus) reasons.push('focus_not_schema_compatible');
  if (!cueApproved) reasons.push('cue_not_approved');
  if (signal?.mode !== 'active_drill') reasons.push('not_active_drill');
  if (signal?.policy?.shouldCorrect !== true) reasons.push('policy_not_correcting');
  if (signal?.policy?.safetyState !== 'normal') reasons.push('safety_not_normal');
  if (signal?.policy?.coachingAction !== 'coach') reasons.push('coaching_action_not_plain_coach');
  if (signal?.takeQuality?.usable !== true) reasons.push('take_not_positively_usable');
  if (signal?.capture?.reliability !== 'good') reasons.push('capture_not_good');
  if (signal?.sessionScope?.tier && signal.sessionScope.tier !== 'full') reasons.push('session_scope_not_full');
  if (sectionLoopActive) reasons.push('section_loop_active');
  if (context.freshness?.fresh !== true) reasons.push('take_not_fresh');
  if (context.measurementUsable !== true) reasons.push('measurement_not_usable');
  if (context.hasTargetContract !== true) reasons.push('target_contract_invalid');
  if ((context.targetIdentityFailures || []).length > 0) reasons.push('target_identity_invalid');
  if ((context.targetValidationFailures || []).length > 0) reasons.push('target_band_invalid');
  if (['ear_training', 'silent'].includes(takeKind)) reasons.push('take_kind_not_coachable');

  // Beginner MTF coaching must never use the long-range aspirational target as
  // an active pass line. A caller must first apply a named/versioned calibrated
  // reachable-step policy to the exact observation selected for the decision.
  if (trainingTarget.required) {
    if (!trainingTarget.applied || trainingTarget.status !== 'reachable_step_ready') {
      reasons.push('reachable_training_target_not_ready');
    }
    if (!trainingTarget.policyId || !trainingTarget.policyVersion) {
      reasons.push('reachable_training_target_policy_missing');
    }
  }

  // Shadow decision authority is not a release certificate. Even a detector
  // with strong synthetic regression coverage stays learner-inactive until an
  // external versioned validation record explicitly marks the exact analysis
  // version as active-release eligible after the held-out human/device work.
  if (detectorRelease.required) {
    if (detectorRelease.shadowAuthority !== 'authoritative') {
      reasons.push('selected_detector_not_shadow_authoritative');
    }
    if (!detectorRelease.validationId || !detectorRelease.validationStatus) {
      reasons.push('detector_validation_identity_missing');
    }
    if (!detectorRelease.activeReleaseEligible) {
      reasons.push('detector_not_release_validated');
    }
  }

  return {
    eligible: reasons.length === 0,
    reasons: [...new Set(reasons)],
    legacyFocus,
    cueApproved,
    trainingTarget,
    detectorRelease,
  };
}

function applyTargetMetricDecision(signal, bridge, activationContext = {}) {
  if (!signal || typeof signal !== 'object' || !bridge) return signal;
  const activation = activationEligibility(signal, bridge, activationContext);
  if (!activation.eligible) return signal;

  signal.targetMetricV3 = {
    schema: bridge.schema,
    mode: bridge.mode,
    decision: bridge.decision,
    activation: {
      eligibleLegacyFocus: activation.legacyFocus,
      cueReviewStatus: bridge.decision?.action?.reviewStatus || null,
      unreviewedCueOverride: bridge.allowUnreviewedCues === true,
      trainingTargetPolicyId: activation.trainingTarget.policyId,
      trainingTargetPolicyVersion: activation.trainingTarget.policyVersion,
      detectorValidationId: activation.detectorRelease.validationId,
      detectorValidationStatus: activation.detectorRelease.validationStatus,
      eligible: true,
    },
  };
  signal.coachingDecision = {
    ...signal.coachingDecision,
    primaryFocus: activation.legacyFocus,
    reason: bridge.decision.reason,
    recommendedDrill: {
      id: bridge.decision.action.cueId,
      instruction: bridge.decision.action.instruction,
      successCriteria: bridge.decision.action.successText,
    },
    successCriteria: [bridge.decision.action.successText],
    avoidCues: [...new Set([
      ...(signal.coachingDecision?.avoidCues || []),
      'Do not claim an anatomical position from acoustics.',
      'Do not change more than the selected focus on this attempt.',
    ])],
  };
  signal.coachMove = {
    ...signal.coachMove,
    cue: bridge.decision.action.instruction,
    successCriteria: bridge.decision.action.successText,
  };
  return signal;
}

function buildTargetMetricShadowWitness(bridge, signal = null) {
  if (!bridge) return null;
  const decision = bridge.decision;
  const legacyFocus = legacyFocusForDecision(decision);
  const currentFocus = signal?.coachingDecision?.primaryFocus || null;
  const trainingTarget = reachableTrainingTargetEvidence(bridge);
  const detectorRelease = detectorReleaseEvidence(bridge);
  return {
    schema: bridge.schema,
    mode: bridge.mode,
    outcome: bridge.error ? 'error' : (decision?.status || 'no_decision'),
    focus_dimension: decision?.focus?.dimension || null,
    focus_direction: decision?.focus?.direction || null,
    focus_confidence: decision?.focus?.confidence ?? null,
    focus_distance: decision?.focus?.distance ?? null,
    cue_id: decision?.action?.cueId || null,
    cue_review_status: decision?.action?.reviewStatus || null,
    legacy_focus: legacyFocus,
    existing_focus: currentFocus,
    focus_agreement: legacyFocus && currentFocus ? legacyFocus === currentFocus : null,
    target_key: bridge.canonicalContext?.targetKey || null,
    target_source: bridge.canonicalContext?.targetSource || null,
    take_kind: bridge.canonicalContext?.takeKind || null,
    attempt_artifact_id: bridge.canonicalContext?.attemptArtifactId || null,
    fresh: bridge.canonicalContext?.freshness?.fresh ?? null,
    measurement_usable: bridge.canonicalContext?.measurementUsable ?? null,
    rejection_reasons: bridge.canonicalContext?.measurementReasons || [],
    training_target_required: trainingTarget.required,
    training_target_applied: trainingTarget.applied,
    training_target_status: trainingTarget.status,
    training_target_policy_id: trainingTarget.policyId,
    training_target_policy_version: trainingTarget.policyVersion,
    detector_release_required: detectorRelease.required,
    detector_shadow_authority: detectorRelease.shadowAuthority,
    detector_release_eligible: detectorRelease.activeReleaseEligible,
    detector_validation_id: detectorRelease.validationId,
    detector_validation_status: detectorRelease.validationStatus,
    error_code: bridge.error?.code || null,
  };
}

function learnFromCuePair({
  motorMap,
  previousBridge,
  previousObservations,
  currentObservations,
  effortBefore = null,
  effortAfter = null,
} = {}) {
  const decision = previousBridge?.decision || previousBridge;
  const verification = verifyCueEffect(
    decision,
    previousObservations,
    currentObservations,
    { effortBefore, effortAfter },
  );
  if (verification.status !== 'verified' || !decision?.action?.cueId) {
    return { motorMap, verification };
  }
  return {
    motorMap: recordCueOutcome(motorMap, {
      cueId: decision.action.cueId,
      focusDimension: decision.focus.dimension,
      beforeObservations: previousObservations,
      afterObservations: currentObservations,
      protectedDimensions: decision.action.protectedMetrics || [],
      protectedRules: decision.action.protectedRules || {},
      effortBefore,
      effortAfter,
      verification,
    }),
    verification,
  };
}

module.exports = {
  BRIDGE_SCHEMA,
  activationEligibility,
  applyTargetMetricDecision,
  buildTargetMetricBridge,
  buildTargetMetricShadowWitness,
  detectorReleaseEvidence,
  focusObservationForDecision,
  learnFromCuePair,
  legacyFocusForDecision,
  reachableTrainingTargetEvidence,
  safeBuildTargetMetricBridge,
};
