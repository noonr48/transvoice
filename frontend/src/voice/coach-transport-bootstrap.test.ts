import { describe, expect, it, vi } from 'vitest';
import { createVoiceCoachTransportBootstrap } from './coach-transport-bootstrap';

function createBootstrapOptions(sessionLease: object) {
  return {
    speechController: {
      kernelUrl: 'http://localhost:3001',
      getSessionContext: () => ({
        currentSessionId: 'session-1',
        isConnected: true,
      }),
      getRequestedProvider: () => 'browser' as const,
      setLastSpokenCoachMessageId: vi.fn(),
      getLastSpokenCoachMessageId: () => null,
      setVoxCpmStatus: vi.fn(),
      onPlaybackError: vi.fn(),
      onRender: vi.fn(),
    },
    inputController: {
      kernelWsUrl: 'ws://localhost:3001',
      getSessionContext: () => ({
        currentSessionId: 'session-1',
        isConnected: true,
        sessionLease,
      }),
      getRequestedInputProvider: () => 'browser' as const,
      getEffectiveInputProvider: () => 'browser' as const,
      getState: () => ({
        status: 'idle' as const,
        error: null,
        finalTranscript: '',
        finalConfidence: null,
      }),
      setState: vi.fn(),
      setQuestionDraft: vi.fn(),
      clearQuestionFeedback: vi.fn(),
      reportQuestionFeedbackError: vi.fn(),
      getRuntimeState: () => ({
        status: 'idle',
        lastOutcome: null,
        requestedProvider: 'browser',
        effectiveProvider: 'browser',
        captureProvider: null,
        providerStyle: null,
        transcriptSource: null,
        lastTranscript: null,
        lastTranscriptConfidence: null,
        lastCaptureStartedAt: null,
        lastSpeechDetectedAt: null,
        lastCapturedAt: null,
        lastProcessedAt: null,
        lastCaptureDurationMs: null,
        lastRoundTripMs: null,
        lastEventAt: null,
        lastError: null,
        successfulTurns: 0,
        noSpeechTurns: 0,
        errorCount: 0,
        consecutiveNoSpeechTurns: 0,
        consecutiveErrorTurns: 0,
        liveSessionId: null,
      }),
      getSelectedInputDeviceId: () => null,
      updateResolvedInput: vi.fn(),
      canUseBackendRecordedFallback: () => true,
      getSilenceThreshold: () => 0.018,
      releasePracticeForListening: vi.fn(() => Promise.resolve()),
      render: vi.fn(),
      syncRuntimeEvent: vi.fn(() => Promise.resolve()),
      submitInputTurn: vi.fn(() => Promise.resolve({})),
      handleCapturedQuestion: vi.fn(() => Promise.resolve()),
      applyInputProviderStatusPayload: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
    },
    runtimeBootstrap: {
      runtimeService: {
        getCurrentMode: () => 'voice',
        canPlaySpeech: () => true,
        getSpeechProvider: () => 'browser' as const,
        addTerminalLine: vi.fn(),
        render: vi.fn(),
      },
      runtimeCoordinator: {
        getInteractionSnapshot: vi.fn(),
        hasInputProvider: () => true,
        supportsAutomaticTurnBoundary: () => true,
        getRecoveryState: () => ({ shouldDisableContinuous: false }),
        getContinuousEnabled: () => true,
        getSpeechRecognitionStatus: () => 'idle' as const,
        getQuestionDraft: () => '',
        getLatestCoachMessage: () => null,
        getLastSpokenCoachMessageId: () => null,
        armPracticeSessionWithNotice: vi.fn(() => Promise.resolve()),
        disarmPracticeSession: vi.fn(() => Promise.resolve()),
        onPracticeArmError: vi.fn(),
        render: vi.fn(),
        getPostPlaybackContext: () => ({
          currentMode: 'voice',
          currentSessionId: 'session-1',
          isConnected: true,
          hasActiveGuideSession: false,
          voiceSessionArmed: false,
          voiceTakeActive: false,
          voiceTakeProcessing: false,
          voiceTransportStatus: 'idle' as const,
          voiceDeepTutorLessonStatus: 'idle' as const,
          voiceCoachTaskStatus: 'idle' as const,
          voiceCoachQuestionStatus: 'idle' as const,
          referenceMimicAction: null,
        }),
      },
    },
  };
}

function createTransportHarness(start: () => Promise<boolean | void>) {
  const sessionLease = {};
  const options = createBootstrapOptions(sessionLease);
  let capturedSpeechOptions: any = null;
  let capturedInputOptions: any = null;
  const speechController = {
    speak: vi.fn(() => true),
    stop: vi.fn(),
    isSpeaking: vi.fn(() => false),
    isPlaying: vi.fn(() => false),
  };
  const inputController = {
    start: vi.fn(start),
    stop: vi.fn(),
    toggle: vi.fn(),
  };
  const bootstrap = createVoiceCoachTransportBootstrap(options, {
    createSpeechController: ((controllerOptions: any) => {
      capturedSpeechOptions = controllerOptions;
      return speechController;
    }) as any,
    createInputController: ((controllerOptions: any) => {
      capturedInputOptions = controllerOptions;
      return inputController;
    }) as any,
  });

  return {
    bootstrap,
    sessionLease,
    speechController,
    inputController,
    addTerminalLine: options.runtimeBootstrap.runtimeService.addTerminalLine,
    render: options.runtimeBootstrap.runtimeService.render,
    capturedSpeechOptions,
    capturedInputOptions,
  };
}

describe('voice coach transport bootstrap', () => {
  it('crosses the real runtime service and wires speech, stop, and toggle transports', async () => {
    const harness = createTransportHarness(() => Promise.resolve(true));
    const message = {
      id: 'coach-1',
      role: 'coach',
      channel: 'runtime',
      kind: 'runtime-answer',
      content: 'Try the ending lighter.',
      createdAt: 1,
    } as const;

    await expect(harness.bootstrap.startCoachListening()).resolves.toBe(true);
    harness.bootstrap.stopCoachListening(true);
    harness.bootstrap.speakCoachMessage(message, 0.97);
    harness.bootstrap.stopCoachSpeech();
    harness.bootstrap.toggleCoachListening();

    expect(harness.inputController.start).toHaveBeenCalledTimes(1);
    expect(harness.inputController.stop).toHaveBeenNthCalledWith(1, true);
    expect(harness.inputController.stop).toHaveBeenNthCalledWith(2, false);
    expect(harness.speechController.speak).toHaveBeenCalledWith(message, {
      provider: 'browser',
      rate: 0.97,
    });
    expect(harness.speechController.stop).toHaveBeenCalledTimes(2);
    expect(harness.inputController.toggle).toHaveBeenCalledTimes(1);
  });

  it('preserves legacy void listening starts as successful', async () => {
    const harness = createTransportHarness(() => Promise.resolve());

    await expect(harness.bootstrap.startCoachListening()).resolves.toBe(true);
    expect(harness.inputController.start).toHaveBeenCalledTimes(1);
  });

  it('returns false without a reopen notice when the input controller declines to start', async () => {
    const harness = createTransportHarness(() => Promise.resolve(false));

    await expect(
      harness.bootstrap.reopenCoachListeningWithNotice('Coach back on mic.'),
    ).resolves.toBe(false);
    expect(harness.inputController.start).toHaveBeenCalledTimes(1);
    expect(harness.addTerminalLine).not.toHaveBeenCalled();
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('preserves the transport-owned terminal state when the input controller rejects', async () => {
    let terminalSentinel = 'idle';
    const harness = createTransportHarness(async () => {
      terminalSentinel = 'input-controller: mic offline';
      throw new Error('mic offline');
    });
    harness.addTerminalLine.mockImplementation((_type, content) => {
      terminalSentinel = `runtime-service: ${content}`;
    });

    await expect(
      harness.bootstrap.reopenCoachListeningWithNotice('Coach back on mic.'),
    ).resolves.toBe(false);
    expect(terminalSentinel).toBe('input-controller: mic offline');
    expect(harness.inputController.start).toHaveBeenCalledTimes(1);
    expect(harness.addTerminalLine).not.toHaveBeenCalled();
    expect(harness.render).not.toHaveBeenCalled();
  });

  it('routes controller callbacks back through the shared runtime service and coordinator', async () => {
    const harness = createTransportHarness(() => Promise.resolve());
    const runPostPlaybackHandoff = vi.spyOn(
      harness.bootstrap.runtimeCoordinator,
      'runPostPlaybackHandoff',
    ).mockResolvedValue({ action: 'noop' });

    harness.capturedInputOptions.stopCoachSpeech();
    await harness.capturedSpeechOptions.onPlaybackFinished();

    expect(harness.speechController.stop).toHaveBeenCalledTimes(1);
    expect(runPostPlaybackHandoff).toHaveBeenCalledTimes(1);
  });

  it('forwards the session lease only to the input controller factory by identity', () => {
    const harness = createTransportHarness(() => Promise.resolve(true));
    const inputSessionContext = harness.capturedInputOptions.getSessionContext();
    const speechSessionContext = harness.capturedSpeechOptions.getSessionContext();

    expect(inputSessionContext.sessionLease).toBe(harness.sessionLease);
    expect(speechSessionContext).not.toHaveProperty('sessionLease');
  });
});
