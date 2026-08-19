// Lesson surface — practice card "paper strip" renderer (Wave B).
//
// Renders the activeCard tokens as a strip of words whose TYPOGRAPHY carries the
// focus: emphasis level 0-3 -> size+weight + a focus-colored underline (level 3
// strongest). Karaoke states recolor each token after a take (pending hollow /
// hit green / missed soft-red). A revision bump pulses the strip.
//
// DOM renderer (consumes a target element). The scoring/identity logic lives in
// the pure karaoke.ts / card.ts modules.

import {
  voiceCardFocusAccentVar,
  type VoicePracticeCard,
  type VoiceCardToken,
} from './card';
import type { KaraokeState } from './karaoke';

export type CardStripRenderContext = {
  element: HTMLElement | null | undefined;
  card: VoicePracticeCard | null;
  karaoke: KaraokeState[]; // parallel to card.tokens; may be shorter -> pending
  // The normal practice line remains authoritative while the tutor has not
  // authored an optional card. This prevents a recordable take with no visible
  // sentence in the compact Coach surface.
  fallbackPhrase?: string | null;
  // Token index to flag as the coach's referenced moment (from momentProgress),
  // or -1 / null for none.
  momentTokenIndex?: number | null;
  // Token index currently sounding during replay (live cursor), or -1 / null.
  activeTokenIndex?: number | null;
};

const EMPHASIS_CLASS: Record<number, string> = {
  0: 'voice-lesson-emph-0',
  1: 'voice-lesson-emph-1',
  2: 'voice-lesson-emph-2',
  3: 'voice-lesson-emph-3',
};

function karaokeClass(state: KaraokeState): string {
  switch (state) {
    case 'hit':
      return 'voice-lesson-tok-hit';
    case 'missed':
      return 'voice-lesson-tok-missed';
    case 'seen':
      return 'voice-lesson-tok-seen';
    default:
      return 'voice-lesson-tok-pending';
  }
}

function karaokeAriaWord(text: string, state: KaraokeState): string {
  switch (state) {
    case 'hit':
      return `${text}, on target`;
    case 'missed':
      return `${text}, needs another pass`;
    case 'seen':
      return `${text}, heard`;
    default:
      return text;
  }
}

function buildTokenEl(
  token: VoiceCardToken,
  state: KaraokeState,
  accentVar: string,
  flags: { isMoment: boolean; isActive: boolean },
): HTMLElement {
  const tokenEl = document.createElement('span');
  tokenEl.className = [
    'voice-lesson-tok',
    EMPHASIS_CLASS[token.emphasis] || EMPHASIS_CLASS[0],
    karaokeClass(state),
    flags.isMoment ? 'voice-lesson-tok-moment' : '',
    flags.isActive ? 'voice-lesson-tok-active' : '',
  ].filter(Boolean).join(' ');
  // The focus accent drives the underline color; emphasis level drives its weight
  // (set via CSS using this custom property).
  tokenEl.style.setProperty('--vt-lesson-tok-accent', accentVar);
  tokenEl.textContent = token.text;
  tokenEl.setAttribute('aria-label', karaokeAriaWord(token.text, state));
  if (token.focusHint) {
    tokenEl.title = token.focusHint;
  }
  return tokenEl;
}

/**
 * Render the card strip. Idempotent: clears and rebuilds the element's token
 * children. When there is no card, shows a calm placeholder.
 */
export function renderVoiceLessonCardStrip(context: CardStripRenderContext): void {
  const { element, card } = context;
  if (!element) return;
  element.replaceChildren();

  if (!card || card.tokens.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'voice-lesson-card-empty';
    empty.textContent = card?.phrase
      || context.fallbackPhrase?.trim()
      || 'Your tutor is preparing a phrase…';
    element.appendChild(empty);
    return;
  }

  const accentVar = voiceCardFocusAccentVar(card.focus.axis);
  element.style.setProperty('--vt-lesson-card-accent', accentVar);

  const momentTokenIndex = context.momentTokenIndex ?? -1;
  const activeTokenIndex = context.activeTokenIndex ?? -1;

  card.tokens.forEach((token, index) => {
    if (index > 0) {
      element.appendChild(document.createTextNode(' '));
    }
    const state = context.karaoke[index] ?? 'pending';
    element.appendChild(buildTokenEl(token, state, accentVar, {
      isMoment: index === momentTokenIndex,
      isActive: index === activeTokenIndex,
    }));
  });
}

/**
 * Trigger the "coach adjusted this card" pulse: add the animation class and
 * remove it after the animation window so it can retrigger on the next bump.
 * Returns a cleanup that cancels the pending timer (for teardown safety).
 */
export function pulseVoiceLessonCard(
  element: HTMLElement | null | undefined,
  windowMs = 1200,
): () => void {
  if (!element) return () => undefined;
  element.classList.remove('voice-lesson-card-pulse');
  // Force reflow so re-adding the class restarts the animation.
  void element.offsetWidth;
  element.classList.add('voice-lesson-card-pulse');
  const timer = setTimeout(() => {
    element.classList.remove('voice-lesson-card-pulse');
  }, windowMs);
  return () => clearTimeout(timer);
}
