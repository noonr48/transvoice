import {
  createVoiceAppRuntime,
  type VoiceAppRuntime,
} from './app-runtime';
import {
  createVoiceControllerGraph,
  type VoiceControllerGraph,
} from './controller-graph';
import {
  createVoiceRenderController,
  type VoiceRenderController,
} from './render-controller';
import {
  createVoiceSessionModeRuntime,
  type VoiceSessionModeRuntime,
} from './session-mode-runtime';

export type VoiceHostRenderFinalizer = (
  mode: string,
  coachShell: VoiceControllerGraph['coachShell'],
) => Promise<unknown> | unknown;

export type VoiceHostAppRuntimeOptions = Omit<
  Parameters<typeof createVoiceAppRuntime>[0],
  'getRuntimeShell' | 'disarmPracticeSession' | 'syncPersistedReferenceAnalysis' | 'runtimeResetDependencies'
>;

type VoiceHostGetVoiceUiState = Parameters<typeof createVoiceSessionModeRuntime>[0]['getVoiceUiState'];

export type VoiceHostAppRuntimeBundle = {
  runtime: VoiceAppRuntime;
  getVoiceUiState: VoiceHostGetVoiceUiState;
};

export type VoiceHostOrchestrationOptions = {
  appRuntime: VoiceHostAppRuntimeOptions | VoiceHostAppRuntimeBundle;
  controllerGraph: Parameters<typeof createVoiceControllerGraph>[0];
  renderController: Omit<
    Parameters<typeof createVoiceRenderController>[0],
    'appRuntime' | 'referenceRuntime' | 'getRuntimeShell' | 'finalizeRender'
  > & {
    finalizeRender?: VoiceHostRenderFinalizer;
  };
  sessionModeRuntime: Omit<
    Parameters<typeof createVoiceSessionModeRuntime>[0],
    'getVoiceUiState' | 'applySessionReentryPlan'
  >;
};

export type VoiceHostOrchestrationFactories = {
  createVoiceAppRuntime?: typeof createVoiceAppRuntime;
  createVoiceControllerGraph?: typeof createVoiceControllerGraph;
  createVoiceRenderController?: typeof createVoiceRenderController;
  createVoiceSessionModeRuntime?: typeof createVoiceSessionModeRuntime;
};

export type VoiceHostOrchestration = VoiceControllerGraph & {
  appRuntime: VoiceAppRuntime;
  renderController: VoiceRenderController;
  sessionModeRuntime: VoiceSessionModeRuntime;
};

function isVoiceHostAppRuntimeBundle(
  appRuntime: VoiceHostOrchestrationOptions['appRuntime'],
): appRuntime is VoiceHostAppRuntimeBundle {
  return Boolean(
    appRuntime
      && typeof appRuntime === 'object'
      && 'runtime' in appRuntime
      && typeof appRuntime.getVoiceUiState === 'function',
  );
}

export function createVoiceHostOrchestration(
  options: VoiceHostOrchestrationOptions,
  factories: VoiceHostOrchestrationFactories = {},
): VoiceHostOrchestration {
  const createVoiceAppRuntimeImpl = factories.createVoiceAppRuntime || createVoiceAppRuntime;
  const createVoiceControllerGraphImpl = factories.createVoiceControllerGraph || createVoiceControllerGraph;
  const createVoiceRenderControllerImpl = factories.createVoiceRenderController || createVoiceRenderController;
  const createVoiceSessionModeRuntimeImpl = factories.createVoiceSessionModeRuntime || createVoiceSessionModeRuntime;

  let controllerGraph: VoiceControllerGraph | null = null;
  let appRuntime: VoiceAppRuntime | null = null;

  const appRuntimeBundle = isVoiceHostAppRuntimeBundle(options.appRuntime)
    ? options.appRuntime
    : (() => {
        const appRuntimeOptions = options.appRuntime;
        return {
          runtime: createVoiceAppRuntimeImpl({
            ...appRuntimeOptions,
            getRuntimeShell: () => controllerGraph?.runtimeShell || null,
            disarmPracticeSession: (reason) => (
              controllerGraph?.liveTransitionController.disarmPracticeSession(reason) ?? Promise.resolve(false)
            ),
            syncPersistedReferenceAnalysis: (referenceClipId) => (
              controllerGraph?.referenceRuntimeController.syncPersistedReferenceAnalysis(referenceClipId) || null
            ),
            runtimeResetDependencies: {
              stopListening: (resetTranscript) => {
                controllerGraph?.coachShell.stopCoachListening(resetTranscript);
              },
              stopSpeech: () => {
                controllerGraph?.coachShell.stopCoachSpeech();
              },
              clearCoachPollTimer: () => {
                controllerGraph?.coachShell.clearCoachPollTimer();
              },
              getLatestCoachMessageId: () => appRuntime?.getLatestCoachMessage()?.id || null,
            },
          }),
          getVoiceUiState: () => appRuntimeOptions.store.getUiState(),
        };
      })();
  const appRuntimeInstance = appRuntimeBundle.runtime;
  appRuntime = appRuntimeInstance;

  const controllerGraphInstance = createVoiceControllerGraphImpl(options.controllerGraph);
  controllerGraph = controllerGraphInstance;

  const renderController = createVoiceRenderControllerImpl({
    ...options.renderController,
    appRuntime: appRuntimeInstance,
    referenceRuntime: controllerGraphInstance.referenceRuntimeController,
    getRuntimeShell: () => controllerGraphInstance.runtimeShell,
    finalizeRender: (mode) => {
      if (options.renderController.finalizeRender) {
        return options.renderController.finalizeRender(mode, controllerGraphInstance.coachShell);
      }
      return controllerGraphInstance.coachShell.finalizeRender(mode);
    },
  });

  const sessionModeRuntime = createVoiceSessionModeRuntimeImpl({
    ...options.sessionModeRuntime,
    getVoiceUiState: () => appRuntimeBundle.getVoiceUiState(),
    applySessionReentryPlan: (plan) => {
      appRuntimeInstance.applySessionReentryPlan(plan);
    },
  });

  return {
    ...controllerGraphInstance,
    appRuntime: appRuntimeInstance,
    renderController,
    sessionModeRuntime,
  };
}
