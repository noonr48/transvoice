// Lesson surface — pluggable word-timing (Wave B).
//
// During replay the card's tokens must re-mark in sync with the recorded audio.
// "When does token N happen in the take?" is answered by a WordTimingSource.
// The default ProgressTimingSource maps each token's startProgress/endProgress
// (0..1, authored on the card) across the take duration. A future ASR source
// (SenseVoice word timestamps — scaffolded, DISABLED) can implement the same
// interface and swap in without touching replay/karaoke. We make ZERO ASR calls.
//
// Pure: no DOM, no network, type-only import of the card model.

import type { VoicePracticeCard } from './card';

export type VoiceTokenWindow = {
  tokenIndex: number;
  startMs: number;
  endMs: number;
};

export interface WordTimingSource {
  /**
   * Token time windows in milliseconds across a take of `takeDurationMs`.
   * Implementations should return one window per renderable token, ordered by
   * tokenIndex, with 0 <= startMs <= endMs <= takeDurationMs.
   */
  getTokenWindows(card: VoicePracticeCard | null, takeDurationMs: number): VoiceTokenWindow[];
}

function sanitizeDuration(takeDurationMs: number): number {
  if (!Number.isFinite(takeDurationMs) || takeDurationMs <= 0) return 0;
  return takeDurationMs;
}

/**
 * Default source: token.startProgress/endProgress * takeDuration.
 *
 * Robustness: when a token omits progress (null), we fall back to an even split
 * across the strip so the strip still lights up left-to-right rather than
 * collapsing to t=0. Progress values are clamped/ordered defensively.
 */
export class ProgressTimingSource implements WordTimingSource {
  getTokenWindows(card: VoicePracticeCard | null, takeDurationMs: number): VoiceTokenWindow[] {
    const duration = sanitizeDuration(takeDurationMs);
    const tokens = card?.tokens ?? [];
    if (tokens.length === 0 || duration === 0) return [];

    const count = tokens.length;
    return tokens.map((token, index) => {
      const evenStart = index / count;
      const evenEnd = (index + 1) / count;
      const startProgress = token.startProgress != null ? token.startProgress : evenStart;
      const endProgressRaw = token.endProgress != null ? token.endProgress : evenEnd;
      // Guarantee a non-negative, ordered window.
      const start = Math.min(Math.max(startProgress, 0), 1);
      const end = Math.min(Math.max(Math.max(endProgressRaw, start), 0), 1);
      return {
        tokenIndex: index,
        startMs: start * duration,
        endMs: end * duration,
      };
    });
  }
}

export const defaultWordTimingSource: WordTimingSource = new ProgressTimingSource();

/**
 * Which token window contains a given progress value (0..1)? Used to flag the
 * coach's `momentProgress` on a token, and to drive the replay cursor. Returns
 * the token index whose [startMs,endMs] brackets the elapsed time, or the
 * nearest preceding token, or -1 when there are no windows.
 */
export function tokenIndexAtElapsed(
  windows: VoiceTokenWindow[],
  elapsedMs: number,
): number {
  if (windows.length === 0) return -1;
  let candidate = -1;
  for (const window of windows) {
    if (elapsedMs >= window.startMs && elapsedMs <= window.endMs) {
      return window.tokenIndex;
    }
    if (elapsedMs >= window.startMs) {
      candidate = window.tokenIndex;
    }
  }
  // Past the end -> last token; before the first -> first token.
  if (candidate === -1) return windows[0].tokenIndex;
  return candidate;
}

/**
 * The token index that a fractional progress (0..1) falls in, by mapping it to
 * elapsed = progress * duration of the windows. Convenience for momentProgress.
 */
export function tokenIndexAtProgress(
  windows: VoiceTokenWindow[],
  progress: number,
): number {
  if (windows.length === 0) return -1;
  const lastEnd = windows[windows.length - 1].endMs;
  if (lastEnd <= 0) return windows[0].tokenIndex;
  const clamped = Math.min(Math.max(progress, 0), 1);
  return tokenIndexAtElapsed(windows, clamped * lastEnd);
}
