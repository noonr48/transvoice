'use strict';

const crypto = require('node:crypto');
const WebSocket = require('ws');

const DEFAULT_POLICY = Object.freeze({
  candidateSilenceMs: 1800,
  fallbackSilenceMs: 4500,
  minSpeechMs: 150,
  noSpeechTimeoutMs: 12000,
  rmsThreshold: 0.02,
  semanticThreshold: 0.65,
  maxAudioBytes: 4 * 1024 * 1024,
});

const CONSERVATIVE_MIN_SPEECH_MS = 150;
const FIRST_PCM_TIMEOUT_MS = 3000;

// While a turn is in flight (finalizeSegment -> ASR round trip) the learner is
// still talking into a live microphone. Those frames used to be DROPPED, so the
// first words spoken over "Thinking…" were destroyed and the coach asked for a
// repeat. They are buffered instead, then replayed into the fresh segment.
// 1 MiB of 16 kHz PCM16 is ~32 s — far longer than any real ASR round trip, so
// the cap only fires when something upstream is genuinely wedged.
const PENDING_FRAME_MAX_BYTES = 1024 * 1024;

// Segment trimming (Defect 2). A segment holds EVERY frame since the segment
// opened: all pre-speech silence plus the full conservative trailing silence
// (up to fallbackSilenceMs = 4500). Handing that to the ASR makes a
// silence-dominated clip. Trim to the voiced span plus a small musical margin.
const TRIM_PRE_ROLL_MS = 300;
const TRIM_TAIL_MS = 600;
// Never hand the ASR a clip shorter than this: some engines reject or
// mis-transcribe very short buffers, and a clipped word is worse than silence.
const TRIM_MIN_AUDIO_MS = 500;
const SAMPLE_RATE = 16000;

function msToSamples(ms, sampleRate = SAMPLE_RATE) {
  return Math.round((ms / 1000) * sampleRate);
}

function samplesToMs(samples, sampleRate = SAMPLE_RATE) {
  return Math.round((samples / sampleRate) * 1000);
}

function clampNumber(value, fallback, minimum, maximum) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : fallback;
}

function normalizePolicy(value = {}) {
  // Accessibility contract: these two boundaries are one tested policy, not
  // user/client tuning knobs. A shorter candidate can cut careful or stuttered
  // speech; a longer fallback makes the same turn feel stalled. Recalibration
  // requires a new representative corpus and an explicit product decision.
  const candidateSilenceMs = DEFAULT_POLICY.candidateSilenceMs;
  return {
    candidateSilenceMs,
    fallbackSilenceMs: DEFAULT_POLICY.fallbackSilenceMs,
    // Short greetings are exactly where the semantic detector is most useful.
    // Keep eligibility server-owned so an older client cannot force a genuine
    // 150–349 ms utterance onto the much slower 4.5 s fallback.
    minSpeechMs: DEFAULT_POLICY.minSpeechMs,
    noSpeechTimeoutMs: clampNumber(
      value.noSpeechTimeoutMs,
      DEFAULT_POLICY.noSpeechTimeoutMs,
      5000,
      60000,
    ),
    rmsThreshold: clampNumber(value.rmsThreshold, DEFAULT_POLICY.rmsThreshold, 0.002, 0.25),
    semanticThreshold: clampNumber(
      value.semanticThreshold,
      DEFAULT_POLICY.semanticThreshold,
      0.5,
      0.99,
    ),
    maxAudioBytes: Math.round(clampNumber(
      value.maxAudioBytes,
      DEFAULT_POLICY.maxAudioBytes,
      1,
      8 * 1024 * 1024,
    )),
  };
}

function pcm16Rms(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 2) return 0;
  const samples = Math.floor(buffer.length / 2);
  let sumSquares = 0;
  for (let offset = 0; offset < samples * 2; offset += 2) {
    const value = buffer.readInt16LE(offset) / 32768;
    sumSquares += value * value;
  }
  return Math.sqrt(sumSquares / samples);
}

function encodePcm16Wav(pcmBuffer, sampleRate = 16000) {
  if (!Buffer.isBuffer(pcmBuffer)) throw new TypeError('pcmBuffer must be a Buffer');
  const header = Buffer.alloc(44);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8, 'ascii');
  header.write('fmt ', 12, 'ascii');
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36, 'ascii');
  header.writeUInt32LE(pcmBuffer.length, 40);
  return Buffer.concat([header, pcmBuffer]);
}

function createVoiceInputLiveConnection(options = {}) {
  const socket = options.socket;
  const getSession = options.getSession || (() => null);
  const submitTurn = options.submitTurn;
  const detector = options.detector || {
    predict: async () => ({ available: false, complete: null, probability: null, reason: 'disabled' }),
    getStatus: () => ({ enabled: false, state: 'disabled', available: false }),
  };
  const createId = options.createId || (() => crypto.randomUUID());
  const now = options.now || Date.now;
  const onWitness = typeof options.onWitness === 'function' ? options.onWitness : () => {};
  const basePolicy = normalizePolicy(options.policy);
  const firstPcmTimeoutMs = Math.round(clampNumber(
    options.firstPcmTimeoutMs,
    FIRST_PCM_TIMEOUT_MS,
    500,
    10000,
  ));
  const setTimeoutImpl = options.setTimeoutImpl || setTimeout;
  const clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout;

  let policy = basePolicy;
  let opened = false;
  let closed = false;
  let processing = false;
  let sessionId = null;
  let sessionGeneration = null;
  let liveInputLeaseId = null;
  let liveSessionId = null;
  let openedAt = null;
  // Socket-lifetime `openedAt` is set once and never reset, so every
  // `open_to_*` metric measured against it grew cumulatively across turns
  // (turn 3 reported the whole session's wall clock). `segmentOpenedAt` is the
  // per-SEGMENT reference, reset in resetSegment(), so the in-segment stage
  // timings describe THIS spoken turn. `openedAt` still backs the one-shot
  // socket-level capture-ready metric.
  let segmentOpenedAt = null;
  let firstPcmAt = null;
  let transportHasPcm = false;
  let firstPcmTimer = null;
  let speechDetectedAt = null;
  let streamSamples = 0;
  let voicedSamples = 0;
  let firstVoiceSample = null;
  let lastVoiceSample = null;
  let semanticCheckedVoiceSample = null;
  let semanticPending = false;
  let segmentEpoch = 0;
  let segmentId = null;
  let segmentFrames = [];
  let segmentBytes = 0;
  let receivedBytes = 0;
  let droppedFrames = 0;
  let fallbackTurns = 0;
  let abortController = null;
  // Speech that arrived while a turn was in flight (Defect 1).
  let pendingFrames = [];
  let pendingBytes = 0;
  let pendingDroppedFrames = 0;

  function clearFirstPcmTimer() {
    if (firstPcmTimer == null) return;
    clearTimeoutImpl(firstPcmTimer);
    firstPcmTimer = null;
  }

  function witness(level, message, metadata) {
    try { onWitness(level, 'voice-input-live', message, metadata); } catch { /* non-fatal */ }
  }

  function send(payload) {
    if (closed || !socket || socket.readyState !== 1) return false;
    try {
      socket.send(JSON.stringify({ emittedAt: now(), ...payload }));
      return true;
    } catch {
      close('send-failed');
      return false;
    }
  }

  function getSessionGeneration(session) {
    if (typeof options.getSessionGeneration === 'function') {
      return options.getSessionGeneration(session);
    }
    const value = Number(session?.coachLiveInputGeneration);
    return Number.isFinite(value) ? value : null;
  }

  function isSameSessionGeneration(session) {
    if (sessionGeneration == null) return true;
    return getSessionGeneration(session) === sessionGeneration;
  }

  function canOpenSession(session, leaseId) {
    return typeof options.canOpenSession !== 'function'
      || options.canOpenSession(session, { liveInputLeaseId: leaseId }) === true;
  }

  function isActiveSession(session) {
    return Boolean(
      session
      && isSameSessionGeneration(session)
      && (
        typeof options.isSessionActive !== 'function'
        || options.isSessionActive(session, {
          liveInputLeaseId,
          generation: sessionGeneration,
        }) === true
      )
    );
  }

  function resolveActiveSession() {
    if (!sessionId) return null;
    const session = getSession(sessionId);
    return isActiveSession(session) ? session : null;
  }

  function resetSegment() {
    segmentEpoch += 1;
    processing = false;
    voicedSamples = 0;
    lastVoiceSample = null;
    semanticCheckedVoiceSample = null;
    semanticPending = false;
    segmentId = null;
    segmentFrames = [];
    segmentBytes = 0;
    streamSamples = 0;
    firstPcmAt = null;
    speechDetectedAt = null;
    firstVoiceSample = null;
    // The next segment starts NOW: every in-segment `open_to_*` stage timing is
    // measured from here, not from socket open.
    segmentOpenedAt = now();
  }

  /**
   * Hold a frame that arrived mid-turn. Bounded, drop-OLDEST: if the buffer
   * ever overflows, the newest speech is the speech worth keeping.
   */
  function bufferPendingFrame(frame) {
    pendingFrames.push(frame);
    pendingBytes += frame.length;
    while (pendingBytes > PENDING_FRAME_MAX_BYTES && pendingFrames.length > 1) {
      const oldest = pendingFrames.shift();
      pendingBytes -= oldest.length;
      pendingDroppedFrames += 1;
      // `droppedFrames` stays the honest count of audio genuinely LOST; frames
      // that merely waited out a turn are no longer counted as dropped.
      droppedFrames += 1;
    }
  }

  /**
   * Seed a freshly reset segment with the speech captured during the turn that
   * just finished. Frames run through the same per-frame path as live frames,
   * so the voicing scan, `speech-start`, and both endpoint tests all apply.
   */
  function flushPendingFrames() {
    if (closed || !pendingFrames.length) return;
    const frames = pendingFrames;
    const bufferedBytes = pendingBytes;
    const droppedOverflow = pendingDroppedFrames;
    pendingFrames = [];
    pendingBytes = 0;
    pendingDroppedFrames = 0;
    witness('info', 'Buffered mid-turn speech seeded the next live segment.', {
      outcome: 'pending-frames-seeded',
      buffered_frames: frames.length,
      buffered_ms: samplesToMs(Math.floor(bufferedBytes / 2)),
      dropped_overflow: droppedOverflow,
    });
    for (let index = 0; index < frames.length; index += 1) {
      if (closed) return;
      if (processing) {
        // A buffered frame completed a turn of its own mid-drain. The same rule
        // applies to what is left: buffer it, never drop it.
        for (let rest = index; rest < frames.length; rest += 1) {
          bufferPendingFrame(frames[rest]);
        }
        return;
      }
      ingestFrame(frames[index]);
    }
  }

  /**
   * Trim a finalized segment to its voiced span plus a small margin. Uses the
   * per-frame RMS voicing scan already performed on the live path, so this adds
   * no second pass over the audio.
   */
  function trimSegmentPcm(pcmBuffer) {
    const totalSamples = Math.floor(pcmBuffer.length / 2);
    const rawMs = samplesToMs(totalSamples);
    if (firstVoiceSample == null || lastVoiceSample == null || totalSamples <= 0) {
      return { pcm: pcmBuffer, rawMs, trimmedMs: rawMs };
    }
    const floorSamples = msToSamples(TRIM_MIN_AUDIO_MS);
    let start = Math.max(0, firstVoiceSample - msToSamples(TRIM_PRE_ROLL_MS));
    let end = Math.min(totalSamples, lastVoiceSample + msToSamples(TRIM_TAIL_MS));
    if (end <= start) return { pcm: pcmBuffer, rawMs, trimmedMs: rawMs };
    // Floor: grow back into the trailing silence first (it is real room tone
    // after the phrase), then into the pre-roll, then keep whatever exists.
    if (end - start < floorSamples) end = Math.min(totalSamples, start + floorSamples);
    if (end - start < floorSamples) start = Math.max(0, end - floorSamples);
    if (start <= 0 && end >= totalSamples) {
      return { pcm: pcmBuffer, rawMs, trimmedMs: rawMs };
    }
    return {
      pcm: pcmBuffer.subarray(start * 2, end * 2),
      rawMs,
      trimmedMs: samplesToMs(end - start),
    };
  }

  function fail(code, error) {
    if (closed) return;
    send({ event: 'error', code, error });
    witness('warn', 'Live voice input failed.', {
      outcome: code,
      processing,
      received_bytes: receivedBytes,
    });
    close(code);
  }

  /**
   * Name a turn failure with the failure-ledger class, from the error itself.
   *
   * 2026-07-27 field repair. A live turn died between `asr-completed` and the
   * coach's own witnesses with ZERO evidence anywhere: the only rejection
   * handler on this path returned silently whenever the turn had been
   * superseded, aborted, or closed, so an exception on a discarded turn left no
   * line at all. A turn must never die silently again — so the class is derived
   * here rather than guessed later from a message string.
   */
  function classifyTurnFailure(error) {
    const status = Number(error?.status ?? error?.statusCode);
    const name = String(error?.name || '');
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (name === 'AbortError' || /aborted/i.test(message)) return 'never-received';
    if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|fetch failed/i.test(`${code} ${message}`)) {
      return 'not-connected';
    }
    if (/ENOENT|ENOTDIR/i.test(code)) return 'wrong-path';
    if (Number.isFinite(status) && status >= 500) return 'partial-function';
    if (Number.isFinite(status) && status >= 400) return 'contract-drift';
    if (name === 'TypeError' || name === 'ReferenceError') return 'dead-function';
    return 'partial-function';
  }

  /**
   * The single witness every `submitTurn` rejection passes through.
   *
   * ERROR level on purpose: a coach turn that produced no reply is not a
   * warning, and the level is what carries it into the journal (the runtime's
   * `pushRuntimeWitness` mapping) as well as the persistent sink. `discarded`
   * separates the two shapes of the same death — a turn nobody is waiting for
   * any more still has to say what killed it.
   */
  function witnessTurnFailure(error, { boundary, segmentId: failedSegmentId, discarded, asrMs }) {
    witness('error', 'Live voice turn failed before a reply could be built.', {
      outcome: 'turn-failed',
      boundary: boundary || null,
      segment_id: failedSegmentId || null,
      discarded: discarded === true,
      error_class: classifyTurnFailure(error),
      error_name: String(error?.name || 'Error').slice(0, 60),
      error_status: Number.isFinite(Number(error?.status ?? error?.statusCode))
        ? Number(error?.status ?? error?.statusCode)
        : null,
      // Bounded: enough to name the fault, never enough to leak a transcript.
      error_message: String(error?.message || 'unknown error').slice(0, 200),
      asr_ms: Number.isFinite(asrMs) ? Math.max(0, Math.round(asrMs)) : null,
      processing,
      received_bytes: receivedBytes,
    });
  }

  async function finalizeSegment(reason, probability = null) {
    if (closed || processing || !opened || !segmentFrames.length || !sessionId) return;
    const activeSession = resolveActiveSession();
    if (!activeSession) {
      fail('session-stale', 'The Coach session is no longer active.');
      return;
    }
    const epoch = segmentEpoch;
    processing = true;
    semanticPending = false;
    const currentSegmentId = segmentId || createId();
    const rawPcmBuffer = Buffer.concat(segmentFrames, segmentBytes);
    const trimmed = trimSegmentPcm(rawPcmBuffer);
    const pcmBuffer = trimmed.pcm;
    const wavBuffer = encodePcm16Wav(pcmBuffer, 16000);
    const asrStartedAt = now();
    abortController = new AbortController();
    send({ event: 'speech-end', sessionId, liveSessionId, segmentId: currentSegmentId });
    send({ event: 'processing', sessionId, liveSessionId, segmentId: currentSegmentId });
    witness('info', 'Live PCM crossed into ASR.', {
      outcome: 'asr-started',
      boundary: reason,
      audio_bytes: pcmBuffer.length,
      audio_ms_raw: trimmed.rawMs,
      audio_ms_trimmed: trimmed.trimmedMs,
      semantic_probability_band: probability == null
        ? 'unavailable'
        : (probability >= policy.semanticThreshold ? 'complete' : 'incomplete'),
      open_to_asr_ms: segmentOpenedAt == null ? null : Math.max(0, asrStartedAt - segmentOpenedAt),
      first_pcm_to_asr_ms: firstPcmAt == null ? null : Math.max(0, asrStartedAt - firstPcmAt),
      speech_to_asr_ms: speechDetectedAt == null ? null : Math.max(0, asrStartedAt - speechDetectedAt),
      dropped_frames: droppedFrames,
    });
    try {
      const payload = await submitTurn({
        sessionId,
        requestedProvider: 'backend',
        captureProvider: 'backend',
        audioFormat: 'wav',
        mimeType: 'audio/wav',
        filename: 'voice-input.wav',
        transcriptSource: 'backend-live',
        capturedAt: now(),
      }, {
        audioBuffer: wavBuffer,
        // The SAME trimmed take, unwrapped. The ASR wants a WAV; the voice
        // analyzer wants raw 16 kHz mono PCM16 — so hand over both views of the
        // one buffer rather than making the runtime unpick a 44-byte header
        // back off the clip it just built. One take, two readers.
        pcmBuffer,
        signal: abortController.signal,
        shouldCommit: () => !closed && segmentEpoch === epoch && Boolean(resolveActiveSession()),
      });
      if (
        closed
        || segmentEpoch !== epoch
        || abortController.signal.aborted
        || !resolveActiveSession()
      ) return;
      if (payload?.inputTurn?.outcome === 'no-speech') {
        resetSegment();
        // A no-speech turn on a VOCALISE drill (hum/SOVT/siren/sustained) is
        // wordless PRACTICE, not a lost take: the runtime marks it and supplies
        // a deterministic acknowledgment line. The live client distinguishes the
        // two by `recoveredFrom` — 'asr-no-speech' means the take was lost,
        // 'wordless-practice-ack' means nothing was lost — and renders
        // `coachLine` into the coach thread when one is carried.
        const wordless = payload.inputTurn.wordlessPractice === true;
        const semanticRetry = payload.inputTurn.semanticRetry === true;
        const coachLine = typeof payload.inputTurn.coachLine === 'string'
          ? payload.inputTurn.coachLine.trim()
          : '';
        send({
          event: 'capture-ready',
          sessionId,
          liveSessionId,
          recoveredFrom: semanticRetry
            ? 'semantic-retry'
            : (wordless ? 'wordless-practice-ack' : 'asr-no-speech'),
          ...((wordless || semanticRetry) && coachLine ? { coachLine } : {}),
        });
        witness('info', semanticRetry
          ? 'Sentence words were unavailable; spoken retry requested.'
          : (wordless
            ? 'Wordless vocalise practice acknowledged; listening continued.'
            : 'ASR rejected a non-speech capture; listening continued.'), {
          outcome: semanticRetry
            ? 'semantic-retry'
            : (wordless ? 'wordless-practice-ack' : 'asr-no-speech'),
          boundary: reason,
          asr_ms: Math.max(0, now() - asrStartedAt),
        });
        flushPendingFrames();
        return;
      }
      const transcript = typeof payload?.inputTurn?.transcript === 'string'
        ? payload.inputTurn.transcript.trim()
        : '';
      if (!transcript) throw new Error('Voice ASR returned no transcript.');
      const asrCompletedAt = now();
      send({
        ...payload,
        event: 'final-transcript',
        sessionId,
        liveSessionId,
        segmentId: currentSegmentId,
        transcript,
        confidence: payload?.inputTurn?.confidence ?? null,
        ...(typeof payload?.inputTurn?.listeningTurnId === 'string'
          && payload.inputTurn.listeningTurnId.trim()
          ? { listeningTurnId: payload.inputTurn.listeningTurnId }
          : {}),
        autoSubmit: true,
      });
      witness('info', 'Live ASR completed.', {
        outcome: 'asr-completed',
        boundary: reason,
        asr_ms: Math.max(0, asrCompletedAt - asrStartedAt),
        open_to_final_ms: segmentOpenedAt == null
          ? null
          : Math.max(0, asrCompletedAt - segmentOpenedAt),
      });
      resetSegment();
      flushPendingFrames();
    } catch (error) {
      // EVERY rejection is witnessed FIRST — including the discarded case that
      // used to `return` here with nothing logged anywhere. That silent return
      // is exactly how a live turn died unexplained on 2026-07-27: the socket
      // swallowed the throw, the client re-armed, and no journal line, sink row,
      // or client event named a cause.
      const discarded = closed || segmentEpoch !== epoch || abortController.signal.aborted;
      witnessTurnFailure(error, {
        boundary: reason,
        segmentId: currentSegmentId,
        discarded,
        asrMs: now() - asrStartedAt,
      });
      if (discarded) return;
      fail('asr-failed', error?.message || 'Voice ASR failed.');
    } finally {
      abortController = null;
    }
  }

  async function considerSemanticEndpoint(snapshotVoiceSample, epoch) {
    if (
      semanticPending
      || processing
      || closed
      || epoch !== segmentEpoch
      || !resolveActiveSession()
    ) return;
    semanticPending = true;
    semanticCheckedVoiceSample = snapshotVoiceSample;
    const pcmBuffer = Buffer.concat(segmentFrames, segmentBytes);
    const result = await detector.predict(pcmBuffer);
    semanticPending = false;
    if (
      closed
      || processing
      || epoch !== segmentEpoch
      || lastVoiceSample !== snapshotVoiceSample
    ) return;
    if (result?.available !== true) {
      witness('warn', 'Semantic endpoint unavailable; waiting for conservative silence.', {
        outcome: result?.reason || 'unavailable',
        fallback_silence_ms: policy.fallbackSilenceMs,
      });
      return;
    }
    const probability = Number(result.probability);
    witness('info', 'Semantic endpoint decision completed.', {
      outcome: result.complete === true && probability >= policy.semanticThreshold
        ? 'complete'
        : 'incomplete',
      probability_band: probability >= 0.8 ? 'high' : (probability >= policy.semanticThreshold ? 'medium' : 'low'),
      threshold: policy.semanticThreshold,
    });
    if (result.complete === true && Number.isFinite(probability) && probability >= policy.semanticThreshold) {
      await finalizeSegment('semantic', probability);
    }
  }

  function handlePcmFrame(value) {
    if (closed || !opened) return;
    const session = sessionId ? getSession(sessionId) : null;
    if (!session || !isSameSessionGeneration(session) || !canOpenSession(session, liveInputLeaseId)) {
      fail('session-stale', 'The Coach session is no longer active.');
      return;
    }
    const frame = Buffer.isBuffer(value) ? value : Buffer.from(value);
    if (!frame.length || frame.length % 2) {
      fail('invalid-pcm', 'Live voice input requires PCM16 frames.');
      return;
    }
    const sessionActive = isActiveSession(session);
    if (!transportHasPcm) {
      transportHasPcm = true;
      clearFirstPcmTimer();
      send({ event: 'capture-ready', sessionId, liveSessionId });
      witness('info', 'Live microphone transport confirmed.', {
        outcome: 'capture-ready',
        frame_bytes: frame.length,
        open_to_capture_ready_ms: openedAt == null ? null : Math.max(0, now() - openedAt),
        session_phase: sessionActive ? 'active' : 'starting',
      });
    }
    // A valid leased frame proves that the phone microphone/socket seam is
    // alive, which lets the two-phase Start lifecycle commit its active
    // checkpoint. Until that commit lands, never retain or process the audio.
    if (!sessionActive) return;
    if (processing) {
      // Defect 1: the learner is still speaking while the previous turn is in
      // ASR. Hold the audio; it seeds the next segment when the turn resolves.
      bufferPendingFrame(frame);
      return;
    }
    ingestFrame(frame);
  }

  /**
   * The per-frame path shared by live frames and replayed buffered frames:
   * accounting, the RMS voicing scan, and both endpoint tests.
   */
  function ingestFrame(frame) {
    receivedBytes += frame.length;
    if (firstPcmAt == null) {
      firstPcmAt = now();
      witness('info', 'First live PCM frame received.', {
        outcome: 'first-pcm',
        frame_bytes: frame.length,
        open_to_first_pcm_ms: segmentOpenedAt == null
          ? null
          : Math.max(0, firstPcmAt - segmentOpenedAt),
      });
    }
    segmentBytes += frame.length;
    if (segmentBytes > policy.maxAudioBytes) {
      fail('audio-too-large', 'This spoken turn is too long.');
      return;
    }
    segmentFrames.push(frame);
    const frameSamples = frame.length / 2;
    streamSamples += frameSamples;
    const isVoice = pcm16Rms(frame) >= policy.rmsThreshold;
    if (isVoice) {
      voicedSamples += frameSamples;
      // Sample index of THIS frame's start. `streamSamples` and `segmentFrames`
      // reset together, so the index addresses the concatenated segment PCM
      // directly — that is what makes the finalize-time trim free.
      if (firstVoiceSample == null) firstVoiceSample = streamSamples - frameSamples;
      lastVoiceSample = streamSamples;
      if (!segmentId) {
        segmentId = createId();
        speechDetectedAt = now();
        witness('info', 'Live speech evidence detected.', {
          outcome: 'speech-started',
          open_to_speech_ms: segmentOpenedAt == null
            ? null
            : Math.max(0, speechDetectedAt - segmentOpenedAt),
          rms_band: 'above-threshold',
        });
        send({ event: 'speech-start', sessionId, liveSessionId, segmentId });
      }
    }

    if (lastVoiceSample == null) {
      const elapsedMs = (streamSamples / 16000) * 1000;
      if (elapsedMs >= policy.noSpeechTimeoutMs) {
        send({ event: 'no-speech', sessionId, liveSessionId });
        resetSegment();
        streamSamples = 0;
      }
      return;
    }

    const silenceMs = ((streamSamples - lastVoiceSample) / 16000) * 1000;
    const voicedMs = (voicedSamples / 16000) * 1000;
    if (
      voicedMs >= CONSERVATIVE_MIN_SPEECH_MS
      && silenceMs >= policy.fallbackSilenceMs
    ) {
      fallbackTurns += 1;
      try { options.onFallback?.(); } catch { /* telemetry must not affect capture */ }
      witness('info', 'Conservative silence boundary accepted.', {
        outcome: 'fallback-endpoint',
        silence_ms: Math.round(silenceMs),
        voiced_ms: Math.round(voicedMs),
        fallback_turns: fallbackTurns,
      });
      void finalizeSegment('conservative-fallback');
      return;
    }
    if (voicedMs < policy.minSpeechMs) return;
    if (
      silenceMs >= policy.candidateSilenceMs
      && !semanticPending
      && semanticCheckedVoiceSample !== lastVoiceSample
    ) {
      void considerSemanticEndpoint(lastVoiceSample, segmentEpoch);
    }
  }

  function handleControl(value) {
    let payload;
    try {
      payload = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value));
    } catch {
      fail('invalid-control', 'Live voice input control message is invalid.');
      return;
    }
    if (payload?.type === 'ping') {
      send({ event: 'pong' });
      return;
    }
    if (payload?.type === 'stop') {
      close('client-stop');
      return;
    }
    if (payload?.type !== 'open' || opened) {
      fail('invalid-control', 'Open the live voice input session first.');
      return;
    }
    const requestedSessionId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
    const requestedLeaseId = typeof payload.liveInputLeaseId === 'string'
      ? payload.liveInputLeaseId.trim().slice(0, 160)
      : '';
    const requestedSession = requestedSessionId ? getSession(requestedSessionId) : null;
    if (!requestedSession || !canOpenSession(requestedSession, requestedLeaseId || null)) {
      fail('session-not-found', 'The Coach session is not active.');
      return;
    }
    if (Number(payload.sampleRate) !== 16000) {
      fail('sample-rate', 'Live voice input requires 16 kHz PCM.');
      return;
    }
    sessionId = requestedSessionId;
    sessionGeneration = getSessionGeneration(requestedSession);
    liveInputLeaseId = requestedLeaseId || null;
    liveSessionId = createId();
    policy = normalizePolicy({
      ...basePolicy,
      rmsThreshold: payload.rmsThreshold,
      noSpeechTimeoutMs: payload.noSpeechTimeoutMs,
      minSpeechMs: payload.minSpeechMs,
      // Included only so normalization can explicitly discard client attempts
      // to change the locked 1800/4500 endpoint policy.
      candidateSilenceMs: payload.candidateSilenceMs,
      fallbackSilenceMs: payload.silenceHoldMs,
    });
    opened = true;
    openedAt = now();
    segmentOpenedAt = openedAt;
    witness('info', 'Live input session opened.', {
      outcome: 'session-opened',
      sample_rate: 16000,
      candidate_silence_ms: policy.candidateSilenceMs,
      fallback_silence_ms: policy.fallbackSilenceMs,
      min_speech_ms: policy.minSpeechMs,
      rms_threshold: Number(policy.rmsThreshold.toFixed(4)),
      first_pcm_timeout_ms: firstPcmTimeoutMs,
    });
    send({
      event: 'session-started',
      sessionId,
      liveSessionId,
      sessionGeneration,
      sampleRate: 16000,
      turnPolicy: {
        semanticEndpoint: detector.getStatus?.().state === 'ready',
        candidateSilenceMs: policy.candidateSilenceMs,
        conservativeSilenceMs: policy.fallbackSilenceMs,
      },
    });
    firstPcmTimer = setTimeoutImpl(() => {
      firstPcmTimer = null;
      if (closed || transportHasPcm) return;
      witness('warn', 'Live input opened but no PCM frame arrived.', {
        outcome: 'first-pcm-timeout',
        first_pcm_timeout_ms: firstPcmTimeoutMs,
      });
      fail('pcm-timeout', 'Microphone audio did not begin.');
    }, firstPcmTimeoutMs);
    firstPcmTimer?.unref?.();
  }

  function handleMessage(value, isBinary = false) {
    if (closed) return;
    if (isBinary) handlePcmFrame(value);
    else handleControl(value);
  }

  function close(reason = 'closed') {
    if (closed) return;
    closed = true;
    clearFirstPcmTimer();
    segmentEpoch += 1;
    abortController?.abort?.(reason);
    abortController = null;
    segmentFrames = [];
    segmentBytes = 0;
    pendingFrames = [];
    pendingBytes = 0;
    pendingDroppedFrames = 0;
    if (socket?.readyState === 1 && typeof socket.close === 'function') {
      try { socket.close(1000, String(reason).slice(0, 120)); } catch { /* already closing */ }
    }
  }

  function getStatus() {
    return {
      opened,
      closed,
      processing,
      sessionId,
      liveSessionId,
      receivedBytes,
      droppedFrames,
      pendingFrames: pendingFrames.length,
      pendingBytes,
      fallbackTurns,
      transportHasPcm,
      detector: detector.getStatus?.() || null,
    };
  }

  socket?.on?.('message', handleMessage);
  socket?.once?.('close', () => close('socket-close'));
  socket?.once?.('error', () => close('socket-error'));

  return { close, getStatus, handleMessage };
}

function createVoiceInputLiveService(options = {}) {
  const connections = new Set();
  const WebSocketServerCtor = options.WebSocketServerCtor || WebSocket.Server;
  const webSocketServer = options.webSocketServer || new WebSocketServerCtor({ noServer: true });
  let attached = false;
  let upgradeHandler = null;
  let fallbackCount = 0;

  webSocketServer.on?.('connection', (socket) => {
    const connection = createVoiceInputLiveConnection({
      socket,
      getSession: options.getSession,
      getSessionGeneration: options.getSessionGeneration,
      canOpenSession: options.canOpenSession,
      isSessionActive: options.isSessionActive,
      submitTurn: options.submitTurn,
      detector: options.detector,
      policy: options.policy,
      firstPcmTimeoutMs: options.firstPcmTimeoutMs,
      setTimeoutImpl: options.setTimeoutImpl,
      clearTimeoutImpl: options.clearTimeoutImpl,
      onWitness: options.onWitness,
      onFallback: () => { fallbackCount += 1; },
    });
    connections.add(connection);
    socket.once?.('close', () => connections.delete(connection));
  });

  function attach(server, attachOptions = {}) {
    if (attached) return;
    const authorizeUpgrade = attachOptions.authorizeUpgrade || options.authorizeUpgrade || (() => ({ allowed: false }));
    upgradeHandler = (req, socket, head) => {
      const pathname = String(req.url || '').split('?')[0];
      if (pathname !== '/voice/input/live') return;
      const authorization = authorizeUpgrade(req);
      if (!authorization?.allowed) {
        if (!socket.destroyed) {
          socket.write?.('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
          socket.destroy?.();
        }
        return;
      }
      webSocketServer.handleUpgrade(req, socket, head, (client) => {
        webSocketServer.emit('connection', client, req);
      });
    };
    server.on('upgrade', upgradeHandler);
    attached = true;
  }

  function getStatus() {
    const detectorStatus = options.detector?.getStatus?.() || null;
    return {
      attached,
      activeConnections: connections.size,
      detector: detectorStatus,
      fallbackCount,
    };
  }

  function closeSession(sessionId, reason = 'session-stopped') {
    const normalized = typeof sessionId === 'string' ? sessionId.trim() : '';
    if (!normalized) return 0;
    let closedCount = 0;
    for (const connection of connections) {
      if (connection.getStatus().sessionId !== normalized) continue;
      connection.close(reason);
      connections.delete(connection);
      closedCount += 1;
    }
    return closedCount;
  }

  function close() {
    for (const connection of connections) connection.close('service-close');
    connections.clear();
    options.detector?.close?.();
    webSocketServer.close?.();
  }

  return { attach, close, closeSession, getStatus, webSocketServer };
}

module.exports = {
  DEFAULT_POLICY,
  createVoiceInputLiveConnection,
  createVoiceInputLiveService,
  encodePcm16Wav,
  normalizePolicy,
  pcm16Rms,
};
