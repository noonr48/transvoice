'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  classifyDetectorAuthority,
  filterDetectorAuthoritativeObservations,
} = require('./detector-authority');

const ANALYSIS_VERSION = 'voice-metrics-v4-formants';

function baseObservation(overrides = {}) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: ANALYSIS_VERSION,
    dimension: 'pitch.register',
    value: 160,
    unit: 'Hz',
    confidence: { signal: 0.92, extractor: 0.92, target: 0.92 },
    target: {
      low: 180,
      high: 220,
      scale: 1,
      source: 'reference',
      targetKey: 'target-1',
      confidence: 0.92,
    },
    persistenceCount: 2,
    flags: [],
    taskId: 'task-1',
    takeKind: 'phrase',
    metadata: {
      targetScaleUnit: 'semitone',
      detectorFamily: 'yin',
      pitchValidFrameCount: 40,
      hitPitchCeiling: false,
    },
    ...overrides,
  };
}

function completeFormantEvidence(overrides = {}) {
  return {
    analysisWindowCount: 12,
    validWindowCount: 10,
    validWindowPct: 10 / 12,
    f2IqrHz: 95,
    f2MadHz: 42,
    medianWindowPitchHz: 182,
    maxWindowPitchHz: 198,
    ...overrides,
  };
}

function formantObservation(formantEvidence = completeFormantEvidence()) {
  return baseObservation({
    metricId: 'formant_lite.f2_median_hz',
    dimension: 'resonance.global_scale',
    value: 1750,
    unit: 'Hz',
    target: {
      low: 2050,
      high: 2250,
      scale: 100,
      source: 'reference',
      targetKey: 'target-1',
      confidence: 0.92,
    },
    takeKind: 'sustained',
    contextKind: 'controlled_probe_formant',
    comparisonContextKey: 'ee-steady-same-note-v1',
    metadata: {
      contextComparable: true,
      controlledProbeId: 'vowel.ee.steady.v1',
      comparisonContextKey: 'ee-steady-same-note-v1',
      detectorFamily: 'lpc_formant_lite_v4',
      formantEvidence,
    },
  });
}

function futureValidatedRegistry() {
  return {
    [ANALYSIS_VERSION]: {
      lpc_formant_lite_v4: {
        validationId: 'formant-held-out-human-v1',
        status: 'held_out_human_validated',
        decisionEligible: true,
        activeReleaseEligible: true,
        humanBenchmarkRequired: false,
        evidenceBasis: ['held_out_human_expert_formant_corpus'],
        pendingEvidence: [],
      },
    },
  };
}

test('well-supported YIN pitch may drive shadow decisions but is not release-certified', () => {
  const authority = classifyDetectorAuthority(baseObservation());
  assert.equal(authority.authority, 'authoritative');
  assert.equal(authority.reason, null);
  assert.equal(authority.evidence.detectorFamily, 'yin');
  assert.equal(authority.evidence.pitchValidFrameCount, 40);
  assert.equal(authority.validation.status, 'synthetic_regression_validated');
  assert.equal(authority.activeReleaseEligible, false);
});

test('unknown analysis version cannot inherit YIN validation', () => {
  const authority = classifyDetectorAuthority(baseObservation({
    metricDefinitionVersion: 'voice-metrics-future-unknown',
  }));
  assert.equal(authority.authority, 'exploratory');
  assert.equal(authority.reason, 'pitch_detector_validation_registry_missing');
});

test('pitch tracker ceiling saturation prevents exact beginner authority', () => {
  const observation = baseObservation();
  observation.metadata.hitPitchCeiling = true;
  const authority = classifyDetectorAuthority(observation);
  assert.equal(authority.authority, 'exploratory');
  assert.equal(authority.reason, 'pitch_tracker_ceiling_reached');
});

test('short pitch evidence remains measurable but exploratory', () => {
  const observation = baseObservation();
  observation.metadata.pitchValidFrameCount = 8;
  const authority = classifyDetectorAuthority(observation);
  assert.equal(authority.authority, 'exploratory');
  assert.equal(authority.reason, 'pitch_detector_evidence_too_short');
});

test('invalid capture is unavailable rather than merely exploratory', () => {
  const observation = baseObservation({ flags: ['low_snr'] });
  const authority = classifyDetectorAuthority(observation);
  assert.equal(authority.authority, 'unavailable');
  assert.equal(authority.reason, 'low_snr');
});

test('verified controlled F2 remains exploratory while human validation is pending', () => {
  const authority = classifyDetectorAuthority(formantObservation());
  assert.equal(authority.authority, 'exploratory');
  assert.equal(authority.reason, 'formant_detector_not_validated_for_shadow_decision');
  assert.equal(authority.validation.status, 'research_only_pending_human_validation');
  assert.equal(authority.activeReleaseEligible, false);
});

test('formant medians without yield and dispersion evidence are not authoritative', () => {
  const authority = classifyDetectorAuthority(formantObservation({
    analysisWindowCount: 12,
    validWindowCount: 10,
  }));
  assert.equal(authority.authority, 'exploratory');
  assert.equal(authority.reason, 'formant_reliability_evidence_incomplete');
});

test('DSP-emitted validation booleans cannot self-certify a formant detector', () => {
  const authority = classifyDetectorAuthority(formantObservation({
    ...completeFormantEvidence(),
    validationStatus: 'validated',
    validationId: 'SELF-CERTIFIED-BY-DSP',
    authorityEligible: true,
  }));
  assert.equal(authority.authority, 'exploratory');
  assert.equal(authority.reason, 'formant_detector_not_validated_for_shadow_decision');
  assert.notEqual(authority.validation.validationId, 'SELF-CERTIFIED-BY-DSP');
});

test('a future external held-out validation registry has an explicit path to formant authority', () => {
  const authority = classifyDetectorAuthority(formantObservation(), {
    validationRegistry: futureValidatedRegistry(),
  });
  assert.equal(authority.authority, 'authoritative');
  assert.equal(authority.reason, null);
  assert.equal(authority.activeReleaseEligible, true);
  assert.equal(authority.validation.validationId, 'formant-held-out-human-v1');
});

test('filter preserves exploratory evidence but exposes only shadow-authoritative observations', () => {
  const resonance = formantObservation();
  const quality = baseObservation({
    metricId: 'quality.cpps_like',
    dimension: 'phonation.periodicity',
    value: 7,
    unit: 'dB_like',
    target: { low: 9, scale: 2, source: 'reference', targetKey: 'target-1', confidence: 0.92 },
    metadata: {},
  });
  const filtered = filterDetectorAuthoritativeObservations([
    baseObservation(),
    resonance,
    quality,
  ]);
  assert.equal(filtered.authoritative.length, 1);
  assert.equal(filtered.authoritative[0].dimension, 'pitch.register');
  assert.equal(filtered.exploratory.length, 2);
  assert.equal(filtered.unavailable.length, 0);
  assert.ok(Object.keys(filtered.authorityByComparisonKey).length >= 2);
});
