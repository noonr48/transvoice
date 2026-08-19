type VoiceReferencePlaybackEvent =
  | 'play'
  | 'pause'
  | 'ended'
  | 'timeupdate'
  | 'loadedmetadata'
  | 'seeked'
  | 'seeking'
  | 'error';

type VoiceReferencePlaybackControllerOptions = {
  getPlayerElement: () => HTMLAudioElement | null;
  render: () => void;
  requestAnimationFrame?: typeof window.requestAnimationFrame;
  cancelAnimationFrame?: typeof window.cancelAnimationFrame;
};

export function createVoiceReferencePlaybackController(
  options: VoiceReferencePlaybackControllerOptions,
) {
  let animationFrame: number | null = null;

  const requestFrame = options.requestAnimationFrame || window.requestAnimationFrame.bind(window);
  const cancelFrame = options.cancelAnimationFrame || window.cancelAnimationFrame.bind(window);

  function stopRenderLoop(): void {
    if (animationFrame !== null) {
      cancelFrame(animationFrame);
      animationFrame = null;
    }
  }

  function startRenderLoop(): void {
    stopRenderLoop();
    const tick = () => {
      options.render();
      const player = options.getPlayerElement();
      if (player && !player.paused && !player.ended) {
        animationFrame = requestFrame(tick);
      } else {
        animationFrame = null;
      }
    };
    animationFrame = requestFrame(tick);
  }

  function pause(reset = false): void {
    const player = options.getPlayerElement();
    if (!player) {
      return;
    }
    player.pause();
    if (reset) {
      player.currentTime = 0;
    }
    stopRenderLoop();
  }

  function handlePlaybackEvent(eventName: VoiceReferencePlaybackEvent): void {
    if (eventName === 'play') {
      startRenderLoop();
      options.render();
      return;
    }
    if (eventName === 'pause' || eventName === 'ended') {
      stopRenderLoop();
      options.render();
      return;
    }
    options.render();
  }

  return {
    pause,
    stopRenderLoop,
    handlePlaybackEvent,
  };
}
