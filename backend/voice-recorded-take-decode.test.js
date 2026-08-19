'use strict';

/* ===========================================================================
 * THE SECOND WORDLESS-AUDIO GAP — the RECORDED coach path (2026-07-27)
 *
 * The first repair gave the STREAMING path a first-class turn trigger, so a
 * wordless-but-voiced live take stopped being eaten by the ASR. It landed on
 * one branch only.
 *
 * MEASURED against the working tree (4f98044 plus the unstaged take-witness
 * work; the `no_pcm_segment` witness quoted below does NOT exist at 4f98044
 * itself, where that guard is a silent `return null`), driving
 * `submitVoiceInputTurn` exactly the way `voice-runtime-entrypoints.js:320`
 * drives it — `submitVoiceInputTurn(req.body)`, with NO `internal` argument —
 * and handing it a real 2s voiced ogg/opus payload:
 *
 *     analyzer take requests dispatched -> 0
 *     coach_take witness  -> {outcome:'skipped', reason:'no_pcm_segment'}
 *     turn trigger        -> 'silent'
 *
 * The recorded branch never supplied PCM, so `beginCoachTakeAnalysis` skipped on
 * every single turn and `voiced_evidence` was STRUCTURALLY UNREACHABLE there.
 * Words and voicing were peers in the resolver, but only words were ever
 * gathered. This suite is the guard on the other half of that peerage.
 *
 * A NOTE ON WHAT WAS *NOT* WRONG, because it was reported as wrong and the
 * measurement says otherwise: the recorded branch did NOT answer a wordless take
 * with a 400. The wordless branch added by the first repair sits INSIDE the
 * `captureProvider === 'backend'` block, so a wordless recorded take already
 * returned a 200 no-speech payload. The 400 is, and remains, the malformed-caller
 * gate. Both facts are pinned below so neither can silently drift.
 * ======================================================================== */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');
const { encodePcm16Wav } = require('./voice-input-live');
const {
  decodeRecordedAudioToPcm16,
  decodeWavPcm16Mono,
  resetFfmpegPathCache,
  resolveFfmpegPath,
  resolveRecordedTakeDecodePlan,
} = require('./voice-input-asr');

const HAS_FFMPEG = (() => {
  resetFfmpegPathCache();
  const found = resolveFfmpegPath();
  resetFfmpegPathCache();
  return Boolean(found);
})();

/* ---------------------------------------------------------------- fixtures */

/** 16 kHz mono PCM16 that a pitch tracker reads as voiced. */
function pcm(ms, amplitude = 9000, rate = 16000) {
  const samples = Math.round((rate * ms) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
  }
  return buffer;
}

/** A WAV at an arbitrary rate/channel count, so the inline parser can be steered. */
function wav(pcmBody, { sampleRate = 16000, channels = 1, bitsPerSample = 16, audioFormat = 1 } = {}) {
  const header = Buffer.alloc(44);
  const blockAlign = (channels * bitsPerSample) / 8;
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBody.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(audioFormat, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBody.length, 40);
  return Buffer.concat([header, pcmBody]);
}

/** Encode PCM into a real ogg/opus container, the way the browser does. */
function oggFromPcm(pcmBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-ogg-'));
  const source = path.join(dir, 'in.wav');
  const target = path.join(dir, 'out.ogg');
  fs.writeFileSync(source, wav(pcmBody));
  const run = spawnSync(resolveFfmpegPath(), ['-hide_banner', '-loglevel', 'error', '-i', source, '-ac', '1', '-c:a', 'libopus', '-f', 'ogg', target, '-y']);
  const encoded = run.status === 0 && fs.existsSync(target) ? fs.readFileSync(target) : null;
  fs.rmSync(dir, { recursive: true, force: true });
  return encoded;
}

/** An fs stub in which no ffmpeg exists anywhere on PATH. */
const NO_FFMPEG_FS = {
  constants: fs.constants,
  accessSync() { throw new Error('ENOENT'); },
};

/* ------------------------------------------------- runtime harness (mocked) */

const VOICE_SESSION_ID = 'mock-vt-session-1';
const TAKE_ONESHOT_PATH = `/api/v1/voice/sessions/${VOICE_SESSION_ID}/take-oneshot`;
const TARGET = Object.freeze({
  source: 'preset', targetPreset: 'cute-feminine', targetProfileId: null, direction: 'feminine',
  pitchFloorHz: 188, pitchCeilingHz: 255, resonanceFloor: 0.32, resonanceCeiling: 1,
  weightFloor: 0, weightCeiling: 0.4, minTargetHitPct: 0.28, pitchPlacement: 'below',
});

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

/**
 * Take metrics shaped like the live analyzer's. `voicedFramePct` 0 with a
 * 'no_voiced_frames' rejection is what the REAL analyzer returned for digital
 * silence in the 2026-07-27 acceptance run; 0.92/120 is what it returned for a
 * 3s harmonic hum (voicedFramePct 1, pitchValidFrameCount 293).
 */
function takeMetrics(voicedFramePct, pitchValidFrameCount) {
  const measurable = voicedFramePct > 0;
  return {
    meanPitchHz: 205, pitchRangeSt: 5, resonanceMean: 0.62, weightMean: 0.38,
    targetHitPct: 0.81, similarityScore: 0.74,
    advanced: {
      measurementAvailable: measurable,
      measurementRejectionReasons: measurable ? [] : ['no_voiced_frames'],
      voicedFramePct,
      confidentFramePct: 0.9,
      scoreConfidence: 0.82,
      captureReliability: 0.9,
      snrDb: 25,
      clippingPct: 0.001,
      pitchValidFrameCount,
      pitchP10Hz: 190,
      pitchTargetOccupancyPct: 80,
      quality: { strainRisk: 0.1, breathyRisk: 0.1 },
      reliabilityFlags: measurable ? [] : ['no_voiced_frames'],
      ...(measurable ? {} : { peakLoudnessDb: -100, meanLoudnessDb: -100 }),
    },
  };
}

function oneshotTakeResponse(requestBody, voicedFramePct, pitchValidFrameCount) {
  const metrics = takeMetrics(voicedFramePct, pitchValidFrameCount);
  return {
    voiceSessionId: VOICE_SESSION_ID,
    status: 'ready',
    streamUrl: `/api/v1/voice/sessions/${VOICE_SESSION_ID}/stream`,
    summary: {
      voiceSessionId: VOICE_SESSION_ID, durationMs: 2400, targetPreset: 'cute-feminine',
      metrics, target: { ...TARGET }, issues: [], nextDrills: [],
    },
    attemptArtifact: {
      attemptArtifactId: `${VOICE_SESSION_ID}-a`, clientAttemptId: null,
      voiceSessionId: VOICE_SESSION_ID, sloaneSessionId: requestBody.sloaneSessionId || null,
      targetPreset: 'cute-feminine', target: { ...TARGET }, referenceClipId: null,
      finalizedAt: Date.now(), metrics, reliabilityFlags: [],
      repContext: requestBody.takeKind ? { kind: requestBody.takeKind } : null,
      timeline: [{ t: 0, voiced: true, pitchHz: 205, pitchScore: 0.9, resonanceScore: 0.62, weightScore: 0.38, confidence: 0.9, loudnessDb: -20 }],
    },
  };
}

function buildHarness({
  voicedFramePct = 0.92,
  pitchValidFrameCount = 120,
  asrResult = { success: true, noSpeech: true, transcript: '', confidence: null, providerStyle: 'simple', transcriptSource: 'backend-asr' },
  ...overrides
} = {}) {
  const logLines = [];
  const witnesses = [];
  const takeRequests = [];
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-recorded-'));
  const fetchImpl = async (url, options = {}) => {
    const target = String(url);
    if (target.includes(TAKE_ONESHOT_PATH)) {
      const requestBody = JSON.parse(options.body || '{}');
      takeRequests.push(requestBody);
      return mockJsonResponse(200, oneshotTakeResponse(requestBody, voicedFramePct, pitchValidFrameCount));
    }
    if (target.includes('/api/v1/voice/sessions/start')) {
      return mockJsonResponse(200, {
        voiceSessionId: VOICE_SESSION_ID, status: 'ready', targetPreset: 'cute-feminine',
        targetSource: 'built-in', referenceClipId: null, targetProfileId: null,
        streamUrl: `/api/v1/voice/sessions/${VOICE_SESSION_ID}/stream`, createdAt: Date.now(),
      });
    }
    if (target.includes('/health')) return mockJsonResponse(200, { status: 'ok' });
    return mockJsonResponse(200, {});
  };
  const runtime = createVoiceStandaloneRuntime({
    fetchImpl,
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    voiceCoachTakeTimeoutMs: 4000,
    voiceCoachAnalyzerBindWaitMs: 4000,
    logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
    debugBus: { push: (level, category, message, metadata) => witnesses.push({ level, category, message, metadata }) },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, liveMode: 'buffered' }),
      transcribeAudio: async () => asrResult,
    },
    ...overrides,
  });
  return {
    runtime,
    logLines,
    witnesses,
    takeRequests,
    lines: (event) => logLines.filter((line) => line?.event === event),
    cleanup: () => { try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

async function armedSession(harness) {
  const started = await harness.runtime.appCompatibilityRouteHandlers.startSession({ sessionId: 'recorded-take-session', studentId: 'recorded-user' });
  const sessionId = started.sessionId || 'recorded-take-session';
  await harness.runtime.voiceOperationRouteHandlers.startVoiceSession({ sessionId, targetPreset: 'cute-feminine' });
  return sessionId;
}

/**
 * The RECORDED call shape, byte for byte how `voice-runtime-entrypoints.js:320`
 * calls it: one argument, no `internal`. Passing `internal` here would silently
 * make these tests exercise the streaming branch instead — the exact confusion
 * that let the gap survive the first repair.
 */
function submitRecordedTurn(harness, sessionId, audio, { mimeType = 'audio/ogg', audioFormat = 'ogg' } = {}) {
  return harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
    sessionId,
    requestedProvider: 'backend',
    captureProvider: 'backend',
    audioFormat,
    mimeType,
    filename: `voice-turn.${audioFormat}`,
    transcriptSource: 'backend-asr',
    audioBase64: audio.toString('base64'),
    capturedAt: Date.now(),
  });
}

/* ============================================================ the decoder */

describe('recorded audio -> PCM16 decode', () => {
  it('reads an already-16 kHz mono PCM16 WAV in-process, with no subprocess at all', async () => {
    const segment = pcm(400);
    const decoded = await decodeRecordedAudioToPcm16({
      audioBuffer: wav(segment),
      mimeType: 'audio/wav',
      // Proves the claim: a spawn here would throw, so reaching ok:true means
      // the inline path ran and ffmpeg was never invoked.
      spawnImpl: () => { throw new Error('ffmpeg must not be spawned for a 16 kHz mono WAV'); },
    });
    assert.equal(decoded.ok, true);
    assert.equal(decoded.via, 'wav_inline');
    assert.equal(decoded.bytesOut, segment.length);
    assert.equal(decoded.pcm.equals(segment), true, 'the decoded PCM must be the original samples');
  });

  it('refuses a WAV shape it cannot honestly read rather than mis-parsing it', () => {
    const body = pcm(200);
    assert.equal(decodeWavPcm16Mono(wav(body, { sampleRate: 44100 })), null, '44.1 kHz needs resampling');
    assert.equal(decodeWavPcm16Mono(wav(body, { channels: 2 })), null, 'stereo needs a mixdown');
    assert.equal(decodeWavPcm16Mono(wav(body, { bitsPerSample: 8 })), null, '8-bit is a different sample width');
    assert.equal(decodeWavPcm16Mono(wav(body, { audioFormat: 3 })), null, 'float WAV is not PCM16');
    assert.equal(decodeWavPcm16Mono(Buffer.from('not a riff at all padded out to length')), null);
  });

  it('keeps a truncated WAV usable instead of trusting a declared size that never arrived', () => {
    const body = pcm(200);
    const full = wav(body);
    // A recording cut off mid-write: the header still declares the full size.
    const truncated = full.subarray(0, 44 + 1000);
    const decoded = decodeWavPcm16Mono(truncated);
    assert.ok(decoded, 'a truncated WAV still has usable frames');
    assert.equal(decoded.length, 1000);
    assert.equal(decoded.length % 2, 0, 'the result must stay sample-aligned');
  });

  it('names the format when nothing here can decode it, and never guesses', async () => {
    const unsupported = await decodeRecordedAudioToPcm16({ audioBuffer: Buffer.from('xx'), mimeType: 'audio/aiff' });
    assert.equal(unsupported.ok, false);
    assert.equal(unsupported.reason, 'unsupported_mime_type');

    const noFfmpeg = await decodeRecordedAudioToPcm16({ audioBuffer: Buffer.from('xx'), mimeType: 'audio/webm', fsImpl: NO_FFMPEG_FS, env: { PATH: '/nowhere' } });
    assert.equal(noFfmpeg.ok, false);
    assert.equal(noFfmpeg.reason, 'ffmpeg_unavailable', 'a missing ffmpeg must be named, not conflated with silence');
    assert.equal(noFfmpeg.mimeType, 'audio/webm');

    const empty = await decodeRecordedAudioToPcm16({ audioBuffer: Buffer.alloc(0), mimeType: 'audio/ogg' });
    assert.equal(empty.ok, false);
    assert.equal(empty.reason, 'empty_audio');
  });

  it('resolves — never rejects — when the decoder cannot even be started', async () => {
    const result = await decodeRecordedAudioToPcm16({
      audioBuffer: Buffer.from('data'),
      mimeType: 'audio/ogg',
      ffmpegPath: '/usr/bin/ffmpeg',
      fsImpl: { constants: fs.constants, accessSync() { /* pretend it exists */ } },
      spawnImpl: () => { throw new Error('EACCES'); },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'decode_spawn_failed');
  });

  it('survives the fd-exhaustion spawn shape instead of taking the gateway down', async () => {
    // Node's `spawn` does NOT throw under EMFILE: it returns a child with
    // undefined stdio and emits 'error' asynchronously. Reproduced under
    // `ulimit -n 64` on node v26.1.0. Touching that stdio before attaching the
    // 'error' handler both rejected this promise and killed the process.
    const { EventEmitter } = require('node:events');
    const emfileChild = () => {
      const child = new EventEmitter();
      child.kill = () => {};
      // stdout/stdin/stderr deliberately absent, exactly as Node leaves them.
      setImmediate(() => child.emit('error', Object.assign(new Error('spawn /usr/bin/ffmpeg EMFILE'), { code: 'EMFILE' })));
      return child;
    };
    let unhandled = null;
    const onUnhandled = (reason) => { unhandled = reason; };
    process.on('unhandledRejection', onUnhandled);
    try {
      const result = await decodeRecordedAudioToPcm16({
        audioBuffer: Buffer.from('data'),
        mimeType: 'audio/ogg',
        ffmpegPath: '/usr/bin/ffmpeg',
        fsImpl: { constants: fs.constants, accessSync() {} },
        spawnImpl: emfileChild,
        timeoutMs: 2000,
      });
      assert.equal(result.ok, false, 'it must RESOLVE, not reject');
      assert.equal(result.reason, 'decode_spawn_failed');
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(unhandled, null, 'no unhandled rejection may escape');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('kills a decode that overruns its deadline instead of holding the turn open', async () => {
    const { EventEmitter } = require('node:events');
    let killed = false;
    const hungChild = () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = Object.assign(new EventEmitter(), { end() {}, write() {} });
      child.kill = () => { killed = true; };
      return child; // never emits 'close'
    };
    const result = await decodeRecordedAudioToPcm16({
      audioBuffer: Buffer.from('data'),
      mimeType: 'audio/ogg',
      ffmpegPath: '/usr/bin/ffmpeg',
      fsImpl: { constants: fs.constants, accessSync() {} },
      spawnImpl: hungChild,
      timeoutMs: 30,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'decode_timeout');
    assert.equal(killed, true, 'the overrunning decoder must be killed, not leaked');
  });

  it('plans the decode synchronously, so an undecodable turn never binds an analyzer session', () => {
    const noFfmpeg = resolveRecordedTakeDecodePlan('audio/webm', { fsImpl: NO_FFMPEG_FS, env: { PATH: '/nowhere' } });
    assert.equal(noFfmpeg.decodable, false);
    assert.equal(noFfmpeg.reason, 'ffmpeg_unavailable');
    // WAV stays decodable with no ffmpeg at all — that is the point of the fast path.
    const wavPlan = resolveRecordedTakeDecodePlan('audio/wav', { fsImpl: NO_FFMPEG_FS, env: { PATH: '/nowhere' } });
    assert.equal(wavPlan.decodable, true);
    assert.equal(wavPlan.via, 'wav_inline');
  });
});

describe('recorded audio -> PCM16 decode (real ffmpeg)', { skip: HAS_FFMPEG ? false : 'ffmpeg is not installed' }, () => {
  it('decodes a real ogg/opus container to 16 kHz mono PCM16', async () => {
    const encoded = oggFromPcm(pcm(1000));
    assert.ok(encoded && encoded.length > 0, 'the fixture encoder must produce an ogg');
    const decoded = await decodeRecordedAudioToPcm16({ audioBuffer: encoded, mimeType: 'audio/ogg', timeoutMs: 10000 });
    assert.equal(decoded.ok, true, `expected a decode, got ${decoded.reason}`);
    assert.equal(decoded.via, 'ffmpeg');
    assert.equal(decoded.bytesOut % 2, 0, 'PCM16 must be sample-aligned');
    // 1s at 16 kHz PCM16 is 32000 bytes; opus pads its edges, so allow a margin
    // rather than pinning a codec's framing.
    assert.ok(decoded.bytesOut >= 28000 && decoded.bytesOut <= 40000, `unexpected decoded length ${decoded.bytesOut}`);
  });

  it('sends a WAV it cannot read inline to ffmpeg rather than giving up on it', async () => {
    // 44.1 kHz stereo: the inline parser refuses it by design, ffmpeg resamples.
    const stereo = Buffer.alloc(44100 * 2 * 2);
    for (let i = 0; i < 44100; i += 1) {
      stereo.writeInt16LE(i % 2 ? 8000 : -8000, i * 4);
      stereo.writeInt16LE(i % 2 ? 8000 : -8000, i * 4 + 2);
    }
    const decoded = await decodeRecordedAudioToPcm16({
      audioBuffer: wav(stereo, { sampleRate: 44100, channels: 2 }),
      mimeType: 'audio/wav',
      timeoutMs: 10000,
    });
    assert.equal(decoded.ok, true, `expected a decode, got ${decoded.reason}`);
    assert.equal(decoded.via, 'ffmpeg');
    assert.ok(decoded.bytesOut > 30000 && decoded.bytesOut < 34000, `expected ~1s of 16 kHz mono, got ${decoded.bytesOut}`);
  });
});

/* ================================================ the recorded turn itself */

describe('the RECORDED coach turn earns a take', () => {
  it('a wordless-but-voiced recorded take is a TURN, on analyzer evidence, with no 400', async (t) => {
    if (!HAS_FFMPEG) return t.skip('ffmpeg is not installed');
    const harness = buildHarness({ voicedFramePct: 0.92, pitchValidFrameCount: 120 });
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitRecordedTurn(harness, sessionId, oggFromPcm(pcm(1200)));

      // THE FIX: 'voiced_evidence' was structurally unreachable here before.
      assert.equal(payload.inputTurn.turnTrigger, 'voiced_evidence');
      assert.equal(payload.inputTurn.voicedEvidence, true);
      assert.equal(payload.inputTurn.takeAnalyzed, true);

      // The take genuinely went out, carrying decoded PCM16 — not the container.
      assert.equal(harness.takeRequests.length, 1, 'the recorded branch must dispatch exactly one take');
      const sent = Buffer.from(harness.takeRequests[0].pcm16Base64, 'base64');
      assert.ok(sent.length > 0 && sent.length % 2 === 0, 'the analyzer must receive sample-aligned PCM16');
      assert.equal(sent.subarray(0, 4).toString('ascii'), sent.subarray(0, 4).toString('ascii'));
      assert.notEqual(sent.subarray(0, 4).toString('ascii'), 'OggS', 'the raw container must never reach the analyzer');

      const decodeLines = harness.lines('coach_take_decode');
      assert.equal(decodeLines.length, 1);
      assert.equal(decodeLines[0].outcome, 'decoded');
      assert.equal(decodeLines[0].via, 'ffmpeg');
      assert.equal(decodeLines[0].audio_type, 'audio/ogg');
      assert.ok(decodeLines[0].bytes_out > 0);

      const trigger = harness.lines('voice_turn_trigger');
      assert.equal(trigger.length, 1);
      assert.equal(trigger[0].trigger, 'voiced_evidence');
      assert.equal(trigger[0].take_outcome, 'analyzed');
    } finally { harness.cleanup(); }
  });

  it('a genuinely silent recorded phrase asks for a retry without claiming anything was heard', async (t) => {
    if (!HAS_FFMPEG) return t.skip('ffmpeg is not installed');
    // The analyzer looked and reported no voiced frames, the same verdict the
    // live analyzer gave digital silence on 2026-07-27.
    const harness = buildHarness({ voicedFramePct: 0, pitchValidFrameCount: 0 });
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitRecordedTurn(harness, sessionId, oggFromPcm(Buffer.alloc(16000 * 2)));

      // Today's outward behavior, unchanged: a 200 no-speech payload, not a 400.
      assert.equal(payload.inputTurn.outcome, 'no-speech');
      assert.equal(payload.inputTurn.turnTrigger, 'silent');
      assert.equal(payload.inputTurn.voicedEvidence, false);
      // NOTHING fabricated: no wordless-practice flag and no heard-voice claim.
      assert.equal(payload.inputTurn.wordlessPractice, undefined);
      assert.equal(payload.inputTurn.semanticRetry, true);
      assert.match(payload.inputTurn.coachLine, /didn't catch.*sentence again/i);
      assert.doesNotMatch(payload.inputTurn.coachLine, /heard your voice/i);

      // But the DIFFERENCE that matters is in the log: the analyzer was ASKED
      // and said no, instead of never being asked at all.
      const take = harness.lines('coach_take');
      assert.equal(take.length, 1);
      assert.equal(take[0].outcome, 'analyzed');
      assert.notEqual(take[0].reason, 'no_pcm_segment', 'silence must no longer read as "we never looked"');
    } finally { harness.cleanup(); }
  });

  it('an ENGINE prescription still cannot manufacture a turn out of digital silence', async (t) => {
    if (!HAS_FFMPEG) return t.skip('ffmpeg is not installed');
    const harness = buildHarness({ voicedFramePct: 0, pitchValidFrameCount: 0 });
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      // A take kind the ENGINE proposed. It may label a take; it may never be
      // evidence that a sound occurred.
      session.voiceState = { ...session.voiceState, pendingTakeKind: { kind: 'hum_sovt', source: 'engine-recommendation', at: Date.now() } };
      const payload = await submitRecordedTurn(harness, sessionId, oggFromPcm(Buffer.alloc(16000 * 2)));
      assert.equal(payload.inputTurn.turnTrigger, 'silent');
      assert.equal(payload.inputTurn.voicedEvidence, false);
    } finally { harness.cleanup(); }
  });

  it('an undecodable format degrades to the old behavior and NAMES the format', async () => {
    const harness = buildHarness({ voiceCoachTakeFfmpegPath: '/definitely/not/ffmpeg' });
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitRecordedTurn(harness, sessionId, Buffer.from('fake webm bytes'), { mimeType: 'audio/webm', audioFormat: 'webm' });

      // The audio was never decoded, so there is no evidence either for voice
      // or for silence.
      assert.equal(payload.inputTurn.outcome, 'no-speech');
      assert.equal(payload.inputTurn.turnTrigger, 'unresolved');
      assert.equal(harness.takeRequests.length, 0, 'an undecodable turn must not dispatch a take');

      const decodeLines = harness.lines('coach_take_decode');
      assert.equal(decodeLines.length, 1);
      assert.equal(decodeLines[0].outcome, 'unavailable');
      assert.equal(decodeLines[0].reason, 'ffmpeg_unavailable');
      assert.equal(decodeLines[0].audio_type, 'audio/webm', 'the witness must name the format it could not read');

      const witness = harness.witnesses.find((row) => row.metadata?.outcome === 'recorded_take_decode_unavailable');
      assert.ok(witness, 'the skip must be witnessed, not silent');
      assert.equal(witness.metadata.audio_type, 'audio/webm');
    } finally { harness.cleanup(); }
  });

  it('the decode can be switched off without relabeling absent evidence as silence', async (t) => {
    if (!HAS_FFMPEG) return t.skip('ffmpeg is not installed');
    const harness = buildHarness({ voiceCoachTakeDecodeEnabled: false });
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitRecordedTurn(harness, sessionId, oggFromPcm(pcm(1200)));
      assert.equal(payload.inputTurn.turnTrigger, 'unresolved');
      assert.equal(harness.takeRequests.length, 0);
      assert.equal(harness.lines('coach_take_decode').length, 0, 'the leg must be fully inert when disabled');
      assert.equal(harness.lines('coach_take')[0].reason, 'no_pcm_segment', 'the exact pre-change witness');
    } finally { harness.cleanup(); }
  });

  it('a WAV recorded take needs no subprocess and still earns its take', async () => {
    const harness = buildHarness({ voicedFramePct: 0.92, pitchValidFrameCount: 120, voiceCoachTakeFfmpegPath: '/definitely/not/ffmpeg' });
    try {
      const sessionId = await armedSession(harness);
      const segment = pcm(1200);
      const payload = await submitRecordedTurn(harness, sessionId, encodePcm16Wav(segment, 16000), { mimeType: 'audio/wav', audioFormat: 'wav' });
      assert.equal(payload.inputTurn.turnTrigger, 'voiced_evidence');
      assert.equal(harness.takeRequests.length, 1);
      // The exact samples, byte for byte, with no transcode in between.
      assert.equal(harness.takeRequests[0].pcm16Base64, segment.toString('base64'));
      assert.equal(harness.lines('coach_take_decode')[0].via, 'wav_inline');
    } finally { harness.cleanup(); }
  });
});

describe('the malformed-caller gate is still a 400', () => {
  it('neither transcript NOR audio is a caller error, on both providers', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      const handlers = harness.runtime.voiceOperationRouteHandlers;

      await assert.rejects(
        () => handlers.submitVoiceInputTurn({ sessionId, requestedProvider: 'backend', captureProvider: 'backend' }),
        (error) => error.status === 400 && /audioBase64 is required/.test(error.message),
      );
      await assert.rejects(
        () => handlers.submitVoiceInputTurn({ sessionId, requestedProvider: 'browser', captureProvider: 'browser' }),
        (error) => error.status === 400 && /transcript is required/.test(error.message),
      );
      assert.equal(harness.takeRequests.length, 0, 'a malformed turn must never reach the analyzer');
    } finally { harness.cleanup(); }
  });
});

describe('the STREAMING branch is untouched', () => {
  it('a streamed turn supplies its own PCM and pays for no decode at all', async () => {
    const harness = buildHarness({ voicedFramePct: 0.92, pitchValidFrameCount: 120 });
    try {
      const sessionId = await armedSession(harness);
      const segment = pcm(900);
      const payload = await harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
        sessionId, requestedProvider: 'backend', captureProvider: 'backend',
        audioFormat: 'wav', mimeType: 'audio/wav', filename: 'voice-input.wav',
        transcriptSource: 'backend-live', capturedAt: Date.now(),
      }, { audioBuffer: encodePcm16Wav(segment, 16000), pcmBuffer: segment, shouldCommit: () => true });

      assert.equal(payload.inputTurn.turnTrigger, 'voiced_evidence');
      assert.equal(harness.takeRequests.length, 1);
      // The streamed segment reaches the analyzer unchanged — no decode round trip.
      assert.equal(harness.takeRequests[0].pcm16Base64, segment.toString('base64'));
      assert.equal(harness.lines('coach_take_decode').length, 0, 'the streaming branch must never invoke the decode leg');
    } finally { harness.cleanup(); }
  });
});
