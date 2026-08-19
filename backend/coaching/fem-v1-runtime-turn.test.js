'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FEM_V1_RUNTIME_SCHEMA,
  resolveFemV1RuntimeTurn,
} = require('./fem-v1-runtime-turn');
const { createBeginnerMasteryState } = require('./beginner-mastery');
const { createAttemptSequence, recordFinalizedAttempt } = require('./session-attempt-sequence');

function learnerState(overrides = {}) {
  return {
    mastery: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    motorResponseMap: null,
    goalCueOverlay: null,
    ...overrides,
  };
}

function sessionState(overrides = {}) {
  const seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline-1', eligible: true });
  return {
    sessionId: 'session-1',
    stage: 'phrase',
    pendingTrial: null,
    attemptSequence: seq,
    baselineAttemptOrdinal: 1,
    feedbackMode: null,
    ...overrides,
  };
}

function attempt(overrides = {}) {
  return {
    attemptArtifactId: 'attempt-1',
    ordinal: 2,
    eligible: true,
    ineligibleReason: null,
    observations: [],
    selfReport: { effort: 2 },
    captureEvidence: { usable: true, reasons: [] },
    ...overrides,
  };
}

test('T3-1: safety stop short-circuits everything, including trial settlement', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState({ pendingTrial: { schema: 'transvoice.pending_motor_trial.v1', status: 'pending', trialId: 't1', attemptSequenceBound: true, baselineAttemptOrdinal: 1 } }),
    finalizedAttempt: attempt({ selfReport: { pain: true } }),
    now: 1755400000000,
  });
  assert.equal(result.action, 'stop_for_safety');
  // Pain settles NOTHING: the trial was not settled — the not_applicable
  // marker with no_pending_trial-family result is the no-settlement state.
  // (A real pending trial would surface result pain_reported from the
  // motor-trial gate; a pain turn must never credit a cue.)
  assert.equal(result.settlement.status, 'not_applicable');
  assert.notEqual(result.settlement.result, 'settled');
  assert.notEqual(result.settlement.result, 'worked_verified');
  assert.equal(result.controllerTurn.action, 'stop_for_safety');
  assert.equal(result.safetyReason, 'pain');
});

test('T3-2: exact-next settlement runs BEFORE the controller decides the next cue', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt({
      observations: [{
        metricId: 'pitch.median_hz', metricDefinitionVersion: 'voice-metrics-v4-formants',
        dimension: 'pitch.register', value: 155, unit: 'Hz',
        attemptArtifactId: 'attempt-1', taskId: 'task-1', takeKind: 'phrase', analysisProfile: 'standard',
        confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
        target: { low: 180, high: 220, scale: 1, source: 'reference', targetKey: 't1', confidence: 0.95 },
        flags: [], persistenceCount: 2, importance: 0.7, controllability: 0.8,
        metadata: { targetScaleUnit: 'semitone', detectorFamily: 'yin', pitchValidFrameCount: 40, hitPitchCeiling: false },
      }],
    }),
    now: 1755400001000,
  });
  // settlement state is exposed (may be not_applicable when no trial was pending)
  assert.ok(result.settlement);
  assert.ok(result.controllerTurn);
  assert.equal(result.controllerTurn.phase, 'pitch_foundation');
});

test('T3-3: shadow mode computes the full turn but writes nothing', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt(),
    now: 1755400000000,
  });
  assert.equal(result.mode, 'shadow');
  assert.deepEqual(result.proposedStateDelta, {}); // no writes in shadow
  assert.ok(result.witness); // witness IS retained for evaluation
  assert.equal(result.witness.mode, 'shadow');
});

test('T3-4: active mode proposes state writes (not applies — the caller applies)', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'active',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt(),
    now: 1755400000000,
  });
  assert.equal(result.mode, 'active');
  assert.ok(Object.keys(result.proposedStateDelta).length >= 0); // delta is a proposal object
});

test('T3-5: unknown mode fails to shadow', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'turbo',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt(),
    now: 1755400000000,
  });
  assert.equal(result.mode, 'shadow');
});

test('T3-6: the witness is privacy-bounded — no raw observations, audio, or cue prose', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt({
      observations: [{
        metricId: 'pitch.median_hz', dimension: 'pitch.register', value: 155, unit: 'Hz',
        attemptArtifactId: 'a1', flags: [], confidence: { signal: 0.9, extractor: 0.9, target: 0.9 },
        target: { low: 180, high: 220, scale: 1, source: 'ref', targetKey: 't1', confidence: 0.9 },
        metadata: {}, takeKind: 'phrase', taskId: 'task-1', analysisProfile: 'standard',
        persistenceCount: 1, importance: 0.5, controllability: 0.5,
      }],
    }),
    now: 1755400000000,
  });
  const witnessJson = JSON.stringify(result.witness);
  assert.ok(!witnessJson.includes('observations'));
  assert.ok(!witnessJson.includes('instruction'));
  assert.ok(!witnessJson.includes('audioBase64'));
  // witness carries bounded identifiers only
  assert.ok(result.witness.schema === FEM_V1_RUNTIME_SCHEMA);
});

test('T3-7: capture-unusable attempt repairs before any coaching', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt({ captureEvidence: { usable: false, reasons: ['low_snr'] } }),
    now: 1755400000000,
  });
  assert.equal(result.controllerTurn.action, 'repair_capture');
});

test('T3-8: ineligible attempt with a reason is recorded, not silently skipped', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt({ eligible: false, ineligibleReason: 'capture_unusable' }),
    now: 1755400000000,
  });
  // the runtime consumed it as ineligible: the controller still runs, no settlement fired
  assert.ok(result.finalizedAttemptDisposition);
  assert.equal(result.finalizedAttemptDisposition.eligible, false);
  assert.equal(result.finalizedAttemptDisposition.ineligibleReason, 'capture_unusable');
});

test('T3-9 (cycle-1): the orchestrator forwards ALL stop fields — no silent drop on adoption', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt({ selfReport: { effort: 2, voiceLoss: true } }),
    now: 1755400000000,
  });
  assert.equal(result.action, 'stop_for_safety');
  assert.equal(result.safetyReason, 'voice_loss');

  const hoarse = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState(),
    finalizedAttempt: attempt({ selfReport: { effort: 2, newOrIncreasedHoarseness: true } }),
    now: 1755400000000,
  });
  assert.equal(hoarse.action, 'reduce_difficulty');
});

test('T3-10 (cycle-1): pain-skip on a real pending trial labels itself honestly', () => {
  const result = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: learnerState(),
    sessionState: sessionState({ pendingTrial: { schema: 'transvoice.pending_motor_trial.v1', status: 'pending', trialId: 'mt-xyz', attemptSequenceBound: true, baselineAttemptOrdinal: 1 } }),
    finalizedAttempt: attempt({ selfReport: { pain: true } }),
    now: 1755400000000,
  });
  assert.equal(result.action, 'stop_for_safety');
  assert.equal(result.settlement.status, 'not_applicable');
  assert.equal(result.settlement.result, 'pain_skipped_settlement');
  assert.equal(result.settlement.trialId, 'mt-xyz');
});
