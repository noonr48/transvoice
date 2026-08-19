'use strict';

/**
 * TV-FEM §8A — Comfortable pitch loop: the END-TO-END deterministic proof.
 *
 * This test composes every certified fem-v1 module in the exact order the
 * master plan §23 requires:
 *
 *   calibration -> reachable step policy -> reachable training target
 *   -> engine decision -> controller serve (approved cue, active mode)
 *   -> cue actually served + acknowledged -> exact-next trial created
 *   -> exact-next take settles worked_verified -> motor map update
 *   -> mastery evidence -> beginner feedback -> feedback fading
 *   -> no-feedback retention -> review state -> beginner card
 *
 * All failures fail closed at every gate; the negative invariants are pinned
 * inside the same composition (shadow serve refused; trial without a served
 * acknowledged cue refused; take before acknowledgement refused).
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildPitchCalibrationEvidence } = require('./pitch-calibration-evidence');
const { resolvePitchStepPolicy, defaultPitchStepPolicyConfig } = require('./pitch-reachable-policy');
const { applyReachableTrainingTargets } = require('./training-target');
const { decideTargetCoaching } = require('./target-coaching-engine');
const { resolveFeminizationV1Turn } = require('./feminization-v1-controller');
const { recordCueServed, acknowledgeCueServe, cueServeEligibility } = require('./cue-served-lifecycle');
const { createPendingMotorTrial, settlePendingMotorTrial } = require('./motor-trial');
const { createBeginnerMasteryState, recordMasteryEvidence } = require('./beginner-mastery');
const { beginnerFeedback } = require('./beginner-feedback');
const { nextFeedbackMode, masteryReviewState, defaultFeedbackPolicy } = require('./feedback-schedule');
const { buildBeginnerSessionCard } = require('./beginner-session-card');
const { getCue } = require('./cue-library-v3');
const { emptyMotorMap } = require('./motor-map');

const T0 = 1755400000000;

function calibrationTake(value, attempt, { effort = 2, glide = false } = {}) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value,
    unit: 'Hz',
    attemptArtifactId: attempt,
    taskId: 'calibration',
    takeKind: 'sustained_vowel',
    analysisProfile: 'standard',
    confidence: { signal: 0.9, extractor: 0.9, target: 0.9 },
    target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 't1', confidence: 0.9 },
    flags: [],
    metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40, hitPitchCeiling: false },
    selfReport: { effort },
    ...(glide ? {} : {}),
  };
}

function livePitchObservation(value, attempt) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value,
    unit: 'Hz',
    attemptArtifactId: attempt,
    taskId: 'task-1',
    takeKind: 'phrase',
    analysisProfile: 'standard',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 't1', confidence: 0.95 },
    flags: [],
    persistenceCount: 2,
    importance: 0.7,
    controllability: 0.8,
    metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40, hitPitchCeiling: false },
    selfReport: { effort: 2 },
  };
}

function protectedObservation(dimension, value, attempt) {
  return {
    metricId: dimension,
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension,
    value,
    unit: 'score',
    attemptArtifactId: attempt,
    taskId: 'task-1',
    takeKind: 'phrase',
    analysisProfile: 'standard',
    confidence: { signal: 0.9, extractor: 0.9, target: 0.9 },
    target: { low: 0, high: 0.5, scale: 0.1, source: 'reference', targetKey: 't1', confidence: 0.9 },
    flags: [],
    persistenceCount: 2,
    importance: 0.4,
    controllability: 0.4,
    metadata: {},
    selfReport: { effort: 2 },
  };
}

function devApprovedCue() {
  // The library cue is clinical-review-required (correctly unservable). A
  // specialist review granting approved_internal is the only way this exact
  // cue becomes servable — simulated here by the review-status override the
  // cue registry will carry once CUE_REVIEW_MATRIX grants it.
  const libraryCue = getCue('pitch.register.small-glide-up.v1');
  return { ...libraryCue, reviewStatus: 'approved_internal' };
}

test('the complete comfortable-pitch loop composes end to end and fails closed at every gate', () => {
  // --- 1. Calibration evidence (baseline + two salient verified upward glides)
  const glide1 = 142 * (2 ** (1.5 / 12));
  const down = glide1 * (2 ** (-0.5 / 12));
  const glide2 = down * (2 ** (1.5 / 12));
  const calibration = buildPitchCalibrationEvidence({
    observations: [
      calibrationTake(140, 'c1'),
      calibrationTake(142, 'c2'),
      calibrationTake(141, 'c3'),
      calibrationTake(143, 'c4'),
      calibrationTake(142, 'c5'),
      calibrationTake(glide1, 'c6', { effort: 2 }),
      calibrationTake(down, 'c7', { effort: 2 }),
      calibrationTake(glide2, 'c8', { effort: 2 }),
    ],
  });
  assert.equal(calibration.status, 'valid');

  // --- 2. Reachable step policy from that evidence (no universal target)
  const policyResolution = resolvePitchStepPolicy({
    calibration,
    config: defaultPitchStepPolicyConfig(),
  });
  assert.equal(policyResolution.status, 'ready');
  assert.equal(policyResolution.policy.policyId, 'fem-v1.pitch.step.comfort-first.v1');
  const stepPolicy = policyResolution.policy;

  // --- 3. Reachable training target on the live observation
  const liveBefore = livePitchObservation(140, 'attempt-1');
  const [rewritten] = applyReachableTrainingTargets(
    [liveBefore],
    { policiesByDimension: { 'pitch.register': stepPolicy } },
  );
  assert.equal(rewritten.metadata.trainingTargetStatus, 'reachable_step_ready');
  const reachableLow = rewritten.target.low;
  // F3 (review): the step is bounded by the RESOLVED policy max — the
  // demonstrated comfort (1.5 ST here), not the config cap.
  assert.ok(reachableLow > 140);
  assert.ok(reachableLow <= 140 * (2 ** (stepPolicy.max / 12)) * 1.000001, 'bounded by policy max');

  // --- 4. Engine decision on the reachable evidence
  const beforeBundle = [
    rewritten,
    protectedObservation('phonation.pressedness', 0.2, 'attempt-1'),
    protectedObservation('intensity.level', 0.3, 'attempt-1'),
  ];
  const decision = decideTargetCoaching({ observations: beforeBundle, stage: 'phrase' });
  assert.equal(decision.status, 'coach');
  assert.equal(decision.focus.dimension, 'pitch.register');
  assert.equal(decision.action.cueId, 'pitch.register.small-glide-up.v1');

  // --- 5. Controller serve: the reviewed cue is served in ACTIVE mode only
  const controllerTurn = resolveFeminizationV1Turn({
    safetyState: { pain: false, effort: 2 },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'pitch_foundation' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    observations: [liveBefore],
    pendingTrial: null,
    sessionContext: { sessionId: 'session-1', stage: 'phrase' },
    mode: 'active',
    cueResolver: (dimension, direction) => (
      dimension === 'pitch.register' && direction === 'below' ? devApprovedCue() : null
    ),
  });
  assert.equal(controllerTurn.action, 'serve_exercise');
  assert.equal(controllerTurn.served, true);
  assert.equal(controllerTurn.trialRequested, true);

  // NEGATIVE: the library cue without review is unservable — fail closed
  const unreviewedTurn = resolveFeminizationV1Turn({
    safetyState: { pain: false },
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'pitch_foundation' },
    masteryState: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    observations: [liveBefore],
    sessionContext: { sessionId: 'session-1', stage: 'phrase' },
    mode: 'active',
    cueResolver: () => getCue('pitch.register.small-glide-up.v1'),
  });
  assert.equal(unreviewedTurn.action, 'end_block');
  assert.equal(unreviewedTurn.reason, 'no_approved_cue_available');

  // --- 6. The cue is ACTUALLY served and acknowledged
  const served = recordCueServed({
    cue: devApprovedCue(),
    sessionId: 'session-1',
    servedAt: T0,
    mode: 'active',
  });
  assert.equal(served.status, 'recorded');
  const acknowledged = acknowledgeCueServe({ event: served.event, acknowledgedAt: T0 + 1000 });
  assert.equal(acknowledged.status, 'acknowledged');

  // NEGATIVE: shadow mode can never produce a serve event
  const shadowServe = recordCueServed({
    cue: devApprovedCue(), sessionId: 'session-1', servedAt: T0, mode: 'shadow',
  });
  assert.equal(shadowServe.status, 'not_recorded');

  // --- 7. Exact-next trial exists only with the eligible serve bound
  const trialArgs = {
    decision,
    beforeObservations: beforeBundle,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    requireCueServeEvent: true,
  };
  const refusedTrial = createPendingMotorTrial({ ...trialArgs, issuedAt: T0 + 2000 });
  assert.equal(refusedTrial.status, 'not_created');
  assert.equal(refusedTrial.reason, 'cue_serve_event_required');

  const boundTrial = createPendingMotorTrial({
    ...trialArgs,
    issuedAt: T0 + 2000,
    cueServeEvent: acknowledged.event,
  });
  assert.equal(boundTrial.status, 'created');
  assert.equal(boundTrial.trial.cueServe.cueId, decision.action.cueId);
  assert.equal(boundTrial.trial.candidatePolicy.allowSkipToLaterAttempt, false);

  // --- 8. The exact next take settles the trial (movement + protections)
  const afterPitch = livePitchObservation(154, 'attempt-2'); // inside the reachable step
  afterPitch.target = { ...rewritten.target }; // same reachable band for comparison identity
  const afterBundle = [
    afterPitch,
    protectedObservation('phonation.pressedness', 0.21, 'attempt-2'),
    protectedObservation('intensity.level', 0.3, 'attempt-2'),
  ];

  // NEGATIVE: a take timestamped before the acknowledgement earns no credit
  const earlyEligibility = cueServeEligibility({ event: acknowledged.event, at: T0 + 500 });
  assert.equal(earlyEligibility.eligible, false);

  const settlement = settlePendingMotorTrial({
    trial: boundTrial.trial,
    sessionId: 'session-1',
    stage: 'phrase',
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

  // --- 9. Mastery records the verified evidence (one lucky take is not mastery)
  let mastery = createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' });
  mastery = recordMasteryEvidence(mastery, {
    skill: 'pitch',
    step: 'elicitation',
    attemptArtifactId: 'attempt-2',
    valid: true,
    result: 'worked_verified',
  });
  assert.equal(mastery.skills.pitch.steps.elicitation.verifiedAttempts, 1);
  assert.equal(mastery.skills.pitch.steps.elicitation.state, 'verified');

  // --- 10. Beginner feedback speaks the verified outcome
  const feedback = beginnerFeedback({ verification: { result: 'worked_verified' } });
  assert.equal(feedback.state, 'verified_progress');
  assert.equal(feedback.nextAction, 'no_feedback_repeat');

  // --- 11. Feedback fades: hidden guide, then the no-feedback attempt verifies
  const policy = defaultFeedbackPolicy();
  const fading = nextFeedbackMode({ attemptInBlock: 4, learner: {}, policy });
  assert.equal(fading.feedbackMode, 'hidden_guide');
  mastery = recordMasteryEvidence(mastery, {
    skill: 'pitch', step: 'elicitation', attemptArtifactId: 'attempt-3',
    valid: true, result: 'worked_verified', noFeedback: true,
  });
  // The new-prompt attempt (earned by the first verified no-feedback take) is
  // itself performed without the guide — the second no-feedback verification
  // that the named policy requires before later sessions open with a
  // retention check.
  mastery = recordMasteryEvidence(mastery, {
    skill: 'pitch', step: 'elicitation', attemptArtifactId: 'attempt-4',
    valid: true, result: 'worked_verified', noFeedback: true,
  });
  assert.equal(mastery.skills.pitch.steps.elicitation.noFeedbackVerifiedAttempts, 2);

  // --- 12. Later session: retention check precedes the guide; retention completes stability
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
  const stable = nextFeedbackMode({ attemptInBlock: 1, newSession: true, learner, policy });
  assert.equal(stable.stabilityAchieved, true);
  const review = masteryReviewState({ learner, now: T0 + 2 * 86400000, policy });
  assert.equal(review.reviewState, 'current');

  // --- 13. The beginner card presents the whole thing in beginner language
  const card = buildBeginnerSessionCard({
    phase: 'pitch_foundation',
    feedback,
    focusLabel: 'Comfortable pitch',
    trySteps: [
      'Start with an easy "mm."',
      'Glide a small step upward.',
      'Open into "mee" without getting louder.',
    ],
    hasApprovedDemo: true,
  });
  assert.equal(card.result.state, 'verified_progress');
  assert.ok(/without relying on the display/.test(card.result.message));
  assert.ok(/Try it once without the guide/.test(card.next.message));
});
