'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_EFFORT_BOUND,
  MIN_CALIBRATION_TAKES,
  PLAUSIBLE_MAX_PITCH_HZ,
  PLAUSIBLE_MIN_PITCH_HZ,
  PITCH_CALIBRATION_EVIDENCE_SCHEMA,
  buildPitchCalibrationEvidence,
} = require('./pitch-calibration-evidence');
const { resolvePitchStepPolicy, defaultPitchStepPolicyConfig } = require('./pitch-reachable-policy');

function take(value, { attempt = null, effort = null, frames = 40, ceiling = false, confidence = 0.9 } = {}) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value,
    unit: 'Hz',
    confidence: { signal: confidence, extractor: confidence, target: 0.9 },
    attemptArtifactId: attempt,
    flags: [],
    metadata: {
      targetScaleUnit: 'semitone',
      detectorFamily: 'yin',
      pitchValidFrameCount: frames,
      hitPitchCeiling: ceiling,
    },
    selfReport: effort == null ? undefined : { effort },
  };
}

test('five good takes produce a valid, versioned baseline distribution', () => {
  const result = buildPitchCalibrationEvidence({
    observations: [
      take(140, { attempt: 'a1', effort: 2 }),
      take(145, { attempt: 'a2', effort: 2 }),
      take(142, { attempt: 'a3', effort: 3 }),
      take(148, { attempt: 'a4', effort: 1 }),
      take(143, { attempt: 'a5', effort: 2 }),
    ],
  });
  assert.equal(result.schema, PITCH_CALIBRATION_EVIDENCE_SCHEMA);
  assert.equal(result.status, 'valid');
  assert.equal(result.baseline.n, 5);
  assert.equal(result.baseline.p50, 143);
  assert.ok(result.baseline.p10 <= result.baseline.p50);
  assert.ok(result.baseline.p90 >= result.baseline.p50);
});

test('no universal target: the record derives no target band at all', () => {
  const result = buildPitchCalibrationEvidence({
    observations: Array.from({ length: 6 }, (_, i) => take(140 + i, { attempt: `a${i}`, effort: 2 })),
  });
  assert.equal(Object.hasOwn(result, 'target'), false);
  assert.equal(Object.hasOwn(result, 'targetBand'), false);
  assert.equal(Object.hasOwn(result.baseline, 'target'), false);
});

test('comfortable movement is recorded in semitones with effort verification', () => {
  const result = buildPitchCalibrationEvidence({
    observations: [
      take(140, { attempt: 'a1', effort: 2 }),
      take(155, { attempt: 'a2', effort: 2 }), // +~1.77 ST, comfortable (verified; 2 <= bound 3 on the five-point scale)
      take(120, { attempt: 'a3', effort: 5 }), // big movement, max five-point effort (unverified: 5 > bound 3)
      take(160, { attempt: 'a4', effort: null }), // movement, effort unknown (unverified, not zero)
      take(142, { attempt: 'a5', effort: 2 }), // downward movement, comfortable (verified)
    ],
  });
  assert.equal(result.status, 'valid');
  const verified = result.comfortableMovement.filter((m) => m.effortVerified);
  assert.equal(verified.length, 2); // a1->a2 (up) and a4->a5 (down)
  const up = verified.find((m) => m.direction === 'up');
  assert.equal(up.afterAttemptArtifactId, 'a2');
  assert.ok(Math.abs(up.deltaSemitones - 12 * Math.log2(155 / 140)) < 2e-6);
  // Unknown effort is recorded but never counted comfortable (unknown is not zero)
  const unknownEffort = result.comfortableMovement.find((m) => m.effort === null);
  assert.ok(unknownEffort);
  assert.equal(unknownEffort.effortVerified, false);
  // Max five-point effort is recorded but never counted comfortable
  const excessive = result.comfortableMovement.find((m) => m.effort === 5);
  assert.ok(excessive);
  assert.equal(excessive.effortVerified, false);
  // Summary reflects only verified movement
  assert.ok(result.comfortableMovementSummary.verifiedCount === 2);
  assert.ok(result.comfortableMovementSummary.maxVerifiedUpwardSemitones > 0);
  assert.ok(result.comfortableMovementSummary.maxVerifiedDownwardSemitones < 0);
});

test('tracker uncertainty is recorded: ceiling hits and frame evidence', () => {
  const result = buildPitchCalibrationEvidence({
    observations: [
      take(140, { attempt: 'a1', frames: 45 }),
      take(145, { attempt: 'a2', frames: 30 }),
      take(150, { attempt: 'a3', frames: 20 }),
      take(148, { attempt: 'a4', ceiling: true }),
      take(143, { attempt: 'a5' }),
      take(141, { attempt: 'a6' }),
    ],
  });
  assert.equal(result.tracker.ceilingHitCount, 1);
  assert.equal(result.tracker.minValidFrameCount, 20);
  assert.ok(result.tracker.medianConfidence > 0 && result.tracker.medianConfidence <= 1);
});

test('insufficient evidence fails closed with reasons, never invented numbers', () => {
  const result = buildPitchCalibrationEvidence({
    observations: [take(140, { attempt: 'a1' }), take(145, { attempt: 'a2' })],
  });
  assert.equal(result.status, 'insufficient_evidence');
  assert.ok(result.reasons.includes('minimum_calibration_takes_not_met'));
  assert.equal(result.baseline, null);
  assert.equal(result.comfortableMovement, null);
  assert.equal(result.tracker, null);
});

test('non-pitch and unusable observations are excluded, not averaged in', () => {
  const noise = { ...take(999, { attempt: 'x' }), dimension: 'phonation.breathiness' };
  const clipped = { ...take(300, { attempt: 'y' }), flags: ['sustained_clipping'] };
  const result = buildPitchCalibrationEvidence({
    observations: [
      noise, clipped,
      ...Array.from({ length: 5 }, (_, i) => take(140 + i, { attempt: `a${i}` })),
    ],
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.baseline.n, 5);
  assert.ok(result.reasons.includes('non_pitch_observations_excluded'));
});

test('implausible values are excluded from the baseline even with clean frames', () => {
  const result = buildPitchCalibrationEvidence({
    observations: [
      take(20, { attempt: 'octave-down' }),
      take(20000, { attempt: 'octave-up' }),
      ...Array.from({ length: 5 }, (_, i) => take(140 + i, { attempt: `a${i}` })),
    ],
  });
  assert.equal(result.status, 'valid');
  assert.equal(result.baseline.n, 5);
  assert.ok(result.baseline.p10 >= PLAUSIBLE_MIN_PITCH_HZ);
  assert.ok(result.baseline.p90 <= PLAUSIBLE_MAX_PITCH_HZ);
});

test('baseline records quantile method and spread', () => {
  const result = buildPitchCalibrationEvidence({
    observations: Array.from({ length: 6 }, (_, i) => take(140 + i, { attempt: `a${i}` })),
  });
  assert.equal(result.baseline.quantileMethod, 'nearest_rank');
  assert.ok(result.baseline.spreadSemitones > 0);
  assert.ok(result.baseline.spreadSemitones < 1);
});

test('one artifact take cannot inflate the median demonstrated-movement basis', () => {
  const artifact = 143 * (2 ** (5 / 12)); // ~+5 ST jump with clean effort
  const result = buildPitchCalibrationEvidence({
    observations: [
      take(140, { attempt: 'a1', effort: 2 }),
      take(150, { attempt: 'a2', effort: 2 }), // +~1.19 ST
      take(141, { attempt: 'a3', effort: 2 }),
      take(152, { attempt: 'a4', effort: 2 }), // +~1.32 ST
      take(143, { attempt: 'a5', effort: 2 }),
      take(artifact, { attempt: 'a6', effort: 2 }), // +5.0 ST artifact
    ],
  });
  const summary = result.comfortableMovementSummary;
  assert.equal(summary.verifiedUpwardCount, 3);
  assert.ok(Math.abs(summary.maxVerifiedUpwardSemitones - 5.0) < 0.01); // still recorded
  // The ALL-verified median stays near the two real movements, not the artifact;
  // policy consumers use the salience-filtered basis via resolvePitchStepPolicy.
  assert.ok(Math.abs(summary.medianAllVerifiedUpwardSemitones - 1.32) < 0.05);
});

test('checkpoint lens-2 F1: forged effort values are MISSING, never verified comfort', () => {
  const up = 142 * (2 ** (1.5 / 12));
  const result = buildPitchCalibrationEvidence({
    observations: [
      take(140, { attempt: 'a1', effort: 2 }),
      take(up, { attempt: 'a2', effort: true }), // forged: boolean (was coerced to 1)
      take(142, { attempt: 'a3', effort: [] }), // forged: array (was coerced to 0)
      take(up, { attempt: 'a4', effort: '  ' }), // forged: whitespace string (was coerced to 0)
      take(142, { attempt: 'a5' }), // fifth take, no effort reported at all
    ],
  });
  assert.equal(result.status, 'valid');
  // Every forged movement is recorded with effort null — never verified.
  assert.equal(result.comfortableMovementSummary.verifiedCount, 0);
  for (const movement of result.comfortableMovement) {
    assert.equal(movement.effort, null, movement.afterAttemptArtifactId);
    assert.equal(movement.effortVerified, false);
  }
  // And with zero verified comfort, the step policy refuses (no default step):
  const policy = resolvePitchStepPolicy({
    calibration: result,
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(policy.status, 'refused');
  assert.equal(policy.reason, 'demonstrated_comfort_required');
});
