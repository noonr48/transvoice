import { describe, expect, it, vi } from 'vitest';
import { createVoiceCoachRuntimeBootstrap } from './runtime-bootstrap';
import {
  createDeepTutorVoiceInteractionState,
  createVoiceInteractionSnapshot,
} from './orchestrator';

function createSnapshot() {
  return createVoiceInteractionSnapshot({
    currentMode: 'voice',
    currentSessionId: 'session-1',
    isConnected: true,
    voiceTakeProcessing: false,
    voiceTakeActive: false,
    voiceTransportStatus: 'idle',
    voiceCoachQuestionStatus: 'idle',
    voiceCoachTaskStatus: 'idle',
    voiceDeepTutorLessonStatus: 'idle',
    voiceSpeechRecognitionStatus: 'idle',
    speechSynthesisBusy: false,
    voiceSessionArmed: false,
  });
}

function createDeepTutorInteraction() {
  return createDeepTutorVoiceInteractionState({
    snapshot: createVoiceInteractionSnapshot({
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      voiceTakeProcessing: false,
      voiceTakeActive: true,
      voiceTransportStatus: 'streaming',
      voiceCoachQuestionStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'idle',
      speechSynthesisBusy: false,
      voiceSessionArmed: false,
    }),
    shouldRebuildLesson: false,
    hasActiveGuideSession: true,
    voiceDeepTutorLessonStatus: 'idle',
    voiceSpeechRecognitionStatus: 'idle',
    referenceMimicAction: null,
    canUseVoiceCoachVoiceInput: false,
    canUseVoiceCoachVoiceInputAfterRelease: true,
    latestCoachMessageId: 'coach-1',
    lastSpokenCoachMessageId: 'coach-0',
  });
}

function createBootstrap(overrides: Partial<{
  canPlaySpeech: boolean;
  startListeningTransport: () => Promise<boolean | void>;
  getLatestCoachMessage: () => {
    id: string;
    role: 'coach';
    channel: 'runtime' | 'deeptutor';
    kind: 'runtime-answer' | 'deeptutor-lesson-advance';
    content: string;
    createdAt: number;
  } | null;
}> = {}) {
  const startListeningTransport = vi.fn(
    overrides.startListeningTransport ?? (() => Promise.resolve()),
  );
  const stopListeningTransport = vi.fn();
  const stopSpeechTransport = vi.fn();
  const playSpeechTransport = vi.fn(() => true);
  const addTerminalLine = vi.fn();
  const render = vi.fn();
  const disarmPracticeSession = vi.fn(() => Promise.resolve());

  const runtime = createVoiceCoachRuntimeBootstrap({
    runtimeService: {
      getCurrentMode: () => 'voice',
      canPlaySpeech: () => overrides.canPlaySpeech ?? true,
      getSpeechProvider: () => 'browser',
      startListeningTransport,
      stopListeningTransport,
      stopSpeechTransport,
      playSpeechTransport,
      addTerminalLine,
      render,
    },
    runtimeCoordinator: {
      getInteractionSnapshot: createSnapshot,
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: overrides.getLatestCoachMessage ?? (() => ({
        id: 'coach-1',
        role: 'coach' as const,
        channel: 'runtime' as const,
        kind: 'runtime-answer' as const,
        content: 'Try the ending lighter.',
        createdAt: 1,
      })),
      getLastSpokenCoachMessageId: () => null,
      armPracticeSessionWithNotice: vi.fn(() => Promise.resolve()),
      disarmPracticeSession,
      onPracticeArmError: vi.fn(),
      render,
      getPostPlaybackContext: () => ({
        currentMode: 'voice',
        currentSessionId: 'session-1',
        isConnected: true,
        hasActiveGuideSession: true,
        voiceSessionArmed: false,
        voiceTakeActive: false,
        voiceTakeProcessing: false,
        voiceTransportStatus: 'idle',
        voiceDeepTutorLessonStatus: 'idle',
        voiceCoachTaskStatus: 'idle',
        voiceCoachQuestionStatus: 'idle',
        referenceMimicAction: 'hold',
      }),
    },
  });

  return {
    ...runtime,
    startListeningTransport,
    stopListeningTransport,
    stopSpeechTransport,
    playSpeechTransport,
    addTerminalLine,
    render,
    disarmPracticeSession,
  };
}

describe('voice runtime bootstrap', () => {
  it('composes render handoffs through the shared runtime service', async () => {
    const runtime = createBootstrap();

    const plan = await runtime.runtimeCoordinator.runRenderHandoff();

    expect(plan).toEqual({ action: 'speak-latest-coach' });
    expect(runtime.stopListeningTransport).toHaveBeenCalledWith(false);
    expect(runtime.stopSpeechTransport).toHaveBeenCalledTimes(1);
    expect(runtime.playSpeechTransport).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'coach-1' }),
      { provider: 'browser', rate: 0.76 },
    );
  });

  it('composes DeepTutor resume handoffs through the shared runtime service', async () => {
    const runtime = createBootstrap({
      getLatestCoachMessage: () => ({
        id: 'coach-1',
        role: 'coach',
        channel: 'deeptutor',
        kind: 'deeptutor-lesson-advance',
        content: 'Try the next pass now.',
        createdAt: 1,
      }),
    });

    const plan = await runtime.runtimeCoordinator.runDeepTutorResumeHandoff(createDeepTutorInteraction());

    expect(plan).toEqual({ action: 'disarm-practice-and-listen' });
    expect(runtime.disarmPracticeSession).toHaveBeenCalledWith('resume coach loop');
    expect(runtime.startListeningTransport).toHaveBeenCalledTimes(1);
    expect(runtime.addTerminalLine).toHaveBeenCalledWith('system', 'Coach listening reopened.');
    expect(runtime.render).toHaveBeenCalledTimes(1);
  });

  it('returns false without a reopen notice when the listening transport rejects', async () => {
    const runtime = createBootstrap({
      startListeningTransport: () => Promise.reject(new Error('mic offline')),
    });

    await expect(
      runtime.runtimeService.reopenCoachListeningWithNotice('Coach back on mic.'),
    ).resolves.toBe(false);
    expect(runtime.startListeningTransport).toHaveBeenCalledTimes(1);
    expect(runtime.addTerminalLine).not.toHaveBeenCalled();
    expect(runtime.render).not.toHaveBeenCalled();
  });
});
