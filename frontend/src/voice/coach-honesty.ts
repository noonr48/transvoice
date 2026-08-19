// Surfacing wave — honesty surfaces for the coach rail.
//
// Two quiet, factual status lines (template nodes; calm, never alarming):
//   (a) #voice-coach-fallback-note — shown when a coach payload carries
//       `fallbackReply: true` (the backend's basic-guidance mode; the flag is
//       being added by the backend builder — coded defensively here, absent
//       flag = no-op). Clears on the next REAL coach reply (a payload whose
//       coachThread ends with a coach message and no fallback flag).
//   (b) #voice-speech-standin-note — shown ONCE per session when a speech
//       response reports `X-Reference-Resolved: false` (the selected tutor
//       voice was unavailable and speech was withheld). coach-speech.ts
//       reads the header on the streaming path and forwards it here through a
//       module-level listener (the transport layer stays DOM-free).
//
// Self-contained module: owns its DOM lookups (absent nodes disable that
// surface) — the same pattern the lesson controller uses.

let activeReferenceResolutionListener: ((resolved: boolean) => void) | null = null;

/**
 * Transport-side entry: forward a speech response's reference-resolution flag
 * to the active honesty surface (no-op before setup / after dispose).
 */
export function noteVoiceSpeechReferenceResolution(resolved: boolean): void {
  activeReferenceResolutionListener?.(resolved);
}

export type VoiceCoachHonestyOptions = {
  doc: Document;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

/** True when the payload's voiceState carries a coach reply (thread ends with a coach turn). */
function carriesCoachReply(voiceState: Record<string, unknown> | null): boolean {
  const thread = voiceState?.coachThread;
  if (!Array.isArray(thread) || thread.length === 0) return false;
  const last = readRecord(thread[thread.length - 1]);
  return last?.role === 'coach';
}

export function setupVoiceCoachHonesty(options: VoiceCoachHonestyOptions) {
  const fallbackEl = options.doc.getElementById('voice-coach-fallback-note');
  const standinEl = options.doc.getElementById('voice-speech-standin-note');

  let fallbackShown = false;
  let standinShownThisSession = false;

  function log(kind: 'system' | 'warning', message: string): void {
    options.addLog?.(kind, message);
  }

  function setFallbackShown(shown: boolean): void {
    if (shown === fallbackShown) return;
    fallbackShown = shown;
    fallbackEl?.classList.toggle('hidden', !shown);
    fallbackEl?.setAttribute('aria-hidden', shown ? 'false' : 'true');
    log('system', shown ? '[voice-surface] fallback chip on' : '[voice-surface] fallback chip off');
  }

  /**
   * Feed every RAW backend payload through here (the standalone onBackendPayload
   * seam — the shared slice contract drops unknown fields like fallbackReply).
   */
  function applyCoachPayload(payload: unknown): void {
    const record = readRecord(payload);
    if (!record) return;
    const voiceState = readRecord(record.voiceState);
    const fallbackFlag = record.fallbackReply === true || voiceState?.fallbackReply === true;
    if (fallbackFlag) {
      setFallbackShown(true);
      return;
    }
    // Clear only on the next real coach reply — unrelated payloads (session
    // sync, take frames) must not silently retire the notice.
    if (fallbackShown && carriesCoachReply(voiceState)) {
      setFallbackShown(false);
    }
  }

  function noteReferenceResolution(resolved: boolean): void {
    if (resolved || standinShownThisSession || !standinEl) return;
    standinShownThisSession = true;
    standinEl.classList.remove('hidden');
    standinEl.setAttribute('aria-hidden', 'false');
    log('system', '[voice-surface] tutor voice unavailable notice shown');
  }

  function start(): void {
    activeReferenceResolutionListener = noteReferenceResolution;
  }

  function dispose(): void {
    if (activeReferenceResolutionListener === noteReferenceResolution) {
      activeReferenceResolutionListener = null;
    }
  }

  return {
    start,
    dispose,
    applyCoachPayload,
    noteReferenceResolution,
    isFallbackShown: () => fallbackShown,
  };
}

export type VoiceCoachHonesty = ReturnType<typeof setupVoiceCoachHonesty>;

// ── Backend-payload tee ──────────────────────────────────────────────────────
// The live coach-reply paths apply payloads through the request controller and
// the controller-graph local apply — neither goes through the host-assembly
// onBackendPayload tee, so the honesty surface would never see fallbackReply on
// a real coach turn. Those apply sites emit this DOM event; the app binds it to
// applyCoachPayload once at bootstrap. Kept as a document event (not option
// threading) so the tee cannot be dropped again by a new apply-site.
const BACKEND_PAYLOAD_TEE_EVENT = 'tv-backend-payload';

export function emitBackendPayloadTee(payload: unknown): void {
  if (typeof document === 'undefined' || !payload) return;
  try {
    document.dispatchEvent(new CustomEvent(BACKEND_PAYLOAD_TEE_EVENT, { detail: payload }));
  } catch {
    // CustomEvent unavailable — honesty tee silently skipped (chip stays defensive).
  }
}

export function bindBackendPayloadTee(apply: (payload: unknown) => void): () => void {
  if (typeof document === 'undefined') return () => {};
  const listener = (event: Event): void => {
    apply((event as CustomEvent).detail);
  };
  document.addEventListener(BACKEND_PAYLOAD_TEE_EVENT, listener);
  return () => document.removeEventListener(BACKEND_PAYLOAD_TEE_EVENT, listener);
}
