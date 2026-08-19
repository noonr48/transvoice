'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateTargetMetricRuntime,
  resolveRuntimeCurriculumPhase,
  resolveTargetMetricStage,
} = require('./target-metric-runtime');

function observation(dimension = 'pitch.register', value = 140) {
  const pitch = dimension === 'pitch.register';
  return {
    metricId: pitch ? 'pitch.median_hz' : dimension,
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension,
    value,
    unit: pitch ? 'Hz' : 'score',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: pitch
      ? { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 'target-1', confidence: 0.95 }
      : { low: 0.4, high: 0.6, scale: 0.1, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    metadata: pitch ? {
      targetScaleUnit: 'semitone',
      detectorFamily: 'yin',
      pitchValidFrameCount: 40,
      hitPitchCeiling: false,
    } : {},
    persistenceCount: 2,
    importance: 0.7,
    controllability: 0.8,
    flags: [],
  };
}

test('stage resolution is shared and deterministic across runtime callers', () => {
  assert.equal(resolveTargetMetricStage({ kind: 'sustained_vowel' }, {}), 'sound');
  assert.equal(resolveTargetMetricStage({ kind: 'word' }, {}), 'word');
  assert.equal(resolveTargetMetricStage({ kind: 'reading' }, {}), 'reading');
  assert.equal(resolveTargetMetricStage({ kind: 'spontaneous' }, {}), 'spontaneous');
  assert.equal(resolveTargetMetricStage(null, { takeKind: 'phrase' }), 'phrase');
});

test('new v1 sessions fail toward pitch foundation rather than a generic all-metric coach', () => {
  assert.equal(resolveRuntimeCurriculumPhase({}), 'pitch_foundation');
  assert.equal(resolveRuntimeCurriculumPhase({
    masteryState: { curriculumPhase: 'resonance_foundation' },
  }), 'resonance_foundation');
});

test('buffered and SSE callers get byte-equivalent shadow decisions from identical evidence', () => {
  const signalA = {
    takeKind: 'phrase',
    mode: 'active_drill',
    coachingDecision: { primaryFocus: 'pitch_floor' },
  };
  const signalB = JSON.parse(JSON.stringify(signalA));
  const options = {
    voiceState: {},
    repContext: { kind: 'phrase' },
    mode: 'shadow',
    observations: [observation()],
  };

  const buffered = evaluateTargetMetricRuntime({ ...options, signal: signalA });
  const streaming = evaluateTargetMetricRuntime({ ...options, signal: signalB });

  assert.deepEqual(streaming.bridge, buffered.bridge);
  assert.deepEqual(streaming.witness, buffered.witness);
  assert.equal(buffered.stage, 'phrase');
  assert.equal(buffered.productDomain, 'feminization_v1');
  assert.equal(buffered.curriculumPhase, 'pitch_foundation');
  assert.equal(buffered.applied, false);
  assert.equal(streaming.applied, false);
  assert.equal(Object.hasOwn(signalA, 'targetMetricV3'), false);
  assert.equal(Object.hasOwn(signalB, 'targetMetricV3'), false);
});

test('beginner runtime cannot let a large breathiness gap outrank pitch foundation', () => {
  const pitch = observation('pitch.register', 170);
  const breathiness = {
    ...observation('phonation.breathiness', 0.95),
    target: { high: 0.2, scale: 0.05, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    importance: 1,
    controllability: 1,
    takeKind: 'phrase',
  };
  const result = evaluateTargetMetricRuntime({
    signal: { takeKind: 'phrase', mode: 'active_drill' },
    repContext: { kind: 'phrase' },
    observations: [breathiness, pitch],
    mode: 'shadow',
  });
  assert.equal(result.bridge.observations.length, 2);
  assert.equal(result.bridge.productPolicy.decisionObservationCount, 1);
  assert.equal(result.bridge.decision.focus.dimension, 'pitch.register');
  assert.equal(result.witness.product_domain, 'feminization_v1');
  assert.equal(result.witness.curriculum_phase, 'pitch_foundation');
});

test('off mode performs no target-metric work and has no witness', () => {
  const signal = { takeKind: 'phrase', coachingDecision: { primaryFocus: 'pitch_floor' } };
  const result = evaluateTargetMetricRuntime({
    signal,
    mode: 'off',
    observations: [observation()],
  });
  assert.equal(result.mode, 'off');
  assert.equal(result.bridge, null);
  assert.equal(result.witness, null);
  assert.equal(result.applied, false);
  assert.equal(Object.hasOwn(signal, 'targetMetricV3'), false);
});

test('invalid mode fails toward shadow, never toward active', () => {
  const signal = { takeKind: 'phrase', coachingDecision: { primaryFocus: 'pitch_floor' } };
  const result = evaluateTargetMetricRuntime({
    signal,
    mode: 'definitely-not-active',
    observations: [observation()],
  });
  assert.equal(result.mode, 'shadow');
  assert.equal(result.applied, false);
  assert.equal(Object.hasOwn(signal, 'targetMetricV3'), false);
});
