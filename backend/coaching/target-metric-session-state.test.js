'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { decideTargetCoaching } = require('./target-coaching-engine');
const { createPendingMotorTrial, settlePendingMotorTrial } = require('./motor-trial');
const {
  TARGET_METRIC_SESSION_SCHEMA,
  bindTargetMetricSessionStateToTarget,
  buildDefaultTargetMetricSessionState,
  normalizePendingMotorTrial,
  normalizePersistenceByDimension,
  normalizeTargetMetricSessionState,
} = require('./target-metric-session-state');

function obs(dimension, value, low, high, {
  attempt = 'attempt-before',
  targetKey = 'target-1',
  taskId = 'task-1',
  takeKind = 'phrase',
  unit = 'score',
  scale = 0.1,
  metadata = {},
  importance = 0.7,
} = {}) {
  return {
    metricId: dimension,
    metricDefinitionVersion: 'v1',
    dimension,
    value,
    unit,
    attemptArtifactId: attempt,
    taskId,
    takeKind,
    analysisProfile: 'standard',
    confidence: { signal: 0.95, segmentation: 0.95, extractor: 0.95, target: 0.95 },
    target: { low, high, scale, source: 'reference', targetKey, confidence: 0.95 },
    persistenceCount: 2,
    importance,
    controllability: 0.8,
    metadata,
    flags: [],
  };
}

function pendingTrial() {
  const before = [
    obs('resonance.global_scale', 0.2, 0.4, 0.6, { importance: 0.9 }),
    obs('pitch.register', 200, 185, 220, {
      unit: 'Hz', scale: 1, metadata: { targetScaleUnit: 'semitone' },
    }),
    obs('phonation.pressedness', 0.2, 0, 0.5),
  ];
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const created = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
  });
  assert.equal(created.status, 'created');
  return created.trial;
}

test('default target-metric session state contains no motor map', () => {
  assert.deepEqual(buildDefaultTargetMetricSessionState(), {
    schema: TARGET_METRIC_SESSION_SCHEMA,
    targetKey: null,
    pendingTrial: null,
    persistenceByDimension: {},
  });
});

test('a valid pending trial survives normalization without cue prose or terminal mutation', () => {
  const trial = pendingTrial();
  const normalized = normalizePendingMotorTrial(trial);
  assert.ok(normalized);
  assert.equal(normalized.status, 'pending');
  assert.equal(normalized.trialId, trial.trialId);
  assert.equal(normalized.candidatePolicy.allowSkipToLaterAttempt, false);
  assert.equal(normalized.decision.action.cueId, trial.cueId);
  assert.equal(Object.hasOwn(normalized.decision.action, 'instruction'), false);
});

test('terminal or malformed trials cannot resurrect after session reload', () => {
  const trial = pendingTrial();
  const after = [
    obs('resonance.global_scale', 0.35, 0.4, 0.6, { attempt: 'attempt-after', importance: 0.9 }),
    obs('pitch.register', 200, 185, 220, {
      attempt: 'attempt-after', unit: 'Hz', scale: 1,
      metadata: { targetScaleUnit: 'semitone' },
    }),
    obs('phonation.pressedness', 0.2, 0, 0.5, { attempt: 'attempt-after' }),
  ];
  const settled = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: after,
    selfReport: { effort: 2 },
  });
  assert.equal(settled.status, 'settled');
  assert.equal(normalizePendingMotorTrial(settled.trial), null);
  assert.equal(normalizePendingMotorTrial({ ...trial, focusComparisonKey: 'wrong-key' }), null);
  assert.equal(normalizePendingMotorTrial({ ...trial, beforeObservations: [] }), null);
});

test('per-dimension persistence is bounded and invalid values are discarded', () => {
  const source = {
    'pitch.register': 3.9,
    'resonance.global_scale': -4,
    'prosody.phrase_ending': Infinity,
    'phonation.breathiness': 999999,
  };
  assert.deepEqual(normalizePersistenceByDimension(source), {
    'pitch.register': 3,
    'phonation.breathiness': 1000,
  });
});

test('changing target clears pending causal trials and target-scoped persistence', () => {
  const trial = pendingTrial();
  const state = normalizeTargetMetricSessionState({
    targetKey: 'target-1',
    pendingTrial: trial,
    persistenceByDimension: { 'pitch.register': 4 },
  });
  const rebound = bindTargetMetricSessionStateToTarget(state, 'target-2');
  assert.equal(rebound.targetKey, 'target-2');
  assert.equal(rebound.pendingTrial, null);
  assert.deepEqual(rebound.persistenceByDimension, {});
});

test('same target preserves a pending trial and persistence counters', () => {
  const trial = pendingTrial();
  const state = bindTargetMetricSessionStateToTarget({
    targetKey: 'target-1',
    pendingTrial: trial,
    persistenceByDimension: { 'pitch.register': 4 },
  }, 'target-1');
  assert.equal(state.pendingTrial.trialId, trial.trialId);
  assert.equal(state.persistenceByDimension['pitch.register'], 4);
});
