import { describe, expect, it, vi } from 'vitest';
import { createVoiceCoachControllerBootstrap } from './coach-controller-bootstrap';

function createBootstrapOptions() {
  return {
    requestController: {
      setQuestionStatus: vi.fn(),
      setQuestionError: vi.fn(),
      setPendingChannel: vi.fn(),
      clearPendingState: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      render: vi.fn(),
      clearQuestionInput: vi.fn(),
      setLastSpokenCoachMessageId: vi.fn(),
    },
    noteController: {
      getSessionContext: () => ({
        currentSessionId: 'session-1',
        isConnected: true,
      }),
      hasLastSummary: () => true,
      hasActiveGuideSession: () => false,
      requestDeepTutorCoach: vi.fn(() => Promise.resolve({})),
      startCoachTask: vi.fn(() => Promise.resolve({ taskId: 'task-1' })),
      getTaskStatus: vi.fn(() => Promise.resolve({ status: 'done', result: 'done' })),
      applyVoiceBackendPayload: vi.fn(),
      syncVoiceSessionStateFromBackend: vi.fn(() => Promise.resolve()),
      updateLastCoachResult: vi.fn(),
      setTaskId: vi.fn(),
      setTaskStatus: vi.fn(),
      setTaskError: vi.fn(),
      setPendingChannel: vi.fn(),
      clearPendingState: vi.fn(),
      render: vi.fn(),
    },
    deepTutorSessionController: {
      getSessionContext: () => ({
        currentSessionId: 'session-1',
        isConnected: true,
      }),
      hasActiveGuideSession: () => true,
      shouldRebuildLesson: () => false,
      startLessonRequest: vi.fn(() => Promise.resolve({})),
      advanceLessonRequest: vi.fn(() => Promise.resolve({})),
      applyVoiceBackendPayload: vi.fn(),
      setLessonStatus: vi.fn(),
      setLessonError: vi.fn(),
      disarmPracticeSession: vi.fn(() => Promise.resolve()),
      runCoachResumeHandoff: vi.fn(() => Promise.resolve({ action: 'noop' })),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
    },
    cockpitController: {
      getSessionContext: () => ({
        currentSessionId: 'session-1',
        isConnected: true,
      }),
      getVoiceUiState: vi.fn(),
      updateVoiceUiState: vi.fn(),
      persistCockpitStateRequest: vi.fn(() => Promise.resolve({})),
      persistConditioningStateRequest: vi.fn(() => Promise.resolve({})),
      refreshCockpitLineRequest: vi.fn(() => Promise.resolve({})),
      applyVoiceBackendPayload: vi.fn(),
      assertPracticeTargetUnlocked: vi.fn(),
      stopCoachListening: vi.fn(),
      stopCoachSpeech: vi.fn(),
      ensureContinuousLoop: vi.fn(),
      setLastSpokenCoachMessageId: vi.fn(),
      addTerminalLine: vi.fn(),
      render: vi.fn(),
      getRequestedSpeechProvider: () => 'browser' as const,
      getRequestedInputProvider: () => 'browser' as const,
      getEffectiveInputProvider: () => 'browser' as const,
      getEffectiveInputCapabilities: vi.fn(() => null),
      supportsAutomaticTurnBoundary: vi.fn(() => true),
      hasBrowserSpeechRecognitionSupport: vi.fn(() => true),
      getNextInputProvider: vi.fn(() => 'backend' as const),
      buildInputRuntimeRecoveryReset: vi.fn((runtime) => runtime),
      getInputRecoveryState: vi.fn(() => ({
        level: 'ok',
        statusLabel: null,
        coachCopy: null,
        activeDrillCopy: null,
        providerHint: null,
        runtimePill: null,
        suggestedInputProvider: null,
        shouldDisableContinuous: false,
        disableReason: null,
      })),
    },
  };
}

describe('voice coach controller bootstrap', () => {
  it('composes the non-transport controller graph and exposes delegation helpers', async () => {
    const options = createBootstrapOptions();
    const requestController = {
      submitRequest: vi.fn(() => Promise.resolve({ ok: true })),
    };
    const noteController = {
      clearPollTimer: vi.fn(),
      requestCoachNote: vi.fn(() => Promise.resolve()),
    };
    const deepTutorSessionController = {
      startLesson: vi.fn(() => Promise.resolve()),
      advanceLesson: vi.fn(() => Promise.resolve()),
      handoffPracticeAfterTake: vi.fn(() => Promise.resolve()),
      resumeLoop: vi.fn(() => Promise.resolve()),
    };
    const cockpitController = {
      refreshLine: vi.fn(() => Promise.resolve()),
      updateCockpitState: vi.fn(() => Promise.resolve()),
      updateConditioningState: vi.fn(() => Promise.resolve()),
      setContinuousMode: vi.fn(() => Promise.resolve(true)),
      toggleContinuousMode: vi.fn(() => Promise.resolve()),
      toggleSpeechProvider: vi.fn(() => Promise.resolve()),
      toggleInputProvider: vi.fn(() => Promise.resolve()),
      toggleSpeechEnabled: vi.fn(() => Promise.resolve()),
      toggleAdvancedPanel: vi.fn(() => Promise.resolve()),
    };

    const bootstrap = createVoiceCoachControllerBootstrap(options, {
      createRequestController: (() => requestController) as any,
      createNoteController: (() => noteController) as any,
      createDeepTutorSessionController: (() => deepTutorSessionController) as any,
      createCockpitController: (() => cockpitController) as any,
    });

    const requestOptions = {
      pendingChannel: 'coach' as const,
      request: vi.fn(() => Promise.resolve({})),
      clearInputOnSuccess: true,
    };
    const practiceContext = { voiceSessionArmed: true, voiceTransportStatus: 'streaming' as const };
    const resumeContext = { interaction: { lessonMode: 'active' } } as any;
    const cockpitPatch = { coachVoice: { speechEnabled: true } };
    const conditioningPatch = { promptText: 'hello' };

    await bootstrap.submitCoachRequest(requestOptions);
    bootstrap.clearCoachPollTimer();
    await bootstrap.requestCoachNote();
    await bootstrap.startDeepTutorLesson();
    await bootstrap.advanceDeepTutorLesson();
    await bootstrap.handoffPracticeAfterTake(practiceContext);
    await bootstrap.resumeDeepTutorLoop(resumeContext);
    await bootstrap.refreshCockpitLine('regenerate');
    await bootstrap.updateCockpitState(cockpitPatch);
    await bootstrap.updateConditioningState(conditioningPatch);
    await bootstrap.setContinuousMode(true);
    await bootstrap.toggleContinuousMode();
    await bootstrap.toggleSpeechProvider();
    await bootstrap.toggleInputProvider();
    await bootstrap.toggleSpeechEnabled();
    await bootstrap.toggleAdvancedPanel();

    expect(requestController.submitRequest).toHaveBeenCalledWith(requestOptions);
    expect(noteController.clearPollTimer).toHaveBeenCalledTimes(1);
    expect(noteController.requestCoachNote).toHaveBeenCalledTimes(1);
    expect(deepTutorSessionController.startLesson).toHaveBeenCalledTimes(1);
    expect(deepTutorSessionController.advanceLesson).toHaveBeenCalledTimes(1);
    expect(deepTutorSessionController.handoffPracticeAfterTake).toHaveBeenCalledWith(practiceContext);
    expect(deepTutorSessionController.resumeLoop).toHaveBeenCalledWith(resumeContext);
    expect(cockpitController.refreshLine).toHaveBeenCalledWith('regenerate');
    expect(cockpitController.updateCockpitState).toHaveBeenCalledWith(cockpitPatch);
    expect(cockpitController.updateConditioningState).toHaveBeenCalledWith(conditioningPatch);
    expect(cockpitController.setContinuousMode).toHaveBeenCalledWith(true);
    expect(cockpitController.toggleContinuousMode).toHaveBeenCalledTimes(1);
    expect(cockpitController.toggleSpeechProvider).toHaveBeenCalledTimes(1);
    expect(cockpitController.toggleInputProvider).toHaveBeenCalledTimes(1);
    expect(cockpitController.toggleSpeechEnabled).toHaveBeenCalledTimes(1);
    expect(cockpitController.toggleAdvancedPanel).toHaveBeenCalledTimes(1);
    expect(bootstrap.requestController).toBe(requestController);
    expect(bootstrap.noteController).toBe(noteController);
    expect(bootstrap.deepTutorSessionController).toBe(deepTutorSessionController);
    expect(bootstrap.cockpitController).toBe(cockpitController);
  });
});
