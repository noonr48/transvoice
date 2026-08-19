import {
  getDeepTutorVoiceResumeButtonLabel as resolveDeepTutorVoiceResumeButtonLabel,
  hasDeepTutorVoiceLessonState,
  shouldRebuildDeepTutorVoiceLessonState,
} from './deeptutor-flow';
import {
  canUseVoiceCoachInput as resolveCanUseVoiceCoachInput,
  createDeepTutorVoiceInteractionState as resolveDeepTutorVoiceInteractionState,
  createVoiceInteractionSnapshot as resolveVoiceInteractionSnapshot,
  getVoiceInteractionOwnerCopy as resolveVoiceInteractionOwnerCopy,
  resolveVoicePracticeReleasePlan,
  type VoiceInteractionOwner,
  type VoiceInteractionSnapshot,
} from './orchestrator';
import type { VoicePracticeTransportStatus } from './practice-transport';
import type { VoiceRuntimeShell } from './runtime-shell';
import type {
  VoiceAudioInputDevice,
  VoiceRuntimeResetDependencies,
  VoiceRuntimeStore,
} from './runtime-store';
import type { VoiceRuntimeStatusState } from './runtime-status';
import {
  getLatestVoiceCoachThreadMessage as resolveLatestVoiceCoachThreadMessage,
  isDeepTutorVoiceGuideInProgress as resolveDeepTutorVoiceGuideInProgress,
  mergeVoiceReferenceAnalysis,
  normalizeDeepTutorVoiceCoachBrief,
  normalizeDeepTutorVoiceState,
  normalizeVoiceInputRuntimeState,
  type DeepTutorVoiceState,
  type VoiceCoachMessage,
  type VoiceCueSheet,
  type VoiceDrill,
  type VoiceLiveFrame,
  type VoicePhraseComparison,
  type VoicePracticeLine,
  type VoiceReferenceAnalysis,
} from './state';
import type { VoiceSessionReentryPlan } from './session-reentry';
import {
  getVoiceActiveDrillCopyText as resolveVoiceActiveDrillCopyText,
  getVoiceActiveDrillStateLabel as resolveVoiceActiveDrillStateLabel,
  getVoiceActiveLine as resolveVoiceActiveLine,
  getVoiceCoachBackendLivePathLabel as resolveVoiceCoachBackendLivePathLabel,
  getVoiceCoachCopy as resolveVoiceCoachCopy,
  getVoiceCoachMessageLabel as resolveVoiceCoachMessageLabel,
  getCurrentVoiceCueSheet as resolveCurrentVoiceCueSheet,
  getRecommendedVoiceDrills as resolveRecommendedVoiceDrills,
  getRenderableVoicePhraseComparison as resolveVoicePhraseComparison,
  getSelectedVoiceDrill as resolveSelectedVoiceDrill,
  getVoiceCueSheetCopyText as resolveVoiceCueSheetCopyText,
  getVoiceForecastText as resolveVoiceForecastText,
  getVoicePhraseComparisonText as resolveVoicePhraseComparisonText,
  getVoiceReferenceMimicProgressState as resolveVoiceReferenceMimicProgressState,
  getVoiceReferenceMimicState as resolveVoiceReferenceMimicState,
  getVoiceSummaryText as resolveVoiceSummaryText,
  isVoicePracticeTargetLocked as resolveVoicePracticeTargetLocked,
} from './view-model';

type VoiceAppRuntimeOptions = {
  store: VoiceRuntimeStore;
  getCurrentMode: () => string;
  getCurrentSessionId: () => string | null;
  getIsConnected: () => boolean;
  getRuntimeShell: () => VoiceRuntimeShell | null;
  getRuntimeStatusState: () => VoiceRuntimeStatusState;
  isSpeechSynthesisBusy: () => boolean;
  getVoiceSessionStreamUrl: (voiceSessionId: string) => string;
  disarmPracticeSession: (reason: string) => Promise<boolean>;
  syncPersistedReferenceAnalysis: (referenceClipId: string | null) => VoiceReferenceAnalysis | null;
  runtimeResetDependencies: VoiceRuntimeResetDependencies;
};

export type VoiceAppRuntime = ReturnType<typeof createVoiceAppRuntime>;

function getRuntimeShellOrThrow(
  getRuntimeShell: VoiceAppRuntimeOptions['getRuntimeShell'],
): VoiceRuntimeShell {
  const runtimeShell = getRuntimeShell();
  if (!runtimeShell) {
    throw new Error('Voice runtime shell is unavailable.');
  }
  return runtimeShell;
}

export function createVoiceAppRuntime(options: VoiceAppRuntimeOptions) {
  const {
    store,
    getCurrentMode,
    getCurrentSessionId,
    getIsConnected,
    getRuntimeShell,
    getRuntimeStatusState,
    isSpeechSynthesisBusy,
    getVoiceSessionStreamUrl,
    disarmPracticeSession,
    syncPersistedReferenceAnalysis,
    runtimeResetDependencies,
  } = options;

  const getViewModelContext = () => store.getViewModelContext();

  const getDeepTutorVoiceState = (): DeepTutorVoiceState => (
    normalizeDeepTutorVoiceState(store.getUiState().deeptutorVoiceState)
  );

  const hasActiveDeepTutorGuideSession = (): boolean => (
    resolveDeepTutorVoiceGuideInProgress(getDeepTutorVoiceState())
  );

  const getRenderableVoicePhraseComparison = (): VoicePhraseComparison | null => (
    resolveVoicePhraseComparison(getViewModelContext())
  );

  const getVoiceReferenceMimicState = (): ReturnType<typeof resolveVoiceReferenceMimicState> => (
    resolveVoiceReferenceMimicState({
      voiceUiState: store.getUiState(),
      comparison: getRenderableVoicePhraseComparison(),
    })
  );

  const getVoiceInteractionSnapshot = (): VoiceInteractionSnapshot => {
    const state = store.getState();
    return resolveVoiceInteractionSnapshot({
      currentMode: getCurrentMode(),
      currentSessionId: getCurrentSessionId(),
      isConnected: getIsConnected(),
      voiceTakeProcessing: state.voiceTakeProcessing,
      voiceTakeActive: state.voiceTakeActive,
      voiceTransportStatus: state.voiceTransportStatus,
      voiceCoachQuestionStatus: state.voiceCoachQuestionStatus,
      voiceCoachTaskStatus: state.voiceCoachTaskStatus,
      voiceDeepTutorLessonStatus: state.voiceDeepTutorLessonStatus,
      voiceSpeechRecognitionStatus: state.voiceSpeechRecognition.status,
      speechSynthesisBusy: isSpeechSynthesisBusy(),
      voiceSessionArmed: state.voiceSessionArmed,
    });
  };

  const canUseVoiceCoachVoiceInputFromSnapshot = (
    interaction: VoiceInteractionSnapshot,
    modifier: { ignoreTakeState?: boolean } = {},
  ): boolean => (
    resolveCanUseVoiceCoachInput(interaction, {
      hasInputProvider: Boolean(getRuntimeShellOrThrow(getRuntimeShell).getEffectiveInputProvider()),
      ignoreTakeState: modifier.ignoreTakeState,
    })
  );

  const getLatestCoachMessage = (): VoiceCoachMessage | null => (
    resolveLatestVoiceCoachThreadMessage(store.getUiState().coachThread, 'coach')
  );

  const getDeepTutorVoiceInteractionState = (
    referenceMimicAction = getVoiceReferenceMimicState().action,
  ): ReturnType<typeof resolveDeepTutorVoiceInteractionState> => {
    const state = store.getState();
    const interaction = getVoiceInteractionSnapshot();
    return resolveDeepTutorVoiceInteractionState({
      snapshot: interaction,
      deeptutorVoiceState: getDeepTutorVoiceState(),
      shouldRebuildLesson: shouldRebuildDeepTutorVoiceLessonState(getDeepTutorVoiceState()),
      hasActiveGuideSession: hasActiveDeepTutorGuideSession(),
      voiceDeepTutorLessonStatus: state.voiceDeepTutorLessonStatus,
      voiceSpeechRecognitionStatus: state.voiceSpeechRecognition.status,
      referenceMimicAction,
      canUseVoiceCoachVoiceInput: canUseVoiceCoachVoiceInputFromSnapshot(interaction),
      canUseVoiceCoachVoiceInputAfterRelease: canUseVoiceCoachVoiceInputFromSnapshot(interaction, {
        ignoreTakeState: true,
      }),
      latestCoachMessageId: getLatestCoachMessage()?.id || null,
      lastSpokenCoachMessageId: state.voiceLastSpokenCoachMessageId,
    });
  };

  const isVoicePracticeTargetMutationLocked = (): boolean => {
    const state = store.getState();
    return resolveVoicePracticeTargetLocked(state.voiceUiState)
      || resolveDeepTutorVoiceGuideInProgress(getDeepTutorVoiceState())
      || state.voiceSessionArmed
      || state.voiceTakeActive
      || state.voiceTakeProcessing;
  };

  const assertVoicePracticeTargetUnlocked = (actionLabel: string): void => {
    if (isVoicePracticeTargetMutationLocked()) {
      throw new Error(`Disarm practice before ${actionLabel}.`);
    }
  };

  const getVoiceCoachBackendLivePathLabel = (): string | null => (
    resolveVoiceCoachBackendLivePathLabel(getRuntimeStatusState().input.backend.liveStatus)
  );

  const getVoiceReferenceMimicProgressState = (
    referenceMimicState = getVoiceReferenceMimicState(),
  ): ReturnType<typeof resolveVoiceReferenceMimicProgressState> => (
    resolveVoiceReferenceMimicProgressState(
      store.getUiState().deeptutorVoiceState,
      referenceMimicState,
    )
  );

  const getVoiceInteractionOwner = (): VoiceInteractionOwner => getVoiceInteractionSnapshot().owner;

  const getVoiceInteractionOwnerCopy = (
    owner = getVoiceInteractionOwner(),
  ): string | null => resolveVoiceInteractionOwnerCopy(owner);


  const hasDeepTutorVoiceLesson = (): boolean => hasDeepTutorVoiceLessonState(getDeepTutorVoiceState());

  const shouldRebuildDeepTutorVoiceLesson = (): boolean => (
    shouldRebuildDeepTutorVoiceLessonState(getDeepTutorVoiceState())
  );

  const canUseVoiceCoachVoiceInput = (options: { ignoreTakeState?: boolean } = {}): boolean => (
    canUseVoiceCoachVoiceInputFromSnapshot(getVoiceInteractionSnapshot(), options)
  );

  const shouldAutoReturnPracticeToCoachAfterTake = (): boolean => hasActiveDeepTutorGuideSession();

  const getDeepTutorVoiceResumeButtonLabel = (): string => {
    const referenceMimicState = getVoiceReferenceMimicState();
    return resolveDeepTutorVoiceResumeButtonLabel({
      interaction: getDeepTutorVoiceInteractionState(referenceMimicState.action),
    });
  };

  return {
    hasModeActivity(): boolean {
      const voiceUiState = store.getUiState();
      return Boolean(
        voiceUiState.voiceSessionId
          || voiceUiState.lessonId
          || voiceUiState.referenceClipId
          || voiceUiState.referenceClipName
          || voiceUiState.lastSummary
          || voiceUiState.targetVoiceProfile
          || voiceUiState.phraseForecast
          || voiceUiState.forecastPhrase
      );
    },
    getViewModelContext,
    getSummaryText(): string {
      return resolveVoiceSummaryText(store.getUiState());
    },
    getCoachCopy(): string {
      return resolveVoiceCoachCopy(getViewModelContext());
    },
    getForecastText(): string {
      return resolveVoiceForecastText(getViewModelContext());
    },
    getSelectedVoiceDrill(): VoiceDrill | null {
      return resolveSelectedVoiceDrill(store.getState().voiceDrillState);
    },
    getRecommendedVoiceDrills(): VoiceDrill[] {
      return resolveRecommendedVoiceDrills(store.getState().voiceDrillState);
    },
    getRenderableVoicePhraseComparison,
    getVoiceActiveLine(): VoicePracticeLine | null {
      return resolveVoiceActiveLine(store.getUiState());
    },
    isVoicePracticeTargetMutationLocked,
    assertVoicePracticeTargetUnlocked,
    getCurrentVoiceCueSheet(): VoiceCueSheet | null {
      return resolveCurrentVoiceCueSheet(getViewModelContext());
    },
    getVoiceActiveDrillStateLabel(): string {
      const state = store.getState();
      return resolveVoiceActiveDrillStateLabel({
        voiceUiState: state.voiceUiState,
        inputRecovery: getRuntimeShellOrThrow(getRuntimeShell).getInputRecoveryState(),
        voiceDeepTutorLessonStatus: state.voiceDeepTutorLessonStatus,
        voiceCoachTaskStatus: state.voiceCoachTaskStatus,
        voiceTakeProcessing: state.voiceTakeProcessing,
        voiceTakeActive: state.voiceTakeActive,
        voiceTransportStatus: state.voiceTransportStatus,
        voiceSessionArmed: state.voiceSessionArmed,
      });
    },
    getVoiceCoachBackendLivePathLabel,
    getVoiceActiveDrillCopyText(): string {
      const state = store.getState();
      return resolveVoiceActiveDrillCopyText({
        voiceUiState: state.voiceUiState,
        inputRecovery: getRuntimeShellOrThrow(getRuntimeShell).getInputRecoveryState(),
        inputRuntime: normalizeVoiceInputRuntimeState(state.voiceUiState.voiceInputRuntime),
        voiceSpeechRecognitionStatus: state.voiceSpeechRecognition.status,
        voiceSessionArmed: state.voiceSessionArmed,
        voiceTransportStatus: state.voiceTransportStatus,
        backendLivePathLabel: getVoiceCoachBackendLivePathLabel(),
        referenceMimicState: getVoiceReferenceMimicState(),
        referenceMimicProgress: getVoiceReferenceMimicProgressState(),
      });
    },
    getVoiceReferenceMimicState,
    getVoiceReferenceMimicProgressState,
    getVoiceInteractionSnapshot,
    getVoiceInteractionOwner,
    getVoiceInteractionOwnerCopy,
    getDeepTutorVoiceInteractionState,
    async releaseVoicePracticeForCoachListening(): Promise<void> {
      const releasePlan = resolveVoicePracticeReleasePlan(getVoiceInteractionSnapshot());
      if (releasePlan.action === 'blocked') {
        throw new Error(releasePlan.reason);
      }
      if (releasePlan.action === 'disarm') {
        await disarmPracticeSession('coach listening takeover');
      }
    },
    getVoiceCueSheetCopyText(): string {
      return resolveVoiceCueSheetCopyText(getViewModelContext());
    },
    getVoicePhraseComparisonText(): string {
      return resolveVoicePhraseComparisonText(getViewModelContext());
    },
    getResolvedVoiceStreamUrl(): string | null {
      const voiceUiState = store.getUiState();
      if (voiceUiState.voiceSessionId) {
        return getVoiceSessionStreamUrl(voiceUiState.voiceSessionId);
      }
      return voiceUiState.streamUrl;
    },
    getVoiceReferenceFrameAtMs(timeMs: number): VoiceLiveFrame | null {
      const timeline = store.getUiState().referenceAnalysis?.timeline;
      if (!Array.isArray(timeline) || timeline.length === 0) {
        return null;
      }
      let candidate = timeline[0];
      for (const frame of timeline) {
        if (frame.t <= timeMs) {
          candidate = frame;
          continue;
        }
        break;
      }
      return candidate;
    },
    getDeepTutorVoiceState,
    hasDeepTutorVoiceLesson,
    hasActiveDeepTutorGuideSession,
    isDeepTutorVoiceGuideInProgress(): boolean {
      return resolveDeepTutorVoiceGuideInProgress(getDeepTutorVoiceState());
    },
    shouldRebuildDeepTutorVoiceLesson,
    getVoiceCoachMessageLabel(message: VoiceCoachMessage | null): string {
      return resolveVoiceCoachMessageLabel(message, {
        hasActiveGuideSession: hasActiveDeepTutorGuideSession(),
      });
    },
    getLatestCoachMessage,
    canUseVoiceCoachVoiceInputFromSnapshot,
    canUseVoiceCoachVoiceInput,
    shouldAutoReturnPracticeToCoachAfterTake,
    getDeepTutorVoiceResumeButtonLabel,
    hydrateStoredInputDevicePreference(
      readVoiceInputDevicePreference: () => string | null,
    ): VoiceAudioInputDevice['deviceId'] {
      const deviceId = readVoiceInputDevicePreference() || 'default';
      store.patchState({
        voiceSelectedInputDeviceId: deviceId,
      });
      return deviceId;
    },
    applySessionReentryPlan(plan: VoiceSessionReentryPlan): void {
      const persistedReferenceAnalysis = syncPersistedReferenceAnalysis(plan.persistedReferenceClipId);
      const referenceAnalysis = mergeVoiceReferenceAnalysis({
        nextReferenceClipId: plan.persistedReferenceClipId,
        currentReferenceAnalysis: persistedReferenceAnalysis,
        incomingReferenceAnalysis: plan.nextVoiceUiState.referenceAnalysis,
        currentReferenceClipId: plan.nextVoiceUiState.referenceClipId,
      });
      store.applySessionReentryPlan(plan, referenceAnalysis, runtimeResetDependencies);
    },
  };
}
