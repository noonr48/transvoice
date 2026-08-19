import { describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceUiState } from './state';
import { createVoiceRuntimeStore } from './runtime-store';
import { createVoiceHostActionsController } from './host-actions-controller';

function flushMicrotasks(): Promise<void> {
  return Promise.resolve().then(() => undefined);
}

function createHarness() {
  const store = createVoiceRuntimeStore({
    voiceUiState: createDefaultVoiceUiState({
      coachVoice: {
        speechEnabled: true,
        continuousEnabled: true,
        speechProvider: 'browser',
        inputProvider: 'browser',
      },
    }),
  });

  let currentSessionId: string | null = 'session-1';
  let isConnected = true;
  let currentMode = 'voice';
  let sessionMode = 'voice';
  let hasActiveGuideSession = false;
  let shouldRebuildLesson = false;
  let shouldAutoReturnPracticeToCoachAfterTake = false;
  let latestCoachMessageId: string | null = 'coach-1';
  let latestCoachMessage = {
    id: latestCoachMessageId,
    role: 'coach',
    channel: 'runtime',
    kind: 'runtime-answer',
    content: 'Try the ending lighter.',
    createdAt: 1,
  } as const;
  let referenceMimicAction: string | null = 'repeat';
  const coachQuestionInput = { value: '' };
  const interaction = { hasCoachSpeaking: false };
  const resumeInteraction = { marker: 'resume' };

  const render = vi.fn();
  const applyVoiceBackendPayload = vi.fn();
  const submitRuntimeCoachQuestionRequest = vi.fn(async () => ({ ok: true } as any));
  const prepareConditioningLatentsRequest = vi.fn(async () => ({ ok: true } as any));

  const coachShell = {
    stopCoachListening: vi.fn(),
    startCoachListening: vi.fn(async () => true),
    reopenCoachListeningWithNotice: vi.fn(async () => undefined),
    stopCoachSpeech: vi.fn(),
    submitCoachRequest: vi.fn(async (requestOptions: any) => requestOptions.request()),
    clearCoachPollTimer: vi.fn(),
    requestCoachNote: vi.fn(async () => undefined),
    handoffPracticeAfterTake: vi.fn(async () => undefined),
    resumeDeepTutorLoop: vi.fn(async () => undefined),
    refreshCockpitLine: vi.fn(async () => undefined),
    updateCockpitState: vi.fn(async () => undefined),
    updateConditioningState: vi.fn(async () => undefined),
    startDeepTutorLesson: vi.fn(async () => undefined),
    advanceDeepTutorLesson: vi.fn(async () => undefined),
  };

  const runtimeShell = {
    supportsAutomaticTurnBoundary: vi.fn(() => true),
    getInputRecoveryState: vi.fn(() => ({
      shouldDisableContinuous: false,
    })),
  };

  const liveTransitionController = {
    startPracticeSession: vi.fn(async () => true),
    beginPracticeTake: vi.fn(() => true),
    endPracticeTake: vi.fn(async () => true),
    disarmPracticeSession: vi.fn(async () => true),
    prepareForSessionTransition: vi.fn(async () => undefined),
  };

  let currentCoachShell: any = coachShell;
  let currentRuntimeShell: any = runtimeShell;
  let currentLiveTransitionController: any = liveTransitionController;

  const appRuntime = {
    canUseVoiceCoachVoiceInputFromSnapshot: vi.fn(() => true),
    getDeepTutorVoiceInteractionState: vi.fn(() => resumeInteraction),
    getLatestCoachMessage: vi.fn(() => latestCoachMessage),
    getVoiceInteractionSnapshot: vi.fn(() => interaction),
    getVoiceReferenceMimicState: vi.fn(() => ({ action: referenceMimicAction })),
    hasActiveDeepTutorGuideSession: vi.fn(() => hasActiveGuideSession),
    shouldAutoReturnPracticeToCoachAfterTake: vi.fn(() => shouldAutoReturnPracticeToCoachAfterTake),
    shouldRebuildDeepTutorVoiceLesson: vi.fn(() => shouldRebuildLesson),
  };

  const controller = createVoiceHostActionsController({
    store,
    getAppRuntime: () => appRuntime,
    getCurrentMode: () => currentMode,
    resolveSessionMode: () => sessionMode,
    getCurrentSessionId: () => currentSessionId,
    getIsConnected: () => isConnected,
    getCoachQuestionInput: () => coachQuestionInput,
    render,
    applyVoiceBackendPayload,
    submitRuntimeCoachQuestionRequest,
    prepareConditioningLatentsRequest,
    getCoachShell: () => currentCoachShell,
    getRuntimeShell: () => currentRuntimeShell,
    getLiveTransitionController: () => currentLiveTransitionController,
  });

  return {
    controller,
    store,
    coachQuestionInput,
    appRuntime,
    setConnection(nextSessionId: string | null, nextIsConnected: boolean) {
      currentSessionId = nextSessionId;
      isConnected = nextIsConnected;
    },
    setModes(nextCurrentMode: string, nextSessionMode: string) {
      currentMode = nextCurrentMode;
      sessionMode = nextSessionMode;
    },
    setGuideSession(active: boolean) {
      hasActiveGuideSession = active;
    },
    setShouldRebuildLesson(value: boolean) {
      shouldRebuildLesson = value;
    },
    setAutoReturn(value: boolean) {
      shouldAutoReturnPracticeToCoachAfterTake = value;
    },
    setLatestCoachMessageId(messageId: string | null) {
      latestCoachMessageId = messageId;
      latestCoachMessage = messageId ? {
        ...latestCoachMessage,
        id: messageId,
      } : null as any;
    },
    setReferenceMimicAction(action: string | null) {
      referenceMimicAction = action;
    },
    setCoachShell(nextCoachShell: any) {
      currentCoachShell = nextCoachShell;
    },
    setRuntimeShell(nextRuntimeShell: any) {
      currentRuntimeShell = nextRuntimeShell;
    },
    setLiveTransitionController(nextLiveTransitionController: any) {
      currentLiveTransitionController = nextLiveTransitionController;
    },
    mocks: {
      render,
      applyVoiceBackendPayload,
      submitRuntimeCoachQuestionRequest,
      prepareConditioningLatentsRequest,
      coachShell,
      runtimeShell,
      liveTransitionController,
    },
  };
}

describe('voice host actions controller', () => {
  // 2026-07-27 (owner's law): ALL learner speech goes to the tutor. These are
  // the utterances the old clarification lane used to CONSUME — "say that
  // again" replayed TTS, "i'm ready" silently armed the practice mic (the
  // live dead-turn fault). Each must now become a REAL tutor request carrying
  // the learner's own words.
  it('sends command-shaped speech to the tutor instead of consuming it', async () => {
    const harness = createHarness();

    for (const spoken of ['say that again', "i'm ready", 'make it easier']) {
      harness.mocks.submitRuntimeCoachQuestionRequest.mockClear();
      await harness.controller.submitVoiceCoachQuestion(spoken);
      expect(harness.mocks.submitRuntimeCoachQuestionRequest).toHaveBeenCalledWith(
        'session-1',
        spoken,
        undefined,
        undefined,
      );
    }
  });

  it('submits runtime coach questions after stopping listening and speech', async () => {
    const harness = createHarness();
    harness.coachQuestionInput.value = 'what should I fix next?';

    await harness.controller.submitVoiceCoachQuestion();

    expect(harness.mocks.coachShell.stopCoachListening).toHaveBeenCalledWith(true);
    expect(harness.mocks.coachShell.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(harness.mocks.coachShell.submitCoachRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        pendingChannel: 'legacy',
        clearInputOnSuccess: true,
      }),
    );
    expect(harness.mocks.submitRuntimeCoachQuestionRequest).toHaveBeenCalledWith(
      'session-1',
      'what should I fix next?',
      undefined,
      undefined,
    );
  });

  it('forwards a live listening turn id with the runtime coach question', async () => {
    const harness = createHarness();

    await harness.controller.submitVoiceCoachQuestion(
      'what should I fix next?',
      { listeningTurnId: 'listening-turn-7' },
    );

    expect(harness.mocks.submitRuntimeCoachQuestionRequest).toHaveBeenCalledWith(
      'session-1',
      'what should I fix next?',
      undefined,
      undefined,
      'listening-turn-7',
    );
  });

  it('captures continuous-loop startup failures in speech recognition state', async () => {
    const harness = createHarness();
    harness.mocks.coachShell.startCoachListening.mockRejectedValueOnce(new Error('mic unavailable'));

    harness.controller.ensureVoiceCoachContinuousLoop();
    await flushMicrotasks();
    await flushMicrotasks();

    expect(harness.mocks.coachShell.startCoachListening).toHaveBeenCalledTimes(1);
    expect(harness.store.getState().voiceSpeechRecognition.status).toBe('error');
    expect(harness.store.getState().voiceSpeechRecognition.error).toBe('mic unavailable');
    expect(harness.mocks.render).toHaveBeenCalledTimes(1);
  });

  it('re-reads late-bound coach and runtime shells on demand', async () => {
    const harness = createHarness();
    harness.setCoachShell(null);
    harness.setRuntimeShell(null);

    await expect(harness.controller.startVoiceCoachListening()).resolves.toBe(false);
    harness.controller.stopVoiceCoachListening(true);
    harness.controller.stopVoiceCoachSpeech();
    harness.controller.clearVoiceCoachPollTimer();
    harness.controller.ensureVoiceCoachContinuousLoop();
    await flushMicrotasks();

    expect(harness.mocks.coachShell.startCoachListening).not.toHaveBeenCalled();
    expect(harness.mocks.coachShell.stopCoachListening).not.toHaveBeenCalled();
    expect(harness.mocks.coachShell.stopCoachSpeech).not.toHaveBeenCalled();
    expect(harness.mocks.coachShell.clearCoachPollTimer).not.toHaveBeenCalled();

    harness.setCoachShell(harness.mocks.coachShell as any);
    harness.setRuntimeShell(harness.mocks.runtimeShell as any);

    await expect(harness.controller.startVoiceCoachListening()).resolves.toBe(true);
    harness.controller.stopVoiceCoachListening(true);
    harness.controller.stopVoiceCoachSpeech();
    harness.controller.clearVoiceCoachPollTimer();
    harness.controller.ensureVoiceCoachContinuousLoop();
    await flushMicrotasks();

    expect(harness.mocks.coachShell.startCoachListening).toHaveBeenCalledTimes(2);
    expect(harness.mocks.coachShell.stopCoachListening).toHaveBeenCalledWith(true);
    expect(harness.mocks.coachShell.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(harness.mocks.coachShell.clearCoachPollTimer).toHaveBeenCalledTimes(1);
  });

  it('resets coach runtime state through the currently bound coach shell', () => {
    const harness = createHarness();
    const reboundCoachShell = {
      ...harness.mocks.coachShell,
      stopCoachListening: vi.fn(),
      stopCoachSpeech: vi.fn(),
      clearCoachPollTimer: vi.fn(),
    };

    harness.store.patchState({
      voiceCoachTaskId: 'task-1',
      voiceCoachTaskStatus: 'error',
      voiceCoachTaskError: 'stale task',
      voiceCoachQuestionStatus: 'error',
      voiceCoachQuestionError: 'stale question',
      voicePendingCoachChannel: 'deeptutor',
      voiceLastSpokenCoachMessageId: 'coach-old',
      voiceDeepTutorLessonStatus: 'error',
      voiceDeepTutorLessonError: 'stale lesson',
      voiceForecastStatus: 'error',
      voiceForecastError: 'stale forecast',
    });
    harness.setCoachShell(reboundCoachShell as any);
    harness.setLatestCoachMessageId('coach-2');

    harness.controller.resetVoiceCoachRuntimeUiState({
      stopListening: true,
      stopSpeech: true,
      resetLessonStatus: true,
      resetForecastState: true,
      syncLastSpokenCoachMessage: true,
    });

    expect(reboundCoachShell.stopCoachListening).toHaveBeenCalledWith(true);
    expect(reboundCoachShell.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(reboundCoachShell.clearCoachPollTimer).toHaveBeenCalledTimes(1);
    expect(harness.mocks.coachShell.stopCoachListening).not.toHaveBeenCalled();
    expect(harness.mocks.coachShell.stopCoachSpeech).not.toHaveBeenCalled();
    expect(harness.mocks.coachShell.clearCoachPollTimer).not.toHaveBeenCalled();
    expect(harness.store.getState()).toMatchObject({
      voiceCoachTaskId: null,
      voiceCoachTaskStatus: 'idle',
      voiceCoachTaskError: null,
      voiceCoachQuestionStatus: 'idle',
      voiceCoachQuestionError: null,
      voicePendingCoachChannel: null,
      voiceLastSpokenCoachMessageId: 'coach-2',
      voiceDeepTutorLessonStatus: 'idle',
      voiceDeepTutorLessonError: null,
      voiceForecastStatus: 'idle',
      voiceForecastError: null,
    });
  });

  it('only hands practice back to the coach when guided auto-return is enabled', async () => {
    const harness = createHarness();
    harness.store.patchState({
      voiceSessionArmed: true,
      voiceTransportStatus: 'streaming',
    });

    await harness.controller.handoffVoicePracticeToCoachAfterTake();
    expect(harness.mocks.coachShell.handoffPracticeAfterTake).not.toHaveBeenCalled();

    harness.setAutoReturn(true);
    await harness.controller.handoffVoicePracticeToCoachAfterTake();

    expect(harness.mocks.coachShell.handoffPracticeAfterTake).toHaveBeenCalledWith({
      voiceSessionArmed: true,
      voiceTransportStatus: 'streaming',
    });
  });

  it('prepares conditioning latents through the backend request and applies the payload', async () => {
    const harness = createHarness();
    const payload = { voiceState: { voiceSessionId: 'voice-session-1' } } as any;
    harness.mocks.prepareConditioningLatentsRequest.mockResolvedValueOnce(payload);

    await harness.controller.prepareVoiceConditioningLatents(
      'prompt',
      new File(['sample'], 'prompt.wav', { type: 'audio/wav' }),
      'coach prompt',
    );

    expect(harness.mocks.prepareConditioningLatentsRequest).toHaveBeenCalledWith(
      'session-1',
      'prompt',
      expect.any(File),
      'coach prompt',
    );
    expect(harness.mocks.applyVoiceBackendPayload).toHaveBeenCalledWith(payload);
  });

  it('forwards practice arming notices through the live transition controller and only renders on success', async () => {
    const harness = createHarness();

    await harness.controller.armVoicePracticeSessionWithNotice('Practice armed for the next pass.');
    expect(harness.mocks.liveTransitionController.startPracticeSession).toHaveBeenCalledWith({
      silent: true,
      successNotice: 'Practice armed for the next pass.',
    });
    expect(harness.mocks.render).toHaveBeenCalledTimes(1);

    harness.mocks.liveTransitionController.startPracticeSession.mockResolvedValueOnce(false);
    await harness.controller.armVoicePracticeSessionWithNotice('Practice armed for the next pass.');

    expect(harness.mocks.render).toHaveBeenCalledTimes(1);
  });

  it('guards live-session transition cleanup outside voice mode', async () => {
    const harness = createHarness();
    harness.setModes('agent', 'agent');

    await harness.controller.prepareForLiveSessionTransition('session mode switch');
    expect(harness.mocks.liveTransitionController.prepareForSessionTransition).not.toHaveBeenCalled();

    harness.setModes('agent', 'voice');
    await harness.controller.prepareForLiveSessionTransition('session mode switch');

    expect(harness.mocks.liveTransitionController.prepareForSessionTransition).toHaveBeenCalledWith(
      'session mode switch',
    );
  });
});
