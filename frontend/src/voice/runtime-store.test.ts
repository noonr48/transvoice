import { describe, expect, it, vi } from 'vitest';
import { createVoiceRuntimeStore } from './runtime-store';

describe('voice runtime store', () => {
  it('tracks practice transport state through the store boundary', () => {
    const store = createVoiceRuntimeStore();

    store.setPracticeTransportState(() => ({
      status: 'streaming',
      liveFrame: {
        t: 120,
        voiced: true,
        pitchHz: 210,
        pitchScore: 0.82,
        resonanceScore: 0.74,
        weightScore: 0.68,
        confidence: 0.91,
        loudnessDb: -16,
      },
      liveTrace: [],
      sessionArmed: true,
      takeActive: true,
      takeProcessing: false,
    }));

    expect(store.getPracticeTransportState()).toMatchObject({
      status: 'streaming',
      sessionArmed: true,
      takeActive: true,
      takeProcessing: false,
    });
    expect(store.getState().voiceLiveFrame?.pitchHz).toBe(210);
  });

  it('resets coach runtime state and synchronizes the last spoken coach message when requested', () => {
    const store = createVoiceRuntimeStore({
      voiceCoachTaskId: 'task-1',
      voiceCoachTurnId: 'turn-1',
      voiceCoachTaskStatus: 'running',
      voiceCoachTaskError: 'stale',
      voiceCoachQuestionStatus: 'sending',
      voiceCoachQuestionError: 'pending',
      voicePendingCoachChannel: 'deeptutor',
      voiceLastSpokenCoachMessageId: 'old-message',
      voiceDeepTutorLessonStatus: 'loading',
      voiceDeepTutorLessonError: 'lesson-error',
      voiceForecastStatus: 'loading',
      voiceForecastError: 'forecast-error',
    });
    const stopListening = vi.fn();
    const stopSpeech = vi.fn();
    const clearCoachPollTimer = vi.fn();

    store.resetCoachRuntimeUiState({
      stopListening: true,
      stopSpeech: true,
      resetLessonStatus: true,
      resetForecastState: true,
      syncLastSpokenCoachMessage: true,
    }, {
      stopListening,
      stopSpeech,
      clearCoachPollTimer,
      getLatestCoachMessageId: () => 'coach-message-2',
    });

    expect(stopListening).toHaveBeenCalledWith(true);
    expect(stopSpeech).toHaveBeenCalledTimes(1);
    expect(clearCoachPollTimer).toHaveBeenCalledTimes(1);
    expect(store.getState()).toMatchObject({
      voiceCoachTaskId: null,
      voiceCoachTurnId: null,
      voiceCoachTaskStatus: 'idle',
      voiceCoachTaskError: null,
      voiceCoachQuestionStatus: 'idle',
      voiceCoachQuestionError: null,
      voicePendingCoachChannel: null,
      voiceLastSpokenCoachMessageId: 'coach-message-2',
      voiceDeepTutorLessonStatus: 'idle',
      voiceDeepTutorLessonError: null,
      voiceForecastStatus: 'idle',
      voiceForecastError: null,
    });
  });

  it('applies session reentry plans and keeps traces isolated from the planner arrays', () => {
    const store = createVoiceRuntimeStore({
      voiceUiState: {
        ...createVoiceRuntimeStore().getUiState(),
        targetPreset: 'cute-feminine',
      },
    });
    const nextLiveTrace = [{
      t: 1,
      voiced: true,
      pitchHz: 200,
      pitchScore: 0.5,
      resonanceScore: 0.4,
      weightScore: 0.3,
      confidence: 0.8,
      loudnessDb: -18,
    }];
    const nextLastTakeTrace = [{
      t: 2,
      voiced: false,
      pitchHz: 0,
      pitchScore: 0,
      resonanceScore: 0,
      weightScore: 0,
      confidence: 0.2,
      loudnessDb: -32,
    }];

    store.applySessionReentryPlan({
      nextVoiceUiState: {
        ...store.getUiState(),
        voiceSessionId: 'voice-session-42',
        referenceClipId: 'clip-1',
      },
      nextLiveTrace,
      nextLastTakeTrace,
      runtimeReset: {
        resetDrillState: true,
      },
    }, {
      clipId: 'clip-1',
      clipName: 'clip.wav',
      timeline: [],
      durationMs: 1200,
      sampleRate: null,
      metrics: null,
    } as any);

    nextLiveTrace.push({
      t: 3,
      voiced: true,
      pitchHz: 180,
      pitchScore: 0.3,
      resonanceScore: 0.3,
      weightScore: 0.3,
      confidence: 0.3,
      loudnessDb: -20,
    });

    expect(store.getUiState().voiceSessionId).toBe('voice-session-42');
    expect(store.getUiState().referenceClipId).toBe('clip-1');
    expect(store.getState().voiceLiveTrace).toHaveLength(1);
    expect(store.getState().voiceLastTakeTrace).toHaveLength(1);
    expect(store.getState().voiceDrillStatus).toBe('idle');
    expect(store.getState().voiceDrillSelectionPendingId).toBeNull();
  });
});
