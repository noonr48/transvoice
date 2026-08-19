import { describe, expect, it, vi } from 'vitest';

import {
  startVoiceOnlyCoachLifecycle,
  stopVoiceOnlyCoachLifecycle,
} from './coach-session-lifecycle';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

describe('voice-only Coach start lifecycle', () => {
  it('opens listening before continuous cycling and commits active memory last', async () => {
    const order: string[] = [];
    const controller = new AbortController();
    const result = await startVoiceOnlyCoachLifecycle({
      signal: controller.signal,
      prepareSession: async () => { order.push('prepared'); },
      enableContinuousCapture: async () => { order.push('continuous'); return true; },
      startListening: async () => { order.push('listening'); return true; },
      cancelListening: () => { order.push('listening-cancelled'); },
      markSessionActive: async () => { order.push('active-checkpoint'); },
      rollbackToStopped: async () => { order.push('rollback'); },
    });

    expect(result).toBe(true);
    expect(order).toEqual(['prepared', 'listening', 'continuous', 'active-checkpoint']);
  });

  it('rolls back without an active checkpoint when microphone startup fails', async () => {
    const markSessionActive = vi.fn(async () => undefined);
    const rollbackToStopped = vi.fn(async () => undefined);
    const result = await startVoiceOnlyCoachLifecycle({
      signal: new AbortController().signal,
      prepareSession: async () => undefined,
      enableContinuousCapture: async () => true,
      startListening: async () => false,
      cancelListening: () => undefined,
      markSessionActive,
      rollbackToStopped,
    });

    expect(result).toBe(false);
    expect(markSessionActive).not.toHaveBeenCalled();
    expect(rollbackToStopped).toHaveBeenCalledOnce();
  });

  it('does not touch the microphone when transient lease preparation fails', async () => {
    const startListening = vi.fn(async () => true);
    const markSessionActive = vi.fn(async () => undefined);
    const rollbackToStopped = vi.fn(async () => undefined);

    await expect(startVoiceOnlyCoachLifecycle({
      signal: new AbortController().signal,
      prepareSession: async () => { throw new Error('lease unavailable'); },
      enableContinuousCapture: async () => true,
      startListening,
      cancelListening: () => undefined,
      markSessionActive,
      rollbackToStopped,
    })).rejects.toThrow('lease unavailable');

    expect(startListening).not.toHaveBeenCalled();
    expect(markSessionActive).not.toHaveBeenCalled();
    expect(rollbackToStopped).toHaveBeenCalledOnce();
  });

  it('lets Stop cancel an in-flight microphone start and rolls back', async () => {
    const listening = deferred<boolean>();
    const controller = new AbortController();
    const markSessionActive = vi.fn(async () => undefined);
    const rollbackToStopped = vi.fn(async () => undefined);
    const cancelListening = vi.fn(() => listening.resolve(false));
    const starting = startVoiceOnlyCoachLifecycle({
      signal: controller.signal,
      prepareSession: async () => undefined,
      enableContinuousCapture: async () => true,
      startListening: () => listening.promise,
      cancelListening,
      markSessionActive,
      rollbackToStopped,
    });

    await Promise.resolve();
    controller.abort();

    await expect(starting).resolves.toBe(false);
    expect(cancelListening).toHaveBeenCalledOnce();
    expect(markSessionActive).not.toHaveBeenCalled();
    expect(rollbackToStopped).toHaveBeenCalledOnce();
  });

  it('orders rollback after a late continuous-mode enable completes', async () => {
    const enabling = deferred<boolean>();
    const order: string[] = [];
    const controller = new AbortController();
    const starting = startVoiceOnlyCoachLifecycle({
      signal: controller.signal,
      prepareSession: async () => undefined,
      startListening: async () => true,
      cancelListening: () => { order.push('listening-cancelled'); },
      enableContinuousCapture: async () => {
        order.push('enable-start');
        const enabled = await enabling.promise;
        order.push('enable-finished');
        return enabled;
      },
      markSessionActive: async () => { order.push('active-checkpoint'); },
      rollbackToStopped: async () => { order.push('rollback'); },
    });

    await vi.waitFor(() => expect(order).toContain('enable-start'));
    controller.abort();
    enabling.resolve(true);

    await expect(starting).resolves.toBe(false);
    expect(order).toEqual(['enable-start', 'listening-cancelled', 'enable-finished', 'rollback']);
  });

  it('does not suppress a failed rollback', async () => {
    const failure = new Error('checkpoint failed');
    await expect(startVoiceOnlyCoachLifecycle({
      signal: new AbortController().signal,
      prepareSession: async () => undefined,
      startListening: async () => false,
      cancelListening: () => undefined,
      enableContinuousCapture: async () => true,
      markSessionActive: async () => undefined,
      rollbackToStopped: async () => { throw failure; },
    })).rejects.toBe(failure);
  });

  it('always writes the stopped checkpoint when continuous disable fails', async () => {
    const order: string[] = [];
    const reportContinuousDisableFailure = vi.fn();
    await stopVoiceOnlyCoachLifecycle({
      stopListening: () => { order.push('listening-stopped'); },
      stopSpeech: () => { order.push('speech-stopped'); },
      disableContinuousCapture: async () => {
        order.push('continuous-disable');
        throw new Error('cockpit unavailable');
      },
      markSessionStopped: async () => { order.push('checkpoint-stopped'); },
      reportContinuousDisableFailure,
    });

    expect(order.slice(0, 2)).toEqual(['listening-stopped', 'speech-stopped']);
    expect(order.slice(2).sort()).toEqual(['checkpoint-stopped', 'continuous-disable']);
    expect(reportContinuousDisableFailure).toHaveBeenCalledOnce();
  });

  it('launches the stopped checkpoint without waiting for a slow cockpit update', async () => {
    const disabling = deferred<boolean>();
    const markSessionStopped = vi.fn(async () => undefined);
    const stopping = stopVoiceOnlyCoachLifecycle({
      stopListening: () => undefined,
      stopSpeech: () => undefined,
      disableContinuousCapture: () => disabling.promise,
      markSessionStopped,
    });

    await Promise.resolve();
    expect(markSessionStopped).toHaveBeenCalledOnce();
    disabling.resolve(true);
    await expect(stopping).resolves.toBeUndefined();
  });
});
