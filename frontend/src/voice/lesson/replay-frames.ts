// Lesson surface — replay frame mapping (Wave B).
//
// Maps replay playback position to a recorded-timeline frame index. The compass
// re-travels the recorded take by walking frames[0..k] as a growing trail with
// the dot at frame k, where k tracks audio playback position.
//
// FRAME-MAPPING MATH:
//   progress = clamp(currentTimeSec / durationSec, 0, 1)
//   k        = round(progress * (frames.length - 1))
//   dot      = frames[k]            (instantaneous position)
//   trail    = frames[0 .. k]       (path travelled so far, inclusive)
//   For the moment marker: kMoment = round(momentProgress * (frames.length-1)).
// Edge cases: empty frames -> -1 (caller shows visual-only with no dot);
// single frame -> always index 0; non-finite/zero duration -> index 0.
//
// Pure: no DOM. Type-only import of the frame shape.

import type { VoiceLiveFrame } from '../state';

export function replayFrameIndex(
  frameCount: number,
  currentTimeSec: number,
  durationSec: number,
): number {
  if (frameCount <= 0) return -1;
  if (frameCount === 1) return 0;
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const progress = Math.min(Math.max(currentTimeSec / durationSec, 0), 1);
  return Math.round(progress * (frameCount - 1));
}

export function replayFrameIndexAtProgress(frameCount: number, progress: number): number {
  if (frameCount <= 0) return -1;
  if (frameCount === 1) return 0;
  const clamped = Math.min(Math.max(progress, 0), 1);
  return Math.round(clamped * (frameCount - 1));
}

/**
 * The inclusive frames[0..k] slice for the growing trail. Returns at least the
 * first frame once k >= 0 so the polyline has a start; empty when k < 0.
 */
export function replayTrailFrames(
  frames: VoiceLiveFrame[],
  k: number,
): VoiceLiveFrame[] {
  if (!Array.isArray(frames) || frames.length === 0 || k < 0) return [];
  return frames.slice(0, Math.min(k + 1, frames.length));
}

/**
 * Elapsed milliseconds for a given frame index, for syncing card token windows.
 * Uses the recorded frame timestamps (`t`, seconds) when monotonic, else falls
 * back to a uniform split of durationMs.
 */
export function replayElapsedMsAtIndex(
  frames: VoiceLiveFrame[],
  k: number,
  durationMs: number,
): number {
  if (!Array.isArray(frames) || frames.length === 0 || k < 0) return 0;
  const index = Math.min(k, frames.length - 1);
  const first = frames[0]?.t;
  const at = frames[index]?.t;
  if (typeof first === 'number' && typeof at === 'number' && at >= first) {
    return (at - first) * 1000;
  }
  // Uniform fallback.
  if (frames.length <= 1) return 0;
  return (index / (frames.length - 1)) * (Number.isFinite(durationMs) ? durationMs : 0);
}
