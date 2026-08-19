import { describe, expect, it, vi } from 'vitest';

import { createVoiceHostOrchestration } from './host-orchestration';

function createHarness(overrides: {
  finalizeRender?: (mode: string, coachShell: any) => Promise<unknown> | unknown;
  onCreateAppRuntime?: (config: any) => void;
  usePrebuiltAppRuntimeBundle?: boolean;
} = {}) {
  const captured: Record<string, any> = {};
  const sessionLease = {};
  const getCoachInputSessionContext = () => ({
    currentSessionId: 'session-1',
    isConnected: true,
    sessionLease,
  });
  let currentVoiceUiState = {
    voiceSessionId: 'voice-session-1',
  };
  const store = {
    getUiState: vi.fn(() => currentVoiceUiState),
  };
  const appRuntime = {
    getLatestCoachMessage: vi.fn(() => ({
      id: 'coach-1',
      role: 'coach',
    })),
    applySessionReentryPlan: vi.fn(),
  };
  const controllerGraph = {
    practiceTransport: { id: 'practice' },
    referencePlaybackController: { id: 'reference-playback' },
    referenceRuntimeController: {
      syncPersistedReferenceAnalysis: vi.fn(() => 'persisted-analysis'),
    },
    sessionStateController: { id: 'session-state' },
    workflowController: { id: 'workflow' },
    liveTransitionController: {
      disarmPracticeSession: vi.fn(async () => true),
    },
    runtimeShell: { id: 'runtime-shell' },
    inputRuntimeController: { id: 'input-runtime' },
    coachTransport: { id: 'coach-transport' },
    coachControllers: { id: 'coach-controllers' },
    coachShell: {
      stopCoachListening: vi.fn(),
      stopCoachSpeech: vi.fn(),
      clearCoachPollTimer: vi.fn(),
      finalizeRender: vi.fn(async () => ({ kind: 'handoff' })),
    },
    bootstrapController: { id: 'bootstrap' },
  };
  const renderController = {
    render: vi.fn(),
  };
  const sessionModeRuntime = {
    applyStartedSession: vi.fn(),
  };

  const options = {
    appRuntime: {
      store,
      getCurrentMode: () => 'voice',
      getCurrentSessionId: () => 'session-1',
      getIsConnected: () => true,
      getRuntimeStatusState: () => ({}) as any,
      isSpeechSynthesisBusy: () => false,
      getVoiceSessionStreamUrl: (voiceSessionId: string) => `wss://${voiceSessionId}`,
    } as any,
    controllerGraph: {
      coachTransport: {
        inputController: {
          getSessionContext: getCoachInputSessionContext,
        },
      },
    } as any,
    renderController: {
      store,
      getCurrentMode: () => 'voice',
      getCurrentSessionId: () => 'session-1',
      getIsConnected: () => true,
      getRuntimeStatusState: () => ({}) as any,
      getReferencePlayerState: () => ({
        paused: true,
        currentTimeMs: 0,
      }),
      getConditioningDraftState: () => ({
        promptFileSelected: false,
        promptTextPresent: false,
        referenceFileSelected: false,
      }),
      getDomBindings: () => null,
      selectDrill: vi.fn(async () => undefined),
      addTerminalLine: vi.fn(),
      finalizeRender: overrides.finalizeRender,
    } as any,
    sessionModeRuntime: {
      render: vi.fn(),
    } as any,
  };

  const createVoiceAppRuntime = vi.fn((config) => {
    captured.appRuntime = config;
    overrides.onCreateAppRuntime?.(config);
    return appRuntime as any;
  });

  const orchestration = createVoiceHostOrchestration({
    ...options,
    appRuntime: overrides.usePrebuiltAppRuntimeBundle
      ? {
          runtime: appRuntime as any,
          getVoiceUiState: () => store.getUiState(),
        }
      : options.appRuntime,
  }, {
    createVoiceAppRuntime,
    createVoiceControllerGraph: vi.fn((config) => {
      captured.controllerGraph = config;
      return controllerGraph as any;
    }),
    createVoiceRenderController: vi.fn((config) => {
      captured.renderController = config;
      return renderController as any;
    }),
    createVoiceSessionModeRuntime: vi.fn((config) => {
      captured.sessionModeRuntime = config;
      return sessionModeRuntime as any;
    }),
  });

  return {
    orchestration,
    options,
    captured,
    sessionLease,
    getCoachInputSessionContext,
    appRuntime,
    controllerGraph,
    renderController,
    sessionModeRuntime,
    setVoiceUiState(nextVoiceUiState: typeof currentVoiceUiState) {
      currentVoiceUiState = nextVoiceUiState;
    },
    factories: {
      createVoiceAppRuntime,
    },
  };
}

describe('voice host orchestration', () => {
  it('forwards the coach input session lease into the controller graph by identity', () => {
    const harness = createHarness();
    const inputControllerOptions = harness.captured.controllerGraph.coachTransport.inputController;

    expect(inputControllerOptions.getSessionContext).toBe(harness.getCoachInputSessionContext);
    expect(inputControllerOptions.getSessionContext().sessionLease).toBe(harness.sessionLease);
  });

  it('connects app runtime helpers to the late-bound controller graph', async () => {
    const harness = createHarness();

    expect(harness.orchestration.appRuntime).toBe(harness.appRuntime);
    expect(harness.orchestration.runtimeShell).toBe(harness.controllerGraph.runtimeShell);
    expect(harness.captured.appRuntime.getRuntimeShell()).toBe(harness.controllerGraph.runtimeShell);

    await expect(harness.captured.appRuntime.disarmPracticeSession('manual disarm')).resolves.toBe(true);
    expect(harness.controllerGraph.liveTransitionController.disarmPracticeSession).toHaveBeenCalledWith('manual disarm');

    expect(harness.captured.appRuntime.syncPersistedReferenceAnalysis('clip-1')).toBe('persisted-analysis');
    expect(harness.controllerGraph.referenceRuntimeController.syncPersistedReferenceAnalysis).toHaveBeenCalledWith('clip-1');

    harness.captured.appRuntime.runtimeResetDependencies.stopListening(true);
    harness.captured.appRuntime.runtimeResetDependencies.stopSpeech();
    harness.captured.appRuntime.runtimeResetDependencies.clearCoachPollTimer();

    expect(harness.controllerGraph.coachShell.stopCoachListening).toHaveBeenCalledWith(true);
    expect(harness.controllerGraph.coachShell.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(harness.controllerGraph.coachShell.clearCoachPollTimer).toHaveBeenCalledTimes(1);
    expect(harness.captured.appRuntime.runtimeResetDependencies.getLatestCoachMessageId()).toBe('coach-1');
  });

  it('keeps app-runtime late-bound hooks safe before the controller graph exists and binds them afterward', async () => {
    const preCreation = {
      disarmResult: Promise.resolve(false),
      runtimeShell: null as any,
      persistedAnalysis: 'unset' as unknown,
    };

    const harness = createHarness({
      onCreateAppRuntime: (config) => {
        preCreation.runtimeShell = config.getRuntimeShell();
        preCreation.disarmResult = config.disarmPracticeSession('pre-bind');
        preCreation.persistedAnalysis = config.syncPersistedReferenceAnalysis('clip-pre');
        config.runtimeResetDependencies.stopListening(true);
        config.runtimeResetDependencies.stopSpeech();
        config.runtimeResetDependencies.clearCoachPollTimer();
      },
    });

    expect(preCreation.runtimeShell).toBeNull();
    await expect(preCreation.disarmResult).resolves.toBe(false);
    expect(preCreation.persistedAnalysis).toBeNull();
    expect(harness.controllerGraph.liveTransitionController.disarmPracticeSession).not.toHaveBeenCalled();
    expect(harness.controllerGraph.referenceRuntimeController.syncPersistedReferenceAnalysis).not.toHaveBeenCalled();
    expect(harness.controllerGraph.coachShell.stopCoachListening).not.toHaveBeenCalled();
    expect(harness.controllerGraph.coachShell.stopCoachSpeech).not.toHaveBeenCalled();
    expect(harness.controllerGraph.coachShell.clearCoachPollTimer).not.toHaveBeenCalled();

    expect(harness.captured.appRuntime.getRuntimeShell()).toBe(harness.controllerGraph.runtimeShell);
    await expect(harness.captured.appRuntime.disarmPracticeSession('post-bind')).resolves.toBe(true);
    expect(harness.captured.appRuntime.syncPersistedReferenceAnalysis('clip-post')).toBe('persisted-analysis');
    harness.captured.appRuntime.runtimeResetDependencies.stopListening(false);
    harness.captured.appRuntime.runtimeResetDependencies.stopSpeech();
    harness.captured.appRuntime.runtimeResetDependencies.clearCoachPollTimer();

    expect(harness.controllerGraph.liveTransitionController.disarmPracticeSession).toHaveBeenCalledWith('post-bind');
    expect(harness.controllerGraph.referenceRuntimeController.syncPersistedReferenceAnalysis)
      .toHaveBeenCalledWith('clip-post');
    expect(harness.controllerGraph.coachShell.stopCoachListening).toHaveBeenCalledWith(false);
    expect(harness.controllerGraph.coachShell.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(harness.controllerGraph.coachShell.clearCoachPollTimer).toHaveBeenCalledTimes(1);
  });

  it('wires render and session mode controllers from the assembled host boundary', async () => {
    const harness = createHarness();
    const plan = { nextVoiceUiState: { voiceSessionId: 'voice-session-2' } };

    expect(harness.orchestration.renderController).toBe(harness.renderController);
    expect(harness.captured.renderController.appRuntime).toBe(harness.appRuntime);
    expect(harness.captured.renderController.referenceRuntime).toBe(harness.controllerGraph.referenceRuntimeController);
    expect(harness.captured.renderController.getRuntimeShell()).toBe(harness.controllerGraph.runtimeShell);

    await harness.captured.renderController.finalizeRender('voice');
    expect(harness.controllerGraph.coachShell.finalizeRender).toHaveBeenCalledWith('voice');

    expect(harness.orchestration.sessionModeRuntime).toBe(harness.sessionModeRuntime);
    expect(harness.captured.sessionModeRuntime.getVoiceUiState()).toEqual({
      voiceSessionId: 'voice-session-1',
    });

    harness.captured.sessionModeRuntime.applySessionReentryPlan(plan);
    expect(harness.appRuntime.applySessionReentryPlan).toHaveBeenCalledWith(plan);
  });

  it('allows callers to override render finalization while keeping the coach shell available', async () => {
    const finalizeRender = vi.fn(async () => 'custom-finalize-result');
    const harness = createHarness({ finalizeRender });

    await expect(harness.captured.renderController.finalizeRender('general')).resolves.toBe('custom-finalize-result');
    expect(finalizeRender).toHaveBeenCalledWith('general', harness.controllerGraph.coachShell);
    expect(harness.controllerGraph.coachShell.finalizeRender).not.toHaveBeenCalled();
  });

  it('accepts a prebuilt app-runtime bundle without calling the app-runtime factory', () => {
    const harness = createHarness({
      usePrebuiltAppRuntimeBundle: true,
    });
    const plan = { nextVoiceUiState: { voiceSessionId: 'voice-session-2' } };

    expect(harness.factories.createVoiceAppRuntime).not.toHaveBeenCalled();
    expect(harness.orchestration.appRuntime).toBe(harness.appRuntime);
    expect(harness.captured.renderController.appRuntime).toBe(harness.appRuntime);

    harness.setVoiceUiState({
      voiceSessionId: 'voice-session-prebuilt',
    });
    expect(harness.captured.sessionModeRuntime.getVoiceUiState()).toEqual({
      voiceSessionId: 'voice-session-prebuilt',
    });

    harness.captured.sessionModeRuntime.applySessionReentryPlan(plan);
    expect(harness.appRuntime.applySessionReentryPlan).toHaveBeenCalledWith(plan);
  });
});
