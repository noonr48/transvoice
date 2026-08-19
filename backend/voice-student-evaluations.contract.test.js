'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildVoiceStudentModelEvaluations } = require('./voice-student-evaluations');

const CONCEPTS = {
  voice_pitch_center: 'Pitch center',
  voice_target_zone_accuracy: 'Target-zone accuracy',
  voice_resonance_brightness: 'Resonance placement',
  voice_light_vocal_weight: 'Vocal weight',
  voice_playful_intonation: 'Intonation range',
  voice_reference_matching: 'Reference matching',
};

function evaluate(summary, voiceState = {}) {
  return buildVoiceStudentModelEvaluations({
    summary,
    voiceState,
    thresholds: {
      minPitchHz: 195,
      minTargetHitPct: 0.42,
      minResonanceMean: 0.58,
      maxWeightMean: 0.6,
      minPitchRangeSt: 2.8,
      minSimilarityScore: 0.58,
      minPhraseMatchScore: 0.56,
    },
    concepts: CONCEPTS,
  });
}

function byId(evaluations, conceptId) {
  return evaluations.find((entry) => entry.conceptId === conceptId);
}

test('measurement-unavailable attempt produces no learner-model evaluations', () => {
  const evaluations = evaluate({
    metrics: {
      meanPitchHz: 201.5,
      resonanceMean: 0.58,
      weightMean: 0.42,
      targetHitPct: 0.8,
      advanced: {
        measurementAvailable: false,
        measurementRejectionReasons: ['no_voiced_frames'],
      },
    },
  });
  assert.deepEqual(evaluations, []);
});

test('one-frame degraded attempt produces no learner-model evaluations', () => {
  const evaluations = evaluate({
    metrics: {
      meanPitchHz: 205,
      pitchRangeSt: 4,
      resonanceMean: 0.7,
      weightMean: 0.3,
      targetHitPct: 1,
      similarityScore: 0.9,
      advanced: {
        measurementAvailable: true,
        pitchValidFrameCount: 1,
        voicedFramePct: 0.01,
        scoreConfidence: 0.05,
        reliabilityFlags: ['low_voiced_coverage', 'low_score_confidence'],
      },
    },
  });
  assert.deepEqual(evaluations, []);
});

// RETAINED with the retired `direction: 'masculine'` on purpose (2026-07-26):
// the invariant is that EXACT custom bands are the authority and the direction
// field is not consulted, which is what keeps a stored FTM take scored correctly.
test('exact dark/heavy custom target bands are learner-model authority', () => {
  const evaluations = evaluate({
    targetPreset: 'masculine',
    metrics: {
      meanPitchHz: 120,
      pitchRangeSt: 2.0,
      resonanceMean: 0.2,
      weightMean: 0.7,
      targetHitPct: 0.35,
      similarityScore: 0.56,
      advanced: { measurementAvailable: true, reliabilityFlags: [] },
    },
    target: {
      source: 'custom-handmade',
      targetProfileId: 'grounded-custom',
      targetPreset: 'masculine',
      direction: 'masculine',
      pitchFloorHz: 100,
      pitchCeilingHz: 140,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
      minTargetHitPct: 0.3,
      minPitchRangeSt: 1.8,
      minSimilarityScore: 0.55,
    },
  }, { targetVoiceProfile: { profileId: 'grounded-custom' } });

  for (const conceptId of [
    'voice_pitch_center',
    'voice_target_zone_accuracy',
    'voice_resonance_brightness',
    'voice_light_vocal_weight',
    'voice_playful_intonation',
    'voice_reference_matching',
  ]) {
    assert.equal(byId(evaluations, conceptId)?.correct, true, conceptId);
  }
  assert.equal(byId(evaluations, 'voice_resonance_brightness')?.conceptName, 'Target resonance placement');
  assert.equal(byId(evaluations, 'voice_light_vocal_weight')?.conceptName, 'Target vocal weight');
  assert.equal(byId(evaluations, 'voice_playful_intonation')?.conceptName, 'Intonation range');
});

test('neutral custom bands reject values on either coordinate side', () => {
  const evaluations = evaluate({
    targetPreset: 'gender-neutral',
    metrics: {
      meanPitchHz: 160,
      resonanceMean: 0.2,
      weightMean: 0.55,
      targetHitPct: 0.5,
      advanced: { measurementAvailable: true, reliabilityFlags: [] },
    },
    target: {
      source: 'custom-reference',
      targetPreset: 'gender-neutral',
      direction: 'neutral',
      pitchFloorHz: 150,
      pitchCeilingHz: 170,
      resonanceFloor: 0.25,
      resonanceCeiling: 0.35,
      weightFloor: 0.4,
      weightCeiling: 0.5,
      minTargetHitPct: 0.2,
    },
  });

  assert.equal(byId(evaluations, 'voice_resonance_brightness')?.correct, false);
  assert.equal(byId(evaluations, 'voice_light_vocal_weight')?.correct, false);
});

test('explicit null target fields fall back to configured thresholds instead of numeric zero', () => {
  const evaluations = evaluate({
    targetPreset: 'cute-feminine',
    metrics: {
      meanPitchHz: 200,
      pitchRangeSt: 0.1,
      resonanceMean: 0.6,
      weightMean: 0.4,
      targetHitPct: 0.1,
      similarityScore: 0.1,
      advanced: { measurementAvailable: true, reliabilityFlags: [] },
    },
    target: {
      direction: null,
      pitchFloorHz: null,
      pitchCeilingHz: null,
      resonanceFloor: null,
      resonanceCeiling: null,
      weightFloor: null,
      weightCeiling: null,
      minTargetHitPct: null,
      minPitchRangeSt: null,
      minSimilarityScore: null,
    },
  });

  assert.equal(byId(evaluations, 'voice_pitch_center')?.correct, true);
  assert.equal(byId(evaluations, 'voice_target_zone_accuracy')?.correct, false);
  assert.equal(byId(evaluations, 'voice_resonance_brightness')?.correct, true);
  assert.equal(byId(evaluations, 'voice_light_vocal_weight')?.correct, true);
  assert.equal(byId(evaluations, 'voice_playful_intonation')?.correct, false);
  assert.equal(byId(evaluations, 'voice_reference_matching')?.correct, false);
});

// Absence-is-not-zero contract (2026-07-26): an unmeasured risk must neither
// fail the phonation concept nor surface a fabricated "0%" to the learner.
function evaluateQuality(quality) {
  return evaluate(
    {
      metrics: {
        meanPitchHz: 205,
        targetHitPct: 0.8,
        advanced: { measurementAvailable: true, reliabilityFlags: [], quality },
      },
    },
    {
      targetVoiceProfile: {
        advancedBands: { quality: { breathyRiskCeiling: 0.55, strainRiskCeiling: 0.5 } } ,
      },
    },
  );
}

test('unmeasured quality risks produce no phonation evaluation', () => {
  const evaluations = evaluateQuality({ breathyRisk: null, strainRisk: null });
  assert.equal(byId(evaluations, 'voice_easy_phonation'), undefined);
});

test('a one-sided quality measurement names only the measured risk', () => {
  const evaluations = evaluateQuality({ breathyRisk: 0.7, strainRisk: null });
  const phonation = byId(evaluations, 'voice_easy_phonation');
  assert.equal(phonation?.correct, false);
  assert.match(phonation.misconception, /breathy risk is 70%/);
  assert.doesNotMatch(phonation.misconception, /strain/);
});

test('fully measured quality risks keep the two-sided verdict', () => {
  const evaluations = evaluateQuality({ breathyRisk: 0.2, strainRisk: 0.2 });
  const phonation = byId(evaluations, 'voice_easy_phonation');
  assert.equal(phonation?.correct, true);
  assert.match(phonation.misconception, /breathy risk is 20% and strain risk is 20%/);
});
