import {
  getNextVoiceCoachInputProvider,
} from './coach-input-provider';
import { emitBackendPayloadTee, noteVoiceSpeechReferenceResolution } from './coach-honesty';
import type { VoiceCoachInputSessionLease } from './coach-input';
import {
  canPlayVoiceCoachMessage as resolveCanPlayVoiceCoachMessage,
} from './coach-loop';
import type { createVoiceApi } from './api';
import type { VoiceDomBindings } from './dom-bindings';
import type { VoiceHostRuntimeBridge } from './host-runtime-bridge';
import type {
  VoiceHostAppRuntimeBundle,
  VoiceHostOrchestrationOptions,
} from './host-orchestration';
import type { VoiceHostRuntimeComposition } from './host-runtime-composition';
import type { VoiceRuntimeStore } from './runtime-store';
import type { VoiceRuntimeShell } from './runtime-shell';
import type { createVoiceRuntimeStatusController } from './runtime-status';
import type { VoiceSessionStateController } from './session-state-controller';
import {
  hasVoiceBackendPayload,
  type VoiceUiState,
} from './state';
import type { VoiceWorkflowController } from './workflow-controller';
import { VOICE_COACH_SELECTED_VOICE_FAILURE_EVENT } from './coach-surface';
import {
  VOICE_COACH_SLOW_SPEAKING_RATE,
  VOICE_COACH_SPEAKING_RATE,
} from './coach-speech-rate';

type VoiceApi = Pick<
  ReturnType<typeof createVoiceApi>,
  | 'advanceDeepTutorVoiceLesson'
  | 'analyzeReference'
  | 'archiveTargetPreset'
  | 'disarmPracticeSession'
  | 'deleteTargetPreset'
  | 'duplicateTargetPreset'
  | 'getDrills'
  | 'getHealthSnapshot'
  | 'getKnowledgeStatus'
  | 'getReferenceAnalysis'
  | 'getReferenceAudioUrl'
  | 'getSessionState'
  | 'getTaskStatus'
  | 'listTargetPresets'
  | 'projectPhraseForecast'
  | 'refreshCockpitLine'
  | 'requestDeepTutorCoach'
  | 'saveHandmadePreset'
  | 'saveReferencePreset'
  | 'selectDrill'
  | 'selectTargetPreset'
  | 'restoreTargetPreset'
  | 'startCoachTask'
  | 'startDeepTutorVoiceLesson'
  | 'startPracticeSession'
  | 'submitInputRuntimeEvent'
  | 'submitInputTurn'
  | 'submitPracticeTake'
  | 'syncPreset'
  | 'syncReference'
  | 'updateCockpitState'
  | 'updateConditioningState'
>;

type VoiceRuntimeStatusController = ReturnType<typeof createVoiceRuntimeStatusController>;

type VoiceHostComposition = Pick<
  VoiceHostRuntimeComposition,
  | 'applyVoiceInputProviderStatusPayload'
  | 'compressVoiceTimeline'
  | 'getSelectedVoiceAudioInput'
  | 'getVoiceCoachInputSilenceThreshold'
  | 'refreshVoiceAudioInputDevices'
  | 'speakVoiceCoachMessage'
  | 'stopVoiceCoachListening'
  | 'stopVoiceCoachSpeech'
  | 'toggleVoiceCoachContinuousMode'
  | 'toggleVoiceCoachInputProvider'
  | 'toggleVoiceCoachListening'
  | 'toggleVoiceCoachSpeechProvider'
  | 'voiceAppRuntime'
  | 'voiceHostActionController'
  | 'writeVoiceInputDevicePreference'
>;

type VoiceControllerGraphOptions = VoiceHostOrchestrationOptions['controllerGraph'];
type VoiceAddTerminalLine = (type: string, content: string) => void;
type VoiceQuestionInput = HTMLInputElement | null;
type VoiceTargetPresetSelect = HTMLSelectElement | null;
type VoiceReferencePlayer = HTMLAudioElement | null;
type VoiceTextInput = HTMLInputElement | HTMLTextAreaElement | null;
type VoiceFileInput = HTMLInputElement | null;

export type VoiceHostOrchestrationConfigOptions = {
  hostRuntimeComposition: VoiceHostComposition;
  hostRuntimeBridge: VoiceHostRuntimeBridge;
  runtimeStatusController: VoiceRuntimeStatusController;
  store: VoiceRuntimeStore;
  voiceApi: VoiceApi;
  kernelUrl: string;
  kernelWsUrl: string;
  voiceTrainerUrl?: string;
  voiceTrainerToken?: string;
  voiceInputLiveBearerToken?: string | null;
  getVoiceInputLiveLeaseId?: () => string | null;
  releasePracticeForCoachListening?: () => Promise<void>;
  getCurrentMode: () => string;
  getCurrentSessionId: () => string | null;
  getIsConnected: () => boolean;
  /**
   * Must return one stable object per session ownership epoch and rotate to a
   * fresh, never-reused object on session ID change, disconnect, or reconnect.
   */
  getSessionLease: () => VoiceCoachInputSessionLease;
  addTerminalLine: VoiceAddTerminalLine;
  /**
   * Optional: append a plain coach line into the thread (same render path as the
   * greeting/debrief lines). Used only for non-failure backend acknowledgments;
   * unwired hosts simply drop the line.
   */
  appendCoachLine?: (text: string) => void;
  /**
   * Optional: SPEAK a coach line the host has just appended, through the same
   * TTS path coach replies use. Returns whether playback started, so an unwired
   * or unavailable speech path degrades to the text append alone.
   *
   * Deliberately separate from `appendCoachLine`: this is a voice-first surface,
   * and an acknowledgment the learner can only READ is the failure it exists to
   * fix — but a host with no speaker must still get the text.
   */
  speakCoachLine?: (text: string) => boolean;
  getSessionStateController: () => VoiceSessionStateController | null;
  getWorkflowController: () => VoiceWorkflowController | null;
  getRuntimeShell: () => VoiceRuntimeShell | null;
  getVoiceCoachQuestionInput: () => VoiceQuestionInput;
  getVoiceTargetPresetSelect: () => VoiceTargetPresetSelect;
  getVoiceReferencePlayer: () => VoiceReferencePlayer;
  getVoiceConditioningPromptTextInput: () => VoiceTextInput;
  getVoiceConditioningPromptFileInput: () => VoiceFileInput;
  getVoiceConditioningReferenceFileInput: () => VoiceFileInput;
  getDomBindings: () => VoiceDomBindings | null;
};

function createAppRuntimeBundle(
  store: VoiceRuntimeStore,
  voiceAppRuntime: VoiceHostComposition['voiceAppRuntime'],
): VoiceHostAppRuntimeBundle {
  return {
    runtime: voiceAppRuntime,
    getVoiceUiState: () => store.getUiState(),
  };
}

function getSessionContext(
  options: Pick<
    VoiceHostOrchestrationConfigOptions,
    'getCurrentSessionId' | 'getIsConnected'
  >,
): {
  currentSessionId: string | null;
  isConnected: boolean;
} {
  return {
    currentSessionId: options.getCurrentSessionId(),
    isConnected: options.getIsConnected(),
  };
}

function getCoachInputSessionContext(
  options: Pick<
    VoiceHostOrchestrationConfigOptions,
    'getCurrentSessionId' | 'getIsConnected' | 'getSessionLease'
  >,
): {
  currentSessionId: string | null;
  isConnected: boolean;
  sessionLease: VoiceCoachInputSessionLease;
} {
  return {
    ...getSessionContext(options),
    sessionLease: options.getSessionLease(),
  };
}

function getWorkflowSessionContext(
  options: Pick<
    VoiceHostOrchestrationConfigOptions,
    'getCurrentMode' | 'getCurrentSessionId' | 'getIsConnected'
  >,
): {
  currentMode: string;
  currentSessionId: string | null;
  isConnected: boolean;
} {
  return {
    currentMode: options.getCurrentMode(),
    currentSessionId: options.getCurrentSessionId(),
    isConnected: options.getIsConnected(),
  };
}

function getRequestedTargetPreset(
  options: Pick<
    VoiceHostOrchestrationConfigOptions,
    'getVoiceTargetPresetSelect' | 'store'
  >,
): string {
  return (
    options.getVoiceTargetPresetSelect()?.value
    || options.store.getUiState().targetPreset
    || 'cute-feminine'
  );
}

function canUseBackendCapture(): boolean {
  const audioWindow = window as Window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return Boolean(
    navigator.mediaDevices
    && (
      typeof AudioContext !== 'undefined'
      || typeof audioWindow.webkitAudioContext !== 'undefined'
    ),
  );
}

function canUseBackendRecordedFallback(): boolean {
  return typeof MediaRecorder !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function hasBrowserSpeechRecognitionSupport(): boolean {
  // Android WebView can expose the constructor even when the device has no
  // recognition service selected. Calls then fail before microphone capture;
  // prefer our verified backend capture path in the packaged phone app.
  if (/;\s*wv\)/i.test(navigator.userAgent)) {
    return false;
  }
  const speechWindow = window as Window & {
    SpeechRecognition?: unknown;
    webkitSpeechRecognition?: unknown;
  };
  return Boolean(speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition);
}

function hasBrowserSpeechSynthesisSupport(): boolean {
  return 'speechSynthesis' in window;
}

export function createVoiceHostOrchestrationConfig(
  options: VoiceHostOrchestrationConfigOptions,
): VoiceHostOrchestrationOptions {
  const {
    hostRuntimeComposition,
    hostRuntimeBridge,
    runtimeStatusController,
    store,
    voiceApi,
  } = options;
  const {
    voiceAppRuntime,
    voiceHostActionController,
  } = hostRuntimeComposition;

  const getBackendLiveVadConfig = () => {
    const advancedPanel = store.getUiState().advancedPanel;
    return {
      silenceHoldMs: advancedPanel.vadSilenceHoldMs,
      noSpeechTimeoutMs: advancedPanel.vadNoSpeechTimeoutMs,
      minSpeechMs: advancedPanel.vadMinSpeechMs,
    };
  };

  const syncVoiceAdvancedPanelVadControls = () => {
    const domBindings = options.getDomBindings();
    if (!domBindings) {
      return;
    }

    const advancedPanel = store.getUiState().advancedPanel;
    const refs = domBindings.bootstrapRefs;

    const updateValue = (input: HTMLInputElement, nextValue: string) => {
      if (document.activeElement === input) {
        return;
      }
      if (input.value !== nextValue) {
        input.value = nextValue;
      }
    };

    updateValue(refs.voiceVadRmsThresholdInput, String(advancedPanel.vadRmsThreshold));
    updateValue(refs.voiceVadSilenceHoldMsInput, String(advancedPanel.vadSilenceHoldMs));
    updateValue(refs.voiceVadNoSpeechTimeoutMsInput, String(advancedPanel.vadNoSpeechTimeoutMs));
    updateValue(refs.voiceVadMinSpeechMsInput, String(advancedPanel.vadMinSpeechMs));
    refs.voiceAudioPreferWorkletCheckbox.checked = Boolean(advancedPanel.audioPreferWorklet);
  };

  return {
    appRuntime: createAppRuntimeBundle(store, voiceAppRuntime),
    controllerGraph: {
      onCoachTurnId: (turnId) => {
        store.patchState({ voiceCoachTurnId: turnId });
      },
      practiceTransport: {
        getState: hostRuntimeBridge.getPracticeTransportState,
        setState: hostRuntimeBridge.setPracticeTransportState,
        render: hostRuntimeBridge.render,
        getRecoveryContext: () => ({
          ...getSessionContext(options),
          voiceSessionId: store.getUiState().voiceSessionId,
        }),
        disarmPracticeSession: (sessionId, reason) => voiceApi.disarmPracticeSession(sessionId, reason),
        updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
      },
      referencePlayback: {
        getPlayerElement: () => options.getVoiceReferencePlayer(),
        render: hostRuntimeBridge.render,
      },
      referenceRuntime: {
        getVoiceUiState: () => store.getUiState(),
        updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
        getPlayerElement: () => options.getVoiceReferencePlayer(),
        getReferenceAudioUrl: (clipId) => voiceApi.getReferenceAudioUrl(clipId),
        getReferenceAnalysis: (clipId) => voiceApi.getReferenceAnalysis(clipId),
        render: hostRuntimeBridge.render,
      },
      sessionState: {
        getVoiceUiState: () => store.getUiState(),
        updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
        setVoiceStudentModelState: (state) => {
          store.patchState({
            voiceStudentModelState: state,
          });
        },
        getSessionContext: () => getSessionContext(options),
        fetchSessionState: (sessionId) => voiceApi.getSessionState(sessionId),
        resetDeepTutorLessonState: () => {
          store.patchState({
            voiceDeepTutorLessonStatus: 'idle',
            voiceDeepTutorLessonError: null,
          });
        },
        clearPracticeState: () => {
          store.patchState({
            voiceSessionArmed: false,
            voiceTakeActive: false,
            voiceTakeProcessing: false,
          });
        },
        getLatestCoachMessage: voiceAppRuntime.getLatestCoachMessage,
        setLastSpokenCoachMessageId: (messageId) => {
          store.patchState({
            voiceLastSpokenCoachMessageId: messageId,
          });
        },
        setLastTakeTrace: (trace) => {
          store.patchState({
            voiceLastTakeTrace: trace,
          });
        },
        hasDeepTutorVoiceLesson: voiceAppRuntime.hasDeepTutorVoiceLesson,
        refreshVoiceCockpitLine: voiceHostActionController.refreshVoiceCockpitLine,
        render: hostRuntimeBridge.render,
      },
      workflow: {
        getSessionContext: () => getWorkflowSessionContext(options),
        getVoiceUiState: () => store.getUiState(),
        updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
        getVoiceTransportStatus: () => store.getState().voiceTransportStatus,
        getRequestedTargetPreset: () => getRequestedTargetPreset(options),
        assertPracticeTargetUnlocked: voiceAppRuntime.assertVoicePracticeTargetUnlocked,
        getHealthSnapshot: () => voiceApi.getHealthSnapshot(),
        getKnowledgeStatus: () => voiceApi.getKnowledgeStatus(),
        applyHealthStatusPayload: (payload) => {
          runtimeStatusController.applyHealthStatusPayload(payload);
        },
        applySpeechStatusPayload: (payload) => {
          runtimeStatusController.applySpeechStatusPayload(payload);
        },
        applyInputProviderStatusPayload: hostRuntimeComposition.applyVoiceInputProviderStatusPayload,
        markVoiceServiceOffline: (message) => {
          runtimeStatusController.markServiceOffline(message);
        },
        setKnowledgeStatusText: (text) => {
          runtimeStatusController.setKnowledgeStatusText(text);
        },
        getDrillsRequest: (sessionId, targetPreset) => voiceApi.getDrills(sessionId, targetPreset),
        syncPresetRequest: (sessionId, targetPreset) => voiceApi.syncPreset(sessionId, targetPreset),
        listTargetPresetsRequest: (options) => voiceApi.listTargetPresets(options),
        saveReferencePresetRequest: (sessionId, payload) => voiceApi.saveReferencePreset(sessionId, payload),
        saveHandmadePresetRequest: (sessionId, payload) => voiceApi.saveHandmadePreset(sessionId, payload),
        selectTargetPresetRequest: (sessionId, presetId) => voiceApi.selectTargetPreset(sessionId, presetId),
        duplicateTargetPresetRequest: (sessionId, presetId, payload) => voiceApi.duplicateTargetPreset(sessionId, presetId, payload),
        archiveTargetPresetRequest: (sessionId, presetId, expectedUpdatedAt) => voiceApi.archiveTargetPreset(sessionId, presetId, expectedUpdatedAt),
        restoreTargetPresetRequest: (sessionId, presetId, expectedUpdatedAt) => voiceApi.restoreTargetPreset(sessionId, presetId, expectedUpdatedAt),
        deleteTargetPresetRequest: (sessionId, presetId, expectedUpdatedAt) => voiceApi.deleteTargetPreset(sessionId, presetId, expectedUpdatedAt),
        selectDrillRequest: (sessionId, drillId) => voiceApi.selectDrill(sessionId, drillId),
        analyzeReferenceRequest: (file, targetPreset) => voiceApi.analyzeReference(file, targetPreset),
        syncReferenceRequest: (sessionId, referenceClipId, referenceClipName) => (
          voiceApi.syncReference(sessionId, referenceClipId, referenceClipName)
        ),
        projectPhraseForecastRequest: (sessionId, phrase) => voiceApi.projectPhraseForecast(sessionId, phrase),
        refreshCockpitLine: voiceHostActionController.refreshVoiceCockpitLine,
        setDrillState: (state) => {
          store.patchState({
            voiceDrillState: state,
          });
        },
        setDrillStatus: (status) => {
          store.patchState({
            voiceDrillStatus: status,
          });
        },
        setDrillError: (error) => {
          store.patchState({
            voiceDrillError: error,
          });
        },
        setDrillSelectionPendingId: (drillId) => {
          store.patchState({
            voiceDrillSelectionPendingId: drillId,
          });
        },
        setForecastStatus: (status) => {
          store.patchState({
            voiceForecastStatus: status,
          });
        },
        setForecastError: (error) => {
          store.patchState({
            voiceForecastError: error,
          });
        },
        resetVoiceTraces: () => {
          store.patchState({
            voiceLiveTrace: [],
            voiceLastTakeTrace: [],
          });
        },
        clearLastTakeTrace: () => {
          store.patchState({
            voiceLastTakeTrace: [],
          });
        },
        render: hostRuntimeBridge.render,
        addTerminalLine: (type, content) => options.addTerminalLine(type, content),
        startVoiceAudioStream: hostRuntimeBridge.startVoiceAudioStream,
        startVoicePracticeSession: voiceHostActionController.startVoicePracticeSession,
      },
      liveTransition: {
        getSessionContext: () => getSessionContext(options),
        getVoiceUiState: () => store.getUiState(),
        getVoiceDrillState: () => store.getState().voiceDrillState,
        updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
        getTransportState: hostRuntimeBridge.getPracticeTransportState,
        setTransportState: hostRuntimeBridge.setPracticeTransportState,
        getTargetPreset: () => getRequestedTargetPreset(options),
        getReferenceClipId: () => store.getUiState().referenceClipId || null,
        getLiveTrace: () => store.getState().voiceLiveTrace,
        setLiveTrace: (trace) => {
          store.patchState({
            voiceLiveTrace: trace,
          });
        },
        setLastTakeTrace: (trace) => {
          store.patchState({
            voiceLastTakeTrace: trace,
          });
        },
        setSuppressPracticeClick: (value) => {
          store.patchState({
            voiceSuppressPracticeClick: value,
          });
        },
        resetCoachRuntimeUiState: voiceHostActionController.resetVoiceCoachRuntimeUiState,
        stopAudioStream: hostRuntimeBridge.stopVoiceAudioStream,
        startAudioStream: hostRuntimeBridge.startVoiceAudioStream,
        startPracticeSessionRequest: (sessionId, requestOptions) => (
          voiceApi.startPracticeSession(sessionId, requestOptions)
        ),
        submitPracticeTakeRequest: (sessionId, reason, timeline, attemptArtifact) => (
          voiceApi.submitPracticeTake(sessionId, reason, timeline, attemptArtifact)
        ),
        disarmPracticeSessionRequest: (sessionId, reason) => voiceApi.disarmPracticeSession(sessionId, reason),
        refreshVoiceCockpitLine: voiceHostActionController.refreshVoiceCockpitLine,
        handoffPracticeAfterTake: voiceHostActionController.handoffVoicePracticeToCoachAfterTake,
        requestCoachNote: voiceHostActionController.requestVoiceCoachNote,
        onCoachNoteError: (message) => {
          store.patchState({
            voiceCoachTaskStatus: 'error',
            voiceCoachTaskError: message,
          });
          hostRuntimeBridge.render();
        },
        compressVoiceTimeline: hostRuntimeComposition.compressVoiceTimeline,
        addTerminalLine: (type, content) => options.addTerminalLine(type, content),
        render: hostRuntimeBridge.render,
      },
      runtimeShell: {
        runtimeStatusController,
        getCurrentMode: options.getCurrentMode,
        getCurrentSessionId: options.getCurrentSessionId,
        getIsConnected: options.getIsConnected,
        getVoiceUiState: () => store.getUiState(),
        canUseBackendCapture,
        canUseBackendRecordedFallback,
        hasBrowserSpeechRecognitionSupport,
        hasBrowserSpeechSynthesisSupport,
      },
      inputRuntime: {
        getVoiceUiState: () => store.getUiState(),
        updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
        getSessionContext: () => getSessionContext(options),
        planRecoverySafety: (recoveryOptions) => runtimeStatusController.planRecoverySafety(recoveryOptions),
        setRecoverySafetyPending: (pending) => {
          runtimeStatusController.setRecoverySafetyPending(pending);
        },
        submitInputRuntimeEvent: (sessionId, event, eventOptions) => (
          voiceApi.submitInputRuntimeEvent(sessionId, event, eventOptions)
        ),
        applyInputProviderStatusPayload: hostRuntimeComposition.applyVoiceInputProviderStatusPayload,
        updateVoiceCockpitState: voiceHostActionController.updateVoiceCockpitState,
        addTerminalLine: (type, content) => options.addTerminalLine(type, content),
        render: hostRuntimeBridge.render,
      },
      coachTransport: {
        speechController: {
          kernelUrl: options.kernelUrl,
          getSessionContext: () => getSessionContext(options),
          getTurnId: () => store.getState().voiceCoachTurnId,
          getReferenceClipId: () => store.getUiState().referenceClipId || null,
          getTargetPreset: () => store.getUiState().targetPreset || 'cute-feminine',
          getDefaultSpeakingRate: () => (
            store.getState().voiceStudentModelState.learnerContext?.coachPreferences
              ?.some((preference) => preference.id === 'slower-pace')
              ? VOICE_COACH_SLOW_SPEAKING_RATE
              : VOICE_COACH_SPEAKING_RATE
          ),
          setLastSpokenCoachMessageId: (messageId) => {
            store.patchState({
              voiceLastSpokenCoachMessageId: messageId,
            });
          },
          getLastSpokenCoachMessageId: () => store.getState().voiceLastSpokenCoachMessageId,
          setVoxCpmStatus: ({ available, error }) => {
            runtimeStatusController.setVoxCpmStatus({ available, error });
          },
          // Surfacing wave (honesty): stand-in-voice notice when the speech
          // response reports X-Reference-Resolved: false.
          onReferenceResolution: (resolved) => noteVoiceSpeechReferenceResolution(resolved),
          onSelectedVoiceFailure: () => {
            if (typeof document === 'undefined') return;
            const EventConstructor = document.defaultView?.CustomEvent;
            if (!EventConstructor) return;
            document.dispatchEvent(new EventConstructor(VOICE_COACH_SELECTED_VOICE_FAILURE_EVENT));
          },
          onPlaybackError: (message) => {
            options.addTerminalLine('system', message);
          },
          onRender: () => {
            hostRuntimeBridge.render();
          },
        },
        inputController: {
          kernelWsUrl: options.kernelWsUrl,
          getBackendLiveBearerToken: () => options.voiceInputLiveBearerToken ?? null,
          getBackendLiveLeaseId: () => options.getVoiceInputLiveLeaseId?.() ?? null,
          // Graph live-frame tap (2026-08-05): open a SEPARATE trainer analyzer
          // stream during hearing so the mirror-graph learner dot gets per-frame
          // pitch/resonance. Best-effort end-to-end; never throws into coaching.
          createGraphStream: async () => {
            try {
              const sid = getCoachInputSessionContext(options).currentSessionId;
              if (!sid || !options.kernelUrl) return null;
              const res = await fetch(`${options.kernelUrl}/voice/graph/session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sessionId: sid }),
              });
              const data = await res.json();
              const graphId = data?.graphVoiceSessionId;
              if (!graphId || !options.voiceTrainerUrl) return null;
              const u = new URL(options.voiceTrainerUrl);
              const proto = u.protocol === 'https:' ? 'wss' : 'ws';
              const token = options.voiceTrainerToken
                ? `?token=${encodeURIComponent(options.voiceTrainerToken)}`
                : '';
              return `${proto}://${u.host}${u.pathname.replace(/\/$/, '')}/api/v1/voice/sessions/${encodeURIComponent(graphId)}/stream${token}`;
            } catch {
              return null;
            }
          },
          setVoiceLiveFrame: (frame: unknown) => {
            try { store.patchState({ voiceLiveFrame: frame as any }); } catch { /* best-effort */ }
          },
          getSessionContext: () => getCoachInputSessionContext(options),
          getState: () => store.getSpeechRecognitionState(),
          setState: (updater) => {
            store.setSpeechRecognitionState(updater);
          },
          setQuestionDraft: (value) => {
            const questionInput = options.getVoiceCoachQuestionInput();
            if (questionInput) {
              questionInput.value = value;
            }
          },
          clearQuestionFeedback: () => {
            store.patchState({
              voiceCoachQuestionStatus: 'idle',
              voiceCoachQuestionError: null,
              voicePendingCoachChannel: null,
            });
          },
          reportQuestionFeedbackError: (message) => {
            store.patchState({
              voiceCoachQuestionStatus: 'error',
              voiceCoachQuestionError: message,
              voicePendingCoachChannel: null,
            });
          },
          getSelectedInputDeviceId: () => store.getState().voiceSelectedInputDeviceId,
          updateResolvedInput: (label, deviceId) => {
            store.updateState((current) => ({
              ...current,
              voiceResolvedInputLabel: label || current.voiceResolvedInputLabel,
              voiceResolvedInputDeviceId: deviceId || current.voiceResolvedInputDeviceId,
            }));
          },
          canUseBackendRecordedFallback: () => options.getRuntimeShell()?.canUseBackendRecordedFallback() ?? false,
          canUseBackendLiveCapture: () => Boolean(
            options.getRuntimeShell()?.getEffectiveInputCapabilities()?.liveCapture,
          ),
          getSilenceThreshold: hostRuntimeComposition.getVoiceCoachInputSilenceThreshold,
          getBackendLiveVadConfig,
          getAudioPreferWorklet: () => store.getUiState().advancedPanel.audioPreferWorklet,
          releasePracticeForListening: options.releasePracticeForCoachListening
            ?? (() => voiceAppRuntime.releaseVoicePracticeForCoachListening()),
          render: hostRuntimeBridge.render,
          submitInputTurn: (sessionId, input) => voiceApi.submitInputTurn(sessionId, input),
          handleCapturedQuestion: voiceHostActionController.submitVoiceCoachQuestion,
          applyInputProviderStatusPayload: hostRuntimeComposition.applyVoiceInputProviderStatusPayload,
          appendCoachLine: (text) => options.appendCoachLine?.(text),
          speakCoachLine: (text) => options.speakCoachLine?.(text) ?? false,
        },
        runtimeBootstrap: {
          runtimeService: {
            getCurrentMode: options.getCurrentMode,
            canPlaySpeechWithProvider: (effectiveSpeechProvider) => resolveCanPlayVoiceCoachMessage({
              currentMode: options.getCurrentMode(),
              speechEnabled: Boolean(store.getUiState().coachVoice?.speechEnabled),
              speechProviderAvailable: Boolean(effectiveSpeechProvider),
            }),
            addTerminalLine: (type, content) => options.addTerminalLine(type, content),
            render: hostRuntimeBridge.render,
          },
          runtimeCoordinator: {
            getInteractionSnapshot: voiceAppRuntime.getVoiceInteractionSnapshot,
            getContinuousEnabled: () => Boolean(store.getUiState().coachVoice?.continuousEnabled),
            getSpeechRecognitionStatus: () => store.getState().voiceSpeechRecognition.status,
            getQuestionDraft: () => options.getVoiceCoachQuestionInput()?.value || '',
            getLatestCoachMessage: voiceAppRuntime.getLatestCoachMessage,
            getLastSpokenCoachMessageId: () => store.getState().voiceLastSpokenCoachMessageId,
            onPostPlaybackHandoff: (detail) => {
              // Privacy-safe device witness: state flags only. Never include
              // transcript, tutor text, session identity, memory, or audio.
              const diagnosticsWindow = window as Window & {
                __tvCoachLastHandoff?: typeof detail;
              };
              diagnosticsWindow.__tvCoachLastHandoff = detail;
              console.info(
                `[voice-loop] post-playback action=${detail.action}`
                + ` listeningStarted=${String(detail.listeningStarted)}`
                + ` owner=${detail.owner}`
                + ` recognition=${detail.recognitionStatus}`,
              );
            },
            armPracticeSessionWithNotice: voiceHostActionController.armVoicePracticeSessionWithNotice,
            disarmPracticeSession: async (reason) => {
              await voiceHostActionController.disarmVoicePracticeSession(reason);
            },
            onPracticeArmError: (message) => {
              options.addTerminalLine('system', `Tutor practice handoff failed: ${message}`);
              hostRuntimeBridge.render();
            },
            render: hostRuntimeBridge.render,
            getPostPlaybackContext: () => {
              const voiceState = store.getState();
              return {
                currentMode: options.getCurrentMode(),
                currentSessionId: options.getCurrentSessionId(),
                isConnected: options.getIsConnected(),
                hasActiveGuideSession: voiceAppRuntime.hasActiveDeepTutorGuideSession(),
                voiceSessionArmed: voiceState.voiceSessionArmed,
                voiceTakeActive: voiceState.voiceTakeActive,
                voiceTakeProcessing: voiceState.voiceTakeProcessing,
                voiceTransportStatus: voiceState.voiceTransportStatus,
                voiceDeepTutorLessonStatus: voiceState.voiceDeepTutorLessonStatus,
                voiceCoachTaskStatus: voiceState.voiceCoachTaskStatus,
                voiceCoachQuestionStatus: voiceState.voiceCoachQuestionStatus,
                referenceMimicAction: voiceAppRuntime.getVoiceReferenceMimicState().action,
              };
            },
          },
        },
      },
      coachControllers: {
        requestController: {
          setQuestionStatus: (status) => {
            store.patchState({
              voiceCoachQuestionStatus: status,
              ...(status === 'sending' ? { voiceCoachTurnId: null } : {}),
            });
          },
          setQuestionError: (error) => {
            store.patchState({
              voiceCoachQuestionError: error,
            });
          },
          setPendingChannel: (channel) => {
            store.patchState({
              voicePendingCoachChannel: channel,
            });
          },
          clearPendingState: voiceHostActionController.clearVoiceCoachPendingState,
          applyVoiceBackendPayload: (payload) => {
            if (hasVoiceBackendPayload(payload)) {
              const turnId = typeof payload.turnId === 'string' ? payload.turnId.trim() : '';
              if (turnId) {
                store.patchState({ voiceCoachTurnId: turnId });
              }
              options.getSessionStateController()!.applyBackendPayload(payload);
              // Honesty tee: raw payload to the honesty surface (fallbackReply
              // is dropped by the slice contract) — see coach-honesty.ts.
              emitBackendPayloadTee(payload);
            }
          },
          render: hostRuntimeBridge.render,
          clearQuestionInput: () => {
            const questionInput = options.getVoiceCoachQuestionInput();
            if (questionInput) {
              questionInput.value = '';
            }
          },
          setLastSpokenCoachMessageId: (messageId) => {
            store.patchState({
              voiceLastSpokenCoachMessageId: messageId,
            });
          },
        },
        // 2026-07-27 (owner's law): the clarificationExecutor lane is GONE —
        // all learner speech goes to the tutor, and the tutor decides. The only
        // client-consumed spoken input left is the scope/device lane in
        // host-runtime-composition.ts, which answers out loud.
        noteController: {
          getSessionContext: () => getSessionContext(options),
          hasLastSummary: () => Boolean(store.getUiState().lastSummary),
          hasActiveGuideSession: voiceAppRuntime.hasActiveDeepTutorGuideSession,
          requestDeepTutorCoach: (sessionId) => voiceApi.requestDeepTutorCoach(sessionId),
          startCoachTask: (sessionId) => voiceApi.startCoachTask(sessionId),
          getTaskStatus: (taskId) => voiceApi.getTaskStatus(taskId),
          updateLastCoachResult: (message, generatedAt) => {
            hostRuntimeBridge.updateVoiceUiState((currentState) => ({
              ...currentState,
              lastCoachMessage: message,
              lastCoachGeneratedAt: generatedAt,
            }));
          },
          setTaskId: (taskId) => {
            store.patchState({
              voiceCoachTaskId: taskId,
            });
          },
          setTaskStatus: (status) => {
            store.patchState({
              voiceCoachTaskStatus: status,
            });
          },
          setTaskError: (error) => {
            store.patchState({
              voiceCoachTaskError: error,
            });
          },
          setPendingChannel: (channel) => {
            store.patchState({
              voicePendingCoachChannel: channel,
            });
          },
          clearPendingState: voiceHostActionController.clearVoiceCoachPendingState,
          render: hostRuntimeBridge.render,
        },
        deepTutorSessionController: {
          getSessionContext: () => getSessionContext(options),
          hasActiveGuideSession: voiceAppRuntime.hasActiveDeepTutorGuideSession,
          shouldRebuildLesson: voiceAppRuntime.shouldRebuildDeepTutorVoiceLesson,
          startLessonRequest: (sessionId, rebuildPlan) => voiceApi.startDeepTutorVoiceLesson(sessionId, rebuildPlan),
          advanceLessonRequest: (sessionId) => voiceApi.advanceDeepTutorVoiceLesson(sessionId),
          setLessonStatus: (status) => {
            store.patchState({
              voiceDeepTutorLessonStatus: status,
            });
          },
          setLessonError: (error) => {
            store.patchState({
              voiceDeepTutorLessonError: error,
            });
          },
          disarmPracticeSession: async (reason) => {
            await voiceHostActionController.disarmVoicePracticeSession(reason);
          },
          addTerminalLine: (type, content) => options.addTerminalLine(type, content),
          render: hostRuntimeBridge.render,
        },
        cockpitController: {
          getSessionContext: () => getSessionContext(options),
          getVoiceUiState: () => store.getUiState(),
          updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
          persistCockpitStateRequest: (sessionId, patch, currentState) => (
            voiceApi.updateCockpitState(sessionId, patch, currentState)
          ),
          persistConditioningStateRequest: (sessionId, nextConditioning) => (
            voiceApi.updateConditioningState(sessionId, nextConditioning)
          ),
          refreshCockpitLineRequest: (sessionId, action) => voiceApi.refreshCockpitLine(sessionId, action),
          assertPracticeTargetUnlocked: voiceAppRuntime.assertVoicePracticeTargetUnlocked,
          stopCoachListening: hostRuntimeComposition.stopVoiceCoachListening,
          stopCoachSpeech: hostRuntimeComposition.stopVoiceCoachSpeech,
          ensureContinuousLoop: voiceHostActionController.ensureVoiceCoachContinuousLoop,
          setLastSpokenCoachMessageId: (messageId) => {
            store.patchState({
              voiceLastSpokenCoachMessageId: messageId,
            });
          },
          addTerminalLine: (type, content) => options.addTerminalLine(type, content),
          render: hostRuntimeBridge.render,
          getNextInputProvider: getNextVoiceCoachInputProvider,
        },
      },
      bootstrap: {
        getCurrentMode: options.getCurrentMode,
        refreshHealthSoon: () => {
          options.getWorkflowController()?.refreshHealthSoon();
        },
        refreshKnowledgeStatusSoon: () => {
          options.getWorkflowController()?.refreshKnowledgeStatusSoon();
        },
        getVoiceUiState: () => store.getUiState(),
        updateVoiceUiState: hostRuntimeBridge.updateVoiceUiState,
        getForecastStatus: () => store.getState().voiceForecastStatus,
        setForecastStatus: (status) => {
          store.patchState({
            voiceForecastStatus: status,
          });
        },
        setForecastError: (error) => {
          store.patchState({
            voiceForecastError: error,
          });
        },
        getTakeState: () => {
          const voiceState = store.getState();
          return {
            sessionArmed: voiceState.voiceSessionArmed,
            takeActive: voiceState.voiceTakeActive,
            takeProcessing: voiceState.voiceTakeProcessing,
            suppressPracticeClick: voiceState.voiceSuppressPracticeClick,
          };
        },
        setSuppressPracticeClick: (value) => {
          store.patchState({
            voiceSuppressPracticeClick: value,
          });
        },
        setSelectedInputDeviceId: (deviceId) => {
          store.patchState({
            voiceSelectedInputDeviceId: deviceId,
          });
        },
        writeVoiceInputDevicePreference: hostRuntimeComposition.writeVoiceInputDevicePreference,
        getSelectedVoiceAudioInput: hostRuntimeComposition.getSelectedVoiceAudioInput,
        setVoiceAudioInputNotice: (notice) => {
          store.patchState({
            voiceAudioInputNotice: notice,
          });
        },
        render: hostRuntimeBridge.render,
        addTerminalLine: (type, content) => options.addTerminalLine(type, content),
        toggleVoiceOverlay: hostRuntimeBridge.toggleVoiceOverlay,
        updateVoiceConditioningState: voiceHostActionController.updateVoiceConditioningState,
        updateVoiceAdvancedPanel: async (patch) => {
          await voiceHostActionController.updateVoiceCockpitState({
            advancedPanel: patch,
          });
        },
        prepareVoiceConditioningLatents: voiceHostActionController.prepareVoiceConditioningLatents,
        toggleVoiceCoachInputProvider: hostRuntimeComposition.toggleVoiceCoachInputProvider,
        updateVoiceCustomPresetDraft: (patch) => {
          options.getWorkflowController()?.updateCustomPresetDraft(patch);
        },
        saveReferencePreset: () => options.getWorkflowController()!.saveReferencePreset(),
        removeVoiceReference: () => options.getWorkflowController()!.removeReference(),
        seedCustomPresetDraft: () => options.getWorkflowController()?.seedCustomPresetDraft(),
        saveHandmadePreset: () => options.getWorkflowController()!.saveHandmadePreset(),
        editCustomPresetDraft: (presetId) => {
          options.getWorkflowController()?.editCustomPresetDraft(presetId);
        },
        selectCustomPreset: (presetId) => options.getWorkflowController()!.selectCustomPreset(presetId),
        duplicateCustomPreset: (presetId) => options.getWorkflowController()!.duplicateCustomPreset(presetId),
        archiveCustomPreset: (presetId) => options.getWorkflowController()!.archiveCustomPreset(presetId),
        restoreCustomPreset: (presetId) => options.getWorkflowController()!.restoreCustomPreset(presetId),
        deleteCustomPreset: (presetId) => options.getWorkflowController()!.deleteCustomPreset(presetId),
        hasActiveDeepTutorGuideSession: voiceAppRuntime.hasActiveDeepTutorGuideSession,
        refreshCockpitLine: voiceHostActionController.refreshVoiceCockpitLine,
        resumeDeepTutorVoiceLoop: voiceHostActionController.resumeDeepTutorVoiceLoop,
        advanceDeepTutorVoiceLesson: voiceHostActionController.advanceDeepTutorVoiceLesson,
        disarmVoicePracticeSession: voiceHostActionController.disarmVoicePracticeSession,
        startVoicePracticeSession: voiceHostActionController.startVoicePracticeSession,
        beginVoicePracticeTake: voiceHostActionController.beginVoicePracticeTake,
        endVoicePracticeSession: voiceHostActionController.endVoicePracticeSession,
        submitVoiceCoachQuestion: voiceHostActionController.submitVoiceCoachQuestion,
        toggleVoiceCoachContinuousMode: hostRuntimeComposition.toggleVoiceCoachContinuousMode,
        toggleVoiceCoachListening: hostRuntimeComposition.toggleVoiceCoachListening,
        toggleVoiceCoachSpeechProvider: hostRuntimeComposition.toggleVoiceCoachSpeechProvider,
        refreshVoiceAudioInputDevices: hostRuntimeComposition.refreshVoiceAudioInputDevices,
        alertUser: (message) => alert(message),
      },
    },
    renderController: {
      store,
      getCurrentMode: options.getCurrentMode,
      getCurrentSessionId: options.getCurrentSessionId,
      getIsConnected: options.getIsConnected,
      getRuntimeStatusState: () => runtimeStatusController.getState(),
      getReferencePlayerState: () => ({
        paused: options.getVoiceReferencePlayer()?.paused ?? true,
        currentTimeMs: Math.round((options.getVoiceReferencePlayer()?.currentTime || 0) * 1000),
      }),
      getConditioningDraftState: () => ({
        promptFileSelected: Boolean(options.getVoiceConditioningPromptFileInput()?.files?.[0]),
        promptTextPresent: Boolean(options.getVoiceConditioningPromptTextInput()?.value.trim()),
        referenceFileSelected: Boolean(options.getVoiceConditioningReferenceFileInput()?.files?.[0]),
      }),
      getDomBindings: options.getDomBindings,
      selectDrill: (drillId) => options.getWorkflowController()!.selectDrill(drillId),
      addTerminalLine: options.addTerminalLine,
      finalizeRender: (mode, coachShell) => {
        const result = coachShell?.finalizeRender(mode);
        syncVoiceAdvancedPanelVadControls();
        return result;
      },
    },
    sessionModeRuntime: {
      render: hostRuntimeBridge.render,
    },
  };
}
