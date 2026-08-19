'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESEARCH_ONLY_DIMENSIONS,
  eligibleObservationsForPhase,
  isMetricEligibleForPhase,
} = require('./metric-eligibility');
const {
  CURRICULUM_PHASES,
  normalizeCurriculumPhase,
} = require('./feminization-v1-policy');

function pitchObservation(value = 140) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value,
    unit: 'Hz',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    flags: [],
    metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40, hitPitchCeiling: false },
  };
}

test('pitch phase rejects breathiness even with a huge target gap', () => {
  const breathy = {
    ...pitchObservation(0.95),
    metricId: 'phonation.breathiness',
    dimension: 'phonation.breathiness',
    target: { low: 0.4, high: 0.6, scale: 0.1, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    importance: 1,
    controllability: 1,
  };
  const result = eligibleObservationsForPhase([breathy, pitchObservation()], { phase: 'pitch_foundation' });
  assert.equal(result.eligible.length, 1);
  assert.equal(result.eligible[0].dimension, 'pitch.register');
  assert.ok(result.rejected.some((item) => item.dimension === 'phonation.breathiness'
    && item.reason === 'metric_not_beginner_coaching_authority'));
});

test('pitch phase rejects prosody and legacy weight', () => {
  const prosody = { ...pitchObservation(), dimension: 'prosody.phrase_ending', metricId: 'prosody.phrase_ending' };
  const legacyWeight = { ...pitchObservation(), dimension: 'phonation.legacy_weight_proxy', metricId: 'phonation.legacy_weight_proxy' };
  const result = eligibleObservationsForPhase([prosody, legacyWeight], { phase: 'pitch_foundation' });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.rejected.length, 2);
});

test('resonance phase rejects formants without verified controlled context', () => {
  const unverified = {
    ...pitchObservation(0.3),
    dimension: 'resonance.global_scale',
    metricId: 'resonance.global_scale',
    takeKind: 'phrase',
  };
  const result = eligibleObservationsForPhase([unverified], { phase: 'resonance_foundation' });
  assert.equal(result.eligible.length, 0);
  assert.equal(result.rejected[0].reason, 'controlled_resonance_context_not_verified');
});

test('resonance phase accepts formants with verified controlled context', () => {
  const verified = {
    ...pitchObservation(0.3),
    dimension: 'resonance.global_scale',
    metricId: 'resonance.global_scale',
    contextKind: 'controlled_probe_formant',
    takeKind: 'sustained_vowel',
    comparisonContextKey: 'ee-steady-same-note-v1',
    metadata: {
      ...pitchObservation().metadata,
      contextComparable: true,
      controlledProbeId: 'vowel.ee.steady.v1',
      comparisonContextKey: 'ee-steady-same-note-v1',
    },
  };
  assert.equal(isMetricEligibleForPhase(verified, { phase: 'resonance_foundation' }), true);
});

test('research-only metrics remain shadow-only in every phase', () => {
  assert.ok(RESEARCH_ONLY_DIMENSIONS.includes('phonation.breathiness'));
  assert.ok(RESEARCH_ONLY_DIMENSIONS.includes('phonation.source_weight'));
  for (const phase of CURRICULUM_PHASES) {
    const research = {
      ...pitchObservation(),
      dimension: 'phonation.source_weight',
      metricId: 'phonation.source_weight',
    };
    assert.equal(isMetricEligibleForPhase(research, { phase }), false, phase);
  }
});

test('unknown phase normalizes rather than throwing', () => {
  const result = eligibleObservationsForPhase([pitchObservation()], { phase: 'not-a-phase' });
  assert.equal(result.phase, normalizeCurriculumPhase('not-a-phase'));
  assert.equal(result.eligible.length, 1);
});
