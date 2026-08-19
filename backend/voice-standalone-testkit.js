'use strict';

// Shared integration-test harness, extracted 2026-07-29 from
// voice-standalone-integration.test.js so sibling suites can drive the same
// in-process app WITHOUT importing a test file (requiring a .test.js module
// re-runs its whole suite). The functions here are verbatim moves.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createVoiceStandaloneApp } = require('./voice-standalone-runtime');

const CURRENT_TEST_ANALYSIS_VERSION = 'voice-metrics-v3-yin';

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

async function beforeTimeout(promise, label, timeoutMs = 2000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function waitForCondition(predicate, label, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for ${label}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function buildMockFetchImpl(overrides = {}) {
  const defaultVoiceTrainerHealth = { status: 'ok' };
  const defaultVoiceTrainerSessionStart = {
    voiceSessionId: 'mock-vt-session-1',
    status: 'ready',
    targetPreset: 'cute-feminine',
    targetSource: 'built-in',
    referenceClipId: null,
    targetProfileId: null,
    streamUrl: '/api/v1/voice/sessions/mock-vt-session-1/stream',
    createdAt: Date.now(),
  };
  const defaultVoiceTrainerSessionEnd = { status: 'ended' };
  const defaultVoiceTrainerPresets = { presets: [] };
  const defaultVoiceTrainerForecast = { forecast: 'mock-forecast' };
  const defaultGgufModels = { data: [{ id: 'voice-tutor-gemma4-r128-clean-s070-iq4nl-attnq8-last10-gguf' }] };
  const defaultGgufChat = {
    choices: [{ message: { content: 'Great job! Keep your resonance bright and forward.' } }],
    usage: { total_tokens: 120 },
  };
  const defaultVoxcpmHealth = { ok: true, model_loaded: true };
  const defaultVoxcpmGenerate = Buffer.from('RIFF' + '\x00'.repeat(100)); // fake WAV

  return async function mockFetchImpl(url, options = {}) {
    const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';

    // Allow per-URL overrides
    for (const [pattern, handler] of Object.entries(overrides)) {
      if (urlStr.includes(pattern)) {
        return handler(url, options);
      }
    }

    // VoxCPM health must be resolved before the generic VoiceTrainer /health.
    if (urlStr.includes('/health') && urlStr.includes('8020')) {
      return mockJsonResponse(200, defaultVoxcpmHealth);
    }

    // VoiceTrainer endpoints
    if (urlStr.includes('/health')) {
      return mockJsonResponse(200, defaultVoiceTrainerHealth);
    }
    if (urlStr.includes('/api/v1/voice/sessions/start')) {
      return mockJsonResponse(200, defaultVoiceTrainerSessionStart);
    }
    if (urlStr.includes('/api/v1/voice/sessions/') && urlStr.includes('/end')) {
      return mockJsonResponse(200, defaultVoiceTrainerSessionEnd);
    }
    if (urlStr.includes('/api/v1/voice/sessions/') && urlStr.includes('/take')) {
      return mockJsonResponse(200, { status: 'ready', summary: null });
    }
    if (urlStr.includes('/api/v1/voice/presets')) {
      return mockJsonResponse(200, defaultVoiceTrainerPresets);
    }
    if (urlStr.includes('/api/v1/voice/target/profile')) {
      const body = JSON.parse(options.body || '{}');
      return mockJsonResponse(200, {
        profileId: `reference-profile-${body.clipId}`,
        clipId: body.clipId,
        analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
        sourceFilename: `${body.clipId}.wav`,
        durationMs: 6400,
        targetPreset: body.targetPreset || 'cute-feminine',
        metrics: {
          meanPitchHz: 207.25,
          pitchRangeSt: 4.6,
          resonanceMean: 0.635,
          weightMean: 0.315,
          targetHitPct: 1,
          similarityScore: 1,
        },
        pitchFloorHz: 181.25,
        pitchCeilingHz: 236.75,
        resonanceFloor: 0.57,
        resonanceCeiling: 0.7,
        weightFloor: 0.25,
        weightCeiling: 0.38,
        stylePrompt: 'Reference-derived exact target',
        notes: [],
      });
    }
    if (urlStr.includes('/api/v1/voice/target/forecast')) {
      return mockJsonResponse(200, defaultVoiceTrainerForecast);
    }
    if (urlStr.includes('/api/v1/voice/reference/')) {
      const clipId = decodeURIComponent(urlStr.split('/api/v1/voice/reference/')[1].split(/[/?#]/)[0]);
      return mockJsonResponse(200, {
        clipId,
        analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
        filename: `${clipId}.wav`,
        durationMs: 6400,
        targetPreset: 'cute-feminine',
        metrics: { advanced: { measurementAvailable: true } },
        timeline: [],
        quality: { verdict: 'good', cloneable: true },
      });
    }

    // GGUF model endpoints
    if (urlStr.includes('/v1/models')) {
      return mockJsonResponse(200, defaultGgufModels);
    }
    if (urlStr.includes('/v1/chat/completions')) {
      // Check if streaming is requested
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch {}
      if (body.stream) {
        return mockStreamingResponse(defaultGgufChat.choices[0].message.content);
      }
      return mockJsonResponse(200, defaultGgufChat);
    }

    // VoxCPM endpoints
    if (urlStr.includes('/generate')) {
      return mockAudioResponse(200, defaultVoxcpmGenerate);
    }
    if (urlStr.includes('/v1/reference-audio/download')) {
      return mockJsonResponse(200, { path: '/tmp/mock-ref.wav' });
    }

    // Default: 404
    return mockJsonResponse(404, { error: 'Not found' });
  };
}

function mockJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Map([['content-type', 'application/json']]),
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function mockAudioResponse(status, buffer, options = {}) {
  const generationMode = options.generationMode || 'profile-synthesis';
  const referenceAudioRole = generationMode === 'cloned-synthesis'
    ? 'conditioning-only'
    : 'none';
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Map([
      ['content-type', 'audio/wav'],
      ['content-length', String(buffer.length)],
      ['X-Speaking-Rate-Applied', String(options.speakingRate || 0.76)],
      ['X-TTS-Generation-Mode', generationMode],
      ['X-Reference-Audio-Role', referenceAudioRole],
    ]),
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (!sent) {
              sent = true;
              return { done: false, value: buffer };
            }
            return { done: true };
          },
          releaseLock() {},
        };
      },
    },
    async text() { return ''; },
    async json() { return {}; },
    async arrayBuffer() { return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength); },
  };
}

function mockStreamingResponse(content) {
  const chunks = content.split(' ');
  let index = 0;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    pull(controller) {
      if (index < chunks.length) {
        const sseLine = `data: ${JSON.stringify({ choices: [{ delta: { content: chunks[index] + ' ' } }] })}\n\n`;
        controller.enqueue(encoder.encode(sseLine));
        index++;
      } else {
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      }
    },
  });

  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([['content-type', 'text/event-stream']]),
    body: stream,
    async text() { return ''; },
    async json() { return {}; },
  };
}

function startTestApp(options = {}) {
  return new Promise((resolve, reject) => {
    const ownsStateRoot = !options.stateRoot;
    const stateRoot = options.stateRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'tv-standalone-test-'));
    const isolatedOptions = {
      ...options,
      stateRoot,
      learnerContextRoot: options.learnerContextRoot || path.join(stateRoot, 'learner-context'),
    };
    try {
      const standalone = createVoiceStandaloneApp(isolatedOptions);
      const { app, runtime } = standalone;
      const server = app.listen(0, '127.0.0.1', () => {
        const addr = server.address();
        const baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve({ server, baseUrl, runtime, app, ownedStateRoot: ownsStateRoot ? stateRoot : null });
      });
      server.on('error', (error) => {
        if (ownsStateRoot) fs.rmSync(stateRoot, { recursive: true, force: true });
        reject(error);
      });
    } catch (err) {
      if (ownsStateRoot) fs.rmSync(stateRoot, { recursive: true, force: true });
      reject(err);
    }
  });
}

function stopTestApp(ctx) {
  if (!ctx?.server) return Promise.resolve();
  const closePromise = new Promise((resolve, reject) => {
    ctx.server.close((error) => (error ? reject(error) : resolve()));
  });
  const closeConnections = setTimeout(() => ctx.server.closeAllConnections?.(), 500);
  return beforeTimeout(closePromise, 'test server shutdown', 2000)
    .finally(() => {
      clearTimeout(closeConnections);
      if (ctx.ownedStateRoot) {
        fs.rmSync(ctx.ownedStateRoot, { recursive: true, force: true });
      }
    });
}

async function httpGet(baseUrl, path) {
  const resp = await fetch(`${baseUrl}${path}`);
  const body = await resp.json().catch(() => null);
  return { status: resp.status, body, headers: resp.headers };
}

async function httpPost(baseUrl, path, data) {
  const resp = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  const contentType = resp.headers.get('content-type') || '';
  let body;
  if (contentType.includes('application/json')) {
    body = await resp.json().catch(() => null);
  } else {
    body = await resp.text();
  }
  return { status: resp.status, body, headers: resp.headers };
}

async function httpDelete(baseUrl, path) {
  const resp = await fetch(`${baseUrl}${path}`, { method: 'DELETE' });
  const body = await resp.json().catch(() => null);
  return { status: resp.status, body, headers: resp.headers };
}

async function httpRawPost(baseUrl, path, rawBody, contentType = 'application/json') {
  const resp = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: rawBody,
  });
  const text = await resp.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  return { status: resp.status, body, headers: resp.headers };
}

module.exports = {
  CURRENT_TEST_ANALYSIS_VERSION,
  createDeferred,
  beforeTimeout,
  waitForCondition,
  buildMockFetchImpl,
  mockJsonResponse,
  mockAudioResponse,
  mockStreamingResponse,
  startTestApp,
  stopTestApp,
  httpGet,
  httpPost,
  httpDelete,
  httpRawPost,
};
