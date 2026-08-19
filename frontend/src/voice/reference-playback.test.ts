import { describe, expect, it, vi } from 'vitest';
import { createVoiceReferencePlaybackController } from './reference-playback';

describe('voice reference playback controller', () => {
  it('starts a render loop on play and stops it once playback pauses', () => {
    const render = vi.fn();
    const callbacks: Array<() => void> = [];
    let nextFrameId = 0;
    let cancelledFrameId: number | null = null;
    const player = {
      paused: false,
      ended: false,
      pause: vi.fn(),
      currentTime: 12,
    } as unknown as HTMLAudioElement;

    const controller = createVoiceReferencePlaybackController({
      getPlayerElement: () => player,
      render,
      requestAnimationFrame: ((callback: FrameRequestCallback) => {
        callbacks.push(() => callback(0));
        nextFrameId += 1;
        return nextFrameId;
      }) as typeof window.requestAnimationFrame,
      cancelAnimationFrame: ((frameId: number) => {
        cancelledFrameId = frameId;
      }) as typeof window.cancelAnimationFrame,
    });

    controller.handlePlaybackEvent('play');
    expect(render).toHaveBeenCalledTimes(1);

    callbacks.shift()?.();
    expect(render).toHaveBeenCalledTimes(2);

    controller.handlePlaybackEvent('pause');
    expect(cancelledFrameId).not.toBeNull();
    expect(render).toHaveBeenCalledTimes(3);
  });

  it('pauses and optionally resets the player while stopping the render loop', () => {
    const player = {
      paused: false,
      ended: false,
      pause: vi.fn(),
      currentTime: 9,
    } as unknown as HTMLAudioElement;

    const controller = createVoiceReferencePlaybackController({
      getPlayerElement: () => player,
      render: vi.fn(),
      requestAnimationFrame: ((callback: FrameRequestCallback) => {
        void callback;
        return 1;
      }) as typeof window.requestAnimationFrame,
      cancelAnimationFrame: vi.fn() as typeof window.cancelAnimationFrame,
    });

    controller.pause(true);

    expect(player.pause).toHaveBeenCalledTimes(1);
    expect(player.currentTime).toBe(0);
  });

  it('still re-renders on non-looping playback events', () => {
    const render = vi.fn();

    const controller = createVoiceReferencePlaybackController({
      getPlayerElement: () => null,
      render,
      requestAnimationFrame: vi.fn() as typeof window.requestAnimationFrame,
      cancelAnimationFrame: vi.fn() as typeof window.cancelAnimationFrame,
    });

    controller.handlePlaybackEvent('timeupdate');
    controller.handlePlaybackEvent('loadedmetadata');
    controller.handlePlaybackEvent('error');

    expect(render).toHaveBeenCalledTimes(3);
  });
});
