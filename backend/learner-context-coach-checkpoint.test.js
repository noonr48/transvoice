'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createLearnerContextService,
  LEARNER_CONTEXT_SCHEMA_VERSION,
  normalizeCoachCheckpoint,
} = require('./learner-context-service');

function makeMemFs() {
  const files = new Map();
  const dirs = new Set();
  return {
    files,
    existsSync: (filePath) => files.has(filePath) || dirs.has(filePath),
    mkdirSync: (filePath) => { dirs.add(filePath); },
    chmodSync: () => {},
    readFileSync: (filePath) => {
      if (!files.has(filePath)) throw new Error(`ENOENT ${filePath}`);
      return files.get(filePath);
    },
    writeFileSync: (filePath, value) => { files.set(filePath, value); },
    appendFileSync: (filePath, value) => { files.set(filePath, (files.get(filePath) || '') + value); },
    renameSync: (from, to) => {
      files.set(to, files.get(from));
      files.delete(from);
    },
  };
}

function makeService(clock = { now: 1_750_000_000_000 }) {
  const fsModule = makeMemFs();
  const service = createLearnerContextService({
    fsModule,
    logger: { warn() {} },
    now: () => clock.now,
    storageRoot: '/tmp/transvoice-coach-checkpoint-test',
  });
  return { clock, fsModule, service };
}

test('coach checkpoint is bounded, normalized, and excludes conversation history', () => {
  const checkpoint = normalizeCoachCheckpoint({
    sessionId: ' session-1 ',
    state: 'active',
    startedAt: 1_700_000_000_000,
    restartCount: 3.7,
    lastSpokeAt: 1_700_000_000_100,
    lastCoachSpokeAt: 1_700_000_000_200,
    transcript: 'this must never persist',
    coachThread: [{ text: 'nor this' }],
    lesson: {
      status: 'practice',
      stage: 'core',
      focus: 'resonance',
      exerciseIndex: 2.8,
    },
    practice: {
      text: `  ${'a'.repeat(900)}  `,
      pronunciation: 'hee-LOH',
    },
    preset: {
      id: 'preset-1',
      name: 'Aster',
      referenceClipId: 'clip-1',
      targetSource: 'custom-reference',
    },
  });

  assert.equal(checkpoint.sessionId, 'session-1');
  assert.equal(checkpoint.state, 'active');
  assert.equal(checkpoint.restartCount, 4);
  assert.equal(checkpoint.lastLearnerSpokeAt, 1_700_000_000_100);
  assert.equal(checkpoint.lastCoachSpokeAt, 1_700_000_000_200);
  assert.equal(checkpoint.lesson.exerciseIndex, 3);
  assert.equal(checkpoint.practice.text.length, 500);
  assert.equal(checkpoint.preset.referenceClipId, 'clip-1');
  assert.equal(Object.hasOwn(checkpoint, 'transcript'), false);
  assert.equal(Object.hasOwn(checkpoint, 'coachThread'), false);
});

test('schema-v6 migration supplies an empty checkpoint to an older profile', () => {
  const { fsModule, service } = makeService();
  const profilePath = service.getProfilePath('learner-1');
  fsModule.files.set(profilePath, JSON.stringify({
    schemaVersion: 'sloane.learner_context.v4',
    studentId: 'learner-1',
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    voice: { targetPreset: 'cute-feminine' },
  }));

  const profile = service.readProfile('learner-1');
  assert.equal(LEARNER_CONTEXT_SCHEMA_VERSION, 'sloane.learner_context.v6');
  assert.equal(profile.schemaVersion, LEARNER_CONTEXT_SCHEMA_VERSION);
  assert.equal(profile.voice.coachCheckpoint, null);
});

test('checkpoint patches merge nested lesson/practice/preset state and expose one snapshot pointer', async () => {
  const { clock, service } = makeService();
  service.updateCoachCheckpoint('learner-2', {
    sessionId: 'lesson-session',
    state: 'active',
    startedAt: clock.now - 20_000,
    restartCount: 1,
    lesson: { status: 'practice', stage: 'core', focus: 'resonance', exerciseIndex: 4 },
    practice: { lineId: 'line-4', text: 'Hello there', pronunciation: 'heh-LOH thair' },
    preset: { id: 'preset-a', name: 'Aster', referenceClipId: 'clip-a' },
  }, { reason: 'session-started' });

  clock.now += 5000;
  service.updateCoachCheckpoint('learner-2', {
    state: 'stopped',
    stoppedAt: clock.now,
    lesson: { exerciseIndex: 5 },
  }, { reason: 'learner-stopped' });

  const profile = service.readProfile('learner-2');
  assert.equal(profile.voice.coachCheckpoint.sessionId, 'lesson-session');
  assert.equal(profile.voice.coachCheckpoint.state, 'stopped');
  assert.equal(profile.voice.coachCheckpoint.lesson.focus, 'resonance');
  assert.equal(profile.voice.coachCheckpoint.lesson.exerciseIndex, 5);
  assert.equal(profile.voice.coachCheckpoint.practice.text, 'Hello there');
  assert.equal(profile.voice.coachCheckpoint.preset.name, 'Aster');
  assert.equal(profile.voice.coachCheckpoint.updatedAt, clock.now);

  const snapshot = await service.getVoiceStudentModelSnapshot('learner-2');
  assert.deepEqual(snapshot.coachCheckpoint, profile.voice.coachCheckpoint);
  assert.deepEqual(snapshot.learnerContext.coachCheckpoint, profile.voice.coachCheckpoint);
});

test('checkpoint event ledger is categorical and never copies content or raw identifiers', () => {
  const { fsModule, service } = makeService();
  const privateValues = [
    'My private practice sentence',
    'mai PRY-vit SEN-tens',
    'Private Voice Name',
    'session-private',
    'preset-private',
    'clip-private',
  ];
  service.updateCoachCheckpoint('learner-3', {
    sessionId: 'session-private',
    state: 'active',
    practice: { text: privateValues[0], pronunciation: privateValues[1] },
    preset: { id: 'preset-private', name: privateValues[2], referenceClipId: 'clip-private' },
  }, { reason: 'practice-updated' });

  const eventText = fsModule.files.get(service.getEventsPath('learner-3'));
  for (const privateValue of privateValues) {
    assert.doesNotMatch(eventText, new RegExp(privateValue));
  }
  const event = JSON.parse(eventText.trim());
  assert.equal(event.type, 'coach_checkpoint_updated');
  assert.equal(event.payload.reason, 'practice-updated');
  assert.equal(event.payload.hasPractice, true);
  assert.equal(event.payload.hasPreset, true);
});

test('forgetting learner memory clears the coach checkpoint', () => {
  const { service } = makeService();
  service.updateCoachCheckpoint('learner-4', {
    sessionId: 'session-to-forget',
    state: 'stopped',
  });
  assert.ok(service.readProfile('learner-4').voice.coachCheckpoint);

  service.resetLearnerMemory('learner-4');
  assert.equal(service.readProfile('learner-4').voice.coachCheckpoint, null);
});
