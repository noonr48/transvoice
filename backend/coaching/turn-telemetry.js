'use strict';

const crypto = require('crypto');

/**
 * TurnTelemetry — per-turn observability for the realtime coaching pipeline.
 *
 * The voice-standalone runtime stamps wall-clock checkpoints across a coaching
 * turn (voice-trainer done, signal built, LLM request/first-token/done,
 * sanitizer done, TTS request/first-byte/done, playback done) and reads back
 * derived latency buckets via `getSummary()`. The frontend peer
 * `src/voice/turn-telemetry.ts` mirrors this module's summary contract and POSTs
 * its own timestamps to `/voice/turns/:turnId/telemetry`, where they are merged
 * via `record()`; the route returns `getSummary()` verbatim, so the summary shape
 * here is the source of truth.
 *
 * Backend time is `Date.now()` epoch-ms throughout (no performance.now offset
 * machinery — that is frontend-only). A `now` override may be injected for tests.
 */

const SCHEMA_VERSION = 'transvoice.turn_telemetry.gateway.v1';

// Wall-clock checkpoints, in pipeline order. Only keys in this set may be marked.
const TIMESTAMP_KEYS = Object.freeze([
  'speech_end_at',
  'voice_trainer_done_at',
  'coaching_signal_done_at',
  'llm_request_at',
  'llm_first_token_at',
  'llm_done_at',
  'sanitizer_done_at',
  'tts_request_at',
  'tts_first_byte_at',
  'tts_done_at',
  'frontend_first_audio_at',
  'playback_done_at',
]);

// Derived latency buckets returned by getSummary().latency.
const BUCKET_KEYS = Object.freeze([
  'voice_trainer_ms',
  'signal_build_ms',
  'llm_ms',
  'llm_ttft_ms',
  'sanitizer_ms',
  'tts_request_ms',
  'tts_total_ms',
  'tts_first_byte_ms',
  'time_to_first_audio_ms',
  'playback_ms',
  'total_turn_ms',
]);

const KEY_SET = new Set(TIMESTAMP_KEYS);

// Privacy boundary: values crossing the telemetry seam must be selected from
// this fixed categorical vocabulary. Shape validation alone is insufficient —
// private names, tokens, or exception identifiers can also look like slugs.
const FALLBACK_REASONS = Object.freeze([
  'model_error',
  'empty_content',
  'no_model',
  'stream_error',
  'tts_reference_unavailable',
  'tts_http_error',
  'tts_timeout',
  'tts_cancelled',
  'tts_stream_error',
  'tts_network_error',
  'voxcpm_failed_browser_fallback',
  'browser_tts_direct',
]);
const FALLBACK_REASON_SET = new Set(FALLBACK_REASONS);

function deriveTelemetryCorrelationId(value) {
  const candidate = typeof value === 'string' ? value.trim() : '';
  if (!candidate) return null;
  return `tc-${crypto.createHash('sha256').update(candidate).digest('hex').slice(0, 32)}`;
}

function normalizeFallbackReason(value) {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return FALLBACK_REASON_SET.has(candidate) ? candidate : null;
}

/** Null-safe, non-negative, rounded duration between two epoch-ms timestamps. */
function diffMs(earlier, later) {
  if (!Number.isFinite(earlier) || !Number.isFinite(later)) return null;
  return Math.max(0, Math.round(later - earlier));
}

/** Coerce a number | Date | ISO string into epoch-ms (null if unparseable). */
function toMs(value) {
  if (value == null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.round(value));
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

class TurnTelemetry {
  constructor(options) {
    if (!options || !options.turnId) {
      throw new Error('TurnTelemetry requires a turnId.');
    }
    this.turnId = options.turnId;
    this.sessionId = options.sessionId ?? null;
    this._now = typeof options.now === 'function' ? options.now : Date.now;
    this.createdAt = this._now();
    this._timestamps = {};
    this._metadata = {};
    this._previousMark = null;
  }

  /** Late-bind turn/session ids (e.g. once a sparse frontend record gains context). */
  setIds({ turnId, sessionId } = {}) {
    if (turnId) this.turnId = turnId;
    if (sessionId) this.sessionId = sessionId;
    return this;
  }

  /**
   * Stamp `name` with the current wall clock. `meta.source` (e.g.
   * `{ source: 'gateway' }`) is stored as `<name>_source` metadata.
   */
  mark(name, meta) {
    return this.record(name, this._now(), meta);
  }

  /** mark() tagged with source 'frontend'. */
  markFrontend(key) {
    return this.mark(key, { source: 'frontend' });
  }

  /**
   * Record an absolute timestamp for `key` (number | Date | ISO string,
   * e.g. mirrored from the frontend POST). Unparseable values are ignored.
   * `key === 'fallback_reason'` is accepted as a metadata special-case so a
   * frontend that folds it into its timestamps payload still round-trips.
   */
  record(key, value, meta) {
    if (!KEY_SET.has(key) && key !== 'fallback_reason') {
      throw new Error(`TurnTelemetry.record: unknown key ${key}`);
    }
    const source = meta && typeof meta.source === 'string' ? meta.source : null;
    if (key === 'fallback_reason') {
      return this.setFallback(value, meta);
    }
    const ms = toMs(value);
    if (ms == null) return this;
    this._timestamps[key] = ms;
    if (source) {
      this._metadata[`${key}_source`] = source;
    }
    return this;
  }

  /**
   * Record `key` as a delta (ms) from the previous relative mark (or from
   * createdAt for the first one). Useful for replaying stage durations.
   */
  recordRelative(key, deltaMs, meta) {
    if (!KEY_SET.has(key)) {
      throw new Error(`TurnTelemetry.recordRelative: unknown key ${key}`);
    }
    const base = this._previousMark != null ? this._previousMark : this.createdAt;
    this._timestamps[key] = base + Math.max(0, Math.round(deltaMs));
    this._previousMark = this._timestamps[key];
    const source = meta && typeof meta.source === 'string' ? meta.source : null;
    if (source) {
      this._metadata[`${key}_source`] = source;
    }
    return this;
  }

  setMetadata(key, value) {
    this._metadata[key] = value;
    return this;
  }

  setFallback(reason, meta) {
    this._metadata.fallback_reason = normalizeFallbackReason(reason);
    this._metadata.fallback_source = meta && typeof meta.source === 'string' ? meta.source : 'gateway';
    return this;
  }

  getFallback() {
    const value = this._metadata.fallback_reason;
    return typeof value === 'string' && value ? value : null;
  }

  /** Recorded checkpoints only, in pipeline order (epoch-ms). */
  _epochTimestamps() {
    const out = {};
    for (const key of TIMESTAMP_KEYS) {
      const value = this._timestamps[key];
      if (typeof value === 'number') out[key] = value;
    }
    return out;
  }

  _computeLatency(timestamps) {
    const start = timestamps.speech_end_at ?? this.createdAt;
    return {
      voice_trainer_ms: diffMs(start, timestamps.voice_trainer_done_at),
      signal_build_ms: diffMs(
        timestamps.voice_trainer_done_at ?? start,
        timestamps.coaching_signal_done_at,
      ),
      llm_ms: diffMs(timestamps.llm_request_at, timestamps.llm_done_at),
      llm_ttft_ms: diffMs(timestamps.llm_request_at, timestamps.llm_first_token_at),
      sanitizer_ms: diffMs(timestamps.llm_done_at, timestamps.sanitizer_done_at),
      tts_request_ms: diffMs(timestamps.sanitizer_done_at, timestamps.tts_request_at),
      tts_total_ms: diffMs(timestamps.tts_request_at, timestamps.tts_done_at),
      tts_first_byte_ms: diffMs(timestamps.tts_request_at, timestamps.tts_first_byte_at),
      time_to_first_audio_ms: diffMs(
        start,
        timestamps.frontend_first_audio_at ?? timestamps.tts_first_byte_at,
      ),
      playback_ms: diffMs(timestamps.frontend_first_audio_at, timestamps.playback_done_at),
      total_turn_ms: diffMs(start, timestamps.playback_done_at),
    };
  }

  /** On-the-wire payload; mirrored by the frontend peer and returned by the route. */
  getSummary() {
    const timestamps = this._epochTimestamps();
    return {
      schema: SCHEMA_VERSION,
      correlationId: deriveTelemetryCorrelationId(this.turnId),
      recordedAt: this.createdAt,
      timestamps,
      latency: this._computeLatency(timestamps),
      fallback_reason: this.getFallback(),
    };
  }

  /** Full JSON shape including arbitrary metadata. */
  toJSON() {
    return {
      ...this.getSummary(),
      metadata: { ...this._metadata },
    };
  }
}

module.exports = {
  TurnTelemetry,
  TIMESTAMP_KEYS,
  BUCKET_KEYS,
  FALLBACK_REASONS,
  SCHEMA_VERSION,
  deriveTelemetryCorrelationId,
  __test__: Object.freeze({
    SCHEMA_VERSION,
    TIMESTAMP_KEYS,
    BUCKET_KEYS,
    FALLBACK_REASONS,
    deriveTelemetryCorrelationId,
    diffMs,
    normalizeFallbackReason,
    toMs,
  }),
};
