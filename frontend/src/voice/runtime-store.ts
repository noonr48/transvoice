import type { VoicePracticeTransportSnapshot, VoicePracticeTransportStatus } from './practice-transport';
import {
  createDefaultVoiceDrillState,
  createDefaultVoiceStudentModelState,
  createDefaultVoiceUiState,
  normalizeVoiceUiState,
  type VoiceCoachMessageChannel,
  type VoiceDrillState,
  type VoiceLiveFrame,
  type VoiceStudentModelState,
  type VoiceUiState,
} from './state';
import type { VoiceAudioInputDevice, VoiceOverlayVisibility } from './contracts';
import type { VoiceViewModelContext } from './view-model';

export type { VoiceAudioInputDevice, VoiceOverlayVisibility } from './contracts';

export type VoiceSpeechRecognitionState = {
  status: 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
  error: string | null;
  finalTranscript: string;
  finalConfidence: number | null;
};

export type VoiceRuntimeStoreState = {
  voiceUiState: VoiceUiState;
  voiceDrillState: VoiceDrillState;
  voiceStudentModelState: VoiceStudentModelState;
  voiceDrillStatus: 'idle' | 'loading' | 'error';
  voiceDrillError: string | null;
  voiceDrillSelectionPendingId: string | null;
  voiceTransportStatus: VoicePracticeTransportStatus;
  voiceLiveFrame: VoiceLiveFrame | null;
  voiceLiveTrace: VoiceLiveFrame[];
  voiceLastTakeTrace: VoiceLiveFrame[];
  voiceCoachTaskId: string | null;
  voiceCoachTurnId: string | null;
  voiceCoachTaskStatus: 'idle' | 'running' | 'error';
  voiceCoachTaskError: string | null;
  voiceForecastStatus: 'idle' | 'loading' | 'error';
  voiceForecastError: string | null;
  voiceOverlayVisibility: VoiceOverlayVisibility;
  voiceAudioInputDevices: VoiceAudioInputDevice[];
  voiceAudioInputStatus: 'idle' | 'loading' | 'ready' | 'error';
  voiceAudioInputError: string | null;
  voiceAudioInputNotice: string | null;
  voiceSelectedInputDeviceId: string | null;
  voiceResolvedInputLabel: string | null;
  voiceResolvedInputDeviceId: string | null;
  voiceInputOptionsSignature: string;
  voiceSessionArmed: boolean;
  voiceTakeActive: boolean;
  voiceTakeProcessing: boolean;
  voiceSuppressPracticeClick: boolean;
  voiceCoachQuestionStatus: 'idle' | 'sending' | 'error';
  voiceCoachQuestionError: string | null;
  voicePendingCoachChannel: VoiceCoachMessageChannel | null;
  voiceLastSpokenCoachMessageId: string | null;
  voiceDeepTutorLessonStatus: 'idle' | 'loading' | 'error';
  voiceDeepTutorLessonError: string | null;
  voiceSpeechRecognition: VoiceSpeechRecognitionState;
};

export type VoiceCoachRuntimeResetOptions = {
  stopListening?: boolean;
  stopSpeech?: boolean;
  resetLessonStatus?: boolean;
  resetForecastState?: boolean;
  resetDrillState?: boolean;
  syncLastSpokenCoachMessage?: boolean;
};

export type VoiceSessionReentryPlan = {
  nextVoiceUiState: VoiceUiState;
  nextLiveTrace: VoiceLiveFrame[];
  nextLastTakeTrace: VoiceLiveFrame[];
  runtimeReset?: VoiceCoachRuntimeResetOptions | null;
};

export type VoiceRuntimeResetDependencies = {
  stopListening?: (resetTranscript: boolean) => void;
  stopSpeech?: () => void;
  clearCoachPollTimer?: () => void;
  getLatestCoachMessageId?: () => string | null;
};

export type VoiceRuntimeStore = ReturnType<typeof createVoiceRuntimeStore>;

export function createDefaultVoiceRuntimeStoreState(
  overrides: Partial<VoiceRuntimeStoreState> = {},
): VoiceRuntimeStoreState {
  return {
    voiceUiState: createDefaultVoiceUiState(),
    voiceDrillState: createDefaultVoiceDrillState(),
    voiceStudentModelState: createDefaultVoiceStudentModelState(),
    voiceDrillStatus: 'idle',
    voiceDrillError: null,
    voiceDrillSelectionPendingId: null,
    voiceTransportStatus: 'idle',
    voiceLiveFrame: null,
    voiceLiveTrace: [],
    voiceLastTakeTrace: [],
    voiceCoachTaskId: null,
    voiceCoachTurnId: null,
    voiceCoachTaskStatus: 'idle',
    voiceCoachTaskError: null,
    voiceForecastStatus: 'idle',
    voiceForecastError: null,
    voiceOverlayVisibility: {
      live: true,
      forecast: true,
      reference: true,
    },
    voiceAudioInputDevices: [],
    voiceAudioInputStatus: 'idle',
    voiceAudioInputError: null,
    voiceAudioInputNotice: null,
    voiceSelectedInputDeviceId: null,
    voiceResolvedInputLabel: null,
    voiceResolvedInputDeviceId: null,
    voiceInputOptionsSignature: '',
    voiceSessionArmed: false,
    voiceTakeActive: false,
    voiceTakeProcessing: false,
    voiceSuppressPracticeClick: false,
    voiceCoachQuestionStatus: 'idle',
    voiceCoachQuestionError: null,
    voicePendingCoachChannel: null,
    voiceLastSpokenCoachMessageId: null,
    voiceDeepTutorLessonStatus: 'idle',
    voiceDeepTutorLessonError: null,
    voiceSpeechRecognition: {
      status: 'idle',
      error: null,
      finalTranscript: '',
      finalConfidence: null,
    },
    ...overrides,
  };
}

export function createVoiceRuntimeStore(initialState: Partial<VoiceRuntimeStoreState> = {}) {
  let state = createDefaultVoiceRuntimeStoreState(initialState);

  const updateState = (
    updater: (current: VoiceRuntimeStoreState) => VoiceRuntimeStoreState,
  ): VoiceRuntimeStoreState => {
    state = updater(state);
    return state;
  };

  const patchState = (patch: Partial<VoiceRuntimeStoreState>): VoiceRuntimeStoreState => (
    updateState((current) => ({
      ...current,
      ...patch,
    }))
  );

  const clearPendingCoachState = (): void => {
    patchState({ voicePendingCoachChannel: null });
  };

  const resetCoachRuntimeUiState = (
    options: VoiceCoachRuntimeResetOptions = {},
    dependencies: VoiceRuntimeResetDependencies = {},
  ): void => {
    const {
      stopListening = false,
      stopSpeech = false,
      resetLessonStatus = false,
      resetForecastState = false,
      resetDrillState = false,
      syncLastSpokenCoachMessage = false,
    } = options;

    if (stopListening) {
      dependencies.stopListening?.(true);
    }
    if (stopSpeech) {
      dependencies.stopSpeech?.();
    }

    dependencies.clearCoachPollTimer?.();

    updateState((current) => ({
      ...current,
      voiceCoachTaskId: null,
      voiceCoachTurnId: null,
      voiceCoachTaskStatus: 'idle',
      voiceCoachTaskError: null,
      voiceCoachQuestionStatus: 'idle',
      voiceCoachQuestionError: null,
      voicePendingCoachChannel: null,
      voiceLastSpokenCoachMessageId: syncLastSpokenCoachMessage
        ? (dependencies.getLatestCoachMessageId?.() ?? null)
        : null,
      voiceDeepTutorLessonStatus: resetLessonStatus ? 'idle' : current.voiceDeepTutorLessonStatus,
      voiceDeepTutorLessonError: resetLessonStatus ? null : current.voiceDeepTutorLessonError,
      voiceForecastStatus: resetForecastState ? 'idle' : current.voiceForecastStatus,
      voiceForecastError: resetForecastState ? null : current.voiceForecastError,
      voiceDrillState: resetDrillState
        ? createDefaultVoiceDrillState({ targetPreset: current.voiceUiState.targetPreset })
        : current.voiceDrillState,
      voiceDrillStatus: resetDrillState ? 'idle' : current.voiceDrillStatus,
      voiceDrillError: resetDrillState ? null : current.voiceDrillError,
      voiceDrillSelectionPendingId: resetDrillState ? null : current.voiceDrillSelectionPendingId,
    }));
  };

  const applySessionReentryPlan = (
    plan: VoiceSessionReentryPlan,
    referenceAnalysis: VoiceUiState['referenceAnalysis'],
    dependencies: VoiceRuntimeResetDependencies = {},
  ): void => {
    updateState((current) => ({
      ...current,
      voiceUiState: normalizeVoiceUiState({
        ...plan.nextVoiceUiState,
        referenceAnalysis,
      }),
      voiceLiveTrace: plan.nextLiveTrace.slice(),
      voiceLastTakeTrace: plan.nextLastTakeTrace.slice(),
    }));
    if (plan.runtimeReset) {
      resetCoachRuntimeUiState(plan.runtimeReset, dependencies);
    }
  };

  return {
    getState(): VoiceRuntimeStoreState {
      return state;
    },
    updateState,
    patchState,
    getUiState(): VoiceUiState {
      return state.voiceUiState;
    },
    updateUiState(updater: (current: VoiceUiState) => VoiceUiState): VoiceUiState {
      const nextUiState = normalizeVoiceUiState(updater(state.voiceUiState));
      patchState({ voiceUiState: nextUiState });
      return nextUiState;
    },
    getViewModelContext(): VoiceViewModelContext {
      return {
        voiceUiState: state.voiceUiState,
        voiceDrillState: state.voiceDrillState,
        voiceStudentModelState: state.voiceStudentModelState,
        voiceDrillStatus: state.voiceDrillStatus,
        voiceDrillError: state.voiceDrillError,
        voiceForecastStatus: state.voiceForecastStatus,
        voiceForecastError: state.voiceForecastError,
        voiceCoachTaskStatus: state.voiceCoachTaskStatus,
        voiceCoachTaskError: state.voiceCoachTaskError,
      };
    },
    getPracticeTransportState(): VoicePracticeTransportSnapshot {
      return {
        status: state.voiceTransportStatus,
        liveFrame: state.voiceLiveFrame,
        liveTrace: state.voiceLiveTrace,
        sessionArmed: state.voiceSessionArmed,
        takeActive: state.voiceTakeActive,
        takeProcessing: state.voiceTakeProcessing,
      };
    },
    setPracticeTransportState(
      updater: (current: VoicePracticeTransportSnapshot) => VoicePracticeTransportSnapshot,
    ): VoicePracticeTransportSnapshot {
      const nextState = updater({
        status: state.voiceTransportStatus,
        liveFrame: state.voiceLiveFrame,
        liveTrace: state.voiceLiveTrace,
        sessionArmed: state.voiceSessionArmed,
        takeActive: state.voiceTakeActive,
        takeProcessing: state.voiceTakeProcessing,
      });
      patchState({
        voiceTransportStatus: nextState.status,
        voiceLiveFrame: nextState.liveFrame,
        voiceLiveTrace: nextState.liveTrace,
        voiceSessionArmed: nextState.sessionArmed,
        voiceTakeActive: nextState.takeActive,
        voiceTakeProcessing: nextState.takeProcessing,
      });
      return nextState;
    },
    getSelectedVoiceAudioInput(): VoiceAudioInputDevice | null {
      return state.voiceAudioInputDevices.find(
        (device) => device.deviceId === (state.voiceSelectedInputDeviceId || 'default'),
      ) || null;
    },
    getSpeechRecognitionState(): VoiceSpeechRecognitionState {
      return state.voiceSpeechRecognition;
    },
    setSpeechRecognitionState(
      updater: (current: VoiceSpeechRecognitionState) => VoiceSpeechRecognitionState,
    ): VoiceSpeechRecognitionState {
      const nextState = updater(state.voiceSpeechRecognition);
      patchState({ voiceSpeechRecognition: nextState });
      return nextState;
    },
    clearPendingCoachState,
    resetCoachRuntimeUiState,
    toggleOverlay(overlay: keyof VoiceOverlayVisibility): VoiceOverlayVisibility {
      const nextOverlayVisibility = {
        ...state.voiceOverlayVisibility,
        [overlay]: !state.voiceOverlayVisibility[overlay],
      };
      patchState({ voiceOverlayVisibility: nextOverlayVisibility });
      return nextOverlayVisibility;
    },
    applySessionReentryPlan,
  };
}
