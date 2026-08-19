import { describe, expect, it, vi } from 'vitest';
import { createVoiceRuntimeCoordinator } from './runtime-coordinator';
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

function createDeepTutorInteraction(overrides: {
  shouldRebuildLesson?: boolean;
  hasActiveGuideSession?: boolean;
  voiceDeepTutorLessonStatus?: 'idle' | 'loading' | 'error';
  voiceSpeechRecognitionStatus?: 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
  referenceMimicAction?: string | null;
  canUseVoiceCoachVoiceInput?: boolean;
  canUseVoiceCoachVoiceInputAfterRelease?: boolean;
  latestCoachMessageId?: string | null;
  lastSpokenCoachMessageId?: string | null;
  snapshot?: Partial<Parameters<typeof createVoiceInteractionSnapshot>[0]>;
} = {}) {
  const snapshot = createVoiceInteractionSnapshot({
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
    ...overrides.snapshot,
  });

  return createDeepTutorVoiceInteractionState({
    snapshot,
    shouldRebuildLesson: overrides.shouldRebuildLesson ?? false,
    hasActiveGuideSession: overrides.hasActiveGuideSession ?? true,
    voiceDeepTutorLessonStatus: overrides.voiceDeepTutorLessonStatus ?? 'idle',
    voiceSpeechRecognitionStatus: overrides.voiceSpeechRecognitionStatus ?? 'idle',
    referenceMimicAction: overrides.referenceMimicAction ?? null,
    canUseVoiceCoachVoiceInput: overrides.canUseVoiceCoachVoiceInput ?? false,
    canUseVoiceCoachVoiceInputAfterRelease: overrides.canUseVoiceCoachVoiceInputAfterRelease ?? false,
    latestCoachMessageId: overrides.latestCoachMessageId ?? null,
    lastSpokenCoachMessageId: overrides.lastSpokenCoachMessageId ?? null,
  });
}

function createRuntimeService(overrides: Partial<{
  canSpeakCoachMessage: ReturnType<typeof vi.fn>;
  speakCoachMessage: ReturnType<typeof vi.fn>;
  startCoachListening: ReturnType<typeof vi.fn>;
  reopenCoachListeningWithNotice: ReturnType<typeof vi.fn>;
}> = {}) {
  return {
    canSpeakCoachMessage: vi.fn(() => true),
    speakCoachMessage: vi.fn(() => true),
    startCoachListening: vi.fn(() => Promise.resolve(true)),
    reopenCoachListeningWithNotice: vi.fn(() => Promise.resolve(true)),
    ...overrides,
  };
}

describe('voice runtime coordinator', () => {
  it('shares one pending microphone reopen across render and post-playback handoffs', async () => {
    let releaseListening!: (started: boolean) => void;
    const pendingListening = new Promise<boolean>((resolve) => {
      releaseListening = resolve;
    });
    const runtimeService = createRuntimeService({
      canSpeakCoachMessage: vi.fn(() => false),
      startCoachListening: vi.fn(() => pendingListening),
    });
    const onPostPlaybackHandoff = vi.fn();
    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: createSnapshot,
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => null,
      getLastSpokenCoachMessageId: () => null,
      onPostPlaybackHandoff,
      runtimeService,
      armPracticeSessionWithNotice: vi.fn(() => Promise.resolve()),
      disarmPracticeSession: vi.fn(() => Promise.resolve()),
      render: vi.fn(),
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
    });

    const renderHandoff = coordinator.runRenderHandoff();
    const postPlaybackHandoff = coordinator.runPostPlaybackHandoff();

    await Promise.resolve();
    expect(runtimeService.startCoachListening).toHaveBeenCalledTimes(1);
    releaseListening(true);
    await expect(Promise.all([renderHandoff, postPlaybackHandoff])).resolves.toEqual([
      { action: 'start-continuous-listening' },
      { action: 'start-continuous-listening' },
    ]);
    expect(onPostPlaybackHandoff).toHaveBeenCalledWith(expect.objectContaining({
      action: 'start-continuous-listening',
      listeningStarted: true,
    }));
  });

  it('speaks the latest coach reply before it tries to reopen listening', async () => {
    const runtimeService = createRuntimeService();

    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: createSnapshot,
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => ({
        id: 'coach-1',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Try the ending lighter.',
        createdAt: 1,
      }),
      getLastSpokenCoachMessageId: () => null,
      runtimeService,
      armPracticeSessionWithNotice: vi.fn(() => Promise.resolve()),
      disarmPracticeSession: vi.fn(() => Promise.resolve()),
      render: vi.fn(),
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
    });

    const plan = await coordinator.runRenderHandoff();

    expect(plan).toEqual({ action: 'speak-latest-coach' });
    expect(runtimeService.speakCoachMessage).toHaveBeenCalledWith(expect.objectContaining({ id: 'coach-1' }));
    expect(runtimeService.startCoachListening).not.toHaveBeenCalled();
  });

  it('does not reopen listening while selected-voice speech is still generating', async () => {
    const runtimeService = createRuntimeService();
    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: () => createVoiceInteractionSnapshot({
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
        speechSynthesisBusy: true,
        voiceSessionArmed: false,
      }),
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => ({
        id: 'coach-1',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Try the ending lighter.',
        createdAt: 1,
      }),
      getLastSpokenCoachMessageId: () => 'coach-1',
      runtimeService,
      armPracticeSessionWithNotice: vi.fn(() => Promise.resolve()),
      disarmPracticeSession: vi.fn(() => Promise.resolve()),
      render: vi.fn(),
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
    });

    const plan = await coordinator.runRenderHandoff();

    expect(plan).toEqual({ action: 'noop' });
    expect(runtimeService.speakCoachMessage).not.toHaveBeenCalled();
    expect(runtimeService.startCoachListening).not.toHaveBeenCalled();
  });

  it('falls back to continuous listening when speech cannot actually start', async () => {
    const runtimeService = createRuntimeService({
      speakCoachMessage: vi.fn(() => false),
    });

    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: createSnapshot,
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => ({
        id: 'coach-1',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Try the ending lighter.',
        createdAt: 1,
      }),
      getLastSpokenCoachMessageId: () => null,
      runtimeService,
      armPracticeSessionWithNotice: vi.fn(() => Promise.resolve()),
      disarmPracticeSession: vi.fn(() => Promise.resolve()),
      render: vi.fn(),
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
    });

    const plan = await coordinator.runRenderHandoff();

    expect(plan).toEqual({ action: 'start-continuous-listening' });
    expect(runtimeService.startCoachListening).toHaveBeenCalledTimes(1);
  });

  it('auto-arms practice after playback when the latest coach reply is a mimic handoff', async () => {
    const armPracticeSessionWithNotice = vi.fn(() => Promise.resolve());
    const runtimeService = createRuntimeService({
      canSpeakCoachMessage: vi.fn(() => false),
      speakCoachMessage: vi.fn(() => false),
    });

    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: createSnapshot,
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => ({
        id: 'coach-1',
        role: 'coach',
        channel: 'deeptutor',
        kind: 'deeptutor-lesson-advance',
        content: 'Try the next pass now.',
        createdAt: 1,
      }),
      getLastSpokenCoachMessageId: () => 'coach-1',
      runtimeService,
      armPracticeSessionWithNotice,
      disarmPracticeSession: vi.fn(() => Promise.resolve()),
      onPracticeArmError: vi.fn(),
      render: vi.fn(),
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
        referenceMimicAction: 'repeat',
      }),
    });

    const plan = await coordinator.runPostPlaybackHandoff();

    expect(plan).toEqual({
      action: 'arm-practice',
      notice: 'Tutor armed practice for the next coached pass.',
    });
    expect(armPracticeSessionWithNotice).toHaveBeenCalledWith('Tutor armed practice for the next coached pass.');
    expect(runtimeService.startCoachListening).not.toHaveBeenCalled();
  });

  it('executes deep tutor resume handoffs through the shared runtime coordinator', async () => {
    const disarmPracticeSession = vi.fn(() => Promise.resolve());
    const runtimeService = createRuntimeService();

    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: createSnapshot,
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => ({
        id: 'coach-1',
        role: 'coach',
        channel: 'deeptutor',
        kind: 'deeptutor-lesson-advance',
        content: 'Try the next pass now.',
        createdAt: 1,
      }),
      getLastSpokenCoachMessageId: () => 'coach-0',
      runtimeService,
      armPracticeSessionWithNotice: vi.fn(() => Promise.resolve()),
      disarmPracticeSession,
      onPracticeArmError: vi.fn(),
      render: vi.fn(),
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
    });

    const plan = await coordinator.runDeepTutorResumeHandoff(createDeepTutorInteraction({
      snapshot: {
        voiceTakeActive: true,
        voiceTransportStatus: 'streaming',
      },
      canUseVoiceCoachVoiceInput: false,
      canUseVoiceCoachVoiceInputAfterRelease: true,
      latestCoachMessageId: 'coach-1',
      lastSpokenCoachMessageId: 'coach-0',
    }));

    expect(plan).toEqual({ action: 'disarm-practice-and-listen' });
    expect(disarmPracticeSession).toHaveBeenCalledWith('resume coach loop');
    expect(runtimeService.reopenCoachListeningWithNotice).toHaveBeenCalledTimes(1);
  });

  it('returns start-lesson without executing coach handoff side effects', async () => {
    const disarmPracticeSession = vi.fn(() => Promise.resolve());
    const runtimeService = createRuntimeService();
    const render = vi.fn();

    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: createSnapshot,
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => null,
      getLastSpokenCoachMessageId: () => null,
      runtimeService,
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
    });

    const plan = await coordinator.runDeepTutorResumeHandoff(createDeepTutorInteraction({
      shouldRebuildLesson: true,
      hasActiveGuideSession: false,
    }));

    expect(plan).toEqual({ action: 'start-lesson' });
    expect(disarmPracticeSession).not.toHaveBeenCalled();
    expect(runtimeService.reopenCoachListeningWithNotice).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });
});
