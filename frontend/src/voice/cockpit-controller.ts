import type { VoiceCockpitLineAction } from './api';
import type {
  VoiceCoachInputCapabilities,
  VoiceCoachInputProvider,
  VoiceCoachSpeechProvider,
} from './contracts';
import type {
  VoiceAdvancedPanelState,
  VoiceBackendPayload,
  VoiceCoachVoiceState,
  VoiceConditioningState,
  VoiceInputRecoveryState,
  VoiceInputRuntimeState,
  VoiceUiState,
} from './state';

type VoiceCockpitStatePatch = {
  coachVoice?: Partial<VoiceCoachVoiceState>;
  voiceInputRuntime?: Partial<VoiceInputRuntimeState>;
  advancedPanel?: Partial<VoiceAdvancedPanelState>;
};

type VoiceCockpitControllerOptions = {
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
  };
  getVoiceUiState: () => VoiceUiState;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  persistCockpitStateRequest: (
    sessionId: string,
    patch: VoiceCockpitStatePatch,
    currentState: {
      coachVoice: VoiceCoachVoiceState;
      voiceInputRuntime: VoiceInputRuntimeState;
      advancedPanel: VoiceAdvancedPanelState;
    },
  ) => Promise<VoiceBackendPayload>;
  persistConditioningStateRequest: (
    sessionId: string,
    nextConditioning: VoiceConditioningState,
  ) => Promise<VoiceBackendPayload>;
  refreshCockpitLineRequest: (
    sessionId: string,
    action: VoiceCockpitLineAction,
  ) => Promise<VoiceBackendPayload>;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  assertPracticeTargetUnlocked: (actionLabel: string) => void;
  stopCoachListening: (resetTranscript?: boolean) => void;
  stopCoachSpeech: () => void;
  ensureContinuousLoop: () => void;
  setLastSpokenCoachMessageId: (messageId: string | null) => void;
  addTerminalLine: (type: 'system' | 'user' | 'assistant' | 'error', content: string) => void;
  render: () => void;
  getRequestedSpeechProvider: () => VoiceCoachSpeechProvider;
  getRequestedInputProvider: () => VoiceCoachInputProvider;
  getEffectiveInputProvider: (requestedProvider?: VoiceCoachInputProvider) => VoiceCoachInputProvider | null;
  getEffectiveInputCapabilities: (
    requestedProvider?: VoiceCoachInputProvider,
    effectiveProvider?: VoiceCoachInputProvider | null,
  ) => VoiceCoachInputCapabilities | null;
  supportsAutomaticTurnBoundary: (
    provider?: VoiceCoachInputProvider | null,
    capabilities?: VoiceCoachInputCapabilities | null,
  ) => boolean;
  hasBrowserSpeechRecognitionSupport: () => boolean;
  getNextInputProvider: (requestedProvider: VoiceCoachInputProvider) => VoiceCoachInputProvider;
  buildInputRuntimeRecoveryReset: (
    runtime: VoiceInputRuntimeState,
    options?: {
      requestedProvider?: VoiceCoachInputProvider;
      effectiveProvider?: VoiceCoachInputProvider | null;
      captureProvider?: VoiceCoachInputProvider | null;
    },
  ) => VoiceInputRuntimeState;
  getInputRecoveryState: () => VoiceInputRecoveryState;
};

export function createVoiceCockpitController(options: VoiceCockpitControllerOptions) {
  async function updateCockpitState(patch: VoiceCockpitStatePatch): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      options.updateVoiceUiState((state) => ({
        ...state,
        coachVoice: patch.coachVoice ? { ...state.coachVoice, ...patch.coachVoice } : state.coachVoice,
        voiceInputRuntime: patch.voiceInputRuntime
          ? { ...state.voiceInputRuntime, ...patch.voiceInputRuntime }
          : state.voiceInputRuntime,
        advancedPanel: patch.advancedPanel ? { ...state.advancedPanel, ...patch.advancedPanel } : state.advancedPanel,
      }));
      return;
    }

    const state = options.getVoiceUiState();
    const data = await options.persistCockpitStateRequest(currentSessionId, patch, {
      coachVoice: state.coachVoice,
      voiceInputRuntime: state.voiceInputRuntime,
      advancedPanel: state.advancedPanel,
    });
    options.applyVoiceBackendPayload(data);
  }

  async function updateConditioningState(patch: Partial<VoiceConditioningState>): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      options.updateVoiceUiState((state) => ({
        ...state,
        voiceConditioning: {
          ...state.voiceConditioning,
          ...patch,
        },
      }));
      return;
    }

    const state = options.getVoiceUiState();
    const data = await options.persistConditioningStateRequest(currentSessionId, {
      ...state.voiceConditioning,
      ...patch,
    });
    options.applyVoiceBackendPayload(data);
  }

  async function refreshLine(action: VoiceCockpitLineAction = 'ensure'): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      return;
    }
    if (action !== 'ensure') {
      options.assertPracticeTargetUnlocked('changing the practice line');
    }

    const data = await options.refreshCockpitLineRequest(currentSessionId, action);
    options.applyVoiceBackendPayload(data);
  }

  async function setContinuousMode(
    enabled: boolean,
    persistence: 'persist' | 'local-only' = 'persist',
  ): Promise<boolean> {
    const nextContinuousEnabled = Boolean(enabled);
    if (
      nextContinuousEnabled
      && Boolean(options.getVoiceUiState().coachVoice?.continuousEnabled) === nextContinuousEnabled
    ) {
      return true;
    }
    if (nextContinuousEnabled && persistence === 'persist') {
      const recovery = options.getInputRecoveryState();
      const requestedInputProvider = options.getRequestedInputProvider();
      const effectiveInputProvider = options.getEffectiveInputProvider(requestedInputProvider);
      const inputCapabilities = options.getEffectiveInputCapabilities(
        requestedInputProvider,
        effectiveInputProvider,
      );

      if (!options.supportsAutomaticTurnBoundary(effectiveInputProvider, inputCapabilities)) {
        options.addTerminalLine('system', 'Hands-free coach currently needs browser speech recognition or backend input with local turn-boundary capture.');
        options.render();
        return false;
      }
      if (recovery.shouldDisableContinuous) {
        options.addTerminalLine('system', recovery.disableReason || 'Hands-free is paused until the input path recovers.');
        options.render();
        return false;
      }
    }

    // Disable is fail-closed locally: even if persistence is unavailable, no
    // render/handoff may observe continuous mode as enabled and reopen the mic.
    if (!nextContinuousEnabled) {
      options.stopCoachListening(true);
      options.updateVoiceUiState((state) => ({
        ...state,
        coachVoice: {
          ...state.coachVoice,
          continuousEnabled: false,
        },
      }));
      options.render();
    }

    if (persistence === 'persist') {
      // If this rejects, the optimistic false state above is intentionally kept.
      await updateCockpitState({
        coachVoice: {
          continuousEnabled: nextContinuousEnabled,
        },
      });
    } else {
      options.updateVoiceUiState((state) => ({
        ...state,
        coachVoice: {
          ...state.coachVoice,
          continuousEnabled: nextContinuousEnabled,
        },
      }));
    }
    if (Boolean(options.getVoiceUiState().coachVoice?.continuousEnabled) !== nextContinuousEnabled) {
      if (!nextContinuousEnabled) {
        options.updateVoiceUiState((state) => ({
          ...state,
          coachVoice: {
            ...state.coachVoice,
            continuousEnabled: false,
          },
        }));
        options.stopCoachListening(true);
        options.render();
      }
      return false;
    }
    if (!nextContinuousEnabled) {
      return true;
    }
    // Start uses local-only only after the live microphone socket is already
    // accepted. Re-running the legacy loop coordinator here can arm the hidden
    // practice transport, which then cancels the next visible Coach Start while
    // trying to release that stale owner. The accepted socket is already the
    // continuous lesson transport; this step only commits its local mode flag.
    if (persistence === 'local-only') {
      options.render();
      return true;
    }
    options.ensureContinuousLoop();
    options.render();
    return true;
  }

  async function toggleContinuousMode(): Promise<void> {
    const nextContinuousEnabled = !options.getVoiceUiState().coachVoice?.continuousEnabled;
    try {
      await setContinuousMode(nextContinuousEnabled);
    } catch (error) {
      options.addTerminalLine('system', `Hands-free coach update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function toggleSpeechProvider(): Promise<void> {
    const nextProvider: VoiceCoachSpeechProvider = options.getRequestedSpeechProvider() === 'browser' ? 'voxcpm' : 'browser';
    options.stopCoachSpeech();

    try {
      await updateCockpitState({
        coachVoice: {
          speechProvider: nextProvider,
        },
      });
      if (options.getVoiceUiState().coachVoice?.speechEnabled) {
        options.setLastSpokenCoachMessageId(null);
      }
      options.render();
    } catch (error) {
      options.addTerminalLine('system', `Coach speech provider update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function toggleInputProvider(): Promise<void> {
    const requestedProvider = options.getRequestedInputProvider();
    const nextProvider = options.getNextInputProvider(requestedProvider);
    if (nextProvider === 'browser' && !options.hasBrowserSpeechRecognitionSupport()) {
      options.addTerminalLine('system', 'Browser speech recognition is unavailable in this browser, so coach input stays on the backend path.');
      options.render();
      return;
    }

    const state = options.getVoiceUiState();
    const nextEffectiveProvider = options.getEffectiveInputProvider(nextProvider);
    const nextCapabilities = options.getEffectiveInputCapabilities(nextProvider, nextEffectiveProvider);
    const nextRuntime = options.buildInputRuntimeRecoveryReset(state.voiceInputRuntime, {
      requestedProvider: nextProvider,
      effectiveProvider: nextEffectiveProvider,
      captureProvider: null,
    });
    const nextContinuousEnabled = Boolean(
      state.coachVoice?.continuousEnabled
      && nextEffectiveProvider
      && options.supportsAutomaticTurnBoundary(nextEffectiveProvider, nextCapabilities),
    );

    options.stopCoachListening(true);

    try {
      await updateCockpitState({
        coachVoice: {
          inputProvider: nextProvider,
          continuousEnabled: nextContinuousEnabled,
        },
        voiceInputRuntime: nextRuntime,
      });
      if (options.getVoiceUiState().coachVoice?.continuousEnabled) {
        options.ensureContinuousLoop();
      }
      options.render();
    } catch (error) {
      options.addTerminalLine('system', `Coach input provider update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function toggleSpeechEnabled(): Promise<void> {
    const nextSpeechEnabled = !options.getVoiceUiState().coachVoice?.speechEnabled;
    if (!nextSpeechEnabled) {
      options.stopCoachSpeech();
    }

    try {
      await updateCockpitState({
        coachVoice: {
          speechEnabled: nextSpeechEnabled,
        },
      });
      if (nextSpeechEnabled) {
        options.setLastSpokenCoachMessageId(null);
      }
      options.render();
    } catch (error) {
      options.addTerminalLine('system', `Coach speech update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async function toggleAdvancedPanel(): Promise<void> {
    try {
      await updateCockpitState({
        advancedPanel: {
          open: !options.getVoiceUiState().advancedPanel.open,
        },
      });
      options.render();
    } catch (error) {
      options.addTerminalLine('system', `Advanced panel update failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    updateCockpitState,
    updateConditioningState,
    refreshLine,
    setContinuousMode,
    toggleContinuousMode,
    toggleSpeechProvider,
    toggleInputProvider,
    toggleSpeechEnabled,
    toggleAdvancedPanel,
  };
}
