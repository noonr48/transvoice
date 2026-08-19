import { describe, expect, it, vi } from 'vitest';

import { createVoiceHostAssembly } from './host-assembly';
import { createVoiceRuntimeStore } from './runtime-store';
import { createVoiceBackendPayload } from './state';

function createHarness() {
  const store = createVoiceRuntimeStore();
  const captured: Record<string, any> = {};

  const runtimeStatusController = {
    getState: vi.fn(() => ({ kind: 'runtime-status' }) as any),
    applyHealthStatusPayload: vi.fn(),
    applyInputProviderStatusPayload: vi.fn(),
  };

  const bridge = {
    bind: vi.fn(),
    render: vi.fn(),
    observeRender: vi.fn(() => vi.fn()),
    getPracticeTransportState: vi.fn(),
    setPracticeTransportState: vi.fn(),
    updateVoiceUiState: vi.fn(),
    startVoiceAudioStream: vi.fn(async () => undefined),
    stopVoiceAudioStream: vi.fn(async () => undefined),
    toggleVoiceOverlay: vi.fn(),
  };

  const appRuntime = {
    hydrateStoredInputDevicePreference: vi.fn(),
  };
  const voiceHostActionController = {
    disarmVoicePracticeSession: vi.fn(async () => true),
    resetVoiceCoachRuntimeUiState: vi.fn(),
    refreshVoiceCockpitLine: vi.fn(async () => undefined),
    prepareForLiveSessionTransition: vi.fn(async () => undefined),
  };
  const readVoiceInputDevicePreference = vi.fn(() => 'usb-mic');
  const writeVoiceInputDevicePreference = vi.fn();
  const refreshVoiceAudioInputDevices = vi.fn(async (silent?: boolean) => (
    silent ? ['silent-mic'] : ['active-mic']
  ));
  const stopVoiceCoachSpeech = vi.fn();
  const composition = {
    voiceAppRuntime: appRuntime,
    voiceHostActionController,
    hasVoiceModeActivity: vi.fn(() => true),
    getVoiceSummaryText: vi.fn(() => 'Voice summary'),
    readVoiceInputDevicePreference,
    writeVoiceInputDevicePreference,
    refreshVoiceAudioInputDevices,
    stopVoiceCoachSpeech,
  };

  const sessionStateController = {
    applyBackendPayload: vi.fn(),
    syncSessionStateFromBackend: vi.fn(async () => null),
  };
  const workflowController = {
    ensureHealthPoller: vi.fn(),
    bootstrapVoiceModeSession: vi.fn(async () => undefined),
    refreshHealth: vi.fn(async () => true),
    refreshDrills: vi.fn(async () => ({ drills: [] })),
  };
  const referencePlaybackController = {
    pause: vi.fn(),
  };
  const referenceRuntimeController = {
    syncPersistedReferenceAnalysis: vi.fn(() => 'persisted-analysis'),
  };
  const bootstrapController = {
    handleVisibilityVisible: vi.fn(),
    registerListeners: vi.fn(),
  };
  const sessionModeRuntime = {
    applyStartedSession: vi.fn(),
    applyDirectFallbackSession: vi.fn(() => true),
    applyRestoredSession: vi.fn(),
  };
  const orchestration = {
    practiceTransport: { id: 'practice-transport' },
    referencePlaybackController,
    referenceRuntimeController,
    sessionStateController,
    workflowController,
    liveTransitionController: { id: 'live-transition' },
    runtimeShell: { id: 'runtime-shell' },
    inputRuntimeController: { id: 'input-runtime' },
    coachTransport: { id: 'coach-transport' },
    coachControllers: { id: 'coach-controllers' },
    coachShell: { id: 'coach-shell', setContinuousMode: vi.fn(async () => true) },
    bootstrapController,
    renderController: { render: vi.fn() },
    sessionModeRuntime,
  };

  const orchestrationConfig = { kind: 'host-orchestration-config' };
  const sessionLease = {};
  const getSessionLease = vi.fn(() => sessionLease);

  const assembly = createVoiceHostAssembly({
    createVoiceHostRuntimeBridge: vi.fn((config) => {
      captured.bridge = config;
      return bridge as any;
    }),
    createVoiceHostRuntimeComposition: vi.fn((config) => {
      captured.composition = config;
      return composition as any;
    }),
    createVoiceHostOrchestrationConfig: vi.fn((config) => {
      captured.orchestrationConfig = config;
      return orchestrationConfig as any;
    }),
    createVoiceHostOrchestration: vi.fn((config) => {
      captured.orchestration = config;
      return orchestration as any;
    }),
  });

  assembly.assemble({
    store,
    runtimeStatusController: runtimeStatusController as any,
    composition: {
      getCurrentMode: () => 'voice',
      getCurrentSessionId: () => 'session-1',
      getIsConnected: () => true,
      resolveSessionMode: () => 'voice',
      getCoachQuestionInput: () => null,
      submitRuntimeCoachQuestionRequest: vi.fn(),
      prepareConditioningLatentsRequest: vi.fn(),
      isSpeechSynthesisBusy: () => false,
      getVoiceSessionStreamUrl: (voiceSessionId) => `wss://${voiceSessionId}`,
      document,
    },
    orchestration: {
      voiceApi: {
        advanceDeepTutorVoiceLesson: vi.fn(),
        analyzeReference: vi.fn(),
        disarmPracticeSession: vi.fn(),
        getDrills: vi.fn(),
        getHealthSnapshot: vi.fn(),
        getKnowledgeStatus: vi.fn(),
        getReferenceAnalysis: vi.fn(),
        getReferenceAudioUrl: vi.fn(),
        getSessionState: vi.fn(),
        getTaskStatus: vi.fn(),
        projectPhraseForecast: vi.fn(),
        refreshCockpitLine: vi.fn(),
        requestDeepTutorCoach: vi.fn(),
        selectDrill: vi.fn(),
        startCoachTask: vi.fn(),
        startDeepTutorVoiceLesson: vi.fn(),
        startPracticeSession: vi.fn(),
        submitInputRuntimeEvent: vi.fn(),
        submitInputTurn: vi.fn(),
        submitPracticeTake: vi.fn(),
        syncPreset: vi.fn(),
        syncReference: vi.fn(),
        updateCockpitState: vi.fn(),
        updateConditioningState: vi.fn(),
      } as any,
      kernelUrl: 'http://kernel',
      kernelWsUrl: 'ws://kernel',
      getCurrentMode: () => 'voice',
      getCurrentSessionId: () => 'session-1',
      getIsConnected: () => true,
      getSessionLease,
      addTerminalLine: vi.fn(),
      getVoiceCoachQuestionInput: () => null,
      getVoiceTargetPresetSelect: () => null,
      getVoiceReferencePlayer: () => null,
      getVoiceConditioningPromptTextInput: () => null,
      getVoiceConditioningPromptFileInput: () => null,
      getVoiceConditioningReferenceFileInput: () => null,
      getDomBindings: () => null,
    },
  });

  return {
    assembly,
    captured,
    bridge,
    composition,
    appRuntime,
    voiceHostActionController,
    sessionStateController,
    workflowController,
    bootstrapController,
    referencePlaybackController,
    referenceRuntimeController,
    sessionModeRuntime,
    orchestration,
    orchestrationConfig,
    sessionLease,
    getSessionLease,
    readVoiceInputDevicePreference,
  };
}

describe('voice host assembly', () => {
  it('owns the late-bound voice host wiring and exposes behavior-level delegates', async () => {
    const harness = createHarness();

    expect(harness.captured.bridge.getAppRuntime()).toBe(harness.appRuntime);
    expect(harness.captured.bridge.getAudioRuntime()).toMatchObject({
      readInputDevicePreference: harness.composition.readVoiceInputDevicePreference,
      writeInputDevicePreference: harness.composition.writeVoiceInputDevicePreference,
      refreshAudioInputDevices: harness.composition.refreshVoiceAudioInputDevices,
    });

    expect(harness.captured.composition.getCoachShell()).toBe(harness.orchestration.coachShell);
    expect(harness.captured.composition.getRuntimeShell()).toBe(harness.orchestration.runtimeShell);
    expect(harness.captured.composition.getLiveTransitionController()).toBe(
      harness.orchestration.liveTransitionController,
    );
    expect(harness.captured.composition.syncPersistedReferenceAnalysis('clip-1')).toBe('persisted-analysis');
    expect(harness.referenceRuntimeController.syncPersistedReferenceAnalysis).toHaveBeenCalledWith('clip-1');

    const backendPayload = createVoiceBackendPayload({
      voiceState: {
        voiceSessionId: 'voice-session-1',
      } as any,
    });
    harness.captured.composition.applyVoiceBackendPayload({ invalid: true } as any);
    expect(harness.sessionStateController.applyBackendPayload).not.toHaveBeenCalled();

    harness.captured.composition.applyVoiceBackendPayload(backendPayload);
    expect(harness.sessionStateController.applyBackendPayload).toHaveBeenCalledWith(backendPayload);

    expect(harness.captured.orchestrationConfig.getSessionStateController())
      .toBe(harness.sessionStateController);
    expect(harness.captured.orchestrationConfig.getWorkflowController())
      .toBe(harness.workflowController);
    expect(harness.captured.orchestrationConfig.getRuntimeShell()).toBe(harness.orchestration.runtimeShell);
    expect(harness.captured.orchestrationConfig.getSessionLease).toBe(harness.getSessionLease);
    expect(harness.captured.orchestrationConfig.getSessionLease()).toBe(harness.sessionLease);
    expect(harness.captured.orchestration).toBe(harness.orchestrationConfig);

    expect(harness.bridge.bind).toHaveBeenCalledWith({
      practiceTransport: harness.orchestration.practiceTransport,
      renderController: harness.orchestration.renderController,
    });

    expect(harness.assembly.getAppRuntime()).toBe(harness.appRuntime);
    const observer = vi.fn();
    const removeObserver = harness.assembly.observeRender(observer);
    expect(harness.bridge.observeRender).toHaveBeenCalledWith(observer);
    expect(removeObserver).toBe(harness.bridge.observeRender.mock.results[0].value);
    harness.assembly.render();
    expect(harness.bridge.render).toHaveBeenCalledTimes(1);

    expect(harness.assembly.runtime.hasModeActivity()).toBe(true);
    expect(harness.assembly.runtime.getSummaryText()).toBe('Voice summary');
    harness.assembly.runtime.stopCoachSpeech();
    expect(harness.composition.stopVoiceCoachSpeech).toHaveBeenCalledTimes(1);
    await expect(harness.assembly.runtime.setCoachContinuousMode(true)).resolves.toBe(true);
    expect(harness.orchestration.coachShell.setContinuousMode).toHaveBeenCalledWith(true);
    await expect(harness.assembly.runtime.refreshAudioInputDevices(true)).resolves.toEqual(['silent-mic']);
    expect(harness.composition.refreshVoiceAudioInputDevices).toHaveBeenCalledWith(true);

    harness.assembly.runtime.hydrateStoredInputDevicePreference();
    expect(harness.appRuntime.hydrateStoredInputDevicePreference)
      .toHaveBeenCalledWith(harness.readVoiceInputDevicePreference);

    await expect(harness.assembly.actions.disarmVoicePracticeSession('manual disarm')).resolves.toBe(true);
    harness.assembly.actions.resetVoiceCoachRuntimeUiState({ preserveInput: true } as any);
    await harness.assembly.actions.refreshVoiceCockpitLine('ensure');
    await harness.assembly.actions.prepareForLiveSessionTransition('mode switch');
    expect(harness.voiceHostActionController.disarmVoicePracticeSession)
      .toHaveBeenCalledWith('manual disarm');
    expect(harness.voiceHostActionController.resetVoiceCoachRuntimeUiState)
      .toHaveBeenCalledWith({ preserveInput: true });
    expect(harness.voiceHostActionController.refreshVoiceCockpitLine).toHaveBeenCalledWith('ensure');
    expect(harness.voiceHostActionController.prepareForLiveSessionTransition)
      .toHaveBeenCalledWith('mode switch');

    harness.assembly.reference.pausePlayback();
    expect(harness.referencePlaybackController.pause).toHaveBeenCalledTimes(1);

    harness.assembly.lifecycle.handleVisibilityVisible();
    harness.assembly.lifecycle.registerListeners({ refs: {} as any });
    expect(harness.bootstrapController.handleVisibilityVisible).toHaveBeenCalledTimes(1);
    expect(harness.bootstrapController.registerListeners).toHaveBeenCalledWith({
      refs: {},
    });

    harness.assembly.workflow.ensureHealthPoller();
    await harness.assembly.workflow.bootstrapVoiceModeSession(false, true);
    await harness.assembly.workflow.refreshHealth();
    await harness.assembly.workflow.refreshDrills(true);
    expect(harness.workflowController.ensureHealthPoller).toHaveBeenCalledTimes(1);
    expect(harness.workflowController.bootstrapVoiceModeSession).toHaveBeenCalledWith(false, true);
    expect(harness.workflowController.refreshHealth).toHaveBeenCalledTimes(1);
    expect(harness.workflowController.refreshDrills).toHaveBeenCalledWith(true);

    await harness.assembly.sessionState.syncFromBackend(true);
    expect(harness.sessionStateController.syncSessionStateFromBackend).toHaveBeenCalledWith(true);

    harness.assembly.sessionMode.applyStartedSession('voice', { id: 'started' } as any);
    expect(harness.assembly.sessionMode.applyDirectFallbackSession('voice')).toBe(true);
    harness.assembly.sessionMode.applyRestoredSession('voice', { id: 'restored' } as any);
    expect(harness.sessionModeRuntime.applyStartedSession).toHaveBeenCalledWith('voice', { id: 'started' });
    expect(harness.sessionModeRuntime.applyDirectFallbackSession).toHaveBeenCalledWith('voice');
    expect(harness.sessionModeRuntime.applyRestoredSession).toHaveBeenCalledWith('voice', { id: 'restored' });
  });
});
