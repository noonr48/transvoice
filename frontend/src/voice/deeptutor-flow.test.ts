import { describe, expect, it } from 'vitest';
import {
  createDeepTutorVoiceInteractionState,
  createVoiceInteractionSnapshot,
} from './orchestrator';
import {
  getDeepTutorVoiceResumeButtonLabel,
  hasDeepTutorVoiceLessonState,
  shouldRebuildDeepTutorVoiceLessonState,
} from './deeptutor-flow';

function createInteractionState(overrides: {
  voiceDeepTutorLessonStatus?: 'idle' | 'loading' | 'error';
  shouldRebuildLesson?: boolean;
  hasActiveGuideSession?: boolean;
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

describe('deeptutor voice flow', () => {
  it('distinguishes missing lesson state from retained lesson history', () => {
    expect(hasDeepTutorVoiceLessonState(null)).toBe(false);
    expect(hasDeepTutorVoiceLessonState({
      guideSessionId: 'guide-1',
      guideSessionStatus: 'completed',
      lastTutorMessage: 'Stay bright on the ending.',
    })).toBe(true);
  });

  it('only requests a rebuild when a prior guide session has completed or errored', () => {
    expect(shouldRebuildDeepTutorVoiceLessonState({
      guideSessionId: 'guide-1',
      guideSessionStatus: 'learning',
    })).toBe(false);
    expect(shouldRebuildDeepTutorVoiceLessonState({
      guideSessionId: 'guide-1',
      guideSessionStatus: 'completed',
    })).toBe(true);
    expect(shouldRebuildDeepTutorVoiceLessonState({
      guideSessionId: 'guide-1',
      guideSessionStatus: 'error',
    })).toBe(true);
  });

  it('labels the DeepTutor resume button from the current ownership state', () => {
    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState({
        voiceDeepTutorLessonStatus: 'loading',
      }),
    })).toBe('Syncing Coach...');

    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState({
        hasActiveGuideSession: false,
      }),
    })).toBe('Guided Coach');

    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState({
        referenceMimicAction: 'mimic',
        snapshot: {
          voiceSessionArmed: true,
          voiceTransportStatus: 'streaming',
        },
      }),
    })).toBe('Back to Coach');

    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState({
        snapshot: {
          voiceTransportStatus: 'connecting',
        },
      }),
    })).toBe('Practice Arming...');

    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState({
        referenceMimicAction: 'repeat',
      }),
    })).toBe('Arm Next Pass');

    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState({
        voiceSpeechRecognitionStatus: 'waiting',
      }),
    })).toBe('Coach Armed');

    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState({
        voiceSpeechRecognitionStatus: 'listening',
      }),
    })).toBe('Coach Listening');

    expect(getDeepTutorVoiceResumeButtonLabel({
      interaction: createInteractionState(),
    })).toBe('Resume Coach');
  });
});
