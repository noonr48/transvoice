'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBeginnerMasteryState } = require('./beginner-mastery');
const { createAttemptFinalizedEvent } = require('./attempt-finalized-event');
const { resolvePitchAlphaCueForShadow } = require('./cue-alpha-authority');
const {
  createFemV1ShadowState,
  normalizeFemV1ShadowState,
  resolveFemV1ShadowSessionTurn,
  shadowStateKey,
} = require('./fem-v1-shadow-state');

function baseSession() {
  return { sessionId: 'shadow-s1', stage: 'phrase', revision: 7, pendingTrial: null, attemptSequence: null };
}

function baseLearner() {
  return { mastery: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }) };
}

function event(id, artifact, expectedRevision = 7) {
  return createAttemptFinalizedEvent({
    eventId: id,
    sessionId: 'shadow-s1',
    attemptArtifactId: artifact,
    expectedSessionRevision: expectedRevision,
    eligible: true,
    evidence: {
      selfReport: { effort: 2 },
      captureEvidence: { usable: true, reasons: [] },
      observations: [],
    },
  });
}

test('shadow state uses a private hashed namespace and round-trips strictly', () => {
  const state = createFemV1ShadowState({
    sessionId: 'shadow-s1', sourceSessionRevision: 7,
    sessionState: baseSession(), learnerState: baseLearner(),
  });
  assert.match(state.stateKey, /^fem-v1-shadow:[0-9a-f]{40}$/);
  assert.ok(!state.stateKey.includes('shadow-s1'));
  assert.deepEqual(normalizeFemV1ShadowState(state), state);
  assert.equal(shadowStateKey('shadow-s1'), state.stateKey);
});

test('two finalized events advance one private attempt sequence without touching production input', () => {
  const productionSession = baseSession();
  const productionLearner = baseLearner();
  const sessionBefore = structuredClone(productionSession);
  const learnerBefore = structuredClone(productionLearner);

  const first = resolveFemV1ShadowSessionTurn({
    sessionState: productionSession,
    learnerState: productionLearner,
    sourceSessionRevision: 7,
    finalizedAttemptEvent: event('evt-1', 'a1'),
    cueResolver: resolvePitchAlphaCueForShadow,
  });
  assert.equal(first.turn.finalizedAttemptDisposition.ordinal, 1);
  assert.equal(first.nextShadowState.sessionState.attemptSequence.nextOrdinal, 2);

  const restored = JSON.parse(JSON.stringify(first.nextShadowState));
  const second = resolveFemV1ShadowSessionTurn({
    shadowState: restored,
    sessionState: productionSession,
    learnerState: productionLearner,
    sourceSessionRevision: 7,
    finalizedAttemptEvent: event('evt-2', 'a2'),
    cueResolver: resolvePitchAlphaCueForShadow,
  });
  assert.equal(second.turn.finalizedAttemptDisposition.ordinal, 2);
  assert.equal(second.nextShadowState.sessionState.attemptSequence.nextOrdinal, 3);
  assert.equal(second.nextShadowState.revision, 2);
  assert.deepEqual(productionSession, sessionBefore);
  assert.deepEqual(productionLearner, learnerBefore);
});

test('shadow does not invent a causal pending trial from a cue the learner never saw', () => {
  const pitchObservation = {
    metricId: 'pitch.median_hz', metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register', value: 140, unit: 'Hz',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    flags: [], metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40, hitPitchCeiling: false },
  };
  const result = resolveFemV1ShadowSessionTurn({
    sessionState: baseSession(), learnerState: baseLearner(), sourceSessionRevision: 7,
    turnEvidence: {
      selfReport: { effort: 2 }, captureEvidence: { usable: true, reasons: [] }, observations: [pitchObservation],
    },
    cueResolver: resolvePitchAlphaCueForShadow,
  });
  assert.equal(result.turn.controllerTurn.action, 'serve_exercise');
  assert.equal(result.turn.controllerTurn.served, false);
  assert.equal(result.turn.controllerTurn.trialRequested, false);
  assert.equal(result.nextShadowState.sessionState.pendingTrial, null);
});

test('shadow state rejects production deltas and mismatched sessions by construction', () => {
  const state = createFemV1ShadowState({ sessionId: 'shadow-s1', sessionState: baseSession(), learnerState: baseLearner() });
  assert.throws(() => resolveFemV1ShadowSessionTurn({
    shadowState: state,
    sessionState: { sessionId: 'different', stage: 'phrase' },
    learnerState: baseLearner(),
  }), /shadow_session_mismatch/);
});
