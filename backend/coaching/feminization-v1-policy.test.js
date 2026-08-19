'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  OUTCOME_CHANNELS,
  SAFETY_AND_CAPTURE_CHANNELS,
  SCOPE,
  classifyFeminizationV1Observation,
  filterFeminizationV1Observations,
  hasVerifiedControlledResonanceContext,
  metricRole,
  normalizeCurriculumPhase,
} = require('./feminization-v1-policy');

function observation(dimension, overrides = {}) {
  return {
    metricId: dimension,
    dimension,
    takeKind: 'phrase',
    contextKind: 'utterance',
    metadata: {},
    ...overrides,
  };
}

function controlledResonance(dimension = 'resonance.global_scale') {
  return observation(dimension, {
    takeKind: 'sustained',
    contextKind: 'controlled_probe_formant',
    comparisonContextKey: 'ee-steady-same-note-v1',
    metadata: {
      contextComparable: true,
      controlledProbeId: 'vowel.ee.steady.v1',
      comparisonContextKey: 'ee-steady-same-note-v1',
    },
  });
}

test('feminization_v1 is explicitly a beginner MTF spoken-voice scope', () => {
  assert.equal(SCOPE.direction, 'male_to_female');
  assert.equal(SCOPE.audience, 'adult_beginner');
  assert.equal(SCOPE.modality, 'spoken_voice');
  assert.equal(SCOPE.referenceUploadRequired, false);
  assert.equal(SCOPE.aggregateGenderScoreAllowed, false);
  assert.equal(SCOPE.anatomicalInferenceAllowed, false);
  assert.equal(SCOPE.universalPitchThresholdAllowed, false);
  assert.equal(JSON.stringify(SCOPE).match(/\b(180|200|220)\b/), null);
});

test('pitch foundation exposes pitch, not breathiness, weight, prosody, or legacy resonance', () => {
  const result = filterFeminizationV1Observations([
    observation('pitch.register'),
    observation('pitch.lower_edge'),
    observation('phonation.breathiness'),
    observation('phonation.legacy_weight_proxy'),
    observation('resonance.legacy_proxy'),
    observation('prosody.phrase_ending'),
  ], { phase: 'pitch_foundation' });

  assert.deepEqual(result.eligible.map((item) => item.dimension), ['pitch.register']);
  assert.ok(result.excluded.some((item) => item.dimension === 'phonation.breathiness'
    && item.reason === 'metric_not_beginner_coaching_authority'));
  assert.ok(result.excluded.some((item) => item.dimension === 'prosody.phrase_ending'
    && item.reason === 'metric_not_unlocked_for_phase'));
});

test('pitch repeatability unlocks low-tail pitch but not upper-edge chasing', () => {
  const result = filterFeminizationV1Observations([
    observation('pitch.register'),
    observation('pitch.lower_edge'),
    observation('pitch.upper_edge'),
  ], { phase: 'pitch_repeatability' });
  assert.deepEqual(
    result.eligible.map((item) => item.dimension),
    ['pitch.register', 'pitch.lower_edge'],
  );
  assert.equal(metricRole('pitch.upper_edge'), 'supporting');
});

test('resonance coaching requires a positively verified controlled context', () => {
  const arbitrary = observation('resonance.global_scale', {
    metadata: { contextComparable: true },
  });
  assert.equal(hasVerifiedControlledResonanceContext(arbitrary), false);
  assert.equal(
    classifyFeminizationV1Observation(arbitrary, { phase: 'resonance_foundation' }).reason,
    'controlled_resonance_context_not_verified',
  );

  const controlled = controlledResonance();
  assert.equal(hasVerifiedControlledResonanceContext(controlled), true);
  assert.equal(
    classifyFeminizationV1Observation(controlled, { phase: 'resonance_foundation' }).eligible,
    true,
  );
});

test('integration allows pitch plus controlled resonance but still excludes quality proxies', () => {
  const result = filterFeminizationV1Observations([
    observation('pitch.register'),
    controlledResonance('resonance.frontness_proxy'),
    observation('phonation.pressedness'),
    observation('phonation.periodicity'),
  ], { phase: 'integration' });
  assert.deepEqual(
    result.eligible.map((item) => item.dimension),
    ['pitch.register', 'resonance.frontness_proxy'],
  );
});

test('prosody becomes coachable only later and only in supported connected-speech tasks', () => {
  const phrase = observation('prosody.phrase_ending', { takeKind: 'phrase' });
  const vowel = observation('prosody.phrase_ending', { takeKind: 'sustained' });
  assert.equal(classifyFeminizationV1Observation(phrase, { phase: 'integration' }).eligible, false);
  assert.equal(classifyFeminizationV1Observation(phrase, { phase: 'prosody' }).eligible, true);
  assert.equal(
    classifyFeminizationV1Observation(vowel, { phase: 'prosody' }).reason,
    'prosody_context_not_supported',
  );
});

test('safety/capture and outcome channels are separate from coaching metric authority', () => {
  assert.ok(SAFETY_AND_CAPTURE_CHANNELS.includes('reported_pain'));
  assert.ok(SAFETY_AND_CAPTURE_CHANNELS.includes('capture_reliability'));
  assert.ok(OUTCOME_CHANNELS.includes('voice_satisfaction'));
  assert.ok(OUTCOME_CHANNELS.includes('no_feedback_retention'));
  assert.equal(metricRole('reported_pain'), 'unregistered');
  assert.equal(metricRole('voice_satisfaction'), 'unregistered');
});

test('unknown curriculum phases fail toward the beginner pitch foundation', () => {
  assert.equal(normalizeCurriculumPhase('something-new'), 'pitch_foundation');
});
