'use strict';

const crypto = require('crypto');
const {
  ATTEMPT_FINALIZED_EVENT_SCHEMA,
  createAttemptFinalizedEvent,
  normalizeAttemptFinalizedEvent,
} = require('./attempt-finalized-event');

const ATTEMPT_FINALIZED_PUBLISHER_SCHEMA = 'transvoice.attempt_finalized_publisher.v1';
const MAX_ID_LENGTH = 160;

function strictId(value, field) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}_required`);
  const text = value.trim();
  if (text.length > MAX_ID_LENGTH) throw new Error(`${field}_too_long`);
  return text;
}

function buildAttemptFinalizedEventId({ sessionId, attemptArtifactId } = {}) {
  const session = strictId(sessionId, 'session_id');
  const artifact = strictId(attemptArtifactId, 'attempt_artifact_id');
  const digest = crypto.createHash('sha256')
    .update(JSON.stringify(['attempt-finalized', session, artifact]))
    .digest('hex');
  return `afe:${digest.slice(0, 48)}`;
}

function digestNormalizedEvent(event) {
  const normalized = normalizeAttemptFinalizedEvent(event);
  return crypto.createHash('sha256')
    .update(JSON.stringify(normalized))
    .digest('hex');
}

function publishAttemptFinalizedEvent({
  sessionId,
  attemptArtifactId,
  finalizedAt,
  expectedSessionRevision = null,
  analyzerVersion = null,
  detectorPolicyVersion = null,
  eligible = false,
  ineligibleReason = null,
  selfReport = {},
  captureEvidence = {},
  observations = [],
} = {}) {
  const resolvedSessionId = strictId(sessionId, 'session_id');
  const resolvedArtifactId = strictId(attemptArtifactId, 'attempt_artifact_id');
  const event = createAttemptFinalizedEvent({
    eventId: buildAttemptFinalizedEventId({
      sessionId: resolvedSessionId,
      attemptArtifactId: resolvedArtifactId,
    }),
    sessionId: resolvedSessionId,
    attemptArtifactId: resolvedArtifactId,
    finalizedAt,
    expectedSessionRevision,
    analyzerVersion,
    detectorPolicyVersion,
    eligible,
    ineligibleReason,
    evidence: {
      selfReport,
      captureEvidence,
      observations,
    },
  });

  return Object.freeze({
    schema: ATTEMPT_FINALIZED_PUBLISHER_SCHEMA,
    event,
    eventId: event.eventId,
    evidenceDigest: event.evidenceDigest,
    eventDigest: digestNormalizedEvent(event),
  });
}

function reconcileAttemptFinalizedPublication(previousEvent, candidateEvent) {
  const previous = normalizeAttemptFinalizedEvent(previousEvent);
  const candidate = normalizeAttemptFinalizedEvent(candidateEvent);
  if (previous.eventId !== candidate.eventId) {
    return Object.freeze({ status: 'different_event', event: candidate });
  }
  if (previous.attemptArtifactId !== candidate.attemptArtifactId
    || previous.sessionId !== candidate.sessionId) {
    throw new Error('attempt_finalized_identity_conflict');
  }
  if (digestNormalizedEvent(previous) !== digestNormalizedEvent(candidate)) {
    throw new Error('attempt_finalized_content_conflict');
  }
  return Object.freeze({ status: 'already_published', event: previous });
}

module.exports = {
  ATTEMPT_FINALIZED_EVENT_SCHEMA,
  ATTEMPT_FINALIZED_PUBLISHER_SCHEMA,
  buildAttemptFinalizedEventId,
  digestNormalizedEvent,
  publishAttemptFinalizedEvent,
  reconcileAttemptFinalizedPublication,
};
