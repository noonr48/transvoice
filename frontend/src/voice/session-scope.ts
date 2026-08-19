// Abandon-trigger fix 6 — ambient session-scope (tier) indicator.
//
// A small calm control in the coach rail header showing how the person is
// practicing right now — "Speaking freely" / "Keeping it quiet" / "Just
// listening" — tappable to cycle tiers. It is a CONTROL, never a startup
// prompt: no modal, no gate, nothing blocks practice (owner ruling 2026-07-19:
// tier capture is passive/ambient). Backend contract (B-SESS): the session
// payload may carry `sessionScope { tier, eyesFree }` in its extras, and
// POST /voice/session/:sessionId/scope persists a change. Both halves are
// optional — with no backend field the indicator still works locally
// (localStorage `tvSessionScope`), and a failed POST is a quiet no-op.
//
// Module pattern follows sound-spelling.ts: self-contained DOM lookups (absent
// nodes disable the surface), own listeners, dispose() tears down.

export const VOICE_SESSION_SCOPE_STORAGE_KEY = 'tvSessionScope';

export type VoiceSessionTier = 'speaking' | 'quiet' | 'listening';

/** Cycle order for the tap: full voice → hushed → receptive. */
export const VOICE_SESSION_TIER_ORDER: VoiceSessionTier[] = ['speaking', 'quiet', 'listening'];

/** Calm ink labels — states of the moment, not modes to configure. */
export const VOICE_SESSION_TIER_LABELS: Record<VoiceSessionTier, string> = {
  speaking: 'Speaking freely',
  quiet: 'Keeping it quiet',
  listening: 'Just listening',
};

/** The backend wire vocabulary (B-SESS, confirmed live): sessionScope.tier is
 *  'full' | 'quiet' | 'silent', and POST /voice/session/:id/scope 400s on
 *  anything else — so the POST always speaks wire, never the calm labels or
 *  the canonical frontend keys. */
export const VOICE_SESSION_TIER_WIRE: Record<VoiceSessionTier, string> = {
  speaking: 'full',
  quiet: 'quiet',
  listening: 'silent',
};

/** Accessible name for the control — describes, never instructs urgency. */
export const VOICE_SESSION_SCOPE_ARIA_LABEL =
  'How you are practicing right now — tap to change';

/**
 * Defensive tier normalization: the backend owns its vocabulary, the indicator
 * owns a calm mapping. Unknown values return null (caller keeps its current
 * tier) so a contract drift can never blank the control.
 */
export function normalizeVoiceSessionTier(value: unknown): VoiceSessionTier | null {
  if (typeof value !== 'string') {
    return null;
  }
  const key = value.trim().toLowerCase();
  if (key === 'speaking' || key === 'full' || key === 'free' || key === 'open') {
    return 'speaking';
  }
  if (key === 'quiet' || key === 'hushed' || key === 'low' || key === 'soft') {
    return 'quiet';
  }
  if (key === 'listening' || key === 'listen' || key === 'silent' || key === 'receptive') {
    return 'listening';
  }
  return null;
}

export type VoiceSessionScopePayloadView = {
  tier: VoiceSessionTier | null;
  eyesFree: boolean | null;
};

/**
 * Pull `sessionScope` out of a session/backend payload defensively — it may
 * sit at the top level or under `extras`, or be absent entirely.
 */
export function extractVoiceSessionScope(payload: unknown): VoiceSessionScopePayloadView | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const extras = record.extras && typeof record.extras === 'object'
    ? record.extras as Record<string, unknown>
    : null;
  const rawScope = record.sessionScope ?? extras?.sessionScope;
  if (!rawScope || typeof rawScope !== 'object') {
    return null;
  }
  const scope = rawScope as Record<string, unknown>;
  return {
    tier: normalizeVoiceSessionTier(scope.tier),
    eyesFree: typeof scope.eyesFree === 'boolean' ? scope.eyesFree : null,
  };
}

type VoiceSessionScopeStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type VoiceSessionScopeOptions = {
  doc: Document;
  /** Persist the change to the backend (api.postVoiceSessionScope). Receives the
   *  WIRE tier ('full' | 'quiet' | 'silent' — the only values the route
   *  accepts); rejections are swallowed here — the local state already
   *  applied. */
  updateScope?: (wireTier: string) => Promise<unknown>;
  /** Injectable for tests; defaults to window.localStorage (null-safe). */
  storage?: VoiceSessionScopeStorage | null;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

function resolveDefaultStorage(): VoiceSessionScopeStorage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function setupVoiceSessionScope(options: VoiceSessionScopeOptions) {
  const { doc } = options;
  const storage = options.storage !== undefined ? options.storage : resolveDefaultStorage();
  const buttonEl = doc.getElementById('voice-session-scope') as HTMLButtonElement | null;

  let tier: VoiceSessionTier = 'speaking';
  let eyesFree: boolean | null = null;
  /** After a manual tap the person's choice wins over later payload echoes. */
  let userChosen = false;
  /** The remembered-habit seed (greeting.tierDefault) fires at most once. */
  let seeded = false;
  let onClick: (() => void) | null = null;

  function log(kind: 'system' | 'warning', message: string): void {
    options.addLog?.(kind, message);
  }

  function render(): void {
    if (!buttonEl) {
      return;
    }
    buttonEl.textContent = VOICE_SESSION_TIER_LABELS[tier];
    buttonEl.dataset.tier = tier;
    buttonEl.setAttribute('aria-label', `${VOICE_SESSION_SCOPE_ARIA_LABEL} (now: ${VOICE_SESSION_TIER_LABELS[tier]})`);
    buttonEl.title = VOICE_SESSION_SCOPE_ARIA_LABEL;
  }

  function persistLocal(): void {
    try {
      storage?.setItem(VOICE_SESSION_SCOPE_STORAGE_KEY, tier);
    } catch {
      /* storage unavailable — the in-session state still applies */
    }
  }

  function pushToBackend(): void {
    if (!options.updateScope) {
      return;
    }
    void options.updateScope(VOICE_SESSION_TIER_WIRE[tier]).catch((error) => {
      // Defensive: a failed sync is a quiet no-op — the local state already applied.
      log('system', `[session-scope] backend sync skipped: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  function setTier(next: VoiceSessionTier, source: 'tap' | 'payload'): void {
    tier = next;
    if (source === 'tap') {
      userChosen = true;
      persistLocal();
      pushToBackend();
      log('system', `[session-scope] ${VOICE_SESSION_TIER_LABELS[tier]}`);
    }
    render();
  }

  function cycle(): void {
    const index = VOICE_SESSION_TIER_ORDER.indexOf(tier);
    const next = VOICE_SESSION_TIER_ORDER[(index + 1) % VOICE_SESSION_TIER_ORDER.length];
    setTier(next, 'tap');
  }

  /** Adopt the backend's remembered scope (session payload extras) — only
   *  until the person taps; their in-session choice is never overridden. */
  function applySessionPayload(payload: unknown): void {
    const scope = extractVoiceSessionScope(payload);
    if (!scope) {
      return;
    }
    if (scope.eyesFree !== null) {
      eyesFree = scope.eyesFree;
    }
    if (scope.tier && !userChosen) {
      setTier(scope.tier, 'payload');
    }
  }

  /** B-SESS addendum: the greeting may carry the learner's remembered daypart
   *  tier (`greeting.tierDefault`, wire vocabulary). When the session is still
   *  at the default 'full' and the person hasn't tapped, seed the session with
   *  the remembered habit ONCE — silently: UI adopts it and the scope route is
   *  posted, with no ceremony and never overriding an in-session choice. */
  function seedFromGreeting(tierDefault: unknown): void {
    if (userChosen || seeded) {
      return;
    }
    const remembered = normalizeVoiceSessionTier(tierDefault);
    if (!remembered || remembered === tier) {
      return;
    }
    if (tier !== 'speaking') {
      // The session already carries a non-default scope — leave it alone.
      return;
    }
    seeded = true;
    setTier(remembered, 'payload');
    pushToBackend();
    log('system', `[session-scope] seeded from remembered habit: ${VOICE_SESSION_TIER_LABELS[remembered]}`);
  }

  function start(): void {
    if (!buttonEl) {
      return;
    }
    try {
      const stored = normalizeVoiceSessionTier(storage?.getItem(VOICE_SESSION_SCOPE_STORAGE_KEY));
      if (stored) {
        tier = stored;
      }
    } catch {
      /* default stands */
    }
    render();
    buttonEl.classList.remove('hidden');
    if (!onClick) {
      onClick = () => cycle();
      buttonEl.addEventListener('click', onClick);
    }
  }

  function dispose(): void {
    if (buttonEl && onClick) {
      buttonEl.removeEventListener('click', onClick);
      onClick = null;
    }
  }

  return {
    start,
    dispose,
    cycle,
    applySessionPayload,
    seedFromGreeting,
    getTier: () => tier,
    getEyesFree: () => eyesFree,
  };
}

export type VoiceSessionScope = ReturnType<typeof setupVoiceSessionScope>;
