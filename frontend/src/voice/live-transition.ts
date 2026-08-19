import {
  registerVoiceAttemptArtifact,
  type VoiceCockpitLineAction,
  type VoicePracticeTakeResponse,
} from './api';
import type { VoiceAttemptArtifact, VoicePracticeLine, VoiceRepContext } from './contracts';
import type { VoicePracticeTransportSnapshot } from './practice-transport';
import {
  getVoiceBackendPayloadSlices,
  createDefaultVoiceDrillState,
  createDefaultVoiceSelfReport,
  normalizeVoiceUiState,
  normalizeVoiceSelfReport,
  type VoiceLiveFrame,
  type VoiceDrillState,
  type VoiceUiState,
} from './state';

export type VoiceRuntimeUiResetOptions = {
  stopListening?: boolean;
  stopSpeech?: boolean;
  resetLessonStatus?: boolean;
  resetForecastState?: boolean;
  resetDrillState?: boolean;
  syncLastSpokenCoachMessage?: boolean;
};

type VoiceLiveTransitionControllerOptions = {
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
  };
  getVoiceUiState: () => VoiceUiState;
  getVoiceDrillState: () => VoiceDrillState;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  getTransportState: () => VoicePracticeTransportSnapshot;
  setTransportState: (
    updater: (state: VoicePracticeTransportSnapshot) => VoicePracticeTransportSnapshot,
  ) => void;
  getTargetPreset: () => string;
  getReferenceClipId: () => string | null;
  getLiveTrace: () => VoiceLiveFrame[];
  setLiveTrace: (trace: VoiceLiveFrame[]) => void;
  setLastTakeTrace: (trace: VoiceLiveFrame[]) => void;
  setSuppressPracticeClick: (value: boolean) => void;
  resetCoachRuntimeUiState: (options: VoiceRuntimeUiResetOptions) => void;
  pauseReferencePlayback: () => void;
  stopAudioStream: (preserveFrame?: boolean) => Promise<void>;
  startAudioStream: () => Promise<void>;
  startPracticeSessionRequest: (
    sessionId: string,
    options: {
      targetPreset: string;
      referenceClipId: string | null;
      targetVoiceProfile: VoiceUiState['targetVoiceProfile'];
      targetSource: VoiceUiState['targetSource'];
    },
  ) => Promise<Record<string, unknown>>;
  submitPracticeTakeRequest: (
    sessionId: string,
    reason: string,
    lastTakeTimeline: VoiceLiveFrame[] | null,
    attemptArtifact?: VoiceAttemptArtifact | null,
  ) => Promise<VoicePracticeTakeResponse>;
  disarmPracticeSessionRequest: (sessionId: string, reason: string) => Promise<Record<string, unknown>>;
  applyVoiceBackendPayload: (payload: Record<string, unknown>) => void;
  refreshVoiceDrills: (silent?: boolean) => Promise<unknown>;
  refreshVoiceCockpitLine: (action?: VoiceCockpitLineAction) => Promise<unknown>;
  handoffPracticeAfterTake: () => Promise<void>;
  requestCoachNote: () => Promise<void>;
  onCoachNoteError: (message: string) => void;
  compressVoiceTimeline: (timeline: VoiceLiveFrame[] | null | undefined, maxPoints?: number) => VoiceLiveFrame[];
  addTerminalLine: (type: 'system', content: string) => void;
  render: () => void;
};

function patchTransportState(
  options: Pick<VoiceLiveTransitionControllerOptions, 'setTransportState'>,
  patch: Partial<VoicePracticeTransportSnapshot>,
): void {
  options.setTransportState((state) => ({
    ...state,
    ...patch,
  }));
}

function resolveErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function createVoiceClientAttemptId(): string {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  if (randomUuid) {
    return `voice-attempt-${randomUuid}`;
  }
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).slice(2, 12);
  return `voice-attempt-${timestamp}-${randomSuffix}`;
}

function cloneVoicePracticeLine(activeLine: VoicePracticeLine | null): VoicePracticeLine | null {
  if (!activeLine) {
    return null;
  }
  return {
    ...activeLine,
    teachingFocus: activeLine.teachingFocus.slice(),
  };
}

function createVoiceRepContext(
  voiceUiState: VoiceUiState,
  voiceDrillState: VoiceDrillState = createDefaultVoiceDrillState(),
): VoiceRepContext {
  const targetVoiceProfile = voiceUiState.targetVoiceProfile;
  const selectedDrill = voiceDrillState.selectedDrill
    || voiceDrillState.drills.find((drill) => drill.id === voiceDrillState.selectedLessonId)
    || null;
  const drill = selectedDrill ? {
    id: selectedDrill.id,
    kind: selectedDrill.kind || null,
    tags: selectedDrill.tags.slice(),
  } : null;
  return {
    targetPreset: voiceUiState.targetPreset || null,
    targetSource: voiceUiState.targetSource || null,
    lessonId: voiceUiState.lessonId || null,
    activeLine: cloneVoicePracticeLine(voiceUiState.activeLine),
    referenceClipId: voiceUiState.referenceClipId || null,
    referenceClipName: voiceUiState.referenceClipName || null,
    forecastPhrase: voiceUiState.forecastPhrase || null,
    targetProfileId: targetVoiceProfile?.profileId || null,
    targetProfileSource: targetVoiceProfile?.sourceFilename || targetVoiceProfile?.clipId || null,
    kind: drill?.kind || null,
    drillId: drill?.id || null,
    tags: drill?.tags || [],
    drill,
  };
}

function createVoiceAttemptSelfReport(voiceUiState: VoiceUiState) {
  const selfReport = normalizeVoiceSelfReport(voiceUiState.selfReportDraft);
  if (!selfReport) {
    return null;
  }
  return {
    ...selfReport,
    metadata: {
      ...(selfReport.metadata || {}),
      source: 'voice-tab-self-report',
      capturedAt: new Date().toISOString(),
    },
  };
}

function createVoiceAttemptArtifact(
  voiceUiState: VoiceUiState,
  voiceDrillState: VoiceDrillState,
): VoiceAttemptArtifact {
  return {
    clientAttemptId: createVoiceClientAttemptId(),
    repContext: createVoiceRepContext(voiceUiState, voiceDrillState),
    selfReport: createVoiceAttemptSelfReport(voiceUiState),
  };
}

export function createVoiceLiveTransitionController(options: VoiceLiveTransitionControllerOptions) {
  async function startPracticeSession(config: {
    silent?: boolean;
    successNotice?: string | null;
  } = {}): Promise<boolean> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const transport = options.getTransportState();
    if (!currentSessionId || !isConnected) {
      return false;
    }
    if (transport.sessionArmed && transport.status === 'streaming') {
      return false;
    }

    let sessionReady = false;
    try {
      options.resetCoachRuntimeUiState({
        stopListening: true,
        stopSpeech: true,
      });
      options.setSuppressPracticeClick(false);
      patchTransportState(options, {
        takeActive: false,
        takeProcessing: false,
      });
      options.setLiveTrace([]);
      options.setLastTakeTrace([]);
      await options.stopAudioStream();

      const voiceUiState = options.getVoiceUiState();
      const data = await options.startPracticeSessionRequest(currentSessionId, {
        targetPreset: options.getTargetPreset(),
        referenceClipId: options.getReferenceClipId(),
        targetVoiceProfile: voiceUiState.targetVoiceProfile || null,
        targetSource: voiceUiState.targetSource || 'built-in',
      });
      options.applyVoiceBackendPayload(data);
      sessionReady = true;
      await options.refreshVoiceDrills(true);
      await options.refreshVoiceCockpitLine('ensure').catch(() => null);
      await options.startAudioStream();
      options.render();

      const successNotice = typeof config.successNotice === 'string' && config.successNotice.trim()
        ? config.successNotice.trim()
        : null;
      if (successNotice) {
        options.addTerminalLine('system', successNotice);
      } else if (!config.silent) {
        options.addTerminalLine('system', `Voice practice armed [${options.getVoiceUiState().targetPreset}]`);
      }
      return true;
    } catch (error) {
      if (sessionReady) {
        await options.disarmPracticeSessionRequest(currentSessionId, 'audio transport failed').catch(() => null);
      }
      await options.stopAudioStream();
      options.updateVoiceUiState((state) => normalizeVoiceUiState({
        ...state,
        status: 'error',
        serviceStatus: 'error',
        lastError: resolveErrorMessage(error),
      }));
      options.render();
      if (!config.silent) {
        options.addTerminalLine('system', `Voice trainer start failed: ${resolveErrorMessage(error)}`);
      }
      return false;
    }
  }

  function beginPracticeTake(): boolean {
    const transport = options.getTransportState();
    if (!transport.sessionArmed || transport.takeActive || transport.takeProcessing || transport.status !== 'streaming') {
      return false;
    }

    options.resetCoachRuntimeUiState({
      stopListening: true,
      stopSpeech: true,
    });
    patchTransportState(options, {
      takeActive: true,
      takeProcessing: false,
      liveFrame: null,
    });
    options.setLiveTrace([]);
    options.updateVoiceUiState((state) => normalizeVoiceUiState({
      ...state,
      status: 'active',
      lastError: null,
    }));
    options.render();
    return true;
  }

  async function endPracticeTake(reason = 'manual take end'): Promise<boolean> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const transport = options.getTransportState();
    if (!currentSessionId || !isConnected) {
      return false;
    }
    if (!transport.sessionArmed || transport.takeProcessing || !transport.takeActive) {
      return false;
    }

    try {
      patchTransportState(options, {
        takeActive: false,
        takeProcessing: true,
        liveFrame: null,
      });
      const liveTakeTrace = options.getLiveTrace().slice();
      const lastTakeTimeline = liveTakeTrace.length > 0
        ? options.compressVoiceTimeline(liveTakeTrace)
        : null;
      const attemptArtifact = createVoiceAttemptArtifact(
        options.getVoiceUiState(),
        options.getVoiceDrillState(),
      );
      const clearRegisteredAttemptArtifact = registerVoiceAttemptArtifact(
        currentSessionId,
        reason,
        attemptArtifact,
      );

      options.render();
      let data: VoicePracticeTakeResponse;
      try {
        data = await options.submitPracticeTakeRequest(currentSessionId, reason, lastTakeTimeline, attemptArtifact);
      } finally {
        clearRegisteredAttemptArtifact();
      }
      const { voiceState: payloadVoiceState } = getVoiceBackendPayloadSlices(data);
      patchTransportState(options, {
        takeProcessing: false,
      });
      options.applyVoiceBackendPayload(data);
      options.updateVoiceUiState((state) => normalizeVoiceUiState({
        ...state,
        lastSummary: data.summary || payloadVoiceState?.lastSummary || state.lastSummary,
        selfReportDraft: createDefaultVoiceSelfReport(),
      }));
      const resolvedLastTakeTimeline = Array.isArray(options.getVoiceUiState().lastTakeTimeline)
        ? options.getVoiceUiState().lastTakeTimeline
        : null;
      options.setLastTakeTrace(
        resolvedLastTakeTimeline && resolvedLastTakeTimeline.length > 0
          ? resolvedLastTakeTimeline.slice()
          : Array.isArray(lastTakeTimeline)
            ? lastTakeTimeline.slice()
            : [],
      );
      await options.refreshVoiceDrills(true);
      await options.refreshVoiceCockpitLine('ensure').catch(() => null);
      await options.handoffPracticeAfterTake();
      options.render();
      if (options.getVoiceUiState().lastSummary) {
        options.requestCoachNote().catch((error) => {
          options.onCoachNoteError(resolveErrorMessage(error));
        });
      }
      options.addTerminalLine('system', 'Voice take ended');
      return true;
    } catch (error) {
      const nextTransport = options.getTransportState();
      const canRetryTake = nextTransport.sessionArmed && nextTransport.status === 'streaming';
      patchTransportState(options, {
        takeProcessing: false,
        takeActive: false,
      });
      options.updateVoiceUiState((state) => normalizeVoiceUiState({
        ...state,
        lastError: canRetryTake
          ? `Take scoring failed. Practice is still armed, so hold to try again: ${resolveErrorMessage(error)}`
          : resolveErrorMessage(error),
        status: canRetryTake ? 'ready' : 'error',
      }));
      options.render();
      options.addTerminalLine('system', `Voice trainer end failed: ${resolveErrorMessage(error)}`);
      return false;
    }
  }

  async function disarmPracticeSession(reason = 'manual disarm'): Promise<boolean> {
    options.resetCoachRuntimeUiState({
      stopListening: true,
      stopSpeech: true,
    });

    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected || !options.getVoiceUiState().voiceSessionId) {
      await options.stopAudioStream(true);
      patchTransportState(options, {
        sessionArmed: false,
        takeActive: false,
        takeProcessing: false,
      });
      options.render();
      return true;
    }

    if (options.getTransportState().takeActive) {
      await endPracticeTake('disarm active take');
    }

    if (options.getTransportState().takeProcessing) {
      return false;
    }

    try {
      await options.stopAudioStream(true);
      const data = await options.disarmPracticeSessionRequest(currentSessionId, reason);
      options.applyVoiceBackendPayload(data);
      patchTransportState(options, {
        sessionArmed: false,
        takeActive: false,
        takeProcessing: false,
      });
      options.render();
      return true;
    } catch (error) {
      options.updateVoiceUiState((state) => normalizeVoiceUiState({
        ...state,
        lastError: resolveErrorMessage(error),
        status: 'error',
      }));
      options.render();
      options.addTerminalLine('system', `Voice trainer disarm failed: ${resolveErrorMessage(error)}`);
      return false;
    }
  }

  async function prepareForSessionTransition(reason: string): Promise<void> {
    await disarmPracticeSession(reason);
    options.pauseReferencePlayback();
    options.resetCoachRuntimeUiState({
      stopSpeech: true,
      resetLessonStatus: true,
      resetForecastState: true,
    });
  }

  return {
    startPracticeSession,
    beginPracticeTake,
    endPracticeTake,
    disarmPracticeSession,
    prepareForSessionTransition,
  };
}
