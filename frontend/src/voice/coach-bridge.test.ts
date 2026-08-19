import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVoiceCoachTransportBootstrap } from './coach-transport-bootstrap';

// Surfacing wave (shell requests): the window.__tvCoach bridge and the
// data-speaking attribute on the coach-thread container.

type SpeechControllerOptions = {
  onPlaybackFinished: () => Promise<void> | void;
  onPlaybackStateChange: (playing: boolean) => void;
};
type RuntimeServiceOptions = {
  playSpeechTransport: (message: unknown, options: unknown) => boolean;
  stopSpeechTransport: () => void;
};

function createBridgeHarness(speakStarts = true) {
  const speechController = {
    speak: vi.fn(() => speakStarts),
    stop: vi.fn(),
    isSpeaking: vi.fn(() => false),
    isPlaying: vi.fn(() => false),
  };
  const inputController = {
    start: vi.fn(async () => true),
    stop: vi.fn(async () => undefined),
    toggle: vi.fn(),
  };
  const runtimeService = {
    canSpeakCoachMessage: vi.fn(() => true),
    startCoachListening: vi.fn(async () => true),
    reopenCoachListeningWithNotice: vi.fn(async () => true),
    speakCoachMessage: vi.fn(() => true),
    stopCoachListening: vi.fn(),
    stopCoachSpeech: vi.fn(),
  };

  let capturedSpeechOptions: SpeechControllerOptions | null = null;
  let capturedRuntimeServiceOptions: RuntimeServiceOptions | null = null;

  const bootstrap = createVoiceCoachTransportBootstrap(
    {
      speechController: {},
      inputController: {},
      runtimeBootstrap: { runtimeService: {}, runtimeCoordinator: {} },
    } as never,
    {
      createSpeechController: ((options: SpeechControllerOptions) => {
        capturedSpeechOptions = options;
        return speechController;
      }) as never,
      createInputController: (() => inputController) as never,
      createRuntimeBootstrap: ((options: { runtimeService: RuntimeServiceOptions }) => {
        capturedRuntimeServiceOptions = options.runtimeService;
        return { runtimeService, runtimeCoordinator: { runPostPlaybackHandoff: vi.fn(async () => undefined) } };
      }) as never,
    },
  );

  return {
    bootstrap,
    speechController,
    inputController,
    runtimeService,
    getSpeechOptions: () => capturedSpeechOptions!,
    getRuntimeServiceOptions: () => capturedRuntimeServiceOptions!,
  };
}

function getThreadEl(): HTMLElement {
  return document.getElementById('voice-coach-thread') as HTMLElement;
}

describe('voice coach shell bridge', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="voice-coach-thread"></div>';
    delete (window as unknown as Record<string, unknown>).__tvCoach;
  });

  it('attaches window.__tvCoach with stopSpeech / audible playback / toggleListening', () => {
    const harness = createBridgeHarness();
    const bridge = (window as unknown as Record<string, unknown>).__tvCoach as {
      stopSpeech: () => void;
      isSpeaking: () => boolean;
      isPlaying: () => boolean;
      toggleListening: () => void;
    };
    expect(bridge).toBeTruthy();

    harness.speechController.isSpeaking.mockReturnValue(true);
    expect(bridge.isSpeaking()).toBe(true);
    harness.speechController.isSpeaking.mockReturnValue(false);
    expect(bridge.isSpeaking()).toBe(false);
    harness.speechController.isPlaying.mockReturnValue(true);
    expect(bridge.isPlaying()).toBe(true);

    bridge.toggleListening();
    expect(harness.inputController.toggle).toHaveBeenCalledTimes(1);

    bridge.stopSpeech();
    expect(harness.runtimeService.stopCoachSpeech).toHaveBeenCalledTimes(1);
  });

  it('reflects speaking state as data-speaking on the coach-thread container', async () => {
    const harness = createBridgeHarness();
    const runtimeServiceOptions = harness.getRuntimeServiceOptions();

    // A request being accepted is not yet audible playback.
    const started = runtimeServiceOptions.playSpeechTransport({ id: 'm1' }, { provider: 'browser', rate: 1 });
    expect(started).toBe(true);
    expect(getThreadEl().getAttribute('data-speaking')).toBeNull();

    // Only the controller's first-audio witness projects Speaking.
    harness.getSpeechOptions().onPlaybackStateChange(true);
    expect(getThreadEl().getAttribute('data-speaking')).toBe('true');

    // Stop transport -> false.
    runtimeServiceOptions.stopSpeechTransport();
    expect(getThreadEl().getAttribute('data-speaking')).toBe('false');

    // Playback finishing (the coach-speech completion callback) -> false.
    runtimeServiceOptions.playSpeechTransport({ id: 'm2' }, { provider: 'browser', rate: 1 });
    harness.getSpeechOptions().onPlaybackStateChange(true);
    expect(getThreadEl().getAttribute('data-speaking')).toBe('true');
    await harness.getSpeechOptions().onPlaybackFinished();
    expect(getThreadEl().getAttribute('data-speaking')).toBe('false');
  });

  it('does not mark speaking when the speech path declines to start', () => {
    const harness = createBridgeHarness(false);
    const runtimeServiceOptions = harness.getRuntimeServiceOptions();
    const started = runtimeServiceOptions.playSpeechTransport({ id: 'm1' }, { provider: 'browser', rate: 1 });
    expect(started).toBe(false);
    expect(getThreadEl().getAttribute('data-speaking')).toBeNull();
  });
});
