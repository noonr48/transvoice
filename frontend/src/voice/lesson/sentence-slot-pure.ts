// Lesson surface — one-real-sentence slot, PURE state mapping (v1.5).
//
// The bridge from practice to life at minimum dose: one sentence the person will
// actually say today. An OFFER, never an obligation (PRACTICE-PHILOSOPHY.md):
// no streak, no badge, no daily reminder — if no sentence is picked the slot
// just sits quietly.
//
// This module owns ONLY the deterministic status -> plain-words mapping + the
// slot mode derivation. No DOM, no fetch — so it runs under `node --test` after
// an esbuild transpile (mirrors card.ts / karaoke.ts / replay-frames.ts).

import type { VoiceRealSentenceEntry, VoiceRealSentenceStatus } from '../api';

// What the slot is currently showing.
//   'empty'   — no sentence picked today: the quiet invite line + "choose" button.
//   'picked'  — a sentence is chosen and being rehearsed / ready / carried.
export type VoiceSentenceSlotMode = 'empty' | 'picked';

export type VoiceSentenceSlotView = {
  mode: VoiceSentenceSlotMode;
  // The picked sentence text (mode 'picked'), else ''.
  text: string;
  // Plain-words status ('' when empty). NEVER a score/level/streak word.
  statusLabel: string;
  // Whether the "I said it today" affordance should be offered. Only for
  // picked/ready (carried is implied at debrief; we never re-assert 'carried'
  // or 'debriefed'). The backend has no same-day "carried" route, so this is
  // surfaced ONLY when an onSaidItToday handler is wired — see note in slot.ts.
  canMarkSaidToday: boolean;
};

export const SENTENCE_SLOT_EMPTY_LINE =
  "Pick one real sentence for today — something you'll actually say.";

// Status -> plain words. The contract's exact register: no completion theater,
// no "done", just where the sentence is in its small life.
//   picked    -> "rehearsing"
//   ready     -> "feels ready to go outside"
//   carried   -> "carried today"
//   debriefed -> "" (the slot stops asserting once it's been debriefed; a fresh
//                    day's pick replaces it — we never show a stale "debriefed")
export function realSentenceStatusLabel(status: VoiceRealSentenceStatus | null | undefined): string {
  switch (status) {
    case 'picked':
      return 'rehearsing';
    case 'ready':
      return 'feels ready to go outside';
    case 'carried':
      return 'carried today';
    default:
      // 'debriefed' or unknown -> no label (the slot returns to quiet).
      return '';
  }
}

function asText(value: unknown, max = 120): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

/**
 * Derive the slot view from today's entry (the GET /voice/real-sentence
 * `today` field). A null/absent entry, or one already 'debriefed', collapses
 * the slot back to the quiet empty invite — no nagging, no leftover badge.
 */
export function resolveSentenceSlotView(today: VoiceRealSentenceEntry | null | undefined): VoiceSentenceSlotView {
  const text = asText(today?.text);
  const status = (today?.status ?? null) as VoiceRealSentenceStatus | null;

  // No sentence today, or it's already been debriefed -> quiet empty state.
  if (!today || !text || status === 'debriefed') {
    return { mode: 'empty', text: '', statusLabel: '', canMarkSaidToday: false };
  }

  return {
    mode: 'picked',
    text,
    statusLabel: realSentenceStatusLabel(status),
    // "I said it today" is only meaningful while still rehearsing / ready.
    canMarkSaidToday: status === 'picked' || status === 'ready',
  };
}

// The editable pick input is capped at 120 chars (the backend's REAL_SENTENCE
// max). Trim + clamp the same way before POSTing so the UI never sends an
// over-length sentence the server would reject.
export const REAL_SENTENCE_MAX_LEN = 120;

export function sanitizeRealSentenceText(value: string): string {
  return asText(value, REAL_SENTENCE_MAX_LEN);
}
