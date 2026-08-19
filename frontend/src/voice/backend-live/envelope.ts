import type { VoiceBackendPayload } from '../contracts';

export type VoiceInputLiveEvent =
  | 'session-started'
  | 'capture-ready'
  | 'speech-start'
  | 'speech-end'
  | 'barge-in'
  | 'partial-transcript'
  | 'processing'
  | 'final-transcript'
  | 'no-speech'
  | 'error'
  | 'pong';

type VoiceInputLiveEnvelopeBase = VoiceBackendPayload & {
  type?: string;
  event: VoiceInputLiveEvent;
  emittedAt?: number;
  sessionId?: unknown;
  liveSessionId?: unknown;
  providers?: unknown;
};

export type VoiceInputLiveEnvelope =
  | (VoiceInputLiveEnvelopeBase & {
    event: 'session-started';
    liveSessionId?: unknown;
  })
  | (VoiceInputLiveEnvelopeBase & {
    event: 'capture-ready';
    segmentId?: unknown;
    /**
     * Why capture was re-armed. Absent on a plain arm; set when the backend
     * recovered from an outcome that ended the take (backend/voice-input-live.js).
     * Known values today:
     *   'asr-no-speech'         — the ASR round-trip found no speech, so the
     *                             take was LOST and listening simply continued.
     *   'wordless-practice-ack' — a non-failure acknowledgment; nothing lost.
     *   'semantic-retry'        — voice evidence landed but the requested
     *                             sentence words did not; repeat in place.
     * Typed `unknown` and read defensively: the backend may add values, and an
     * unrecognized one must behave exactly like a plain arm.
     */
    recoveredFrom?: unknown;
    /**
     * Optional warm line for the coach thread carried by a non-failure
     * acknowledgment. `coachLine` is this codebase's existing name for it
     * (see VoiceRealSentenceOutcomeResponse); `ackLine` is accepted as a
     * tolerant alias while the backend half settles.
     */
    coachLine?: unknown;
    ackLine?: unknown;
  })
  | (VoiceInputLiveEnvelopeBase & {
    event: 'speech-start' | 'speech-end' | 'barge-in' | 'processing' | 'no-speech' | 'pong';
    segmentId?: unknown;
  })
  | (VoiceInputLiveEnvelopeBase & {
    event: 'partial-transcript';
    segmentId?: unknown;
    transcript?: unknown;
    confidence?: unknown;
  })
  | (VoiceInputLiveEnvelopeBase & {
    event: 'final-transcript';
    segmentId?: unknown;
    listeningTurnId?: unknown;
    transcript?: unknown;
    confidence?: unknown;
    autoSubmit?: unknown;
    routeError?: unknown;
  })
  | (VoiceInputLiveEnvelopeBase & {
    event: 'error';
    error?: unknown;
  });

function normalizeEvent(value: unknown): VoiceInputLiveEvent | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  switch (normalized) {
    case 'session-started':
    case 'capture-ready':
    case 'speech-start':
    case 'speech-end':
    case 'barge-in':
    case 'partial-transcript':
    case 'processing':
    case 'final-transcript':
    case 'no-speech':
    case 'error':
    case 'pong':
      return normalized;
    default:
      return null;
  }
}

export function parseVoiceInputLiveEnvelope(payload: unknown): VoiceInputLiveEnvelope | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const event = normalizeEvent((payload as { event?: unknown }).event);
  if (!event) {
    return null;
  }
  return payload as VoiceInputLiveEnvelope;
}
