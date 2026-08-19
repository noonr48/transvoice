'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLearnerContextService } = require('../learner-context-service');
const {
  BEGINNER_MASTERY_SCHEMA,
  createBeginnerMasteryState,
  recordMasteryEvidence,
} = require('./beginner-mastery');
const { resolveVoiceTargetIdentity } = require('../voice-target-identity');

function withService(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transvoice-beginner-mastery-'));
  const service = createLearnerContextService({
    storageRoot: root,
    structuredMemoryEnabled: false,
    logger: { warn() {}, log() {}, error() {} },
    now: () => 1_800_000_000_000,
  });
  return Promise.resolve()
    .then(() => fn(service, root))
    .finally(() => fs.rmSync(root, { recursive: true, force: true }));
}

function learnedMastery() {
  let mastery = createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' });
  mastery = recordMasteryEvidence(mastery, {
    skill: 'pitch',
    step: 'elicitation',
    attemptArtifactId: 'private-attempt-id',
    valid: true,
    result: 'worked_verified',
  });
  return mastery;
}

test('beginner mastery is learner-level durable state, not target-scoped learning', async () => withService(async (service) => {
  const studentId = 'student-beginner-mastery';
  const initial = service.readProfile(studentId);
  const targetKey = initial.voice.targetKey;
  assert.equal(service.getBeginnerMastery(studentId).schema, BEGINNER_MASTERY_SCHEMA);
  assert.equal(service.getBeginnerMastery(studentId).curriculumPhase, 'calibration');

  const updated = service.updateBeginnerMastery(studentId, { mastery: learnedMastery() });
  assert.equal(updated.voice.beginnerMastery.curriculumPhase, 'pitch_foundation');
  assert.equal(updated.voice.beginnerMastery.skills.pitch.steps.elicitation.state, 'verified');
  assert.equal(Object.hasOwn(updated.voice.learningByTarget[targetKey], 'beginnerMastery'), false);

  const reloaded = service.readProfile(studentId);
  assert.equal(reloaded.voice.beginnerMastery.skills.pitch.steps.elicitation.verifiedAttempts, 1);
}));

test('changing reference/target does not erase acquired beginner mastery', async () => withService(async (service) => {
  const studentId = 'student-target-switch';
  service.updateBeginnerMastery(studentId, { mastery: learnedMastery() });
  const next = resolveVoiceTargetIdentity({
    targetPreset: 'soft-feminine',
    targetSource: 'built-in',
    pitchFloorHz: 170,
    pitchCeilingHz: 240,
    resonanceFloor: 0.45,
    resonanceCeiling: 1,
    weightFloor: 0,
    weightCeiling: 0.45,
  });
  assert.equal(next.valid, true);
  service.setActiveVoiceTarget(studentId, {
    targetPreset: 'soft-feminine',
    targetSource: 'built-in',
    targetKey: next.targetKey,
    pitchFloorHz: 170,
    pitchCeilingHz: 240,
    resonanceFloor: 0.45,
    resonanceCeiling: 1,
    weightFloor: 0,
    weightCeiling: 0.45,
  });
  const mastery = service.getBeginnerMastery(studentId);
  assert.equal(mastery.curriculumPhase, 'pitch_foundation');
  assert.equal(mastery.skills.pitch.steps.elicitation.state, 'verified');
}));

test('beginner mastery does not enter the model-facing learner snapshot', async () => withService(async (service) => {
  const studentId = 'student-mastery-snapshot';
  service.updateBeginnerMastery(studentId, { mastery: learnedMastery() });
  const snapshot = await service.getVoiceStudentModelSnapshot(studentId, 'coach me');
  const serialized = JSON.stringify(snapshot);
  assert.equal(snapshot.available, true);
  assert.equal(Object.hasOwn(snapshot, 'beginnerMastery'), false);
  assert.equal(Object.hasOwn(snapshot.learnerContext || {}, 'beginnerMastery'), false);
  assert.doesNotMatch(serialized, /private-attempt-id/);
  assert.doesNotMatch(serialized, /noFeedbackVerifiedAttempts/);
}));

test('corrupt persisted mastery normalizes before read or write', async () => withService(async (service) => {
  const studentId = 'student-corrupt-mastery';
  const updated = service.updateBeginnerMastery(studentId, {
    mastery: {
      curriculumPhase: 'made-up-phase',
      skills: {
        pitch: {
          steps: {
            elicitation: {
              state: 'perfect',
              validAttempts: -500,
              verifiedAttempts: 999999999,
            },
          },
        },
      },
    },
  });
  assert.equal(updated.voice.beginnerMastery.curriculumPhase, 'calibration');
  assert.equal(updated.voice.beginnerMastery.skills.pitch.steps.elicitation.state, 'not_observed');
  assert.equal(updated.voice.beginnerMastery.skills.pitch.steps.elicitation.validAttempts, 0);
}));

test('forget learned memory resets beginner mastery with motor and coaching memory', async () => withService(async (service) => {
  const studentId = 'student-reset-mastery';
  service.updateBeginnerMastery(studentId, { mastery: learnedMastery() });
  assert.equal(service.getBeginnerMastery(studentId).curriculumPhase, 'pitch_foundation');
  service.resetLearnerMemory(studentId);
  const reset = service.getBeginnerMastery(studentId);
  assert.equal(reset.curriculumPhase, 'calibration');
  assert.equal(reset.skills.pitch.steps.elicitation.state, 'not_observed');
}));
