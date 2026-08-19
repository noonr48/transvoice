'use strict';

// Gateway-level proof for the word-emphasis channel: the shaped text must
// actually reach VoxCPM's `target_text`, the witness must report what it really
// did, and voice cloning must be provably untouched.
//
// The shaper's own rules live in voice-emphasis-shaping.test.js. This file only
// asks: does the speech endpoint WIRE it correctly?

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createVoiceStandaloneApp } = require('./voice-standalone-runtime');

const LINE = 'I think we can get this done today without any trouble.';
const REFERENCE_CLIP_ID = 'clip-emphasis-clone';
const REFERENCE_AUDIO_PATH = '/tmp/clip-emphasis-clone.wav';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Map([['content-type', 'application/json']]),
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function audioResponse(buffer, { cloned = false } = {}) {
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Map([
      ['content-type', 'audio/wav'],
      ['content-length', String(buffer.length)],
      ['X-Speaking-Rate-Applied', '0.76'],
      ['X-TTS-Generation-Mode', cloned ? 'cloned-synthesis' : 'profile-synthesis'],
      ['X-Reference-Audio-Role', cloned ? 'conditioning-only' : 'none'],
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
  };
}

/**
 * Boot the standalone app on an ephemeral port with VoxCPM "enabled" and a
 * captured upstream, POST one speech request, and hand back what the gateway
 * sent to the TTS engine plus every witness line it logged.
 *
 * `withReference: true` also opens a session, marks a cloneable reference on
 * it, and lets the DSP + download mocks resolve — so the clone gate is really
 * entered rather than skipped.
 */
async function speakThroughGateway(requestBody, { withReference = false } = {}) {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-emphasis-test-'));
  const witnesses = [];
  const realFetch = global.fetch;
  let upstreamBody = null;

  global.fetch = async function patchedFetch(url, options) {
    const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
    if (urlStr.includes('/generate')) {
      upstreamBody = JSON.parse(options?.body || '{}');
      return audioResponse(Buffer.from(`RIFF${' '.repeat(64)}`), { cloned: withReference });
    }
    if (urlStr.includes('/v1/reference-audio/download')) {
      return jsonResponse(200, { path: REFERENCE_AUDIO_PATH });
    }
    if (urlStr.includes(`/api/v1/voice/reference/${REFERENCE_CLIP_ID}`)) {
      return jsonResponse(200, {
        clipId: REFERENCE_CLIP_ID,
        filename: `${REFERENCE_CLIP_ID}.wav`,
        durationMs: 6400,
        targetPreset: 'cute-feminine',
        metrics: { advanced: { measurementAvailable: true } },
        timeline: [],
        quality: { verdict: 'good', cloneable: true },
      });
    }
    return realFetch(url, options);
  };

  const { app, runtime } = createVoiceStandaloneApp({
    stateRoot,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    disableSessionPersistence: true,
    logger: { log: (entry) => witnesses.push(entry) },
    env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
  });

  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.on('error', reject);
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const payload = { ...requestBody };
    if (withReference) {
      const started = await realFetch(`${baseUrl}/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const { sessionId } = await started.json();
      // Compatibility-only raw reference session: the shortest real route into
      // the clone gate at proxyVoiceSpeechGenerate.
      runtime.sessions.get(sessionId).voiceState.referenceClipId = REFERENCE_CLIP_ID;
      payload.sessionId = sessionId;
    }

    const response = await realFetch(`${baseUrl}/voice/speech/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    await response.arrayBuffer();
    return {
      status: response.status,
      cloned: response.headers.get('X-Voice-Cloned'),
      upstreamBody,
      emphasisWitnesses: witnesses.filter((entry) => entry?.event === 'tts_emphasis'),
    };
  } finally {
    global.fetch = realFetch;
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
}

describe('TTS word-emphasis channel (gateway)', () => {
  it('shapes target_text into a comma clause around the emphasized word', async () => {
    const result = await speakThroughGateway({
      targetText: LINE,
      emphasisWord: 'today',
      emphasisOccurrence: 0,
    });

    assert.equal(result.status, 200);
    assert.equal(
      result.upstreamBody.target_text,
      'I think we can get this done, today, without any trouble.',
    );
    // Same words, same order: commas are the only difference.
    assert.equal(result.upstreamBody.target_text.replace(/,/g, ''), LINE.replace(/,/g, ''));
    assert.ok(!/[<>*_]/.test(result.upstreamBody.target_text), 'never SSML or markdown');
  });

  it('emits the witness with requested / matched / shaped whenever an emphasis word is asked for', async () => {
    const result = await speakThroughGateway({
      targetText: LINE,
      emphasisWord: 'today',
      emphasisOccurrence: 0,
      emphasisCardTokenIndex: 7,
    });

    assert.equal(result.emphasisWitnesses.length, 1);
    const witness = result.emphasisWitnesses[0];
    assert.equal(witness.event, 'tts_emphasis');
    assert.equal(witness.requested, 'today');
    assert.equal(witness.matched, true);
    assert.equal(witness.shaped, true);
    assert.equal(witness.selector, 'occurrence');
    assert.equal(witness.occurrence_used, 0);
    assert.equal(witness.occurrence_count, 1);
    // The card index is traceability metadata, never a selector.
    assert.equal(witness.card_token_index, 7);
    assert.equal(witness.token_index_requested, null);
  });

  it('a CARD token index is never used as a selector', async () => {
    // The card's coordinate system is not the sent text's. Even a card index
    // that would pick a different word must not move the comma.
    const line = 'I can do that today and finish it today.';
    const result = await speakThroughGateway({
      targetText: line,
      emphasisWord: 'today',
      emphasisOccurrence: 0,
      emphasisCardTokenIndex: 8,
    });

    assert.equal(result.upstreamBody.target_text, 'I can do that, today, and finish it today.');
    assert.equal(result.emphasisWitnesses[0].occurrence_used, 0);
    assert.equal(result.emphasisWitnesses[0].card_token_index, 8);
  });

  it('passes the text through unchanged and witnesses matched:false when the word is absent', async () => {
    const result = await speakThroughGateway({
      targetText: LINE,
      emphasisWord: 'tomorrow',
    });

    assert.equal(result.upstreamBody.target_text, LINE);
    assert.equal(result.emphasisWitnesses.length, 1);
    assert.equal(result.emphasisWitnesses[0].requested, 'tomorrow');
    assert.equal(result.emphasisWitnesses[0].matched, false);
    assert.equal(result.emphasisWitnesses[0].shaped, false);
  });

  it('picks the occurrence the caller named when the word repeats', async () => {
    const line = 'I can do that today and finish it today.';
    const result = await speakThroughGateway({
      targetText: line,
      emphasisWord: 'today',
      emphasisOccurrence: 1,
    });

    assert.equal(result.upstreamBody.target_text, 'I can do that today and finish it, today.');
    assert.equal(result.emphasisWitnesses[0].occurrence_used, 1);
    assert.equal(result.emphasisWitnesses[0].selector, 'occurrence');
  });

  it('REGRESSION: an announcement prefix cannot steal the emphasis', async () => {
    // The live eyes-free demo speaks "New line: <phrase>." — "line" is in the
    // prefix too. The occurrence selector is what keeps the comma off it.
    const result = await speakThroughGateway({
      targetText: 'New line: Hold the line. Keep it light.',
      emphasisWord: 'line',
      emphasisOccurrence: 1,
    });

    assert.equal(result.upstreamBody.target_text, 'New line: Hold the, line. Keep it light.');
    assert.ok(!result.upstreamBody.target_text.startsWith('New,'));
  });

  it('REGRESSION: junk index values never coerce into "the first token"', async () => {
    const line = 'I can do that today and finish it today.';
    const result = await speakThroughGateway({
      targetText: line,
      emphasisWord: 'today',
      emphasisOccurrence: null,
      emphasisTokenIndex: '',
    });

    assert.equal(result.emphasisWitnesses[0].occurrence_requested, null);
    assert.equal(result.emphasisWitnesses[0].token_index_requested, null);
    assert.equal(result.emphasisWitnesses[0].selector, 'first');
  });

  it('leaves the request completely unchanged when no emphasis word is sent', async () => {
    const result = await speakThroughGateway({ targetText: LINE });

    assert.equal(result.upstreamBody.target_text, LINE);
    assert.equal(result.emphasisWitnesses.length, 0, 'no emphasis asked for -> no witness');
    assert.deepEqual(Object.keys(result.upstreamBody).sort(), ['speakingRate', 'target_text']);
  });

  it('CLONING: a resolved reference still rides alongside shaped text', async () => {
    const result = await speakThroughGateway(
      { targetText: LINE, emphasisWord: 'today', emphasisOccurrence: 0 },
      { withReference: true },
    );

    assert.equal(result.status, 200);
    assert.equal(result.cloned, 'true', 'the clone gate must actually have been entered');
    assert.equal(
      result.upstreamBody.reference_audio_path,
      REFERENCE_AUDIO_PATH,
      'emphasis shaping must not disturb reference resolution',
    );
    assert.equal(
      result.upstreamBody.target_text,
      'I think we can get this done, today, without any trouble.',
      'the cloned request carries the shaped text',
    );
    assert.deepEqual(
      Object.keys(result.upstreamBody).sort(),
      ['reference_audio_path', 'speakingRate', 'target_text'],
      'the upstream body gains no new keys',
    );
  });

  it('CLONING: the reference resolves identically with no emphasis at all', async () => {
    const result = await speakThroughGateway({ targetText: LINE }, { withReference: true });

    assert.equal(result.cloned, 'true');
    assert.equal(result.upstreamBody.reference_audio_path, REFERENCE_AUDIO_PATH);
    assert.equal(result.upstreamBody.target_text, LINE);
  });
});
