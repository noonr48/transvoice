'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createTurnRecord } = require('./coaching-eval');
const { TARGET_METRIC_SHADOW_RECORD_SCHEMA } = require('./target-metric-shadow-analytics');

function privateWitness() {
  return {
    schema: 'transvoice.target_metric_bridge.v2',
    mode: 'shadow',
    outcome: 'coach',
    focus_dimension: 'pitch.register',
    focus_direction: 'below',
    focus_confidence: 0.88,
    focus_distance: 2.1,
    cue_id: 'pitch.register.small-glide-up.v1',
    cue_review_status: 'clinical-review-required',
    legacy_focus: 'pitch_floor',
    existing_focus: 'pitch_floor',
    focus_agreement: true,
    target_key: 'PRIVATE TARGET KEY',
    target_source: 'reference',
    take_kind: 'phrase',
    attempt_artifact_id: 'PRIVATE ATTEMPT ID',
    fresh: true,
    measurement_usable: true,
    rejection_reasons: [],
    transcript: 'PRIVATE LEARNER TRANSCRIPT',
    instruction: 'PRIVATE CUE WORDING',
    observations: [{ private: 'PRIVATE RAW OBSERVATION' }],
  };
}

test('coaching eval persists only the sanitized target-metric shadow record', () => {
  const record = createTurnRecord({
    studentId: 'student-private',
    sessionId: 'session-private',
    turnIndex: 1,
    signal: {
      mode: 'active_drill',
      policy: { shouldCorrect: true, safetyState: 'normal', avoidTopics: [] },
      capture: { reliability: 'good' },
      coachMove: { intent: 'coach' },
    },
    userMessage: 'PRIVATE USER MESSAGE',
    rawReply: 'PRIVATE RAW REPLY',
    sanitizedReply: 'PRIVATE SAFE REPLY',
    targetMetricShadowWitness: privateWitness(),
  });

  assert.equal(record.targetMetricShadow.schema, TARGET_METRIC_SHADOW_RECORD_SCHEMA);
  assert.equal(record.targetMetricShadow.focusDimension, 'pitch.register');
  assert.equal(record.targetMetricShadow.focusAgreement, true);
  assert.equal(record.targetMetricShadow.targetKeyHash.length, 64);
  assert.equal(record.targetMetricShadow.attemptKeyHash.length, 64);
  assert.doesNotMatch(
    JSON.stringify(record.targetMetricShadow),
    /PRIVATE|TRANSCRIPT|CUE WORDING|RAW OBSERVATION/,
  );
  assert.equal(record.userMessage, '[redacted]');
  assert.equal(record.rawReply, '[redacted]');
});

test('coaching eval keeps a null target-metric field when no shadow witness exists', () => {
  const record = createTurnRecord({
    sessionId: 'session-no-shadow',
    signal: null,
  });
  assert.equal(record.targetMetricShadow, null);
});
