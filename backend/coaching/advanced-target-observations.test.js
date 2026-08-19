'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { targetDistance, isUsableObservation } = require('./metric-observations');
const { legacyObservationsFromVoiceState } = require('./legacy-observation-adapter');
const { decideTargetCoaching } = require('./target-coaching-engine');

function oneSided({ value, low = null, high = null, scale = 0.1, unit = 'score' }) {
  return {
    metricId: 'test',
    dimension: 'test',
    value,
    unit,
    confidence: { signal: 0.9, extractor: 0.9, target: 0.9 },
    target: { low, high, scale, source: 'reference', targetKey: 'target-1', confidence: 0.9 },
    taskId: 'task-1',
    takeKind: 'phrase',
    flags: [],
  };
}

function verifiedFormantContext() {
  return {
    formants: true,
    verified: true,
    source: 'controlled_probe_pair',
    probeId: 'vowel.ee.steady.v1',
    comparisonContextKey: 'ee-steady-same-note-v1',
    targetEvidenceKind: 'same_probe_clipwide',
  };
}

function state(overrides = {}) {
  const version = 'voice-metrics-v4-formants';
  const advanced = {
    medianPitchHz: 200,
    pitchP10Hz: 190,
    pitchP90Hz: 220,
    pitchStdSt: 2.0,
    phraseEndDropHz: 22,
    scoreConfidence: 0.9,
    captureReliability: 0.9,
    voicedFramePct: 0.9,
    confidentFramePct: 0.9,
    pitchValidFrameCount: 80,
    measurementAvailable: true,
    snrDb: 24,
    clippingPct: 0,
    stabilityMean: 0.7,
    formantLite: { f2MedianHz: 2100, frontnessScore: 0.6 },
    quality: { breathyRisk: 0.3, strainRisk: 0.3, cppsLike: 10, harmonicStrength: 7 },
    ...(overrides.advanced || {}),
  };
  const advancedBands = {
    pitchP10HzFloor: 170,
    pitchP90HzCeiling: 240,
    pitchStdStCeiling: 2.5,
    phraseEndDropHzCeiling: 10,
    stabilityFloor: 0.5,
    formantLite: { frontnessFloor: 0.55 },
    quality: {
      breathyRiskCeiling: 0.5,
      strainRiskCeiling: 0.5,
      cppsLikeFloor: 8,
      harmonicStrengthFloor: 5,
    },
    ...(overrides.advancedBands || {}),
  };
  return {
    targetPreset: 'cute-feminine',
    targetSource: 'reference',
    referenceClipId: 'ref-1',
    referenceAnalysis: {
      clipId: 'ref-1',
      analysisVersion: version,
      quality: { verdict: 'good' },
    },
    targetVoiceProfile: {
      profileId: 'profile-1',
      clipId: 'ref-1',
      targetPreset: 'cute-feminine',
      analysisVersion: version,
      pitchFloorHz: 180,
      pitchCeilingHz: 220,
      resonanceFloor: 0.4,
      resonanceCeiling: 0.65,
      weightFloor: 0.2,
      weightCeiling: 0.45,
      advancedBands,
      metrics: { advanced: { formantLite: { f2MedianHz: 2100 } } },
    },
    lastSummary: {
      analysisVersion: version,
      targetPreset: 'cute-feminine',
      referenceClipId: 'ref-1',
      target: {
        source: 'reference',
        targetPreset: 'cute-feminine',
        targetProfileId: 'profile-1',
        direction: 'feminine',
        pitchFloorHz: 180,
        pitchCeilingHz: 220,
        resonanceFloor: 0.4,
        resonanceCeiling: 0.65,
        weightFloor: 0.2,
        weightCeiling: 0.45,
        referenceF2MedianHz: 2100,
      },
      metrics: { meanPitchHz: 200, resonanceMean: 0.5, weightMean: 0.35, advanced },
    },
    lastAttemptArtifact: {
      attemptArtifactId: 'attempt-1',
      finalizedAt: Date.now(),
      repContext: { kind: 'phrase', drillId: 'task-1' },
    },
  };
}

test('one-sided target regions are zero inside the allowed side and signed outside it', () => {
  assert.equal(targetDistance(oneSided({ value: 0.6, low: 0.5 })).absoluteDistance, 0);
  assert.equal(targetDistance(oneSided({ value: 0.4, low: 0.5 })).direction, 'below');
  assert.ok(Math.abs(targetDistance(oneSided({ value: 0.4, low: 0.5 })).absoluteDistance - 1) < 1e-9);
  assert.equal(targetDistance(oneSided({ value: 0.4, high: 0.5 })).absoluteDistance, 0);
  assert.equal(targetDistance(oneSided({ value: 0.6, high: 0.5 })).direction, 'above');
  assert.ok(Math.abs(targetDistance(oneSided({ value: 0.6, high: 0.5 })).absoluteDistance - 1) < 1e-9);
});

test('reference-derived advanced bands expand the vector without fake phoneme timing', () => {
  const observations = legacyObservationsFromVoiceState(state());
  for (const dimension of [
    'pitch.lower_edge',
    'pitch.upper_edge',
    'prosody.pitch_variability',
    'prosody.phrase_ending',
    'resonance.frontness_proxy',
    'phonation.breathiness',
    'phonation.pressedness',
    'phonation.periodicity',
    'phonation.harmonic_presence',
    'production.stability',
  ]) {
    assert.ok(observations.some((item) => item.dimension === dimension), `missing ${dimension}`);
  }
  const frontness = observations.find((item) => item.dimension === 'resonance.frontness_proxy');
  assert.equal(frontness.metadata.clipWide, true);
  assert.equal(frontness.metadata.needsVowelConditioning, true);
  assert.equal(frontness.phoneme, undefined);
  assert.ok(frontness.flags.includes('context_not_comparable'));
  assert.equal(isUsableObservation(frontness), false);
});

test('phrase-end target gap selects a contour exercise while register remains protected in the generic research engine', () => {
  const observations = legacyObservationsFromVoiceState(state());
  const decision = decideTargetCoaching({ observations, stage: 'phrase' });
  assert.equal(decision.status, 'coach');
  assert.equal(decision.focus.dimension, 'prosody.phrase_ending');
  assert.match(decision.action.cueId, /hum-then-words/);
  assert.ok(decision.action.protectedMetrics.includes('pitch.register'));
});

test('clip-wide frontness cannot select ee until controlled formant context is verified', () => {
  const source = state({
    advanced: {
      phraseEndDropHz: 6,
      formantLite: { f2MedianHz: 2100, frontnessScore: 0.35 },
    },
  });
  const defaultObservations = legacyObservationsFromVoiceState(source);
  const defaultFrontness = defaultObservations.find((item) => item.dimension === 'resonance.frontness_proxy');
  assert.equal(isUsableObservation(defaultFrontness), false);
  const defaultDecision = decideTargetCoaching({ observations: defaultObservations, stage: 'phrase' });
  assert.notEqual(defaultDecision.focus?.dimension, 'resonance.frontness_proxy');

  const assertedOnly = legacyObservationsFromVoiceState(source, {
    contextComparability: { formants: true },
  });
  assert.equal(
    isUsableObservation(assertedOnly.find((item) => item.dimension === 'resonance.frontness_proxy')),
    false,
  );

  const comparableObservations = legacyObservationsFromVoiceState(source, {
    contextComparability: verifiedFormantContext(),
  });
  const frontness = comparableObservations.find((item) => item.dimension === 'resonance.frontness_proxy');
  assert.equal(isUsableObservation(frontness), true);
  assert.equal(frontness.metadata.controlledProbeId, 'vowel.ee.steady.v1');
  assert.equal(frontness.metadata.comparisonContextKey, 'ee-steady-same-note-v1');
  assert.equal(targetDistance(frontness).direction, 'below');
  const decision = decideTargetCoaching({ observations: comparableObservations, stage: 'phrase' });
  assert.equal(decision.focus.dimension, 'resonance.frontness_proxy');
  assert.match(decision.action.cueId, /ee-anchor/);
  assert.match(decision.action.instruction, /same note/i);
});

test('reference breathiness gap remains research-only behavior in the generic engine', () => {
  const observations = legacyObservationsFromVoiceState(state({
    advanced: {
      phraseEndDropHz: 6,
      quality: { breathyRisk: 0.72, strainRisk: 0.3, cppsLike: 10, harmonicStrength: 7 },
    },
  }));
  const decision = decideTargetCoaching({ observations, stage: 'phrase' });
  assert.equal(decision.focus.dimension, 'phonation.breathiness');
  assert.match(decision.action.cueId, /m-onset/);
  assert.match(decision.action.instruction, /mmm/i);
});
