import { describe, expect, it } from 'vitest';
import {
  canPlayVoiceCoachMessage,
  shouldRunContinuousVoiceCoachLoop,
  shouldSpeakLatestVoiceCoachReply,
  shouldStartVoiceCoachContinuousListening,
} from './coach-loop';

describe('voice coach loop', () => {
  it('only runs the continuous loop when the input path and recovery state allow it', () => {
    expect(shouldRunContinuousVoiceCoachLoop({
      canUseVoiceInput: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
    })).toBe(true);

    expect(shouldRunContinuousVoiceCoachLoop({
      canUseVoiceInput: false,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
    })).toBe(false);

    expect(shouldRunContinuousVoiceCoachLoop({
      canUseVoiceInput: true,
      automaticTurnBoundarySupported: false,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
    })).toBe(false);

    expect(shouldRunContinuousVoiceCoachLoop({
      canUseVoiceInput: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: true,
      continuousEnabled: true,
    })).toBe(false);
  });

  it('only starts continuous listening when nothing already owns the coach turn', () => {
    expect(shouldStartVoiceCoachContinuousListening({
      canUseVoiceInput: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: '',
      speechSynthesisBusy: false,
    })).toBe(true);

    expect(shouldStartVoiceCoachContinuousListening({
      canUseVoiceInput: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'waiting',
      questionDraft: '',
      speechSynthesisBusy: false,
    })).toBe(false);

    expect(shouldStartVoiceCoachContinuousListening({
      canUseVoiceInput: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: 'repeat that',
      speechSynthesisBusy: false,
    })).toBe(false);

    expect(shouldStartVoiceCoachContinuousListening({
      canUseVoiceInput: true,
      automaticTurnBoundarySupported: true,
      recoveryShouldDisableContinuous: false,
      continuousEnabled: true,
      voiceSpeechRecognitionStatus: 'idle',
      questionDraft: '',
      speechSynthesisBusy: true,
    })).toBe(false);
  });

  it('only speaks coach replies when voice playback is allowed and the reply is new', () => {
    expect(canPlayVoiceCoachMessage({
      currentMode: 'voice',
      speechEnabled: true,
      speechProviderAvailable: true,
    })).toBe(true);

    expect(canPlayVoiceCoachMessage({
      currentMode: 'general',
      speechEnabled: true,
      speechProviderAvailable: true,
    })).toBe(false);

    expect(shouldSpeakLatestVoiceCoachReply({
      currentMode: 'voice',
      speechEnabled: true,
      speechProviderAvailable: true,
      latestCoachMessage: {
        id: 'coach-1',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Try the ending lighter.',
        createdAt: 1,
      },
      lastSpokenCoachMessageId: null,
    })).toBe(true);

    expect(shouldSpeakLatestVoiceCoachReply({
      currentMode: 'voice',
      speechEnabled: true,
      speechProviderAvailable: true,
      latestCoachMessage: {
        id: 'coach-1',
        role: 'coach',
        channel: 'runtime',
        kind: 'runtime-answer',
        content: 'Try the ending lighter.',
        createdAt: 1,
      },
      lastSpokenCoachMessageId: 'coach-1',
    })).toBe(false);
  });
});
