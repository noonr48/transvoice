'use strict';

// 2026-07-26 — v4 FORMANT RECALIBRATION of the resonance pass marks.
//
// The formant-lite selector was repaired at 8b0a19b (VOICE_ANALYSIS_VERSION
// v3 -> `voice-metrics-v4-formants`): front-vowel F2 had been reading ~798 Hz
// against a true 2761, and since `_estimate_timbre` computes
// `resonance = 0.80*clamp((F2-1250)/900) + 0.20*bright_spectral`, resonance
// collapsed to ~0.0 on exactly the vowels a feminine target is brightest on.
//
// MEASURED on the repaired analyzer (synthesized vowels through
// audio_analysis._estimate_timbre and build_attempt_metrics, feminine F0
// 180-240 Hz) — these are the numbers every value in this file is drawn from:
//
//   per-vowel resonance   /i/ 0.800 · /ae/ 0.383-0.461 · /a/ 0.245-0.303 · /u/ 0.000
//   phrase resonanceMean  cute-feminine 0.366 · everyday-feminine 0.378
//                         bright-playful 0.435 · australian-bright-feminine 0.355
//   phrase weightMean     0.115-0.251
//
// Two things are pinned here. (1) The backend's threshold fallback agrees with
// the analyzer's own TARGET_PROFILES table, because that fallback exists solely
// to reproduce what the analyzer would have said. (2) A v4-realistic take is
// judged the same way by both. Under the stale 0.58/0.54/0.62/0.60 marks every
// one of the measured phrase values above was rejected while the analyzer scored
// it in-band.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { buildVoiceStudentModelEvaluations } = require('./voice-student-evaluations');
const { createVoiceSessionStateRuntime } = require('./voice-session-state');

// --- v4-realistic measured values (see header) -------------------------------
const FRONT_VOWEL_RESONANCE = 0.80; // /i/ — the vowel the pre-v4 selector destroyed
const BACK_VOWEL_RESONANCE = 0.00; // /u/ — genuinely dark, unchanged by the repair
const V4_PHRASE_RESONANCE = {
  'cute-feminine': 0.366,
  'everyday-feminine': 0.378,
  'bright-playful': 0.435,
  'australian-bright-feminine': 0.355,
};
const V4_PHRASE_WEIGHT = 0.181;
// What the stale marks were, so the regression this fixes stays legible.
const PRE_V4_MARKS = {
  'cute-feminine': 0.58,
  'everyday-feminine': 0.54,
  'bright-playful': 0.62,
  'australian-bright-feminine': 0.60,
};

const ANALYZER_SOURCE = path.resolve(
  __dirname,
  '../services/voice-trainer/src/services/audio_analysis.py',
);

/** The analyzer's own min_resonance_mean per preset, read from the authority. */
function analyzerResonanceFloors() {
  const source = fs.readFileSync(ANALYZER_SOURCE, 'utf8');
  const floors = {};
  const preset = /"([a-z-]+)": VoiceTargetProfile\(([\s\S]*?)\n {4}\),/g;
  let match;
  while ((match = preset.exec(source)) !== null) {
    const found = /min_resonance_mean=([\d.]+)/.exec(match[2]);
    if (found) floors[match[1]] = Number(found[1]);
  }
  return floors;
}

function runtimeThresholds(targetPreset) {
  const runtime = createVoiceSessionStateRuntime({});
  return runtime.getVoiceStudentPresetTargets(targetPreset);
}

function evaluateResonance({ resonanceMean, thresholds, target = {}, targetPreset = 'cute-feminine' }) {
  const evaluations = buildVoiceStudentModelEvaluations({
    summary: {
      targetPreset,
      target,
      metrics: {
        resonanceMean,
        weightMean: V4_PHRASE_WEIGHT,
        advanced: {
          measurementAvailable: true,
          scoreConfidence: 0.9,
          voicedFramePct: 0.9,
          captureReliability: 0.9,
          reliabilityFlags: [],
        },
      },
    },
    voiceState: {},
    thresholds,
    concepts: {},
  });
  return evaluations.find((entry) => entry.conceptId === 'voice_resonance_brightness');
}

// ---------------------------------------------------------------------------
// CONSUMER 1 — the threshold fallback (recalibrated)
// ---------------------------------------------------------------------------

test('v4: each preset resonance mark equals the analyzer TARGET_PROFILES floor it stands in for', () => {
  const authority = analyzerResonanceFloors();
  assert.ok(
    Object.keys(authority).length >= 4,
    `read the analyzer table from ${ANALYZER_SOURCE}`,
  );
  for (const preset of Object.keys(V4_PHRASE_RESONANCE)) {
    const expected = authority[preset];
    assert.equal(
      typeof expected,
      'number',
      `analyzer defines min_resonance_mean for ${preset}`,
    );
    assert.equal(
      runtimeThresholds(preset).minResonanceMean,
      expected,
      `${preset} fallback must reproduce the analyzer floor, not a second scale`,
    );
    // The value it used to hold, so a silent revert is visible as a failure.
    assert.notEqual(expected, PRE_V4_MARKS[preset], `${preset} moved off the pre-v4 mark`);
  }
});

test('v4: an unknown preset still resolves to the recalibrated cute-feminine fallback', () => {
  assert.equal(runtimeThresholds('a-preset-that-does-not-exist').minResonanceMean, 0.32);
});

test('v4: the evaluator default (no thresholds supplied at all) matches the analyzer floor', () => {
  // Measured cute-feminine phrase resonance 0.366 is in-band for the analyzer
  // (floor 0.32) and was rejected by the old 0.58 default.
  const evaluation = evaluateResonance({
    resonanceMean: V4_PHRASE_RESONANCE['cute-feminine'],
    thresholds: undefined,
  });
  assert.equal(evaluation.correct, true);
});

test('v4: the fallback verdict on a measured take agrees with the analyzer band', () => {
  // The invariant is AGREEMENT, not "everything passes". australian-bright-feminine
  // asks for a brighter voice (floor 0.38) than the measured phrase delivers
  // (0.355), so the honest verdict there is still a miss — and the analyzer says
  // the same thing. A recalibration that made every take pass would be a rubber
  // stamp, not a repair.
  const authority = analyzerResonanceFloors();
  for (const [preset, resonanceMean] of Object.entries(V4_PHRASE_RESONANCE)) {
    const analyzerVerdict = resonanceMean >= authority[preset];
    assert.equal(
      evaluateResonance({
        resonanceMean,
        thresholds: runtimeThresholds(preset),
        targetPreset: preset,
      }).correct,
      analyzerVerdict,
      `${preset}: measured ${resonanceMean} vs analyzer floor ${authority[preset]}`,
    );
  }
  assert.equal(
    V4_PHRASE_RESONANCE['australian-bright-feminine'] < authority['australian-bright-feminine'],
    true,
    'the agreement above is not vacuous — one preset genuinely misses',
  );
});

test('v4: takes in the gap between the new mark and the stale one flipped to a pass', () => {
  // Every value here is a measured v4 reading that sits at or above the analyzer
  // floor and below the mark this file replaced — the exact interval where the
  // stale copy told a learner they were outside a band the analyzer scored them
  // inside. 0.461 is the measured /ae/ resonance at feminine F0; the rest are the
  // measured phrase means.
  const IN_GAP = {
    'cute-feminine': 0.366,
    'everyday-feminine': 0.378,
    'bright-playful': 0.435,
    'australian-bright-feminine': 0.461,
  };
  const authority = analyzerResonanceFloors();
  for (const [preset, resonanceMean] of Object.entries(IN_GAP)) {
    assert.ok(
      resonanceMean >= authority[preset] && resonanceMean < PRE_V4_MARKS[preset],
      `${preset}: ${resonanceMean} lies in the corrected interval`,
    );
    const thresholds = runtimeThresholds(preset);
    assert.equal(
      evaluateResonance({ resonanceMean, thresholds, targetPreset: preset }).correct,
      true,
      `${preset}: in-band under the v4 mark`,
    );
    // The same take under the stale mark — the false negative this repair removes.
    assert.equal(
      evaluateResonance({
        resonanceMean,
        thresholds: { ...thresholds, minResonanceMean: PRE_V4_MARKS[preset] },
        targetPreset: preset,
      }).correct,
      false,
      `${preset}: the pre-v4 mark rejected the same in-band take`,
    );
  }
});

test('v4: the recalibrated mark still fails a genuinely dark take', () => {
  // The repair must not turn the pass mark into a rubber stamp: /u/ measures 0.000
  // on the repaired analyzer and is correctly out of band for a feminine target.
  const evaluation = evaluateResonance({
    resonanceMean: BACK_VOWEL_RESONANCE,
    thresholds: runtimeThresholds('cute-feminine'),
  });
  assert.equal(evaluation.correct, false);
  assert.match(evaluation.misconception, /outside the 32–100% target band/);
});

test('v4: a bright front-vowel take passes and does not overflow the band ceiling', () => {
  const evaluation = evaluateResonance({
    resonanceMean: FRONT_VOWEL_RESONANCE,
    thresholds: runtimeThresholds('cute-feminine'),
  });
  assert.equal(evaluation.correct, true);
});

// ---------------------------------------------------------------------------
// CONSUMER 1b — the band-relative path (VERIFIED, no change needed)
// ---------------------------------------------------------------------------

test('v4: analyzer-supplied bands win over the fallback, so the mark never applies to a live take', () => {
  // The live path always carries summary.target.resonanceFloor/Ceiling
  // (audio_analysis._build_attempt_target emits them for every resolvable
  // preset, and a v4 self-heal refreshes them for reference targets). This is
  // the "band-relative, self-normalizing" case: it needed no recalibration, and
  // this test is the record of that.
  const deliberatelyWrongThresholds = { minResonanceMean: 0.99 };
  const evaluation = evaluateResonance({
    resonanceMean: V4_PHRASE_RESONANCE['cute-feminine'],
    thresholds: deliberatelyWrongThresholds,
    target: { direction: 'feminine', resonanceFloor: 0.32, resonanceCeiling: 1 },
  });
  assert.equal(evaluation.correct, true, 'the analyzer band decided, not the threshold');
  assert.match(evaluation.misconception, /32–100% target band/);
});

test('v4: a reference-derived band that is bright at BOTH ends still judges by the band', () => {
  // A v4-self-healed reference profile can legitimately carry a high floor now
  // that front-vowel F2 is measured correctly. A take below it must fail even
  // though it clears the preset fallback.
  const evaluation = evaluateResonance({
    resonanceMean: 0.40,
    thresholds: runtimeThresholds('cute-feminine'),
    target: { direction: 'feminine', resonanceFloor: 0.62, resonanceCeiling: 0.9 },
  });
  assert.equal(evaluation.correct, false);
  assert.match(evaluation.misconception, /62–90% target band/);

  // ...and a take above a reference ceiling is out of band on the bright side —
  // only reachable at all because v4 restored the top of the resonance range.
  const tooBright = evaluateResonance({
    resonanceMean: FRONT_VOWEL_RESONANCE,
    thresholds: runtimeThresholds('cute-feminine'),
    target: { direction: 'feminine', resonanceFloor: 0.4, resonanceCeiling: 0.6 },
  });
  assert.equal(tooBright.correct, false);
  assert.match(tooBright.misconception, /40–60% target band/);
});

test('v4: retired-masculine and neutral fallback bands keep their direction semantics', () => {
  // The fallback is a port of audio_analysis._target_timbre_bands; the direction
  // branches (and the 0.14 neutral half-width) must survive the recalibration.
  //
  // RE-POINTED 2026-07-27 (SCOPE RULING: no female-to-male route exists). An
  // earlier round made a stored masculine take DEGRADE to the band-CENTERED
  // neutral semantics so four stored sessions kept scoring sensibly. Those rows
  // are deleted and the value is now corrupt input, so that degrade is gone: a
  // masculinizing direction is simply not in the whitelist and is scored exactly
  // as any other unrecognised value. Pinned as EQUIVALENCE so no special-case
  // can creep back in.
  for (const retiredValue of ['masculine', 'masc-natural', 'ftm']) {
    for (const resonanceMean of [0.3, FRONT_VOWEL_RESONANCE]) {
      assert.deepEqual(
        evaluateResonance({
          resonanceMean,
          thresholds: { minResonanceMean: 0.28 },
          target: { direction: retiredValue },
          targetPreset: retiredValue,
        }),
        evaluateResonance({
          resonanceMean,
          thresholds: { minResonanceMean: 0.28 },
          target: { direction: 'mystery-direction' },
          targetPreset: 'mystery-voice',
        }),
        `"${retiredValue}" at resonance ${resonanceMean} must score exactly as an unrecognised value`,
      );
    }
  }

  const centered = evaluateResonance({
    resonanceMean: 0.3,
    thresholds: { minResonanceMean: 0.28 },
    target: { direction: 'neutral' },
    targetPreset: 'androgynous',
  });
  assert.equal(centered.correct, true, 'neutral reads the mark as a band CENTER +-0.14');
  assert.match(centered.misconception, /14–42% target band/);
});
