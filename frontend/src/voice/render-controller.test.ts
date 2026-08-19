import { describe, expect, it, vi } from 'vitest';
import { createVoiceRenderController } from './render-controller';
import { createDefaultVoiceRuntimeStoreState } from './runtime-store';

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness() {
  const state = createDefaultVoiceRuntimeStoreState({
    voiceUiState: {
      ...createDefaultVoiceRuntimeStoreState().voiceUiState,
      referenceClipId: ' clip-1 ',
      voiceSessionId: 'voice-session-1',
    },
  });
  const patchState = vi.fn();
  const hydrateReferenceAnalysisIfNeeded = vi.fn(async () => undefined);
  const getHydrationView = vi.fn(() => ({
    hasPlayableReference: true,
    hydrationInFlight: false,
    hydrationFailed: false,
    hydrationError: null,
  }));
  const runtimeShell = {
    getRuntimeEnvironment: vi.fn(() => ({
      canUseBackendCapture: true,
      browserSpeechRecognitionSupported: true,
    })),
    getRequestedSpeechProvider: vi.fn(() => 'browser'),
    getRequestedInputProvider: vi.fn(() => 'browser'),
    getEffectiveInputProvider: vi.fn(() => 'backend'),
    isInputProviderFallbackActive: vi.fn(() => false),
    getInputRecoveryState: vi.fn(() => ({ shouldDisableContinuous: false })),
    getEffectiveInputCapabilities: vi.fn(() => ({ automaticTurnBoundary: true })),
    supportsAutomaticTurnBoundary: vi.fn(() => true),
    isSpeechProviderFallbackActive: vi.fn(() => false),
    getEffectiveSpeechProvider: vi.fn(() => 'voxcpm'),
    getConditioningStatusText: vi.fn(() => 'Conditioning ready'),
  };
  const buildVoiceRenderState = vi.fn(() => ({
    summaryState: { summary: true },
    controlsState: { controls: true },
    orchestrationState: { orchestration: true },
  }));
  const applyVoiceRenderSummaryDom = vi.fn();
  const applyVoiceRenderControlsDom = vi.fn();
  const applyVoiceRenderOrchestration = vi.fn(() => 'signature-1');
  const addTerminalLine = vi.fn();
  const finalizeRender = vi.fn();

  const controller = createVoiceRenderController({
    store: {
      getState: () => state,
      patchState,
    } as any,
    appRuntime: {
      getResolvedVoiceStreamUrl: vi.fn(() => 'http://stream'),
      getViewModelContext: vi.fn(() => ({ voiceUiState: state.voiceUiState })),
      getVoiceReferenceFrameAtMs: vi.fn(() => ({ t: 1200, pitchHz: 220 })),
      canUseVoiceCoachVoiceInput: vi.fn(() => true),
      getVoiceInteractionOwnerCopy: vi.fn(() => 'Coach owns the next step.'),
      getVoiceInteractionOwner: vi.fn(() => 'coach-processing'),
      shouldRebuildDeepTutorVoiceLesson: vi.fn(() => false),
      getDeepTutorVoiceResumeButtonLabel: vi.fn(() => 'Resume guided coach'),
    } as any,
    referenceRuntime: {
      hydrateReferenceAnalysisIfNeeded,
      getHydrationView,
    },
    getCurrentMode: () => 'voice',
    getCurrentSessionId: () => 'session-1',
    getIsConnected: () => true,
    getRuntimeShell: () => runtimeShell as any,
    getRuntimeStatusState: () => ({
      knowledgeStatusText: 'Ready',
      speech: { voxcpm: { error: null, enabled: true } },
      input: { backend: { error: null, enabled: true } },
    }) as any,
    getReferencePlayerState: () => ({
      paused: false,
      currentTimeMs: 1200,
    }),
    getConditioningDraftState: () => ({
      promptFileSelected: true,
      promptTextPresent: true,
      referenceFileSelected: false,
    }),
    getDomBindings: () => ({
      renderSummaryElements: { summaryEl: true },
      renderControlsElements: { controlsEl: true },
      renderOrchestrationElements: { orchestrationEl: true },
    } as any),
    selectDrill: vi.fn(async () => undefined),
    addTerminalLine,
    finalizeRender,
  }, {
    buildVoiceRenderState,
    applyVoiceRenderSummaryDom,
    applyVoiceRenderControlsDom,
    applyVoiceRenderOrchestration,
  });

  return {
    controller,
    buildVoiceRenderState,
    patchState,
    hydrateReferenceAnalysisIfNeeded,
    getHydrationView,
    runtimeShell,
    applyVoiceRenderSummaryDom,
    applyVoiceRenderControlsDom,
    applyVoiceRenderOrchestration,
    finalizeRender,
  };
}

describe('voice render controller', () => {
  it('assembles runtime render state and applies orchestration through the extracted boundary', async () => {
    const harness = createHarness();

    harness.controller.render();
    await Promise.resolve();

    expect(harness.hydrateReferenceAnalysisIfNeeded).toHaveBeenCalledTimes(1);
    expect(harness.getHydrationView).toHaveBeenCalledWith('clip-1');
    expect(harness.runtimeShell.getEffectiveInputProvider).toHaveBeenCalledWith('browser');
    expect(harness.buildVoiceRenderState).toHaveBeenCalledWith(expect.objectContaining({
      isVoiceMode: true,
      currentSessionId: 'session-1',
      streamUrl: 'http://stream',
      referencePlayerPaused: false,
      voiceConditioningStatusText: 'Conditioning ready',
      conditioningPromptFileSelected: true,
      conditioningPromptTextPresent: true,
      conditioningReferenceFileSelected: false,
    }));
    expect(harness.applyVoiceRenderSummaryDom).toHaveBeenCalledWith(
      { summaryEl: true },
      { summary: true },
    );
    expect(harness.applyVoiceRenderControlsDom).toHaveBeenCalledWith(
      { controlsEl: true },
      { controls: true },
    );
    expect(harness.applyVoiceRenderOrchestration).toHaveBeenCalledWith(
      { orchestrationEl: true },
      { orchestration: true },
    );
    expect(harness.patchState).toHaveBeenCalledWith({
      voiceInputOptionsSignature: 'signature-1',
    });
    expect(harness.finalizeRender).toHaveBeenCalledWith('voice');
  });

  it('catches finalizeRender rejections so they do not surface as unhandled promise failures', async () => {
    const harness = createHarness();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      harness.finalizeRender.mockRejectedValueOnce(new Error('boom'));

      harness.controller.render();
      await flushAsyncWork();

      expect(harness.finalizeRender).toHaveBeenCalledTimes(1);
      expect(warnSpy).toHaveBeenCalled();
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('no-ops when the shell has not finished wiring DOM bindings or runtime shell yet', () => {
    const patchState = vi.fn();
    const controller = createVoiceRenderController({
      store: {
        getState: () => createDefaultVoiceRuntimeStoreState(),
        patchState,
      } as any,
      appRuntime: {} as any,
      referenceRuntime: {
        hydrateReferenceAnalysisIfNeeded: vi.fn(),
        getHydrationView: vi.fn(),
      } as any,
      getCurrentMode: () => 'voice',
      getCurrentSessionId: () => null,
      getIsConnected: () => false,
      getRuntimeShell: () => null,
      getRuntimeStatusState: () => ({} as any),
      getReferencePlayerState: () => ({ paused: true, currentTimeMs: 0 }),
      getConditioningDraftState: () => ({
        promptFileSelected: false,
        promptTextPresent: false,
        referenceFileSelected: false,
      }),
      getDomBindings: () => null,
      selectDrill: vi.fn(),
      addTerminalLine: vi.fn(),
      finalizeRender: vi.fn(),
    });

    controller.render();

    expect(patchState).not.toHaveBeenCalled();
  });
});
