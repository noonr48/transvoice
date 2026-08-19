'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isUsableObservation, normalizeObservation } = require('./metric-observations');
const {
  buildCanonicalMetricContext,
  legacyObservationsFromVoiceState,
  referenceTargetConfidence,
} = require('./legacy-observation-adapter');

function referenceVoiceState({
  referenceVersion = 'voice-metrics-v4-formants',
  takeVersion = 'voice-metrics-v4-formants',
  verdict = 'good',
} = {}) {
  return {
    targetPreset: 'cute-feminine',
    targetSource: 'reference',
    referenceClipId: 'ref-1',
    referenceAnalysis: {
      clipId: 'ref-1',
      analysisVersion: referenceVersion,
      quality: { verdict },
    },
    targetVoiceProfile: {
      profileId: 'profile-1',
      clipId: 'ref-1',
      targetPreset: 'cute-feminine',
      analysisVersion: referenceVersion,
      pitchFloorHz: 180,
      pitchCeilingHz: 220,
      resonanceFloor: 0.4,
      resonanceCeiling: 0.65,
      weightFloor: 0.2,
      weightCeiling: 0.45,
      metrics: { advanced: { formantLite: { f2MedianHz: 2100 } } },
    },
    lastSummary: {
      analysisVersion: takeVersion,
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
      metrics: {
        meanPitchHz: 160,
        resonanceMean: 0.25,
        weightMean: 0.58,
        advanced: {
          medianPitchHz: 160,
          scoreConfidence: 0.9,
          captureReliability: 0.9,
          voicedFramePct: 0.9,
          confidentFramePct: 0.9,
          pitchValidFrameCount: 80,
          measurementAvailable: true,
          snrDb: 24,
          clippingPct: 0,
          formantLite: { f2MedianHz: 1700 },
        },
      },
    },
    lastAttemptArtifact: {
      attemptArtifactId: 'attempt-1',
      finalizedAt: Date.now(),
      repContext: { kind: 'phrase', drillId: 'task-1' },
    },
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

test('reference target confidence follows the uploaded clip quality verdict', () => {
  assert.equal(referenceTargetConfidence(referenceVoiceState({ verdict: 'good' })), 0.9);
  assert.equal(referenceTargetConfidence(referenceVoiceState({ verdict: 'usable' })), 0.7);
  assert.equal(referenceTargetConfidence(referenceVoiceState({ verdict: 'reject' })), 0);
  assert.equal(referenceTargetConfidence({ referenceAnalysis: {} }), 0.6);
});

test('adapter consumes the canonical metric contract and carries provenance', () => {
  const state = referenceVoiceState();
  const context = buildCanonicalMetricContext(state);
  assert.equal(context.contract.hasTargetContract, true);
  assert.equal(context.usability.usableForScoring, true);
  const observations = legacyObservationsFromVoiceState(state);
  const pitch = observations.find((item) => item.dimension === 'pitch.register');
  assert.equal(pitch.attemptArtifactId, 'attempt-1');
  assert.equal(pitch.taskId, 'task-1');
  assert.equal(pitch.takeKind, 'phrase');
  assert.ok(pitch.target.targetKey);
  assert.equal(isUsableObservation(pitch), true);
});

test('matching analyzer versions allow coarse reference timbre but not clip-wide formants without context', () => {
  const observations = legacyObservationsFromVoiceState(referenceVoiceState());
  const resonance = observations.find((item) => item.dimension === 'resonance.legacy_proxy');
  const f2 = observations.find((item) => item.dimension === 'resonance.global_scale');
  assert.equal(resonance.metadata.calibrationComparable, true);
  assert.equal(isUsableObservation(resonance), true);
  assert.equal(f2.metadata.calibrationComparable, true);
  assert.ok(f2.flags.includes('context_not_comparable'));
  assert.equal(isUsableObservation(f2), false);
});

test('a bare formants=true assertion cannot unlock clip-wide F2 without verified context', () => {
  const observations = legacyObservationsFromVoiceState(referenceVoiceState(), {
    contextComparability: { formants: true },
  });
  const f2 = observations.find((item) => item.dimension === 'resonance.global_scale');
  assert.ok(f2.flags.includes('context_not_comparable'));
  assert.equal(isUsableObservation(f2), false);
});

test('verified controlled context can make F2 rankable and stamps comparison identity', () => {
  const observations = legacyObservationsFromVoiceState(referenceVoiceState(), {
    contextComparability: verifiedFormantContext(),
  });
  const f2 = observations.find((item) => item.dimension === 'resonance.global_scale');
  assert.equal(f2.metadata.contextComparable, true);
  assert.equal(f2.metadata.controlledProbeId, 'vowel.ee.steady.v1');
  assert.equal(f2.metadata.comparisonContextKey, 'ee-steady-same-note-v1');
  assert.equal(f2.flags.includes('context_not_comparable'), false);
  assert.equal(normalizeObservation(f2).comparisonContextKey, 'ee-steady-same-note-v1');
  assert.equal(isUsableObservation(f2), true);
});

test('stale reference calibration suppresses timbre but keeps pitch comparable', () => {
  const state = referenceVoiceState({
    referenceVersion: 'voice-metrics-v3',
    takeVersion: 'voice-metrics-v4-formants',
  });
  const observations = legacyObservationsFromVoiceState(state, {
    contextComparability: verifiedFormantContext(),
  });
  const pitch = observations.find((item) => item.dimension === 'pitch.register');
  const resonance = observations.find((item) => item.dimension === 'resonance.legacy_proxy');
  const weight = observations.find((item) => item.dimension === 'phonation.legacy_weight_proxy');
  const f2 = observations.find((item) => item.dimension === 'resonance.global_scale');
  assert.equal(pitch.flags.includes('analysis_version_mismatch'), false);
  assert.equal(isUsableObservation(pitch), true);
  for (const item of [resonance, weight, f2]) {
    assert.equal(item.flags.includes('analysis_version_mismatch'), true);
    assert.equal(item.metadata.calibrationComparable, false);
    assert.equal(isUsableObservation(item), false);
  }
});

test('a rejected uploaded reference cannot drive target coaching', () => {
  const observations = legacyObservationsFromVoiceState(referenceVoiceState({ verdict: 'reject' }));
  assert.ok(observations.length >= 3);
  assert.ok(observations.every((item) => item.target.confidence === 0));
  assert.ok(observations.every((item) => isUsableObservation(item) === false));
});

test('canonical channel-health failures become explicit invalidating flags', () => {
  const state = referenceVoiceState();
  state.lastSummary.metrics.advanced.snrDb = 7;
  state.lastSummary.metrics.advanced.clippingPct = 0.08;
  const observations = legacyObservationsFromVoiceState(state);
  assert.ok(observations.every((item) => item.flags.includes('low_snr')));
  assert.ok(observations.every((item) => item.flags.includes('sustained_clipping')));
  assert.ok(observations.every((item) => isUsableObservation(item) === false));
});

test('stale take evidence produces no v3 observations', () => {
  const state = referenceVoiceState();
  state.sessionStartedAt = 20_000;
  state.lastAttemptArtifact.finalizedAt = 10_000;
  const adapted = legacyObservationsFromVoiceState(state, { returnContext: true });
  assert.equal(adapted.canonicalContext.freshness.fresh, false);
  assert.equal(adapted.observations.length, 0);
});
