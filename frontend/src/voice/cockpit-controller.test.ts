import { describe, expect, it, vi } from 'vitest';
import { createVoiceCockpitController } from './cockpit-controller';

function createVoiceState() {
  return {
    coachVoice: {
      speechEnabled: true,
      continuousEnabled: true,
      speechProvider: 'browser',
      inputProvider: 'backend',
    },
    voiceInputRuntime: {
      status: 'idle',
      requestedProvider: 'backend',
      effectiveProvider: 'backend',
      captureProvider: null,
    },
    advancedPanel: {
      open: false,
    },
    voiceConditioning: {
      useTargetProfileStyle: true,
      styleInstruction: '',
      promptText: '',
      promptAudioName: null,
      promptLatentsReady: false,
      referenceAudioName: null,
      referenceLatentsReady: false,
      updatedAt: null,
    },
  } as any;
}

describe('voice cockpit controller', () => {
  it('applies cockpit patches locally when no connected session exists', async () => {
    let state = createVoiceState();
    const stopCoachListening = vi.fn();
    const ensureContinuousLoop = vi.fn();

    const controller = createVoiceCockpitController({
      getSessionContext: () => ({ currentSessionId: null, isConnected: false }),
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      persistCockpitStateRequest: vi.fn(),
      persistConditioningStateRequest: vi.fn(),
      refreshCockpitLineRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      assertPracticeTargetUnlocked: vi.fn(),
      stopCoachListening,
      stopCoachSpeech: vi.fn(),
      ensureContinuousLoop,
      setLastSpokenCoachMessageId: vi.fn(),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
      getRequestedSpeechProvider: () => 'browser',
      getRequestedInputProvider: () => 'backend',
      getEffectiveInputProvider: () => 'backend',
      getEffectiveInputCapabilities: () => ({
        normalizedTurnContract: true,
        liveCapture: true,
        finalTranscript: true,
        interimTranscript: true,
        vad: true,
        bargeInCancel: true,
      }),
      supportsAutomaticTurnBoundary: () => true,
      hasBrowserSpeechRecognitionSupport: () => true,
      getNextInputProvider: () => 'browser',
      buildInputRuntimeRecoveryReset: (runtime) => runtime,
      getInputRecoveryState: () => ({
        statusLabel: null,
        coachCopy: '',
        activeDrillCopy: '',
        providerHint: '',
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      }),
    });

    await controller.updateCockpitState({
      advancedPanel: { open: true },
    });

    expect(state.advancedPanel.open).toBe(true);
    await expect(controller.setContinuousMode(false)).resolves.toBe(true);
    expect(state.coachVoice.continuousEnabled).toBe(false);
    expect(stopCoachListening).toHaveBeenCalledWith(true);
    await expect(controller.setContinuousMode(true)).resolves.toBe(true);
    expect(state.coachVoice.continuousEnabled).toBe(true);
    expect(ensureContinuousLoop).toHaveBeenCalledTimes(1);
  });

  it('blocks continuous mode when automatic turn-boundary support is unavailable', async () => {
    const addTerminalLine = vi.fn();
    const render = vi.fn();
    const state = {
      ...createVoiceState(),
      coachVoice: {
        ...createVoiceState().coachVoice,
        continuousEnabled: false,
      },
    };

    const controller = createVoiceCockpitController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getVoiceUiState: () => state,
      updateVoiceUiState: vi.fn(),
      persistCockpitStateRequest: vi.fn(),
      persistConditioningStateRequest: vi.fn(),
      refreshCockpitLineRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      assertPracticeTargetUnlocked: vi.fn(),
      stopCoachListening: vi.fn(),
      stopCoachSpeech: vi.fn(),
      ensureContinuousLoop: vi.fn(),
      setLastSpokenCoachMessageId: vi.fn(),
      addTerminalLine,
      render,
      getRequestedSpeechProvider: () => 'browser',
      getRequestedInputProvider: () => 'backend',
      getEffectiveInputProvider: () => 'backend',
      getEffectiveInputCapabilities: () => null,
      supportsAutomaticTurnBoundary: () => false,
      hasBrowserSpeechRecognitionSupport: () => true,
      getNextInputProvider: () => 'browser',
      buildInputRuntimeRecoveryReset: (runtime) => runtime,
      getInputRecoveryState: () => ({
        statusLabel: null,
        coachCopy: '',
        activeDrillCopy: '',
        providerHint: '',
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      }),
    });

    await controller.toggleContinuousMode();

    expect(addTerminalLine).toHaveBeenCalledWith(
      'system',
      'Hands-free coach currently needs browser speech recognition or backend input with local turn-boundary capture.',
    );
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('can enable the already-committed Start loop locally without a cockpit request', async () => {
    let state = {
      ...createVoiceState(),
      coachVoice: {
        ...createVoiceState().coachVoice,
        continuousEnabled: false,
      },
    };
    const persistCockpitStateRequest = vi.fn();
    const ensureContinuousLoop = vi.fn();
    const controller = createVoiceCockpitController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => { state = updater(state); },
      persistCockpitStateRequest,
      persistConditioningStateRequest: vi.fn(),
      refreshCockpitLineRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      assertPracticeTargetUnlocked: vi.fn(),
      stopCoachListening: vi.fn(),
      stopCoachSpeech: vi.fn(),
      ensureContinuousLoop,
      setLastSpokenCoachMessageId: vi.fn(),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
      getRequestedSpeechProvider: () => 'voxcpm',
      getRequestedInputProvider: () => 'backend',
      getEffectiveInputProvider: () => 'backend',
      getEffectiveInputCapabilities: () => ({
        normalizedTurnContract: true,
        liveCapture: true,
        finalTranscript: true,
        interimTranscript: false,
        vad: true,
        bargeInCancel: false,
      }),
      // The local-only path runs only after the real live socket was accepted,
      // so stale preflight status cannot veto that already-proven transport.
      supportsAutomaticTurnBoundary: () => false,
      hasBrowserSpeechRecognitionSupport: () => false,
      getNextInputProvider: () => 'backend',
      buildInputRuntimeRecoveryReset: (runtime) => runtime,
      getInputRecoveryState: () => ({
        statusLabel: null,
        coachCopy: '',
        activeDrillCopy: '',
        providerHint: '',
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: true,
        disableReason: 'stale recovery state',
      }),
    });

    await expect(controller.setContinuousMode(true, 'local-only')).resolves.toBe(true);

    expect(state.coachVoice.continuousEnabled).toBe(true);
    expect(persistCockpitStateRequest).not.toHaveBeenCalled();
    expect(ensureContinuousLoop).not.toHaveBeenCalled();
  });

  it('switches input providers, resets runtime, and stops listening first', async () => {
    let state = createVoiceState();
    const stopCoachListening = vi.fn();

    const controller = createVoiceCockpitController({
      getSessionContext: () => ({ currentSessionId: null, isConnected: false }),
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      persistCockpitStateRequest: vi.fn(),
      persistConditioningStateRequest: vi.fn(),
      refreshCockpitLineRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      assertPracticeTargetUnlocked: vi.fn(),
      stopCoachListening,
      stopCoachSpeech: vi.fn(),
      ensureContinuousLoop: vi.fn(),
      setLastSpokenCoachMessageId: vi.fn(),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
      getRequestedSpeechProvider: () => 'browser',
      getRequestedInputProvider: () => 'backend',
      getEffectiveInputProvider: (requested) => requested === 'browser' ? 'browser' : 'backend',
      getEffectiveInputCapabilities: () => ({
        normalizedTurnContract: true,
        liveCapture: true,
        finalTranscript: true,
        interimTranscript: true,
        vad: false,
        bargeInCancel: true,
      }),
      supportsAutomaticTurnBoundary: (provider) => provider === 'browser',
      hasBrowserSpeechRecognitionSupport: () => true,
      getNextInputProvider: () => 'browser',
      buildInputRuntimeRecoveryReset: (_runtime, options) => ({
        status: 'idle',
        requestedProvider: options?.requestedProvider || 'browser',
        effectiveProvider: options?.effectiveProvider || 'browser',
        captureProvider: options?.captureProvider || null,
      } as any),
      getInputRecoveryState: () => ({
        statusLabel: null,
        coachCopy: '',
        activeDrillCopy: '',
        providerHint: '',
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      }),
    });

    await controller.toggleInputProvider();

    expect(stopCoachListening).toHaveBeenCalledWith(true);
    expect(state.coachVoice.inputProvider).toBe('browser');
    expect(state.voiceInputRuntime.requestedProvider).toBe('browser');
  });

  it('switches speech provider and clears spoken-reply tracking when speech stays enabled', async () => {
    let state = createVoiceState();
    const stopCoachSpeech = vi.fn();
    const setLastSpokenCoachMessageId = vi.fn();

    const controller = createVoiceCockpitController({
      getSessionContext: () => ({ currentSessionId: null, isConnected: false }),
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      persistCockpitStateRequest: vi.fn(),
      persistConditioningStateRequest: vi.fn(),
      refreshCockpitLineRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      assertPracticeTargetUnlocked: vi.fn(),
      stopCoachListening: vi.fn(),
      stopCoachSpeech,
      ensureContinuousLoop: vi.fn(),
      setLastSpokenCoachMessageId,
      addTerminalLine: vi.fn(),
      render: vi.fn(),
      getRequestedSpeechProvider: () => 'browser',
      getRequestedInputProvider: () => 'backend',
      getEffectiveInputProvider: () => 'backend',
      getEffectiveInputCapabilities: () => null,
      supportsAutomaticTurnBoundary: () => true,
      hasBrowserSpeechRecognitionSupport: () => true,
      getNextInputProvider: () => 'browser',
      buildInputRuntimeRecoveryReset: (runtime) => runtime,
      getInputRecoveryState: () => ({
        statusLabel: null,
        coachCopy: '',
        activeDrillCopy: '',
        providerHint: '',
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      }),
    });

    await controller.toggleSpeechProvider();

    expect(stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(state.coachVoice.speechProvider).toBe('voxcpm');
    expect(setLastSpokenCoachMessageId).toHaveBeenCalledWith(null);
  });

  it('disables speech immediately and persists the disabled state', async () => {
    let state = createVoiceState();
    const stopCoachSpeech = vi.fn();

    const controller = createVoiceCockpitController({
      getSessionContext: () => ({ currentSessionId: null, isConnected: false }),
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      persistCockpitStateRequest: vi.fn(),
      persistConditioningStateRequest: vi.fn(),
      refreshCockpitLineRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      assertPracticeTargetUnlocked: vi.fn(),
      stopCoachListening: vi.fn(),
      stopCoachSpeech,
      ensureContinuousLoop: vi.fn(),
      setLastSpokenCoachMessageId: vi.fn(),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
      getRequestedSpeechProvider: () => 'browser',
      getRequestedInputProvider: () => 'backend',
      getEffectiveInputProvider: () => 'backend',
      getEffectiveInputCapabilities: () => null,
      supportsAutomaticTurnBoundary: () => true,
      hasBrowserSpeechRecognitionSupport: () => true,
      getNextInputProvider: () => 'browser',
      buildInputRuntimeRecoveryReset: (runtime) => runtime,
      getInputRecoveryState: () => ({
        statusLabel: null,
        coachCopy: '',
        activeDrillCopy: '',
        providerHint: '',
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      }),
    });

    await controller.toggleSpeechEnabled();

    expect(stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(state.coachVoice.speechEnabled).toBe(false);
  });
});
