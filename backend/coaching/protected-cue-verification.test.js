'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideTargetCoaching, verifyCueEffect } = require('./target-coaching-engine');
const { emptyMotorMap, recordCueOutcome, cueEffectMultiplier } = require('./motor-map');
const { learnFromCuePair } = require('./target-metric-bridge');

function obs(dimension, value, low, high, extra = {}) {
  return {
    metricId: dimension,
    dimension,
    value,
    unit: extra.unit || 'score',
    confidence: { signal: 0.95, segmentation: 0.95, extractor: 0.95, target: 0.95 },
    target: {
      low,
      high,
      scale: extra.scale || 0.1,
      source: 'reference',
      targetKey: extra.targetKey || 'target-1',
      confidence: 0.95,
    },
    attemptArtifactId: extra.attemptArtifactId || 'attempt-1',
    taskId: 'task-1',
    takeKind: 'phrase',
    persistenceCount: 2,
    importance: 0.8,
    controllability: 0.8,
    metadata: extra.metadata || {},
    flags: [],
  };
}

function stableProtection(attemptArtifactId) {
  return [
    obs('pitch.register', 200, 185, 220, {
      attemptArtifactId,
      unit: 'Hz',
      scale: 1,
      metadata: { targetScaleUnit: 'semitone' },
    }),
    obs('phonation.pressedness', 0.2, 0, 0.5, { attemptArtifactId }),
  ];
}

test('protected pitch motion confounds resonance success and demotes the cue in the motor map', () => {
  const before = [
    obs('resonance.global_scale', 0.2, 0.4, 0.6),
    ...stableProtection('attempt-1'),
  ];
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  assert.equal(decision.focus.dimension, 'resonance.global_scale');
  assert.equal(decision.action.protectedRules['pitch.register'].max, 1);

  const after = [
    obs('resonance.global_scale', 0.35, 0.4, 0.6, { attemptArtifactId: 'attempt-2' }),
    obs('pitch.register', 235, 185, 220, {
      attemptArtifactId: 'attempt-2',
      unit: 'Hz',
      scale: 1,
      metadata: { targetScaleUnit: 'semitone' },
    }),
    obs('phonation.pressedness', 0.2, 0, 0.5, { attemptArtifactId: 'attempt-2' }),
  ];
  const verification = verifyCueEffect(decision, before, after, {
    effortBefore: 2,
    effortAfter: 2,
  });
  assert.equal(verification.targetMovement, 'improved');
  assert.equal(verification.result, 'confounded');
  assert.equal(verification.protectedRegressions[0].dimension, 'pitch.register');

  let motorMap = emptyMotorMap();
  motorMap = recordCueOutcome(motorMap, {
    cueId: decision.action.cueId,
    focusDimension: decision.focus.dimension,
    beforeObservations: before,
    afterObservations: after,
    protectedDimensions: decision.action.protectedMetrics,
    protectedRules: decision.action.protectedRules,
    effortBefore: 2,
    effortAfter: 2,
    verification,
  });
  const learned = motorMap.byCue[decision.action.cueId];
  assert.equal(learned.successes, 0);
  assert.ok(learned.meanProtectedDrift > 0);
  assert.ok(cueEffectMultiplier(motorMap, decision.action.cueId, decision.focus.dimension) < 1);
});

test('missing effort cannot be silently converted into zero effort success', () => {
  const before = [
    obs('resonance.global_scale', 0.2, 0.4, 0.6),
    ...stableProtection('attempt-1'),
  ];
  const after = [
    obs('resonance.global_scale', 0.35, 0.4, 0.6, { attemptArtifactId: 'attempt-2' }),
    ...stableProtection('attempt-2'),
  ];
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const verification = verifyCueEffect(decision, before, after);
  assert.equal(verification.result, 'movement_observed_partial');
  assert.ok(verification.missingProtectedEvidence.some((item) => item.dimension === 'safety.effort'));

  const learned = learnFromCuePair({
    motorMap: emptyMotorMap(),
    previousBridge: { decision },
    previousObservations: before,
    currentObservations: after,
  });
  assert.equal(learned.verification.result, 'movement_observed_partial');
  assert.equal(learned.motorMap.byCue[decision.action.cueId].successes, 0);
  assert.equal(learned.motorMap.byCue[decision.action.cueId].effortObservations, 0);
});

test('a cue becomes worked_verified only when focus, protection, and effort are all observed', () => {
  const before = [
    obs('resonance.global_scale', 0.2, 0.4, 0.6),
    ...stableProtection('attempt-1'),
  ];
  const after = [
    obs('resonance.global_scale', 0.35, 0.4, 0.6, { attemptArtifactId: 'attempt-2' }),
    ...stableProtection('attempt-2'),
  ];
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const verification = verifyCueEffect(decision, before, after, {
    effortBefore: 2,
    effortAfter: 2,
  });
  assert.equal(verification.result, 'worked_verified');
  assert.deepEqual(verification.protectedRegressions, []);
  assert.deepEqual(verification.missingProtectedEvidence, []);

  const learned = learnFromCuePair({
    motorMap: emptyMotorMap(),
    previousBridge: { decision },
    previousObservations: before,
    currentObservations: after,
    effortBefore: 2,
    effortAfter: 2,
  });
  assert.equal(learned.motorMap.byCue[decision.action.cueId].successes, 1);
});
