import { describe, expect, it } from 'vitest';
import fixtures from './deeptutor-interaction-fixtures.json';
import {
  createDeepTutorVoiceInteractionState,
  createVoiceInteractionSnapshot,
} from './orchestrator';

type FrontendFixture = {
  deeptutorVoiceState: Record<string, unknown> | null;
  shouldRebuildLesson: boolean;
  hasActiveGuideSession: boolean;
  voiceDeepTutorLessonStatus: 'idle' | 'loading' | 'error';
  voiceSpeechRecognitionStatus: 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
  referenceMimicAction: string | null;
  canUseVoiceCoachVoiceInput: boolean;
  canUseVoiceCoachVoiceInputAfterRelease: boolean;
  latestCoachMessageId: string | null;
  lastSpokenCoachMessageId: string | null;
  snapshot: Partial<Parameters<typeof createVoiceInteractionSnapshot>[0]>;
};

type ExpectedFixture = {
  lessonMode: string;
  guideStatus: string;
  runtimeOwner: string;
  practiceIntent: string;
  hasActiveGuideSession: boolean;
  hasHistoricalLessonState: boolean;
};

function createFixtureInteractionState(frontend: FrontendFixture) {
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
    ...frontend.snapshot,
  });

  return createDeepTutorVoiceInteractionState({
    snapshot,
    deeptutorVoiceState: frontend.deeptutorVoiceState as any,
    shouldRebuildLesson: frontend.shouldRebuildLesson,
    hasActiveGuideSession: frontend.hasActiveGuideSession,
    voiceDeepTutorLessonStatus: frontend.voiceDeepTutorLessonStatus,
    voiceSpeechRecognitionStatus: frontend.voiceSpeechRecognitionStatus,
    referenceMimicAction: frontend.referenceMimicAction,
    canUseVoiceCoachVoiceInput: frontend.canUseVoiceCoachVoiceInput,
    canUseVoiceCoachVoiceInputAfterRelease: frontend.canUseVoiceCoachVoiceInputAfterRelease,
    latestCoachMessageId: frontend.latestCoachMessageId,
    lastSpokenCoachMessageId: frontend.lastSpokenCoachMessageId,
  });
}

describe('deeptutor interaction parity fixtures', () => {
  for (const fixture of fixtures as Array<{ name: string; frontend: FrontendFixture; expected: ExpectedFixture }>) {
    it(`matches shared contract for ${fixture.name}`, () => {
      const interaction = createFixtureInteractionState(fixture.frontend);

      expect({
        lessonMode: interaction.lessonMode,
        guideStatus: interaction.guideStatus,
        runtimeOwner: interaction.runtimeOwner,
        practiceIntent: interaction.practiceIntent,
        hasActiveGuideSession: interaction.hasActiveGuideSession,
        hasHistoricalLessonState: interaction.hasHistoricalLessonState,
      }).toEqual(fixture.expected);
    });
  }
});
