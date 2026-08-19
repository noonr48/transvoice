'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { legacyObservationsFromVoiceState } = require('./legacy-observation-adapter');
const { classifyDetectorAuthority } = require('./detector-authority');

function state() {
  const version = 'voice-metrics-v4-formants';
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
      metrics: { advanced: { formantLite: { f2MedianHz: 2200 } } },
    },
    lastSummary: {
      analysisVersion: version,
      targetPreset: 'cute-feminine',
      referenceClipId: 'ref-1',
      target: {
        source: 'reference',
        targetPreset: 'cute-feminine',
        targetProfileId: 'profile-1',
        analysisVersion: version,
        pitchFloorHz: 180,
        pitchCeilingHz: 220,
        resonanceFloor: 0.4,
        resonanceCeiling: 0.65,
        weightFloor: 0.2,
        weightCeiling: 0.45,
        referenceF2MedianHz: 2200,
      },
      metrics: {
        meanPitchHz: 160,
        resonanceMean: 0.35,
        weightMean: 0.4,
        advanced: {
          measurementAvailable: true,
          medianPitchHz: 160,
          pitchValidFrameCount: 48,
          voicedFramePct: 0.9,
          confidentFramePct: 0.88,
          scoreConfidence: 0.9,
          captureReliability: 0.92,
          snrDb: 24,
          clippingPct: 0,
          hitPitchCeiling: false,
          analysisProfile: 'standard',
          formantLite: {
            f1MedianHz: 480,
            f2MedianHz: 1780,
            frontnessScore: 0.48,
            analysisWindowCount: 14,
            validWindowCount: 11,
            validWindowPct: 0.786,
            f2IqrHz: 95,
            f2MadHz: 42,
            medianWindowPitchHz: 160,
            maxWindowPitchHz: 164,
          },
        },
      },
    },
    lastAttemptArtifact: {
      attemptArtifactId: 'attempt-1',
      finalizedAt: Date.now(),
      repContext: { kind: 'sustained_vowel', drillId: 'controlled-ee' },
    },
  };
}

test('adapted median pitch carries YIN evidence and can become beginner-authoritative', () => {
  const observations = legacyObservationsFromVoiceState(state());
  const pitch = observations.find((item) => item.metricId === 'pitch.median_hz');
  assert.ok(pitch);
  assert.equal(pitch.metadata.detectorFamily, 'yin');
  assert.equal(pitch.metadata.pitchValidFrameCount, 48);
  assert.equal(pitch.metadata.hitPitchCeiling, false);
  assert.equal(classifyDetectorAuthority(pitch).authority, 'authoritative');
});

test('adapted formant evidence remains descriptive and exploratory without validation witness', () => {
  const observations = legacyObservationsFromVoiceState(state(), {
    contextComparability: {
      formants: true,
      verified: true,
      source: 'controlled_probe_pair',
      probeId: 'vowel.ee.steady.v1',
      comparisonContextKey: 'ee-steady-same-note-v1',
      targetEvidenceKind: 'same_probe_clipwide',
    },
  });
  const f2 = observations.find((item) => item.metricId === 'formant_lite.f2_median_hz');
  assert.ok(f2);
  assert.equal(f2.metadata.formantEvidence.analysisWindowCount, 14);
  assert.equal(f2.metadata.formantEvidence.validWindowCount, 11);
  assert.equal(f2.metadata.formantEvidence.validationStatus, null);
  assert.equal(f2.metadata.formantEvidence.authorityEligible, false);
  const authority = classifyDetectorAuthority(f2);
  assert.equal(authority.authority, 'exploratory');
  assert.equal(authority.reason, 'formant_detector_not_validated_for_shadow_decision');
  assert.equal(authority.validation.validationId, 'lpc-formant-v4-synthetic-regression-v1');
  assert.equal(authority.activeReleaseEligible, false);
});
