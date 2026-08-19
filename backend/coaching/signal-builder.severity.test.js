/**
 * Style-issue severity: the pitch-lock regression suite (2026-07-29).
 *
 * WHAT THIS PINS. detectIssues speaks its top-ranked finding. Before the
 * SEVERITY_SPREAD rework, resonance and weight carried a FLAT 0.7 while the pitch
 * family carried `dip / 30` Hz, which saturates at 1.0 for any learner more than
 * 30 Hz under the band floor. A pre-training voice sits 60-90 Hz under a feminine
 * floor, so resonance and weight were STRUCTURALLY UNABLE to be the primary issue
 * for the whole early phase of training. These tests fail if that lock returns.
 */
const test = require('node:test');
const assert = require('node:assert');

const { detectIssues } = require('./signal-builder.js');

// everyday-feminine-shaped bands: pitch 168-235 Hz, resonance floor 0.24,
// weight ceiling 0.46.
const TARGET = Object.freeze({
  pitchFloorHz: 168,
  pitchCeilingHz: 235,
  resonanceFloor: 0.24,
  resonanceCeiling: 1,
  weightFloor: 0,
  weightCeiling: 0.46,
});

function takeState({ meanPitchHz, p10, p90, resonanceMean, weightMean }) {
  return {
    lastSummary: {
      target: { ...TARGET },
      metrics: {
        meanPitchHz,
        resonanceMean,
        weightMean,
        pitchRangeSt: 3,
        targetHitPct: 0.2,
        similarityScore: 0.5,
        advanced: {
          measurementAvailable: true,
          pitchP10Hz: p10,
          pitchP90Hz: p90,
          medianPitchHz: meanPitchHz,
          voicedFramePct: 0.9,
          confidentFramePct: 0.9,
          scoreConfidence: 0.8,
          captureReliability: 0.8,
          snrDb: 20,
          clippingPct: 0,
          pitchValidFrameCount: 120,
          sampleCount: 140,
          quality: {},
          formantLite: {},
        },
      },
    },
    targetVoiceProfile: { ...TARGET, advancedBands: {} },
  };
}

const BEGINNER = {
  meanPitchHz: 125, p10: 110, p90: 140, resonanceMean: 0.14, weightMean: 0.6,
};

test('THE REGRESSION: a typical beginner take does NOT lead with pitch', () => {
  // 110 Hz against a 168 Hz floor is 5.8 semitones low, AND resonance is 0.10
  // under its floor, AND weight is 0.14 over its ceiling. Under the old scoring
  // pitch scored a saturated 1.0 against two flat 0.7s and won every time.
  // Which of resonance/weight leads is decided by their normalised gaps — this
  // fixture's weight is further off, so weight leads. The contract under test is
  // that PITCH does not, because the research ranks it fourth of five.
  const issues = detectIssues(takeState(BEGINNER), 'active_drill', { takeKind: 'phrase' });
  assert.notEqual(
    issues.primaryIssue,
    'pitch_floor_under_target',
    'a beginner take led with pitch — the pitch lock is back',
  );
  assert.ok(
    ['resonance_slightly_back', 'voice_weight_heavy'].includes(issues.primaryIssue),
    `expected a mouth-shape or weight cue, got ${issues.primaryIssue}`,
  );
});

test('resonance leads when it is the worst axis on a beginner take', () => {
  // Same beginner pitch, weight brought inside its band, resonance far under.
  const issues = detectIssues(
    takeState({ ...BEGINNER, resonanceMean: 0.05, weightMean: 0.4 }),
    'active_drill',
    { takeKind: 'phrase' },
  );
  assert.equal(issues.primaryIssue, 'resonance_slightly_back');
});

test('pitch is still REACHABLE when it is the only axis off target', () => {
  // De-centring pitch must not mean silencing it. Resonance on target, pitch low.
  const issues = detectIssues(
    takeState({ ...BEGINNER, resonanceMean: 0.3, weightMean: 0.4 }),
    'active_drill',
    { takeKind: 'phrase' },
  );
  assert.equal(issues.primaryIssue, 'pitch_floor_under_target');
});

test('severity is ORDERED, not binary — a bigger gap on the same axis scores higher', () => {
  // Pitch AND weight held inside their bands so resonance is the only axis
  // moving — otherwise a barely-off resonance correctly loses to a far-off pitch
  // and this stops measuring what it claims to.
  const inBand = { meanPitchHz: 200, p10: 175, p90: 225, weightMean: 0.4 };
  const near = detectIssues(
    takeState({ ...inBand, resonanceMean: 0.22 }), 'active_drill', { takeKind: 'phrase' },
  );
  const far = detectIssues(
    takeState({ ...inBand, resonanceMean: 0.05 }), 'active_drill', { takeKind: 'phrase' },
  );
  assert.equal(near.primaryIssue, 'resonance_slightly_back');
  assert.equal(far.primaryIssue, 'resonance_slightly_back');
  assert.ok(
    far.confidence > near.confidence,
    `a larger resonance gap must score higher (near ${near.confidence}, far ${far.confidence})`,
  );
});

test('resonance and weight are no longer TIED — they can outrank each other', () => {
  // Both were pinned at 0.7, so their order was decided by push order alone.
  const weightWorse = detectIssues(
    takeState({ ...BEGINNER, resonanceMean: 0.23, weightMean: 0.9 }),
    'active_drill', { takeKind: 'phrase' },
  );
  assert.equal(weightWorse.primaryIssue, 'voice_weight_heavy');

  const resonanceWorse = detectIssues(
    takeState({ ...BEGINNER, resonanceMean: 0.02, weightMean: 0.48 }),
    'active_drill', { takeKind: 'phrase' },
  );
  assert.equal(resonanceWorse.primaryIssue, 'resonance_slightly_back');
});

test('every style confidence stays strictly below the composed verdict at 0.8', () => {
  // STYLE_CONFIDENCE_CEILING exists so pitch_pressed_in_band keeps the documented
  // ordering it was given. Drive every style axis to its worst and check the cap.
  const worst = detectIssues(
    takeState({ meanPitchHz: 80, p10: 70, p90: 90, resonanceMean: 0, weightMean: 1 }),
    'active_drill',
    { takeKind: 'phrase' },
  );
  assert.ok(
    worst.confidence < 0.8,
    `a maxed style issue reached ${worst.confidence}, which can tie or beat the composed verdict`,
  );
});

test('an unmeasured axis scores 0 rather than inheriting a rank', () => {
  // resonanceMean null => gap null => styleConfidence returns 0, so the axis
  // cannot be spoken. It must not fall back to a fabricated mid value.
  const issues = detectIssues(
    takeState({ ...BEGINNER, resonanceMean: null }), 'active_drill', { takeKind: 'phrase' },
  );
  assert.notEqual(issues.primaryIssue, 'resonance_slightly_back');
  assert.notEqual(issues.secondaryIssue, 'resonance_slightly_back');
});

test('GUARD: an unmeasurable take yields NO issue, so fabricated scores stay unspoken', () => {
  // The analyzer emits a hard-coded 0.5 resonance / 0.5 weight for a frame with
  // no speech-band energy (audio_analysis.py, the total_energy <= EPSILON
  // branch), and an all-silent take therefore carries resonanceMean 0.5 /
  // weightMean 0.5 — measured 2026-07-29. Those values were deliberately NOT
  // changed, because both fields are required floats on a live wire contract
  // (contracts.py VoiceFrame, mirrored in frontend/src/voice/contracts.ts).
  // This early return is what makes that safe: detectIssues refuses to score a
  // take the analyzer disowned. Remove it and 0.5 becomes coaching evidence —
  // and under the severity model a 0.5 reads as a plausible mid-range voice
  // rather than as missing data, which is worse than the old behaviour.
  // Python-side twin: services/voice-trainer/tests/test_timbre_fabrication_containment.py
  const disowned = takeState({
    meanPitchHz: 201.5, p10: 201.5, p90: 201.5, resonanceMean: 0.5, weightMean: 0.5,
  });
  disowned.lastSummary.metrics.advanced.measurementAvailable = false;
  disowned.lastSummary.metrics.advanced.measurementRejectionReasons = ['no_voiced_frames'];
  disowned.lastSummary.metrics.advanced.voicedFramePct = 0;

  const issues = detectIssues(disowned, 'active_drill', { takeKind: 'phrase' });
  assert.equal(issues.primaryIssue, null);
  assert.equal(issues.secondaryIssue, null);
  assert.equal(issues.confidence, 0);
  assert.equal(issues.plainEvidence, '');
});

// ---------------------------------------------------------------------------
// RISK DEAD-ZONE — the regression an independent review caught, pinned here with
// that review's own fixtures. The first cut of the severity rework scored style by
// magnitude but left strain/breathy on their raw scale, so a strain reading barely
// over its 0.52 bar took the PRIMARY spoken slot from findings that used to beat
// it. strainRisk is known-inverted (650-clip calibration: clean voices read
// 0.40-0.51, severely strained read 0.05-0.11), so that promotion could put the
// tutor on a clean voice's back. riskConfidence's dead zone is the repair.
// ---------------------------------------------------------------------------

function strainedTake(base, strainRisk) {
  const state = takeState(base);
  state.lastSummary.metrics.advanced.quality = { strainRisk };
  return state;
}

test('REGRESSION: strain sitting ON its bar does not steal the slot from pitch', () => {
  // Reviewer fixture 1: p10 60 Hz under floor, resonance and weight in band,
  // strainRisk exactly at the 0.52 warn bar. Was pitch_floor_under_target before
  // the rework; the first cut made it strain_risk.
  const issues = detectIssues(
    strainedTake(
      { meanPitchHz: 120, p10: 108, p90: 150, resonanceMean: 0.3, weightMean: 0.4 },
      0.52,
    ),
    'active_drill',
    { takeKind: 'phrase' },
  );
  assert.equal(issues.primaryIssue, 'pitch_floor_under_target');
});

test('REGRESSION: strain sitting ON its bar does not steal the slot from resonance', () => {
  // Reviewer fixture 2: resonance 0.10 under floor, strainRisk at the bar.
  const issues = detectIssues(
    strainedTake(
      { meanPitchHz: 200, p10: 175, p90: 225, resonanceMean: 0.14, weightMean: 0.4 },
      0.52,
    ),
    'active_drill',
    { takeKind: 'phrase' },
  );
  assert.equal(issues.primaryIssue, 'resonance_slightly_back');
});

test('a GENUINELY high strain reading still leads', () => {
  // The dead zone must not mute strain, only stop it winning on a bare crossing.
  const issues = detectIssues(
    strainedTake(
      { meanPitchHz: 200, p10: 175, p90: 225, resonanceMean: 0.14, weightMean: 0.4 },
      0.93,
    ),
    'active_drill',
    { takeKind: 'phrase' },
  );
  assert.equal(issues.primaryIssue, 'strain_risk');
});

test('risk confidence RISES with the risk, from ~0 at the bar', () => {
  const base = { meanPitchHz: 200, p10: 175, p90: 225, resonanceMean: 0.3, weightMean: 0.4 };
  const atBar = detectIssues(strainedTake(base, 0.52), 'active_drill', { takeKind: 'phrase' });
  const high = detectIssues(strainedTake(base, 0.9), 'active_drill', { takeKind: 'phrase' });
  assert.ok(
    atBar.confidence < 0.05,
    `a bare bar-crossing should carry ~no confidence, got ${atBar.confidence}`,
  );
  assert.equal(high.primaryIssue, 'strain_risk');
  assert.ok(high.confidence > atBar.confidence, 'risk confidence must be ordered');
});

test('pitch severity FALLS as the learner improves (the old term could not)', () => {
  // `dip / 30` Hz saturated at 1.0 for every dip over 30 Hz, so a learner who
  // closed 40 Hz of a 60 Hz gap saw no change at all. In semitones it moves.
  const early = detectIssues(
    takeState({ meanPitchHz: 120, p10: 108, p90: 135, resonanceMean: 0.3, weightMean: 0.4 }),
    'active_drill', { takeKind: 'phrase' },
  );
  const later = detectIssues(
    takeState({ meanPitchHz: 160, p10: 155, p90: 180, resonanceMean: 0.3, weightMean: 0.4 }),
    'active_drill', { takeKind: 'phrase' },
  );
  assert.equal(early.primaryIssue, 'pitch_floor_under_target');
  assert.equal(later.primaryIssue, 'pitch_floor_under_target');
  assert.ok(
    later.confidence < early.confidence,
    `pitch severity must fall as the floor rises (early ${early.confidence}, later ${later.confidence})`,
  );
});
