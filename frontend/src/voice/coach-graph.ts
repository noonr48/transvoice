/**
 * THE CALL-AND-RESPONSE GRAPH (2026-07-30)
 *
 * Owner's description, verbatim: *"one dot shows for when the user speaks and the
 * other dot shows when the tutor speaks… it's meant to sub-conscious thinking…
 * the movements of a dot through colours, and space can teach the brain to learn
 * completely without words. no latin. no chemistry knowledge. pure pattern
 * matching."*
 *
 * So this is not a target to chase. It is a SHAPE TO IMITATE. The tutor speaks
 * and its dot travels; the learner speaks and hers travels over the ghost of it.
 * Nothing is scored, nothing is numbered, and no verdict is ever printed here —
 * that is deliberate and evidence-backed: grading every attempt measurably hurts
 * long-term retention, and a silent ambient display is the one form of feedback
 * that does not.
 *
 * THE AXES ARE NOT LABELLED IN THE APP'S BANNED REGISTER. The horizontal axis is
 * "buzz in your chest → buzz in your face", not "dark → bright"; the owner ruled
 * out the brightness vocabulary explicitly ("as if anyone knows wtf that is").
 * The vertical is pitch, spaced in semitones so the same musical move is the same
 * distance anywhere — see `measurement-domain.ts`.
 *
 * IT IS A MODE, NOT AN ADDITION. Product law allows exactly two persistent
 * controls and one instruction space on the Coach surface. This graph OCCUPIES
 * that single instruction space during a call-and-response drill and yields it
 * back to the practice sentence afterwards. Nothing persistent is added, nothing
 * scrolls, the two controls stay two.
 */

import {
  VOICE_GRAPH_MIN_PCT,
  VOICE_GRAPH_SPAN_PCT,
  VOICE_PITCH_MAX_HZ,
  VOICE_PITCH_MIN_HZ,
  voicePitchToGraphTopPct,
  voiceResonanceToGraphLeftPct,
} from './measurement-domain';

/** One measured instant of a voice. Only what this graph plots. */
export type CoachGraphPoint = {
  pitchHz: number;
  resonance: number;
};

export type TimedCoachGraphPoint = CoachGraphPoint & {
  tMs: number;
};

export type CoachGraphSpeaker = 'tutor' | 'learner';

const MAX_TRACK_HEADER_LENGTH = 4_096;
const MAX_TRACK_POINTS = 360;
const MAX_TRACK_DURATION_MS = 120_000;
const malformedTrackWitnessedGraphs = new WeakSet<object>();

/** Report one privacy-safe malformed-track witness per graph without risking playback. */
function reportMalformedTutorMetricTrack(graph: object, headerLength: number): void {
  if (malformedTrackWitnessedGraphs.has(graph)) return;
  malformedTrackWitnessedGraphs.add(graph);
  try {
    const telemetry = (globalThis as typeof globalThis & {
      __tvTelemetry?: {
        event: (
          level: 'warn',
          seam: string,
          failureClass: string,
          code: string,
          data: Record<string, unknown>,
        ) => void;
      };
    }).__tvTelemetry;
    telemetry?.event('warn', 'coach-graph', 'partial-function', 'tutor-track-invalid', {
      headerLength,
    });
  } catch {
    // The comparison is advisory; telemetry must never interrupt speech.
  }
}

/**
 * Decode the fail-soft compact JSON carried by X-Tutor-Metric-Track. The backend
 * deliberately uses [tMs, pitchHz, resonance] tuples to stay below proxy header
 * limits. Network headers are untrusted input: malformed, oversized,
 * out-of-order, or incomplete tracks return null and speech continues.
 */
export function decodeTutorMetricTrackHeader(value: string | null): TimedCoachGraphPoint[] | null {
  const encoded = typeof value === 'string' ? value.trim() : '';
  if (!encoded || encoded.length > MAX_TRACK_HEADER_LENGTH) return null;

  try {
    const parsed = JSON.parse(encoded) as { points?: unknown };
    if (!Array.isArray(parsed?.points)) return null;
    if (parsed.points.length < 2 || parsed.points.length > MAX_TRACK_POINTS) return null;

    let previousTime = -1;
    const points: TimedCoachGraphPoint[] = [];
    for (const candidate of parsed.points) {
      if (
        !Array.isArray(candidate)
        || candidate.length !== 3
        || candidate.some((coordinate) => typeof coordinate !== 'number')
      ) return null;
      const [tMs, pitchHz, resonance] = candidate;
      if (
        !Number.isFinite(pitchHz)
        || pitchHz <= 0
        || !Number.isFinite(resonance)
        || resonance < 0
        || resonance > 1
        || !Number.isFinite(tMs)
        || tMs < previousTime
        || tMs < 0
        || tMs > MAX_TRACK_DURATION_MS
      ) {
        return null;
      }
      points.push({ pitchHz, resonance, tMs });
      previousTime = tMs;
    }
    return points;
  } catch {
    return null;
  }
}

/**
 * How far off the natural band a voice sits, and which way.
 *
 * WHY THIS EXISTS. Pitch and mouth shape CO-VARY in real voices — which is why
 * the band on the community chart runs corner to corner instead of filling the
 * square. Raise pitch without the mouth shape following and you do not travel
 * toward the feminine corner; you leave the band SIDEWAYS, into territory that
 * reads as strained rather than feminine. That is the research's "pitch alone
 * sounds forced" rendered as geometry.
 *
 * Both axes are normalised into the same 0-1 field first — pitch in SEMITONE
 * space, so the comparison is perceptual rather than arithmetic — and the result
 * is the signed perpendicular offset from the y = x diagonal.
 *
 * @returns positive = pitch has run ahead of the mouth shape (the common fault);
 *          negative = mouth shape ahead of pitch; ~0 = travelling along the band.
 *          Range is bounded to ±0.707 (half of √2), the corners of the field.
 */
export function offBandOffset(point: CoachGraphPoint): number | null {
  if (!point) return null;
  const { pitchHz, resonance } = point;
  if (!Number.isFinite(pitchHz) || !Number.isFinite(resonance)) return null;

  const clampedPitch = Math.min(VOICE_PITCH_MAX_HZ, Math.max(VOICE_PITCH_MIN_HZ, pitchHz));
  const semitoneSpan = 12 * Math.log2(VOICE_PITCH_MAX_HZ / VOICE_PITCH_MIN_HZ);
  const y = (12 * Math.log2(clampedPitch / VOICE_PITCH_MIN_HZ)) / semitoneSpan;
  const x = Math.min(1, Math.max(0, resonance));

  return (y - x) / Math.SQRT2;
}

/**
 * Is this voice travelling ALONG the band, or leaving it sideways?
 *
 * The threshold is deliberately generous. Real voices scatter, a single attempt
 * is noisy, and the cost of crying "off band" at someone who is fine is much
 * higher here than the cost of staying quiet — this app's learners are already
 * inclined to believe they are doing it wrong.
 */
export const OFF_BAND_TOLERANCE = 0.18;

export function isOffBand(point: CoachGraphPoint): boolean {
  const offset = offBandOffset(point);
  return offset !== null && Math.abs(offset) > OFF_BAND_TOLERANCE;
}

export type CoachGraphOptions = {
  doc: Document;
  /** Where the graph mounts — the coach's single instruction space. */
  host?: HTMLElement | null;
};

const TRAIL_LIMIT = 48;

export function createCoachGraph(options: CoachGraphOptions) {
  const { doc } = options;
  const host = options.host ?? doc.getElementById('tv-coach-graph');
  if (!host) return null;

  const field = doc.createElement('div');
  field.className = 'tv-graph-field';

  // The band a natural voice travels along, drawn corner to corner. This is the
  // single most informative mark on the graph: leaving it sideways is the lesson.
  const band = doc.createElement('div');
  band.className = 'tv-graph-band';
  field.append(band);

  const trails: Record<CoachGraphSpeaker, SVGPolylineElement> = {
    tutor: makeTrail(doc, 'tutor'),
    learner: makeTrail(doc, 'learner'),
  };
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', 'tv-graph-trails');
  svg.setAttribute('viewBox', '0 0 100 100');
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.append(trails.tutor, trails.learner);
  field.append(svg);

  const dots: Record<CoachGraphSpeaker, HTMLElement> = {
    tutor: makeDot(doc, 'tutor'),
    learner: makeDot(doc, 'learner'),
  };
  field.append(dots.tutor, dots.learner);
  host.append(field);

  const paths: Record<CoachGraphSpeaker, Array<{ x: number; y: number }>> = {
    tutor: [],
    learner: [],
  };
  let trackTimers: number[] = [];

  const stopTrack = (): void => {
    for (const timer of trackTimers) {
      if (doc.defaultView) doc.defaultView.clearTimeout(timer);
      else globalThis.clearTimeout(timer);
    }
    trackTimers = [];
  };

  const schedule = (callback: () => void, delayMs: number): number => (
    doc.defaultView
      ? doc.defaultView.setTimeout(callback, delayMs)
      : globalThis.setTimeout(callback, delayMs) as unknown as number
  );

  const place = (speaker: CoachGraphSpeaker, point: CoachGraphPoint): void => {
    if (!Number.isFinite(point?.pitchHz) || !Number.isFinite(point?.resonance)) return;
    const x = voiceResonanceToGraphLeftPct(point.resonance);
    const y = voicePitchToGraphTopPct(point.pitchHz);
    dots[speaker].style.left = `${x}%`;
    dots[speaker].style.top = `${y}%`;
    dots[speaker].classList.remove('tv-graph-dot-parked');

    const path = paths[speaker];
    path.push({ x, y });
    if (path.length > TRAIL_LIMIT) path.shift();
    trails[speaker].setAttribute('points', path.map((p) => `${p.x},${p.y}`).join(' '));
  };

  /**
   * ALTERNATE, NEVER OVERLAP. Whoever is speaking is live; the other dims and
   * stays put, and its trail remains as a ghost to be travelled over. Call, then
   * response — the same rhythm as hearing a sound and then making it.
   */
  const setSpeaker = (speaker: CoachGraphSpeaker): void => {
    field.dataset.speaking = speaker;
    const other: CoachGraphSpeaker = speaker === 'tutor' ? 'learner' : 'tutor';
    dots[speaker].classList.remove('tv-graph-dot-parked');
    dots[other].classList.add('tv-graph-dot-parked');
    // A new turn by this speaker starts a fresh line; the other's ghost survives.
    paths[speaker] = [];
    trails[speaker].setAttribute('points', '');
  };

  const beginTurn = (speaker: CoachGraphSpeaker): void => {
    stopTrack();
    setSpeaker(speaker);
  };

  const playTrack = (speaker: CoachGraphSpeaker, points: TimedCoachGraphPoint[]): boolean => {
    if (!Array.isArray(points) || points.length < 2) return false;
    stopTrack();
    setSpeaker(speaker);
    // Analyzer timestamps are absolute offsets from first audio. Keep the dot
    // parked until the first measured frame instead of rebasing that frame to 0.
    dots[speaker].classList.add('tv-graph-dot-parked');
    host.hidden = false;
    for (const point of points) {
      const delayMs = Math.max(0, point.tMs);
      if (delayMs === 0) place(speaker, point);
      else trackTimers.push(schedule(() => place(speaker, point), delayMs));
    }
    return true;
  };

  const parkTrack = (speaker: CoachGraphSpeaker): void => {
    stopTrack();
    dots[speaker].classList.add('tv-graph-dot-parked');
    if (field.dataset.speaking === speaker) delete field.dataset.speaking;
  };

  const clearTrack = (speaker: CoachGraphSpeaker): void => {
    parkTrack(speaker);
    paths[speaker] = [];
    trails[speaker].setAttribute('points', '');
    dots[speaker].removeAttribute('style');
  };

  return {
    /** Begin a turn. The previous speaker's trail is kept as the thing to copy. */
    beginTurn,
    /** Feed one measured instant of the current speaker's voice. */
    push: (speaker: CoachGraphSpeaker, point: CoachGraphPoint): void => place(speaker, point),
    /** Animate an already-measured utterance in lockstep with its playback. */
    playTrack,
    /** Park one completed speaker while preserving its trail as the comparison ghost. */
    parkTrack,
    /** Remove one speaker's stale comparison without disturbing the other. */
    clearTrack,
    /** Reveal the graph — it takes over the instruction space for this drill. */
    show: (): void => { host.hidden = false; },
    /** Hand the instruction space back to the practice sentence. */
    hide: (): void => {
      stopTrack();
      host.hidden = true;
    },
    /** Clear both trails. Used when a drill ends, not between turns. */
    reset: (): void => {
      stopTrack();
      for (const speaker of ['tutor', 'learner'] as CoachGraphSpeaker[]) {
        paths[speaker] = [];
        trails[speaker].setAttribute('points', '');
        dots[speaker].classList.add('tv-graph-dot-parked');
      }
      delete field.dataset.speaking;
    },
    /** Exposed for tests and for the tutor's own wording decisions. */
    isOffBand,
    offBandOffset,
  };
}

/** Decode and start the exact tutor track carried by a speech response. */
export function playTutorMetricTrackHeader(
  graph: ReturnType<typeof createCoachGraph>,
  encodedTrack: string | null,
  invalidHeaderLength?: number,
): boolean {
  if (!graph) return false;
  const track = decodeTutorMetricTrackHeader(encodedTrack);
  if (!track) {
    const observedInvalidLength = typeof encodedTrack === 'string' && encodedTrack.trim()
      ? encodedTrack.trim().length
      : typeof invalidHeaderLength === 'number' && Number.isFinite(invalidHeaderLength)
        ? Math.max(0, Math.round(invalidHeaderLength))
        : 0;
    if (observedInvalidLength > 0) {
      reportMalformedTutorMetricTrack(graph, observedInvalidLength);
    }
    graph.clearTrack('tutor');
    return false;
  }
  return graph.playTrack('tutor', track);
}

function makeDot(doc: Document, speaker: CoachGraphSpeaker): HTMLElement {
  const dot = doc.createElement('div');
  dot.className = `tv-graph-dot tv-graph-dot-${speaker} tv-graph-dot-parked`;
  dot.dataset.speaker = speaker;
  return dot;
}

function makeTrail(doc: Document, speaker: CoachGraphSpeaker): SVGPolylineElement {
  const line = doc.createElementNS('http://www.w3.org/2000/svg', 'polyline');
  line.setAttribute('class', `tv-graph-trail tv-graph-trail-${speaker}`);
  line.setAttribute('points', '');
  return line;
}

/** Exported for the CSS/markup contract test — the plot area the dots live in. */
export const COACH_GRAPH_BOUNDS = Object.freeze({
  minPct: VOICE_GRAPH_MIN_PCT,
  maxPct: VOICE_GRAPH_MIN_PCT + VOICE_GRAPH_SPAN_PCT,
});
