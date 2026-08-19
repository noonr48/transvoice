'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLearnerContextService } = require('./learner-context-service');
const {
  createVoiceStandaloneRuntime,
  createVoiceStandaloneSessionStore,
} = require('./voice-standalone-runtime');
const { resolveVoiceTargetIdentity } = require('./voice-target-identity');

function makeBinding() {
  const targetVoiceProfile = {
    profileId: 'profile-aster',
    clipId: 'clip-aster',
    targetPreset: 'cute-feminine',
    direction: 'feminine',
    analysisVersion: 'voice-metrics-v2',
    pitchFloorHz: 170,
    pitchCeilingHz: 230,
    resonanceFloor: 0.35,
    resonanceCeiling: 0.65,
    weightFloor: 0.25,
    weightCeiling: 0.55,
  };
  const identity = resolveVoiceTargetIdentity({
    targetSource: 'custom-reference',
    targetPreset: targetVoiceProfile.targetPreset,
    targetProfileId: targetVoiceProfile.profileId,
    referenceClipId: targetVoiceProfile.clipId,
    direction: targetVoiceProfile.direction,
    analysisVersion: targetVoiceProfile.analysisVersion,
    pitchFloorHz: targetVoiceProfile.pitchFloorHz,
    pitchCeilingHz: targetVoiceProfile.pitchCeilingHz,
    resonanceFloor: targetVoiceProfile.resonanceFloor,
    resonanceCeiling: targetVoiceProfile.resonanceCeiling,
    weightFloor: targetVoiceProfile.weightFloor,
    weightCeiling: targetVoiceProfile.weightCeiling,
  });
  return {
    presetId: 'preset-aster',
    presetName: 'Aster',
    referenceClipId: 'clip-aster',
    targetPreset: targetVoiceProfile.targetPreset,
    targetSource: 'custom-reference',
    targetKey: identity.targetKey,
    targetProfileId: targetVoiceProfile.profileId,
    analysisVersion: targetVoiceProfile.analysisVersion,
    direction: targetVoiceProfile.direction,
    targetVoiceProfile,
  };
}

function makeSession(id, studentId, binding = makeBinding()) {
  return {
    id,
    studentId,
    agentId: 'voice-tutor-standalone',
    createdAt: Date.now() - 1000,
    updatedAt: Date.now(),
    mode: 'voice',
    voiceState: {
      status: 'idle',
      targetPreset: binding.targetPreset,
      targetSource: binding.targetSource,
      selectedCustomPresetId: binding.presetId,
      selectedCustomPresetName: binding.presetName,
      referenceClipId: binding.referenceClipId,
      referenceClipName: 'aster.wav',
      targetVoiceProfile: binding.targetVoiceProfile,
      targetBinding: binding,
      coachThread: [
        { role: 'user', content: 'private learner speech' },
        { role: 'coach', content: 'private working response' },
      ],
      lastCoachMessage: 'private working response',
      lastSummary: {
        transcript: 'private learner speech',
        metrics: { meanPitchHz: 190 },
      },
      voiceInputRuntime: {
        lastTranscript: 'private learner speech',
        lastPartialTranscript: 'private learner',
        transcriptSource: 'asr',
      },
    },
    lessonState: {
      status: 'practice',
      currentExerciseIndex: 3,
    },
    mainTask: 'private working task',
    notepad: { content: 'private note', items: [] },
    summary: { text: 'private summary' },
  };
}

function makeHarness(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-memory-control-'));
  const learnerRoot = path.join(root, 'learner-context');
  const sessionStorePath = path.join(root, 'sessions.json');
  const evalPath = path.join(root, 'eval-turns.jsonl');
  const learnerContextService = createLearnerContextService({
    storageRoot: learnerRoot,
    logger: { warn() {}, log() {} },
  });
  const binding = makeBinding();
  const sessions = new Map([
    ['learner-session', makeSession('learner-session', 'learner', binding)],
    ['other-session', makeSession('other-session', 'other', binding)],
  ]);
  const runtimeOptions = {
    sessions,
    learnerContextService,
    stateRoot: root,
    sessionStorePath,
    logger: false,
    fetchImpl: async () => { throw new Error('offline test'); },
  };
  if (options.evalEnabled !== false) {
    runtimeOptions.evalPath = evalPath;
  }
  const runtime = createVoiceStandaloneRuntime(runtimeOptions);
  return {
    binding,
    learnerContextService,
    evalPath,
    root,
    runtime,
    sessionStorePath,
  };
}

test('reset personalization clears learned/runtime state but preserves the exact selected preset', async (t) => {
  const h = makeHarness();
  t.after(() => fs.rmSync(h.root, { recursive: true, force: true }));
  h.learnerContextService.setActiveVoiceTarget('learner', h.binding);
  h.learnerContextService.addMoment('learner', {
    kind: 'win',
    text: 'A private remembered moment',
  });
  h.learnerContextService.addCoachPreference('learner', {
    id: 'slower-pace',
    text: 'Prefers a slower coaching pace',
  });
  h.learnerContextService.updateNotepadHandoff('learner', {
    content: 'private handoff',
  });

  const response = await h.runtime.learnerContextRouteHandlers.forgetLearnerContext({
    studentId: 'learner',
    operation: 'reset-personalization',
  });

  assert.equal(response.success, true);
  assert.equal(response.resetReceipt.operation, 'reset-personalization');
  assert.equal(response.resetReceipt.runtimeStore.resetSessions, 1);
  const profile = h.learnerContextService.readProfile('learner');
  assert.equal(profile.voice.targetBinding.targetKey, h.binding.targetKey);
  assert.deepEqual(profile.voice.moments, []);
  assert.deepEqual(profile.voice.coachPreferences, []);
  assert.equal(profile.voice.notepadHandoff, null);

  const session = h.runtime.sessions.get('learner-session');
  assert.ok(session, 'reset keeps a target-bound shell so the exact preset can resume');
  assert.equal(session.voiceState.referenceClipId, h.binding.referenceClipId);
  assert.equal(session.voiceState.selectedCustomPresetId, h.binding.presetId);
  assert.deepEqual(session.voiceState.coachThread, []);
  assert.equal(session.voiceState.lastCoachMessage, null);
  assert.equal(session.voiceState.lastSummary, null);
  assert.equal(session.lessonState, null);
  assert.equal(session.mainTask, null);
  assert.equal(session.notepad.content, '');
  assert.equal(h.runtime.sessions.has('other-session'), true);

  const persisted = fs.readFileSync(h.sessionStorePath, 'utf8');
  assert.doesNotMatch(persisted, /private learner speech|private working response|private handoff/);
});

test('delete all removes learner files and runtime sessions with an idempotent receipt', async (t) => {
  const h = makeHarness();
  t.after(() => fs.rmSync(h.root, { recursive: true, force: true }));
  h.learnerContextService.setActiveVoiceTarget('learner', h.binding);
  h.learnerContextService.addMoment('learner', {
    kind: 'win',
    text: 'delete this memory',
  });
  const learnerKey = crypto.createHash('sha256').update('learner').digest('hex');
  const otherKey = crypto.createHash('sha256').update('other').digest('hex');
  fs.writeFileSync(h.evalPath, [
    JSON.stringify({
      sessionId: 'learner-session',
      learnerKey,
      rawReply: 'DELETE_EVAL_SENTINEL',
    }),
    JSON.stringify({
      sessionId: 'other-session',
      learnerKey: otherKey,
      rawReply: '[redacted]',
    }),
    JSON.stringify({
      sessionId: 'legacy-session',
      rawReply: 'UNATTRIBUTED_LEGACY_SENTINEL',
    }),
  ].join('\n') + '\n', 'utf8');

  const corruptMixedPath = `${h.sessionStorePath}.corrupt.101`;
  const corruptUnreadablePath = `${h.sessionStorePath}.corrupt.102`;
  const interruptedPath = `${h.sessionStorePath}.103.104.tmp`;
  const unrelatedPath = `${h.sessionStorePath}.unrelated`;
  const mixedPayload = {
    schemaVersion: 'voice-standalone-sessions-v2',
    sessions: [
      makeSession('learner-corrupt', 'learner', h.binding),
      makeSession('other-corrupt', 'other', h.binding),
    ],
  };
  mixedPayload.sessions[0].voiceState.coachThread = [
    { role: 'user', content: 'DELETE_CORRUPT_SENTINEL' },
  ];
  fs.writeFileSync(corruptMixedPath, JSON.stringify(mixedPayload), 'utf8');
  fs.writeFileSync(corruptUnreadablePath, '{ DELETE_UNREADABLE_SENTINEL', 'utf8');
  fs.writeFileSync(interruptedPath, JSON.stringify(mixedPayload), 'utf8');
  fs.writeFileSync(unrelatedPath, 'LEAVE_UNRELATED_SENTINEL', 'utf8');

  const first = await h.runtime.learnerContextRouteHandlers.forgetLearnerContext({
    studentId: 'learner',
    operation: 'delete-all',
  });
  const second = await h.runtime.learnerContextRouteHandlers.forgetLearnerContext({
    studentId: 'learner',
    operation: 'delete-all',
  });

  assert.equal(first.success, true);
  assert.equal(first.learnerContext, null);
  assert.equal(first.deletionReceipt.runtimeStore.deletedSessions, 1);
  assert.equal(first.deletionReceipt.learnerStore.stores.profile, true);
  assert.equal(first.deletionReceipt.learnerStore.stores.events, true);
  assert.equal(second.deletionReceipt.runtimeStore.deletedSessions, 0);
  assert.equal(h.runtime.sessions.has('learner-session'), false);
  assert.equal(h.runtime.sessions.has('other-session'), true);
  assert.equal(fs.existsSync(h.learnerContextService.getProfilePath('learner')), false);
  assert.equal(fs.existsSync(h.learnerContextService.getEventsPath('learner')), false);
  const persisted = fs.readFileSync(h.sessionStorePath, 'utf8');
  const persistedBackup = fs.readFileSync(`${h.sessionStorePath}.bak`, 'utf8');
  assert.doesNotMatch(persisted, /learner-session|delete this memory/);
  assert.doesNotMatch(persistedBackup, /learner-session|delete this memory/);
  assert.match(persisted, /other-session/);
  assert.match(persistedBackup, /other-session/);
  assert.equal(first.deletionReceipt.runtimeStore.persistencePasses, 2);
  assert.equal(first.deletionReceipt.runtimeStore.persistedGenerations, 2);
  assert.equal(first.deletionReceipt.runtimeStore.sessionArtifacts.success, true);
  assert.equal(first.deletionReceipt.runtimeStore.sessionArtifacts.remainingTargetRecords, 0);
  assert.equal(first.deletionReceipt.runtimeStore.evalStore.success, true);
  assert.equal(first.deletionReceipt.runtimeStore.evalStore.remainingTargetRecords, 0);
  assert.equal(fs.existsSync(corruptUnreadablePath), false);
  assert.doesNotMatch(fs.readFileSync(corruptMixedPath, 'utf8'), /learner-corrupt|DELETE_CORRUPT_SENTINEL/);
  assert.match(fs.readFileSync(corruptMixedPath, 'utf8'), /other-corrupt/);
  assert.doesNotMatch(fs.readFileSync(interruptedPath, 'utf8'), /learner-corrupt/);
  assert.match(fs.readFileSync(interruptedPath, 'utf8'), /other-corrupt/);
  assert.equal(fs.readFileSync(unrelatedPath, 'utf8'), 'LEAVE_UNRELATED_SENTINEL');
  const evalText = fs.readFileSync(h.evalPath, 'utf8');
  assert.doesNotMatch(evalText, /DELETE_EVAL_SENTINEL|UNATTRIBUTED_LEGACY_SENTINEL|learner-session/);
  assert.match(evalText, /other-session/);
});

test('delete all scrubs a dormant eval ledger while live recording is disabled', async (t) => {
  const h = makeHarness({ evalEnabled: false });
  t.after(() => fs.rmSync(h.root, { recursive: true, force: true }));
  const learnerKey = crypto.createHash('sha256').update('learner').digest('hex');
  const otherKey = crypto.createHash('sha256').update('other').digest('hex');
  assert.equal(h.runtime.config.evalPath, null, 'live turn recording remains disabled');
  assert.equal(h.runtime.config.evalStorePath, h.evalPath);
  fs.writeFileSync(h.evalPath, [
    JSON.stringify({
      sessionId: 'learner-session',
      learnerKey,
      rawReply: 'DELETE_DORMANT_EVAL_SENTINEL',
    }),
    JSON.stringify({
      sessionId: 'other-session',
      learnerKey: otherKey,
      rawReply: '[redacted]',
    }),
  ].join('\n') + '\n', 'utf8');

  const response = await h.runtime.learnerContextRouteHandlers.forgetLearnerContext({
    studentId: 'learner',
    operation: 'delete-all',
  });

  assert.equal(response.success, true);
  assert.equal(response.deletionReceipt.runtimeStore.evalStore.success, true);
  assert.equal(response.deletionReceipt.runtimeStore.evalStore.remainingTargetRecords, 0);
  const evalText = fs.readFileSync(h.evalPath, 'utf8');
  assert.doesNotMatch(evalText, /DELETE_DORMANT_EVAL_SENTINEL|learner-session/);
  assert.match(evalText, /other-session/);
});

test('delete all scrubs and rebuilds an unrecoverably corrupt primary with no backup', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-memory-corrupt-delete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionStorePath = path.join(root, 'sessions.json');
  const corruptSentinel = 'PRIVATE_CORRUPT_LEARNER_BYTES';
  fs.writeFileSync(sessionStorePath, `{ ${corruptSentinel}`, 'utf8');

  const sessionStore = createVoiceStandaloneSessionStore({
    storePath: sessionStorePath,
    logger: false,
  });
  assert.equal(sessionStore.loadSessions().size, 0);
  assert.equal(sessionStore.getStoreInfo().writeBlocked, true);
  assert.equal(fs.existsSync(`${sessionStorePath}.bak`), false);

  const learnerContextService = createLearnerContextService({
    storageRoot: path.join(root, 'learner-context'),
    logger: { warn() {}, log() {} },
  });
  learnerContextService.addMoment('learner', {
    kind: 'win',
    text: 'delete this remembered moment too',
  });
  const binding = makeBinding();
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map([
      ['learner-session', makeSession('learner-session', 'learner', binding)],
      ['other-session', makeSession('other-session', 'other', binding)],
    ]),
    sessionStore,
    sessionStorePath,
    learnerContextService,
    stateRoot: root,
    logger: false,
    fetchImpl: async () => { throw new Error('offline test'); },
  });

  const response = await runtime.learnerContextRouteHandlers.forgetLearnerContext({
    studentId: 'learner',
    operation: 'delete-all',
  });

  assert.equal(response.success, true);
  assert.equal(
    response.deletionReceipt.runtimeStore.writeRecovery.recovered,
    true,
  );
  assert.equal(sessionStore.getStoreInfo().writeBlocked, false);
  assert.equal(runtime.sessions.has('learner-session'), false);
  assert.equal(runtime.sessions.has('other-session'), true);
  assert.equal(fs.existsSync(`${sessionStorePath}.bak`), true);
  for (const name of fs.readdirSync(root).filter((entry) => entry.startsWith('sessions.json'))) {
    const text = fs.readFileSync(path.join(root, name), 'utf8');
    assert.doesNotMatch(text, new RegExp(corruptSentinel));
    assert.doesNotMatch(text, /learner-session|private learner speech/);
  }
  assert.match(fs.readFileSync(sessionStorePath, 'utf8'), /other-session/);
  assert.match(fs.readFileSync(`${sessionStorePath}.bak`, 'utf8'), /other-session/);
  assert.equal(fs.existsSync(learnerContextService.getProfilePath('learner')), false);
  assert.equal(fs.existsSync(learnerContextService.getEventsPath('learner')), false);
});

test('delete all rejects an unsupported session schema without mutating any bytes or live sessions', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-memory-unsupported-delete-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionStorePath = path.join(root, 'sessions.json');
  const binding = makeBinding();
  const unsupportedBytes = `${JSON.stringify({
    schemaVersion: 'voice-standalone-sessions-v99',
    futureMetadata: 'KEEP_FUTURE_METADATA',
    sessions: [
      makeSession('learner-future', 'learner', binding),
      makeSession('other-future', 'other', binding),
    ],
  }, null, 2)}\n`;
  fs.writeFileSync(sessionStorePath, unsupportedBytes, 'utf8');

  const sessionStore = createVoiceStandaloneSessionStore({
    storePath: sessionStorePath,
    logger: false,
  });
  assert.equal(sessionStore.loadSessions().size, 0);
  assert.equal(sessionStore.getStoreInfo().writeBlockKind, 'unsupported-schema');

  const learnerContextService = createLearnerContextService({
    storageRoot: path.join(root, 'learner-context'),
    logger: { warn() {}, log() {} },
  });
  learnerContextService.addMoment('learner', {
    kind: 'win',
    text: 'must remain until deletion can be verified',
  });
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map([
      ['learner-session', makeSession('learner-session', 'learner', binding)],
      ['other-session', makeSession('other-session', 'other', binding)],
    ]),
    sessionStore,
    sessionStorePath,
    learnerContextService,
    stateRoot: root,
    logger: false,
    fetchImpl: async () => { throw new Error('offline test'); },
  });

  await assert.rejects(
    runtime.learnerContextRouteHandlers.forgetLearnerContext({
      studentId: 'learner',
      operation: 'delete-all',
    }),
    /cannot safely interpret the write-blocked session schema/i,
  );

  assert.equal(fs.readFileSync(sessionStorePath, 'utf8'), unsupportedBytes);
  assert.equal(runtime.sessions.has('learner-session'), true);
  assert.equal(runtime.sessions.has('other-session'), true);
  assert.equal(
    fs.existsSync(learnerContextService.getProfilePath('learner')),
    true,
  );
});
