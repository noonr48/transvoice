'use strict';

const { normalizeObservation, targetDistance, semitonesBetween } = require('./metric-observations');

const TRAINING_TARGET_SCHEMA = 'transvoice.training_target.v1';
const REACHABLE_TARGET_POLICY_SCHEMA = 'transvoice.reachable_target_policy.v1';

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function cloneTarget(target = {}) {
  return {
    low: finiteOrNull(target.low),
    high: finiteOrNull(target.high),
    center: finiteOrNull(target.center),
    scale: finiteOrNull(target.scale),
    source: target.source || null,
    referenceId: target.referenceId || null,
    targetKey: target.targetKey || null,
    analysisVersion: target.analysisVersion || null,
    confidence: finiteOrNull(target.confidence),
  };
}

function shiftHzBySemitones(hz, semitones) {
  const start = finiteOrNull(hz);
  const delta = finiteOrNull(semitones);
  if (start == null || start <= 0 || delta == null) return null;
  return start * (2 ** (delta / 12));
}

function normalizeStepPolicy(policy) {
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) return null;
  const type = String(policy.type || '').trim();
  const max = finiteOrNull(policy.max);
  const policyId = String(policy.policyId || '').trim();
  if (!policyId || max == null || max <= 0) return null;
  if (!['max_native_delta', 'max_semitone_delta', 'max_normalized_distance'].includes(type)) {
    return null;
  }
  return {
    schema: REACHABLE_TARGET_POLICY_SCHEMA,
    policyId,
    policyVersion: String(policy.policyVersion || '1'),
    type,
    max,
  };
}

function targetBoundary(distance) {
  if (!distance || distance.direction === 'target') return null;
  if (distance.direction === 'below') {
    return distance.target.low ?? distance.target.center ?? null;
  }
  if (distance.direction === 'above') {
    return distance.target.high ?? distance.target.center ?? null;
  }
  return null;
}

function nextNativeValue(distance, policy) {
  const current = finiteOrNull(distance?.value);
  const boundary = finiteOrNull(targetBoundary(distance));
  if (current == null || boundary == null || !policy) return null;

  if (policy.type === 'max_semitone_delta') {
    if (distance.unit !== 'Hz' || current <= 0 || boundary <= 0) return null;
    const signedGap = semitonesBetween(current, boundary);
    if (signedGap == null) return null;
    const step = Math.min(Math.abs(signedGap), policy.max);
    const signedStep = distance.direction === 'below' ? step : -step;
    return shiftHzBySemitones(current, signedStep);
  }

  let maxNativeDelta = policy.max;
  if (policy.type === 'max_normalized_distance') {
    const scale = finiteOrNull(distance.target.scale);
    if (scale == null || scale <= 0) return null;
    maxNativeDelta = scale * policy.max;
  }

  if (distance.direction === 'below') {
    return Math.min(boundary, current + maxNativeDelta);
  }
  return Math.max(boundary, current - maxNativeDelta);
}

function insideEnvelope(value, envelope) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return true;
  const number = finiteOrNull(value);
  if (number == null) return false;
  const low = finiteOrNull(envelope.low);
  const high = finiteOrNull(envelope.high);
  if (low != null && number < low) return false;
  if (high != null && number > high) return false;
  return true;
}

/**
 * Derive a learner-reachable next threshold while keeping the aspirational
 * target unchanged and explicit.
 *
 * There is deliberately NO default step size. A caller must supply a named,
 * calibrated policy for the exact metric/dimension. Until such a policy exists
 * the result is `aspirational_only`, so this architecture cannot silently turn
 * an arbitrary engineering constant into learner-facing pedagogy.
 */
function deriveReachableTrainingTarget(rawObservation, {
  stepPolicy = null,
  safetyEnvelope = null,
} = {}) {
  const observation = normalizeObservation(rawObservation);
  const distance = targetDistance(observation);
  const aspirationalTarget = cloneTarget(observation.target);
  const policy = normalizeStepPolicy(stepPolicy);

  const base = {
    schema: TRAINING_TARGET_SCHEMA,
    metricId: observation.metricId,
    dimension: observation.dimension,
    value: observation.value,
    unit: observation.unit,
    aspirationalTarget,
    trainingTarget: null,
    policy,
    status: null,
    direction: distance?.direction || null,
    remainingAspirationalDistance: distance?.absoluteDistance ?? null,
    metadata: {
      targetKey: observation.target?.targetKey || null,
      taskId: observation.taskId || null,
      takeKind: observation.takeKind || null,
      comparisonContextKey: observation.comparisonContextKey || null,
      analysisProfile: observation.analysisProfile || null,
      metricDefinitionVersion: observation.metricDefinitionVersion || null,
    },
  };

  if (!distance || distance.value == null || distance.absoluteDistance == null) {
    return { ...base, status: 'insufficient_target_evidence' };
  }
  if (distance.inTarget) {
    return {
      ...base,
      status: 'already_in_aspirational_target',
      trainingTarget: aspirationalTarget,
    };
  }
  if (!policy) {
    return { ...base, status: 'aspirational_only' };
  }

  const nextValue = nextNativeValue(distance, policy);
  if (nextValue == null) {
    return { ...base, status: 'policy_not_applicable' };
  }
  if (!insideEnvelope(observation.value, safetyEnvelope)
      || !insideEnvelope(nextValue, safetyEnvelope)) {
    return { ...base, status: 'blocked_by_safety_envelope' };
  }

  const trainingTarget = {
    low: distance.direction === 'below' ? nextValue : null,
    high: distance.direction === 'above' ? nextValue : null,
    center: null,
    scale: aspirationalTarget.scale,
    source: aspirationalTarget.source,
    referenceId: aspirationalTarget.referenceId,
    targetKey: aspirationalTarget.targetKey,
    analysisVersion: aspirationalTarget.analysisVersion,
    confidence: aspirationalTarget.confidence,
  };

  return {
    ...base,
    status: 'reachable_step_ready',
    trainingTarget,
    nextThreshold: nextValue,
    stepFromCurrent: distance.unit === 'Hz' && policy.type === 'max_semitone_delta'
      ? Math.abs(semitonesBetween(observation.value, nextValue))
      : Math.abs(nextValue - observation.value),
    stepUnit: policy.type === 'max_semitone_delta' ? 'semitone' : observation.unit,
  };
}

/**
 * Build an alternate observation vector for shadow experiments. Live v3 does
 * not call this yet. Only observations with an explicit reachable-step policy
 * are rewritten; every other observation stays aspirational and is labelled so
 * evaluation can distinguish the two cases.
 */
function applyReachableTrainingTargets(observations, {
  policiesByDimension = {},
  safetyEnvelopesByDimension = {},
} = {}) {
  return (Array.isArray(observations) ? observations : []).map((raw) => {
    const result = deriveReachableTrainingTarget(raw, {
      stepPolicy: policiesByDimension?.[raw?.dimension] || null,
      safetyEnvelope: safetyEnvelopesByDimension?.[raw?.dimension] || null,
    });
    if (result.status !== 'reachable_step_ready') {
      return {
        ...raw,
        metadata: {
          ...(raw?.metadata || {}),
          trainingTargetStatus: result.status,
          trainingTargetApplied: false,
        },
      };
    }
    return {
      ...raw,
      target: result.trainingTarget,
      metadata: {
        ...(raw?.metadata || {}),
        aspirationalTarget: result.aspirationalTarget,
        trainingTargetStatus: result.status,
        trainingTargetApplied: true,
        trainingTargetPolicyId: result.policy.policyId,
        trainingTargetPolicyVersion: result.policy.policyVersion,
      },
    };
  });
}

module.exports = {
  REACHABLE_TARGET_POLICY_SCHEMA,
  TRAINING_TARGET_SCHEMA,
  applyReachableTrainingTargets,
  deriveReachableTrainingTarget,
  normalizeStepPolicy,
  shiftHzBySemitones,
};
