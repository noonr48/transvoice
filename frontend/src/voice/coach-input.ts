import type {
  VoiceCoachInputProvider,
  VoiceInputRuntimeEvent,
  VoiceInputRuntimeEventRequest,
  VoiceInputTurnRequest,
  VoiceInputTurnResponse,
} from './api';
import { hasVoiceBackendPayload, type VoiceBackendPayload, type VoiceInputRuntimeState } from './state';
import { pushBackendDiagnostic, reportBackendException } from '../runtime-diagnostics';
import { createPcm16Capture, type Pcm16CaptureHandle } from './audio/pcm16-capture';
import { createVoiceAudioContext } from './audio/audio-context';
import { parseVoiceInputLiveEnvelope } from './backend-live/envelope';
import type { VoiceInputRuntimeLifecycleContext } from './input-runtime-controller';

type BrowserSpeechRecognitionAlternative = {
  transcript: string;
  confidence: number;
};

type BrowserSpeechRecognitionResultLike = {
  isFinal: boolean;
  length: number;
  [index: number]: BrowserSpeechRecognitionAlternative;
};

type BrowserSpeechRecognitionEventLike = Event & {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResultLike>;
};

type BrowserSpeechRecognitionErrorEventLike = Event & {
  error?: string;
  message?: string;
};

type BrowserSpeechRecognitionLike = EventTarget & {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onstart: ((event: Event) => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEventLike) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEventLike) => void) | null;
  onend: ((event: Event) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

type BrowserSpeechRecognitionConstructor = new () => BrowserSpeechRecognitionLike;

type VoiceCoachInputFrontendState = {
  status: 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
  error: string | null;
  finalTranscript: string;
  finalConfidence: number | null;
};

/**
 * Stable by exact identity for one session ownership epoch. Every session ID
 * change, disconnect, or reconnect must rotate to a fresh, never-reused object.
 */
export type VoiceCoachInputSessionLease = object;

type VoiceCoachInputControllerOptions = {
  kernelWsUrl: string;
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
    sessionLease: VoiceCoachInputSessionLease;
  };
  getRequestedInputProvider: () => VoiceCoachInputProvider;
  getEffectiveInputProvider: (requestedProvider?: VoiceCoachInputProvider) => VoiceCoachInputProvider | null;
  getState: () => VoiceCoachInputFrontendState;
  setState: (
    updater: (state: VoiceCoachInputFrontendState) => VoiceCoachInputFrontendState,
  ) => void;
  setQuestionDraft: (value: string) => void;
  clearQuestionFeedback: () => void;
  reportQuestionFeedbackError: (message: string) => void;
  getRuntimeState: () => VoiceInputRuntimeState;
  getSelectedInputDeviceId: () => string | null;
  updateResolvedInput: (label: string | null, deviceId: string | null) => void;
  canUseBackendRecordedFallback: () => boolean;
  canUseBackendLiveCapture?: () => boolean;
  getSilenceThreshold: () => number;
  getBackendLiveVadConfig?: () => {
    silenceHoldMs?: number;
    noSpeechTimeoutMs?: number;
    minSpeechMs?: number;
    [key: string]: unknown;
  };
  getBackendLiveBearerToken?: () => string | null;
  getBackendLiveLeaseId?: () => string | null;
  // Graph live-frame tap (2026-08-05): open a separate trainer analyzer
  // stream during hearing so the mirror-graph learner dot gets per-frame
  // pitch/resonance. createGraphStream returns the authenticated WS url
  // (or null); setVoiceLiveFrame bridges an inbound frame to the store.
  createGraphStream?: () => Promise<string | null>;
  setVoiceLiveFrame?: (frame: unknown) => void;
  getAudioPreferWorklet?: () => boolean;
  releasePracticeForListening: () => Promise<void>;
  isCoachSpeechBusy: () => boolean;
  stopCoachSpeech: () => void;
  render: () => void;
  syncRuntimeEvent: (
    event: VoiceInputRuntimeEvent,
    options?: VoiceInputRuntimeEventRequest & { render?: boolean },
    lifecycle?: VoiceInputRuntimeLifecycleContext,
  ) => Promise<void>;
  submitInputTurn: (
    sessionId: string,
    input: VoiceInputTurnRequest,
  ) => Promise<VoiceInputTurnResponse>;
  handleCapturedQuestion: (
    question: string,
    options?: { listeningTurnId?: string },
  ) => Promise<void>;
  applyInputProviderStatusPayload: (payload: unknown) => void;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  /**
   * Optional: append a plain coach line into the thread — the same render path
   * the greeting and debrief lines use. Only used for NON-failure backend
   * acknowledgments that carry their own text; when unwired the line is simply
   * dropped (never an error surface, never invented copy).
   */
  appendCoachLine?: (text: string) => void;
  /**
   * Optional: speak a line the host has just appended to the thread, through
   * the SAME coach TTS path replies and greetings use. Returns whether playback
   * started; false (or unwired) means the thread append is the whole surface.
   */
  speakCoachLine?: (text: string) => boolean;
};

declare global {
  interface Window {
    SpeechRecognition?: BrowserSpeechRecognitionConstructor;
    webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
  }
}

function getSpeechRecognitionConstructor(): BrowserSpeechRecognitionConstructor | null {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

/**
 * CONVERSATION-lane capture constraints (echo-safe). This helper feeds ONLY the
 * coach-turn listening captures in this file (backend-live + recorded fallback).
 * The MEASUREMENT lane acquires its own raw streams elsewhere and must stay raw.
 *
 * | Lane          | Acquired in                                  | EC  | NS  | AGC |
 * |---------------|----------------------------------------------|-----|-----|-----|
 * | conversation  | coach-input.ts (backend-live + recorded)     | ON  | ON  | off |
 * | measurement   | practice-transport.ts (armed takes)          | off | off | off |
 * | measurement   | front-door.ts (reference recording)          | off | off | off |
 *
 * Why: coach TTS plays over the phone speaker while the hands-free mic listens;
 * without echoCancellation the coach hears itself (only half-duplex sequencing
 * protects today). EC+NS are safe here because this audio is transcribed (ASR),
 * never measured. AGC stays OFF everywhere — it corrupts level/RMS semantics
 * (the local VAD in this file thresholds raw RMS). The threshold read through
 * getSilenceThreshold() is noise-adaptive: host-runtime-composition derives it
 * from the mic-check noise floor (never below the tuned base, capped sanely).
 */
function getVoiceCoachInputConstraints(requestedDeviceId: string | null): MediaStreamConstraints {
  return {
    audio: requestedDeviceId
      ? {
          deviceId: { exact: requestedDeviceId },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        }
      : {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: false,
        },
  };
}

/** Witness: one line per conversation-lane mic acquisition (echo-safe split). */
function logConversationStreamAcquisition(path: 'backend-live' | 'recorded-fallback'): void {
  console.info(`[voice-stream] conversation EC:on NS:on AGC:off (${path})`);
}

type VoiceInputCaptureTelemetryCode =
  | 'audio-context-not-running'
  | 'script-processor-capture-started'
  | 'script-processor-first-pcm'
  | 'script-processor-no-pcm'
  | 'worklet-capture-started'
  | 'worklet-first-pcm'
  | 'worklet-no-pcm';

function reportVoiceInputCaptureTelemetry(
  level: 'error' | 'warn' | 'info',
  failureClass: 'ok' | 'partial-function',
  code: VoiceInputCaptureTelemetryCode,
): void {
  try {
    const telemetry = (globalThis as typeof globalThis & {
      __tvTelemetry?: {
        event: (
          eventLevel: 'error' | 'warn' | 'info',
          seam: string,
          eventFailureClass: string,
          eventCode: string,
          data?: Record<string, unknown>,
        ) => void;
      };
    }).__tvTelemetry;
    telemetry?.event(level, 'voice-input-capture', failureClass, code);
  } catch {
    // Capture remains authoritative; telemetry is advisory.
  }
}

/**
 * Every outcome of the client's auto-submit decision (2026-07-27 field repair).
 *
 * A live turn reached `asr-completed` with a real transcript and the coach
 * never answered. Nothing on the server could tell whether the client had asked
 * for a reply, because the client's decision NOT to ask was a plain `return` in
 * four different places. `dispatched` is the only healthy code; every other one
 * marks a turn the learner spoke and nothing was going to say back.
 *
 * `coach-turn-dispatched` is deliberately paired with the server's
 * `coach_turn_request accepted` line: seeing one without the other names the
 * dead crossing without any further guessing.
 */
export type VoiceCoachTurnDispatchCode =
  | 'coach-turn-dispatched'
  | 'coach-turn-skipped-duplicate-segment'
  | 'coach-turn-skipped-no-transcript'
  | 'coach-turn-skipped-manual'
  | 'coach-turn-declined-no-session'
  | 'coach-turn-declined-not-connected'
  // 2026-07-27 owner's law: clarification consumption is gone; only the
  // scope/device lane still consumes speech. intent-routed stays in the debug
  // ingest allowlist for old bundles but is no longer emitted.
  | 'coach-turn-declined-scope-intent'
  | 'coach-turn-declined-owner-superseded'
  | 'coach-turn-declined-no-shell';

export function reportVoiceCoachTurnDispatch(
  level: 'error' | 'warn' | 'info',
  failureClass: 'ok' | 'never-received' | 'not-joined' | 'dead-function' | 'not-connected',
  code: VoiceCoachTurnDispatchCode,
  data?: Record<string, unknown>,
): void {
  try {
    const telemetry = (globalThis as typeof globalThis & {
      __tvTelemetry?: {
        event: (
          eventLevel: 'error' | 'warn' | 'info',
          seam: string,
          eventFailureClass: string,
          eventCode: string,
          data?: Record<string, unknown>,
        ) => void;
      };
    }).__tvTelemetry;
    if (data) {
      telemetry?.event(level, 'coach-turn-dispatch', failureClass, code, data);
    } else {
      telemetry?.event(level, 'coach-turn-dispatch', failureClass, code);
    }
  } catch {
    // The turn remains authoritative; telemetry is advisory.
  }
}

function reportVoiceInputHandoffYield(): void {
  try {
    const telemetry = (globalThis as typeof globalThis & {
      __tvTelemetry?: {
        event: (
          eventLevel: 'info',
          seam: string,
          eventFailureClass: string,
          eventCode: string,
        ) => void;
      };
    }).__tvTelemetry;
    telemetry?.event(
      'info',
      'voice-input-handoff',
      'ok',
      'listening-yielded-to-coach-speech',
    );
  } catch {
    // Handoff ownership remains authoritative; telemetry is advisory.
  }
}

function resolveRecorderMimeType(): string {
  if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) return 'audio/ogg;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/ogg')) return 'audio/ogg';
  if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) return 'audio/webm;codecs=opus';
  if (MediaRecorder.isTypeSupported('audio/webm')) return 'audio/webm';
  return '';
}

type InputOwner = {
  generation: number;
  sessionId: string | null;
  isConnected: boolean;
  sessionLease: VoiceCoachInputSessionLease;
  requestedProvider: VoiceCoachInputProvider;
  abortController: AbortController;
  cancelled: Promise<void>;
  resolveCancelled: () => void;
  eventEpoch: number;
  phase: 'starting' | 'active' | 'inactive';
  identity: object | null;
  invalidated: boolean;
  terminalErrorPublished: boolean;
};

type RecordedBackendTake = {
  owner: InputOwner;
  generation: number;
  sessionId: string | null;
  isConnected: boolean;
  requestedProvider: VoiceCoachInputProvider;
  recorder: MediaRecorder | null;
  stream: MediaStream | null;
  chunks: Blob[];
  speakingStartedAt: number | null;
  lastVoiceAt: number | null;
  captureStartedAt: number | null;
  stopIntent: boolean | null;
  stopRequested: boolean;
  finalized: boolean;
  terminal: boolean;
  stopWatchdog: number | null;
  analyser: AnalyserNode | null;
  monitorContext: AudioContext | null;
  monitorSource: MediaStreamAudioSourceNode | null;
  monitorTimer: number | null;
};

type BackendLiveTake = {
  owner: InputOwner;
  generation: number;
  sessionId: string;
  requestedProvider: VoiceCoachInputProvider;
  stream: MediaStream | null;
  socket: WebSocket | null;
  graphSocket?: WebSocket | null;
  audioContext: AudioContext | null;
  sourceNode: MediaStreamAudioSourceNode | null;
  capture: Pcm16CaptureHandle | null;
  captureStartedAt: number | null;
  liveSessionId: string | null;
  stoppedManually: boolean;
  submittedSegments: Set<string>;
  firstPcmProduced: boolean;
  terminal: boolean;
  rejectStartup: ((error: Error) => void) | null;
};

type InputStartupAttempt = {
  captureProvider: 'backend' | 'browser' | null;
  transcriptSource: 'backend-live' | 'backend-asr' | 'browser-fallback' | 'browser-speech-recognition' | null;
  captureStartedAt: number | null;
};

class InputStartupFailure extends Error {
  readonly terminalMessage: string;
  readonly attempt: InputStartupAttempt;

  constructor(publicMessage: string, terminalMessage: string, attempt: InputStartupAttempt) {
    super(publicMessage);
    this.name = 'InputStartupFailure';
    this.terminalMessage = terminalMessage;
    this.attempt = attempt;
  }
}

type BrowserRecognitionTake = {
  owner: InputOwner;
  generation: number;
  requestedProvider: VoiceCoachInputProvider;
  sessionId: string | null;
  isConnected: boolean;
  recognition: BrowserSpeechRecognitionLike;
  startedAt: number;
  speechDetectedAt: number | null;
  capturedAt: number | null;
  finalTranscript: string;
  finalConfidence: number | null;
  transcriptSource: 'browser-fallback' | 'browser-speech-recognition';
  stoppedManually: boolean;
  failed: boolean;
  terminal: boolean;
};

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  const message = String(error).trim();
  return message && message !== '[object Object]' ? message : fallback;
}

/* Flow lane — degenerate-take guard.
 * After N consecutive takes end with no speech, the room is likely defeating
 * the raw-RMS VAD gate (noise arming instantly, or speech never clearing the
 * threshold). The runtime already counts the streak
 * (voiceInputRuntime.consecutiveNoSpeechTurns, input-runtime-controller —
 * applied synchronously at the top of syncEvent, so a read right after the
 * no-speech sync call is fresh); this guard reads that existing counter and
 * surfaces ONE calm hint per streak through the existing question-feedback
 * surface. The recovery machinery (input-recovery.ts) owns provider-switch
 * suggestions at >= 2 consecutive; this complements it at >= 3 with the
 * noise-specific nudge. */
export const DEGENERATE_TAKE_HINT_AFTER = 3;
export const DEGENERATE_TAKE_HINT = 'noisy here — tap the orb to talk instead';

export type DegenerateTakeHintGuardOptions = {
  getConsecutiveNoSpeechTurns: () => number;
  surfaceHint: (message: string) => void;
  log?: (line: string) => void;
  hintAfter?: number;
};

export function createDegenerateTakeHintGuard(options: DegenerateTakeHintGuardOptions) {
  const hintAfter = options.hintAfter ?? DEGENERATE_TAKE_HINT_AFTER;
  let hintedThisStreak = false;

  return {
    /** Call right after a no-speech turn has been synced into the runtime. */
    onNoSpeechTurn(): void {
      const consecutive = options.getConsecutiveNoSpeechTurns();
      if (!Number.isFinite(consecutive) || consecutive < hintAfter) {
        // Streak below the bar (or reset) — re-arm for the next streak.
        hintedThisStreak = false;
        return;
      }
      if (hintedThisStreak) {
        return; // one calm hint per streak
      }
      hintedThisStreak = true;
      options.log?.(`[voice-noise] ${consecutive} takes in a row ended with no speech — surfacing quiet hint`);
      options.surfaceHint(DEGENERATE_TAKE_HINT);
    },
  };
}

/**
 * Shape-tolerant read of the optional acknowledgment line a non-failure
 * 'capture-ready' may carry. The backend half may not have landed yet, so an
 * absent, non-string, or blank field is silently ignored — we never invent copy
 * to stand in for it.
 */
function readLiveEnvelopeCoachLine(source: { coachLine?: unknown; ackLine?: unknown }): string {
  for (const candidate of [source.coachLine, source.ackLine]) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim();
  }
  return '';
}

export function createVoiceCoachInputController(options: VoiceCoachInputControllerOptions) {
  let inputGeneration = 0;
  let recordedTake: RecordedBackendTake | null = null;
  let liveTake: BackendLiveTake | null = null;
  let browserTake: BrowserRecognitionTake | null = null;
  let currentOwner: InputOwner | null = null;

  const patchState = (patch: Partial<VoiceCoachInputFrontendState>) => {
    options.setState((state) => ({ ...state, ...patch }));
  };

  const isActiveStatus = (
    status: VoiceCoachInputFrontendState['status'] = options.getState().status,
  ): boolean => status === 'waiting' || status === 'listening' || status === 'processing';

  /* Live re-arm streak — DELIBERATELY not part of the input runtime state.
   *
   * When the backend's ASR rejects a capture as non-speech it re-arms and keeps
   * listening (backend/voice-input-live.js; product law from commit 5f5541f —
   * the mic never stopped on these turns). Such a take must therefore never
   * reach voiceInputRuntime.consecutiveNoSpeechTurns, because at >= 2 that
   * counter makes getVoiceInputRecoveryState report shouldDisableContinuous
   * (input-recovery.ts), which auto-pauses hands-free, stops
   * shouldRunContinuousVoiceCoachLoop from restarting it (coach-loop.ts), and
   * makes the cockpit refuse a manual re-enable (cockpit-controller.ts). One
   * ASR-rejected take plus one genuine 12 s no-speech timeout would otherwise
   * arm that pause — and ASR-rejected takes are exactly what a noisy room
   * produces in bulk.
   *
   * Keeping the streak in this closure means it can drive the calm noise hint
   * and nothing else: it is structurally unreachable from the recovery /
   * pause / refuse machinery, which only ever reads runtime state. */
  let liveNoSpeechReArms = 0;

  // Flow lane: one calm noise hint after repeated empty takes. The streak is the
  // runtime's own no-speech count (12 s timeouts, recorded + browser paths) PLUS
  // the live re-arms above, so a mixed streak still earns exactly one hint.
  const degenerateTakeHintGuard = createDegenerateTakeHintGuard({
    getConsecutiveNoSpeechTurns: () => options.getRuntimeState().consecutiveNoSpeechTurns
      + liveNoSpeechReArms,
    surfaceHint: (message) => options.reportQuestionFeedbackError(message),
    log: (line) => console.info(line),
  });

  const getBackendLiveInputUrl = () => `${options.kernelWsUrl}/voice/input/live`;

  const isCurrentGeneration = (generation: number): boolean => generation === inputGeneration;

  function createInputOwner(generation: number, phase: InputOwner['phase']): InputOwner {
    const session = options.getSessionContext();
    let resolveCancelled!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      resolveCancelled = resolve;
    });
    return {
      generation,
      sessionId: session.currentSessionId,
      isConnected: session.isConnected,
      sessionLease: session.sessionLease,
      requestedProvider: options.getRequestedInputProvider(),
      abortController: new AbortController(),
      cancelled,
      resolveCancelled,
      eventEpoch: 0,
      phase,
      identity: null,
      invalidated: false,
      terminalErrorPublished: false,
    };
  }

  function abortOwner(owner: InputOwner | null): void {
    if (!owner) return;
    owner.invalidated = true;
    owner.phase = 'inactive';
    if (owner.abortController.signal.aborted) return;
    owner.abortController.abort();
    owner.resolveCancelled();
  }

  function selectOwner(phase: InputOwner['phase']): InputOwner {
    abortOwner(currentOwner);
    const owner = createInputOwner(++inputGeneration, phase);
    currentOwner = owner;
    return owner;
  }

  function isOwnerSelected(owner: InputOwner): boolean {
    return currentOwner === owner
      && !owner.invalidated
      && !owner.abortController.signal.aborted
      && isCurrentGeneration(owner.generation);
  }

  function hasOwnerSessionContext(owner: InputOwner): boolean {
    const session = options.getSessionContext();
    return owner.isConnected
      && session.isConnected
      && Boolean(owner.sessionId)
      && session.currentSessionId === owner.sessionId
      && session.sessionLease === owner.sessionLease;
  }

  function invalidateOwnerForContextMismatch(owner: InputOwner): void {
    if (owner.invalidated) return;
    const shouldResetState = currentOwner === owner && isActiveStatus();
    abortOwner(owner);
    const recordedOwner = recordedTake?.owner === owner ? recordedTake : null;
    const liveOwner = liveTake?.owner === owner ? liveTake : null;
    const browserOwner = browserTake?.owner === owner ? browserTake : null;
    if (recordedOwner) discardRecordedTake(recordedOwner);
    if (liveOwner) cleanupLiveTake(liveOwner, false);
    if (browserOwner) stopBrowserTake(browserOwner);
    if (shouldResetState && currentOwner === owner) {
      patchState({ status: 'idle', error: null });
      options.render();
    }
  }

  function isOwnerCurrent(owner: InputOwner, identity: object | null = null): boolean {
    if (!isOwnerSelected(owner)) return false;
    if (identity && owner.identity !== identity) return false;
    if (hasOwnerSessionContext(owner)) return true;
    invalidateOwnerForContextMismatch(owner);
    return false;
  }

  function syncOwnerRuntimeEvent(
    owner: InputOwner,
    identity: object | null,
    event: VoiceInputRuntimeEvent,
    eventOptions: VoiceInputRuntimeEventRequest & { render?: boolean } = {},
  ): Promise<void> {
    /* Reset rule for the live re-arm streak: follow the runtime's OWN reset
     * points exactly. applyVoiceInputRuntimeEvent zeroes
     * consecutiveNoSpeechTurns on 'completed' and on 'error'
     * (input-runtime-controller.ts), so the re-arm streak must zero with them —
     * otherwise the combined count the hint guard reads would never fall back
     * after a turn finally landed. This is the single funnel: every runtime
     * event this controller emits goes through here. */
    if (event === 'completed' || event === 'error') liveNoSpeechReArms = 0;
    const epoch = ++owner.eventEpoch;
    return options.syncRuntimeEvent(event, eventOptions, {
      sessionId: owner.sessionId,
      isCurrent: () => isOwnerCurrent(owner, identity) && owner.eventEpoch === epoch,
    });
  }

  function publishOwnerTerminalError(
    owner: InputOwner,
    identity: object | null,
    error: string,
    eventOptions: VoiceInputRuntimeEventRequest & { render?: boolean },
  ): boolean {
    if (owner.terminalErrorPublished) return false;
    if (!isOwnerCurrent(owner, identity)) return false;
    owner.terminalErrorPublished = true;
    owner.phase = 'inactive';
    patchState({ status: 'error', error });
    void syncOwnerRuntimeEvent(owner, identity, 'error', {
      ...eventOptions,
      error,
      render: false,
    });
    options.render();
    return true;
  }

  const isCurrentRecordedTake = (take: RecordedBackendTake): boolean => (
    recordedTake === take && !take.terminal && isOwnerCurrent(take.owner, take)
  );

  const isCurrentLiveTake = (take: BackendLiveTake): boolean => (
    liveTake === take && !take.terminal && isOwnerCurrent(take.owner, take)
  );

  const isCurrentBrowserTake = (take: BrowserRecognitionTake): boolean => (
    browserTake === take
    && browserTake.recognition === take.recognition
    && !take.terminal
    && isOwnerCurrent(take.owner, take)
  );

  function hasBrowserSpeechRecognitionSupport(): boolean {
    return Boolean(getSpeechRecognitionConstructor());
  }

  function stopStream(stream: MediaStream | null): void {
    stream?.getTracks().forEach((track) => track.stop());
  }

  function clearRecordedMonitor(take: RecordedBackendTake): void {
    if (take.monitorTimer != null) {
      window.clearInterval(take.monitorTimer);
      take.monitorTimer = null;
    }
    if (take.monitorSource) {
      take.monitorSource.disconnect();
      take.monitorSource = null;
    }
    if (take.analyser) {
      take.analyser.disconnect();
      take.analyser = null;
    }
    if (take.monitorContext) {
      const context = take.monitorContext;
      take.monitorContext = null;
      void context.close().catch(() => undefined);
    }
  }

  function cleanupRecordedTakeResources(take: RecordedBackendTake): void {
    clearRecordedMonitor(take);
    if (take.stream) {
      const stream = take.stream;
      take.stream = null;
      stopStream(stream);
    }
  }

  function clearRecordedStopWatchdog(take: RecordedBackendTake): void {
    if (take.stopWatchdog != null) {
      window.clearTimeout(take.stopWatchdog);
      take.stopWatchdog = null;
    }
  }

  function detachRecorderHandlers(take: RecordedBackendTake): void {
    if (!take.recorder) return;
    take.recorder.onstart = null;
    take.recorder.ondataavailable = null;
    take.recorder.onerror = null;
    take.recorder.onstop = null;
  }

  function discardRecordedTake(take: RecordedBackendTake): void {
    if (take.terminal) return;
    take.terminal = true;
    take.finalized = true;
    take.stopRequested = true;
    take.stopIntent = false;
    take.chunks = [];
    clearRecordedStopWatchdog(take);
    clearRecordedMonitor(take);
    const recorder = take.recorder;
    detachRecorderHandlers(take);
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.stop();
      } catch {
        // Context invalidation is already terminal; teardown continues below.
      }
    }
    cleanupRecordedTakeResources(take);
    if (recordedTake === take) recordedTake = null;
  }

  function terminateRecordedTake(take: RecordedBackendTake, error: string | null = null): void {
    if (take.terminal) return;
    const shouldPublishError = Boolean(error) && isOwnerCurrent(take.owner, take);
    if (take.terminal) return;
    take.terminal = true;
    take.finalized = true;
    take.chunks = [];
    clearRecordedStopWatchdog(take);
    detachRecorderHandlers(take);
    cleanupRecordedTakeResources(take);
    if (recordedTake === take) recordedTake = null;
    if (!error || !shouldPublishError) return;
    publishOwnerTerminalError(take.owner, take, error, {
      requestedProvider: take.requestedProvider,
      effectiveProvider: 'backend',
      captureProvider: 'backend',
      transcriptSource: 'backend-asr',
      captureStartedAt: take.captureStartedAt,
      speechDetectedAt: take.speakingStartedAt,
      processedAt: Date.now(),
    });
  }

  function stopRecordedTake(take: RecordedBackendTake, finalize = false): void {
    if (take.stopIntent == null) {
      take.stopIntent = finalize;
    }
    if (take.stopRequested) {
      return;
    }
    take.stopRequested = true;
    clearRecordedMonitor(take);
    const recorder = take.recorder;
    if (!recorder) {
      terminateRecordedTake(take);
      return;
    }
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      terminateRecordedTake(take, 'Backend voice capture failed to stop.');
      return;
    }
    if (take.terminal) return;
    take.stopWatchdog = window.setTimeout(() => {
      terminateRecordedTake(take, 'Backend voice capture did not stop cleanly.');
    }, 2_000);
  }

  function cleanupLiveTake(take: BackendLiveTake, sendStop = true): void {
    // Close the optional graph analyzer stream (best-effort, never throws).
    const graphSocket = take.graphSocket;
    take.graphSocket = null;
    if (graphSocket) { try { graphSocket.close(); } catch { /* best-effort */ } }
    take.terminal = true;
    const socket = take.socket;
    take.socket = null;
    if (liveTake === take) {
      liveTake = null;
    }
    if (socket && sendStop && socket.readyState === WebSocket.OPEN) {
      try {
        socket.send(JSON.stringify({
          type: 'stop',
          sessionId: take.sessionId,
          finalize: false,
        }));
      } catch {
        // Ignore stop-send failures during teardown.
      }
    }
    if (take.capture) {
      take.capture.stop();
      take.capture = null;
    }
    if (take.sourceNode) {
      take.sourceNode.disconnect();
      take.sourceNode = null;
    }
    if (take.stream) {
      const stream = take.stream;
      take.stream = null;
      stopStream(stream);
    }
    if (take.audioContext) {
      const context = take.audioContext;
      take.audioContext = null;
      void context.close().catch(() => undefined);
    }
    if (socket) {
      try {
        socket.close();
      } catch {
        // Ignore close failures.
      }
    }
    take.captureStartedAt = null;
    take.liveSessionId = null;
  }

  function getBackendLiveStartupAttempt(take: BackendLiveTake): InputStartupAttempt {
    return {
      captureProvider: 'backend',
      transcriptSource: 'backend-live',
      captureStartedAt: take.captureStartedAt,
    };
  }

  function failBackendLiveTake(take: BackendLiveTake, errorMessage: string): boolean {
    if (!isCurrentLiveTake(take)) return false;
    const attempt = getBackendLiveStartupAttempt(take);
    const rejectStartup = take.rejectStartup;
    if (rejectStartup) {
      rejectStartup(new InputStartupFailure(errorMessage, errorMessage, attempt));
      return true;
    }

    const processedAt = Date.now();
    cleanupLiveTake(take, false);
    publishOwnerTerminalError(take.owner, take, errorMessage, {
      requestedProvider: take.requestedProvider,
      effectiveProvider: 'backend',
      captureProvider: attempt.captureProvider,
      transcriptSource: attempt.transcriptSource,
      captureStartedAt: attempt.captureStartedAt,
      processedAt,
      captureDurationMs: attempt.captureStartedAt
        ? processedAt - attempt.captureStartedAt
        : null,
    });
    return true;
  }

  function stopLiveTake(take: BackendLiveTake, sendStop = true): void {
    take.stoppedManually = true;
    cleanupLiveTake(take, sendStop);
  }

  function stopBrowserTake(take: BrowserRecognitionTake): void {
    if (take.terminal) return;
    take.terminal = true;
    take.stoppedManually = true;
    take.recognition.onresult = null;
    take.recognition.onstart = null;
    take.recognition.onerror = null;
    take.recognition.onend = null;
    if (browserTake === take) {
      browserTake = null;
    }
    try {
      take.recognition.abort();
    } catch {
      // Ignore abort failures during teardown.
    }
  }

  function stopInputResources(resetTranscript: boolean, owner: InputOwner): void {
    const currentState = options.getState();
    const hadActiveInput = isActiveStatus(currentState.status);
    const activeRuntime = options.getRuntimeState();
    const liveOwner = liveTake;
    const recordedOwner = recordedTake;
    const browserOwner = browserTake;
    if (liveOwner) stopLiveTake(liveOwner, false);
    if (recordedOwner) stopRecordedTake(recordedOwner, false);
    if (browserOwner) stopBrowserTake(browserOwner);
    if (!isOwnerSelected(owner)) return;
    if (resetTranscript) {
      patchState({
        finalTranscript: '',
        finalConfidence: null,
        error: null,
      });
    }
    if (currentState.status !== 'unsupported') {
      patchState({ status: 'idle' });
    }
    if (hadActiveInput) {
      void syncOwnerRuntimeEvent(owner, null, 'idle', {
        requestedProvider: owner.requestedProvider,
        effectiveProvider: activeRuntime.effectiveProvider,
        captureProvider: activeRuntime.captureProvider,
        transcriptSource: activeRuntime.transcriptSource,
        processedAt: Date.now(),
        render: false,
      });
    }
  }

  async function stop(resetTranscript = false): Promise<void> {
    const owner = selectOwner('inactive');
    stopInputResources(resetTranscript, owner);
  }

  async function prepareInputStart(owner: InputOwner): Promise<boolean> {
    await options.releasePracticeForListening();
    const ownerCurrentAfterRelease = isOwnerCurrent(owner);
    if (!ownerCurrentAfterRelease) return false;
    // A render can request continuous listening, then yield here while practice
    // teardown completes. If a fresh tutor reply starts during that await, this
    // stale listening intent must yield to speech. Stopping it would abort the
    // selected-voice fetch before the phone hears a response. Playback
    // completion owns the subsequent listening handoff.
    if (options.isCoachSpeechBusy()) {
      reportVoiceInputHandoffYield();
      stopInputResources(true, owner);
      return false;
    }
    options.stopCoachSpeech();
    stopInputResources(true, owner);
    const ownerCurrentAfterCleanup = isOwnerCurrent(owner);
    return ownerCurrentAfterCleanup;
  }

  function handleBackendLiveEnvelope(take: BackendLiveTake, payload: unknown): void {
    if (!isCurrentLiveTake(take)) return;
    const envelope = parseVoiceInputLiveEnvelope(payload);
    if (!envelope) {
      return;
    }
    if (envelope.providers) {
      options.applyInputProviderStatusPayload(envelope);
    }
    if (hasVoiceBackendPayload(envelope)) {
      options.applyVoiceBackendPayload(envelope);
    }

    switch (envelope.event) {
      case 'session-started':
        take.liveSessionId = typeof envelope.liveSessionId === 'string' ? envelope.liveSessionId.trim() : null;
        patchState({
          status: 'idle',
          error: null,
          finalTranscript: '',
          finalConfidence: null,
        });
        break;
      case 'capture-ready': {
        /* The backend re-arms capture after a recoverable outcome and says WHY
         * via `recoveredFrom`. Reading it is what keeps a LOST take honest: an
         * ASR round-trip that found no speech used to arrive here indistinguish-
         * able from a fresh arm, so listening -> Thinking... -> silently back to
         * waiting, with the no-speech accounting below ('no-speech' case) never
         * running on the live path. An unrecognized value behaves as a plain
         * arm. */
        const recoveredFrom = typeof envelope.recoveredFrom === 'string'
          ? envelope.recoveredFrom.trim()
          : '';
        if (recoveredFrom === 'asr-no-speech') {
          /* The take was lost, so it counts toward the calm noise hint — but it
           * counts HERE, in the live re-arm streak, and emits NO runtime
           * no-speech event. The device never stopped listening on this turn, so
           * nothing about it may reach consecutiveNoSpeechTurns and arm the
           * hands-free pause (see the liveNoSpeechReArms note above). The only
           * runtime event this branch produces is the 'waiting' settle below,
           * which re-arms exactly as a plain capture-ready does. */
          liveNoSpeechReArms += 1;
          degenerateTakeHintGuard.onNoSpeechTurn();
        } else if (
          recoveredFrom === 'wordless-practice-ack'
          || recoveredFrom === 'semantic-retry'
        ) {
          /* NOT a failure — nothing was lost, so no streak counter and no
           * noise hint. Surface the acknowledgment only if this build's backend
           * actually sent one. */
          const ackLine = readLiveEnvelopeCoachLine(envelope);
          if (ackLine) {
            /* The thread append always happens: it is the record of the turn,
             * and the fallback when no speech path is available. */
            options.appendCoachLine?.(ackLine);
            /* ...and on a VOICE-FIRST surface it must also be HEARD. Reading an
             * acknowledgment is not being answered: the learner hummed, looked
             * up, and heard nothing, which is exactly the "the tutor stops
             * responding" report this branch exists to fix.
             *
             * Called UNCONDITIONALLY, including while the tutor is speaking —
             * deliberately, and this is the whole subtlety. The never-interrupt
             * rule lives in the host's line channel, and withholding there is
             * not just "return without speaking": the appended line has to be
             * CLAIMED as already-spoken, or the render handoff the append just
             * scheduled picks it up and says it over the tutor anyway. Guarding
             * here would skip the call, and skipping the call skips the claim —
             * so the guard would produce the very interrupt it was written to
             * prevent. One decision, one owner. */
            options.speakCoachLine?.(ackLine);
          }
        }
        patchState({
          status: 'waiting',
          error: null,
          finalTranscript: '',
          finalConfidence: null,
        });
        void syncOwnerRuntimeEvent(take.owner, take, 'waiting', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-live',
          captureStartedAt: take.captureStartedAt,
          render: false,
        });
        break;
      }
      case 'speech-start':
        patchState({
          status: 'listening',
          error: null,
        });
        options.stopCoachSpeech();
        void syncOwnerRuntimeEvent(take.owner, take, 'listening', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-live',
          captureStartedAt: take.captureStartedAt,
          speechDetectedAt: Date.now(),
          render: false,
        });
        break;
      case 'barge-in':
        options.stopCoachSpeech();
        break;
      case 'partial-transcript':
        patchState({ status: 'listening' });
        if (typeof envelope.transcript === 'string') {
          options.setQuestionDraft(envelope.transcript);
          patchState({ finalTranscript: envelope.transcript });
        }
        if (envelope.confidence != null) {
          patchState({ finalConfidence: Number(envelope.confidence) });
        }
        break;
      case 'processing':
        patchState({ status: 'processing' });
        void syncOwnerRuntimeEvent(take.owner, take, 'processing', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-live',
          capturedAt: Date.now(),
          render: false,
        });
        break;
      case 'final-transcript': {
        const segmentId = typeof envelope.segmentId === 'string' ? envelope.segmentId.trim() : '';
        const listeningTurnId = typeof envelope.listeningTurnId === 'string'
          && envelope.listeningTurnId.trim()
          ? envelope.listeningTurnId
          : '';
        const transcript = typeof envelope.transcript === 'string' ? envelope.transcript.trim() : '';
        let pendingAutoSubmit: string | null = null;
        patchState({
          status: 'idle',
          error: null,
          finalTranscript: '',
          finalConfidence: envelope.confidence != null ? Number(envelope.confidence) : null,
        });
        if (envelope.autoSubmit === false) {
          options.clearQuestionFeedback();
        }
        options.setQuestionDraft(envelope.autoSubmit === false ? '' : transcript);
        if (
          envelope.routeError
          && typeof envelope.routeError === 'string'
          && envelope.routeError.trim()
          && !envelope.autoSubmit
        ) {
          options.reportQuestionFeedbackError(envelope.routeError.trim());
        } else if (segmentId && transcript && !take.submittedSegments.has(segmentId)) {
          take.submittedSegments.add(segmentId);
          if (envelope.autoSubmit) {
            pendingAutoSubmit = transcript;
          } else {
            /* Manual send — the learner has to press it. Healthy, but it is a
             * turn with no reply coming, so it is still named. */
            reportVoiceCoachTurnDispatch('info', 'ok', 'coach-turn-skipped-manual');
          }
        } else if (!transcript) {
          reportVoiceCoachTurnDispatch('warn', 'never-received', 'coach-turn-skipped-no-transcript');
        } else {
          /* The same segment already went out once. Before this line, a repeat
           * final-transcript for a segment the client had recorded simply
           * vanished — a real spoken turn with nothing said back and nothing
           * logged on either side of the wire. `segment_present` keeps the row
           * honest if a server ever stops sending segment ids (reviewer
           * finding: an absent id would otherwise wear the wrong label). */
          reportVoiceCoachTurnDispatch('warn', 'never-received', 'coach-turn-skipped-duplicate-segment', {
            segment_present: Boolean(segmentId),
          });
        }
        void syncOwnerRuntimeEvent(take.owner, take, 'completed', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-live',
          transcript,
          confidence: envelope.confidence != null ? Number(envelope.confidence) : null,
          processedAt: Date.now(),
          render: false,
        });
        if (pendingAutoSubmit) {
          /* The CLIENT end of the transcript -> coach-reply crossing. Its pair
           * is the gateway's `coach_turn_request accepted`; this line without
           * that one names the dead crossing on sight. */
          reportVoiceCoachTurnDispatch('info', 'ok', 'coach-turn-dispatched');
          const submit = listeningTurnId
            ? options.handleCapturedQuestion(pendingAutoSubmit, { listeningTurnId })
            : options.handleCapturedQuestion(pendingAutoSubmit);
          void submit.catch((error) => {
            reportBackendException({
              operation: 'Submit captured voice turn to coach',
              error,
              source: 'voice-coach-runtime',
              method: 'POST',
              kind: 'runtime',
            });
            if (isCurrentLiveTake(take)) options.render();
          });
        }
        break;
      }
      case 'no-speech':
        patchState({
          status: 'idle',
          error: null,
        });
        void syncOwnerRuntimeEvent(take.owner, take, 'no-speech', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-live',
          processedAt: Date.now(),
          render: false,
        });
        degenerateTakeHintGuard.onNoSpeechTurn();
        break;
      case 'error': {
        const errorMessage = typeof envelope.error === 'string' && envelope.error.trim()
          ? envelope.error.trim()
          : 'Backend live voice input failed.';
        const envelopeCode = (envelope as Record<string, unknown>).code;
        if (envelopeCode === 'pcm-timeout') {
          reportVoiceInputCaptureTelemetry(
            'warn',
            'partial-function',
            take.capture?.mode === 'worklet' ? 'worklet-no-pcm' : 'script-processor-no-pcm',
          );
        }
        failBackendLiveTake(take, errorMessage);
        return;
      }
      default:
        break;
    }
    options.render();
  }

  async function submitTranscriptTurn(
    sessionId: string,
    transcript: string,
    input: Omit<Extract<VoiceInputTurnRequest, { transcript: string }>, 'requestedProvider' | 'transcript'>,
    requestedProvider: VoiceCoachInputProvider,
    owner: InputOwner,
    identity: object,
  ): Promise<string> {
    const normalizedTranscript = transcript.trim();
    if (!normalizedTranscript) {
      return '';
    }
    const data = await options.submitInputTurn(sessionId, {
      ...input,
      requestedProvider,
      transcript: normalizedTranscript,
    });
    if (isOwnerCurrent(owner, identity)) {
      options.applyInputProviderStatusPayload(data);
      options.applyVoiceBackendPayload(data);
    }
    return typeof data.inputTurn?.transcript === 'string' && data.inputTurn.transcript.trim()
      ? data.inputTurn.transcript.trim()
      : normalizedTranscript;
  }

  async function submitAudioTurn(
    sessionId: string,
    audioBlob: Blob,
    input: Omit<Extract<VoiceInputTurnRequest, { audioBlob: Blob }>, 'requestedProvider' | 'audioBlob'>,
    requestedProvider: VoiceCoachInputProvider,
    owner: InputOwner,
    identity: object,
  ): Promise<string> {
    if (audioBlob.size <= 0) {
      return '';
    }
    const data = await options.submitInputTurn(sessionId, {
      ...input,
      requestedProvider,
      audioBlob,
    });
    if (isOwnerCurrent(owner, identity)) {
      options.applyInputProviderStatusPayload(data);
      options.applyVoiceBackendPayload(data);
    }
    if (data.inputTurn?.outcome === 'no-speech') {
      return '';
    }
    const transcript = typeof data.inputTurn?.transcript === 'string' ? data.inputTurn.transcript.trim() : '';
    if (!transcript) {
      throw new Error('Backend voice input returned no transcript.');
    }
    return transcript;
  }

  async function startBackendLiveCapture(owner: InputOwner): Promise<boolean> {
    if (!owner.sessionId || !owner.isConnected) {
      throw new Error('Connect the session before using backend live voice input.');
    }

    if (!await prepareInputStart(owner)) return false;

    const take: BackendLiveTake = {
      owner,
      generation: owner.generation,
      sessionId: owner.sessionId,
      requestedProvider: owner.requestedProvider,
      stream: null,
      socket: null,
      audioContext: null,
      sourceNode: null,
      capture: null,
      captureStartedAt: null,
      liveSessionId: null,
      stoppedManually: false,
      submittedSegments: new Set<string>(),
      firstPcmProduced: false,
      terminal: false,
      rejectStartup: null,
    };
    owner.identity = take;
    liveTake = take;

    const requestedDeviceId = options.getSelectedInputDeviceId();
    const deviceId = requestedDeviceId && requestedDeviceId !== 'default' ? requestedDeviceId : null;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(getVoiceCoachInputConstraints(deviceId));
    } catch (error) {
      cleanupLiveTake(take, false);
      if (!isOwnerSelected(owner)) return false;
      throw error;
    }
    logConversationStreamAcquisition('backend-live');
    if (!isCurrentLiveTake(take)) {
      stopStream(stream);
      return false;
    }
    take.stream = stream;
    const audioTrack = stream.getAudioTracks()[0] || null;
    options.updateResolvedInput(
      audioTrack?.label?.trim() || null,
      audioTrack?.getSettings?.().deviceId || deviceId || requestedDeviceId,
    );

    let resolveFirstPcmProduced: (() => void) | null = null;
    const firstPcmProduced = new Promise<void>((resolve) => {
      resolveFirstPcmProduced = resolve;
    });
    const forwardPcmFrame = (frame: ArrayBuffer) => {
      const socket = take.socket;
      if (!isCurrentLiveTake(take) || !socket || socket.readyState !== WebSocket.OPEN) {
        return;
      }
      if (!take.firstPcmProduced) {
        take.firstPcmProduced = true;
        resolveFirstPcmProduced?.();
        resolveFirstPcmProduced = null;
        reportVoiceInputCaptureTelemetry(
          'info',
          'ok',
          take.capture?.mode === 'worklet' ? 'worklet-first-pcm' : 'script-processor-first-pcm',
        );
      }
      try {
        socket.send(frame);
      } catch (error) {
        if (!isCurrentLiveTake(take)) return;
        reportBackendException({
          operation: 'Send backend live voice input frame',
          error,
          source: getBackendLiveInputUrl(),
          method: 'GET',
          kind: 'websocket',
        });
        failBackendLiveTake(take, 'Backend live voice input frame failed.');
      }
      // Graph live-frame fan-out (review fix 2026-08-05): AFTER the ASR send so a
      // graph fault can never preempt a speech frame; gated on OPEN so a still-
      // CONNECTING socket is not buffered against. Best-effort; never throws.
      const graphSocket = take.graphSocket;
      if (graphSocket && graphSocket.readyState === WebSocket.OPEN) {
        try { graphSocket.send(frame); } catch { /* graph is best-effort */ }
      }
    };
    const createLiveCapture = (preferWorklet: boolean) => createPcm16Capture({
      audioContext: take.audioContext as AudioContext,
      sourceNode: take.sourceNode as MediaStreamAudioSourceNode,
      outputSampleRate: 16000,
      frameSize: 1024,
      preferWorklet,
      onFrame: forwardPcmFrame,
    });

    try {
      const audioContext = createVoiceAudioContext();
      take.audioContext = audioContext;
      if (audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      if (!isCurrentLiveTake(take)) {
        cleanupLiveTake(take, false);
        return false;
      }
      const sourceNode = audioContext.createMediaStreamSource(stream);
      take.sourceNode = sourceNode;
      take.capture = await createLiveCapture(options.getAudioPreferWorklet?.() !== false);
    } catch (error) {
      cleanupLiveTake(take, false);
      if (!isOwnerSelected(owner)) return false;
      throw error;
    }
    if (!isCurrentLiveTake(take)) {
      cleanupLiveTake(take, false);
      return false;
    }
    take.captureStartedAt = Date.now();
    patchState({
      status: 'idle',
      error: null,
      finalTranscript: '',
      finalConfidence: null,
    });
    options.render();

    try {
      return await new Promise<boolean>((resolve, reject) => {
        let settled = false;
        let captureStarted = false;
        let sessionAccepted = false;
        let captureReady = false;
        let captureReadyTimer: number | null = null;
        const socket = new WebSocket(getBackendLiveInputUrl());
        socket.binaryType = 'arraybuffer';
        take.socket = socket;
        // Open the optional graph analyzer stream (best-effort, fire-and-forget
        // so it never delays capture or perturbs the ASR feed). Reuses the SAME
        // mic capture (fan-out in forwardPcmFrame) -> no second getUserMedia.
        if (typeof options.createGraphStream === 'function') {
          void Promise.resolve(options.createGraphStream()).then((graphUrl) => {
            if (!graphUrl || !isCurrentLiveTake(take)) return;
            try {
              const graphSocket = new WebSocket(graphUrl);
              graphSocket.binaryType = 'arraybuffer';
              graphSocket.addEventListener('message', (event) => {
                try { options.setVoiceLiveFrame?.(JSON.parse(String(event.data))); }
                catch { /* malformed frame: speech continues */ }
              });
              take.graphSocket = graphSocket;
            } catch { /* graph stream is best-effort */ }
          }).catch(() => { /* graph is best-effort */ });
        }

        const clearCaptureReadyTimer = () => {
          if (captureReadyTimer === null) return;
          window.clearTimeout(captureReadyTimer);
          captureReadyTimer = null;
        };

        const settleStaleStartup = () => {
          clearCaptureReadyTimer();
          cleanupLiveTake(take, false);
          if (!settled) {
            settled = true;
            take.rejectStartup = null;
            resolve(false);
          }
        };

        const cleanupOpenFailure = (error: Error) => {
          if (settled) return;
          clearCaptureReadyTimer();
          if (!isCurrentLiveTake(take)) {
            settleStaleStartup();
            return;
          }
          const failure = error instanceof InputStartupFailure
            ? error
            : new InputStartupFailure(
                getErrorMessage(error, 'Backend live voice input failed to start.'),
                getErrorMessage(error, 'Backend live voice input failed to start.'),
                getBackendLiveStartupAttempt(take),
              );
          settled = true;
          take.rejectStartup = null;
          cleanupLiveTake(take, false);
          reject(failure);
        };
        take.rejectStartup = cleanupOpenFailure;

        const settleReady = () => {
          if (settled || !captureStarted || !sessionAccepted || !captureReady) return;
          if (!isCurrentLiveTake(take)) {
            settleStaleStartup();
            return;
          }
          clearCaptureReadyTimer();
          settled = true;
          take.rejectStartup = null;
          resolve(true);
        };

        socket.addEventListener('open', () => {
          if (settled) return;
          if (!isCurrentLiveTake(take)) {
            settleStaleStartup();
            return;
          }
          const vadConfig = options.getBackendLiveVadConfig?.() ?? {};
          // Product policy is deliberately not a caller-tunable VAD knob. The
          // semantic endpoint may decide at 1.8 s; the amplitude-only fallback
          // must always leave a careful learner the full 4.5 s pause window.
          const silenceHoldMs = 4500;
          const noSpeechTimeoutMs = typeof vadConfig.noSpeechTimeoutMs === 'number' ? vadConfig.noSpeechTimeoutMs : 12000;
          const minSpeechMs = 150;
          const bearerToken = options.getBackendLiveBearerToken?.();
          const normalizedBearerToken = typeof bearerToken === 'string' ? bearerToken.trim() : '';
          const extraVadConfigEntries = Object.entries(vadConfig).filter(([key, value]) => (
            value !== undefined
            && !['silenceHoldMs', 'noSpeechTimeoutMs', 'minSpeechMs'].includes(key)
          ));
          const extraVadConfig = Object.fromEntries(extraVadConfigEntries);

          try {
            socket.send(JSON.stringify({
              type: 'open',
              sessionId: take.sessionId,
              liveInputLeaseId: options.getBackendLiveLeaseId?.() ?? null,
              ...(normalizedBearerToken ? { bearerToken: normalizedBearerToken } : {}),
              sampleRate: 16000,
              rmsThreshold: options.getSilenceThreshold(),
              silenceHoldMs,
              noSpeechTimeoutMs,
              minSpeechMs,
              ...extraVadConfig,
            }));
          } catch (error) {
            cleanupOpenFailure(error instanceof Error ? error : new Error(String(error)));
            return;
          }

          const startCaptureWithFirstFrameRecovery = async () => {
            const initialCapture = take.capture;
            if (!initialCapture) {
              throw new Error('Backend live voice capture was unavailable.');
            }
            const waitForFirstPcm = async (capture: Pcm16CaptureHandle): Promise<boolean> => {
              if (take.firstPcmProduced) return true;
              let firstFrameTimer: number | null = null;
              await Promise.race([
                firstPcmProduced,
                owner.cancelled,
                new Promise<void>((resolve) => {
                  firstFrameTimer = window.setTimeout(resolve, 1_000);
                }),
              ]);
              if (firstFrameTimer !== null) {
                window.clearTimeout(firstFrameTimer);
              }
              if (take.firstPcmProduced) return true;
              if (!isCurrentLiveTake(take) || take.capture !== capture) return false;
              reportVoiceInputCaptureTelemetry(
                'warn',
                'partial-function',
                capture.mode === 'worklet' ? 'worklet-no-pcm' : 'script-processor-no-pcm',
              );
              return false;
            };

            await initialCapture.start();
            reportVoiceInputCaptureTelemetry(
              'info',
              'ok',
              initialCapture.mode === 'worklet'
                ? 'worklet-capture-started'
                : 'script-processor-capture-started',
            );
            if (take.audioContext?.state !== 'running') {
              reportVoiceInputCaptureTelemetry(
                'warn',
                'partial-function',
                'audio-context-not-running',
              );
            }
            if (await waitForFirstPcm(initialCapture)) {
              return;
            }
            if (!isCurrentLiveTake(take) || take.capture !== initialCapture) {
              return;
            }
            if (initialCapture.mode !== 'worklet') {
              throw new InputStartupFailure(
                'Microphone audio did not begin.',
                'Microphone audio did not begin.',
                getBackendLiveStartupAttempt(take),
              );
            }
            initialCapture.stop();
            const fallbackCapture = await createLiveCapture(false);
            if (!isCurrentLiveTake(take)) {
              fallbackCapture.stop();
              return;
            }
            take.capture = fallbackCapture;
            await fallbackCapture.start();
            reportVoiceInputCaptureTelemetry(
              'info',
              'ok',
              'script-processor-capture-started',
            );
            if (!await waitForFirstPcm(fallbackCapture) && isCurrentLiveTake(take)) {
              throw new InputStartupFailure(
                'Microphone audio did not begin.',
                'Microphone audio did not begin.',
                getBackendLiveStartupAttempt(take),
              );
            }
          };

          startCaptureWithFirstFrameRecovery()
            .then(() => {
              if (settled) return;
              if (!isCurrentLiveTake(take)) {
                settleStaleStartup();
                return;
              }
              captureStarted = true;
              captureReadyTimer = window.setTimeout(() => {
                cleanupOpenFailure(new InputStartupFailure(
                  'Microphone audio did not begin.',
                  'Microphone audio did not begin.',
                  getBackendLiveStartupAttempt(take),
                ));
              }, 3500);
              settleReady();
            })
            .catch((error) => {
              cleanupOpenFailure(error instanceof Error ? error : new Error(String(error)));
            });
        });

        socket.addEventListener('message', (event) => {
          if (!isCurrentLiveTake(take)) return;
          try {
            const envelope = JSON.parse(String(event.data));
            handleBackendLiveEnvelope(take, envelope);
            if (envelope?.event === 'session-started') {
              sessionAccepted = true;
              settleReady();
            }
            if (envelope?.event === 'capture-ready') {
              captureReady = true;
              settleReady();
            }
          } catch (error) {
            if (!isCurrentLiveTake(take)) {
              return;
            }
            reportBackendException({
              operation: 'Parse backend live voice input event',
              error,
              source: getBackendLiveInputUrl(),
              method: 'GET',
              kind: 'websocket',
            });
            console.warn('[Voice] Failed to parse backend live input event:', error);
          }
        });

        socket.addEventListener('error', () => {
          if (!isCurrentLiveTake(take)) {
            settleStaleStartup();
            return;
          }
          pushBackendDiagnostic({
            kind: 'websocket',
            operation: 'Backend live voice input error',
            message: 'Backend live voice socket failed.',
            source: getBackendLiveInputUrl(),
            method: 'GET',
          });
          failBackendLiveTake(take, 'Backend live voice socket failed.');
        });

        socket.addEventListener('close', () => {
          if (take.terminal || take.stoppedManually) return;
          if (!isCurrentLiveTake(take)) {
            settleStaleStartup();
            return;
          }
          pushBackendDiagnostic({
            kind: 'websocket',
            operation: 'Backend live voice input closed',
            message: 'Backend live voice input disconnected.',
            source: getBackendLiveInputUrl(),
            method: 'GET',
          });
          failBackendLiveTake(take, 'Backend live voice input disconnected.');
        });
        owner.abortController.signal.addEventListener('abort', () => {
          if (settled) return;
          clearCaptureReadyTimer();
          settled = true;
          take.rejectStartup = null;
          cleanupLiveTake(take, false);
          resolve(false);
        }, { once: true });
      });
    } catch (error) {
      const failure = error instanceof InputStartupFailure
        ? error
        : new InputStartupFailure(
            getErrorMessage(error, 'Backend live voice input failed to start.'),
            getErrorMessage(error, 'Backend live voice input failed to start.'),
            getBackendLiveStartupAttempt(take),
          );
      cleanupLiveTake(take, false);
      if (!isOwnerSelected(owner)) return false;
      throw failure;
    }
  }

  async function finalizeRecordedTake(take: RecordedBackendTake): Promise<void> {
    if (take.finalized || take.terminal) return;
    take.finalized = true;
    take.terminal = true;
    clearRecordedStopWatchdog(take);
    const shouldFinalize = take.stopIntent === true;
    const chunks = [...take.chunks];
    take.chunks = [];
    const mimeType = take.recorder?.mimeType || 'audio/webm';
    const hadDetectedSpeech = Boolean(take.speakingStartedAt);
    const captureStartedAt = take.captureStartedAt;
    const speechDetectedAt = take.speakingStartedAt;
    const stoppedAt = Date.now();
    detachRecorderHandlers(take);
    cleanupRecordedTakeResources(take);
    if (recordedTake === take) recordedTake = null;

    if (!shouldFinalize) {
      if (!isOwnerCurrent(take.owner, take)) return;
      patchState({ status: 'idle', error: null });
      if (!hadDetectedSpeech && captureStartedAt && stoppedAt - captureStartedAt >= 11000) {
        void syncOwnerRuntimeEvent(take.owner, take, 'no-speech', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-asr',
          captureStartedAt,
          processedAt: stoppedAt,
          captureDurationMs: stoppedAt - captureStartedAt,
          render: false,
        });
        degenerateTakeHintGuard.onNoSpeechTurn();
      } else {
        void syncOwnerRuntimeEvent(take.owner, take, 'idle', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-asr',
          processedAt: stoppedAt,
          render: false,
        });
      }
      options.render();
      return;
    }

    if (!hadDetectedSpeech) {
      if (!isOwnerCurrent(take.owner, take)) return;
      patchState({ status: 'idle', error: null });
      void syncOwnerRuntimeEvent(take.owner, take, 'no-speech', {
        requestedProvider: take.requestedProvider,
        effectiveProvider: 'backend',
        captureProvider: 'backend',
        transcriptSource: 'backend-asr',
        captureStartedAt,
        processedAt: stoppedAt,
        captureDurationMs: captureStartedAt ? stoppedAt - captureStartedAt : null,
        render: false,
      });
      degenerateTakeHintGuard.onNoSpeechTurn();
      options.render();
      return;
    }

    const audioBlob = new Blob(chunks, { type: mimeType });
    if (audioBlob.size <= 0) {
      if (!isOwnerCurrent(take.owner, take)) return;
      patchState({ status: 'idle', error: null });
      void syncOwnerRuntimeEvent(take.owner, take, 'error', {
        requestedProvider: take.requestedProvider,
        effectiveProvider: 'backend',
        captureProvider: 'backend',
        transcriptSource: 'backend-asr',
        captureStartedAt,
        speechDetectedAt,
        processedAt: stoppedAt,
        captureDurationMs: captureStartedAt ? stoppedAt - captureStartedAt : null,
        error: 'Backend voice input captured no audio.',
        render: false,
      });
      options.render();
      return;
    }

    if (!take.sessionId || !take.isConnected) {
      if (!isOwnerCurrent(take.owner, take)) return;
      patchState({
        status: 'error',
        error: 'Connect the session before sending backend voice input.',
      });
      options.render();
      return;
    }

    if (isOwnerCurrent(take.owner, take)) {
      patchState({ status: 'processing' });
      void syncOwnerRuntimeEvent(take.owner, take, 'processing', {
        requestedProvider: take.requestedProvider,
        effectiveProvider: 'backend',
        captureProvider: 'backend',
        transcriptSource: 'backend-asr',
        captureStartedAt,
        speechDetectedAt,
        capturedAt: stoppedAt,
        captureDurationMs: captureStartedAt ? stoppedAt - captureStartedAt : null,
        render: false,
      });
      options.render();
    }

    void submitAudioTurn(take.sessionId, audioBlob, {
      captureProvider: 'backend',
      filename: `voice-turn.${mimeType.includes('ogg') ? 'ogg' : mimeType.includes('wav') ? 'wav' : 'webm'}`,
      captureStartedAt,
      speechDetectedAt,
      capturedAt: stoppedAt,
      transcriptSource: 'backend-asr',
    }, take.requestedProvider, take.owner, take).then((normalizedTranscript) => {
      if (!isOwnerCurrent(take.owner, take)) {
        /* A resolved transcript whose take was superseded is DROPPED here by
         * design — but dropped is still a decline on the transcript -> coach
         * crossing, and an unwitnessed one is indistinguishable from the
         * live silent-turn fault. (Reviewer finding, 2026-07-27.) */
        if (normalizedTranscript) {
          reportVoiceCoachTurnDispatch('warn', 'never-received', 'coach-turn-declined-owner-superseded');
        }
        return;
      }
      if (!normalizedTranscript) {
        patchState({ status: 'idle', error: null, finalTranscript: '' });
        void syncOwnerRuntimeEvent(take.owner, take, 'no-speech', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'backend',
          captureProvider: 'backend',
          transcriptSource: 'backend-asr',
          captureStartedAt,
          speechDetectedAt,
          capturedAt: stoppedAt,
          processedAt: Date.now(),
          captureDurationMs: captureStartedAt ? stoppedAt - captureStartedAt : null,
          render: false,
        });
        degenerateTakeHintGuard.onNoSpeechTurn();
        options.render();
        return;
      }
      patchState({ status: 'idle', finalTranscript: '' });
      /* The healthy beacon, recorded-ASR lane — its pair is the gateway's
       * `coach_turn_request accepted`, same as the live lane's emission. */
      reportVoiceCoachTurnDispatch('info', 'ok', 'coach-turn-dispatched');
      return options.handleCapturedQuestion(normalizedTranscript);
    }).catch((error) => {
      if (!isOwnerCurrent(take.owner, take)) return;
      patchState({ status: 'error', error: (error as Error).message });
      void syncOwnerRuntimeEvent(take.owner, take, 'error', {
        requestedProvider: take.requestedProvider,
        effectiveProvider: 'backend',
        captureProvider: 'backend',
        transcriptSource: 'backend-asr',
        captureStartedAt,
        speechDetectedAt,
        capturedAt: stoppedAt,
        processedAt: Date.now(),
        captureDurationMs: captureStartedAt ? stoppedAt - captureStartedAt : null,
        error: (error as Error).message,
        render: false,
      });
      options.render();
    });
  }

  async function startRecordedBackendCapture(owner: InputOwner): Promise<boolean> {
    if (!await prepareInputStart(owner)) return false;
    const take: RecordedBackendTake = {
      owner,
      generation: owner.generation,
      sessionId: owner.sessionId,
      isConnected: owner.isConnected,
      requestedProvider: owner.requestedProvider,
      recorder: null,
      stream: null,
      chunks: [],
      speakingStartedAt: null,
      lastVoiceAt: null,
      captureStartedAt: null,
      stopIntent: null,
      stopRequested: false,
      finalized: false,
      terminal: false,
      stopWatchdog: null,
      analyser: null,
      monitorContext: null,
      monitorSource: null,
      monitorTimer: null,
    };
    owner.identity = take;
    recordedTake = take;

    const requestedDeviceId = options.getSelectedInputDeviceId();
    const deviceId = requestedDeviceId && requestedDeviceId !== 'default' ? requestedDeviceId : null;
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia(getVoiceCoachInputConstraints(deviceId));
    } catch (error) {
      if (recordedTake === take) recordedTake = null;
      take.finalized = true;
      take.terminal = true;
      if (!isOwnerSelected(owner)) return false;
      throw error;
    }
    logConversationStreamAcquisition('recorded-fallback');
    if (!isCurrentRecordedTake(take)) {
      stopStream(stream);
      return false;
    }
    take.stream = stream;
    const audioTrack = stream.getAudioTracks()[0] || null;
    options.updateResolvedInput(
      audioTrack?.label?.trim() || null,
      audioTrack?.getSettings?.().deviceId || deviceId || requestedDeviceId,
    );

    const recorderMimeType = resolveRecorderMimeType();
    let recorder: MediaRecorder;
    try {
      recorder = recorderMimeType
        ? new MediaRecorder(stream, { mimeType: recorderMimeType })
        : new MediaRecorder(stream);
    } catch (error) {
      const failure = new InputStartupFailure(
        getErrorMessage(error, 'Backend voice capture failed to start.'),
        'Backend voice capture failed to start.',
        {
          captureProvider: 'backend',
          transcriptSource: 'backend-asr',
          captureStartedAt: take.captureStartedAt,
        },
      );
      discardRecordedTake(take);
      throw failure;
    }
    take.recorder = recorder;
    patchState({
      status: 'waiting',
      error: null,
      finalTranscript: '',
      finalConfidence: null,
    });

    try {
      take.monitorContext = createVoiceAudioContext();
      take.monitorSource = take.monitorContext.createMediaStreamSource(stream);
      take.analyser = take.monitorContext.createAnalyser();
      take.analyser.fftSize = 2048;
      take.monitorSource.connect(take.analyser);
      const samples = new Float32Array(take.analyser.fftSize);
      take.monitorTimer = window.setInterval(() => {
        const analyser = take.analyser;
        if (!isCurrentRecordedTake(take) || !analyser) return;
        const vadConfig = options.getBackendLiveVadConfig?.() ?? {};
        // Keep recorded fallback behaviour identical to the live endpoint's
        // conservative path even when a stale persisted panel says otherwise.
        const silenceHoldMs = 4500;
        const noSpeechTimeoutMs = typeof vadConfig.noSpeechTimeoutMs === 'number' ? vadConfig.noSpeechTimeoutMs : 12000;
        const minSpeechMs = 150;
        analyser.getFloatTimeDomainData(samples);
        let sumSquares = 0;
        for (const sample of samples) sumSquares += sample * sample;
        const rms = Math.sqrt(sumSquares / samples.length);
        const now = Date.now();
        if (rms >= options.getSilenceThreshold()) {
          if (!take.speakingStartedAt && options.getState().status !== 'listening') {
            patchState({ status: 'listening' });
            void syncOwnerRuntimeEvent(owner, take, 'listening', {
              requestedProvider: take.requestedProvider,
              effectiveProvider: 'backend',
              captureProvider: 'backend',
              transcriptSource: 'backend-asr',
              captureStartedAt: take.captureStartedAt,
              speechDetectedAt: now,
              render: false,
            });
            options.render();
          }
          take.speakingStartedAt = take.speakingStartedAt ?? now;
          take.lastVoiceAt = now;
        }

        if (
          take.speakingStartedAt
          && take.lastVoiceAt
          && now - take.speakingStartedAt >= minSpeechMs
          && now - take.lastVoiceAt >= silenceHoldMs
        ) {
          stopRecordedTake(take, true);
        } else if (
          !take.speakingStartedAt
          && take.captureStartedAt
          && now - take.captureStartedAt >= noSpeechTimeoutMs
        ) {
          stopRecordedTake(take, false);
        }
      }, 100);
    } catch {
      clearRecordedMonitor(take);
    }

    recorder.ondataavailable = (event) => {
      if (!take.finalized && event.data && event.data.size > 0) {
        take.chunks.push(event.data);
      }
    };
    recorder.onstop = () => {
      void finalizeRecordedTake(take);
    };

    let startupSettled = false;
    let startupTimeout: number | null = null;
    let resolveStartup!: (started: boolean) => void;
    let rejectStartup!: (error: Error) => void;
    const startup = new Promise<boolean>((resolve, reject) => {
      resolveStartup = resolve;
      rejectStartup = reject;
    });
    const clearStartupWait = () => {
      if (startupTimeout != null) {
        window.clearTimeout(startupTimeout);
        startupTimeout = null;
      }
      owner.abortController.signal.removeEventListener('abort', handleStartupAbort);
    };
    const settleStartup = (started: boolean) => {
      if (startupSettled) return;
      startupSettled = true;
      clearStartupWait();
      resolveStartup(started);
    };
    const failStartup = (error: Error) => {
      if (startupSettled) return;
      startupSettled = true;
      clearStartupWait();
      rejectStartup(error);
    };
    function handleStartupAbort() {
      recorder.onstart = null;
      settleStartup(false);
    }
    owner.abortController.signal.addEventListener('abort', handleStartupAbort, { once: true });
    recorder.onstart = () => {
      if (!isCurrentRecordedTake(take)) {
        settleStartup(false);
        return;
      }
      take.captureStartedAt = Date.now();
      void syncOwnerRuntimeEvent(owner, take, 'waiting', {
        requestedProvider: take.requestedProvider,
        effectiveProvider: 'backend',
        captureProvider: 'backend',
        transcriptSource: 'backend-asr',
        captureStartedAt: take.captureStartedAt,
        render: false,
      });
      options.render();
      settleStartup(true);
    };
    recorder.onerror = () => {
      if (!startupSettled) {
        failStartup(new InputStartupFailure(
          'Backend voice capture failed to start.',
          'Backend voice capture failed to start.',
          {
            captureProvider: 'backend',
            transcriptSource: 'backend-asr',
            captureStartedAt: take.captureStartedAt,
          },
        ));
        return;
      }
      if (take.finalized || take.terminal) return;
      terminateRecordedTake(take, 'Backend voice capture failed.');
    };

    try {
      recorder.start();
      startupTimeout = window.setTimeout(() => {
        failStartup(new InputStartupFailure(
          'Backend voice capture did not open.',
          'Backend voice capture did not open.',
          {
            captureProvider: 'backend',
            transcriptSource: 'backend-asr',
            captureStartedAt: take.captureStartedAt,
          },
        ));
      }, 4_000);
      const started = await startup;
      if (!started) return false;
    } catch (error) {
      startupSettled = true;
      clearStartupWait();
      const failure = new InputStartupFailure(
        getErrorMessage(error, 'Backend voice capture failed to start.'),
        'Backend voice capture failed to start.',
        {
          captureProvider: 'backend',
          transcriptSource: 'backend-asr',
          captureStartedAt: take.captureStartedAt,
        },
      );
      discardRecordedTake(take);
      throw failure;
    }
    if (isCurrentRecordedTake(take)) options.render();
    return isCurrentRecordedTake(take);
  }

  async function startBrowserSpeechRecognition(owner: InputOwner): Promise<boolean> {
    const SpeechRecognitionCtor = getSpeechRecognitionConstructor();
    if (!SpeechRecognitionCtor) {
      if (isOwnerSelected(owner)) {
        patchState({
          status: 'unsupported',
          error: 'This browser does not expose speech recognition.',
        });
        options.render();
      }
      return false;
    }

    if (!await prepareInputStart(owner)) return false;

    const recognitionInstance = new SpeechRecognitionCtor();
    const requestedProvider = owner.requestedProvider;
    const take: BrowserRecognitionTake = {
      owner,
      generation: owner.generation,
      requestedProvider,
      sessionId: owner.sessionId,
      isConnected: owner.isConnected,
      recognition: recognitionInstance,
      startedAt: Date.now(),
      speechDetectedAt: null,
      capturedAt: null,
      finalTranscript: '',
      finalConfidence: null,
      transcriptSource: requestedProvider === 'backend'
      ? 'browser-fallback'
      : 'browser-speech-recognition',
      stoppedManually: false,
      failed: false,
      terminal: false,
    };
    owner.identity = take;
    browserTake = take;
    patchState({
      status: 'waiting',
      finalTranscript: '',
      finalConfidence: null,
      error: null,
    });

    recognitionInstance.continuous = false;
    recognitionInstance.interimResults = true;
    recognitionInstance.lang = 'en-US';
    recognitionInstance.onstart = () => {
      if (!isCurrentBrowserTake(take)) return;
      patchState({
        status: 'waiting',
        error: null,
      });
      void syncOwnerRuntimeEvent(owner, take, 'waiting', {
        requestedProvider: take.requestedProvider,
        effectiveProvider: 'browser',
        captureProvider: 'browser',
        transcriptSource: take.transcriptSource,
        captureStartedAt: take.startedAt,
        render: false,
      });
      options.render();
    };
    recognitionInstance.onresult = (event) => {
      if (!isCurrentBrowserTake(take)) return;
      let interimTranscript = '';
      let finalTranscript = '';
      const hadSpeechEvidence = take.speechDetectedAt != null;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = Array.from({ length: result.length })
          .map((_, alternativeIndex) => result[alternativeIndex]?.transcript || '')
          .join(' ')
          .trim();
        if (!transcript) continue;
        take.speechDetectedAt = take.speechDetectedAt ?? Date.now();
        if (result.isFinal) {
          finalTranscript = `${finalTranscript} ${transcript}`.trim();
        } else {
          interimTranscript = `${interimTranscript} ${transcript}`.trim();
        }
      }

      if (!hadSpeechEvidence && take.speechDetectedAt != null) {
        patchState({ status: 'listening', error: null });
        void syncOwnerRuntimeEvent(owner, take, 'listening', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'browser',
          captureProvider: 'browser',
          transcriptSource: take.transcriptSource,
          captureStartedAt: take.startedAt,
          speechDetectedAt: take.speechDetectedAt,
          render: false,
        });
      }

      options.setQuestionDraft(finalTranscript || interimTranscript);
      if (finalTranscript) {
        const finalConfidenceValues = Array.from(
          { length: event.results.length - event.resultIndex },
          (_, offset) => event.results[event.resultIndex + offset],
        )
          .filter((result) => Boolean(result?.isFinal))
          .map((result) => Number(result?.[0]?.confidence))
          .filter((value) => Number.isFinite(value));
        const finalConfidence = finalConfidenceValues.length > 0
          ? finalConfidenceValues.reduce((sum, value) => sum + value, 0) / finalConfidenceValues.length
          : null;
        take.finalTranscript = finalTranscript;
        take.finalConfidence = finalConfidence;
        patchState({
          finalTranscript,
          finalConfidence,
          status: 'processing',
        });
        take.capturedAt = Date.now();
        void syncOwnerRuntimeEvent(owner, take, 'processing', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'browser',
          captureProvider: 'browser',
          transcriptSource: take.transcriptSource,
          captureStartedAt: take.startedAt,
          speechDetectedAt: take.speechDetectedAt ?? take.capturedAt,
          capturedAt: take.capturedAt,
          transcript: finalTranscript,
          confidence: finalConfidence,
          captureDurationMs: take.capturedAt - take.startedAt,
          render: false,
        });
        options.render();
      }
    };
    recognitionInstance.onerror = (event) => {
      if (!isCurrentBrowserTake(take)) return;
      const errorMessage = event.error || event.message || 'Speech recognition failed.';
      take.failed = true;
      stopBrowserTake(take);
      patchState({
        error: errorMessage,
        status: 'error',
      });
      void syncOwnerRuntimeEvent(owner, take, 'error', {
        requestedProvider: take.requestedProvider,
        effectiveProvider: 'browser',
        captureProvider: 'browser',
        transcriptSource: take.transcriptSource,
        captureStartedAt: take.startedAt,
        speechDetectedAt: take.speechDetectedAt,
        capturedAt: take.capturedAt,
        processedAt: Date.now(),
        captureDurationMs: take.capturedAt != null
          ? take.capturedAt - take.startedAt
          : null,
        error: errorMessage,
        render: false,
      });
      options.render();
    };
    recognitionInstance.onend = () => {
      if (!isCurrentBrowserTake(take)) return;
      take.terminal = true;
      recognitionInstance.onresult = null;
      recognitionInstance.onstart = null;
      recognitionInstance.onerror = null;
      recognitionInstance.onend = null;
      browserTake = null;
      if (take.failed) return;
      if (take.stoppedManually) {
        patchState({ status: 'idle' });
        void syncOwnerRuntimeEvent(owner, take, 'idle', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'browser',
          captureProvider: 'browser',
          transcriptSource: take.transcriptSource,
          processedAt: Date.now(),
          render: false,
        });
        options.render();
        return;
      }
      if (!take.finalTranscript.trim()) {
        patchState({ status: 'idle' });
        void syncOwnerRuntimeEvent(owner, take, 'no-speech', {
          requestedProvider: take.requestedProvider,
          effectiveProvider: 'browser',
          captureProvider: 'browser',
          transcriptSource: take.transcriptSource,
          captureStartedAt: take.startedAt,
          processedAt: Date.now(),
          render: false,
        });
        degenerateTakeHintGuard.onNoSpeechTurn();
        options.render();
        return;
      }

      patchState({
        status: 'idle',
        finalTranscript: '',
        finalConfidence: null,
      });
      if (!take.sessionId || !take.isConnected) {
        patchState({
          status: 'error',
          error: 'Connect the session before sending voice input.',
        });
        options.render();
        return;
      }
      void submitTranscriptTurn(take.sessionId, take.finalTranscript, {
        captureProvider: 'browser',
        confidence: take.finalConfidence,
        isFinal: true,
        captureStartedAt: take.startedAt,
        speechDetectedAt: take.speechDetectedAt,
        capturedAt: take.capturedAt ?? Date.now(),
        transcriptSource: take.transcriptSource,
      }, take.requestedProvider, owner, take).then((normalizedTranscript) => {
        if (!isOwnerCurrent(owner, take)) {
          /* Same crossing, browser-recognition lane: a superseded take's
           * resolved transcript is dropped — witnessed, never silent. */
          if (normalizedTranscript) {
            reportVoiceCoachTurnDispatch('warn', 'never-received', 'coach-turn-declined-owner-superseded');
          }
          return;
        }
        /* The healthy beacon, browser-recognition lane — only for a real
         * transcript; an empty one dies at submitVoiceCoachQuestion's guard
         * and must not claim a dispatch. */
        if (normalizedTranscript) {
          reportVoiceCoachTurnDispatch('info', 'ok', 'coach-turn-dispatched');
        }
        return options.handleCapturedQuestion(normalizedTranscript);
      })
        .catch((error) => {
          if (!isOwnerCurrent(owner, take)) return;
          void syncOwnerRuntimeEvent(owner, take, 'error', {
            requestedProvider: take.requestedProvider,
            effectiveProvider: 'browser',
            captureProvider: 'browser',
            transcriptSource: take.transcriptSource,
            captureStartedAt: take.startedAt,
            speechDetectedAt: take.speechDetectedAt,
            capturedAt: take.capturedAt,
            processedAt: Date.now(),
            captureDurationMs: take.capturedAt != null
              ? take.capturedAt - take.startedAt
              : null,
            error: (error as Error).message,
            render: false,
          });
          options.render();
        });
      options.render();
    };

    try {
      recognitionInstance.start();
    } catch (error) {
      stopBrowserTake(take);
      throw error;
    }
    if (isCurrentBrowserTake(take)) options.render();
    return isCurrentBrowserTake(take);
  }

  async function runStart(owner: InputOwner): Promise<boolean> {
    const effectiveInputProvider = options.getEffectiveInputProvider(owner.requestedProvider);
    const requestedProvider = owner.requestedProvider;
    console.info(`[voice-input-start] provider-resolution generation=${owner.generation} requested=${requestedProvider} effective=${effectiveInputProvider || 'none'}`);
    let lastAttempt: InputStartupAttempt = {
      captureProvider: effectiveInputProvider === 'backend' || effectiveInputProvider === 'browser'
        ? effectiveInputProvider
        : null,
      transcriptSource: effectiveInputProvider === 'backend'
        ? 'backend-live'
        : effectiveInputProvider === 'browser'
          ? (requestedProvider === 'backend' ? 'browser-fallback' : 'browser-speech-recognition')
          : null,
      captureStartedAt: null,
    };
    try {
      if (effectiveInputProvider === 'backend') {
        if (options.canUseBackendLiveCapture?.() !== false) {
          lastAttempt = {
            captureProvider: 'backend',
            transcriptSource: 'backend-live',
            captureStartedAt: null,
          };
          try {
            const started = await startBackendLiveCapture(owner);
            if (!isOwnerSelected(owner)) return false;
            return started;
          } catch (error) {
            if (!isOwnerSelected(owner)) return false;
            if (error instanceof InputStartupFailure) lastAttempt = error.attempt;
            console.warn('[Voice] Backend live input failed, falling back to recorded capture:', error);
          }
        }
        if (!options.canUseBackendRecordedFallback()) {
          throw new Error('This browser cannot use the recorded fallback for backend voice input.');
        }
        lastAttempt = {
          captureProvider: 'backend',
          transcriptSource: 'backend-asr',
          captureStartedAt: null,
        };
        try {
          const started = await startRecordedBackendCapture(owner);
          if (!isOwnerSelected(owner)) return false;
          return started;
        } catch (error) {
          if (error instanceof InputStartupFailure) lastAttempt = error.attempt;
          throw error;
        }
      }

      if (effectiveInputProvider !== 'browser') {
        if (!isOwnerSelected(owner)) return false;
        console.warn(`[voice-input-start] provider-unavailable generation=${owner.generation} requested=${requestedProvider}`);
        patchState({
          status: 'unsupported',
          error: requestedProvider === 'backend'
            ? 'Backend live capture is not wired yet. Browser speech recognition is still required for spoken coach turns.'
            : 'This browser does not expose speech recognition.',
        });
        options.render();
        return false;
      }

      const started = await startBrowserSpeechRecognition(owner);
      if (!isOwnerSelected(owner)) return false;
      return started;
    } catch (error) {
      if (!isOwnerSelected(owner)) return false;
      const publicError = error instanceof Error
        ? error
        : new Error(getErrorMessage(error, 'Voice input failed to start.'));
      if (error instanceof InputStartupFailure) lastAttempt = error.attempt;
      const terminalMessage = error instanceof InputStartupFailure
        ? error.terminalMessage
        : publicError.message;
      const now = Date.now();
      publishOwnerTerminalError(
        owner,
        owner.identity,
        terminalMessage,
        {
          requestedProvider,
          effectiveProvider: effectiveInputProvider ?? null,
          captureProvider: lastAttempt.captureProvider,
          transcriptSource: lastAttempt.transcriptSource,
          captureStartedAt: lastAttempt.captureStartedAt,
          processedAt: now,
          captureDurationMs: lastAttempt.captureStartedAt
            ? now - lastAttempt.captureStartedAt
            : null,
        },
      );
      throw publicError;
    }
  }

  function start(): Promise<boolean> {
    const owner = selectOwner('starting');
    stopInputResources(true, owner);
    const operation = runStart(owner).then(
      (started) => {
        if (currentOwner === owner) owner.phase = started ? 'active' : 'inactive';
        console.info(`[voice-input-start] settled generation=${owner.generation} started=${started} ownerSelected=${currentOwner === owner}`);
        return started;
      },
      (error) => {
        if (currentOwner === owner) owner.phase = 'inactive';
        throw error;
      },
    );
    void operation.catch(() => undefined);
    return Promise.race([
      operation,
      owner.cancelled.then(() => false),
    ]);
  }

  function toggle(): void {
    if (currentOwner?.phase === 'starting' || isActiveStatus()) {
      const stopPromise = stop(true);
      const owner = currentOwner;
      void stopPromise.then(() => {
        if (owner && isOwnerSelected(owner)) options.render();
      });
      return;
    }
    const startPromise = start();
    void startPromise.catch(() => undefined);
  }

  return {
    hasBrowserSpeechRecognitionSupport,
    start,
    stop,
    toggle,
  };
}
