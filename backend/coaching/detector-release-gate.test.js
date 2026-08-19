'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { activationEligibility } = require('./target-metric-bridge');

function signal() {
  return {
    mode: 'active_drill',
    policy: { shouldCorrect: true, safetyState: 'normal', coachingAction: 'coach' },
    takeQuality: { usable: true },
    capture: { reliability: 'good' },
    sessionScope: { tier: 'full' },
  };
}

function bridge({ activeReleaseEligible = false } = {}) {
  return {
    mode: 'active',
    error: null,
    allowUnreviewedCues: false,
    decision: {
      status: 'coach',
      focus: {
        dimension: 'pitch.register',
        direction: 'below',
        targetKey: 'target-1',
        taskId: 'task-1',
        takeKind: 'phrase',
      },
      action: {
        cueId: 'pitch.register.small-glide-up.v1',
        reviewStatus: 'approved',
      },
    },
    observations: [{
      metricId: 'pitch.median_hz',
      metricDefinitionVersion: 'voice-metrics-v4-formants',
      dimension: 'pitch.register',
      value: 160,
      unit: 'Hz',
      target: { low: 170, high: null, scale: 1, targetKey: 'target-1' },
      taskId: 'task-1',
      takeKind: 'phrase',
      metadata: {
        targetScaleUnit: 'semitone',
        trainingTargetApplied: true,
        trainingTargetStatus: 'reachable_step_ready',
        trainingTargetPolicyId: 'calibrated-test-policy',
        trainingTargetPolicyVersion: '1',
      },
    }],
    canonicalContext: {
      freshness: { fresh: true },
      measurementUsable: true,
      hasTargetContract: true,
      targetIdentityFailures: [],
      targetValidationFailures: [],
      takeKind: 'phrase',
    },
    productPolicy: {
      domain: 'feminization_v1',
      selectedDetectorAuthority: {
        authority: 'authoritative',
        activeReleaseEligible,
        validationId: activeReleaseEligible
          ? 'yin-held-out-human-v1'
          : 'yin-v4-synthetic-regression-v1',
        validationStatus: activeReleaseEligible
          ? 'held_out_human_validated'
          : 'synthetic_regression_validated',
        humanBenchmarkRequired: !activeReleaseEligible,
      },
    },
  };
}

test('synthetic-regression detector cannot activate beginner coaching', () => {
  const eligibility = activationEligibility(signal(), bridge());
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('detector_not_release_validated'));
  assert.equal(eligibility.detectorRelease.shadowAuthority, 'authoritative');
  assert.equal(eligibility.detectorRelease.activeReleaseEligible, false);
});

test('external held-out release validation clears the detector-specific gate', () => {
  const eligibility = activationEligibility(signal(), bridge({ activeReleaseEligible: true }));
  assert.equal(eligibility.reasons.includes('detector_not_release_validated'), false);
  assert.equal(eligibility.detectorRelease.activeReleaseEligible, true);
  assert.equal(eligibility.eligible, true);
});

test('missing detector validation identity fails closed even when a caller flips a boolean', () => {
  const candidate = bridge({ activeReleaseEligible: true });
  candidate.productPolicy.selectedDetectorAuthority.validationId = null;
  candidate.productPolicy.selectedDetectorAuthority.validationStatus = null;
  const eligibility = activationEligibility(signal(), candidate);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('detector_validation_identity_missing'));
});
