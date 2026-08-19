'use strict';

const {
  MOTOR_TRIAL_SCHEMA,
  safeObservationSnapshot,
} = require('./motor-trial');
const { comparisonIdentityKey } = require('./metric-observations');
const { CUE_SERVED_EVENT_SCHEMA } = require('./cue-served-lifecycle');
const { SERVABLE_CUE_REVIEW_STATUSES } = require('./feminization-v1-controller');
const { parseFivePoint } = require('./voice-self-report');

const TARGET_METRIC_SESSION_SCHEMA = 'transvoice.target_metric_session_state.v1';
const MAX_PERSISTENCE_DIMENSIONS = 64;
const MAX_PERSISTENCE_COUNT = 1000;
// Serve-window policy must survive the same persistence round-trip as the
// trial itself (R1-002): the acknowledgement window is part of the binding's
// identity, so settlement post-restart enforces the SAME window the live
// event carried.
const SERVE_ACKNOWLEDGEMENT_WINDOW_MS = 10 * 60 * 1000;

/**
 * R1-002 — normalize a cue-serve binding for persistence.
 *
 * GPT-Pro finding 2.1: the trial normalizer previously dropped `cueServe`
 * entirely, so a persisted bound trial lost its serving evidence and
 * settlement skipped the acknowledgement/window checks. Now the binding is
 * REQUIRED to be internally valid: schema, cue id match, servable review
 * status, ordered timestamps, session match. A binding present-but-invalid
 * fails the WHOLE trial closed (returns null) — causality evidence cannot be
 * half-preserved. An absent binding (legacy research trial, cueServe: null)
 * stays absent.
 */
function normalizeCueServeBinding(value, { cueId, sessionId } = {}) {
  if (value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { invalid: true };
  if (value.schema !== CUE_SERVED_EVENT_SCHEMA) return { invalid: true };
  const boundCueId = typeof value.cueId === 'string' ? value.cueId.trim().slice(0, 160) : null;
  const cueReviewStatus = typeof value.cueReviewStatus === 'string'
    ? value.cueReviewStatus.trim().slice(0, 80)
    : null;
  const servedAt = Number.isFinite(value.servedAt) ? value.servedAt : null;
  const acknowledgedAt = Number.isFinite(value.acknowledgedAt) ? value.acknowledgedAt : null;
  const boundSessionId = typeof value.sessionId === 'string' ? value.sessionId.trim().slice(0, 160) : null;
  if (
    !boundCueId
    || !cueReviewStatus
    || !SERVABLE_CUE_REVIEW_STATUSES.includes(cueReviewStatus)
    || servedAt == null
    || acknowledgedAt == null
    || acknowledgedAt < servedAt
    || (cueId != null && boundCueId !== cueId)
    || (sessionId != null && boundSessionId !== null && boundSessionId !== sessionId)
  ) {
    return { invalid: true };
  }
  return {
    schema: CUE_SERVED_EVENT_SCHEMA,
    cueId: boundCueId,
    cueReviewStatus,
    sessionId: boundSessionId,
    servedAt,
    acknowledgedAt,
    acknowledgementWindowMs: Number.isFinite(value.acknowledgementWindowMs)
      && value.acknowledgementWindowMs > 0
      ? value.acknowledgementWindowMs
      : SERVE_ACKNOWLEDGEMENT_WINDOW_MS,
  };
}

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}
function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function boundedCount(value) {
  const number = finiteOrNull(value);
  if (number == null) return 0;
  return Math.max(0, Math.min(MAX_PERSISTENCE_COUNT, Math.floor(number)));
}
function stringArray(values, maxItems = 32) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => textOrNull(value, 120))
    .filter(Boolean))]
    .slice(0, maxItems);
}
function normalizeProtectedRules(value, protectedMetrics) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const allowed = new Set(protectedMetrics);
  const out = {};
  for (const [rawDimension, rawRule] of Object.entries(value)) {
    const dimension = textOrNull(rawDimension, 120);
    if (!dimension || !allowed.has(dimension)) continue;
    if (!rawRule || typeof rawRule !== 'object' || Array.isArray(rawRule)) continue;
    const type = textOrNull(rawRule.type, 64);
    const max = finiteOrNull(rawRule.max);
    if (type === 'max_semitone_delta' && max != null && max > 0 && max <= 24) {
      out[dimension] = { type, max };
    }
  }
  return out;
}

function normalizePendingMotorTrial(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  if (value.schema !== MOTOR_TRIAL_SCHEMA || value.status !== 'pending') return null;

  const trialId = textOrNull(value.trialId, 120);
  const sessionId = textOrNull(value.sessionId, 160);
  const stage = textOrNull(value.stage, 48);
  const cueId = textOrNull(value.cueId, 160);
  const focusDimension = textOrNull(value.focusDimension, 120);
  const focusComparisonKey = textOrNull(value.focusComparisonKey, 1024);
  const beforeAttemptArtifactId = textOrNull(value.beforeAttemptArtifactId, 160);
  if (!trialId || !sessionId || !stage || !cueId || !focusDimension
      || !focusComparisonKey || !beforeAttemptArtifactId) return null;

  const protectedMetrics = stringArray(value.protectedMetrics, 32);
  const beforeObservations = (Array.isArray(value.beforeObservations)
    ? value.beforeObservations : [])
    .map((item) => safeObservationSnapshot(item, {
      fallbackAttemptArtifactId: beforeAttemptArtifactId,
    }))
    .filter(Boolean)
    .filter((item) => item.attemptArtifactId === beforeAttemptArtifactId)
    .slice(0, 16);
  if (!beforeObservations.some((item) => comparisonIdentityKey(item) === focusComparisonKey)) {
    return null;
  }

  const decision = value.decision && typeof value.decision === 'object'
    && !Array.isArray(value.decision)
    ? value.decision
    : null;
  const decisionFocus = decision?.focus || {};
  const decisionAction = decision?.action || {};
  if (decision?.status !== 'coach'
      || textOrNull(decisionFocus.comparisonKey, 1024) !== focusComparisonKey
      || textOrNull(decisionFocus.dimension, 120) !== focusDimension
      || textOrNull(decisionAction.cueId, 160) !== cueId) {
    return null;
  }

  const normalizedDecision = {
    schema: textOrNull(decision.schema, 120),
    engineVersion: textOrNull(decision.engineVersion, 120),
    status: 'coach',
    focus: {
      metricId: textOrNull(decisionFocus.metricId, 160),
      dimension: focusDimension,
      direction: textOrNull(decisionFocus.direction, 32),
      comparisonKey: focusComparisonKey,
      targetKey: textOrNull(decisionFocus.targetKey, 256),
      attemptArtifactId: beforeAttemptArtifactId,
      taskId: textOrNull(decisionFocus.taskId, 160),
      takeKind: textOrNull(decisionFocus.takeKind, 80),
      analysisProfile: textOrNull(decisionFocus.analysisProfile, 80),
    },
    action: {
      cueId,
      reviewStatus: textOrNull(decisionAction.reviewStatus, 80),
      protectedMetrics,
      protectedRules: normalizeProtectedRules(decisionAction.protectedRules, protectedMetrics),
    },
  };

  // R1-002: the cue-serve binding is part of the trial's causal evidence.
  // Present-but-invalid binding -> the whole trial fails closed (null);
  // absent binding (legacy) -> stays null. See normalizeCueServeBinding.
  const cueServeBinding = normalizeCueServeBinding(value.cueServe, {
    cueId,
    sessionId,
  });
  if (cueServeBinding && cueServeBinding.invalid) return null;

  return {
    schema: MOTOR_TRIAL_SCHEMA,
    trialId,
    status: 'pending',
    sessionId,
    issuedAt: finiteOrNull(value.issuedAt),
    stage,
    cueId,
    cueReviewStatus: textOrNull(value.cueReviewStatus, 80),
    focusDimension,
    focusComparisonKey,
    targetKey: textOrNull(value.targetKey, 256),
    beforeAttemptArtifactId,
    taskId: textOrNull(value.taskId, 160),
    takeKind: textOrNull(value.takeKind, 80),
    analysisProfile: textOrNull(value.analysisProfile, 80),
    protectedMetrics,
    protectedRules: normalizeProtectedRules(value.protectedRules, protectedMetrics),
    effortBefore: parseFivePoint(value.effortBefore),
    strainBefore: parseFivePoint(value.strainBefore),
    fatigueBefore: parseFivePoint(value.fatigueBefore),
    discomfortBefore: parseFivePoint(value.discomfortBefore),
    painBefore: value.painBefore === true,
    beforeObservations,
    decision: normalizedDecision,
    cueServe: cueServeBinding,
    // R1-003 ordinal binding (null for legacy trials):
    baselineAttemptOrdinal: Number.isFinite(value.baselineAttemptOrdinal)
      ? value.baselineAttemptOrdinal
      : null,
    attemptSequenceBound: value.attemptSequenceBound === true,
    candidatePolicy: {
      consumeNextFinalizedAttempt: true,
      allowSkipToLaterAttempt: false,
    },
  };
}

function normalizePersistenceByDimension(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out = {};
  for (const [rawDimension, rawCount] of Object.entries(value).slice(0, MAX_PERSISTENCE_DIMENSIONS)) {
    const dimension = textOrNull(rawDimension, 120);
    if (!dimension || Object.prototype.hasOwnProperty.call(out, dimension)) continue;
    const count = boundedCount(rawCount);
    if (count > 0) out[dimension] = count;
  }
  return out;
}

function buildDefaultTargetMetricSessionState() {
  return {
    schema: TARGET_METRIC_SESSION_SCHEMA,
    targetKey: null,
    pendingTrial: null,
    persistenceByDimension: {},
  };
}

function normalizeTargetMetricSessionState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return buildDefaultTargetMetricSessionState();
  }
  return {
    schema: TARGET_METRIC_SESSION_SCHEMA,
    targetKey: textOrNull(value.targetKey, 256),
    pendingTrial: normalizePendingMotorTrial(value.pendingTrial),
    persistenceByDimension: normalizePersistenceByDimension(value.persistenceByDimension),
  };
}

function bindTargetMetricSessionStateToTarget(value, targetKey) {
  const normalized = normalizeTargetMetricSessionState(value);
  const key = textOrNull(targetKey, 256);
  if (normalized.targetKey && key && normalized.targetKey !== key) {
    return {
      schema: TARGET_METRIC_SESSION_SCHEMA,
      targetKey: key,
      pendingTrial: null,
      persistenceByDimension: {},
    };
  }
  return { ...normalized, targetKey: key || normalized.targetKey };
}

module.exports = {
  MAX_PERSISTENCE_COUNT,
  MAX_PERSISTENCE_DIMENSIONS,
  SERVE_ACKNOWLEDGEMENT_WINDOW_MS,
  TARGET_METRIC_SESSION_SCHEMA,
  bindTargetMetricSessionStateToTarget,
  buildDefaultTargetMetricSessionState,
  normalizeCueServeBinding,
  normalizePendingMotorTrial,
  normalizePersistenceByDimension,
  normalizeTargetMetricSessionState,
};
