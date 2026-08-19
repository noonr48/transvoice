'use strict';

// ---------------------------------------------------------------------------
// "A turn must never die silently again." (2026-07-27 field repair)
//
// THE INCIDENT. A learner spoke a normal sentence. The gateway journal showed
// the whole live path succeed — session-opened, speech-started, asr-started,
// asr-completed with a REAL transcript, pending-frames-seeded — and then
// nothing at all. No coach_gates, no turn_telemetry, no TTS, no error line, no
// client beacon. The tutor simply never answered, and no log on either side of
// the wire could say why, or even say WHETHER a reply had been asked for.
//
// Two silences made that possible, and this file kill-tests both:
//
//   1. voice-input-live's only rejection handler `return`ed with ZERO evidence
//      whenever the turn had been superseded, aborted, or closed. An exception
//      on a discarded turn left no line anywhere.
//   2. POST /voice/coach/stream — the single crossing that turns a finished
//      transcript into a spoken reply — had no witness of ANY kind: its 400/404
//      guards answered silently and its catch-all turned a throw into a bare
//      500 with nothing logged.
//
// Every assertion below checks the witness's CLASS or VALUE, never its mere
// presence: a row that exists but carries the wrong class is exactly as useless
// as no row at all when the next hunt reads it.
// ---------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createVoiceStandaloneRuntime,
  registerStandaloneSupportRoutes,
} = require('./voice-standalone-runtime');
const { createVoiceInputLiveConnection, encodePcm16Wav } = require('./voice-input-live');

// ── live-socket harness ────────────────────────────────────────────────────

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.OPEN = 1;
    this.readyState = this.OPEN;
    this.sent = [];
  }

  send(value) { this.sent.push(JSON.parse(String(value))); }

  close() { this.readyState = 3; this.emit('close'); }
}

function pcm(ms, amplitude = 9000, sampleRate = 16000) {
  const samples = Math.round((sampleRate * ms) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
  }
  return buffer;
}

function flush() { return new Promise((resolve) => setImmediate(resolve)); }

/**
 * A live connection whose `submitTurn` does whatever the test needs, with every
 * witness captured. `discardMidTurn` reproduces the exact shape that used to be
 * swallowed: the turn is invalidated WHILE the submit is in flight, so the
 * rejection lands on a turn nobody is waiting for any more.
 */
function liveHarness({ submitTurn, discardMidTurn = false } = {}) {
  const socket = new FakeSocket();
  const witnesses = [];
  const activeSession = { id: 'session-a' };
  const connection = createVoiceInputLiveConnection({
    socket,
    getSession: (sessionId) => (sessionId === 'session-a' ? activeSession : null),
    submitTurn: async (body, internal) => {
      if (discardMidTurn) {
        // The client stopped listening / a newer segment took over mid-flight.
        socket.readyState = 3;
        socket.emit('close');
      }
      return submitTurn(body, internal);
    },
    detector: {
      // A confident semantic endpoint, so one speech burst + the candidate
      // silence finalizes the segment — the same 'complete' boundary the field
      // trail carried.
      predict: async () => ({ available: true, complete: true, probability: 0.92, reason: null }),
      getStatus: () => ({ state: 'ready' }),
    },
    createId: () => 'segment-1',
    onWitness: (level, category, message, metadata) => {
      witnesses.push({ level, category, message, metadata });
    },
    policy: {
      candidateSilenceMs: 1800,
      fallbackSilenceMs: 4500,
      minSpeechMs: 350,
      noSpeechTimeoutMs: 12000,
      rmsThreshold: 0.02,
      semanticThreshold: 0.65,
      maxAudioBytes: 4 * 1024 * 1024,
    },
  });
  connection.handleMessage(JSON.stringify({ type: 'open', sessionId: 'session-a', sampleRate: 16000 }), false);
  return { connection, socket, witnesses, activeSession };
}

async function driveOneTurn(harness) {
  // One spoken burst, then the candidate silence the semantic endpoint fires on.
  harness.connection.handleMessage(pcm(500, 5000), true);
  harness.connection.handleMessage(pcm(1800, 0), true);
  // The submit is awaited inside finalizeSegment; give the microtask queue room.
  for (let i = 0; i < 12; i += 1) await flush();
}

function turnFailedLines(harness) {
  return harness.witnesses.filter((row) => row.metadata?.outcome === 'turn-failed');
}

// ── 1. the rejection nobody was waiting for ────────────────────────────────

test('a submitTurn rejection on a DISCARDED turn is witnessed (the exact silence that shipped)', async () => {
  const harness = liveHarness({
    discardMidTurn: true,
    submitTurn: async () => {
      const error = new Error('Voice ASR transcription failed.');
      error.status = 502;
      throw error;
    },
  });

  await driveOneTurn(harness);

  const failed = turnFailedLines(harness);
  assert.equal(failed.length, 1, 'the discarded rejection must produce exactly one witness');
  const row = failed[0];
  // LEVEL: a turn that produced no reply is an error, not a warning — and the
  // level is what carries it into the journal the owner actually reads.
  assert.equal(row.level, 'error');
  assert.equal(row.category, 'voice-input-live');
  // CLASS, not presence. A 5xx from the transcription leg is partial-function.
  assert.equal(row.metadata.error_class, 'partial-function');
  assert.equal(row.metadata.error_status, 502);
  assert.equal(row.metadata.discarded, true, 'the discarded case must be labelled as such');
  assert.equal(row.metadata.segment_id, 'segment-1');
  assert.equal(row.metadata.error_message, 'Voice ASR transcription failed.');
});

test('a submitTurn rejection on a LIVE turn is witnessed AND told to the client', async () => {
  const harness = liveHarness({
    submitTurn: async () => { throw new Error('boom on the coach leg'); },
  });

  await driveOneTurn(harness);

  const failed = turnFailedLines(harness);
  assert.equal(failed.length, 1);
  assert.equal(failed[0].metadata.discarded, false);
  assert.equal(failed[0].metadata.error_class, 'partial-function');
  // The client is told, so the surface can stop pretending it is still thinking.
  const errorEvent = harness.socket.sent.find((line) => line.event === 'error');
  assert.ok(errorEvent, 'the client must receive an error event');
  assert.equal(errorEvent.code, 'asr-failed');
  assert.equal(errorEvent.error, 'boom on the coach leg');
});

test('the failure CLASS is derived from the error, not guessed', async () => {
  const cases = [
    [Object.assign(new Error('conflict'), { status: 409 }), 'contract-drift'],
    [Object.assign(new Error('server said no'), { status: 503 }), 'partial-function'],
    [Object.assign(new TypeError('x is not a function')), 'dead-function'],
    [Object.assign(new Error('fetch failed'), { code: 'ECONNREFUSED' }), 'not-connected'],
    [Object.assign(new Error('The operation was aborted'), { name: 'AbortError' }), 'never-received'],
  ];
  for (const [error, expected] of cases) {
    const harness = liveHarness({ submitTurn: async () => { throw error; } });
    await driveOneTurn(harness);
    const failed = turnFailedLines(harness);
    assert.equal(failed.length, 1, `one witness for ${expected}`);
    assert.equal(failed[0].metadata.error_class, expected, `${error.name}/${error.status || error.code} -> ${expected}`);
  }
});

test('a long error message is bounded before it reaches the witness', async () => {
  const harness = liveHarness({
    submitTurn: async () => { throw new Error('x'.repeat(4000)); },
  });
  await driveOneTurn(harness);
  assert.equal(turnFailedLines(harness)[0].metadata.error_message.length, 200);
});

test('a HEALTHY turn emits zero turn-failed lines (witness budget)', async () => {
  const harness = liveHarness({
    submitTurn: async (body) => ({
      success: true,
      sessionId: body.sessionId,
      inputTurn: { transcript: 'a normal spoken sentence', confidence: 0.9 },
    }),
  });
  await driveOneTurn(harness);
  assert.equal(turnFailedLines(harness).length, 0);
  assert.ok(
    harness.witnesses.some((row) => row.metadata?.outcome === 'asr-completed'),
    'the healthy path still reports asr-completed',
  );
});

// ── 2. the coach-turn request seam ─────────────────────────────────────────

/**
 * A runtime + the REAL route registration, entered through the registered
 * handler rather than by calling the runtime method directly — a witness
 * registered into a dispatcher is only proven by entering through it.
 */
function routeHarness({ coachTurn } = {}) {
  const logLines = [];
  const busRows = [];
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-turn-witness-'));
  const runtime = createVoiceStandaloneRuntime({
    fetchImpl: async () => ({
      ok: true, status: 200, headers: new Map(),
      async text() { return '{}'; }, async json() { return {}; },
    }),
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
    debugBus: { push: (level, category, message, metadata) => busRows.push({ level, category, message, metadata }) },
  });
  if (coachTurn) runtime.generateRealtimeCoachReplyStreaming = coachTurn;

  const routes = new Map();
  const record = (method) => (route, ...handlers) => routes.set(
    `${method} ${route}`,
    handlers[handlers.length - 1],
  );
  const app = {
    get: record('GET'),
    post: record('POST'),
    put: record('PUT'),
    patch: record('PATCH'),
    delete: record('DELETE'),
    all: record('ALL'),
    options: record('OPTIONS'),
    head: record('HEAD'),
    use: () => {},
  };
  registerStandaloneSupportRoutes(app, runtime, { sensitiveRouteGuard: (_req, _res, next) => next() });

  const call = async (body) => {
    const res = {
      headersSent: false,
      statusCode: 200,
      payload: null,
      status(code) { this.statusCode = code; return this; },
      json(value) { this.payload = value; this.headersSent = true; return this; },
      writeHead(code) { this.statusCode = code; this.headersSent = true; },
      write() { return true; },
      end() { this.ended = true; },
      setHeader() {},
      on() {}, once() {}, removeListener() {},
    };
    await routes.get('POST /voice/coach/stream')({ body }, res);
    return res;
  };

  return {
    runtime,
    call,
    logLines,
    busRows,
    requestLines: () => logLines.filter((line) => line?.event === 'coach_turn_request'),
    cleanup: () => { try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

test('an ARRIVING coach turn is witnessed — the fact the 2026-07-27 hunt could not establish', async () => {
  let sawTurn = false;
  const harness = routeHarness({ coachTurn: async (_session, _q, res) => { sawTurn = true; res.writeHead(200); res.end(); } });
  try {
    harness.runtime.sessions.set('s1', { id: 's1', voiceState: {} });
    await harness.call({ sessionId: 's1', message: 'i think that sounded okay' });
    assert.equal(sawTurn, true);
    const lines = harness.requestLines();
    assert.equal(lines.length, 1);
    assert.equal(lines[0].outcome, 'accepted');
    // The transcript itself is NEVER logged — only that one arrived, and how big.
    assert.equal(lines[0].message_chars, 'i think that sounded okay'.length);
    assert.equal(Object.values(lines[0]).includes('i think that sounded okay'), false);
    // An accepted request is not a failure, so it stays out of the failure sink.
    assert.equal(harness.busRows.filter((row) => row.category === 'coach-turn').length, 0);
  } finally { harness.cleanup(); }
});

test('every coach-turn REJECTION names itself with a class (all three were silent)', async () => {
  const harness = routeHarness();
  try {
    harness.runtime.sessions.set('s1', { id: 's1', voiceState: {} });

    const noSession = await harness.call({ message: 'hello' });
    assert.equal(noSession.statusCode, 400);
    const missing = await harness.call({ sessionId: 'nope', message: 'hello' });
    assert.equal(missing.statusCode, 404);
    const noMessage = await harness.call({ sessionId: 's1' });
    assert.equal(noMessage.statusCode, 400);

    assert.deepEqual(
      harness.requestLines().map((line) => [line.outcome, line.reason, line.class]),
      [
        ['rejected', 'missing_session_id', 'contract-drift'],
        ['rejected', 'session_not_found', 'wrong-path'],
        ['rejected', 'missing_message', 'contract-drift'],
      ],
    );
    // Every one also reaches the persistent sink, so a restart cannot erase it.
    assert.equal(harness.busRows.filter((row) => row.category === 'coach-turn' && row.level === 'error').length, 3);
  } finally { harness.cleanup(); }
});

test('a coach turn that THROWS before its first witness is named, not swallowed into a bare 500', async () => {
  const harness = routeHarness({
    coachTurn: async () => { throw new TypeError('normalizeThing is not a function'); },
  });
  try {
    harness.runtime.sessions.set('s1', { id: 's1', voiceState: {} });
    const res = await harness.call({ sessionId: 's1', message: 'a normal sentence' });
    assert.equal(res.statusCode, 500);

    const lines = harness.requestLines();
    assert.deepEqual(lines.map((line) => line.outcome), ['accepted', 'failed']);
    const failure = lines[1];
    assert.equal(failure.reason, 'coach_turn_threw');
    // A TypeError on this path means code believed active did not run.
    assert.equal(failure.class, 'dead-function');
    assert.equal(failure.error_name, 'TypeError');
    assert.equal(failure.error_message, 'normalizeThing is not a function');
    assert.equal(failure.response_started, false);
    assert.equal(Number.isFinite(failure.ms), true);
  } finally { harness.cleanup(); }
});

test('a throw AFTER the stream opened is still named, and the response is closed not re-headered', async () => {
  const harness = routeHarness({
    coachTurn: async (_session, _q, res) => {
      res.writeHead(200);
      throw new Error('the model stream died mid-reply');
    },
  });
  try {
    harness.runtime.sessions.set('s1', { id: 's1', voiceState: {} });
    const res = await harness.call({ sessionId: 's1', message: 'a normal sentence' });
    assert.equal(res.ended, true);
    const failure = harness.requestLines().find((line) => line.outcome === 'failed');
    assert.equal(failure.response_started, true);
    assert.equal(failure.class, 'partial-function');
  } finally { harness.cleanup(); }
});

// ── 2b. the failure reaches the JOURNAL, where the owner looks ─────────────

test('a turn-failed witness reaches the journal with its class; a healthy stage keeps its old shape', () => {
  const logLines = [];
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-journal-map-'));
  const runtime = createVoiceStandaloneRuntime({
    fetchImpl: async () => ({ ok: true, status: 200, headers: new Map(), async text() { return '{}'; }, async json() { return {}; } }),
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
  });
  try {
    // The exact metadata voice-input-live emits on a failed turn. Before this
    // mapping existed, an error-level live-input witness never reached the
    // journal at all — the surface where the 2026-07-27 trail was read, and
    // where it simply stopped after asr-completed.
    runtime.pushRuntimeWitness('error', 'voice-input-live', 'Live voice turn failed before a reply could be built.', {
      outcome: 'turn-failed',
      boundary: 'semantic',
      segment_id: 'segment-1',
      discarded: true,
      error_class: 'partial-function',
      error_name: 'Error',
      error_status: 502,
      error_message: 'Voice ASR transcription failed.',
      asr_ms: 2644,
    });
    const failed = logLines.find((line) => line?.event === 'voice_input_live_stage' && line.stage === 'turn-failed');
    assert.ok(failed, 'the failure must reach the journal');
    assert.equal(failed.level, 'error');
    assert.equal(failed.error_class, 'partial-function');
    assert.equal(failed.error_status, 502);
    assert.equal(failed.discarded, true);
    assert.equal(failed.segment_id, 'segment-1');
    assert.equal(failed.asr_ms, 2644);

    // A healthy stage line must NOT grow failure fields — the budget rule.
    logLines.length = 0;
    runtime.pushRuntimeWitness('info', 'voice-input-live', 'Live ASR completed.', {
      outcome: 'asr-completed', boundary: 'semantic', asr_ms: 2644,
    });
    const healthy = logLines.find((line) => line?.event === 'voice_input_live_stage');
    assert.equal(healthy.stage, 'asr-completed');
    assert.equal('error_class' in healthy, false);
    assert.equal('discarded' in healthy, false);
  } finally {
    try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

// ── 3. the client beacon actually CROSSES the fail-closed ingest ───────────

test('every coach-turn-dispatch code the client emits is ACCEPTED by the ingest contract', () => {
  // The ingest is fail-closed on seam/class/code: an unlisted value is dropped
  // with a 400 and the witness never exists. A client-side witness that cannot
  // cross is decoration, so the contract is proven by entering through the
  // REAL /voice/debug/event handler with the exact payloads the browser sends.
  const debug = require('./voice-standalone-debug');
  const routes = [];
  const app = {
    get: (route, ...handlers) => routes.push({ method: 'get', route, handlers }),
    post: (route, ...handlers) => routes.push({ method: 'post', route, handlers }),
    use: () => {},
  };
  const bus = debug.createDebugBus({ logger: {}, now: () => 1000 });
  debug.attachDebugRoutes(app, bus, { getRuntimeStats: () => ({}) });
  const ingest = routes.find((entry) => entry.method === 'post' && entry.route === '/voice/debug/event');
  assert.ok(ingest, 'the client ingest route must exist');

  // Exactly the (level, class, code) triples emitted by
  // reportVoiceCoachTurnDispatch in frontend/src/voice/coach-input.ts.
  const emitted = [
    ['info', 'ok', 'coach-turn-dispatched'],
    ['info', 'ok', 'coach-turn-skipped-manual'],
    ['warn', 'never-received', 'coach-turn-skipped-no-transcript'],
    ['warn', 'never-received', 'coach-turn-skipped-duplicate-segment'],
    ['warn', 'not-connected', 'coach-turn-declined-no-session'],
    ['warn', 'not-connected', 'coach-turn-declined-not-connected'],
    // intent-routed is no longer emitted (2026-07-27 owner's law: all speech
    // goes to the tutor) but stays accepted for old bundles still in the field.
    ['info', 'ok', 'coach-turn-declined-intent-routed'],
    ['info', 'ok', 'coach-turn-declined-scope-intent'],
    ['warn', 'never-received', 'coach-turn-declined-owner-superseded'],
    ['error', 'dead-function', 'coach-turn-declined-no-shell'],
  ];
  for (const [level, failureClass, code] of emitted) {
    const res = {
      statusCode: 200,
      status(value) { this.statusCode = value; return this; },
      json() { return this; },
      end() { return this; },
    };
    ingest.handlers[0]({
      body: {
        schema: 'transvoice.client_failure.v1',
        level,
        seam: 'coach-turn-dispatch',
        class: failureClass,
        code,
        phase: 'app-ready',
        traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
      },
      debugReqId: 'server-abcdef',
    }, res);
    assert.equal(res.statusCode, 200, `${code} must be accepted, not dropped`);
    const event = bus.since(0).at(-1);
    assert.equal(event.kind, 'client:coach-turn-dispatch', `${code} lands on its own seam`);
    assert.equal(event.msg, code);
    assert.equal(event.data.class, failureClass, `${code} keeps its CLASS, not just its name`);
  }
});

// ── 4. the reproduced live scenario, made permanent ────────────────────────

test('a PERSISTED pre-prescription session shape survives a full coach turn (the 2026-07-27 repro)', async () => {
  // The live session that produced the incident, in the shape the store held
  // it: a session persisted BEFORE pendingTakeKind existed (so the key is
  // absent, not null), a bound analyzer session, a real drill, and a trainer
  // whose one-shot slot is held — the exact http_409 the field trail carried.
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-live-repro-'));
  const logLines = [];
  const runtime = createVoiceStandaloneRuntime({
    fetchImpl: async (url) => {
      const target = String(url);
      const body = target.includes('take-oneshot') ? { detail: 'stream slot in use' } : {};
      const status = target.includes('take-oneshot') ? 409 : 200;
      return {
        ok: status < 400,
        status,
        headers: new Map([['content-type', 'application/json']]),
        async text() { return JSON.stringify(body); },
        async json() { return body; },
      };
    },
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, liveMode: 'buffered' }),
      transcribeAudio: async () => ({
        success: true,
        transcript: 'i think that sounded okay',
        confidence: 0.93,
        providerStyle: 'simple',
        transcriptSource: 'backend-asr',
      }),
    },
  });
  try {
    const session = {
      id: 'voice-session-live-repro',
      studentId: 'live-repro-user',
      createdAt: Date.now() - 60000,
      updatedAt: Date.now(),
      coachLiveInputState: 'active',
      coachLiveInputGeneration: 66,
      coachLiveInputLeaseId: null,
      voiceState: {
        // NOTE the absent `pendingTakeKind` key — a session written by any
        // build older than the prescription is exactly this shape, and the
        // normalizer must fill it in rather than trip over it.
        lessonId: 'cute-bright-reset',
        targetPreset: 'cute-feminine',
        targetSource: 'custom-reference',
        voiceSessionId: '222cf29edd4c492d968c27e043faa1bc',
        status: 'idle',
        serviceStatus: 'online',
        coachVoice: { speechEnabled: true, continuousEnabled: false, speechProvider: 'voxcpm', inputProvider: 'backend' },
        voiceInputRuntime: { status: 'idle', lastOutcome: 'idle', successfulTurns: 24 },
      },
    };
    runtime.sessions.set(session.id, session);

    // Leg 1 — the live input turn, with the analyzer take answering 409.
    const segment = Buffer.alloc(16000 * 2);
    for (let i = 0; i < 16000; i += 1) segment.writeInt16LE(i % 2 ? 9000 : -9000, i * 2);
    const payload = await runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
      sessionId: session.id,
      requestedProvider: 'backend',
      captureProvider: 'backend',
      audioFormat: 'wav',
      mimeType: 'audio/wav',
      filename: 'voice-input.wav',
      transcriptSource: 'backend-live',
      capturedAt: Date.now(),
    }, {
      audioBuffer: encodePcm16Wav(segment, 16000),
      pcmBuffer: segment,
      shouldCommit: () => true,
    });
    assert.equal(payload.inputTurn.transcript, 'i think that sounded okay');

    // The 409 is fail-OPEN and witnessed, exactly as the field trail showed.
    const take = logLines.filter((line) => line?.event === 'coach_take');
    assert.equal(take.length, 1);
    assert.equal(take[0].outcome, 'error');
    assert.equal(take[0].reason, 'http_409');

    // Leg 2 — the coach turn on that same session must reach its own witness.
    // This is the assertion the incident needed: the turn does NOT die between
    // the transcript and coach_gates.
    const res = {
      headersSent: false,
      chunks: [],
      writeHead() { this.headersSent = true; },
      write(chunk) { this.chunks.push(String(chunk)); return true; },
      end(chunk) { if (chunk) this.chunks.push(String(chunk)); this.ended = true; },
      setHeader() {}, on() {}, once() {}, removeListener() {},
    };
    await runtime.generateRealtimeCoachReplyStreaming(session, 'i think that sounded okay', res, null, null);
    assert.ok(
      logLines.some((line) => line?.event === 'coach_gates'),
      'the coach turn must reach coach_gates on a persisted pre-prescription session',
    );
    assert.equal(res.headersSent, true, 'the reply stream must open');
  } finally {
    try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});
