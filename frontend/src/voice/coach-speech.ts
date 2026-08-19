import type { VoiceCoachMessage } from './state';
import type { VoiceCoachSpeechProvider, VoiceSpeechEmphasis } from './contracts';
import { VOICE_COACH_SPEAKING_RATE } from './coach-speech-rate';
import { TurnTelemetry } from './turn-telemetry';
import { createPcmStreamPlayer, isStreamingPcmResponse, type PcmStreamPlayerHandle } from './audio/pcm-stream-player';
import { decodeTutorMetricTrackHeader } from './coach-graph';

export type { VoiceCoachSpeechProvider } from './contracts';

export const VOICE_TUTOR_METRIC_TRACK_EVENT = 'voice-tutor-metric-track';

export type VoiceTutorMetricTrackDetail = {
  encodedTrack: string | null;
  invalidHeaderLength?: number;
};

type VoiceCoachSpeechControllerOptions = {
  kernelUrl: string;
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
  };
  getRequestedProvider: () => VoiceCoachSpeechProvider;
  setLastSpokenCoachMessageId: (messageId: string | null) => void;
  getLastSpokenCoachMessageId: () => string | null;
  setVoxCpmStatus: (status: { available: boolean | null; error: string | null }) => void;
  onPlaybackFinished: () => Promise<void> | void;
  onPlaybackError: (message: string) => void;
  onPlaybackStateChange?: (playing: boolean) => void;
  onSelectedVoiceFailure?: () => void;
  onRender: () => void;
  fetchImpl?: typeof fetch;
  createAudio?: () => HTMLAudioElement;
  createPcmPlayer?: () => PcmStreamPlayerHandle | null;
  pcmCompletionGraceMs?: number;
  playedAcknowledgementTimeoutMs?: number;
  /**
   * Optional hook to provide a turnId for the current coaching turn. The
   * controller will create a fresh TurnTelemetry when this returns a string.
   */
  getTurnId?: () => string | null;
  getReferenceClipId?: () => string | null;
  getTargetPreset?: () => string;
  getDefaultSpeakingRate?: () => number;
  /**
   * Surfacing wave (honesty): called with the parsed `X-Reference-Resolved`
   * header of a speech response. False means the selected reference could not
   * be used and playback must remain silent. Absent header -> not called.
   * Optional so transports/tests stay unchanged.
   */
  onReferenceResolution?: (resolved: boolean) => void;
};

// Word-emphasis channel — the ONLY utterance kinds that carry it. These two ARE
// the practice line being demonstrated, so the gateway may reshape their clause
// structure around the stressed word. Coach free-speech replies are excluded by
// construction: their prosody hint stays the LLM's job, and `scope-ack` chirps
// ("got it") contain no card word at all.
const VOICE_LINE_DEMO_KINDS = ['hear-line', 'eyes-free'];

function asEmphasisIndex(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function resolveVoiceSpeechEmphasis(
  message: VoiceCoachMessage,
): { word: string; tokenIndex: number | null; occurrence: number | null } | null {
  if (!VOICE_LINE_DEMO_KINDS.includes(message.kind)) return null;
  const emphasis: VoiceSpeechEmphasis | null | undefined = message.emphasis;
  if (!emphasis) return null;
  const word = typeof emphasis.word === 'string' ? emphasis.word.trim() : '';
  if (!word) return null;
  const occurrence = asEmphasisIndex(emphasis.occurrence);
  // The occurrence is what the gateway resolves against; without it we would be
  // asking the gateway to guess which copy of the word to stress.
  if (occurrence === null) return null;
  return { word, tokenIndex: asEmphasisIndex(emphasis.tokenIndex), occurrence };
}

function createVoiceCoachAbortError(message: string): Error {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function createVoiceCoachTimeoutError(message: string): Error {
  const error = new Error(message);
  error.name = 'TimeoutError';
  return error;
}

function hasVerifiedSelectedVoiceSynthesis(response: Response): boolean {
  const appliedRate = response.headers.get('X-Speaking-Rate-Applied');
  return response.headers.get('X-Voice-Cloned')?.trim().toLowerCase() === 'true'
    && response.headers.get('X-TTS-Generation-Mode')?.trim().toLowerCase() === 'cloned-synthesis'
    && response.headers.get('X-Reference-Audio-Role')?.trim().toLowerCase() === 'conditioning-only'
    && appliedRate !== null
    && Number.isFinite(Number(appliedRate));
}

function reportSpeechTelemetry(
  level: 'error' | 'warn' | 'info',
  seam: 'tts-playback' | 'tts-synthesis',
  failureClass: 'ok' | 'partial-function',
  eventCode: 'pcm-overflow' | 'pcm-underrun' | 'pcm-playback-complete' | 'playback-interrupted' | 'target-text-generated',
  status: 'failed' | 'succeeded',
  data: Record<string, unknown> = {},
): void {
  try {
    const telemetry = (globalThis as typeof globalThis & {
      __tvTelemetry?: {
        event: (
          level: 'error' | 'warn' | 'info',
          seam: string,
          failureClass: string,
          eventCode: string,
          data?: Record<string, unknown>,
        ) => void;
      };
    }).__tvTelemetry;
    telemetry?.event(level, seam, failureClass, eventCode, { status, ...data });
  } catch {
    // The synthesis/playback contract remains authoritative; telemetry is advisory.
  }
}

function reportVerifiedSpeechSynthesis(): void {
  reportSpeechTelemetry('info', 'tts-synthesis', 'ok', 'target-text-generated', 'succeeded');
}

/** Publish every first-audio boundary so an absent track invalidates the prior tutor ghost. */
function publishTutorMetricTrack(encodedTrack: string | null): void {
  if (typeof document === 'undefined') return;
  const EventConstructor = document.defaultView?.CustomEvent;
  if (!EventConstructor) return;
  const candidate = typeof encodedTrack === 'string' && encodedTrack.trim()
    ? encodedTrack.trim()
    : null;
  const value = candidate && decodeTutorMetricTrackHeader(candidate) ? candidate : null;
  const invalidHeaderLength = candidate && value === null ? candidate.length : undefined;
  try {
    document.dispatchEvent(new EventConstructor(VOICE_TUTOR_METRIC_TRACK_EVENT, {
      detail: {
        encodedTrack: value,
        ...(invalidHeaderLength === undefined ? {} : { invalidHeaderLength }),
      } satisfies VoiceTutorMetricTrackDetail,
    }));
  } catch {
    // Metric display is fail-soft and must never interrupt speech playback.
  }
}

function waitForPcmPlaybackCompletion(
  player: PcmStreamPlayerHandle,
  controller: AbortController,
  completionGraceMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let offEnded: () => void = () => undefined;
    let offFailed: () => void = () => undefined;
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const cleanup = () => {
      if (timeout) clearTimeout(timeout);
      offEnded();
      offFailed();
      controller.signal.removeEventListener('abort', onAbort);
    };
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onFailed = (detail: { error: Error }) => {
      cleanup();
      reject(detail.error);
    };
    const onAbort = () => {
      cleanup();
      reject(createVoiceCoachAbortError('Voice speech cancelled.'));
    };
    const onTimeout = () => {
      cleanup();
      player.abort();
      reportSpeechTelemetry(
        'error',
        'tts-playback',
        'partial-function',
        'playback-interrupted',
        'failed',
      );
      reject(createVoiceCoachTimeoutError('PCM playback stalled before completion.'));
    };

    offEnded = player.on('ended', onEnded);
    offFailed = player.on('failed', onFailed);
    controller.signal.addEventListener('abort', onAbort, { once: true });

    const current = player.getState();
    const queuedSamples = Number.isFinite(current.totalSamplesQueued)
      ? Math.max(0, current.totalSamplesQueued)
      : 0;
    const playedSamples = Number.isFinite(current.totalSamplesPlayed)
      ? Math.max(0, current.totalSamplesPlayed)
      : 0;
    const sampleRate = Number.isFinite(current.playbackSampleRate) && Number(current.playbackSampleRate) > 0
      ? Number(current.playbackSampleRate)
      : Number.isFinite(current.sampleRate) && Number(current.sampleRate) > 0
        ? Number(current.sampleRate)
      : 48_000;
    const remainingDurationMs = Math.max(0, queuedSamples - playedSamples) / sampleRate * 1000;
    timeout = setTimeout(
      onTimeout,
      Math.max(25, Math.ceil(remainingDurationMs + completionGraceMs)),
    );
    if (current.status === 'ended') {
      onEnded();
    } else if (current.status === 'failed') {
      onFailed({ error: new Error(current.error || 'PCM playback failed.') });
    } else if (controller.signal.aborted) {
      onAbort();
    }
  });
}

async function readVoiceSpeechError(response: Response): Promise<string> {
  try {
    const payload = await response.json();
    if (payload && typeof payload.error === 'string' && payload.error.trim()) {
      return payload.error.trim();
    }
  } catch {
    // Fall through to text parsing.
  }

  try {
    const text = await response.text();
    if (typeof text === 'string' && text.trim()) {
      return text.trim();
    }
  } catch {
    // Fall through to generic HTTP message.
  }

  return `HTTP ${response.status}`;
}

function playVoiceCoachAudio(audio: HTMLAudioElement): Promise<void> {
  const playback = audio.play();
  if (playback && typeof playback.then === 'function') {
    return playback.then(() => undefined);
  }
  return Promise.resolve();
}

function waitForVoiceCoachAudioCompletion(audio: HTMLAudioElement, controller: AbortController): Promise<void> {
  return new Promise((resolve, reject) => {
    const onEnded = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('VoxCPM audio playback failed.'));
    };
    const onAbort = () => {
      cleanup();
      reject(createVoiceCoachAbortError('Voice speech cancelled.'));
    };
    const cleanup = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
      controller.signal.removeEventListener('abort', onAbort);
    };

    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onError, { once: true });
    controller.signal.addEventListener('abort', onAbort, { once: true });
    if (controller.signal.aborted) {
      onAbort();
    }
  });
}

function appendVoiceCoachSourceBufferChunk(
  sourceBuffer: SourceBuffer,
  chunk: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const onUpdateEnd = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error('VoxCPM stream buffer append failed.'));
    };
    const onAbort = () => {
      cleanup();
      reject(createVoiceCoachAbortError('Voice speech cancelled during buffer append.'));
    };
    const cleanup = () => {
      sourceBuffer.removeEventListener('updateend', onUpdateEnd);
      sourceBuffer.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
    };

    sourceBuffer.addEventListener('updateend', onUpdateEnd, { once: true });
    sourceBuffer.addEventListener('error', onError, { once: true });
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }
    try {
      sourceBuffer.appendBuffer(chunk);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}

export function createVoiceCoachSpeechController(options: VoiceCoachSpeechControllerOptions) {
  let playbackToken = 0;
  let activeAudioEl: HTMLAudioElement | null = null;
  let activeAbortController: AbortController | null = null;
  let activeObjectUrl: string | null = null;
  let activePcmPlayer: PcmStreamPlayerHandle | null = null;
  let activeVoxCpmPlayback: {
    controller: AbortController;
    streamId: string | null;
  } | null = null;
  let audiblePlayback = false;

  const fetchImpl = options.fetchImpl || fetch;
  const createAudio = options.createAudio || (() => new Audio());
  const createPcmPlayer = options.createPcmPlayer || createPcmStreamPlayer;
  const pcmCompletionGraceMs = Math.max(25, options.pcmCompletionGraceMs ?? 4000);
  const playedAcknowledgementTimeoutMs = Math.max(25, options.playedAcknowledgementTimeoutMs ?? 1500);

  const isCurrentPlayback = (token: number) => token === playbackToken;
  const setAudiblePlayback = (playing: boolean) => {
    if (audiblePlayback === playing) return;
    audiblePlayback = playing;
    options.onPlaybackStateChange?.(playing);
  };
  const hasActivePlayback = () => Boolean(
    activeAbortController
    || activeAudioEl
    || activeObjectUrl
    || activePcmPlayer
    || (
      'speechSynthesis' in window
      && Boolean(window.speechSynthesis.speaking || window.speechSynthesis.pending)
    ),
  );

  const cleanupPlaybackResources = () => {
    if (activeAbortController && !activeAbortController.signal.aborted) {
      activeAbortController.abort();
    }
    activeAbortController = null;

    if (activePcmPlayer) {
      activePcmPlayer.abort();
      activePcmPlayer = null;
    }

    if (activeAudioEl) {
      activeAudioEl.pause();
      activeAudioEl.removeAttribute('src');
      activeAudioEl.load();
      activeAudioEl.onended = null;
      activeAudioEl.onerror = null;
      activeAudioEl = null;
    }
    if (activeObjectUrl) {
      URL.revokeObjectURL(activeObjectUrl);
      activeObjectUrl = null;
    }
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setAudiblePlayback(false);
  };

  const finishPlaybackTurn = (token: number) => {
    window.setTimeout(() => {
      if (!isCurrentPlayback(token)) {
        return;
      }
      Promise.resolve(options.onPlaybackFinished())
        .catch(() => undefined)
        .finally(() => {
          options.onRender();
        });
    }, 120);
  };

  async function playVoiceCoachSpeechResponse(
    response: Response,
    controller: AbortController,
    token: number,
    telemetry: TurnTelemetry | null = null,
  ): Promise<void> {
    const contentType = response.headers.get('content-type') || 'audio/mpeg';
    const audioFormat = response.headers.get('X-Audio-Format');
    const encodedTutorMetricTrack = response.headers.get('X-Tutor-Metric-Track');
    let tutorMetricTrackPublished = false;
    let pcmPlayer: PcmStreamPlayerHandle | null = null;

    const publishMetricTrackOnce = (): void => {
      if (tutorMetricTrackPublished) return;
      tutorMetricTrackPublished = true;
      publishTutorMetricTrack(encodedTutorMetricTrack);
    };

    // Fast path: raw PCM streaming from the TTS service.
    // Plays chunks as they arrive (true streaming), no blob/element wait.
    if (isStreamingPcmResponse(response)) {
      pcmPlayer = createPcmPlayer();
      if (pcmPlayer) {
        activePcmPlayer = pcmPlayer;
        let firstAudioMarked = false;
        let underrunReported = false;
        const offFirstAudio = pcmPlayer.on('firstAudio', () => {
          if (firstAudioMarked || !isCurrentPlayback(token) || controller.signal.aborted) return;
          firstAudioMarked = true;
          publishMetricTrackOnce();
          if (!isCurrentPlayback(token) || controller.signal.aborted) return;
          setAudiblePlayback(true);
          if (telemetry) {
            telemetry.markFrontend('frontend_first_audio_at');
          }
        });
        const offUnderrun = pcmPlayer.on('underrun', () => {
          if (underrunReported) return;
          underrunReported = true;
          reportSpeechTelemetry('warn', 'tts-playback', 'partial-function', 'pcm-underrun', 'failed');
        });
        const offFailed = pcmPlayer.on('failed', (detail) => {
          reportSpeechTelemetry(
            'error',
            'tts-playback',
            'partial-function',
            /overflow/i.test(detail.error.message) ? 'pcm-overflow' : 'playback-interrupted',
            'failed',
          );
        });
        const linkedAbort = () => {
          pcmPlayer?.abort();
        };
        controller.signal.addEventListener('abort', linkedAbort, { once: true });
        try {
          await pcmPlayer.play(response, { signal: controller.signal });
          await waitForPcmPlaybackCompletion(pcmPlayer, controller, pcmCompletionGraceMs);
          const completed = pcmPlayer.getState();
          const playbackSampleRate = Number(completed.playbackSampleRate) || Number(completed.sampleRate) || 48_000;
          reportSpeechTelemetry(
            'info',
            'tts-playback',
            'ok',
            'pcm-playback-complete',
            'succeeded',
            {
              sourceSampleRate: Number(completed.sampleRate) || 0,
              playbackSampleRate,
              queuedSamples: Number(completed.totalSamplesQueued) || 0,
              playedSamples: Number(completed.totalSamplesPlayed) || 0,
              durationMs: playbackSampleRate > 0
                ? Math.round((Number(completed.totalSamplesPlayed) || 0) / playbackSampleRate * 1000)
                : 0,
              underrunCount: Number(completed.underrunCount) || 0,
            },
          );
          if (telemetry) {
            telemetry.markFrontend('playback_done_at');
          }
        } finally {
          if (isCurrentPlayback(token)) setAudiblePlayback(false);
          offFirstAudio();
          offUnderrun();
          offFailed();
          controller.signal.removeEventListener('abort', linkedAbort);
          pcmPlayer.dispose();
          if (activePcmPlayer === pcmPlayer) {
            activePcmPlayer = null;
          }
        }
        return;
      }
    }

    const audio = createAudio();
    audio.preload = 'auto';
    activeAudioEl = audio;
    let objectUrl: string | null = null;
    let firstAudioMarked = false;

    const markFirstAudio = () => {
      if (firstAudioMarked || !isCurrentPlayback(token) || controller.signal.aborted) return;
      firstAudioMarked = true;
      publishMetricTrackOnce();
      if (!isCurrentPlayback(token) || controller.signal.aborted) return;
      setAudiblePlayback(true);
      if (telemetry) {
        telemetry.markFrontend('frontend_first_audio_at');
      }
    };

    // `onplaying` fires when the audio element actually starts emitting sound,
    // which is the closest browser observable to "first audio plays".
    audio.addEventListener('playing', markFirstAudio, { once: true });

    try {
      if ('MediaSource' in window && response.body && MediaSource.isTypeSupported(contentType)) {
        const mediaSource = new MediaSource();
        objectUrl = URL.createObjectURL(mediaSource);
        activeObjectUrl = objectUrl;
        audio.src = objectUrl;

        const sourceBuffer = await new Promise<SourceBuffer>((resolve, reject) => {
          const cleanup = () => {
            mediaSource.removeEventListener('sourceopen', onSourceOpen);
            mediaSource.removeEventListener('error', onSourceError);
            controller.signal.removeEventListener('abort', onAbort);
          };
          const onSourceOpen = () => {
            cleanup();
            try {
              const nextSourceBuffer = mediaSource.addSourceBuffer(contentType);
              nextSourceBuffer.mode = 'sequence';
              resolve(nextSourceBuffer);
            } catch (error) {
              reject(error);
            }
          };
          const onSourceError = () => {
            cleanup();
            reject(new Error('VoxCPM media source failed to open.'));
          };
          const onAbort = () => {
            cleanup();
            reject(createVoiceCoachAbortError('Voice speech cancelled before media source opened.'));
          };
          mediaSource.addEventListener('sourceopen', onSourceOpen, { once: true });
          mediaSource.addEventListener('error', onSourceError, { once: true });
          controller.signal.addEventListener('abort', onAbort, { once: true });
          if (controller.signal.aborted) onAbort();
        });

        // Do not await play() before feeding MediaSource: its promise resolves
        // only once media can actually start, which requires the first appended
        // bytes. Start both sides, then join the playback promise after buffering.
        let playbackStartError: unknown = null;
        const playbackStarted = playVoiceCoachAudio(audio).catch((error) => {
          playbackStartError = error;
        });
        const reader = response.body.getReader();
        while (true) {
          if (controller.signal.aborted) {
            throw createVoiceCoachAbortError('Voice speech cancelled.');
          }
          const { done, value } = await reader.read();
          if (done) {
            break;
          }
          if (value?.length) {
            await appendVoiceCoachSourceBufferChunk(sourceBuffer, value, controller.signal);
          }
        }
        if (mediaSource.readyState === 'open' && !sourceBuffer.updating) {
          mediaSource.endOfStream();
        }
        await playbackStarted;
        if (playbackStartError) throw playbackStartError;
        await waitForVoiceCoachAudioCompletion(audio, controller);
        if (telemetry) {
          telemetry.markFrontend('playback_done_at');
        }
        return;
      }

      const audioBlob = await response.blob();
      if (controller.signal.aborted) {
        throw createVoiceCoachAbortError('Voice speech cancelled.');
      }
      objectUrl = URL.createObjectURL(audioBlob);
      activeObjectUrl = objectUrl;
      audio.src = objectUrl;
      await playVoiceCoachAudio(audio);
      await waitForVoiceCoachAudioCompletion(audio, controller);
      if (telemetry) {
        telemetry.markFrontend('playback_done_at');
      }
    } finally {
      if (isCurrentPlayback(token)) setAudiblePlayback(false);
      audio.removeEventListener('playing', markFirstAudio);
      // Release object URLs and audio element references after completion so they do not
      // accumulate across many coach turns (stop() is not always called after a normal completion).
      if (activeAudioEl === audio) {
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        audio.onended = null;
        audio.onerror = null;
        activeAudioEl = null;
      }
      if (objectUrl && activeObjectUrl === objectUrl) {
        URL.revokeObjectURL(objectUrl);
        activeObjectUrl = null;
      }
    }
  }

  function startBrowserSpeech(
    message: VoiceCoachMessage,
    token: number,
    rate = VOICE_COACH_SPEAKING_RATE,
    telemetry: TurnTelemetry | null = null,
    trackAsCoachReply = true,
  ): boolean {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return false;
    }

    const utterance = new SpeechSynthesisUtterance(message.content);
    utterance.rate = rate;
    utterance.pitch = 1.14;
    utterance.onstart = () => {
      if (!isCurrentPlayback(token)) return;
      publishTutorMetricTrack(null);
      if (!isCurrentPlayback(token)) return;
      setAudiblePlayback(true);
      if (telemetry) {
        telemetry.markFrontend('frontend_first_audio_at');
      }
    };
    utterance.onend = () => {
      if (!isCurrentPlayback(token)) return;
      setAudiblePlayback(false);
      if (telemetry) {
        telemetry.markFrontend('playback_done_at');
        if (telemetry.getFallback()) {
          void telemetry.sendTo(options.kernelUrl, fetchImpl);
        }
      }
      finishPlaybackTurn(token);
    };
    utterance.onerror = () => {
      if (!isCurrentPlayback(token)) return;
      setAudiblePlayback(false);
      if (telemetry) {
        telemetry.markFrontend('playback_done_at');
        if (telemetry.getFallback()) {
          void telemetry.sendTo(options.kernelUrl, fetchImpl);
        }
      }
      if (trackAsCoachReply && options.getLastSpokenCoachMessageId() === message.id) {
        options.setLastSpokenCoachMessageId(null);
      }
      options.onPlaybackError('Browser speech failed.');
      if (!isCurrentPlayback(token)) return;
      finishPlaybackTurn(token);
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      if (isCurrentPlayback(token)) setAudiblePlayback(false);
      options.onPlaybackError(`Browser speech failed: ${(error as Error).message || String(error)}`);
      return false;
    }
    if (trackAsCoachReply) {
      options.setLastSpokenCoachMessageId(message.id);
    }
    return true;
  }

  async function startVoxCpmSpeech(
    message: VoiceCoachMessage,
    token: number,
    rate = VOICE_COACH_SPEAKING_RATE,
    telemetry: TurnTelemetry | null = null,
    trackAsCoachReply = true,
  ): Promise<boolean> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      return false;
    }

    const controller = new AbortController();
    activeAbortController = controller;
    const voxCpmPlayback = { controller, streamId: null as string | null };
    activeVoxCpmPlayback = voxCpmPlayback;
    let playbackStarted = false;

    const speechBody: Record<string, unknown> = {
      sessionId: currentSessionId,
      turnId: telemetry?.turnId ?? undefined,
      targetText: message.content,
      speakingRate: rate,
      referenceClipId: options.getReferenceClipId?.() ?? null,
      targetPreset: options.getTargetPreset?.() ?? 'cute-feminine',
    };
    // Word-emphasis channel: line demos only. The gateway shapes target_text
    // into a comma-delimited clause around this word; the token index lets it
    // pick the right occurrence when the word repeats. Voice cloning is
    // untouched — referenceClipId and the clone gate are unchanged.
    const speechEmphasis = resolveVoiceSpeechEmphasis(message);
    if (speechEmphasis) {
      speechBody.emphasisWord = speechEmphasis.word;
      speechBody.emphasisOccurrence = speechEmphasis.occurrence;
      if (speechEmphasis.tokenIndex !== null) {
        // Deliberately NOT `emphasisTokenIndex`: that gateway field means "the
        // Nth whitespace token of the text I am sending you", which is a
        // different coordinate system from a practice-card token index. Sending
        // a card index under that name would be a selector the gateway could
        // act on and get wrong. This one is witness metadata only.
        speechBody.emphasisCardTokenIndex = speechEmphasis.tokenIndex;
      }
    }

    try {
      const response = await fetchImpl(`${options.kernelUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(speechBody),
        signal: controller.signal,
      });
      // A test double (or a race at response delivery) may resolve fetch after
      // abort. Reject stale ownership before publishing headers or allocating a
      // player, otherwise an old line can overwrite the current transport.
      if (
        controller.signal.aborted
        || !isCurrentPlayback(token)
        || activeVoxCpmPlayback !== voxCpmPlayback
      ) {
        throw createVoiceCoachAbortError('Voice speech superseded.');
      }
      // Surfacing wave (honesty): the speech Response is only available here on
      // the streaming path — read the reference-resolution header before the
      // HTTP status check so a fail-closed 409 is still visible to the learner.
      const referenceResolvedHeader = response.headers.get('X-Reference-Resolved');
      const referenceResolved = referenceResolvedHeader === null
        ? null
        : referenceResolvedHeader.trim().toLowerCase() !== 'false';
      if (referenceResolved !== null && options.onReferenceResolution) {
        try {
          options.onReferenceResolution(referenceResolved);
        } catch {
          /* honesty surface must never break playback */
        }
        if (!isCurrentPlayback(token) || controller.signal.aborted) {
          throw createVoiceCoachAbortError('Voice speech superseded during response handling.');
        }
      }
      if (!response.ok) {
        throw new Error(await readVoiceSpeechError(response));
      }
      // Product law: a selected preset is the tutor's voice, full stop. An
      // unresolved response must never reach the speaker under that name.
      if (options.getReferenceClipId?.() && referenceResolved === false) {
        throw new Error('Selected tutor voice did not resolve; speech was withheld.');
      }
      // Reference audio is conditioning only. For a selected preset, refuse to
      // play any response that does not prove it is newly generated target-text
      // synthesis in the cloned voice.
      if (options.getReferenceClipId?.() && !hasVerifiedSelectedVoiceSynthesis(response)) {
        throw new Error('Selected tutor voice synthesis was not verified; speech was withheld.');
      }
      reportVerifiedSpeechSynthesis();
      if (
        activeVoxCpmPlayback === voxCpmPlayback
        && isCurrentPlayback(token)
        && !controller.signal.aborted
      ) {
        voxCpmPlayback.streamId = response.headers.get('X-Voice-Speech-Stream-Id')?.trim() || null;
      }
      playbackStarted = true;
      await playVoiceCoachSpeechResponse(response, controller, token, telemetry);
      if (trackAsCoachReply && options.getReferenceClipId?.() && isCurrentPlayback(token)) {
        // The acknowledgement updates a durable spoke clock, but it is not part
        // of audible playback and must never hold the learner turn open.
        const acknowledgementController = new AbortController();
        const acknowledgementTimeout = window.setTimeout(
          () => acknowledgementController.abort(),
          playedAcknowledgementTimeoutMs,
        );
        try {
          await fetchImpl(`${options.kernelUrl}/voice/speech/played`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: currentSessionId, provider: 'voxcpm' }),
            keepalive: true,
            signal: acknowledgementController.signal,
          }).catch(() => null);
        } finally {
          window.clearTimeout(acknowledgementTimeout);
        }
      }
      if (telemetry) {
        void telemetry.sendTo(options.kernelUrl, fetchImpl);
      }
      if (isCurrentPlayback(token)) {
        finishPlaybackTurn(token);
      }
      return true;
    } catch (error) {
      if (activeAbortController === controller) {
        activeAbortController = null;
      }

      if (controller.signal.aborted || (error as Error).name === 'AbortError') {
        if (telemetry) {
          telemetry.markFrontend('playback_done_at');
          telemetry.setFallback('tts_cancelled');
          void telemetry.sendTo(options.kernelUrl, fetchImpl);
        }
        return false;
      }

      if (options.getReferenceClipId?.()) {
        options.onSelectedVoiceFailure?.();
        if (!isCurrentPlayback(token)) return false;
      }

      options.onPlaybackError(`VoxCPM speech failed: ${(error as Error).message}`);
      if (!isCurrentPlayback(token)) return false;

      const isTransientError = (err: unknown): boolean => {
        if (err instanceof DOMException && err.name === 'AbortError') return true;
        if (err instanceof Error && err.name === 'AbortError') return true;
        if (err instanceof DOMException && err.name === 'TimeoutError') return true;
        if (err instanceof Error && err.name === 'TimeoutError') return true;
        if (err instanceof Error && /timeout/i.test(err.message)) return true;
        return false;
      };

      if (!isTransientError(error)) {
        options.setVoxCpmStatus({
          available: false,
          error: (error as Error).message,
        });
        if (!isCurrentPlayback(token)) return false;
      }

      // Generic browser TTS is only a legacy fallback when no reference voice
      // has been selected. Once a preset exists, silence is more honest than a
      // different voice.
      if (!playbackStarted && !options.getReferenceClipId?.() && 'speechSynthesis' in window) {
        if (telemetry) {
          telemetry.setFallback('voxcpm_failed_browser_fallback');
        }
        const fallbackStarted = startBrowserSpeech(message, token, rate, telemetry, trackAsCoachReply);
        if (trackAsCoachReply && !fallbackStarted && options.getLastSpokenCoachMessageId() === message.id) {
          options.setLastSpokenCoachMessageId(null);
        }
        options.onRender();
        return fallbackStarted;
      }

      if (trackAsCoachReply && options.getLastSpokenCoachMessageId() === message.id) {
        options.setLastSpokenCoachMessageId(null);
      }
      if (isCurrentPlayback(token)) {
        finishPlaybackTurn(token);
      }
      options.onRender();
      return false;
    } finally {
      if (activeAbortController === controller) {
        activeAbortController = null;
      }
      if (activeVoxCpmPlayback === voxCpmPlayback) {
        activeVoxCpmPlayback = null;
      }
    }
  }

  function stop(): void {
    const hadActivePlayback = hasActivePlayback();
    const voxCpmPlayback = activeVoxCpmPlayback;
    const streamId = voxCpmPlayback?.streamId ?? null;
    playbackToken += 1;
    cleanupPlaybackResources();

    const { currentSessionId, isConnected } = options.getSessionContext();
    if ((voxCpmPlayback || options.getRequestedProvider() === 'voxcpm') && currentSessionId && isConnected) {
      void fetchImpl(`${options.kernelUrl}/voice/speech/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: currentSessionId,
          streamId,
          reason: 'Voice speech cancelled by the frontend runtime.',
        }),
        keepalive: true,
      }).catch(() => null);
    }
    if (activeVoxCpmPlayback === voxCpmPlayback) {
      activeVoxCpmPlayback = null;
    }
    if (!hadActivePlayback) {
      return;
    }
    options.onRender();
  }

  function speak(
    message: VoiceCoachMessage,
    optionsForSpeak: {
      provider: VoiceCoachSpeechProvider;
      rate?: number;
    },
  ): boolean {
    // One transport owns the speaker. A newer line supersedes every pending or
    // audible path before claiming a fresh token, so stale first-audio events
    // cannot publish an old tutor track over the new one.
    if (hasActivePlayback()) stop();
    else playbackToken += 1;
    const token = playbackToken;
    const { currentSessionId } = options.getSessionContext();
    const trackAsCoachReply = !['hear-line', 'eyes-free', 'scope-ack'].includes(message.kind);
    const explicitTurnId = trackAsCoachReply ? (options.getTurnId?.() ?? null) : null;
    // If a turnId was provided (e.g. from a coach response), mirror it; if
    // not, generate one so the fallback browser path still has telemetry
    // to send.
    const turnId = explicitTurnId || `turn-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
    const telemetry = new TurnTelemetry({ turnId, sessionId: currentSessionId });
    const configuredRate = Number(options.getDefaultSpeakingRate?.());
    const defaultRate = Number.isFinite(configuredRate)
      ? Math.max(0.5, Math.min(1.25, configuredRate))
      : VOICE_COACH_SPEAKING_RATE;
    const speakingRate = optionsForSpeak.rate ?? defaultRate;
    const selectedReferenceClipId = options.getReferenceClipId?.() ?? null;
    if (optionsForSpeak.provider === 'voxcpm' || selectedReferenceClipId) {
      // Claim the message synchronously. Render handoffs may run again before
      // the async fetch resolves; delaying this marker until the response lets
      // every render enqueue the same utterance again.
      if (trackAsCoachReply) {
        options.setLastSpokenCoachMessageId(message.id);
      }
      void startVoxCpmSpeech(message, token, speakingRate, telemetry, trackAsCoachReply);
      return true;
    }
    telemetry.setFallback('browser_tts_direct');
    return startBrowserSpeech(message, token, speakingRate, telemetry, trackAsCoachReply);
  }

  return {
    speak,
    stop,
    /**
     * Surfacing wave: live speaking probe (any active playback path — PCM
     * stream, media element, or browser speechSynthesis). Read-only.
     */
    isSpeaking: () => hasActivePlayback(),
    // Unlike isSpeaking(), this is true only after the browser reports the
    // first audible frame and becomes false again when sound ends or aborts.
    isPlaying: () => audiblePlayback,
  };
}
