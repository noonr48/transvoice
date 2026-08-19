import { createVoiceBootstrapController, type VoiceBootstrapController } from './bootstrap-controller';
import { emitBackendPayloadTee } from './coach-honesty';
import { createVoiceCoachControllerBootstrap, type VoiceCoachControllerBootstrap } from './coach-controller-bootstrap';
import { createVoiceCoachShellBootstrap, type VoiceCoachShellBootstrap } from './coach-shell-bootstrap';
import { createVoiceCoachTransportBootstrap, type VoiceCoachTransportBootstrap } from './coach-transport-bootstrap';
import { createVoiceInputRuntimeController, type VoiceInputRuntimeController } from './input-runtime-controller';
import { createVoiceLiveTransitionController } from './live-transition';
import { createVoicePracticeTransportController } from './practice-transport';
import { createVoiceReferencePlaybackController } from './reference-playback';
import { createVoiceReferenceRuntimeController } from './reference-runtime';
import { createVoiceRuntimeShell, type VoiceRuntimeShell } from './runtime-shell';
import { createVoiceSessionStateController, type VoiceSessionStateController } from './session-state-controller';
import { hasVoiceBackendPayload, type VoiceBackendPayload } from './state';
import { createVoiceWorkflowController, type VoiceWorkflowController } from './workflow-controller';

type VoiceCoachTransportGraphOptions = {
  speechController: Omit<
    Parameters<typeof createVoiceCoachTransportBootstrap>[0]['speechController'],
    'getRequestedProvider'
  >;
  inputController: Omit<
    Parameters<typeof createVoiceCoachTransportBootstrap>[0]['inputController'],
    'getRequestedInputProvider'
    | 'getEffectiveInputProvider'
    | 'getRuntimeState'
    | 'syncRuntimeEvent'
    | 'applyVoiceBackendPayload'
  >;
  runtimeBootstrap: {
    runtimeService: Omit<
      Parameters<typeof createVoiceCoachTransportBootstrap>[0]['runtimeBootstrap']['runtimeService'],
      'canPlaySpeech' | 'getSpeechProvider'
    > & {
      canPlaySpeechWithProvider: (
        effectiveSpeechProvider: ReturnType<VoiceRuntimeShell['getEffectiveSpeechProvider']>,
      ) => boolean;
    };
    runtimeCoordinator: Omit<
      Parameters<typeof createVoiceCoachTransportBootstrap>[0]['runtimeBootstrap']['runtimeCoordinator'],
      'hasInputProvider' | 'supportsAutomaticTurnBoundary' | 'getRecoveryState'
    >;
  };
};

type VoiceCoachControllersGraphOptions = {
  requestController: Parameters<typeof createVoiceCoachControllerBootstrap>[0]['requestController'];
  noteController: Omit<
    Parameters<typeof createVoiceCoachControllerBootstrap>[0]['noteController'],
    'applyVoiceBackendPayload' | 'syncVoiceSessionStateFromBackend'
  >;
  deepTutorSessionController: Omit<
    Parameters<typeof createVoiceCoachControllerBootstrap>[0]['deepTutorSessionController'],
    'applyVoiceBackendPayload' | 'runCoachResumeHandoff'
  >;
  cockpitController: Omit<
    Parameters<typeof createVoiceCoachControllerBootstrap>[0]['cockpitController'],
    | 'applyVoiceBackendPayload'
    | 'getRequestedSpeechProvider'
    | 'getRequestedInputProvider'
    | 'getEffectiveInputProvider'
    | 'getEffectiveInputCapabilities'
    | 'supportsAutomaticTurnBoundary'
    | 'hasBrowserSpeechRecognitionSupport'
    | 'buildInputRuntimeRecoveryReset'
    | 'getInputRecoveryState'
  >;
};

export type VoiceControllerGraphOptions = {
  onCoachTurnId?: (turnId: string) => void;
  practiceTransport: Omit<
    Parameters<typeof createVoicePracticeTransportController>[0],
    'applyVoiceBackendPayload'
  >;
  referencePlayback: Parameters<typeof createVoiceReferencePlaybackController>[0];
  referenceRuntime: Omit<
    Parameters<typeof createVoiceReferenceRuntimeController>[0],
    'pausePlayback'
  >;
  sessionState: Omit<
    Parameters<typeof createVoiceSessionStateController>[0],
    'syncPersistedReferenceAnalysis' | 'refreshVoiceDrills' | 'enforceRecoverySafety'
  >;
  workflow: Omit<
    Parameters<typeof createVoiceWorkflowController>[0],
    'applyVoiceBackendPayload' | 'syncSessionStateFromBackend' | 'adoptResolvedReferenceAnalysis'
  >;
  liveTransition: Omit<
    Parameters<typeof createVoiceLiveTransitionController>[0],
    'pauseReferencePlayback' | 'applyVoiceBackendPayload' | 'refreshVoiceDrills'
  >;
  runtimeShell: Parameters<typeof createVoiceRuntimeShell>[0];
  inputRuntime: Omit<
    Parameters<typeof createVoiceInputRuntimeController>[0],
    'getRequestedInputProvider' | 'getEffectiveInputProvider' | 'getInputRecoveryState' | 'applyVoiceBackendPayload'
  >;
  coachTransport: VoiceCoachTransportGraphOptions;
  coachControllers: VoiceCoachControllersGraphOptions;
  bootstrap: Omit<
    Parameters<typeof createVoiceBootstrapController>[0],
    'syncPreset'
    | 'toggleAdvancedPanel'
    | 'analyzeReference'
    | 'projectPhraseForecast'
    | 'toggleVoiceCoachSpeech'
    | 'handleReferencePlaybackEvent'
  >;
};

type VoiceControllerGraphFactories = {
  createVoicePracticeTransportController?: typeof createVoicePracticeTransportController;
  createVoiceReferencePlaybackController?: typeof createVoiceReferencePlaybackController;
  createVoiceReferenceRuntimeController?: typeof createVoiceReferenceRuntimeController;
  createVoiceSessionStateController?: typeof createVoiceSessionStateController;
  createVoiceWorkflowController?: typeof createVoiceWorkflowController;
  createVoiceLiveTransitionController?: typeof createVoiceLiveTransitionController;
  createVoiceRuntimeShell?: typeof createVoiceRuntimeShell;
  createVoiceInputRuntimeController?: typeof createVoiceInputRuntimeController;
  createVoiceCoachTransportBootstrap?: typeof createVoiceCoachTransportBootstrap;
  createVoiceCoachControllerBootstrap?: typeof createVoiceCoachControllerBootstrap;
  createVoiceCoachShellBootstrap?: typeof createVoiceCoachShellBootstrap;
  createVoiceBootstrapController?: typeof createVoiceBootstrapController;
};

export type VoiceControllerGraph = {
  practiceTransport: ReturnType<typeof createVoicePracticeTransportController>;
  referencePlaybackController: ReturnType<typeof createVoiceReferencePlaybackController>;
  referenceRuntimeController: ReturnType<typeof createVoiceReferenceRuntimeController>;
  sessionStateController: VoiceSessionStateController;
  workflowController: VoiceWorkflowController;
  liveTransitionController: ReturnType<typeof createVoiceLiveTransitionController>;
  runtimeShell: VoiceRuntimeShell;
  inputRuntimeController: VoiceInputRuntimeController;
  coachTransport: VoiceCoachTransportBootstrap;
  coachControllers: VoiceCoachControllerBootstrap;
  coachShell: VoiceCoachShellBootstrap;
  bootstrapController: VoiceBootstrapController;
};

export function createVoiceControllerGraph(
  options: VoiceControllerGraphOptions,
  factories: VoiceControllerGraphFactories = {},
): VoiceControllerGraph {
  const createPracticeTransportImpl = factories.createVoicePracticeTransportController || createVoicePracticeTransportController;
  const createReferencePlaybackImpl = factories.createVoiceReferencePlaybackController || createVoiceReferencePlaybackController;
  const createReferenceRuntimeImpl = factories.createVoiceReferenceRuntimeController || createVoiceReferenceRuntimeController;
  const createSessionStateImpl = factories.createVoiceSessionStateController || createVoiceSessionStateController;
  const createWorkflowImpl = factories.createVoiceWorkflowController || createVoiceWorkflowController;
  const createLiveTransitionImpl = factories.createVoiceLiveTransitionController || createVoiceLiveTransitionController;
  const createRuntimeShellImpl = factories.createVoiceRuntimeShell || createVoiceRuntimeShell;
  const createInputRuntimeImpl = factories.createVoiceInputRuntimeController || createVoiceInputRuntimeController;
  const createCoachTransportImpl = factories.createVoiceCoachTransportBootstrap || createVoiceCoachTransportBootstrap;
  const createCoachControllersImpl = factories.createVoiceCoachControllerBootstrap || createVoiceCoachControllerBootstrap;
  const createCoachShellImpl = factories.createVoiceCoachShellBootstrap || createVoiceCoachShellBootstrap;
  const createBootstrapImpl = factories.createVoiceBootstrapController || createVoiceBootstrapController;

  let sessionStateController: VoiceSessionStateController | null = null;
  let workflowController: VoiceWorkflowController | null = null;
  let runtimeShell: VoiceRuntimeShell | null = null;
  let inputRuntimeController: VoiceInputRuntimeController | null = null;
  let coachTransport: VoiceCoachTransportBootstrap | null = null;
  let coachShell: VoiceCoachShellBootstrap | null = null;

  const applyVoiceBackendPayload = (payload: VoiceBackendPayload | null | undefined): void => {
    const turnId = typeof payload?.turnId === 'string' ? payload.turnId.trim() : '';
    if (turnId) {
      options.onCoachTurnId?.(turnId);
    }
    if (!sessionStateController || !hasVoiceBackendPayload(payload)) {
      return;
    }
    sessionStateController.applyBackendPayload(payload);
    // Honesty tee: the slice contract drops raw flags like fallbackReply; the
    // honesty surface listens for the raw payload (coach-honesty.ts).
    emitBackendPayloadTee(payload);
  };

  const practiceTransport = createPracticeTransportImpl({
    ...options.practiceTransport,
    applyVoiceBackendPayload,
  });

  const referencePlaybackController = createReferencePlaybackImpl(options.referencePlayback);
  const referenceRuntimeController = createReferenceRuntimeImpl({
    ...options.referenceRuntime,
    pausePlayback: (reset) => {
      referencePlaybackController.pause(reset);
    },
  });

  sessionStateController = createSessionStateImpl({
    ...options.sessionState,
    syncPersistedReferenceAnalysis: (referenceClipId) => (
      referenceRuntimeController.syncPersistedReferenceAnalysis(referenceClipId)
    ),
    refreshVoiceDrills: (silent) => workflowController!.refreshDrills(silent),
    enforceRecoverySafety: () => inputRuntimeController?.enforceRecoverySafety() ?? Promise.resolve(),
  });

  workflowController = createWorkflowImpl({
    ...options.workflow,
    applyVoiceBackendPayload: (payload) => {
      sessionStateController!.applyBackendPayload(payload);
    },
    syncSessionStateFromBackend: (silenceCoach) => sessionStateController!.syncSessionStateFromBackend(silenceCoach),
    adoptResolvedReferenceAnalysis: (data, fallbackFilename) => (
      referenceRuntimeController.adoptResolvedReferenceAnalysis(data, fallbackFilename)
    ),
  });

  const liveTransitionController = createLiveTransitionImpl({
    ...options.liveTransition,
    pauseReferencePlayback: () => {
      referencePlaybackController.pause();
    },
    applyVoiceBackendPayload: (payload) => {
      applyVoiceBackendPayload(payload as VoiceBackendPayload);
    },
    refreshVoiceDrills: (silent) => workflowController!.refreshDrills(silent),
  });

  runtimeShell = createRuntimeShellImpl(options.runtimeShell);

  inputRuntimeController = createInputRuntimeImpl({
    ...options.inputRuntime,
    getRequestedInputProvider: () => runtimeShell!.getRequestedInputProvider(),
    getEffectiveInputProvider: (requestedProvider) => runtimeShell!.getEffectiveInputProvider(requestedProvider),
    getInputRecoveryState: (runtime, overrideOptions) => runtimeShell!.getInputRecoveryState(runtime, overrideOptions),
    applyVoiceBackendPayload: (payload) => {
      applyVoiceBackendPayload(payload);
    },
  });

  coachTransport = createCoachTransportImpl({
    speechController: {
      ...options.coachTransport.speechController,
      getRequestedProvider: () => runtimeShell!.getRequestedSpeechProvider(),
    },
    inputController: {
      ...options.coachTransport.inputController,
      getRequestedInputProvider: () => runtimeShell!.getRequestedInputProvider(),
      getEffectiveInputProvider: (requestedProvider) => runtimeShell!.getEffectiveInputProvider(requestedProvider),
      getRuntimeState: () => inputRuntimeController!.getRuntimeState(),
      syncRuntimeEvent: (...args) => inputRuntimeController!.syncEvent(...args),
      applyVoiceBackendPayload: (payload) => {
        applyVoiceBackendPayload(payload);
      },
    },
    runtimeBootstrap: {
      runtimeService: {
        ...options.coachTransport.runtimeBootstrap.runtimeService,
        canPlaySpeech: () => (
          options.coachTransport.runtimeBootstrap.runtimeService.canPlaySpeechWithProvider(
            runtimeShell!.getEffectiveSpeechProvider(),
          )
        ),
        getSpeechProvider: () => runtimeShell!.getEffectiveSpeechProvider(),
      },
      runtimeCoordinator: {
        ...options.coachTransport.runtimeBootstrap.runtimeCoordinator,
        hasInputProvider: () => Boolean(runtimeShell!.getEffectiveInputProvider()),
        supportsAutomaticTurnBoundary: (...args) => runtimeShell!.supportsAutomaticTurnBoundary(...args),
        getRecoveryState: (...args) => runtimeShell!.getInputRecoveryState(...args),
      },
    },
  });

  const coachControllers = createCoachControllersImpl({
    requestController: options.coachControllers.requestController,
    noteController: {
      ...options.coachControllers.noteController,
      applyVoiceBackendPayload: (payload) => {
        sessionStateController!.applyBackendPayload(payload);
      },
      syncVoiceSessionStateFromBackend: async () => {
        await sessionStateController!.syncSessionStateFromBackend();
      },
    },
    deepTutorSessionController: {
      ...options.coachControllers.deepTutorSessionController,
      applyVoiceBackendPayload: (payload) => {
        applyVoiceBackendPayload(payload);
      },
      runCoachResumeHandoff: (interaction) => coachTransport!.runtimeCoordinator.runDeepTutorResumeHandoff(interaction),
    },
    cockpitController: {
      ...options.coachControllers.cockpitController,
      applyVoiceBackendPayload: (payload) => {
        applyVoiceBackendPayload(payload);
      },
      getRequestedSpeechProvider: () => runtimeShell!.getRequestedSpeechProvider(),
      getRequestedInputProvider: () => runtimeShell!.getRequestedInputProvider(),
      getEffectiveInputProvider: (requestedProvider) => runtimeShell!.getEffectiveInputProvider(requestedProvider),
      getEffectiveInputCapabilities: (requestedProvider, effectiveProvider) => (
        runtimeShell!.getEffectiveInputCapabilities(requestedProvider, effectiveProvider)
      ),
      supportsAutomaticTurnBoundary: (...args) => runtimeShell!.supportsAutomaticTurnBoundary(...args),
      hasBrowserSpeechRecognitionSupport: () => runtimeShell!.hasBrowserSpeechRecognitionSupport(),
      buildInputRuntimeRecoveryReset: (...args) => runtimeShell!.buildInputRuntimeRecoveryReset(...args),
      getInputRecoveryState: (...args) => runtimeShell!.getInputRecoveryState(...args),
    },
  });

  coachShell = createCoachShellImpl({
    transport: coachTransport,
    controllers: coachControllers,
  });

  const bootstrapController = createBootstrapImpl({
    ...options.bootstrap,
    syncPreset: (preset) => workflowController!.syncPreset(preset),
    updateVoiceCustomPresetDraft: (patch) => workflowController!.updateCustomPresetDraft(patch),
    saveReferencePreset: () => workflowController!.saveReferencePreset(),
    removeVoiceReference: () => workflowController!.removeReference(),
    seedCustomPresetDraft: () => workflowController!.seedCustomPresetDraft(),
    saveHandmadePreset: () => workflowController!.saveHandmadePreset(),
    editCustomPresetDraft: (presetId) => workflowController!.editCustomPresetDraft(presetId),
    selectCustomPreset: (presetId) => workflowController!.selectCustomPreset(presetId),
    deleteCustomPreset: (presetId) => workflowController!.deleteCustomPreset(presetId),
    toggleAdvancedPanel: () => coachShell?.toggleAdvancedPanel(),
    // The bootstrap controller's analyzeReference slot is typed Promise<void>;
    // the workflow method now returns the analyze response (for the front-door
    // report card), so discard it here to keep the void contract. The standalone
    // front door consumes the return via its own host-assembly wrapper instead.
    analyzeReference: async (file) => {
      await workflowController!.analyzeReference(file);
    },
    projectPhraseForecast: () => workflowController!.projectPhraseForecast(),
    toggleVoiceCoachSpeech: () => coachShell?.toggleSpeechEnabled(),
    handleReferencePlaybackEvent: (eventName) => {
      referencePlaybackController.handlePlaybackEvent(eventName);
    },
  });

  return {
    practiceTransport,
    referencePlaybackController,
    referenceRuntimeController,
    sessionStateController,
    workflowController,
    liveTransitionController,
    runtimeShell,
    inputRuntimeController,
    coachTransport,
    coachControllers,
    coachShell,
    bootstrapController,
  };
}
