import type { VoiceInteractionOwner } from './orchestrator';
import type { VoicePracticeTransportStatus } from './practice-transport';
import type { VoiceReferenceHydrationView } from './reference-runtime';
import {
  getVoiceMetricsFromFrame,
  hasVoiceTimelinePath,
  isVoiceComparisonMatchCueSheet,
} from './render';
import type {
  VoiceRenderControlsDomState,
  VoiceRenderSummaryDomState,
} from './render-dom';
import type { VoiceRenderOrchestrationState } from './render/orchestration';
import type {
  VoiceCoachInputCapabilities,
  VoiceCoachInputProvider,
  VoiceCoachSpeechProvider,
  VoiceInputRecoveryState,
  VoiceRuntimeEnvironment,
  VoiceRuntimeStatusState,
} from './runtime-status';
import {
  getDeepTutorVoiceLessonMode,
  getLatestVoiceCoachThreadMessage,
  isVoiceAttemptMeasurementUsable,
  isDeepTutorVoiceGuideInProgress,
  normalizeDeepTutorVoiceState,
  normalizeVoiceConditioningState,
  normalizeVoiceInputRuntimeState,
  normalizeVoicePhraseTextForMatch,
  type VoiceCoachMessageChannel,
  type VoiceLiveFrame,
  type VoiceUiState,
} from './state';
import {
  getCurrentVoiceCueSheet,
  getRenderableVoicePhraseComparison,
  getSelectedVoiceDrill,
  getRecommendedVoiceDrills,
  getVoiceActiveDrillCopyText,
  getVoiceActiveDrillStateLabel,
  getVoiceActiveLine,
  getVoiceCoachControlsViewModel,
  getVoiceCoachCopy,
  getVoiceCoachMessageLabel,
  getVoiceCoachPanelCopy,
  getVoiceCoachSupportViewModel,
  getVoiceCoachThreadViewModel,
  getVoiceCueSheetCopyText,
  getVoiceForecastText,
  getVoiceInputPanelViewModel,
  getVoiceInputRuntimeViewModel,
  getVoicePanelControlsViewModel,
  getVoicePhraseComparisonText,
  getVoiceReferenceMimicProgressState,
  getVoiceReferenceMimicState,
  getVoiceReferenceViewModel,
  getVoiceScriptPadViewModel,
  getVoiceSidebarSummaryViewModel,
  getVoiceStageViewModel,
  isVoicePracticeTargetLocked,
  type VoiceViewModelContext,
} from './view-model';

type VoiceCoachQuestionStatus = 'idle' | 'sending' | 'error';
type VoiceSpeechRecognitionStatus = 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
type VoiceDeepTutorLessonStatus = 'idle' | 'loading' | 'error';
type VoiceAudioInputStatus = 'idle' | 'loading' | 'ready' | 'error';

type VoiceRenderAudioInputDevice = {
  deviceId: string;
  label: string;
  isDefault: boolean;
};

export type VoiceRenderOverlayVisibility = {
  live: boolean;
  forecast: boolean;
  reference: boolean;
};

export type VoiceRenderStateContext = {
  isVoiceMode: boolean;
  currentSessionId: string | null;
  isConnected: boolean;
  streamUrl: string | null;
  viewModelContext: VoiceViewModelContext;
  voiceCoachQuestionStatus: VoiceCoachQuestionStatus;
  voiceCoachQuestionError: string | null;
  voiceSpeechRecognitionStatus: VoiceSpeechRecognitionStatus;
  voiceSpeechRecognitionError: string | null;
  voiceDeepTutorLessonStatus: VoiceDeepTutorLessonStatus;
  voiceDeepTutorLessonError: string | null;
  voiceTransportStatus: VoicePracticeTransportStatus;
  voiceSessionArmed: boolean;
  voiceTakeActive: boolean;
  voiceTakeProcessing: boolean;
  voiceAudioInputDevices: VoiceRenderAudioInputDevice[];
  selectedInputDeviceId: string | null;
  voiceResolvedInputLabel: string | null;
  voiceAudioInputStatus: VoiceAudioInputStatus;
  voiceAudioInputError: string | null;
  voiceAudioInputNotice: string | null;
  liveFrame: VoiceLiveFrame | null;
  liveTrace: VoiceLiveFrame[] | null | undefined;
  lastTakeTrace: VoiceLiveFrame[] | null | undefined;
  overlayVisibility: VoiceRenderOverlayVisibility;
  audioInputOptionsSignature: string;
  selectionPendingId: string | null;
  onSelectDrill: (drillId: string) => Promise<void>;
  onSelectError: (error: unknown) => void;
  referenceHydrationView: VoiceReferenceHydrationView;
  referencePlayerPaused: boolean;
  referenceFrame: VoiceLiveFrame | null;
  voiceRuntimeStatus: VoiceRuntimeStatusState;
  voiceRuntimeEnvironment: VoiceRuntimeEnvironment;
  requestedSpeechProvider: VoiceCoachSpeechProvider;
  requestedInputProvider: VoiceCoachInputProvider;
  inputProviderFallbackActive: boolean;
  speechProviderFallbackActive: boolean;
  inputCapabilities: VoiceCoachInputCapabilities | null;
  inputRecovery: VoiceInputRecoveryState;
  handsFreeVoiceInputSupported: boolean;
  voiceCoachInputAvailable: boolean;
  voiceCoachSpeechOutputAvailable: boolean;
  canUseVoiceAsk: boolean;
  pendingCoachChannel: VoiceCoachMessageChannel | null;
  ownerCopy: string | null;
  interactionOwner: VoiceInteractionOwner;
  voiceConditioningStatusText: string;
  shouldRebuildDeepTutorVoiceLesson: boolean;
  deepTutorResumeButtonText: string;
  conditioningPromptFileSelected: boolean;
  conditioningPromptTextPresent: boolean;
  conditioningReferenceFileSelected: boolean;
};

export type VoiceRenderStateBundle = {
  summaryState: VoiceRenderSummaryDomState;
  controlsState: VoiceRenderControlsDomState;
  orchestrationState: VoiceRenderOrchestrationState;
};

function hasVoiceLiveSession(
  voiceUiState: VoiceUiState,
  context: Pick<
    VoiceRenderStateContext,
    'voiceSessionArmed' | 'voiceTakeActive' | 'voiceTakeProcessing'
  >,
): boolean {
  return Boolean(
    voiceUiState.voiceSessionId
      && (
        context.voiceSessionArmed
        || context.voiceTakeActive
        || context.voiceTakeProcessing
        || ['ready', 'active'].includes(voiceUiState.status)
      ),
  );
}

function getVoicePracticeTargetMutationLocked(
  voiceUiState: VoiceUiState,
  context: Pick<
    VoiceRenderStateContext,
    'voiceSessionArmed' | 'voiceTakeActive' | 'voiceTakeProcessing'
  >,
  deepTutorOwnsLineSelection: boolean,
): boolean {
  return isVoicePracticeTargetLocked(voiceUiState)
    || deepTutorOwnsLineSelection
    || context.voiceSessionArmed
    || context.voiceTakeActive
    || context.voiceTakeProcessing;
}

export function buildVoiceRenderState(context: VoiceRenderStateContext): VoiceRenderStateBundle {
  const { viewModelContext, voiceRuntimeStatus } = context;
  const { voiceUiState, voiceDrillState } = viewModelContext;
  const deeptutorVoiceState = normalizeDeepTutorVoiceState(voiceUiState.deeptutorVoiceState);
  const deepTutorOwnsLineSelection = isDeepTutorVoiceGuideInProgress(deeptutorVoiceState);
  const deeptutorGuideActive = getDeepTutorVoiceLessonMode(deeptutorVoiceState) === 'active';
  const selectedDrill = getSelectedVoiceDrill(voiceDrillState);
  const recommendedDrills = getRecommendedVoiceDrills(voiceDrillState);
  const comparison = getRenderableVoicePhraseComparison(viewModelContext);
  const referenceMimicState = getVoiceReferenceMimicState({
    voiceUiState,
    comparison,
  });
  const referenceMimicProgress = getVoiceReferenceMimicProgressState(
    voiceUiState.deeptutorVoiceState,
    referenceMimicState,
  );
  const summaryMetrics = voiceUiState.lastSummary?.metrics || null;
  const summaryMeasurementUsable = isVoiceAttemptMeasurementUsable(summaryMetrics);
  const summaryMeasurementRejected = Boolean(summaryMetrics) && !summaryMeasurementUsable;
  const liveMetrics = getVoiceMetricsFromFrame(context.liveFrame)
    || (summaryMeasurementUsable ? summaryMetrics : null);
  const referenceMetrics = getVoiceMetricsFromFrame(context.referenceFrame)
    || voiceUiState.referenceAnalysis?.metrics
    || voiceUiState.targetVoiceProfile?.metrics
    || null;
  const liveVoiceSessionId = voiceUiState.voiceSessionId || '';
  const lastSummarySessionId = voiceUiState.lastSummary?.voiceSessionId || '';
  const liveSession = hasVoiceLiveSession(voiceUiState, context);
  const livePathTimeline = context.voiceTakeActive
    ? context.liveTrace
    : (summaryMeasurementRejected ? [] : (voiceUiState.lastTakeTimeline || context.lastTakeTrace));
  const referencePathTimeline = voiceUiState.referenceAnalysis?.timeline;
  const forecastPathTimeline = voiceUiState.phraseForecast?.timeline;
  const hasLivePath = hasVoiceTimelinePath(livePathTimeline);
  const hasForecastPath = hasVoiceTimelinePath(forecastPathTimeline);
  const hasReferencePath = hasVoiceTimelinePath(referencePathTimeline);
  const activeLine = getVoiceActiveLine(voiceUiState);
  const cueSheet = getCurrentVoiceCueSheet(viewModelContext);
  const comparisonMatchesCueSheet = isVoiceComparisonMatchCueSheet({
    cueSheet,
    comparison,
    normalizePhraseText: normalizeVoicePhraseTextForMatch,
  });
  const referenceView = getVoiceReferenceViewModel({
    voiceUiState,
    referenceMimicState,
    referenceMimicProgress,
    referenceHydrationFailed: context.referenceHydrationView.hydrationFailed,
    referenceHydrationError: context.referenceHydrationView.hydrationError,
    referenceHydrationInFlight: context.referenceHydrationView.hydrationInFlight,
    hasPlayableReference: context.referenceHydrationView.hasPlayableReference,
    hasReferencePath,
    referencePlayerPaused: context.referencePlayerPaused,
  });
  const sidebarSummaryView = getVoiceSidebarSummaryViewModel({
    ...viewModelContext,
    voiceKnowledgeStatusText: voiceRuntimeStatus.knowledgeStatusText,
    voiceTakeActive: context.voiceTakeActive,
    voiceSessionArmed: context.voiceSessionArmed,
    liveVoiceSessionId,
  });
  const stageView = getVoiceStageViewModel({
    voiceUiState,
    selectedDrill,
    comparison,
    liveVoiceSessionId,
    lastSummarySessionId,
    streamUrl: context.streamUrl,
    liveSession,
    voiceTakeActive: context.voiceTakeActive,
    voiceSessionArmed: context.voiceSessionArmed,
    voiceTakeProcessing: context.voiceTakeProcessing,
    voiceTransportStatus: context.voiceTransportStatus,
  });
  const voiceConditioning = normalizeVoiceConditioningState(voiceUiState.voiceConditioning);
  const inputRuntime = normalizeVoiceInputRuntimeState(voiceUiState.voiceInputRuntime);
  const coachSupport = getVoiceCoachSupportViewModel({
    currentSessionId: context.currentSessionId,
    isConnected: context.isConnected,
    requestedSpeechProvider: context.requestedSpeechProvider,
    speechProviderFallbackActive: context.speechProviderFallbackActive,
    voiceCoachVoxCpmError: voiceRuntimeStatus.speech.voxcpm.error,
    voiceCoachVoxCpmEnabled: voiceRuntimeStatus.speech.voxcpm.enabled,
    requestedInputProvider: context.requestedInputProvider,
    inputProviderFallbackActive: context.inputProviderFallbackActive,
    voiceCoachInputBackendError: voiceRuntimeStatus.input.backend.error,
    voiceCoachInputBackendEnabled: voiceRuntimeStatus.input.backend.enabled,
    canUseBackendVoiceCoachCapture: context.voiceRuntimeEnvironment.canUseBackendCapture,
    browserSpeechRecognitionSupported: context.voiceRuntimeEnvironment.browserSpeechRecognitionSupported,
    backendInputCapabilities: voiceRuntimeStatus.input.backend.capabilities,
    effectiveInputCapabilities: context.inputCapabilities,
    backendLiveStatus: voiceRuntimeStatus.input.backend.liveStatus,
  });
  const inputPanel = getVoiceInputPanelViewModel({
    comparison,
    voiceTransportStatus: context.voiceTransportStatus,
    voiceResolvedInputLabel: context.voiceResolvedInputLabel,
    voiceAudioInputDevices: context.voiceAudioInputDevices,
    selectedInputDeviceId: context.selectedInputDeviceId,
    voiceTakeProcessing: context.voiceTakeProcessing,
    voiceTakeActive: context.voiceTakeActive,
    voiceSessionArmed: context.voiceSessionArmed,
    voiceAudioInputStatus: context.voiceAudioInputStatus,
    voiceAudioInputError: context.voiceAudioInputError,
    voiceAudioInputNotice: context.voiceAudioInputNotice,
    liveLoudnessDb: context.liveFrame?.loudnessDb ?? null,
    liveConfidence: context.liveFrame?.confidence ?? null,
  });
  const latestCoachMessage = getLatestVoiceCoachThreadMessage(voiceUiState.coachThread, 'coach');
  const latestCoachCopy = getVoiceCoachCopy(viewModelContext);
  const latestCoachLabel = getVoiceCoachMessageLabel(latestCoachMessage, {
    hasActiveGuideSession: deepTutorOwnsLineSelection,
  });
  const coachPanelCopyText = getVoiceCoachPanelCopy({
    latestCoachMessage,
    latestCoachCopy,
    latestCoachLabel,
    voiceCoachQuestionStatus: context.voiceCoachQuestionStatus,
    voiceCoachQuestionError: context.voiceCoachQuestionError,
    voiceSpeechRecognitionStatus: context.voiceSpeechRecognitionStatus,
    voiceSpeechRecognitionError: context.voiceSpeechRecognitionError,
    voiceDeepTutorLessonStatus: context.voiceDeepTutorLessonStatus,
    voiceDeepTutorLessonError: context.voiceDeepTutorLessonError,
    requestedInputProvider: context.requestedInputProvider,
    inputProviderFallbackActive: context.inputProviderFallbackActive,
    backendLivePathLabel: coachSupport.backendLivePathLabel,
    inputRecovery: context.inputRecovery,
    inputProviderFallbackReason: coachSupport.inputProviderFallbackReason,
    inputCapabilityCopy: coachSupport.inputCapabilityCopy,
    speechEnabled: Boolean(voiceUiState.coachVoice?.speechEnabled),
    voxcpmFallbackReason: coachSupport.voxcpmFallbackReason,
    continuousEnabled: Boolean(voiceUiState.coachVoice?.continuousEnabled),
    handsFreeVoiceInputSupported: context.handsFreeVoiceInputSupported,
    ownerCopy: context.ownerCopy,
  });
  const inputRuntimeView = getVoiceInputRuntimeViewModel(inputRuntime, {
    backendLivePathLabel: coachSupport.backendLivePathLabel,
    runtimePill: context.inputRecovery.runtimePill,
  });
  const voicePracticeTargetLocked = getVoicePracticeTargetMutationLocked(
    voiceUiState,
    context,
    deepTutorOwnsLineSelection,
  );
  const panelControls = getVoicePanelControlsViewModel({
    voiceUiState,
    voiceConditioning,
    voiceConditioningStatusText: context.voiceConditioningStatusText,
    voicePracticeTargetLocked,
    currentSessionId: context.currentSessionId,
    isConnected: context.isConnected,
    voiceForecastStatus: viewModelContext.voiceForecastStatus,
    voiceSessionArmed: context.voiceSessionArmed,
    voiceTakeProcessing: context.voiceTakeProcessing,
    voiceTakeActive: context.voiceTakeActive,
    voiceTransportStatus: context.voiceTransportStatus,
    deepTutorOwnsLineSelection,
    activeLine,
    voiceDeepTutorLessonStatus: context.voiceDeepTutorLessonStatus,
    shouldRebuildDeepTutorVoiceLesson: context.shouldRebuildDeepTutorVoiceLesson,
    deepTutorVoiceRoutesEnabled: voiceRuntimeStatus.deepTutorVoiceRoutesEnabled !== false,
    voiceCoachQuestionStatus: context.voiceCoachQuestionStatus,
    voiceAudioInputDevicesCount: context.voiceAudioInputDevices.length,
    conditioningPromptFileSelected: context.conditioningPromptFileSelected,
    conditioningPromptTextPresent: context.conditioningPromptTextPresent,
    conditioningReferenceFileSelected: context.conditioningReferenceFileSelected,
  });
  const coachControls = getVoiceCoachControlsViewModel({
    currentSessionId: context.currentSessionId,
    isConnected: context.isConnected,
    handsFreeEnabled: Boolean(voiceUiState.coachVoice?.continuousEnabled),
    voiceCoachInputAvailable: context.voiceCoachInputAvailable,
    handsFreeVoiceInputSupported: context.handsFreeVoiceInputSupported,
    inputRecovery: context.inputRecovery,
    voiceSpeechRecognitionStatus: context.voiceSpeechRecognitionStatus,
    canUseVoiceAsk: context.canUseVoiceAsk,
    interactionOwner: context.interactionOwner,
    deeptutorGuideActive,
    speechEnabled: Boolean(voiceUiState.coachVoice?.speechEnabled),
    voiceCoachSpeechOutputAvailable: context.voiceCoachSpeechOutputAvailable,
    requestedSpeechProvider: context.requestedSpeechProvider,
    speechProviderFallbackActive: context.speechProviderFallbackActive,
    voiceCoachVoxCpmError: voiceRuntimeStatus.speech.voxcpm.error,
    requestedInputProvider: context.requestedInputProvider,
    inputProviderFallbackActive: context.inputProviderFallbackActive,
    voiceCoachInputBackendError: voiceRuntimeStatus.input.backend.error,
    browserSpeechRecognitionSupported: context.voiceRuntimeEnvironment.browserSpeechRecognitionSupported,
    backendInputBaseTitle: coachSupport.backendInputBaseTitle,
    inputProviderHint: context.inputRecovery.providerHint,
  });
  const scriptPad = getVoiceScriptPadViewModel({
    voiceUiState,
    voiceDrillState,
  });
  const coachThreadView = getVoiceCoachThreadViewModel({
    coachThread: voiceUiState.coachThread,
    voiceCoachTaskStatus: viewModelContext.voiceCoachTaskStatus,
    voiceCoachQuestionStatus: context.voiceCoachQuestionStatus,
    pendingCoachChannel: context.pendingCoachChannel,
    hasActiveGuideSession: deepTutorOwnsLineSelection,
    emptyCopy: latestCoachCopy,
  });

  return {
    summaryState: {
      sidebarSummaryView,
      coachPanelCopyText,
      cueSheetCopyText: getVoiceCueSheetCopyText(viewModelContext),
      phraseComparisonCopyText: getVoicePhraseComparisonText(viewModelContext),
      forecastCopyText: getVoiceForecastText(viewModelContext),
      inputPanel,
      inputRuntimeView,
      stageView,
      referenceView,
      activeDrillCopyText: getVoiceActiveDrillCopyText({
        voiceUiState,
        inputRecovery: context.inputRecovery,
        inputRuntime,
        voiceSpeechRecognitionStatus: context.voiceSpeechRecognitionStatus,
        voiceSessionArmed: context.voiceSessionArmed,
        voiceTransportStatus: context.voiceTransportStatus,
        backendLivePathLabel: coachSupport.backendLivePathLabel,
        referenceMimicState,
        referenceMimicProgress,
      }),
      activeDrillStateText: getVoiceActiveDrillStateLabel({
        voiceUiState,
        inputRecovery: context.inputRecovery,
        voiceDeepTutorLessonStatus: context.voiceDeepTutorLessonStatus,
        voiceCoachTaskStatus: viewModelContext.voiceCoachTaskStatus,
        voiceTakeProcessing: context.voiceTakeProcessing,
        voiceTakeActive: context.voiceTakeActive,
        voiceTransportStatus: context.voiceTransportStatus,
        voiceSessionArmed: context.voiceSessionArmed,
      }),
      isVoiceMode: context.isVoiceMode,
    },
    controlsState: {
      panelControls,
      coachControls,
    },
    orchestrationState: {
      voiceAudioInputDevices: context.voiceAudioInputDevices,
      selectedInputDeviceId: context.selectedInputDeviceId,
      audioInputOptionsSignature: context.audioInputOptionsSignature,
      overlayVisibility: context.overlayVisibility,
      hasLivePath,
      hasForecastPath,
      hasReferencePath,
      recommendedDrills,
      selectedDrillId: selectedDrill?.id || null,
      drillStatus: viewModelContext.voiceDrillStatus,
      currentSessionId: context.currentSessionId,
      isConnected: context.isConnected,
      targetMutationLocked: voicePracticeTargetLocked,
      selectionPendingId: context.selectionPendingId,
      onSelectDrill: context.onSelectDrill,
      onSelectError: context.onSelectError,
      drillState: voiceDrillState,
      drillError: viewModelContext.voiceDrillError,
      cueSheet,
      comparison,
      comparisonMatchesCueSheet,
      hasForecastTimeline: Boolean(forecastPathTimeline?.length),
      customTargetPresets: voiceUiState.customTargetPresets,
      selectedCustomPresetId: voiceUiState.selectedCustomPresetId,
      targetSource: voiceUiState.targetSource,
      scriptPad,
      deepTutorResumeButtonText: context.deepTutorResumeButtonText,
      deepTutorNextButtonText: context.voiceDeepTutorLessonStatus === 'loading' ? 'Advancing...' : 'Advance Lesson',
      linePinButtonText: activeLine?.pinned ? 'Pinned' : 'Pin Line',
      coachThread: coachThreadView,
      liveMetrics,
      referenceMetrics,
      referencePathTimeline,
      forecastPathTimeline,
      livePathTimeline,
    },
  };
}
