'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTargetMetricShadowReport, sortedCounter } = require('./target-metric-shadow-report');
const { sanitizeTargetMetricShadowWitness } = require('./target-metric-shadow-analytics');

function row(focus, cue, agreement, outcome = 'coach') {
  return {
    targetMetricShadow: sanitizeTargetMetricShadowWitness({
      schema: 'transvoice.target_metric_bridge.v2',
      mode: 'shadow',
      outcome,
      focus_dimension: focus,
      focus_direction: focus ? 'below' : null,
      focus_confidence: focus ? 0.8 : null,
      focus_distance: focus ? 1.2 : null,
      cue_id: cue,
      cue_review_status: cue ? 'clinical-review-required' : null,
      legacy_focus: focus === 'pitch.register' ? 'pitch_floor' : 'phrase_ending',
      existing_focus: agreement ? (focus === 'pitch.register' ? 'pitch_floor' : 'phrase_ending') : 'vocal_weight',
      focus_agreement: agreement,
      target_key: 'target',
      target_source: 'reference',
      take_kind: 'phrase',
      attempt_artifact_id: `attempt-${focus || 'none'}-${cue || 'none'}`,
      fresh: true,
      measurement_usable: true,
      rejection_reasons: outcome === 'coach' ? [] : ['low_snr'],
    }),
  };
}

test('sortedCounter orders by frequency then token', () => {
  assert.deepEqual(sortedCounter({ z: 1, b: 2, a: 2 }), { a: 2, b: 2, z: 1 });
});

test('report exposes aggregate review data without turn payloads', () => {
  const report = buildTargetMetricShadowReport([
    row('pitch.register', 'pitch.register.small-glide-up.v1', true),
    row('pitch.register', 'pitch.register.small-glide-up.v1', false),
    row('prosody.phrase_ending', 'prosody.contour.hum-then-words.v1', false),
    row(null, null, null, 'no_reliable_gap'),
  ]);

  assert.equal(report.witnessCount, 4);
  assert.equal(report.focusDimensions['pitch.register'], 2);
  assert.equal(report.focusDimensions['prosody.phrase_ending'], 1);
  assert.equal(report.cueIds['pitch.register.small-glide-up.v1'], 2);
  assert.equal(report.focusAgreement.comparableCount, 3);
  assert.equal(report.focusAgreement.agreementCount, 1);
  assert.equal(report.focusAgreement.rate, 0.3333);
  assert.equal(report.rejectionReasons.low_snr, 1);
  assert.equal(Object.hasOwn(report, 'turns'), false);
  assert.equal(Object.hasOwn(report, 'records'), false);
  assert.doesNotMatch(JSON.stringify(report), /attempt-/);
});
