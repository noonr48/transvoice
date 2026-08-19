// Lesson surface — karaoke marking (Wave B).
//
// After a take, each card token gets a karaoke state derived from the phrase
// comparison checkpoints the card already matches (progress-window overlap).
// v1 marks per-word VOICE QUALITY (not phoneme accuracy) — no ASR.
//
// THRESHOLDS (chosen per the design's "gentle, never harsh" rule):
//   All checkpoint scores are clamped 0..1 in state.ts
//   (normalizeVoicePhraseCheckpoint: pathMatchScore/laneMatchScore/... each
//    `clampVoiceMetric(value, 0, 1)`), so a 0..1 cut is well-defined.
//   We combine pathMatchScore (shape) with laneMatchScore (staying in the lane)
//   as a single quality signal: score = path present ? path, blended 70/30 with
//   lane when both exist (lane corroborates path). Cuts:
//     hit      : score >= 0.60   (green fill)
//     missed   : score <  0.35   (soft red, gentle)
//     seen     : otherwise       (neutral "we heard this word")
//     pending  : no overlapping scored checkpoint yet (hollow)
//   0.60/0.35 sit just under/over the existing tone bands
//   (getVoicePhraseCheckpointTone: strong>=0.75, mixed>=0.5, weak<0.5) so a
//   clearly-mixed word reads neutral rather than "missed", keeping feedback kind.
//
// Pure: no DOM. Type-only imports.

import type { VoicePracticeCard, VoiceCardToken } from './card';

// Minimal structural views of the phrase-comparison checkpoint, so this module
// does not depend on state.ts internals (it is fed normalized checkpoints).
export type KaraokeCheckpoint = {
  pathMatchScore: number | null;
  laneMatchScore: number | null;
  startProgress: number | null;
  endProgress: number | null;
};

export type KaraokeComparison = {
  phrase: string | null;
  checkpoints: KaraokeCheckpoint[];
};

export type KaraokeState = 'pending' | 'seen' | 'hit' | 'missed';

export const KARAOKE_HIT_THRESHOLD = 0.6;
export const KARAOKE_MISS_THRESHOLD = 0.35;

function clampProgress(value: number | null | undefined, fallback: number): number {
  if (value == null || !Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * The checkpoint whose progress window overlaps a token's window the most
 * (mirrors render/phrase.ts getVoiceCueSheetCheckpointForToken, but worst-score
 * first so a token that straddles a weak segment is marked honestly).
 */
export function checkpointForCardToken(
  token: VoiceCardToken,
  checkpoints: KaraokeCheckpoint[],
): KaraokeCheckpoint | null {
  if (!checkpoints || checkpoints.length === 0) return null;
  const tokenStart = clampProgress(token.startProgress, 0);
  const tokenEnd = clampProgress(token.endProgress, 1);

  const overlaps = checkpoints.filter((checkpoint) => {
    const checkpointStart = clampProgress(checkpoint.startProgress, 0);
    const checkpointEnd = clampProgress(checkpoint.endProgress, 1);
    return checkpointEnd > tokenStart && checkpointStart < tokenEnd;
  });
  if (overlaps.length === 0) return null;

  // Worst (lowest) blended quality first — a token is only "hit" if the segment
  // it actually lands in scored well. A checkpoint with no usable score sorts
  // LAST (treated as best/ignorable) so a genuinely-scored overlap is preferred
  // over an unscored one rather than being shadowed by it.
  return overlaps.slice().sort((left, right) => {
    const leftScore = checkpointQualityScore(left);
    const rightScore = checkpointQualityScore(right);
    const leftSort = leftScore == null ? Number.POSITIVE_INFINITY : leftScore;
    const rightSort = rightScore == null ? Number.POSITIVE_INFINITY : rightScore;
    return leftSort - rightSort;
  })[0] || null;
}

/**
 * Blend path (shape) and lane (in-lane hold) into one 0..1 quality score, or
 * null when neither is present.
 */
export function checkpointQualityScore(checkpoint: KaraokeCheckpoint | null): number | null {
  if (!checkpoint) return null;
  const path = typeof checkpoint.pathMatchScore === 'number' ? checkpoint.pathMatchScore : null;
  const lane = typeof checkpoint.laneMatchScore === 'number' ? checkpoint.laneMatchScore : null;
  if (path != null && lane != null) {
    return (path * 0.7) + (lane * 0.3);
  }
  if (path != null) return path;
  if (lane != null) return lane;
  return null;
}

export function karaokeStateFromScore(score: number | null): KaraokeState {
  if (score == null) return 'pending';
  if (score >= KARAOKE_HIT_THRESHOLD) return 'hit';
  if (score < KARAOKE_MISS_THRESHOLD) return 'missed';
  return 'seen';
}

/**
 * Map a card's tokens to karaoke states from a phrase comparison. When the
 * comparison phrase does not match the card phrase (stale comparison), every
 * token is 'pending' — we never mark a card against another card's scores.
 */
export function markCardTokens(
  card: VoicePracticeCard | null,
  comparison: KaraokeComparison | null,
  options: { phraseMatches: boolean },
): KaraokeState[] {
  const tokens = card?.tokens ?? [];
  if (tokens.length === 0) return [];
  if (!options.phraseMatches || !comparison || comparison.checkpoints.length === 0) {
    return tokens.map(() => 'pending');
  }
  return tokens.map((token) => {
    const checkpoint = checkpointForCardToken(token, comparison.checkpoints);
    return karaokeStateFromScore(checkpointQualityScore(checkpoint));
  });
}

/**
 * Normalize a comparison phrase for the card<->comparison phrase match (mirrors
 * the spirit of normalizeVoicePhraseTextForMatch in state.ts: case/space/punct
 * insensitive).
 */
export function normalizePhraseForMatch(value: string | null | undefined): string {
  if (typeof value !== 'string') return '';
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
