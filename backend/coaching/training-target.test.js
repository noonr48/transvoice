'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { targetDistance } = require('./metric-observations');
const {
  applyReachableTrainingTargets,
  deriveReachableTrainingTarget,
  shiftHzBySemitones,
} = require('./training-target');

function pitch(value = 140) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value,
    unit: 'Hz',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.9 },
    target: {
      low: 190,
      high: 230,
      scale: 1,
      source: 'reference',
      targetKey: 'target-1',
      confidence: 0.9,
    },
    taskId: 'phrase-1',
    takeKind: 'phrase',
    analysisProfile: 'standard',
    comparisonContextKey: 'phrase-1-context',
    metadata: {
      targetScaleUnit: 'semitone',
    },
  };
}

function scalar(value = 0.2) {
  return {
    metricId: 'legacy.resonance_mean',
    dimension: 'resonance.legacy_proxy',
    value,
    unit: 'score_0_1',
    confidence: { signal: 0.9, extractor: 0.7, target: 0.9 },
    target: { low: 0.5, high: 0.8, scale: 0.14, source: 'reference', targetKey: 'target-1', confidence: 0.9 },
    metadata: {},
  };
}

test('there is deliberately no implicit reachable step size', () => {
  const result = deriveReachableTrainingTarget(pitch());
  assert.equal(result.status, 'aspirational_only');
  assert.equal(result.trainingTarget, null);
  assert.equal(result.policy, null);
});

test('reachable target metadata comes from canonical observation provenance, not ad-hoc metadata', () => {
  const result = deriveReachableTrainingTarget(pitch());
  assert.equal(result.metadata.targetKey, 'target-1');
  assert.equal(result.metadata.taskId, 'phrase-1');
  assert.equal(result.metadata.takeKind, 'phrase');
  assert.equal(result.metadata.comparisonContextKey, 'phrase-1-context');
  assert.equal(result.metadata.analysisProfile, 'standard');
  assert.equal(result.metadata.metricDefinitionVersion, 'voice-metrics-v4-formants');
  assert.equal(result.aspirationalTarget.targetKey, 'target-1');
});

test('an explicit semitone policy advances pitch by no more than its calibrated limit', () => {
  const result = deriveReachableTrainingTarget(pitch(140), {
    stepPolicy: {
      policyId: 'research.pitch.step.v1',
      policyVersion: '1',
      type: 'max_semitone_delta',
      max: 1,
    },
  });
  assert.equal(result.status, 'reachable_step_ready');
  assert.ok(Math.abs(result.stepFromCurrent - 1) < 1e-9);
  assert.ok(Math.abs(result.nextThreshold - shiftHzBySemitones(140, 1)) < 1e-9);
  assert.equal(result.trainingTarget.low, result.nextThreshold);
  assert.equal(result.trainingTarget.high, null);
  assert.equal(result.trainingTarget.targetKey, 'target-1');
  assert.equal(result.aspirationalTarget.low, 190);
  assert.equal(result.aspirationalTarget.high, 230);
});

test('a reachable step never overshoots the aspirational boundary', () => {
  const result = deriveReachableTrainingTarget(pitch(189), {
    stepPolicy: { policyId: 'research.pitch.step.v1', type: 'max_semitone_delta', max: 3 },
  });
  assert.equal(result.status, 'reachable_step_ready');
  assert.equal(result.nextThreshold, 190);
});

test('above-target movement steps downward toward the nearest aspirational edge', () => {
  const result = deriveReachableTrainingTarget(pitch(260), {
    stepPolicy: { policyId: 'research.pitch.step.v1', type: 'max_semitone_delta', max: 1 },
  });
  assert.equal(result.status, 'reachable_step_ready');
  assert.equal(result.trainingTarget.low, null);
  assert.equal(result.trainingTarget.high, result.nextThreshold);
  assert.ok(result.nextThreshold < 260);
  assert.ok(result.nextThreshold > 230);
});

test('scalar policies can use native or target-normalized steps', () => {
  const native = deriveReachableTrainingTarget(scalar(0.2), {
    stepPolicy: { policyId: 'research.resonance.native.v1', type: 'max_native_delta', max: 0.05 },
  });
  assert.equal(native.status, 'reachable_step_ready');
  assert.ok(Math.abs(native.nextThreshold - 0.25) < 1e-12);

  const normalized = deriveReachableTrainingTarget(scalar(0.2), {
    stepPolicy: { policyId: 'research.resonance.normalized.v1', type: 'max_normalized_distance', max: 0.5 },
  });
  assert.equal(normalized.status, 'reachable_step_ready');
  assert.ok(Math.abs(normalized.nextThreshold - 0.27) < 1e-12);
});

test('safety envelope vetoes rather than silently clamping a proposed next target', () => {
  const result = deriveReachableTrainingTarget(pitch(180), {
    stepPolicy: { policyId: 'research.pitch.step.v1', type: 'max_semitone_delta', max: 2 },
    safetyEnvelope: { low: 100, high: 185 },
  });
  assert.equal(result.status, 'blocked_by_safety_envelope');
  assert.equal(result.trainingTarget, null);
});

test('already-in-target evidence stays anchored to the aspiration', () => {
  const result = deriveReachableTrainingTarget(pitch(205), {
    stepPolicy: { policyId: 'research.pitch.step.v1', type: 'max_semitone_delta', max: 1 },
  });
  assert.equal(result.status, 'already_in_aspirational_target');
  assert.deepEqual(result.trainingTarget, result.aspirationalTarget);
});

test('shadow vector rewrite is explicit and leaves unconfigured dimensions aspirational', () => {
  const originalPitch = pitch(140);
  const originalScalar = scalar(0.2);
  const rewritten = applyReachableTrainingTargets([originalPitch, originalScalar], {
    policiesByDimension: {
      'pitch.register': { policyId: 'research.pitch.step.v1', type: 'max_semitone_delta', max: 1 },
    },
  });

  assert.equal(rewritten[0].metadata.trainingTargetApplied, true);
  assert.equal(rewritten[0].metadata.aspirationalTarget.low, 190);
  assert.equal(rewritten[0].target.targetKey, 'target-1');
  assert.ok(targetDistance(rewritten[0]).absoluteDistance < targetDistance(originalPitch).absoluteDistance);

  assert.equal(rewritten[1].metadata.trainingTargetApplied, false);
  assert.equal(rewritten[1].metadata.trainingTargetStatus, 'aspirational_only');
  assert.deepEqual(rewritten[1].target, originalScalar.target);
});
