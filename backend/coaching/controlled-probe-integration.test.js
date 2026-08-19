'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isUsableObservation, normalizeObservation } = require('./metric-observations');
const { buildProbeContextMetadata } = require('./controlled-probes');
const { evaluateTargetMetricRuntime } = require('./target-metric-runtime');

function referenceState() {
  const version = 'voice-metrics-v4-formants';
  return {
    referenceClipId: 'ref-ee-probe',
    referenceAnalysis: {
      analysisVersion: version,
      quality: { verdict: 'good' },
    },
    targetVoiceProfile: {
      profileId: 'target-ee-profile',
      clipId: 'ref-ee-probe',
      analysisVersion: version,
      pitchFloorHz: 180,
      pitchCeilingHz: 230,
      resonanceFloor: 0.4,
      resonanceCeiling: 0.75,
      weightFloor: 0.1,
      weightCeiling: 0.5,
      metrics: {
        advanced: { formantLite: { f2MedianHz: 2200 } },
      },
      advancedBands: {
        formantLite: { frontnessFloor: 0.55 },
      },
    },
    lastAttemptArtifact: {
      attemptArtifactId: 'attempt-ee-learner',
      finalizedAt: 2000,
    },
    lastTakeFinalizedAt: 2000,
    sessionStartedAt: 1000,
    lastSummary: {
      analysisVersion: version,
      target: {
        source: 'reference',
        targetProfileId: 'target-ee-profile',
        analysisVersion: version,
        pitchFloorHz: 180,
        pitchCeilingHz: 230,
        resonanceFloor: 0.4,
        resonanceCeiling: 0.75,
        weightFloor: 0.1,
        weightCeiling: 0.5,
        referenceF2MedianHz: 2200,
      },
      metrics: {
        meanPitchHz: 200,
        resonanceMean: 0.5,
        weightMean: 0.3,
        advanced: {
          measurementAvailable: true,
          scoreConfidence: 0.92,
          captureReliability: 0.92,
          confidentFramePct: 0.92,
          voicedFramePct: 0.9,
          pitchValidFrameCount: 60,
          snrDb: 24,
          clippingPct: 0,
          medianPitchHz: 200,
          analysisProfile: 'standard',
          formantLite: { f2MedianHz: 1750, frontnessScore: 0.35 },
        },
      },
    },
  };
}

function probeRepContext(overrides = {}) {
  return {
    kind: 'sustained_vowel',
    drillId: 'controlled-ee',
    metadata: buildProbeContextMetadata('vowel.ee.steady.v1', {
      comparisonContextKey: 'ee-steady-same-note-v1',
      targetProbeId: 'vowel.ee.steady.v1',
      targetComparisonContextKey: 'ee-steady-same-note-v1',
      targetEvidenceKind: 'same_probe_clipwide',
      ...overrides,
    }),
  };
}

test('verified same-probe context makes F2 rankable and stamps its comparison identity', () => {
  const runtime = evaluateTargetMetricRuntime({
    voiceState: referenceState(),
    signal: { mode: 'active_drill', takeKind: 'sustained' },
    repContext: probeRepContext(),
    mode: 'shadow',
  });
  assert.equal(runtime.contextComparability.formants, true);
  assert.equal(runtime.contextComparability.verified, true);

  const f2 = runtime.bridge.observations.find((item) => item.metricId === 'formant_lite.f2_median_hz');
  const frontness = runtime.bridge.observations.find((item) => item.metricId === 'formant_lite.frontness_score');
  for (const item of [f2, frontness]) {
    assert.ok(item);
    assert.equal(item.flags.includes('context_not_comparable'), false);
    assert.equal(item.metadata.contextComparable, true);
    assert.equal(item.metadata.controlledProbeId, 'vowel.ee.steady.v1');
    assert.equal(item.metadata.comparisonContextKey, 'ee-steady-same-note-v1');
    assert.equal(normalizeObservation(item).comparisonContextKey, 'ee-steady-same-note-v1');
    assert.equal(isUsableObservation(item), true);
  }
});

test('same learner probe against arbitrary target speech remains non-rankable', () => {
  const runtime = evaluateTargetMetricRuntime({
    voiceState: referenceState(),
    signal: { mode: 'active_drill', takeKind: 'sustained' },
    repContext: probeRepContext({ targetEvidenceKind: null }),
    mode: 'shadow',
  });
  assert.equal(runtime.contextComparability.formants, false);
  const f2 = runtime.bridge.observations.find((item) => item.metricId === 'formant_lite.f2_median_hz');
  assert.ok(f2.flags.includes('context_not_comparable'));
  assert.equal(isUsableObservation(f2), false);
});

test('different controlled context keys cannot share the same comparison identity', () => {
  const first = normalizeObservation({
    metricId: 'formant_lite.f2_median_hz',
    dimension: 'resonance.global_scale',
    value: 1800,
    unit: 'Hz',
    taskId: 'controlled-ee',
    takeKind: 'sustained',
    contextKind: 'controlled_probe_formant',
    comparisonContextKey: 'context-A',
    target: { low: 2000, high: 2300, scale: 150, targetKey: 'target-1' },
  });
  const second = normalizeObservation({
    ...first,
    comparisonContextKey: 'context-B',
  });
  assert.notEqual(first.comparisonKey, second.comparisonKey);
});
