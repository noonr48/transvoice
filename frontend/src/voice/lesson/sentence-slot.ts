// Lesson surface — one-real-sentence slot (v1.5, DOM controller).
//
// A slim card near the focus banner holding ONE sentence the person will
// actually say today. An OFFER, never an obligation (PRACTICE-PHILOSOPHY.md):
//   - empty  -> a single quiet invite line + "Choose with the coach" button,
//               which reveals the 3 deterministic suggestions (plain selectable
//               lines) + an editable input (<=120 chars). Picking POSTs and the
//               slot shows the sentence + a plain-words status.
//   - picked -> the sentence + status ("rehearsing" / "feels ready to go
//               outside" / "carried today").
//   - NO daily reminder / badge / streak. If nothing is picked it sits quietly.
//
// The "I said it today" same-day affordance (contract 1b) is OMITTED: the
// backend exposes only the /outcome route (which sets 'debriefed'), with NO
// same-day "carried" route. Per the contract, carried is therefore left to the
// next-day debrief and the affordance is skipped. (The pure layer still derives
// canMarkSaidToday for correctness; we just never render a button for it.)
//
// Self-contained: owns its DOM lookups (all optional -> never throws if a node
// is absent) + all its listeners (dispose() tears everything down). The picked
// card becomes the session's active practice card server-side; the lesson
// controller's existing card flow renders it (we call onPicked so the app can
// refresh the active card if the take payload didn't already update it).

import {
  resolveSentenceSlotView,
  sanitizeRealSentenceText,
  SENTENCE_SLOT_EMPTY_LINE,
  REAL_SENTENCE_MAX_LEN,
  type VoiceSentenceSlotView,
} from './sentence-slot-pure';
import type {
  VoiceRealSentenceEntry,
  VoiceRealSentenceResponse,
  VoiceRealSentencePickResponse,
} from '../api';

export type VoiceSentenceSlotOptions = {
  doc: Document;
  // Fetch today's sentence + suggestions (GET /voice/real-sentence).
  getRealSentence: () => Promise<VoiceRealSentenceResponse>;
  // Pick a sentence (POST /voice/real-sentence/pick). Returns the entry + card.
  pickRealSentence: (text: string) => Promise<VoiceRealSentencePickResponse>;
  // Called after a successful pick so the app can ensure the active card flips
  // to the new real_sentence card (the backend sets it active when a sessionId
  // is supplied; this is the belt-and-braces refresh).
  onPicked?: (response: VoiceRealSentencePickResponse) => void;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

function getEl(doc: Document, id: string): HTMLElement | null {
  return doc.getElementById(id);
}

export function createVoiceSentenceSlot(options: VoiceSentenceSlotOptions) {
  const { doc } = options;

  // --- DOM (all optional) ---
  const emptyEl = getEl(doc, 'voice-lesson-sentence-empty');
  const emptyLineEl = getEl(doc, 'voice-lesson-sentence-empty-line');
  const chooseBtn = getEl(doc, 'voice-lesson-sentence-choose') as HTMLButtonElement | null;
  const chooserEl = getEl(doc, 'voice-lesson-sentence-chooser');
  const suggestionsEl = getEl(doc, 'voice-lesson-sentence-suggestions');
  const inputEl = getEl(doc, 'voice-lesson-sentence-input') as HTMLInputElement | null;
  const pickBtn = getEl(doc, 'voice-lesson-sentence-pick') as HTMLButtonElement | null;
  const cancelBtn = getEl(doc, 'voice-lesson-sentence-cancel') as HTMLButtonElement | null;
  const pickedEl = getEl(doc, 'voice-lesson-sentence-picked');
  const pickedTextEl = getEl(doc, 'voice-lesson-sentence-text');
  const pickedStatusEl = getEl(doc, 'voice-lesson-sentence-status');

  // Persistent listeners (bound once); plus per-render suggestion listeners that
  // are cleared before each re-render so they don't accumulate.
  const listenerCleanups: Array<() => void> = [];
  let suggestionCleanups: Array<() => void> = [];
  let lastView: VoiceSentenceSlotView = { mode: 'empty', text: '', statusLabel: '', canMarkSaidToday: false };
  let lastSuggestions: string[] = [];
  let pickInFlight = false;
  let chooserOpen = false;

  function clearSuggestionListeners(): void {
    suggestionCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        /* best-effort */
      }
    });
    suggestionCleanups = [];
  }

  function log(kind: 'system' | 'warning', message: string): void {
    options.addLog?.(kind, message);
  }

  function show(el: HTMLElement | null, visible: boolean): void {
    el?.classList.toggle('hidden', !visible);
  }

  function renderView(view: VoiceSentenceSlotView): void {
    lastView = view;
    if (emptyLineEl) emptyLineEl.textContent = SENTENCE_SLOT_EMPTY_LINE;
    // The chooser is a transient sub-state of "empty"; keep it open if mid-pick.
    show(emptyEl, view.mode === 'empty' && !chooserOpen);
    show(chooserEl, view.mode === 'empty' && chooserOpen);
    show(pickedEl, view.mode === 'picked');
    if (view.mode === 'picked') {
      if (pickedTextEl) pickedTextEl.textContent = view.text;
      if (pickedStatusEl) {
        pickedStatusEl.textContent = view.statusLabel;
        show(pickedStatusEl, Boolean(view.statusLabel));
      }
    }
  }

  function renderSuggestions(suggestions: string[]): void {
    lastSuggestions = Array.isArray(suggestions) ? suggestions.slice(0, 3) : [];
    if (!suggestionsEl) return;
    // Drop the prior render's suggestion listeners before rebuilding.
    clearSuggestionListeners();
    suggestionsEl.replaceChildren();
    lastSuggestions.forEach((suggestion) => {
      const text = sanitizeRealSentenceText(suggestion);
      if (!text) return;
      const line = doc.createElement('button');
      line.type = 'button';
      line.className = 'voice-lesson-sentence-suggestion';
      line.textContent = text;
      line.setAttribute('aria-label', `Use this sentence: ${text}`);
      const onClick = (): void => {
        // Selecting a suggestion fills the editable input (the user can still
        // tweak it before committing) — a gentle pre-fill, not an auto-commit.
        if (inputEl) {
          inputEl.value = text;
          inputEl.focus();
        }
      };
      line.addEventListener('click', onClick);
      suggestionCleanups.push(() => line.removeEventListener('click', onClick));
      suggestionsEl.appendChild(line);
    });
  }

  function openChooser(): void {
    chooserOpen = true;
    renderView(lastView);
    if (inputEl) {
      inputEl.value = '';
      inputEl.maxLength = REAL_SENTENCE_MAX_LEN;
    }
    // (Re)load suggestions each time the chooser opens (they never repeat the
    // last 10 picked — deterministic, server-side).
    void options.getRealSentence()
      .then((response) => {
        renderSuggestions(Array.isArray(response?.suggestions) ? response.suggestions : []);
      })
      .catch((error) => log('warning', `Could not load sentence suggestions: ${error instanceof Error ? error.message : String(error)}`));
  }

  function closeChooser(): void {
    chooserOpen = false;
    renderView(lastView);
  }

  async function commitPick(): Promise<void> {
    if (pickInFlight) return;
    const text = sanitizeRealSentenceText(inputEl?.value || '');
    if (!text) {
      // Nothing typed/selected — keep the chooser open, gently nudge focus.
      inputEl?.focus();
      return;
    }
    pickInFlight = true;
    if (pickBtn) pickBtn.disabled = true;
    try {
      const response = await options.pickRealSentence(text);
      if (response?.success === false) {
        const message = typeof response.error === 'string' ? response.error : 'Could not save that sentence.';
        log('warning', message);
        return;
      }
      // Reflect the picked entry locally (the slot flips to 'picked') and let the
      // app refresh the active card.
      const entry = (response?.entry || { id: '', text, status: 'picked' }) as VoiceRealSentenceEntry;
      chooserOpen = false;
      renderView(resolveSentenceSlotView(entry));
      options.onPicked?.(response);
      log('system', 'Today’s sentence picked.');
    } catch (error) {
      log('warning', `Could not save that sentence: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pickInFlight = false;
      if (pickBtn) pickBtn.disabled = false;
    }
  }

  function bind(): void {
    const on = (el: HTMLElement | null, type: string, handler: EventListener): void => {
      if (!el) return;
      el.addEventListener(type, handler);
      listenerCleanups.push(() => el.removeEventListener(type, handler));
    };
    on(chooseBtn, 'click', () => openChooser());
    on(cancelBtn, 'click', () => closeChooser());
    on(pickBtn, 'click', () => { void commitPick(); });
    // Enter inside the input commits the pick (it's a single-line field; the
    // lesson keyboard guard ignores keys while an input is focused, so this is
    // local and safe).
    on(inputEl, 'keydown', (event) => {
      if ((event as KeyboardEvent).key === 'Enter') {
        event.preventDefault();
        void commitPick();
      }
    });
  }

  // --- Public: refresh today's sentence (called on entry + after a take) ---
  async function refresh(): Promise<void> {
    try {
      const response = await options.getRealSentence();
      // Don't clobber an open chooser the user is mid-pick in.
      if (!chooserOpen) {
        renderView(resolveSentenceSlotView(response?.today ?? null));
      }
    } catch (error) {
      log('warning', `Could not load today’s sentence: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function start(): void {
    bind();
    renderView(lastView);
    void refresh();
  }

  function dispose(): void {
    clearSuggestionListeners();
    listenerCleanups.forEach((cleanup) => {
      try {
        cleanup();
      } catch {
        /* best-effort */
      }
    });
    listenerCleanups.length = 0;
  }

  return { start, refresh, dispose };
}

export type VoiceSentenceSlot = ReturnType<typeof createVoiceSentenceSlot>;
