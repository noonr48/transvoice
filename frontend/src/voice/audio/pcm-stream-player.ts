/**
 * pcm-stream-player.ts
 *
 * Streaming PCM playback for VoxCPM TTS responses.
 *
 * The VoxCPM TTS service at /v1/tts/stream returns raw PCM chunks (not WAV) with
 * metadata in response headers:
 *   X-Audio-Format: pcm_s16le | pcm_f32le
 *   X-Audio-Sample-Rate: <hz>
 *   X-Audio-Channels: <n>
 *
 * This module consumes the streaming response, converts Int16LE / Float32LE chunks
 * into Float32 frames, and feeds them to an AudioWorklet ring buffer that renders
 * to the AudioContext destination. First audio plays as soon as the worklet
 * receives its first batch of samples — there is no buffering of the entire
 * synthesis.
 *
 * The implementation falls back gracefully:
 *   - If the worklet cannot be loaded, play() throws so the caller can fall back
 *     to the existing blob-based path.
 *   - AbortController cooperates with fetch's AbortSignal so callers can cancel
 *     mid-stream.
 *   - The events API mirrors typical streaming media clients: started,
 *     firstAudio, underrun, ended, failed.
 */
import { createVoiceAudioContext } from './audio-context';
import { StreamingLinearResampler } from './pcm16-resampler';

export type PcmStreamFormat = 'pcm_s16le' | 'pcm_f32le';

export type PcmStreamPlayerEventName =
  | 'started'
  | 'firstAudio'
  | 'underrun'
  | 'ended'
  | 'failed';

export type PcmStreamPlayerEventMap = {
  started: PcmStreamPlayerStartedDetail;
  firstAudio: PcmStreamPlayerFirstAudioDetail;
  underrun: PcmStreamPlayerUnderrunDetail;
  ended: PcmStreamPlayerEndedDetail;
  failed: PcmStreamPlayerFailedDetail;
};

export type PcmStreamPlayerStartedDetail = {
  sampleRate: number;
  playbackSampleRate: number;
  channels: number;
  format: PcmStreamFormat;
  ringBufferSamples: number;
};

export type PcmStreamPlayerFirstAudioDetail = {
  queuedSamples: number;
  latencyMs: number;
  playedAt: number;
};

export type PcmStreamPlayerUnderrunDetail = {
  count: number;
  deficitSamples: number;
  at: number;
};

export type PcmStreamPlayerEndedDetail = {
  totalSamplesPlayed: number;
  durationMs: number;
  at: number;
};

export type PcmStreamPlayerFailedDetail = {
  error: Error;
  at: number;
};

export type PcmStreamPlayerEventHandler<K extends PcmStreamPlayerEventName> = (
  detail: PcmStreamPlayerEventMap[K],
) => void;

export type PcmStreamPlayerStatus = 'idle' | 'loading' | 'streaming' | 'ended' | 'failed';

export type PcmStreamPlayerState = {
  status: PcmStreamPlayerStatus;
  sampleRate: number | null;
  playbackSampleRate: number | null;
  channels: number | null;
  format: PcmStreamFormat | null;
  totalSamplesQueued: number;
  totalSamplesPlayed: number;
  underrunCount: number;
  firstAudioAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  error: string | null;
};

export type PcmStreamPlayerOptions = {
  audioContext?: AudioContext;
  workletUrl?: string;
  ringBufferSeconds?: number;
  ringBufferSamples?: number;
  expectedFormat?: PcmStreamFormat;
  expectedSampleRate?: number;
  expectedChannels?: number;
  fetchImpl?: typeof fetch;
  ringBufferResample?: boolean;
  capacityWaitTimeoutMs?: number;
  resumeWaitTimeoutMs?: number;
  createWorkletNode?: (
    context: AudioContext,
    processorOptions: { ringBufferSeconds: number; ringBufferSamples: number },
  ) => AudioWorkletNode;
};

export type PcmStreamPlayerPlayOptions = {
  signal?: AbortSignal;
};

export type PcmStreamPlayerHandle = {
  play: (source: string | Response, options?: PcmStreamPlayerPlayOptions) => Promise<void>;
  abort: () => void;
  dispose: () => void;
  on: <K extends PcmStreamPlayerEventName>(
    event: K,
    handler: PcmStreamPlayerEventHandler<K>,
  ) => () => void;
  off: <K extends PcmStreamPlayerEventName>(
    event: K,
    handler: PcmStreamPlayerEventHandler<K>,
  ) => void;
  getState: () => PcmStreamPlayerState;
  getAudioContext: () => AudioContext | null;
  getWorkletNode: () => AudioWorkletNode | null;
};

export const PCM_STREAM_PLAYER_PROCESSOR_NAME = 'sloane-pcm-stream-player';
export const PCM_STREAM_PLAYER_DEFAULT_WORKLET_URL = '/worklets/pcm-stream-player.worklet.js';

const DEFAULT_RING_BUFFER_SECONDS = 0.2;
const DEFAULT_SAMPLE_RATE = 48000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_FRAME_MS = 50;
const DEFAULT_CAPACITY_WAIT_TIMEOUT_MS = 4000;
const DEFAULT_RESUME_WAIT_TIMEOUT_MS = 4000;
const HEADER_NAME_FORMAT = 'X-Audio-Format';
const HEADER_NAME_SAMPLE_RATE = 'X-Audio-Sample-Rate';
const HEADER_NAME_CHANNELS = 'X-Audio-Channels';

const workletLoadCache = new WeakMap<AudioContext, Promise<void>>();

function int16LeBufferToFloat32(int16: Int16Array): Float32Array {
  const len = int16.length;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i += 1) {
    const sample = int16[i];
    out[i] = sample < 0 ? sample / 0x8000 : sample / 0x7fff;
  }
  return out;
}

function f32LeBufferToFloat32(f32: Float32Array): Float32Array {
  return new Float32Array(f32);
}

function readHeaderNumber(headers: Headers, name: string, fallback: number): number {
  const raw = headers.get(name);
  if (raw === null || raw === undefined) {
    return fallback;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readHeaderString(headers: Headers, name: string): string | null {
  const raw = headers.get(name);
  if (raw === null || raw === undefined) {
    return null;
  }
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function normalizePcmError(error: unknown): Error {
  if (error instanceof Error) return error;
  const wrapped = new Error(String(error));
  if (error && typeof error === 'object' && 'name' in error) {
    const name = String((error as { name?: unknown }).name || '');
    if (name) wrapped.name = name;
  }
  return wrapped;
}

function detectFormat(headers: Headers): PcmStreamFormat {
  const declared = (readHeaderString(headers, HEADER_NAME_FORMAT) || '').toLowerCase();
  if (declared === 'pcm_s16le' || declared === 's16le' || declared === 'int16') {
    return 'pcm_s16le';
  }
  if (declared === 'pcm_f32le' || declared === 'f32le' || declared === 'float32') {
    return 'pcm_f32le';
  }
  return 'pcm_s16le';
}

function computeRingBufferSamples(
  ringBufferSeconds: number,
  ringBufferSamples: number,
  fallbackSampleRate: number,
): number {
  if (ringBufferSamples > 0) {
    return Math.max(1, Math.floor(ringBufferSamples));
  }
  const seconds = ringBufferSeconds > 0 ? ringBufferSeconds : DEFAULT_RING_BUFFER_SECONDS;
  return Math.max(1, Math.floor(fallbackSampleRate * seconds));
}

async function ensureWorkletLoaded(
  audioContext: AudioContext,
  workletUrl: string,
): Promise<void> {
  const cached = workletLoadCache.get(audioContext);
  if (cached) {
    await cached;
    return;
  }
  if (!audioContext.audioWorklet) {
    throw new Error('AudioWorklet is not available in this AudioContext.');
  }
  const load = audioContext.audioWorklet.addModule(workletUrl);
  const tracked = load.catch((error: Error) => {
    workletLoadCache.delete(audioContext);
    throw error;
  });
  workletLoadCache.set(audioContext, tracked);
  await tracked;
}

export function createPcmStreamPlayer(options: PcmStreamPlayerOptions = {}): PcmStreamPlayerHandle {
  const fetchImpl: typeof fetch = options.fetchImpl ?? fetch;
  const ringBufferSeconds = options.ringBufferSeconds ?? DEFAULT_RING_BUFFER_SECONDS;
  const ringBufferSamplesOption = options.ringBufferSamples ?? 0;
  const expectedSampleRate = options.expectedSampleRate ?? DEFAULT_SAMPLE_RATE;
  const expectedChannels = options.expectedChannels ?? DEFAULT_CHANNELS;
  const workletUrl = options.workletUrl ?? PCM_STREAM_PLAYER_DEFAULT_WORKLET_URL;
  const capacityWaitTimeoutMs = Math.max(
    100,
    options.capacityWaitTimeoutMs ?? DEFAULT_CAPACITY_WAIT_TIMEOUT_MS,
  );
  const resumeWaitTimeoutMs = Math.max(
    25,
    options.resumeWaitTimeoutMs ?? DEFAULT_RESUME_WAIT_TIMEOUT_MS,
  );
  const createWorkletNode = options.createWorkletNode;

  const listeners: {
    [K in PcmStreamPlayerEventName]: Set<PcmStreamPlayerEventHandler<K>>;
  } = {
    started: new Set(),
    firstAudio: new Set(),
    underrun: new Set(),
    ended: new Set(),
    failed: new Set(),
  };

  let audioContext: AudioContext | null = options.audioContext ?? null;
  let workletNode: AudioWorkletNode | null = null;
  let abortController: AbortController | null = null;
  let activeSampleRate = expectedSampleRate;
  let activePlaybackSampleRate = expectedSampleRate;
  let queuedSamplesInWorklet = 0;
  let workletFailure: Error | null = null;
  const capacityWaiters = new Set<() => void>();
  let ringBufferSamples = computeRingBufferSamples(
    ringBufferSeconds,
    ringBufferSamplesOption,
    expectedSampleRate,
  );

  let state: PcmStreamPlayerState = {
    status: 'idle',
    sampleRate: null,
    playbackSampleRate: null,
    channels: null,
    format: null,
    totalSamplesQueued: 0,
    totalSamplesPlayed: 0,
    underrunCount: 0,
    firstAudioAt: null,
    startedAt: null,
    endedAt: null,
    error: null,
  };

  function emit<K extends PcmStreamPlayerEventName>(
    event: K,
    detail: PcmStreamPlayerEventMap[K],
  ): void {
    const set = listeners[event] as Set<PcmStreamPlayerEventHandler<K>>;
    set.forEach((handler) => {
      try {
        handler(detail);
      } catch (error) {
        // eslint-disable-next-line no-console
        console.error(`[pcm-stream-player] listener for "${event}" threw:`, error);
      }
    });
  }

  function patchState(patch: Partial<PcmStreamPlayerState>): void {
    state = { ...state, ...patch };
  }

  function wakeCapacityWaiters(): void {
    const waiters = Array.from(capacityWaiters);
    capacityWaiters.clear();
    waiters.forEach((wake) => wake());
  }

  async function waitForBufferCapacity(sampleCount: number): Promise<void> {
    if (sampleCount > ringBufferSamples) {
      throw new Error('PCM stream frame exceeds the playback buffer capacity.');
    }
    while (queuedSamplesInWorklet + sampleCount > ringBufferSamples) {
      if (workletFailure) throw workletFailure;
      if (abortController?.signal.aborted) {
        throw new DOMException('PCM stream aborted.', 'AbortError');
      }
      await new Promise<void>((resolve, reject) => {
        let timeout: ReturnType<typeof setTimeout> | null = null;
        const wake = () => {
          if (timeout) clearTimeout(timeout);
          capacityWaiters.delete(wake);
          resolve();
        };
        timeout = setTimeout(() => {
          capacityWaiters.delete(wake);
          reject(new Error('PCM playback stalled while waiting for audio buffer capacity.'));
        }, capacityWaitTimeoutMs);
        capacityWaiters.add(wake);
      });
    }
  }

  async function resumeAudioContext(context: AudioContext): Promise<void> {
    if (context.state === 'suspended') {
      try {
        const signal = abortController?.signal;
        let timeout: ReturnType<typeof setTimeout> | null = null;
        let onAbort: (() => void) | null = null;
        const abortWait = new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new DOMException('PCM stream aborted.', 'AbortError'));
          if (signal?.aborted) {
            onAbort();
          } else {
            signal?.addEventListener('abort', onAbort, { once: true });
          }
        });
        const timeoutWait = new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(() => {
            const error = new Error('PCM playback stalled while resuming the audio device.');
            error.name = 'TimeoutError';
            reject(error);
          }, resumeWaitTimeoutMs);
        });
        try {
          await Promise.race([
            Promise.resolve().then(() => context.resume()),
            abortWait,
            timeoutWait,
          ]);
        } finally {
          if (timeout) clearTimeout(timeout);
          if (onAbort) signal?.removeEventListener('abort', onAbort);
        }
      } catch (error) {
        const errorName = error && typeof error === 'object' && 'name' in error
          ? String((error as { name?: unknown }).name || '')
          : '';
        if (errorName === 'AbortError' || errorName === 'TimeoutError') {
          throw error;
        }
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`PCM playback could not resume the audio device: ${reason}`);
      }
    }
    if (context.state !== 'running') {
      throw new Error(`PCM playback audio device is ${context.state}.`);
    }
  }

  async function ensureAudioContext(): Promise<AudioContext> {
    if (audioContext) {
      await resumeAudioContext(audioContext);
      return audioContext;
    }
    const context = createVoiceAudioContext();
    audioContext = context;
    await resumeAudioContext(context);
    return context;
  }

  async function ensureWorklet(sampleRateValue: number): Promise<AudioWorkletNode> {
    const context = await ensureAudioContext();
    activePlaybackSampleRate = Number.isFinite(context.sampleRate) && context.sampleRate > 0
      ? context.sampleRate
      : sampleRateValue;
    if (workletNode) {
      return workletNode;
    }
    const localRingBufferSamples = computeRingBufferSamples(
      ringBufferSeconds,
      ringBufferSamplesOption,
      activePlaybackSampleRate,
    );
    ringBufferSamples = localRingBufferSamples;

    if (createWorkletNode) {
      workletNode = createWorkletNode(context, {
        ringBufferSeconds,
        ringBufferSamples: localRingBufferSamples,
      });
    } else {
      await ensureWorkletLoaded(context, workletUrl);
      workletNode = new AudioWorkletNode(context, PCM_STREAM_PLAYER_PROCESSOR_NAME, {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [expectedChannels],
        processorOptions: {
          ringBufferSeconds,
          ringBufferSamples: localRingBufferSamples,
        },
      });
    }
    workletNode.port.onmessage = (event: MessageEvent) => {
      const data = event.data as
        | { type?: string; count?: number; deficitSamples?: number; sampleRate?: number }
        | null;
      if (!data || typeof data !== 'object' || typeof data.type !== 'string') {
        return;
      }
      if (data.type === 'firstFrame') {
        const fireFirstAudio = () => {
          const queuedSamples = state.totalSamplesQueued;
          const sampleRateForLatency = state.playbackSampleRate ?? activePlaybackSampleRate;
          const latencyMs = sampleRateForLatency > 0
            ? (queuedSamples / sampleRateForLatency) * 1000
            : 0;
          const playedAt = Date.now();
          patchState({ firstAudioAt: playedAt });
          emit('firstAudio', { queuedSamples, latencyMs, playedAt });
        };
        if (context.state === 'running') {
          fireFirstAudio();
        } else {
          const onResume = () => {
            if (context.state === 'running') {
              fireFirstAudio();
            }
          };
          context.addEventListener('statechange', onResume, { once: true });
        }
      } else if (data.type === 'underrun') {
        const count = Number.isFinite(data.count)
          ? Number(data.count)
          : state.underrunCount + 1;
        const deficit = Number.isFinite(data.deficitSamples) ? Number(data.deficitSamples) : 0;
        patchState({ underrunCount: count });
        emit('underrun', { count, deficitSamples: deficit, at: Date.now() });
      } else if (data.type === 'consumed') {
        const count = Number.isFinite(data.count) ? Math.max(0, Number(data.count)) : 0;
        queuedSamplesInWorklet = Math.max(0, queuedSamplesInWorklet - count);
        patchState({
          totalSamplesPlayed: Math.min(
            state.totalSamplesQueued,
            state.totalSamplesPlayed + count,
          ),
        });
        wakeCapacityWaiters();
      } else if (data.type === 'overflow') {
        workletFailure = new Error('PCM stream buffer overflow was prevented.');
        abortController?.abort();
        wakeCapacityWaiters();
      } else if (data.type === 'ended') {
        queuedSamplesInWorklet = 0;
        wakeCapacityWaiters();
        finalizeEnded();
      } else if (data.type === 'stopped') {
        queuedSamplesInWorklet = 0;
        wakeCapacityWaiters();
      }
    };
    if (!createWorkletNode) {
      workletNode.connect(context.destination);
    }
    return workletNode;
  }

  function finalizeEnded(): void {
    if (state.status === 'ended' || state.status === 'failed') {
      return;
    }
    const endedAt = Date.now();
    const totalSamplesPlayed = state.totalSamplesQueued;
    const sampleRateForDuration = state.playbackSampleRate ?? activePlaybackSampleRate;
    const durationMs = sampleRateForDuration > 0
      ? (totalSamplesPlayed / sampleRateForDuration) * 1000
      : 0;
    patchState({ status: 'ended', endedAt });
    emit('ended', { totalSamplesPlayed, durationMs, at: endedAt });
  }

  async function pushChunk(float32: Float32Array): Promise<void> {
    if (!workletNode) {
      return;
    }
    if (float32.length === 0) {
      return;
    }
    await waitForBufferCapacity(float32.length);
    if (workletFailure) throw workletFailure;
    if (abortController?.signal.aborted) {
      throw new DOMException('PCM stream aborted.', 'AbortError');
    }
    const copy = new Float32Array(float32);
    const sampleCount = copy.length;
    queuedSamplesInWorklet += sampleCount;
    workletNode.port.postMessage(
      { type: 'push', buffer: copy },
      [copy.buffer],
    );
    // Transferring copy.buffer detaches it immediately, so copy.length is zero
    // from this point onward in real browsers. Preserve the count before the
    // transfer so playback truth and /voice/speech/played cannot report a
    // successful zero-sample utterance.
    patchState({ totalSamplesQueued: state.totalSamplesQueued + sampleCount });
  }

  async function pumpStream(
    response: Response,
    format: PcmStreamFormat,
    sampleRateValue: number,
    channels: number,
  ): Promise<void> {
    if (!response.body) {
      throw new Error('PCM stream response has no body.');
    }
    const reader = response.body.getReader();
    const bytesPerSample = format === 'pcm_f32le' ? 4 : 2;
    const samplesPerFrame = Math.max(
      1,
      Math.floor((sampleRateValue * DEFAULT_FRAME_MS) / 1000),
    );
    const frameBytes = samplesPerFrame * bytesPerSample;
    if (channels !== 1) {
      throw new Error(`PCM stream requires mono audio; received ${channels} channels.`);
    }
    const shouldResample = options.ringBufferResample !== false
      && sampleRateValue !== activePlaybackSampleRate;
    const resampler = shouldResample
      ? new StreamingLinearResampler(sampleRateValue, activePlaybackSampleRate)
      : null;

    let leftover: Uint8Array | null = null;

    const pushSourceSamples = async (sourceSamples: Float32Array): Promise<void> => {
      if (!resampler) {
        await pushChunk(sourceSamples);
        return;
      }
      let rendered = new Float32Array(
        Math.max(1, Math.ceil(sourceSamples.length * activePlaybackSampleRate / sampleRateValue) + 2),
      );
      let renderedLength = 0;
      resampler.process(sourceSamples, (sample) => {
        if (renderedLength >= rendered.length) {
          const grown = new Float32Array(rendered.length * 2);
          grown.set(rendered);
          rendered = grown;
        }
        rendered[renderedLength] = sample;
        renderedLength += 1;
      });
      if (renderedLength > 0) {
        await pushChunk(rendered.subarray(0, renderedLength));
      }
    };

    try {
      while (true) {
        if (abortController?.signal.aborted) {
          throw new DOMException('PCM stream aborted.', 'AbortError');
        }
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (!value || value.length === 0) {
          continue;
        }
        let buffer = value;
        if (leftover) {
          const merged = new Uint8Array(leftover.length + buffer.length);
          merged.set(leftover, 0);
          merged.set(buffer, leftover.length);
          buffer = merged;
          leftover = null;
        }

        let offset = 0;
        while (offset + frameBytes <= buffer.length) {
          const view = buffer.subarray(offset, offset + frameBytes);
          offset += frameBytes;
          await pushSourceSamples(bytesToFloat32(view, format));
        }
        if (offset < buffer.length) {
          leftover = buffer.subarray(offset);
        }
      }

      if (leftover && leftover.length > 0) {
        const remainingSamples = Math.floor(leftover.length / bytesPerSample);
        if (remainingSamples > 0) {
          const slice = leftover.subarray(0, remainingSamples * bytesPerSample);
          await pushSourceSamples(bytesToFloat32(slice, format));
        }
      }
    } finally {
      try {
        reader.releaseLock();
      } catch {
        // Reader may already be released if the stream was cancelled.
      }
    }
  }

  function bytesToFloat32(view: Uint8Array, format: PcmStreamFormat): Float32Array {
    if (format === 'pcm_f32le') {
      if (view.byteOffset % 4 === 0) {
        const aligned = new Float32Array(
          view.buffer,
          view.byteOffset,
          view.length / 4,
        );
        return f32LeBufferToFloat32(aligned);
      }
      const copy = new Uint8Array(view);
      const aligned = new Float32Array(copy.buffer);
      return f32LeBufferToFloat32(aligned);
    }
    if (view.byteOffset % 2 === 0) {
      const aligned = new Int16Array(view.buffer, view.byteOffset, view.length / 2);
      return int16LeBufferToFloat32(aligned);
    }
    const copy = new Uint8Array(view);
    const aligned = new Int16Array(copy.buffer);
    return int16LeBufferToFloat32(aligned);
  }

  async function play(
    source: string | Response,
    playOptions: PcmStreamPlayerPlayOptions = {},
  ): Promise<void> {
    const controller = new AbortController();
    abortController = controller;
    if (playOptions.signal) {
      if (playOptions.signal.aborted) {
        controller.abort();
      } else {
        playOptions.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }
    }

    patchState({
      status: 'loading',
      error: null,
      totalSamplesQueued: 0,
      totalSamplesPlayed: 0,
      underrunCount: 0,
      firstAudioAt: null,
      startedAt: null,
      endedAt: null,
      playbackSampleRate: null,
    });
    queuedSamplesInWorklet = 0;
    workletFailure = null;

    let response: Response;
    try {
      if (typeof source === 'string') {
        response = await fetchImpl(source, { signal: controller.signal });
      } else {
        response = source;
      }
    } catch (error) {
      if (controller.signal.aborted) {
        throw new DOMException('PCM stream aborted.', 'AbortError');
      }
      const wrapped = error instanceof Error ? error : new Error(String(error));
      patchState({ status: 'failed', error: wrapped.message });
      emit('failed', { error: wrapped, at: Date.now() });
      throw wrapped;
    }

    if (!response.ok) {
      const message = `PCM stream request failed with HTTP ${response.status}`;
      const error = new Error(message);
      patchState({ status: 'failed', error: message });
      emit('failed', { error, at: Date.now() });
      throw error;
    }

    const format = options.expectedFormat ?? detectFormat(response.headers);
    const sampleRateValue = readHeaderNumber(
      response.headers,
      HEADER_NAME_SAMPLE_RATE,
      expectedSampleRate,
    );
    const channels = readHeaderNumber(
      response.headers,
      HEADER_NAME_CHANNELS,
      expectedChannels,
    );
    activeSampleRate = sampleRateValue;
    ringBufferSamples = computeRingBufferSamples(
      ringBufferSeconds,
      ringBufferSamplesOption,
      sampleRateValue,
    );

    patchState({
      status: 'loading',
      sampleRate: sampleRateValue,
      channels,
      format,
    });

    let worklet: AudioWorkletNode;
    try {
      worklet = await ensureWorklet(sampleRateValue);
    } catch (error) {
      const wrapped = normalizePcmError(error);
      patchState({ status: 'failed', error: wrapped.message });
      emit('failed', { error: wrapped, at: Date.now() });
      throw wrapped;
    }
    patchState({ playbackSampleRate: activePlaybackSampleRate });

    try {
      worklet.port.postMessage({ type: 'reset' });
    } catch {
      // Worklet may not have a reset handler in older builds; ignore.
    }

    patchState({ status: 'streaming', startedAt: Date.now() });
    emit('started', {
      sampleRate: sampleRateValue,
      playbackSampleRate: activePlaybackSampleRate,
      channels,
      format,
      ringBufferSamples,
    });

    try {
      await pumpStream(response, format, sampleRateValue, channels);
      if (state.totalSamplesQueued <= 0) {
        throw new Error('PCM stream response contained no audio samples.');
      }
    } catch (error) {
      const protocolFailure = workletFailure as Error | null;
      if (protocolFailure) {
        const failure: Error = protocolFailure;
        patchState({ status: 'failed', error: failure.message });
        emit('failed', { error: failure, at: Date.now() });
        throw failure;
      }
      if (
        abortController?.signal.aborted
        || (error instanceof DOMException && error.name === 'AbortError')
        || (error instanceof Error && error.name === 'AbortError')
      ) {
        throw new DOMException('PCM stream aborted.', 'AbortError');
      }
      const wrapped = error instanceof Error ? error : new Error(String(error));
      patchState({ status: 'failed', error: wrapped.message });
      emit('failed', { error: wrapped, at: Date.now() });
      throw wrapped;
    }

    try {
      worklet.port.postMessage({ type: 'end' });
    } catch {
      // Worklet port may be closed if the processor already exited.
    }
  }

  function abort(): void {
    if (abortController && !abortController.signal.aborted) {
      abortController.abort();
    }
    wakeCapacityWaiters();
    if (workletNode) {
      try {
        workletNode.port.postMessage({ type: 'stop' });
      } catch {
        // Ignore — worklet may have already shut down.
      }
    }
  }

  function dispose(): void {
    abort();
    if (workletNode) {
      try {
        workletNode.disconnect();
      } catch {
        // Ignore — node may already be disconnected.
      }
      workletNode = null;
    }
    const ctx = audioContext;
    if (ctx) {
      workletLoadCache.delete(ctx);
      try {
        ctx.close();
      } catch {
        // Ignore — context may already be closed.
      }
      audioContext = null;
    }
  }

  return {
    play,
    abort,
    dispose,
    on(event, handler) {
      const set = listeners[event] as Set<PcmStreamPlayerEventHandler<typeof event>>;
      set.add(handler);
      return () => set.delete(handler);
    },
    off(event, handler) {
      const set = listeners[event] as Set<PcmStreamPlayerEventHandler<typeof event>>;
      set.delete(handler);
    },
    getState: () => ({ ...state }),
    getAudioContext: () => audioContext,
    getWorkletNode: () => workletNode,
  };
}

export function isStreamingPcmResponse(response: Response): boolean {
  const format = response.headers.get(HEADER_NAME_FORMAT);
  if (!format) {
    return false;
  }
  const normalized = format.trim().toLowerCase();
  return normalized === 'pcm_s16le'
    || normalized === 'pcm_f32le'
    || normalized === 's16le'
    || normalized === 'f32le';
}
