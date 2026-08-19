import type {
  VoiceCoachGreeting,
  VoiceCoachGreetingResponse,
  VoiceLearnerMemoProfileResponse,
  VoiceLearnerMemoRecentAttempt,
  VoiceLearnerMemoSnapshot,
  VoiceReferenceAnalyzeResponse,
  VoiceBackendPayload,
} from './api';

/**
 * P2 (memory/continuity) — welcome-back card + continuity greeting.
 *
 * Design principle (LESSON-EXPERIENCE-DESIGN §1, §6): when a known learner
 * returns and NO durable session restores, replace the blank front door with a
 * warm, minimal card carrying ONE next action ("Continue practice" — re-attach
 * their last target voice and drop straight into the stage). A returning learner
 * is greeted by name and reminded of continuity; an unknown learner sees the
 * normal front door, untouched.
 *
 * This module owns only the welcome-back surface. It does NOT modify the front
 * door's own visibility logic (shouldShowVoiceFrontDoor); it gates AROUND it via
 * the injected `showFrontDoor` / `revealPracticeStage` callbacks, so the two
 * never fight over the DOM.
 */

export interface VoiceWelcomeBackElements {
  welcomeBackEl: HTMLElement | null;
  titleEl: HTMLElement | null;
  targetEl: HTMLElement | null;
  statEl: HTMLElement | null;
  continueBtn: HTMLButtonElement | null;
  changeBtn: HTMLButtonElement | null;
  noteEl: HTMLElement | null;
}

export interface VoiceWelcomeBackOptions {
  /** Standalone session id (for the greeting fetch + reference sync). */
  sessionId: string;
  /** Learner id (defaults to the backend default when omitted/blank). */
  studentId?: string | null;
  /**
   * Whether a durable session is being restored this load. When true the card
   * is suppressed entirely — the restored session already has its own context
   * and greeting path. (LESSON-EXPERIENCE-DESIGN: the card is the *no restore*
   * fallback for known returning learners.)
   */
  hasRestorableSession: boolean;
  /** Fetch the learner snapshot carrying the memo fields. */
  getMemoProfile: (studentId: string) => Promise<VoiceLearnerMemoProfileResponse>;
  /** Fetch the deterministic two-line continuity greeting. */
  getCoachGreeting: (sessionId: string, studentId?: string | null) => Promise<VoiceCoachGreetingResponse>;
  /** Fetch a reference analysis by clipId (to re-attach the last target). */
  getReferenceAnalysis: (clipId: string) => Promise<VoiceReferenceAnalyzeResponse>;
  /** Re-attach a reference to the live session (the existing sync path). */
  syncReference: (
    sessionId: string,
    referenceClipId: string | null,
    referenceClipName: string,
  ) => Promise<VoiceBackendPayload>;
  /**
   * Adopt a resolved reference analysis into the live UI state, then reveal the
   * practice stage (hide both the front door and this card). Receives the synced
   * backend payload + the resolved analysis so the caller can patch UI state the
   * same way the upload path does.
   */
  onContinuePractice: (context: {
    backendPayload: VoiceBackendPayload | null;
    analysis: VoiceReferenceAnalyzeResponse;
    reference: { clipId: string; name: string };
  }) => void;
  /**
   * Reveal the normal front door (the "Change target voice" / failure path).
   * Called when the user dismisses the card or a re-attach fails. The caller's
   * implementation re-runs its own front-door visibility refresh.
   */
  showFrontDoor: () => void;
  /**
   * Toggle ONLY the front-door section's `.hidden` class (our own gate; we do
   * NOT touch shouldShowVoiceFrontDoor's logic). Used to suppress the door while
   * the card is up, per the design contract.
   */
  setFrontDoorHidden: (hidden: boolean) => void;
  /** Append the continuity greeting into the coach thread (survives re-render). */
  appendCoachGreeting?: (greeting: VoiceCoachGreeting) => void;
  /** Optional log sink. */
  log?: (type: string, message: string) => void;
  /** DOM resolver (defaults to the global document). */
  documentRef?: Document;
}

export interface VoiceWelcomeBackHandle {
  /** Whether the welcome-back card is currently showing instead of the front door. */
  isShowing: () => boolean;
  /** Force-hide the card (e.g. if another flow takes over). */
  dismiss: () => void;
  /**
   * Surfacing wave (first-run greeting): fire the SAME greeting path returning
   * learners get, exactly once. Called by the app when the front door completes
   * on a first run (target voice attached). No-ops when a greeting already
   * fired (returning learner / restored session) — the double-greet guard.
   */
  greetFirstRun: () => void;
}

function resolveElements(documentRef: Document): VoiceWelcomeBackElements {
  const byId = <T extends HTMLElement>(id: string): T | null => (
    documentRef.getElementById(id) as T | null
  );
  return {
    welcomeBackEl: byId<HTMLElement>('voice-welcome-back'),
    titleEl: byId<HTMLElement>('voice-welcome-back-title'),
    targetEl: byId<HTMLElement>('voice-welcome-back-target'),
    statEl: byId<HTMLElement>('voice-welcome-back-stat'),
    continueBtn: byId<HTMLButtonElement>('voice-welcome-back-continue'),
    changeBtn: byId<HTMLButtonElement>('voice-welcome-back-change'),
    noteEl: byId<HTMLElement>('voice-welcome-back-note'),
  };
}

function str(value: unknown, max = 160): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Read the memo snapshot off the response (the backend mirrors the memo fields
 * both at the top level and inside `learnerContext`). Tolerant of either shape.
 */
function readMemoSnapshot(response: VoiceLearnerMemoProfileResponse | null): VoiceLearnerMemoSnapshot {
  const top = (response && typeof response === 'object' ? response : {}) as VoiceLearnerMemoSnapshot;
  const nested = (response?.learnerContext && typeof response.learnerContext === 'object'
    ? response.learnerContext
    : {}) as VoiceLearnerMemoSnapshot;
  return {
    studentId: top.studentId ?? nested.studentId ?? null,
    masteryLevel: top.masteryLevel ?? nested.masteryLevel ?? null,
    profile: top.profile ?? nested.profile ?? null,
    whatWorked: top.whatWorked ?? nested.whatWorked ?? null,
    lastReference: top.lastReference ?? nested.lastReference ?? null,
    recentAttempts: top.recentAttempts ?? nested.recentAttempts ?? null,
  };
}

/**
 * Compose the "last session" stat line: attempts count + a streak proxy
 * (consecutive most-recent usable takes with canonical targetHitPct >= 0.70).
 * Historical percent-unit records are normalized for continuity. Returns ''
 * when there's nothing meaningful to show.
 */
function buildStatLine(recentAttempts: VoiceLearnerMemoRecentAttempt[] | null | undefined): string {
  const attempts = Array.isArray(recentAttempts)
    ? recentAttempts.filter((attempt) => attempt?.usableForLearning !== false)
    : [];
  if (attempts.length === 0) {
    return '';
  }
  // recentAttempts is newest-last; walk backwards for the streak.
  let streak = 0;
  for (let index = attempts.length - 1; index >= 0; index -= 1) {
    const hit = Number(attempts[index]?.targetHitPct);
    const hitFraction = Number.isFinite(hit) && Math.abs(hit) > 1 ? hit / 100 : hit;
    if (Number.isFinite(hitFraction) && hitFraction >= 0.70) {
      streak += 1;
    } else {
      break;
    }
  }
  const countPart = `${attempts.length} take${attempts.length === 1 ? '' : 's'} logged`;
  return streak >= 2 ? `${countPart} · ${streak} on-target in a row` : countPart;
}

export function setupVoiceWelcomeBack(options: VoiceWelcomeBackOptions): VoiceWelcomeBackHandle {
  const documentRef = options.documentRef
    || (typeof document !== 'undefined' ? document : null);
  const log = options.log || (() => undefined);

  let showing = false;

  const noop: VoiceWelcomeBackHandle = {
    isShowing: () => showing,
    dismiss: () => undefined,
    greetFirstRun: () => undefined,
  };

  if (!documentRef) {
    return noop;
  }

  const elements = resolveElements(documentRef);
  if (!elements.welcomeBackEl) {
    return noop;
  }

  const studentId = str(options.studentId, 160) || 'default-voice-learner';

  function hideCard(): void {
    showing = false;
    elements.welcomeBackEl?.classList.add('hidden');
  }

  function showNote(message: string): void {
    if (!elements.noteEl) return;
    elements.noteEl.textContent = message;
    elements.noteEl.classList.toggle('hidden', !message);
  }

  // Surfacing wave: single-fire guard shared by the returning-learner greeting
  // and the first-run greeting — whichever fires first wins, the other no-ops.
  let greetingRequested = false;

  const handle: VoiceWelcomeBackHandle = {
    isShowing: () => showing,
    dismiss: hideCard,
    greetFirstRun: () => {
      if (greetingRequested) return;
      log('system', '[voice-surface] first-run greeting');
      appendGreeting();
    },
  };

  // The greeting is independent of the card: append it whenever a known learner
  // returns (card shown OR session restored), so a returning user is always
  // greeted. Fire-and-forget; never blocks rendering.
  function appendGreeting(): void {
    if (!options.appendCoachGreeting) return;
    if (greetingRequested) return;
    greetingRequested = true;
    void options.getCoachGreeting(options.sessionId, studentId)
      .then((response) => {
        const greeting = response?.greeting;
        if (greeting && (greeting.line1 || greeting.line2 || (greeting.lines && greeting.lines.length))) {
          options.appendCoachGreeting?.(greeting);
        }
      })
      .catch((error) => log('warning', `Greeting fetch failed: ${error instanceof Error ? error.message : String(error)}`));
  }

  function renderCard(memo: VoiceLearnerMemoSnapshot, reference: { clipId: string; name: string; summary: string }): void {
    const displayName = str(memo.profile?.displayName, 80);
    if (elements.titleEl) {
      elements.titleEl.textContent = displayName ? `Welcome back, ${displayName}` : 'Welcome back';
    }
    if (elements.targetEl) {
      const summaryPart = reference.summary ? ` — ${reference.summary}` : '';
      elements.targetEl.textContent = `Your target: ${reference.name || 'your last voice'}${summaryPart}`;
    }
    if (elements.statEl) {
      const stat = buildStatLine(memo.recentAttempts);
      elements.statEl.textContent = stat;
      elements.statEl.classList.toggle('hidden', !stat);
    }
    showNote('');
  }

  async function continuePractice(reference: { clipId: string; name: string }): Promise<void> {
    if (elements.continueBtn) {
      elements.continueBtn.disabled = true;
      elements.continueBtn.textContent = 'Re-attaching…';
    }
    try {
      // 1) Re-fetch the reference analysis by clipId (also proves the clip still
      //    exists on the DSP). A 404 here is the "clip gone" failure path.
      const analysis = await options.getReferenceAnalysis(reference.clipId);
      const resolvedClipId = str(analysis.clipId, 160) || reference.clipId;
      const resolvedName = str(analysis.filename, 160) || reference.name;
      // 2) Attach it to the live session via the existing sync path.
      const backendPayload = await options.syncReference(
        options.sessionId,
        resolvedClipId,
        resolvedName,
      ).catch(() => null);
      // 3) Hand off to the caller to patch UI state + reveal the practice stage.
      options.onContinuePractice({
        backendPayload,
        analysis,
        reference: { clipId: resolvedClipId, name: resolvedName },
      });
      hideCard();
      log('system', `Welcome back — re-attached target ${resolvedName}`);
    } catch (error) {
      // Failure path: the clip is no longer available on the DSP. Keep the card
      // visible with a quiet note + a clear recovery action that hands off to
      // the front door — rather than stranding the user on a dead card.
      const message = error instanceof Error ? error.message : String(error);
      log('warning', `Could not re-attach last target: ${message}`);
      showNote('That target voice is no longer available. Choose a voice to continue.');
      // Repurpose the primary button to reveal the front door on the next click.
      if (elements.continueBtn) {
        elements.continueBtn.dataset.clipId = '';
        elements.continueBtn.dataset.clipName = '';
        elements.continueBtn.disabled = false;
        elements.continueBtn.textContent = 'Choose a target voice';
      }
      return;
    } finally {
      if (elements.continueBtn && elements.continueBtn.dataset.clipId) {
        elements.continueBtn.disabled = false;
        elements.continueBtn.textContent = 'Continue practice';
      }
    }
  }

  elements.continueBtn?.addEventListener('click', () => {
    const clipId = elements.continueBtn?.dataset.clipId || '';
    const name = elements.continueBtn?.dataset.clipName || '';
    if (!clipId) {
      // No clip (or the failure path cleared it) — hand off to the front door.
      hideCard();
      options.setFrontDoorHidden(false);
      options.showFrontDoor();
      return;
    }
    void continuePractice({ clipId, name });
  });

  elements.changeBtn?.addEventListener('click', () => {
    // "Change target voice" — dismiss the card, reveal the normal front door.
    hideCard();
    options.setFrontDoorHidden(false);
    options.showFrontDoor();
    log('system', 'Welcome back dismissed — choose a new target voice.');
  });

  // Entry: decide whether to show the card. Fire-and-forget; the front door is
  // already wired by the caller and shows by default, so a no-op here simply
  // leaves the door in place.
  void (async () => {
    // Greet returning learners regardless of the card (also on session restore).
    let memo: VoiceLearnerMemoSnapshot | null = null;
    try {
      const response = await options.getMemoProfile(studentId);
      memo = readMemoSnapshot(response);
    } catch (error) {
      log('warning', `Learner memo fetch failed: ${error instanceof Error ? error.message : String(error)}`);
      memo = null;
    }

    const lastReference = memo?.lastReference || null;
    const clipId = str(lastReference?.clipId, 160);
    const knownReturningLearner = Boolean(clipId);

    // The greeting appends for any known returning learner (card OR restore).
    if (knownReturningLearner || options.hasRestorableSession) {
      appendGreeting();
    }

    // The CARD only replaces the blank front door: no restorable session AND a
    // known last reference to re-attach. Otherwise leave the front door as-is.
    if (options.hasRestorableSession || !knownReturningLearner) {
      return;
    }

    const reference = {
      clipId,
      name: str(lastReference?.name, 160),
      summary: str(lastReference?.summary, 240),
    };
    renderCard(memo as VoiceLearnerMemoSnapshot, reference);
    if (elements.continueBtn) {
      elements.continueBtn.dataset.clipId = reference.clipId;
      elements.continueBtn.dataset.clipName = reference.name;
    }
    // Suppress the front door (our own class toggle — we never edit its logic)
    // and reveal the card in its place.
    options.setFrontDoorHidden(true);
    elements.welcomeBackEl?.classList.remove('hidden');
    showing = true;
    log('system', 'Welcome back card shown for returning learner.');
  })();

  return handle;
}
