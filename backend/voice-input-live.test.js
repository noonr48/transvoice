'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const {
  createVoiceInputLiveConnection,
  createVoiceInputLiveService,
  encodePcm16Wav,
  normalizePolicy,
  pcm16Rms,
} = require('./voice-input-live');

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = this.OPEN;
    this.sent = [];
  }

  send(value) {
    this.sent.push(JSON.parse(String(value)));
  }

  close() {
    this.readyState = 3;
    this.emit('close');
  }
}

function pcm(ms, amplitude, sampleRate = 16000) {
  const samples = Math.round((sampleRate * ms) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
  }
  return buffer;
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve));
}

function createHarness(overrides = {}) {
  const socket = new FakeSocket();
  const submitted = [];
  const activeSession = overrides.activeSession || { id: 'session-a' };
  const detector = overrides.detector || {
    predict: async () => ({ available: false, complete: null, probability: null, reason: 'unavailable' }),
    getStatus: () => ({ state: 'unavailable' }),
  };
  const connection = createVoiceInputLiveConnection({
    socket,
    getSession: (sessionId) => sessionId === 'session-a' ? activeSession : null,
    submitTurn: async (body, internal) => {
      submitted.push({ body, internal });
      return {
        success: true,
        sessionId: body.sessionId,
        inputTurn: {
          transcript: 'careful complete line',
          confidence: 0.92,
          listeningTurnId: 'listening-turn-1',
        },
      };
    },
    detector,
    createId: () => `id-${submitted.length + 1}`,
    policy: {
      candidateSilenceMs: 1800,
      fallbackSilenceMs: 4500,
      minSpeechMs: 350,
      noSpeechTimeoutMs: 12000,
      rmsThreshold: 0.02,
      semanticThreshold: 0.65,
      maxAudioBytes: 4 * 1024 * 1024,
      ...overrides.policy,
    },
    ...overrides.connectionOptions,
  });
  connection.handleMessage(JSON.stringify({
    type: 'open',
    sessionId: 'session-a',
    sampleRate: 16000,
    ...overrides.open,
  }), false);
  return { connection, detector, socket, submitted, activeSession };
}

test('endpoint timing and short-speech eligibility are exact server-owned policy', () => {
  assert.deepEqual(
    [
      normalizePolicy({ candidateSilenceMs: 100, fallbackSilenceMs: 900 }).candidateSilenceMs,
      normalizePolicy({ candidateSilenceMs: 100, fallbackSilenceMs: 900 }).fallbackSilenceMs,
      normalizePolicy({ candidateSilenceMs: 9999, fallbackSilenceMs: 9999 }).candidateSilenceMs,
      normalizePolicy({ candidateSilenceMs: 9999, fallbackSilenceMs: 9999 }).fallbackSilenceMs,
      normalizePolicy({ minSpeechMs: 2000 }).minSpeechMs,
    ],
    [1800, 4500, 1800, 4500, 150],
  );
});

test('a stopped Coach session cannot open a live input socket', () => {
  const activeSession = {
    id: 'session-a',
    coachLiveInputState: 'stopped',
    coachLiveInputGeneration: 2,
    coachLiveInputLeaseId: null,
  };
  const harness = createHarness({
    activeSession,
    connectionOptions: {
      canOpenSession: (session) => session.coachLiveInputState === 'active',
    },
  });

  assert.equal(harness.socket.sent.some(({ event }) => event === 'session-started'), false);
  assert.ok(harness.socket.sent.some(({ event, code }) => event === 'error' && code === 'session-not-found'));
  assert.equal(harness.connection.getStatus().closed, true);
});

test('a prepared lease confirms transport without retaining PCM before activation', () => {
  const witnesses = [];
  const activeSession = {
    id: 'session-a',
    coachLiveInputState: 'starting',
    coachLiveInputGeneration: 4,
    coachLiveInputLeaseId: 'lease-a',
  };
  const harness = createHarness({
    activeSession,
    open: { liveInputLeaseId: 'lease-a' },
    connectionOptions: {
      getSessionGeneration: (session) => session.coachLiveInputGeneration,
      canOpenSession: (session, context) => (
        ['starting', 'active'].includes(session.coachLiveInputState)
        && session.coachLiveInputLeaseId === context.liveInputLeaseId
      ),
      isSessionActive: (session, context) => (
        session.coachLiveInputState === 'active'
        && session.coachLiveInputGeneration === context.generation
        && session.coachLiveInputLeaseId === context.liveInputLeaseId
      ),
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
    },
  });

  harness.connection.handleMessage(pcm(64, 0), true);
  assert.ok(harness.socket.sent.some(({ event }) => event === 'capture-ready'));
  assert.equal(harness.connection.getStatus().transportHasPcm, true);
  assert.equal(harness.connection.getStatus().receivedBytes, 0);
  assert.equal(harness.submitted.length, 0);
  assert.ok(witnesses.some(({ metadata }) => (
    metadata.outcome === 'capture-ready'
    && metadata.session_phase === 'starting'
  )));

  activeSession.coachLiveInputState = 'active';
  harness.connection.handleMessage(pcm(64, 0), true);
  assert.equal(harness.connection.getStatus().receivedBytes, pcm(64, 0).length);
});

test('End invalidates a pending semantic endpoint before it can submit audio', async () => {
  let resolveDecision;
  const decision = new Promise((resolve) => { resolveDecision = resolve; });
  const activeSession = {
    id: 'session-a',
    coachLiveInputState: 'active',
    coachLiveInputGeneration: 7,
    coachLiveInputLeaseId: 'lease-a',
  };
  const harness = createHarness({
    activeSession,
    open: { liveInputLeaseId: 'lease-a' },
    detector: {
      predict: () => decision,
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      getSessionGeneration: (session) => session.coachLiveInputGeneration,
      canOpenSession: (session, context) => (
        session.coachLiveInputState === 'active'
        && session.coachLiveInputLeaseId === context.liveInputLeaseId
      ),
      isSessionActive: (session, context) => (
        session.coachLiveInputState === 'active'
        && session.coachLiveInputGeneration === context.generation
        && session.coachLiveInputLeaseId === context.liveInputLeaseId
      ),
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  activeSession.coachLiveInputState = 'stopped';
  activeSession.coachLiveInputGeneration += 1;
  activeSession.coachLiveInputLeaseId = null;
  resolveDecision({ available: true, complete: true, probability: 0.99, reason: null });
  await flush();
  await flush();

  assert.equal(harness.submitted.length, 0);
  assert.equal(harness.socket.sent.some(({ event }) => event === 'processing'), false);
});

test('End invalidates an in-flight ASR commit and suppresses its late transcript', async () => {
  let resolveSubmit;
  let internalHandoff;
  const submitResult = new Promise((resolve) => { resolveSubmit = resolve; });
  const activeSession = {
    id: 'session-a',
    coachLiveInputState: 'active',
    coachLiveInputGeneration: 3,
    coachLiveInputLeaseId: 'lease-a',
  };
  const harness = createHarness({
    activeSession,
    open: { liveInputLeaseId: 'lease-a' },
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      getSessionGeneration: (session) => session.coachLiveInputGeneration,
      canOpenSession: (session, context) => (
        session.coachLiveInputState === 'active'
        && session.coachLiveInputLeaseId === context.liveInputLeaseId
      ),
      isSessionActive: (session, context) => (
        session.coachLiveInputState === 'active'
        && session.coachLiveInputGeneration === context.generation
        && session.coachLiveInputLeaseId === context.liveInputLeaseId
      ),
      submitTurn: async (_body, internal) => {
        internalHandoff = internal;
        return submitResult;
      },
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  activeSession.coachLiveInputState = 'stopped';
  activeSession.coachLiveInputGeneration += 1;
  activeSession.coachLiveInputLeaseId = null;
  assert.equal(internalHandoff.shouldCommit(), false);
  resolveSubmit({ success: true, inputTurn: { transcript: 'must never surface' } });
  await flush();

  assert.equal(harness.socket.sent.some(({ transcript }) => transcript === 'must never surface'), false);
});

test('service status counts conservative fallback turns cumulatively', async () => {
  const webSocketServer = new EventEmitter();
  webSocketServer.close = () => {};
  const service = createVoiceInputLiveService({
    webSocketServer,
    getSession: () => ({ id: 'session-a' }),
    detector: {
      predict: async () => ({ available: false, complete: null, probability: null, reason: 'unavailable' }),
      getStatus: () => ({ state: 'unavailable' }),
      close: () => {},
    },
    submitTurn: async (body) => ({
      success: true,
      inputTurn: { transcript: 'fallback complete', confidence: 0.8 },
      sessionId: body.sessionId,
    }),
  });
  const socket = new FakeSocket();
  webSocketServer.emit('connection', socket);
  socket.emit('message', JSON.stringify({ type: 'open', sessionId: 'session-a', sampleRate: 16000 }), false);
  socket.emit('message', pcm(500, 5000), true);
  socket.emit('message', pcm(4500, 0), true);
  await flush();

  assert.equal(service.getStatus().fallbackCount, 1);
  service.close();
});

test('PCM helpers calculate normalized RMS and emit a valid mono 16 kHz WAV', () => {
  const source = pcm(100, 3276);
  assert.ok(Math.abs(pcm16Rms(source) - 0.1) < 0.002);
  const wav = encodePcm16Wav(source, 16000);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.toString('ascii', 36, 40), 'data');
  assert.equal(wav.readUInt32LE(40), source.length);
  assert.deepEqual(wav.subarray(44), source);
});

test('a deliberate 1.2 s pause is protected and Smart Turn incomplete keeps listening', async () => {
  const calls = [];
  const harness = createHarness({
    detector: {
      predict: async (audio) => {
        calls.push(audio);
        return { available: true, complete: false, probability: 0.18, reason: null };
      },
      getStatus: () => ({ state: 'ready' }),
    },
  });
  harness.connection.handleMessage(pcm(400, 4000), true);
  harness.connection.handleMessage(pcm(1200, 0), true);
  await flush();

  assert.equal(calls.length, 0, 'protected pause never reaches the semantic cutoff');
  assert.equal(harness.submitted.length, 0);
  assert.ok(harness.socket.sent.some(({ event }) => event === 'speech-start'));
  assert.equal(harness.socket.sent.some(({ event }) => event === 'processing'), false);

  harness.connection.handleMessage(pcm(600, 0), true);
  await flush();
  assert.equal(calls.length, 1);
  assert.equal(harness.submitted.length, 0);

  harness.connection.handleMessage(pcm(200, 4000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  assert.equal(calls.length, 2, 'resumed speech permits a fresh endpoint decision');
  assert.equal(harness.submitted.length, 0);
});

test('a confident semantic endpoint sends one internal WAV Buffer turn', async () => {
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.88, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();

  assert.equal(harness.submitted.length, 1);
  assert.equal(harness.submitted[0].body.audioBase64, undefined);
  assert.equal(harness.submitted[0].body.mimeType, 'audio/wav');
  assert.equal(harness.submitted[0].internal.audioBuffer.toString('ascii', 0, 4), 'RIFF');
  assert.equal(harness.socket.sent.filter(({ event }) => event === 'processing').length, 1);
  const final = harness.socket.sent.find(({ event }) => event === 'final-transcript');
  assert.equal(final.transcript, 'careful complete line');
  assert.equal(final.listeningTurnId, 'listening-turn-1');
  assert.equal(final.autoSubmit, true);
});

test('an ASR no-speech result keeps the live socket open and returns to capture-ready', async () => {
  const witnesses = [];
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.88, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      submitTurn: async () => ({
        success: true,
        inputTurn: {
          outcome: 'no-speech',
          transcript: null,
          confidence: null,
        },
      }),
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
    },
  });

  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();

  assert.equal(harness.connection.getStatus().closed, false);
  assert.equal(harness.connection.getStatus().processing, false);
  assert.equal(harness.socket.sent.some(({ event }) => event === 'error'), false);
  assert.equal(
    harness.socket.sent.filter(({ event }) => event === 'capture-ready').length,
    2,
  );
  assert.ok(witnesses.some(({ metadata }) => metadata.outcome === 'asr-no-speech'));
});

test('a sentence semantic retry carries one spoken recovery line while listening continues', async () => {
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.88, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      submitTurn: async () => ({
        success: true,
        inputTurn: {
          outcome: 'no-speech',
          semanticRetry: true,
          coachLine: 'I heard your voice, but I missed the words. Say the sentence again.',
        },
      }),
    },
  });

  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();

  const recovery = harness.socket.sent.find(
    ({ event, recoveredFrom }) => event === 'capture-ready' && recoveredFrom === 'semantic-retry',
  );
  assert.equal(
    recovery?.coachLine,
    'I heard your voice, but I missed the words. Say the sentence again.',
  );
  assert.equal(harness.connection.getStatus().closed, false);
});

test('detector loss falls back conservatively at 4.5 seconds, never inside 1.8 seconds', async () => {
  const harness = createHarness();
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  assert.equal(harness.submitted.length, 0);

  harness.connection.handleMessage(pcm(2699, 0), true);
  await flush();
  assert.equal(harness.submitted.length, 0);

  harness.connection.handleMessage(pcm(1, 0), true);
  await flush();
  await flush();
  assert.equal(harness.submitted.length, 1);
});

test('a short spoken greeting reaches Smart Turn at 1.8 seconds instead of the slow fallback', async () => {
  const detectorCalls = [];
  const harness = createHarness({
    detector: {
      predict: async (audio) => {
        detectorCalls.push(audio);
        return { available: true, complete: true, probability: 0.99, reason: null };
      },
      getStatus: () => ({ state: 'ready' }),
    },
  });

  harness.connection.handleMessage(pcm(200, 5000), true);
  harness.connection.handleMessage(pcm(1799, 0), true);
  await flush();
  assert.equal(harness.submitted.length, 0, 'the locked 1.8 second candidate floor is preserved');
  assert.equal(detectorCalls.length, 0);

  harness.connection.handleMessage(pcm(1, 0), true);
  await flush();
  await flush();
  assert.equal(detectorCalls.length, 1, '150 ms or more of speech is eligible for Smart Turn');
  assert.equal(harness.submitted.length, 1, 'the neural completion finalizes the short greeting');
  assert.ok(harness.socket.sent.some(({ event }) => event === 'final-transcript'));
});

test('a short greeting still keeps the 4.5 second fallback when Smart Turn is unavailable', async () => {
  const harness = createHarness();
  harness.connection.handleMessage(pcm(200, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  assert.equal(harness.submitted.length, 0);

  harness.connection.handleMessage(pcm(2699, 0), true);
  await flush();
  assert.equal(harness.submitted.length, 0);

  harness.connection.handleMessage(pcm(1, 0), true);
  await flush();
  await flush();
  assert.equal(harness.submitted.length, 1);
});

test('the live socket confirms capture on first PCM and fails closed when no frame arrives', () => {
  let timeoutCallback = null;
  let cleared = 0;
  const timedOut = createHarness({
    connectionOptions: {
      firstPcmTimeoutMs: 3000,
      setTimeoutImpl: (callback) => {
        timeoutCallback = callback;
        return 17;
      },
      clearTimeoutImpl: () => { cleared += 1; },
    },
  });
  assert.equal(timedOut.socket.sent.some(({ event }) => event === 'capture-ready'), false);
  timeoutCallback();
  assert.ok(timedOut.socket.sent.some(({ event, code }) => event === 'error' && code === 'pcm-timeout'));
  assert.equal(timedOut.connection.getStatus().closed, true);

  const ready = createHarness({
    connectionOptions: {
      setTimeoutImpl: (callback) => {
        timeoutCallback = callback;
        return 18;
      },
      clearTimeoutImpl: () => { cleared += 1; },
    },
  });
  ready.connection.handleMessage(pcm(64, 0), true);
  assert.ok(ready.socket.sent.some(({ event }) => event === 'capture-ready'));
  assert.equal(ready.connection.getStatus().transportHasPcm, true);
  assert.ok(cleared >= 1);
});

test('a stale neural completion cannot cut off speech that resumed during inference', async () => {
  let resolveDecision;
  const decision = new Promise((resolve) => { resolveDecision = resolve; });
  const harness = createHarness({
    detector: {
      predict: () => decision,
      getStatus: () => ({ state: 'ready' }),
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  harness.connection.handleMessage(pcm(200, 5000), true);
  resolveDecision({ available: true, complete: true, probability: 0.99, reason: null });
  await flush();

  assert.equal(harness.submitted.length, 0);
  assert.equal(harness.socket.sent.some(({ event }) => event === 'processing'), false);
});

test('closing during ASR aborts the internal handoff and suppresses the final envelope', async () => {
  let resolveSubmit;
  const submitResult = new Promise((resolve) => { resolveSubmit = resolve; });
  let signal = null;
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      submitTurn: async (_body, internal) => {
        signal = internal.signal;
        return submitResult;
      },
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  harness.connection.close();
  assert.equal(signal.aborted, true);
  resolveSubmit({ success: true, inputTurn: { transcript: 'too late' } });
  await flush();
  assert.equal(harness.socket.sent.some(({ transcript }) => transcript === 'too late'), false);
});

test('oversized input is rejected before ASR and mid-turn frames stay out of the in-flight turn', async () => {
  let resolveSubmit;
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    policy: { maxAudioBytes: 100_000 },
    connectionOptions: {
      submitTurn: () => new Promise((resolve) => { resolveSubmit = resolve; }),
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  const bytesAtProcessing = harness.connection.getStatus().receivedBytes;
  harness.connection.handleMessage(pcm(100, 5000), true);
  assert.equal(harness.connection.getStatus().receivedBytes, bytesAtProcessing);
  resolveSubmit({ success: true, inputTurn: { transcript: 'done' } });
  await flush();

  const oversized = createHarness({ policy: { maxAudioBytes: 1000 } });
  oversized.connection.handleMessage(pcm(500, 5000), true);
  assert.equal(oversized.submitted.length, 0);
  assert.ok(oversized.socket.sent.some(({ event, code }) => event === 'error' && code === 'audio-too-large'));
});

test('seam witnesses expose timings and categories without audio or transcript content', async () => {
  const witnesses = [];
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
      submitTurn: async () => ({
        success: true,
        inputTurn: { transcript: 'private learner words must not enter telemetry', confidence: 0.9 },
      }),
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();

  const serialized = JSON.stringify(witnesses);
  assert.equal(serialized.includes('private learner words'), false);
  assert.equal(serialized.includes('pcm16Base64'), false);
  assert.ok(witnesses.some(({ metadata }) => metadata.outcome === 'first-pcm'));
  assert.ok(witnesses.some(({ metadata }) => metadata.outcome === 'asr-started'));
  assert.ok(witnesses.some(({ metadata }) => metadata.outcome === 'asr-completed'));
});

// ---------------------------------------------------------------------------
// Defect 1 — speech spoken during the ASR round trip must survive it.
// ---------------------------------------------------------------------------

test('speech spoken during the ASR round trip seeds the next segment instead of being dropped', async () => {
  const witnesses = [];
  let resolveSubmit;
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
      submitTurn: (body, internal) => {
        harness.submitted.push({ body, internal });
        return new Promise((resolve) => { resolveSubmit = resolve; });
      },
    },
  });

  // Turn 1: speak, then pause into the semantic endpoint.
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();
  assert.equal(harness.submitted.length, 1, 'turn 1 reached ASR');
  assert.equal(harness.connection.getStatus().processing, true);

  // The learner keeps talking over "Thinking…" — 400 ms of real voiced audio.
  harness.connection.handleMessage(pcm(400, 5000), true);
  assert.equal(harness.connection.getStatus().pendingFrames, 1, 'mid-turn speech is held, not dropped');
  assert.equal(harness.connection.getStatus().droppedFrames, 0, 'nothing was lost');

  // Turn 1 resolves; the held speech seeds turn 2.
  resolveSubmit({ success: true, inputTurn: { transcript: 'first line', confidence: 0.9 } });
  await flush();
  await flush();

  const seeded = witnesses.find(({ metadata }) => metadata.outcome === 'pending-frames-seeded');
  assert.ok(seeded, 'a structured witness records the seeding');
  assert.equal(seeded.metadata.buffered_frames, 1);
  assert.equal(seeded.metadata.buffered_ms, 400);
  assert.equal(seeded.metadata.dropped_overflow, 0);
  assert.equal(harness.connection.getStatus().pendingFrames, 0);

  // The seeded frame ran the full per-frame path: speech-start fired for turn 2.
  assert.equal(
    harness.socket.sent.filter(({ event }) => event === 'speech-start').length,
    2,
    'the buffered speech opened a new segment',
  );

  // And a trailing pause closes turn 2 on audio that only exists because it was buffered.
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();
  assert.equal(harness.submitted.length, 2, 'the held speech became its own ASR turn');
  assert.ok(
    harness.submitted[1].internal.audioBuffer.length > 44,
    'turn 2 carried real PCM, not an empty WAV',
  );
});

test('a wedged ASR turn bounds the pending buffer and counts the overflow it drops', async () => {
  const witnesses = [];
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
      // Never resolves until the test resolves it.
      submitTurn: (body, internal) => {
        harness.submitted.push({ body, internal });
        return harness.wedged || (harness.wedged = new Promise((resolve) => {
          harness.resolveWedged = resolve;
        }));
      },
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();
  assert.equal(harness.connection.getStatus().processing, true);

  // 1 MiB cap = ~32 s of PCM16 @16 kHz. Push 40 s of voiced audio at it.
  for (let index = 0; index < 40; index += 1) {
    harness.connection.handleMessage(pcm(1000, 5000), true);
  }
  const status = harness.connection.getStatus();
  assert.ok(status.pendingBytes <= 1024 * 1024, `pending buffer stayed bounded: ${status.pendingBytes}`);
  assert.ok(status.droppedFrames > 0, 'overflow drops are counted, not silent');

  harness.resolveWedged({ success: true, inputTurn: { transcript: 'first line', confidence: 0.9 } });
  await flush();
  await flush();
  const seeded = witnesses.find(({ metadata }) => metadata.outcome === 'pending-frames-seeded');
  assert.ok(seeded, 'the seeding witness fires');
  assert.ok(seeded.metadata.dropped_overflow > 0, 'the witness names the overflow it dropped');
  assert.ok(seeded.metadata.buffered_ms > 0);
});

// ---------------------------------------------------------------------------
// Defect 2 — the ASR clip is the voiced span, not the whole listening window.
// ---------------------------------------------------------------------------

test('the ASR clip is trimmed to the voiced span plus margins, and the witness reports both durations', async () => {
  const witnesses = [];
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: false, complete: null, probability: null, reason: 'unavailable' }),
      getStatus: () => ({ state: 'unavailable' }),
    },
    connectionOptions: {
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
    },
  });
  // 1 s of pre-speech silence, 1 s of speech, then the full 4.5 s fallback silence.
  harness.connection.handleMessage(pcm(1000, 0), true);
  harness.connection.handleMessage(pcm(1000, 5000), true);
  harness.connection.handleMessage(pcm(4600, 0), true);
  await flush();
  await flush();

  assert.equal(harness.submitted.length, 1);
  const started = witnesses.find(({ metadata }) => metadata.outcome === 'asr-started');
  assert.ok(started);
  // Raw = 1000 + 1000 + 4600 = 6600 ms. Trimmed = 300 pre-roll + 1000 + 600 tail.
  assert.equal(started.metadata.audio_ms_raw, 6600);
  assert.equal(started.metadata.audio_ms_trimmed, 1900);
  assert.ok(
    started.metadata.audio_ms_trimmed < started.metadata.audio_ms_raw * 0.4,
    'the silence-dominated clip is gone',
  );
  // The WAV actually shrank: 44-byte header + 1900 ms of PCM16 @16 kHz.
  assert.equal(harness.submitted[0].internal.audioBuffer.length, 44 + 1900 * 16 * 2);
  assert.equal(started.metadata.audio_bytes, 1900 * 16 * 2);
});

test('a very short utterance keeps the 500 ms floor rather than being trimmed to nothing', async () => {
  const witnesses = [];
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
    },
  });
  // 200 ms of speech (above the 150 ms minimum) inside a long listening window.
  harness.connection.handleMessage(pcm(200, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();

  const started = witnesses.find(({ metadata }) => metadata.outcome === 'asr-started');
  assert.ok(started);
  assert.ok(started.metadata.audio_ms_trimmed >= 500, `floor held: ${started.metadata.audio_ms_trimmed}`);
  assert.ok(started.metadata.audio_ms_trimmed <= started.metadata.audio_ms_raw);
});

test('open_to_asr_ms measures THIS segment, not cumulative socket wall clock', async () => {
  const witnesses = [];
  let clock = 1_000_000;
  let resolveSubmit;
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      now: () => clock,
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
      submitTurn: (body, internal) => {
        harness.submitted.push({ body, internal });
        return new Promise((resolve) => { resolveSubmit = resolve; });
      },
    },
  });

  clock += 2000;
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();
  const firstAsr = witnesses.filter(({ metadata }) => metadata.outcome === 'asr-started').at(-1);
  assert.equal(firstAsr.metadata.open_to_asr_ms, 2000);

  // 60 s of ASR + coach reply pass before the learner speaks the SECOND turn.
  clock += 60_000;
  resolveSubmit({ success: true, inputTurn: { transcript: 'first line', confidence: 0.9 } });
  await flush();
  await flush();

  clock += 1500;
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();
  const secondAsr = witnesses.filter(({ metadata }) => metadata.outcome === 'asr-started').at(-1);
  assert.equal(
    secondAsr.metadata.open_to_asr_ms,
    1500,
    'turn 2 reports its own 1.5 s, not the 63.5 s the socket had been open',
  );
});

// ---------------------------------------------------------------------------
// Wordless vocalise practice — the LIVE envelope the client actually reads.
// The frontend keys off `recoveredFrom` and renders `coachLine`
// (frontend/src/voice/coach-input.ts readLiveEnvelopeCoachLine).
// ---------------------------------------------------------------------------

test('a wordless-practice no-speech turn re-arms as an acknowledgment carrying coachLine', async () => {
  const witnesses = [];
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      onWitness: (level, category, message, metadata) => {
        witnesses.push({ level, category, message, metadata });
      },
      submitTurn: async () => ({
        success: true,
        inputTurn: {
          outcome: 'no-speech',
          wordlessPractice: true,
          takeKind: 'hum_sovt',
          coachLine: 'I could not get a usable voice reading. Try the hum again, easy and unforced.',
        },
      }),
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();

  const armed = harness.socket.sent.filter(({ event }) => event === 'capture-ready').at(-1);
  assert.equal(armed.recoveredFrom, 'wordless-practice-ack', 'not a lost take');
  assert.equal(
    armed.coachLine,
    'I could not get a usable voice reading. Try the hum again, easy and unforced.',
  );
  assert.equal(harness.connection.getStatus().closed, false, 'the socket keeps listening');
  assert.ok(witnesses.some(({ metadata }) => metadata.outcome === 'wordless-practice-ack'));
});

test('an ordinary no-speech turn still re-arms as asr-no-speech with no coachLine', async () => {
  const harness = createHarness({
    detector: {
      predict: async () => ({ available: true, complete: true, probability: 0.9, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    connectionOptions: {
      submitTurn: async () => ({ success: true, inputTurn: { outcome: 'no-speech' } }),
    },
  });
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  await flush();
  await flush();

  const armed = harness.socket.sent.filter(({ event }) => event === 'capture-ready').at(-1);
  assert.equal(armed.recoveredFrom, 'asr-no-speech');
  assert.equal(armed.coachLine, undefined, 'no line is invented for a genuinely lost take');
});
