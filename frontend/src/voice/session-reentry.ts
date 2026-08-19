import {
  createDefaultVoiceUiState,
  getVoiceBackendPayloadSlices,
  normalizeVoiceUiState,
  type VoiceLiveFrame,
  type VoiceUiState,
} from './state';

export type VoiceRuntimeResetPlan = {
  stopListening?: boolean;
  stopSpeech?: boolean;
  resetLessonStatus?: boolean;
  resetForecastState?: boolean;
  resetDrillState?: boolean;
  syncLastSpokenCoachMessage?: boolean;
};

export type VoiceSessionReentryPlan = {
  nextVoiceUiState: VoiceUiState;
  persistedReferenceClipId: string | null;
  runtimeReset: VoiceRuntimeResetPlan | null;
  nextLiveTrace: VoiceLiveFrame[];
  nextLastTakeTrace: VoiceLiveFrame[];
};

export type VoiceBootstrapPlan = {
  shouldResumeExistingSession: boolean;
  shouldAutoStartPractice: boolean;
};

function getPersistedReferenceClipId(
  mode: string,
  data: Record<string, unknown> | null | undefined,
): string | null {
  if (mode !== 'voice') {
    return null;
  }

  const { voiceState } = getVoiceBackendPayloadSlices(data);
  return typeof voiceState?.referenceClipId === 'string' && voiceState.referenceClipId.trim()
    ? voiceState.referenceClipId.trim()
    : null;
}

function buildSessionVoiceUiState(
  data: Record<string, unknown> | null | undefined,
  currentVoiceUiState: VoiceUiState,
): VoiceUiState {
  const {
    voiceState,
    deeptutorVoiceState,
  } = getVoiceBackendPayloadSlices(data);
  return normalizeVoiceUiState({
    ...createDefaultVoiceUiState({ targetPreset: currentVoiceUiState.targetPreset }),
    ...(voiceState || {}),
    deeptutorVoiceState: deeptutorVoiceState as VoiceUiState['deeptutorVoiceState'],
  });
}

function createVoiceResetPlan(): VoiceRuntimeResetPlan {
  return {
    stopListening: true,
    resetLessonStatus: true,
    resetForecastState: true,
    resetDrillState: true,
    syncLastSpokenCoachMessage: true,
  };
}

export function planStartedVoiceSessionReentry(
  sessionMode: string,
  data: Record<string, unknown> | null | undefined,
  currentVoiceUiState: VoiceUiState,
): VoiceSessionReentryPlan {
  return {
    nextVoiceUiState: buildSessionVoiceUiState(data, currentVoiceUiState),
    persistedReferenceClipId: getPersistedReferenceClipId(sessionMode, data),
    runtimeReset: sessionMode === 'voice' ? createVoiceResetPlan() : null,
    nextLiveTrace: [],
    nextLastTakeTrace: [],
  };
}

export function planRestoredVoiceSessionReentry(
  restoredMode: string,
  data: Record<string, unknown> | null | undefined,
  currentVoiceUiState: VoiceUiState,
): VoiceSessionReentryPlan {
  const nextVoiceUiState = buildSessionVoiceUiState(data, currentVoiceUiState);
  return {
    nextVoiceUiState,
    persistedReferenceClipId: getPersistedReferenceClipId(restoredMode, data),
    runtimeReset: restoredMode === 'voice' ? createVoiceResetPlan() : null,
    nextLiveTrace: [],
    nextLastTakeTrace: restoredMode === 'voice' && Array.isArray(nextVoiceUiState.lastTakeTimeline)
      ? nextVoiceUiState.lastTakeTimeline.slice()
      : [],
  };
}

export function planDirectFallbackVoiceSessionReentry(
  sessionMode: string,
  currentVoiceUiState: VoiceUiState,
): VoiceSessionReentryPlan {
  return {
    nextVoiceUiState: createDefaultVoiceUiState({ targetPreset: currentVoiceUiState.targetPreset }),
    persistedReferenceClipId: null,
    runtimeReset: sessionMode === 'voice'
      ? {
          resetForecastState: true,
          resetDrillState: true,
        }
      : null,
    nextLiveTrace: [],
    nextLastTakeTrace: [],
  };
}

export function planVoiceModeBootstrap(options: {
  autoStart?: boolean;
  voiceSessionId?: string | null;
  voiceTransportStatus?: string | null;
}): VoiceBootstrapPlan {
  const hasVoiceSession = Boolean(options.voiceSessionId);
  const shouldResumeExistingSession = Boolean(
    options.autoStart && hasVoiceSession && options.voiceTransportStatus === 'idle',
  );
  return {
    shouldResumeExistingSession,
    shouldAutoStartPractice: Boolean(options.autoStart && !hasVoiceSession),
  };
}

/**
 * The four linear stages of a session spine: Warm-up -> Target -> Practice -> Review.
 * Pure derivation from existing signals (no new state fields) — consumed by the
 * voice-copy front door (gates the auto-arm) and the session-spine stepper.
 */
export type VoiceSessionStage = 'warmup' | 'target' | 'practice' | 'review';

export function deriveSessionStage(input: {
  voiceSessionId?: string | null;
  targetSource?: string | null;
  referenceClipId?: string | null;
  attemptCount?: number;
  hasLastSummary?: boolean;
  transportStatus?: string | null;
  sessionArmed?: boolean;
  takeActive?: boolean;
}): VoiceSessionStage {
  const practicing = Boolean(input.takeActive) || input.transportStatus === 'streaming';
  // A finished take (a summary, or recorded attempts) lands us in Review — unless a new
  // take is already underway, in which case Practice wins.
  if ((input.hasLastSummary || (input.attemptCount ?? 0) > 0) && !practicing) {
    return 'review';
  }
  if (practicing || Boolean(input.sessionArmed)) {
    return 'practice';
  }
  // A target is "owned" once a reference is loaded (voice-copy front door, P0.3).
  if (input.targetSource === 'reference' || Boolean(input.referenceClipId)) {
    return 'target';
  }
  return 'warmup';
}
