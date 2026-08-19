import type { VoiceCoachInputProvider } from './contracts';
import {
  normalizeVoiceInputRuntimeState,
  type VoiceInputRuntimeState,
} from './state';

export type { VoiceCoachInputProvider } from './contracts';

export type VoiceCoachBackendLiveStatus = {
  requestedMode: string | null;
  requestedVadStrategy: string | null;
  requestedWsProtocol: string | null;
  requestedWsUrlConfigured: boolean;
  requestedProviderTarget: string | null;
  requestedModel: string | null;
  requestedLanguage: string | null;
  requestedEndpointing: string | null;
  actualMode: string | null;
  actualEngine: string | null;
  actualInterimMode: string | null;
  actualVadStrategy: string | null;
  actualProviderTarget: string | null;
  actualProviderModel: string | null;
  actualProviderLanguage: string | null;
  actualProviderEndpointing: string | null;
  fallbackReason: string | null;
  verified: boolean;
  available: boolean | null;
  lastError: string | null;
  lastErrorBucket: string | null;
  lastCheckedAt: number | null;
};

export type VoiceInputRecoveryState = {
  level: 'ok' | 'warning' | 'critical';
  statusLabel: string | null;
  coachCopy: string | null;
  activeDrillCopy: string | null;
  providerHint: string | null;
  runtimePill: string | null;
  suggestedInputProvider: VoiceCoachInputProvider | null;
  shouldDisableContinuous: boolean;
  disableReason: string | null;
};

export function createDefaultVoiceCoachBackendLiveStatus(): VoiceCoachBackendLiveStatus {
  return {
    requestedMode: null,
    requestedVadStrategy: null,
    requestedWsProtocol: null,
    requestedWsUrlConfigured: false,
    requestedProviderTarget: null,
    requestedModel: null,
    requestedLanguage: null,
    requestedEndpointing: null,
    actualMode: null,
    actualEngine: null,
    actualInterimMode: null,
    actualVadStrategy: null,
    actualProviderTarget: null,
    actualProviderModel: null,
    actualProviderLanguage: null,
    actualProviderEndpointing: null,
    fallbackReason: null,
    verified: false,
    available: null,
    lastError: null,
    lastErrorBucket: null,
    lastCheckedAt: null,
  };
}

export function normalizeVoiceCoachBackendLiveStatus(backendStatus: any): VoiceCoachBackendLiveStatus {
  const fallback = createDefaultVoiceCoachBackendLiveStatus();
  const live = backendStatus?.live && typeof backendStatus.live === 'object' ? backendStatus.live : null;
  const requested = live?.requested && typeof live.requested === 'object' ? live.requested : null;
  const effective = live?.effective && typeof live.effective === 'object'
    ? live.effective
    : live?.resolved && typeof live.resolved === 'object'
      ? live.resolved
      : null;
  return {
    ...fallback,
    requestedMode: typeof requested?.mode === 'string' && requested.mode.trim() ? requested.mode.trim() : null,
    requestedVadStrategy: typeof requested?.vadStrategy === 'string' && requested.vadStrategy.trim() ? requested.vadStrategy.trim() : null,
    requestedWsProtocol: typeof requested?.wsProtocol === 'string' && requested.wsProtocol.trim() ? requested.wsProtocol.trim() : null,
    requestedWsUrlConfigured: Boolean(requested?.wsUrlConfigured),
    requestedProviderTarget: typeof requested?.providerTarget === 'string' && requested.providerTarget.trim() ? requested.providerTarget.trim() : null,
    requestedModel: typeof requested?.model === 'string' && requested.model.trim() ? requested.model.trim() : null,
    requestedLanguage: typeof requested?.languageCode === 'string' && requested.languageCode.trim() ? requested.languageCode.trim() : null,
    requestedEndpointing: typeof requested?.endpointingProfile === 'string' && requested.endpointingProfile.trim() ? requested.endpointingProfile.trim() : null,
    actualMode: typeof effective?.activeMode === 'string' && effective.activeMode.trim() ? effective.activeMode.trim() : null,
    actualEngine: typeof effective?.engine === 'string' && effective.engine.trim() ? effective.engine.trim() : null,
    actualInterimMode: typeof effective?.interimMode === 'string' && effective.interimMode.trim() ? effective.interimMode.trim() : null,
    actualVadStrategy: typeof effective?.vadStrategy === 'string' && effective.vadStrategy.trim() ? effective.vadStrategy.trim() : null,
    actualProviderTarget: typeof effective?.providerTarget === 'string' && effective.providerTarget.trim() ? effective.providerTarget.trim() : null,
    actualProviderModel: typeof effective?.providerModel === 'string' && effective.providerModel.trim() ? effective.providerModel.trim() : null,
    actualProviderLanguage: typeof effective?.providerLanguage === 'string' && effective.providerLanguage.trim() ? effective.providerLanguage.trim() : null,
    actualProviderEndpointing: typeof effective?.providerEndpointing === 'string' && effective.providerEndpointing.trim() ? effective.providerEndpointing.trim() : null,
    fallbackReason: typeof effective?.fallbackReason === 'string' && effective.fallbackReason.trim()
      ? effective.fallbackReason.trim()
      : typeof live?.lastError === 'string' && live.lastError.trim()
        ? live.lastError.trim()
        : null,
    verified: Boolean(live?.verified),
    available: typeof live?.available === 'boolean' ? live.available : null,
    lastError: typeof live?.lastError === 'string' && live.lastError.trim() ? live.lastError.trim() : null,
    lastErrorBucket: typeof live?.lastErrorBucket === 'string' && live.lastErrorBucket.trim() ? live.lastErrorBucket.trim() : null,
    lastCheckedAt: Number.isFinite(Number(live?.lastCheckedAt)) ? Math.round(Number(live.lastCheckedAt)) : null,
  };
}

export function getVoiceInputRecoveryState(
  runtime: VoiceInputRuntimeState,
  options: {
    requestedInputProvider?: VoiceCoachInputProvider;
    effectiveInputProvider?: VoiceCoachInputProvider | null;
    inputProviderFallbackActive?: boolean;
    backendLiveStatus?: VoiceCoachBackendLiveStatus | null;
    backendInputError?: string | null;
  } = {},
): VoiceInputRecoveryState {
  const requestedInputProvider = options.requestedInputProvider ?? 'browser';
  const effectiveInputProvider = options.effectiveInputProvider ?? runtime.effectiveProvider ?? null;
  const inputProviderFallbackActive = options.inputProviderFallbackActive ?? false;
  const backendLiveStatus = options.backendLiveStatus ?? createDefaultVoiceCoachBackendLiveStatus();
  const backendInputError = typeof options.backendInputError === 'string' && options.backendInputError.trim()
    ? options.backendInputError.trim()
    : null;
  const backendCapture = runtime.captureProvider === 'backend';
  const browserCapture = runtime.captureProvider === 'browser';
  const fallbackCapture = requestedInputProvider === 'backend' && browserCapture;
  const repeatedErrors = runtime.consecutiveErrorTurns >= 2;
  const repeatedBackendErrors = repeatedErrors && backendCapture;
  const repeatedFallbackErrors = repeatedErrors && fallbackCapture;
  const repeatedBackendNoSpeech = requestedInputProvider === 'backend'
    && backendCapture
    && runtime.consecutiveNoSpeechTurns >= 2;
  const repeatedFallbackNoSpeech = fallbackCapture
    && runtime.consecutiveNoSpeechTurns >= 2;
  const repeatedBrowserNoSpeech = requestedInputProvider === 'browser'
    && browserCapture
    && runtime.consecutiveNoSpeechTurns >= 2;

  if (repeatedBackendErrors) {
    return {
      level: 'critical',
      statusLabel: 'Input degraded',
      coachCopy: 'Backend input has failed on repeated turns. Switch to Browser input for a steadier coach loop while backend ASR is recovered.',
      activeDrillCopy: 'Backend ASR is unstable right now. Switch to Browser input or use single-turn retries before re-enabling a fast loop.',
      providerHint: 'Recommended: switch to Browser input until backend ASR is healthy again.',
      runtimePill: 'switch to browser',
      suggestedInputProvider: 'browser',
      shouldDisableContinuous: true,
      disableReason: 'Hands-free was paused after repeated backend input failures. Switch to Browser input or recover backend ASR before turning it back on.',
    };
  }

  if (repeatedFallbackErrors) {
    return {
      level: 'critical',
      statusLabel: 'Fallback degraded',
      coachCopy: 'Backend input is selected, but browser fallback has also failed on repeated turns. Check browser mic permission or switch to explicit Browser input until the backend path is healthy again.',
      activeDrillCopy: 'The current browser fallback path is unstable. Retry a short manual turn after checking mic permission, or switch to Browser input before re-enabling a fast loop.',
      providerHint: 'Browser fallback has failed on repeated turns. Check mic permission or switch to explicit Browser input.',
      runtimePill: 'fallback retry',
      suggestedInputProvider: 'browser',
      shouldDisableContinuous: true,
      disableReason: 'Hands-free was paused after repeated browser-fallback input failures. Retry a manual turn or switch to explicit Browser input before turning it back on.',
    };
  }

  if (repeatedErrors) {
    return {
      level: 'critical',
      statusLabel: 'Input degraded',
      coachCopy: 'Voice input has failed on repeated turns. Check mic permission/device health, then retry with Talk to Coach before using hands-free again.',
      activeDrillCopy: 'Recent input failures mean the coach loop needs a clean retry. Reopen the mic manually after checking browser permission and your selected input.',
      providerHint: 'Check browser mic permission and the selected input device before retrying.',
      runtimePill: 'input retry',
      suggestedInputProvider: null,
      shouldDisableContinuous: true,
      disableReason: 'Hands-free was paused after repeated voice input failures. Retry a manual turn before re-enabling it.',
    };
  }

  if (repeatedBackendNoSpeech) {
    return {
      level: 'warning',
      statusLabel: 'Mic check',
      coachCopy: 'Backend capture ended with no speech on recent turns. Check the selected mic/device level, or switch to Browser input if you need a more forgiving coach path right now.',
      activeDrillCopy: 'Backend capture is hearing silence. Check your input path, then retry once or switch to Browser input for coach talk.',
      providerHint: 'Backend capture has timed out with no speech. Check the mic path or switch to Browser input.',
      runtimePill: `${runtime.consecutiveNoSpeechTurns}x no speech`,
      suggestedInputProvider: 'browser',
      shouldDisableContinuous: true,
      disableReason: 'Hands-free was paused because backend capture timed out with no speech on repeated turns.',
    };
  }

  if (repeatedFallbackNoSpeech) {
    return {
      level: 'warning',
      statusLabel: 'Fallback mic check',
      coachCopy: 'Backend input is selected, but the browser fallback path has heard no speech on recent turns. Check browser mic permission/device level, or switch to explicit Browser input until backend ASR is healthy.',
      activeDrillCopy: 'The current fallback path is hearing silence. Retry with a short manual turn after checking the browser mic path, or switch to Browser input to lock the active path in.',
      providerHint: 'Browser fallback has timed out with no speech. Check mic permission/device level or switch to explicit Browser input.',
      runtimePill: 'fallback no speech',
      suggestedInputProvider: 'browser',
      shouldDisableContinuous: true,
      disableReason: 'Hands-free was paused because the browser fallback path timed out with no speech on repeated turns.',
    };
  }

  if (requestedInputProvider === 'backend' && inputProviderFallbackActive && effectiveInputProvider === 'browser') {
    return {
      level: 'warning',
      statusLabel: 'Fallback active',
      coachCopy: backendInputError
        ? `Backend input is offline, so browser fallback is carrying coach turns (${backendInputError}). Switch to Browser input if you want a stable path until backend ASR comes back.`
        : 'Backend input is selected, but browser fallback is carrying the coach loop right now. Switch to Browser input if you want the current path to be explicit and stable.',
      activeDrillCopy: 'Coach listening is currently riding browser fallback, not backend ASR. Keep going or switch to Browser input to make the active path explicit.',
      providerHint: 'Browser fallback is active for coach turns. Switch to Browser input if you want that path locked in.',
      runtimePill: 'browser fallback',
      suggestedInputProvider: 'browser',
      shouldDisableContinuous: false,
      disableReason: null,
    };
  }

  if (repeatedBrowserNoSpeech) {
    return {
      level: 'warning',
      statusLabel: 'Mic check',
      coachCopy: 'Recent coach turns ended with no speech detected. Check the selected input device and start speaking before the listen window times out.',
      activeDrillCopy: 'The coach loop is not hearing speech on recent turns. Check the mic path, then retry with a short manual turn.',
      providerHint: 'Recent browser turns ended with no speech. Check the selected input device.',
      runtimePill: `${runtime.consecutiveNoSpeechTurns}x no speech`,
      suggestedInputProvider: null,
      shouldDisableContinuous: true,
      disableReason: 'Hands-free was paused because browser input timed out with no speech on repeated turns. Retry a short manual turn before turning it back on.',
    };
  }

  if (runtime.lastOutcome === 'error' && runtime.lastError) {
    return {
      level: 'warning',
      statusLabel: 'Retry input',
      coachCopy: runtime.lastError,
      activeDrillCopy: 'The last coach turn failed. Retry with a short manual turn before leaning on the automatic loop again.',
      providerHint: runtime.lastError,
      runtimePill: 'last turn failed',
      suggestedInputProvider: null,
      shouldDisableContinuous: false,
      disableReason: null,
    };
  }

  return {
    level: 'ok',
    statusLabel: null,
    coachCopy: null,
    activeDrillCopy: null,
    providerHint: null,
    runtimePill: null,
    suggestedInputProvider: null,
    shouldDisableContinuous: false,
    disableReason: null,
  };
}

export function buildVoiceInputRuntimeRecoveryReset(
  runtime: VoiceInputRuntimeState,
  options: {
    requestedProvider?: VoiceCoachInputProvider;
    effectiveProvider?: VoiceCoachInputProvider | null;
    captureProvider?: VoiceCoachInputProvider | null;
  } = {},
): VoiceInputRuntimeState {
  return normalizeVoiceInputRuntimeState({
    ...runtime,
    status: 'idle',
    lastOutcome: 'idle',
    requestedProvider: options.requestedProvider ?? runtime.requestedProvider,
    effectiveProvider: options.effectiveProvider === undefined
      ? runtime.effectiveProvider
      : options.effectiveProvider,
    captureProvider: options.captureProvider === undefined
      ? null
      : options.captureProvider,
    providerStyle: null,
    transcriptSource: null,
    lastTranscript: null,
    lastTranscriptConfidence: null,
    lastCaptureStartedAt: null,
    lastSpeechDetectedAt: null,
    lastCapturedAt: null,
    lastProcessedAt: null,
    lastCaptureDurationMs: null,
    lastRoundTripMs: null,
    consecutiveNoSpeechTurns: 0,
    consecutiveErrorTurns: 0,
    liveEngine: null,
    liveInterimMode: null,
    liveVadStrategy: null,
    providerTarget: null,
    providerModel: null,
    providerLanguage: null,
    providerEndpointing: null,
    lastAudioProcessedMs: null,
    lastError: null,
    lastEventAt: Date.now(),
  });
}
