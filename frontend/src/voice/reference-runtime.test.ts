import { describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceUiState, type VoiceUiState } from './state';
import { createVoiceReferenceRuntimeController } from './reference-runtime';

function createPlayer() {
  const player = document.createElement('audio');
  player.load = vi.fn();
  player.pause = vi.fn();
  return player;
}

describe('voice reference runtime controller', () => {
  it('never attaches a reference clip to an audio element on the Coach page', () => {
    const coachSurface = document.createElement('section');
    coachSurface.id = 'tv-coach-surface';
    document.body.append(coachSurface);
    const player = createPlayer();
    const getReferenceAudioUrl = vi.fn((clipId) => `https://voice.test/reference/${clipId}/audio`);
    let state: VoiceUiState = {
      ...createDefaultVoiceUiState({ targetPreset: 'cute-feminine' }),
      referenceClipId: 'coach-conditioning-clip',
    };

    try {
      const controller = createVoiceReferenceRuntimeController({
        getVoiceUiState: () => state,
        updateVoiceUiState: (updater) => { state = updater(state); },
        getPlayerElement: () => player,
        getReferenceAudioUrl,
        getReferenceAnalysis: vi.fn(),
        pausePlayback: vi.fn(),
        render: vi.fn(),
      });

      controller.syncPersistedReferenceAnalysis('coach-conditioning-clip');

      expect(getReferenceAudioUrl).not.toHaveBeenCalled();
      expect(player.getAttribute('src')).toBeNull();
      expect(controller.getHydrationView('coach-conditioning-clip').hasPlayableReference).toBe(false);
    } finally {
      coachSurface.remove();
    }
  });

  it('syncs playback source for the active reference clip and clears it when the clip disappears', () => {
    let state: VoiceUiState = createDefaultVoiceUiState({ targetPreset: 'cute-feminine' });
    const player = createPlayer();

    const controller = createVoiceReferenceRuntimeController({
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      getPlayerElement: () => player,
      getReferenceAudioUrl: (clipId) => `https://voice.test/reference/${clipId}/audio`,
      getReferenceAnalysis: vi.fn(),
      pausePlayback: vi.fn(),
      render: vi.fn(),
    });

    state = {
      ...state,
      referenceClipId: 'clip-1',
      referenceClipName: 'target.wav',
    };

    expect(controller.syncPersistedReferenceAnalysis('clip-1')).toBeNull();
    expect(player.getAttribute('src')).toBe('https://voice.test/reference/clip-1/audio');
    expect(controller.getHydrationView('clip-1').hasPlayableReference).toBe(true);

    expect(controller.syncPersistedReferenceAnalysis(null)).toBeNull();
    expect(player.getAttribute('src')).toBeNull();
    expect(controller.getHydrationView(null).hasPlayableReference).toBe(false);
  });

  it('hydrates missing reference analysis once and stores it on the voice UI state', async () => {
    let state: VoiceUiState = {
      ...createDefaultVoiceUiState({ targetPreset: 'cute-feminine' }),
      referenceClipId: 'clip-1',
      referenceClipName: 'target.wav',
    };
    const render = vi.fn();
    const getReferenceAnalysis = vi.fn(() => Promise.resolve({
      clipId: 'clip-1',
      filename: 'target.wav',
      durationMs: 2400,
      analysisVersion: 'voice-metrics-v2',
      timeline: [],
      metrics: {
        meanPitchHz: 220,
        advanced: {
          pitchP10Hz: 186.224,
          formantLite: {
            f2MedianHz: 1848.337,
            frontnessScore: 0.6033,
          },
          quality: {
            cppsLike: 10.821,
            strainRisk: 0.2149,
          },
        },
      },
    }));

    const controller = createVoiceReferenceRuntimeController({
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      getPlayerElement: () => createPlayer(),
      getReferenceAudioUrl: (clipId) => `https://voice.test/reference/${clipId}/audio`,
      getReferenceAnalysis,
      pausePlayback: vi.fn(),
      render,
    });

    await controller.hydrateReferenceAnalysisIfNeeded();

    expect(getReferenceAnalysis).toHaveBeenCalledTimes(1);
    expect(state.referenceAnalysis).toMatchObject({
      clipId: 'clip-1',
      filename: 'target.wav',
      durationMs: 2400,
      analysisVersion: 'voice-metrics-v2',
      metrics: {
        advanced: {
          pitchP10Hz: 186.22,
          formantLite: {
            f2MedianHz: 1848.34,
            frontnessScore: 0.6033,
          },
          quality: {
            cppsLike: 10.82,
            strainRisk: 0.2149,
          },
        },
      },
    });
    expect(render).toHaveBeenCalledTimes(1);
    expect(controller.getHydrationView('clip-1')).toMatchObject({
      hydrationInFlight: false,
      hydrationFailed: false,
      hydrationError: null,
    });
  });

  it('suppresses repeated hydration after a failure until the clip changes', async () => {
    let state: VoiceUiState = {
      ...createDefaultVoiceUiState({ targetPreset: 'cute-feminine' }),
      referenceClipId: 'clip-1',
      referenceClipName: 'target.wav',
    };
    const getReferenceAnalysis = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({
        clipId: 'clip-2',
        filename: 'target-2.wav',
        durationMs: 1800,
        timeline: [],
        metrics: null,
      });

    const controller = createVoiceReferenceRuntimeController({
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      getPlayerElement: () => createPlayer(),
      getReferenceAudioUrl: (clipId) => `https://voice.test/reference/${clipId}/audio`,
      getReferenceAnalysis,
      pausePlayback: vi.fn(),
      render: vi.fn(),
    });

    await controller.hydrateReferenceAnalysisIfNeeded();
    await controller.hydrateReferenceAnalysisIfNeeded();

    expect(getReferenceAnalysis).toHaveBeenCalledTimes(1);
    expect(controller.getHydrationView('clip-1')).toMatchObject({
      hydrationFailed: true,
      hydrationError: 'network down',
    });

    state = {
      ...state,
      referenceClipId: 'clip-2',
      referenceClipName: 'target-2.wav',
      referenceAnalysis: null,
    };
    controller.syncPersistedReferenceAnalysis('clip-2');
    await controller.hydrateReferenceAnalysisIfNeeded();

    expect(getReferenceAnalysis).toHaveBeenCalledTimes(2);
    expect(state.referenceAnalysis).toMatchObject({
      clipId: 'clip-2',
      filename: 'target-2.wav',
    });
  });

  it('prefers richer backend reference analysis details over persisted-only playback metadata', () => {
    let state: VoiceUiState = {
      ...createDefaultVoiceUiState({ targetPreset: 'cute-feminine' }),
      referenceClipId: 'clip-1',
      referenceClipName: 'target.wav',
      referenceAnalysis: {
        clipId: 'clip-1',
        filename: 'target.wav',
        durationMs: 2400,
        timeline: [],
        metrics: null,
      },
    };

    const controller = createVoiceReferenceRuntimeController({
      getVoiceUiState: () => state,
      updateVoiceUiState: (updater) => {
        state = updater(state);
      },
      getPlayerElement: () => createPlayer(),
      getReferenceAudioUrl: (clipId) => `https://voice.test/reference/${clipId}/audio`,
      getReferenceAnalysis: vi.fn(),
      pausePlayback: vi.fn(),
      render: vi.fn(),
    });

    const adopted = controller.adoptResolvedReferenceAnalysis({
      clipId: 'clip-1',
      filename: 'target.wav',
      durationMs: 2400,
      analysisVersion: 'voice-metrics-v2',
      timeline: [],
      metrics: {
        meanPitchHz: 221.4,
        advanced: {
          stabilityMean: 0.7333,
          formantLite: {
            f2MedianHz: 1904.119,
            frontnessScore: 0.6442,
          },
          quality: {
            cppsLike: 12.106,
            breathyRisk: 0.3012,
          },
        },
      },
    } as any);

    expect(adopted.analysisVersion).toBe('voice-metrics-v2');
    expect(adopted.metrics?.advanced).toMatchObject({
      stabilityMean: 0.7333,
      formantLite: {
        f2MedianHz: 1904.12,
        frontnessScore: 0.6442,
      },
      quality: {
        cppsLike: 12.11,
        breathyRisk: 0.3012,
      },
    });
  });
});
