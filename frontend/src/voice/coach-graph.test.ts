/**
 * The call-and-response graph (2026-07-30).
 *
 * What matters is not that dots exist — it is that the graph tells the truth
 * about the ONE thing it was built to teach: pitch and mouth shape travel
 * together, and pitch running ahead on its own is the fault, not the goal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OFF_BAND_TOLERANCE,
  createCoachGraph,
  decodeTutorMetricTrackHeader,
  isOffBand,
  offBandOffset,
  playTutorMetricTrackHeader,
} from './coach-graph';

describe('off-band offset — the thing the graph is for', () => {
  it('a voice travelling ALONG the band reads as on-band, low and high alike', () => {
    // Both axes low, and both axes high: two very different voices, both moving
    // pitch and mouth shape together. Neither is a fault.
    expect(Math.abs(offBandOffset({ pitchHz: 100, resonance: 0.13 })!)).toBeLessThan(OFF_BAND_TOLERANCE);
    expect(Math.abs(offBandOffset({ pitchHz: 320, resonance: 0.86 })!)).toBeLessThan(OFF_BAND_TOLERANCE);
  });

  it('PITCH WITHOUT THE MOUTH SHAPE is flagged, and signed positive', () => {
    // The classic beginner fault, and the thing the research calls "pitch alone
    // sounds forced": she has pushed the pitch right up with no change in shape.
    const forced = { pitchHz: 340, resonance: 0.16 };
    expect(offBandOffset(forced)!).toBeGreaterThan(OFF_BAND_TOLERANCE);
    expect(isOffBand(forced)).toBe(true);
  });

  it('the OPPOSITE imbalance is flagged too, and signed negative', () => {
    const shapeOnly = { pitchHz: 95, resonance: 0.88 };
    expect(offBandOffset(shapeOnly)!).toBeLessThan(-OFF_BAND_TOLERANCE);
    expect(isOffBand(shapeOnly)).toBe(true);
  });

  it('is PERCEPTUAL, not arithmetic — the pitch half is measured in semitones', () => {
    // 100->200 Hz and 200->400 Hz are the same musical move. If the offset were
    // computed on raw Hz, the second would swamp the first and the graph would
    // call a perfectly balanced high voice "off band".
    const lowStep = offBandOffset({ pitchHz: 200, resonance: 0.5 })!
      - offBandOffset({ pitchHz: 100, resonance: 0.5 })!;
    const highStep = offBandOffset({ pitchHz: 400, resonance: 0.5 })!
      - offBandOffset({ pitchHz: 200, resonance: 0.5 })!;
    expect(highStep).toBeCloseTo(lowStep, 5);
  });

  it('refuses to judge what it cannot measure', () => {
    expect(offBandOffset({ pitchHz: Number.NaN, resonance: 0.5 })).toBeNull();
    expect(offBandOffset({ pitchHz: 200, resonance: Number.NaN })).toBeNull();
    // A null offset must never be reported as a fault.
    expect(isOffBand({ pitchHz: Number.NaN, resonance: 0.5 })).toBe(false);
  });

  it('the tolerance is generous, because a false accusation costs more here', () => {
    // A learner already inclined to think she is doing it wrong must not be told
    // she is off-band for an ordinary amount of scatter.
    const mildlyUneven = { pitchHz: 230, resonance: 0.44 };
    expect(isOffBand(mildlyUneven)).toBe(false);
  });
});

describe('call and response', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="tv-coach-graph"></div>';
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const build = () => createCoachGraph({ doc: document });
  const encodeTrack = (payload: unknown): string => JSON.stringify(payload);

  it('ALTERNATES: the speaker is live, the other parks — never both at once', () => {
    const graph = build()!;
    expect(graph).not.toBeNull();

    graph.beginTurn('tutor');
    const tutorDot = document.querySelector('[data-speaker="tutor"]')!;
    const learnerDot = document.querySelector('[data-speaker="learner"]')!;
    expect(tutorDot.classList.contains('tv-graph-dot-parked')).toBe(false);
    expect(learnerDot.classList.contains('tv-graph-dot-parked')).toBe(true);

    graph.beginTurn('learner');
    expect(learnerDot.classList.contains('tv-graph-dot-parked')).toBe(false);
    expect(tutorDot.classList.contains('tv-graph-dot-parked')).toBe(true);
  });

  it("THE GHOST SURVIVES: the tutor's trail is still there for her to travel over", () => {
    const graph = build()!;
    graph.beginTurn('tutor');
    graph.push('tutor', { pitchHz: 180, resonance: 0.4 });
    graph.push('tutor', { pitchHz: 240, resonance: 0.6 });
    const tutorTrail = document.querySelector('.tv-graph-trail-tutor')!;
    const ghost = tutorTrail.getAttribute('points');
    expect(ghost).toBeTruthy();

    // Her turn begins. Her own line starts fresh; his stays as the thing to copy.
    graph.beginTurn('learner');
    expect(tutorTrail.getAttribute('points')).toBe(ghost);
    expect(document.querySelector('.tv-graph-trail-learner')!.getAttribute('points')).toBe('');
  });

  it('higher pitch places the dot HIGHER, and more forward places it RIGHT', () => {
    const graph = build()!;
    graph.beginTurn('learner');
    const dot = document.querySelector('[data-speaker="learner"]') as HTMLElement;

    graph.push('learner', { pitchHz: 120, resonance: 0.2 });
    const low = { top: parseFloat(dot.style.top), left: parseFloat(dot.style.left) };
    graph.push('learner', { pitchHz: 300, resonance: 0.8 });
    const high = { top: parseFloat(dot.style.top), left: parseFloat(dot.style.left) };

    expect(high.top).toBeLessThan(low.top);   // smaller top% = higher on screen
    expect(high.left).toBeGreaterThan(low.left);
  });

  it('an unmeasurable instant moves nothing rather than jumping to a corner', () => {
    const graph = build()!;
    graph.beginTurn('learner');
    graph.push('learner', { pitchHz: 200, resonance: 0.5 });
    const dot = document.querySelector('[data-speaker="learner"]') as HTMLElement;
    const settled = dot.style.top;

    graph.push('learner', { pitchHz: Number.NaN, resonance: 0.5 });
    expect(dot.style.top).toBe(settled);
  });

  it('YIELDS THE SPACE BACK — it is a mode of the canvas, not an addition', () => {
    const graph = build()!;
    const host = document.getElementById('tv-coach-graph') as HTMLElement;
    graph.show();
    expect(host.hidden).toBe(false);
    graph.hide();
    expect(host.hidden).toBe(true);
  });

  it('returns null instead of throwing when the markup is absent', () => {
    document.body.innerHTML = '';
    expect(createCoachGraph({ doc: document })).toBeNull();
  });

  it('BEHAVIOUR, not source strings: a frame in makes a dot move', () => {
    // The source-grep version of this check passed against a graph that drew
    // nothing at all — constructed, referenced, and dead, because the turn was
    // never started and the host was never shown. Only driving it proves it.
    const graph = build()!;
    const host = document.getElementById('tv-coach-graph') as HTMLElement;
    const dot = () => document.querySelector('[data-speaker="learner"]') as HTMLElement;

    // Cold: the graph shell is visible from startup; dots are parked, nowhere.
    expect(host.hidden).toBe(false);
    expect(dot().classList.contains('tv-graph-dot-parked')).toBe(true);
    expect(dot().style.top).toBe('');

    // The three calls the app must make for anything to appear.
    graph.beginTurn('learner');
    graph.show();
    graph.push('learner', { pitchHz: 210, resonance: 0.55 });

    expect(host.hidden).toBe(false);
    expect(dot().classList.contains('tv-graph-dot-parked')).toBe(false);
    expect(dot().style.top).not.toBe('');
    expect(document.querySelector('.tv-graph-trail-learner')!.getAttribute('points'))
      .toMatch(/\d/);
  });

  it('decodes the tutor header strictly and fails soft on malformed tracks', () => {
    const valid = encodeTrack({
      v: 'voice-v5',
      durationMs: 120,
      points: [
        [0, 180, 0.4],
        [120, 220, 0.6],
      ],
    });
    expect(decodeTutorMetricTrackHeader(valid)).toEqual([
      { tMs: 0, pitchHz: 180, resonance: 0.4 },
      { tMs: 120, pitchHz: 220, resonance: 0.6 },
    ]);
    expect(decodeTutorMetricTrackHeader(null)).toBeNull();
    expect(decodeTutorMetricTrackHeader('not-json')).toBeNull();
    expect(decodeTutorMetricTrackHeader(encodeTrack({ points: [] }))).toBeNull();
    expect(decodeTutorMetricTrackHeader(encodeTrack({
      points: [
        [20, 180, 0.4],
        [10, 220, 0.6],
      ],
    }))).toBeNull();
    for (const malformed of [
      [[0, '180', 0.4], [10, 220, 0.6]],
      [[0, 180, null], [10, 220, 0.6]],
      [[0, 180, 0.4, 99], [10, 220, 0.6]],
    ]) {
      expect(decodeTutorMetricTrackHeader(encodeTrack({ points: malformed }))).toBeNull();
    }
    expect(decodeTutorMetricTrackHeader(encodeTrack({
      points: Array.from({ length: 49 }, (_, index) => [index * 10, 180 + index, 0.5]),
    }))).toHaveLength(49);
    expect(decodeTutorMetricTrackHeader('x'.repeat(4_097))).toBeNull();
    expect(decodeTutorMetricTrackHeader(encodeTrack({
      points: Array.from({ length: 361 }, (_, index) => [index * 10, 180, 0.5]),
    }))).toBeNull();
    expect(decodeTutorMetricTrackHeader(encodeTrack({
      points: [[0, 180, 0.4], [120_001, 220, 0.6]],
    }))).toBeNull();
  });

  it('plays the tutor track in time, then preserves its ghost for the learner', () => {
    vi.useFakeTimers();
    const graph = build()!;
    const host = document.getElementById('tv-coach-graph') as HTMLElement;
    const tutorDot = document.querySelector('[data-speaker="tutor"]') as HTMLElement;
    const tutorTrail = document.querySelector('.tv-graph-trail-tutor')!;
    const encodedTrack = encodeTrack({
      v: 'voice-v5',
      points: [
        [200, 140, 0.2],
        [300, 220, 0.55],
        [500, 280, 0.8],
      ],
    });

    expect(playTutorMetricTrackHeader(graph, encodedTrack)).toBe(true);
    expect(host.hidden).toBe(false);
    expect(tutorDot.classList.contains('tv-graph-dot-parked')).toBe(true);
    expect(tutorDot.style.top).toBe('');
    expect(tutorTrail.getAttribute('points')).toBe('');

    vi.advanceTimersByTime(199);
    expect(tutorDot.style.top).toBe('');
    expect(tutorTrail.getAttribute('points')).toBe('');
    vi.advanceTimersByTime(1);
    const firstTop = tutorDot.style.top;
    expect(firstTop).not.toBe('');
    expect(tutorTrail.getAttribute('points')?.trim().split(/\s+/)).toHaveLength(1);

    vi.advanceTimersByTime(100);
    expect(tutorDot.style.top).not.toBe(firstTop);
    vi.advanceTimersByTime(200);
    const ghost = tutorTrail.getAttribute('points');
    expect(ghost?.trim().split(/\s+/)).toHaveLength(3);

    graph.parkTrack('tutor');
    expect(tutorDot.classList.contains('tv-graph-dot-parked')).toBe(true);
    expect(tutorTrail.getAttribute('points')).toBe(ghost);
    expect(host.hidden).toBe(false);

    graph.beginTurn('learner');
    expect(tutorTrail.getAttribute('points')).toBe(ghost);
    expect(document.querySelector('.tv-graph-trail-learner')!.getAttribute('points')).toBe('');
  });

  it('clears an unavailable tutor comparison without erasing the learner trail', () => {
    vi.useFakeTimers();
    const graph = build()!;
    const learnerTrail = document.querySelector('.tv-graph-trail-learner')!;
    const tutorTrail = document.querySelector('.tv-graph-trail-tutor')!;
    graph.beginTurn('learner');
    graph.push('learner', { pitchHz: 180, resonance: 0.4 });
    graph.push('learner', { pitchHz: 190, resonance: 0.5 });
    const learnerGhost = learnerTrail.getAttribute('points');
    graph.playTrack('tutor', [
      { tMs: 0, pitchHz: 140, resonance: 0.2 },
      { tMs: 500, pitchHz: 280, resonance: 0.8 },
    ]);
    expect(tutorTrail.getAttribute('points')).not.toBe('');

    expect(playTutorMetricTrackHeader(graph, null)).toBe(false);

    expect(tutorTrail.getAttribute('points')).toBe('');
    expect(learnerTrail.getAttribute('points')).toBe(learnerGhost);
    vi.advanceTimersByTime(600);
    expect(tutorTrail.getAttribute('points')).toBe('');
    expect(learnerTrail.getAttribute('points')).toBe(learnerGhost);
  });

  it('reports malformed tutor data once while clearing only the tutor comparison', () => {
    vi.useFakeTimers();
    const graph = build()!;
    const learnerTrail = document.querySelector('.tv-graph-trail-learner')!;
    const tutorTrail = document.querySelector('.tv-graph-trail-tutor')!;
    const telemetryGlobal = globalThis as typeof globalThis & {
      __tvTelemetry?: { event: ReturnType<typeof vi.fn> };
    };
    const previousTelemetry = telemetryGlobal.__tvTelemetry;
    const event = vi.fn();
    telemetryGlobal.__tvTelemetry = { event };

    try {
      graph.beginTurn('learner');
      graph.push('learner', { pitchHz: 180, resonance: 0.4 });
      const learnerGhost = learnerTrail.getAttribute('points');
      graph.playTrack('tutor', [
        { tMs: 0, pitchHz: 140, resonance: 0.2 },
        { tMs: 500, pitchHz: 280, resonance: 0.8 },
      ]);
      expect(playTutorMetricTrackHeader(graph, null)).toBe(false);
      expect(event).not.toHaveBeenCalled();
      graph.playTrack('tutor', [
        { tMs: 0, pitchHz: 140, resonance: 0.2 },
        { tMs: 500, pitchHz: 280, resonance: 0.8 },
      ]);

      expect(playTutorMetricTrackHeader(graph, null, 'not-json'.length)).toBe(false);
      expect(playTutorMetricTrackHeader(graph, '{still-not-json')).toBe(false);

      expect(tutorTrail.getAttribute('points')).toBe('');
      expect(learnerTrail.getAttribute('points')).toBe(learnerGhost);
      expect(event).toHaveBeenCalledTimes(1);
      expect(event).toHaveBeenCalledWith(
        'warn',
        'coach-graph',
        'partial-function',
        'tutor-track-invalid',
        { headerLength: 'not-json'.length },
      );
    } finally {
      if (previousTelemetry) telemetryGlobal.__tvTelemetry = previousTelemetry;
      else delete telemetryGlobal.__tvTelemetry;
    }
  });

  it('contains a throwing malformed-track witness so playback remains fail-soft', () => {
    const graph = build()!;
    const learnerTrail = document.querySelector('.tv-graph-trail-learner')!;
    const tutorTrail = document.querySelector('.tv-graph-trail-tutor')!;
    const telemetryGlobal = globalThis as typeof globalThis & {
      __tvTelemetry?: { event: ReturnType<typeof vi.fn> };
    };
    const previousTelemetry = telemetryGlobal.__tvTelemetry;
    const event = vi.fn(() => {
      throw new Error('telemetry sink unavailable');
    });
    telemetryGlobal.__tvTelemetry = { event };

    try {
      graph.beginTurn('learner');
      graph.push('learner', { pitchHz: 180, resonance: 0.4 });
      const learnerGhost = learnerTrail.getAttribute('points');
      graph.playTrack('tutor', [
        { tMs: 0, pitchHz: 140, resonance: 0.2 },
        { tMs: 0, pitchHz: 280, resonance: 0.8 },
      ]);
      expect(tutorTrail.getAttribute('points')).not.toBe('');

      let firstResult: boolean | undefined;
      let secondResult: boolean | undefined;
      expect(() => {
        firstResult = playTutorMetricTrackHeader(graph, 'not-json');
        secondResult = playTutorMetricTrackHeader(graph, '{still-not-json');
      }).not.toThrow();

      expect([firstResult, secondResult]).toEqual([false, false]);
      expect(tutorTrail.getAttribute('points')).toBe('');
      expect(learnerTrail.getAttribute('points')).toBe(learnerGhost);
      expect(event).toHaveBeenCalledTimes(1);
    } finally {
      if (previousTelemetry) telemetryGlobal.__tvTelemetry = previousTelemetry;
      else delete telemetryGlobal.__tvTelemetry;
    }
  });

  it('cancels the remaining tutor animation when the turn is interrupted', () => {
    vi.useFakeTimers();
    const graph = build()!;
    const tutorTrail = document.querySelector('.tv-graph-trail-tutor')!;
    graph.playTrack('tutor', [
      { tMs: 0, pitchHz: 140, resonance: 0.2 },
      { tMs: 500, pitchHz: 280, resonance: 0.8 },
    ]);
    const before = tutorTrail.getAttribute('points');

    graph.beginTurn('learner');
    vi.advanceTimersByTime(600);
    expect(tutorTrail.getAttribute('points')).toBe(before);
  });
});

describe('the band must connect the corners the maths connects', () => {
  // Caught in review, and only by rendering it: the CSS said `to top right`,
  // which paints a stripe running top-left -> bottom-right, because a gradient's
  // colour stops sit PERPENDICULAR to its gradient line. On these axes that
  // stripe joins high-pitch-with-chest-buzz to low-pitch-with-face-buzz — the
  // FAULT drawn as the guide, on a display whose entire premise is copying the
  // picture. `to top left` puts it on the bottom-left -> top-right diagonal.
  it('the on-band corners are low+chest and high+face', () => {
    // Bottom-left of the plot = lowest pitch, least forward. Top-right = highest,
    // most forward. Both must read as ON the band; the other two corners must not.
    const lowChest = offBandOffset({ pitchHz: 80, resonance: 0 })!;
    const highFace = offBandOffset({ pitchHz: 400, resonance: 1 })!;
    expect(Math.abs(lowChest)).toBeLessThan(OFF_BAND_TOLERANCE);
    expect(Math.abs(highFace)).toBeLessThan(OFF_BAND_TOLERANCE);

    const highChest = offBandOffset({ pitchHz: 400, resonance: 0 })!;
    const lowFace = offBandOffset({ pitchHz: 80, resonance: 1 })!;
    expect(Math.abs(highChest)).toBeGreaterThan(OFF_BAND_TOLERANCE);
    expect(Math.abs(lowFace)).toBeGreaterThan(OFF_BAND_TOLERANCE);
    // ...and they are the extremes, opposite in sign.
    expect(highChest).toBeCloseTo(Math.SQRT1_2, 6);
    expect(lowFace).toBeCloseTo(-Math.SQRT1_2, 6);
  });
});
