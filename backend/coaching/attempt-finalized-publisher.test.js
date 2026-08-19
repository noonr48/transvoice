'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildAttemptFinalizedEventId,
  publishAttemptFinalizedEvent,
  reconcileAttemptFinalizedPublication,
} = require('./attempt-finalized-publisher');

function publish(overrides = {}) {
  return publishAttemptFinalizedEvent({
    sessionId: 'session-1',
    attemptArtifactId: 'attempt-1',
    finalizedAt: 1755400000000,
    expectedSessionRevision: 4,
    analyzerVersion: 'voice-trainer-test',
    detectorPolicyVersion: 'pitch-dev-001',
    eligible: true,
    selfReport: { effort: 2, pain: false },
    captureEvidence: { usable: true, reasons: [] },
    observations: [],
    ...overrides,
  });
}

test('publisher creates a stable event identity from session plus attempt artifact', () => {
  const first = publish();
  const second = publish({ finalizedAt: 1755400005000 });
  assert.equal(first.eventId, second.eventId);
  assert.equal(first.eventId, buildAttemptFinalizedEventId({
    sessionId: 'session-1', attemptArtifactId: 'attempt-1',
  }));
  assert.match(first.eventId, /^afe:[0-9a-f]{48}$/);
});

test('same finalized attempt content reconciles idempotently', () => {
  const first = publish().event;
  const second = publish().event;
  const result = reconcileAttemptFinalizedPublication(first, second);
  assert.equal(result.status, 'already_published');
  assert.equal(result.event.evidenceDigest, first.evidenceDigest);
});

test('same artifact identity with changed evidence fails closed', () => {
  const first = publish().event;
  const changed = publish({ selfReport: { effort: 4, pain: false } }).event;
  assert.equal(first.eventId, changed.eventId);
  assert.notEqual(first.evidenceDigest, changed.evidenceDigest);
  assert.throws(
    () => reconcileAttemptFinalizedPublication(first, changed),
    /attempt_finalized_content_conflict/,
  );
});

test('different artifact gets a different stable event identity', () => {
  const first = publish().event;
  const second = publish({ attemptArtifactId: 'attempt-2' }).event;
  const result = reconcileAttemptFinalizedPublication(first, second);
  assert.equal(result.status, 'different_event');
  assert.notEqual(first.eventId, second.eventId);
});

test('publisher rejects oversize identity rather than truncating it', () => {
  assert.throws(
    () => publish({ attemptArtifactId: 'x'.repeat(161) }),
    /attempt_artifact_id_too_long/,
  );
});

test('capture-invalid publication requires the deterministic ineligible reason', () => {
  assert.throws(
    () => publish({ eligible: false, ineligibleReason: null }),
    /ineligible_reason_required/,
  );
  const publication = publish({
    eligible: false,
    ineligibleReason: 'capture_low_snr',
    captureEvidence: { usable: false, reasons: ['low_snr'] },
  });
  assert.equal(publication.event.eligible, false);
  assert.equal(publication.event.ineligibleReason, 'capture_low_snr');
});
