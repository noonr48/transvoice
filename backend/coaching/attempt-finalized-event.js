'use strict';

const crypto = require('crypto');

const ATTEMPT_FINALIZED_EVENT_SCHEMA = 'transvoice.attempt_finalized.v1';
const MAX_ID_LENGTH = 160;
const MAX_REASON_LENGTH = 120;
const MAX_VERSION_LENGTH = 120;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertBoundedText(value, field, { required = false, maxLength = MAX_ID_LENGTH } = {}) {
  if (value == null || value === '') {
    if (required) throw new Error(`${field}_required`);
    return null;
  }
  if (typeof value !== 'string') throw new Error(`${field}_invalid`);
  const text = value.trim();
  if (!text) {
    if (required) throw new Error(`${field}_required`);
    return null;
  }
  if (text.length > maxLength) throw new Error(`${field}_too_long`);
  return text;
}

function canonicalize(value, path = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}_non_finite`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error(`${path}.${key}_undefined`);
      out[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`${path}_not_json`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(canonicalize(value)));
}

function digestJson(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function normalizeCaptureEvidence(value) {
  const source = isPlainObject(value) ? value : {};
  return {
    usable: source.usable === true,
    reasons: Array.isArray(source.reasons)
      ? [...new Set(source.reasons.map((reason) => String(reason).trim()).filter(Boolean))].slice(0, 16)
      : [],
  };
}

function normalizeAttemptEvidence(value = {}) {
  const source = isPlainObject(value) ? value : {};
  return {
    selfReport: isPlainObject(source.selfReport) ? cloneJson(source.selfReport) : {},
    captureEvidence: normalizeCaptureEvidence(source.captureEvidence),
    observations: Array.isArray(source.observations) ? cloneJson(source.observations) : [],
  };
}

function mergePlainObjectsStrict(primary, supplemental, field) {
  const out = { ...primary };
  for (const [key, value] of Object.entries(supplemental)) {
    if (Object.prototype.hasOwnProperty.call(out, key) && digestJson(out[key]) !== digestJson(value)) {
      throw new Error(`attempt_evidence_conflict:${field}.${key}`);
    }
    if (!Object.prototype.hasOwnProperty.call(out, key)) out[key] = cloneJson(value);
  }
  return out;
}

function mergeEvidence(primary, supplemental) {
  const a = normalizeAttemptEvidence(primary);
  const b = normalizeAttemptEvidence(supplemental);
  const selfReport = mergePlainObjectsStrict(a.selfReport, b.selfReport, 'selfReport');

  const primaryCaptureProvided = isPlainObject(primary?.captureEvidence)
    && Object.keys(primary.captureEvidence).length > 0;
  const supplementalCaptureProvided = isPlainObject(supplemental?.captureEvidence)
    && Object.keys(supplemental.captureEvidence).length > 0;
  let captureEvidence = a.captureEvidence;
  if (!primaryCaptureProvided && supplementalCaptureProvided) {
    captureEvidence = b.captureEvidence;
  } else if (primaryCaptureProvided && supplementalCaptureProvided
    && digestJson(a.captureEvidence) !== digestJson(b.captureEvidence)) {
    throw new Error('attempt_evidence_conflict:captureEvidence');
  }

  const primaryObservationsProvided = Array.isArray(primary?.observations) && primary.observations.length > 0;
  const supplementalObservationsProvided = Array.isArray(supplemental?.observations) && supplemental.observations.length > 0;
  let observations = a.observations;
  if (!primaryObservationsProvided && supplementalObservationsProvided) {
    observations = b.observations;
  } else if (primaryObservationsProvided && supplementalObservationsProvided
    && digestJson(a.observations) !== digestJson(b.observations)) {
    throw new Error('attempt_evidence_conflict:observations');
  }

  return { selfReport, captureEvidence, observations };
}

function createAttemptFinalizedEvent({
  eventId,
  sessionId,
  attemptArtifactId,
  finalizedAt = null,
  expectedSessionRevision = null,
  analyzerVersion = null,
  detectorPolicyVersion = null,
  eligible = false,
  ineligibleReason = null,
  evidence = {},
} = {}) {
  const resolvedEligible = eligible === true;
  const reason = assertBoundedText(ineligibleReason, 'ineligible_reason', {
    required: !resolvedEligible,
    maxLength: MAX_REASON_LENGTH,
  });
  if (resolvedEligible && reason) throw new Error('eligible_attempt_cannot_have_ineligible_reason');

  const normalizedEvidence = normalizeAttemptEvidence(evidence);
  const event = {
    schema: ATTEMPT_FINALIZED_EVENT_SCHEMA,
    eventId: assertBoundedText(eventId, 'event_id', { required: true }),
    sessionId: assertBoundedText(sessionId, 'session_id', { required: true }),
    attemptArtifactId: assertBoundedText(attemptArtifactId, 'attempt_artifact_id', { required: true }),
    finalizedAt: finalizedAt == null ? null : Number(finalizedAt),
    expectedSessionRevision: expectedSessionRevision == null ? null : Number(expectedSessionRevision),
    analyzerVersion: assertBoundedText(analyzerVersion, 'analyzer_version', { maxLength: MAX_VERSION_LENGTH }),
    detectorPolicyVersion: assertBoundedText(detectorPolicyVersion, 'detector_policy_version', { maxLength: MAX_VERSION_LENGTH }),
    eligible: resolvedEligible,
    ineligibleReason: resolvedEligible ? null : reason,
    evidence: normalizedEvidence,
    evidenceDigest: digestJson(normalizedEvidence),
  };
  if (event.finalizedAt != null && !Number.isFinite(event.finalizedAt)) throw new Error('finalized_at_invalid');
  if (event.expectedSessionRevision != null
    && (!Number.isInteger(event.expectedSessionRevision) || event.expectedSessionRevision < 0)) {
    throw new Error('expected_session_revision_invalid');
  }
  return Object.freeze(event);
}

function normalizeAttemptFinalizedEvent(value) {
  if (!isPlainObject(value) || value.schema !== ATTEMPT_FINALIZED_EVENT_SCHEMA) {
    throw new Error('attempt_finalized_event_required');
  }
  const event = createAttemptFinalizedEvent({
    eventId: value.eventId,
    sessionId: value.sessionId,
    attemptArtifactId: value.attemptArtifactId,
    finalizedAt: value.finalizedAt,
    expectedSessionRevision: value.expectedSessionRevision,
    analyzerVersion: value.analyzerVersion,
    detectorPolicyVersion: value.detectorPolicyVersion,
    eligible: value.eligible === true,
    ineligibleReason: value.ineligibleReason,
    evidence: value.evidence,
  });
  if (typeof value.evidenceDigest !== 'string' || value.evidenceDigest !== event.evidenceDigest) {
    throw new Error('attempt_evidence_digest_mismatch');
  }
  return event;
}

function resolveCanonicalAttemptEvidence(finalizedAttempt, turnEvidence) {
  const primary = isPlainObject(finalizedAttempt)
    ? {
      selfReport: finalizedAttempt.selfReport,
      captureEvidence: finalizedAttempt.captureEvidence,
      observations: finalizedAttempt.observations,
    }
    : {};
  return mergeEvidence(primary, isPlainObject(turnEvidence) ? turnEvidence : {});
}

function attemptFromFinalizedEvent(event) {
  const normalized = normalizeAttemptFinalizedEvent(event);
  return {
    attemptArtifactId: normalized.attemptArtifactId,
    eligible: normalized.eligible,
    ineligibleReason: normalized.ineligibleReason,
    selfReport: cloneJson(normalized.evidence.selfReport),
    captureEvidence: cloneJson(normalized.evidence.captureEvidence),
    observations: cloneJson(normalized.evidence.observations),
  };
}

module.exports = {
  ATTEMPT_FINALIZED_EVENT_SCHEMA,
  MAX_ID_LENGTH,
  attemptFromFinalizedEvent,
  createAttemptFinalizedEvent,
  digestJson,
  normalizeAttemptEvidence,
  normalizeAttemptFinalizedEvent,
  resolveCanonicalAttemptEvidence,
};
