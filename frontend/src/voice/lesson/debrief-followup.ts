// Lesson surface — one-real-sentence debrief follow-up (v1.5, DOM controller).
//
// When the greeting payload carries a pending-debrief question (the backend
// appends greeting.debriefLine + greeting.pendingDebrief), render three quiet
// buttons UNDER the coach thread:
//   "Said it — went well" / "Said it — rough" / "Didn't today"
// plus an optional one-line note input. One tap -> POST outcome -> render the
// returned coachLine into the thread (the SAME way coach messages render) ->
// remove the buttons. Dismissing (an unobtrusive ✕ or just ignoring) is fine —
// we NEVER re-prompt in-session (the backend also stops asking once debriefed).
//
// The coach line itself is the warm response (said-rough/not-said write NO
// negative record server-side); we only surface it. Self-contained: optional
// DOM, all listeners torn down via the returned handle.

import type {
  VoiceRealSentenceEntry,
  VoiceRealSentenceOutcome,
  VoiceRealSentenceOutcomeResponse,
} from '../api';

export type VoiceDebriefFollowupOptions = {
  doc: Document;
  // The pending entry from the greeting payload ({ id, text, ... }).
  pendingDebrief: VoiceRealSentenceEntry;
  // The greeting's debrief question line, rendered as the prompt above the
  // buttons (already a deterministic template; we do not synthesize it).
  debriefLine?: string | null;
  // Submit the outcome (POST /voice/real-sentence/outcome) -> { coachLine }.
  submitOutcome: (
    id: string,
    outcome: VoiceRealSentenceOutcome,
    note?: string | null,
  ) => Promise<VoiceRealSentenceOutcomeResponse>;
  // Render a coach line into the thread (same path the greeting/coach uses).
  appendCoachLine: (text: string) => void;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

export type VoiceDebriefFollowupHandle = {
  dismiss: () => void;
};

function getEl(doc: Document, id: string): HTMLElement | null {
  return doc.getElementById(id);
}

const OUTCOME_BUTTONS: Array<{ id: string; outcome: VoiceRealSentenceOutcome }> = [
  { id: 'voice-lesson-debrief-well', outcome: 'said-well' },
  { id: 'voice-lesson-debrief-rough', outcome: 'said-rough' },
  { id: 'voice-lesson-debrief-not', outcome: 'not-said' },
];

export function setupVoiceDebriefFollowup(options: VoiceDebriefFollowupOptions): VoiceDebriefFollowupHandle {
  const { doc } = options;
  const log = (kind: 'system' | 'warning', message: string): void => options.addLog?.(kind, message);

  const panelEl = getEl(doc, 'voice-lesson-debrief');
  const promptEl = getEl(doc, 'voice-lesson-debrief-prompt');
  const noteEl = getEl(doc, 'voice-lesson-debrief-note') as HTMLInputElement | null;
  const dismissEl = getEl(doc, 'voice-lesson-debrief-dismiss') as HTMLButtonElement | null;

  const cleanups: Array<() => void> = [];
  let submitted = false;

  const noop: VoiceDebriefFollowupHandle = { dismiss: () => undefined };
  if (!panelEl || !options.pendingDebrief?.id) {
    return noop;
  }

  function hide(): void {
    panelEl?.classList.add('hidden');
    panelEl?.setAttribute('aria-hidden', 'true');
    cleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        /* best-effort */
      }
    });
    cleanups.length = 0;
  }

  async function submit(outcome: VoiceRealSentenceOutcome): Promise<void> {
    if (submitted) return;
    submitted = true;
    // Lock the buttons immediately so a double-tap can't double-post.
    OUTCOME_BUTTONS.forEach(({ id }) => {
      const btn = getEl(doc, id) as HTMLButtonElement | null;
      if (btn) btn.disabled = true;
    });
    const note = (noteEl?.value || '').trim().slice(0, 240);
    try {
      const response = await options.submitOutcome(options.pendingDebrief.id, outcome, note || null);
      const coachLine = typeof response?.coachLine === 'string' ? response.coachLine.trim() : '';
      if (coachLine) {
        options.appendCoachLine(coachLine);
      }
      log('system', 'Real-sentence debrief logged.');
    } catch (error) {
      // Even on failure we do not re-prompt; surface a quiet log only.
      log('warning', `Could not log the debrief: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      hide();
    }
  }

  // Render the prompt line (the greeting already computed it).
  if (promptEl) {
    promptEl.textContent = (options.debriefLine || '').trim()
      || `Yesterday's sentence — "${options.pendingDebrief.text}". How did it go?`;
  }

  // Wire the three outcome buttons + the dismiss control.
  OUTCOME_BUTTONS.forEach(({ id, outcome }) => {
    const btn = getEl(doc, id) as HTMLButtonElement | null;
    if (!btn) return;
    btn.disabled = false;
    const onClick = (): void => { void submit(outcome); };
    btn.addEventListener('click', onClick);
    cleanups.push(() => btn.removeEventListener('click', onClick));
  });
  if (dismissEl) {
    const onDismiss = (): void => hide();
    dismissEl.addEventListener('click', onDismiss);
    cleanups.push(() => dismissEl.removeEventListener('click', onDismiss));
  }

  // Reveal the panel.
  panelEl.classList.remove('hidden');
  panelEl.setAttribute('aria-hidden', 'false');

  return { dismiss: hide };
}
