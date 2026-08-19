'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createVoiceStandaloneRuntime,
  createVoiceStandaloneSessionStore,
} = require('./voice-standalone-runtime');

function tempRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tv-session-memory-'));
}

function privateSession(id = 'session-private') {
  return {
    id,
    studentId: 'learner-private',
    createdAt: 1000,
    updatedAt: 2000,
    mainTask: 'private legacy task',
    notepad: { content: 'private notepad text' },
    summary: { text: 'private summary text' },
    voiceState: {
      status: 'idle',
      targetPreset: 'cute-feminine',
      targetSource: 'custom-reference',
      selectedCustomPresetId: 'preset-private',
      selectedCustomPresetName: 'Aster',
      referenceClipId: 'clip-private',
      coachThread: [
        { role: 'user', content: 'my private spoken sentence' },
        { role: 'coach', content: 'private coach response' },
      ],
      lastCoachMessage: 'private coach response',
      activeLine: {
        id: 'line-1',
        displayText: 'The visible practice line may persist.',
      },
      voiceInputRuntime: {
        status: 'completed',
        lastTranscript: 'my private spoken sentence',
        lastPartialTranscript: 'my private',
        transcriptSource: 'backend',
      },
      lastSummary: {
        transcript: 'my private spoken sentence',
        metrics: { meanPitchHz: 190 },
      },
      lastAttemptArtifact: {
        transcript: 'my private spoken sentence',
        audioBase64: 'SECRET_AUDIO_BYTES',
      },
    },
  };
}

test('durable session records keep semantic continuity but strip conversation, transcripts, and raw audio', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'sessions.json');
  const store = createVoiceStandaloneSessionStore({ storePath, logger: false });
  store.saveSessions(new Map([['session-private', privateSession()]]));

  const text = fs.readFileSync(storePath, 'utf8');
  assert.doesNotMatch(text, /my private spoken sentence/);
  assert.doesNotMatch(text, /private coach response/);
  assert.doesNotMatch(text, /SECRET_AUDIO_BYTES/);
  assert.doesNotMatch(text, /private notepad text|private legacy task|private summary text/);
  const record = JSON.parse(text).sessions[0];
  assert.equal(record.voiceState.activeLine.displayText, 'The visible practice line may persist.');
  assert.equal(record.voiceState.referenceClipId, 'clip-private');
  assert.equal(Object.hasOwn(record.voiceState, 'coachThread'), false);
  assert.equal(Object.hasOwn(record.voiceState.voiceInputRuntime, 'lastTranscript'), false);
});

test('session export applies the same privacy boundary as disk persistence', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessions = new Map([['session-private', privateSession()]]);
  const runtime = createVoiceStandaloneRuntime({
    sessions,
    logger: false,
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  const exported = runtime.standaloneSessionRouteHandlers.exportSession('session-private');
  const text = JSON.stringify(exported.session);
  assert.doesNotMatch(text, /my private spoken sentence|private coach response|SECRET_AUDIO_BYTES/);
  assert.equal(exported.session.voiceState.activeLine.displayText, 'The visible practice line may persist.');
});

test('corrupt session store quarantines and recovers its previous valid generation', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'sessions.json');
  const store = createVoiceStandaloneSessionStore({ storePath, logger: false });
  store.saveSessions(new Map([['first', privateSession('first')]]));
  store.saveSessions(new Map([['second', privateSession('second')]]));
  fs.writeFileSync(storePath, '{ broken json', 'utf8');

  const recovering = createVoiceStandaloneSessionStore({ storePath, logger: false });
  const loaded = recovering.loadSessions();
  assert.equal(loaded.has('first'), true);
  assert.equal(loaded.has('second'), false);
  assert.equal(recovering.getStoreInfo().health.status, 'recovered');
  assert.equal(fs.readdirSync(root).some((name) => name.includes('.corrupt.')), true);
});

test('unrecoverable session-store corruption blocks later writes', (t) => {
  const root = tempRoot();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'sessions.json');
  fs.writeFileSync(storePath, '{ broken json', 'utf8');
  const store = createVoiceStandaloneSessionStore({ storePath, logger: false });
  assert.equal(store.loadSessions().size, 0);
  const result = store.saveSessions(new Map([['new', privateSession('new')]]));
  assert.equal(result.blocked, true);
  assert.match(result.reason, /corrupt/i);
});
