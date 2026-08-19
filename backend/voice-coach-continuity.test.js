'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');
const { resolveVoiceTargetIdentity } = require('./voice-target-identity');

function makeExistingSession() {
  return {
    id: 'continuing-session',
    agentId: 'voice-tutor-standalone',
    studentId: 'continuity-learner',
    createdAt: 1_750_000_000_000,
    updatedAt: 1_750_000_010_000,
    mode: 'voice',
    voiceState: {
      status: 'idle',
      targetPreset: 'cute-feminine',
      targetSource: 'custom-reference',
      selectedCustomPresetId: 'preset-aster',
      selectedCustomPresetName: 'Aster',
      referenceClipId: 'clip-aster',
      referenceClipName: 'aster.wav',
      targetVoiceProfile: {
        profileId: 'profile-aster',
        clipId: 'clip-aster',
        analysisVersion: 'voice-metrics-v2',
        targetPreset: 'cute-feminine',
        direction: 'feminine',
        pitchFloorHz: 170,
        pitchCeilingHz: 230,
        resonanceFloor: 0.35,
        resonanceCeiling: 0.65,
        weightFloor: 0.25,
        weightCeiling: 0.55,
      },
      activeLine: {
        id: 'line-7',
        displayText: 'Meet me by the garden gate.',
        performanceText: 'Keep this phrase light and forward.',
        cueSheet: {
          phrase: 'Meet me by the garden gate.',
          cueLine: 'meet mee by thuh GAR-dn gayt',
          styledCueLine: 'meet mee by thuh GAR-dn gayt',
          tokens: [],
        },
      },
    },
    lessonState: {
      status: 'practice',
      stage: 'core',
      currentExerciseIndex: 7,
      focus: 'resonance',
    },
  };
}

function makeRuntime() {
  const existing = makeExistingSession();
  const sessions = new Map([[existing.id, existing]]);
  const checkpointWrites = [];
  const boundTargets = [];
  const sessionRingWrites = [];
  let snapshotReads = 0;
  const learnerContextService = {
    readProfile: () => ({
      voice: {
        coachCheckpoint: {
          sessionId: existing.id,
          state: 'stopped',
          restartCount: 4,
          preset: { id: 'preset-aster', referenceClipId: 'clip-aster' },
          practice: { lineId: 'line-7', text: 'Meet me by the garden gate.' },
        },
      },
    }),
    updateCoachCheckpoint: (_studentId, patch, meta) => {
      checkpointWrites.push({ patch, meta });
      return { voice: { coachCheckpoint: patch } };
    },
    setActiveVoiceTarget: (_studentId, binding) => {
      boundTargets.push(binding);
      return binding;
    },
    addSession: (_studentId, entry) => {
      sessionRingWrites.push(entry);
      return entry;
    },
    getVoiceStudentModelSnapshot: async () => {
      snapshotReads += 1;
      return { learnerContext: {} };
    },
  };
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions,
    learnerContextService,
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  return {
    checkpointWrites,
    boundTargets,
    existing,
    getSnapshotReads: () => snapshotReads,
    runtime,
    sessionRingWrites,
  };
}

test('starting Coach resumes the checkpointed lesson instead of creating a blank session', async () => {
  const { checkpointWrites, existing, runtime } = makeRuntime();
  const payload = await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'new-random-frontend-id',
    studentId: 'continuity-learner',
  });

  assert.equal(payload.sessionId, existing.id);
  assert.equal(runtime.sessions.has('new-random-frontend-id'), false);
  assert.equal(runtime.sessions.get(existing.id).voiceState.referenceClipId, 'clip-aster');
  assert.equal(runtime.sessions.get(existing.id).voiceState.activeLine.id, 'line-7');
  assert.ok(checkpointWrites.some(({ patch, meta }) => (
    patch.state === 'active'
    && patch.restartCount === 5
    && Number.isFinite(patch.lastRestartedAt)
    && meta.reason === 'learner-started'
  )));
});

test('an explicit existing phone session wins over an unrelated learner checkpoint', async () => {
  const { boundTargets, existing, runtime } = makeRuntime();
  const phoneSession = {
    ...makeExistingSession(),
    id: 'phone-selected-session',
    createdAt: existing.createdAt + 1,
    updatedAt: existing.updatedAt + 1,
    voiceState: {
      ...makeExistingSession().voiceState,
      targetPreset: 'cute-feminine',
      selectedCustomPresetId: 'preset-morning-brew',
      selectedCustomPresetName: 'Morning Brew',
      referenceClipId: 'clip-morning-brew',
      referenceClipName: 'morning-brew.wav',
      targetVoiceProfile: {
        ...makeExistingSession().voiceState.targetVoiceProfile,
        profileId: 'profile-morning-brew',
        clipId: 'clip-morning-brew',
      },
      targetBinding: {
        targetKey: 'stale-target-b',
        presetId: 'preset-stale-b',
        referenceClipId: 'clip-stale-b',
        targetSource: 'custom-reference',
        targetPreset: 'cute-feminine',
        targetProfileId: 'profile-stale-b',
      },
    },
  };
  runtime.sessions.set(phoneSession.id, phoneSession);

  const payload = await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: phoneSession.id,
    studentId: phoneSession.studentId,
    activate: false,
  });

  assert.equal(payload.sessionId, phoneSession.id);
  assert.equal(runtime.sessions.get(phoneSession.id).voiceState.selectedCustomPresetId, 'preset-morning-brew');
  assert.equal(runtime.sessions.get(phoneSession.id).voiceState.referenceClipId, 'clip-morning-brew');
  assert.equal(runtime.sessions.get(phoneSession.id).voiceState.targetBinding.presetId, 'preset-morning-brew');
  assert.equal(runtime.sessions.get(phoneSession.id).voiceState.targetBinding.referenceClipId, 'clip-morning-brew');
  assert.notEqual(runtime.sessions.get(phoneSession.id).voiceState.targetBinding.targetKey, 'stale-target-b');
  assert.equal(boundTargets.at(-1).presetId, 'preset-morning-brew');
  assert.equal(boundTargets.at(-1).referenceClipId, 'clip-morning-brew');
});

test('learner Stop checkpoints the continuing lesson without ending it', async () => {
  const { checkpointWrites, existing, runtime, sessionRingWrites } = makeRuntime();
  const session = runtime.sessions.get(existing.id);
  session.voiceState.coachThread = [
    { role: 'user', content: 'private spoken words' },
    { role: 'coach', content: 'working response' },
  ];
  session.voiceState.lastCoachMessage = 'working response';
  session.voiceState.voiceInputRuntime = {
    lastTranscript: 'private spoken words',
    lastPartialTranscript: 'private',
    transcriptSource: 'asr',
  };
  const priorRingWriteCount = sessionRingWrites.length;
  const result = await runtime.appCompatibilityRouteHandlers.stopSession(existing.id);

  assert.equal(result.status, 'stopped');
  assert.equal(result.continuityRecorded, true);
  assert.notEqual(runtime.sessions.get(existing.id).voiceState.status, 'ended');
  assert.equal(runtime.sessions.has(existing.id), true);
  assert.deepEqual(runtime.sessions.get(existing.id).voiceState.coachThread, []);
  assert.equal(runtime.sessions.get(existing.id).voiceState.lastCoachMessage, null);
  assert.equal(runtime.sessions.get(existing.id).voiceState.voiceInputRuntime.lastTranscript, null);
  assert.equal(runtime.sessions.get(existing.id).voiceState.voiceInputRuntime.lastPartialTranscript, null);
  assert.equal(sessionRingWrites.length, priorRingWriteCount + 1);
  assert.equal(sessionRingWrites.at(-1).endReason, 'learner-stopped');
  assert.ok(checkpointWrites.some(({ patch, meta }) => (
    patch.state === 'stopped'
    && Number.isFinite(patch.stoppedAt)
    && meta.reason === 'learner-stopped'
  )));
  assert.ok(checkpointWrites.some(({ patch }) => (
    patch.practice?.pronunciation === 'meet mee by thuh GAR-dn gayt'
  )));
  assert.equal(checkpointWrites.some(({ patch }) => (
    patch.practice?.pronunciation === 'Keep this phrase light and forward.'
  )), false);
});

test('Start and continuous-input state mutations do not hydrate learner memory or queue a lesson plan', async () => {
  const { existing, getSnapshotReads, runtime } = makeRuntime();
  const session = runtime.sessions.get(existing.id);
  session.voiceState.voiceInputRuntime = {
    ...session.voiceState.voiceInputRuntime,
    status: 'error',
    lastOutcome: 'error',
    consecutiveErrorTurns: 2,
    consecutiveNoSpeechTurns: 3,
    lastError: 'A stale input failure.',
  };

  const prepared = await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: existing.id,
    studentId: existing.studentId,
    activate: false,
    prepareLiveInput: true,
    liveInputLeaseId: 'lease-1',
  });
  const activated = await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: existing.id,
    studentId: existing.studentId,
    activate: true,
    continuousEnabled: true,
    liveInputLeaseId: 'lease-1',
  });
  const cockpit = await runtime.voiceOperationRouteHandlers.updateVoiceCockpitState({
    sessionId: existing.id,
    coachVoice: {
      ...existing.voiceState.coachVoice,
      continuousEnabled: true,
    },
  });
  const input = await runtime.voiceOperationRouteHandlers.updateVoiceInputRuntime({
    sessionId: existing.id,
    event: 'listening',
    requestedProvider: 'backend',
    effectiveProvider: 'backend',
    captureProvider: 'backend',
  });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(getSnapshotReads(), 0);
  assert.equal(prepared.sessionId, existing.id);
  assert.equal(prepared.voiceState.voiceInputRuntime.status, 'idle');
  assert.equal(prepared.voiceState.voiceInputRuntime.lastOutcome, 'idle');
  assert.equal(prepared.voiceState.voiceInputRuntime.consecutiveErrorTurns, 0);
  assert.equal(prepared.voiceState.voiceInputRuntime.consecutiveNoSpeechTurns, 0);
  assert.equal(prepared.voiceState.voiceInputRuntime.lastError, null);
  assert.equal(activated.sessionId, existing.id);
  assert.equal(activated.voiceState.targetPreset, existing.voiceState.targetPreset);
  assert.equal(activated.studentModel, undefined);
  assert.equal(activated.learnerContext, undefined);
  assert.equal(runtime.sessions.get(existing.id).voiceState.coachVoice.continuousEnabled, true);
  assert.equal(cockpit.voiceState.coachVoice.continuousEnabled, true);
  assert.equal(input.voiceInputRuntime.status, 'listening');
  assert.equal(input.voiceState.voiceInputRuntime.status, 'listening');
});

test('coach-spoke time is checkpointed only by successful preset-bound playback acknowledgement', () => {
  const { checkpointWrites, existing, runtime } = makeRuntime();
  const result = runtime.voiceOperationRouteHandlers.recordVoiceSpeechPlayback({
    sessionId: existing.id,
    provider: 'voxcpm',
  });

  assert.equal(result.success, true);
  assert.equal(result.recorded, true);
  assert.equal(runtime.sessions.get(existing.id).voiceState.lastCoachSpokenAt, result.coachSpokeAt);
  assert.ok(checkpointWrites.some(({ patch, meta }) => (
    patch.lastCoachSpokeAt === result.coachSpokeAt
    && patch.lastActivityAt === result.coachSpokeAt
    && meta.reason === 'coach-spoke'
  )));
});

test('coach-spoke acknowledgement rejects an unbound or non-cloned provider', () => {
  const { existing, runtime } = makeRuntime();
  assert.throws(() => runtime.voiceOperationRouteHandlers.recordVoiceSpeechPlayback({
    sessionId: existing.id,
    provider: 'browser',
  }), /preset-bound tutor voice/i);
});

function recoverablePreset() {
  const targetVoiceProfile = {
    profileId: 'profile-aster',
    clipId: 'clip-aster',
    analysisVersion: 'voice-metrics-v2',
    targetPreset: 'cute-feminine',
    direction: 'feminine',
    pitchFloorHz: 170,
    pitchCeilingHz: 230,
    resonanceFloor: 0.35,
    resonanceCeiling: 0.65,
    weightFloor: 0.25,
    weightCeiling: 0.55,
  };
  return {
    id: 'preset-aster',
    name: 'Aster',
    kind: 'reference',
    basePreset: 'cute-feminine',
    archived: false,
    referenceClipId: 'clip-aster',
    referenceClipName: 'aster.wav',
    referenceAnalysis: {
      clipId: 'clip-aster',
      analysisVersion: 'voice-metrics-v2',
      quality: { verdict: 'good', cloneable: true },
      metrics: { advanced: { measurementAvailable: true } },
      timeline: [],
    },
    targetVoiceProfile,
  };
}

function recoverableBinding() {
  const preset = recoverablePreset();
  const p = preset.targetVoiceProfile;
  const identity = resolveVoiceTargetIdentity({
    targetSource: 'custom-reference',
    targetPreset: p.targetPreset,
    targetProfileId: p.profileId,
    referenceClipId: p.clipId,
    direction: p.direction,
    analysisVersion: p.analysisVersion,
    pitchFloorHz: p.pitchFloorHz,
    pitchCeilingHz: p.pitchCeilingHz,
    resonanceFloor: p.resonanceFloor,
    resonanceCeiling: p.resonanceCeiling,
    weightFloor: p.weightFloor,
    weightCeiling: p.weightCeiling,
  });
  return {
    presetId: preset.id,
    presetName: preset.name,
    referenceClipId: preset.referenceClipId,
    targetPreset: p.targetPreset,
    targetSource: 'custom-reference',
    targetKey: identity.targetKey,
    targetProfileId: p.profileId,
    analysisVersion: p.analysisVersion,
  };
}

test('a missing runtime session is reconstructed only from the exact checkpoint preset', async () => {
  const checkpointWrites = [];
  const boundTargets = [];
  const binding = recoverableBinding();
  const checkpoint = {
    sessionId: 'recovered-session',
    state: 'stopped',
    restartCount: 2,
    targetBinding: binding,
    preset: {
      id: binding.presetId,
      name: binding.presetName,
      referenceClipId: binding.referenceClipId,
      targetPreset: binding.targetPreset,
      targetSource: binding.targetSource,
      targetProfileId: binding.targetProfileId,
    },
    lesson: {
      status: 'practice',
      stage: 'core',
      focus: 'resonance',
      lessonId: 'lesson-1',
      exerciseId: 'exercise-4',
      exerciseIndex: 4,
    },
    practice: {
      lineId: 'line-4',
      text: 'Meet me by the garden gate.',
      pronunciation: 'meet mee by thuh GAR-dn gayt',
    },
  };
  const learnerContextService = {
    readProfile: () => ({ voice: { coachCheckpoint: checkpoint } }),
    setActiveVoiceTarget: (_studentId, target) => boundTargets.push(target),
    updateCoachCheckpoint: (_studentId, patch, meta) => {
      checkpointWrites.push({ patch, meta });
      return { voice: { coachCheckpoint: patch } };
    },
    getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
  };
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map(),
    learnerContextService,
    logger: false,
    fetchImpl: async (url) => {
      assert.match(String(url), /\/api\/v1\/voice\/presets\/preset-aster$/);
      return new Response(JSON.stringify(recoverablePreset()), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    },
  });

  const result = await runtime.appCompatibilityRouteHandlers.startSession({
    studentId: 'continuity-learner',
    sessionId: 'random-phone-id',
  });
  const session = runtime.sessions.get('recovered-session');
  assert.equal(result.sessionId, 'recovered-session');
  assert.ok(session);
  assert.equal(runtime.sessions.has('random-phone-id'), false);
  assert.equal(session.voiceState.selectedCustomPresetId, 'preset-aster');
  assert.equal(session.voiceState.referenceClipId, 'clip-aster');
  assert.equal(session.voiceState.targetBinding.targetKey, binding.targetKey);
  assert.equal(session.voiceState.activeLine.displayText, checkpoint.practice.text);
  assert.equal(session.voiceState.activeLine.cueSheet.styledCueLine, checkpoint.practice.pronunciation);
  assert.equal(session.lessonState.currentExerciseIndex, 4);
  assert.equal(boundTargets.at(-1).targetKey, binding.targetKey);
  assert.ok(checkpointWrites.some(({ meta }) => meta.reason === 'learner-started'));
});

test('checkpoint recovery fails closed when the exact preset no longer matches', async () => {
  const binding = recoverableBinding();
  const learnerContextService = {
    readProfile: () => ({
      voice: {
        coachCheckpoint: {
          sessionId: 'must-not-fallback',
          state: 'stopped',
          targetBinding: binding,
          preset: {
            id: binding.presetId,
            referenceClipId: binding.referenceClipId,
          },
        },
      },
    }),
    getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
  };
  const mismatched = { ...recoverablePreset(), referenceClipId: 'different-clip' };
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map(),
    learnerContextService,
    logger: false,
    fetchImpl: async () => new Response(JSON.stringify(mismatched), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });

  await assert.rejects(
    runtime.appCompatibilityRouteHandlers.startSession({
      studentId: 'continuity-learner',
      sessionId: 'random-phone-id',
    }),
    /saved reference|does not match|continuing lesson/i,
  );
  assert.equal(runtime.sessions.size, 0, 'no built-in fallback session is created');
});

test('unreadable learner memory blocks Start before a fallback session can be created', async () => {
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => {
        throw new Error('corrupt profile');
      },
    },
    logger: false,
    fetchImpl: async () => { throw new Error('offline test'); },
  });

  await assert.rejects(
    runtime.appCompatibilityRouteHandlers.startSession({
      studentId: 'corrupt-learner',
      sessionId: 'must-not-exist',
    }),
    /memory is unavailable|cannot be verified/i,
  );
  assert.equal(runtime.sessions.size, 0);
});

test('Start rolls live input back when the continuity checkpoint cannot be written', async () => {
  const existing = makeExistingSession();
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map([[existing.id, existing]]),
    learnerContextService: {
      readProfile: () => ({
        voice: {
          coachCheckpoint: {
            sessionId: existing.id,
            state: 'stopped',
            preset: { id: 'preset-aster', referenceClipId: 'clip-aster' },
          },
        },
      }),
      setActiveVoiceTarget: () => ({}),
      updateCoachCheckpoint: () => {
        throw new Error('disk unavailable');
      },
    },
    logger: false,
    fetchImpl: async () => { throw new Error('offline test'); },
  });

  await assert.rejects(
    runtime.appCompatibilityRouteHandlers.startSession({
      studentId: existing.studentId,
      sessionId: existing.id,
    }),
    /could not be saved safely|not started/i,
  );
  assert.equal(runtime.sessions.get(existing.id).coachLiveInputState, 'stopped');
});

function makePersistenceControlledRuntime(saveSessions) {
  const existing = makeExistingSession();
  const checkpointWrites = [];
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map([[existing.id, existing]]),
    sessionStore: {
      saveSessions,
      getStoreInfo: () => ({
        storePath: '/isolated/test/sessions.json',
        writeBlocked: false,
      }),
    },
    learnerContextService: {
      readProfile: () => ({
        voice: {
          coachCheckpoint: {
            sessionId: existing.id,
            state: 'stopped',
            restartCount: 1,
            preset: { id: 'preset-aster', referenceClipId: 'clip-aster' },
          },
        },
      }),
      setActiveVoiceTarget: (_studentId, binding) => binding,
      updateCoachCheckpoint: (_studentId, patch, meta) => {
        checkpointWrites.push({ patch, meta });
        return { voice: { coachCheckpoint: patch } };
      },
      addSession: (_studentId, entry) => entry,
      getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
    },
    logger: false,
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  return { checkpointWrites, existing, runtime };
}

test('Start and prepare-only fail closed when the session store rejects the mutation', async () => {
  const blocked = () => ({ saved: false, blocked: true, reason: 'blocked test store' });
  const first = makePersistenceControlledRuntime(blocked);
  await assert.rejects(
    first.runtime.appCompatibilityRouteHandlers.startSession({
      studentId: first.existing.studentId,
      sessionId: first.existing.id,
    }),
    /could not be saved safely|session memory/i,
  );
  assert.equal(first.runtime.sessions.get(first.existing.id).coachLiveInputState, 'stopped');
  assert.equal(first.checkpointWrites.some(({ patch }) => patch.state === 'active'), false);

  const prepared = makePersistenceControlledRuntime(blocked);
  await assert.rejects(
    prepared.runtime.appCompatibilityRouteHandlers.startSession({
      studentId: prepared.existing.studentId,
      sessionId: prepared.existing.id,
      activate: false,
      prepareLiveInput: true,
      liveInputLeaseId: 'lease-blocked',
    }),
    /could not be saved safely|session memory/i,
  );
  assert.equal(prepared.runtime.sessions.get(prepared.existing.id).coachLiveInputState, 'stopped');
});

test('a blocked first Start leaves no blank in-memory session behind', async () => {
  const runtime = createVoiceStandaloneRuntime({
    sessions: new Map(),
    sessionStore: {
      saveSessions: () => ({ saved: false, blocked: true, reason: 'blocked test store' }),
      getStoreInfo: () => ({
        storePath: '/isolated/test/sessions.json',
        writeBlocked: false,
      }),
    },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: (_studentId, patch) => ({ voice: { coachCheckpoint: patch } }),
    },
    logger: false,
    fetchImpl: async () => { throw new Error('offline test'); },
  });

  await assert.rejects(
    runtime.appCompatibilityRouteHandlers.startSession({
      studentId: 'new-learner',
      sessionId: 'must-not-survive',
    }),
    /could not be saved safely|session memory/i,
  );
  assert.equal(runtime.sessions.has('must-not-survive'), false);
});

test('End never claims success when persistence fails, but the microphone remains stopped', async () => {
  const blocked = () => ({ saved: false, blocked: true, reason: 'blocked test store' });
  const { checkpointWrites, existing, runtime } = makePersistenceControlledRuntime(blocked);
  const session = runtime.sessions.get(existing.id);
  session.coachLiveInputState = 'active';

  await assert.rejects(
    runtime.appCompatibilityRouteHandlers.stopSession(existing.id),
    /could not be saved safely|session memory/i,
  );

  assert.equal(session.coachLiveInputState, 'stopped');
  assert.ok(checkpointWrites.some(({ patch }) => patch.state === 'stopped'));
});
