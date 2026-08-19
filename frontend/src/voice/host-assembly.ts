import type { VoiceAppRuntime } from './app-runtime';
import type { VoiceCockpitLineAction } from './api';
import type { VoiceBootstrapController } from './bootstrap-controller';
import { createVoiceHostOrchestration } from './host-orchestration';
import type { VoiceHostOrchestration } from './host-orchestration';
import {
  createVoiceHostOrchestrationConfig,
  type VoiceHostOrchestrationConfigOptions,
} from './host-orchestration-config';
import { createVoiceHostRuntimeBridge } from './host-runtime-bridge';
import type { VoiceHostRuntimeBridge } from './host-runtime-bridge';
import {
  createVoiceHostRuntimeComposition,
  type VoiceHostRuntimeComposition,
  type VoiceHostRuntimeCompositionOptions,
} from './host-runtime-composition';
import { hasVoiceBackendPayload } from './state';

type VoiceHostAssemblyCompositionOptions = Omit<
  VoiceHostRuntimeCompositionOptions,
  | 'store'
  | 'runtimeStatusController'
  | 'render'
  | 'applyVoiceBackendPayload'
  | 'getCoachShell'
  | 'getRuntimeShell'
  | 'getLiveTransitionController'
  | 'syncPersistedReferenceAnalysis'
>;

type VoiceHostAssemblyOrchestrationOptions = Omit<
  VoiceHostOrchestrationConfigOptions,
  | 'hostRuntimeComposition'
  | 'hostRuntimeBridge'
  | 'runtimeStatusController'
  | 'store'
  | 'getSessionStateController'
  | 'getWorkflowController'
  | 'getRuntimeShell'
>;

type VoiceHostActionController = VoiceHostRuntimeComposition['voiceHostActionController'];
type VoiceHostWorkflowController = VoiceHostOrchestration['workflowController'];
type VoiceHostSessionModeRuntime = VoiceHostOrchestration['sessionModeRuntime'];
type VoiceHostBootstrapRegistration = Parameters<VoiceBootstrapController['registerListeners']>[0];

export type VoiceHostAssemblyOptions = {
  store: VoiceHostRuntimeCompositionOptions['store'];
  runtimeStatusController: VoiceHostOrchestrationConfigOptions['runtimeStatusController'];
  composition: VoiceHostAssemblyCompositionOptions;
  orchestration: VoiceHostAssemblyOrchestrationOptions;
  /**
   * Wave B lesson surface: an optional side-channel that receives EVERY raw
   * backend payload before the VoiceUiState slice drops the lesson-only fields
   * (`activeCard`, `replayDirective`, `cardOpsApplied`). No-op when absent, so
   * existing callers are unaffected.
   */
  onBackendPayload?: (payload: unknown) => void;
};

export type VoiceHostAssemblyFactories = {
  createVoiceHostRuntimeBridge?: typeof createVoiceHostRuntimeBridge;
  createVoiceHostRuntimeComposition?: typeof createVoiceHostRuntimeComposition;
  createVoiceHostOrchestrationConfig?: typeof createVoiceHostOrchestrationConfig;
  createVoiceHostOrchestration?: typeof createVoiceHostOrchestration;
};

export type VoiceHostAssembly = ReturnType<typeof createVoiceHostAssembly>;

export function createVoiceHostAssembly(
  factories: VoiceHostAssemblyFactories = {},
) {
  const createVoiceHostRuntimeBridgeImpl = (
    factories.createVoiceHostRuntimeBridge || createVoiceHostRuntimeBridge
  );
  const createVoiceHostRuntimeCompositionImpl = (
    factories.createVoiceHostRuntimeComposition || createVoiceHostRuntimeComposition
  );
  const createVoiceHostOrchestrationConfigImpl = (
    factories.createVoiceHostOrchestrationConfig || createVoiceHostOrchestrationConfig
  );
  const createVoiceHostOrchestrationImpl = (
    factories.createVoiceHostOrchestration || createVoiceHostOrchestration
  );

  let voiceHostRuntimeBridge!: VoiceHostRuntimeBridge;
  let voiceHostActionController!: VoiceHostActionController;
  let voiceAppRuntime!: VoiceAppRuntime;
  let hasVoiceModeActivity: VoiceHostRuntimeComposition['hasVoiceModeActivity'] = () => false;
  let getVoiceSummaryText: VoiceHostRuntimeComposition['getVoiceSummaryText'] = () => '';
  let readVoiceInputDevicePreference: VoiceHostRuntimeComposition['readVoiceInputDevicePreference'] = () => null;
  let refreshVoiceAudioInputDevices: VoiceHostRuntimeComposition['refreshVoiceAudioInputDevices'] = async () => [];
  let stopVoiceCoachSpeech: VoiceHostRuntimeComposition['stopVoiceCoachSpeech'] = () => undefined;
  let stopVoiceCoachListening: VoiceHostRuntimeComposition['stopVoiceCoachListening'] = () => undefined;
  let startVoiceCoachListening: VoiceHostRuntimeComposition['startVoiceCoachListening'] = async () => false;
  // Surfacing wave: the hear-this-line button speaks through the SAME coach
  // speech path (provider gating + referenceClipId threading included).
  let speakVoiceCoachMessage: VoiceHostRuntimeComposition['speakVoiceCoachMessage'] = () => false;

  let voiceSessionStateController: VoiceHostOrchestration['sessionStateController'] | null = null;
  let voiceWorkflowController: VoiceHostWorkflowController | null = null;
  let voiceRuntimeShell: VoiceHostOrchestration['runtimeShell'] | null = null;
  let voiceCoachShell: VoiceHostOrchestration['coachShell'] | null = null;
  let voiceReferenceRuntime: VoiceHostOrchestration['referenceRuntimeController'] | null = null;
  let voiceReferencePlaybackController: VoiceHostOrchestration['referencePlaybackController'] | null = null;
  let voiceLiveTransitionController: VoiceHostOrchestration['liveTransitionController'] | null = null;
  let voiceBootstrapController: VoiceHostOrchestration['bootstrapController'] | null = null;
  let voiceSessionModeRuntime: VoiceHostSessionModeRuntime | null = null;

  function assemble(options: VoiceHostAssemblyOptions): void {
    let writeVoiceInputDevicePreference: VoiceHostRuntimeComposition['writeVoiceInputDevicePreference'] = () => undefined;

    voiceHostRuntimeBridge = createVoiceHostRuntimeBridgeImpl({
      store: options.store,
      getAppRuntime: () => voiceAppRuntime,
      getAudioRuntime: () => ({
        readInputDevicePreference: readVoiceInputDevicePreference,
        writeInputDevicePreference: writeVoiceInputDevicePreference,
        refreshAudioInputDevices: refreshVoiceAudioInputDevices,
      }),
    });

    const voiceHostRuntimeComposition = createVoiceHostRuntimeCompositionImpl({
      ...options.composition,
      store: options.store,
      runtimeStatusController: options.runtimeStatusController,
      render: voiceHostRuntimeBridge.render,
      applyVoiceBackendPayload: (payload) => {
        // Wave B: tee the raw payload to the lesson surface BEFORE the slice
        // contract drops activeCard/replayDirective/cardOpsApplied.
        try {
          options.onBackendPayload?.(payload);
        } catch {
          /* the lesson side-channel must never break the core apply path */
        }
        if (hasVoiceBackendPayload(payload)) {
          voiceSessionStateController?.applyBackendPayload(payload);
        }
      },
      getCoachShell: () => voiceCoachShell,
      getRuntimeShell: () => voiceRuntimeShell,
      getLiveTransitionController: () => voiceLiveTransitionController,
      getPracticeAudioRingBuffer: () => voiceHostRuntimeBridge.getPracticeAudioRingBuffer(),
      syncPersistedReferenceAnalysis: (referenceClipId) => (
        voiceReferenceRuntime?.syncPersistedReferenceAnalysis(referenceClipId) || null
      ),
    });

    voiceHostActionController = voiceHostRuntimeComposition.voiceHostActionController;
    voiceAppRuntime = voiceHostRuntimeComposition.voiceAppRuntime;
    hasVoiceModeActivity = voiceHostRuntimeComposition.hasVoiceModeActivity;
    getVoiceSummaryText = voiceHostRuntimeComposition.getVoiceSummaryText;
    readVoiceInputDevicePreference = voiceHostRuntimeComposition.readVoiceInputDevicePreference;
    writeVoiceInputDevicePreference = voiceHostRuntimeComposition.writeVoiceInputDevicePreference;
    refreshVoiceAudioInputDevices = voiceHostRuntimeComposition.refreshVoiceAudioInputDevices;
    stopVoiceCoachSpeech = voiceHostRuntimeComposition.stopVoiceCoachSpeech;
    stopVoiceCoachListening = voiceHostRuntimeComposition.stopVoiceCoachListening;
    startVoiceCoachListening = voiceHostRuntimeComposition.startVoiceCoachListening;
    speakVoiceCoachMessage = voiceHostRuntimeComposition.speakVoiceCoachMessage;

    const voiceHostOrchestration = createVoiceHostOrchestrationImpl(
      createVoiceHostOrchestrationConfigImpl({
        ...options.orchestration,
        hostRuntimeComposition: voiceHostRuntimeComposition,
        hostRuntimeBridge: voiceHostRuntimeBridge,
        runtimeStatusController: options.runtimeStatusController,
        store: options.store,
        getSessionStateController: () => voiceSessionStateController,
        getWorkflowController: () => voiceWorkflowController,
        getRuntimeShell: () => voiceRuntimeShell,
      }),
    );

    voiceHostRuntimeBridge.bind({
      practiceTransport: voiceHostOrchestration.practiceTransport,
      renderController: voiceHostOrchestration.renderController,
    });

    voiceSessionStateController = voiceHostOrchestration.sessionStateController;
    voiceWorkflowController = voiceHostOrchestration.workflowController;
    voiceRuntimeShell = voiceHostOrchestration.runtimeShell;
    voiceCoachShell = voiceHostOrchestration.coachShell;
    voiceReferenceRuntime = voiceHostOrchestration.referenceRuntimeController;
    voiceReferencePlaybackController = voiceHostOrchestration.referencePlaybackController;
    voiceLiveTransitionController = voiceHostOrchestration.liveTransitionController;
    voiceBootstrapController = voiceHostOrchestration.bootstrapController;
    voiceSessionModeRuntime = voiceHostOrchestration.sessionModeRuntime;
  }

  function render(): void {
    voiceHostRuntimeBridge.render();
  }

  function getAppRuntime(): VoiceAppRuntime {
    return voiceAppRuntime;
  }

  return {
    assemble,
    render,
    observeRender: (observer: () => void) => voiceHostRuntimeBridge.observeRender(observer),
    getAppRuntime,
    runtime: {
      hasModeActivity: () => hasVoiceModeActivity(),
      getSummaryText: () => getVoiceSummaryText(),
      stopCoachSpeech: () => stopVoiceCoachSpeech(),
      stopCoachListening: (resetTranscript = false) => stopVoiceCoachListening(resetTranscript),
      startCoachListening: () => startVoiceCoachListening(),
      setCoachContinuousMode: (
        enabled: boolean,
        persistence?: 'persist' | 'local-only',
      ) => (
        persistence === undefined
          ? voiceCoachShell?.setContinuousMode(enabled) ?? Promise.resolve(false)
          : voiceCoachShell?.setContinuousMode(enabled, persistence) ?? Promise.resolve(false)
      ),
      speakCoachMessage: (
        ...args: Parameters<VoiceHostRuntimeComposition['speakVoiceCoachMessage']>
      ) => speakVoiceCoachMessage(...args),
      refreshAudioInputDevices: (silent?: boolean) => refreshVoiceAudioInputDevices(silent),
      hydrateStoredInputDevicePreference: () => {
        voiceAppRuntime.hydrateStoredInputDevicePreference(readVoiceInputDevicePreference);
      },
    },
    workflow: {
      ensureHealthPoller: () => voiceWorkflowController!.ensureHealthPoller(),
      bootstrapVoiceModeSession: (autoStart?: boolean, sessionAlreadySynced?: boolean) => (
        voiceWorkflowController!.bootstrapVoiceModeSession(autoStart, sessionAlreadySynced)
      ),
      refreshHealth: () => voiceWorkflowController!.refreshHealth(),
      refreshDrills: (silent?: boolean) => voiceWorkflowController!.refreshDrills(silent),
      analyzeReference: (file: File) => voiceWorkflowController!.analyzeReference(file),
    },
    sessionState: {
      syncFromBackend: (silenceCoach?: boolean) => (
        voiceSessionStateController!.syncSessionStateFromBackend(silenceCoach)
      ),
    },
    actions: {
      disarmVoicePracticeSession: (
        reason?: Parameters<VoiceHostActionController['disarmVoicePracticeSession']>[0],
      ) => voiceHostActionController.disarmVoicePracticeSession(reason),
      // 2026-07-27 (owner's law): coach mode is SPOKEN — surfaces that used to
      // stage a question in the typed input and click send now submit straight
      // through the controller, the same lane the tap pills use.
      submitVoiceCoachQuestion: (
        ...args: Parameters<VoiceHostActionController['submitVoiceCoachQuestion']>
      ) => voiceHostActionController.submitVoiceCoachQuestion(...args),
      resetVoiceCoachRuntimeUiState: (
        ...args: Parameters<VoiceHostActionController['resetVoiceCoachRuntimeUiState']>
      ) => voiceHostActionController.resetVoiceCoachRuntimeUiState(...args),
      refreshVoiceCockpitLine: (
        action: VoiceCockpitLineAction,
      ) => voiceHostActionController.refreshVoiceCockpitLine(action),
      prepareForLiveSessionTransition: (
        ...args: Parameters<VoiceHostActionController['prepareForLiveSessionTransition']>
      ) => voiceHostActionController.prepareForLiveSessionTransition(...args),
    },
    sessionMode: {
      applyStartedSession: (
        ...args: Parameters<VoiceHostSessionModeRuntime['applyStartedSession']>
      ) => voiceSessionModeRuntime!.applyStartedSession(...args),
      applyDirectFallbackSession: (
        ...args: Parameters<VoiceHostSessionModeRuntime['applyDirectFallbackSession']>
      ) => voiceSessionModeRuntime!.applyDirectFallbackSession(...args),
      applyRestoredSession: (
        ...args: Parameters<VoiceHostSessionModeRuntime['applyRestoredSession']>
      ) => voiceSessionModeRuntime!.applyRestoredSession(...args),
    },
    lifecycle: {
      handleVisibilityVisible: () => voiceBootstrapController!.handleVisibilityVisible(),
      registerListeners: (registration: VoiceHostBootstrapRegistration) => (
        voiceBootstrapController!.registerListeners(registration)
      ),
    },
    reference: {
      pausePlayback: () => voiceReferencePlaybackController!.pause(),
    },
  };
}
