import { describe, expect, it } from 'vitest';
import {
  canUseVoiceCoachInput,
  createDeepTutorVoiceInteractionState,
  createVoiceInteractionSnapshot,
  getVoiceInteractionOwnerCopy,
  resolveVoiceCoachPostPlaybackHandoffPlan,
  resolveVoiceCoachRenderHandoffPlan,
  resolveVoicePracticeReleasePlan,
  resolveDeepTutorVoiceResumePlan,
  resolveVoiceInteractionOwner,
  shouldAutoArmVoicePracticeAfterCoachSpeech,
} from './orchestrator';

function createDeepTutorInteractionState(overrides: {
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

describe('voice orchestrator', () => {
  it('prioritizes take processing and active take ownership', () => {
    expect(resolveVoiceInteractionOwner({
      voiceTakeProcessing: true,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      voiceCoachQuestionStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'idle',
      speechSynthesisBusy: false,
      voiceSessionArmed: false,
    })).toBe('practice-processing');

    expect(resolveVoiceInteractionOwner({
      voiceTakeProcessing: false,
      voiceTakeActive: true,
      voiceTransportStatus: 'streaming',
      voiceCoachQuestionStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'waiting',
      speechSynthesisBusy: true,
      voiceSessionArmed: true,
    })).toBe('practice-live');
  });

  it('surfaces coach processing and practice ownership copy deterministically', () => {
    expect(resolveVoiceInteractionOwner({
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      voiceCoachQuestionStatus: 'sending',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'idle',
      speechSynthesisBusy: false,
      voiceSessionArmed: false,
    })).toBe('coach-processing');

    expect(getVoiceInteractionOwnerCopy('practice-armed')).toContain('owns the mic right now');
  });

  it('builds an interaction snapshot and uses it for coach-input gating', () => {
    const snapshot = createVoiceInteractionSnapshot({
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'streaming',
      voiceCoachQuestionStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'idle',
      speechSynthesisBusy: false,
      voiceSessionArmed: true,
    });

    expect(snapshot.owner).toBe('practice-armed');
    expect(snapshot.hasPracticeOwnership).toBe(true);
    expect(canUseVoiceCoachInput(snapshot, {
      hasInputProvider: true,
    })).toBe(true);
    expect(resolveVoicePracticeReleasePlan(snapshot)).toEqual({ action: 'disarm' });
  });

  it('blocks coach-input and release plans while practice is still active or arming', () => {
    const activeTake = createVoiceInteractionSnapshot({
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
      voiceSessionArmed: true,
    });
    expect(canUseVoiceCoachInput(activeTake, {
      hasInputProvider: true,
    })).toBe(false);
    expect(resolveVoicePracticeReleasePlan(activeTake)).toEqual({
      action: 'blocked',
      reason: 'Finish the current practice cycle before reopening coach listening.',
    });

    const arming = createVoiceInteractionSnapshot({
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'connecting',
      voiceCoachQuestionStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'idle',
      speechSynthesisBusy: false,
      voiceSessionArmed: false,
    });
    expect(canUseVoiceCoachInput(arming, {
      hasInputProvider: true,
      ignoreTakeState: true,
    })).toBe(false);
  });

  it('only auto-arms after deeptutor handoff replies when mimic practice is still active', () => {
    expect(shouldAutoArmVoicePracticeAfterCoachSpeech({
      message: {
        id: 'coach-1',
        role: 'coach',
        channel: 'deeptutor',
        kind: 'deeptutor-lesson-advance',
        content: 'Try the next pass now.',
        createdAt: Date.now(),
      },
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      continuousEnabled: true,
      hasActiveGuideSession: true,
      voiceSessionArmed: false,
      voiceTakeActive: false,
      voiceTakeProcessing: false,
      voiceTransportStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceCoachQuestionStatus: 'idle',
      referenceMimicAction: 'repeat',
    })).toBe(true);

    expect(shouldAutoArmVoicePracticeAfterCoachSpeech({
      message: {
        id: 'coach-2',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Listen for the ending.',
        createdAt: Date.now(),
      },
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      continuousEnabled: true,
      hasActiveGuideSession: true,
      voiceSessionArmed: false,
      voiceTakeActive: false,
      voiceTakeProcessing: false,
      voiceTransportStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceCoachQuestionStatus: 'idle',
      referenceMimicAction: 'repeat',
    })).toBe(false);
  });

  it('prefers speaking a fresh coach reply before reopening continuous listening on render', () => {
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
    });

    expect(resolveVoiceCoachRenderHandoffPlan({
      snapshot,
      hasInputProvider: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: '',
      canPlaySpeech: true,
      latestCoachMessageId: 'coach-1',
      lastSpokenCoachMessageId: null,
    })).toEqual({ action: 'speak-latest-coach' });

    expect(resolveVoiceCoachRenderHandoffPlan({
      snapshot,
      hasInputProvider: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: '',
      canPlaySpeech: false,
      latestCoachMessageId: 'coach-1',
      lastSpokenCoachMessageId: null,
    })).toEqual({ action: 'start-continuous-listening' });
  });

  it('reopens continuous listening only when the runtime snapshot is free to listen', () => {
    const processingSnapshot = createVoiceInteractionSnapshot({
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'idle',
      voiceCoachQuestionStatus: 'sending',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'idle',
      speechSynthesisBusy: false,
      voiceSessionArmed: false,
    });

    expect(resolveVoiceCoachRenderHandoffPlan({
      snapshot: processingSnapshot,
      hasInputProvider: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: '',
      canPlaySpeech: false,
      latestCoachMessageId: null,
      lastSpokenCoachMessageId: null,
    })).toEqual({ action: 'noop' });
  });

  it('chooses between post-playback practice auto-arm and listening restart deterministically', () => {
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
    });

    expect(resolveVoiceCoachPostPlaybackHandoffPlan({
      snapshot,
      hasInputProvider: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: '',
      message: {
        id: 'coach-1',
        role: 'coach',
        channel: 'deeptutor',
        kind: 'deeptutor-lesson-advance',
        content: 'Try the next pass now.',
        createdAt: Date.now(),
      },
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
    })).toEqual({
      action: 'arm-practice',
      notice: 'Tutor armed practice for the next coached pass.',
    });

    expect(resolveVoiceCoachPostPlaybackHandoffPlan({
      snapshot,
      hasInputProvider: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: '',
      message: {
        id: 'coach-2',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Listen for the release.',
        createdAt: Date.now(),
      },
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
    })).toEqual({ action: 'start-continuous-listening' });
  });

  it('plans deep tutor resume handoffs without mixing practice and coach control', () => {
    expect(resolveDeepTutorVoiceResumePlan(createDeepTutorInteractionState({
      shouldRebuildLesson: true,
      hasActiveGuideSession: false,
      canUseVoiceCoachVoiceInput: true,
      canUseVoiceCoachVoiceInputAfterRelease: true,
    }))).toEqual({ action: 'start-lesson' });

    expect(resolveDeepTutorVoiceResumePlan(createDeepTutorInteractionState({
      referenceMimicAction: 'repeat',
      canUseVoiceCoachVoiceInput: true,
      canUseVoiceCoachVoiceInputAfterRelease: true,
      latestCoachMessageId: 'coach-1',
    }))).toEqual({ action: 'arm-practice' });

    expect(resolveDeepTutorVoiceResumePlan(createDeepTutorInteractionState({
      snapshot: {
        voiceTakeActive: true,
        voiceTransportStatus: 'streaming',
      },
      canUseVoiceCoachVoiceInput: false,
      canUseVoiceCoachVoiceInputAfterRelease: true,
      latestCoachMessageId: 'coach-2',
      lastSpokenCoachMessageId: 'coach-1',
    }))).toEqual({ action: 'disarm-practice-and-listen' });

    expect(resolveDeepTutorVoiceResumePlan(createDeepTutorInteractionState({
      canUseVoiceCoachVoiceInput: false,
      canUseVoiceCoachVoiceInputAfterRelease: false,
      latestCoachMessageId: 'coach-3',
      lastSpokenCoachMessageId: 'coach-2',
    }))).toEqual({ action: 'speak-latest-coach' });
  });

  it('keeps the resume loop idle while practice is still arming', () => {
    expect(resolveDeepTutorVoiceResumePlan(createDeepTutorInteractionState({
      referenceMimicAction: 'repeat',
      snapshot: {
        voiceTransportStatus: 'connecting',
      },
      canUseVoiceCoachVoiceInput: false,
      canUseVoiceCoachVoiceInputAfterRelease: false,
    }))).toEqual({ action: 'noop' });
  });

  it('exposes practice and coach semantic states on the shared snapshot', () => {
    const snapshot = createVoiceInteractionSnapshot({
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      voiceTakeProcessing: false,
      voiceTakeActive: false,
      voiceTransportStatus: 'streaming',
      voiceCoachQuestionStatus: 'idle',
      voiceCoachTaskStatus: 'idle',
      voiceDeepTutorLessonStatus: 'idle',
      voiceSpeechRecognitionStatus: 'idle',
      speechSynthesisBusy: false,
      voiceSessionArmed: true,
    });

    expect(snapshot.practiceState).toBe('armed');
    expect(snapshot.coachState).toBe('idle');
    expect(snapshot.hasCoachOwnership).toBe(false);
  });

  it('builds a DeepTutor interaction contract with explicit reentry semantics', () => {
    const state = createDeepTutorInteractionState({
      voiceSpeechRecognitionStatus: 'waiting',
      referenceMimicAction: 'repeat',
      canUseVoiceCoachVoiceInput: true,
      canUseVoiceCoachVoiceInputAfterRelease: true,
      latestCoachMessageId: 'coach-1',
      lastSpokenCoachMessageId: null,
    });

    expect(state.lessonLifecycle).toBe('active');
    expect(state.practiceIntent).toBe('practice');
    expect(state.coachListeningState).toBe('armed');
    expect(state.canArmPractice).toBe(true);
    expect(state.hasUnspokenCoachReply).toBe(true);
  });
});
