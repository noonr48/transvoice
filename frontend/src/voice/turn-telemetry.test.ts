import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TurnTelemetry, TIMESTAMP_KEYS, FALLBACK_REASONS, __test__ } from './turn-telemetry';

function makeClock(start = 0) {
  let now = start;
  return {
    now: () => now,
    advance: (ms: number) => {
      now += ms;
      return now;
    },
  };
}

describe('TurnTelemetry (frontend)', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws when turnId is missing', () => {
    expect(() => new TurnTelemetry({ turnId: '' as string })).toThrow(/turnId/);
  });

  it('records markFrontend() timestamps with performance.now() resolution', () => {
    const clock = makeClock(100);
    const t = new TurnTelemetry({ turnId: 'turn-1', now: clock.now, epochOffsetMs: 1_000 });
    clock.advance(50);
    t.markFrontend('speech_end_at');
    expect(t['_perfTimestamps'].speech_end_at).toBe(150);
    const summary = t.getSummary();
    expect(summary.timestamps.speech_end_at).toBe(1_150);
  });

  it('recordEpoch() converts an absolute ms back into a relative offset', () => {
    const clock = makeClock(0);
    const t = new TurnTelemetry({ turnId: 'turn-1', now: clock.now, epochOffsetMs: 1_000 });
    t.recordEpoch('tts_first_byte_at', 2_000);
    expect(t.getSummary().timestamps.tts_first_byte_at).toBe(2_000);
  });

  it('markFrontend throws on unknown keys', () => {
    const t = new TurnTelemetry({ turnId: 'turn-1', now: () => 0, epochOffsetMs: 0 });
    expect(() => t.markFrontend('not_a_key' as any)).toThrow(/unknown key/);
  });

  it('computes latency buckets from recorded timestamps', () => {
    const clock = makeClock(0);
    const t = new TurnTelemetry({ turnId: 'turn-1', now: clock.now, epochOffsetMs: 0 });
    t.markFrontend('speech_end_at');
    clock.advance(100);
    t.markFrontend('voice_trainer_done_at');
    clock.advance(20);
    t.markFrontend('coaching_signal_done_at');
    clock.advance(40);
    t.markFrontend('llm_request_at');
    clock.advance(60);
    t.markFrontend('llm_first_token_at');
    clock.advance(200);
    t.markFrontend('llm_done_at');
    clock.advance(5);
    t.markFrontend('sanitizer_done_at');
    clock.advance(15);
    t.markFrontend('tts_request_at');
    clock.advance(300);
    t.markFrontend('tts_first_byte_at');
    clock.advance(800);
    t.markFrontend('tts_done_at');
    clock.advance(100);
    t.markFrontend('frontend_first_audio_at');
    clock.advance(900);
    t.markFrontend('playback_done_at');

    const summary = t.getSummary();
    expect(summary.latency.voice_trainer_ms).toBe(100);
    expect(summary.latency.signal_build_ms).toBe(20);
    expect(summary.latency.llm_ms).toBe(260);
    expect(summary.latency.llm_ttft_ms).toBe(60);
    expect(summary.latency.sanitizer_ms).toBe(5);
    expect(summary.latency.tts_request_ms).toBe(15);
    expect(summary.latency.tts_first_byte_ms).toBe(300);
    expect(summary.latency.tts_total_ms).toBe(1_100);
    expect(summary.latency.time_to_first_audio_ms).toBe(1_640);
    expect(summary.latency.playback_ms).toBe(900);
    expect(summary.latency.total_turn_ms).toBe(2_540);
  });

  it('returns null latency buckets when timestamps are missing', () => {
    const t = new TurnTelemetry({ turnId: 'turn-1', now: () => 0, epochOffsetMs: 0 });
    const summary = t.getSummary();
    expect(summary.latency.llm_ms).toBeNull();
    expect(summary.latency.total_turn_ms).toBeNull();
  });

  it('setFallback() stores fallback_reason and getFallback() returns it', () => {
    const t = new TurnTelemetry({ turnId: 'turn-1', now: () => 0, epochOffsetMs: 0 });
    t.setFallback('tts_cancelled');
    expect(t.getFallback()).toBe('tts_cancelled');
    expect(t.getSummary().fallback_reason).toBe('tts_cancelled');
    t.setFallback(null);
    expect(t.getFallback()).toBeNull();
  });

  it('toJSON() never serializes arbitrary metadata or raw identifiers', () => {
    const t = new TurnTelemetry({ turnId: 'turn-1', now: () => 0, epochOffsetMs: 0 });
    t.setMetadata('privateText', 'DO_NOT_SERIALIZE');
    const json = t.toJSON();
    expect(json.metadata).toEqual({});
    expect(json).not.toHaveProperty('turnId');
    expect(json).not.toHaveProperty('sessionId');
    expect(JSON.stringify(json)).not.toContain('DO_NOT_SERIALIZE');
  });

  it('sendTo() POSTs timestamps + fallback_reason to the gateway', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    const t = new TurnTelemetry({ turnId: 'turn-1', sessionId: 'sess-1', now: () => 0, epochOffsetMs: 0 });
    t.markFrontend('speech_end_at');
    t.setFallback('tts_reference_unavailable');
    const ok = await t.sendTo('http://kernel.test', fetchMock as any);
    expect(ok).toBe(true);
    expect(t.wasSent()).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`http://kernel.test/voice/turns/${await __test__.deriveTelemetryCorrelationId('turn-1')}/telemetry`);
    expect(url).not.toContain('turn-1');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body).not.toHaveProperty('sessionId');
    expect(body).not.toHaveProperty('turnId');
    expect(body.fallback_reason).toBe('tts_reference_unavailable');
    expect(typeof body.timestamps.speech_end_at).toBe('number');
  });

  it('uses an explicit privacy-safe fallback allowlist', () => {
    const t = new TurnTelemetry({ turnId: 'turn-private', now: () => 0, epochOffsetMs: 0 });
    for (const value of [
      'tts_stream_error: PRIVATE exception text',
      'PRIVATE_EXCEPTION_TEXT',
      'deadnamealice',
      'sk_live_secret_value',
    ]) {
      t.setFallback(value);
      expect(t.getFallback(), value).toBeNull();
      expect(JSON.stringify(t.toJSON())).not.toContain(value);
    }
    expect(FALLBACK_REASONS).toContain('tts_stream_error');
    t.setFallback('TTS_STREAM_ERROR');
    expect(t.getFallback()).toBe('tts_stream_error');
  });

  it('sendTo() records non-2xx responses as failures and returns false', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    const t = new TurnTelemetry({ turnId: 'turn-1', now: () => 0, epochOffsetMs: 0 });
    const ok = await t.sendTo('http://kernel.test', fetchMock as any);
    expect(ok).toBe(false);
    expect(t.wasSent()).toBe(false);
    expect(t.getLastSendError()).toContain('500');
  });

  it('sendTo() catches thrown fetch errors and records them', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    const t = new TurnTelemetry({ turnId: 'turn-1', now: () => 0, epochOffsetMs: 0 });
    const ok = await t.sendTo('http://kernel.test', fetchMock as any);
    expect(ok).toBe(false);
    expect(t.getLastSendError()).toBe('network down');
  });

  it('sendTo() returns false when kernelUrl is empty', async () => {
    const t = new TurnTelemetry({ turnId: 'turn-1', now: () => 0, epochOffsetMs: 0 });
    const ok = await t.sendTo('', fetch as any);
    expect(ok).toBe(false);
  });

  it('exposes the timestamp key surface for analytics consumers', () => {
    expect(TIMESTAMP_KEYS).toContain('speech_end_at');
    expect(TIMESTAMP_KEYS).toContain('playback_done_at');
    expect(__test__.SCHEMA_VERSION).toMatch(/^transvoice\.turn_telemetry/);
  });
});
