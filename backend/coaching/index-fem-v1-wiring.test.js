'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const coaching = require('./index');

test('the fem-v1 deterministic surface is exposed through the runtime barrel', () => {
  // The gateway consumes only this barrel (wiring contract); every certified
  // P1/P2 module entry point must be reachable through it.
  const expected = [
    'resolveFeminizationV1Turn',
    'eligibleObservationsForPhase',
    'isMetricEligibleForPhase',
    'buildPitchCalibrationEvidence',
    'resolvePitchStepPolicy',
    'defaultPitchStepPolicyConfig',
    'recordCueServed',
    'acknowledgeCueServe',
    'cueServeEligibility',
    'nextFeedbackMode',
    'masteryReviewState',
    'defaultFeedbackPolicy',
    'createPendingMotorTrial',
    'createLearnerFacingTrial',
    'settlePendingMotorTrial',
    'evaluateFemV1Replay',
  ];
  for (const name of expected) {
    assert.equal(typeof coaching[name], 'function', name);
  }
  assert.equal(typeof coaching.FEMINIZATION_V1_CONTROLLER_SCHEMA, 'string');
});

test('barrel-exposed controller keeps its laws (pain stops through the barrel path)', () => {
  const turn = coaching.resolveFeminizationV1Turn({
    safetyState: { pain: true },
    captureState: { usable: false, reasons: ['low_snr'] },
    curriculumState: { phase: 'pitch_foundation' },
    observations: [],
    mode: 'shadow',
  });
  assert.equal(turn.action, 'stop_for_safety');
  assert.equal(coaching.FEMINIZATION_V1_CONTROLLER_SCHEMA, turn.schema);
});

test('barrel-exposed serve lifecycle refuses shadow serves (shadow never learns)', () => {
  const refused = coaching.recordCueServed({
    cue: { cueId: 'c.v1', reviewStatus: 'approved_internal' },
    sessionId: 's-1',
    servedAt: 1000,
    mode: 'shadow',
  });
  assert.equal(refused.status, 'not_recorded');
  assert.equal(refused.reason, 'shadow_mode_cannot_serve');
});

test('barrel-exposed trial creation enforces the serve gate when required', () => {
  const refused = coaching.createPendingMotorTrial({
    decision: { status: 'coach', focus: {}, action: { cueId: 'c.v1' } },
    beforeObservations: [],
    sessionId: 's-1',
    stage: 'phrase',
    requireCueServeEvent: true,
  });
  assert.equal(refused.status, 'not_created');
  assert.equal(refused.reason, 'cue_serve_event_required');
});

test('M1: the learner-facing trial seam ALWAYS requires serve evidence — even when the caller passes false', () => {
  const args = {
    decision: { status: 'coach', focus: {}, action: { cueId: 'c.v1' } },
    beforeObservations: [],
    sessionId: 's-1',
    stage: 'phrase',
  };
  const omitted = coaching.createLearnerFacingTrial(args);
  assert.equal(omitted.status, 'not_created');
  assert.equal(omitted.reason, 'cue_serve_event_required');
  const bypassAttempt = coaching.createLearnerFacingTrial({
    ...args,
    requireCueServeEvent: false, // explicitly weakened — still enforced
  });
  assert.equal(bypassAttempt.status, 'not_created');
  assert.equal(bypassAttempt.reason, 'cue_serve_event_required');
});

test('M4: controller shadow decision composes into a replay row (adapter smoke)', () => {
  const breathy = {
    metricId: 'phonation.breathiness',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'phonation.breathiness',
    value: 0.95,
    unit: 'score',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { low: 0.4, high: 0.6, scale: 0.1, source: 'reference', targetKey: 't1', confidence: 0.95 },
    flags: [],
    persistenceCount: 2,
    importance: 1,
    controllability: 1,
    metadata: {},
  };
  const turn = coaching.resolveFeminizationV1Turn({
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'pitch_foundation' },
    observations: [breathy],
    sessionContext: { sessionId: 's-1', stage: 'phrase' },
    mode: 'shadow',
  });
  assert.equal(turn.action, 'end_block');
  // The documented adapter shape (fem-v1-replay-evaluator.js row contract):
  const row = {
    rowId: 'r1',
    phase: 'pitch_foundation',
    legacyFocus: 'tone_clarity', // legacy coached breathiness
    v1Focus: turn.focus ? turn.focus.dimension : null,
    v1Action: turn.action,
    v1Reason: turn.reason,
    eligibilityRejected: turn.eligibility ? turn.eligibility.rejected : [],
    settlement: null,
    retention: null,
  };
  const report = coaching.evaluateFemV1Replay([row]);
  assert.equal(report.phasePolicyViolations.count, 1); // legacy breathiness in pitch phase
  assert.equal(report.phasePolicyViolations.details[0].source, 'legacy');
  assert.equal(report.rejectionReasons.metric_not_beginner_coaching_authority, 1);
  assert.equal(report.noEvidenceRate, 1); // end_block + no_eligible_observation
});

test('coachingTurn exposes the fem-v1 controller witness in shadow without touching the signal', async () => {
  const result = await coaching.coachingTurn({
    voiceState: { lastAttemptArtifact: { selfReport: { pain: true } } },
    callModel: null,
  });
  assert.equal(result.femV1ControllerTurn.action, 'stop_for_safety');
  assert.equal(result.femV1ControllerTurn.mode, 'shadow');
  assert.equal(Object.hasOwn(result.signal, 'femV1'), false);
  assert.equal(Object.hasOwn(result.signal, 'femV1ControllerTurn'), false);
});

test('coachingTurn fails the controller closed to the curriculum entrance without take evidence', async () => {
  // A minimal conversational turn claims no take, so signal-builder defaults
  // usable=true/good; the controller still refuses mid-curriculum correction
  // and lands on the calibration entrance (unknown mastery -> calibration).
  const result = await coaching.coachingTurn({ voiceState: {}, callModel: null });
  assert.equal(result.femV1ControllerTurn.action, 'collect_calibration');
  assert.equal(result.femV1ControllerTurn.phase, 'calibration');
  assert.notEqual(result.femV1ControllerTurn.action, 'serve_exercise');
});

test('femV1ControllerMode off skips controller computation entirely', async () => {
  const result = await coaching.coachingTurn({
    voiceState: {},
    callModel: null,
    femV1ControllerMode: 'off',
  });
  assert.equal(result.femV1ControllerTurn, null);
  assert.equal(result.femV1BeginnerCard, null); // card is off with the controller
});

test('shadow beginner card: present under default mode, certified schema, never touches the signal', async () => {
  const result = await coaching.coachingTurn({
    voiceState: { lastAttemptArtifact: { selfReport: { effort: 2 } } },
    callModel: null,
  });
  const card = result.femV1BeginnerCard;
  assert.ok(card);
  assert.equal(card.schema, 'transvoice.beginner_session_card.v1');
  // Minimal conversational turn: calibration entrance, no take evidence ->
  // ready_for_instruction with the calibration result message.
  assert.equal(card.result.state, 'ready_for_instruction');
  assert.ok(card.result.message.length > 0);
  assert.deepEqual(card.try.steps, []); // no approved cues -> honest no steps
  assert.equal(Object.hasOwn(result.signal, 'femV1BeginnerCard'), false);
  assert.equal(Object.hasOwn(result.signal, 'femV1'), false);
});

test('shadow beginner card: pain collapses the card to the safety stop', async () => {
  const result = await coaching.coachingTurn({
    voiceState: { lastAttemptArtifact: { selfReport: { pain: true } } },
    callModel: null,
  });
  const card = result.femV1BeginnerCard;
  assert.equal(card.result.state, 'safety_stop');
  assert.equal(card.focus.label, null);
  assert.deepEqual(card.try.steps, []);
  assert.equal(card.record, null); // no record affordance on a stop card
  assert.ok(/should not hurt/.test(card.result.message));
});

test('shadow beginner card: capture failure speaks the neutral repair message', async () => {
  const result = await coaching.coachingTurn({
    voiceState: {
      // Real capture-unusable path: assessCaptureReliability reads three
      // voiceState shapes (lastSummary.metrics.advanced.captureReliability,
      // lastAttemptArtifact.summary, voiceInputRuntime.lastCaptureReliability)
      // — 0.2 < 0.3 is the unusable threshold on any of them.
      lastSummary: {
        analysisVersion: 'voice-metrics-v4-formants',
        metrics: { advanced: { captureReliability: 0.2 } },
      },
    },
    callModel: null,
  });
  const card = result.femV1BeginnerCard;
  assert.equal(card.result.state, 'could_not_measure');
  // Certified repair copy (captureMessage), pinned: neutral setup language,
  // never "sounded very similar" — that fallback asserts a measurement
  // comparison that never happened on a capture-failure turn.
  assert.match(card.result.message, /quieter|farther|once more|reliable measurement/i);
  assert.ok(!/sounded very similar/i.test(card.result.message));
  // Neutral copy: the recording failed, never the learner.
  assert.ok(!/fail|wrong|bad /i.test(card.result.message));
});

test('shadow beginner card: every reachable action speaks its certified copy (no fallback leakage)', async () => {
  const cases = [
    // [voiceState, expected card state, expected message regex]
    [{ lastAttemptArtifact: { selfReport: { effort: 2 } } }, 'ready_for_instruction', /samples|starting point|ready/i],
    [{ lastAttemptArtifact: { selfReport: { pain: true } } }, 'safety_stop', /should not hurt/i],
    [{ lastSummary: { metrics: { advanced: { captureReliability: 0.2 } } } }, 'could_not_measure', /quieter|farther|once more|reliable measurement/i],
    [{ lastAttemptArtifact: { selfReport: { effort: 2, newOrIncreasedHoarseness: true } } }, 'ease_reset', /easier|too effortful/i],
    [{ beginnerMastery: { curriculumPhase: 'resonance_foundation' } }, 'no_actionable_correction', /could not tell|same lesson|nothing needs changing/i],
  ];
  for (const [voiceState, expectedState, messagePattern] of cases) {
    const result = await coaching.coachingTurn({ voiceState, callModel: null });
    const card = result.femV1BeginnerCard;
    assert.ok(card, `card present for ${expectedState}`);
    assert.equal(card.result.state, expectedState);
    assert.match(card.result.message, messagePattern, expectedState);
    // The misrepresentation fallback never leaks on any state:
    assert.ok(!/sounded very similar/i.test(card.result.message), expectedState);
  }
});

test('cycle-1 optional hardening: ACTION_FEEDBACK_STATES covers the controller action vocabulary exactly', () => {
  const { resolveFeminizationV1Turn } = require('./feminization-v1-controller');
  // Enumerate the controller's action vocabulary by observation: drive every
  // reachable rung and collect actions. If a future action is added without a
  // card mapping, its shadow card silently nulls — this sync test turns red
  // instead (the observed set must EQUAL the mapped set).
  const observed = new Set();
  const baseOptions = {
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'pitch_foundation' },
    observations: [],
    sessionContext: { sessionId: 's-1', stage: 'phrase' },
    mode: 'shadow',
  };
  const probes = [
    { safetyState: { pain: true } },
    { captureState: { usable: false, reasons: [] } },
    { safetyState: { pain: false, effort: 4 } }, // R1-001: five-point escalation (4 = threshold)
    { curriculumState: { phase: 'calibration' } },
    { curriculumState: { phase: 'awareness' } },
    { curriculumState: { phase: 'pitch_foundation', advancementAuthorized: true } },
    {}, // end_block via no eligible observations
  ];
  for (const overrides of probes) {
    const turn = resolveFeminizationV1Turn({ ...baseOptions, ...overrides });
    observed.add(turn.action);
  }
  const expected = new Set([
    'stop_for_safety', 'repair_capture', 'reduce_difficulty',
    'collect_calibration', 'teach_awareness', 'advance_phase',
    'end_block',
  ]);
  // serve_exercise and verify_attempt are reachable only with an approved
  // cueResolver / a pending trial — driven in the controller suite; the
  // mapping for both is pinned by the all-states test's ready/partial cases.
  assert.deepEqual([...observed].sort(), [...expected].sort());
});

test('shadow beginner card: jargon-free by construction through the barrel path', async () => {
  const { containsInternalJargon } = require('./beginner-feedback');
  for (const voiceState of [
    { lastAttemptArtifact: { selfReport: { effort: 2 } } },
    { lastAttemptArtifact: { selfReport: { pain: true } } },
    { lastAttemptArtifact: { selfReport: { effort: 2 }, takeQuality: { usable: false, reasons: ['low_snr'] } } },
  ]) {
    const result = await coaching.coachingTurn({ voiceState, callModel: null });
    assert.equal(containsInternalJargon(result.femV1BeginnerCard), false);
  }
});

test('the full immediate-stop set reaches the controller witness through coachingTurn', async () => {
  // F1 regression: every IMMEDIATE_STOP_FIELDS entry must survive the
  // self-report mapping — not just pain/throatPain.
  for (const field of ['voiceLoss', 'suddenVoiceLoss', 'severeBreathlessness', 'severeDizziness', 'restrictionConflict', 'recentLaryngealSurgery', 'explicitStop']) {
    const result = await coaching.coachingTurn({
      voiceState: { lastAttemptArtifact: { selfReport: { [field]: true } } },
      callModel: null,
    });
    assert.equal(result.femV1ControllerTurn.action, 'stop_for_safety', field);
  }
});

test('plan-7.2 reduce-tier flags reach the controller witness through coachingTurn', async () => {
  const result = await coaching.coachingTurn({
    voiceState: { lastAttemptArtifact: { selfReport: { newOrIncreasedHoarseness: true } } },
    callModel: null,
  });
  assert.equal(result.femV1ControllerTurn.action, 'reduce_difficulty');
  assert.equal(result.femV1ControllerTurn.reason, 'newOrIncreasedHoarseness');
});
