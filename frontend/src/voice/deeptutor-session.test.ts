import { describe, expect, it, vi } from 'vitest';
import {
  createDeepTutorVoiceInteractionState,
  createVoiceInteractionSnapshot,
} from './orchestrator';
import { createDeepTutorSessionController } from './deeptutor-session';

function createResumeInteraction(overrides: {
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

describe('deeptutor session controller', () => {
  it('runs lesson start with loading and idle status transitions', async () => {
    const setLessonStatus = vi.fn();
    const setLessonError = vi.fn();
    const applyVoiceBackendPayload = vi.fn();
    const render = vi.fn();
    const runCoachResumeHandoff = vi.fn(() => Promise.resolve({ action: 'start-lesson' as const }));

    const controller = createDeepTutorSessionController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      hasActiveGuideSession: () => false,
      shouldRebuildLesson: () => true,
      getLatestCoachMessage: () => null,
      startLessonRequest: () => Promise.resolve({ success: true } as any),
      advanceLessonRequest: vi.fn(),
      applyVoiceBackendPayload,
      setLessonStatus,
      setLessonError,
      disarmPracticeSession: vi.fn(),
      runCoachResumeHandoff,
      addTerminalLine: vi.fn(),
      render,
    });

    await controller.startLesson();

    expect(setLessonStatus).toHaveBeenNthCalledWith(1, 'loading');
    expect(setLessonStatus).toHaveBeenNthCalledWith(2, 'idle');
    expect(setLessonError).toHaveBeenNthCalledWith(1, null);
    expect(setLessonError).toHaveBeenNthCalledWith(2, null);
    expect(applyVoiceBackendPayload).toHaveBeenCalledWith({ success: true });
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('disarms practice after a take when a deeptutor guide session is active', async () => {
    const disarmPracticeSession = vi.fn(() => Promise.resolve());
    const addTerminalLine = vi.fn();

    const controller = createDeepTutorSessionController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      hasActiveGuideSession: () => true,
      shouldRebuildLesson: () => false,
      getLatestCoachMessage: () => null,
      startLessonRequest: vi.fn(),
      advanceLessonRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      setLessonStatus: vi.fn(),
      setLessonError: vi.fn(),
      disarmPracticeSession,
      runCoachResumeHandoff: vi.fn(() => Promise.resolve({ action: 'noop' })),
      addTerminalLine,
      render: vi.fn(),
    });

    await controller.handoffPracticeAfterTake({
      voiceSessionArmed: true,
      voiceTransportStatus: 'streaming',
    });

    expect(disarmPracticeSession).toHaveBeenCalledWith('post-take tutor handoff');
    expect(addTerminalLine).toHaveBeenCalledWith('system', 'Practice released so the tutor can review the take.');
  });

  it('delegates non-start resume handoffs to the runtime coordinator', async () => {
    const runCoachResumeHandoff = vi.fn(() => Promise.resolve({ action: 'speak-latest-coach' as const }));

    const controller = createDeepTutorSessionController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      hasActiveGuideSession: () => true,
      shouldRebuildLesson: () => false,
      startLessonRequest: vi.fn(),
      advanceLessonRequest: vi.fn(),
      applyVoiceBackendPayload: vi.fn(),
      setLessonStatus: vi.fn(),
      setLessonError: vi.fn(),
      disarmPracticeSession: vi.fn(),
      runCoachResumeHandoff,
      addTerminalLine: vi.fn(),
      render: vi.fn(),
    });

    const interaction = createResumeInteraction({
      canUseVoiceCoachVoiceInput: false,
      canUseVoiceCoachVoiceInputAfterRelease: false,
      latestCoachMessageId: 'coach-1',
      lastSpokenCoachMessageId: 'coach-0',
    });
    await controller.resumeLoop({ interaction });

    expect(runCoachResumeHandoff).toHaveBeenCalledWith(interaction);
  });

  it('starts a new lesson when the runtime coordinator returns start-lesson', async () => {
    const setLessonStatus = vi.fn();
    const setLessonError = vi.fn();
    const applyVoiceBackendPayload = vi.fn();
    const render = vi.fn();
    const startLessonRequest = vi.fn(() => Promise.resolve({ success: true } as any));

    const controller = createDeepTutorSessionController({
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      hasActiveGuideSession: () => true,
      shouldRebuildLesson: () => false,
      startLessonRequest,
      advanceLessonRequest: vi.fn(),
      applyVoiceBackendPayload,
      setLessonStatus,
      setLessonError,
      disarmPracticeSession: vi.fn(),
      runCoachResumeHandoff: vi.fn(() => Promise.resolve({ action: 'start-lesson' as const })),
      addTerminalLine: vi.fn(),
      render,
    });

    await controller.resumeLoop({
      interaction: createResumeInteraction({
        shouldRebuildLesson: true,
        hasActiveGuideSession: false,
      }),
    });

    expect(startLessonRequest).toHaveBeenCalledTimes(1);
    expect(setLessonStatus).toHaveBeenNthCalledWith(1, 'loading');
    expect(setLessonStatus).toHaveBeenNthCalledWith(2, 'idle');
    expect(setLessonError).toHaveBeenNthCalledWith(1, null);
    expect(setLessonError).toHaveBeenNthCalledWith(2, null);
    expect(applyVoiceBackendPayload).toHaveBeenCalledWith({ success: true });
    expect(render).toHaveBeenCalledTimes(2);
  });
});
