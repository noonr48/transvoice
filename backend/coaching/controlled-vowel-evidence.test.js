'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTROLLED_VOWEL_EVIDENCE_SCHEMA,
  buildControlledVowelEvidence,
  DEFAULT_HIGH_F0_RISK_HZ,
  MIN_STABLE_SEGMENT_MS,
} = require('./controlled-vowel-evidence');
const {
  DEFAULT_DETECTOR_VALIDATION_REGISTRY,
  normalizeValidationEntry,
} = require('./detector-validation-registry');

function formants({ f0 = 220, f1 = 300, f2 = 2200, f3 = 2900, f4 = null } = {}) {
  const out = {
    f1: { valueHz: f1, confidence: 0.9 },
    f2: { valueHz: f2, confidence: 0.85 },
    f3: { valueHz: f3, confidence: 0.8 },
  };
  if (f4 != null) out.f4 = { valueHz: f4, confidence: 0.7 };
  return out;
}

function bundle(overrides = {}) {
  return {
    probeId: 'vowel.ee.steady.v1',
    languagePackId: 'en-AU-feminization-foundations-v1',
    attemptArtifactId: 'attempt-1',
    recordingContextId: 'rec-ctx-1',
    analyzerVersion: 'voice-metrics-v4-formants',
    analysisProfile: 'standard',
    contextKind: 'controlled_probe_formant',
    comparisonContextKey: 'ee-steady-same-note-v1',
    contextComparable: true,
    promptMatched: true,
    promptConfidence: 0.92,
    stableSegment: { startMs: 210, endMs: 420, confidence: 0.88 },
    f0MedianHz: 220,
    formants: formants(),
    reliability: {
      detectorFamily: 'lpc_formant_lite_v4',
      analysisWindowCount: 14,
      validWindowCount: 11,
      validWindowPct: 0.786,
      f2IqrHz: 95,
      f2MadHz: 42,
      medianWindowPitchHz: 220,
      maxWindowPitchHz: 232,
    },
    trackContinuity: { gapCount: 0, maxGapMs: 0, ok: true },
    estimates: {
      f1: [300, 305, 298],
      f2: [2200, 2218, 2190],
      f3: [2900, 2940, 2880],
    },
    ...overrides,
  };
}

function releaseValidatedRegistry() {
  return {
    ...DEFAULT_DETECTOR_VALIDATION_REGISTRY,
    'voice-metrics-v4-formants': {
      ...DEFAULT_DETECTOR_VALIDATION_REGISTRY['voice-metrics-v4-formants'],
      lpc_formant_lite_v4: normalizeValidationEntry({
        validationId: 'lpc-formant-human-benchmark-test-v1',
        status: 'human_benchmark_validated',
        decisionEligible: true,
        activeReleaseEligible: true,
        humanBenchmarkRequired: true,
        evidenceBasis: ['held_out_human_expert_formant_corpus'],
        pendingEvidence: [],
      }),
    },
  };
}

test('complete evidence with a release-validated detector is validForCoaching', () => {
  const evidence = buildControlledVowelEvidence(bundle(), {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.schema, CONTROLLED_VOWEL_EVIDENCE_SCHEMA);
  assert.equal(evidence.validForCoaching, true);
  assert.deepEqual(evidence.invalidityReasons, []);
  assert.equal(evidence.probeId, 'vowel.ee.steady.v1');
  assert.equal(evidence.languagePackId, 'en-AU-feminization-foundations-v1');
  assert.equal(evidence.stableSegment.durationMs, 210);
  assert.equal(evidence.f0MedianHz, 220);
  assert.equal(evidence.formants.f1.valueHz, 300);
  assert.equal(evidence.formants.f4, null);
  assert.equal(evidence.estimatorAgreement.agreementOk, true);
  assert.equal(evidence.highF0Risk, 'nominal');
  assert.equal(evidence.promptMatched, true);
});

test('missing or short stable segment fails closed', () => {
  const missing = buildControlledVowelEvidence(
    bundle({ stableSegment: null }),
    { validationRegistry: releaseValidatedRegistry() },
  );
  assert.equal(missing.validForCoaching, false);
  assert.ok(missing.invalidityReasons.includes('stable_segment_missing'));

  const short = buildControlledVowelEvidence(
    bundle({ stableSegment: { startMs: 210, endMs: 300, confidence: 0.9 } }),
    { validationRegistry: releaseValidatedRegistry() },
  );
  assert.equal(short.validForCoaching, false);
  assert.ok(short.invalidityReasons.includes('stable_segment_too_short'));
  assert.ok(MIN_STABLE_SEGMENT_MS >= 100);
});

test('every formant F1-F3 must carry a value and confidence', () => {
  const noF3 = bundle();
  delete noF3.formants.f3;
  const evidence = buildControlledVowelEvidence(noF3, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('formant_value_missing'));

  const noConf = bundle({ formants: { ...formants(), f2: { valueHz: 2200 } } });
  const evidence2 = buildControlledVowelEvidence(noConf, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence2.validForCoaching, false);
  assert.ok(evidence2.invalidityReasons.includes('per_formant_confidence_missing'));
});

test('high F0 marks elevated risk and fails closed for coaching', () => {
  assert.ok(DEFAULT_HIGH_F0_RISK_HZ >= 280);
  const high = buildControlledVowelEvidence(
    bundle({ f0MedianHz: 340, reliability: { ...bundle().reliability, medianWindowPitchHz: 340, maxWindowPitchHz: 355 } }),
    { validationRegistry: releaseValidatedRegistry() },
  );
  assert.equal(high.highF0Risk, 'elevated');
  assert.equal(high.validForCoaching, false);
  assert.ok(high.invalidityReasons.includes('high_f0_reliability_risk'));
});

test('estimator disagreement fails closed', () => {
  const disagree = bundle({ estimates: { f1: [300, 380, 298], f2: [2200, 2218, 2190], f3: [2900, 2940, 2880] } });
  const evidence = buildControlledVowelEvidence(disagree, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.estimatorAgreement.agreementOk, false);
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('estimator_disagreement'));
});

test('single-estimator evidence is retained but never coaching-valid', () => {
  const single = bundle({ estimates: { f1: [300], f2: [2200], f3: [2900] } });
  const evidence = buildControlledVowelEvidence(single, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('estimator_agreement_unavailable'));
  assert.equal(evidence.formants.f1.valueHz, 300); // retained as research evidence
});

test('unverified controlled context fails closed', () => {
  const badContext = bundle({ contextComparable: false });
  const evidence = buildControlledVowelEvidence(badContext, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('controlled_context_not_verified'));

  const wrongKind = bundle({ contextKind: 'phrase' });
  const evidence2 = buildControlledVowelEvidence(wrongKind, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence2.validForCoaching, false);
  assert.ok(evidence2.invalidityReasons.includes('controlled_context_not_verified'));
});

test('prompt mismatch fails closed', () => {
  const mismatch = bundle({ promptMatched: false, promptConfidence: 0.3 });
  const evidence = buildControlledVowelEvidence(mismatch, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('prompt_not_matched'));
});

test('default registry: formants stay research-only until human validation', () => {
  const evidence = buildControlledVowelEvidence(bundle());
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('detector_not_release_validated'));
  assert.equal(evidence.detectorValidation.activeReleaseEligible, false);
  // Still complete research evidence:
  assert.equal(evidence.formants.f2.valueHz, 2200);
});

test('optional F4 is recorded when present', () => {
  const withF4 = bundle({ formants: formants({ f4: 3600 }) });
  const evidence = buildControlledVowelEvidence(withF4, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.formants.f4.valueHz, 3600);
  assert.equal(evidence.validForCoaching, true);
});

test('reliability evidence must be complete (window counts, dispersion, pitch context)', () => {
  const incomplete = bundle({ reliability: { ...bundle().reliability, f2IqrHz: null } });
  const evidence = buildControlledVowelEvidence(incomplete, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('reliability_evidence_incomplete'));
});

test('malformed input never throws — it fails closed with schema_invalid', () => {
  const evidence = buildControlledVowelEvidence(null);
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('input_bundle_invalid'));
  const garbage = buildControlledVowelEvidence('not-an-object');
  assert.equal(garbage.validForCoaching, false);
});

test('F1 kill: null F0 can never be valid — unknown is not zero', () => {
  const noF0 = bundle({ f0MedianHz: null });
  const evidence = buildControlledVowelEvidence(noF0, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('f0_median_missing'));
  assert.equal(evidence.highF0Risk, 'nominal'); // window witnesses 232Hz are below the line; the record fails closed on f0_median_missing regardless
});

test('F1 kill: low take-median cannot mask a high-pitch analysis context', () => {
  const masked = bundle({
    f0MedianHz: 200,
    reliability: { ...bundle().reliability, medianWindowPitchHz: 200, maxWindowPitchHz: 355 },
  });
  const evidence = buildControlledVowelEvidence(masked, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.highF0Risk, 'elevated');
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('high_f0_reliability_risk'));
});

test('F1 kill: take median inconsistent with window pitch witnesses fails closed', () => {
  const inconsistent = bundle({
    f0MedianHz: 200,
    reliability: { ...bundle().reliability, medianWindowPitchHz: 320 },
  });
  const evidence = buildControlledVowelEvidence(inconsistent, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('f0_pitch_context_inconsistent'));
});

test('F4 kill: missing evidence identity fails closed', () => {
  const anonymous = bundle({ recordingContextId: null });
  const evidence = buildControlledVowelEvidence(anonymous, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('evidence_identity_missing'));
});

test('F2: track continuity is required and degraded continuity fails closed', () => {
  const degraded = bundle({ trackContinuity: { gapCount: 3, maxGapMs: 90, ok: false } });
  const evidence = buildControlledVowelEvidence(degraded, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence.validForCoaching, false);
  assert.ok(evidence.invalidityReasons.includes('track_continuity_degraded'));

  const missing = bundle({ trackContinuity: null });
  const evidence2 = buildControlledVowelEvidence(missing, {
    validationRegistry: releaseValidatedRegistry(),
  });
  assert.equal(evidence2.validForCoaching, false);
  assert.ok(evidence2.invalidityReasons.includes('track_continuity_missing'));
});
