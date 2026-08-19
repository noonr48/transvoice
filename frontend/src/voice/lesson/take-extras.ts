// Lesson surface — v1.5 take-finalize payload extras, PURE normalizers.
//
// The take-finalize payload now carries quiet, advisory side-channels alongside
// the score: the strain GUARDIAN decision, the time-lapse mirror's PIN
// suggestion, and real-sentence READINESS. The shared VoiceBackendPayload slice
// does not model them (same pattern as card.ts / replayDirective), so the lesson
// layer owns defensive normalizers here.
//
// IMPORTANT (contract): the guardian's TEMPLATE LINES already arrive as coach
// messages from the backend (inserted into the coach thread server-side). The
// frontend MUST NOT duplicate that text — its only job is the quiet VISUAL hint
// (a muted line + a calm emphasis on the existing end control). So these
// normalizers expose only the structured decision, never re-render the prose.
//
// Pure: no DOM. Runs under `node --test` after an esbuild transpile.

export type VoiceGuardianLevel = 'ease' | 'close';

export type VoiceGuardianHint = {
  level: VoiceGuardianLevel;
};

export type VoicePinSuggestion = {
  attemptId: string;
};

export type VoiceRealSentenceReadiness = {
  ready: boolean;
  takesToday: number | null;
  heldRatio: number | null;
  phrase: string | null;
};

function asTrimmedString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asFiniteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

/**
 * Normalize `payload.guardian` ({ level: 'ease' | 'close' } | null). Returns
 * null unless a recognized level is present — so an absent/`null` guardian
 * (a clean take) clears the hint.
 */
export function normalizeVoiceGuardianHint(value: unknown): VoiceGuardianHint | null {
  if (!value || typeof value !== 'object') return null;
  const level = asTrimmedString((value as Record<string, unknown>).level);
  if (level === 'ease' || level === 'close') {
    return { level };
  }
  return null;
}

/**
 * Normalize `payload.pinSuggestion` ({ attemptId } | null). Returns null unless
 * a non-empty attemptId is present (the backend offers it at most once/session;
 * the frontend also clears it on the next take).
 */
export function normalizeVoicePinSuggestion(value: unknown): VoicePinSuggestion | null {
  if (!value || typeof value !== 'object') return null;
  const attemptId = asTrimmedString((value as Record<string, unknown>).attemptId);
  if (!attemptId) return null;
  return { attemptId };
}

/**
 * Normalize `payload.realSentenceReadiness` ({ ready, takesToday, heldRatio,
 * phrase } | null). Returns null when absent (no active real_sentence card).
 */
export function normalizeVoiceRealSentenceReadiness(value: unknown): VoiceRealSentenceReadiness | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  return {
    ready: record.ready === true,
    takesToday: asFiniteNumber(record.takesToday),
    heldRatio: asFiniteNumber(record.heldRatio),
    phrase: asTrimmedString(record.phrase),
  };
}

// The quiet hint line for the guardian's "ease" level. The coach has ALREADY
// said the full template line in-thread; this is only a small visual cue, no
// alarm color. (Kept short and calm — see PRACTICE-PHILOSOPHY.md §6.)
export const GUARDIAN_EASE_HINT = 'Easy mode — sip of water, drop the volume.';
