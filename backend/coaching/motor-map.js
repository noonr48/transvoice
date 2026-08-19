'use strict';

const {
  comparisonIdentityKey,
  isUsableObservation,
  normalizeObservation,
  semitonesBetween,
  targetDistance,
} = require('./metric-observations');

const MOTOR_MAP_SCHEMA = 'transvoice.motor_map.v2';
const LEGACY_MOTOR_MAP_SCHEMA = 'transvoice.motor_map.v1';
const MAX_MOTOR_MAP_CUES = 128;
const MAX_MOTOR_MAP_DIMENSIONS_PER_CUE = 64;
const MAX_MOTOR_MAP_COUNT = 1_000_000;

function emptyMotorMap() {
  return { schema: MOTOR_MAP_SCHEMA, byCue: {} };
}
function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function boundedText(value, maxLength) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : '';
}
function boundedCount(value, max = MAX_MOTOR_MAP_COUNT) {
  const number = finiteOrNull(value);
  if (number == null) return 0;
  return Math.max(0, Math.min(max, Math.floor(number)));
}
function boundedMean(value, min, max) {
  const number = finiteOrNull(value);
  if (number == null) return 0;
  return Math.max(min, Math.min(max, number));
}
function normalizeDimensionState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const attempts = boundedCount(source.attempts);
  return {
    attempts,
    successes: Math.min(attempts, boundedCount(source.successes)),
    verifiedFailures: Math.min(attempts, boundedCount(source.verifiedFailures)),
    meanTargetGain: boundedMean(source.meanTargetGain, -100, 100),
    meanVerifiedTargetGain: boundedMean(source.meanVerifiedTargetGain, -100, 100),
    verifiedGainObservations: Math.min(attempts, boundedCount(source.verifiedGainObservations)),
  };
}
function normalizeCueState(value) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const attempts = boundedCount(source.attempts);
  const byDimension = {};
  const dimensionEntries = source.byDimension && typeof source.byDimension === 'object'
    && !Array.isArray(source.byDimension)
    ? Object.entries(source.byDimension)
    : [];
  for (const [rawDimension, state] of dimensionEntries.slice(0, MAX_MOTOR_MAP_DIMENSIONS_PER_CUE)) {
    const dimension = boundedText(rawDimension, 120);
    if (!dimension || Object.prototype.hasOwnProperty.call(byDimension, dimension)) continue;
    byDimension[dimension] = normalizeDimensionState(state);
  }
  return {
    attempts,
    successes: Math.min(attempts, boundedCount(source.successes)),
    verifiedFailures: Math.min(attempts, boundedCount(source.verifiedFailures)),
    confounded: Math.min(attempts, boundedCount(source.confounded)),
    partialEvidence: Math.min(attempts, boundedCount(source.partialEvidence)),
    meanTargetGain: boundedMean(source.meanTargetGain, -100, 100),
    meanVerifiedTargetGain: boundedMean(source.meanVerifiedTargetGain, -100, 100),
    verifiedGainObservations: Math.min(attempts, boundedCount(source.verifiedGainObservations)),
    meanProtectedDrift: boundedMean(source.meanProtectedDrift, 0, 100),
    protectedObservations: Math.min(attempts * MAX_MOTOR_MAP_DIMENSIONS_PER_CUE, boundedCount(source.protectedObservations)),
    missingProtectedEvidence: boundedCount(source.missingProtectedEvidence),
    meanEffortDelta: boundedMean(source.meanEffortDelta, -10, 10),
    effortObservations: Math.min(attempts, boundedCount(source.effortObservations)),
    byDimension,
  };
}
function normalizeMotorMap(map) {
  if (!map || typeof map !== 'object' || Array.isArray(map)) return emptyMotorMap();
  if (map.schema != null && ![MOTOR_MAP_SCHEMA, LEGACY_MOTOR_MAP_SCHEMA].includes(map.schema)) {
    return emptyMotorMap();
  }
  const source = map.byCue && typeof map.byCue === 'object' && !Array.isArray(map.byCue)
    ? map.byCue
    : {};
  const byCue = {};
  for (const [rawCueId, state] of Object.entries(source).slice(0, MAX_MOTOR_MAP_CUES)) {
    const cueId = boundedText(rawCueId, 160);
    if (!cueId || Object.prototype.hasOwnProperty.call(byCue, cueId)) continue;
    byCue[cueId] = normalizeCueState(state);
  }
  return { schema: MOTOR_MAP_SCHEMA, byCue };
}
function cloneMap(map) {
  return normalizeMotorMap(map);
}
function runningMean(previousMean, previousCount, nextValue) {
  return ((previousMean || 0) * previousCount + nextValue) / (previousCount + 1);
}
function normalizedByDimension(observations, dimension) {
  return (Array.isArray(observations) ? observations : [])
    .map(normalizeObservation)
    .filter((item) => item.dimension === dimension);
}
function comparableObservationPair(beforeObservations, afterObservations, dimension) {
  const beforeItems = normalizedByDimension(beforeObservations, dimension);
  const afterItems = normalizedByDimension(afterObservations, dimension);
  for (const before of beforeItems) {
    const key = comparisonIdentityKey(before);
    const after = afterItems.find((candidate) => comparisonIdentityKey(candidate) === key);
    if (after) return { before, after };
  }
  return null;
}
function classifyVerification(result) {
  const value = typeof result === 'string' ? result : '';
  return {
    success: value === 'worked_verified',
    failure: ['confounded', 'cost_too_high', 'moved_wrong_way'].includes(value),
    confounded: value === 'confounded',
    partial: value === 'movement_observed_partial',
  };
}

function recordCueOutcome(map, {
  cueId,
  focusDimension,
  beforeObservations,
  afterObservations,
  protectedDimensions = [],
  protectedRules = {},
  effortBefore = null,
  effortAfter = null,
  verification = null,
} = {}) {
  const next = cloneMap(map);
  if (!cueId || !focusDimension) return next;
  if (verification && verification.status !== 'verified') return next;

  const focusPair = comparableObservationPair(
    beforeObservations,
    afterObservations,
    focusDimension,
  );
  if (!focusPair
    || !isUsableObservation(focusPair.before)
    || !isUsableObservation(focusPair.after)) {
    return next;
  }
  const before = targetDistance(focusPair.before);
  const after = targetDistance(focusPair.after);
  if (!before || !after) return next;
  const targetGain = before.absoluteDistance - after.absoluteDistance;

  let protectedDrift = 0;
  let protectedCount = 0;
  let protectedMissing = 0;
  for (const dimension of protectedDimensions) {
    if (dimension === 'safety.effort') continue;
    const pair = comparableObservationPair(beforeObservations, afterObservations, dimension);
    if (!pair) {
      protectedMissing += 1;
      continue;
    }
    const rule = protectedRules[dimension] || null;
    if (rule?.type === 'max_semitone_delta') {
      const delta = semitonesBetween(pair.before.value, pair.after.value);
      const max = finiteOrNull(rule.max);
      if (delta == null || max == null || max <= 0) {
        protectedMissing += 1;
        continue;
      }
      protectedDrift += Math.max(0, Math.abs(delta) - max) / max;
      protectedCount += 1;
      continue;
    }
    const b = targetDistance(pair.before);
    const a = targetDistance(pair.after);
    if (!b || !a) {
      protectedMissing += 1;
      continue;
    }
    protectedDrift += Math.max(0, a.absoluteDistance - b.absoluteDistance);
    protectedCount += 1;
  }
  protectedDrift = protectedCount ? protectedDrift / protectedCount : 0;

  const effort0 = finiteOrNull(effortBefore);
  const effort1 = finiteOrNull(effortAfter);
  const effortProtected = protectedDimensions.includes('safety.effort');
  const effortKnown = effort0 != null && effort1 != null;
  const effortDelta = effortKnown ? effort1 - effort0 : null;
  if (effortProtected && !effortKnown) protectedMissing += 1;

  const current = next.byCue[cueId] || normalizeCueState({});
  const attemptCount = current.attempts;
  current.meanTargetGain = runningMean(current.meanTargetGain, attemptCount, targetGain);
  current.attempts += 1;

  if (protectedCount > 0) {
    current.meanProtectedDrift = runningMean(
      current.meanProtectedDrift,
      current.protectedObservations || 0,
      protectedDrift,
    );
    current.protectedObservations = (current.protectedObservations || 0) + 1;
  }
  current.missingProtectedEvidence = (current.missingProtectedEvidence || 0) + protectedMissing;
  if (effortKnown) {
    current.meanEffortDelta = runningMean(
      current.meanEffortDelta,
      current.effortObservations || 0,
      effortDelta,
    );
    current.effortObservations = (current.effortObservations || 0) + 1;
  }

  const verificationClass = verification
    ? classifyVerification(verification.result)
    : {
      success: targetGain > 0
        && protectedMissing === 0
        && protectedDrift <= 0.1
        && (!effortProtected || (effortKnown && effortDelta <= 0)),
      failure: false,
      confounded: false,
      partial: protectedMissing > 0,
    };

  if (verificationClass.success) {
    current.successes += 1;
    current.meanVerifiedTargetGain = runningMean(
      current.meanVerifiedTargetGain,
      current.verifiedGainObservations || 0,
      targetGain,
    );
    current.verifiedGainObservations = (current.verifiedGainObservations || 0) + 1;
  }
  if (verificationClass.failure) current.verifiedFailures = (current.verifiedFailures || 0) + 1;
  if (verificationClass.confounded) current.confounded = (current.confounded || 0) + 1;
  if (verificationClass.partial) current.partialEvidence = (current.partialEvidence || 0) + 1;

  const dimensionState = current.byDimension[focusDimension] || normalizeDimensionState({});
  dimensionState.meanTargetGain = runningMean(
    dimensionState.meanTargetGain,
    dimensionState.attempts,
    targetGain,
  );
  dimensionState.attempts += 1;
  if (verificationClass.success) {
    dimensionState.successes += 1;
    dimensionState.meanVerifiedTargetGain = runningMean(
      dimensionState.meanVerifiedTargetGain,
      dimensionState.verifiedGainObservations || 0,
      targetGain,
    );
    dimensionState.verifiedGainObservations = (dimensionState.verifiedGainObservations || 0) + 1;
  }
  if (verificationClass.failure) {
    dimensionState.verifiedFailures = (dimensionState.verifiedFailures || 0) + 1;
  }
  current.byDimension[focusDimension] = dimensionState;
  next.byCue[cueId] = current;
  return normalizeMotorMap(next);
}

function cueEffectMultiplier(map, cueId, focusDimension) {
  const normalized = normalizeMotorMap(map);
  const state = normalized.byCue?.[cueId] || null;
  if (!state || !state.attempts) return 1;
  const dimensionState = state.byDimension?.[focusDimension];

  // Only causally VERIFIED gains are allowed to raise a cue's prior. A raw
  // acoustic gain from a confounded/partial trial remains useful telemetry but
  // cannot teach the selector that the cue works.
  const verifiedGain = finiteOrNull(dimensionState?.meanVerifiedTargetGain)
    ?? finiteOrNull(state.meanVerifiedTargetGain)
    ?? 0;
  const verifiedGainCount = finiteOrNull(dimensionState?.verifiedGainObservations)
    ?? finiteOrNull(state.verifiedGainObservations)
    ?? 0;
  const drift = Math.max(0, finiteOrNull(state.meanProtectedDrift) ?? 0);
  const effort = Math.max(0, finiteOrNull(state.meanEffortDelta) ?? 0);
  const successRate = state.successes / Math.max(1, state.attempts);
  const failureRate = (finiteOrNull(state.verifiedFailures) ?? 0) / Math.max(1, state.attempts);
  const confoundRate = (finiteOrNull(state.confounded) ?? 0) / Math.max(1, state.attempts);
  const partialRate = (finiteOrNull(state.partialEvidence) ?? 0) / Math.max(1, state.attempts);
  const missingRate = Math.min(1,
    (finiteOrNull(state.missingProtectedEvidence) ?? 0) / Math.max(1, state.attempts));

  const gainTerm = verifiedGainCount > 0
    ? Math.max(-0.6, Math.min(0.6, verifiedGain * 0.35))
    : 0;
  const successTerm = (successRate - 0.5) * 0.3;
  const penalty = Math.min(
    0.9,
    drift * 0.25
      + effort * 0.12
      + missingRate * 0.12
      + failureRate * 0.35
      + confoundRate * 0.25
      + partialRate * 0.08,
  );
  return Math.max(0.35, Math.min(1.65, 1 + gainTerm + successTerm - penalty));
}

module.exports = {
  MAX_MOTOR_MAP_CUES,
  MAX_MOTOR_MAP_DIMENSIONS_PER_CUE,
  MOTOR_MAP_SCHEMA,
  cueEffectMultiplier,
  emptyMotorMap,
  normalizeMotorMap,
  recordCueOutcome,
};
