import { describe, expect, it, vi } from 'vitest';
import {
  createDefaultVoiceDrillState,
  createDefaultVoiceUiState,
  type VoiceDrillState,
  type VoiceLiveFrame,
} from './state';
import { createVoiceLiveTransitionController } from './live-transition';
import type { VoicePracticeTransportSnapshot } from './practice-transport';

function createHarness() {
  let voiceUiState = createDefaultVoiceUiState({
    targetPreset: 'teacher',
    targetSource: 'custom-handmade',
    targetVoiceProfile: {
      profileId: 'custom-profile-1',
      clipId: 'custom-preset-1',
      sourceFilename: 'Handmade target',
      durationMs: 0,
      targetPreset: 'teacher',
      metrics: {
        meanPitchHz: 130,
        pitchRangeSt: 3,
        resonanceMean: 0.2,
        weightMean: 0.7,
        targetHitPct: 1,
        similarityScore: 1,
      },
      pitchFloorHz: 120,
      pitchCeilingHz: 140,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
      stylePrompt: 'Low custom target',
    },
    selfReportDraft: {
      effort: 2,
      strain: 1,
      perceivedDifficulty: 3,
      confidence: 4,
    },
  });
  let transportState: VoicePracticeTransportSnapshot = {
    status: 'idle',
    liveFrame: null,
    liveTrace: [],
    sessionArmed: false,
    takeActive: false,
    takeProcessing: false,
  };
  let voiceDrillState: VoiceDrillState = createDefaultVoiceDrillState({
    targetPreset: 'teacher',
    selectedLessonId: 'teacher-vocalise-sustained',
    selectedDrill: {
      id: 'teacher-vocalise-sustained',
      kind: 'sustained',
      title: 'Steady vowel',
      focus: 'Hold steady',
      phrase: 'ahh',
      description: 'Hold one comfortable vowel.',
      cues: ['Keep it easy.'],
      tags: ['vocalise', 'stability', 'pitch'],
    },
  });
  let currentSessionId: string | null = 'session-1';
  let isConnected = true;
  let lastTakeTrace: VoiceLiveFrame[] = [];
  let suppressPracticeClick = false;

  const resetCoachRuntimeUiState = vi.fn();
  const pauseReferencePlayback = vi.fn();
  const stopAudioStream = vi.fn(async (_preserveFrame?: boolean) => {
    transportState = {
      ...transportState,
      status: 'idle',
      sessionArmed: false,
      takeActive: false,
      takeProcessing: false,
    };
  });
  const startAudioStream = vi.fn(async () => {
    transportState = {
      ...transportState,
      status: 'streaming',
      sessionArmed: true,
      takeActive: false,
      takeProcessing: false,
    };
  });
  const startPracticeSessionRequest = vi.fn(async () => ({
    voiceState: {
      voiceSessionId: 'voice-session-1',
      targetPreset: 'teacher',
    },
  }));
  const submitPracticeTakeRequest = vi.fn(async (_sessionId: string, _reason: string, lastTakeTimeline: VoiceLiveFrame[] | null) => ({
    voiceState: {
      lastTakeTimeline,
      lastSummary: { voiceSessionId: 'voice-session-1' },
    },
    summary: {
      voiceSessionId: 'voice-session-1',
    },
  }));
  const disarmPracticeSessionRequest = vi.fn(async () => ({
    voiceState: {
      voiceSessionId: null,
      status: 'idle',
    },
  }));
  const applyVoiceBackendPayload = vi.fn((payload: any) => {
    if (payload?.voiceState) {
      voiceUiState = {
        ...voiceUiState,
        ...payload.voiceState,
      };
    }
  });
  const refreshVoiceDrills = vi.fn(async () => null);
  const refreshVoiceCockpitLine = vi.fn(async () => null);
  const handoffPracticeAfterTake = vi.fn(async () => undefined);
  const requestCoachNote = vi.fn(async () => undefined);
  const onCoachNoteError = vi.fn();
  const compressVoiceTimeline = vi.fn((timeline: VoiceLiveFrame[] | null | undefined) => Array.isArray(timeline) ? timeline.slice(0, 1) : []);
  const addTerminalLine = vi.fn();
  const render = vi.fn();

  const controller = createVoiceLiveTransitionController({
    getSessionContext: () => ({
      currentSessionId,
      isConnected,
    }),
    getVoiceUiState: () => voiceUiState,
    getVoiceDrillState: () => voiceDrillState,
    updateVoiceUiState: (updater) => {
      voiceUiState = updater(voiceUiState);
    },
    getTransportState: () => transportState,
    setTransportState: (updater) => {
      transportState = updater(transportState);
    },
    getTargetPreset: () => voiceUiState.targetPreset || 'teacher',
    getReferenceClipId: () => voiceUiState.referenceClipId || null,
    getLiveTrace: () => transportState.liveTrace,
    setLiveTrace: (trace) => {
      transportState = {
        ...transportState,
        liveTrace: trace,
      };
    },
    setLastTakeTrace: (trace) => {
      lastTakeTrace = trace;
    },
    setSuppressPracticeClick: (value) => {
      suppressPracticeClick = value;
    },
    resetCoachRuntimeUiState,
    pauseReferencePlayback,
    stopAudioStream,
    startAudioStream,
    startPracticeSessionRequest,
    submitPracticeTakeRequest,
    disarmPracticeSessionRequest,
    applyVoiceBackendPayload,
    refreshVoiceDrills,
    refreshVoiceCockpitLine,
    handoffPracticeAfterTake,
    requestCoachNote,
    onCoachNoteError,
    compressVoiceTimeline,
    addTerminalLine,
    render,
  });

  return {
    controller,
    getVoiceUiState: () => voiceUiState,
    getTransportState: () => transportState,
    setTransportState: (patch: Partial<VoicePracticeTransportSnapshot>) => {
      transportState = {
        ...transportState,
        ...patch,
      };
    },
    setLiveTrace: (trace: VoiceLiveFrame[]) => {
      transportState = {
        ...transportState,
        liveTrace: trace,
      };
    },
    setVoiceSessionId: (voiceSessionId: string | null) => {
      voiceUiState = {
        ...voiceUiState,
        voiceSessionId,
      };
    },
    setVoiceDrillState: (nextState: VoiceDrillState) => {
      voiceDrillState = nextState;
    },
    setConnection: (nextSessionId: string | null, nextConnected: boolean) => {
      currentSessionId = nextSessionId;
      isConnected = nextConnected;
    },
    getLastTakeTrace: () => lastTakeTrace,
    getSuppressPracticeClick: () => suppressPracticeClick,
    mocks: {
      resetCoachRuntimeUiState,
      pauseReferencePlayback,
      stopAudioStream,
      startAudioStream,
      startPracticeSessionRequest,
      submitPracticeTakeRequest,
      disarmPracticeSessionRequest,
      applyVoiceBackendPayload,
      refreshVoiceDrills,
      refreshVoiceCockpitLine,
      handoffPracticeAfterTake,
      requestCoachNote,
      onCoachNoteError,
      compressVoiceTimeline,
      addTerminalLine,
      render,
    },
  };
}

describe('voice live transition controller', () => {
  it('arms practice, refreshes runtime state, and only emits the explicit success notice on success', async () => {
    const harness = createHarness();

    const started = await harness.controller.startPracticeSession({
      silent: true,
      successNotice: 'Practice armed for the next coached pass.',
    });

    expect(started).toBe(true);
    expect(harness.mocks.resetCoachRuntimeUiState).toHaveBeenCalledWith({
      stopListening: true,
      stopSpeech: true,
    });
    expect(harness.mocks.stopAudioStream).toHaveBeenCalledTimes(1);
    expect(harness.mocks.startPracticeSessionRequest).toHaveBeenCalledWith('session-1', {
      targetPreset: 'teacher',
      referenceClipId: null,
      targetSource: 'custom-handmade',
      targetVoiceProfile: expect.objectContaining({
        profileId: 'custom-profile-1',
        pitchFloorHz: 120,
        pitchCeilingHz: 140,
      }),
    });
    expect(harness.mocks.refreshVoiceDrills).toHaveBeenCalledWith(true);
    expect(harness.mocks.refreshVoiceCockpitLine).toHaveBeenCalledWith('ensure');
    expect(harness.mocks.startAudioStream).toHaveBeenCalledTimes(1);
    expect(harness.mocks.addTerminalLine).toHaveBeenCalledWith('system', 'Practice armed for the next coached pass.');
    expect(harness.getTransportState().status).toBe('streaming');
    expect(harness.getTransportState().sessionArmed).toBe(true);
    expect(harness.getSuppressPracticeClick()).toBe(false);
  });

  it('cleans up backend arming failures without emitting a false success notice', async () => {
    const harness = createHarness();
    harness.mocks.startAudioStream.mockRejectedValueOnce(new Error('Mic transport failed'));

    const started = await harness.controller.startPracticeSession({
      silent: true,
      successNotice: 'Practice armed for the next coached pass.',
    });

    expect(started).toBe(false);
    expect(harness.mocks.disarmPracticeSessionRequest).toHaveBeenCalledWith('session-1', 'audio transport failed');
    expect(harness.mocks.addTerminalLine).not.toHaveBeenCalledWith('system', 'Practice armed for the next coached pass.');
    expect(harness.getVoiceUiState().status).toBe('error');
    expect(harness.getVoiceUiState().serviceStatus).toBe('error');
    expect(harness.getVoiceUiState().lastError).toBe('Mic transport failed');
  });

  it('begins a take only when practice transport is actively armed', () => {
    const harness = createHarness();
    harness.setTransportState({
      status: 'streaming',
      sessionArmed: true,
      liveFrame: { t: 0, pitchHz: 220 } as VoiceLiveFrame,
      liveTrace: [{ t: 0, pitchHz: 220 } as VoiceLiveFrame],
    });

    const began = harness.controller.beginPracticeTake();

    expect(began).toBe(true);
    expect(harness.getTransportState().takeActive).toBe(true);
    expect(harness.getTransportState().takeProcessing).toBe(false);
    expect(harness.getTransportState().liveFrame).toBeNull();
    expect(harness.getTransportState().liveTrace).toEqual([]);
    expect(harness.getVoiceUiState().status).toBe('active');
  });

  it('submits a completed take, restores trace state, and requests a coach note on success', async () => {
    const harness = createHarness();
    harness.setVoiceSessionId('voice-session-1');
    harness.setTransportState({
      status: 'streaming',
      sessionArmed: true,
      takeActive: true,
    });
    harness.setLiveTrace([
      { t: 0, pitchHz: 220 } as VoiceLiveFrame,
      { t: 10, pitchHz: 222 } as VoiceLiveFrame,
    ]);

    const completed = await harness.controller.endPracticeTake('manual take end');

    expect(completed).toBe(true);
    expect(harness.mocks.compressVoiceTimeline).toHaveBeenCalled();
	    expect(harness.mocks.submitPracticeTakeRequest).toHaveBeenCalledWith(
	      'session-1',
	      'manual take end',
	      [{ t: 0, pitchHz: 220 }],
	      expect.objectContaining({
	        clientAttemptId: expect.stringMatching(/^voice-attempt-/),
	        repContext: expect.objectContaining({
	          kind: 'sustained',
	          drillId: 'teacher-vocalise-sustained',
	          tags: ['vocalise', 'stability', 'pitch'],
	          drill: {
	            id: 'teacher-vocalise-sustained',
	            kind: 'sustained',
	            tags: ['vocalise', 'stability', 'pitch'],
	          },
	        }),
	        selfReport: expect.objectContaining({
	          effort: 2,
	          strain: 1,
	          perceivedDifficulty: 3,
	          confidence: 4,
	          metadata: expect.objectContaining({
	            source: 'voice-tab-self-report',
	          }),
	        }),
	      }),
	    );
    expect(harness.mocks.refreshVoiceDrills).toHaveBeenCalledWith(true);
    expect(harness.mocks.refreshVoiceCockpitLine).toHaveBeenCalledWith('ensure');
    expect(harness.mocks.handoffPracticeAfterTake).toHaveBeenCalledTimes(1);
    expect(harness.mocks.requestCoachNote).toHaveBeenCalledTimes(1);
    expect(harness.getLastTakeTrace()).toHaveLength(1);
	    expect(harness.getLastTakeTrace()[0]).toMatchObject({ t: 0, pitchHz: 220 });
	    expect(harness.getVoiceUiState().selfReportDraft.effort).toBe(null);
	    expect(harness.mocks.addTerminalLine).toHaveBeenCalledWith('system', 'Voice take ended');
	  });

  it('prepares for a live session transition by disarming practice, pausing playback, and resetting runtime UI', async () => {
    const harness = createHarness();
    harness.setConnection(null, false);

    await harness.controller.prepareForSessionTransition('mode switch');

    expect(harness.mocks.stopAudioStream).toHaveBeenCalledWith(true);
    expect(harness.mocks.pauseReferencePlayback).toHaveBeenCalledTimes(1);
    expect(harness.mocks.resetCoachRuntimeUiState).toHaveBeenNthCalledWith(1, {
      stopListening: true,
      stopSpeech: true,
    });
    expect(harness.mocks.resetCoachRuntimeUiState).toHaveBeenNthCalledWith(2, {
      stopSpeech: true,
      resetLessonStatus: true,
      resetForecastState: true,
    });
  });
});
