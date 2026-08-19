'use strict';

const DEFAULT_MAX_AUDIO_BYTES = 12 * 1024 * 1024;
const ALLOWED_AUDIO_MIME_TYPES = new Set([
  'audio/webm',
  'audio/wav',
  'audio/x-wav',
  'audio/ogg',
  'audio/mp4',
  'audio/mpeg',
]);

function trimText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeTranscript(value) {
  const text = trimText(value);
  if (!text) return '';
  const pythonList = text.match(/^\[\s*['"]([^'"]+)['"]\s*\]$/u);
  return trimText(pythonList ? pythonList[1] : text);
}

function normalizeLanguage(value) {
  const language = trimText(value).toLowerCase();
  if (!language || language === 'auto') return '';
  return language.startsWith('en') ? 'en' : language;
}

function normalizeMimeType(value) {
  const normalized = trimText(value).toLowerCase().split(';')[0];
  return ALLOWED_AUDIO_MIME_TYPES.has(normalized) ? normalized : null;
}

function decodeBase64Audio(value, maxBytes = DEFAULT_MAX_AUDIO_BYTES) {
  const encoded = trimText(value);
  if (!encoded) {
    const error = new Error('audioBase64 is required for backend voice input turns');
    error.status = 400;
    throw error;
  }
  // Reject before allocating a decoded buffer. Base64 expands by roughly 4/3.
  if (encoded.length > Math.ceil(maxBytes / 3) * 4 + 8) {
    const error = new Error(`Recorded audio is too large (maximum ${maxBytes} bytes).`);
    error.status = 413;
    throw error;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/u.test(encoded) || encoded.length % 4 === 1) {
    const error = new Error('audioBase64 must contain valid base64 audio data');
    error.status = 400;
    throw error;
  }
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length) {
    const error = new Error('audioBase64 decoded to empty audio');
    error.status = 400;
    throw error;
  }
  if (buffer.length > maxBytes) {
    const error = new Error(`Recorded audio is too large (maximum ${maxBytes} bytes).`);
    error.status = 413;
    throw error;
  }
  return buffer;
}

async function readProviderError(response) {
  try {
    const payload = await response.json();
    const detail = trimText(payload?.error || payload?.detail || payload?.message);
    if (detail) return detail.slice(0, 240);
  } catch {
    // Try text next.
  }
  try {
    const text = trimText(await response.text());
    if (text) return text.slice(0, 240);
  } catch {
    // Fall through.
  }
  return `HTTP ${response.status}`;
}

function extractTranscript(payload) {
  const root = payload && typeof payload === 'object' ? payload : {};
  const resultEntry = Array.isArray(root.result) ? root.result[0] : root.result;
  const transcript = normalizeTranscript(
    root.text
    || root.transcript
    || root.data?.text
    || root.data?.transcript
    || resultEntry?.clean_text
    || resultEntry?.text
    || resultEntry?.raw_text,
  );
  if (!transcript) return null;
  const confidenceValue = Number(root.confidence ?? root.data?.confidence ?? resultEntry?.confidence);
  return {
    transcript: transcript.slice(0, 1200),
    confidence: Number.isFinite(confidenceValue) ? confidenceValue : null,
    providerModel: trimText(root.model?.name || root.model?.id || root.model || root.model_name) || null,
    providerLanguage: trimText(root.language || root.language_code) || null,
    audioProcessedMs: Number.isFinite(Number(root.audio_processed_ms))
      ? Math.max(0, Math.round(Number(root.audio_processed_ms)))
      : null,
  };
}

function combineAbortSignal(signal, timeoutMs) {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeoutSignal;
  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any([signal, timeoutSignal]);
  }
  const controller = new AbortController();
  const abort = (source) => {
    if (!controller.signal.aborted) controller.abort(source.reason);
  };
  if (signal.aborted) abort(signal);
  else signal.addEventListener('abort', () => abort(signal), { once: true });
  timeoutSignal.addEventListener('abort', () => abort(timeoutSignal), { once: true });
  return controller.signal;
}

class VoiceInputAsrBridge {
  constructor(options = {}) {
    this.enabled = options.enabled === true;
    this.baseUrl = (trimText(options.baseUrl) || 'http://127.0.0.1:8765').replace(/\/+$/u, '');
    this.apiStyle = trimText(options.apiStyle).toLowerCase() || 'simple';
    this.language = trimText(options.language) || 'auto';
    this.liveMode = trimText(options.liveMode).toLowerCase() || 'buffered';
    this.timeoutMs = Number.isFinite(Number(options.timeoutMs))
      ? Math.max(1000, Math.round(Number(options.timeoutMs)))
      : 10000;
    this.maxAudioBytes = Number.isFinite(Number(options.maxAudioBytes))
      ? Math.max(1024, Math.round(Number(options.maxAudioBytes)))
      : DEFAULT_MAX_AUDIO_BYTES;
    this.fetchImpl = options.fetchImpl || global.fetch;
    this.available = null;
    this.lastError = null;
    this.lastCheckedAt = null;
    this.statusCacheMs = Number.isFinite(Number(options.statusCacheMs))
      ? Math.max(0, Math.round(Number(options.statusCacheMs)))
      : 5000;
  }

  markStatus(available, reason = null) {
    this.available = Boolean(available);
    this.lastError = reason ? trimText(reason).slice(0, 240) : null;
    this.lastCheckedAt = Date.now();
  }

  statusPayload(reason = this.lastError) {
    return {
      enabled: this.enabled,
      available: this.enabled ? this.available === true : false,
      reason: this.enabled ? (reason || null) : 'Voice ASR is disabled.',
      baseUrl: this.baseUrl,
      apiStyle: this.apiStyle,
      liveMode: this.liveMode,
      lastCheckedAt: this.lastCheckedAt,
    };
  }

  async getStatus(options = {}) {
    if (!this.enabled) return this.statusPayload();
    const fresh = this.lastCheckedAt != null && Date.now() - this.lastCheckedAt < this.statusCacheMs;
    if (options.refresh !== true && fresh) return this.statusPayload();

    let lastReason = 'Voice ASR health check failed.';
    for (const path of ['/health', '/ready']) {
      try {
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          signal: AbortSignal.timeout(Math.min(this.timeoutMs, 3000)),
        });
        if (response.ok) {
          let payload = {};
          try { payload = await response.json(); } catch { /* an HTTP 2xx is enough */ }
          if (payload.model_loaded === false || payload.ready === false) {
            lastReason = 'Voice ASR model is not ready.';
            continue;
          }
          this.markStatus(true, null);
          return this.statusPayload();
        }
        lastReason = await readProviderError(response);
      } catch (error) {
        lastReason = trimText(error?.message) || lastReason;
      }
    }
    this.markStatus(false, lastReason);
    return this.statusPayload(lastReason);
  }

  candidateStyles() {
    return this.apiStyle === 'auto' ? ['simple', 'openai'] : [this.apiStyle];
  }

  async transcribeAudio(options = {}) {
    if (!this.enabled) return { success: false, error: 'Voice ASR is disabled.' };
    const audioBuffer = options.audioBuffer;
    if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
      return { success: false, error: 'audioBuffer is required.' };
    }
    if (audioBuffer.length > this.maxAudioBytes) {
      return { success: false, error: `Recorded audio is too large (maximum ${this.maxAudioBytes} bytes).` };
    }
    const mimeType = normalizeMimeType(options.mimeType || 'audio/webm');
    if (!mimeType) return { success: false, error: 'Unsupported recorded audio type.' };
    const filename = trimText(options.filename) || 'voice-input.webm';
    const language = normalizeLanguage(options.language || this.language);
    let lastError = 'Voice ASR transcription failed.';

    for (const style of this.candidateStyles()) {
      try {
        const form = new FormData();
        form.append('file', new Blob([audioBuffer], { type: mimeType }), filename);
        let path = '/transcribe';
        if (style === 'openai') {
          path = '/v1/audio/transcriptions';
          if (language) form.append('language', language);
          form.append('response_format', 'verbose_json');
        } else if (style === 'simple') {
          const query = new URLSearchParams();
          if (language) query.set('language', language);
          // The deployed NeMo/Parakeet service returns plain strings when its
          // timestamp mode is disabled, while its hardened response adapter
          // accepts only Hypothesis objects. Timestamp mode therefore carries
          // the actual text on this provider; segments remain optional.
          query.set('return_timestamps', 'true');
          path = `/transcribe?${query.toString()}`;
        } else {
          continue;
        }

        const requestSignal = combineAbortSignal(options.signal, this.timeoutMs);
        const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
          method: 'POST',
          body: form,
          signal: requestSignal,
        });
        if (!response.ok) throw new Error(await readProviderError(response));
        const payload = await response.json();
        const parsed = extractTranscript(payload);
        // A healthy recognizer can legitimately return HTTP 200 with an empty
        // transcript when VAD admitted room noise, breath, or an unusably short
        // sound. That is a no-speech turn, not a provider outage.
        if (!parsed) {
          this.markStatus(true, null);
          return {
            success: true,
            noSpeech: true,
            transcript: '',
            confidence: null,
            providerModel: null,
            providerLanguage: null,
            audioProcessedMs: null,
            providerStyle: style,
            transcriptSource: 'backend-asr',
          };
        }
        this.markStatus(true, null);
        return {
          success: true,
          ...parsed,
          providerStyle: style,
          transcriptSource: 'backend-asr',
        };
      } catch (error) {
        lastError = trimText(error?.message) || lastError;
        if (options.signal?.aborted) break;
      }
    }

    this.markStatus(false, lastError);
    return { success: false, error: lastError };
  }
}

/* ===========================================================================
 * RECORDED AUDIO -> PCM16, so the analyzer can hear a recorded take (2026-07-27)
 *
 * WHY THIS EXISTS. The coach's recorded path (`POST /voice/input/turn`) receives
 * BROWSER audio — `coach-input.ts:291` asks MediaRecorder for
 * 'audio/ogg;codecs=opus' first and falls back to webm — while the analyzer's
 * one-shot take route wants `pcm16Base64`, "base64-encoded 16 kHz mono PCM16
 * little-endian" (services/voice-trainer/src/services/contracts.py:132). Something
 * has to decode, and MEASURED, nothing upstream already did:
 * `VoiceInputAsrBridge.transcribeAudio` above wraps the ENCODED buffer in a Blob
 * and posts it as multipart, so no PCM ever materialises in this process.
 *
 * ffmpeg is not a new dependency of this repo — it is already required by the
 * very analyzer this feeds (`services/voice-trainer/src/services/audio_analysis.py`
 * shells the identical `-ac 1 -ar <rate> -f s16le` invocation for non-WAV input and
 * raises "install ffmpeg or use WAV input" without it), and by
 * `services/voxcpm-tts/app/audio.py`. `frontend/src/voice/front-door.ts:304` names
 * "the DSP needs ffmpeg for non-WAV" as a standing implementation constraint. It IS
 * new to the Node backend, which previously spawned only the smart-turn Python
 * worker (`voice-turn-detector.js`). It is therefore treated as OPTIONAL
 * everywhere below: absent ffmpeg degrades to exactly the old behaviour (no take)
 * and says so, it never fails a turn.
 *
 * MEASURED on this box 2026-07-27 (ffmpeg n8.1.1, /usr/bin/ffmpeg): a 2s mono clip
 * decodes through `pipe:0` to exactly 64000 bytes (16000 Hz x 2 bytes x 2 s) from
 * BOTH ogg/opus and webm/opus. Container seeking is not required for either, so
 * stdin is used and no temp file is ever written.
 * ======================================================================== */

const RECORDED_TAKE_SAMPLE_RATE = 16000;
const WAV_MIME_TYPES = new Set(['audio/wav', 'audio/x-wav']);
/** Bound on decoded PCM: 60s @ 16 kHz PCM16, the analyzer one-shot's own cap. */
const MAX_DECODED_PCM_BYTES = 1920000;

/**
 * Parse a RIFF/WAVE buffer that is ALREADY 16 kHz mono PCM16 and hand back its
 * data chunk. Returns null for every other WAV shape (other rates, stereo,
 * float, ADPCM), because resampling and mixdown are exactly the work ffmpeg is
 * for — this is a fast path, not a second decoder.
 *
 * Worth having despite the browser never producing WAV here: it is what
 * `encodePcm16Wav` (voice-input-live.js) emits, and it decodes with no
 * subprocess at all.
 */
function decodeWavPcm16Mono(buffer, sampleRate = RECORDED_TAKE_SAMPLE_RATE) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) return null;
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return null;
  let offset = 12;
  let format = null;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString('ascii', offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (chunkId === 'fmt ' && chunkSize >= 16 && body + 16 <= buffer.length) {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitsPerSample: buffer.readUInt16LE(body + 14),
      };
    } else if (chunkId === 'data') {
      if (!format) return null;
      // 1 = WAVE_FORMAT_PCM. Anything else is compressed and not ours to read.
      if (format.audioFormat !== 1) return null;
      if (format.channels !== 1) return null;
      if (format.bitsPerSample !== 16) return null;
      if (format.sampleRate !== sampleRate) return null;
      const available = Math.max(0, buffer.length - body);
      // A truncated recording still has usable frames; trust the smaller of the
      // declared size and what actually arrived, then keep it sample-aligned.
      const usable = Math.min(chunkSize, available) & ~1;
      if (usable < 2) return null;
      return buffer.subarray(body, body + usable);
    }
    // RIFF chunks are word-aligned: an odd size carries one pad byte.
    offset = body + chunkSize + (chunkSize % 2);
  }
  return null;
}

/**
 * Locate ffmpeg once per process. Mirrors what `shutil.which` does for the
 * Python analyzer, without adding a dependency to resolve a path.
 * Returns null when it is not installed — the caller must treat that as
 * "no take this turn", never as an error.
 */
let ffmpegPathCache;
function resolveFfmpegPath(explicitPath = null, { fsImpl = null, env = null } = {}) {
  const fsModule = fsImpl || require('node:fs');
  const explicit = trimText(explicitPath);
  if (explicit) {
    try {
      fsModule.accessSync(explicit, fsModule.constants.X_OK);
      return explicit;
    } catch {
      return null;
    }
  }
  // An injected filesystem or PATH describes a DIFFERENT machine than the one
  // the cache was filled from, so it must neither read nor write that cache.
  // Without this a caller that says "there is no ffmpeg here" is answered with
  // the real binary — which is exactly what this function is asked to decide.
  const injected = Boolean(fsImpl || env);
  if (!injected && ffmpegPathCache !== undefined) return ffmpegPathCache;
  const pathModule = require('node:path');
  const searchPath = trimText((env || process.env).PATH) || '/usr/bin:/bin:/usr/local/bin';
  for (const directory of searchPath.split(pathModule.delimiter)) {
    if (!directory) continue;
    const candidate = pathModule.join(directory, 'ffmpeg');
    try {
      fsModule.accessSync(candidate, fsModule.constants.X_OK);
      if (!injected) ffmpegPathCache = candidate;
      return candidate;
    } catch { /* keep looking */ }
  }
  if (!injected) ffmpegPathCache = null;
  return null;
}

/** Test seam only: forget the cached ffmpeg lookup. */
function resetFfmpegPathCache() {
  ffmpegPathCache = undefined;
}

/**
 * Can a recorded take of this mime type be decoded here AT ALL, decided
 * synchronously and BEFORE any work is dispatched?
 *
 * The caller needs this answer up front because binding an analyzer session for
 * audio that can never be decoded would create a real session on the trainer
 * that nothing can use — the exact waste the streaming branch's dispatch guard
 * exists to avoid.
 */
function resolveRecordedTakeDecodePlan(mimeType, { ffmpegPath = null, fsImpl, env } = {}) {
  const normalized = normalizeMimeType(mimeType);
  if (!normalized) return { decodable: false, via: null, reason: 'unsupported_mime_type', mimeType: trimText(mimeType) || null };
  const resolvedFfmpeg = resolveFfmpegPath(ffmpegPath, { ...(fsImpl ? { fsImpl } : {}), ...(env ? { env } : {}) });
  if (WAV_MIME_TYPES.has(normalized)) {
    // WAV is decodable either way: in-process when it is already 16 kHz mono
    // PCM16, ffmpeg otherwise. The in-process attempt happens at decode time.
    return { decodable: true, via: resolvedFfmpeg ? 'wav_or_ffmpeg' : 'wav_inline', reason: null, mimeType: normalized, ffmpegPath: resolvedFfmpeg };
  }
  if (!resolvedFfmpeg) {
    return { decodable: false, via: null, reason: 'ffmpeg_unavailable', mimeType: normalized };
  }
  return { decodable: true, via: 'ffmpeg', reason: null, mimeType: normalized, ffmpegPath: resolvedFfmpeg };
}

/**
 * Decode recorded browser audio to raw 16 kHz mono PCM16.
 *
 * ALWAYS resolves, NEVER rejects — same contract as `beginCoachTakeAnalysis`,
 * and for the same reason: this is dispatched before the ASR is awaited, so an
 * unhandled rejection here would take the process down on Node >= 15.
 *
 * Resolves `{ ok: true, pcm, via, ms, bytesIn, bytesOut }` or
 * `{ ok: false, reason, ms, mimeType, ... }`. A false is never an error the
 * turn should surface; it means this turn has no take evidence, exactly as
 * every recorded turn had none before this existed.
 */
async function decodeRecordedAudioToPcm16({
  audioBuffer,
  mimeType,
  ffmpegPath = null,
  timeoutMs = 2000,
  sampleRate = RECORDED_TAKE_SAMPLE_RATE,
  maxBytes = MAX_DECODED_PCM_BYTES,
  spawnImpl = null,
  fsImpl,
  env,
} = {}) {
  const startedAt = Date.now();
  const done = (result) => ({ ...result, ms: Date.now() - startedAt });
  if (!Buffer.isBuffer(audioBuffer) || audioBuffer.length === 0) {
    return done({ ok: false, reason: 'empty_audio', mimeType: normalizeMimeType(mimeType) });
  }
  const plan = resolveRecordedTakeDecodePlan(mimeType, { ffmpegPath, fsImpl, env });
  if (!plan.decodable) return done({ ok: false, reason: plan.reason, mimeType: plan.mimeType });

  if (WAV_MIME_TYPES.has(plan.mimeType)) {
    const inline = decodeWavPcm16Mono(audioBuffer, sampleRate);
    if (inline && inline.length >= 2) {
      if (inline.length > maxBytes) {
        return done({ ok: false, reason: 'decoded_too_large', mimeType: plan.mimeType, bytesOut: inline.length });
      }
      return done({ ok: true, pcm: inline, via: 'wav_inline', bytesIn: audioBuffer.length, bytesOut: inline.length, mimeType: plan.mimeType });
    }
    // A WAV this parser will not read (other rate, stereo, float) is not a
    // failure while ffmpeg is present — it is ffmpeg's job.
    if (!plan.ffmpegPath) {
      return done({ ok: false, reason: 'wav_unsupported_shape', mimeType: plan.mimeType });
    }
  }

  const spawn = spawnImpl || require('node:child_process').spawn;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(done(result));
    };
    let child;
    const timer = setTimeout(() => {
      try { child?.kill('SIGKILL'); } catch { /* already gone */ }
      finish({ ok: false, reason: 'decode_timeout', mimeType: plan.mimeType });
    }, Math.max(1, Math.round(timeoutMs)));
    timer?.unref?.();
    const chunks = [];
    let bytesOut = 0;
    let overflowed = false;
    let stderr = '';
    const onClose = (code) => {
      if (overflowed) {
        // This count INCLUDES the chunk that tripped the cap, so it reads a
        // little above `maxBytes`. It marks where the decode was abandoned; it
        // is not a measurement of the stream, which was never read to the end.
        finish({ ok: false, reason: 'decoded_too_large', mimeType: plan.mimeType, bytesOut });
        return;
      }
      const pcm = Buffer.concat(chunks);
      // Sample alignment is a hard precondition of beginCoachTakeAnalysis, which
      // rejects an odd-length buffer outright.
      const aligned = pcm.length % 2 ? pcm.subarray(0, pcm.length - 1) : pcm;
      if (code === 0 && aligned.length >= 2) {
        finish({ ok: true, pcm: aligned, via: 'ffmpeg', bytesIn: audioBuffer.length, bytesOut: aligned.length, mimeType: plan.mimeType });
        return;
      }
      finish({
        ok: false,
        reason: aligned.length < 2 && code === 0 ? 'decoded_empty' : 'decode_failed',
        mimeType: plan.mimeType,
        exitCode: code,
        error: trimText(stderr).slice(0, 200) || null,
      });
    };
    // EVERYTHING from the spawn to `stdin.end` sits inside this try, for a
    // MEASURED reason rather than defensive habit. Under fd exhaustion Node's
    // `spawn` does NOT throw: it returns a ChildProcess whose `stdout`/`stdin`
    // are `undefined`, then emits 'error' asynchronously. Reproduced on this box
    // under `ulimit -n 64` (node v26.1.0):
    //
    //     threw: null | child: object | stdout: undefined | stdin: undefined
    //
    // An earlier draft touched `child.stdout` before attaching the 'error'
    // handler and did two fatal things at once: it threw a TypeError out of this
    // executor — rejecting a promise whose whole contract is that it never
    // rejects — and it left the child's EMFILE 'error' event unlistened, which
    // on Node >= 15 terminates the gateway. Both were observed directly:
    // `Unhandled 'error' event ... Error: spawn /usr/bin/ffmpeg EMFILE`, EXIT=1.
    // So the 'error' handler is attached FIRST, the stdio is checked before it
    // is touched, and anything still unexpected becomes an ordinary failed decode.
    try {
      child = spawn(plan.ffmpegPath, [
        '-hide_banner',
        '-loglevel', 'error',
        // stdin, MEASURED to decode ogg/opus and webm/opus without seeking, so
        // no temp file is ever written. (`-nostdin`, which the Python analyzer's
        // file-path invocation passes, was measured to work here too — 64000
        // bytes from a 2s clip on ffmpeg n8.1.1. It is simply unnecessary when
        // stdin IS the input, so it is left off. It is not harmful.)
        '-i', 'pipe:0',
        '-ac', '1',
        '-ar', String(sampleRate),
        '-f', 's16le',
        'pipe:1',
      ], { stdio: ['pipe', 'pipe', 'pipe'] });
      child.on('error', (error) => {
        finish({ ok: false, reason: 'decode_spawn_failed', mimeType: plan.mimeType, error: trimText(error?.message).slice(0, 200) || 'spawn failed' });
      });
      if (!child.stdout || !child.stdin || !child.stderr) {
        // The fd-exhaustion shape above. 'error' is already handled, so the
        // process is safe; this turn simply gets no decode.
        finish({ ok: false, reason: 'decode_spawn_failed', mimeType: plan.mimeType, error: 'child process has no stdio' });
        return;
      }
      child.stdout.on('data', (chunk) => {
        bytesOut += chunk.length;
        if (bytesOut > maxBytes) {
          // Stop paying for audio the analyzer would 413 anyway.
          overflowed = true;
          try { child.kill('SIGKILL'); } catch { /* already gone */ }
          return;
        }
        chunks.push(chunk);
      });
      child.stderr.on('data', (chunk) => { if (stderr.length < 400) stderr += String(chunk); });
      // EPIPE on stdin is normal: ffmpeg may stop reading once it has what it
      // needs. It must never become an unhandled 'error' event.
      child.stdin.on('error', () => {});
      child.on('close', onClose);
      child.stdin.end(audioBuffer);
    } catch (error) {
      try { child?.kill('SIGKILL'); } catch { /* nothing to kill */ }
      finish({ ok: false, reason: 'decode_spawn_failed', mimeType: plan.mimeType, error: trimText(error?.message).slice(0, 200) || 'spawn failed' });
    }
  });
}

module.exports = {
  ALLOWED_AUDIO_MIME_TYPES,
  DEFAULT_MAX_AUDIO_BYTES,
  MAX_DECODED_PCM_BYTES,
  RECORDED_TAKE_SAMPLE_RATE,
  VoiceInputAsrBridge,
  combineAbortSignal,
  decodeBase64Audio,
  decodeRecordedAudioToPcm16,
  decodeWavPcm16Mono,
  extractTranscript,
  normalizeMimeType,
  normalizeTranscript,
  resetFfmpegPathCache,
  resolveFfmpegPath,
  resolveRecordedTakeDecodePlan,
};
