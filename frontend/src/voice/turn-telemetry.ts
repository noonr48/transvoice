/**
 * TurnTelemetry — per-turn observability for the coaching pipeline.
 *
 * Mirrors the backend `coaching/turn-telemetry.js` module. Tracks
 * frontend-side timestamps with `performance.now()` for high resolution
 * and converts them to epoch-ms before sending to the gateway.
 *
 * The expected lifecycle is:
 *   const t = new TurnTelemetry({ turnId, sessionId });
 *   t.markFrontend('speech_end_at');                 // VAD finalized
 *   ...
 *   t.markFrontend('frontend_first_audio_at');       // audio element onplaying
 *   ...
 *   t.markFrontend('playback_done_at');              // audio element ended
 *   if (speechWasCancelled) t.setFallback('tts_cancelled');
 *   await t.sendTo(kernelUrl, fetchImpl);            // POST /voice/turns/:turnId/telemetry
 */

const SCHEMA_VERSION = 'transvoice.turn_telemetry.frontend.v1';

export const TIMESTAMP_KEYS = Object.freeze([
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

// Keep this exactly aligned with backend/coaching/turn-telemetry.js. This is a
// privacy boundary, not merely input formatting: arbitrary slug-shaped values
// may contain private identifiers or secrets.
export const FALLBACK_REASONS = Object.freeze([
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
const FALLBACK_REASON_SET = new Set<string>(FALLBACK_REASONS);

function normalizeFallbackReason(value: unknown): string | null {
  const candidate = typeof value === 'string' ? value.trim().toLowerCase() : '';
  return FALLBACK_REASON_SET.has(candidate) ? candidate : null;
}

async function deriveTelemetryCorrelationId(value: string): Promise<string | null> {
  const candidate = typeof value === 'string' ? value.trim() : '';
  const subtle = globalThis.crypto?.subtle;
  if (!candidate || !subtle) return null;
  const digest = new Uint8Array(await subtle.digest('SHA-256', new TextEncoder().encode(candidate)));
  return `tc-${Array.from(digest.slice(0, 16), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function reportTurnTelemetryFailure(code: string, status?: number): void {
  try {
    const telemetry = (globalThis as typeof globalThis & {
      __tvTelemetry?: {
        event: (
          level: 'error' | 'warn' | 'info',
          seam: string,
          failureClass: string,
          eventCode: string,
          data?: Record<string, unknown>,
        ) => void;
      };
    }).__tvTelemetry;
    telemetry?.event(
      'warn',
      'turn-telemetry',
      typeof status === 'number' ? 'contract-drift' : 'not-connected',
      code,
      typeof status === 'number' ? { status } : {},
    );
  } catch {
    // Turn telemetry is advisory and must never affect speech playback.
  }
}

function getPerformanceNow(): () => number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
    return () => performance.now();
  }
  const start = Date.now();
  return () => Date.now() - start;
}

function getEpochOffsetMs(perfNow: () => number): number {
  if (typeof Date !== 'undefined') {
    return Date.now() - Math.round(perfNow());
  }
  return 0;
}

function toEpochMs(perfMs: number, offset: number): number {
  return Math.max(0, Math.round(offset + perfMs));
}

function diffMs(earlier: number | null, later: number | null): number | null {
  if (earlier == null || later == null) return null;
  return Math.max(0, Math.round(later - earlier));
}

export type TurnTelemetryOptions = {
  turnId: string;
  sessionId?: string | null;
  now?: () => number;
  epochOffsetMs?: number;
};

export class TurnTelemetry {
  readonly turnId: string;
  sessionId: string | null;
  readonly createdAt: number;
  private readonly _now: () => number;
  private readonly _offset: number;
  private readonly _perfTimestamps: Partial<Record<typeof TIMESTAMP_KEYS[number], number>> = {};
  private readonly _metadata: Record<string, unknown> = {};
  private _sent = false;
  private _lastSendError: string | null = null;

  constructor(options: TurnTelemetryOptions) {
    if (!options || !options.turnId) {
      throw new Error('TurnTelemetry requires a turnId.');
    }
    this.turnId = options.turnId;
    this.sessionId = options.sessionId ?? null;
    this._now = options.now ?? getPerformanceNow();
    this._offset = options.epochOffsetMs ?? getEpochOffsetMs(this._now);
    this.createdAt = toEpochMs(this._now(), this._offset);
  }

  /**
   * Record a frontend-originated timestamp using `performance.now()`.
   * Re-recording the same key is allowed (overwrites, last write wins).
   */
  markFrontend(key: typeof TIMESTAMP_KEYS[number], perfValue?: number): this {
    if (!KEY_SET.has(key)) {
      throw new Error(`TurnTelemetry.markFrontend: unknown key ${key}`);
    }
    const perfMs = typeof perfValue === 'number' ? perfValue : this._now();
    this._perfTimestamps[key] = perfMs;
    return this;
  }

  /**
   * Record an absolute epoch-ms timestamp (e.g. from a server response
   * header or from another component's wall clock). Useful when the gateway
   * already produced the timestamp and the frontend is mirroring it.
   */
  recordEpoch(key: typeof TIMESTAMP_KEYS[number], epochMs: number): this {
    if (!KEY_SET.has(key)) {
      throw new Error(`TurnTelemetry.recordEpoch: unknown key ${key}`);
    }
    if (typeof epochMs !== 'number' || !Number.isFinite(epochMs)) return this;
    this._perfTimestamps[key] = epochMs - this._offset;
    return this;
  }

  setMetadata(key: string, value: unknown): this {
    this._metadata[key] = value;
    return this;
  }

  setFallback(reason: string | null): this {
    this._metadata.fallback_reason = normalizeFallbackReason(reason);
    return this;
  }

  getFallback(): string | null {
    const v = this._metadata.fallback_reason;
    return typeof v === 'string' && v ? v : null;
  }

  private getEpochTimestamps(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const key of TIMESTAMP_KEYS) {
      const perf = this._perfTimestamps[key];
      if (typeof perf === 'number') {
        out[key] = toEpochMs(perf, this._offset);
      }
    }
    return out;
  }

  private computeLatency(timestamps: Record<string, number>): Record<typeof BUCKET_KEYS[number], number | null> {
    const start = timestamps.speech_end_at ?? this.createdAt;
    return {
      voice_trainer_ms: diffMs(start, timestamps.voice_trainer_done_at),
      signal_build_ms: diffMs(
        timestamps.voice_trainer_done_at != null ? timestamps.voice_trainer_done_at : start,
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
        timestamps.frontend_first_audio_at != null ? timestamps.frontend_first_audio_at : timestamps.tts_first_byte_at,
      ),
      playback_ms: diffMs(timestamps.frontend_first_audio_at, timestamps.playback_done_at),
      total_turn_ms: diffMs(start, timestamps.playback_done_at),
    };
  }

  /**
   * Build the on-the-wire payload (matches the backend's getSummary shape).
   */
  getSummary(): {
    schema: string;
    recordedAt: number;
    timestamps: Record<string, number>;
    latency: Record<typeof BUCKET_KEYS[number], number | null>;
    fallback_reason: string | null;
  } {
    const timestamps = this.getEpochTimestamps();
    return {
      schema: SCHEMA_VERSION,
      recordedAt: this.createdAt,
      timestamps,
      latency: this.computeLatency(timestamps),
      fallback_reason: this.getFallback(),
    };
  }

  /**
   * Full JSON shape including metadata.
   */
  toJSON(): ReturnType<typeof this.getSummary> & { metadata: Record<string, unknown> } {
    return {
      ...this.getSummary(),
      metadata: {},
    };
  }

  /**
   * POST the current record to the gateway. Safe to call multiple times;
   * subsequent calls are best-effort and record lastSendError on the
   * instance for diagnostics.
   *
   * @param {string} kernelUrl - base URL of the voice kernel
   * @param {typeof fetch} [fetchImpl] - override fetch (e.g. for tests)
   * @returns {Promise<boolean>} true on a 2xx response, false otherwise
   */
  async sendTo(kernelUrl: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
    if (!kernelUrl) return false;
    const correlationId = await deriveTelemetryCorrelationId(this.turnId).catch(() => null);
    if (!correlationId) {
      reportTurnTelemetryFailure('turn-telemetry-network');
      return false;
    }
    const url = `${kernelUrl.replace(/\/$/, '')}/voice/turns/${encodeURIComponent(correlationId)}/telemetry`;
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          timestamps: this.getEpochTimestamps(),
          fallback_reason: this.getFallback(),
        }),
        keepalive: true,
      });
      this._sent = response.ok;
      this._lastSendError = response.ok ? null : `HTTP ${response.status}`;
      if (!response.ok) reportTurnTelemetryFailure('turn-telemetry-http', response.status);
      return response.ok;
    } catch (error) {
      this._lastSendError = (error as Error)?.message || String(error);
      reportTurnTelemetryFailure('turn-telemetry-network');
      return false;
    }
  }

  wasSent(): boolean {
    return this._sent;
  }

  getLastSendError(): string | null {
    return this._lastSendError;
  }
}

export const __test__ = Object.freeze({
  SCHEMA_VERSION,
  TIMESTAMP_KEYS,
  BUCKET_KEYS,
  FALLBACK_REASONS,
  deriveTelemetryCorrelationId,
  diffMs,
  normalizeFallbackReason,
  toEpochMs,
});
