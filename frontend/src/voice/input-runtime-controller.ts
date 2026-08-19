import type {
  VoiceCoachInputProvider,
  VoiceInputRuntimeEvent,
  VoiceInputRuntimeEventRequest,
  VoiceInputRuntimeResponse,
} from './api';
import type { VoiceInputRecoveryState } from './runtime-status';
import {
  normalizeVoiceInputRuntimeState,
  normalizeVoiceUiState,
  type VoiceAdvancedPanelState,
  type VoiceBackendPayload,
  type VoiceCoachVoiceState,
  type VoiceInputRuntimeState,
  type VoiceUiState,
} from './state';

type VoiceInputRuntimeControllerOptions = {
  getVoiceUiState: () => VoiceUiState;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
  };
  getRequestedInputProvider: () => VoiceCoachInputProvider;
  getEffectiveInputProvider: (requestedProvider?: VoiceCoachInputProvider) => VoiceCoachInputProvider | null;
  getInputRecoveryState: (
    runtime?: VoiceInputRuntimeState,
    overrideOptions?: {
      requestedInputProvider?: VoiceCoachInputProvider;
      effectiveInputProvider?: VoiceCoachInputProvider | null;
      inputProviderFallbackActive?: boolean;
    },
  ) => VoiceInputRecoveryState;
  planRecoverySafety: (options: {
    continuousEnabled: boolean;
    recovery: VoiceInputRecoveryState;
  }) => {
    shouldApply: boolean;
    disableReason: string | null;
  };
  setRecoverySafetyPending: (pending: boolean) => void;
  submitInputRuntimeEvent: (
    sessionId: string,
    event: VoiceInputRuntimeEvent,
    options: VoiceInputRuntimeEventRequest,
  ) => Promise<VoiceInputRuntimeResponse>;
  applyInputProviderStatusPayload: (payload: unknown) => void;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  updateVoiceCockpitState: (patch: {
    coachVoice?: Partial<VoiceCoachVoiceState>;
    voiceInputRuntime?: Partial<VoiceInputRuntimeState>;
    advancedPanel?: Partial<VoiceAdvancedPanelState>;
  }) => Promise<void>;
  addTerminalLine: (type: string, content: string) => void;
  render: () => void;
};

export type VoiceInputRuntimeController = ReturnType<typeof createVoiceInputRuntimeController>;

export type VoiceInputRuntimeLifecycleContext = Readonly<{
  sessionId: string | null;
  isCurrent: () => boolean;
}>;

function isLifecycleCurrent(lifecycle?: VoiceInputRuntimeLifecycleContext): boolean {
  return !lifecycle || lifecycle.isCurrent();
}

export function applyVoiceInputRuntimeEvent(
  runtime: VoiceInputRuntimeState,
  event: VoiceInputRuntimeEvent,
  options: VoiceInputRuntimeEventRequest = {},
  eventAt = Date.now(),
): VoiceInputRuntimeState {
  const previous = normalizeVoiceInputRuntimeState(runtime);
  const next = normalizeVoiceInputRuntimeState({
    ...previous,
    requestedProvider: options.requestedProvider ?? previous.requestedProvider,
    effectiveProvider: options.effectiveProvider === undefined
      ? previous.effectiveProvider
      : options.effectiveProvider,
    captureProvider: options.captureProvider === undefined
      ? previous.captureProvider
      : options.captureProvider,
    providerStyle: options.providerStyle === undefined
      ? previous.providerStyle
      : options.providerStyle,
    transcriptSource: options.transcriptSource === undefined
      ? previous.transcriptSource
      : options.transcriptSource,
    lastTranscript: options.transcript === undefined
      ? previous.lastTranscript
      : options.transcript,
    lastTranscriptConfidence: options.confidence === undefined
      ? previous.lastTranscriptConfidence
      : options.confidence,
    lastCaptureStartedAt: options.captureStartedAt === undefined
      ? previous.lastCaptureStartedAt
      : options.captureStartedAt,
    lastSpeechDetectedAt: options.speechDetectedAt === undefined
      ? previous.lastSpeechDetectedAt
      : options.speechDetectedAt,
    lastCapturedAt: options.capturedAt === undefined
      ? previous.lastCapturedAt
      : options.capturedAt,
    lastProcessedAt: options.processedAt === undefined
      ? previous.lastProcessedAt
      : options.processedAt,
    lastCaptureDurationMs: options.captureDurationMs === undefined
      ? previous.lastCaptureDurationMs
      : options.captureDurationMs,
    lastRoundTripMs: options.roundTripMs === undefined
      ? previous.lastRoundTripMs
      : options.roundTripMs,
    lastError: options.error === undefined
      ? previous.lastError
      : options.error,
    lastEventAt: eventAt,
  });

  if (!next.effectiveProvider) {
    next.effectiveProvider = next.captureProvider || next.requestedProvider;
  }

  switch (event) {
    case 'waiting':
      next.status = 'waiting';
      next.lastError = null;
      next.lastCaptureStartedAt = next.lastCaptureStartedAt ?? eventAt;
      break;
    case 'listening':
      next.status = 'listening';
      next.lastError = null;
      next.lastSpeechDetectedAt = next.lastSpeechDetectedAt ?? eventAt;
      break;
    case 'processing':
      next.status = 'processing';
      next.lastError = null;
      next.lastCapturedAt = next.lastCapturedAt ?? eventAt;
      if (next.lastCaptureStartedAt && next.lastCapturedAt && next.lastCaptureDurationMs == null) {
        next.lastCaptureDurationMs = Math.max(0, next.lastCapturedAt - next.lastCaptureStartedAt);
      }
      break;
    case 'completed':
      next.status = 'idle';
      next.lastOutcome = 'completed';
      next.successfulTurns = previous.successfulTurns + 1;
      next.consecutiveNoSpeechTurns = 0;
      next.consecutiveErrorTurns = 0;
      next.lastError = null;
      next.lastProcessedAt = next.lastProcessedAt ?? eventAt;
      if (next.lastCapturedAt && next.lastProcessedAt && next.lastRoundTripMs == null) {
        next.lastRoundTripMs = Math.max(0, next.lastProcessedAt - next.lastCapturedAt);
      }
      break;
    case 'no-speech':
      next.status = 'idle';
      next.lastOutcome = 'no-speech';
      next.noSpeechTurns = previous.noSpeechTurns + 1;
      next.consecutiveNoSpeechTurns = previous.consecutiveNoSpeechTurns + 1;
      next.consecutiveErrorTurns = 0;
      next.lastError = null;
      next.lastTranscript = null;
      next.lastTranscriptConfidence = null;
      next.lastProcessedAt = next.lastProcessedAt ?? eventAt;
      if (next.lastCaptureStartedAt && next.lastProcessedAt && next.lastCaptureDurationMs == null) {
        next.lastCaptureDurationMs = Math.max(0, next.lastProcessedAt - next.lastCaptureStartedAt);
      }
      break;
    case 'error':
      next.status = 'error';
      next.lastOutcome = 'error';
      next.errorCount = previous.errorCount + 1;
      next.consecutiveErrorTurns = previous.consecutiveErrorTurns + 1;
      next.consecutiveNoSpeechTurns = 0;
      next.lastError = next.lastError || previous.lastError || 'Voice input failed.';
      next.lastProcessedAt = next.lastProcessedAt ?? eventAt;
      if (next.lastCapturedAt && next.lastProcessedAt && next.lastRoundTripMs == null) {
        next.lastRoundTripMs = Math.max(0, next.lastProcessedAt - next.lastCapturedAt);
      }
      break;
    default:
      next.status = 'idle';
      break;
  }

  return next;
}

export function createVoiceInputRuntimeController(options: VoiceInputRuntimeControllerOptions) {
  function getRuntimeState(): VoiceInputRuntimeState {
    return normalizeVoiceInputRuntimeState(options.getVoiceUiState().voiceInputRuntime);
  }

  function applyLocalEvent(
    event: VoiceInputRuntimeEvent,
    eventOptions: VoiceInputRuntimeEventRequest = {},
  ): VoiceInputRuntimeState {
    const nextRuntime = applyVoiceInputRuntimeEvent(getRuntimeState(), event, eventOptions);
    options.updateVoiceUiState((state) => normalizeVoiceUiState({
      ...state,
      voiceInputRuntime: nextRuntime,
    }));
    return nextRuntime;
  }

  async function enforceRecoverySafety(
    lifecycle?: VoiceInputRuntimeLifecycleContext,
  ): Promise<void> {
    if (!isLifecycleCurrent(lifecycle)) {
      return;
    }
    const currentState = options.getVoiceUiState();
    const recovery = options.getInputRecoveryState(getRuntimeState());
    const plan = options.planRecoverySafety({
      continuousEnabled: Boolean(currentState.coachVoice?.continuousEnabled),
      recovery,
    });
    if (!plan.shouldApply || !isLifecycleCurrent(lifecycle)) {
      return;
    }

    options.setRecoverySafetyPending(true);
    try {
      await options.updateVoiceCockpitState({
        coachVoice: {
          continuousEnabled: false,
        },
      });
      if (!isLifecycleCurrent(lifecycle)) {
        return;
      }
      if (plan.disableReason && isLifecycleCurrent(lifecycle)) {
        options.addTerminalLine('system', plan.disableReason);
      }
    } catch (error) {
      if (isLifecycleCurrent(lifecycle)) {
        console.warn('[Voice] Failed to apply recovery safety behavior', error);
      }
    } finally {
      if (isLifecycleCurrent(lifecycle)) {
        options.setRecoverySafetyPending(false);
        if (isLifecycleCurrent(lifecycle)) {
          options.render();
        }
      }
    }
  }

  async function syncEvent(
    event: VoiceInputRuntimeEvent,
    eventOptions: VoiceInputRuntimeEventRequest & { render?: boolean } = {},
    lifecycle?: VoiceInputRuntimeLifecycleContext,
  ): Promise<void> {
    if (!isLifecycleCurrent(lifecycle)) {
      return;
    }
    if (lifecycle) {
      options.setRecoverySafetyPending(false);
      if (!isLifecycleCurrent(lifecycle)) {
        return;
      }
    }
    applyLocalEvent(event, eventOptions);
    const isTerminalEvent = event === 'error' || event === 'no-speech' || event === 'completed';
    if (isTerminalEvent && !lifecycle) {
      void enforceRecoverySafety();
    }
    if (eventOptions.render !== false && isLifecycleCurrent(lifecycle)) {
      options.render();
    }

    const sessionContext = lifecycle
      ? { currentSessionId: lifecycle.sessionId, isConnected: true }
      : options.getSessionContext();

    if (sessionContext.currentSessionId && sessionContext.isConnected) {
      const requestOptions: VoiceInputRuntimeEventRequest = {
        requestedProvider: eventOptions.requestedProvider ?? options.getRequestedInputProvider(),
        effectiveProvider: eventOptions.effectiveProvider ?? options.getEffectiveInputProvider(),
        captureProvider: eventOptions.captureProvider ?? null,
        providerStyle: eventOptions.providerStyle ?? null,
        transcriptSource: eventOptions.transcriptSource ?? null,
        transcript: eventOptions.transcript ?? null,
        confidence: eventOptions.confidence ?? null,
        captureStartedAt: eventOptions.captureStartedAt ?? null,
        speechDetectedAt: eventOptions.speechDetectedAt ?? null,
        capturedAt: eventOptions.capturedAt ?? null,
        processedAt: eventOptions.processedAt ?? null,
        captureDurationMs: eventOptions.captureDurationMs ?? null,
        roundTripMs: eventOptions.roundTripMs ?? null,
        error: eventOptions.error ?? null,
      };

      if (!isLifecycleCurrent(lifecycle)) {
        return;
      }
      try {
        const data = await options.submitInputRuntimeEvent(
          sessionContext.currentSessionId,
          event,
          requestOptions,
        );
        if (!isLifecycleCurrent(lifecycle)) {
          return;
        }
        options.applyInputProviderStatusPayload(data);
        if (!isLifecycleCurrent(lifecycle)) {
          return;
        }
        options.applyVoiceBackendPayload(data);
        if (eventOptions.render !== false && isLifecycleCurrent(lifecycle)) {
          options.render();
        }
      } catch (error) {
        if (!isLifecycleCurrent(lifecycle)) {
          return;
        }
        console.warn('[Voice] Failed to sync input runtime event', error);
      }
    }

    if (isTerminalEvent && lifecycle && isLifecycleCurrent(lifecycle)) {
      await enforceRecoverySafety(lifecycle);
    }
  }

  return {
    getRuntimeState,
    applyLocalEvent,
    syncEvent,
    enforceRecoverySafety,
  };
}
