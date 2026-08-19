'use strict';

/**
 * TV-FEM §8B — Controlled /i/ resonance loop: the END-TO-END deterministic
 * proof, mirroring pitch-vertical-loop.test.js (§8A).
 *
 * Master-plan §23 order:
 *   authoritative controlled /i/ baseline evidence
 *   -> reviewed resonance experiment served (approved cue, active mode)
 *   -> hold pitch steady (protected rule: max 1.0 semitone)
 *   -> exact next /i/ take
 *   -> authoritative formant evidence for the after-take
 *   -> verify resonance-direction movement (toward the learner's own
 *      controlled baseline target)
 *   -> verify pitch + effort protection
 *   -> motor map update (worked_verified)
 *   -> mastery evidence (resonance elicitation)
 *   -> beginner feedback + card
 *   -> no-feedback repetition + later-session retention gate
 *
 * Negative invariants pinned in-composition: unverified controlled context
 * cannot even rank; high-F0 evidence is invalid regardless of formants; a
 * serve without acknowledgement earns no trial.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildControlledVowelEvidence } = require('./controlled-vowel-evidence');
const { normalizeValidationEntry, DEFAULT_DETECTOR_VALIDATION_REGISTRY } = require('./detector-validation-registry');
const { decideTargetCoaching } = require('./target-coaching-engine');
const { resolveFeminizationV1Turn } = require('./feminization-v1-controller');
const { getCue } = require('./cue-library-v3');
const { recordCueServed, acknowledgeCueServe } = require('./cue-served-lifecycle');
const { createPendingMotorTrial, settlePendingMotorTrial } = require('./motor-trial');
const { createBeginnerMasteryState, recordMasteryEvidence } = require('./beginner-mastery');
const { beginnerFeedback } = require('./beginner-feedback');
const { nextFeedbackMode, masteryReviewState, defaultFeedbackPolicy } = require('./feedback-schedule');
const { buildBeginnerSessionCard } = require('./beginner-session-card');
const { emptyMotorMap } = require('./motor-map');

const T0 = 1755400000000;

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

/** Authoritative controlled-vowel evidence bundle (plan 10.3 shape). */
function vowelBundle({ f0 = 200, f2 = 1780, attempt = 'attempt-1' } = {}) {
  return {
    probeId: 'vowel.ee.steady.v1',
    languagePackId: 'en-AU-feminization-foundations-v1',
    attemptArtifactId: attempt,
    recordingContextId: 'rec-ctx-1',
    analyzerVersion: 'voice-metrics-v4-formants',
    analysisProfile: 'standard',
    contextKind: 'controlled_probe_formant',
    comparisonContextKey: 'ee-steady-same-note-v1',
    contextComparable: true,
    promptMatched: true,
    promptConfidence: 0.93,
    stableSegment: { startMs: 200, endMs: 420, confidence: 0.9 },
    f0MedianHz: f0,
    formants: {
      f1: { valueHz: 400, confidence: 0.88 },
      f2: { valueHz: f2, confidence: 0.85 },
      f3: { valueHz: 2600, confidence: 0.8 },
    },
    trackContinuity: { gapCount: 0, maxGapMs: 0, ok: true },
    reliability: {
      detectorFamily: 'lpc_formant_lite_v4',
      analysisWindowCount: 14,
      validWindowCount: 12,
      validWindowPct: 0.857,
      f2IqrHz: 90,
      f2MadHz: 40,
      medianWindowPitchHz: f0,
      maxWindowPitchHz: f0 + 10,
    },
    estimates: {
      f1: [400, 404, 398],
      f2: [f2, f2 + 18, f2 - 12],
      f3: [2600, 2630, 2580],
    },
  };
}

/** The coaching observation derived from controlled evidence: resonance scale. */
function resonanceObservation(value, attempt, comparisonContextKey) {
  return {
    metricId: 'resonance.global_scale',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'resonance.global_scale',
    value,
    unit: 'score',
    attemptArtifactId: attempt,
    taskId: 'task-ee-1',
    takeKind: 'sustained_vowel',
    analysisProfile: 'standard',
    confidence: { signal: 0.9, extractor: 0.85, target: 0.9 },
    target: { low: 0.4, high: 0.6, scale: 0.1, source: 'learner_controlled_baseline', targetKey: 'ee-baseline-1', confidence: 0.9 },
    flags: [],
    persistenceCount: 2,
    importance: 0.9,
    controllability: 0.7,
    contextKind: 'controlled_probe_formant',
    comparisonContextKey,
    metadata: {
      contextComparable: true,
      controlledProbeId: 'vowel.ee.steady.v1',
      comparisonContextKey,
    },
    selfReport: { effort: 2 },
  };
}

function pitchProtectedObservation(f0Hz, attempt) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value: f0Hz,
    unit: 'Hz',
    attemptArtifactId: attempt,
    taskId: 'task-ee-1',
    takeKind: 'sustained_vowel',
    analysisProfile: 'standard',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { low: 180, high: 220, scale: 1, source: 'learner_controlled_baseline', targetKey: 'ee-baseline-1', confidence: 0.9 },
    flags: [],
    persistenceCount: 2,
    importance: 0.4,
    controllability: 0.4,
    metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40, hitPitchCeiling: false },
    selfReport: { effort: 2 },
  };
}

function pressednessObservation(value, attempt) {
  return {
    metricId: 'phonation.pressedness',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'phonation.pressedness',
    value,
    unit: 'score',
    attemptArtifactId: attempt,
    taskId: 'task-ee-1',
    takeKind: 'sustained_vowel',
    analysisProfile: 'standard',
    confidence: { signal: 0.9, extractor: 0.9, target: 0.9 },
    target: { low: 0, high: 0.5, scale: 0.1, source: 'learner_controlled_baseline', targetKey: 'ee-baseline-1', confidence: 0.9 },
    flags: [],
    persistenceCount: 2,
    importance: 0.4,
    controllability: 0.4,
    metadata: {},
    selfReport: { effort: 2 },
  };
}

function approvedResonanceCue() {
  const libraryCue = getCue('resonance.front-vowel.ee-anchor.v1');
  return { ...libraryCue, reviewStatus: 'approved_internal' };
}

test('the complete controlled-/i/ resonance loop composes end to end and fails closed at every gate', () => {
  // --- 1. Authoritative controlled /i/ baseline evidence (valid, release-validated)
  const registry = releaseValidatedRegistry();
  const baselineEvidence = buildControlledVowelEvidence(vowelBundle({ f2: 1780 }), {
    validationRegistry: registry,
  });
  assert.equal(baselineEvidence.validForCoaching, true);

  // NEGATIVE: high-F0 take is invalid regardless of complete formants
  const highF0Evidence = buildControlledVowelEvidence(
    vowelBundle({ f0: 340, f2: 2400 }),
    { validationRegistry: registry },
  );
  assert.equal(highF0Evidence.validForCoaching, false);

  // NEGATIVE: default registry keeps the same take research-only
  const researchOnly = buildControlledVowelEvidence(vowelBundle({ f2: 2400 }));
  assert.equal(researchOnly.validForCoaching, false);
  assert.ok(researchOnly.invalidityReasons.includes('detector_not_release_validated'));

  // --- 2. Engine decision on the controlled observation (below baseline target)
  const beforeObs = resonanceObservation(0.24, 'attempt-1', 'ee-steady-same-note-v1');
  const beforeBundle = [
    beforeObs,
    pitchProtectedObservation(200, 'attempt-1'),
    pressednessObservation(0.2, 'attempt-1'),
  ];
  const decision = decideTargetCoaching({ observations: beforeBundle, stage: 'sound' });
  assert.equal(decision.status, 'coach');
  assert.equal(decision.focus.dimension, 'resonance.global_scale');
  assert.equal(decision.action.cueId, 'resonance.front-vowel.ee-anchor.v1');

  // NEGATIVE: the same observation without the controlled-probe CONTEXT KIND
  // cannot be the focus — through the CONTROLLER. Metadata comparability is
  // left fully intact so the ONLY missing predicate is contextKind itself
  // (feminization-v1-policy hasVerifiedControlledResonanceContext), and the
  // exclusion reason names exactly that law — not a conjunction of causes.
  const unverified = { ...beforeObs, contextKind: 'phrase' };
  const unverifiedTurn = resolveFeminizationV1Turn({
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'resonance_foundation' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'resonance_foundation' }),
    observations: [unverified],
    sessionContext: { sessionId: 'session-1', stage: 'sound' },
    mode: 'active',
    cueResolver: () => approvedResonanceCue(),
  });
  assert.equal(unverifiedTurn.action, 'end_block');
  assert.equal(unverifiedTurn.reason, 'no_eligible_observation_for_phase');
  assert.equal(unverifiedTurn.eligibility?.rejected?.[0]?.dimension, 'resonance.global_scale');
  assert.equal(unverifiedTurn.eligibility?.rejected?.[0]?.reason, 'controlled_resonance_context_not_verified');

  // --- 3. Controller serves the reviewed resonance cue in resonance phase
  const controllerTurn = resolveFeminizationV1Turn({
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'resonance_foundation' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'resonance_foundation' }),
    observations: [beforeObs],
    pendingTrial: null,
    sessionContext: { sessionId: 'session-1', stage: 'sound' },
    mode: 'active',
    cueResolver: (dimension, direction) => (
      dimension === 'resonance.global_scale' && direction === 'below' ? approvedResonanceCue() : null
    ),
  });
  assert.equal(controllerTurn.action, 'serve_exercise');
  assert.equal(controllerTurn.served, true);

  // NEGATIVE: in the pitch phase the same observation cannot be the focus
  const pitchPhaseTurn = resolveFeminizationV1Turn({
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'pitch_foundation' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    observations: [beforeObs],
    sessionContext: { sessionId: 'session-1', stage: 'sound' },
    mode: 'active',
    cueResolver: () => approvedResonanceCue(),
  });
  assert.equal(pitchPhaseTurn.action, 'end_block');

  // --- 4. The cue is genuinely served + acknowledged; trial bound
  const served = recordCueServed({
    cue: approvedResonanceCue(), sessionId: 'session-1', servedAt: T0, mode: 'active',
  });
  const acknowledged = acknowledgeCueServe({ event: served.event, acknowledgedAt: T0 + 1200 });
  assert.equal(acknowledged.status, 'acknowledged');

  const trial = createPendingMotorTrial({
    decision,
    beforeObservations: beforeBundle,
    sessionId: 'session-1',
    stage: 'sound',
    selfReport: { effort: 2 },
    issuedAt: T0 + 2000,
    cueServeEvent: acknowledged.event,
    requireCueServeEvent: true,
  });
  assert.equal(trial.status, 'created');

  // NEGATIVE: unacknowledged serve earns no trial
  const refusedTrial = createPendingMotorTrial({
    decision,
    beforeObservations: beforeBundle,
    sessionId: 'session-1',
    stage: 'sound',
    issuedAt: T0 + 2000,
    cueServeEvent: served.event,
    requireCueServeEvent: true,
  });
  assert.equal(refusedTrial.status, 'not_created');

  // --- 5. The exact next /i/ take: authoritative evidence + protected pitch
  const afterEvidence = buildControlledVowelEvidence(
    vowelBundle({ f0: 204, f2: 2050, attempt: 'attempt-2' }),
    { validationRegistry: registry },
  );
  assert.equal(afterEvidence.validForCoaching, true);

  // Provenance threading (cycle-1 F3): the authoritative formant evidence
  // and the coaching observation describe the SAME physical take (same
  // attempt artifact, same comparison context); the 1780->2050 Hz F2 rise
  // is the acoustic movement the 0.24->0.31 resonance observation reports.
  const afterObs = resonanceObservation(0.31, 'attempt-2', 'ee-steady-same-note-v1');
  assert.equal(afterEvidence.attemptArtifactId, 'attempt-2');
  assert.equal(afterEvidence.comparisonContextKey, afterObs.comparisonContextKey);
  assert.ok(afterEvidence.formants.f2.valueHz > baselineEvidence.formants.f2.valueHz);
  const afterBundle = [
    afterObs,
    pitchProtectedObservation(204, 'attempt-2'),
    pressednessObservation(0.21, 'attempt-2'),
  ];

  const settlement = settlePendingMotorTrial({
    trial: trial.trial,
    sessionId: 'session-1',
    stage: 'sound',
    afterAttemptArtifactId: 'attempt-2',
    afterObservations: afterBundle,
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: T0 + 30000, // inside the 10-minute serve window
  });
  assert.equal(settlement.status, 'settled');
  assert.equal(settlement.result, 'worked_verified');
  assert.equal(settlement.motorMapUpdated, true);
  assert.equal(settlement.motorMap.byCue[decision.action.cueId].successes, 1);

  // --- 6. Mastery records verified resonance elicitation (one take is not mastery)
  let mastery = createBeginnerMasteryState({ curriculumPhase: 'resonance_foundation' });
  mastery = recordMasteryEvidence(mastery, {
    skill: 'resonance', step: 'elicitation', attemptArtifactId: 'attempt-2',
    valid: true, result: 'worked_verified',
  });
  assert.equal(mastery.skills.resonance.steps.elicitation.state, 'verified');
  assert.equal(mastery.curriculumPhase, 'resonance_foundation'); // evidence alone never advances phase

  // --- 7. Beginner feedback + card in beginner language
  const feedback = beginnerFeedback({ verification: { result: 'worked_verified' } });
  assert.equal(feedback.state, 'verified_progress');
  const card = buildBeginnerSessionCard({
    phase: 'resonance_foundation',
    feedback,
    focusLabel: 'Brighter vowel sound',
    trySteps: ['Hold a comfortable "ee" on the same note.', 'Keep the jaw easy, lip spread small.', 'Carry that shape into "see me."'],
    hasApprovedDemo: false,
  });
  assert.equal(card.result.state, 'verified_progress');

  // --- 8. Word transfer + no-feedback repetition, then later-session retention
  mastery = recordMasteryEvidence(mastery, {
    skill: 'resonance', step: 'elicitation', attemptArtifactId: 'attempt-3',
    valid: true, result: 'worked_verified', noFeedback: true,
  });
  mastery = recordMasteryEvidence(mastery, {
    skill: 'resonance', step: 'elicitation', attemptArtifactId: 'attempt-4',
    valid: true, result: 'worked_verified', noFeedback: true,
  });
  const policy = defaultFeedbackPolicy();
  const retentionGate = nextFeedbackMode({
    attemptInBlock: 1, newSession: true,
    learner: { noFeedbackVerified: 2, retentionVerified: false }, policy,
  });
  assert.equal(retentionGate.feedbackMode, 'retention_check');
  const learner = {
    noFeedbackVerified: 2,
    retentionVerified: true,
    lastNoFeedbackVerifiedAt: T0 + 86400000,
  };
  const review = masteryReviewState({ learner, now: T0 + 2 * 86400000, policy });
  assert.equal(review.reviewState, 'current');

  // --- 9. One /i/ success never claims whole-voice resonance mastery (plan 10.8)
  const summary = require('./beginner-mastery').masterySummary(mastery);
  assert.equal(summary.skills.resonance.elicitation, 'verified');
  assert.equal(summary.skills.resonance.retention, 'not_observed'); // retention STEP unproven
  assert.notEqual(summary.curriculumPhase, 'integration'); // phase never auto-advanced
});
