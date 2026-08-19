'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBeginnerMasteryState } = require('./beginner-mastery');
const { resolveFemV1RuntimeTurn } = require('./fem-v1-runtime-turn');
const { resolveFemV1ShadowRuntime } = require('./target-metric-runtime');

function pitchObservation(value = 140) {
  return {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value,
    unit: 'Hz',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: {
      low: 180,
      high: 220,
      scale: 1,
      source: 'reference',
      targetKey: 'target-1',
      confidence: 0.95,
    },
    flags: [],
    metadata: {
      targetScaleUnit: 'semitone',
      detectorFamily: 'yin',
      pitchValidFrameCount: 40,
      hitPitchCeiling: false,
    },
  };
}

function mastery() {
  return createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' });
}

test('shared live seam uses qualified nonclinical pitch authority in hard shadow', () => {
  const turn = resolveFemV1ShadowRuntime({
    voiceState: { sessionId: 'shadow-authority-session', selfReport: { effort: 2 } },
    signal: { takeQuality: { usable: true }, capture: { reliability: 'good' } },
    bridge: { observations: [pitchObservation()] },
    stage: 'phrase',
    motorMap: null,
    masteryState: mastery(),
  });
  assert.equal(turn.mode, 'shadow');
  assert.equal(turn.controllerTurn.action, 'serve_exercise');
  assert.equal(turn.controllerTurn.cue.cueId, 'pitch.register.small-glide-up.v1');
  assert.equal(turn.controllerTurn.served, false);
  assert.equal(turn.controllerTurn.trialRequested, false);
  assert.equal(Object.hasOwn(turn.controllerTurn.cue, 'instruction'), false);
  assert.equal(turn.witness.turn.cueId, 'pitch.register.small-glide-up.v1');
});

test('active runtime without an explicit resolver cannot inherit shadow alpha authority', () => {
  const turn = resolveFemV1RuntimeTurn({
    mode: 'active',
    learnerState: { mastery: mastery() },
    sessionState: { sessionId: 'active-session', stage: 'phrase' },
    turnEvidence: {
      selfReport: { effort: 2 },
      captureEvidence: { usable: true, reasons: [] },
      observations: [pitchObservation()],
    },
  });
  assert.equal(turn.controllerTurn.action, 'end_block');
  assert.equal(turn.controllerTurn.reason, 'no_approved_cue_available');
  assert.equal(turn.controllerTurn.cue, null);
});

test('shared seam reads canonical attemptSequence and retains legacy typo only as migration fallback', () => {
  const attemptSequence = {
    schema: 'transvoice.session_attempt_sequence.v1',
    nextOrdinal: 2,
    attempts: [{
      ordinal: 1,
      attemptArtifactId: 'baseline-1',
      eligible: true,
      ineligibleReason: null,
    }],
  };
  const turn = resolveFemV1ShadowRuntime({
    voiceState: { sessionId: 'sequence-session', attemptSequence, selfReport: { effort: 2 } },
    signal: { takeQuality: { usable: true }, capture: { reliability: 'good' } },
    bridge: { observations: [] },
    stage: 'phrase',
    motorMap: null,
    masteryState: mastery(),
  });
  assert.equal(turn.controllerTurn.action, 'end_block');
  assert.equal(turn.shadowStateDelta.attemptSequence, undefined);
});
