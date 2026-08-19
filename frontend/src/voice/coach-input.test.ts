import { afterEach, describe, expect, it, vi } from 'vitest';

import { createVoiceCoachThreadLineChannel } from './coach-thread-line';
import { resolveVoiceCoachRenderHandoffPlan } from './orchestrator';

const audioMocks = vi.hoisted(() => ({
  createPcm16Capture: vi.fn(),
  createVoiceAudioContext: vi.fn(),
}));

vi.mock('./audio/pcm16-capture', () => ({
  createPcm16Capture: audioMocks.createPcm16Capture,
}));

vi.mock('./audio/audio-context', () => ({
  createVoiceAudioContext: audioMocks.createVoiceAudioContext,
}));

import {
  createVoiceCoachInputController,
  DEGENERATE_TAKE_HINT,
  DEGENERATE_TAKE_HINT_AFTER,
} from './coach-input';
import {
  applyVoiceInputRuntimeEvent,
  createVoiceInputRuntimeController,
} from './input-runtime-controller';
import { createVoiceRuntimeStatusController } from './runtime-status';
import { createDefaultVoiceUiState } from './state';

type InputProvider = 'backend' | 'browser';
type FrontendState = {
  status: 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
  error: string | null;
  finalTranscript: string;
  finalConfidence: number | null;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

type MockStream = MediaStream & {
  rms: number;
  track: MediaStreamTrack & { stop: ReturnType<typeof vi.fn> };
};

type MockLiveCapture = {
  captureSampleRate: number;
  outputSampleRate: number;
  frameSize: number;
  mode: 'script-processor';
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
};

type LiveFailureKind = 'envelope' | 'socket-error' | 'socket-close' | 'frame-send';

type CapturedLiveHandlers = {
  message: (event: any) => void;
  error: (event: any) => void;
  close: (event: any) => void;
  frame: (frame: ArrayBuffer) => void;
};

let capturedPcmOnFrame: ((frame: ArrayBuffer) => void) | null = null;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) {
    await Promise.resolve();
  }
}

function createMockStream(label: string): MockStream {
  const track = {
    label,
    stop: vi.fn(),
    getSettings: () => ({ deviceId: `${label}-device` }),
  } as unknown as MockStream['track'];
  return {
    rms: 0,
    track,
    getTracks: () => [track],
    getAudioTracks: () => [track],
  } as unknown as MockStream;
}

function installAudioContextMock(): void {
  audioMocks.createVoiceAudioContext.mockImplementation(() => {
    let sourceStream: MockStream | null = null;
    const sourceNode = {
      connect: vi.fn(),
      disconnect: vi.fn(),
    };
    const analyser = {
      fftSize: 0,
      disconnect: vi.fn(),
      getFloatTimeDomainData: vi.fn((samples: Float32Array) => {
        samples.fill(sourceStream?.rms ?? 0);
      }),
    };
    return {
      sampleRate: 48000,
      destination: {},
      createMediaStreamSource: vi.fn((stream: MediaStream) => {
        sourceStream = stream as MockStream;
        return sourceNode;
      }),
      createAnalyser: vi.fn(() => analyser),
      close: vi.fn(async () => undefined),
    } as unknown as AudioContext;
  });
}

function installLiveCaptureMock(
  start: ReturnType<typeof vi.fn> = vi.fn(async () => {
    queueMicrotask(() => capturedPcmOnFrame?.(new ArrayBuffer(2048)));
  }),
): MockLiveCapture {
  const capture: MockLiveCapture = {
    captureSampleRate: 48_000,
    outputSampleRate: 16_000,
    frameSize: 1_024,
    mode: 'script-processor',
    start,
    stop: vi.fn(),
  };
  audioMocks.createPcm16Capture.mockImplementation(async (options: {
    onFrame: (frame: ArrayBuffer) => void;
  }) => {
    capturedPcmOnFrame = options.onFrame;
    return capture;
  });
  return capture;
}

class MockMediaRecorder {
  static instances: MockMediaRecorder[] = [];
  static terminalMode: 'manual' | 'native' | 'missing-stop' = 'manual';
  static finalData = 'native-final';
  static constructorError: Error | null = null;
  static startError: Error | null = null;
  static autoStartEvent = true;

  static isTypeSupported(): boolean {
    return true;
  }

  readonly stream: MediaStream;
  readonly mimeType: string;
  state: RecordingState = 'inactive';
  onstart: ((event: Event) => void) | null = null;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  stopCalls = 0;
  stopTrackCounts: number[] = [];

  constructor(stream: MediaStream, options?: MediaRecorderOptions) {
    this.stream = stream;
    this.mimeType = options?.mimeType || 'audio/webm';
    if (MockMediaRecorder.constructorError) throw MockMediaRecorder.constructorError;
    MockMediaRecorder.instances.push(this);
  }

  start(): void {
    if (MockMediaRecorder.startError) throw MockMediaRecorder.startError;
    this.state = 'recording';
    if (MockMediaRecorder.autoStartEvent) {
      queueMicrotask(() => this.onstart?.(new Event('start')));
    }
  }

  emitStart(): void {
    this.onstart?.(new Event('start'));
  }

  stop(): void {
    this.stopCalls += 1;
    const track = this.stream.getTracks()[0] as MockStream['track'] | undefined;
    this.stopTrackCounts.push(track?.stop.mock.calls.length ?? 0);
    this.state = 'inactive';
    if (MockMediaRecorder.terminalMode === 'native') {
      const ondataavailable = this.ondataavailable;
      const onstop = this.onstop;
      queueMicrotask(() => {
        ondataavailable?.({
          data: new Blob([MockMediaRecorder.finalData], { type: this.mimeType }),
        } as BlobEvent);
        onstop?.(new Event('stop'));
      });
    }
  }

  emitData(value: string): void {
    this.ondataavailable?.({ data: new Blob([value], { type: this.mimeType }) } as BlobEvent);
  }

  emitStop(): void {
    this.onstop?.(new Event('stop'));
  }

  emitError(): void {
    this.onerror?.(new Event('error'));
  }
}

class MockWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: MockWebSocket[] = [];
  static sendError: Error | null = null;
  static autoSessionStarted = true;
  static autoCaptureReady = true;

  readyState = MockWebSocket.CONNECTING;
  binaryType = 'blob';
  sent: unknown[] = [];
  closeCalls = 0;
  private readonly listeners = new Map<string, Array<(event: any) => void>>();

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  addEventListener(type: string, listener: (event: any) => void): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  handlers(type: string): Array<(event: any) => void> {
    return [...(this.listeners.get(type) ?? [])];
  }

  emit(type: string, event: any = {}): void {
    if (type === 'open') this.readyState = MockWebSocket.OPEN;
    if (type === 'close') this.readyState = MockWebSocket.CLOSED;
    this.handlers(type).forEach((listener) => listener(event));
  }

  send(value: unknown): void {
    if (MockWebSocket.sendError) throw MockWebSocket.sendError;
    this.sent.push(value);
    if (typeof value === 'string') {
      try {
        const payload = JSON.parse(value) as { type?: unknown; sessionId?: unknown };
        if (payload.type === 'open') {
          queueMicrotask(() => {
            if (this.readyState !== MockWebSocket.OPEN) return;
            if (MockWebSocket.autoSessionStarted) {
              this.emit('message', {
                data: JSON.stringify({
                  event: 'session-started',
                  sessionId: payload.sessionId,
                  sampleRate: 16000,
                }),
              });
            }
            if (MockWebSocket.autoCaptureReady) {
              this.emit('message', {
                data: JSON.stringify({
                  event: 'capture-ready',
                  sessionId: payload.sessionId,
                  sampleRate: 16000,
                }),
              });
            }
          });
        }
      } catch {
        // Non-control test frames are intentionally ignored.
      }
    }
  }

  close(): void {
    this.closeCalls += 1;
    if (this.readyState === MockWebSocket.CLOSED || this.readyState === MockWebSocket.CLOSING) return;
    this.readyState = MockWebSocket.CLOSING;
    const closeHandlers = this.handlers('close');
    queueMicrotask(() => {
      this.readyState = MockWebSocket.CLOSED;
      closeHandlers.forEach((listener) => listener(new Event('close')));
    });
  }
}

class MockRecognition {
  static instances: MockRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = '';
  onstart: ((event: Event) => void) | null = null;
  onresult: ((event: any) => void) | null = null;
  onerror: ((event: any) => void) | null = null;
  private currentOnEnd: ((event: Event) => void) | null = null;
  private queuedOnEnd: ((event: Event) => void) | null = null;
  start = vi.fn();
  stop = vi.fn(() => this.queueEnd());
  abort = vi.fn(() => this.queueEnd());

  constructor() {
    MockRecognition.instances.push(this);
  }

  get onend(): ((event: Event) => void) | null {
    return this.currentOnEnd;
  }

  set onend(handler: ((event: Event) => void) | null) {
    this.currentOnEnd = handler;
    if (handler) this.queuedOnEnd = handler;
  }

  private queueEnd(): void {
    const onend = this.queuedOnEnd;
    queueMicrotask(() => onend?.(new Event('end')));
  }
}

function createResultEvent(transcript: string, confidence = 0.9): any {
  return {
    resultIndex: 0,
    results: [{
      0: { transcript, confidence },
      isFinal: true,
      length: 1,
    }],
  };
}

function captureMonitorCallbacks(): Array<() => void> {
  const callbacks: Array<() => void> = [];
  vi.spyOn(window, 'setInterval').mockImplementation(((handler: TimerHandler) => {
    if (typeof handler === 'function') callbacks.push(handler as () => void);
    return callbacks.length;
  }) as typeof window.setInterval);
  vi.spyOn(window, 'clearInterval').mockImplementation(() => undefined);
  return callbacks;
}

function createHarness(overrides: {
  effectiveProvider?: InputProvider | null;
  requestedProvider?: InputProvider;
  sessionId?: string;
  getUserMedia?: ReturnType<typeof vi.fn>;
  submitInputTurn?: ReturnType<typeof vi.fn>;
  syncRuntimeEvent?: ReturnType<typeof vi.fn>;
  releasePracticeForListening?: ReturnType<typeof vi.fn>;
  isCoachSpeechBusy?: () => boolean;
  /** What the host's speech path returns — false models "no speaker available". */
  speakCoachLine?: boolean;
  /** A REAL host speech implementation, for wired tests. Wins over speakCoachLine. */
  speakCoachLineImpl?: (text: string) => boolean;
  stopCoachSpeech?: ReturnType<typeof vi.fn>;
  canUseBackendRecordedFallback?: boolean;
  canUseBackendLiveCapture?: boolean;
  getRuntimeState?: () => ReturnType<typeof createDefaultVoiceUiState>['voiceInputRuntime'];
} = {}) {
  const context = {
    effectiveProvider: overrides.effectiveProvider === undefined ? 'backend' as InputProvider : overrides.effectiveProvider,
    requestedProvider: overrides.requestedProvider ?? 'backend' as InputProvider,
    sessionId: overrides.sessionId ?? 'session-A',
    isConnected: true,
    sessionLease: {},
  };
  const state: FrontendState = {
    status: 'idle',
    error: null,
    finalTranscript: '',
    finalConfidence: null,
  };
  const getUserMedia = overrides.getUserMedia ?? vi.fn();
  const stateTransitions: FrontendState[] = [];
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  });
  vi.stubGlobal('MediaRecorder', MockMediaRecorder);

  const setState = vi.fn((updater: (current: FrontendState) => FrontendState) => {
    Object.assign(state, updater({ ...state }));
    stateTransitions.push({ ...state });
  });
  const setQuestionDraft = vi.fn();
  const syncRuntimeEvent = overrides.syncRuntimeEvent ?? vi.fn(async () => undefined);
  const submitInputTurn = overrides.submitInputTurn ?? vi.fn(async (_sessionId: string) => ({
    inputTurn: { transcript: 'captured question' },
  }));
  const handleCapturedQuestion = vi.fn(async () => undefined);
  const applyInputProviderStatusPayload = vi.fn();
  const applyVoiceBackendPayload = vi.fn();
  const render = vi.fn();
  const stopCoachSpeech = overrides.stopCoachSpeech ?? vi.fn();
  const clearQuestionFeedback = vi.fn();
  const reportQuestionFeedbackError = vi.fn();
  const appendCoachLine = vi.fn();
  // Returns whether playback started — the speakCoachMessage contract. Default
  // true; `speakCoachLine: false` in the overrides models a host with no usable
  // speech path, which must degrade to the text append alone.
  const speakCoachLine = vi.fn((text: string) => (
    overrides.speakCoachLineImpl
      ? overrides.speakCoachLineImpl(text)
      : (overrides.speakCoachLine ?? true)
  ));

  const controller = createVoiceCoachInputController({
    kernelWsUrl: 'ws://kernel.test',
    getSessionContext: () => ({
      currentSessionId: context.sessionId,
      isConnected: context.isConnected,
      sessionLease: context.sessionLease,
    }),
    getRequestedInputProvider: () => context.requestedProvider,
    getEffectiveInputProvider: () => context.effectiveProvider,
    getState: () => state,
    setState,
    setQuestionDraft,
    clearQuestionFeedback,
    reportQuestionFeedbackError,
    appendCoachLine,
    speakCoachLine,
    getRuntimeState: overrides.getRuntimeState
      ?? (() => createDefaultVoiceUiState().voiceInputRuntime),
    getSelectedInputDeviceId: () => null,
    updateResolvedInput: vi.fn(),
    canUseBackendRecordedFallback: () => overrides.canUseBackendRecordedFallback ?? true,
    canUseBackendLiveCapture: () => overrides.canUseBackendLiveCapture ?? true,
    getSilenceThreshold: () => 0.018,
    releasePracticeForListening: overrides.releasePracticeForListening ?? vi.fn(async () => undefined),
    isCoachSpeechBusy: overrides.isCoachSpeechBusy ?? (() => false),
    stopCoachSpeech,
    render,
    syncRuntimeEvent,
    submitInputTurn,
    handleCapturedQuestion,
    applyInputProviderStatusPayload,
    applyVoiceBackendPayload,
  });

  return {
    context,
    state,
    getUserMedia,
    setState,
    setQuestionDraft,
    syncRuntimeEvent,
    submitInputTurn,
    handleCapturedQuestion,
    applyInputProviderStatusPayload,
    applyVoiceBackendPayload,
    stopCoachSpeech,
    clearQuestionFeedback,
    reportQuestionFeedbackError,
    appendCoachLine,
    speakCoachLine,
    render,
    stateTransitions,
    controller,
  };
}

function driveVadStop(stream: MockStream, monitor: () => void, setNow: (value: number) => void): void {
  setNow(1_000);
  stream.rms = 0.1;
  monitor();
  // Recorded-mode fallback is deliberately conservative: careful speakers and
  // people who stutter get at least 4.5 s after the last detected voice frame.
  setNow(6_000);
  stream.rms = 0;
  monitor();
}

async function readBlob(blob: Blob): Promise<string> {
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener('load', () => resolve(String(reader.result ?? '')));
    reader.addEventListener('error', () => reject(reader.error));
    reader.readAsText(blob);
  });
}

function captureLiveHandlers(socket: MockWebSocket): CapturedLiveHandlers {
  return {
    message: socket.handlers('message')[0],
    error: socket.handlers('error')[0],
    close: socket.handlers('close')[0],
    frame: capturedPcmOnFrame as (frame: ArrayBuffer) => void,
  };
}

function fireLiveFailure(
  kind: LiveFailureKind,
  socket: MockWebSocket,
  handlers: CapturedLiveHandlers,
  envelopeError = 'backend live envelope failed',
): void {
  if (kind === 'envelope') {
    handlers.message({ data: JSON.stringify({ event: 'error', error: envelopeError }) });
    return;
  }
  if (kind === 'socket-error') {
    handlers.error(new Event('error'));
    return;
  }
  if (kind === 'socket-close') {
    socket.readyState = MockWebSocket.CLOSED;
    handlers.close(new Event('close'));
    return;
  }
  MockWebSocket.sendError = new Error('forced frame send failure');
  handlers.frame(new ArrayBuffer(2));
}

function fireAllSavedLiveFailures(
  socket: MockWebSocket,
  handlers: CapturedLiveHandlers,
): void {
  handlers.message({ data: JSON.stringify({ event: 'error', error: 'late envelope failure' }) });
  handlers.error(new Event('error'));
  socket.readyState = MockWebSocket.CLOSED;
  handlers.close(new Event('close'));
  MockWebSocket.sendError = new Error('late frame send failure');
  handlers.frame(new ArrayBuffer(2));
}

describe('voice coach input controller', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    audioMocks.createPcm16Capture.mockReset();
    audioMocks.createVoiceAudioContext.mockReset();
    MockMediaRecorder.instances = [];
    MockMediaRecorder.terminalMode = 'manual';
    MockMediaRecorder.finalData = 'native-final';
    MockMediaRecorder.constructorError = null;
    MockMediaRecorder.startError = null;
    MockMediaRecorder.autoStartEvent = true;
    MockWebSocket.instances = [];
    MockWebSocket.sendError = null;
    MockWebSocket.autoSessionStarted = true;
    MockWebSocket.autoCaptureReady = true;
    MockRecognition.instances = [];
    capturedPcmOnFrame = null;
    delete (window as any).SpeechRecognition;
    delete (window as any).webkitSpeechRecognition;
    delete (window as any).__tvTelemetry;
    delete (window as any).__SLOANE_BACKEND_ERRORS;
    delete (window as any).__SLOANE_BACKEND_ERROR_SEQ;
    delete (navigator as any).mediaDevices;
    vi.useRealTimers();
  });

  it('does not let an in-flight listening start cancel tutor speech that began during async preparation', async () => {
    const release = deferred<void>();
    let coachSpeechBusy = false;
    const telemetryEvent = vi.fn();
    (window as any).__tvTelemetry = { event: telemetryEvent };
    const getUserMedia = vi.fn(async () => createMockStream('must-not-open'));
    const stopCoachSpeech = vi.fn();
    const harness = createHarness({
      getUserMedia,
      releasePracticeForListening: vi.fn(() => release.promise),
      isCoachSpeechBusy: () => coachSpeechBusy,
      stopCoachSpeech,
    });

    const starting = harness.controller.start();
    await flushAsync();
    coachSpeechBusy = true;
    release.resolve();

    await expect(starting).resolves.toBe(false);
    expect(stopCoachSpeech).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(telemetryEvent).toHaveBeenCalledWith(
      'info',
      'voice-input-handoff',
      'ok',
      'listening-yielded-to-coach-speech',
    );
  });

  it('starts recorded backend capture directly when websocket live capture is unavailable', async () => {
    installAudioContextMock();
    captureMonitorCallbacks();
    const recordedStream = createMockStream('recorded-only');
    const getUserMedia = vi.fn(async () => recordedStream);
    const harness = createHarness({
      getUserMedia,
      canUseBackendLiveCapture: false,
    });

    await expect(harness.controller.start()).resolves.toBe(true);
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(audioMocks.createPcm16Capture).not.toHaveBeenCalled();
    expect(MockWebSocket.instances).toHaveLength(0);
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].state).toBe('recording');
  });

  it('does not acknowledge recorded capture until MediaRecorder reports it open', async () => {
    installAudioContextMock();
    captureMonitorCallbacks();
    MockMediaRecorder.autoStartEvent = false;
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('recorder-readiness')),
      canUseBackendLiveCapture: false,
    });

    let settled = false;
    const starting = harness.controller.start().then((value) => {
      settled = true;
      return value;
    });
    await flushAsync();

    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].state).toBe('recording');
    expect(settled).toBe(false);

    MockMediaRecorder.instances[0].emitStart();
    await expect(starting).resolves.toBe(true);
  });

  it('treats an empty recorded ASR result as no-speech instead of a microphone error', async () => {
    installAudioContextMock();
    const monitors = captureMonitorCallbacks();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const recordedStream = createMockStream('recorded-no-speech');
    const syncRuntimeEvent = vi.fn(async (_event: string) => undefined);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => recordedStream),
      canUseBackendLiveCapture: false,
      syncRuntimeEvent,
      submitInputTurn: vi.fn(async () => ({
        inputTurn: {
          outcome: 'no-speech',
          transcript: null,
        },
      })),
    });

    await expect(harness.controller.start()).resolves.toBe(true);
    const recorder = MockMediaRecorder.instances[0];
    recorder.emitData('quiet-audio');
    driveVadStop(recordedStream, monitors[0], (value) => { now = value; });
    recorder.emitStop();
    await flushAsync();
    await flushAsync();

    expect(harness.state).toMatchObject({ status: 'idle', error: null });
    expect(syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error')).toHaveLength(0);
    expect(syncRuntimeEvent.mock.calls.filter(([event]) => event === 'no-speech')).toHaveLength(1);
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();
  });

  it('keeps delayed recorded takes isolated and finalizes each take exactly once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    const monitors = captureMonitorCallbacks();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const aLive = createMockStream('a-live');
    const aRecorded = createMockStream('a-recorded');
    const bLive = createMockStream('b-live');
    const bRecorded = createMockStream('b-recorded');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(aLive)
      .mockResolvedValueOnce(aRecorded)
      .mockResolvedValueOnce(bLive)
      .mockResolvedValueOnce(bRecorded);
    const submitInputTurn = vi.fn(async (
      sessionId: string,
      _payload: { requestedProvider: string; audioBlob: Blob },
    ) => ({
      inputTurn: { transcript: sessionId === 'session-A' ? 'question A' : 'question B' },
    }));
    const harness = createHarness({ getUserMedia, submitInputTurn });

    await harness.controller.start();
    const recorderA = MockMediaRecorder.instances[0];
    recorderA.emitData('A-first|');
    driveVadStop(aRecorded, monitors[0], (value) => { now = value; });
    expect(recorderA.stopCalls).toBe(1);

    harness.context.sessionId = 'session-B';
    harness.context.requestedProvider = 'browser';
    await harness.controller.start();
    const recorderB = MockMediaRecorder.instances[1];
    expect(recorderB.state).toBe('recording');

    recorderA.emitData('A-final');
    recorderA.emitStop();
    recorderA.emitStop();
    await flushAsync();

    expect(submitInputTurn).toHaveBeenCalledTimes(1);
    expect(submitInputTurn.mock.calls[0][0]).toBe('session-A');
    expect(submitInputTurn.mock.calls[0][1].requestedProvider).toBe('backend');
    expect(await readBlob(submitInputTurn.mock.calls[0][1].audioBlob)).toBe('A-first|A-final');
    expect(harness.state.status).toBe('waiting');
    expect(recorderB.state).toBe('recording');

    recorderB.emitData('B-only');
    driveVadStop(bRecorded, monitors[1], (value) => { now = value; });
    monitors[1]();
    expect(recorderB.stopCalls).toBe(1);
    recorderB.emitStop();
    recorderB.emitStop();
    await flushAsync();

    expect(submitInputTurn).toHaveBeenCalledTimes(2);
    expect(submitInputTurn.mock.calls[1][0]).toBe('session-B');
    expect(submitInputTurn.mock.calls[1][1].requestedProvider).toBe('browser');
    expect(await readBlob(submitInputTurn.mock.calls[1][1].audioBlob)).toBe('B-only');
    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledWith('question B');
  });

  it('drops a stale recorded API result while the current take publishes once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    const monitors = captureMonitorCallbacks();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);

    const aResponse = deferred<any>();
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('a-live'))
      .mockResolvedValueOnce(createMockStream('a-recorded'))
      .mockResolvedValueOnce(createMockStream('b-live'))
      .mockResolvedValueOnce(createMockStream('b-recorded'));
    const submitInputTurn = vi.fn()
      .mockImplementationOnce(() => aResponse.promise)
      .mockResolvedValueOnce({ inputTurn: { transcript: 'question B' }, voiceState: { marker: 'B' } });
    const harness = createHarness({ getUserMedia, submitInputTurn });

    await harness.controller.start();
    const recorderA = MockMediaRecorder.instances[0];
    recorderA.emitData('A');
    driveVadStop(recorderA.stream as MockStream, monitors[0], (value) => { now = value; });
    recorderA.emitStop();
    await flushAsync();
    expect(submitInputTurn).toHaveBeenCalledTimes(1);

    harness.context.sessionId = 'session-B';
    await harness.controller.start();
    const recorderB = MockMediaRecorder.instances[1];
    const stateBeforeAResult = { ...harness.state };
    const renderCount = harness.render.mock.calls.length;
    const runtimeEventCount = harness.syncRuntimeEvent.mock.calls.length;

    aResponse.resolve({ inputTurn: { transcript: 'question A' }, voiceState: { marker: 'A' } });
    await flushAsync();

    expect(harness.state).toEqual(stateBeforeAResult);
    expect(harness.render).toHaveBeenCalledTimes(renderCount);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(runtimeEventCount);
    expect(harness.applyInputProviderStatusPayload).not.toHaveBeenCalled();
    expect(harness.applyVoiceBackendPayload).not.toHaveBeenCalled();
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();

    recorderB.emitData('B');
    driveVadStop(recorderB.stream as MockStream, monitors[1], (value) => { now = value; });
    recorderB.emitStop();
    await flushAsync();

    expect(harness.applyInputProviderStatusPayload).toHaveBeenCalledTimes(1);
    expect(harness.applyVoiceBackendPayload).toHaveBeenCalledTimes(1);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledWith('question B');
  });

  it('discards a superseded pending media stream without starting its recorder', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    captureMonitorCallbacks();

    const pendingAStream = deferred<MediaStream>();
    const staleAStream = createMockStream('a-stale-live');
    const getUserMedia = vi.fn()
      .mockImplementationOnce(() => pendingAStream.promise)
      .mockResolvedValueOnce(createMockStream('b-live'))
      .mockResolvedValueOnce(createMockStream('b-recorded'))
      .mockResolvedValueOnce(createMockStream('a-should-not-record'));
    const harness = createHarness({ getUserMedia });

    const startA = harness.controller.start();
    await flushAsync();
    expect(getUserMedia).toHaveBeenCalledTimes(1);

    harness.context.sessionId = 'session-B';
    const startB = harness.controller.start();
    await startB;
    expect(MockMediaRecorder.instances).toHaveLength(1);

    pendingAStream.resolve(staleAStream);
    await expect(startA).resolves.toBe(false);
    await flushAsync();

    expect(staleAStream.track.stop).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].state).toBe('recording');
  });

  it('ignores saved live-socket callbacks after a replacement becomes current', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('a-live'))
      .mockResolvedValueOnce(createMockStream('b-live'));
    const harness = createHarness({ getUserMedia });

    const startA = harness.controller.start();
    await flushAsync();
    MockWebSocket.instances[0].emit('open');
    await startA;
    const staleMessage = MockWebSocket.instances[0].handlers('message')[0];

    harness.context.sessionId = 'session-B';
    const startB = harness.controller.start();
    await flushAsync();
    MockWebSocket.instances[1].emit('open');
    await startB;

    const stateBeforeStaleMessage = { ...harness.state };
    const renderCount = harness.render.mock.calls.length;
    const runtimeEventCount = harness.syncRuntimeEvent.mock.calls.length;
    staleMessage({
      data: JSON.stringify({
        event: 'final-transcript',
        segmentId: 'segment-A',
        transcript: 'stale live question',
        autoSubmit: true,
        providers: { marker: 'A' },
        voiceState: { marker: 'A' },
      }),
    });
    await flushAsync();

    expect(harness.state).toEqual(stateBeforeStaleMessage);
    expect(harness.render).toHaveBeenCalledTimes(renderCount);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(runtimeEventCount);
    expect(harness.setQuestionDraft).not.toHaveBeenCalled();
    expect(harness.applyInputProviderStatusPayload).not.toHaveBeenCalled();
    expect(harness.applyVoiceBackendPayload).not.toHaveBeenCalled();
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();

    MockWebSocket.instances[1].emit('message', {
      data: JSON.stringify({
        event: 'final-transcript',
        segmentId: 'segment-B',
        listeningTurnId: 'listen-turn-B',
        transcript: 'current live question',
        autoSubmit: true,
      }),
    });
    await flushAsync();
    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledWith(
      'current live question',
      { listeningTurnId: 'listen-turn-B' },
    );
  });

  it('ignores saved browser-recognition callbacks after replacement', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const submitInputTurn = vi.fn(async (_sessionId: string) => ({
      inputTurn: { transcript: 'current browser question' },
    }));
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      submitInputTurn,
    });

    await harness.controller.start();
    const recognitionA = MockRecognition.instances[0];
    const staleResult = recognitionA.onresult;
    const staleError = recognitionA.onerror;
    const staleEnd = recognitionA.onend;

    harness.context.sessionId = 'session-B';
    await harness.controller.start();
    const recognitionB = MockRecognition.instances[1];
    const stateBeforeStaleCallbacks = { ...harness.state };
    const renderCount = harness.render.mock.calls.length;
    const runtimeEventCount = harness.syncRuntimeEvent.mock.calls.length;

    staleResult?.(createResultEvent('stale browser question'));
    staleError?.({ error: 'stale browser error' });
    staleEnd?.(new Event('end'));
    await flushAsync();

    expect(harness.state).toEqual(stateBeforeStaleCallbacks);
    expect(harness.render).toHaveBeenCalledTimes(renderCount);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(runtimeEventCount);
    expect(harness.setQuestionDraft).not.toHaveBeenCalled();
    expect(submitInputTurn).not.toHaveBeenCalled();
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();

    recognitionB.onresult?.(createResultEvent('current browser question'));
    recognitionB.onend?.(new Event('end'));
    await flushAsync();

    expect(submitInputTurn).toHaveBeenCalledTimes(1);
    expect(submitInputTurn.mock.calls[0][0]).toBe('session-B');
    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledWith('current browser question');
  });

  it('witnesses a transcript that resolves after its take was superseded', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const telemetryEvent = vi.fn();
    (window as any).__tvTelemetry = { event: telemetryEvent };
    const pending = deferred<{ inputTurn: { transcript: string } }>();
    const submitInputTurn = vi.fn(() => pending.promise);
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      submitInputTurn,
    });

    await harness.controller.start();
    const recognitionA = MockRecognition.instances[0];
    recognitionA.onresult?.(createResultEvent('a real finished sentence'));
    recognitionA.onend?.(new Event('end'));
    await flushAsync();
    expect(submitInputTurn).toHaveBeenCalledTimes(1);

    // The take is replaced while the transcript request is still in flight.
    harness.context.sessionId = 'session-B';
    await harness.controller.start();
    pending.resolve({ inputTurn: { transcript: 'a real finished sentence' } });
    await flushAsync();

    // The learner's words are dropped by design (stale owner) — but never
    // silently: the decline is named on the coach-turn-dispatch seam.
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();
    expect(telemetryEvent).toHaveBeenCalledWith(
      'warn',
      'coach-turn-dispatch',
      'never-received',
      'coach-turn-declined-owner-superseded',
    );
    delete (window as any).__tvTelemetry;
  });

  it('settles a superseded practice-release start false before the old release resolves', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const releaseA = deferred<void>();
    const releasePracticeForListening = vi.fn()
      .mockImplementationOnce(() => releaseA.promise)
      .mockResolvedValue(undefined);
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      releasePracticeForListening,
    });
    const pendingMarker = Symbol('pending');
    let observedA: boolean | void | symbol = pendingMarker;

    const startA = harness.controller.start().then((value) => {
      observedA = value;
      return value;
    });
    await flushAsync();
    const startB = harness.controller.start();
    await flushAsync();
    const observedBeforeRelease = observedA;
    releaseA.resolve();
    const [resultA, resultB] = await Promise.all([startA, startB]);

    expect(observedBeforeRelease).toBe(false);
    expect(resultA).toBe(false);
    expect(resultB).toBe(true);
    expect(MockRecognition.instances).toHaveLength(1);
  });

  it('settles an explicitly stopped media start false before getUserMedia resolves', async () => {
    installAudioContextMock();
    const pendingStream = deferred<MediaStream>();
    const staleStream = createMockStream('stopped-pending');
    const getUserMedia = vi.fn(() => pendingStream.promise);
    const harness = createHarness({ getUserMedia });
    const pendingMarker = Symbol('pending');
    let observed: boolean | void | symbol = pendingMarker;

    const start = harness.controller.start().then((value) => {
      observed = value;
      return value;
    });
    await flushAsync();
    await harness.controller.stop(true);
    await flushAsync();
    const observedBeforeMedia = observed;
    pendingStream.resolve(staleStream);
    const result = await start;
    await flushAsync();

    expect(observedBeforeMedia).toBe(false);
    expect(result).toBe(false);
    expect(staleStream.track.stop).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances).toHaveLength(0);
  });

  it('stops a late PCM capture handle once after startup cancellation already cleaned earlier resources', async () => {
    installAudioContextMock();
    const pendingCapture = deferred<{
      captureSampleRate: number;
      outputSampleRate: number;
      frameSize: number;
      mode: 'script-processor';
      start: ReturnType<typeof vi.fn>;
      stop: ReturnType<typeof vi.fn>;
    }>();
    audioMocks.createPcm16Capture.mockImplementation(() => pendingCapture.promise);
    const stream = createMockStream('late-pcm');
    const harness = createHarness({ getUserMedia: vi.fn(async () => stream) });
    const capture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'script-processor' as const,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
    };

    const start = harness.controller.start();
    await flushAsync();
    const context = audioMocks.createVoiceAudioContext.mock.results[0].value as any;
    const source = context.createMediaStreamSource.mock.results[0].value;
    await harness.controller.stop(true);
    await expect(start).resolves.toBe(false);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);

    pendingCapture.resolve(capture);
    await flushAsync();
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
  });

  it('makes a session-invalidated false start inactive so a restored-session toggle starts', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const release = deferred<void>();
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      sessionId: 'session-A',
      releasePracticeForListening: vi.fn(() => release.promise),
    });

    const start = harness.controller.start();
    await flushAsync();
    harness.context.sessionId = 'session-B';
    release.resolve();

    await expect(start).resolves.toBe(false);
    expect(MockRecognition.instances).toHaveLength(0);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();

    harness.context.sessionId = 'session-A';
    harness.controller.toggle();
    await flushAsync();
    expect(MockRecognition.instances).toHaveLength(1);
    expect(MockRecognition.instances[0].start).toHaveBeenCalledTimes(1);
  });

  it('treats starting ownership as active so a second toggle cancels it', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const release = deferred<void>();
    const releasePracticeForListening = vi.fn(() => release.promise);
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      releasePracticeForListening,
    });
    const pendingMarker = Symbol('pending');
    let observed: boolean | void | symbol = pendingMarker;

    const start = harness.controller.start().then((value) => {
      observed = value;
      return value;
    });
    await flushAsync();
    harness.controller.toggle();
    await flushAsync();
    const observedBeforeRelease = observed;
    release.resolve();
    const result = await start;

    expect(observedBeforeRelease).toBe(false);
    expect(result).toBe(false);
    expect(releasePracticeForListening).toHaveBeenCalledTimes(1);
    expect(MockRecognition.instances).toHaveLength(0);
  });

  it('returns true only for a current active start and false for unsupported capability', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const supported = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
    });
    await expect(supported.controller.start()).resolves.toBe(true);
    await supported.controller.stop(true);

    const unsupported = createHarness({
      effectiveProvider: null,
      requestedProvider: 'browser',
    });
    await expect(unsupported.controller.start()).resolves.toBe(false);
    expect(unsupported.state.status).toBe('unsupported');
  });

  it('settles a stopped pending socket start false and cleans its late resources', async () => {
    installAudioContextMock();
    const capture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'script-processor' as const,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
    };
    audioMocks.createPcm16Capture.mockResolvedValue(capture);
    vi.stubGlobal('WebSocket', MockWebSocket);
    const stream = createMockStream('socket-pending');
    const harness = createHarness({ getUserMedia: vi.fn(async () => stream) });
    const pendingMarker = Symbol('pending');
    let observed: boolean | void | symbol = pendingMarker;

    const start = harness.controller.start().then((value) => {
      observed = value;
      return value;
    });
    await flushAsync();
    expect(MockWebSocket.instances).toHaveLength(1);
    await harness.controller.stop(true);
    await flushAsync();
    const observedAfterStop = observed;
    const result = await start;

    expect(observedAfterStop).toBe(false);
    expect(result).toBe(false);
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(MockWebSocket.instances[0].closeCalls).toBe(1);
  });

  it('passes captured session and latest event epoch lifecycle and blocks session-change callbacks', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const syncRuntimeEvent = vi.fn(async (
      _event: string,
      _detail?: unknown,
      _lifecycle?: { sessionId: string; isCurrent(): boolean },
    ) => undefined);
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      sessionId: 'session-A',
      syncRuntimeEvent,
    });

    const started = await harness.controller.start();
    const recognition = MockRecognition.instances[0];
    recognition.onstart?.(new Event('start'));
    recognition.onresult?.(createResultEvent('epoch question'));

    expect(syncRuntimeEvent).toHaveBeenCalledTimes(3);
    expect(syncRuntimeEvent.mock.calls.map(([event]) => event)).toEqual(['waiting', 'listening', 'processing']);
    const listeningLifecycle = syncRuntimeEvent.mock.calls[1][2]!;
    const processingLifecycle = syncRuntimeEvent.mock.calls[2][2]!;
    expect(listeningLifecycle.sessionId).toBe('session-A');
    expect(processingLifecycle.sessionId).toBe('session-A');
    expect(listeningLifecycle.isCurrent()).toBe(false);
    expect(processingLifecycle.isCurrent()).toBe(true);

    harness.context.sessionId = 'session-B';
    const stateBeforeSessionChangeCallbacks = { ...harness.state };
    const draftCount = harness.setQuestionDraft.mock.calls.length;
    const renderCount = harness.render.mock.calls.length;
    const eventCount = syncRuntimeEvent.mock.calls.length;
    recognition.onerror?.({ error: 'wrong-session error' });
    recognition.onend?.(new Event('end'));
    await flushAsync();

    expect(processingLifecycle.isCurrent()).toBe(false);
    expect(harness.state).toEqual({
      ...stateBeforeSessionChangeCallbacks,
      status: 'idle',
      error: null,
    });
    expect(harness.setQuestionDraft).toHaveBeenCalledTimes(draftCount);
    expect(harness.render).toHaveBeenCalledTimes(renderCount + 1);
    expect(syncRuntimeEvent).toHaveBeenCalledTimes(eventCount);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(started).toBe(true);
  });

  it('resumes a suspended AudioContext before acknowledging live microphone capture', async () => {
    const sourceNode = { connect: vi.fn(), disconnect: vi.fn() };
    const audioContext = {
      state: 'suspended',
      sampleRate: 48_000,
      destination: {},
      resume: vi.fn(async () => { (audioContext as { state: string }).state = 'running'; }),
      createMediaStreamSource: vi.fn(() => sourceNode),
      close: vi.fn(async () => undefined),
    } as unknown as AudioContext;
    audioMocks.createVoiceAudioContext.mockReturnValue(audioContext);
    const capture = installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('suspended-context-live')),
    });

    const starting = harness.controller.start();
    await flushAsync();
    MockWebSocket.instances[0].emit('open');
    await expect(starting).resolves.toBe(true);

    expect(audioContext.resume).toHaveBeenCalledTimes(1);
    expect((audioContext.resume as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0])
      .toBeLessThan(capture.start.mock.invocationCallOrder[0]);
  });

  it('witnesses worklet startup and first PCM without audio content', async () => {
    installAudioContextMock();
    const telemetryEvent = vi.fn();
    (window as any).__tvTelemetry = { event: telemetryEvent };
    const capture = installLiveCaptureMock() as MockLiveCapture & { mode: 'worklet' };
    capture.mode = 'worklet';
    vi.stubGlobal('WebSocket', MockWebSocket);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('worklet-witness-live')),
    });

    const starting = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await flushAsync();

    expect(telemetryEvent).toHaveBeenCalledWith(
      'info',
      'voice-input-capture',
      'ok',
      'worklet-capture-started',
    );
    capturedPcmOnFrame?.(new ArrayBuffer(2048));
    expect(telemetryEvent).toHaveBeenCalledWith(
      'info',
      'voice-input-capture',
      'ok',
      'worklet-first-pcm',
    );
    await expect(starting).resolves.toBe(true);
  });

  it('recovers a zero-frame worklet into live ScriptProcessor capture before backend timeout', async () => {
    vi.useFakeTimers();
    installAudioContextMock();
    const telemetryEvent = vi.fn();
    (window as any).__tvTelemetry = { event: telemetryEvent };
    const workletCapture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'worklet' as const,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
    };
    const scriptProcessorCapture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'script-processor' as const,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
    };
    audioMocks.createPcm16Capture
      .mockImplementationOnce(async (options: { onFrame: (frame: ArrayBuffer) => void }) => {
        capturedPcmOnFrame = options.onFrame;
        return workletCapture;
      })
      .mockImplementationOnce(async (options: { onFrame: (frame: ArrayBuffer) => void }) => {
        capturedPcmOnFrame = options.onFrame;
        return scriptProcessorCapture;
      });
    vi.stubGlobal('WebSocket', MockWebSocket);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('worklet-recovery-live')),
    });

    const starting = harness.controller.start();
    await flushAsync();
    MockWebSocket.instances[0].emit('open');
    await flushAsync();
    expect(workletCapture.start).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await flushAsync();
    capturedPcmOnFrame?.(new ArrayBuffer(2048));
    await flushAsync();
    await expect(starting).resolves.toBe(true);

    expect(workletCapture.stop).toHaveBeenCalledTimes(1);
    expect(scriptProcessorCapture.start).toHaveBeenCalledTimes(1);
    expect(audioMocks.createPcm16Capture).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ preferWorklet: false }),
    );
    expect(telemetryEvent).toHaveBeenCalledWith(
      'warn',
      'voice-input-capture',
      'partial-function',
      'worklet-no-pcm',
    );
    expect(telemetryEvent).toHaveBeenCalledWith(
      'info',
      'voice-input-capture',
      'ok',
      'script-processor-capture-started',
    );
  });

  it('abandons zero-frame ScriptProcessor capture promptly and starts recorded fallback', async () => {
    vi.useFakeTimers();
    installAudioContextMock();
    captureMonitorCallbacks();
    const telemetryEvent = vi.fn();
    (window as any).__tvTelemetry = { event: telemetryEvent };
    const silentScriptCapture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'script-processor' as const,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
    };
    audioMocks.createPcm16Capture.mockResolvedValue(silentScriptCapture);
    vi.stubGlobal('WebSocket', MockWebSocket);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('silent-live'))
      .mockResolvedValueOnce(createMockStream('recorded-recovery'));
    const harness = createHarness({ getUserMedia });

    const starting = harness.controller.start();
    await flushAsync();
    MockWebSocket.instances[0].emit('open');
    await flushAsync();

    await vi.advanceTimersByTimeAsync(1_000);
    await flushAsync();
    await expect(starting).resolves.toBe(true);

    expect(silentScriptCapture.stop).toHaveBeenCalled();
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].state).toBe('recording');
    expect(telemetryEvent).toHaveBeenCalledWith(
      'warn',
      'voice-input-capture',
      'partial-function',
      'script-processor-no-pcm',
    );
  });

  it('does not acknowledge live capture until the server accepts the session lease', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    MockWebSocket.autoSessionStarted = false;
    vi.stubGlobal('WebSocket', MockWebSocket);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('lease-ack-live')),
    });
    const pendingMarker = Symbol('pending');
    let observed: boolean | symbol = pendingMarker;

    const starting = harness.controller.start().then((started) => {
      observed = started;
      return started;
    });
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await flushAsync();
    expect(observed).toBe(pendingMarker);

    socket.emit('message', {
      data: JSON.stringify({ event: 'session-started', sessionId: 'session-1', sampleRate: 16000 }),
    });
    await expect(starting).resolves.toBe(true);
  });

  it('does not claim the microphone is ready until the backend observes PCM', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    MockWebSocket.autoCaptureReady = false;
    vi.stubGlobal('WebSocket', MockWebSocket);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('pcm-ack-live')),
    });
    const pendingMarker = Symbol('pending');
    let observed: boolean | symbol = pendingMarker;

    const starting = harness.controller.start().then((started) => {
      observed = started;
      return started;
    });
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await flushAsync();

    expect(observed).toBe(pendingMarker);
    expect(harness.state.status).toBe('idle');

    socket.emit('message', {
      data: JSON.stringify({ event: 'capture-ready', sessionId: 'session-1', sampleRate: 16000 }),
    });
    await expect(starting).resolves.toBe(true);
    expect(harness.state.status).toBe('waiting');
  });

  it('stops a native-shaped recorder while tracks are live and finalizes its final data once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    MockMediaRecorder.terminalMode = 'native';
    MockMediaRecorder.finalData = 'native-final';
    const monitors = captureMonitorCallbacks();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const recordedStream = createMockStream('native-recorded');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('native-live-fallback'))
      .mockResolvedValueOnce(recordedStream);
    const harness = createHarness({ getUserMedia });

    const started = await harness.controller.start();
    const recorder = MockMediaRecorder.instances[0];
    const savedData = recorder.ondataavailable;
    const savedStop = recorder.onstop;
    recorder.emitData('prefix|');
    driveVadStop(recordedStream, monitors[0], (value) => { now = value; });

    expect(recorder.stopCalls).toBe(1);
    expect(recorder.stopTrackCounts).toEqual([0]);
    expect(recordedStream.track.stop).not.toHaveBeenCalled();
    await flushAsync();

    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.submitInputTurn).toHaveBeenCalledTimes(1);
    expect(await readBlob(harness.submitInputTurn.mock.calls[0][1].audioBlob)).toBe('prefix|native-final');
    savedData?.({ data: new Blob(['duplicate']) } as BlobEvent);
    savedStop?.(new Event('stop'));
    await flushAsync();
    expect(harness.submitInputTurn).toHaveBeenCalledTimes(1);
    expect(started).toBe(true);
  });

  it('keeps a careful speaker recording through 1.2 s and stops only after 4.5 s of silence', async () => {
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    const monitors = captureMonitorCallbacks();
    let now = 1_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const recordedStream = createMockStream('careful-pause-recorded');
    const harness = createHarness({
      getUserMedia: vi.fn()
        .mockResolvedValueOnce(createMockStream('careful-pause-live'))
        .mockResolvedValueOnce(recordedStream),
    });

    await harness.controller.start();
    const recorder = MockMediaRecorder.instances[0];
    recordedStream.rms = 0.1;
    monitors[0]();
    now = 2_200;
    recordedStream.rms = 0;
    monitors[0]();
    assert.equal(recorder.stopCalls, 0, '1.2 seconds is a protected thinking pause');
    now = 5_499;
    monitors[0]();
    assert.equal(recorder.stopCalls, 0);
    now = 5_500;
    monitors[0]();
    assert.equal(recorder.stopCalls, 1);
  });

  it('uses a 2s missing-onstop watchdog only for cleanup and current error', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    MockMediaRecorder.terminalMode = 'missing-stop';
    const monitors = captureMonitorCallbacks();
    const recordedStream = createMockStream('watchdog-recorded');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('watchdog-live-fallback'))
      .mockResolvedValueOnce(recordedStream);
    const harness = createHarness({ getUserMedia });

    const started = await harness.controller.start();
    const recorder = MockMediaRecorder.instances[0];
    recorder.emitData('partial-must-not-submit');
    driveVadStop(recordedStream, monitors[0], (value) => vi.setSystemTime(value));

    await vi.advanceTimersByTimeAsync(1_999);
    expect(recordedStream.track.stop).not.toHaveBeenCalled();
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    await flushAsync();

    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(harness.state.status).toBe('error');
    expect(harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error')).toHaveLength(1);
    expect(started).toBe(true);
  });

  it('treats recorder error as terminal and ignores later data and stop success', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    const recordedStream = createMockStream('error-recorded');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('error-live-fallback'))
      .mockResolvedValueOnce(recordedStream);
    const harness = createHarness({ getUserMedia });

    const started = await harness.controller.start();
    const recorder = MockMediaRecorder.instances[0];
    recorder.emitData('partial');
    const savedData = recorder.ondataavailable;
    const savedStop = recorder.onstop;
    recorder.emitError();
    await flushAsync();
    savedData?.({ data: new Blob(['late-success']) } as BlobEvent);
    savedStop?.(new Event('stop'));
    await flushAsync();

    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
    expect(recorder.ondataavailable).toBeNull();
    expect(recorder.onerror).toBeNull();
    expect(recorder.onstop).toBeNull();
    expect(harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error')).toHaveLength(1);
    expect(started).toBe(true);
  });

  it.each([
    'envelope',
    'socket-error',
    'socket-close',
    'frame-send',
  ] as const)('lets recorded fallback recover a pending live %s failure without a terminal error', async (kind) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    captureMonitorCallbacks();
    const pendingCaptureStart = deferred<void>();
    const liveCapture = installLiveCaptureMock(vi.fn(() => pendingCaptureStart.promise));
    vi.stubGlobal('WebSocket', MockWebSocket);
    const liveStream = createMockStream(`pending-${kind}-live`);
    const recordedStream = createMockStream(`pending-${kind}-recorded`);
    let localRuntimeErrors = 0;
    const syncRuntimeEvent = vi.fn(async (event: string) => {
      if (event === 'error') localRuntimeErrors += 1;
    });
    const harness = createHarness({
      getUserMedia: vi.fn()
        .mockResolvedValueOnce(liveStream)
        .mockResolvedValueOnce(recordedStream),
      syncRuntimeEvent,
    });
    const pendingMarker = Symbol('pending');
    let observed: boolean | symbol = pendingMarker;

    const start = harness.controller.start().then((started) => {
      observed = started;
      return started;
    });
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    const handlers = captureLiveHandlers(socket);
    expect(handlers).toEqual({
      message: expect.any(Function),
      error: expect.any(Function),
      close: expect.any(Function),
      frame: expect.any(Function),
    });
    socket.emit('open');
    await flushAsync();
    expect(liveCapture.start).toHaveBeenCalledTimes(1);
    expect(observed).toBe(pendingMarker);

    fireLiveFailure(kind, socket, handlers, 'pending envelope failure');
    await expect(start).resolves.toBe(true);
    await flushAsync();

    const liveContext = audioMocks.createVoiceAudioContext.mock.results[0].value as any;
    const liveSource = liveContext.createMediaStreamSource.mock.results[0].value;
    expect(observed).toBe(true);
    expect(syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error')).toHaveLength(0);
    expect(localRuntimeErrors).toBe(0);
    expect(harness.stateTransitions.filter(({ status }) => status === 'error')).toHaveLength(0);
    expect(harness.state).toMatchObject({ status: 'waiting', error: null });
    expect(MockMediaRecorder.instances).toHaveLength(1);
    expect(MockMediaRecorder.instances[0].state).toBe('recording');
    expect(liveCapture.stop).toHaveBeenCalledTimes(1);
    expect(liveSource.disconnect).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(liveContext.close).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);

    const frozen = {
      state: { ...harness.state },
      transitions: harness.stateTransitions.length,
      events: syncRuntimeEvent.mock.calls.length,
      renders: harness.render.mock.calls.length,
    };
    pendingCaptureStart.resolve();
    fireAllSavedLiveFailures(socket, handlers);
    await flushAsync();
    expect(harness.state).toEqual(frozen.state);
    expect(harness.stateTransitions).toHaveLength(frozen.transitions);
    expect(syncRuntimeEvent).toHaveBeenCalledTimes(frozen.events);
    expect(harness.render).toHaveBeenCalledTimes(frozen.renders);
    expect(liveCapture.stop).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);
  });

  it.each([
    'envelope',
    'socket-error',
  ] as const)('publishes one fallback-unavailable terminal decision for a pending live %s failure', async (kind) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    const pendingCaptureStart = deferred<void>();
    const liveCapture = installLiveCaptureMock(vi.fn(() => pendingCaptureStart.promise));
    vi.stubGlobal('WebSocket', MockWebSocket);
    const liveStream = createMockStream(`unavailable-${kind}`);
    let localRuntimeErrors = 0;
    const syncRuntimeEvent = vi.fn(async (event: string) => {
      if (event === 'error') localRuntimeErrors += 1;
    });
    const harness = createHarness({
      getUserMedia: vi.fn(async () => liveStream),
      syncRuntimeEvent,
      canUseBackendRecordedFallback: false,
    });
    const pendingMarker = Symbol('pending');
    let observed: boolean | symbol = pendingMarker;
    const fallbackError = 'This browser cannot use the recorded fallback for backend voice input.';

    const start = harness.controller.start().then(
      (started) => {
        observed = started;
        return started;
      },
      (error) => {
        throw error;
      },
    );
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    const handlers = captureLiveHandlers(socket);
    expect(handlers).toEqual({
      message: expect.any(Function),
      error: expect.any(Function),
      close: expect.any(Function),
      frame: expect.any(Function),
    });
    socket.emit('open');
    await flushAsync();
    expect(observed).toBe(pendingMarker);
    const transitionsBefore = harness.stateTransitions.length;
    const rendersBefore = harness.render.mock.calls.length;

    fireLiveFailure(kind, socket, handlers, 'live startup rejected');
    await expect(start).rejects.toThrow(fallbackError);
    await flushAsync();

    const errorCalls = syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error');
    expect(errorCalls).toHaveLength(1);
    expect(localRuntimeErrors).toBe(1);
    expect(errorCalls[0][1]).toEqual(expect.objectContaining({
      captureProvider: 'backend',
      transcriptSource: 'backend-live',
      error: fallbackError,
    }));
    expect(harness.stateTransitions.slice(transitionsBefore).filter(({ status }) => status === 'error')).toHaveLength(1);
    expect(harness.render).toHaveBeenCalledTimes(rendersBefore + 1);
    expect(harness.state).toMatchObject({ status: 'error', error: fallbackError });
    expect(liveCapture.stop).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);

    const frozen = {
      state: { ...harness.state },
      transitions: harness.stateTransitions.length,
      events: syncRuntimeEvent.mock.calls.length,
      renders: harness.render.mock.calls.length,
    };
    pendingCaptureStart.resolve();
    fireAllSavedLiveFailures(socket, handlers);
    await flushAsync();
    expect(harness.state).toEqual(frozen.state);
    expect(harness.stateTransitions).toHaveLength(frozen.transitions);
    expect(syncRuntimeEvent).toHaveBeenCalledTimes(frozen.events);
    expect(harness.render).toHaveBeenCalledTimes(frozen.renders);
  });

  it.each([
    { kind: 'envelope' as const, expected: 'active envelope failure' },
    { kind: 'socket-error' as const, expected: 'Backend live voice socket failed.' },
    { kind: 'socket-close' as const, expected: 'Backend live voice input disconnected.' },
    { kind: 'frame-send' as const, expected: 'Backend live voice input frame failed.' },
  ])('publishes and drains exactly once for an active live $kind failure', async ({ kind, expected }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    const liveCapture = installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const liveStream = createMockStream(`active-${kind}`);
    let localRuntimeErrors = 0;
    const syncRuntimeEvent = vi.fn(async (event: string) => {
      if (event === 'error') localRuntimeErrors += 1;
    });
    const harness = createHarness({
      getUserMedia: vi.fn(async () => liveStream),
      syncRuntimeEvent,
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    const handlers = captureLiveHandlers(socket);
    expect(handlers).toEqual({
      message: expect.any(Function),
      error: expect.any(Function),
      close: expect.any(Function),
      frame: expect.any(Function),
    });
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    const transitionsBefore = harness.stateTransitions.length;
    const eventsBefore = syncRuntimeEvent.mock.calls.length;
    const rendersBefore = harness.render.mock.calls.length;

    fireLiveFailure(kind, socket, handlers, 'active envelope failure');
    await flushAsync();

    const liveContext = audioMocks.createVoiceAudioContext.mock.results[0].value as any;
    const liveSource = liveContext.createMediaStreamSource.mock.results[0].value;
    const errorCalls = syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error');
    expect(errorCalls).toHaveLength(1);
    expect(localRuntimeErrors).toBe(1);
    expect(errorCalls[0][1]).toEqual(expect.objectContaining({
      captureProvider: 'backend',
      transcriptSource: 'backend-live',
      error: expected,
    }));
    expect(harness.stateTransitions.slice(transitionsBefore).filter(({ status }) => status === 'error')).toHaveLength(1);
    expect(syncRuntimeEvent).toHaveBeenCalledTimes(eventsBefore + 1);
    expect(harness.render).toHaveBeenCalledTimes(rendersBefore + 1);
    expect(harness.state).toMatchObject({ status: 'error', error: expected });
    expect(liveCapture.stop).toHaveBeenCalledTimes(1);
    expect(liveSource.disconnect).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(liveContext.close).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);

    const frozen = {
      state: { ...harness.state },
      transitions: harness.stateTransitions.length,
      events: syncRuntimeEvent.mock.calls.length,
      renders: harness.render.mock.calls.length,
    };
    fireAllSavedLiveFailures(socket, handlers);
    await flushAsync();
    expect(harness.state).toEqual(frozen.state);
    expect(harness.stateTransitions).toHaveLength(frozen.transitions);
    expect(syncRuntimeEvent).toHaveBeenCalledTimes(frozen.events);
    expect(harness.render).toHaveBeenCalledTimes(frozen.renders);
    expect(liveCapture.stop).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);
  });

  it.each([
    'final-transcript',
    'no-speech',
  ] as const)('still treats an active socket close after %s made the UI idle as terminal', async (event) => {
    installAudioContextMock();
    const liveCapture = installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const liveStream = createMockStream(`idle-before-close-${event}`);
    const harness = createHarness({ getUserMedia: vi.fn(async () => liveStream) });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    const handlers = captureLiveHandlers(socket);
    expect(handlers.close).toEqual(expect.any(Function));
    expect(handlers.message).toEqual(expect.any(Function));
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    handlers.message({
      data: JSON.stringify(event === 'final-transcript'
        ? {
            event,
            segmentId: 'idle-segment',
            transcript: 'finished before close',
            autoSubmit: false,
          }
        : { event }),
    });
    expect(harness.state.status).toBe('idle');
    const transitionsBefore = harness.stateTransitions.length;
    const rendersBefore = harness.render.mock.calls.length;

    socket.readyState = MockWebSocket.CLOSED;
    handlers.close(new Event('close'));
    await flushAsync();

    expect(harness.state).toMatchObject({
      status: 'error',
      error: 'Backend live voice input disconnected.',
    });
    expect(harness.stateTransitions.slice(transitionsBefore).filter(({ status }) => status === 'error')).toHaveLength(1);
    expect(harness.syncRuntimeEvent.mock.calls.filter(([runtimeEvent]) => runtimeEvent === 'error')).toHaveLength(1);
    expect(harness.render).toHaveBeenCalledTimes(rendersBefore + 1);
    expect(liveCapture.stop).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);
  });

  it.each([
    'cancelled',
    'stale',
  ] as const)('keeps a %s pending live failure false and terminally inert', async (mode) => {
    installAudioContextMock();
    const pendingCaptureStart = deferred<void>();
    const liveCapture = installLiveCaptureMock(vi.fn(() => pendingCaptureStart.promise));
    vi.stubGlobal('WebSocket', MockWebSocket);
    const liveStream = createMockStream(`pending-${mode}`);
    let localRuntimeErrors = 0;
    const syncRuntimeEvent = vi.fn(async (event: string) => {
      if (event === 'error') localRuntimeErrors += 1;
    });
    const harness = createHarness({
      getUserMedia: vi.fn(async () => liveStream),
      syncRuntimeEvent,
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    const handlers = captureLiveHandlers(socket);
    expect(handlers).toEqual({
      message: expect.any(Function),
      error: expect.any(Function),
      close: expect.any(Function),
      frame: expect.any(Function),
    });
    socket.emit('open');
    await flushAsync();
    if (mode === 'cancelled') {
      await harness.controller.stop(true);
    } else {
      Object.assign(window, { SpeechRecognition: MockRecognition });
      harness.context.effectiveProvider = 'browser';
      harness.context.requestedProvider = 'browser';
      await expect(harness.controller.start()).resolves.toBe(true);
    }
    await expect(start).resolves.toBe(false);
    const frozen = {
      state: { ...harness.state },
      transitions: harness.stateTransitions.length,
      events: syncRuntimeEvent.mock.calls.length,
      renders: harness.render.mock.calls.length,
    };

    fireAllSavedLiveFailures(socket, handlers);
    pendingCaptureStart.resolve();
    await flushAsync();

    expect(localRuntimeErrors).toBe(0);
    expect(syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error')).toHaveLength(0);
    expect(harness.state).toEqual(frozen.state);
    expect(harness.stateTransitions).toHaveLength(frozen.transitions);
    expect(syncRuntimeEvent).toHaveBeenCalledTimes(frozen.events);
    expect(harness.render).toHaveBeenCalledTimes(frozen.renders);
    expect(liveCapture.stop).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);
  });

  it('releases live resources immediately on an application error and makes queued close inert', async () => {
    installAudioContextMock();
    const capture = installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const stream = createMockStream('application-error-live');
    const harness = createHarness({ getUserMedia: vi.fn(async () => stream) });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    const started = await start;
    const context = audioMocks.createVoiceAudioContext.mock.results[0].value as any;
    const source = context.createMediaStreamSource.mock.results[0].value;
    socket.emit('message', {
      data: JSON.stringify({ event: 'error', error: 'application rejected audio' }),
    });

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(source.disconnect).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);
    const errorEventCount = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error').length;
    const renderCount = harness.render.mock.calls.length;
    await flushAsync();

    expect(harness.state).toMatchObject({ status: 'error', error: 'application rejected audio' });
    expect(harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error')).toHaveLength(errorEventCount);
    expect(harness.render).toHaveBeenCalledTimes(renderCount);
    expect(started).toBe(true);
  });

  it('rejects a current live startup promptly when an application error arrives during capture start', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    const pendingCaptureStart = deferred<void>();
    const capture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'script-processor' as const,
      start: vi.fn(() => pendingCaptureStart.promise),
      stop: vi.fn(),
    };
    audioMocks.createPcm16Capture.mockResolvedValue(capture);
    vi.stubGlobal('WebSocket', MockWebSocket);
    const stream = createMockStream('application-error-startup');
    const harness = createHarness({
      getUserMedia: vi.fn(async () => stream),
      canUseBackendRecordedFallback: false,
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await flushAsync();
    expect(capture.start).toHaveBeenCalledTimes(1);
    socket.emit('message', {
      data: JSON.stringify({ event: 'error', error: 'startup application error' }),
    });

    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    await expect(start).rejects.toThrow('recorded fallback');
    pendingCaptureStart.resolve();
    await flushAsync();
    expect(capture.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps native queued recognition end inert when a new recognition owner replaces it', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
    });

    const startedA = await harness.controller.start();
    const recognitionA = MockRecognition.instances[0];
    recognitionA.onstart?.(new Event('start'));
    const startedB = await harness.controller.start();
    const recognitionB = MockRecognition.instances[1];
    recognitionB.onstart?.(new Event('start'));
    const stateBeforeQueuedEnd = { ...harness.state };
    const eventCount = harness.syncRuntimeEvent.mock.calls.length;
    await flushAsync();

    expect(harness.state).toEqual(stateBeforeQueuedEnd);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCount);
    expect(recognitionA.abort).toHaveBeenCalledTimes(1);
    expect(recognitionB.abort).not.toHaveBeenCalled();
    expect(startedA).toBe(true);
    expect(startedB).toBe(true);
  });

  it('publishes exactly one current idle event when an active live take is stopped', async () => {
    installAudioContextMock();
    const capture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'script-processor' as const,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
    };
    audioMocks.createPcm16Capture.mockResolvedValue(capture);
    vi.stubGlobal('WebSocket', MockWebSocket);
    const stream = createMockStream('live-stop-idle');
    const harness = createHarness({ getUserMedia: vi.fn(async () => stream) });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    const idleBefore = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle').length;

    await harness.controller.stop(true);
    const idleCalls = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle');
    const eventCountAfterStop = harness.syncRuntimeEvent.mock.calls.length;
    const stateAfterStop = { ...harness.state };
    await flushAsync();

    expect(idleCalls).toHaveLength(idleBefore + 1);
    expect(idleCalls.at(-1)?.[2].isCurrent()).toBe(true);
    expect(stateAfterStop.status).toBe('idle');
    expect(harness.state).toEqual(stateAfterStop);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountAfterStop);
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);
  });

  it('publishes exactly one current idle event when a live take is replaced', async () => {
    installAudioContextMock();
    const capture = {
      captureSampleRate: 48_000,
      outputSampleRate: 16_000,
      frameSize: 1_024,
      mode: 'script-processor' as const,
      start: vi.fn(async () => undefined),
      stop: vi.fn(),
    };
    audioMocks.createPcm16Capture.mockResolvedValue(capture);
    vi.stubGlobal('WebSocket', MockWebSocket);
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const stream = createMockStream('live-replace-idle');
    const harness = createHarness({ getUserMedia: vi.fn(async () => stream) });

    const startA = harness.controller.start();
    await flushAsync();
    const socketA = MockWebSocket.instances[0];
    socketA.emit('open');
    await expect(startA).resolves.toBe(true);
    const idleBefore = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle').length;
    harness.context.effectiveProvider = 'browser';
    harness.context.requestedProvider = 'browser';

    const startB = harness.controller.start();
    await expect(startB).resolves.toBe(true);
    const idleCalls = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle');
    const idleLifecycle = idleCalls.at(-1)?.[2];
    const eventCountAfterReplacement = harness.syncRuntimeEvent.mock.calls.length;
    await flushAsync();

    expect(idleCalls).toHaveLength(idleBefore + 1);
    expect(idleLifecycle.isCurrent()).toBe(true);
    expect(harness.state.status).toBe('waiting');
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountAfterReplacement);
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(socketA.closeCalls).toBe(1);
    expect(MockRecognition.instances).toHaveLength(1);
  });

  it('publishes one idle for active recorded stop and ignores delayed recorder terminal events', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    captureMonitorCallbacks();
    const recordedStream = createMockStream('recorded-stop-idle');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('recorded-stop-live'))
      .mockResolvedValueOnce(recordedStream);
    const harness = createHarness({ getUserMedia });

    await expect(harness.controller.start()).resolves.toBe(true);
    const recorder = MockMediaRecorder.instances[0];
    const savedData = recorder.ondataavailable;
    const savedStop = recorder.onstop;
    const idleBefore = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle').length;
    await harness.controller.stop(true);
    const idleCalls = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle');
    const idleLifecycle = idleCalls.at(-1)?.[2];
    const eventCountAfterStop = harness.syncRuntimeEvent.mock.calls.length;
    const stateAfterStop = { ...harness.state };

    savedData?.({ data: new Blob(['late-recorded-data']) } as BlobEvent);
    savedStop?.(new Event('stop'));
    await flushAsync();

    expect(idleCalls).toHaveLength(idleBefore + 1);
    expect(idleLifecycle.isCurrent()).toBe(true);
    expect(harness.state).toEqual(stateAfterStop);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountAfterStop);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
  });

  it('publishes one idle for recorded replacement and ignores delayed old onstop', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    captureMonitorCallbacks();
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const recordedStream = createMockStream('recorded-replace-idle');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('recorded-replace-live'))
      .mockResolvedValueOnce(recordedStream);
    const harness = createHarness({ getUserMedia });

    await expect(harness.controller.start()).resolves.toBe(true);
    const recorderA = MockMediaRecorder.instances[0];
    const savedData = recorderA.ondataavailable;
    const savedStop = recorderA.onstop;
    const idleBefore = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle').length;
    harness.context.effectiveProvider = 'browser';
    harness.context.requestedProvider = 'browser';
    await expect(harness.controller.start()).resolves.toBe(true);
    const idleCalls = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'idle');
    const eventCountAfterReplacement = harness.syncRuntimeEvent.mock.calls.length;
    const stateAfterReplacement = { ...harness.state };

    savedData?.({ data: new Blob(['late-old-data']) } as BlobEvent);
    savedStop?.(new Event('stop'));
    await flushAsync();

    expect(idleCalls).toHaveLength(idleBefore + 1);
    expect(harness.state).toEqual(stateAfterReplacement);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountAfterReplacement);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
    expect(MockRecognition.instances).toHaveLength(1);
  });

  it.each([
    { stage: 'constructor' as const, message: 'recorder constructor failed' },
    { stage: 'start' as const, message: 'recorder start failed' },
  ])('publishes one terminal error and cleans once when MediaRecorder $stage throws', async ({ stage, message }) => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    captureMonitorCallbacks();
    if (stage === 'constructor') {
      MockMediaRecorder.constructorError = new Error(message);
    } else {
      MockMediaRecorder.startError = new Error(message);
    }
    let localRuntimeErrors = 0;
    const syncRuntimeEvent = vi.fn(async (event: string) => {
      if (event === 'error') localRuntimeErrors += 1;
    });
    const recordedStream = createMockStream(`recorder-${stage}-error`);
    const liveStream = createMockStream(`recorder-${stage}-live`);
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(liveStream)
      .mockResolvedValueOnce(recordedStream);
    const harness = createHarness({ getUserMedia, syncRuntimeEvent });

    await expect(harness.controller.start()).rejects.toThrow(message);

    const errorCalls = syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error');
    expect(errorCalls).toHaveLength(1);
    expect(localRuntimeErrors).toBe(1);
    expect(errorCalls[0][1]).toEqual(expect.objectContaining({
      captureProvider: 'backend',
      transcriptSource: 'backend-asr',
      captureStartedAt: null,
      error: 'Backend voice capture failed to start.',
    }));
    expect(harness.stateTransitions.filter(({ status }) => status === 'error')).toHaveLength(1);
    expect(harness.state).toMatchObject({ status: 'error', error: 'Backend voice capture failed to start.' });
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
    if (stage === 'start') {
      expect(MockMediaRecorder.instances[0].onstart).toBeNull();
      expect(MockMediaRecorder.instances[0].ondataavailable).toBeNull();
      expect(MockMediaRecorder.instances[0].onerror).toBeNull();
      expect(MockMediaRecorder.instances[0].onstop).toBeNull();
    }
  });

  it('lets toggle consume a recorded startup rejection without overwriting the terminal owner message', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    captureMonitorCallbacks();
    MockMediaRecorder.startError = new Error('public recorder rejection');
    let localRuntimeErrors = 0;
    const syncRuntimeEvent = vi.fn(async (event: string) => {
      if (event === 'error') localRuntimeErrors += 1;
    });
    const liveStream = createMockStream('toggle-live-failure');
    const recordedStream = createMockStream('toggle-recorded-failure');
    const harness = createHarness({
      getUserMedia: vi.fn()
        .mockResolvedValueOnce(liveStream)
        .mockResolvedValueOnce(recordedStream),
      syncRuntimeEvent,
    });

    harness.controller.toggle();
    await vi.waitFor(() => {
      expect(harness.state.status).toBe('error');
    });
    await flushAsync();

    expect(harness.state).toEqual({
      status: 'error',
      error: 'Backend voice capture failed to start.',
      finalTranscript: '',
      finalConfidence: null,
    });
    expect(harness.stateTransitions.filter(({ status }) => status === 'error')).toHaveLength(1);
    expect(syncRuntimeEvent.mock.calls.filter(([event]) => event === 'error')).toHaveLength(1);
    expect(localRuntimeErrors).toBe(1);
    expect(harness.render).toHaveBeenCalledTimes(1);
    expect(liveStream.track.stop).toHaveBeenCalledTimes(1);
    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
  });

  it('rejects an unobserved browser session A/L0→B/L1→A/L2 ABA before saved callbacks can revive', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      sessionId: 'session-A',
    });

    await expect(harness.controller.start()).resolves.toBe(true);
    const recognition = MockRecognition.instances[0];
    recognition.onstart?.(new Event('start'));
    const lifecycle = harness.syncRuntimeEvent.mock.calls.at(-1)?.[2];
    const savedResult = recognition.onresult;
    const savedEnd = recognition.onend;
    const eventCountBeforeRestore = harness.syncRuntimeEvent.mock.calls.length;

    harness.context.sessionId = 'session-B';
    harness.context.sessionLease = {};
    harness.context.sessionId = 'session-A';
    harness.context.sessionLease = {};
    const restoredLifecycleCurrent = lifecycle.isCurrent();
    savedResult?.(createResultEvent('must not revive'));
    savedEnd?.(new Event('end'));
    await flushAsync();

    expect(restoredLifecycleCurrent).toBe(false);
    expect(recognition.abort).toHaveBeenCalledTimes(1);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountBeforeRestore);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();
  });

  it('rejects an unobserved recorded connected/L0→disconnected/L1→connected/L2 ABA and cleans once', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    captureMonitorCallbacks();
    const recordedStream = createMockStream('recorded-unobserved-aba');
    const harness = createHarness({
      getUserMedia: vi.fn()
        .mockResolvedValueOnce(createMockStream('recorded-unobserved-aba-live'))
        .mockResolvedValueOnce(recordedStream),
      sessionId: 'session-A',
    });

    await expect(harness.controller.start()).resolves.toBe(true);
    const recorder = MockMediaRecorder.instances[0];
    const savedData = recorder.ondataavailable;
    const savedStop = recorder.onstop;
    const lifecycle = harness.syncRuntimeEvent.mock.calls.find(([event]) => event === 'waiting')?.[2];
    const eventCountBeforeRestore = harness.syncRuntimeEvent.mock.calls.length;

    harness.context.isConnected = false;
    harness.context.sessionLease = {};
    harness.context.isConnected = true;
    harness.context.sessionLease = {};
    const restoredLifecycleCurrent = lifecycle.isCurrent();
    savedData?.({ data: new Blob(['must not revive']) } as BlobEvent);
    savedStop?.(new Event('stop'));
    await flushAsync();

    expect(restoredLifecycleCurrent).toBe(false);
    expect(recorder.stopCalls).toBe(1);
    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountBeforeRestore);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();
  });

  it('publishes live completion before synchronous auto-submit invalidates its owner', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const completion = deferred<void>();
    const sequence: string[] = [];
    let completionSettled = false;
    let completionLifecycle: { isCurrent: () => boolean } | undefined;
    void completion.promise.then(() => {
      completionSettled = true;
    });
    const syncRuntimeEvent = vi.fn((event: string, _options: unknown, lifecycle?: { isCurrent: () => boolean }) => {
      if (event !== 'completed') return Promise.resolve();
      completionLifecycle = lifecycle;
      if (!lifecycle?.isCurrent()) return Promise.resolve();
      sequence.push('completed-local');
      sequence.push('completed-dispatch');
      return completion.promise;
    });
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('completion-order-live')),
      syncRuntimeEvent,
    });
    harness.handleCapturedQuestion.mockImplementation(() => {
      sequence.push('submit');
      expect(completionSettled).toBe(false);
      void harness.controller.stop(true);
      sequence.push('owner-invalidated');
      return Promise.resolve();
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    socket.emit('message', {
      data: JSON.stringify({
        event: 'final-transcript',
        segmentId: 'completion-order-segment',
        transcript: 'submit after completion dispatch',
        autoSubmit: true,
      }),
    });

    expect(sequence).toEqual([
      'completed-local',
      'completed-dispatch',
      'submit',
      'owner-invalidated',
    ]);
    expect(completionSettled).toBe(false);
    expect(completionLifecycle?.isCurrent()).toBe(false);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
  });

  it('records a durable diagnostic when live auto-submit rejects downstream', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    (window as any).__SLOANE_BACKEND_ERRORS = [];
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('rejected-submit-live')),
    });
    harness.handleCapturedQuestion.mockRejectedValue(new Error('coach submit failed'));

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    socket.emit('message', {
      data: JSON.stringify({
        event: 'final-transcript',
        segmentId: 'rejected-submit-segment',
        transcript: 'submit this turn',
        autoSubmit: true,
      }),
    });
    await flushAsync();

    expect((window as any).__SLOANE_BACKEND_ERRORS).toEqual([
      expect.objectContaining({
        operation: 'Submit captured voice turn to coach',
        source: 'voice-coach-runtime',
        method: 'POST',
      }),
    ]);
  });

  /* 2026-07-27 field repair. A learner spoke a normal sentence, the gateway
   * journal showed asr-completed with a REAL transcript, and then nothing — no
   * coach turn, no reply, no error, on either side of the wire. Nothing could
   * say whether the client had even asked for a reply, because the client's
   * decision NOT to ask was a bare `return`. These prove the decision is now
   * named every time it is made — the healthy case AND the silent drop. */
  it('names the auto-submit decision when a turn IS dispatched to the coach', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const telemetryEvent = vi.fn();
    (window as any).__tvTelemetry = { event: telemetryEvent };
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('dispatch-witness-live')),
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    socket.emit('message', {
      data: JSON.stringify({
        event: 'final-transcript',
        segmentId: 'dispatch-witness-segment',
        transcript: 'i think that sounded okay',
        autoSubmit: true,
      }),
    });
    await flushAsync();

    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
    expect(telemetryEvent).toHaveBeenCalledWith(
      'info',
      'coach-turn-dispatch',
      'ok',
      'coach-turn-dispatched',
    );
  });

  it('names the SILENT drop when the same segment arrives twice', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const telemetryEvent = vi.fn();
    (window as any).__tvTelemetry = { event: telemetryEvent };
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('duplicate-witness-live')),
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    const envelope = JSON.stringify({
      event: 'final-transcript',
      segmentId: 'duplicate-witness-segment',
      transcript: 'i think that sounded okay',
      autoSubmit: true,
    });
    socket.emit('message', { data: envelope });
    await flushAsync();
    socket.emit('message', { data: envelope });
    await flushAsync();

    // The second one is genuinely dropped — that behavior is unchanged.
    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
    // ...but it no longer vanishes without a trace — and the row says whether
    // a segment id was even present (reviewer finding: an absent id must not
    // wear the duplicate label unannotated).
    expect(telemetryEvent).toHaveBeenCalledWith(
      'warn',
      'coach-turn-dispatch',
      'never-received',
      'coach-turn-skipped-duplicate-segment',
      { segment_present: true },
    );
  });

  it.each([
    { label: 'false', autoSubmit: false },
    { label: 'omitted', autoSubmit: undefined },
  ])('publishes one completion and no submit when live autoSubmit is $label', async ({ autoSubmit }) => {
    installAudioContextMock();
    installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream(`non-auto-${String(autoSubmit)}`)),
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    socket.emit('message', {
      data: JSON.stringify({
        event: 'final-transcript',
        segmentId: `non-auto-${String(autoSubmit)}`,
        transcript: 'draft only',
        ...(autoSubmit === undefined ? {} : { autoSubmit }),
      }),
    });
    await flushAsync();

    const completedCalls = harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'completed');
    expect(completedCalls).toHaveLength(1);
    expect(completedCalls[0][1]).toEqual(expect.objectContaining({ transcript: 'draft only' }));
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();
  });

  it('publishes completion for each duplicate final envelope but auto-submits its segment only once', async () => {
    installAudioContextMock();
    installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const harness = createHarness({
      getUserMedia: vi.fn(async () => createMockStream('duplicate-final-live')),
    });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    const finalEnvelope = {
      event: 'final-transcript',
      segmentId: 'duplicate-final-segment',
      transcript: 'submit once',
      autoSubmit: true,
    };
    socket.emit('message', { data: JSON.stringify(finalEnvelope) });
    socket.emit('message', { data: JSON.stringify(finalEnvelope) });
    await flushAsync();

    expect(harness.syncRuntimeEvent.mock.calls.filter(([event]) => event === 'completed')).toHaveLength(2);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledTimes(1);
    expect(harness.handleCapturedQuestion).toHaveBeenCalledWith('submit once');
  });

  it('permanently invalidates and cleans a browser owner across session A→B→A', async () => {
    Object.assign(window, { SpeechRecognition: MockRecognition });
    const harness = createHarness({
      effectiveProvider: 'browser',
      requestedProvider: 'browser',
      sessionId: 'session-A',
    });

    await expect(harness.controller.start()).resolves.toBe(true);
    const recognition = MockRecognition.instances[0];
    recognition.onstart?.(new Event('start'));
    const lifecycle = harness.syncRuntimeEvent.mock.calls.at(-1)?.[2];
    const savedResult = recognition.onresult;
    const savedEnd = recognition.onend;
    const eventCountBeforeMismatch = harness.syncRuntimeEvent.mock.calls.length;

    harness.context.sessionId = 'session-B';
    expect(lifecycle.isCurrent()).toBe(false);
    await flushAsync();
    const cleanupCountAtMismatch = recognition.abort.mock.calls.length;
    const stateAfterMismatch = { ...harness.state };
    harness.context.sessionId = 'session-A';
    const restoredLifecycleCurrent = lifecycle.isCurrent();
    savedResult?.(createResultEvent('revived browser result'));
    savedEnd?.(new Event('end'));
    await flushAsync();

    expect(cleanupCountAtMismatch).toBe(1);
    expect(recognition.onresult).toBeNull();
    expect(recognition.onend).toBeNull();
    expect(stateAfterMismatch.status).toBe('idle');
    expect(restoredLifecycleCurrent).toBe(false);
    expect(harness.state).toEqual(stateAfterMismatch);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountBeforeMismatch);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(recognition.abort).toHaveBeenCalledTimes(1);
  });

  it('permanently invalidates and cleans a live owner across session A→B→A', async () => {
    installAudioContextMock();
    const capture = installLiveCaptureMock();
    vi.stubGlobal('WebSocket', MockWebSocket);
    const stream = createMockStream('live-aba');
    const harness = createHarness({ getUserMedia: vi.fn(async () => stream), sessionId: 'session-A' });

    const start = harness.controller.start();
    await flushAsync();
    const socket = MockWebSocket.instances[0];
    const savedMessage = socket.handlers('message')[0];
    socket.emit('open');
    await expect(start).resolves.toBe(true);
    const lifecycle = harness.syncRuntimeEvent.mock.calls.find(([event]) => event === 'waiting')?.[2];
    const context = audioMocks.createVoiceAudioContext.mock.results[0].value as any;
    const source = context.createMediaStreamSource.mock.results[0].value;
    const eventCountBeforeMismatch = harness.syncRuntimeEvent.mock.calls.length;

    harness.context.sessionId = 'session-B';
    expect(lifecycle.isCurrent()).toBe(false);
    await flushAsync();
    const cleanupAtMismatch = {
      capture: capture.stop.mock.calls.length,
      source: source.disconnect.mock.calls.length,
      stream: stream.track.stop.mock.calls.length,
      context: context.close.mock.calls.length,
      socket: socket.closeCalls,
    };
    const stateAfterMismatch = { ...harness.state };
    harness.context.sessionId = 'session-A';
    const restoredLifecycleCurrent = lifecycle.isCurrent();
    savedMessage({
      data: JSON.stringify({
        event: 'final-transcript',
        segmentId: 'revived-live',
        transcript: 'must remain stale',
        autoSubmit: true,
      }),
    });
    await flushAsync();

    expect(cleanupAtMismatch).toEqual({ capture: 1, source: 1, stream: 1, context: 1, socket: 1 });
    expect(stateAfterMismatch.status).toBe('idle');
    expect(restoredLifecycleCurrent).toBe(false);
    expect(harness.state).toEqual(stateAfterMismatch);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountBeforeMismatch);
    expect(harness.handleCapturedQuestion).not.toHaveBeenCalled();
    expect(capture.stop).toHaveBeenCalledTimes(1);
    expect(stream.track.stop).toHaveBeenCalledTimes(1);
    expect(socket.closeCalls).toBe(1);
  });

  it('permanently invalidates and cleans a recorded owner across disconnect/reconnect', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installAudioContextMock();
    audioMocks.createPcm16Capture.mockRejectedValue(new Error('live unavailable'));
    captureMonitorCallbacks();
    const recordedStream = createMockStream('recorded-aba');
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createMockStream('recorded-aba-live'))
      .mockResolvedValueOnce(recordedStream);
    const harness = createHarness({ getUserMedia, sessionId: 'session-A' });

    await expect(harness.controller.start()).resolves.toBe(true);
    const recorder = MockMediaRecorder.instances[0];
    const savedData = recorder.ondataavailable;
    const savedError = recorder.onerror;
    const savedStop = recorder.onstop;
    const lifecycle = harness.syncRuntimeEvent.mock.calls.find(([event]) => event === 'waiting')?.[2];
    const eventCountBeforeMismatch = harness.syncRuntimeEvent.mock.calls.length;

    harness.context.isConnected = false;
    expect(lifecycle.isCurrent()).toBe(false);
    await flushAsync();
    const cleanupAtMismatch = {
      recorderStop: recorder.stopCalls,
      stream: recordedStream.track.stop.mock.calls.length,
    };
    const stateAfterMismatch = { ...harness.state };
    harness.context.isConnected = true;
    const restoredLifecycleCurrent = lifecycle.isCurrent();
    savedData?.({ data: new Blob(['revived-recorded']) } as BlobEvent);
    savedError?.(new Event('error'));
    savedStop?.(new Event('stop'));
    await flushAsync();

    expect(cleanupAtMismatch).toEqual({ recorderStop: 1, stream: 1 });
    expect(recorder.stopTrackCounts).toEqual([0]);
    expect(recorder.ondataavailable).toBeNull();
    expect(recorder.onerror).toBeNull();
    expect(recorder.onstop).toBeNull();
    expect(stateAfterMismatch.status).toBe('idle');
    expect(restoredLifecycleCurrent).toBe(false);
    expect(harness.state).toEqual(stateAfterMismatch);
    expect(harness.syncRuntimeEvent).toHaveBeenCalledTimes(eventCountBeforeMismatch);
    expect(harness.submitInputTurn).not.toHaveBeenCalled();
    expect(recorder.stopCalls).toBe(1);
    expect(recordedStream.track.stop).toHaveBeenCalledTimes(1);
  });

  it('syncs a runtime error event when listening fails to start', async () => {
    const syncRuntimeEvent = vi.fn(async () => undefined);
    const sessionLease = {};
    const state: FrontendState = {
      status: 'idle',
      error: null,
      finalTranscript: '',
      finalConfidence: null,
    };

    const setState = (updater: (current: FrontendState) => FrontendState) => {
      Object.assign(state, updater({ ...state }));
    };

    class BrokenRecognition {
      continuous = false;
      interimResults = false;
      lang = '';
      onstart: ((event: Event) => void) | null = null;
      onresult: ((event: any) => void) | null = null;
      onerror: ((event: any) => void) | null = null;
      onend: ((event: Event) => void) | null = null;

      start() {
        throw new Error('Mic denied');
      }
      stop() {}
      abort() {}
    }

    Object.assign(window, {
      SpeechRecognition: BrokenRecognition,
    });

    const controller = createVoiceCoachInputController({
      kernelWsUrl: 'ws://kernel.test',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true, sessionLease }),
      getRequestedInputProvider: () => 'browser',
      getEffectiveInputProvider: () => 'browser',
      getState: () => state,
      setState,
      setQuestionDraft: () => undefined,
      clearQuestionFeedback: () => undefined,
      reportQuestionFeedbackError: () => undefined,
      getRuntimeState: () => createDefaultVoiceUiState().voiceInputRuntime,
      getSelectedInputDeviceId: () => null,
      updateResolvedInput: () => undefined,
      canUseBackendRecordedFallback: () => false,
      getSilenceThreshold: () => 0.018,
      releasePracticeForListening: async () => undefined,
      isCoachSpeechBusy: () => false,
      stopCoachSpeech: () => undefined,
      render: () => undefined,
      syncRuntimeEvent,
      submitInputTurn: vi.fn(async () => ({}) as any),
      handleCapturedQuestion: vi.fn(async () => undefined),
      applyInputProviderStatusPayload: () => undefined,
      applyVoiceBackendPayload: () => undefined,
    });

    await expect(controller.start()).rejects.toThrow('Mic denied');
    expect(syncRuntimeEvent).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({
        requestedProvider: 'browser',
        effectiveProvider: 'browser',
        captureProvider: 'browser',
        transcriptSource: 'browser-speech-recognition',
      }),
      expect.objectContaining({
        sessionId: 'session-1',
        isCurrent: expect.any(Function),
      }),
    );
    expect(syncRuntimeEvent.mock.calls[0][2].isCurrent()).toBe(true);
  });

  // Live-path recovery accounting. The backend re-arms capture after a
  // recoverable outcome and says WHY via `recoveredFrom` on 'capture-ready'.
  // Before this was read, an ASR round-trip that found no speech looked exactly
  // like a fresh arm: the take was lost silently, the runtime streak counter
  // never moved, and the degenerate-take hint could never fire on this path.
  describe('capture-ready recoveredFrom accounting', () => {
    // Mirrors the real runtime: syncEvent applies the reducer SYNCHRONOUSLY
    // before its first await, which is what lets the hint guard read a fresh
    // consecutive count immediately after the no-speech sync call.
    function createRuntimeTracker() {
      let runtime = createDefaultVoiceUiState().voiceInputRuntime;
      const syncRuntimeEvent = vi.fn(async (event: any, eventOptions: any = {}) => {
        runtime = applyVoiceInputRuntimeEvent(runtime, event, eventOptions ?? {});
      });
      return {
        syncRuntimeEvent,
        getRuntimeState: () => runtime,
        eventsSince: (index: number): string[] => syncRuntimeEvent.mock.calls
          .slice(index)
          .map(([event]) => event as string),
      };
    }

    function emitCaptureReady(socket: MockWebSocket, extra: Record<string, unknown> = {}): void {
      socket.emit('message', {
        data: JSON.stringify({ event: 'capture-ready', sessionId: 'session-A', ...extra }),
      });
    }

    async function startLiveTake(
      label: string,
      harnessOverrides: Parameters<typeof createHarness>[0] = {},
    ) {
      installAudioContextMock();
      installLiveCaptureMock();
      MockWebSocket.autoCaptureReady = false;
      vi.stubGlobal('WebSocket', MockWebSocket);
      const tracker = createRuntimeTracker();
      const harness = createHarness({
        getUserMedia: vi.fn(async () => createMockStream(label)),
        syncRuntimeEvent: tracker.syncRuntimeEvent,
        getRuntimeState: tracker.getRuntimeState,
        ...harnessOverrides,
      });

      const starting = harness.controller.start();
      await flushAsync();
      const socket = MockWebSocket.instances[0];
      socket.emit('open');
      await flushAsync();
      emitCaptureReady(socket);
      await expect(starting).resolves.toBe(true);
      await flushAsync();
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });
      return { harness, socket, tracker };
    }

    it('settles an asr-no-speech re-arm straight back to waiting without any runtime no-speech accounting', async () => {
      const { harness, socket, tracker } = await startLiveTake('recovered-no-speech-live');
      const before = tracker.syncRuntimeEvent.mock.calls.length;

      emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech' });
      await flushAsync();

      // 'waiting' is the ONLY runtime event this branch may emit. A live re-arm
      // must never write the runtime no-speech accounting, because that counter
      // arms the hands-free pause (input-recovery.ts shouldDisableContinuous)
      // and the device never stopped listening on this turn.
      expect(tracker.eventsSince(before)).toEqual(['waiting']);
      expect(tracker.getRuntimeState().consecutiveNoSpeechTurns).toBe(0);
      expect(tracker.getRuntimeState().noSpeechTurns).toBe(0);
      expect(tracker.getRuntimeState().lastOutcome).not.toBe('no-speech');
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });
      expect(harness.stateTransitions.filter(({ status }) => status === 'error')).toHaveLength(0);
      // One lost take is below the hint bar — the coach stays quiet.
      expect(harness.reportQuestionFeedbackError).not.toHaveBeenCalled();
      expect(harness.appendCoachLine).not.toHaveBeenCalled();
    });

    it('surfaces the one calm noise hint once the streak of asr-no-speech re-arms reaches the bar', async () => {
      const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const { harness, socket, tracker } = await startLiveTake('recovered-streak-live');

      for (let index = 0; index < DEGENERATE_TAKE_HINT_AFTER; index += 1) {
        emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech' });
        await flushAsync();
      }

      // The hint rides the controller-local re-arm streak; the runtime counter
      // that arms the hands-free pause stays untouched at zero.
      expect(tracker.getRuntimeState().consecutiveNoSpeechTurns).toBe(0);
      expect(harness.reportQuestionFeedbackError).toHaveBeenCalledTimes(1);
      expect(harness.reportQuestionFeedbackError).toHaveBeenCalledWith(DEGENERATE_TAKE_HINT);
      expect(info).toHaveBeenCalledWith(expect.stringContaining('[voice-noise]'));
      // Still listening, still not an error state.
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });
      expect(harness.stateTransitions.filter(({ status }) => status === 'error')).toHaveLength(0);
    });

    it('leaves a plain capture-ready re-arm exactly as it was', async () => {
      const { harness, socket, tracker } = await startLiveTake('plain-rearm-live');
      const before = tracker.syncRuntimeEvent.mock.calls.length;

      emitCaptureReady(socket);
      await flushAsync();

      expect(tracker.eventsSince(before)).toEqual(['waiting']);
      expect(tracker.getRuntimeState().consecutiveNoSpeechTurns).toBe(0);
      expect(tracker.getRuntimeState().noSpeechTurns).toBe(0);
      expect(harness.reportQuestionFeedbackError).not.toHaveBeenCalled();
      expect(harness.appendCoachLine).not.toHaveBeenCalled();
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });
    });

    it('treats a wordless-practice-ack re-arm as a non-failure and renders only a line it actually carries', async () => {
      const { harness, socket, tracker } = await startLiveTake('wordless-ack-live');
      const before = tracker.syncRuntimeEvent.mock.calls.length;

      // The backend half may not have landed yet: no line field, no line.
      emitCaptureReady(socket, { recoveredFrom: 'wordless-practice-ack' });
      await flushAsync();
      expect(harness.appendCoachLine).not.toHaveBeenCalled();

      emitCaptureReady(socket, {
        recoveredFrom: 'wordless-practice-ack',
        coachLine: '  Heard that one as breath, not words.  ',
      });
      await flushAsync();

      expect(tracker.eventsSince(before)).toEqual(['waiting', 'waiting']);
      expect(tracker.getRuntimeState().consecutiveNoSpeechTurns).toBe(0);
      expect(tracker.getRuntimeState().noSpeechTurns).toBe(0);
      expect(harness.reportQuestionFeedbackError).not.toHaveBeenCalled();
      expect(harness.appendCoachLine).toHaveBeenCalledTimes(1);
      expect(harness.appendCoachLine).toHaveBeenCalledWith('Heard that one as breath, not words.');
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });
    });

    // -----------------------------------------------------------------------
    // FIELD REPAIR (2026-07-26): the acknowledgment must be HEARD.
    //
    // This is a voice-first coach surface. The learner hums, looks up, and gets
    // a line they can only READ — which is indistinguishable from the tutor
    // having stopped responding, and is exactly what was reported. The ack now
    // also rides the SAME TTS path coach replies and greetings use.
    // -----------------------------------------------------------------------
    it('speaks the wordless ack through the coach speech path exactly once', async () => {
      const { harness, socket } = await startLiveTake('wordless-ack-spoken');

      emitCaptureReady(socket, {
        recoveredFrom: 'wordless-practice-ack',
        coachLine: '  Heard that — steady and easy.  ',
      });
      await flushAsync();

      // Trimmed identically on both channels — one line, two surfaces.
      expect(harness.appendCoachLine).toHaveBeenCalledTimes(1);
      expect(harness.appendCoachLine).toHaveBeenCalledWith('Heard that — steady and easy.');
      expect(harness.speakCoachLine).toHaveBeenCalledTimes(1);
      expect(harness.speakCoachLine).toHaveBeenCalledWith('Heard that — steady and easy.');
    });

    it('speaks a sentence semantic retry through the same in-place coach line path', async () => {
      const { harness, socket, tracker } = await startLiveTake('semantic-retry-spoken');
      const before = tracker.syncRuntimeEvent.mock.calls.length;

      emitCaptureReady(socket, {
        recoveredFrom: 'semantic-retry',
        coachLine: 'I heard your voice, but I missed the words. Say the sentence again.',
      });
      await flushAsync();

      expect(tracker.eventsSince(before)).toEqual(['waiting']);
      expect(tracker.getRuntimeState().consecutiveNoSpeechTurns).toBe(0);
      expect(harness.appendCoachLine).toHaveBeenCalledWith(
        'I heard your voice, but I missed the words. Say the sentence again.',
      );
      expect(harness.speakCoachLine).toHaveBeenCalledWith(
        'I heard your voice, but I missed the words. Say the sentence again.',
      );
    });

    it('never speaks an ack the envelope did not carry', async () => {
      const { harness, socket } = await startLiveTake('wordless-ack-no-line');

      emitCaptureReady(socket, { recoveredFrom: 'wordless-practice-ack' });
      await flushAsync();

      expect(harness.appendCoachLine).not.toHaveBeenCalled();
      expect(harness.speakCoachLine).not.toHaveBeenCalled();
    });

    it('WIRED: a speaking tutor is not interrupted — the line is withheld AND claimed', async () => {
      // This is deliberately wired end-to-end (real line channel + real handoff
      // resolver) rather than asserted at the seam, because the seam is where
      // the first cut of this fix went wrong. It guarded the call with
      // `if (!isCoachSpeechBusy())` and asserted `speakCoachLine` was NOT
      // called — which reads like "we withheld the speech" and is in fact the
      // broken state: skipping the call skips the CLAIM, the appended line
      // stays unspoken, and the render handoff that the append just scheduled
      // says it over the tutor. A "not called" assertion cannot tell the two
      // apart, so it must never be the thing standing behind this guard.
      const spoken: string[] = [];
      const claimed: string[] = [];
      const thread: { id: string; content: string }[] = [];
      const channel = createVoiceCoachThreadLineChannel({
        appendMessage: (message) => { thread.push({ id: message.id, content: message.content }); },
        speakMessage: (message) => { spoken.push(message.content); return true; },
        markSpoken: (message) => { claimed.push(message.id); },
        // CASE A: the speech controller reports audio actually coming out. This
        // is the common "tutor is mid-sentence" case and the one the old guard
        // short-circuited.
        isCoachSpeaking: () => true,
      });

      // The controller's OWN speech-busy probe must be true here too — that is
      // the signal the deleted guard consulted, so a test where it is false
      // cannot tell the fixed code from the broken code. It has to flip AFTER
      // the take is live, because a tutor already speaking at start-up blocks
      // the capture handoff itself, which is a different branch.
      let speaking = false;
      const { harness, socket } = await startLiveTake('wordless-ack-busy-wired', {
        isCoachSpeechBusy: () => speaking,
        speakCoachLineImpl: (text: string) => {
          channel.append(text);
          return channel.speak(text);
        },
      });
      speaking = true;

      emitCaptureReady(socket, {
        recoveredFrom: 'wordless-practice-ack',
        coachLine: 'Heard that — steady and easy.',
      });
      await flushAsync();

      // Nothing was said over the tutor...
      expect(spoken).toEqual([]);
      // ...the record of the turn still landed...
      expect(thread).toHaveLength(1);
      expect(thread[0].content).toBe('Heard that — steady and easy.');
      // ...and the line was CLAIMED, which is what actually withholds it.
      expect(claimed).toEqual([thread[0].id]);
      // Proof that the claim is the thing that matters: the real handoff
      // resolver now leaves this message alone instead of speaking it.
      const handoffContext = {
        snapshot: { owner: 'idle', hasCoachSpeaking: true, currentSessionId: 's', isConnected: true },
        hasInputProvider: true,
        automaticTurnBoundarySupported: true,
        recoveryShouldDisableContinuous: false,
        continuousEnabled: true,
        voiceSpeechRecognitionStatus: 'idle',
        questionDraft: '',
        canPlaySpeech: true,
        latestCoachMessageId: thread[0].id,
      } as unknown as Parameters<typeof resolveVoiceCoachRenderHandoffPlan>[0];
      expect(resolveVoiceCoachRenderHandoffPlan({
        ...handoffContext,
        lastSpokenCoachMessageId: claimed[0],
      })).toEqual({ action: 'noop' });
      // ...whereas leaving it unclaimed is exactly the interrupt (the defect).
      expect(resolveVoiceCoachRenderHandoffPlan({
        ...handoffContext,
        lastSpokenCoachMessageId: null,
      })).toEqual({ action: 'speak-latest-coach' });

      expect(harness.appendCoachLine).toHaveBeenCalledTimes(1);
    });

    it('falls back to the text append when the speech path cannot start', async () => {
      const { harness, socket } = await startLiveTake('wordless-ack-mute', {
        speakCoachLine: false,
      });

      emitCaptureReady(socket, {
        recoveredFrom: 'wordless-practice-ack',
        coachLine: 'Heard that — steady and easy.',
      });
      await flushAsync();

      // A host with no usable speaker still gets the whole acknowledgment; the
      // append is not conditional on speech, it is the fallback.
      expect(harness.speakCoachLine).toHaveBeenCalledTimes(1);
      expect(harness.speakCoachLine).toHaveReturnedWith(false);
      expect(harness.appendCoachLine).toHaveBeenCalledTimes(1);
      expect(harness.appendCoachLine).toHaveBeenCalledWith('Heard that — steady and easy.');
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });
    });

    it('an asr-no-speech re-arm never reaches the speech path', async () => {
      const { harness, socket } = await startLiveTake('lost-take-silent');

      emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech', coachLine: 'ignored' });
      await flushAsync();

      expect(harness.speakCoachLine).not.toHaveBeenCalled();
      expect(harness.appendCoachLine).not.toHaveBeenCalled();
    });

    it('treats an unrecognized recoveredFrom value as a plain re-arm', async () => {
      const { harness, socket, tracker } = await startLiveTake('unknown-recovery-live');
      const before = tracker.syncRuntimeEvent.mock.calls.length;

      emitCaptureReady(socket, { recoveredFrom: 'some-future-reason', coachLine: 'ignored' });
      await flushAsync();

      expect(tracker.eventsSince(before)).toEqual(['waiting']);
      expect(tracker.getRuntimeState().consecutiveNoSpeechTurns).toBe(0);
      expect(harness.reportQuestionFeedbackError).not.toHaveBeenCalled();
      expect(harness.appendCoachLine).not.toHaveBeenCalled();
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });
    });

    it('resets the re-arm streak when a turn finally lands, so the next streak starts clean', async () => {
      const { harness, socket } = await startLiveTake('rearm-reset-live');

      // Two lost re-arms — below the bar.
      emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech' });
      await flushAsync();
      emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech' });
      await flushAsync();
      expect(harness.reportQuestionFeedbackError).not.toHaveBeenCalled();

      // A turn lands: syncs 'completed', which is one of the two events the
      // runtime reducer uses to zero consecutiveNoSpeechTurns. The re-arm
      // streak must zero with it.
      socket.emit('message', {
        data: JSON.stringify({
          event: 'final-transcript',
          sessionId: 'session-A',
          segmentId: 'segment-1',
          transcript: 'hello there',
          autoSubmit: false,
        }),
      });
      await flushAsync();

      // Two more re-arms would reach 4 on an un-reset streak; on a clean one
      // they are only 2, so the coach stays quiet.
      emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech' });
      await flushAsync();
      emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech' });
      await flushAsync();
      expect(harness.reportQuestionFeedbackError).not.toHaveBeenCalled();

      // The third after the reset does earn the hint.
      emitCaptureReady(socket, { recoveredFrom: 'asr-no-speech' });
      await flushAsync();
      expect(harness.reportQuestionFeedbackError).toHaveBeenCalledTimes(1);
      expect(harness.reportQuestionFeedbackError).toHaveBeenCalledWith(DEGENERATE_TAKE_HINT);
    });
  });

  /* The pause machinery, driven for real. These tests wire the ACTUAL
   * input-runtime-controller, the ACTUAL recovery-state resolver and the ACTUAL
   * recovery-safety plan — no mocked syncRuntimeEvent — because the claim under
   * test is a negative one ("a live re-arm can never pause hands-free"), and a
   * negative is only worth anything against machinery that provably fires. */
  describe('live asr-no-speech re-arms and the hands-free pause machinery', () => {
    function createRealRuntimeStack() {
      const statusController = createVoiceRuntimeStatusController();
      const initial = createDefaultVoiceUiState();
      let voiceUiState = {
        ...initial,
        // Hands-free ON: this is precisely what the pause would switch off.
        coachVoice: { ...initial.coachVoice, continuousEnabled: true },
      };
      const updateVoiceCockpitState = vi.fn(async () => undefined);
      const addTerminalLine = vi.fn();
      const recoveryContext = {
        requestedInputProvider: 'backend' as const,
        effectiveInputProvider: 'backend' as const,
        inputProviderFallbackActive: false,
      };

      const runtimeController = createVoiceInputRuntimeController({
        getVoiceUiState: () => voiceUiState,
        updateVoiceUiState: (updater: any) => {
          voiceUiState = updater(voiceUiState);
        },
        getSessionContext: () => ({ currentSessionId: 'session-A', isConnected: true }),
        getRequestedInputProvider: () => 'backend',
        getEffectiveInputProvider: () => 'backend',
        getInputRecoveryState: (runtime: any) => statusController
          .getInputRecoveryState(runtime ?? voiceUiState.voiceInputRuntime, recoveryContext as any),
        planRecoverySafety: (planOptions: any) => statusController.planRecoverySafety(planOptions),
        setRecoverySafetyPending: (pending: boolean) => {
          statusController.setRecoverySafetyPending(pending);
        },
        submitInputRuntimeEvent: vi.fn(async () => ({}) as any),
        applyInputProviderStatusPayload: vi.fn(),
        applyVoiceBackendPayload: vi.fn(),
        updateVoiceCockpitState,
        addTerminalLine,
        render: vi.fn(),
      } as any);

      return {
        runtimeController,
        updateVoiceCockpitState,
        addTerminalLine,
        getRuntime: () => runtimeController.getRuntimeState(),
      };
    }

    async function startRealLiveTake(label: string) {
      installAudioContextMock();
      installLiveCaptureMock();
      MockWebSocket.autoCaptureReady = false;
      vi.stubGlobal('WebSocket', MockWebSocket);
      const stack = createRealRuntimeStack();
      const harness = createHarness({
        getUserMedia: vi.fn(async () => createMockStream(label)),
        syncRuntimeEvent: vi.fn((event: any, eventOptions: any, lifecycle: any) => stack
          .runtimeController.syncEvent(event, eventOptions, lifecycle)),
        getRuntimeState: () => stack.runtimeController.getRuntimeState(),
      });

      const starting = harness.controller.start();
      await flushAsync();
      const socket = MockWebSocket.instances[0];
      socket.emit('open');
      await flushAsync();
      socket.emit('message', {
        data: JSON.stringify({ event: 'capture-ready', sessionId: 'session-A' }),
      });
      await expect(starting).resolves.toBe(true);
      await flushAsync();
      return { harness, socket, stack };
    }

    function emitLive(socket: MockWebSocket, payload: Record<string, unknown>): void {
      socket.emit('message', {
        data: JSON.stringify({ sessionId: 'session-A', ...payload }),
      });
    }

    it('never pauses hands-free across repeated live re-arms plus a genuine backend no-speech timeout', async () => {
      vi.spyOn(console, 'info').mockImplementation(() => undefined);
      const { harness, socket, stack } = await startRealLiveTake('rearm-no-pause-live');

      // Five ASR-rejected takes — what a noisy room produces in bulk.
      for (let index = 0; index < 5; index += 1) {
        emitLive(socket, { event: 'capture-ready', recoveredFrom: 'asr-no-speech' });
        await flushAsync();
      }
      expect(stack.getRuntime().consecutiveNoSpeechTurns).toBe(0);
      // Every re-arm left the mic armed and listening.
      expect(harness.state).toMatchObject({ status: 'waiting', error: null });

      // Plus one GENUINE backend no-speech timeout (the 12 s VAD boundary).
      emitLive(socket, { event: 'no-speech' });
      await flushAsync();

      // The genuine one counts — and one is below the >= 2 pause threshold.
      expect(stack.getRuntime().consecutiveNoSpeechTurns).toBe(1);
      expect(stack.updateVoiceCockpitState).not.toHaveBeenCalled();
      expect(stack.addTerminalLine).not.toHaveBeenCalled();

      // The learner still gets the calm hint the streak earned.
      expect(harness.reportQuestionFeedbackError).toHaveBeenCalledTimes(1);
      expect(harness.reportQuestionFeedbackError).toHaveBeenCalledWith(DEGENERATE_TAKE_HINT);
      // A genuine no-speech settles to idle — pre-existing behaviour, and still
      // never an error state.
      expect(harness.state).toMatchObject({ status: 'idle', error: null });
      expect(harness.stateTransitions.filter(({ status }) => status === 'error')).toHaveLength(0);
    });

    it('does pause hands-free after two genuine backend no-speech turns (control)', async () => {
      const { socket, stack } = await startRealLiveTake('genuine-no-speech-pause-live');

      emitLive(socket, { event: 'no-speech' });
      await flushAsync();
      emitLive(socket, { event: 'no-speech' });
      await flushAsync();

      expect(stack.getRuntime().consecutiveNoSpeechTurns).toBe(2);
      expect(stack.updateVoiceCockpitState).toHaveBeenCalledWith(
        expect.objectContaining({ coachVoice: { continuousEnabled: false } }),
      );
      expect(stack.addTerminalLine).toHaveBeenCalledWith('system', expect.stringContaining('Hands-free was paused'));
    });
  });
});
