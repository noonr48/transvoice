'use strict';

// 2026-07-26 — v4 FORMANT REPAIR: the two learner-facing resonance judgments.
//
// CONSUMER 3 (signal-builder buildTargetFit resonance status/evidence) is
// BAND-RELATIVE: it compares `resonanceMean` against the target's own
// `resonanceFloor`/`resonanceCeiling`, both of which the analyzer emits with the
// take and the v4 self-heal refreshes for reference targets. Nothing in it
// encodes a v3 or v4 scale, so it needed no recalibration — these tests are the
// record of that verification, driven with the measured v4 values.
//
// CONSUMER 2 (signal-schema buildReferenceFit) compares the LIVE take against a
// stored reference clip with a fixed +-0.05 tolerance. That tolerance is also
// scale-free — but only while both sides come from the same instrument. The
// formant repair moved front-vowel F2 from a misread ~798 Hz to a true ~2761,
// which moves resonance for an unchanged voice from ~0.0 to ~0.8, so a v3
// reference against a v4 take manufactures a ~0.8 delta and a confident
// "too bright". The runtime's bind-time gate only proves the reference and its
// derived profile agree with EACH OTHER, so a self-consistent pre-v4 pair reaches
// this comparison unflagged. These tests pin the missing half of that gate.
//
// MEASURED v4 values used below (audio_analysis, synthesized vowels, feminine F0
// 180-240 Hz): /i/ 0.800 · /ae/ 0.383-0.461 · /a/ 0.245-0.303 · /u/ 0.000;
// phrase-level resonanceMean 0.355-0.435.

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildReferenceFit, isReferenceCalibrationComparable } = require('./signal-schema');
const { buildTargetFit } = require('./signal-builder');

const V4 = 'voice-metrics-v4-formants';
const V3 = 'voice-metrics-v3';

const FRONT_VOWEL_RESONANCE = 0.80;
const BACK_VOWEL_RESONANCE = 0.00;
const V4_PHRASE_RESONANCE = 0.366;
// What the same front-vowel voice measured before the repair: F2 read ~798 Hz,
// so 0.80*clamp((798-1250)/900) clamps to 0 and only the spectral term survives.
const PRE_V4_FRONT_VOWEL_RESONANCE = 0.02;

const ADVANCED = {
  measurementAvailable: true,
  scoreConfidence: 0.9,
  voicedFramePct: 0.9,
  captureReliability: 0.9,
  reliabilityFlags: [],
};

function targetFitFor(resonanceMean, { resonanceFloor = 0.32, resonanceCeiling = 1 } = {}) {
  const summary = {
    targetPreset: 'cute-feminine',
    target: {
      source: 'built-in',
      direction: 'feminine',
      targetPreset: 'cute-feminine',
      pitchFloorHz: 188,
      pitchCeilingHz: 255,
      resonanceFloor,
      resonanceCeiling,
      weightFloor: 0,
      weightCeiling: 0.4,
    },
    metrics: {
      meanPitchHz: 210,
      resonanceMean,
      weightMean: 0.18,
      advanced: ADVANCED,
    },
  };
  const voiceState = { targetPreset: 'cute-feminine', targetSource: 'built-in', lastSummary: summary };
  return buildTargetFit(voiceState, summary, ADVANCED, {}, null);
}

function referenceFitFor({
  referenceVersion,
  takeVersion,
  referenceResonance,
  liveResonance,
  referenceWeight = 0.20,
  liveWeight = 0.20,
  referencePitch = 205,
  livePitch = 208,
}) {
  const voiceState = {
    referenceClipId: 'clip-1',
    referenceAnalysis: {
      analysisVersion: referenceVersion,
      metrics: {
        meanPitchHz: referencePitch,
        resonanceMean: referenceResonance,
        weightMean: referenceWeight,
      },
    },
    lastSummary: { analysisVersion: takeVersion },
  };
  return buildReferenceFit(voiceState, {
    meanPitchHz: livePitch,
    resonanceMean: liveResonance,
    weightMean: liveWeight,
  });
}

// ---------------------------------------------------------------------------
// CONSUMER 3 — band-relative, VERIFIED no change needed
// ---------------------------------------------------------------------------

test('v4 target fit: a bright front-vowel take reads in-target against the preset band', () => {
  const fit = targetFitFor(FRONT_VOWEL_RESONANCE);
  assert.equal(fit.resonance.status, 'target');
  assert.equal(fit.resonance.evidence, 'Resonance 80% in target zone.');
});

test('v4 target fit: a measured phrase take reads in-target, and a dark take reads too_dark', () => {
  assert.equal(targetFitFor(V4_PHRASE_RESONANCE).resonance.status, 'target');

  const dark = targetFitFor(BACK_VOWEL_RESONANCE);
  assert.equal(dark.resonance.status, 'too_dark');
  assert.equal(dark.resonance.evidence, 'Resonance 0% — below target band 32–100%.');
});

test('v4 target fit: the SAME voice under the pre-v4 misread would have read too_dark', () => {
  // The wording never had to change — the measurement did. This pins that the
  // status flip between these two rows comes entirely from the repaired input.
  assert.equal(targetFitFor(PRE_V4_FRONT_VOWEL_RESONANCE).resonance.status, 'too_dark');
  assert.equal(targetFitFor(FRONT_VOWEL_RESONANCE).resonance.status, 'target');
});

test('v4 target fit: the band, not a constant, decides — a narrow reference band re-judges the same take', () => {
  // Self-normalizing: hand the same measured value a v4-self-healed reference
  // band and the verdict follows the band with no code change.
  const tooBright = targetFitFor(FRONT_VOWEL_RESONANCE, { resonanceFloor: 0.4, resonanceCeiling: 0.6 });
  assert.equal(tooBright.resonance.status, 'too_bright');
  assert.equal(tooBright.resonance.evidence, 'Resonance 80% — above target band 40–60%.');

  const inBand = targetFitFor(FRONT_VOWEL_RESONANCE, { resonanceFloor: 0.7, resonanceCeiling: 0.95 });
  assert.equal(inBand.resonance.status, 'target');
});

// ---------------------------------------------------------------------------
// CONSUMER 2 — the +-0.05 flag under v4, and its calibration premise
// ---------------------------------------------------------------------------

test('v4 reference fit: same calibration keeps the +-0.05 semantics exactly as before', () => {
  const onTarget = referenceFitFor({
    referenceVersion: V4,
    takeVersion: V4,
    referenceResonance: 0.42,
    liveResonance: 0.45,
  });
  assert.equal(onTarget.enabled, true);
  assert.equal(onTarget.resonance.status, 'target');
  assert.equal(Math.round(onTarget.resonance.deltaPct), 3);

  const tooBright = referenceFitFor({
    referenceVersion: V4,
    takeVersion: V4,
    referenceResonance: 0.42,
    liveResonance: FRONT_VOWEL_RESONANCE,
  });
  assert.equal(tooBright.resonance.status, 'too_bright');

  const tooDark = referenceFitFor({
    referenceVersion: V4,
    takeVersion: V4,
    referenceResonance: 0.42,
    liveResonance: BACK_VOWEL_RESONANCE,
  });
  assert.equal(tooDark.resonance.status, 'too_dark');
});

test('v4 reference fit: a pre-v4 reference against a v4 take reports NO resonance or weight verdict', () => {
  // Without the guard this is a confident "too_bright" on a delta of 0.78 that
  // the learner did not produce — the instrument changed, not the voice.
  const fit = referenceFitFor({
    referenceVersion: V3,
    takeVersion: V4,
    referenceResonance: PRE_V4_FRONT_VOWEL_RESONANCE,
    liveResonance: FRONT_VOWEL_RESONANCE,
    referenceWeight: 0.62,
    liveWeight: 0.18,
  });
  assert.equal(fit.enabled, true, 'reference coaching is not switched off wholesale');
  assert.equal(fit.resonance.status, 'uncertain');
  assert.equal(fit.resonance.deltaPct, null);
  assert.equal(fit.weight.status, 'uncertain');
  assert.equal(fit.weight.deltaPct, null);
});

test('v4 reference fit: pitch survives a calibration mismatch, because the repair never touched it', () => {
  const fit = referenceFitFor({
    referenceVersion: V3,
    takeVersion: V4,
    referenceResonance: PRE_V4_FRONT_VOWEL_RESONANCE,
    liveResonance: FRONT_VOWEL_RESONANCE,
    referencePitch: 205,
    livePitch: 208,
  });
  assert.equal(fit.pitch.status, 'in_band');
  assert.ok(fit.pitch.semitoneDelta != null);
  // Alignment is then pitch-only rather than a blend that hides the suppression.
  assert.equal(fit.alignmentScore, Math.round(Math.max(0, 100 - Math.abs(fit.pitch.semitoneDelta) * 20)));
});

test('v4 reference fit: an unstamped reference or take is unknown calibration, never assumed to match', () => {
  for (const versions of [
    { referenceVersion: undefined, takeVersion: V4 },
    { referenceVersion: V4, takeVersion: undefined },
    { referenceVersion: '', takeVersion: V4 },
    { referenceVersion: '   ', takeVersion: V4 },
    { referenceVersion: undefined, takeVersion: undefined },
  ]) {
    const fit = referenceFitFor({
      ...versions,
      referenceResonance: 0.42,
      liveResonance: 0.45, // inside +-0.05: would have read 'target'
    });
    assert.equal(
      fit.resonance.status,
      'uncertain',
      `unstamped pair ${JSON.stringify(versions)} must not produce a verdict`,
    );
  }
});

test('v4 reference fit: the calibration predicate is exact, and tolerates surrounding whitespace', () => {
  assert.equal(isReferenceCalibrationComparable({
    referenceAnalysis: { analysisVersion: ` ${V4} ` },
    lastSummary: { analysisVersion: V4 },
  }), true);
  assert.equal(isReferenceCalibrationComparable({
    referenceAnalysis: { analysisVersion: V3 },
    lastSummary: { analysisVersion: V4 },
  }), false);
  assert.equal(isReferenceCalibrationComparable({}), false);
  assert.equal(isReferenceCalibrationComparable(null), false);
});
