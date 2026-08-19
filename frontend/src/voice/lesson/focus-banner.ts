// Lesson surface — focus banner (Wave B).
//
// One always-visible line at the top of the practice stage: today's single
// focus. Primary source is activeCard.focus.statement; falls back to the latest
// coach line, then a calm default. Updates whenever the card/focus changes.
//
// Pure DOM writer + a pure resolver (testable).

import type { VoicePracticeCard, VoiceCardFocusAxis } from './card';

export type FocusBannerInput = {
  card: VoicePracticeCard | null;
  // Fallback focus text (e.g. latest coach message, or lesson-board focus).
  fallbackFocusText?: string | null;
};

export type FocusBannerView = {
  statement: string;
  axis: VoiceCardFocusAxis | null;
  isPlaceholder: boolean;
};

// Surfacing wave: reads truthfully with or without the coach — the focus comes
// from what the take shows, not from a promised tutor message.
const DEFAULT_FOCUS = 'Pick a line and take it — your focus sets from what the take shows.';

export function resolveFocusBanner(input: FocusBannerInput): FocusBannerView {
  const statement = input.card?.focus.statement
    || (typeof input.fallbackFocusText === 'string' && input.fallbackFocusText.trim()
      ? input.fallbackFocusText.trim()
      : null);
  if (statement) {
    return {
      statement,
      axis: input.card?.focus.axis ?? null,
      isPlaceholder: false,
    };
  }
  return { statement: DEFAULT_FOCUS, axis: null, isPlaceholder: true };
}

const AXIS_LABEL: Record<VoiceCardFocusAxis, string> = {
  pitch: 'pitch',
  resonance: 'resonance',
  weight: 'weight',
  prosody: 'prosody',
};

export function renderVoiceLessonFocusBanner(
  elements: {
    banner: HTMLElement | null | undefined;
    text: HTMLElement | null | undefined;
    axisChip: HTMLElement | null | undefined;
  },
  view: FocusBannerView,
): void {
  if (elements.text) {
    elements.text.textContent = view.statement;
  }
  if (elements.axisChip) {
    if (view.axis) {
      elements.axisChip.textContent = AXIS_LABEL[view.axis];
      elements.axisChip.classList.remove('hidden');
      elements.axisChip.dataset.axis = view.axis;
    } else {
      elements.axisChip.classList.add('hidden');
      elements.axisChip.removeAttribute('data-axis');
    }
  }
  if (elements.banner) {
    elements.banner.classList.toggle('voice-lesson-focus-placeholder', view.isPlaceholder);
    // Drive the banner accent from the axis via a data attribute (CSS maps it).
    if (view.axis) {
      elements.banner.dataset.axis = view.axis;
    } else {
      elements.banner.removeAttribute('data-axis');
    }
    elements.banner.setAttribute('aria-label', `Today's focus: ${view.statement}`);
  }
}
