import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  COACH_TURN_RETRY_DELAY_MS,
  COACH_TURN_RETRY_HINT,
  createVoiceApi,
  isTransientCoachTurnError,
  requestJson,
  VOICE_COACH_TURN_SETTLED_EVENT,
  VOICE_COACH_TURN_START_EVENT,
  VoiceNetworkRequestError,
  withCoachTurnRetry,
  type VoiceCoachTurnSettledDetail,
} from './api';

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
}

function createApi() {
  return createVoiceApi({
    kernelUrl: 'http://kernel.test',
    voiceTrainerUrl: 'http://trainer.test',
    voiceTrainerToken: null,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('coach-turn retry', () => {
  it('classifies only fetch-rejection failures as transient', async () => {
    vi.mocked(global.fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const networkError = await requestJson('http://kernel.test/voice/coach/runtime', { method: 'POST' })
      .then(() => null, (error: unknown) => error);
    expect(networkError).toBeInstanceOf(VoiceNetworkRequestError);
    expect(isTransientCoachTurnError(networkError)).toBe(true);

    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: 'Bad gateway' }, { status: 502 }));
    const httpError = await requestJson('http://kernel.test/voice/coach/runtime', { method: 'POST' })
      .then(() => null, (error: unknown) => error);
    expect(httpError).toBeInstanceOf(Error);
    expect(isTransientCoachTurnError(httpError)).toBe(false);
  });

  it('retries once after a network failure and resolves with the retry result', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ success: true, reply: 'hi' }));

    const result = await withCoachTurnRetry(
      () => requestJson<{ success: boolean }>('http://kernel.test/voice/coach/runtime', { method: 'POST' }),
      { delayMs: 0 },
    );

    expect(result).toMatchObject({ success: true });
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('does not retry a 4xx response', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: 'A coach question is required' }, { status: 400 }));

    await expect(withCoachTurnRetry(
      () => requestJson('http://kernel.test/voice/coach/runtime', { method: 'POST' }),
      { delayMs: 0 },
    )).rejects.toThrow('A coach question is required');

    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('double-apply guard: does not retry 502/504 responses (turn may have landed server-side)', async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: 'Bad gateway' }, { status: 502 }));
    await expect(withCoachTurnRetry(
      () => requestJson('http://kernel.test/voice/coach/message', { method: 'POST' }),
      { delayMs: 0 },
    )).rejects.toThrow('Bad gateway');
    expect(global.fetch).toHaveBeenCalledTimes(1);

    vi.mocked(global.fetch).mockResolvedValueOnce(jsonResponse({ error: 'Gateway timeout' }, { status: 504 }));
    await expect(withCoachTurnRetry(
      () => requestJson('http://kernel.test/voice/coach/message', { method: 'POST' }),
      { delayMs: 0 },
    )).rejects.toThrow('Gateway timeout');
    expect(global.fetch).toHaveBeenCalledTimes(2); // one call per attempt above — no retries
  });

  it('appends the calm hint when the retry also fails on the network', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const error = await withCoachTurnRetry(
      () => requestJson('http://kernel.test/voice/coach/runtime', { method: 'POST' }),
      { delayMs: 0 },
    ).then(() => null, (caught: unknown) => caught as Error);

    expect(error).toBeInstanceOf(VoiceNetworkRequestError);
    expect(error?.message).toContain(COACH_TURN_RETRY_HINT);
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('re-sends the byte-identical payload on retry (same RequestInit)', async () => {
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));
    const api = createApi();

    // Patch the default delay path by racing real timers: use fake timers so the
    // 1.5s wait is deterministic.
    vi.useFakeTimers();
    const pending = api.submitRuntimeCoachQuestion('session-1', 'can you hear me?');
    await vi.advanceTimersByTimeAsync(COACH_TURN_RETRY_DELAY_MS);
    await expect(pending).resolves.toMatchObject({ success: true });

    const calls = vi.mocked(global.fetch).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('http://kernel.test/voice/coach/runtime');
    expect(calls[1][0]).toBe('http://kernel.test/voice/coach/runtime');
    expect(calls[0][1]).toBe(calls[1][1]); // the SAME RequestInit object, not a rebuild
    expect((calls[0][1] as RequestInit).body).toBe(JSON.stringify({ sessionId: 'session-1', message: 'can you hear me?' }));
  });

  it('waits ~1.5s (default delay) before the single retry', async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    const pending = withCoachTurnRetry(
      () => requestJson('http://kernel.test/voice/coach/runtime', { method: 'POST' }),
    );
    // Let the first (rejected) attempt settle without advancing timers.
    await vi.advanceTimersByTimeAsync(0);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(COACH_TURN_RETRY_DELAY_MS - 1);
    expect(global.fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    await expect(pending).resolves.toMatchObject({ success: true });
    expect(COACH_TURN_RETRY_DELAY_MS).toBe(1500);
  });

  it('logs the retry witness line once per retry', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse({ success: true }));

    await withCoachTurnRetry(
      () => requestJson('http://kernel.test/voice/input/turn', { method: 'POST' }),
      { delayMs: 0, source: '/voice/input/turn' },
    );

    const witnessLines = infoSpy.mock.calls.filter((call) => String(call[0]).startsWith('[coach-turn]'));
    expect(witnessLines).toHaveLength(1);
    expect(String(witnessLines[0][0])).toContain('/voice/input/turn');
  });
});

describe('coach-turn lifecycle tee (abandon-trigger fixes 2b/2c)', () => {
  function collectEvents() {
    const started: unknown[] = [];
    const settled: VoiceCoachTurnSettledDetail[] = [];
    const onStart = (event: Event) => started.push((event as CustomEvent).detail);
    const onSettled = (event: Event) => settled.push((event as CustomEvent<VoiceCoachTurnSettledDetail>).detail);
    document.addEventListener(VOICE_COACH_TURN_START_EVENT, onStart);
    document.addEventListener(VOICE_COACH_TURN_SETTLED_EVENT, onSettled);
    return {
      started,
      settled,
      dispose: () => {
        document.removeEventListener(VOICE_COACH_TURN_START_EVENT, onStart);
        document.removeEventListener(VOICE_COACH_TURN_SETTLED_EVENT, onSettled);
      },
    };
  }

  it('emits start + settled(ok) around a successful turn', async () => {
    const events = collectEvents();
    const result = await withCoachTurnRetry(async () => 'reply', { source: '/voice/coach/message' });
    expect(result).toBe('reply');
    expect(events.started).toEqual([{ source: '/voice/coach/message' }]);
    expect(events.settled).toEqual([{ source: '/voice/coach/message', ok: true, lost: false }]);
    events.dispose();
  });

  it('an HTTP failure settles as ok:false lost:false (the turn DID arrive)', async () => {
    const events = collectEvents();
    await expect(withCoachTurnRetry(async () => {
      throw new Error('HTTP 502');
    }, { source: '/voice/coach/runtime' })).rejects.toThrow('HTTP 502');
    expect(events.settled).toEqual([{ source: '/voice/coach/runtime', ok: false, lost: false }]);
    events.dispose();
  });

  it('an exhausted network retry settles as lost:true — the voiced lost-turn signal', async () => {
    const events = collectEvents();
    let attempts = 0;
    await expect(withCoachTurnRetry(async () => {
      attempts += 1;
      throw new VoiceNetworkRequestError('offline');
    }, { source: '/voice/input/turn', delayMs: 1 })).rejects.toThrow(COACH_TURN_RETRY_HINT);
    expect(attempts).toBe(2);
    expect(events.started).toHaveLength(1);
    expect(events.settled).toEqual([{ source: '/voice/input/turn', ok: false, lost: true }]);
    events.dispose();
  });

  it('a retry that recovers settles ok:true (no lost-turn line for a save)', async () => {
    const events = collectEvents();
    let attempts = 0;
    const result = await withCoachTurnRetry(async () => {
      attempts += 1;
      if (attempts === 1) {
        throw new VoiceNetworkRequestError('blip');
      }
      return 'recovered';
    }, { delayMs: 1 });
    expect(result).toBe('recovered');
    expect(events.settled).toEqual([{ source: null, ok: true, lost: false }]);
    events.dispose();
  });
});
