/**
 * The plot axes (2026-07-30).
 *
 * The vertical axis was linear in HERTZ and had no test at all. That matters
 * more here than in most plots: this graph exists so a learner can copy the
 * SHAPE of the tutor's travel without any words. If the same musical move is
 * drawn as a different distance depending where the voice sits, the shape is a
 * lie and the whole pattern-matching premise fails.
 */
import { describe, expect, it } from 'vitest';

import {
  VOICE_GRAPH_MIN_PCT,
  VOICE_GRAPH_SPAN_PCT,
  VOICE_PITCH_MAX_HZ,
  VOICE_PITCH_MIN_HZ,
  voicePitchToGraphTopPct,
  voiceResonanceToGraphLeftPct,
} from './measurement-domain';

const BOTTOM = VOICE_GRAPH_MIN_PCT + VOICE_GRAPH_SPAN_PCT;

describe('pitch axis', () => {
  it('EQUAL MUSICAL INTERVALS ARE EQUAL DISTANCES — the property the graph rests on', () => {
    // An octave is an octave. Under the old linear-in-Hz axis these two measured
    // 23.8 and 47.5 — the same move drawn twice as large at the top of the range
    // as at the bottom.
    const lowOctave = Math.abs(voicePitchToGraphTopPct(100) - voicePitchToGraphTopPct(200));
    const highOctave = Math.abs(voicePitchToGraphTopPct(200) - voicePitchToGraphTopPct(400));
    expect(highOctave).toBeCloseTo(lowOctave, 5);

    // And it holds for a smaller interval, so this is not a coincidence of one span.
    const lowFifth = Math.abs(voicePitchToGraphTopPct(100) - voicePitchToGraphTopPct(150));
    const highFifth = Math.abs(voicePitchToGraphTopPct(160) - voicePitchToGraphTopPct(240));
    expect(highFifth).toBeCloseTo(lowFifth, 5);
  });

  it('keeps the plot bounds it always had, so nothing downstream shifts', () => {
    expect(voicePitchToGraphTopPct(VOICE_PITCH_MIN_HZ)).toBeCloseTo(BOTTOM, 5);
    expect(voicePitchToGraphTopPct(VOICE_PITCH_MAX_HZ)).toBeCloseTo(VOICE_GRAPH_MIN_PCT, 5);
  });

  it('runs the right way up and clamps outside the range', () => {
    // Higher pitch = smaller top% = higher on screen.
    expect(voicePitchToGraphTopPct(300)).toBeLessThan(voicePitchToGraphTopPct(120));
    expect(voicePitchToGraphTopPct(20)).toBeCloseTo(BOTTOM, 5);
    expect(voicePitchToGraphTopPct(9000)).toBeCloseTo(VOICE_GRAPH_MIN_PCT, 5);
  });

  it('never leaves the plot area, across the whole audible speaking range', () => {
    for (let hz = 40; hz <= 900; hz += 5) {
      const top = voicePitchToGraphTopPct(hz);
      expect(top).toBeGreaterThanOrEqual(VOICE_GRAPH_MIN_PCT - 1e-9);
      expect(top).toBeLessThanOrEqual(BOTTOM + 1e-9);
    }
  });
});

describe('resonance axis', () => {
  it('spans the plot and clamps', () => {
    expect(voiceResonanceToGraphLeftPct(0)).toBeCloseTo(VOICE_GRAPH_MIN_PCT, 5);
    expect(voiceResonanceToGraphLeftPct(1)).toBeCloseTo(BOTTOM, 5);
    expect(voiceResonanceToGraphLeftPct(-3)).toBeCloseTo(VOICE_GRAPH_MIN_PCT, 5);
    expect(voiceResonanceToGraphLeftPct(3)).toBeCloseTo(BOTTOM, 5);
  });
});
