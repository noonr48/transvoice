import type { VoiceAppRuntime } from './app-runtime';
import type { VoiceDomBindings } from './dom-bindings';
import {
  applyVoiceRenderControlsDom,
  applyVoiceRenderSummaryDom,
} from './render-dom';
import {
  applyVoiceRenderOrchestration,
} from './render/orchestration';
import {
  buildVoiceRenderState,
} from './render-state';
import type { VoiceReferenceRuntimeController } from './reference-runtime';
import type { VoiceRuntimeShell } from './runtime-shell';
import type { VoiceRuntimeStatusState } from './runtime-status';
import type { VoiceRuntimeStore } from './runtime-store';
import { getErrorMessage } from '../runtime-diagnostics';
import { normalizeVoiceInputRuntimeState, normalizeVoiceReferenceClipId } from './state';

type VoiceRenderControllerOptions = {
  store: VoiceRuntimeStore;
  appRuntime: VoiceAppRuntime;
  referenceRuntime: Pick<
    VoiceReferenceRuntimeController,
    'hydrateReferenceAnalysisIfNeeded' | 'getHydrationView'
  >;
  getCurrentMode: () => string;
  getCurrentSessionId: () => string | null;
  getIsConnected: () => boolean;
  getRuntimeShell: () => VoiceRuntimeShell | null;
  getRuntimeStatusState: () => VoiceRuntimeStatusState;
  getReferencePlayerState: () => {
    paused: boolean;
    currentTimeMs: number;
  };
  getConditioningDraftState: () => {
    promptFileSelected: boolean;
    promptTextPresent: boolean;
    referenceFileSelected: boolean;
  };
  getDomBindings: () => VoiceDomBindings | null;
  selectDrill: (drillId: string) => Promise<void>;
  addTerminalLine: (type: 'user' | 'assistant' | 'system', content: string) => void;
  finalizeRender: (mode: string) => Promise<unknown> | unknown;
};

type VoiceRenderControllerDependencies = {
  buildVoiceRenderState?: typeof buildVoiceRenderState;
  applyVoiceRenderSummaryDom?: typeof applyVoiceRenderSummaryDom;
  applyVoiceRenderControlsDom?: typeof applyVoiceRenderControlsDom;
  applyVoiceRenderOrchestration?: typeof applyVoiceRenderOrchestration;
};

export type VoiceRenderController = ReturnType<typeof createVoiceRenderController>;

export function createVoiceRenderController(
  options: VoiceRenderControllerOptions,
  dependencies: VoiceRenderControllerDependencies = {},
) {
  const buildVoiceRenderStateImpl = dependencies.buildVoiceRenderState || buildVoiceRenderState;
  const applyVoiceRenderSummaryDomImpl = dependencies.applyVoiceRenderSummaryDom || applyVoiceRenderSummaryDom;
  const applyVoiceRenderControlsDomImpl = dependencies.applyVoiceRenderControlsDom || applyVoiceRenderControlsDom;
  const applyVoiceRenderOrchestrationImpl = dependencies.applyVoiceRenderOrchestration || applyVoiceRenderOrchestration;

  let renderSequence = 0;

  function render(): void {
    const domBindings = options.getDomBindings();
    const runtimeShell = options.getRuntimeShell();
    if (!domBindings || !runtimeShell) {
      return;
    }

    const currentMode = options.getCurrentMode();
    const voiceState = options.store.getState();
    const voiceUiState = voiceState.voiceUiState;
    const sequence = ++renderSequence;
    const normalizedReferenceClipId = normalizeVoiceReferenceClipId(voiceUiState.referenceClipId);
    if (currentMode === 'voice' && normalizedReferenceClipId) {
      void options.referenceRuntime.hydrateReferenceAnalysisIfNeeded();
    }

    const referenceHydrationView = options.referenceRuntime.getHydrationView(normalizedReferenceClipId);
    const voiceRuntimeStatus = options.getRuntimeStatusState();
    const voiceRuntimeEnvironment = runtimeShell.getRuntimeEnvironment();
    const requestedSpeechProvider = runtimeShell.getRequestedSpeechProvider();
    const requestedInputProvider = runtimeShell.getRequestedInputProvider();
    const effectiveInputProvider = runtimeShell.getEffectiveInputProvider(requestedInputProvider);
    const inputRuntime = normalizeVoiceInputRuntimeState(voiceUiState.voiceInputRuntime);
    const inputProviderFallbackActive = runtimeShell.isInputProviderFallbackActive();
    const inputRecovery = runtimeShell.getInputRecoveryState(inputRuntime, {
      requestedInputProvider,
      effectiveInputProvider,
      inputProviderFallbackActive,
    });
    const inputCapabilities = runtimeShell.getEffectiveInputCapabilities();
    const handsFreeVoiceInputSupported = runtimeShell.supportsAutomaticTurnBoundary(
      effectiveInputProvider,
      inputCapabilities,
    );
    const speechProviderFallbackActive = runtimeShell.isSpeechProviderFallbackActive();
    const referencePlayerState = options.getReferencePlayerState();
    const conditioningDraftState = options.getConditioningDraftState();
    const renderState = buildVoiceRenderStateImpl({
      isVoiceMode: currentMode === 'voice',
      currentSessionId: options.getCurrentSessionId(),
      isConnected: options.getIsConnected(),
      streamUrl: options.appRuntime.getResolvedVoiceStreamUrl(),
      viewModelContext: options.appRuntime.getViewModelContext(),
      voiceCoachQuestionStatus: voiceState.voiceCoachQuestionStatus,
      voiceCoachQuestionError: voiceState.voiceCoachQuestionError,
      voiceSpeechRecognitionStatus: voiceState.voiceSpeechRecognition.status,
      voiceSpeechRecognitionError: voiceState.voiceSpeechRecognition.error,
      voiceDeepTutorLessonStatus: voiceState.voiceDeepTutorLessonStatus,
      voiceDeepTutorLessonError: voiceState.voiceDeepTutorLessonError,
      voiceTransportStatus: voiceState.voiceTransportStatus,
      voiceSessionArmed: voiceState.voiceSessionArmed,
      voiceTakeActive: voiceState.voiceTakeActive,
      voiceTakeProcessing: voiceState.voiceTakeProcessing,
      voiceAudioInputDevices: voiceState.voiceAudioInputDevices,
      selectedInputDeviceId: voiceState.voiceSelectedInputDeviceId,
      voiceResolvedInputLabel: voiceState.voiceResolvedInputLabel,
      voiceAudioInputStatus: voiceState.voiceAudioInputStatus,
      voiceAudioInputError: voiceState.voiceAudioInputError,
      voiceAudioInputNotice: voiceState.voiceAudioInputNotice,
      liveFrame: voiceState.voiceLiveFrame,
      liveTrace: voiceState.voiceLiveTrace,
      lastTakeTrace: voiceState.voiceLastTakeTrace,
      overlayVisibility: voiceState.voiceOverlayVisibility,
      audioInputOptionsSignature: voiceState.voiceInputOptionsSignature,
      selectionPendingId: voiceState.voiceDrillSelectionPendingId,
      onSelectDrill: (drillId) => options.selectDrill(drillId),
      onSelectError: (error) => {
        options.addTerminalLine('system', `Drill load failed: ${getErrorMessage(error)}`);
      },
      referenceHydrationView,
      referencePlayerPaused: referencePlayerState.paused,
      referenceFrame: options.appRuntime.getVoiceReferenceFrameAtMs(referencePlayerState.currentTimeMs),
      voiceRuntimeStatus,
      voiceRuntimeEnvironment,
      requestedSpeechProvider,
      requestedInputProvider,
      inputProviderFallbackActive,
      speechProviderFallbackActive,
      inputCapabilities,
      inputRecovery,
      handsFreeVoiceInputSupported,
      voiceCoachInputAvailable: Boolean(effectiveInputProvider),
      voiceCoachSpeechOutputAvailable: Boolean(runtimeShell.getEffectiveSpeechProvider()),
      canUseVoiceAsk: options.appRuntime.canUseVoiceCoachVoiceInput(),
      pendingCoachChannel: voiceState.voicePendingCoachChannel,
      ownerCopy: options.appRuntime.getVoiceInteractionOwnerCopy(),
      interactionOwner: options.appRuntime.getVoiceInteractionOwner(),
      voiceConditioningStatusText: runtimeShell.getConditioningStatusText(),
      shouldRebuildDeepTutorVoiceLesson: options.appRuntime.shouldRebuildDeepTutorVoiceLesson(),
      deepTutorResumeButtonText: options.appRuntime.getDeepTutorVoiceResumeButtonLabel(),
      conditioningPromptFileSelected: conditioningDraftState.promptFileSelected,
      conditioningPromptTextPresent: conditioningDraftState.promptTextPresent,
      conditioningReferenceFileSelected: conditioningDraftState.referenceFileSelected,
    });

    applyVoiceRenderSummaryDomImpl(domBindings.renderSummaryElements, renderState.summaryState);
    applyVoiceRenderControlsDomImpl(domBindings.renderControlsElements, renderState.controlsState);
    options.store.patchState({
      voiceInputOptionsSignature: applyVoiceRenderOrchestrationImpl(
        { ...domBindings.renderOrchestrationElements },
        renderState.orchestrationState,
      ),
    });
    void Promise.resolve()
      .then(() => {
        if (sequence !== renderSequence) {
          return;
        }
        return options.finalizeRender(currentMode);
      })
      .catch((error) => {
        console.warn('[Sloane] finalizeRender failed:', error);
      });
  }

  return {
    render,
  };
}
