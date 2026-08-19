'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_DETECTOR_VALIDATION_REGISTRY,
  lookupDetectorValidation,
  validationForObservation,
} = require('./detector-validation-registry');

const VERSION = 'voice-metrics-v4-formants';

test('current YIN is shadow-decision eligible but not active-release eligible', () => {
  const validation = lookupDetectorValidation({
    analysisVersion: VERSION,
    detectorFamily: 'yin',
  });
  assert.equal(validation.status, 'synthetic_regression_validated');
  assert.equal(validation.decisionEligible, true);
  assert.equal(validation.activeReleaseEligible, false);
  assert.equal(validation.humanBenchmarkRequired, true);
  assert.ok(validation.pendingEvidence.includes('held_out_human_expert_pitch_corpus'));
});

test('current LPC formant detector remains research-only', () => {
  const validation = lookupDetectorValidation({
    analysisVersion: VERSION,
    detectorFamily: 'lpc_formant_lite_v4',
  });
  assert.equal(validation.decisionEligible, false);
  assert.equal(validation.activeReleaseEligible, false);
  assert.match(validation.status, /research_only/);
});

test('unknown versions fail closed instead of inheriting another calibration', () => {
  assert.equal(lookupDetectorValidation({
    analysisVersion: 'voice-metrics-v999',
    detectorFamily: 'yin',
  }), null);
});

test('observation lookup binds detector family and metric definition version', () => {
  const validation = validationForObservation({
    metricDefinitionVersion: VERSION,
    metadata: { detectorFamily: 'yin' },
  });
  assert.equal(validation.validationId, 'yin-v4-synthetic-regression-v1');
});

test('registry entries are immutable release policy, not mutable runtime state', () => {
  const entry = DEFAULT_DETECTOR_VALIDATION_REGISTRY[VERSION].yin;
  assert.throws(() => {
    'use strict';
    entry.activeReleaseEligible = true;
  }, TypeError);
  assert.equal(entry.activeReleaseEligible, false);
});
