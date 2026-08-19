'use strict';

// 2026-07-29 TTS latency optimization (L1-L3).
//   L1: pre-synthesis fires at sanitize time with the EXACT upstream request
//       the phone's later /voice/speech/generate will send (same cache keys),
//       drains the stream, and is abort-aware.
//   L2: the wire copy of attemptArtifacts keeps every frontend-read field and
//       drops the heavy ones (timeline + advanced bulk).
//   L3: session-start template pre-warm enumerates bounded, invariant-only
//       template sentences through the same path.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestApp,
  stopTestApp,
  buildMockFetchImpl,
  mockJsonResponse: mockJsonResponseFromTestkit,
  mockAudioResponse,
} = require('./voice-standalone-testkit');
const { listInvariantTemplateTexts } = require('./coaching/direct-reply');
const { listStarterDrillInstructions } = require('./coaching/signal-builder');

// Server calls must bypass the patched global.fetch (the VoxCPM mock) — the
// load-time reference is the real one.
const serverFetch = global.fetch;

async function httpPost(url, body) {
  const response = await serverFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

async function waitFor(predicate, { timeoutMs = 3000, stepMs = 25 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = predicate();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
  return null;
}

function makeGenerateRecorder(base) {
  const calls = [];
  const fetchImpl = base;
  const recorder = async (url, options = {}) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    if (urlStr.includes('/generate')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch { /* ignore */ }
      calls.push({ url: urlStr, body, signal: options.signal || null });
    }
    return fetchImpl(url, options);
  };
  return { calls, fetchImpl: recorder };
}

function setupLatencyApp({ generateBehavior = null, withReference = true, logger = null, paceMs = 0 } = {}) {
  const overrides = {};
  if (withReference) {
    // Echo the requested target exactly, like the prewarm integration test —
    // the analyzer acknowledgement must match or /voice/session/start fails.
    overrides['/api/v1/voice/sessions/start'] = async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      return mockJsonResponseFromTestkit(200, {
        voiceSessionId: 'mock-vt-session-1',
        status: 'ready',
        targetPreset: body.targetPreset,
        targetSource: body.targetSource,
        referenceClipId: body.referenceClipId,
        targetProfileId: body.targetVoiceProfile?.profileId || null,
        analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
        streamUrl: '/api/v1/voice/sessions/mock-vt-session-1/stream',
        createdAt: Date.now(),
      });
    };
  }
  const base = buildMockFetchImpl(overrides);
  const defaultGenerate = async (url, options) => {
    // The speech handler verifies the cloned-synthesis evidence headers on a
    // referenced session — mirror the prewarm integration tests' mock mode.
    return mockAudioResponse(200, Buffer.from('RIFF' + '\x00'.repeat(100)), {
      generationMode: 'cloned-synthesis',
    });
  };
  const recorder = makeGenerateRecorder(generateBehavior ? async (url, options) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    if (urlStr.includes('/generate')) return generateBehavior(url, options);
    return base(url, options);
  } : (async (url, options) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    if (urlStr.includes('/generate')) return defaultGenerate(url, options);
    return base(url, options);
  }));
  // The VoxCPM lane (reference prepare + /generate) uses bare global fetch in
  // voice-standalone-runtime.js — the same pattern the prewarm integration
  // tests follow — so the mock+recorder must patch BOTH fetchImpl and
  // global.fetch.
  const realFetch = global.fetch;
  global.fetch = recorder.fetchImpl;
  const logs = [];
  return startTestApp({
    fetchImpl: recorder.fetchImpl,
    voxcpmEnabled: true,
    disableSessionPersistence: true,
    ttsTemplatePrewarmPaceMs: paceMs,
    logger: {
      log(event) { logs.push(event); },
      warn() {},
      error() {},
    },
  }).then((ctx) => ({ ctx, generateCalls: recorder.calls, logs, realFetch }));
}

async function teardownLatencyApp(ctx, realFetch) {
  await stopTestApp(ctx);
  global.fetch = realFetch;
}

// Bind a reference onto the session the way the prewarm integration tests do:
// the trainer session-start mock carries no clip, so the reference arrives via
// /voice/session/reference and is bound by /voice/session/start (which is also
// where the L3 template pre-warm hook fires).
async function startReferencedSession(ctx, withReference = true) {
  const start = await httpPost(`${ctx.baseUrl}/session/start`, {});
  const sessionId = start.body.sessionId;
  if (withReference) {
    await httpPost(`${ctx.baseUrl}/voice/session/reference`, {
      sessionId,
      referenceClipId: 'clip-1',
    });
    const bind = await httpPost(`${ctx.baseUrl}/voice/session/start`, {
      sessionId,
      targetSource: 'reference',
      referenceClipId: 'clip-1',
    });
    if (bind.status !== 200) {
      throw new Error(`reference bind failed (${bind.status}): ${JSON.stringify(bind.body).slice(0, 200)}`);
    }
  }
  return sessionId;
}

// ---------------------------------------------------------------------------
// L1 — pre-synthesis at sanitize time
// ---------------------------------------------------------------------------

test('L1: pre-synthesis fires with the exact upstream request and drains', async () => {
  const { ctx, generateCalls, logs, realFetch } = await setupLatencyApp();
  try {
    const sessionId = await startReferencedSession(ctx);

    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.equal(turn.status, 200);
    const reply = turn.body.message;
    assert.ok(reply);

    const presynth = await waitFor(() => generateCalls.find((call) => call.body.target_text === reply));
    assert.ok(presynth, 'pre-synthesis /generate fired for the reply text');
    // The EXACT upstream shape the phone's speech request uses — same cache keys.
    assert.equal(presynth.body.speakingRate, 0.76);
    assert.equal(presynth.body.reference_audio_path, '/tmp/mock-ref.wav');

    // Drained + witnessed (the response was already in hand before this — the
    // coach reply never waited on the prime).
    const witness = await waitFor(() => logs.find((event) => (
      event?.event === 'tts_presynth' && event?.reason === 'coach_reply_buffered'
    )));
    assert.ok(witness, 'tts_presynth witness logged');
    assert.equal(witness.outcome, 'primed');
    assert.ok(witness.drained_bytes > 0, 'the stream was drained');
  } finally {
    await teardownLatencyApp(ctx, realFetch);
  }
});

test('L1: the phone speech request produces byte-identical upstream cache keys', async () => {
  const { ctx, generateCalls, realFetch } = await setupLatencyApp();
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    const reply = turn.body.message;
    const presynth = await waitFor(() => generateCalls.find((call) => call.body.target_text === reply));
    assert.ok(presynth);

    const speech = await httpPost(`${ctx.baseUrl}/voice/speech/generate`, {
      sessionId,
      targetText: reply,
    });
    assert.equal(speech.status, 200);
    const phoneUpstream = generateCalls.filter((call) => call.body.target_text === reply).at(-1);
    assert.ok(phoneUpstream);
    // target_text + speakingRate + reference_audio_path are the cache-key inputs.
    assert.deepEqual(
      {
        target_text: phoneUpstream.body.target_text,
        speakingRate: phoneUpstream.body.speakingRate,
        reference_audio_path: phoneUpstream.body.reference_audio_path,
      },
      {
        target_text: presynth.body.target_text,
        speakingRate: presynth.body.speakingRate,
        reference_audio_path: presynth.body.reference_audio_path,
      },
    );
  } finally {
    await teardownLatencyApp(ctx, realFetch);
  }
});

test('L1: pre-synthesis is abort-aware (session stop cancels the prime)', async () => {
  const hanging = () => new Promise(() => {}); // never resolves — a stale prime
  const { ctx, generateCalls, realFetch } = await setupLatencyApp({ generateBehavior: hanging });
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, { sessionId, message: 'How was that?' });
    const replyText = turn.body.message;
    // The prime fires DURING the turn (sanitize time) — read its recorded call.
    const prime = await waitFor(() => generateCalls.find((call) => call.body.target_text === replyText));
    assert.ok(prime, 'the reply prime fired');
    assert.ok(prime.signal, 'the reply prime carries an abort signal');
    assert.equal(prime.signal.aborted, false);

    const stop = await httpPost(`${ctx.baseUrl}/session/${encodeURIComponent(sessionId)}/stop`, {});
    assert.ok(stop.status === 200 || stop.status === 204);
    const aborted = await waitFor(() => prime.signal.aborted === true);
    assert.equal(aborted, true, 'session stop aborted the stale pre-synthesis');
  } finally {
    await teardownLatencyApp(ctx, realFetch);
  }
});

test('L1: no reference means a graceful no-op (no upstream call, reply unaffected)', async () => {
  const { ctx, generateCalls, realFetch } = await setupLatencyApp({ withReference: false });
  try {
    const sessionId = await startReferencedSession(ctx, false);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.ok(turn.body.message);
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(generateCalls.length, 0, 'no pre-synthesis without a reference');
  } finally {
    await teardownLatencyApp(ctx, realFetch);
  }
});

// ---------------------------------------------------------------------------
// L2 — slimmed attempt history on the wire
// ---------------------------------------------------------------------------

test('L2: the wire keeps every frontend-read field and drops timeline + advanced bulk', async () => {
  const logs = [];
  const ctx = await startTestApp({
    fetchImpl: buildMockFetchImpl({}),
    disableSessionPersistence: true,
    logger: { log(event) { logs.push(event); }, warn() {}, error() {} },
  });
  try {
    const start = await httpPost(`${ctx.baseUrl}/session/start`, {});
    const sessionId = start.body.sessionId;
    const session = ctx.runtime.sessions.get(sessionId);
    const bigTimeline = Array.from({ length: 80 }, (_, i) => ({ t: i * 10, f0: 180 + i, voiced: true }));
    const bigAdvanced = {
      measurementAvailable: true,
      scoreConfidence: 0.9,
      voicedFramePct: 0.9,
      pitchValidFrameCount: 120,
      pitchP10Hz: 150,
      pitchP90Hz: 220,
      formantLite: { f1MedianHz: 700, f2MedianHz: 1900, frontnessScore: 0.5 },
      hugePerFrameArray: Array.from({ length: 400 }, (_, i) => i),
    };
    session.voiceState = {
      ...session.voiceState,
      attemptArtifacts: [0, 1].map((n) => ({
        attemptArtifactId: `art-${n}`,
        attemptId: `att-${n}`,
        clientAttemptId: `client-${n}`,
        createdAt: Date.now() - n * 1000,
        finalizedAt: Date.now() - n * 1000,
        status: 'finalized',
        timeline: bigTimeline,
        repContext: { kind: 'phrase', drillId: 'x' },
        selfReport: { strain: 1 },
        phraseComparison: { words: ['a', 'b'] },
        summary: {
          metrics: {
            targetHitPct: 0.6 + n * 0.05,
            similarityScore: 0.4,
            durationMs: 3200,
            meanPitchHz: 190 + n,
            advanced: bigAdvanced,
          },
        },
      })),
    };

    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.equal(turn.status, 200);
    const artifacts = turn.body.voiceState?.attemptArtifacts || [];
    assert.equal(artifacts.length, 2, 'every row survives the trim (take count is honest)');
    for (const artifact of artifacts) {
      assert.equal(artifact.timeline, undefined, 'timeline dropped');
      assert.equal(artifact.repContext, undefined, 'repContext dropped');
      assert.equal(artifact.phraseComparison, undefined, 'phraseComparison dropped');
      assert.ok(artifact.attemptArtifactId && artifact.clientAttemptId, 'Listen replay ids preserved');
      const advanced = artifact.summary?.metrics?.advanced || {};
      assert.equal(advanced.measurementAvailable, true, 'usability field preserved');
      assert.equal(advanced.pitchP10Hz, undefined, 'advanced bulk dropped');
      assert.equal(advanced.formantLite, undefined, 'formant bulk dropped');
      assert.equal(advanced.hugePerFrameArray, undefined, 'frame arrays dropped');
      assert.ok([0.6, 0.65].includes(artifact.summary?.metrics?.targetHitPct), 'hit% preserved');
    }
    const witness = logs.find((event) => event?.event === 'session_payload_slimmed');
    assert.ok(witness, 'session_payload_slimmed witness logged');
    assert.ok(witness.bytes_after < witness.bytes_before, 'payload shrank');
  } finally {
    await stopTestApp(ctx);
  }
});

// ---------------------------------------------------------------------------
// L3 — template pre-warm at session start
// ---------------------------------------------------------------------------

test('L3: invariant enumerations are bounded and invariant-only', () => {
  const templates = listInvariantTemplateTexts();
  assert.ok(templates.length >= 12, `expected the template pools, got ${templates.length}`);
  for (const text of templates) {
    assert.equal(typeof text, 'string');
    assert.match(text, /\.$/, `invariant templates are whole sentences: ${text}`);
    assert.ok(!text.includes('{'), `no interpolation placeholders: ${text}`);
  }
  const drills = listStarterDrillInstructions();
  assert.equal(drills.length, 9);
  for (const text of drills) {
    assert.ok(text.trim().length > 0);
    assert.ok(!text.includes('{'));
  }
});

test('L3: session start pre-warms bounded template segments through the L1 path', async () => {
  const { ctx, generateCalls, logs, realFetch } = await setupLatencyApp({ paceMs: 0 });
  try {
    await startReferencedSession(ctx);
    const witness = await waitFor(() => logs.find((event) => event?.event === 'tts_template_prewarm'), { timeoutMs: 5000 });
    assert.ok(witness, 'tts_template_prewarm witness logged');
    assert.ok(witness.segments_enumerated > 0);
    assert.ok(witness.segments_enumerated <= 48, `bounded enumeration, got ${witness.segments_enumerated}`);
    assert.equal(witness.segments_fired, witness.segments_enumerated);
    const templateCall = generateCalls.find((call) => (
      call.body.target_text === 'Switch to a very gentle hum or lip trill with no pushing.'
    ));
    assert.ok(templateCall, 'a RESET template segment was pre-synthesized');
    assert.equal(templateCall.body.reference_audio_path, '/tmp/mock-ref.wav');
  } finally {
    await teardownLatencyApp(ctx, realFetch);
  }
});
