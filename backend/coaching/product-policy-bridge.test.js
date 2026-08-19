'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applyProductPolicyToBridge, GENERIC_RESEARCH_DOMAIN } = require('./product-policy-bridge');

const ANALYSIS_VERSION = 'voice-metrics-v4-formants';

function obs(dimension, value, target, overrides = {}) {
  return {
    metricId: dimension,
    metricDefinitionVersion: ANALYSIS_VERSION,
    dimension,
    value,
    unit: dimension.startsWith('pitch.') ? 'Hz' : 'score',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { ...target, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    persistenceCount: 2,
    importance: 0.8,
    controllability: 0.8,
    flags: [],
    taskId: 'task-1',
    takeKind: 'phrase',
    ...overrides,
  };
}

function pitch() {
  return obs('pitch.register', 140, { low: 180, high: 220, scale: 1 }, {
    metricId: 'pitch.median_hz',
    metadata: {
      targetScaleUnit: 'semitone',
      detectorFamily: 'yin',
      pitchValidFrameCount: 40,
      hitPitchCeiling: false,
    },
  });
}

function breathiness() {
  return obs('phonation.breathiness', 0.9, { high: 0.4, scale: 0.1 });
}

function controlledResonance() {
  return obs('resonance.global_scale', 1700, { low: 2050, high: 2250, scale: 100 }, {
    metricId: 'formant_lite.f2_median_hz',
    unit: 'Hz',
    takeKind: 'sustained',
    contextKind: 'controlled_probe_formant',
    comparisonContextKey: 'ee-steady-same-note-v1',
    metadata: {
      contextComparable: true,
      controlledProbeId: 'vowel.ee.steady.v1',
      comparisonContextKey: 'ee-steady-same-note-v1',
      detectorFamily: 'lpc_formant_lite_v4',
      formantEvidence: {
        analysisWindowCount: 12,
        validWindowCount: 10,
        validWindowPct: 10 / 12,
        f2IqrHz: 90,
        f2MadHz: 40,
        medianWindowPitchHz: 182,
        maxWindowPitchHz: 198,
      },
    },
  });
}

function futureFormantRegistry() {
  return {
    [ANALYSIS_VERSION]: {
      lpc_formant_lite_v4: {
        validationId: 'formant-held-out-human-v1',
        status: 'held_out_human_validated',
        decisionEligible: true,
        activeReleaseEligible: true,
        humanBenchmarkRequired: false,
      },
    },
  };
}

test('feminization_v1 keeps research evidence but removes research-only metrics from decision authority', () => {
  const source = {
    observations: [breathiness(), pitch()],
    decision: { status: 'legacy-placeholder' },
    error: null,
  };
  const bridge = applyProductPolicyToBridge(source, {
    curriculumPhase: 'pitch_foundation',
    stage: 'phrase',
  });
  assert.equal(bridge.observations.length, 2);
  assert.equal(bridge.productPolicy.domainEligibleObservationCount, 1);
  assert.equal(bridge.productPolicy.decisionObservationCount, 1);
  assert.equal(bridge.productPolicy.excludedObservationCount, 1);
  assert.equal(bridge.decision.status, 'coach');
  assert.equal(bridge.decision.focus.dimension, 'pitch.register');
  assert.equal(bridge.productPolicy.selectedDetectorAuthority.authority, 'authoritative');
  assert.equal(bridge.productPolicy.selectedDetectorAuthority.activeReleaseEligible, false);
  assert.equal(bridge.productPolicy.selectedDetectorAuthority.validationStatus, 'synthetic_regression_validated');
  assert.ok(bridge.productPolicy.exclusionReasons.metric_not_beginner_coaching_authority >= 1);
});

test('resonance is unavailable in pitch foundation even if a future detector registry validates it', () => {
  const bridge = applyProductPolicyToBridge({
    observations: [controlledResonance()],
    error: null,
  }, {
    curriculumPhase: 'pitch_foundation',
    stage: 'sound',
    detectorAuthorityOptions: { validationRegistry: futureFormantRegistry() },
  });
  assert.equal(bridge.decision.status, 'no_reliable_gap');
  assert.equal(bridge.productPolicy.domainEligibleObservationCount, 0);
  assert.equal(bridge.productPolicy.decisionObservationCount, 0);
});

test('controlled resonance remains exploratory while held-out human validation is pending', () => {
  const bridge = applyProductPolicyToBridge({
    observations: [controlledResonance()],
    error: null,
  }, {
    curriculumPhase: 'resonance_foundation',
    stage: 'sound',
  });
  assert.equal(bridge.productPolicy.domainEligibleObservationCount, 1);
  assert.equal(bridge.productPolicy.decisionObservationCount, 0);
  assert.equal(bridge.productPolicy.detectorExploratoryCount, 1);
  assert.equal(bridge.decision.status, 'no_reliable_gap');
  assert.equal(
    bridge.productPolicy.detectorExclusionReasons.formant_detector_not_validated_for_shadow_decision,
    1,
  );
});

test('future external formant validation has an explicit path to beginner shadow and release authority', () => {
  const bridge = applyProductPolicyToBridge({
    observations: [controlledResonance()],
    error: null,
  }, {
    curriculumPhase: 'resonance_foundation',
    stage: 'sound',
    detectorAuthorityOptions: { validationRegistry: futureFormantRegistry() },
  });
  assert.equal(bridge.productPolicy.domainEligibleObservationCount, 1);
  assert.equal(bridge.productPolicy.decisionObservationCount, 1);
  assert.equal(bridge.decision.status, 'coach');
  assert.equal(bridge.decision.focus.dimension, 'resonance.global_scale');
  assert.equal(bridge.productPolicy.selectedDetectorAuthority.activeReleaseEligible, true);
  assert.equal(bridge.productPolicy.selectedDetectorAuthority.validationId, 'formant-held-out-human-v1');
});

test('generic research domain preserves the original decision and complete authority surface', () => {
  const source = {
    observations: [breathiness(), pitch()],
    decision: { status: 'research-decision' },
    error: null,
  };
  const bridge = applyProductPolicyToBridge(source, {
    productDomain: GENERIC_RESEARCH_DOMAIN,
  });
  assert.equal(bridge.decision.status, 'research-decision');
  assert.equal(bridge.productPolicy.decisionObservationCount, 2);
  assert.equal(bridge.productPolicy.excludedObservationCount, 0);
  assert.equal(bridge.productPolicy.selectedDetectorAuthority, null);
});

test('bridge errors are not reinterpreted by product policy', () => {
  const source = { observations: [pitch()], decision: null, error: { code: 'boom' } };
  assert.equal(applyProductPolicyToBridge(source), source);
});
