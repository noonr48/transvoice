'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { VoiceInputAsrBridge } = require('./voice-input-asr');
const { resolveVoiceStandaloneConfig } = require('./voice-standalone-config');
const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');

function jsonResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('standalone config exposes the buffered ASR provider contract', () => {
  const config = resolveVoiceStandaloneConfig({
    env: {
      VOICE_ASR_ENABLED: 'true',
      VOICE_ASR_URL: 'http://asr.test:8765/',
      VOICE_ASR_API_STYLE: 'simple',
      VOICE_ASR_LANGUAGE: 'en-AU',
      VOICE_ASR_TIMEOUT_MS: '4321',
      VOICE_ASR_LIVE_MODE: 'buffered',
    },
    stateRoot: '/tmp/voice-asr-config-test',
  });

  assert.equal(config.voiceAsrEnabled, true);
  assert.equal(config.voiceAsrUrl, 'http://asr.test:8765');
  assert.equal(config.voiceAsrApiStyle, 'simple');
  assert.equal(config.voiceAsrLanguage, 'en-AU');
  assert.equal(config.voiceAsrTimeoutMs, 4321);
  assert.equal(config.voiceAsrLiveMode, 'buffered');
});

test('standalone config locks the adaptive live endpoint policy and resolves runtime paths', () => {
  const config = resolveVoiceStandaloneConfig({
    env: {
      SMART_TURN_ENABLED: 'true',
      SMART_TURN_PYTHON_PATH: '/opt/smart-turn/bin/python',
      SMART_TURN_MODEL_PATH: '/opt/smart-turn/model.onnx',
      VOICE_LIVE_CANDIDATE_SILENCE_MS: '100',
      VOICE_LIVE_FALLBACK_SILENCE_MS: '900',
      VOICE_LIVE_SEMANTIC_THRESHOLD: '2',
    },
    stateRoot: '/tmp/voice-live-config-test',
  });

  assert.equal(config.smartTurnEnabled, true);
  assert.equal(config.smartTurnPythonPath, '/opt/smart-turn/bin/python');
  assert.equal(config.smartTurnModelPath, '/opt/smart-turn/model.onnx');
  assert.equal(config.voiceLiveCandidateSilenceMs, 1800);
  assert.equal(config.voiceLiveFallbackSilenceMs, 4500);
  assert.equal(config.voiceLiveSemanticThreshold, 0.99);
});

test('standalone config ignores attempts to lengthen the locked endpoint policy', () => {
  const config = resolveVoiceStandaloneConfig({
    env: {
      VOICE_LIVE_CANDIDATE_SILENCE_MS: '9999',
      VOICE_LIVE_FALLBACK_SILENCE_MS: '9999',
    },
    stateRoot: '/tmp/voice-live-config-locked-test',
  });

  assert.equal(config.voiceLiveCandidateSilenceMs, 1800);
  assert.equal(config.voiceLiveFallbackSilenceMs, 4500);
});

test('simple ASR bridge forwards multipart audio and normalizes provider text', async () => {
  const calls = [];
  const bridge = new VoiceInputAsrBridge({
    enabled: true,
    baseUrl: 'http://asr.test:8765',
    apiStyle: 'simple',
    language: 'en-AU',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return jsonResponse(200, { text: "['Keep the sound forward']", model: 'parakeet' });
    },
  });

  const result = await bridge.transcribeAudio({
    audioBuffer: Buffer.from('mock-webm-audio'),
    filename: 'take.webm',
    mimeType: 'audio/webm',
  });

  assert.equal(result.success, true);
  assert.equal(result.transcript, 'Keep the sound forward');
  assert.equal(result.providerStyle, 'simple');
  assert.match(calls[0].url, /\/transcribe\?language=en&return_timestamps=true$/);
  assert.equal(calls[0].options.method, 'POST');
  assert.ok(calls[0].options.body instanceof FormData);
  assert.ok(calls[0].options.body.get('file') instanceof Blob);
});

test('a healthy ASR response with no transcript is no-speech, not a provider outage', async () => {
  const bridge = new VoiceInputAsrBridge({
    enabled: true,
    baseUrl: 'http://asr.test:8765',
    fetchImpl: async () => jsonResponse(200, {
      success: true,
      text: '',
      segments: [],
      model: 'parakeet',
    }),
  });

  const result = await bridge.transcribeAudio({
    audioBuffer: Buffer.from('quiet-wav-audio'),
    filename: 'quiet.wav',
    mimeType: 'audio/wav',
  });

  assert.deepEqual(result, {
    success: true,
    noSpeech: true,
    transcript: '',
    confidence: null,
    providerModel: null,
    providerLanguage: null,
    audioProcessedMs: null,
    providerStyle: 'simple',
    transcriptSource: 'backend-asr',
  });
  assert.equal((await bridge.getStatus()).available, true);
  assert.equal((await bridge.getStatus()).reason, null);
});

test('ASR status distinguishes disabled and reachable providers', async () => {
  const disabled = new VoiceInputAsrBridge({ enabled: false, baseUrl: 'http://asr.test' });
  assert.deepEqual(await disabled.getStatus({ refresh: true }), {
    enabled: false,
    available: false,
    reason: 'Voice ASR is disabled.',
    baseUrl: 'http://asr.test',
    apiStyle: 'simple',
    liveMode: 'buffered',
    lastCheckedAt: null,
  });

  const ready = new VoiceInputAsrBridge({
    enabled: true,
    baseUrl: 'http://asr.test',
    fetchImpl: async () => jsonResponse(200, { status: 'healthy', model_loaded: true }),
  });
  const status = await ready.getStatus({ refresh: true });
  assert.equal(status.enabled, true);
  assert.equal(status.available, true);
  assert.equal(status.reason, null);
  assert.ok(Number.isFinite(status.lastCheckedAt));
});

test('standalone status advertises recorded ASR with a local automatic turn boundary', async () => {
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    voiceInputAsrBridge: {
      getStatus: async () => ({
        enabled: true,
        available: true,
        reason: null,
        liveMode: 'buffered',
      }),
    },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/health')) {
        return jsonResponse(200, { status: 'ok' });
      }
      throw new Error('offline test');
    },
  });

  const payload = await runtime.voiceOperationRouteHandlers.getVoiceInputStatus();
  assert.equal(payload.providers.backend.capabilities.liveCapture, false);
  assert.equal(payload.providers.backend.capabilities.recordedCapture, true);
  assert.equal(payload.providers.backend.capabilities.automaticTurnBoundary, true);
  assert.equal(payload.providers.backend.capabilities.vad, true);
  assert.equal(payload.providers.backend.live.attached, false);
});

test('backend live capture remains available when ASR is disabled because DSP can close the turn', async () => {
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    voiceInputLiveService: {
      getStatus: () => ({
        attached: true,
        activeConnections: 0,
        detector: { enabled: true, available: true },
        fallbackCount: 0,
      }),
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({
        enabled: false,
        available: false,
        reason: 'Voice ASR is disabled.',
        liveMode: 'buffered',
      }),
    },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    fetchImpl: async (url) => {
      if (String(url).endsWith('/health')) {
        return jsonResponse(200, { status: 'ok' });
      }
      throw new Error('offline test');
    },
  });

  const payload = await runtime.voiceOperationRouteHandlers.getVoiceInputStatus();
  assert.equal(payload.status, 'degraded');
  assert.deepEqual(payload.listening, {
    canStart: true,
    status: 'degraded',
    semanticAvailable: false,
    acousticAvailable: true,
    reason: 'Words may need an immediate spoken retry until semantic listening recovers.',
  });
  assert.equal(payload.providers.backend.available, true);
  assert.equal(payload.providers.backend.transcriptionAvailable, false);
  assert.equal(payload.providers.backend.acousticTurnAvailable, true);
  assert.equal(payload.providers.backend.capabilities.liveCapture, true);
  assert.equal(payload.providers.backend.capabilities.finalTranscript, false);
});

test('an attached transport does not claim acoustic turns when VoiceTrainer is offline', async () => {
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    voiceInputLiveService: {
      getStatus: () => ({
        attached: true,
        activeConnections: 0,
        detector: { enabled: true, available: true },
        fallbackCount: 0,
      }),
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({
        enabled: false,
        available: false,
        reason: 'Voice ASR is disabled.',
        liveMode: 'buffered',
      }),
    },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    fetchImpl: async () => { throw new Error('VoiceTrainer offline'); },
  });

  const payload = await runtime.voiceOperationRouteHandlers.getVoiceInputStatus();
  assert.equal(payload.status, 'disabled');
  assert.equal(payload.providers.backend.available, false);
  assert.equal(payload.providers.backend.acousticTurnAvailable, false);
  assert.equal(payload.providers.backend.capabilities.liveCapture, false);
});

test('standalone runtime accepts recorded backend audio and checkpoints last spoke time', async () => {
  const checkpoints = [];
  const bridgeCalls = [];
  const learnerContextService = {
    readProfile: () => ({ voice: { coachCheckpoint: null } }),
    updateCoachCheckpoint: (_studentId, patch, meta) => checkpoints.push({ patch, meta }),
    getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
  };
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    learnerContextService,
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, reason: null }),
      transcribeAudio: async (input) => {
        bridgeCalls.push(input);
        return {
          success: true,
          transcript: 'Continue with the same phrase',
          confidence: 0.91,
          providerStyle: 'simple',
          transcriptSource: 'backend-asr',
        };
      },
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  const session = runtime.appCompatibilityRouteHandlers;
  const started = await session.startSession({ sessionId: 'asr-session', studentId: 'asr-learner' });
  assert.equal(started.sessionId, 'asr-session');

  const capturedAt = 1_750_123_456_789;
  const payload = await runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
    sessionId: 'asr-session',
    requestedProvider: 'backend',
    captureProvider: 'backend',
    audioBase64: Buffer.from('webm-bytes').toString('base64'),
    audioFormat: 'webm',
    mimeType: 'audio/webm',
    capturedAt,
  });

  assert.equal(bridgeCalls.length, 1);
  assert.deepEqual(bridgeCalls[0].audioBuffer, Buffer.from('webm-bytes'));
  assert.equal(payload.inputTurn.transcript, 'Continue with the same phrase');
  assert.equal(payload.inputTurn.transcriptSource, 'backend-asr');
  assert.equal(payload.inputTurn.confidence, 0.91);
  assert.ok(checkpoints.some(({ patch }) => patch.lastSpokeAt === capturedAt));
  assert.ok(checkpoints.some(({ patch }) => patch.lastLearnerSpokeAt === capturedAt));
});

test('standalone runtime returns a no-speech turn without checkpointing learner speech', async () => {
  const checkpoints = [];
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: (_studentId, patch, meta) => checkpoints.push({ patch, meta }),
      getVoiceStudentModelSnapshot: async () => null,
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, reason: null }),
      transcribeAudio: async () => ({
        success: true,
        noSpeech: true,
        transcript: '',
        confidence: null,
        providerStyle: 'simple',
        transcriptSource: 'backend-asr',
      }),
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'quiet-asr-session',
    studentId: 'quiet-asr-learner',
  });
  const learnerSpokeBefore = checkpoints.filter(({ meta }) => meta.reason === 'learner-spoke').length;

  const payload = await runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
    sessionId: 'quiet-asr-session',
    requestedProvider: 'backend',
    captureProvider: 'backend',
    audioBase64: Buffer.from('quiet-wav-audio').toString('base64'),
    audioFormat: 'wav',
    mimeType: 'audio/wav',
  });

  assert.equal(payload.inputTurn.outcome, 'no-speech');
  assert.equal(payload.inputTurn.transcript, null);
  assert.equal(
    checkpoints.filter(({ meta }) => meta.reason === 'learner-spoke').length,
    learnerSpokeBefore,
  );
});

test('standalone runtime accepts an internal WAV Buffer without base64 re-encoding', async () => {
  const bridgeCalls = [];
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true }),
      transcribeAudio: async (input) => {
        bridgeCalls.push(input);
        return {
          success: true,
          transcript: 'A careful complete thought',
          confidence: 0.87,
          providerStyle: 'simple',
          transcriptSource: 'backend-asr',
        };
      },
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  await runtime.appCompatibilityRouteHandlers.startSession({ sessionId: 'live-buffer' });
  const audioBuffer = Buffer.from('RIFF-internal-wav');
  const controller = new AbortController();

  const payload = await runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
    sessionId: 'live-buffer',
    requestedProvider: 'backend',
    captureProvider: 'backend',
    mimeType: 'audio/wav',
    audioFormat: 'wav',
  }, {
    audioBuffer,
    signal: controller.signal,
    shouldCommit: () => true,
  });

  assert.equal(bridgeCalls.length, 1);
  assert.equal(bridgeCalls[0].audioBuffer, audioBuffer);
  assert.equal(bridgeCalls[0].signal, controller.signal);
  assert.equal(payload.inputTurn.transcript, 'A careful complete thought');
});

test('a stale internal live turn cannot mutate the session after ASR resolves', async () => {
  let resolveTranscription;
  const transcription = new Promise((resolve) => { resolveTranscription = resolve; });
  let current = true;
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true }),
      transcribeAudio: () => transcription,
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  await runtime.appCompatibilityRouteHandlers.startSession({ sessionId: 'stale-buffer' });
  const before = runtime.sessions.get('stale-buffer').voiceState?.voiceInputRuntime || null;
  const pending = runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
    sessionId: 'stale-buffer',
    captureProvider: 'backend',
    mimeType: 'audio/wav',
  }, {
    audioBuffer: Buffer.from('RIFF-stale-wav'),
    signal: new AbortController().signal,
    shouldCommit: () => current,
  });
  current = false;
  resolveTranscription({
    success: true,
    transcript: 'This result arrived too late',
    transcriptSource: 'backend-asr',
  });

  await assert.rejects(pending, /no longer current/i);
  assert.deepEqual(runtime.sessions.get('stale-buffer').voiceState?.voiceInputRuntime || null, before);
});

test('ASR bridge preserves its timeout when a caller cancellation signal is supplied', async () => {
  let providerSignal = null;
  const bridge = new VoiceInputAsrBridge({
    enabled: true,
    baseUrl: 'http://asr.test',
    timeoutMs: 1000,
    fetchImpl: async (_url, options) => {
      providerSignal = options.signal;
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(options.signal.reason || new Error('aborted')), { once: true });
      });
    },
  });
  const controller = new AbortController();
  const pending = bridge.transcribeAudio({
    audioBuffer: Buffer.from('wav'),
    mimeType: 'audio/wav',
    signal: controller.signal,
  });
  controller.abort(new Error('turn cancelled'));
  const result = await pending;

  assert.notEqual(providerSignal, controller.signal, 'provider signal also carries the bridge timeout');
  assert.equal(providerSignal.aborted, true);
  assert.equal(result.success, false);
  assert.match(result.error, /turn cancelled|aborted/i);
});

test('gateway stays online while optional Coach ASR reports unavailable', async () => {
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    env: { VOICE_ASR_ENABLED: 'true', VOXCPM_ENABLED: 'false' },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({
        enabled: true,
        available: false,
        reason: 'ASR test provider is offline.',
        apiStyle: 'simple',
        liveMode: 'buffered',
      }),
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith('/health')) return jsonResponse(200, { status: 'online' });
      if (target.endsWith('/models')) return jsonResponse(200, { data: [] });
      throw new Error(`Unexpected health probe: ${target}`);
    },
  });

  const health = await runtime.voiceSessionRouteHandlers.getVoiceHealth();
  assert.equal(health.statusCode, 200);
  assert.equal(health.payload.status, 'online');
  assert.equal(health.payload.services.voiceAsr.status, 'offline');
  assert.equal(health.payload.services.voiceAsr.reason, 'ASR test provider is offline.');
});

test('gateway stays startable when ASR is healthy and VoiceTrainer is offline', async () => {
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    env: { VOICE_ASR_ENABLED: 'true', VOXCPM_ENABLED: 'false' },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({
        enabled: true,
        available: true,
        reason: null,
        apiStyle: 'simple',
        liveMode: 'buffered',
      }),
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith('/health')) return jsonResponse(503, { status: 'offline' });
      if (target.endsWith('/models')) return jsonResponse(200, { data: [] });
      throw new Error(`Unexpected health probe: ${target}`);
    },
  });

  const health = await runtime.voiceSessionRouteHandlers.getVoiceHealth();
  assert.equal(health.statusCode, 200);
  assert.equal(health.payload.status, 'online');
  assert.equal(health.payload.services.voiceTrainer.status, 'offline');
  assert.equal(health.payload.services.voiceAsr.status, 'online');
});

test('gateway blocks startup only when both listening lanes are unavailable', async () => {
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    env: { VOICE_ASR_ENABLED: 'true', VOXCPM_ENABLED: 'false' },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({
        enabled: true,
        available: false,
        reason: 'ASR test provider is offline.',
        apiStyle: 'simple',
        liveMode: 'buffered',
      }),
    },
    fetchImpl: async (url) => {
      const target = String(url);
      if (target.endsWith('/health')) return jsonResponse(503, { status: 'offline' });
      if (target.endsWith('/models')) return jsonResponse(200, { data: [] });
      throw new Error(`Unexpected health probe: ${target}`);
    },
  });

  const health = await runtime.voiceSessionRouteHandlers.getVoiceHealth();
  assert.equal(health.statusCode, 503);
  assert.equal(health.payload.status, 'offline');
  assert.equal(health.payload.services.voiceTrainer.status, 'offline');
  assert.equal(health.payload.services.voiceAsr.status, 'offline');
});

test('runtime rejects empty or oversized recorded audio before provider forwarding', async () => {
  let calls = 0;
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true }),
      transcribeAudio: async () => { calls += 1; return { success: false }; },
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  await runtime.appCompatibilityRouteHandlers.startSession({ sessionId: 'audio-limits' });

  await assert.rejects(
    runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
      sessionId: 'audio-limits', captureProvider: 'backend', audioBase64: '',
    }),
    /audioBase64/i,
  );
  await assert.rejects(
    runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
      sessionId: 'audio-limits', captureProvider: 'backend',
      audioBase64: Buffer.alloc(12 * 1024 * 1024 + 1).toString('base64'),
    }),
    /too large/i,
  );
  assert.equal(calls, 0);
});
