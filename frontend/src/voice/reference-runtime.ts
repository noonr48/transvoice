import type { VoiceReferenceAnalyzeResponse } from './api';
import {
  getPersistedVoiceReferenceAnalysis,
  normalizeVoiceReferenceAnalysis,
  normalizeVoiceReferenceClipId,
  type VoiceReferenceAnalysis,
  type VoiceUiState,
} from './state';

type VoiceReferenceRuntimeControllerOptions = {
  getVoiceUiState: () => VoiceUiState;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  getPlayerElement: () => HTMLAudioElement | null;
  getReferenceAudioUrl: (clipId: string) => string;
  getReferenceAnalysis: (clipId: string) => Promise<VoiceReferenceAnalyzeResponse>;
  pausePlayback: (reset?: boolean) => void;
  render: () => void;
};

export type VoiceReferenceHydrationView = {
  hasPlayableReference: boolean;
  hydrationInFlight: boolean;
  hydrationFailed: boolean;
  hydrationError: string | null;
};

export type VoiceReferenceRuntimeController = ReturnType<typeof createVoiceReferenceRuntimeController>;

function normalizeReferenceAnalysisPayload(
  clipId: string | null,
  data: VoiceReferenceAnalyzeResponse,
  fallbackFilename: string | null = null,
): VoiceReferenceAnalysis {
  return normalizeVoiceReferenceAnalysis({
    clipId: data.clipId || clipId || null,
    filename: data.filename || fallbackFilename || null,
    durationMs: data.durationMs || null,
    metrics: data.metrics || null,
    timeline: Array.isArray(data.timeline) ? data.timeline : [],
    analysisVersion: data.analysisVersion || null,
  }) || {
    clipId: data.clipId || clipId || null,
    filename: data.filename || fallbackFilename || null,
    durationMs: data.durationMs || null,
    metrics: null,
    timeline: [],
    analysisVersion: data.analysisVersion || null,
  };
}

export function createVoiceReferenceRuntimeController(options: VoiceReferenceRuntimeControllerOptions) {
  let playbackUrl: string | null = null;
  let hydrationClipId: string | null = null;
  let hydrationFailedClipId: string | null = null;
  let hydrationError: string | null = null;

  function clearPlaybackSource(): void {
    options.pausePlayback(true);
    playbackUrl = null;
    const player = options.getPlayerElement();
    if (!player) {
      return;
    }
    player.removeAttribute('src');
    player.load();
    player.classList.add('hidden');
  }

  function setPlaybackSource(referenceClipId: string | null | undefined): void {
    const normalizedClipId = normalizeVoiceReferenceClipId(referenceClipId);
    if (!normalizedClipId) {
      clearPlaybackSource();
      return;
    }

    // In the phone Coach composition, a preset recording is conditioning data
    // only. Do not even attach its URL to the hidden legacy audio element: this
    // makes accidental reference-clip playback impossible on the Coach page.
    const player = options.getPlayerElement();
    if (player?.ownerDocument?.getElementById('tv-coach-surface')) {
      clearPlaybackSource();
      return;
    }

    const nextSource = options.getReferenceAudioUrl(normalizedClipId);
    if (playbackUrl === nextSource && player?.getAttribute('src') === nextSource) {
      player?.classList.remove('hidden');
      return;
    }

    clearPlaybackSource();
    playbackUrl = nextSource;
    if (!player) {
      return;
    }
    player.src = nextSource;
    player.classList.remove('hidden');
  }

  function syncPersistedReferenceAnalysis(nextReferenceClipId: string | null | undefined): VoiceReferenceAnalysis | null {
    const currentState = options.getVoiceUiState();
    const normalizedNextClipId = normalizeVoiceReferenceClipId(nextReferenceClipId);
    const nextReferenceAnalysis = getPersistedVoiceReferenceAnalysis({
      nextReferenceClipId: normalizedNextClipId,
      currentReferenceAnalysis: currentState.referenceAnalysis,
      currentReferenceClipId: currentState.referenceClipId,
    });

    if (!normalizedNextClipId) {
      clearPlaybackSource();
      hydrationClipId = null;
      hydrationFailedClipId = null;
      hydrationError = null;
      return null;
    }

    setPlaybackSource(normalizedNextClipId);
    return nextReferenceAnalysis;
  }

  async function hydrateReferenceAnalysisIfNeeded(): Promise<void> {
    const currentState = options.getVoiceUiState();
    const referenceClipId = normalizeVoiceReferenceClipId(currentState.referenceClipId);
    if (!referenceClipId) {
      hydrationClipId = null;
      hydrationFailedClipId = null;
      hydrationError = null;
      return;
    }

    const currentAnalysisClipId = normalizeVoiceReferenceClipId(currentState.referenceAnalysis?.clipId);
    if (hydrationFailedClipId && hydrationFailedClipId !== referenceClipId) {
      hydrationFailedClipId = null;
      hydrationError = null;
    }
    if (
      currentAnalysisClipId === referenceClipId
      || hydrationClipId === referenceClipId
      || hydrationFailedClipId === referenceClipId
    ) {
      return;
    }

    hydrationClipId = referenceClipId;
    hydrationError = null;

    try {
      const data = await options.getReferenceAnalysis(referenceClipId);
      if (normalizeVoiceReferenceClipId(options.getVoiceUiState().referenceClipId) !== referenceClipId) {
        return;
      }

      options.updateVoiceUiState((state) => ({
        ...state,
        referenceClipName: state.referenceClipName || data.filename || null,
        referenceAnalysis: normalizeReferenceAnalysisPayload(
          referenceClipId,
          data,
          state.referenceClipName || null,
        ),
      }));
      hydrationFailedClipId = null;
      hydrationError = null;
      options.render();
    } catch (error) {
      if (normalizeVoiceReferenceClipId(options.getVoiceUiState().referenceClipId) === referenceClipId) {
        hydrationFailedClipId = referenceClipId;
        hydrationError = error instanceof Error ? error.message : String(error);
        options.render();
      }
    } finally {
      if (hydrationClipId === referenceClipId) {
        hydrationClipId = null;
      }
    }
  }

  function adoptResolvedReferenceAnalysis(
    data: VoiceReferenceAnalyzeResponse,
    fallbackFilename: string | null = null,
  ): VoiceReferenceAnalysis {
    const clipId = normalizeVoiceReferenceClipId(data.clipId) || null;
    hydrationClipId = null;
    hydrationFailedClipId = null;
    hydrationError = null;
    setPlaybackSource(clipId);
    return normalizeReferenceAnalysisPayload(
      clipId,
      data,
      fallbackFilename,
    );
  }

  function getHydrationView(referenceClipId: string | null | undefined): VoiceReferenceHydrationView {
    const normalizedClipId = normalizeVoiceReferenceClipId(referenceClipId);
    return {
      hasPlayableReference: Boolean(playbackUrl),
      hydrationInFlight: normalizedClipId != null && hydrationClipId === normalizedClipId,
      hydrationFailed: normalizedClipId != null && hydrationFailedClipId === normalizedClipId,
      hydrationError,
    };
  }

  return {
    syncPersistedReferenceAnalysis,
    hydrateReferenceAnalysisIfNeeded,
    adoptResolvedReferenceAnalysis,
    getHydrationView,
  };
}
