// Lesson surface — time-lapse mirror, PURE selection logic (v1.5).
//
// The person's own recorded arc — the honest progress device (no XP could ever
// compete with hearing your own voice change; PRACTICE-PHILOSOPHY.md §4). This
// module owns ONLY the deterministic "which two takes are we comparing" math +
// the then/now header copy. No DOM, no fetch, no replay coupling — so it runs
// under `node --test` after an esbuild transpile.
//
// Milestone lists arrive OLDEST FIRST (the contract). Default comparison is
// earliest vs latest; the user may select any two (then = the older of the two
// by list position, now = the newer), and we always orient then->now in time.

import type { VoiceMilestone } from '../api';

export type VoiceMirrorPair = {
  // The earlier ("then") and later ("now") milestone, oriented by list index
  // (the list is oldest-first, so a lower index is always the earlier take).
  then: VoiceMilestone;
  now: VoiceMilestone;
  thenIndex: number;
  nowIndex: number;
};

function isMilestone(value: unknown): value is VoiceMilestone {
  return Boolean(value && typeof value === 'object' && typeof (value as VoiceMilestone).id === 'string');
}

/**
 * Clean a raw milestone list: keep only well-formed entries with an id,
 * preserving order (oldest first). Defensive against a malformed proxy payload.
 */
export function sanitizeMilestones(list: unknown): VoiceMilestone[] {
  if (!Array.isArray(list)) return [];
  return list.filter(isMilestone);
}

/**
 * Resolve the effective comparison pair from the (oldest-first) milestone list
 * and the user's optional selected ids.
 *
 * Rules:
 *  - 0 or 1 milestones  -> null (nothing to compare; caller shows empty/solo).
 *  - No valid selection -> default earliest (index 0) vs latest (last index).
 *  - Two distinct valid selections -> those two, oriented then(earlier index)
 *    -> now(later index).
 *  - One valid selection only, or a selection collides on the same milestone ->
 *    fall back to pairing the selected one with the opposite extreme (so the
 *    user always gets a real then/now), else the default pair.
 *
 * Selection is by id (stable across re-fetch), resolved to list position here.
 */
export function resolveMirrorPair(
  milestones: VoiceMilestone[],
  selection?: { thenId?: string | null; nowId?: string | null },
): VoiceMirrorPair | null {
  const list = sanitizeMilestones(milestones);
  if (list.length < 2) return null;

  const lastIndex = list.length - 1;
  const indexOfId = (id: string | null | undefined): number => {
    if (typeof id !== 'string' || !id) return -1;
    return list.findIndex((m) => m.id === id);
  };

  let a = indexOfId(selection?.thenId);
  let b = indexOfId(selection?.nowId);

  // Neither selected -> default earliest vs latest.
  if (a < 0 && b < 0) {
    a = 0;
    b = lastIndex;
  } else if (a < 0) {
    // Only "now" selected -> pair it with the earliest (unless that IS it, then
    // pair with the latest other extreme).
    a = b === 0 ? lastIndex : 0;
  } else if (b < 0) {
    // Only "then" selected -> pair it with the latest (unless that IS it).
    b = a === lastIndex ? 0 : lastIndex;
  }

  // Both resolved but identical -> nudge to a real pair (extremes).
  if (a === b) {
    if (a === 0) {
      b = lastIndex;
    } else {
      a = 0;
    }
  }

  // Orient then(earlier index) -> now(later index).
  const thenIndex = Math.min(a, b);
  const nowIndex = Math.max(a, b);
  return {
    then: list[thenIndex],
    now: list[nowIndex],
    thenIndex,
    nowIndex,
  };
}

function milestoneDateLabel(milestone: VoiceMilestone | null | undefined): string {
  const date = typeof milestone?.date === 'string' ? milestone.date.trim() : '';
  return date || 'a take';
}

/**
 * The plain then->now header for a resolved pair: "⟨date⟩ → ⟨date⟩".
 * Honest and calm — a date arrow, never a delta/score.
 */
export function mirrorPairHeader(pair: VoiceMirrorPair | null): string {
  if (!pair) return '';
  return `${milestoneDateLabel(pair.then)} → ${milestoneDateLabel(pair.now)}`;
}

/**
 * One-line label for a milestone row on the time axis: "⟨date⟩ · ⟨label⟩ · ⟨dur⟩".
 * Omits absent parts; duration rendered as a whole-second count.
 */
export function milestoneRowLabel(milestone: VoiceMilestone | null | undefined): string {
  if (!milestone) return '';
  const parts: string[] = [];
  const date = typeof milestone.date === 'string' ? milestone.date.trim() : '';
  if (date) parts.push(date);
  const label = typeof milestone.label === 'string' ? milestone.label.trim() : '';
  if (label) parts.push(label);
  const durationMs = Number(milestone.durationMs);
  if (Number.isFinite(durationMs) && durationMs > 0) {
    parts.push(`${(durationMs / 1000).toFixed(1)}s`);
  }
  return parts.join(' · ');
}

// Honest, calm copy fixed by the contract.
export const MIRROR_HONEST_LINE =
  'Same phrase not required — listen for the center of the voice.';
export const MIRROR_EMPTY_LINE =
  'When a take is worth keeping, you can pin it here — one a week is plenty.';
