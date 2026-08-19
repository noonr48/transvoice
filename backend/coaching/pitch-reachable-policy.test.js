'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PITCH_REACHABLE_POLICY_ID,
  PITCH_REACHABLE_POLICY_SCHEMA,
  PITCH_REACHABLE_POLICY_VERSION,
  defaultPitchStepPolicyConfig,
  resolvePitchStepPolicy,
} = require('./pitch-reachable-policy');
const { buildPitchCalibrationEvidence } = require('./pitch-calibration-evidence');
const { deriveReachableTrainingTarget } = require('./training-target');

function take(value, { attempt, effort = 2, frames = 40, ceiling = false, confidence = 0.9 } = {}) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value,
    unit: 'Hz',
    confidence: { signal: confidence, extractor: confidence, target: 0.9 },
    attemptArtifactId: attempt,
    flags: [],
    metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: frames, hitPitchCeiling: ceiling },
    selfReport: effort == null ? undefined : { effort },
  };
}

function calibration({ withMovement = true, risk = 'nominal', confidence = 0.9 } = {}) {
  const takes = [
    take(140, { attempt: 'a1', confidence }),
    take(142, { attempt: 'a2', confidence }),
    take(141, { attempt: 'a3', confidence }),
    take(143, { attempt: 'a4', confidence }),
    take(142, { attempt: 'a5', confidence }),
  ];
  if (withMovement === 'single') {
    takes.push(take(142 * (2 ** (1.5 / 12)), { attempt: 'a6', effort: 2, confidence }));
  } else if (withMovement === 'subfloor') {
    const m1 = 142 * (2 ** (0.3 / 12));
    const m2 = m1 * (2 ** (0.4 / 12));
    takes.push(take(m1, { attempt: 'a6', effort: 2, confidence }));
    takes.push(take(m2, { attempt: 'a7', effort: 2, confidence }));
  } else if (withMovement === true) {
    // Comfort ladder with TWO salient verified upward glides (+1.5 ST each,
    // separated by a small down step) so the median basis is a real 1.5 ST.
    const up1 = 142 * (2 ** (1.5 / 12));
    const down = up1 * (2 ** (-0.5 / 12));
    const up2 = down * (2 ** (1.5 / 12));
    takes.push(take(up1, { attempt: 'a6', effort: 2, confidence }));
    takes.push(take(down, { attempt: 'a7', effort: 2, confidence }));
    takes.push(take(up2, { attempt: 'a8', effort: 2, confidence }));
  }
  if (risk === 'elevated') {
    takes.push(take(150, { attempt: 'a9', frames: 12, confidence }));
  }
  return buildPitchCalibrationEvidence({ observations: takes });
}

test('valid calibration yields a named+versioned policy capped by demonstrated comfort', () => {
  const config = defaultPitchStepPolicyConfig();
  const result = resolvePitchStepPolicy({ calibration: calibration(), config });
  assert.equal(result.status, 'ready');
  assert.equal(result.schema, PITCH_REACHABLE_POLICY_SCHEMA);
  assert.equal(result.policy.policyId, PITCH_REACHABLE_POLICY_ID);
  assert.equal(result.policy.policyVersion, PITCH_REACHABLE_POLICY_VERSION);
  assert.equal(result.policy.type, 'max_semitone_delta');
  // median verified upward glide 1.5 ST < config cap 2.0 ST -> step capped at demonstrated
  assert.ok(Math.abs(result.policy.max - 1.5) < 0.05);
  assert.equal(result.basis.demonstratedComfortBasis, 'median_salient_verified_upward');
  assert.equal(result.basis.salientVerifiedUpwardCount, 2);
  assert.equal(result.basis.allVerifiedUpwardCount, 4); // includes jitter; only salient counts
  assert.ok(result.basis.demonstratedComfortSemitones > 0);
});

test('no calibration evidence: policy refused, target stays aspirational_only (no default step)', () => {
  const result = resolvePitchStepPolicy({ calibration: null, config: defaultPitchStepPolicyConfig() });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'calibration_evidence_required');
  assert.equal(result.policy, null);

  const target = deriveReachableTrainingTarget(
    { metricId: 'pitch.median_hz', metricDefinitionVersion: 'voice-metrics-v4-formants', dimension: 'pitch.register', value: 140, unit: 'Hz', confidence: { signal: 0.95, extractor: 0.95, target: 0.95 }, target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 't1', confidence: 0.9 }, flags: [], metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40 } },
    { stepPolicy: null },
  );
  assert.equal(target.status, 'aspirational_only');
});

test('demonstrated comfort required: zero verified upward movement refuses the policy', () => {
  const result = resolvePitchStepPolicy({
    calibration: calibration({ withMovement: false }),
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'demonstrated_comfort_required');
});

test('detector uncertainty considered: elevated octave risk refuses the policy', () => {
  const result = resolvePitchStepPolicy({
    calibration: calibration({ risk: 'elevated' }),
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'tracker_uncertainty_too_high');
});

test('detector uncertainty considered: low median confidence refuses the policy', () => {
  const result = resolvePitchStepPolicy({
    calibration: calibration({ confidence: 0.4 }),
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'tracker_uncertainty_too_high');
});

test('config cap below demonstrated movement caps the step at the config value', () => {
  const result = resolvePitchStepPolicy({
    calibration: calibration(),
    config: { ...defaultPitchStepPolicyConfig(), maxSemitones: 0.75 },
  });
  assert.equal(result.status, 'ready');
  assert.ok(Math.abs(result.policy.max - 0.75) < 1e-9);
});

test('integration: resolved policy drives deriveReachableTrainingTarget to reachable_step_ready', () => {
  const resolved = resolvePitchStepPolicy({ calibration: calibration(), config: defaultPitchStepPolicyConfig() });
  assert.equal(resolved.status, 'ready');
  const target = deriveReachableTrainingTarget(
    { metricId: 'pitch.median_hz', metricDefinitionVersion: 'voice-metrics-v4-formants', dimension: 'pitch.register', value: 140, unit: 'Hz', confidence: { signal: 0.95, extractor: 0.95, target: 0.95 }, target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 't1', confidence: 0.9 }, flags: [], metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40 } },
    { stepPolicy: resolved.policy },
  );
  assert.equal(target.status, 'reachable_step_ready');
  assert.ok(target.nextThreshold > 140);
  // step never exceeds the demonstrated-comfort cap
  assert.ok(Math.abs(target.stepFromCurrent - resolved.policy.max) < 1e-6);
  assert.equal(target.policy.policyId, 'fem-v1.pitch.step.comfort-first.v1');
});

test('a single verified movement is not demonstrated comfort (count requirement)', () => {
  const result = resolvePitchStepPolicy({
    calibration: calibration({ withMovement: 'single' }),
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'demonstrated_comfort_required');
});

test('sub-floor median refuses: jitter is not a glide', () => {
  const result = resolvePitchStepPolicy({
    calibration: calibration({ withMovement: 'subfloor' }),
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'demonstrated_comfort_required');
});

test('a baseline spread beyond one octave refuses the policy', () => {
  const wide = buildPitchCalibrationEvidence({
    observations: [
      take(100, { attempt: 'a1', effort: 2 }),
      take(240, { attempt: 'a2', effort: 2 }),
      take(105, { attempt: 'a3', effort: 2 }),
      take(235, { attempt: 'a4', effort: 2 }),
      take(102, { attempt: 'a5', effort: 2 }),
      take(238, { attempt: 'a6', effort: 2 }),
    ],
  });
  assert.equal(wide.status, 'valid');
  assert.ok(wide.baseline.spreadSemitones > 12);
  const result = resolvePitchStepPolicy({
    calibration: wide,
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(result.status, 'refused');
  assert.equal(result.reason, 'baseline_spread_too_wide');
});
