'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FEMINIZATION_V1_CONTROLLER_SCHEMA,
  PHASE_DIRECTION_CONSTRAINTS,
  rankEligibleObservations,
  resolveFeminizationV1Turn,
} = require('./feminization-v1-controller');
const { createBeginnerMasteryState } = require('./beginner-mastery');

function observation(dimension = 'pitch.register', value = 140, extra = {}) {
  return {
    metricId: dimension === 'pitch.register' ? 'pitch.median_hz' : dimension,
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension,
    value,
    unit: 'Hz',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    flags: [],
    metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40, hitPitchCeiling: false },
    ...extra,
  };
}

const approvedCue = {
  cueId: 'pitch.register.small-glide-up.v1',
  dimensionPatterns: ['pitch.register'],
  directions: ['below'],
  stages: ['sound', 'word', 'phrase'],
  instruction: 'easy hum, small glide up',
  reviewStatus: 'approved_internal',
  protectedMetrics: ['safety.effort'],
};

function baseContext(overrides = {}) {
  return {
    safetyState: { pain: false, throatPain: false, discomfort: null, effort: 2, fatigue: null, strain: null },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'pitch_foundation' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    observations: [observation()],
    pendingTrial: null,
    sessionContext: { sessionId: 's-1', stage: 'phrase', now: 1755400000000 },
    mode: 'shadow',
    cueResolver: () => null,
    ...overrides,
  };
}

test('safety precedes all: pain yields stop_for_safety even with broken capture', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    safetyState: { pain: true },
    captureState: { usable: false, reasons: ['low_snr'] },
  }));
  assert.equal(turn.action, 'stop_for_safety');
  assert.equal(turn.schema, FEMINIZATION_V1_CONTROLLER_SCHEMA);
});

test('explicit stop request yields stop_for_safety', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    safetyState: { pain: false, explicitStop: true },
  }));
  assert.equal(turn.action, 'stop_for_safety');
});

test('capture failure precedes correction: repair_capture regardless of metrics', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    captureState: { usable: false, reasons: ['sustained_clipping'] },
  }));
  assert.equal(turn.action, 'repair_capture');
  assert.deepEqual(turn.captureReasons, ['sustained_clipping']);
});

test('pending trial is resolved before any new cue is served', () => {
  const trial = {
    schema: 'transvoice.pending_motor_trial.v1',
    status: 'pending',
    trialId: 'mt-1',
    cueId: 'pitch.register.small-glide-up.v1',
  };
  const turn = resolveFeminizationV1Turn(baseContext({ pendingTrial: trial }));
  assert.equal(turn.action, 'verify_attempt');
  assert.equal(turn.pendingTrial.trialId, 'mt-1');
});

test('escalating effort reduces difficulty instead of chasing the target', () => {
  // R1-001: five-point scale — 4 is the escalation threshold (the old 0-10
  // fixture value of 8 is out-of-range and parses to missing evidence).
  const turn = resolveFeminizationV1Turn(baseContext({
    safetyState: { pain: false, discomfort: null, effort: 4, fatigue: null, strain: null },
  }));
  assert.equal(turn.action, 'reduce_difficulty');
});

test('calibration phase collects calibration; never corrects', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'calibration' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'calibration' }),
  }));
  assert.equal(turn.action, 'collect_calibration');
});

test('awareness phase teaches awareness', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'awareness' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'awareness' }),
  }));
  assert.equal(turn.action, 'teach_awareness');
});

test('pitch phase cannot serve breathiness: huge breathiness gap is not the focus', () => {
  const breathy = observation('phonation.breathiness', 0.95, {
    target: { low: 0.4, high: 0.6, scale: 0.1, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    importance: 1,
    controllability: 1,
  });
  const turn = resolveFeminizationV1Turn(baseContext({
    observations: [breathy, observation('pitch.register', 170)],
    cueResolver: (dim) => (dim === 'pitch.register' ? approvedCue : null),
  }));
  assert.ok(['serve_exercise', 'end_block'].includes(turn.action));
  if (turn.focus) assert.equal(turn.focus.dimension, 'pitch.register');
});

test('no approved cue fails closed: end_block, never an unreviewed active cue', () => {
  const turn = resolveFeminizationV1Turn(baseContext({ cueResolver: () => null }));
  assert.equal(turn.action, 'end_block');
  assert.equal(turn.reason, 'no_approved_cue_available');
});

test('a clinical-review-required cue is not servable even if offered', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    cueResolver: () => ({ ...approvedCue, reviewStatus: 'clinical-review-required' }),
  }));
  assert.equal(turn.action, 'end_block');
  assert.equal(turn.reason, 'no_approved_cue_available');
});

test('approved cue in the right phase and direction serves exactly one exercise', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    mode: 'active',
    cueResolver: (dimension, direction, stage) => (
      dimension === 'pitch.register' && direction === 'below' && stage === 'phrase'
        ? approvedCue
        : null
    ),
  }));
  assert.equal(turn.action, 'serve_exercise');
  assert.equal(turn.cue.cueId, 'pitch.register.small-glide-up.v1');
  assert.equal(turn.focus.dimension, 'pitch.register');
  assert.equal(turn.trialRequested, true);
});

test('shadow mode computes the same decision but never requests a trial', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    mode: 'shadow',
    cueResolver: () => approvedCue,
  }));
  assert.equal(turn.mode, 'shadow');
  assert.equal(turn.action, 'serve_exercise');
  assert.equal(turn.trialRequested, false);
  assert.equal(turn.served, false);
});

test('invalid mode fails toward shadow, never active', () => {
  const turn = resolveFeminizationV1Turn(baseContext({ mode: 'definitely-not-a-mode' }));
  assert.equal(turn.mode, 'shadow');
});

test('phase precedes ranking: no eligible observation means no correction', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'resonance_foundation' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'resonance_foundation' }),
    observations: [observation('pitch.register', 170)],
    cueResolver: () => approvedCue,
  }));
  assert.equal(turn.action, 'end_block');
  assert.equal(turn.reason, 'no_eligible_observation_for_phase');
});

test('advance_phase requires explicit sequential evidence policy', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'pitch_foundation', advancementAuthorized: true, advancementEvidence: ['worked_verified', 'effort_stable', 'no_feedback_check'] },
  }));
  assert.equal(turn.action, 'advance_phase');
  assert.equal(turn.nextPhase, 'pitch_repeatability');

  const denied = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'pitch_foundation', advancementAuthorized: false, advancementEvidence: ['worked_verified'] },
  }));
  assert.notEqual(denied.action, 'advance_phase');
});

test('F1: authorized advancement is reachable from calibration and awareness', () => {
  const fromCalibration = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'calibration', advancementAuthorized: true },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'calibration' }),
  }));
  assert.equal(fromCalibration.action, 'advance_phase');
  assert.equal(fromCalibration.nextPhase, 'awareness');

  const fromAwareness = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'awareness', advancementAuthorized: true },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'awareness' }),
  }));
  assert.equal(fromAwareness.action, 'advance_phase');
  assert.equal(fromAwareness.nextPhase, 'pitch_foundation');
});

test('F2: unknown or missing phase fails closed to calibration, never mid-curriculum', () => {
  const garbage = resolveFeminizationV1Turn(baseContext({
    curriculumState: { phase: 'pitch_foundatoin' },
    masteryState: null,
    cueResolver: () => approvedCue,
  }));
  assert.equal(garbage.phase, 'calibration');
  assert.equal(garbage.action, 'collect_calibration');
});

test('F3: the full immediate-stop set stops training', () => {
  for (const field of ['voiceLoss', 'suddenVoiceLoss', 'severeBreathlessness', 'severeDizziness', 'restrictionConflict', 'explicitStop']) {
    const turn = resolveFeminizationV1Turn(baseContext({
      safetyState: { pain: false, [field]: true },
      cueResolver: () => approvedCue,
    }));
    assert.equal(turn.action, 'stop_for_safety', field);
  }
});

test('F4: shadow serve decision carries no servable cue instruction', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    mode: 'shadow',
    cueResolver: () => approvedCue,
  }));
  assert.equal(turn.action, 'serve_exercise');
  assert.equal(turn.cue.cueId, 'pitch.register.small-glide-up.v1');
  assert.equal(Object.hasOwn(turn.cue, 'instruction'), false);
  assert.equal(Object.hasOwn(turn.cue, 'protectedMetrics'), false);
  assert.equal(turn.served, false);
  assert.equal(turn.trialRequested, false);
});

test('F5: a malformed pending trial still blocks new cue serving', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    pendingTrial: { status: 'pending' },
    cueResolver: () => approvedCue,
  }));
  assert.equal(turn.action, 'verify_attempt');
  assert.equal(turn.reason, 'pending_trial_open_schema_unverified');
});

test('F6: null context objects never throw and fail closed on missing capture evidence', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    safetyState: null,
    captureState: null,
    curriculumState: null,
    sessionContext: null,
    masteryState: null,
  }));
  assert.equal(turn.phase, 'calibration');
  // Missing capture evidence is not skipped: unknown ≠ zero, so the turn
  // fails closed to capture repair rather than proceeding to coaching.
  assert.equal(turn.action, 'repair_capture');
});

test('F6: prototype-named dimensions are rejected, not crash', () => {
  const proto = observation('__proto__', 140);
  const turn = resolveFeminizationV1Turn(baseContext({ observations: [proto] }));
  assert.equal(turn.action, 'end_block');
  assert.equal(turn.reason, 'no_eligible_observation_for_phase');
});

test('M3: reserved contract params are inert — passing them changes nothing', () => {
  // Deep-equal pin: the four master-plan 4.2 reserved params must not
  // affect v1 decisions until their named consumers exist (P5 motor split).
  const base = baseContext({ cueResolver: () => approvedCue });
  const withReserved = resolveFeminizationV1Turn({
    ...base,
    goalProfile: { style: 'bright' },
    capabilityProfile: { baselinePitchHz: 999 },
    motorResponseMap: { byCue: { 'x.v1': { successes: 99 } } },
    goalCueOverlay: { 'x.v1': 0.9 },
  });
  const without = resolveFeminizationV1Turn(base);
  assert.deepEqual(withReserved, without);
});

test('matrix: pitch foundation never serves a downward pitch correction', () => {
  const aboveTarget = observation('pitch.register', 250);
  const turn = resolveFeminizationV1Turn(baseContext({
    mode: 'active',
    observations: [aboveTarget],
    cueResolver: (dimension, direction) => (
      dimension === 'pitch.register' && direction === 'above' ? approvedCue : null
    ),
  }));
  assert.notEqual(turn.action, 'serve_exercise');
  assert.equal(turn.action, 'end_block');
});

test('F3: plan 7.2 reduce-tier flags reduce difficulty with the field named', () => {
  for (const field of ['newOrIncreasedHoarseness', 'frequentCoughOrThroatClearing', 'suddenLossOfRange', 'acuteRespiratoryIllness']) {
    const turn = resolveFeminizationV1Turn(baseContext({
      safetyState: { pain: false, [field]: true },
      cueResolver: () => approvedCue,
    }));
    assert.equal(turn.action, 'reduce_difficulty', field);
    assert.equal(turn.reason, field);
  }
});

test('F3: recent laryngeal surgery is an immediate stop, not a reduction', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    safetyState: { pain: false, recentLaryngealSurgery: true },
    cueResolver: () => approvedCue,
  }));
  assert.equal(turn.action, 'stop_for_safety');
});

test('F7: rank order is importance, then controllability, then stable input order', () => {
  const low = { ...observation('pitch.register', 140), importance: 0.2, controllability: 0.9 };
  const highImportance = { ...observation('pitch.register', 141), importance: 0.9, controllability: 0.1 };
  const tieBreak = { ...observation('pitch.register', 142), importance: 0.9, controllability: 0.1 };
  const ranked = rankEligibleObservations([low, highImportance, tieBreak]);
  assert.equal(ranked[0], highImportance);
  assert.equal(ranked[1], tieBreak);
  assert.equal(ranked[2], low);

  // Equal importance: the controllability rung must decide (flipping this
  // comparator would otherwise leave the suite green).
  const easyControl = { ...observation('pitch.register', 143), importance: 0.9, controllability: 0.8 };
  const hardControl = { ...observation('pitch.register', 144), importance: 0.9, controllability: 0.2 };
  const rankedByControl = rankEligibleObservations([hardControl, easyControl]);
  assert.equal(rankedByControl[0], easyControl);
  assert.equal(rankedByControl[1], hardControl);
});

test('F7: observation inside its target band yields no corrective direction (end_block)', () => {
  const inside = observation('pitch.register', 200); // target 180-220
  const turn = resolveFeminizationV1Turn(baseContext({
    observations: [inside],
    cueResolver: () => approvedCue,
  }));
  assert.equal(turn.action, 'end_block');
  assert.equal(turn.reason, 'no_reliable_gap_in_eligible_observations');
});

test('F7: invalid mode with a servable cue still fails to shadow (never active)', () => {
  const turn = resolveFeminizationV1Turn(baseContext({
    mode: 'attivo',
    cueResolver: () => approvedCue,
  }));
  assert.equal(turn.mode, 'shadow');
  assert.equal(turn.served, false);
  assert.equal(turn.trialRequested, false);
  assert.equal(Object.hasOwn(turn.cue, 'instruction'), false);
});
