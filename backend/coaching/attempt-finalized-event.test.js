'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createAttemptFinalizedEvent,
  normalizeAttemptFinalizedEvent,
  resolveCanonicalAttemptEvidence,
} = require('./attempt-finalized-event');

function base(overrides = {}) {
  return {
    eventId: 'evt-1',
    sessionId: 'session-1',
    attemptArtifactId: 'attempt-1',
    finalizedAt: 1755400000000,
    expectedSessionRevision: 4,
    analyzerVersion: 'voice-trainer-test',
    detectorPolicyVersion: 'pitch-dev-001',
    eligible: true,
    evidence: {
      selfReport: { effort: 2, pain: false },
      captureEvidence: { usable: true, reasons: [] },
      observations: [],
    },
    ...overrides,
  };
}

test('finalized event is content digested and normalizes losslessly', () => {
  const event = createAttemptFinalizedEvent(base());
  const normalized = normalizeAttemptFinalizedEvent(event);
  assert.equal(normalized.evidenceDigest, event.evidenceDigest);
  assert.equal(normalized.attemptArtifactId, 'attempt-1');
  assert.equal(normalized.expectedSessionRevision, 4);
});

test('tampered evidence cannot retain an old digest', () => {
  const event = createAttemptFinalizedEvent(base());
  const tampered = JSON.parse(JSON.stringify(event));
  tampered.evidence.selfReport.pain = true;
  assert.throws(() => normalizeAttemptFinalizedEvent(tampered), /attempt_evidence_digest_mismatch/);
});

test('identifiers are rejected rather than silently truncated', () => {
  assert.throws(
    () => createAttemptFinalizedEvent(base({ eventId: 'x'.repeat(161) })),
    /event_id_too_long/,
  );
});

test('ineligible finalized attempts require a deterministic reason', () => {
  assert.throws(
    () => createAttemptFinalizedEvent(base({ eligible: false, ineligibleReason: null })),
    /ineligible_reason_required/,
  );
});

test('supplemental self-report fills missing fields but cannot contradict them', () => {
  const merged = resolveCanonicalAttemptEvidence(
    { selfReport: { pain: true }, captureEvidence: { usable: true, reasons: [] }, observations: [] },
    { selfReport: { effort: 2 } },
  );
  assert.equal(merged.selfReport.pain, true);
  assert.equal(merged.selfReport.effort, 2);

  assert.throws(
    () => resolveCanonicalAttemptEvidence(
      { selfReport: { pain: true } },
      { selfReport: { pain: false } },
    ),
    /attempt_evidence_conflict:selfReport\.pain/,
  );
});

test('different non-empty observation surfaces fail closed', () => {
  assert.throws(
    () => resolveCanonicalAttemptEvidence(
      { observations: [{ metricId: 'pitch.median_hz', value: 160 }] },
      { observations: [{ metricId: 'pitch.median_hz', value: 170 }] },
    ),
    /attempt_evidence_conflict:observations/,
  );
});
