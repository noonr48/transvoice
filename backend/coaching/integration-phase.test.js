'use strict';

/**
 * TV-FEM-P4-001 — Integration: one focus, protected established skills,
 * effort simplification, short-phrase transfer, cross-session retrieval.
 *
 * Backlog acceptance mapped:
 * - one_primary_focus: both dimensions eligible with real gaps -> exactly ONE
 *   served focus, never both.
 * - established_skill_protected: a dimension inside its target band is never
 *   the focus while another has a gap; and when the established dimension
 *   MOVES during the protected settle (confound side), the trial result is
 *   confounded — no credit.
 * - effort_can_simplify: escalating self-report cost outranks any correction
 *   even with both gaps present.
 * - short_phrase_transfer: `transfer.retention` is a coaching dimension in
 *   the transfer phase (and never outside it).
 * - cross_session_retrieval: a later session opens with the retention check
 *   before any guide returns (composition through the feedback schedule).
 */

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFeminizationV1Turn } = require('./feminization-v1-controller');
const { eligibleObservationsForPhase } = require('./metric-eligibility');
const { createBeginnerMasteryState } = require('./beginner-mastery');
const { nextFeedbackMode, defaultFeedbackPolicy } = require('./feedback-schedule');
const { getCue } = require('./cue-library-v3');
const { decideTargetCoaching } = require('./target-coaching-engine');
const {
  createPendingMotorTrial,
  settlePendingMotorTrial,
} = require('./motor-trial');
const { recordCueServed, acknowledgeCueServe } = require('./cue-served-lifecycle');
const { emptyMotorMap } = require('./motor-map');

function obs(dimension, value, low, high, extra = {}) {
  return {
    metricId: dimension === 'pitch.register' ? 'pitch.median_hz' : dimension,
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension,
    value,
    unit: dimension === 'pitch.register' ? 'Hz' : 'score',
    attemptArtifactId: 'attempt-1',
    taskId: 'task-1',
    takeKind: extra.takeKind || 'phrase',
    analysisProfile: 'standard',
    confidence: { signal: 0.9, extractor: 0.9, target: 0.9 },
    target: { low, high, scale: dimension === 'pitch.register' ? 1 : 0.1, source: 'learner_controlled_baseline', targetKey: 'tk-1', confidence: 0.9 },
    flags: [],
    persistenceCount: 2,
    importance: extra.importance ?? 0.7,
    controllability: extra.controllability ?? 0.7,
    contextKind: extra.contextKind,
    comparisonContextKey: extra.comparisonContextKey,
    metadata: extra.metadata || {},
    selfReport: { effort: 2 },
  };
}

function controlledResonance(value) {
  return obs('resonance.global_scale', value, 0.4, 0.6, {
    takeKind: 'sustained_vowel',
    contextKind: 'controlled_probe_formant',
    comparisonContextKey: 'ee-steady-same-note-v1',
    importance: 0.9,
    metadata: {
      contextComparable: true,
      controlledProbeId: 'vowel.ee.steady.v1',
      comparisonContextKey: 'ee-steady-same-note-v1',
    },
  });
}

function turn(overrides = {}) {
  return resolveFeminizationV1Turn({
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'integration' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'integration' }),
    observations: [],
    sessionContext: { sessionId: 's-1', stage: 'sound' },
    mode: 'active',
    cueResolver: () => null,
    ...overrides,
  });
}

const pitchCue = () => ({ ...getCue('pitch.register.small-glide-up.v1'), reviewStatus: 'approved_internal' });
const resonanceCue = () => ({ ...getCue('resonance.front-vowel.ee-anchor.v1'), reviewStatus: 'approved_internal' });

test('one primary focus: both gaps present, exactly one dimension served', () => {
  const bothGaps = [
    obs('pitch.register', 140, 180, 220, { importance: 0.6 }),
    controlledResonance(0.24),
  ];
  const result = turn({
    observations: bothGaps,
    cueResolver: (dimension) => (dimension === 'resonance.global_scale' ? resonanceCue() : pitchCue()),
  });
  assert.equal(result.action, 'serve_exercise');
  assert.equal(result.focus.dimension, 'resonance.global_scale'); // higher importance wins the single focus
  assert.equal(Object.hasOwn(result, 'secondaryFocus'), false);
  // Determinism: identical evidence must yield an identical decision — no
  // oscillation between the two eligible focuses across calls.
  const result2 = turn({
    observations: bothGaps,
    cueResolver: (dimension) => (dimension === 'resonance.global_scale' ? resonanceCue() : pitchCue()),
  });
  assert.deepEqual(result2, result);
});

test('established skill is protected: an in-band dimension is never the focus', () => {
  const result = turn({
    observations: [
      obs('pitch.register', 200, 180, 220, { importance: 0.9 }), // inside band — protected
      controlledResonance(0.24),
    ],
    cueResolver: (dimension) => (dimension === 'resonance.global_scale' ? resonanceCue() : pitchCue()),
  });
  assert.equal(result.action, 'serve_exercise');
  assert.equal(result.focus.dimension, 'resonance.global_scale');
  // The protected dimension rides in the cue's protections, not in the focus.
  assert.ok(result.cue.protectedMetrics.includes('pitch.register'));
});

test('established skill protection, confound side: protected pitch moves -> no credit', () => {
  const before = [
    controlledResonance(0.24),
    obs('pitch.register', 200, 180, 220, { takeKind: 'sustained_vowel', metadata: { targetScaleUnit: 'semitone' } }),
    obs('phonation.pressedness', 0.2, 0, 0.5, { takeKind: 'sustained_vowel' }),
  ];
  const decision = decideTargetCoaching({ observations: before, stage: 'sound' });
  assert.equal(decision.status, 'coach');
  assert.equal(decision.focus.dimension, 'resonance.global_scale');

  const served = recordCueServed({ cue: resonanceCue(), sessionId: 's-1', servedAt: 1000, mode: 'active' });
  const ack = acknowledgeCueServe({ event: served.event, acknowledgedAt: 1500 });
  const trial = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 's-1',
    stage: 'sound',
    selfReport: { effort: 2 },
    issuedAt: 2000,
    cueServeEvent: ack.event,
    requireCueServeEvent: true,
  });
  assert.equal(trial.status, 'created');

  // Resonance improves BUT the protected pitch escapes the cue's 1.0-ST rule
  // (200 -> 240 Hz is ~3.16 ST): confounded — the protected skill was disturbed.
  const after = [
    { ...controlledResonance(0.31), attemptArtifactId: 'attempt-2' },
    { ...obs('pitch.register', 240, 180, 220, { takeKind: 'sustained_vowel', metadata: { targetScaleUnit: 'semitone' } }), attemptArtifactId: 'attempt-2' },
    { ...obs('phonation.pressedness', 0.21, 0, 0.5, { takeKind: 'sustained_vowel' }), attemptArtifactId: 'attempt-2' },
  ];
  const settled = settlePendingMotorTrial({
    trial: trial.trial,
    sessionId: 's-1',
    stage: 'sound',
    afterAttemptArtifactId: 'attempt-2',
    afterObservations: after,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 3000,
  });
  assert.equal(settled.status, 'settled');
  assert.equal(settled.result, 'confounded');
  const cueStats = settled.motorMap.byCue['resonance.front-vowel.ee-anchor.v1'];
  assert.equal(cueStats.successes, 0); // confounds never earn credit
  assert.ok(cueStats.attempts >= 1); // but the trial is honestly recorded
});

test('effort can simplify: escalation outranks correction even with both gaps', () => {
  // R1-001: five-point scale — 4 is the escalation threshold (8 was the old
  // 0-10 fixture value, now out-of-range and therefore missing evidence).
  const result = turn({
    safetyState: { pain: false, effort: 4 },
    observations: [
      obs('pitch.register', 140, 180, 220),
      controlledResonance(0.24),
    ],
    cueResolver: () => pitchCue(),
  });
  assert.equal(result.action, 'reduce_difficulty');
  assert.equal(result.reason, 'self_report_cost_escalated');
});

test('short-phrase transfer: transfer.retention coaches ONLY in the transfer phase', () => {
  const retention = obs('transfer.retention', 0.2, 0.5, 0.8, { importance: 0.9 });
  const transferPhase = eligibleObservationsForPhase([retention], { phase: 'transfer' });
  assert.equal(transferPhase.eligible.length, 1);
  assert.equal(transferPhase.eligible[0].dimension, 'transfer.retention');

  for (const phase of ['calibration', 'awareness', 'pitch_foundation', 'pitch_repeatability', 'resonance_foundation', 'integration', 'prosody']) {
    const out = eligibleObservationsForPhase([retention], { phase });
    assert.equal(out.eligible.length, 0, phase);
    assert.equal(out.rejected[0].reason, 'metric_not_unlocked_for_phase', phase);
  }
});

test('cross-session retrieval: later session opens with the retention check', () => {
  const policy = defaultFeedbackPolicy();
  const gate = nextFeedbackMode({
    attemptInBlock: 1,
    newSession: true,
    learner: { noFeedbackVerified: 2, retentionVerified: false },
    policy,
  });
  assert.equal(gate.feedbackMode, 'retention_check');
  assert.equal(gate.stabilityAchieved, false); // the check is the gate, not a reward
});

test('the 1.0-semitone protected rule is pinned UNIQUELY: in-band drift still confounds', () => {
  // 200 -> 218 Hz is ~1.49 ST — ABOVE the ee-anchor's 1.0-ST rule but STILL
  // INSIDE the 180-220 band. The generic target-band regression cannot fire
  // here; only the max_semitone_delta protected rule can. If this settles
  // confounded, the rule evaluated; if it settles worked_verified, the rule
  // was skipped (or raised) — a regression this test uniquely catches.
  const before = [
    controlledResonance(0.24),
    obs('pitch.register', 200, 180, 220, { takeKind: 'sustained_vowel', metadata: { targetScaleUnit: 'semitone' } }),
    obs('phonation.pressedness', 0.2, 0, 0.5, { takeKind: 'sustained_vowel' }),
  ];
  const decision = decideTargetCoaching({ observations: before, stage: 'sound' });
  const served = recordCueServed({ cue: resonanceCue(), sessionId: 's-1', servedAt: 1000, mode: 'active' });
  const ack = acknowledgeCueServe({ event: served.event, acknowledgedAt: 1500 });
  const trial = createPendingMotorTrial({
    decision, beforeObservations: before, sessionId: 's-1', stage: 'sound',
    selfReport: { effort: 2 }, issuedAt: 2000, cueServeEvent: ack.event, requireCueServeEvent: true,
  });
  const after = [
    { ...controlledResonance(0.31), attemptArtifactId: 'attempt-2' },
    { ...obs('pitch.register', 218, 180, 220, { takeKind: 'sustained_vowel', metadata: { targetScaleUnit: 'semitone' } }), attemptArtifactId: 'attempt-2' },
    { ...obs('phonation.pressedness', 0.21, 0, 0.5, { takeKind: 'sustained_vowel' }), attemptArtifactId: 'attempt-2' },
  ];
  const settled = settlePendingMotorTrial({
    trial: trial.trial, sessionId: 's-1', stage: 'sound',
    afterAttemptArtifactId: 'attempt-2', afterObservations: after,
    selfReport: { effort: 2 }, motorMap: emptyMotorMap(),
    settledAt: 3000,
  });
  assert.equal(settled.status, 'settled');
  assert.equal(settled.result, 'confounded');
  const cueStats = settled.motorMap.byCue['resonance.front-vowel.ee-anchor.v1'];
  assert.equal(cueStats.successes, 0);
});

test('the transfer phase can serve: retention focus through the approved same-sentence cue', () => {
  // transfer.same-sentence.v1 stages are word/phrase/reading/spontaneous —
  // no 'sound' — so the phrase stage is the supported serving surface.
  const retention = obs('transfer.retention', 0.2, 0.5, 0.8, { importance: 0.9, takeKind: 'phrase' });
  const transferCue = () => ({ ...getCue('transfer.same-sentence.v1'), reviewStatus: 'approved_internal' });
  const result = resolveFeminizationV1Turn({
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'transfer' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'transfer' }),
    observations: [retention],
    sessionContext: { sessionId: 's-1', stage: 'phrase' },
    mode: 'active',
    cueResolver: (dimension, direction) => (
      dimension === 'transfer.retention' && direction === 'below' ? transferCue() : null
    ),
  });
  assert.equal(result.action, 'serve_exercise');
  assert.equal(result.focus.dimension, 'transfer.retention');
  assert.equal(result.cue.cueId, 'transfer.same-sentence.v1');
});
