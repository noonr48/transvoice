'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  TurnTelemetry,
  TIMESTAMP_KEYS,
  BUCKET_KEYS,
  FALLBACK_REASONS,
  SCHEMA_VERSION,
} = require('./turn-telemetry');

test('TurnTelemetry (gateway)', async (t) => {
  await t.test('throws when turnId is missing', () => {
    assert.throws(() => new TurnTelemetry({ turnId: '' }), /turnId/);
  });

  await t.test('mark throws on unknown keys', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    assert.throws(() => tel.mark('not_a_key'), /unknown key/);
  });

  await t.test('computes the 11 latency buckets from recorded timestamps', () => {
    // Same cumulative offsets as the frontend src/voice/turn-telemetry.test.ts
    // fixture, fed as absolute epoch-ms so the assertion is clock-independent.
    const tel = new TurnTelemetry({ turnId: 'turn-1', sessionId: 'sess-1' });
    const ts = {
      speech_end_at: 0,
      voice_trainer_done_at: 100,
      coaching_signal_done_at: 120,
      llm_request_at: 160,
      llm_first_token_at: 220,
      llm_done_at: 420,
      sanitizer_done_at: 425,
      tts_request_at: 440,
      tts_first_byte_at: 740,
      tts_done_at: 1540,
      frontend_first_audio_at: 1640,
      playback_done_at: 2540,
    };
    for (const [key, value] of Object.entries(ts)) tel.record(key, value);
    const { latency } = tel.getSummary();
    assert.equal(latency.voice_trainer_ms, 100);
    assert.equal(latency.signal_build_ms, 20);
    assert.equal(latency.llm_ms, 260);
    assert.equal(latency.llm_ttft_ms, 60);
    assert.equal(latency.sanitizer_ms, 5);
    assert.equal(latency.tts_request_ms, 15);
    assert.equal(latency.tts_first_byte_ms, 300);
    assert.equal(latency.tts_total_ms, 1100);
    assert.equal(latency.time_to_first_audio_ms, 1640);
    assert.equal(latency.playback_ms, 900);
    assert.equal(latency.total_turn_ms, 2540);
  });

  await t.test('null latency buckets when timestamps are missing', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    const { latency } = tel.getSummary();
    assert.equal(latency.llm_ms, null);
    assert.equal(latency.total_turn_ms, null);
  });

  await t.test('getSummary shape satisfies the logTurnTelemetry consumer', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1', sessionId: 'sess-1' });
    const summary = tel.getSummary();
    assert.match(summary.correlationId, /^tc-[a-f0-9]{32}$/);
    assert.equal(Object.hasOwn(summary, 'turnId'), false);
    assert.equal(Object.hasOwn(summary, 'sessionId'), false);
    assert.equal(summary.fallback_reason, null);
    assert.ok(summary.latency && typeof summary.latency === 'object');
    for (const key of BUCKET_KEYS) assert.ok(key in summary.latency, `missing bucket ${key}`);
    assert.equal(summary.schema, SCHEMA_VERSION);
    assert.match(summary.schema, /^transvoice\.turn_telemetry/);
  });

  await t.test('mark stamps a recorded timestamp; getSummary includes it', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    tel.mark('llm_request_at', { source: 'gateway' });
    assert.equal(typeof tel.getSummary().timestamps.llm_request_at, 'number');
  });

  await t.test('setFallback / getFallback round-trip', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    tel.setFallback('tts_timeout', { source: 'gateway' });
    assert.equal(tel.getFallback(), 'tts_timeout');
    assert.equal(tel.getSummary().fallback_reason, 'tts_timeout');
    tel.setFallback(null);
    assert.equal(tel.getFallback(), null);
  });

  await t.test('fallback reasons use an explicit privacy-safe allowlist', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-private-error' });
    for (const value of [
      'tts_stream_error: PRIVATE exception text',
      'PRIVATE_EXCEPTION_TEXT',
      'deadnamealice',
      'sk_live_secret_value',
    ]) {
      tel.setFallback(value);
      assert.equal(tel.getFallback(), null, `rejected ${value}`);
      assert.equal(JSON.stringify(tel.toJSON()).includes(value), false);
    }
    assert.ok(FALLBACK_REASONS.includes('tts_stream_error'));
    tel.setFallback('TTS_STREAM_ERROR');
    assert.equal(tel.getFallback(), 'tts_stream_error');
  });

  await t.test('record ignores non-finite values; toJSON includes metadata', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    tel.record('llm_request_at', Number.NaN);
    assert.equal('llm_request_at' in tel.getSummary().timestamps, false);
    tel.setMetadata('audioReadyMs', 1234);
    assert.equal(tel.toJSON().metadata.audioReadyMs, 1234);
  });

  await t.test('superset API: record fallback_reason special-case + source tagging', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    tel.record('fallback_reason', 'tts_timeout', { source: 'frontend' });
    assert.equal(tel.getFallback(), 'tts_timeout');
    tel.record('llm_request_at', 1000, { source: 'frontend' });
    assert.equal(tel.getSummary().timestamps.llm_request_at, 1000);
    assert.equal(tel.toJSON().metadata.llm_request_at_source, 'frontend');
  });

  await t.test('superset API: recordRelative chains deltas; markFrontend tags source', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    tel.recordRelative('speech_end_at', 0);
    tel.recordRelative('llm_request_at', 100);
    tel.recordRelative('llm_done_at', 250);
    assert.equal(tel.getSummary().latency.llm_ms, 250);
    tel.markFrontend('playback_done_at');
    assert.equal(tel.toJSON().metadata.playback_done_at_source, 'frontend');
  });

  await t.test('superset API: setIds late-binds; record coerces Date/ISO strings', () => {
    const tel = new TurnTelemetry({ turnId: 'turn-1' });
    tel.setIds({ sessionId: 'sess-9' });
    assert.equal(tel.sessionId, 'sess-9');
    assert.equal(Object.hasOwn(tel.getSummary(), 'sessionId'), false);
    tel.record('tts_request_at', new Date(5000));
    tel.record('tts_done_at', new Date(6500).toISOString());
    assert.equal(tel.getSummary().latency.tts_total_ms, 1500);
  });

  await t.test('exposes the timestamp/bucket key surface', () => {
    assert.ok(TIMESTAMP_KEYS.includes('speech_end_at'));
    assert.ok(TIMESTAMP_KEYS.includes('playback_done_at'));
    assert.equal(TIMESTAMP_KEYS.length, 12);
    assert.equal(BUCKET_KEYS.length, 11);
  });
});
