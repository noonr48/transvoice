'use strict';

const METRIC_OBSERVATION_SCHEMA = 'transvoice.metric_observation.v2';
const INVALIDATING_FLAGS = new Set([
  'measurement_unavailable',
  'no_voiced_frames',
  'low_snr',
  'sustained_clipping',
  'low_score_confidence',
  'low_voiced_coverage',
  'low_confident_coverage',
  'low_capture_reliability',
  'segmentation_failed',
  'target_not_comparable',
  'context_not_comparable',
  'analysis_version_mismatch',
  'analysis_profile_no_formants',
  'missing_measurement_confidence',
  'stale_take',
]);
const DEFAULT_MIN_CONFIDENCE = 0.55;

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function clamp01(value) {
  const number = finiteOrNull(value);
  if (number == null) return null;
  return Math.max(0, Math.min(1, number));
}
function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}
function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}
function semitonesBetween(fromHz, toHz) {
  const from = finiteOrNull(fromHz);
  const to = finiteOrNull(toHz);
  if (from == null || to == null || from <= 0 || to <= 0) return null;
  return 12 * Math.log2(to / from);
}
function combineConfidence(confidence = {}) {
  const values = [
    confidence.overall,
    confidence.signal,
    confidence.segmentation,
    confidence.extractor,
    confidence.target,
  ].map(clamp01).filter((value) => value != null);
  return values.length ? Math.min(...values) : 0;
}
function normalizeTarget(target = {}) {
  const low = finiteOrNull(target.low);
  const high = finiteOrNull(target.high);
  const center = finiteOrNull(target.center);
  const scale = finiteOrNull(target.scale);
  return {
    low,
    high,
    center,
    scale: scale != null && scale > 0 ? scale : null,
    source: textOrNull(target.source),
    referenceId: textOrNull(target.referenceId),
    targetKey: textOrNull(target.targetKey),
    analysisVersion: textOrNull(target.analysisVersion),
    confidence: clamp01(target.confidence),
  };
}
function comparisonIdentityParts(observation) {
  return [
    observation.metricId,
    observation.dimension,
    observation.target?.targetKey || '',
    observation.taskId || '',
    observation.takeKind || '',
    observation.phoneme || '',
    observation.word || '',
    observation.contextKind || '',
    observation.comparisonContextKey || '',
    observation.analysisProfile || '',
    observation.metricDefinitionVersion || '',
  ];
}
function comparisonIdentityKey(observation) {
  if (!observation) return null;
  return comparisonIdentityParts(observation).map((part) => String(part ?? '')).join('|');
}
function observationIdentityKey(observation) {
  if (!observation) return null;
  return `${comparisonIdentityKey(observation)}|${observation.attemptArtifactId || ''}`;
}
function normalizeObservation(raw = {}) {
  const confidence = raw && typeof raw.confidence === 'object' && !Array.isArray(raw.confidence)
    ? raw.confidence
    : {};
  const target = normalizeTarget(raw.target || {});
  const metadata = raw.metadata && typeof raw.metadata === 'object' && !Array.isArray(raw.metadata)
    ? { ...raw.metadata }
    : {};
  const observationTargetConfidence = clamp01(confidence.target);
  const declaredTargetConfidence = clamp01(target.confidence);
  const effectiveTargetConfidence = observationTargetConfidence != null && declaredTargetConfidence != null
    ? Math.min(observationTargetConfidence, declaredTargetConfidence)
    : (observationTargetConfidence ?? declaredTargetConfidence);
  const observation = {
    schema: METRIC_OBSERVATION_SCHEMA,
    metricId: String(raw.metricId || raw.dimension || '').trim(),
    metricDefinitionVersion: textOrNull(raw.metricDefinitionVersion) || 'v1',
    dimension: String(raw.dimension || raw.metricId || '').trim(),
    value: finiteOrNull(raw.value),
    unit: String(raw.unit || 'unitless'),
    timestampStartMs: finiteOrNull(raw.timestampStartMs),
    timestampEndMs: finiteOrNull(raw.timestampEndMs),
    phoneme: textOrNull(raw.phoneme),
    word: textOrNull(raw.word),
    utteranceId: textOrNull(raw.utteranceId),
    contextKind: textOrNull(raw.contextKind),
    comparisonContextKey: textOrNull(raw.comparisonContextKey || metadata.comparisonContextKey),
    sourceKind: textOrNull(raw.sourceKind) || 'measured',
    attemptArtifactId: textOrNull(raw.attemptArtifactId),
    taskId: textOrNull(raw.taskId),
    takeKind: textOrNull(raw.takeKind),
    analysisProfile: textOrNull(raw.analysisProfile),
    confidence: {
      overall: clamp01(confidence.overall),
      signal: clamp01(confidence.signal),
      segmentation: clamp01(confidence.segmentation),
      extractor: clamp01(confidence.extractor),
      target: effectiveTargetConfidence,
    },
    target,
    flags: uniqueStrings(raw.flags),
    persistenceCount: Math.max(1, Math.floor(finiteOrNull(raw.persistenceCount) || 1)),
    importance: clamp01(raw.importance) ?? 0.5,
    controllability: clamp01(raw.controllability) ?? 0.5,
    metadata,
  };
  observation.effectiveConfidence = combineConfidence(observation.confidence);
  observation.comparisonKey = comparisonIdentityKey(observation);
  observation.observationKey = observationIdentityKey(observation);
  return observation;
}
function targetDistance(rawObservation) {
  const observation = normalizeObservation(rawObservation);
  const value = observation.value;
  const { low, high, center, scale } = observation.target;
  if (value == null) return null;
  let signedNative = null;
  let direction = 'target';
  if (low != null && high != null && high > low) {
    if (value < low) {
      signedNative = value - low;
      direction = 'below';
    } else if (value > high) {
      signedNative = value - high;
      direction = 'above';
    } else {
      signedNative = 0;
    }
  } else if (low != null && high == null) {
    if (value < low) {
      signedNative = value - low;
      direction = 'below';
    } else {
      signedNative = 0;
    }
  } else if (high != null && low == null) {
    if (value > high) {
      signedNative = value - high;
      direction = 'above';
    } else {
      signedNative = 0;
    }
  } else if (center != null) {
    signedNative = value - center;
    direction = signedNative < 0 ? 'below' : signedNative > 0 ? 'above' : 'target';
  } else {
    return null;
  }

  let signedDistance = null;
  if (observation.metadata.targetScaleUnit === 'semitone' && observation.unit === 'Hz') {
    let delta = 0;
    if (direction === 'below' && low != null) delta = semitonesBetween(low, value);
    else if (direction === 'above' && high != null) delta = semitonesBetween(high, value);
    else if (center != null && direction !== 'target') delta = semitonesBetween(center, value);
    if (delta == null) return null;
    signedDistance = scale != null ? delta / scale : delta;
  } else {
    const resolvedScale = scale ?? (
      low != null && high != null && high > low ? (high - low) / 2 : null
    );
    if (resolvedScale == null || resolvedScale <= 0) return null;
    signedDistance = signedNative / resolvedScale;
  }

  return {
    ...observation,
    direction,
    signedNativeDelta: signedNative,
    signedDistance,
    absoluteDistance: Math.abs(signedDistance),
    inTarget: direction === 'target',
  };
}
function invalidatingFlags(observation) {
  const normalized = normalizeObservation(observation);
  return normalized.flags.filter((flag) => INVALIDATING_FLAGS.has(flag));
}
function isUsableObservation(observation, { minConfidence = DEFAULT_MIN_CONFIDENCE } = {}) {
  const distance = targetDistance(observation);
  return Boolean(
    distance
    && distance.value != null
    && distance.absoluteDistance != null
    && distance.effectiveConfidence >= minConfidence
    && invalidatingFlags(distance).length === 0
  );
}
function rankableObservations(observations, options = {}) {
  return (Array.isArray(observations) ? observations : [])
    .map(targetDistance)
    .filter(Boolean)
    .filter((observation) => isUsableObservation(observation, options))
    .map((observation) => ({
      ...observation,
      priority: observation.absoluteDistance
        * observation.effectiveConfidence
        * (0.5 + observation.importance)
        * (0.5 + observation.controllability),
    }))
    .sort((a, b) => b.priority - a.priority);
}

module.exports = {
  DEFAULT_MIN_CONFIDENCE,
  INVALIDATING_FLAGS,
  METRIC_OBSERVATION_SCHEMA,
  combineConfidence,
  comparisonIdentityKey,
  invalidatingFlags,
  isUsableObservation,
  normalizeObservation,
  observationIdentityKey,
  rankableObservations,
  semitonesBetween,
  targetDistance,
};
