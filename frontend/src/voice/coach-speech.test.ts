import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  VOICE_TUTOR_METRIC_TRACK_EVENT,
  createVoiceCoachSpeechController,
  type VoiceTutorMetricTrackDetail,
} from './coach-speech';
import { createPcmStreamPlayer } from './audio/pcm-stream-player';
import { createCoachGraph, playTutorMetricTrackHeader } from './coach-graph';

const coachMessage = {
  id: 'coach-1',
  role: 'coach',
  channel: 'runtime',
  kind: 'runtime-answer',
  content: 'Try the ending lighter.',
  createdAt: 1,
} as const;

const VERIFIED_CLONE_HEADERS = {
  'X-Reference-Resolved': 'true',
  'X-Voice-Cloned': 'true',
  'X-TTS-Generation-Mode': 'cloned-synthesis',
  'X-Reference-Audio-Role': 'conditioning-only',
  'X-Speaking-Rate-Applied': '0.76',
} as const;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function createPendingSpeechResponse(streamId: string | null) {
  const body = createDeferred<Blob>();
  const headers = new Headers({ 'content-type': 'audio/wav' });
  if (streamId !== null) {
    headers.set('X-Voice-Speech-Stream-Id', streamId);
  }
  const response = new Response(null, { status: 200, headers });
  Object.defineProperty(response, 'blob', { value: () => body.promise });
  return { response, resolveBody: body.resolve, rejectBody: body.reject };
}

function installIdleSpeechSynthesis() {
  Object.assign(window, {
    speechSynthesis: {
      cancel: vi.fn(),
      speaking: false,
      pending: false,
    },
  });
}

function createAudioStub(): HTMLAudioElement {
  return {
    preload: '',
    src: '',
    onended: null,
    onerror: null,
    play: vi.fn(() => Promise.resolve()),
    pause: vi.fn(),
    load: vi.fn(),
    removeAttribute: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  } as any as HTMLAudioElement;
}

function createVoxCpmController(fetchImpl: typeof fetch) {
  return createVoiceCoachSpeechController({
    kernelUrl: 'http://kernel.test',
    getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
    getRequestedProvider: () => 'voxcpm',
    setLastSpokenCoachMessageId: () => undefined,
    getLastSpokenCoachMessageId: () => null,
    setVoxCpmStatus: () => undefined,
    onPlaybackFinished: () => undefined,
    onPlaybackError: () => undefined,
    onRender: () => undefined,
    fetchImpl,
    createAudio: createAudioStub,
  });
}

function createPcmSpeechResponse(tutorMetricTrack: string | null = null) {
  return new Response(new Uint8Array([0, 0, 1, 0]), {
    status: 200,
    headers: {
      'Content-Type': 'application/octet-stream',
      'X-Audio-Format': 'pcm_s16le',
      'X-Audio-Sample-Rate': '48000',
      'X-Audio-Channels': '1',
      'X-Voice-Speech-Stream-Id': 'pcm-stream-1',
      ...(tutorMetricTrack ? { 'X-Tutor-Metric-Track': tutorMetricTrack } : {}),
      ...VERIFIED_CLONE_HEADERS,
    },
  });
}

function createAbortablePcmPlayer() {
  const listeners = new Map<string, Set<(detail: any) => void>>();
  const handle = {
    play: vi.fn((_response: Response, options?: { signal?: AbortSignal }) => new Promise<void>((_resolve, reject) => {
      const rejectAbort = () => {
        const error = new Error('PCM stream aborted.');
        error.name = 'AbortError';
        reject(error);
      };
      options?.signal?.addEventListener('abort', rejectAbort, { once: true });
      if (options?.signal?.aborted) rejectAbort();
    })),
    abort: vi.fn(),
    dispose: vi.fn(),
    on: vi.fn((event: string, handler: (detail: any) => void) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)?.add(handler);
      return () => listeners.get(event)?.delete(handler);
    }),
    off: vi.fn((event: string, handler: (detail: any) => void) => {
      listeners.get(event)?.delete(handler);
    }),
    getState: vi.fn(() => ({ status: 'streaming', error: null })),
    getAudioContext: vi.fn(() => null),
    getWorkletNode: vi.fn(() => null),
  };
  return handle;
}

async function flushSpeechWork() {
  await Promise.resolve();
  await Promise.resolve();
}

describe('voice coach speech controller', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('never substitutes browser speech when the selected reference voice fails', async () => {
    class MockUtterance {
      constructor(public text: string) {}
    }
    Object.assign(globalThis, { SpeechSynthesisUtterance: MockUtterance as any });
    const speak = vi.fn();
    Object.assign(window, {
      speechSynthesis: {
        speak,
        cancel: vi.fn(),
        speaking: false,
        pending: false,
      },
    });
    const playbackError = vi.fn();
    const onSelectedVoiceFailure = vi.fn();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      getTargetPreset: () => 'reference-preset',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => 'coach-1',
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: playbackError,
      onSelectedVoiceFailure,
      onRender: () => undefined,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'clone unavailable' }), {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
      })) as any,
    });

    expect(controller.speak(coachMessage, { provider: 'voxcpm' })).toBe(true);
    await flushSpeechWork();
    await flushSpeechWork();

    expect(speak).not.toHaveBeenCalled();
    expect(playbackError).toHaveBeenCalledWith(expect.stringMatching(/VoxCPM speech failed/i));
    expect(onSelectedVoiceFailure).toHaveBeenCalledOnce();
  });

  it('rejects an unresolved speech response when the selected reference did not resolve', async () => {
    const play = vi.fn(() => Promise.resolve());
    const audio = { ...createAudioStub(), play } as HTMLAudioElement;
    const playbackError = vi.fn();
    const onReferenceResolution = vi.fn();
    const onSelectedVoiceFailure = vi.fn();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => 'coach-1',
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: playbackError,
      onReferenceResolution,
      onSelectedVoiceFailure,
      onRender: () => undefined,
      fetchImpl: vi.fn(async () => new Response(new Blob(['unresolved']), {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'X-Reference-Resolved': 'false',
        },
      })) as any,
      createAudio: () => audio,
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await flushSpeechWork();
    await flushSpeechWork();

    expect(onReferenceResolution).toHaveBeenCalledWith(false);
    expect(play).not.toHaveBeenCalled();
    expect(playbackError).toHaveBeenCalledWith(expect.stringMatching(/selected tutor voice/i));
    expect(onSelectedVoiceFailure).toHaveBeenCalledOnce();
  });

  it('reads selected-voice failure headers before a fail-closed HTTP status', async () => {
    installIdleSpeechSynthesis();
    const onReferenceResolution = vi.fn();
    const onSelectedVoiceFailure = vi.fn();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => coachMessage.id,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onReferenceResolution,
      onSelectedVoiceFailure,
      onRender: () => undefined,
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ error: 'reference unavailable' }), {
        status: 409,
        headers: {
          'Content-Type': 'application/json',
          'X-Reference-Resolved': 'false',
        },
      })) as any,
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await flushSpeechWork();
    await flushSpeechWork();

    expect(onReferenceResolution).toHaveBeenCalledWith(false);
    expect(onSelectedVoiceFailure).toHaveBeenCalledOnce();
  });

  it('withholds ambiguous audio that could be reference playback instead of synthesis', async () => {
    installIdleSpeechSynthesis();
    const play = vi.fn(() => Promise.resolve());
    const playbackError = vi.fn();
    const onSelectedVoiceFailure = vi.fn();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => coachMessage.id,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: playbackError,
      onSelectedVoiceFailure,
      onRender: () => undefined,
      fetchImpl: vi.fn(async () => new Response(new Blob(['ambiguous audio']), {
        status: 200,
        headers: {
          'Content-Type': 'audio/wav',
          'X-Reference-Resolved': 'true',
          'X-Voice-Cloned': 'true',
        },
      })) as any,
      createAudio: () => ({ ...createAudioStub(), play } as HTMLAudioElement),
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await flushSpeechWork();
    await flushSpeechWork();

    expect(play).not.toHaveBeenCalled();
    expect(playbackError).toHaveBeenCalledWith(expect.stringMatching(/synthesis was not verified/i));
    expect(onSelectedVoiceFailure).toHaveBeenCalledOnce();
  });

  it('passes the configured slow pace into cloned TTS and reports Speaking only from actual audio', async () => {
    installIdleSpeechSynthesis();
    const states: boolean[] = [];
    const handlers = new Map<string, () => void>();
    const audio = {
      ...createAudioStub(),
      addEventListener: (event: string, handler: () => void) => { handlers.set(event, handler); },
      removeEventListener: (event: string) => { handlers.delete(event); },
    } as HTMLAudioElement;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:actual-audio'),
      revokeObjectURL: vi.fn(),
    });
    const fetchImpl = vi.fn(async (url: string) => (
      url.endsWith('/voice/speech/generate')
        ? new Response(new Blob(['audio']), {
            status: 200,
            headers: { 'Content-Type': 'audio/wav', ...VERIFIED_CLONE_HEADERS },
          })
        : new Response('{}', { status: 200 })
    ));

    try {
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        getReferenceClipId: () => 'selected-reference-clip',
        getDefaultSpeakingRate: () => 0.65,
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => coachMessage.id,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished: () => undefined,
        onPlaybackError: () => undefined,
        onPlaybackStateChange: (playing) => states.push(playing),
        onRender: () => undefined,
        fetchImpl: fetchImpl as any,
        createAudio: () => audio,
      });

      controller.speak(coachMessage, { provider: 'voxcpm' });
      for (let index = 0; index < 10 && !handlers.has('ended'); index += 1) {
        await flushSpeechWork();
      }
      const generateCall = fetchImpl.mock.calls.find(([url]) => url.endsWith('/voice/speech/generate'));
      expect(JSON.parse(String(generateCall?.[1]?.body)).speakingRate).toBe(0.65);
      expect(states).toEqual([]);
      expect(controller.isPlaying()).toBe(false);
      handlers.get('playing')?.();
      expect(states).toEqual([true]);
      expect(controller.isPlaying()).toBe(true);
      handlers.get('ended')?.();
      await flushSpeechWork();
      expect(states).toEqual([true, false]);
      expect(controller.isPlaying()).toBe(false);
    } finally {
      Object.assign(URL, {
        createObjectURL: originalCreateObjectURL,
        revokeObjectURL: originalRevokeObjectURL,
      });
    }
  });

  it('publishes every first-audio boundary and invalidates an absent successor track', async () => {
    installIdleSpeechSynthesis();
    document.body.innerHTML = '<div id="tv-coach-graph" hidden></div>';
    const coachGraph = createCoachGraph({ doc: document });
    const encodedTrack = JSON.stringify({
      v: 'voice-metrics-v4-formants',
      durationMs: 120,
      points: [[0, 180, 0.4], [120, 220, 0.6]],
    });
    const handlers = new Map<string, () => void>();
    const audio = {
      ...createAudioStub(),
      addEventListener: (event: string, handler: () => void) => { handlers.set(event, handler); },
      removeEventListener: (event: string) => { handlers.delete(event); },
    } as HTMLAudioElement;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:tutor-track-audio'),
      revokeObjectURL: vi.fn(),
    });
    const seen: Array<string | null> = [];
    const invalidLengths: Array<number | null> = [];
    const played: boolean[] = [];
    const onTrack = (event: Event) => {
      const detail = (event as CustomEvent<VoiceTutorMetricTrackDetail>).detail;
      seen.push(detail.encodedTrack);
      invalidLengths.push(detail.invalidHeaderLength ?? null);
      played.push(playTutorMetricTrackHeader(coachGraph, detail.encodedTrack, detail.invalidHeaderLength));
    };
    document.addEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTrack);
    let generated = 0;
    const fetchImpl = vi.fn(async (url: string) => {
      if (!url.endsWith('/voice/speech/generate')) {
        return new Response('{}', { status: 200 });
      }
      generated += 1;
      const headers: Record<string, string> = {
        'Content-Type': 'audio/wav',
        ...VERIFIED_CLONE_HEADERS,
      };
      if (generated === 1) headers['X-Tutor-Metric-Track'] = encodedTrack;
      if (generated === 3) headers['X-Tutor-Metric-Track'] = 'not-json';
      return new Response(new Blob(['audio']), { status: 200, headers });
    });

    try {
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        getReferenceClipId: () => 'selected-reference-clip',
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => coachMessage.id,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished: () => undefined,
        onPlaybackError: () => undefined,
        onRender: () => undefined,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createAudio: () => audio,
      });

      controller.speak(coachMessage, { provider: 'voxcpm' });
      for (let index = 0; index < 10 && !handlers.has('ended'); index += 1) {
        await flushSpeechWork();
      }
      expect(seen).toEqual([], 'a response header alone must not move the tutor dot early');

      handlers.get('playing')?.();
      handlers.get('playing')?.();
      expect(seen).toEqual([encodedTrack]);
      expect(played).toEqual([true]);
      expect(document.getElementById('tv-coach-graph')?.hidden).toBe(false);
      const tutorDot = document.querySelector('[data-speaker="tutor"]') as HTMLElement;
      const tutorTrail = document.querySelector('.tv-graph-trail-tutor')!;
      expect(tutorDot.style.top).not.toBe('');
      handlers.get('ended')?.();
      await flushSpeechWork();

      handlers.clear();
      controller.speak({ ...coachMessage, id: 'coach-without-track' }, { provider: 'voxcpm' });
      for (let index = 0; index < 10 && !handlers.has('ended'); index += 1) {
        await flushSpeechWork();
      }
      handlers.get('playing')?.();
      expect(seen).toEqual([encodedTrack, null]);
      expect(played).toEqual([true, false]);
      expect(tutorDot.style.top).toBe('');
      expect(tutorTrail.getAttribute('points')).toBe('');
      handlers.get('ended')?.();
      await flushSpeechWork();

      handlers.clear();
      controller.speak({ ...coachMessage, id: 'coach-with-malformed-track' }, { provider: 'voxcpm' });
      for (let index = 0; index < 10 && !handlers.has('ended'); index += 1) {
        await flushSpeechWork();
      }
      expect(seen).toEqual([encodedTrack, null], 'malformed metadata must still wait for first audio');
      handlers.get('playing')?.();
      expect(seen).toEqual([encodedTrack, null, null]);
      expect(invalidLengths).toEqual([null, null, 'not-json'.length]);
      expect(played).toEqual([true, false, false]);
      expect(tutorDot.style.top).toBe('');
      expect(tutorTrail.getAttribute('points')).toBe('');
      handlers.get('ended')?.();
      await flushSpeechWork();
    } finally {
      document.removeEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTrack);
      document.body.innerHTML = '';
      Object.assign(URL, {
        createObjectURL: originalCreateObjectURL,
        revokeObjectURL: originalRevokeObjectURL,
      });
    }
  });

  it('forces cloned speech when a selected reference exists even if legacy state requests browser', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 503 }));
    const browserSpeak = vi.fn();
    Object.assign(window, {
      speechSynthesis: {
        speak: browserSpeak,
        cancel: vi.fn(),
        speaking: false,
        pending: false,
      },
    });
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'browser',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => null,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender: () => undefined,
      fetchImpl: fetchMock as any,
    });

    controller.speak(coachMessage, { provider: 'browser' });
    await flushSpeechWork();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://kernel.test/voice/speech/generate',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(browserSpeak).not.toHaveBeenCalled();
  });

  it('marks the message as spoken and finishes after browser synthesis ends', async () => {
    vi.useFakeTimers();

    let spokenMessageId: string | null = null;
    let utteranceRef: SpeechSynthesisUtterance | null = null;
    let finishedCount = 0;

    class MockUtterance {
      text: string;
      rate = 1;
      pitch = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;

      constructor(text: string) {
        this.text = text;
      }
    }

    Object.assign(globalThis, {
      SpeechSynthesisUtterance: MockUtterance as any,
    });

    Object.assign(window, {
      speechSynthesis: {
        speak: (utterance: SpeechSynthesisUtterance) => {
          utteranceRef = utterance;
        },
        cancel: vi.fn(),
        speaking: false,
        pending: false,
      },
    });

    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'browser',
      setLastSpokenCoachMessageId: (messageId) => {
        spokenMessageId = messageId;
      },
      getLastSpokenCoachMessageId: () => spokenMessageId,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => {
        finishedCount += 1;
      },
      onPlaybackError: () => undefined,
      onRender: () => undefined,
    });

    const tutorTrackBoundaries: Array<string | null> = [];
    const onTutorTrack = (event: Event) => {
      tutorTrackBoundaries.push((event as CustomEvent<VoiceTutorMetricTrackDetail>).detail.encodedTrack);
    };
    document.addEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTutorTrack);

    expect(controller.speak({
      id: 'coach-1',
      role: 'coach',
      channel: 'runtime',
      kind: 'runtime-answer',
      content: 'Try the ending lighter.',
      createdAt: 1,
    }, {
      provider: 'browser',
    })).toBe(true);

    expect(spokenMessageId).toBe('coach-1');
    expect(utteranceRef).not.toBeNull();

    utteranceRef?.onstart?.();
    document.removeEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTutorTrack);
    expect(tutorTrackBoundaries).toEqual([null]);
    utteranceRef?.onend?.();
    await vi.advanceTimersByTimeAsync(150);

    expect(finishedCount).toBe(1);
  });

  it('sends the generate response stream ID when stopping VoxCPM playback', async () => {
    const pendingResponse = createPendingSpeechResponse('gateway-stream-1');
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.endsWith('/voice/speech/generate')) {
        return Promise.resolve(pendingResponse.response);
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    installIdleSpeechSynthesis();
    const controller = createVoxCpmController(fetchMock as any);

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await flushSpeechWork();

    controller.stop();
    const cancelCalls = fetchMock.mock.calls.filter(([url]) => url.endsWith('/voice/speech/cancel'));
    expect(cancelCalls).toHaveLength(1);
    expect(JSON.parse(String(cancelCalls[0][1]?.body))).toMatchObject({
      sessionId: 'session-1',
      streamId: 'gateway-stream-1',
    });

    pendingResponse.resolveBody(new Blob(['audio']));
    await flushSpeechWork();
  });

  it('publishes each PCM first-audio boundary as a valid track or explicit null', async () => {
    installIdleSpeechSynthesis();
    const encodedTrack = JSON.stringify({ points: [[0, 180, 0.4], [120, 220, 0.6]] });
    const seen: Array<string | null> = [];
    const onTrack = (event: Event) => {
      seen.push((event as CustomEvent<VoiceTutorMetricTrackDetail>).detail.encodedTrack);
    };
    document.addEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTrack);
    const createCompletingPlayer = () => {
      const listeners = new Map<string, (detail?: any) => void>();
      return {
        play: vi.fn(async () => {
          expect(seen).toHaveLength(generationCount - 1);
          listeners.get('firstAudio')?.();
        }),
        abort: vi.fn(),
        dispose: vi.fn(),
        on: vi.fn((event: string, handler: (detail?: any) => void) => {
          listeners.set(event, handler);
          return () => listeners.delete(event);
        }),
        off: vi.fn(),
        getState: vi.fn(() => ({
          status: 'ended',
          sampleRate: 48_000,
          totalSamplesQueued: 2,
          totalSamplesPlayed: 2,
          error: null,
        })),
        getAudioContext: vi.fn(() => null),
        getWorkletNode: vi.fn(() => null),
      };
    };
    const onPlaybackFinished = vi.fn();
    let generationCount = 0;
    const fetchMock = vi.fn(async (url: string) => (
      url.endsWith('/voice/speech/generate')
        ? createPcmSpeechResponse(generationCount++ === 0 ? encodedTrack : null)
        : new Response('{}', { status: 200 })
    ));

    try {
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        getReferenceClipId: () => 'selected-reference-clip',
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => coachMessage.id,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished,
        onPlaybackError: () => undefined,
        onRender: () => undefined,
        fetchImpl: fetchMock as unknown as typeof fetch,
        createPcmPlayer: () => createCompletingPlayer() as any,
      });

      controller.speak(coachMessage, { provider: 'voxcpm' });
      await vi.waitFor(() => expect(onPlaybackFinished).toHaveBeenCalledTimes(1));
      expect(seen).toEqual([encodedTrack]);

      controller.speak({ ...coachMessage, id: 'coach-2' }, { provider: 'voxcpm' });
      await vi.waitFor(() => expect(onPlaybackFinished).toHaveBeenCalledTimes(2));
      expect(seen).toEqual([encodedTrack, null]);
    } finally {
      document.removeEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTrack);
    }
  });

  it('settles repeated End presses during queued PCM without acknowledging playback', async () => {
    installIdleSpeechSynthesis();
    const players: ReturnType<typeof createAbortablePcmPlayer>[] = [];
    const fetchMock = vi.fn(async (url: string) => (
      url.endsWith('/voice/speech/generate')
        ? createPcmSpeechResponse()
        : new Response('{}', { status: 200 })
    ));
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => coachMessage.id,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender: () => undefined,
      fetchImpl: fetchMock as any,
      createPcmPlayer: () => {
        const player = createAbortablePcmPlayer();
        players.push(player);
        return player as any;
      },
    });

    for (let cycle = 0; cycle < 3; cycle += 1) {
      controller.speak({ ...coachMessage, id: `coach-${cycle}` }, { provider: 'voxcpm' });
      await vi.waitFor(() => expect(players).toHaveLength(cycle + 1));
      await vi.waitFor(() => expect(players[cycle].play).toHaveBeenCalledOnce());
      controller.stop();
      await vi.waitFor(() => expect(players[cycle].dispose).toHaveBeenCalledOnce());
    }

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/voice/speech/played'))).toBe(false);
    expect(players.every((player) => player.abort.mock.calls.length >= 1)).toBe(true);
  });

  it('lets End interrupt a real PCM player while its audio device resume is pending', async () => {
    installIdleSpeechSynthesis();
    const resume = createDeferred<void>();
    const context = {
      state: 'suspended',
      destination: {},
      close: vi.fn(),
      resume: vi.fn(() => resume.promise),
      addEventListener: vi.fn(),
    } as unknown as AudioContext;
    const player = createPcmStreamPlayer({
      audioContext: context,
      createWorkletNode: () => {
        throw new Error('worklet must not be created before resume settles');
      },
    });
    const fetchMock = vi.fn(async (url: string) => (
      url.endsWith('/voice/speech/generate')
        ? createPcmSpeechResponse()
        : new Response('{}', { status: 200 })
    ));
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => coachMessage.id,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender: () => undefined,
      fetchImpl: fetchMock as any,
      createPcmPlayer: () => player,
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await vi.waitFor(() => expect(context.resume).toHaveBeenCalledOnce());
    controller.stop();

    await vi.waitFor(() => expect(context.close).toHaveBeenCalledOnce());
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/voice/speech/played'))).toBe(false);
  });

  it('fails and disposes when short PCM drains without a completion event', async () => {
    installIdleSpeechSynthesis();
    const playbackError = vi.fn();
    const onSelectedVoiceFailure = vi.fn();
    const setVoxCpmStatus = vi.fn();
    const stalledPlayer = createAbortablePcmPlayer();
    stalledPlayer.play.mockResolvedValueOnce(undefined);
    stalledPlayer.getState.mockReturnValue({
      status: 'streaming',
      sampleRate: 48_000,
      totalSamplesQueued: 96,
      totalSamplesPlayed: 0,
      error: null,
    } as any);
    const fetchMock = vi.fn(async (url: string) => (
      url.endsWith('/voice/speech/generate')
        ? createPcmSpeechResponse()
        : new Response('{}', { status: 200 })
    ));
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => coachMessage.id,
      setVoxCpmStatus,
      onPlaybackFinished: () => undefined,
      onPlaybackError: playbackError,
      onSelectedVoiceFailure,
      onRender: () => undefined,
      fetchImpl: fetchMock as any,
      createPcmPlayer: () => stalledPlayer as any,
      pcmCompletionGraceMs: 25,
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await vi.waitFor(() => expect(onSelectedVoiceFailure).toHaveBeenCalledOnce());

    expect(playbackError).toHaveBeenCalledWith(expect.stringMatching(/stalled before completion/i));
    expect(stalledPlayer.abort).toHaveBeenCalled();
    expect(stalledPlayer.dispose).toHaveBeenCalledOnce();
    expect(setVoxCpmStatus).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/voice/speech/played'))).toBe(false);
  });

  it('treats a truncated PCM body as selected-voice failure and never records played', async () => {
    installIdleSpeechSynthesis();
    const playbackError = vi.fn();
    const onSelectedVoiceFailure = vi.fn();
    const failedPlayer = createAbortablePcmPlayer();
    failedPlayer.play.mockRejectedValueOnce(new Error('terminated while reading response body'));
    const fetchMock = vi.fn(async (url: string) => (
      url.endsWith('/voice/speech/generate')
        ? createPcmSpeechResponse()
        : new Response('{}', { status: 200 })
    ));
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => coachMessage.id,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: playbackError,
      onSelectedVoiceFailure,
      onRender: () => undefined,
      fetchImpl: fetchMock as any,
      createPcmPlayer: () => failedPlayer as any,
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await vi.waitFor(() => expect(onSelectedVoiceFailure).toHaveBeenCalledOnce());

    expect(playbackError).toHaveBeenCalledWith(expect.stringMatching(/terminated/i));
    expect(failedPlayer.dispose).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/voice/speech/played'))).toBe(false);
  });

  it('claims a VoxCPM message before the asynchronous generate request resolves', () => {
    const pending = createDeferred<Response>();
    let spokenMessageId: string | null = null;
    installIdleSpeechSynthesis();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      setLastSpokenCoachMessageId: (messageId) => { spokenMessageId = messageId; },
      getLastSpokenCoachMessageId: () => spokenMessageId,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender: () => undefined,
      fetchImpl: vi.fn(() => pending.promise) as any,
      createAudio: createAudioStub,
    });

    expect(controller.speak(coachMessage, { provider: 'voxcpm' })).toBe(true);
    expect(spokenMessageId).toBe(coachMessage.id);
    expect(controller.isSpeaking()).toBe(true);
  });

  it('keeps auxiliary target-line speech out of the previous backend turn', () => {
    const pending = createDeferred<Response>();
    let spokenMessageId: string | null = 'coach-latest';
    const fetchMock = vi.fn(() => pending.promise);
    installIdleSpeechSynthesis();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getTurnId: () => 'backend-coach-turn-1',
      setLastSpokenCoachMessageId: (messageId) => { spokenMessageId = messageId; },
      getLastSpokenCoachMessageId: () => spokenMessageId,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender: () => undefined,
      fetchImpl: fetchMock as any,
      createAudio: createAudioStub,
    });

    controller.speak({ ...coachMessage, id: 'hear-line-1', kind: 'hear-line' }, { provider: 'voxcpm' });
    expect(spokenMessageId).toBe('coach-latest');
    const generateBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(generateBody.turnId).toMatch(/^turn-/);
    expect(generateBody.turnId).not.toBe('backend-coach-turn-1');
  });

  it('does not reuse a previous stream ID when a later response omits the header', async () => {
    const firstResponse = createPendingSpeechResponse('gateway-stream-old');
    const secondResponse = createPendingSpeechResponse(null);
    const responses = [firstResponse.response, secondResponse.response];
    let responseIndex = 0;
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.endsWith('/voice/speech/generate')) {
        return Promise.resolve(responses[responseIndex++]);
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    installIdleSpeechSynthesis();
    const controller = createVoxCpmController(fetchMock as any);

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await flushSpeechWork();
    controller.stop();
    firstResponse.resolveBody(new Blob(['first']));
    await flushSpeechWork();

    controller.speak({ ...coachMessage, id: 'coach-2' }, { provider: 'voxcpm' });
    await flushSpeechWork();
    controller.stop();

    const cancelBodies = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/voice/speech/cancel'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(cancelBodies).toHaveLength(2);
    expect(cancelBodies[0].streamId).toBe('gateway-stream-old');
    expect(cancelBodies[1]).toHaveProperty('streamId', null);

    secondResponse.resolveBody(new Blob(['second']));
    await flushSpeechWork();
  });

  it('does not let a superseded response replace or clear the current stream ID', async () => {
    const lateGenerate = createDeferred<Response>();
    const supersededResponse = createPendingSpeechResponse('gateway-stream-old');
    const currentResponse = createPendingSpeechResponse('gateway-stream-current');
    let generateCount = 0;
    const fetchMock = vi.fn((url: string, _init?: RequestInit) => {
      if (url.endsWith('/voice/speech/generate')) {
        generateCount += 1;
        return generateCount === 1
          ? lateGenerate.promise
          : Promise.resolve(currentResponse.response);
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    installIdleSpeechSynthesis();
    const controller = createVoxCpmController(fetchMock as any);

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await flushSpeechWork();
    controller.speak({ ...coachMessage, id: 'coach-2' }, { provider: 'voxcpm' });
    await flushSpeechWork();

    lateGenerate.resolve(supersededResponse.response);
    supersededResponse.resolveBody(new Blob(['superseded']));
    await flushSpeechWork();
    await flushSpeechWork();
    controller.stop();

    const cancelBodies = fetchMock.mock.calls
      .filter(([url]) => url.endsWith('/voice/speech/cancel'))
      .map(([, init]) => JSON.parse(String(init?.body)));
    expect(cancelBodies.at(-1)?.streamId).toBe('gateway-stream-current');

    currentResponse.resolveBody(new Blob(['current']));
    await flushSpeechWork();
  });

  it('drops a stale generate response before callbacks or player allocation', async () => {
    const staleGenerate = createDeferred<Response>();
    const currentGenerate = createDeferred<Response>();
    let generateCount = 0;
    const fetchMock = vi.fn((url: string) => {
      if (url.endsWith('/voice/speech/generate')) {
        generateCount += 1;
        return generateCount === 1 ? staleGenerate.promise : currentGenerate.promise;
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });
    const onReferenceResolution = vi.fn();
    const createAudio = vi.fn(createAudioStub);
    installIdleSpeechSynthesis();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => null,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onReferenceResolution,
      onRender: () => undefined,
      fetchImpl: fetchMock as unknown as typeof fetch,
      createAudio,
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    controller.speak({ ...coachMessage, id: 'coach-current' }, { provider: 'voxcpm' });
    staleGenerate.resolve(new Response(new Blob(['stale']), {
      status: 200,
      headers: { 'Content-Type': 'audio/wav', 'X-Reference-Resolved': 'false' },
    }));
    await flushSpeechWork();
    await flushSpeechWork();

    expect(onReferenceResolution).not.toHaveBeenCalled();
    expect(createAudio).not.toHaveBeenCalled();
    controller.stop();
    currentGenerate.resolve(new Response(null, { status: 499 }));
    await flushSpeechWork();
  });

  it('does not start a stale browser fallback when an error callback starts a newer line', async () => {
    const currentGenerate = createDeferred<Response>();
    let generateCount = 0;
    const browserSpeak = vi.fn();
    class MockUtterance {
      rate = 1;
      pitch = 1;
      onstart: (() => void) | null = null;
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(public text: string) {}
    }
    Object.assign(globalThis, { SpeechSynthesisUtterance: MockUtterance as any });
    Object.assign(window, {
      speechSynthesis: {
        speak: browserSpeak,
        cancel: vi.fn(),
        speaking: false,
        pending: false,
      },
    });
    const fetchMock = vi.fn((url: string) => {
      if (!url.endsWith('/voice/speech/generate')) {
        return Promise.resolve(new Response('{}', { status: 200 }));
      }
      generateCount += 1;
      return generateCount === 1
        ? Promise.resolve(new Response('generation failed', { status: 503 }))
        : currentGenerate.promise;
    });
    let controller!: ReturnType<typeof createVoiceCoachSpeechController>;
    const onPlaybackError = vi.fn(() => {
      if (generateCount === 1) {
        controller.speak({ ...coachMessage, id: 'coach-reentrant' }, { provider: 'voxcpm' });
      }
    });
    controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => null,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError,
      onRender: () => undefined,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    controller.speak(coachMessage, { provider: 'voxcpm' });
    await vi.waitFor(() => expect(generateCount).toBe(2));
    expect(browserSpeak).not.toHaveBeenCalled();

    controller.stop();
    currentGenerate.resolve(new Response(null, { status: 499 }));
    await flushSpeechWork();
  });

  it('cancels forced VoxCPM playback even when legacy requested-provider state says browser', async () => {
    const pendingGenerate = createDeferred<Response>();
    const fetchMock = vi.fn((url: string) => (
      url.endsWith('/voice/speech/generate')
        ? pendingGenerate.promise
        : Promise.resolve(new Response('{}', { status: 200 }))
    ));
    installIdleSpeechSynthesis();
    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'browser',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => null,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender: () => undefined,
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    controller.speak(coachMessage, { provider: 'browser' });
    controller.stop();
    await flushSpeechWork();

    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/voice/speech/cancel'))).toBe(true);
    pendingGenerate.resolve(new Response(null, { status: 499 }));
    await flushSpeechWork();
  });

  it('still sends backend cancel without re-rendering when stop is called with no local playback state', async () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })));
    const onRender = vi.fn();

    Object.assign(window, {
      speechSynthesis: {
        cancel: vi.fn(),
        speaking: false,
        pending: false,
      },
    });

    const controller = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      setLastSpokenCoachMessageId: () => undefined,
      getLastSpokenCoachMessageId: () => null,
      setVoxCpmStatus: () => undefined,
      onPlaybackFinished: () => undefined,
      onPlaybackError: () => undefined,
      onRender,
      fetchImpl: fetchMock as any,
    });

    controller.stop();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledWith(
      'http://kernel.test/voice/speech/cancel',
      expect.objectContaining({
        method: 'POST',
        keepalive: true,
      }),
    );
    expect(onRender).not.toHaveBeenCalled();
  });

  it('feeds MediaSource before awaiting play so first audio cannot deadlock', async () => {
    installIdleSpeechSynthesis();
    const playStarted = createDeferred<void>();
    const audioHandlers = new Map<string, () => void>();
    const audio = {
      ...createAudioStub(),
      play: vi.fn(() => playStarted.promise),
      addEventListener: (event: string, handler: () => void) => { audioHandlers.set(event, handler); },
      removeEventListener: (event: string) => { audioHandlers.delete(event); },
    } as HTMLAudioElement;
    const encodedTrack = JSON.stringify({ points: [[0, 180, 0.4], [120, 220, 0.6]] });
    const seen: Array<string | null> = [];
    const onTrack = (event: Event) => {
      seen.push((event as CustomEvent<VoiceTutorMetricTrackDetail>).detail.encodedTrack);
    };
    document.addEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTrack);
    const sourceHandlers = new Map<string, () => void>();
    const sourceBuffer = {
      mode: 'segments',
      updating: false,
      appendBuffer: vi.fn(() => {
        expect(seen).toHaveLength(generationCount - 1);
        playStarted.resolve();
        audioHandlers.get('playing')?.();
        queueMicrotask(() => sourceHandlers.get('updateend')?.());
      }),
      addEventListener: (event: string, handler: () => void) => { sourceHandlers.set(event, handler); },
      removeEventListener: (event: string) => { sourceHandlers.delete(event); },
    } as unknown as SourceBuffer;
    class MockMediaSource {
      static isTypeSupported = () => true;
      readyState = 'open';
      addEventListener(event: string, handler: () => void) {
        if (event === 'sourceopen') queueMicrotask(handler);
      }
      removeEventListener() {}
      addSourceBuffer() { return sourceBuffer; }
      endOfStream() {
        window.setTimeout(() => audioHandlers.get('ended')?.(), 0);
      }
    }
    const originalMediaSource = globalThis.MediaSource;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.assign(globalThis, { MediaSource: MockMediaSource });
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:media-source-audio'),
      revokeObjectURL: vi.fn(),
    });
    const onPlaybackFinished = vi.fn();
    let generationCount = 0;

    try {
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => coachMessage.id,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished,
        onPlaybackError: () => undefined,
        onRender: () => undefined,
        fetchImpl: vi.fn(async (url: string) => (
          url.endsWith('/voice/speech/generate')
            ? new Response(new Uint8Array([0, 1, 2, 3]), {
                status: 200,
                headers: {
                  'Content-Type': 'audio/webm',
                  ...(generationCount++ === 0 ? { 'X-Tutor-Metric-Track': encodedTrack } : {}),
                },
              })
            : new Response('{}', { status: 200 })
        )) as unknown as typeof fetch,
        createAudio: () => audio,
      });

      controller.speak(coachMessage, { provider: 'voxcpm' });
      await vi.waitFor(() => expect(sourceBuffer.appendBuffer).toHaveBeenCalled());
      await vi.waitFor(() => expect(onPlaybackFinished).toHaveBeenCalledOnce());
      expect(audio.play).toHaveBeenCalledOnce();
      expect(seen).toEqual([encodedTrack]);

      controller.speak({ ...coachMessage, id: 'coach-2' }, { provider: 'voxcpm' });
      await vi.waitFor(() => expect(onPlaybackFinished).toHaveBeenCalledTimes(2));
      expect(audio.play).toHaveBeenCalledTimes(2);
      expect(seen).toEqual([encodedTrack, null]);
    } finally {
      document.removeEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTrack);
      if (originalMediaSource === undefined) {
        delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
      } else {
        Object.assign(globalThis, { MediaSource: originalMediaSource });
      }
      Object.assign(URL, {
        createObjectURL: originalCreateObjectURL,
        revokeObjectURL: originalRevokeObjectURL,
      });
    }
  });

  it('aborts a MediaSource open wait and removes its listeners on supersession', async () => {
    installIdleSpeechSynthesis();
    const mediaListeners = new Map<string, () => void>();
    class PendingMediaSource {
      static isTypeSupported = () => true;
      readyState = 'open';
      addEventListener(event: string, handler: () => void) { mediaListeners.set(event, handler); }
      removeEventListener(event: string) { mediaListeners.delete(event); }
      addSourceBuffer() { throw new Error('sourceopen must not run after stop'); }
      endOfStream() {}
    }
    const originalMediaSource = globalThis.MediaSource;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.assign(globalThis, { MediaSource: PendingMediaSource });
    const createObjectURL = vi.fn(() => 'blob:pending-media-source');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    const audio = createAudioStub();
    const onPlaybackError = vi.fn();
    const fetchImpl = vi.fn(async (url: string) => (
      url.endsWith('/voice/speech/generate')
        ? new Response(new Uint8Array([0, 1, 2, 3]), {
            status: 200,
            headers: { 'Content-Type': 'audio/webm' },
          })
        : new Response('{}', { status: 200 })
    ));

    try {
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => null,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished: () => undefined,
        onPlaybackError,
        onRender: () => undefined,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createAudio: () => audio,
      });

      controller.speak(coachMessage, { provider: 'voxcpm' });
      await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalled());
      controller.stop();
      await flushSpeechWork();

      expect(mediaListeners.size).toBe(0);
      expect(audio.pause).toHaveBeenCalled();
      expect(onPlaybackError).not.toHaveBeenCalled();
    } finally {
      if (originalMediaSource === undefined) {
        delete (globalThis as { MediaSource?: typeof MediaSource }).MediaSource;
      } else {
        Object.assign(globalThis, { MediaSource: originalMediaSource });
      }
      Object.assign(URL, {
        createObjectURL: originalCreateObjectURL,
        revokeObjectURL: originalRevokeObjectURL,
      });
    }
  });

  it('bounds the post-play acknowledgement so the learner handoff cannot hang', async () => {
    installIdleSpeechSynthesis();
    const handlers = new Map<string, () => void>();
    const audio = {
      ...createAudioStub(),
      addEventListener: (event: string, handler: () => void) => { handlers.set(event, handler); },
      removeEventListener: (event: string) => { handlers.delete(event); },
    } as HTMLAudioElement;
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:ack-timeout-audio'),
      revokeObjectURL: vi.fn(),
    });
    const onPlaybackFinished = vi.fn();
    const fetchImpl = vi.fn((url: string, init?: RequestInit) => {
      if (url.endsWith('/voice/speech/generate')) {
        return Promise.resolve(new Response(new Blob(['audio']), {
          status: 200,
          headers: { 'Content-Type': 'audio/wav', ...VERIFIED_CLONE_HEADERS },
        }));
      }
      if (url.endsWith('/voice/speech/played')) {
        return new Promise<Response>((_resolve, reject) => {
          const abort = () => {
            const error = new Error('played acknowledgement timed out');
            error.name = 'AbortError';
            reject(error);
          };
          init?.signal?.addEventListener('abort', abort, { once: true });
          if (init?.signal?.aborted) abort();
        });
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    });

    try {
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        getReferenceClipId: () => 'selected-reference-clip',
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => coachMessage.id,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished,
        onPlaybackError: () => undefined,
        onRender: () => undefined,
        fetchImpl: fetchImpl as unknown as typeof fetch,
        createAudio: () => audio,
        playedAcknowledgementTimeoutMs: 25,
      });

      controller.speak(coachMessage, { provider: 'voxcpm' });
      await vi.waitFor(() => expect(handlers.has('ended')).toBe(true));
      handlers.get('playing')?.();
      handlers.get('ended')?.();

      await vi.waitFor(() => expect(onPlaybackFinished).toHaveBeenCalledOnce());
      expect(fetchImpl.mock.calls.some(([url]) => String(url).endsWith('/voice/speech/played'))).toBe(true);
    } finally {
      Object.assign(URL, {
        createObjectURL: originalCreateObjectURL,
        revokeObjectURL: originalRevokeObjectURL,
      });
    }
  });

  it('releases object urls after VoxCPM playback completes', async () => {
    vi.useFakeTimers();

    const fetchMock = vi.fn(() => Promise.resolve(new Response(
      new Blob(['audio'], { type: 'audio/wav' }),
      { status: 200, headers: { 'content-type': 'audio/wav', ...VERIFIED_CLONE_HEADERS } },
    )));
    const createObjectUrlMock = vi.fn(() => 'blob:voice-audio');
    const revokeObjectUrlMock = vi.fn();

    const urlAny = URL as any;
    const originalCreateObjectURL = urlAny.createObjectURL;
    const originalRevokeObjectURL = urlAny.revokeObjectURL;
    urlAny.createObjectURL = createObjectUrlMock;
    urlAny.revokeObjectURL = revokeObjectUrlMock;

    let endedHandler: (() => void) | null = null;
    const audio = {
      preload: '',
      src: '',
      onended: null,
      onerror: null,
      play: vi.fn(() => Promise.resolve()),
      pause: vi.fn(),
      load: vi.fn(),
      removeAttribute: vi.fn(),
      addEventListener: (event: string, handler: () => void) => {
        if (event === 'ended') {
          endedHandler = handler;
        }
      },
      removeEventListener: () => undefined,
    } as any as HTMLAudioElement;

    Object.assign(window, {
      speechSynthesis: {
        cancel: vi.fn(),
        speaking: false,
        pending: false,
      },
    });

    try {
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        getReferenceClipId: () => 'selected-reference-clip',
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => null,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished: () => undefined,
        onPlaybackError: () => undefined,
        onRender: () => undefined,
        fetchImpl: fetchMock as any,
        createAudio: () => audio,
      });

      controller.speak({
        id: 'coach-1',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Try the ending lighter.',
        createdAt: 1,
      }, {
        provider: 'voxcpm',
      });

      for (let index = 0; index < 10 && !endedHandler; index += 1) {
        await Promise.resolve();
      }
      expect(createObjectUrlMock).toHaveBeenCalled();
      expect(endedHandler).not.toBeNull();
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/voice/speech/played'))).toBe(false);

      endedHandler?.();
      await Promise.resolve();
      await Promise.resolve();
      await vi.advanceTimersByTimeAsync(200);

      expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:voice-audio');
      const playedCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/voice/speech/played'));
      expect(playedCall).toBeDefined();
      expect(JSON.parse(String(playedCall?.[1]?.body))).toEqual({
        sessionId: 'session-1',
        provider: 'voxcpm',
      });
    } finally {
      urlAny.createObjectURL = originalCreateObjectURL;
      urlAny.revokeObjectURL = originalRevokeObjectURL;
    }
  });

  // Surfacing wave (honesty): the X-Reference-Resolved header is read off the
  // speech Response on the streaming path and forwarded to onReferenceResolution.
  it('forwards the X-Reference-Resolved header to onReferenceResolution', async () => {
    installIdleSpeechSynthesis();

    const runCase = async (headerValue: string | null): Promise<Array<boolean>> => {
      const seen: boolean[] = [];
      const { response } = createPendingSpeechResponse('stream-1');
      if (headerValue !== null) {
        response.headers.set('X-Reference-Resolved', headerValue);
      }
      const fetchMock = vi.fn(() => Promise.resolve(response));
      const controller = createVoiceCoachSpeechController({
        kernelUrl: 'http://kernel.test',
        getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
        getRequestedProvider: () => 'voxcpm',
        setLastSpokenCoachMessageId: () => undefined,
        getLastSpokenCoachMessageId: () => null,
        setVoxCpmStatus: () => undefined,
        onPlaybackFinished: () => undefined,
        onPlaybackError: () => undefined,
        onRender: () => undefined,
        fetchImpl: fetchMock as unknown as typeof fetch,
        createAudio: createAudioStub,
        onReferenceResolution: (resolved) => {
          seen.push(resolved);
        },
      });
      controller.speak(coachMessage, { provider: 'voxcpm' });
      await flushSpeechWork();
      return seen;
    };

    expect(await runCase('false')).toEqual([false]);
    expect(await runCase('true')).toEqual([true]);
    expect(await runCase(null)).toEqual([]);
  });
});
