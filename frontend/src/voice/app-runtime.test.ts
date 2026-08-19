import { describe, expect, it, vi } from 'vitest';
import { createVoiceAppRuntime } from './app-runtime';
import { createDefaultVoiceRuntimeStatusState } from './runtime-status';
import { createVoiceRuntimeStore } from './runtime-store';

function createHarness() {
  const store = createVoiceRuntimeStore();
  const runtimeShell = {
    getEffectiveInputProvider: vi.fn(() => 'browser'),
    getInputRecoveryState: vi.fn(() => ({ shouldDisableContinuous: false })),
  };
  const syncPersistedReferenceAnalysis = vi.fn((referenceClipId: string | null) => (
    referenceClipId
      ? {
          clipId: referenceClipId,
          clipName: 'clip.wav',
          durationMs: 1_200,
          timeline: [],
          sampleRate: null,
          metrics: null,
        }
      : null
  ));
  const stopListening = vi.fn();
  const stopSpeech = vi.fn();
  const clearCoachPollTimer = vi.fn();
  const disarmPracticeSession = vi.fn(async () => true);

  const runtime = createVoiceAppRuntime({
    store,
    getCurrentMode: () => 'voice',
    getCurrentSessionId: () => 'session-1',
    getIsConnected: () => true,
    getRuntimeShell: () => runtimeShell as any,
    getRuntimeStatusState: () => createDefaultVoiceRuntimeStatusState(),
    isSpeechSynthesisBusy: () => false,
    getVoiceSessionStreamUrl: (voiceSessionId) => `wss://voice.test/${voiceSessionId}`,
    disarmPracticeSession,
    syncPersistedReferenceAnalysis,
    runtimeResetDependencies: {
      stopListening,
      stopSpeech,
      clearCoachPollTimer,
      getLatestCoachMessageId: () => 'coach-latest',
    },
  });

  return {
    store,
    runtime,
    runtimeShell,
    syncPersistedReferenceAnalysis,
    stopListening,
    stopSpeech,
    clearCoachPollTimer,
    disarmPracticeSession,
  };
}

describe('voice app runtime', () => {
  it('bridges interaction, coach message, and guide-session selectors through the facade', async () => {
    const harness = createHarness();
    harness.store.updateState((current) => ({
      ...current,
      voiceSessionArmed: true,
      voiceUiState: {
        ...current.voiceUiState,
        voiceSessionId: 'voice-session-1',
        coachThread: [
          {
            id: 'coach-1',
            role: 'coach',
            channel: 'coach',
            kind: 'reply',
            content: 'Hold the vowel longer.',
            createdAt: 10,
          },
        ],
        deeptutorVoiceState: {
          guideSessionId: 'guide-1',
          guideSessionStatus: 'active',
          status: 'active',
          runtimeState: 'listening',
          enabled: true,
        } as any,
      },
    }));

    const snapshot = harness.runtime.getVoiceInteractionSnapshot();
    expect(snapshot.owner).toBe('practice-armed');
    expect(harness.runtime.getLatestCoachMessage()?.id).toBe('coach-1');
    expect(harness.runtime.hasActiveDeepTutorGuideSession()).toBe(true);
    expect(harness.runtime.shouldAutoReturnPracticeToCoachAfterTake()).toBe(true);
    expect(harness.runtime.canUseVoiceCoachVoiceInput()).toBe(true);
    expect(harness.runtime.canUseVoiceCoachVoiceInput({ ignoreTakeState: true })).toBe(true);
    await harness.runtime.releaseVoicePracticeForCoachListening();
    expect(harness.disarmPracticeSession).toHaveBeenCalledWith('coach listening takeover');
  });

  it('hydrates stored input preferences and applies session reentry plans through the facade', () => {
    const harness = createHarness();

    expect(harness.runtime.hydrateStoredInputDevicePreference(() => 'mic-2')).toBe('mic-2');
    expect(harness.store.getState().voiceSelectedInputDeviceId).toBe('mic-2');

    harness.runtime.applySessionReentryPlan({
      nextVoiceUiState: {
        ...harness.store.getUiState(),
        voiceSessionId: 'voice-session-2',
        referenceClipId: 'clip-7',
      },
      persistedReferenceClipId: 'clip-7',
      runtimeReset: {
        stopListening: true,
        stopSpeech: true,
        resetDrillState: true,
      },
      nextLiveTrace: [{
        t: 1,
        voiced: true,
        pitchHz: 200,
        pitchScore: 0.5,
        resonanceScore: 0.4,
        weightScore: 0.3,
        confidence: 0.9,
        loudnessDb: -18,
      }],
      nextLastTakeTrace: [{
        t: 2,
        voiced: false,
        pitchHz: 0,
        pitchScore: 0,
        resonanceScore: 0,
        weightScore: 0,
        confidence: 0.2,
        loudnessDb: -32,
      }],
    });

    expect(harness.syncPersistedReferenceAnalysis).toHaveBeenCalledWith('clip-7');
    expect(harness.stopListening).toHaveBeenCalledWith(true);
    expect(harness.stopSpeech).toHaveBeenCalledTimes(1);
    expect(harness.clearCoachPollTimer).toHaveBeenCalledTimes(1);
    expect(harness.store.getUiState().voiceSessionId).toBe('voice-session-2');
    expect(harness.store.getUiState().referenceClipId).toBe('clip-7');
    expect(harness.store.getState().voiceLiveTrace).toHaveLength(1);
    expect(harness.store.getState().voiceLastTakeTrace).toHaveLength(1);
  });

  it('derives stream URLs and reference-frame lookup through the facade', () => {
    const harness = createHarness();
    harness.store.updateUiState((current) => ({
      ...current,
      voiceSessionId: 'voice-session-9',
      streamUrl: 'ws://fallback.test/session',
      referenceAnalysis: {
        clipId: 'clip-1',
        clipName: 'clip.wav',
        durationMs: 2_000,
        sampleRate: null,
        metrics: null,
        timeline: [
          { t: 0, voiced: false, pitchHz: 0, pitchScore: 0, resonanceScore: 0, weightScore: 0, confidence: 0.1, loudnessDb: -40 },
          { t: 120, voiced: true, pitchHz: 180, pitchScore: 0.5, resonanceScore: 0.5, weightScore: 0.5, confidence: 0.8, loudnessDb: -20 },
          { t: 360, voiced: true, pitchHz: 210, pitchScore: 0.7, resonanceScore: 0.7, weightScore: 0.6, confidence: 0.9, loudnessDb: -16 },
        ],
      } as any,
    }));

    expect(harness.runtime.getResolvedVoiceStreamUrl()).toBe('wss://voice.test/voice-session-9');
    expect(harness.runtime.getVoiceReferenceFrameAtMs(240)?.t).toBe(120);

    harness.store.updateUiState((current) => ({
      ...current,
      voiceSessionId: null,
    }));
    expect(harness.runtime.getResolvedVoiceStreamUrl()).toBe('ws://fallback.test/session');
  });
});
