import { describe, expect, it, vi } from 'vitest';
import { createVoiceControllerGraph } from './controller-graph';

function createHarness() {
  const captured: Record<string, any> = {};
  const onCoachTurnId = vi.fn();
  const sessionLease = {};
  const getCoachInputSessionContext = () => ({
    currentSessionId: 'session-1',
    isConnected: true,
    sessionLease,
  });
  const getCoachSpeechSessionContext = () => ({
    currentSessionId: 'session-1',
    isConnected: true,
  });

  const practiceTransport = {
    start: vi.fn(),
    stop: vi.fn(),
  };
  const referencePlaybackController = {
    pause: vi.fn(),
    handlePlaybackEvent: vi.fn(),
  };
  const referenceRuntimeController = {
    syncPersistedReferenceAnalysis: vi.fn(() => 'persisted-analysis'),
    adoptResolvedReferenceAnalysis: vi.fn(() => 'resolved-analysis'),
  };
  const sessionStateController = {
    applyBackendPayload: vi.fn(),
    syncSessionStateFromBackend: vi.fn(async () => null),
  };
  const workflowController = {
    refreshDrills: vi.fn(async () => null),
    syncPreset: vi.fn(async () => undefined),
    analyzeReference: vi.fn(async () => undefined),
    projectPhraseForecast: vi.fn(async () => undefined),
  };
  const liveTransitionController = {
    startPracticeSession: vi.fn(),
    beginPracticeTake: vi.fn(),
    endPracticeTake: vi.fn(),
    disarmPracticeSession: vi.fn(),
    prepareForSessionTransition: vi.fn(),
  };
  const runtimeShell = {
    getRequestedInputProvider: vi.fn(() => 'browser'),
    getEffectiveInputProvider: vi.fn(() => 'backend'),
    getInputRecoveryState: vi.fn(() => ({ shouldDisableContinuous: false })),
    getRequestedSpeechProvider: vi.fn(() => 'browser'),
    getEffectiveSpeechProvider: vi.fn(() => 'voxcpm'),
    getEffectiveInputCapabilities: vi.fn(() => ({ liveCapture: true })),
    supportsAutomaticTurnBoundary: vi.fn(() => true),
    hasBrowserSpeechRecognitionSupport: vi.fn(() => true),
    buildInputRuntimeRecoveryReset: vi.fn(() => ({ status: 'idle' })),
  };
  const inputRuntimeController = {
    getRuntimeState: vi.fn(() => ({ status: 'idle' })),
    syncEvent: vi.fn(async () => undefined),
    enforceRecoverySafety: vi.fn(async () => undefined),
  };
  const coachTransport = {
    runtimeCoordinator: {
      runDeepTutorResumeHandoff: vi.fn(async () => ({ action: 'noop' })),
    },
  };
  const coachControllers = {
    toggleSpeechEnabled: vi.fn(async () => undefined),
    toggleAdvancedPanel: vi.fn(async () => undefined),
  };
  const coachShell = {
    toggleSpeechEnabled: vi.fn(async () => undefined),
    toggleAdvancedPanel: vi.fn(async () => undefined),
  };
  const bootstrapController = {
    registerListeners: vi.fn(),
    handleVisibilityVisible: vi.fn(),
  };

  const graph = createVoiceControllerGraph({
    onCoachTurnId,
    practiceTransport: {} as any,
    referencePlayback: {} as any,
    referenceRuntime: {} as any,
    sessionState: {} as any,
    workflow: {} as any,
    liveTransition: {} as any,
    runtimeShell: {} as any,
    inputRuntime: {} as any,
    coachTransport: {
      speechController: {
        getSessionContext: getCoachSpeechSessionContext,
      } as any,
      inputController: {
        getSessionContext: getCoachInputSessionContext,
      } as any,
      runtimeBootstrap: {
        runtimeService: {
          canPlaySpeechWithProvider: vi.fn(() => true),
        } as any,
        runtimeCoordinator: {} as any,
      },
    },
    coachControllers: {
      requestController: {} as any,
      clarificationExecutor: {} as any,
      noteController: {} as any,
      deepTutorSessionController: {} as any,
      cockpitController: {} as any,
    },
    bootstrap: {} as any,
  }, {
    createVoicePracticeTransportController: vi.fn((options) => {
      captured.practiceTransport = options;
      return practiceTransport as any;
    }),
    createVoiceReferencePlaybackController: vi.fn((options) => {
      captured.referencePlayback = options;
      return referencePlaybackController as any;
    }),
    createVoiceReferenceRuntimeController: vi.fn((options) => {
      captured.referenceRuntime = options;
      return referenceRuntimeController as any;
    }),
    createVoiceSessionStateController: vi.fn((options) => {
      captured.sessionState = options;
      return sessionStateController as any;
    }),
    createVoiceWorkflowController: vi.fn((options) => {
      captured.workflow = options;
      return workflowController as any;
    }),
    createVoiceLiveTransitionController: vi.fn((options) => {
      captured.liveTransition = options;
      return liveTransitionController as any;
    }),
    createVoiceRuntimeShell: vi.fn((options) => {
      captured.runtimeShell = options;
      return runtimeShell as any;
    }),
    createVoiceInputRuntimeController: vi.fn((options) => {
      captured.inputRuntime = options;
      return inputRuntimeController as any;
    }),
    createVoiceCoachTransportBootstrap: vi.fn((options) => {
      captured.coachTransport = options;
      return coachTransport as any;
    }),
    createVoiceCoachControllerBootstrap: vi.fn((options) => {
      captured.coachControllers = options;
      return coachControllers as any;
    }),
    createVoiceCoachShellBootstrap: vi.fn((options) => {
      captured.coachShell = options;
      return coachShell as any;
    }),
    createVoiceBootstrapController: vi.fn((options) => {
      captured.bootstrap = options;
      return bootstrapController as any;
    }),
  });

  return {
    graph,
    captured,
    sessionLease,
    getCoachInputSessionContext,
    getCoachSpeechSessionContext,
    practiceTransport,
    referencePlaybackController,
    referenceRuntimeController,
    sessionStateController,
    workflowController,
    runtimeShell,
    inputRuntimeController,
    coachTransport,
    coachShell,
    onCoachTurnId,
  };
}

describe('voice controller graph', () => {
  it('bridges session, workflow, and reference dependencies across creation order', async () => {
    const harness = createHarness();
    const payload = { voiceState: { voiceSessionId: 'voice-session-1' }, turnId: 'turn-backend-1' };

    harness.captured.practiceTransport.applyVoiceBackendPayload(payload);
    expect(harness.sessionStateController.applyBackendPayload).toHaveBeenCalledWith(payload);
    expect(harness.onCoachTurnId).toHaveBeenCalledWith('turn-backend-1');

    expect(harness.captured.sessionState.syncPersistedReferenceAnalysis('clip-1')).toBe('persisted-analysis');
    expect(harness.referenceRuntimeController.syncPersistedReferenceAnalysis).toHaveBeenCalledWith('clip-1');

    await harness.captured.sessionState.refreshVoiceDrills(true);
    expect(harness.workflowController.refreshDrills).toHaveBeenCalledWith(true);

    await harness.captured.sessionState.enforceRecoverySafety();
    expect(harness.inputRuntimeController.enforceRecoverySafety).toHaveBeenCalledTimes(1);

    harness.captured.workflow.applyVoiceBackendPayload(payload);
    expect(harness.sessionStateController.applyBackendPayload).toHaveBeenCalledWith(payload);

    await harness.captured.workflow.syncSessionStateFromBackend(true);
    expect(harness.sessionStateController.syncSessionStateFromBackend).toHaveBeenCalledWith(true);

    expect(harness.captured.workflow.adoptResolvedReferenceAnalysis({ clipId: 'clip-1' }, 'clip.wav')).toBe('resolved-analysis');
    expect(harness.referenceRuntimeController.adoptResolvedReferenceAnalysis).toHaveBeenCalledWith(
      { clipId: 'clip-1' },
      'clip.wav',
    );

    harness.captured.liveTransition.pauseReferencePlayback();
    expect(harness.referencePlaybackController.pause).toHaveBeenCalledTimes(1);
  });

  it('bridges runtime shell, coach transport, and bootstrap shell facades', async () => {
    const harness = createHarness();

    expect(harness.captured.inputRuntime.getRequestedInputProvider()).toBe('browser');
    expect(harness.runtimeShell.getRequestedInputProvider).toHaveBeenCalledTimes(1);

    expect(harness.captured.coachTransport.speechController.getRequestedProvider()).toBe('browser');
    expect(harness.runtimeShell.getRequestedSpeechProvider).toHaveBeenCalledTimes(1);

    expect(harness.captured.coachTransport.inputController.getEffectiveInputProvider('browser')).toBe('backend');
    expect(harness.runtimeShell.getEffectiveInputProvider).toHaveBeenCalledWith('browser');

    expect(harness.captured.coachTransport.runtimeBootstrap.runtimeService.getSpeechProvider()).toBe('voxcpm');
    expect(harness.runtimeShell.getEffectiveSpeechProvider).toHaveBeenCalledTimes(1);

    expect(harness.captured.coachTransport.runtimeBootstrap.runtimeCoordinator.hasInputProvider()).toBe(true);
    expect(harness.runtimeShell.getEffectiveInputProvider).toHaveBeenCalled();

    await harness.captured.coachControllers.deepTutorSessionController.runCoachResumeHandoff({ lessonMode: 'active' });
    expect(harness.coachTransport.runtimeCoordinator.runDeepTutorResumeHandoff).toHaveBeenCalledWith({ lessonMode: 'active' });

    expect(harness.captured.coachControllers.cockpitController.getRequestedInputProvider()).toBe('browser');
    expect(harness.runtimeShell.getRequestedInputProvider).toHaveBeenCalled();

    await harness.captured.bootstrap.syncPreset('warm');
    expect(harness.workflowController.syncPreset).toHaveBeenCalledWith('warm');

    await harness.captured.bootstrap.toggleAdvancedPanel();
    expect(harness.coachShell.toggleAdvancedPanel).toHaveBeenCalledTimes(1);

    await harness.captured.bootstrap.toggleVoiceCoachSpeech();
    expect(harness.coachShell.toggleSpeechEnabled).toHaveBeenCalledTimes(1);

    harness.captured.bootstrap.handleReferencePlaybackEvent('play');
    expect(harness.referencePlaybackController.handlePlaybackEvent).toHaveBeenCalledWith('play');
  });

  it('forwards only the coach input session lease into the transport factory by identity', () => {
    const harness = createHarness();
    const inputControllerOptions = harness.captured.coachTransport.inputController;
    const speechControllerOptions = harness.captured.coachTransport.speechController;

    expect(inputControllerOptions.getSessionContext).toBe(harness.getCoachInputSessionContext);
    expect(inputControllerOptions.getSessionContext().sessionLease).toBe(harness.sessionLease);
    expect(speechControllerOptions.getSessionContext).toBe(harness.getCoachSpeechSessionContext);
    expect(speechControllerOptions.getSessionContext()).not.toHaveProperty('sessionLease');
  });

  it('forwards the lifecycle context from coach transport to input runtime by identity', async () => {
    const harness = createHarness();
    const eventOptions = { transcript: 'graph lifecycle sentinel', render: false };
    const lifecycle = { sessionId: 'session-graph', isCurrent: vi.fn(() => true) };

    await harness.captured.coachTransport.inputController.syncRuntimeEvent(
      'processing',
      eventOptions,
      lifecycle,
    );

    expect(harness.inputRuntimeController.syncEvent).toHaveBeenCalledWith(
      'processing',
      eventOptions,
      lifecycle,
    );
    expect(harness.inputRuntimeController.syncEvent.mock.calls[0][2]).toBe(lifecycle);
  });
});
