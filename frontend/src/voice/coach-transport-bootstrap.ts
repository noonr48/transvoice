import { createVoiceCoachInputController } from './coach-input';
import { createVoiceCoachSpeechController } from './coach-speech';
import { createVoiceCoachRuntimeBootstrap } from './runtime-bootstrap';
import type { VoiceCoachRuntimeService } from './runtime-service';
import { VOICE_COACH_SPEAKING_RATE } from './coach-speech-rate';
import { VOICE_COACH_PLAYBACK_STATE_EVENT } from './coach-surface';

type VoiceCoachTransportBootstrapOptions = {
  speechController: Omit<Parameters<typeof createVoiceCoachSpeechController>[0], 'onPlaybackFinished'>;
  inputController: Omit<
    Parameters<typeof createVoiceCoachInputController>[0],
    'isCoachSpeechBusy' | 'stopCoachSpeech'
  >;
  runtimeBootstrap: {
    runtimeService: Omit<
      Parameters<typeof createVoiceCoachRuntimeBootstrap>[0]['runtimeService'],
      'startListeningTransport' | 'stopListeningTransport' | 'stopSpeechTransport' | 'playSpeechTransport'
    >;
    runtimeCoordinator: Parameters<typeof createVoiceCoachRuntimeBootstrap>[0]['runtimeCoordinator'];
  };
};

type VoiceCoachTransportBootstrapFactories = {
  createSpeechController?: typeof createVoiceCoachSpeechController;
  createInputController?: typeof createVoiceCoachInputController;
  createRuntimeBootstrap?: typeof createVoiceCoachRuntimeBootstrap;
};

export type VoiceCoachTransportBootstrap = {
  speechController: ReturnType<typeof createVoiceCoachSpeechController>;
  inputController: ReturnType<typeof createVoiceCoachInputController>;
  runtimeService: VoiceCoachRuntimeService;
  runtimeCoordinator: ReturnType<typeof createVoiceCoachRuntimeBootstrap>['runtimeCoordinator'];
  startCoachListening: () => Promise<boolean>;
  stopCoachListening: (resetTranscript?: boolean) => void;
  reopenCoachListeningWithNotice: (notice?: string) => Promise<boolean>;
  speakCoachMessage: VoiceCoachRuntimeService['speakCoachMessage'];
  stopCoachSpeech: () => void;
  toggleCoachListening: () => void;
};

// Surfacing wave (shell request): reflect coach speaking state as a
// data-speaking="true|false" attribute on the stable coach-thread container so
// the shell can read it without label-sniffing. Lazy lookup, null-safe — absent
// node simply disables the surface (jsdom suites without the template included).
function reflectCoachSpeakingState(speaking: boolean): void {
  if (typeof document === 'undefined') return;
  document.getElementById('voice-coach-thread')?.setAttribute('data-speaking', speaking ? 'true' : 'false');
}

function dispatchCoachPlaybackState(playing: boolean): void {
  if (typeof document === 'undefined') return;
  const EventConstructor = document.defaultView?.CustomEvent;
  if (!EventConstructor) return;
  document.dispatchEvent(new EventConstructor(VOICE_COACH_PLAYBACK_STATE_EVENT, {
    detail: { playing },
  }));
}

export function createVoiceCoachTransportBootstrap(
  options: VoiceCoachTransportBootstrapOptions,
  factories: VoiceCoachTransportBootstrapFactories = {},
): VoiceCoachTransportBootstrap {
  const createSpeechControllerImpl = factories.createSpeechController || createVoiceCoachSpeechController;
  const createInputControllerImpl = factories.createInputController || createVoiceCoachInputController;
  const createRuntimeBootstrapImpl = factories.createRuntimeBootstrap || createVoiceCoachRuntimeBootstrap;

  let runtimeCoordinator: ReturnType<typeof createVoiceCoachRuntimeBootstrap>['runtimeCoordinator'] | null = null;
  let runtimeService: VoiceCoachRuntimeService | null = null;
  let publishedPlaybackState: boolean | null = null;
  const publishPlaybackState = (playing: boolean): void => {
    reflectCoachSpeakingState(playing);
    if (publishedPlaybackState === playing) return;
    publishedPlaybackState = playing;
    dispatchCoachPlaybackState(playing);
    options.speechController.onPlaybackStateChange?.(playing);
  };

  const speechController = createSpeechControllerImpl({
    ...options.speechController,
    onPlaybackStateChange: publishPlaybackState,
    onPlaybackFinished: async () => {
      publishPlaybackState(false);
      await runtimeCoordinator?.runPostPlaybackHandoff();
    },
  });

  const inputController = createInputControllerImpl({
    ...options.inputController,
    isCoachSpeechBusy: () => speechController.isSpeaking(),
    stopCoachSpeech: () => {
      runtimeService?.stopCoachSpeech();
    },
  });

  const runtime = createRuntimeBootstrapImpl({
    runtimeService: {
      ...options.runtimeBootstrap.runtimeService,
      startListeningTransport: () => inputController.start(),
      stopListeningTransport: (resetTranscript = false) => {
        void inputController.stop(resetTranscript);
      },
      stopSpeechTransport: () => {
        speechController.stop();
        publishPlaybackState(false);
      },
      playSpeechTransport: (message, transportOptions) => {
        return speechController.speak(message, transportOptions);
      },
    },
    runtimeCoordinator: options.runtimeBootstrap.runtimeCoordinator,
  });

  runtimeService = runtime.runtimeService;
  runtimeCoordinator = runtime.runtimeCoordinator;

  // Surfacing wave (shell request): a tiny read/control bridge for the shell.
  // Attached once at bootstrap; last bootstrap wins (one live transport per page).
  if (typeof window !== 'undefined') {
    (window as unknown as Record<string, unknown>).__tvCoach = {
      stopSpeech: () => runtime.runtimeService.stopCoachSpeech(),
      isSpeaking: () => speechController.isSpeaking(),
      isPlaying: () => speechController.isPlaying(),
      toggleListening: () => inputController.toggle(),
    };
    console.info('[voice-surface] __tvCoach bridge attached');
  }

  return {
    speechController,
    inputController,
    runtimeService,
    runtimeCoordinator,
    startCoachListening: () => runtime.runtimeService.startCoachListening(),
    stopCoachListening: (resetTranscript = false) => runtime.runtimeService.stopCoachListening(resetTranscript),
    reopenCoachListeningWithNotice: (notice?: string) => runtime.runtimeService.reopenCoachListeningWithNotice(notice),
    speakCoachMessage: (message, rate = VOICE_COACH_SPEAKING_RATE) => runtime.runtimeService.speakCoachMessage(message, rate),
    stopCoachSpeech: () => runtime.runtimeService.stopCoachSpeech(),
    toggleCoachListening: () => inputController.toggle(),
  };
}
