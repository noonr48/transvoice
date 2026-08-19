'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const WebSocket = require('ws');

const { createVoiceStandaloneApp, createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');

function pcm(ms, amplitude, sampleRate = 16000) {
  const samples = Math.round((sampleRate * ms) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
  }
  return buffer;
}

function waitForEvent(target, event) {
  return new Promise((resolve, reject) => {
    target.once(event, resolve);
    if (event !== 'error') target.once('error', reject);
  });
}

function closeServer(server) {
  return new Promise((resolve) => server.close(resolve));
}

test('authenticated /voice/input/live streams PCM through one runtime Buffer handoff', async (t) => {
  const bridgeCalls = [];
  const detector = {
    predict: async () => ({ available: true, complete: true, probability: 0.91, reason: null }),
    getStatus: () => ({ enabled: true, state: 'ready', available: true, fallbackCount: 0 }),
    close: () => {},
  };
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    voiceTurnDetector: detector,
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, liveMode: 'buffered' }),
      transcribeAudio: async (input) => {
        bridgeCalls.push(input);
        return {
          success: true,
          transcript: 'The gateway heard this promptly',
          confidence: 0.93,
          providerStyle: 'simple',
          transcriptSource: 'backend-asr',
        };
      },
    },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
    },
    fetchImpl: async () => { throw new Error('offline integration fixture'); },
  });
  await runtime.appCompatibilityRouteHandlers.startSession({ sessionId: 'live-integration' });
  const standalone = createVoiceStandaloneApp({
    runtime,
    logger: false,
    sensitiveRouteGuard: (_req, _res, next) => next(),
  });
  const server = standalone.start({ host: '127.0.0.1', port: 0, logger: { log() {}, warn() {} } });
  t.after(async () => {
    runtime.voiceInputLiveService.close();
    if (server.listening) await closeServer(server);
  });
  await waitForEvent(server, 'listening');
  const port = server.address().port;

  const status = await runtime.voiceOperationRouteHandlers.getVoiceInputStatus();
  assert.equal(status.providers.backend.capabilities.liveCapture, true);
  assert.equal(status.providers.backend.live.attached, true);

  const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/input/live`);
  const envelopes = [];
  socket.on('message', (data) => envelopes.push(JSON.parse(data.toString('utf8'))));
  await waitForEvent(socket, 'open');
  socket.send(JSON.stringify({ type: 'open', sessionId: 'live-integration', sampleRate: 16000 }));
  socket.send(pcm(500, 5000));
  socket.send(pcm(1800, 0));

  const deadline = Date.now() + 2000;
  while (!envelopes.some(({ event }) => event === 'final-transcript') && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(bridgeCalls.length, 1);
  assert.equal(envelopes.find(({ event }) => event === 'session-started')?.turnPolicy?.candidateSilenceMs, 1800);
  assert.equal(envelopes.find(({ event }) => event === 'session-started')?.turnPolicy?.conservativeSilenceMs, 4500);
  assert.equal(bridgeCalls[0].audioBuffer.toString('ascii', 0, 4), 'RIFF');
  const final = envelopes.find(({ event }) => event === 'final-transcript');
  assert.equal(final?.transcript, 'The gateway heard this promptly');
  assert.match(final?.listeningTurnId, /^listening-turn-/);
  socket.close();
});

test('two-phase live lease accepts audio only after activation and End prevents reopening', async (t) => {
  const bridgeCalls = [];
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    voiceTurnDetector: {
      predict: async () => ({ available: true, complete: true, probability: 0.91, reason: null }),
      getStatus: () => ({ enabled: true, state: 'ready', available: true, fallbackCount: 0 }),
      close: () => {},
    },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, liveMode: 'buffered' }),
      transcribeAudio: async (input) => {
        bridgeCalls.push(input);
        return {
          success: true,
          transcript: 'Activated lease completed once',
          confidence: 0.9,
          providerStyle: 'simple',
          transcriptSource: 'backend-asr',
        };
      },
    },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
    },
    fetchImpl: async () => { throw new Error('offline integration fixture'); },
  });
  const lease = 'phone-start-lease';
  await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'lease-integration',
    prepareLiveInput: true,
    activate: false,
    liveInputLeaseId: lease,
  });
  const standalone = createVoiceStandaloneApp({
    runtime,
    logger: false,
    sensitiveRouteGuard: (_req, _res, next) => next(),
  });
  const server = standalone.start({ host: '127.0.0.1', port: 0, logger: { log() {}, warn() {} } });
  t.after(async () => {
    runtime.voiceInputLiveService.close();
    if (server.listening) await closeServer(server);
  });
  await waitForEvent(server, 'listening');
  const port = server.address().port;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/voice/input/live`);
  const envelopes = [];
  socket.on('message', (data) => envelopes.push(JSON.parse(data.toString('utf8'))));
  await waitForEvent(socket, 'open');
  socket.send(JSON.stringify({
    type: 'open',
    sessionId: 'lease-integration',
    liveInputLeaseId: lease,
    sampleRate: 16000,
  }));

  // The socket may be ready first, but pre-checkpoint PCM is discarded.
  socket.send(pcm(500, 5000));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.ok(envelopes.some(({ event }) => event === 'capture-ready'));
  assert.equal(bridgeCalls.length, 0);

  await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'lease-integration',
    liveInputLeaseId: lease,
  });
  socket.send(pcm(500, 5000));
  socket.send(pcm(1800, 0));
  const finalDeadline = Date.now() + 2000;
  while (!envelopes.some(({ event }) => event === 'final-transcript') && Date.now() < finalDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(bridgeCalls.length, 1);
  assert.equal(envelopes.filter(({ event }) => event === 'final-transcript').length, 1);

  await runtime.appCompatibilityRouteHandlers.stopSession('lease-integration');
  const stoppedSocket = new WebSocket(`ws://127.0.0.1:${port}/voice/input/live`);
  const stoppedEnvelopes = [];
  stoppedSocket.on('message', (data) => stoppedEnvelopes.push(JSON.parse(data.toString('utf8'))));
  await waitForEvent(stoppedSocket, 'open');
  stoppedSocket.send(JSON.stringify({
    type: 'open',
    sessionId: 'lease-integration',
    liveInputLeaseId: lease,
    sampleRate: 16000,
  }));
  const errorDeadline = Date.now() + 1000;
  while (!stoppedEnvelopes.some(({ event }) => event === 'error') && Date.now() < errorDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.ok(stoppedEnvelopes.some(({ event, code }) => event === 'error' && code === 'session-not-found'));
  stoppedSocket.close();
});

test('live input authorization is checked before WebSocket construction', async () => {
  let upgrades = 0;
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true }),
    },
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
  });
  const originalHandleUpgrade = runtime.voiceInputLiveService.webSocketServer.handleUpgrade.bind(
    runtime.voiceInputLiveService.webSocketServer,
  );
  runtime.voiceInputLiveService.webSocketServer.handleUpgrade = (...args) => {
    upgrades += 1;
    return originalHandleUpgrade(...args);
  };
  const standalone = createVoiceStandaloneApp({
    runtime,
    logger: false,
    sensitiveRouteGuard: (_req, res) => res.status(403).json({ success: false }),
  });
  const server = standalone.start({ host: '127.0.0.1', port: 0, logger: { log() {}, warn() {} } });
  await waitForEvent(server, 'listening');
  const socket = new WebSocket(`ws://127.0.0.1:${server.address().port}/voice/input/live`);
  const response = await new Promise((resolve) => socket.once('unexpected-response', (_request, reply) => resolve(reply)));
  assert.equal(response.statusCode, 403);
  assert.equal(upgrades, 0);
  runtime.voiceInputLiveService.close();
  await closeServer(server);
});
