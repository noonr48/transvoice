import {
  getVoiceBackendPayloadSlices,
  mergeVoiceReferenceAnalysis,
  normalizeDeepTutorVoiceState,
  normalizeVoiceStudentModelState,
  normalizeVoiceUiState,
  type VoiceBackendPayload,
  type VoiceCoachMessage,
  type VoiceLiveFrame,
  type VoiceReferenceAnalysis,
  type VoiceStudentModelState,
  type VoiceUiState,
} from './state';

type VoiceSessionStateControllerOptions = {
  getVoiceUiState: () => VoiceUiState;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  setVoiceStudentModelState: (state: VoiceStudentModelState) => void;
  syncPersistedReferenceAnalysis: (
    referenceClipId: string | null | undefined,
  ) => VoiceReferenceAnalysis | null;
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
  };
  fetchSessionState: (sessionId: string) => Promise<VoiceBackendPayload>;
  resetDeepTutorLessonState: () => void;
  clearPracticeState: () => void;
  getLatestCoachMessage: () => VoiceCoachMessage | null;
  setLastSpokenCoachMessageId: (messageId: string | null) => void;
  setLastTakeTrace: (trace: VoiceLiveFrame[]) => void;
  hasDeepTutorVoiceLesson: () => boolean;
  refreshVoiceDrills: (silent?: boolean) => Promise<unknown>;
  refreshVoiceCockpitLine: (action?: 'ensure' | 'regenerate' | 'easier' | 'harder' | 'next' | 'pin-toggle') => Promise<unknown>;
  render: () => void;
  enforceRecoverySafety: () => Promise<void>;
};

export type VoiceSessionStateController = ReturnType<typeof createVoiceSessionStateController>;

export function resolveVoiceBackendPayloadState(
  currentVoiceUiState: VoiceUiState,
  payload: VoiceBackendPayload | null | undefined,
  options: {
    syncPersistedReferenceAnalysis: (
      referenceClipId: string | null | undefined,
    ) => VoiceReferenceAnalysis | null;
  },
): VoiceUiState {
  const {
    voiceState: nextVoiceStatePatch,
    deeptutorVoiceState: nextDeepTutorVoiceStatePatch,
  } = getVoiceBackendPayloadSlices(payload);
  const nextDeepTutorVoiceStateSource = nextDeepTutorVoiceStatePatch
    ?? currentVoiceUiState.deeptutorVoiceState;
  const nextDeepTutorVoiceState = nextDeepTutorVoiceStateSource
    ? normalizeDeepTutorVoiceState(nextDeepTutorVoiceStateSource)
    : null;
  const hasReferenceClipPatch = Boolean(
    nextVoiceStatePatch
    && Object.prototype.hasOwnProperty.call(nextVoiceStatePatch, 'referenceClipId'),
  );
  const nextReferenceClipId = hasReferenceClipPatch
    ? (nextVoiceStatePatch?.referenceClipId ?? null)
    : (currentVoiceUiState.referenceClipId ?? null);
  const persistedReferenceAnalysis = options.syncPersistedReferenceAnalysis(nextReferenceClipId);
  const nextReferenceAnalysis = mergeVoiceReferenceAnalysis({
    nextReferenceClipId,
    currentReferenceAnalysis: persistedReferenceAnalysis,
    incomingReferenceAnalysis: nextVoiceStatePatch?.referenceAnalysis,
    currentReferenceClipId: currentVoiceUiState.referenceClipId,
  });

  return normalizeVoiceUiState({
    ...currentVoiceUiState,
    ...(nextVoiceStatePatch || {}),
    deeptutorVoiceState: nextDeepTutorVoiceState,
    referenceAnalysis: nextReferenceAnalysis,
  });
}

export function createVoiceSessionStateController(options: VoiceSessionStateControllerOptions) {
  function applyBackendPayload(payload: VoiceBackendPayload | null | undefined): VoiceUiState {
    const { studentModel, learnerContext } = getVoiceBackendPayloadSlices(payload);
    const nextVoiceUiState = resolveVoiceBackendPayloadState(
      options.getVoiceUiState(),
      payload,
      {
        syncPersistedReferenceAnalysis: options.syncPersistedReferenceAnalysis,
      },
    );
    options.updateVoiceUiState(() => nextVoiceUiState);

    if (studentModel || learnerContext) {
      options.setVoiceStudentModelState(normalizeVoiceStudentModelState({
        ...(studentModel || {
          available: learnerContext?.available === true,
          enabled: learnerContext?.available !== false,
        }),
        learnerContext: (learnerContext ?? studentModel?.learnerContext ?? null) as VoiceStudentModelState['learnerContext'],
      }));
    }

    return nextVoiceUiState;
  }

  async function syncSessionStateFromBackend(silenceCoach = false): Promise<VoiceUiState | null> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      return null;
    }

    try {
      const data = await options.fetchSessionState(currentSessionId);
      const nextVoiceUiState = applyBackendPayload(data);
      options.resetDeepTutorLessonState();

      if (!nextVoiceUiState.voiceSessionId) {
        options.clearPracticeState();
      }
      if (silenceCoach) {
        options.setLastSpokenCoachMessageId(options.getLatestCoachMessage()?.id || null);
      }

      options.setLastTakeTrace(
        Array.isArray(nextVoiceUiState.lastTakeTimeline)
          ? nextVoiceUiState.lastTakeTimeline.slice()
          : [],
      );
      await options.refreshVoiceDrills(true);
      if (!options.hasDeepTutorVoiceLesson()) {
        await options.refreshVoiceCockpitLine('ensure').catch(() => null);
      }
      options.render();
      void options.enforceRecoverySafety();
      return options.getVoiceUiState();
    } catch (error) {
      console.warn('[Sloane] Failed to load voice session state:', error);
      return null;
    }
  }

  return {
    applyBackendPayload,
    syncSessionStateFromBackend,
  };
}
