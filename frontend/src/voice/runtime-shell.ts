import {
  normalizeVoiceInputRuntimeState,
  type VoiceUiState,
  type VoiceInputRuntimeState,
} from './state';
import {
  createVoiceRuntimeStatusController,
  type VoiceCoachInputCapabilities,
  type VoiceCoachInputProvider,
  type VoiceCoachSpeechProvider,
  type VoiceInputRecoveryState,
  type VoiceRuntimeEnvironment,
} from './runtime-status';

type VoiceRuntimeShellOptions = {
  runtimeStatusController: ReturnType<typeof createVoiceRuntimeStatusController>;
  getCurrentMode: () => string;
  getCurrentSessionId: () => string | null;
  getIsConnected: () => boolean;
  getVoiceUiState: () => VoiceUiState;
  canUseBackendCapture: () => boolean;
  canUseBackendRecordedFallback: () => boolean;
  hasBrowserSpeechRecognitionSupport: () => boolean;
  hasBrowserSpeechSynthesisSupport: () => boolean;
};

export type VoiceRuntimeShell = ReturnType<typeof createVoiceRuntimeShell>;

export function createVoiceRuntimeShell(options: VoiceRuntimeShellOptions) {
  function getRequestedSpeechProvider(): VoiceCoachSpeechProvider {
    return options.getVoiceUiState().coachVoice?.speechProvider === 'voxcpm' ? 'voxcpm' : 'browser';
  }

  function getRequestedInputProvider(): VoiceCoachInputProvider {
    return options.getVoiceUiState().coachVoice?.inputProvider === 'backend' ? 'backend' : 'browser';
  }

  function getRuntimeEnvironment(): VoiceRuntimeEnvironment {
    return {
      currentMode: options.getCurrentMode(),
      currentSessionId: options.getCurrentSessionId(),
      isConnected: options.getIsConnected(),
      browserSpeechRecognitionSupported: options.hasBrowserSpeechRecognitionSupport(),
      browserSpeechSynthesisSupported: options.hasBrowserSpeechSynthesisSupport(),
      canUseBackendCapture: options.canUseBackendCapture(),
      canUseBackendRecordedFallback: options.canUseBackendRecordedFallback(),
    };
  }

  function getEffectiveInputProvider(
    requestedProvider: VoiceCoachInputProvider = getRequestedInputProvider(),
  ): VoiceCoachInputProvider | null {
    return options.runtimeStatusController.getEffectiveInputProvider({
      ...getRuntimeEnvironment(),
      requestedProvider,
    });
  }

  function isInputProviderFallbackActive(
    requestedProvider: VoiceCoachInputProvider = getRequestedInputProvider(),
    effectiveProvider: VoiceCoachInputProvider | null = getEffectiveInputProvider(requestedProvider),
  ): boolean {
    return options.runtimeStatusController.isInputProviderFallbackActive({
      ...getRuntimeEnvironment(),
      requestedProvider,
    }, effectiveProvider);
  }

  function getEffectiveInputCapabilities(
    requestedProvider: VoiceCoachInputProvider = getRequestedInputProvider(),
    effectiveProvider: VoiceCoachInputProvider | null = getEffectiveInputProvider(requestedProvider),
  ): VoiceCoachInputCapabilities | null {
    return options.runtimeStatusController.getEffectiveInputCapabilities({
      ...getRuntimeEnvironment(),
      requestedProvider,
    }, effectiveProvider);
  }

  function supportsAutomaticTurnBoundary(
    provider: VoiceCoachInputProvider | null = getEffectiveInputProvider(),
    capabilities: VoiceCoachInputCapabilities | null = getEffectiveInputCapabilities(),
  ): boolean {
    if (provider === 'browser') {
      return true;
    }
    if (provider === 'backend') {
      return Boolean(
        capabilities?.liveCapture
        || (capabilities?.recordedCapture && capabilities?.automaticTurnBoundary),
      );
    }
    return false;
  }

  function getInputRecoveryState(
    runtime = normalizeVoiceInputRuntimeState(options.getVoiceUiState().voiceInputRuntime),
    overrideOptions: {
      requestedInputProvider?: VoiceCoachInputProvider;
      effectiveInputProvider?: VoiceCoachInputProvider | null;
      inputProviderFallbackActive?: boolean;
    } = {},
  ): VoiceInputRecoveryState {
    return options.runtimeStatusController.getInputRecoveryState(runtime, {
      ...getRuntimeEnvironment(),
      requestedInputProvider: overrideOptions.requestedInputProvider ?? getRequestedInputProvider(),
      effectiveInputProvider: overrideOptions.effectiveInputProvider,
      inputProviderFallbackActive: overrideOptions.inputProviderFallbackActive,
    });
  }

  function buildInputRuntimeRecoveryReset(
    runtime = normalizeVoiceInputRuntimeState(options.getVoiceUiState().voiceInputRuntime),
    resetOptions: {
      requestedProvider?: VoiceCoachInputProvider;
      effectiveProvider?: VoiceCoachInputProvider | null;
      captureProvider?: VoiceCoachInputProvider | null;
    } = {},
  ): VoiceInputRuntimeState {
    return options.runtimeStatusController.buildInputRuntimeRecoveryReset(runtime, resetOptions);
  }

  function getEffectiveSpeechProvider(
    requestedProvider: VoiceCoachSpeechProvider = getRequestedSpeechProvider(),
  ): VoiceCoachSpeechProvider | null {
    return options.runtimeStatusController.getEffectiveSpeechProvider({
      ...getRuntimeEnvironment(),
      requestedProvider,
    });
  }

  function isSpeechProviderFallbackActive(
    requestedProvider: VoiceCoachSpeechProvider = getRequestedSpeechProvider(),
    effectiveProvider: VoiceCoachSpeechProvider | null = getEffectiveSpeechProvider(requestedProvider),
  ): boolean {
    return options.runtimeStatusController.isSpeechProviderFallbackActive({
      ...getRuntimeEnvironment(),
      requestedProvider,
    }, effectiveProvider);
  }

  function getConditioningStatusText(): string {
    const voiceUiState = options.getVoiceUiState();
    const runtimeStatus = options.runtimeStatusController.getState();
    return options.runtimeStatusController.getConditioningStatusText(
      voiceUiState.voiceConditioning,
      voiceUiState.targetVoiceProfile,
      voiceUiState.referenceClipId || null,
      runtimeStatus.speech.voxcpm.available === true,
    );
  }

  return {
    getRequestedSpeechProvider,
    getRequestedInputProvider,
    canUseBackendCapture: () => options.canUseBackendCapture(),
    canUseBackendRecordedFallback: () => options.canUseBackendRecordedFallback(),
    hasBrowserSpeechRecognitionSupport: () => options.hasBrowserSpeechRecognitionSupport(),
    hasBrowserSpeechSynthesisSupport: () => options.hasBrowserSpeechSynthesisSupport(),
    getRuntimeEnvironment,
    getEffectiveInputProvider,
    isInputProviderFallbackActive,
    getEffectiveInputCapabilities,
    supportsAutomaticTurnBoundary,
    getInputRecoveryState,
    buildInputRuntimeRecoveryReset,
    getEffectiveSpeechProvider,
    isSpeechProviderFallbackActive,
    getConditioningStatusText,
  };
}
