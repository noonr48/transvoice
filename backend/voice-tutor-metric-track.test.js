'use strict';

// 2026-07-30 CALL-AND-RESPONSE GRAPH — the tutor's own travel.
//
// The tutor speaks and its dot crosses the pitch / mouth-shape field; then the
// learner speaks and her dot crosses the ghost of it. She copies the SHAPE,
// wordlessly. Her half was always live. The tutor's half could not run, because
// the app synthesizes his speech and never listened to it.
//
// These tests drive the REAL runtime path end to end: a coach turn fires the
// real pre-synthesis, the real drain hands the real audio bytes to the real
// analyzer client, the real validity gate judges the reading, and the real
// speech route publishes it on the response that carries the audio. The two
// upstreams (VoxCPM, the analyzer) are mocked at the socket, exactly as the
// existing latency suite mocks them — but everything BETWEEN them is the
// shipping code, and the assertions are on real HTTP responses.
//
// The load-bearing properties:
//   1. The analyzer receives the SAME BYTES VoxCPM produced (not a stub, not a
//      re-request) — the measurement is of the audio the learner will hear.
//   2. The speech response carries that measurement, and it is exposed to the
//      browser.
//   3. Every failure mode still SPEAKS. A missing shape costs the graph a turn.
//   4. Nothing waits. The reply path and the speech path never block on it.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  startTestApp,
  stopTestApp,
  buildMockFetchImpl,
  mockJsonResponse,
  mockAudioResponse,
} = require('./voice-standalone-testkit');

const {
  DEFAULT_MAX_TRACK_POINTS,
  MAX_TRACK_HEADER_CHARS,
  buildTutorMetricTrack,
  buildTutorMetricTrackKey,
  createTutorMetricTrackCache,
  decodeTutorMetricTrackHeader,
  encodeTutorMetricTrackHeader,
} = require('./voice-tutor-metric-track');

const serverFetch = global.fetch;

async function httpPost(url, body) {
  const response = await serverFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// `timeoutMs` is not a nicety: the latency law under test is "this route never
// waits on the analysis", and a route that DOES wait would otherwise hang the
// whole suite instead of naming itself. A bounded client turns that into an
// assertion failure with a test name attached.
async function httpPostRaw(url, body, { timeoutMs = 0 } = {}) {
  const controller = new AbortController();
  const timer = timeoutMs > 0
    ? setTimeout(() => controller.abort(new Error(`request exceeded ${timeoutMs}ms`)), timeoutMs)
    : null;
  try {
    const response = await serverFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const buffer = Buffer.from(await response.arrayBuffer());
    return { status: response.status, headers: response.headers, buffer };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitFor(predicate, { timeoutMs = 4000, stepMs = 15 } = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = predicate();
    if (value) return value;
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, stepMs));
  }
}

// ---------------------------------------------------------------------------
// Fixtures that mirror the REAL services
// ---------------------------------------------------------------------------

// A rising 48 kHz mono PCM16 sweep. Not decorative: it stands in for tutor
// speech whose pitch TRAVELS, and it is what the analyzer mock must receive
// byte for byte for the crossing to be proven.
function tutorPcm({ ms = 700, sampleRate = 48000 } = {}) {
  const count = Math.round((sampleRate * ms) / 1000);
  const buffer = Buffer.alloc(count * 2);
  let phase = 0;
  for (let index = 0; index < count; index += 1) {
    const f0 = 180 + (60 * (index / count));
    phase += (2 * Math.PI * f0) / sampleRate;
    buffer.writeInt16LE(Math.round(Math.sin(phase) * 20000), index * 2);
  }
  return buffer;
}

// The analyzer's real response contract (services/voice-trainer contracts.py:
// SynthesisAnalysisResponse -> VoiceAttemptMetrics + list[VoiceFrame]). The
// `advanced` block carries the exact fields voice-measurement-validity.js
// reads, so the gate under test is the shipping gate, not a stand-in.
function analyzerResponse({
  frames = 60,
  startHz = 180,
  endHz = 240,
  usable = true,
  voiced = true,
} = {}) {
  const timeline = [];
  for (let index = 0; index < frames; index += 1) {
    const ratio = frames === 1 ? 0 : index / (frames - 1);
    timeline.push({
      t: index * 10,
      voiced,
      pitchHz: voiced ? startHz + ((endHz - startHz) * ratio) : 0,
      pitchScore: 0.7,
      resonanceScore: 0.30 + (0.35 * ratio),
      weightScore: 0.28,
      confidence: 0.75,
      loudnessDb: -22.5,
      analysisVersion: 'voice-metrics-v4-formants',
    });
  }
  return {
    analysisVersion: 'voice-metrics-v4-formants',
    durationMs: frames * 10,
    sampleRate: 16000,
    metrics: {
      meanPitchHz: (startHz + endHz) / 2,
      resonanceMean: 0.475,
      weightMean: 0.28,
      advanced: {
        measurementAvailable: usable,
        scoreConfidence: usable ? 0.757 : 0.10,
        voicedFramePct: usable ? 0.62 : 0.02,
        confidentFramePct: usable ? 1.0 : 0.10,
        captureReliability: usable ? 0.70 : 0.10,
        pitchValidFrameCount: usable ? frames : 0,
        snrDb: usable ? 70.8 : 3.0,
        clippingPct: 0.0,
        reliabilityFlags: usable ? ['quiet_input'] : ['no_voiced_frames'],
      },
    },
    timeline,
  };
}

// ---------------------------------------------------------------------------
// Harness — the same shape the L1/L3 latency suite uses
// ---------------------------------------------------------------------------

function setupTrackApp({
  audio = tutorPcm(),
  analyzeBehavior = null,
  generateBehavior = null,
  enabled = true,
  timeoutMs = 4000,
  streamOnly = false,
  templatePrewarmEnabled = false,
  templatePrewarmPaceMs = 0,
} = {}) {
  const analyzeCalls = [];
  const overrides = {
    '/api/v1/voice/sessions/start': async (_url, options = {}) => {
      const body = JSON.parse(options.body || '{}');
      return mockJsonResponse(200, {
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
    },
    '/api/v1/voice/synthesis/analyze': async (_url, options = {}) => {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch { /* ignore */ }
      analyzeCalls.push(body);
      if (analyzeBehavior) return analyzeBehavior(body, analyzeCalls.length);
      return mockJsonResponse(200, analyzerResponse());
    },
  };
  const base = buildMockFetchImpl(overrides);
  const generateCalls = [];
  const fetchImpl = async (url, options = {}) => {
    const urlStr = typeof url === 'string' ? url : String(url);
    if (urlStr.includes('/generate')) {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch { /* ignore */ }
      generateCalls.push(body);
      if (generateBehavior) {
        return generateBehavior({ body, options, call: generateCalls.length, audio });
      }
      const response = mockAudioResponse(200, audio, { generationMode: 'cloned-synthesis' });
      response.headers.set('X-Audio-Sample-Rate', '48000');
      response.headers.set('X-Audio-Format', 'pcm_s16le');
      if (streamOnly) {
        // A body that can ONLY be read chunk by chunk. The drain has two
        // branches and production takes the arrayBuffer one; this exercises the
        // other, which would otherwise be shipped untested.
        delete response.arrayBuffer;
        const chunkSize = Math.max(2, Math.floor(audio.length / 4) & ~1);
        response.body = {
          getReader() {
            let offset = 0;
            return {
              async read() {
                if (offset >= audio.length) return { done: true };
                const chunk = audio.subarray(offset, Math.min(audio.length, offset + chunkSize));
                offset += chunk.length;
                return { done: false, value: chunk };
              },
              releaseLock() {},
            };
          },
        };
      }
      return response;
    }
    return base(url, options);
  };

  const realFetch = global.fetch;
  global.fetch = fetchImpl;
  const logs = [];
  return startTestApp({
    fetchImpl,
    voxcpmEnabled: true,
    disableSessionPersistence: true,
    ttsTemplatePrewarmEnabled: templatePrewarmEnabled,
    ttsTemplatePrewarmPaceMs: templatePrewarmPaceMs,
    tutorMetricTrackEnabled: enabled,
    tutorMetricTrackTimeoutMs: timeoutMs,
    logger: { log(event) { logs.push(event); }, warn() {}, error() {} },
  }).then((ctx) => ({ ctx, analyzeCalls, generateCalls, logs, realFetch }));
}

async function teardownTrackApp(ctx, realFetch) {
  await stopTestApp(ctx);
  global.fetch = realFetch;
}

async function startReferencedSession(ctx) {
  const start = await httpPost(`${ctx.baseUrl}/session/start`, {});
  const sessionId = start.body.sessionId;
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
    throw new Error(`reference bind failed (${bind.status})`);
  }
  return sessionId;
}

// ---------------------------------------------------------------------------
// The key: the identity of a piece of tutor audio
// ---------------------------------------------------------------------------

test('the key is the audio: same three inputs, same key; any change, a different key', () => {
  const base = { text: 'Let the sound float forward.', speakingRate: 0.76, referenceAudioPath: '/tmp/ref.wav' };
  assert.equal(buildTutorMetricTrackKey(base), buildTutorMetricTrackKey({ ...base }));
  assert.notEqual(buildTutorMetricTrackKey(base), buildTutorMetricTrackKey({ ...base, text: 'Something else.' }));
  assert.notEqual(buildTutorMetricTrackKey(base), buildTutorMetricTrackKey({ ...base, speakingRate: 0.65 }));
  assert.notEqual(
    buildTutorMetricTrackKey({ ...base, speakingRate: 0.7601 }),
    buildTutorMetricTrackKey({ ...base, speakingRate: 0.7604 }),
    'distinct on-wire numeric rates must never alias to one audio track',
  );
  assert.equal(
    buildTutorMetricTrackKey({ ...base, speakingRate: -0 }),
    buildTutorMetricTrackKey({ ...base, speakingRate: 0 }),
    'rates with the same JSON wire value share one identity',
  );
  assert.notEqual(
    buildTutorMetricTrackKey({ text: '1|hello', speakingRate: 0.76, referenceAudioPath: '/voice/a' }),
    buildTutorMetricTrackKey({ text: 'hello', speakingRate: 1, referenceAudioPath: '/voice/a|0.76' }),
    'tuple fields containing delimiters must not collide',
  );
  assert.notEqual(
    buildTutorMetricTrackKey({ ...base, referenceAudioPath: 'none' }),
    buildTutorMetricTrackKey({ ...base, referenceAudioPath: null }),
    'a literal voice identity must not alias the absent-voice sentinel',
  );
  assert.notEqual(buildTutorMetricTrackKey(base), buildTutorMetricTrackKey({ ...base, referenceAudioPath: '/tmp/other.wav' }));
  // Whitespace around the same line is the same line.
  assert.equal(buildTutorMetricTrackKey(base), buildTutorMetricTrackKey({ ...base, text: '  Let the sound float forward.  ' }));
});

test('an unkeyable line is never cached — a wrong hit would draw the wrong shape', () => {
  assert.equal(buildTutorMetricTrackKey({ text: '', speakingRate: 0.76 }), null);
  assert.equal(buildTutorMetricTrackKey({ text: '   ', speakingRate: 0.76 }), null);
  assert.equal(buildTutorMetricTrackKey({}), null);
});

test('the cache is bounded and least-recently-used', () => {
  const cache = createTutorMetricTrackCache({ maxEntries: 3 });
  cache.set('a', { points: [1] });
  cache.set('b', { points: [2] });
  cache.set('c', { points: [3] });
  assert.equal(cache.size, 3);
  // Touch 'a' so 'b' becomes the oldest.
  assert.ok(cache.get('a'));
  cache.set('d', { points: [4] });
  assert.equal(cache.size, 3);
  assert.equal(cache.get('b'), null, 'the least-recently-used entry was evicted');
  assert.ok(cache.get('a'));
  assert.ok(cache.get('c'));
  assert.ok(cache.get('d'));
});

// ---------------------------------------------------------------------------
// The reading: the learner's own trust gate, applied to the tutor
// ---------------------------------------------------------------------------

test('a trustworthy analysis becomes a travelling shape', () => {
  const track = buildTutorMetricTrack(analyzerResponse({ frames: 60 }));
  assert.ok(track, 'a usable analysis yields a track');
  assert.equal(track.analysisVersion, 'voice-metrics-v4-formants');
  assert.equal(track.durationMs, 600);
  assert.ok(track.points.length >= 2);
  assert.ok(track.points.length <= DEFAULT_MAX_TRACK_POINTS);
  // A shape, not a point: both axes travel across the phrase.
  assert.ok(track.points.at(-1).pitchHz > track.points[0].pitchHz);
  assert.ok(track.points.at(-1).resonance > track.points[0].resonance);
  // Endpoints are kept, so the gesture is not clipped.
  assert.equal(track.points[0].tMs, 0);
  assert.equal(track.points.at(-1).tMs, 590);
  for (const point of track.points) {
    assert.ok(Number.isFinite(point.pitchHz) && point.pitchHz > 0);
    assert.ok(Number.isFinite(point.resonance));
    assert.ok(Number.isFinite(point.tMs));
  }
});

test('an UNTRUSTWORTHY reading yields no shape — the learner never copies noise', () => {
  // The real gate in voice-measurement-validity.js, on the real fields.
  assert.equal(buildTutorMetricTrack(analyzerResponse({ usable: false })), null);
});

test('unvoiced audio yields no shape, and one point is not a travel', () => {
  assert.equal(buildTutorMetricTrack(analyzerResponse({ voiced: false })), null);
  assert.equal(buildTutorMetricTrack(analyzerResponse({ frames: 1 })), null);
});

test('a missing, empty or malformed analysis is null, never a throw', () => {
  assert.equal(buildTutorMetricTrack(null), null);
  assert.equal(buildTutorMetricTrack(undefined), null);
  assert.equal(buildTutorMetricTrack({}), null);
  assert.equal(buildTutorMetricTrack({ metrics: {}, timeline: 'nope' }), null);
  assert.equal(buildTutorMetricTrack({ metrics: { advanced: {} }, timeline: [] }), null);
});

// ---------------------------------------------------------------------------
// The wire form
// ---------------------------------------------------------------------------

test('the header round-trips the shape', () => {
  const track = buildTutorMetricTrack(analyzerResponse({ frames: 60 }));
  const encoded = encodeTutorMetricTrackHeader(track);
  assert.ok(encoded, 'a track encodes');
  assert.ok(encoded.length <= MAX_TRACK_HEADER_CHARS);
  // Header values must be latin-1 safe.
  assert.match(encoded, /^[ -~]+$/);
  const decoded = decodeTutorMetricTrackHeader(encoded);
  assert.equal(decoded.analysisVersion, track.analysisVersion);
  assert.equal(decoded.meanPitchHz, track.meanPitchHz);
  assert.equal(decoded.resonance, track.resonance);
  assert.equal(decoded.points.length, track.points.length);
  assert.deepEqual(decoded.points[0], track.points[0]);
  assert.deepEqual(decoded.points.at(-1), track.points.at(-1));
});

test('an over-large shape is THINNED, not dropped', () => {
  const fat = buildTutorMetricTrack(analyzerResponse({ frames: 4000 }), { maxPoints: 4000 });
  assert.ok(fat.points.length > 1000);
  const encoded = encodeTutorMetricTrackHeader(fat);
  assert.ok(encoded, 'a huge track still produces a header');
  assert.ok(encoded.length <= MAX_TRACK_HEADER_CHARS);
  const decoded = decodeTutorMetricTrackHeader(encoded);
  assert.ok(decoded.points.length >= 2);
  assert.ok(decoded.points.length < fat.points.length, 'it was thinned');
});

test('nothing encodes to a header that lies', () => {
  assert.equal(encodeTutorMetricTrackHeader(null), null);
  assert.equal(encodeTutorMetricTrackHeader({ points: [] }), null);
  assert.equal(encodeTutorMetricTrackHeader({ points: [{ tMs: 0, pitchHz: 1, resonance: 0 }] }), null);
  assert.equal(decodeTutorMetricTrackHeader(''), null);
  assert.equal(decodeTutorMetricTrackHeader('{not json'), null);
  assert.equal(decodeTutorMetricTrackHeader('{"points":[]}'), null);
});

// ---------------------------------------------------------------------------
// THE REAL PATH — a coach turn, through the shipping runtime
// ---------------------------------------------------------------------------

test('the analyzer measures the EXACT audio VoxCPM produced', async () => {
  const audio = tutorPcm({ ms: 700 });
  const { ctx, analyzeCalls, logs, realFetch } = await setupTrackApp({ audio });
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.equal(turn.status, 200);

    const call = await waitFor(() => analyzeCalls[0]);
    assert.ok(call, 'the pre-synthesis handed the drained audio to the analyzer');
    // THE CROSSING: byte-for-byte the audio the phone is about to be sent.
    // Not a re-request, not a stub, not a placeholder.
    assert.equal(
      Buffer.from(call.pcm16Base64, 'base64').toString('hex'),
      audio.toString('hex'),
      'the analyzer received the synthesized bytes verbatim',
    );
    // And at the rate the audio DECLARED, not a compiled-in guess.
    assert.equal(call.sampleRate, 48000);
    assert.equal(call.targetPreset, 'cute-feminine');

    const witness = await waitFor(() => logs.find((event) => event?.event === 'tutor_metric_track'));
    assert.ok(witness, 'the measurement is witnessed');
    assert.equal(witness.outcome, 'measured');
    assert.ok(witness.points >= 2);
    assert.ok(witness.mean_pitch_hz > 0);
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});

test('a CHUNK-STREAMED body is reassembled before it is measured', async () => {
  const audio = tutorPcm({ ms: 700 });
  const { ctx, analyzeCalls, realFetch } = await setupTrackApp({ audio, streamOnly: true });
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.equal(turn.status, 200);

    const call = await waitFor(() => analyzeCalls[0]);
    assert.ok(call, 'a reader-only body still reaches the analyzer');
    // Every chunk, in order — a partial or reordered reassembly would measure
    // audio the learner never hears.
    assert.equal(
      Buffer.from(call.pcm16Base64, 'base64').toString('hex'),
      audio.toString('hex'),
      'the streamed chunks were reassembled verbatim',
    );
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});

test('the speech response CARRIES the tutor track for the line it is speaking', async () => {
  const { ctx, analyzeCalls, realFetch } = await setupTrackApp();
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    const reply = turn.body.message;
    assert.ok(reply);
    await waitFor(() => analyzeCalls.length > 0);

    const speech = await httpPostRaw(`${ctx.baseUrl}/voice/speech/generate`, {
      sessionId,
      targetText: reply,
    });
    assert.equal(speech.status, 200);
    assert.ok(speech.buffer.length > 0, 'the audio is intact');

    const header = speech.headers.get('X-Tutor-Metric-Track');
    assert.ok(header, 'the spoken line carries its measured travel');
    const track = decodeTutorMetricTrackHeader(header);
    assert.ok(track.points.length >= 2, 'a travel, not a point');
    assert.ok(track.points.at(-1).pitchHz > track.points[0].pitchHz);
    assert.equal(track.analysisVersion, 'voice-metrics-v4-formants');
    assert.ok(track.meanPitchHz > 0);
    assert.ok(track.resonance >= 0 && track.resonance <= 1);
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});

test('a real reply out-ranks template prewarm after the single worker returns busy', async () => {
  const templateAudio = tutorPcm({ ms: 250 });
  const replyAudio = tutorPcm();
  let workerBusy = true;
  let releaseTemplate = null;
  const successfulTexts = [];
  const audioResponse = (pcm) => {
    const response = mockAudioResponse(200, pcm, { generationMode: 'cloned-synthesis' });
    response.headers.set('X-Audio-Sample-Rate', '48000');
    response.headers.set('X-Audio-Format', 'pcm_s16le');
    return response;
  };
  const generateBehavior = ({ body, call }) => {
    if (call === 1) {
      return new Promise((resolve) => {
        releaseTemplate = () => {
          if (!workerBusy) return;
          workerBusy = false;
          successfulTexts.push(body.target_text);
          resolve(audioResponse(templateAudio));
        };
      });
    }
    if (workerBusy) {
      return mockAudioResponse(429, Buffer.from('busy'), { generationMode: 'cloned-synthesis' });
    }
    successfulTexts.push(body.target_text);
    return audioResponse(replyAudio);
  };

  const { ctx, analyzeCalls, logs, realFetch } = await setupTrackApp({
    audio: replyAudio,
    generateBehavior,
    templatePrewarmEnabled: true,
    templatePrewarmPaceMs: 1000,
  });
  try {
    const sessionId = await startReferencedSession(ctx);
    assert.ok(await waitFor(() => releaseTemplate), 'the first low-priority template owns the worker');

    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.equal(turn.status, 200);
    const reply = turn.body.message;
    assert.ok(reply);
    assert.equal(workerBusy, true, 'the coach-text response never waits for pre-synthesis admission');

    const retry = await waitFor(() => logs.find((event) => (
      event?.event === 'tts_presynth_admission'
      && event?.reason === 'coach_reply_buffered'
    )));
    assert.deepEqual(
      {
        component: retry?.component,
        seam: retry?.seam,
        line: retry?.line,
        class: retry?.class,
        outcome: retry?.outcome,
        attempt: retry?.attempt,
      },
      {
        component: 'voice-tutor-standalone',
        seam: 'voxcpm-generate',
        line: 'presynthesizeCoachReply',
        class: 'partial-function',
        outcome: 'busy_retry',
        attempt: 1,
      },
      'the exact admission witness fires before trusting the retry',
    );

    releaseTemplate();
    releaseTemplate = null;
    const primed = await waitFor(() => logs.find((event) => (
      event?.event === 'tts_presynth'
      && event?.reason === 'coach_reply_buffered'
      && event?.outcome === 'primed'
    )));
    assert.ok(primed?.drained_bytes > 0, 'the retried real reply drains its exact audio');
    const measured = await waitFor(() => logs.find((event) => (
      event?.event === 'tutor_metric_track'
      && event?.reason === 'coach_reply_buffered'
      && event?.outcome === 'measured'
    )));
    assert.ok(measured?.points >= 2, 'the retried reply is measured and cached');
    assert.ok(
      analyzeCalls.some((call) => Buffer.from(call.pcm16Base64 || '', 'base64').equals(replyAudio)),
      'the analyzer receives the exact retried reply PCM, not the template PCM',
    );
    assert.equal(successfulTexts[1], reply, 'no second template reacquires ahead of the real reply');

    const speech = await httpPostRaw(`${ctx.baseUrl}/voice/speech/generate`, {
      sessionId,
      targetText: reply,
    });
    assert.equal(speech.status, 200);
    assert.ok(speech.buffer.equals(replyAudio), 'the speech route still returns the exact reply PCM');
    const header = speech.headers.get('X-Tutor-Metric-Track');
    assert.ok(header, 'the later speech lookup publishes the retried reply track');
    const track = decodeTutorMetricTrackHeader(header);
    assert.ok(track?.points?.length >= 2, 'the published retry track carries a real travel');
  } finally {
    releaseTemplate?.();
    await teardownTrackApp(ctx, realFetch);
  }
});

test('the browser is allowed to READ the track header (the crossing, not just the send)', async () => {
  const { ctx, realFetch } = await setupTrackApp();
  try {
    const response = await serverFetch(`${ctx.baseUrl}/voice/speech/generate`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'http://example.test',
        'Access-Control-Request-Method': 'POST',
      },
    });
    const exposed = (response.headers.get('access-control-expose-headers') || '').toLowerCase();
    assert.ok(
      exposed.includes('x-tutor-metric-track'),
      `the track header must be exposed cross-origin; got: ${exposed}`,
    );
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});

test('a repeated line costs nothing — one measurement, reused', async () => {
  const { ctx, analyzeCalls, realFetch } = await setupTrackApp();
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    const reply = turn.body.message;
    await waitFor(() => analyzeCalls.length > 0);
    const afterFirst = analyzeCalls.length;

    // Speak the same line twice more.
    const first = await httpPostRaw(`${ctx.baseUrl}/voice/speech/generate`, { sessionId, targetText: reply });
    const second = await httpPostRaw(`${ctx.baseUrl}/voice/speech/generate`, { sessionId, targetText: reply });
    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.ok(first.headers.get('X-Tutor-Metric-Track'));
    assert.equal(
      first.headers.get('X-Tutor-Metric-Track'),
      second.headers.get('X-Tutor-Metric-Track'),
      'the same line yields the same shape',
    );
    // Give any stray analysis a chance to appear before asserting it did not.
    await new Promise((resolve) => setTimeout(resolve, 120));
    assert.equal(analyzeCalls.length, afterFirst, 'the repeat was a cache hit, not a re-analysis');
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});

// ---------------------------------------------------------------------------
// FAIL SOFT — the tutor must always speak
// ---------------------------------------------------------------------------

test('the analyzer being DOWN never silences the tutor', async () => {
  const { ctx, analyzeCalls, logs, realFetch } = await setupTrackApp({
    analyzeBehavior: async () => mockJsonResponse(503, { error: 'analyzer offline' }),
  });
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.equal(turn.status, 200, 'the coach turn still succeeds');
    const reply = turn.body.message;
    assert.ok(reply, 'the tutor still has something to say');
    await waitFor(() => analyzeCalls.length > 0);

    const speech = await httpPostRaw(`${ctx.baseUrl}/voice/speech/generate`, { sessionId, targetText: reply });
    assert.equal(speech.status, 200, 'the tutor still SPEAKS');
    assert.ok(speech.buffer.length > 0, 'the audio is whole');
    assert.equal(speech.headers.get('X-Tutor-Metric-Track'), null, 'the graph simply misses this turn');

    const witness = await waitFor(() => logs.find((event) => (
      event?.event === 'tutor_metric_track' && event?.outcome === 'error'
    )));
    assert.ok(witness, 'the miss is named, not silent');
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});

test('an UNUSABLE reading is refused, and the tutor still speaks', async () => {
  const { ctx, analyzeCalls, logs, realFetch } = await setupTrackApp({
    analyzeBehavior: async () => mockJsonResponse(200, analyzerResponse({ usable: false })),
  });
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    const reply = turn.body.message;
    await waitFor(() => analyzeCalls.length > 0);

    const speech = await httpPostRaw(`${ctx.baseUrl}/voice/speech/generate`, { sessionId, targetText: reply });
    assert.equal(speech.status, 200);
    assert.ok(speech.buffer.length > 0);
    assert.equal(speech.headers.get('X-Tutor-Metric-Track'), null);

    const witness = await waitFor(() => logs.find((event) => (
      event?.event === 'tutor_metric_track' && event?.outcome === 'unusable'
    )));
    assert.ok(witness, 'refusing to trust a reading is witnessed as such');
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});

test('a HANGING analyzer never delays the reply or the speech', async () => {
  let released;
  const gate = new Promise((resolve) => { released = resolve; });
  const { ctx, analyzeCalls, realFetch } = await setupTrackApp({
    analyzeBehavior: async () => {
      await gate;
      return mockJsonResponse(200, analyzerResponse());
    },
  });
  try {
    const sessionId = await startReferencedSession(ctx);

    const replyStart = Date.now();
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    const replyMs = Date.now() - replyStart;
    assert.equal(turn.status, 200);
    const reply = turn.body.message;
    await waitFor(() => analyzeCalls.length > 0);

    const speechStart = Date.now();
    let speech;
    try {
      speech = await httpPostRaw(
        `${ctx.baseUrl}/voice/speech/generate`,
        { sessionId, targetText: reply },
        { timeoutMs: 3000 },
      );
    } catch (error) {
      assert.fail(
        `the speech route BLOCKED on the stuck analysis — the latency law is broken (${error?.message || error})`,
      );
    }
    const speechMs = Date.now() - speechStart;
    assert.equal(speech.status, 200, 'the tutor speaks while the analyzer is still stuck');
    assert.ok(speech.buffer.length > 0);
    assert.equal(speech.headers.get('X-Tutor-Metric-Track'), null, 'no shape yet, so no header');

    // Neither path waited on the stuck analysis. Generous bounds: the point is
    // "did not block on a promise that never settled", not a benchmark.
    assert.ok(replyMs < 3000, `the reply must not wait on the analysis (took ${replyMs}ms)`);
    assert.ok(speechMs < 3000, `the speech must not wait on the analysis (took ${speechMs}ms)`);
  } finally {
    released();
    await teardownTrackApp(ctx, realFetch);
  }
});

test('the feature can be switched OFF entirely, and nothing else changes', async () => {
  const { ctx, analyzeCalls, realFetch } = await setupTrackApp({ enabled: false });
  try {
    const sessionId = await startReferencedSession(ctx);
    const turn = await httpPost(`${ctx.baseUrl}/voice/coach/runtime`, {
      sessionId,
      message: 'How was that?',
    });
    assert.equal(turn.status, 200);
    const reply = turn.body.message;

    const speech = await httpPostRaw(`${ctx.baseUrl}/voice/speech/generate`, { sessionId, targetText: reply });
    assert.equal(speech.status, 200);
    assert.ok(speech.buffer.length > 0);
    assert.equal(speech.headers.get('X-Tutor-Metric-Track'), null);

    await new Promise((resolve) => setTimeout(resolve, 150));
    assert.equal(analyzeCalls.length, 0, 'the analyzer is never called when the flag is off');
  } finally {
    await teardownTrackApp(ctx, realFetch);
  }
});
