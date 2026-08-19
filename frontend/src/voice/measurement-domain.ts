/** Canonical analyzer/custom-target pitch domain used by every voice plot. */
export const VOICE_PITCH_MIN_HZ = 80;
export const VOICE_PITCH_MAX_HZ = 400;
export const VOICE_GRAPH_MIN_PCT = 12;
export const VOICE_GRAPH_SPAN_PCT = 76;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Pitch on the vertical axis, spaced by EAR rather than by hertz.
 *
 * This axis was linear in Hz (80-400). Hearing is logarithmic: the step from
 * 100 to 120 Hz is a large musical move, the step from 300 to 320 Hz is a small
 * one, and a linear axis draws them the same size. That squashes movement at the
 * bottom of the range and exaggerates it at the top — so the same vocal gesture
 * is drawn differently depending where the voice sits, which is precisely the
 * distortion a graph built for PATTERN MATCHING cannot afford.
 *
 * Semitones fix it: equal musical intervals become equal distances, so a rise of
 * "the same amount" looks the same anywhere on the axis, and the tutor's travel
 * shape can be imitated rather than merely aimed at.
 *
 * Endpoints are unchanged — 80 Hz still sits at the bottom of the plot area and
 * 400 Hz at the top — so nothing downstream that reasons about the plot bounds
 * has to change. Only the spacing in between differs.
 */
export function voicePitchToGraphTopPct(pitchHz: number): number {
  const pitch = clamp(pitchHz, VOICE_PITCH_MIN_HZ, VOICE_PITCH_MAX_HZ);
  const semitonesFromFloor = 12 * Math.log2(pitch / VOICE_PITCH_MIN_HZ);
  const semitoneSpan = 12 * Math.log2(VOICE_PITCH_MAX_HZ / VOICE_PITCH_MIN_HZ);
  return VOICE_GRAPH_MIN_PCT + VOICE_GRAPH_SPAN_PCT
    - (semitonesFromFloor / semitoneSpan) * VOICE_GRAPH_SPAN_PCT;
}

export function voiceResonanceToGraphLeftPct(resonance: number): number {
  return VOICE_GRAPH_MIN_PCT + clamp(resonance, 0, 1) * VOICE_GRAPH_SPAN_PCT;
}
