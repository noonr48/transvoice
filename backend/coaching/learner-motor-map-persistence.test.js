'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createLearnerContextService } = require('../learner-context-service');
const { MOTOR_MAP_SCHEMA } = require('./motor-map');
const { resolveVoiceTargetIdentity } = require('../voice-target-identity');

function withService(fn) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'transvoice-motor-map-'));
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

function learnedMap() {
  return {
    schema: MOTOR_MAP_SCHEMA,
    byCue: {
      'pitch.register.small-glide-up.v1': {
        attempts: 3,
        successes: 2,
        verifiedFailures: 1,
        meanVerifiedTargetGain: 0.7,
        verifiedGainObservations: 2,
        byDimension: {
          'pitch.register': {
            attempts: 3,
            successes: 2,
            verifiedFailures: 1,
            meanVerifiedTargetGain: 0.7,
            verifiedGainObservations: 2,
          },
        },
      },
    },
  };
}

test('active-target motor map round-trips only inside learningByTarget', async () => withService(async (service) => {
  const studentId = 'student-motor-map';
  const initial = service.readProfile(studentId);
  const targetKey = initial.voice.targetKey;

  assert.deepEqual(service.getTargetMotorMap(studentId), { schema: MOTOR_MAP_SCHEMA, byCue: {} });
  const updated = service.updateTargetMotorMap(studentId, { motorMap: learnedMap() });

  assert.equal(updated.voice.learningByTarget[targetKey].motorMap.schema, MOTOR_MAP_SCHEMA);
  assert.equal(updated.voice.learningByTarget[targetKey].motorMap.byCue['pitch.register.small-glide-up.v1'].successes, 2);
  assert.equal(Object.hasOwn(updated.voice, 'motorMap'), false);

  const reloaded = service.readProfile(studentId);
  assert.equal(reloaded.voice.learningByTarget[targetKey].motorMap.byCue['pitch.register.small-glide-up.v1'].attempts, 3);
  assert.equal(service.getTargetMotorMap(studentId).byCue['pitch.register.small-glide-up.v1'].successes, 2);
}));

test('motor map does not enter the model-facing learner snapshot', async () => withService(async (service) => {
  const studentId = 'student-snapshot';
  service.updateTargetMotorMap(studentId, { motorMap: learnedMap() });
  const snapshot = await service.getVoiceStudentModelSnapshot(studentId, 'coach me');
  const serialized = JSON.stringify(snapshot);

  assert.equal(snapshot.available, true);
  assert.equal(Object.hasOwn(snapshot, 'motorMap'), false);
  assert.equal(Object.hasOwn(snapshot.learnerContext || {}, 'motorMap'), false);
  assert.doesNotMatch(serialized, /pitch\.register\.small-glide-up\.v1/);
  assert.doesNotMatch(serialized, /meanVerifiedTargetGain/);
}));

test('explicit unknown/non-owned target bucket is rejected rather than created', async () => withService(async (service) => {
  const studentId = 'student-wrong-target';
  const profile = service.readProfile(studentId);
  const other = resolveVoiceTargetIdentity({
    targetPreset: 'soft-feminine',
    targetSource: 'built-in',
    pitchFloorHz: 170,
    pitchCeilingHz: 240,
    resonanceFloor: 0.45,
    resonanceCeiling: 1,
    weightFloor: 0,
    weightCeiling: 0.45,
  });
  assert.ok(other.targetKey);
  assert.notEqual(other.targetKey, profile.voice.targetKey);

  assert.throws(() => service.updateTargetMotorMap(studentId, {
    targetKey: other.targetKey,
    motorMap: learnedMap(),
  }), /target learning bucket/i);
  assert.equal(service.readProfile(studentId).voice.learningByTarget[other.targetKey], undefined);
}));

test('corrupt motor-map values are normalized before they become durable or rankable', async () => withService(async (service) => {
  const studentId = 'student-corrupt-map';
  const updated = service.updateTargetMotorMap(studentId, {
    motorMap: {
      schema: MOTOR_MAP_SCHEMA,
      byCue: {
        'cue-corrupt': {
          attempts: 2,
          successes: 9999,
          meanVerifiedTargetGain: Infinity,
          verifiedGainObservations: 9999,
          byDimension: {},
        },
      },
    },
  });
  const map = service.getTargetMotorMap(studentId);
  assert.equal(map.byCue['cue-corrupt'].attempts, 2);
  assert.equal(map.byCue['cue-corrupt'].successes, 2);
  assert.equal(map.byCue['cue-corrupt'].meanVerifiedTargetGain, 0);
  assert.equal(map.byCue['cue-corrupt'].verifiedGainObservations, 2);
  assert.deepEqual(updated.voice.learningByTarget[updated.voice.targetKey].motorMap, map);
}));

test('learner memory reset clears the target motor map with the rest of learned coaching state', async () => withService(async (service) => {
  const studentId = 'student-reset-map';
  service.updateTargetMotorMap(studentId, { motorMap: learnedMap() });
  assert.ok(Object.keys(service.getTargetMotorMap(studentId).byCue).length > 0);
  service.resetLearnerMemory(studentId);
  assert.deepEqual(service.getTargetMotorMap(studentId), { schema: MOTOR_MAP_SCHEMA, byCue: {} });
}));
