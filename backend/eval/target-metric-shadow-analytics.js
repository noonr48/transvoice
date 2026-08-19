'use strict';

const crypto = require('crypto');

const TARGET_METRIC_SHADOW_RECORD_SCHEMA = 'transvoice.target_metric_shadow_record.v1';
const MAX_REASON_COUNT = 12;
const MAX_TOKEN_LENGTH = 120;

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function boundedToken(value, maxLength = MAX_TOKEN_LENGTH) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return text.slice(0, Math.max(1, maxLength));
}

function hashOpaque(value) {
  const text = boundedToken(value, 512);
  if (!text) return null;
  return crypto.createHash('sha256').update(text).digest('hex');
}

function uniqueBoundedTokens(values, maxItems = MAX_REASON_COUNT) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source
    .map((value) => boundedToken(value, 80))
    .filter(Boolean))]
    .slice(0, maxItems);
}

/**
 * Convert the runtime's target-metric shadow witness into a durable evaluation
 * row. This is intentionally a NEW object rather than `{...witness}`: adding a
 * private field to the runtime witness later must not silently expand the eval
 * storage surface.
 */
function sanitizeTargetMetricShadowWitness(witness) {
  if (!witness || typeof witness !== 'object' || Array.isArray(witness)) return null;

  return {
    schema: TARGET_METRIC_SHADOW_RECORD_SCHEMA,
    bridgeSchema: boundedToken(witness.schema, 80),
    mode: boundedToken(witness.mode, 24),
    outcome: boundedToken(witness.outcome, 64),
    focusDimension: boundedToken(witness.focus_dimension, 80),
    focusDirection: boundedToken(witness.focus_direction, 24),
    focusConfidence: finiteOrNull(witness.focus_confidence),
    focusDistance: finiteOrNull(witness.focus_distance),
    cueId: boundedToken(witness.cue_id, 120),
    cueReviewStatus: boundedToken(witness.cue_review_status, 64),
    legacyFocus: boundedToken(witness.legacy_focus, 80),
    existingFocus: boundedToken(witness.existing_focus, 80),
    focusAgreement: typeof witness.focus_agreement === 'boolean'
      ? witness.focus_agreement
      : null,
    targetKeyHash: hashOpaque(witness.target_key),
    targetSource: boundedToken(witness.target_source, 48),
    takeKind: boundedToken(witness.take_kind, 48),
    attemptKeyHash: hashOpaque(witness.attempt_artifact_id),
    fresh: typeof witness.fresh === 'boolean' ? witness.fresh : null,
    measurementUsable: typeof witness.measurement_usable === 'boolean'
      ? witness.measurement_usable
      : null,
    rejectionReasons: uniqueBoundedTokens(witness.rejection_reasons),
    errorCode: boundedToken(witness.error_code, 80),
  };
}

function increment(counter, key) {
  if (!key) return;
  counter[key] = (counter[key] || 0) + 1;
}

function rate(numerator, denominator) {
  return denominator > 0 ? Number((numerator / denominator).toFixed(4)) : null;
}

/**
 * Aggregate privacy-bounded shadow records. Accepts either sanitized shadow
 * rows directly or coaching-eval turn records carrying `targetMetricShadow`.
 * No raw voice state is required and this function never attempts to recreate
 * missing acoustic evidence.
 */
function computeTargetMetricShadowAnalytics(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const records = source
    .map((row) => {
      if (row?.schema === TARGET_METRIC_SHADOW_RECORD_SCHEMA) return row;
      if (row?.targetMetricShadow?.schema === TARGET_METRIC_SHADOW_RECORD_SCHEMA) {
        return row.targetMetricShadow;
      }
      return sanitizeTargetMetricShadowWitness(row?.targetMetricShadow || row?.targetMetricShadowWitness || null);
    })
    .filter(Boolean);

  const outcomes = {};
  const focusDimensions = {};
  const cueIds = {};
  const targetSources = {};
  const takeKinds = {};
  const rejectionReasons = {};
  const errors = {};
  const cueReviewStatuses = {};

  let comparableFocusCount = 0;
  let agreementCount = 0;
  let coachOutcomeCount = 0;
  let measurementUsableCount = 0;
  let freshCount = 0;
  let confidenceSum = 0;
  let confidenceCount = 0;
  let distanceSum = 0;
  let distanceCount = 0;

  for (const record of records) {
    increment(outcomes, record.outcome);
    increment(focusDimensions, record.focusDimension);
    increment(cueIds, record.cueId);
    increment(targetSources, record.targetSource);
    increment(takeKinds, record.takeKind);
    increment(errors, record.errorCode);
    increment(cueReviewStatuses, record.cueReviewStatus);
    for (const reason of record.rejectionReasons || []) increment(rejectionReasons, reason);

    if (record.outcome === 'coach') coachOutcomeCount += 1;
    if (record.measurementUsable === true) measurementUsableCount += 1;
    if (record.fresh === true) freshCount += 1;
    if (typeof record.focusAgreement === 'boolean') {
      comparableFocusCount += 1;
      if (record.focusAgreement) agreementCount += 1;
    }
    if (Number.isFinite(record.focusConfidence)) {
      confidenceSum += record.focusConfidence;
      confidenceCount += 1;
    }
    if (Number.isFinite(record.focusDistance)) {
      distanceSum += record.focusDistance;
      distanceCount += 1;
    }
  }

  return {
    schema: 'transvoice.target_metric_shadow_analytics.v1',
    inputRowCount: source.length,
    witnessCount: records.length,
    witnessCoverageRate: rate(records.length, source.length),
    outcomes,
    focusDimensions,
    cueIds,
    cueReviewStatuses,
    targetSources,
    takeKinds,
    rejectionReasons,
    errors,
    coachOutcomeRate: rate(coachOutcomeCount, records.length),
    measurementUsableRate: rate(measurementUsableCount, records.length),
    freshEvidenceRate: rate(freshCount, records.length),
    focusAgreement: {
      comparableCount: comparableFocusCount,
      agreementCount,
      disagreementCount: comparableFocusCount - agreementCount,
      rate: rate(agreementCount, comparableFocusCount),
    },
    meanFocusConfidence: confidenceCount > 0
      ? Number((confidenceSum / confidenceCount).toFixed(4))
      : null,
    meanFocusDistance: distanceCount > 0
      ? Number((distanceSum / distanceCount).toFixed(4))
      : null,
  };
}

module.exports = {
  TARGET_METRIC_SHADOW_RECORD_SCHEMA,
  computeTargetMetricShadowAnalytics,
  hashOpaque,
  sanitizeTargetMetricShadowWitness,
};
