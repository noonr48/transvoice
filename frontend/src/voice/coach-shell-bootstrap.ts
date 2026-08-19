import type { VoiceCoachControllerBootstrap } from './coach-controller-bootstrap';
import type { VoiceCoachTransportBootstrap } from './coach-transport-bootstrap';
import { VOICE_COACH_SPEAKING_RATE } from './coach-speech-rate';

type VoiceCoachShellBootstrapOptions = {
  transport: VoiceCoachTransportBootstrap;
  controllers: VoiceCoachControllerBootstrap;
};

export type VoiceCoachShellRenderResult =
  | { kind: 'stopped' }
  | {
    kind: 'handoff';
    plan: Awaited<ReturnType<VoiceCoachTransportBootstrap['runtimeCoordinator']['runRenderHandoff']>>;
  };

export type VoiceCoachShellBootstrap = {
  transport: VoiceCoachTransportBootstrap;
  controllers: VoiceCoachControllerBootstrap;
  runtimeCoordinator: VoiceCoachTransportBootstrap['runtimeCoordinator'];
  startCoachListening: VoiceCoachTransportBootstrap['startCoachListening'];
  stopCoachListening: VoiceCoachTransportBootstrap['stopCoachListening'];
  reopenCoachListeningWithNotice: VoiceCoachTransportBootstrap['reopenCoachListeningWithNotice'];
  speakCoachMessage: VoiceCoachTransportBootstrap['speakCoachMessage'];
  stopCoachSpeech: VoiceCoachTransportBootstrap['stopCoachSpeech'];
  toggleCoachListening: VoiceCoachTransportBootstrap['toggleCoachListening'];
  submitCoachRequest: VoiceCoachControllerBootstrap['submitCoachRequest'];
  clearCoachPollTimer: VoiceCoachControllerBootstrap['clearCoachPollTimer'];
  requestCoachNote: VoiceCoachControllerBootstrap['requestCoachNote'];
  startDeepTutorLesson: VoiceCoachControllerBootstrap['startDeepTutorLesson'];
  advanceDeepTutorLesson: VoiceCoachControllerBootstrap['advanceDeepTutorLesson'];
  handoffPracticeAfterTake: VoiceCoachControllerBootstrap['handoffPracticeAfterTake'];
  resumeDeepTutorLoop: VoiceCoachControllerBootstrap['resumeDeepTutorLoop'];
  refreshCockpitLine: VoiceCoachControllerBootstrap['refreshCockpitLine'];
  updateCockpitState: VoiceCoachControllerBootstrap['updateCockpitState'];
  updateConditioningState: VoiceCoachControllerBootstrap['updateConditioningState'];
  setContinuousMode: VoiceCoachControllerBootstrap['setContinuousMode'];
  toggleContinuousMode: VoiceCoachControllerBootstrap['toggleContinuousMode'];
  toggleSpeechProvider: VoiceCoachControllerBootstrap['toggleSpeechProvider'];
  toggleInputProvider: VoiceCoachControllerBootstrap['toggleInputProvider'];
  toggleSpeechEnabled: VoiceCoachControllerBootstrap['toggleSpeechEnabled'];
  toggleAdvancedPanel: VoiceCoachControllerBootstrap['toggleAdvancedPanel'];
  runRenderHandoff: VoiceCoachTransportBootstrap['runtimeCoordinator']['runRenderHandoff'];
  runDeepTutorResumeHandoff: VoiceCoachTransportBootstrap['runtimeCoordinator']['runDeepTutorResumeHandoff'];
  finalizeRender: (currentMode: string) => Promise<VoiceCoachShellRenderResult>;
};

export function createVoiceCoachShellBootstrap(
  options: VoiceCoachShellBootstrapOptions,
): VoiceCoachShellBootstrap {
  async function finalizeRender(currentMode: string): Promise<VoiceCoachShellRenderResult> {
    if (currentMode !== 'voice') {
      options.transport.stopCoachSpeech();
      options.transport.stopCoachListening(true);
      return { kind: 'stopped' };
    }

    return {
      kind: 'handoff',
      plan: await options.transport.runtimeCoordinator.runRenderHandoff(),
    };
  }

  return {
    transport: options.transport,
    controllers: options.controllers,
    runtimeCoordinator: options.transport.runtimeCoordinator,
    startCoachListening: () => options.transport.startCoachListening(),
    stopCoachListening: (resetTranscript = false) => options.transport.stopCoachListening(resetTranscript),
    reopenCoachListeningWithNotice: (notice) => options.transport.reopenCoachListeningWithNotice(notice),
    speakCoachMessage: (message, rate = VOICE_COACH_SPEAKING_RATE) => options.transport.speakCoachMessage(message, rate),
    stopCoachSpeech: () => options.transport.stopCoachSpeech(),
    toggleCoachListening: () => options.transport.toggleCoachListening(),
    submitCoachRequest: (requestOptions) => options.controllers.submitCoachRequest(requestOptions),
    clearCoachPollTimer: () => options.controllers.clearCoachPollTimer(),
    requestCoachNote: () => options.controllers.requestCoachNote(),
    startDeepTutorLesson: () => options.controllers.startDeepTutorLesson(),
    advanceDeepTutorLesson: () => options.controllers.advanceDeepTutorLesson(),
    handoffPracticeAfterTake: (context) => options.controllers.handoffPracticeAfterTake(context),
    resumeDeepTutorLoop: (context) => options.controllers.resumeDeepTutorLoop(context),
    refreshCockpitLine: (action) => options.controllers.refreshCockpitLine(action),
    updateCockpitState: (patch) => options.controllers.updateCockpitState(patch),
    updateConditioningState: (patch) => options.controllers.updateConditioningState(patch),
    setContinuousMode: (enabled, persistence) => (
      persistence === undefined
        ? options.controllers.setContinuousMode(enabled)
        : options.controllers.setContinuousMode(enabled, persistence)
    ),
    toggleContinuousMode: () => options.controllers.toggleContinuousMode(),
    toggleSpeechProvider: () => options.controllers.toggleSpeechProvider(),
    toggleInputProvider: () => options.controllers.toggleInputProvider(),
    toggleSpeechEnabled: () => options.controllers.toggleSpeechEnabled(),
    toggleAdvancedPanel: () => options.controllers.toggleAdvancedPanel(),
    runRenderHandoff: () => options.transport.runtimeCoordinator.runRenderHandoff(),
    runDeepTutorResumeHandoff: (interaction) => options.transport.runtimeCoordinator.runDeepTutorResumeHandoff(interaction),
    finalizeRender,
  };
}
