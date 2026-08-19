import { describe, expect, it, vi } from 'vitest';
import {
  createVoiceSessionStateController,
  resolveVoiceBackendPayloadState,
} from './session-state-controller';
import {
  createDefaultVoiceStudentModelState,
  createDefaultVoiceUiState,
  getLatestVoiceCoachThreadMessage,
  normalizeVoiceUiState,
  type VoiceBackendPayload,
} from './state';

function createHarness(options: {
  voiceUiState?: ReturnType<typeof createDefaultVoiceUiState>;
  currentSessionId?: string | null;
  isConnected?: boolean;
  fetchSessionState?: (sessionId: string) => Promise<VoiceBackendPayload>;
  hasDeepTutorVoiceLesson?: boolean;
} = {}) {
  let voiceUiState = options.voiceUiState || createDefaultVoiceUiState();
  let voiceStudentModelState = createDefaultVoiceStudentModelState();
  let lastSpokenCoachMessageId: string | null = null;
  let lastTakeTrace: Array<{ t: number; voiced: boolean; pitchHz: number; pitchScore: number; resonanceScore: number; weightScore: number; confidence: number; loudnessDb: number }> = [];

  const syncPersistedReferenceAnalysis = vi.fn((referenceClipId: string | null | undefined) => (
    referenceClipId
      ? {
          clipId: referenceClipId,
          filename: `${referenceClipId}.wav`,
          durationMs: 1400,
          metrics: null,
          timeline: [],
        }
      : null
  ));
  const fetchSessionState = vi.fn(options.fetchSessionState || (async () => ({
    voiceState: {
      voiceSessionId: null,
      referenceClipId: 'ref-session',
      coachThread: [
        {
          id: 'coach-2',
          role: 'coach',
          kind: 'runtime-answer',
          content: 'Synced coach message',
          createdAt: 2,
        },
      ],
      lastTakeTimeline: [
        {
          t: 1,
          voiced: true,
          pitchHz: 220,
          pitchScore: 0.8,
          resonanceScore: 0.7,
          weightScore: 0.6,
          confidence: 0.9,
          loudnessDb: -20,
        },
      ],
    },
  })));
  const resetDeepTutorLessonState = vi.fn();
  const clearPracticeState = vi.fn();
  const setLastSpokenCoachMessageId = vi.fn((messageId: string | null) => {
    lastSpokenCoachMessageId = messageId;
  });
  const setLastTakeTrace = vi.fn((trace) => {
    lastTakeTrace = trace;
  });
  const refreshVoiceDrills = vi.fn(async () => null);
  const refreshVoiceCockpitLine = vi.fn(async () => null);
  const render = vi.fn();
  const enforceRecoverySafety = vi.fn(async () => undefined);

  const controller = createVoiceSessionStateController({
    getVoiceUiState: () => voiceUiState,
    updateVoiceUiState: (updater) => {
      voiceUiState = normalizeVoiceUiState(updater(voiceUiState));
    },
    setVoiceStudentModelState: (state) => {
      voiceStudentModelState = state;
    },
    syncPersistedReferenceAnalysis,
    getSessionContext: () => ({
      currentSessionId: options.currentSessionId === undefined ? 'session-1' : options.currentSessionId,
      isConnected: options.isConnected ?? true,
    }),
    fetchSessionState,
    resetDeepTutorLessonState,
    clearPracticeState,
    getLatestCoachMessage: () => getLatestVoiceCoachThreadMessage(voiceUiState.coachThread, 'coach'),
    setLastSpokenCoachMessageId,
    setLastTakeTrace,
    hasDeepTutorVoiceLesson: () => options.hasDeepTutorVoiceLesson ?? false,
    refreshVoiceDrills,
    refreshVoiceCockpitLine,
    render,
    enforceRecoverySafety,
  });

  return {
    controller,
    getVoiceUiState: () => voiceUiState,
    getVoiceStudentModelState: () => voiceStudentModelState,
    getLastSpokenCoachMessageId: () => lastSpokenCoachMessageId,
    getLastTakeTrace: () => lastTakeTrace,
    syncPersistedReferenceAnalysis,
    fetchSessionState,
    resetDeepTutorLessonState,
    clearPracticeState,
    setLastSpokenCoachMessageId,
    setLastTakeTrace,
    refreshVoiceDrills,
    refreshVoiceCockpitLine,
    render,
    enforceRecoverySafety,
  };
}

describe('voice session state controller', () => {
  it('resolves backend payload state with top-level DeepTutor ownership and persisted reference hydration', () => {
    const nextState = resolveVoiceBackendPayloadState(createDefaultVoiceUiState({
      deeptutorVoiceState: {
        guideSessionId: 'old-guide',
      },
    }), {
      voiceState: {
        referenceClipId: 'ref-next',
        deeptutorVoiceState: {
          guideSessionId: 'nested-guide',
        },
      },
      deeptutorVoiceState: {
        guideSessionId: 'top-guide',
        guideSessionStatus: 'learning',
      },
    }, {
      syncPersistedReferenceAnalysis: (referenceClipId) => ({
        clipId: referenceClipId || null,
        filename: 'resolved.wav',
        durationMs: 900,
        metrics: null,
        timeline: [],
      }),
    });

    expect(nextState.referenceAnalysis).toMatchObject({
      clipId: 'ref-next',
      filename: 'resolved.wav',
    });
    expect(nextState.deeptutorVoiceState).toMatchObject({
      guideSessionId: 'top-guide',
      guideSessionStatus: 'learning',
    });
  });

  it('preserves richer backend reference analysis when persisted hydration only has playback metadata', () => {
    const nextState = resolveVoiceBackendPayloadState(createDefaultVoiceUiState({
      referenceClipId: 'ref-current',
    }), {
      voiceState: {
        referenceClipId: 'ref-next',
        referenceAnalysis: {
          clipId: 'ref-next',
          filename: 'resolved.wav',
          analysisVersion: 'voice-metrics-v2',
          metrics: {
            meanPitchHz: 219.44,
            advanced: {
              pitchP10Hz: 184.227,
              formantLite: {
                f2MedianHz: 1888.116,
                frontnessScore: 0.6222,
              },
              quality: {
                cppsLike: 11.442,
                strainRisk: 0.2449,
              },
            },
          },
          timeline: [],
        },
      },
    }, {
      syncPersistedReferenceAnalysis: (referenceClipId) => ({
        clipId: referenceClipId || null,
        filename: 'resolved.wav',
        durationMs: 900,
        metrics: null,
        timeline: [],
      }),
    });

    expect(nextState.referenceAnalysis).toMatchObject({
      clipId: 'ref-next',
      filename: 'resolved.wav',
      durationMs: 900,
      analysisVersion: 'voice-metrics-v2',
      metrics: {
        meanPitchHz: 219.44,
        advanced: {
          pitchP10Hz: 184.23,
          formantLite: {
            f2MedianHz: 1888.12,
            frontnessScore: 0.6222,
          },
          quality: {
            cppsLike: 11.44,
            strainRisk: 0.2449,
          },
        },
      },
    });
  });

  it('honors an explicit backend null when a reference target is removed', () => {
    const nextState = resolveVoiceBackendPayloadState(createDefaultVoiceUiState({
      referenceClipId: 'ref-current',
      referenceClipName: 'current.wav',
      referenceAnalysis: {
        clipId: 'ref-current',
        filename: 'current.wav',
        metrics: null,
        timeline: [],
      },
    }), {
      voiceState: {
        referenceClipId: null,
        referenceClipName: null,
        referenceAnalysis: null,
        targetVoiceProfile: null,
        targetSource: 'built-in',
      },
    }, {
      syncPersistedReferenceAnalysis: () => null,
    });

    expect(nextState.referenceClipId).toBeNull();
    expect(nextState.referenceClipName).toBeNull();
    expect(nextState.referenceAnalysis).toBeNull();
    expect(nextState.targetVoiceProfile).toBeNull();
    expect(nextState.targetSource).toBe('built-in');
  });

  it('applies backend payloads through the shared merge rules and updates the student model', () => {
    const harness = createHarness();

    const nextState = harness.controller.applyBackendPayload({
      voiceState: {
        referenceClipId: 'ref-apply',
      },
      studentModel: {
        enabled: true,
        studentId: 'student-1',
        reviewQueueSize: 2,
        learnerContext: {
          source: 'local-learner-context',
          targetPreset: 'australian-bright-feminine',
          recentAttemptCount: 3,
        },
      },
    });

    expect(nextState.referenceClipId).toBe('ref-apply');
    expect(nextState.referenceAnalysis).toMatchObject({
      clipId: 'ref-apply',
    });
    expect(harness.getVoiceStudentModelState()).toMatchObject({
      enabled: true,
      studentId: 'student-1',
      reviewQueueSize: 2,
      learnerContext: {
        source: 'local-learner-context',
        targetPreset: 'australian-bright-feminine',
        recentAttemptCount: 3,
      },
    });
    expect(harness.syncPersistedReferenceAnalysis).toHaveBeenCalledWith('ref-apply');
  });

  it('applies a learner-context-only backend payload as a standalone state seam', () => {
    const harness = createHarness();

    harness.controller.applyBackendPayload({
      learnerContext: {
        available: true,
        source: 'local-learner-context',
        targetPreset: 'cute-feminine',
        notepadHandoff: {
          content: 'Next pass: keep vowels smaller and lighter.',
          items: ['smaller vowels'],
          source: 'deeptutor-slow-planner',
          sessionId: 'session-1',
          updatedAt: 1700000000000,
        },
      },
    });

    expect(harness.getVoiceStudentModelState()).toMatchObject({
      available: true,
      enabled: true,
      learnerContext: {
        available: true,
        source: 'local-learner-context',
        targetPreset: 'cute-feminine',
        notepadHandoff: {
          content: 'Next pass: keep vowels smaller and lighter.',
          items: ['smaller vowels'],
          source: 'deeptutor-slow-planner',
        },
      },
    });
  });

  it('syncs the voice session from the backend and applies the shared hydration side effects', async () => {
    const harness = createHarness();

    const nextState = await harness.controller.syncSessionStateFromBackend(true);

    expect(harness.fetchSessionState).toHaveBeenCalledWith('session-1');
    expect(nextState?.referenceClipId).toBe('ref-session');
    expect(harness.resetDeepTutorLessonState).toHaveBeenCalledTimes(1);
    expect(harness.clearPracticeState).toHaveBeenCalledTimes(1);
    expect(harness.getLastSpokenCoachMessageId()).toBe('coach-2');
    expect(harness.getLastTakeTrace()).toHaveLength(1);
    expect(harness.refreshVoiceDrills).toHaveBeenCalledWith(true);
    expect(harness.refreshVoiceCockpitLine).toHaveBeenCalledWith('ensure');
    expect(harness.render).toHaveBeenCalledTimes(1);
    expect(harness.enforceRecoverySafety).toHaveBeenCalledTimes(1);
  });

  it('skips the cockpit refresh during sync when DeepTutor already owns the lesson', async () => {
    const harness = createHarness({
      hasDeepTutorVoiceLesson: true,
    });

    await harness.controller.syncSessionStateFromBackend();

    expect(harness.refreshVoiceCockpitLine).not.toHaveBeenCalled();
  });
});
