import { createVoiceCoachNoteController } from './coach-note';
import { createVoiceCoachRequestController } from './coach-request';
import { createVoiceCockpitController } from './cockpit-controller';
import { createDeepTutorSessionController } from './deeptutor-session';

type VoiceCoachControllerBootstrapOptions = {
  requestController: Parameters<typeof createVoiceCoachRequestController>[0];
  noteController: Parameters<typeof createVoiceCoachNoteController>[0];
  deepTutorSessionController: Parameters<typeof createDeepTutorSessionController>[0];
  cockpitController: Parameters<typeof createVoiceCockpitController>[0];
};

type VoiceCoachControllerBootstrapFactories = {
  createRequestController?: typeof createVoiceCoachRequestController;
  createNoteController?: typeof createVoiceCoachNoteController;
  createDeepTutorSessionController?: typeof createDeepTutorSessionController;
  createCockpitController?: typeof createVoiceCockpitController;
};

export type VoiceCoachControllerBootstrap = {
  requestController: ReturnType<typeof createVoiceCoachRequestController>;
  noteController: ReturnType<typeof createVoiceCoachNoteController>;
  deepTutorSessionController: ReturnType<typeof createDeepTutorSessionController>;
  cockpitController: ReturnType<typeof createVoiceCockpitController>;
  submitCoachRequest: ReturnType<typeof createVoiceCoachRequestController>['submitRequest'];
  clearCoachPollTimer: ReturnType<typeof createVoiceCoachNoteController>['clearPollTimer'];
  requestCoachNote: ReturnType<typeof createVoiceCoachNoteController>['requestCoachNote'];
  startDeepTutorLesson: ReturnType<typeof createDeepTutorSessionController>['startLesson'];
  advanceDeepTutorLesson: ReturnType<typeof createDeepTutorSessionController>['advanceLesson'];
  handoffPracticeAfterTake: ReturnType<typeof createDeepTutorSessionController>['handoffPracticeAfterTake'];
  resumeDeepTutorLoop: ReturnType<typeof createDeepTutorSessionController>['resumeLoop'];
  refreshCockpitLine: ReturnType<typeof createVoiceCockpitController>['refreshLine'];
  updateCockpitState: ReturnType<typeof createVoiceCockpitController>['updateCockpitState'];
  updateConditioningState: ReturnType<typeof createVoiceCockpitController>['updateConditioningState'];
  setContinuousMode: ReturnType<typeof createVoiceCockpitController>['setContinuousMode'];
  toggleContinuousMode: ReturnType<typeof createVoiceCockpitController>['toggleContinuousMode'];
  toggleSpeechProvider: ReturnType<typeof createVoiceCockpitController>['toggleSpeechProvider'];
  toggleInputProvider: ReturnType<typeof createVoiceCockpitController>['toggleInputProvider'];
  toggleSpeechEnabled: ReturnType<typeof createVoiceCockpitController>['toggleSpeechEnabled'];
  toggleAdvancedPanel: ReturnType<typeof createVoiceCockpitController>['toggleAdvancedPanel'];
};

export function createVoiceCoachControllerBootstrap(
  options: VoiceCoachControllerBootstrapOptions,
  factories: VoiceCoachControllerBootstrapFactories = {},
): VoiceCoachControllerBootstrap {
  const createRequestControllerImpl = factories.createRequestController || createVoiceCoachRequestController;
  const createNoteControllerImpl = factories.createNoteController || createVoiceCoachNoteController;
  const createDeepTutorSessionControllerImpl = factories.createDeepTutorSessionController || createDeepTutorSessionController;
  const createCockpitControllerImpl = factories.createCockpitController || createVoiceCockpitController;

  const requestController = createRequestControllerImpl(options.requestController);
  const noteController = createNoteControllerImpl(options.noteController);
  const deepTutorSessionController = createDeepTutorSessionControllerImpl(options.deepTutorSessionController);
  const cockpitController = createCockpitControllerImpl(options.cockpitController);

  return {
    requestController,
    noteController,
    deepTutorSessionController,
    cockpitController,
    submitCoachRequest: (requestOptions) => requestController.submitRequest(requestOptions),
    clearCoachPollTimer: () => noteController.clearPollTimer(),
    requestCoachNote: () => noteController.requestCoachNote(),
    startDeepTutorLesson: () => deepTutorSessionController.startLesson(),
    advanceDeepTutorLesson: () => deepTutorSessionController.advanceLesson(),
    handoffPracticeAfterTake: (context) => deepTutorSessionController.handoffPracticeAfterTake(context),
    resumeDeepTutorLoop: (context) => deepTutorSessionController.resumeLoop(context),
    refreshCockpitLine: (action) => cockpitController.refreshLine(action),
    updateCockpitState: (patch) => cockpitController.updateCockpitState(patch),
    updateConditioningState: (patch) => cockpitController.updateConditioningState(patch),
    setContinuousMode: (enabled, persistence) => (
      persistence === undefined
        ? cockpitController.setContinuousMode(enabled)
        : cockpitController.setContinuousMode(enabled, persistence)
    ),
    toggleContinuousMode: () => cockpitController.toggleContinuousMode(),
    toggleSpeechProvider: () => cockpitController.toggleSpeechProvider(),
    toggleInputProvider: () => cockpitController.toggleInputProvider(),
    toggleSpeechEnabled: () => cockpitController.toggleSpeechEnabled(),
    toggleAdvancedPanel: () => cockpitController.toggleAdvancedPanel(),
  };
}
