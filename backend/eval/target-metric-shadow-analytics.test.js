'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TARGET_METRIC_SHADOW_RECORD_SCHEMA,
  computeTargetMetricShadowAnalytics,
  sanitizeTargetMetricShadowWitness,
} = require('./target-metric-shadow-analytics');

function witness(overrides = {}) {
  return {
    schema: 'transvoice.target_metric_bridge.v2',
    mode: 'shadow',
    outcome: 'coach',
    focus_dimension: 'prosody.phrase_ending',
    focus_direction: 'above',
    focus_confidence: 0.82,
    focus_distance: 1.4,
    cue_id: 'prosody.contour.hum-then-words.v1',
    cue_review_status: 'clinical-review-required',
    legacy_focus: 'phrase_ending',
    existing_focus: 'pitch_floor',
    focus_agreement: false,
    target_key: 'PRIVATE-TARGET-IDENTITY',
    target_source: 'reference',
    take_kind: 'phrase',
    attempt_artifact_id: 'PRIVATE-ATTEMPT-IDENTITY',
    fresh: true,
    measurement_usable: true,
    rejection_reasons: [],
    error_code: null,
    // Deliberately hostile future/accidental fields. None may cross storage.
    transcript: 'PRIVATE LEARNER TRANSCRIPT',
    instruction: 'PRIVATE CUE PROSE',
    raw_observations: [{ secret: 'PRIVATE RAW METRIC' }],
    audio: 'PRIVATE AUDIO BYTES',
    ...overrides,
  };
}

test('durable shadow record is an explicit privacy allowlist, not a witness spread', () => {
  const record = sanitizeTargetMetricShadowWitness(witness());
  assert.equal(record.schema, TARGET_METRIC_SHADOW_RECORD_SCHEMA);
  assert.equal(record.outcome, 'coach');
  assert.equal(record.focusDimension, 'prosody.phrase_ending');
  assert.equal(record.focusAgreement, false);
  assert.equal(record.targetKeyHash.length, 64);
  assert.equal(record.attemptKeyHash.length, 64);
  assert.notEqual(record.targetKeyHash, 'PRIVATE-TARGET-IDENTITY');
  assert.notEqual(record.attemptKeyHash, 'PRIVATE-ATTEMPT-IDENTITY');
  assert.doesNotMatch(
    JSON.stringify(record),
    /PRIVATE|TRANSCRIPT|CUE PROSE|RAW METRIC|AUDIO BYTES/,
  );
  assert.equal(Object.hasOwn(record, 'transcript'), false);
  assert.equal(Object.hasOwn(record, 'instruction'), false);
});

test('rejection reasons are bounded, deduplicated categorical tokens', () => {
  const reasons = Array.from({ length: 30 }, (_, index) => `reason_${index}`);
  const record = sanitizeTargetMetricShadowWitness(witness({
    outcome: 'no_reliable_gap',
    rejection_reasons: ['low_snr', 'low_snr', ...reasons],
  }));
  assert.equal(record.rejectionReasons[0], 'low_snr');
  assert.equal(new Set(record.rejectionReasons).size, record.rejectionReasons.length);
  assert.ok(record.rejectionReasons.length <= 12);
});

test('analytics expose focus, agreement, rejection, and coverage distributions', () => {
  const rows = [
    { targetMetricShadow: sanitizeTargetMetricShadowWitness(witness()) },
    { targetMetricShadow: sanitizeTargetMetricShadowWitness(witness({
      focus_dimension: 'pitch.register',
      cue_id: 'pitch.register.small-glide-up.v1',
      legacy_focus: 'pitch_floor',
      existing_focus: 'pitch_floor',
      focus_agreement: true,
      focus_confidence: 0.9,
      focus_distance: 2,
    })) },
    { targetMetricShadow: sanitizeTargetMetricShadowWitness(witness({
      outcome: 'no_reliable_gap',
      focus_dimension: null,
      cue_id: null,
      focus_agreement: null,
      measurement_usable: false,
      fresh: false,
      rejection_reasons: ['low_snr'],
      focus_confidence: null,
      focus_distance: null,
    })) },
    { signal: { intent: 'legacy-only-turn' } },
  ];

  const analytics = computeTargetMetricShadowAnalytics(rows);
  assert.equal(analytics.inputRowCount, 4);
  assert.equal(analytics.witnessCount, 3);
  assert.equal(analytics.witnessCoverageRate, 0.75);
  assert.equal(analytics.outcomes.coach, 2);
  assert.equal(analytics.outcomes.no_reliable_gap, 1);
  assert.equal(analytics.focusDimensions['prosody.phrase_ending'], 1);
  assert.equal(analytics.focusDimensions['pitch.register'], 1);
  assert.equal(analytics.rejectionReasons.low_snr, 1);
  assert.deepEqual(analytics.focusAgreement, {
    comparableCount: 2,
    agreementCount: 1,
    disagreementCount: 1,
    rate: 0.5,
  });
  assert.equal(analytics.coachOutcomeRate, 0.6667);
  assert.equal(analytics.measurementUsableRate, 0.6667);
  assert.equal(analytics.freshEvidenceRate, 0.6667);
  assert.equal(analytics.meanFocusConfidence, 0.86);
  assert.equal(analytics.meanFocusDistance, 1.7);
});

test('malformed or absent shadow data is ignored rather than synthesized', () => {
  const analytics = computeTargetMetricShadowAnalytics([
    null,
    {},
    { targetMetricShadow: null },
  ]);
  assert.equal(analytics.inputRowCount, 3);
  assert.equal(analytics.witnessCount, 0);
  assert.equal(analytics.witnessCoverageRate, 0);
  assert.equal(analytics.focusAgreement.rate, null);
  assert.equal(analytics.meanFocusConfidence, null);
});
