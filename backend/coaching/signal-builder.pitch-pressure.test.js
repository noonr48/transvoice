'use strict';

// 2026-07-27 — PRESSED-INTO-BAND regression guard.
//
// THE DEFECT THIS PINS. buildTargetFit's pitch status was computed from FREQUENCY
// ALONE (band placement, plus a stability override). F0 rises 2-6 Hz per cmH2O of
// subglottal pressure, and doubling that pressure also adds ~9-11 dB SPL (Titze
// 1989, via studio/research/mtf-voice-body-atlas-2026-07-27.md 2.2/2.6) — so a
// learner could land inside the band by PUSHING AIR and the scorer read it as on
// target. Vocal loading raises F0 across a session, so the false green appeared
// exactly when the learner was fatiguing. The app was rewarding the one habit most
// likely to injure its user.
//
// WHAT IS ASSERTED HERE, in order of importance:
//   1. A learner who reaches the band CLEANLY scores exactly as before — every
//      pre-existing key of targetFit.pitch identical, and no new issue.
//   2. A pressed in-band take no longer produces an unqualified pass: the composed
//      issue fires, becomes primaryIssue, and carries a strain_reduction focus.
//   3. The stability override and the uncertain/unusable path keep their exact
//      previous precedence and meaning.
//   4. Tilt can never carry the verdict alone.
//   5. The MEASURED contract boundary: targetFit.pitch's new keys are stripped by
//      signal-schema's whitelist, which is WHY the verdict travels as an issue and
//      as the additive top-level signal.pitchPressure block.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildTargetFit,
  detectIssues,
  detectPitchPressureSignature,
  primaryIssueToFocus,
  buildCoachMove,
  buildDoNotSay,
  buildSignal,
  PRESSED_TILT_FLAT_DB_PER_OCT,
  PRESSED_MIN_CORRELATES,
} = require('./signal-builder');
const { isValidCoachingSignal } = require('./signal-schema');

const TARGET = Object.freeze({
  pitchFloorHz: 165,
  pitchCeilingHz: 220,
  resonanceFloor: 0.32,
  resonanceCeiling: 1,
  weightFloor: 0,
  weightCeiling: 0.45,
  source: 'preset',
  analysisVersion: 'voice-metrics-v4-formants',
});

const PROFILE = Object.freeze({
  advancedBands: { pitchStdStCeiling: 2.5, quality: {} },
});

/**
 * A usable, fully measured take. Every knob a pressure correlate reads is a
 * parameter, so a case differs from its neighbour in exactly the intended way.
 */
function takeState({
  meanPitchHz = 195,
  resonance = 0.5,
  weight = 0.35,
  tilt = -16,
  strain = 0.2,
  pitchStdSt = 1.2,
} = {}) {
  return {
    targetPreset: 'cute-feminine',
    targetVoiceProfile: PROFILE,
    lastAttemptArtifact: { finalizedAt: Date.now() },
    lastSummary: {
      targetPreset: 'cute-feminine',
      target: { ...TARGET },
      metrics: {
        meanPitchHz,
        resonanceMean: resonance,
        weightMean: weight,
        advanced: {
          measurementAvailable: true,
          voicedFramePct: 0.9,
          confidentFramePct: 0.85,
          scoreConfidence: 0.9,
          pitchValidFrameCount: 400,
          hnrValidFrameCount: 400,
          hnrVoicedCoveragePct: 0.9,
          captureReliability: 0.9,
          snrDb: 30,
          clippingPct: 0.001,
          pitchP10Hz: meanPitchHz - 8,
          pitchP90Hz: meanPitchHz + 8,
          pitchStdSt,
          pitchTargetOccupancyPct: 88,
          spectralTiltMeanDbPerOct: tilt,
          quality: { strainRisk: strain, breathyRisk: 0.1 },
        },
      },
    },
  };
}

function fitFor(voiceState, takeKind = 'phrase') {
  const advanced = voiceState.lastSummary.metrics.advanced;
  return buildTargetFit(
    voiceState,
    voiceState.lastSummary,
    advanced,
    advanced.quality,
    PROFILE,
    { takeKind },
  );
}

// The keys targetFit.pitch carried BEFORE this change. A clean take must be
// identical across all of them — that is the "scores exactly as before" contract.
const LEGACY_PITCH_KEYS = [
  'status', 'medianHz', 'semitoneDeltaToTargetCenter',
  'percentInBand', 'bandFloorHz', 'bandCeilingHz',
];

// ---------------------------------------------------------------------------
// 1. The clean learner is untouched
// ---------------------------------------------------------------------------

test('clean in-band take: no signature, no new issue, legacy pitch fields unchanged', () => {
  const clean = takeState({ tilt: -16, strain: 0.2, weight: 0.35 });
  const fit = fitFor(clean);

  assert.equal(fit.pitch.status, 'in_band');
  assert.equal(fit.pitch.successSuppressed, false);
  assert.equal(fit.pitch.suppressionReason, null);
  assert.deepEqual(fit.pitch.pressureCorrelates, []);

  // MEASURED: the pre-existing fields still hold the same values the
  // frequency-only implementation produced for this take.
  assert.deepEqual(
    LEGACY_PITCH_KEYS.map((k) => fit.pitch[k]),
    ['in_band', 195, 0.2, 88, 165, 220],
  );

  // And nothing new enters the issue list.
  const issues = detectIssues(clean, 'active_drill', { takeKind: 'phrase' });
  assert.equal(issues.primaryIssue, null);
  assert.equal(issues.plainEvidence, '');
});

// ---------------------------------------------------------------------------
// 2. The pressed learner no longer reads as a pass
// ---------------------------------------------------------------------------

test('pressed in-band take: composed verdict fires and outranks its own constituents', () => {
  const pressed = takeState({ tilt: -6, strain: 0.6, weight: 0.55 });
  const fit = fitFor(pressed);

  // The status stays inside the shipped PITCH_STATUSES enum on purpose — the
  // validator and the frontend label map both switch on it.
  assert.equal(fit.pitch.status, 'in_band');
  assert.equal(fit.pitch.successSuppressed, true);
  assert.equal(fit.pitch.suppressionReason, 'pressure_signature');
  // strain_at_warn leads because it is the mandatory term.
  assert.deepEqual(
    fit.pitch.pressureCorrelates,
    ['strain_at_warn', 'spectral_tilt_flat', 'weight_above_band'],
  );

  const issues = detectIssues(pressed, 'active_drill', { takeKind: 'phrase' });
  // MEASURED before this change: primaryIssue was 'voice_weight_heavy' (0.7), so
  // the coach said "lighten the voice" while the actual finding was "you are
  // pushing air to reach the band". The composed verdict must win that race.
  assert.equal(issues.primaryIssue, 'pitch_pressed_in_band');
  assert.equal(issues.secondaryIssue, 'voice_weight_heavy');
  assert.equal(issues.confidence, 0.8);
  // SECOND PLACE SURVIVED THE 2026-07-29 SEVERITY REWORK, but only after a repair.
  // The first cut of that rework scored style by magnitude while leaving the risks
  // on their raw scale, which flipped this assertion to `strain_risk` — a mildly
  // off weight (0.55 vs a 0.45 ceiling -> 0.35) fell below a strain reading sitting
  // barely over its 0.52 bar. Since strainRisk is known-inverted, that was a
  // regression, not a finding. riskConfidence's dead zone puts strain 0.60 at 0.19,
  // restoring this ordering: pressed(0.80) > weight(0.35) > strain(0.19).
  assert.match(issues.plainEvidence, /inside the target band/i);
  assert.match(issues.plainEvidence, /pressed/i);

  // The correction is NOT a pitch move.
  assert.equal(primaryIssueToFocus('pitch_pressed_in_band'), 'strain_reduction');

  const move = buildCoachMove({
    intent: 'single_actionable_cue',
    issues,
    safety: {},
    mode: 'active_drill',
    voiceState: {},
  });
  assert.equal(move.nextAction, 'repeat_with_less_pressure');
  // The cue must never ask for more effort, and must not ask for a pitch change.
  assert.doesNotMatch(move.cue, /\b(push|higher|louder|harder)\b/i);
});

test('a live strain verdict still outranks the composed one (safety ordering unchanged)', () => {
  // strain_risk carries strainRisk itself as its confidence; at 0.9 it must beat
  // the composed verdict's fixed 0.8 so the coach addresses strain directly.
  const veryStrained = takeState({ tilt: -6, strain: 0.9, weight: 0.55 });
  const issues = detectIssues(veryStrained, 'active_drill', { takeKind: 'phrase' });
  assert.equal(issues.primaryIssue, 'strain_risk');
  assert.equal(issues.secondaryIssue, 'pitch_pressed_in_band');
});

// ---------------------------------------------------------------------------
// 3. Existing overrides keep their precedence
// ---------------------------------------------------------------------------

test('the unstable override is unweakened and is never re-labelled as pressed', () => {
  // Wide spread AND every pressure correlate present: 'unstable' must still win,
  // and the signature must not fire on a non-in_band status.
  const unstable = takeState({ tilt: -6, strain: 0.6, weight: 0.55, pitchStdSt: 4.5 });
  const fit = fitFor(unstable);
  assert.equal(fit.pitch.status, 'unstable');
  assert.equal(fit.pitch.successSuppressed, false);
  assert.equal(fit.pitch.suppressionReason, null);

  const issues = detectIssues(unstable, 'active_drill', { takeKind: 'phrase' });
  assert.notEqual(issues.primaryIssue, 'pitch_pressed_in_band');
});

test('below-band and above-band takes never carry the signature', () => {
  for (const meanPitchHz of [140, 260]) {
    const fit = fitFor(takeState({ meanPitchHz, tilt: -6, strain: 0.6, weight: 0.55 }));
    assert.notEqual(fit.pitch.status, 'in_band');
    assert.equal(fit.pitch.successSuppressed, false);
  }
});

test('an unusable / uncertain take carries the inert fields, never a verdict', () => {
  const unusable = takeState();
  unusable.lastSummary.metrics.advanced.measurementAvailable = false;
  const fit = fitFor(unusable);
  assert.equal(fit.pitch.status, 'uncertain');
  assert.equal(fit.pitch.successSuppressed, false);
  assert.equal(fit.pitch.suppressionReason, null);
  assert.deepEqual(fit.pitch.pressureCorrelates, []);
});

// ---------------------------------------------------------------------------
// 4. Tilt can never carry the verdict alone
// ---------------------------------------------------------------------------

test('one correlate is not a signature — tilt alone can never fire it', () => {
  const tiltOnly = takeState({ tilt: -6, strain: 0.2, weight: 0.35 });
  const fit = fitFor(tiltOnly);
  assert.deepEqual(fit.pitch.pressureCorrelates, ['spectral_tilt_flat']);
  assert.equal(fit.pitch.successSuppressed, false);
  assert.equal(PRESSED_MIN_CORRELATES, 2);
});

// REGRESSION (found in independent review, 2026-07-27). The first version required
// only "any 2 of 3", which let tilt + weight carry the verdict with ZERO effort
// evidence — a heavy-voiced learner on a flat-sounding microphone was told they were
// pressing. strain_at_warn is now mandatory, because audio_analysis.py emits
// strainRisk at all only when HNR or stability was measured, making a non-null
// strainRisk the DSP's own certificate that voice-derived effort evidence exists.
test('the verdict NEVER fires without effort evidence, whatever else is present', () => {
  // Both non-strain correlates at their most extreme, strain entirely absent.
  const noEffortEvidence = detectPitchPressureSignature({
    pitchStatus: 'in_band', spectralTilt: -1, strainRisk: null, strainWarnBar: 0.52,
    weightMean: 0.99, weightCeiling: 0.45,
  });
  assert.deepEqual(noEffortEvidence.correlates, ['spectral_tilt_flat', 'weight_above_band']);
  assert.equal(noEffortEvidence.signature, false);

  // Same, through the real builder: strain measured but well under the bar.
  const belowBar = fitFor(takeState({ tilt: -6, strain: 0.05, weight: 0.55 }));
  assert.deepEqual(belowBar.pitch.pressureCorrelates, ['spectral_tilt_flat', 'weight_above_band']);
  assert.equal(belowBar.pitch.successSuppressed, false);
  // ...and the pre-existing weight issue still owns that take, exactly as before.
  assert.equal(
    detectIssues(takeState({ tilt: -6, strain: 0.05, weight: 0.55 }), 'active_drill', { takeKind: 'phrase' }).primaryIssue,
    'voice_weight_heavy',
  );
});

test('the signature still fires without tilt when strain and weight are both present', () => {
  const noTilt = takeState({ tilt: null, strain: 0.6, weight: 0.55 });
  const fit = fitFor(noTilt);
  assert.deepEqual(fit.pitch.pressureCorrelates, ['strain_at_warn', 'weight_above_band']);
  assert.equal(fit.pitch.successSuppressed, true);
});

// REGRESSION (independent review, 2026-07-27). audio_analysis.py returns 0.0 both
// when the tilt line cannot be fitted and as the frame-mean default, and surfaces it
// ungated. 0.0 > -10, so an ABSENT tilt was reading as a pressedness correlate.
test('an absent spectral tilt (the analyzer 0.0 default) is not evidence', () => {
  const defaulted = fitFor(takeState({ tilt: 0, strain: 0.6, weight: 0.35 }));
  assert.deepEqual(defaulted.pitch.pressureCorrelates, ['strain_at_warn']);
  assert.equal(defaulted.pitch.successSuppressed, false);
  // A real, slightly-flat reading right next to it still counts.
  assert.deepEqual(
    fitFor(takeState({ tilt: -0.001, strain: 0.6, weight: 0.35 })).pitch.pressureCorrelates,
    ['strain_at_warn', 'spectral_tilt_flat'],
  );
});

// REGRESSION (independent review, 2026-07-27). KIND_SUPPRESSED_ISSUES declares a
// trill's strain reading a lie ("a trill is SUPPOSED to wobble"), yet the composed
// verdict was consuming that same number as pressure evidence — scoring a trill on
// evidence this module refuses to report.
test('a take kind that calls its strain reading a lie cannot feed the verdict', () => {
  const pressedNumbers = { tilt: -6, strain: 0.9, weight: 0.55 };

  // phrase: strain is honest, so the verdict stands.
  assert.equal(fitFor(takeState(pressedNumbers), 'phrase').pitch.successSuppressed, true);

  // trill: strain_risk is in its suppression list, so the correlate is inadmissible
  // and the verdict cannot form — no matter how extreme the other readings are.
  const trill = fitFor(takeState(pressedNumbers), 'trill');
  assert.equal(trill.pitch.successSuppressed, false);
  assert.equal(trill.pitch.pressureCorrelates.includes('strain_at_warn'), false);
  assert.equal(
    detectIssues(takeState(pressedNumbers), 'active_drill', { takeKind: 'trill' }).primaryIssue,
    'voice_weight_heavy',
  );

  // ear_training suppresses everything ('*').
  assert.equal(fitFor(takeState(pressedNumbers), 'ear_training').pitch.successSuppressed, false);
});

test('the tilt bar is the analyzer own zero-point and is strict', () => {
  // audio_analysis.py: tilt_strain_term = clamp((tilt + 10.0) / 8.0). At exactly
  // -10 the DSP's own term is 0, so -10 is NOT yet evidence of effort.
  assert.equal(PRESSED_TILT_FLAT_DB_PER_OCT, -10);
  const at = detectPitchPressureSignature({
    pitchStatus: 'in_band', spectralTilt: -10, strainRisk: 0.6, strainWarnBar: 0.52,
    weightMean: 0.35, weightCeiling: 0.45,
  });
  assert.deepEqual(at.correlates, ['strain_at_warn']);
  assert.equal(at.signature, false);

  const above = detectPitchPressureSignature({
    pitchStatus: 'in_band', spectralTilt: -9.9, strainRisk: 0.6, strainWarnBar: 0.52,
    weightMean: 0.35, weightCeiling: 0.45,
  });
  assert.deepEqual(above.correlates, ['strain_at_warn', 'spectral_tilt_flat']);
  assert.equal(above.signature, true);
});

test('vocalise take kinds get the lenient strain bar, so a hum is not read as pressed', () => {
  // safety-thresholds.js lifts the strain WARN bar for vocalise kinds because the
  // analyzer reads clean sustained phonation as pressed. A strain reading that
  // clears the phrase bar must NOT clear the hum bar.
  const sustained = takeState({ tilt: -6, strain: 0.56, weight: 0.35 });
  assert.equal(fitFor(sustained, 'phrase').pitch.successSuppressed, true);
  assert.equal(fitFor(sustained, 'hum_sovt').pitch.successSuppressed, false);

  // REGRESSION (independent review, 2026-07-27): the lenience must hold when the
  // OTHER correlates are maxed out too. The first version softened one of three
  // votes and a heavy hum still tripped the verdict on tilt + weight alone.
  const heavyHum = takeState({ tilt: -6, strain: 0.30, weight: 0.55 });
  assert.equal(fitFor(heavyHum, 'hum_sovt').pitch.successSuppressed, false);
  assert.equal(
    detectIssues(heavyHum, 'active_drill', { takeKind: 'hum_sovt' }).primaryIssue,
    'voice_weight_heavy',
  );
});

// ---------------------------------------------------------------------------
// 5. The MEASURED contract boundary
// ---------------------------------------------------------------------------

test('MEASURED: signal-schema strips the pitch flags, so the verdict rides the issue + witness', () => {
  const pressed = takeState({ tilt: -6, strain: 0.6, weight: 0.55 });
  const signal = buildSignal({ voiceState: pressed, practiceMode: 'active_drill', userMessage: '' });

  // The schema rebuilds targetFit from six named pitch keys with no spread. This
  // is asserted, not assumed — it is the whole reason for the two routes below.
  assert.deepEqual(Object.keys(signal.targetFit.pitch).sort(), [...LEGACY_PITCH_KEYS].sort());
  assert.equal(signal.targetFit.pitch.status, 'in_band');

  // Route 1 — the issue. This is what the renderer prints as its Note line.
  assert.equal(signal.observation.primaryIssue, 'pitch_pressed_in_band');
  assert.match(signal.observation.plainEvidence, /pressed/i);
  assert.equal(signal.coachingDecision.primaryFocus, 'strain_reduction');

  // Route 2 — the additive top-level witness, for the renderer/policy/section-loop
  // owners to consume without a second DSP pass.
  assert.equal(signal.pitchPressure.signature, true);
  assert.equal(signal.pitchPressure.successSuppressed, true);
  assert.equal(signal.pitchPressure.pitchStatus, 'in_band');
  assert.ok(signal.pitchPressure.correlates.length >= PRESSED_MIN_CORRELATES);

  // The status stayed inside the shipped enum, so the validator still passes.
  assert.equal(isValidCoachingSignal(signal), true);

  // Never tell someone who is already pushing to push harder. doNotSay is
  // post-hoc enforced by the sanitizer, so this is a real gag.
  for (const phrase of ['go higher', 'try harder', 'more intensity']) {
    assert.ok(signal.doNotSay.includes(phrase), `doNotSay missing ${phrase}`);
  }
});

// REGRESSION (independent review, 2026-07-27). buildSignal resolves the summary as
// `lastSummary || {}` while detectIssues also falls back to lastAttemptArtifact.summary,
// so the two targetFit computations can disagree. The gag and the witness take the
// UNION with the issue, and the witness records which path asserted it.
test('the witness and the gag can never be silent on a turn whose issue says pressed', () => {
  const pressed = takeState({ tilt: -6, strain: 0.6, weight: 0.55 });
  const signal = buildSignal({ voiceState: pressed, practiceMode: 'active_drill', userMessage: '' });
  // Normal path: both sources agree.
  assert.equal(signal.pitchPressure.assertedBy, 'both');
  assert.equal(signal.pitchPressure.correlates.length >= PRESSED_MIN_CORRELATES, true);

  // MEASURED, and the reason the ranking test above lives at detectIssues level:
  // a strainRisk high enough to outrank this verdict (>= 0.8) is already past the
  // 0.70 STOP bar, so buildSignal routes the whole turn to a safety breather and
  // clears the observation. The witness must still attach on that turn.
  const veryStrained = takeState({ tilt: -6, strain: 0.9, weight: 0.55 });
  const s2 = buildSignal({ voiceState: veryStrained, practiceMode: 'active_drill', userMessage: '' });
  assert.equal(s2.policy.safetyState, 'stop');
  assert.equal(s2.policy.coachingAction, 'breather');
  assert.equal(s2.observation.primaryIssue, null);
  assert.equal(s2.pitchPressure.signature, true);
});

// REGRESSION (independent review, 2026-07-27). buildDoNotSay de-dupes then caps at
// 24, dropping the TAIL. The gag used to ride the `explicit` tier, which is pushed
// last and is therefore the first thing the cap eats; it is now placed with the
// safety block. MEASURED scope of the fix below.
test('the pressure gag outranks the explicit tier at the doNotSay cap', () => {
  const pressed = takeState({ tilt: -6, strain: 0.6, weight: 0.55 });
  const signal = buildSignal({
    voiceState: pressed,
    practiceMode: 'active_drill',
    userMessage: '',
    explicitDoNotSay: Array.from({ length: 30 }, (_, i) => `filler-phrase-${i}`),
  });
  assert.equal(signal.doNotSay.length, 24, 'the cap is genuinely being hit');
  for (const phrase of ['go higher', 'try harder', 'more intensity']) {
    assert.ok(signal.doNotSay.includes(phrase), `cap dropped the safety gag: ${phrase}`);
  }
});

// The LIMIT of that fix, pinned so nobody reads the test above as a stronger promise
// than it is. `scenarioAvoid` is pushed BEFORE the safety block, so a scenario avoid
// list longer than the cap evicts every safety gag — the PRE-EXISTING ones too, not
// just this feature's. Documented rather than changed: reordering buildDoNotSay
// would alter doNotSay for every other caller.
test('MEASURED LIMIT: a cap-length scenarioAvoid list evicts ALL safety gags, old and new', () => {
  const fillers = Array.from({ length: 30 }, (_, i) => `filler-topic-${i}`);
  const preExisting = buildDoNotSay({
    scenarioAvoid: fillers, drillContraindications: [], safety: { state: 'fatigue_or_strain' },
    explicit: [], takeKind: null, pitchPressure: true,
  });
  assert.equal(preExisting.length, 24);
  // The ORIGINAL safety gags are evicted by the same mechanism...
  assert.equal(preExisting.includes('push'), false);
  assert.equal(preExisting.includes('intensity'), false);
  // ...so this feature's gag being evicted alongside them is the pre-existing
  // behaviour, not a regression this change introduced.
  assert.equal(preExisting.includes('more intensity'), false);
});

test('a clean take gains no witness block and no gag', () => {
  const clean = takeState();
  const signal = buildSignal({ voiceState: clean, practiceMode: 'active_drill', userMessage: '' });
  assert.equal(signal.pitchPressure, undefined);
  assert.equal(signal.targetFit.pitch.status, 'in_band');
  assert.equal(signal.observation.primaryIssue, null);
  for (const phrase of ['go higher', 'try harder', 'more intensity']) {
    assert.equal(signal.doNotSay.includes(phrase), false);
  }
  assert.equal(isValidCoachingSignal(signal), true);
});

// ---------------------------------------------------------------------------
// 6. The phrase-end corollary
// ---------------------------------------------------------------------------

test('a phrase-end sag is attributed to decaying breath pressure, not to the larynx', () => {
  // Atlas 2.6: subglottal pressure controls pitch as well as loudness, so a sag at
  // the end of a long phrase is pressure decaying. The evidence line is what the
  // renderer hands the model, so it must name the breath cause.
  const sagging = takeState();
  sagging.lastSummary.metrics.advanced.pitchTrajectory = 'falling';
  const issues = detectIssues(sagging, 'active_drill', { takeKind: 'phrase' });
  assert.equal(issues.primaryIssue, 'pitch_falling_at_end');
  assert.match(issues.plainEvidence, /air running out/i);
  assert.match(issues.plainEvidence, /ribs/i);
  // It must not blame the voice/larynx as the cause.
  assert.match(issues.plainEvidence, /not the voice failing/i);
});
