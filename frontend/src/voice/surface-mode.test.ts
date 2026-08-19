/**
 * Surface switching (2026-07-29).
 *
 * The property that matters is not "the right div is visible" — it is that
 * leaving the coach TEARS THE SESSION DOWN. The coach surface is hidden rather
 * than unmounted, so a learner who switches to practice mid-session would
 * otherwise leave a live microphone and a running tutor behind an invisible
 * surface.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_VOICE_SURFACE,
  createVoiceSurfaceController,
  isVoiceSurface,
  readStoredVoiceSurface,
} from './surface-mode';

/** A promise the test controls, so teardown can be held mid-flight on purpose. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((settle) => { resolve = settle; });
  return { promise, resolve };
}

function memoryStorage(seed?: string) {
  const map = new Map<string, string>();
  if (seed !== undefined) map.set('tvSurface', seed);
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value); },
    read: () => map.get('tvSurface') ?? null,
  };
}

describe('surface mode', () => {
  it('defaults to the coach — the app is a lesson first', () => {
    expect(DEFAULT_VOICE_SURFACE).toBe('coach');
    const root = document.createElement('div');
    const controller = createVoiceSurfaceController({ root, storage: memoryStorage() });
    expect(controller.current).toBe('coach');
    expect(root.dataset.tvSurface).toBe('coach');
  });

  it('THE TEARDOWN: leaving the coach stops the session BEFORE the switch', async () => {
    // Ordering is the whole point. If the surface flipped first, the mic would be
    // live behind a hidden surface for however long teardown takes.
    const order: string[] = [];
    const root = document.createElement('div');
    const controller = createVoiceSurfaceController({
      root,
      storage: memoryStorage(),
      onLeaveCoach: () => { order.push(`teardown@${root.dataset.tvSurface}`); },
      onChange: (surface) => { order.push(`changed@${surface}`); },
    });

    await controller.set('practice');
    expect(order).toEqual(['teardown@coach', 'changed@practice']);
  });

  it('THE TEARDOWN IS AWAITED: an async stop holds the flip until it finishes', async () => {
    // The test above passes even against an implementation that CALLS the
    // teardown without awaiting it, because a synchronous stub finishes inside
    // the same tick. Teardown is really async — stopping capture, stopping
    // speech, checkpointing over the network — so this pins the property that
    // actually protects the learner: the coach stays on screen, and the mic
    // stays owned by a visible surface, until the stop has landed.
    const stop = deferred();
    const root = document.createElement('div');
    const controller = createVoiceSurfaceController({
      root,
      storage: memoryStorage(),
      onLeaveCoach: () => stop.promise,
    });

    const switching = controller.set('practice');
    await Promise.resolve();
    await Promise.resolve();
    // Still on the coach: the stop has not resolved yet.
    expect(root.dataset.tvSurface).toBe('coach');
    expect(controller.current).toBe('coach');

    stop.resolve();
    await switching;
    expect(root.dataset.tvSurface).toBe('practice');
  });

  it('DOUBLE TAP: a second tap during teardown does not stop the session twice', async () => {
    // The toggle stays visible and clickable for the whole teardown window.
    // Measured before the guard: two taps ran the teardown TWICE, i.e. two
    // concurrent session-stop requests against one live session.
    const stop = deferred();
    const onLeaveCoach = vi.fn(() => stop.promise);
    const controller = createVoiceSurfaceController({
      root: document.createElement('div'),
      storage: memoryStorage(),
      onLeaveCoach,
    });

    const first = controller.toggle();
    const second = controller.toggle();
    stop.resolve();
    await Promise.all([first, second]);

    expect(onLeaveCoach).toHaveBeenCalledOnce();
    expect(controller.current).toBe('practice');
  });

  it('after a switch settles, the next switch is allowed', async () => {
    // The in-flight guard must RELEASE. If it leaked, the learner would be stuck
    // on whichever surface they landed on — a worse bug than the one it fixes.
    const onLeaveCoach = vi.fn();
    const controller = createVoiceSurfaceController({
      root: document.createElement('div'),
      storage: memoryStorage(),
      onLeaveCoach,
    });
    await controller.set('practice');
    await controller.set('coach');
    await controller.set('practice');
    expect(controller.current).toBe('practice');
    expect(onLeaveCoach).toHaveBeenCalledTimes(2);
  });

  it('the guard releases even when the teardown throws', async () => {
    // A failed teardown keeps the learner on the coach, but it must not also
    // latch the in-flight guard — the next attempt has to be allowed to run.
    const onLeaveCoach = vi.fn()
      .mockImplementationOnce(() => { throw new Error('coach session did not stop'); })
      .mockImplementationOnce(() => undefined);
    const controller = createVoiceSurfaceController({
      root: document.createElement('div'),
      storage: memoryStorage(),
      onLeaveCoach,
      onTeardownError: () => {},
    });
    await controller.set('practice');
    expect(controller.current).toBe('coach');
    await controller.set('practice');
    expect(controller.current).toBe('practice');
    expect(onLeaveCoach).toHaveBeenCalledTimes(2);
  });

  it('does NOT tear down when already away from the coach', async () => {
    const onLeaveCoach = vi.fn();
    const controller = createVoiceSurfaceController({
      root: document.createElement('div'),
      storage: memoryStorage('practice'),
      onLeaveCoach,
    });
    expect(controller.current).toBe('practice');
    await controller.set('coach');
    expect(onLeaveCoach).not.toHaveBeenCalled();
  });

  it('a FAILED teardown CANCELS the switch and is reported', async () => {
    // Reversed 2026-07-29 after review. This used to let the learner leave on a
    // failed teardown, on the reasoning that stranding them was the worse harm.
    // It is not: hiding this surface is exactly what makes the microphone
    // invisible, and a teardown that failed means the lesson may still be
    // running. Leaving would recreate the hazard the teardown exists to prevent.
    // Staying costs a trip they wanted; leaving costs an open mic they cannot
    // see — and they are not stranded, the coach is right there and still works.
    const onTeardownError = vi.fn();
    const root = document.createElement('div');
    const controller = createVoiceSurfaceController({
      root,
      storage: memoryStorage(),
      onLeaveCoach: () => { throw new Error('coach session did not stop'); },
      onTeardownError,
    });

    await controller.set('practice');
    expect(controller.current).toBe('coach');
    expect(root.dataset.tvSurface).toBe('coach');
    expect(onTeardownError).toHaveBeenCalledOnce();
  });

  it('a teardown that NEVER SETTLES times out, reports, and frees the button', async () => {
    // The stop request is a network call. A server that accepts it and never
    // answers used to latch the in-flight guard forever: every later tap
    // returned the same pending promise, so the navigation button was dead until
    // a reload, with the status stuck on "Stopping…".
    vi.useFakeTimers();
    try {
      const onTeardownError = vi.fn();
      const controller = createVoiceSurfaceController({
        root: document.createElement('div'),
        storage: memoryStorage(),
        onLeaveCoach: () => new Promise<void>(() => {}),
        onTeardownError,
        teardownTimeoutMs: 50,
      });

      const stuck = controller.set('practice');
      await vi.advanceTimersByTimeAsync(60);
      expect(await stuck).toBe('coach');
      expect(onTeardownError).toHaveBeenCalledOnce();
      expect(String(onTeardownError.mock.calls[0][0])).toMatch(/did not finish/);

      // ...and the guard is free, so the button still works afterwards.
      const second = controller.set('practice');
      await vi.advanceTimersByTimeAsync(60);
      expect(await second).toBe('coach');
      expect(onTeardownError).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('remembers the surface, and a corrupt or unreadable value falls back to coach', () => {
    const store = memoryStorage();
    const controller = createVoiceSurfaceController({
      root: document.createElement('div'), storage: store,
    });
    return controller.set('practice').then(() => {
      expect(store.read()).toBe('practice');

      expect(readStoredVoiceSurface(memoryStorage('nonsense'))).toBe('coach');
      expect(readStoredVoiceSurface(memoryStorage(''))).toBe('coach');
      expect(readStoredVoiceSurface(null)).toBe('coach');
      // Private browsing throws on access rather than returning null.
      expect(readStoredVoiceSurface({
        getItem: () => { throw new Error('denied'); },
        setItem: () => {},
      })).toBe('coach');
    });
  });

  it('a blocked storage write does not break navigation', async () => {
    const controller = createVoiceSurfaceController({
      root: document.createElement('div'),
      storage: { getItem: () => null, setItem: () => { throw new Error('quota'); } },
    });
    await expect(controller.set('practice')).resolves.toBe('practice');
    expect(controller.current).toBe('practice');
  });

  it('toggle round-trips, and only tears down on the coach-leaving leg', async () => {
    const onLeaveCoach = vi.fn();
    const controller = createVoiceSurfaceController({
      root: document.createElement('div'), storage: memoryStorage(), onLeaveCoach,
    });
    await controller.toggle();
    expect(controller.current).toBe('practice');
    await controller.toggle();
    expect(controller.current).toBe('coach');
    expect(onLeaveCoach).toHaveBeenCalledOnce();
  });

  it('rejects anything that is not a surface', () => {
    for (const bogus of ['Coach', ' practice', '', null, undefined, 1, {}]) {
      expect(isVoiceSurface(bogus)).toBe(false);
    }
    expect(isVoiceSurface('coach')).toBe(true);
    expect(isVoiceSurface('practice')).toBe(true);
  });
});
