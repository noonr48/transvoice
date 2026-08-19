'use strict';

/**
 * section-scorer — per-section (per-word-fragment) scoring of one take.
 *
 * PURPOSE (sentence-teardown pedagogy, phase B). The coach can already say
 * "your pitch sat under the band on that take". It cannot say WHICH PART of the
 * sentence was weakest, so phase C has nothing to isolate and drill. This module
 * slices the attempt artifact's per-frame timeline into per-token sections,
 * scores each against the target bands, and — only when it is genuinely
 * entitled to — names ONE fragment as the weakest.
 *
 * =====================================================================
 * ALIGNMENT PROVENANCE — READ THIS BEFORE TRUSTING A SECTION BOUNDARY
 * =====================================================================
 * There is NO measured word timing anywhere in this repo. Verified 2026-07-26
 * by repo-wide search: no ASR word timestamps, no forced aligner, and
 * `phraseComparison.checkpoints` (the only structure that ever carried
 * startProgress/endProgress downstream) still has ZERO producers.
 *
 * The only per-token positional signal that exists is voice-cue-sheet.js:803-804:
 *
 *     startProgress: clamp01(wordIndex / words.length),
 *     endProgress:   clamp01((wordIndex + 1) / words.length),
 *
 * Those fractions are relative to the phrase's WORD COUNT — not to the take's
 * audio duration, and not to anything measured. They encode the assumption
 * "word k occupies time slice k of N equal slices". Worse, practice-cards.js
 * `buildCardTokens` (l.190-197) DROPS them entirely: a PracticeCard token is
 * `{ text, emphasis, focusHint }` and carries no timing at all.
 *
 * So this module derives the same uniform fractions itself when a token lacks
 * them, and stamps every result with `alignment: 'uniform-word-index'`. A
 * consumer that treats a section boundary as a MEASURED word boundary is wrong.
 *
 * The known, SYSTEMATIC error: English phrase-final syllables run roughly
 * 1.5-2x the mean word duration, so a uniform grid places the final token's
 * window too early and lets it steal frames from its predecessor. That bias
 * does not average out. Two mechanisms absorb it, and both are load-bearing:
 *   (1) the isolation unit is a FRAGMENT of 1-3 adjacent tokens, not a lone
 *       word — adjacent weak tokens merge, which widens the window past the
 *       alignment error;
 *   (2) `worst.confident` is fail-closed behind FIVE absolute gates (below):
 *       evidence on the blamed axis, a margin over a MEASURED rival, measurement
 *       usability, localization (a whole-phrase span is not a section), and a
 *       nameable fragment. Keep this list in step with the `Gate N:` comments —
 *       a section-scorer.test.js check fails if the two ever disagree.
 *
 * =====================================================================
 * CONSTANTS — every value traces to a shipped number, not to taste
 * =====================================================================
 * MIN_SECTION_VOICED_FRAMES = 5
 *   The timeline this module receives is a UNIFORM RESAMPLE of the WHOLE take,
 *   decimated three times on the way here:
 *     1. DSP analyses at 100 fps (ANALYSIS_HOP_SIZE=160 at 16 kHz,
 *        services/voice-trainer/src/services/audio_analysis.py:45);
 *     2. the trainer samples the attempt artifact to <=180 frames
 *        (streaming_analyzer.py:47 ATTEMPT_ARTIFACT_TIMELINE_FRAMES);
 *     3. THE BINDING ONE — normalizeVoiceAttemptArtifact re-samples to <=80
 *        frames (voice-session-state.js:918-921, an explicit `80` argument that
 *        overrides normalizeVoiceDetailedTimeline's own 160 default).
 *   So the operative geometry is NOT a frame rate at all: it is 80 frames spread
 *   uniformly across the take, however long it is. Frames per token are
 *   therefore 80/N for an N-word line, and voiced frames are that times the
 *   voiced fraction. Measured live on a 5-word card: exactly 16 voiced frames
 *   per token.
 *     - 3-word line  -> ~26 frames/token
 *     - 5-word line  -> 16 frames/token   (the drill-pack median is 5 words)
 *     - 8-word line  -> 10 frames/token   (the drill-pack maximum)
 *   A floor of 5 therefore starts to bite around a 10-16-word line (sooner when
 *   voicing is sparse) — which is exactly where a single word is too narrow in
 *   time to blame anyway, and where the 1-3-token merge restores the evidence.
 *   5 is also the smallest count at which a median has three interior samples
 *   rather than being the average of two. Both arguments land on the same value.
 *   NOTE the historical trap: the LIVE stream path runs ~16 fps
 *   (streaming_analyzer.py:43) and it is tempting to derive this constant from
 *   "a 300 ms word at 16 fps = 4.8 frames". That arrives at 5 too, but by
 *   accident — the artifact cap above, not the frame rate, is what governs.
 *
 * SECTION_SCORE_MARGIN = 1.0 severity unit
 *   Severity is expressed in AXIS QUANTA, where one quantum is one clearly
 *   audible miss on that axis:
 *     - pitch:            1.00 semitone (the perceptual just-noticeable
 *                         difference for pitch in connected speech)
 *     - resonance/weight: 0.14 score units — the codebase's OWN shipped
 *                         half-band, signal-builder.js:239-240 and 253-254,
 *                         which synthesize a band as legacy +/- 0.14.
 *   A band-relative margin was designed first and REJECTED: the shipped presets
 *   span 2.14 st (gender-neutral 152-172 Hz) to 6.52 st (soft-feminine
 *   175-255 Hz) — a 3.05x spread after the 2026-07-26 MTF-only cut, and 4.6x
 *   before it — so one band-fraction would mean well under the JND on the
 *   tightest preset and be absurdly strict on the widest. Absolute quanta are
 *   preset-independent, so the cut does not change these constants.
 *
 * MAX_FRAGMENT_TOKENS = 3
 *   The isolation unit phase C drills. Stated by the pedagogy contract; a
 *   fragment longer than three words stops being a fragment.
 *
 * Pure module: no I/O, no clock, no requires beyond the shared usability gate.
 * Every entry point is total — malformed input returns { sections: [], worst: null }.
 */

const { resolveVoiceMeasurementUsability } = require('../voice-measurement-validity');

// See the constant derivations in the header block above.
const MIN_SECTION_VOICED_FRAMES = 5;
const SECTION_SCORE_MARGIN = 1.0;
const MAX_FRAGMENT_TOKENS = 3;

// One "clearly audible miss" per axis, in that axis's native units.
const PITCH_QUANTUM_SEMITONES = 1.0;
const SCORE_AXIS_QUANTUM = 0.14;

const AXES = ['pitch', 'resonance', 'weight'];

function toFiniteOrNull(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp01(value) {
  if (!Number.isFinite(value)) return null;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

/**
 * Median of a finite-number list. Returns null for an empty list. Used instead
 * of a mean because a single octave-error frame from the pitch estimator would
 * drag a mean clean out of the band and invent a weak section.
 */
function median(values) {
  if (!Array.isArray(values) || values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? sorted[mid]
    : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Semitone distance between two Hz values. Null-safe; requires both > 0. */
function semitonesBetween(fromHz, toHz) {
  if (!Number.isFinite(fromHz) || !Number.isFinite(toHz)) return null;
  if (fromHz <= 0 || toHz <= 0) return null;
  return 12 * Math.log2(toHz / fromHz);
}

/**
 * Signed distance OUTSIDE a [floor, ceiling] band.
 *   below floor -> negative, above ceiling -> positive, inside -> 0.
 * A missing/degenerate band returns null (axis not scoreable).
 */
function bandDistance(value, floor, ceiling, { asSemitones = false } = {}) {
  if (!Number.isFinite(value)) return null;
  const lo = toFiniteOrNull(floor);
  const hi = toFiniteOrNull(ceiling);
  if (lo == null || hi == null || !(hi > lo)) return null;
  if (value < lo) {
    return asSemitones ? semitonesBetween(lo, value) : value - lo;
  }
  if (value > hi) {
    return asSemitones ? semitonesBetween(hi, value) : value - hi;
  }
  return 0;
}

/**
 * Normalize the caller's tokens into ordered slices with [start,end] progress
 * fractions.
 *
 * Accepts BOTH shapes on purpose:
 *   - cue-sheet tokens, which carry startProgress/endProgress
 *     (voice-cue-sheet.js:803-804) — used verbatim when both are finite and
 *     ordered;
 *   - practice-card tokens `{ text, emphasis, focusHint }`
 *     (practice-cards.js:21), which carry NO timing — the same uniform
 *     word-index fractions are derived here.
 * Either way the fractions are word-index fractions. See the header.
 *
 * The supplied/derived decision is ALL-OR-NOTHING across the array, never per
 * token. Honoring some tokens' fractions while deriving others mixes two grids
 * and opens GAPS that belong to no section — frames in a gap would be scored by
 * nobody, so a genuinely weak stretch of audio could vanish between two tokens.
 * (Caught by the (e2) regression test, which observed 87 of 100 frames landing
 * in a section.) A supplied grid must therefore be a genuine TILING: every
 * token finite and in range, each window starting exactly where the previous
 * one ended, the first starting at 0 and the last ending at 1. Anything less —
 * a hole, an overlap, a short start, an early finish — and the whole array
 * falls back to the uniform word-index slices. Non-contiguity is the subtle
 * case: `[0,0.3]` and `[0.6,1.0]` are individually well-formed and ordered, yet
 * lose 30% of the take. Either way `sections.length === tokens.length` and the
 * windows tile the take without holes.
 */
const GRID_EPSILON = 1e-6;

function normalizeTokens(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return [];
  const total = tokens.length;

  const raws = tokens.map((token) => (token && typeof token === 'object' ? token : {}));
  const texts = tokens.map((token, index) => {
    if (typeof token === 'string') return token;
    return typeof raws[index].text === 'string' ? raws[index].text : '';
  });

  // A supplied grid is trusted only if EVERY token is well-formed AND the
  // windows form a contiguous, complete tiling of [0,1].
  let gridUsable = true;
  let previousEnd = null;
  const supplied = raws.map((raw) => {
    const start = clamp01(toFiniteOrNull(raw.startProgress));
    const end = clamp01(toFiniteOrNull(raw.endProgress));
    if (start == null || end == null || !(end > start)) {
      gridUsable = false;
      return null;
    }
    // Contiguity: the first window opens at 0, and every later window opens
    // exactly where its predecessor closed — no hole, no overlap.
    const expectedStart = previousEnd == null ? 0 : previousEnd;
    if (Math.abs(start - expectedStart) > GRID_EPSILON) {
      gridUsable = false;
      return null;
    }
    previousEnd = end;
    return { start, end };
  });
  // Completeness: the last window must close at the end of the take.
  if (previousEnd == null || Math.abs(previousEnd - 1) > GRID_EPSILON) {
    gridUsable = false;
  }

  return raws.map((_raw, index) => {
    const window = gridUsable && supplied[index]
      ? supplied[index]
      : { start: index / total, end: (index + 1) / total };
    return {
      index,
      text: texts[index],
      startProgress: window.start,
      endProgress: window.end,
      supplied: gridUsable,
    };
  });
}

/**
 * Resolve each frame's position as a fraction of the take, so the token
 * fractions and the frame times live on the same axis.
 *
 * `t` is milliseconds from take start.
 *
 * The span is taken from THE TIMELINE'S OWN first and last timestamps, not from
 * `durationMs`. That precedence is deliberate. The timeline is a uniform
 * resample of every analysed frame of the take, first to last
 * (streaming_analyzer.py _sample_attempt_timeline), so its own endpoints ARE the
 * spoken line by construction. `durationMs` is metadata about the audio and can
 * legitimately disagree — a take whose leading or trailing silence was trimmed
 * reports the untrimmed duration while the frames cover only the trimmed span.
 * Preferring `durationMs` there would squeeze every token window toward the
 * start of the take and hand the final token almost no frames, which is exactly
 * the mis-blame this module must not commit. Using the first frame's `t` (rather
 * than assuming 0) covers an offset timeline for the same reason.
 *
 * `durationMs` is kept as a fallback for the case where the timestamps cannot
 * define a span at all. Failing that, INDEX position is used, which is exactly
 * right for a uniform resample. Positions are clamped to [0,1] either way, so a
 * token window past the end simply collects no frames rather than wrapping.
 */
function normalizeTimeline(timeline, durationMs) {
  if (!Array.isArray(timeline) || timeline.length === 0) return [];
  const frames = timeline
    .map((frame) => (frame && typeof frame === 'object' ? frame : null))
    .filter(Boolean);
  if (frames.length === 0) return [];

  const times = frames.map((frame) => toFiniteOrNull(frame.t));
  const known = times.filter((t) => t != null);
  const firstTime = known.length > 0 ? Math.min(...known) : null;
  const lastTime = known.length > 0 ? Math.max(...known) : null;
  const observedSpan = firstTime != null && lastTime != null && lastTime > firstTime
    ? lastTime - firstTime
    : null;
  const declaredSpan = toFiniteOrNull(durationMs);
  const span = observedSpan ?? (declaredSpan != null && declaredSpan > 0 ? declaredSpan : null);
  const origin = observedSpan != null ? firstTime : 0;

  const lastIndex = Math.max(1, frames.length - 1);
  return frames.map((frame, index) => {
    const t = times[index];
    // Time-based position when we have a real span AND a real timestamp;
    // otherwise index position (correct for the uniform resample this backend
    // performs — voice-session-state.js normalizeVoiceDetailedTimeline).
    const position = span != null && t != null
      ? clamp01((t - origin) / span)
      : clamp01(index / lastIndex);
    return {
      index,
      position: position == null ? 0 : position,
      voiced: frame.voiced === true,
      pitchHz: toFiniteOrNull(frame.pitchHz),
      resonanceScore: toFiniteOrNull(frame.resonanceScore),
      weightScore: toFiniteOrNull(frame.weightScore),
      confidence: toFiniteOrNull(frame.confidence),
    };
  });
}

/**
 * Collect the frames whose position falls in [startProgress, endProgress).
 * The final token's window is closed on the right so the last frame is never
 * dropped by a floating-point hair.
 */
function framesForWindow(frames, startProgress, endProgress, isLast) {
  return frames.filter((frame) => {
    if (frame.position < startProgress) return false;
    return isLast ? frame.position <= endProgress : frame.position < endProgress;
  });
}

/**
 * Score one window of frames against the target bands.
 * Returns the per-axis deltas (in each axis's NATIVE unit, for the caller to
 * read) plus the severity in axis quanta (comparable across axes) and the
 * confidence-weighted score.
 */
function scoreWindow(frames, target) {
  const voicedFrames = frames.filter((frame) => frame.voiced);
  const pitchValues = voicedFrames
    .map((frame) => frame.pitchHz)
    .filter((value) => value != null && value > 0);
  const resonanceValues = voicedFrames
    .map((frame) => frame.resonanceScore)
    .filter((value) => value != null);
  const weightValues = voicedFrames
    .map((frame) => frame.weightScore)
    .filter((value) => value != null);
  const confidenceValues = voicedFrames
    .map((frame) => frame.confidence)
    .filter((value) => value != null);

  // Semitone distance outside the pitch band; normalized distance outside the
  // resonance/weight bands. Null when the axis is unscoreable here.
  const pitchDelta = bandDistance(
    median(pitchValues), target.pitchFloorHz, target.pitchCeilingHz, { asSemitones: true },
  );
  const resonanceDelta = bandDistance(
    median(resonanceValues), target.resonanceFloor, target.resonanceCeiling,
  );
  const weightDelta = bandDistance(
    median(weightValues), target.weightFloor, target.weightCeiling,
  );

  const severities = {
    pitch: pitchDelta == null ? null : Math.abs(pitchDelta) / PITCH_QUANTUM_SEMITONES,
    resonance: resonanceDelta == null ? null : Math.abs(resonanceDelta) / SCORE_AXIS_QUANTUM,
    weight: weightDelta == null ? null : Math.abs(weightDelta) / SCORE_AXIS_QUANTUM,
  };

  const sampleCounts = {
    pitch: pitchValues.length,
    resonance: resonanceValues.length,
    weight: weightValues.length,
  };

  let axis = null;
  let severity = 0;
  for (const candidate of AXES) {
    const value = severities[candidate];
    if (value == null) continue;
    if (axis === null || value > severity) {
      axis = candidate;
      severity = value;
    }
  }

  // Confidence weighting: a section the estimator was unsure about must not
  // out-score a section it was sure about. A REAL artifact frame always carries
  // the field — voice-session-state.js:615 coerces a missing confidence to 0,
  // which zeroes the score and so fails closed. The default of 1 below is
  // therefore reached only by hand-built fixtures that omit the field entirely.
  const meanConfidence = confidenceValues.length > 0
    ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length
    : 1;

  const deltaByAxis = { pitch: pitchDelta, resonance: resonanceDelta, weight: weightDelta };
  const scoredAxis = severity > 0 ? axis : null;
  return {
    frames: frames.length,
    voicedFrames: voicedFrames.length,
    pitchDelta,
    resonanceDelta,
    weightDelta,
    axis: scoredAxis,
    severity,
    confidence: meanConfidence,
    score: severity * meanConfidence,
    direction: severity > 0 && axis ? directionFor(deltaByAxis[axis]) : null,
    // How many voiced frames actually backed EACH axis's median.
    //
    // Per-axis rather than a single number, because two different questions are
    // asked of it and they are about different axes:
    //   - the evidence gate asks "did the BLAMED axis have enough samples?" — a
    //     window can hold twenty voiced frames while the pitch estimator
    //     returned a usable Hz for only one, and a median of one is not
    //     evidence;
    //   - the margin gate asks "was the rival MEASURED on the leader's axis?" —
    //     and a rival with nothing wrong has no blamed axis of its own, so a
    //     single "count for my own worst axis" number would report 0 for every
    //     clean section and make a clean rival indistinguishable from an
    //     unmeasured one. (That conflation was introduced and caught here: it
    //     zeroed the margin on a take whose other four words were perfect.)
    axisSampleCounts: sampleCounts,
    // Convenience: the count backing the blamed axis (0 when nothing is blamed).
    axisSampleCount: scoredAxis ? sampleCounts[scoredAxis] : 0,
  };
}

/**
 * The fields resolveVoiceMeasurementUsability actually inspects. Kept in step
 * with voice-measurement-validity.js readAdvancedMetrics + the checks below it;
 * this is a presence test only — the shared resolver still owns every verdict.
 */
const MEASUREMENT_EVIDENCE_FIELDS = [
  'measurementAvailable',
  'measurementRejectionReasons',
  'rejectionReasons',
  'reliabilityFlags',
  'scoreConfidence',
  'voicedFramePct',
  'confidentFramePct',
  'captureReliability',
  'pitchValidFrameCount',
  'snrDb',
  'clippingPct',
];

/**
 * True when `value` carries at least one field the usability resolver reads.
 * Accepts the same shapes the resolver does: a full summary, `{ advanced }`, or
 * the advanced block itself.
 */
function hasMeasurementEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidates = [value, value.advanced, value.metrics?.advanced];
  return candidates.some((candidate) => (
    candidate
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && MEASUREMENT_EVIDENCE_FIELDS.some((field) => candidate[field] !== undefined)
  ));
}

/** Which side of the band the section fell on. */
function directionFor(delta) {
  if (delta == null || delta === 0) return null;
  return delta < 0 ? 'under' : 'over';
}

/**
 * Merge adjacent WEAK single-token sections into fragments of up to
 * MAX_FRAGMENT_TOKENS.
 *
 * "Weak" means the section is outside a band (severity > 0) on the same axis
 * AND on the same SIDE of that band as its neighbour. Both halves matter:
 *   - same axis, because merging a flat word with a heavy word would produce a
 *     fragment that is not about one thing, and phase C could not drill it;
 *   - same DIRECTION, because two words on OPPOSITE sides of one band average
 *     back INTO the band. The merged fragment then scores zero, disappears from
 *     the ranking, and the mildest remaining word wins — so the coach
 *     confidently blames the wrong word while the two genuinely worst words are
 *     erased. Reproduced before this guard existed: "my"(1.74st under) +
 *     "voice"(1.62st over) merged to a delta of exactly 0.00, and "lovely"
 *     (1.14st under, the mildest miss on the take) was named with confident:true.
 *     That is the precise failure this module exists to prevent.
 *
 * This is not cosmetic. The uniform word-index alignment mis-places boundaries
 * by up to roughly half a word (phrase-final lengthening, see header), so a
 * two-or-three-token fragment is the smallest unit whose window reliably
 * contains the audio that was actually weak.
 */
function mergeAdjacentWeak(sections, frames, target) {
  const merged = [];
  let cursor = 0;
  while (cursor < sections.length) {
    const head = sections[cursor];
    if (!head.axis || head.severity <= 0) {
      merged.push(head);
      cursor += 1;
      continue;
    }
    let end = cursor;
    while (
      end + 1 < sections.length
      && (end + 1) - cursor + 1 <= MAX_FRAGMENT_TOKENS
      && sections[end + 1].axis === head.axis
      // Same side of the band — see the header. Without this, opposite-side
      // neighbours cancel to zero and vanish from the ranking.
      && sections[end + 1].direction === head.direction
      && sections[end + 1].severity > 0
    ) {
      end += 1;
    }
    if (end === cursor) {
      merged.push(head);
      cursor += 1;
      continue;
    }
    // Rescore across the combined window rather than averaging the parts: the
    // fragment's median is the honest statistic for the fragment.
    const startProgress = sections[cursor].startProgress;
    const endProgress = sections[end].endProgress;
    const isLast = end === sections.length - 1;
    const windowFrames = framesForWindow(frames, startProgress, endProgress, isLast);
    const scored = scoreWindow(windowFrames, target);
    merged.push({
      tokenStart: sections[cursor].tokenStart,
      tokenEnd: sections[end].tokenEnd,
      text: sections.slice(cursor, end + 1).map((s) => s.text).filter(Boolean).join(' '),
      startProgress,
      endProgress,
      merged: true,
      ...scored,
    });
    cursor = end + 1;
  }
  return merged;
}

/**
 * Score one take's sections and, when entitled to, name the weakest fragment.
 *
 * @param {object}   input
 * @param {Array}    input.timeline    attempt-artifact per-frame timeline
 *                                     ({ t, voiced, pitchHz, resonanceScore,
 *                                     weightScore, confidence, ... })
 * @param {Array}    input.tokens      card tokens (`{ text, ... }`) or cue-sheet
 *                                     tokens (which additionally carry
 *                                     start/endProgress)
 * @param {object}   input.target      target bands: pitchFloorHz/pitchCeilingHz,
 *                                     resonanceFloor/Ceiling, weightFloor/Ceiling
 * @param {number}  [input.durationMs] take duration; falls back to the last
 *                                     frame's `t`, then to frame index position
 * @param {object}  [input.metrics]    advanced metrics for the measurement
 *                                     usability gate (accepts a full summary,
 *                                     `{ advanced }`, or the advanced block)
 *
 * @returns {{ sections: Array, worst: object|null, alignment: string }}
 *
 *   READ THIS BEFORE CONSUMING `worst`. `worst` is null only when no section
 *   scored above zero — which covers "nothing was outside a band", an unusable
 *   input, AND a take whose per-frame confidence was all zero (score is severity
 *   times mean confidence, and a real artifact coerces a missing confidence to 0,
 *   voice-session-state.js:615). Whenever SOME section leads, `worst` is a
 *   POPULATED object even if the gates failed — it carries
 *   tokenStart/tokenEnd/text/axis/direction/margin/voicedFrames/score for
 *   diagnostics, and `confident: false`.
 *
 *   Therefore `worst.confident === true` is the ONLY safe predicate for naming a
 *   fragment to a learner. A null-check alone is NOT sufficient and will blame a
 *   fragment on thin evidence, a tie, or an unusable measurement. Consumers that
 *   want the strict "worst:null" semantics should read
 *   `worst && worst.confident ? worst : null`.
 */
function scoreTakeSections({
  timeline = null,
  tokens = null,
  target = null,
  durationMs = null,
  metrics = null,
} = {}) {
  const empty = { sections: [], worst: null, alignment: 'uniform-word-index' };

  if (!target || typeof target !== 'object') return empty;
  const normalizedTokens = normalizeTokens(tokens);
  if (normalizedTokens.length === 0) return empty;
  const frames = normalizeTimeline(timeline, durationMs);
  if (frames.length === 0) return empty;

  const bands = {
    pitchFloorHz: toFiniteOrNull(target.pitchFloorHz),
    pitchCeilingHz: toFiniteOrNull(target.pitchCeilingHz),
    resonanceFloor: toFiniteOrNull(target.resonanceFloor),
    resonanceCeiling: toFiniteOrNull(target.resonanceCeiling),
    weightFloor: toFiniteOrNull(target.weightFloor),
    weightCeiling: toFiniteOrNull(target.weightCeiling),
  };

  const perToken = normalizedTokens.map((token, index) => {
    const isLast = index === normalizedTokens.length - 1;
    const windowFrames = framesForWindow(
      frames, token.startProgress, token.endProgress, isLast,
    );
    return {
      tokenStart: token.index,
      tokenEnd: token.index,
      text: token.text,
      startProgress: token.startProgress,
      endProgress: token.endProgress,
      merged: false,
      ...scoreWindow(windowFrames, bands),
    };
  });

  const sections = mergeAdjacentWeak(perToken, frames, bands);

  // ---- The five confident gates. Fail-closed: any doubt -> confident false. ----
  const ranked = sections.slice().sort((a, b) => b.score - a.score);
  const leader = ranked[0] || null;

  if (!leader || !leader.axis || leader.score <= 0) {
    return { sections, worst: null, alignment: 'uniform-word-index' };
  }

  // Gate 1: enough evidence under the leader to hold a median — counted on the
  // BLAMED axis, not on raw voiced frames (a window can be voiced throughout
  // while the pitch estimator returned a usable value only once).
  const framesEnough = (leader.axisSampleCounts?.[leader.axis] ?? 0) >= MIN_SECTION_VOICED_FRAMES;

  // Gate 2: the leader must be one audible miss clear of the field.
  // The comparison baseline must itself be MEASURED ON THE LEADER'S AXIS. An
  // unmeasured neighbour scores 0 by default, which would hand the leader a free
  // margin equal to its own score — but an unmeasured section is not known to be
  // better, it is unknown, and unknown must not read as "clearly not the
  // problem". A CLEAN neighbour, by contrast, IS measured and is exactly the
  // baseline we want, so the test is per-axis sample count and not "does this
  // section have a blamed axis".
  //
  // The baseline is the TOP-SCORING rival, never "the best-scoring rival that
  // happens to be measured". Scanning past an unmeasured rival to a quieter one
  // would compare the leader against a section it already beat while ignoring
  // its closest competitor — measured on a different axis, a rival can outscore
  // the chosen baseline and be skipped, inflating the margin. So: take
  // `others[0]`, and if IT is not measured on the leader's axis, the separation
  // is simply not establishable and confidence is refused.
  const others = ranked.slice(1);
  const topRival = others[0] || null;
  const rivalMeasured = topRival !== null
    && (topRival.axisSampleCounts?.[leader.axis] ?? 0) >= MIN_SECTION_VOICED_FRAMES;
  // With no other section at all (a single-token line) there is nothing to be
  // confused WITH, so the leader's own severity must clear the margin. Note
  // gate 4 independently blocks that case, so this branch is belt-and-braces.
  const margin = topRival === null
    ? leader.score
    : (rivalMeasured ? leader.score - topRival.score : 0);
  const marginEnough = margin >= SECTION_SCORE_MARGIN
    && (topRival === null || rivalMeasured);

  // Gate 3: the take's own measurement must be usable for scoring at all.
  // The shared resolver is reused verbatim — never re-implemented or relaxed.
  // But note the deliberate divergence on ABSENCE: resolveVoiceMeasurementUsability
  // treats an absent measurement as usable (measurementAvailable === null stays
  // USABLE, so an absent take does not get accused of a capture fault it was
  // never observed to have). That convention is right for "may this take be
  // scored at all"; it is WRONG for "may I name one word as the culprit".
  // Here, no evidence about measurement quality must mean no naming.
  // The test is for EVIDENCE, not merely for a non-empty object: `{foo: 1}` is
  // truthy and non-empty yet says nothing about measurement quality, and would
  // otherwise re-open the fail-open hole. At least one field the shared resolver
  // actually reads must be present.
  const usable = hasMeasurementEvidence(metrics)
    && resolveVoiceMeasurementUsability(metrics).usableForScoring;

  // Gate 4: a "section" that spans the WHOLE phrase is not a localization — it
  // is a whole-take verdict, which the existing take-level coaching already
  // covers. Naming it here would tell phase C to isolate the entire sentence,
  // which is not an isolation at all. Reachable when every token is weak on one
  // axis and the phrase is short enough to merge into a single fragment.
  const localized = !(leader.tokenStart === 0 && leader.tokenEnd === normalizedTokens.length - 1);

  // Gate 5: `confident` means "phase C may isolate and drill THIS fragment", so
  // a fragment with no nameable text cannot be confident however clean the
  // measurement was — it can be neither spoken about nor isolated. Without this,
  // a blank card token produced a witness line claiming a confident blame while
  // the renderer (which needs the text) emitted nothing: the log and the prompt
  // disagreed about whether the coach had been told anything.
  const nameable = typeof leader.text === 'string' && leader.text.trim().length > 0;

  const confident = Boolean(framesEnough && marginEnough && usable && localized && nameable);

  return {
    sections,
    worst: {
      tokenStart: leader.tokenStart,
      tokenEnd: leader.tokenEnd,
      text: leader.text,
      axis: leader.axis,
      direction: leader.direction,
      margin,
      voicedFrames: leader.voicedFrames,
      score: leader.score,
      confident,
    },
    alignment: 'uniform-word-index',
  };
}

module.exports = {
  scoreTakeSections,
  MIN_SECTION_VOICED_FRAMES,
  SECTION_SCORE_MARGIN,
  MAX_FRAGMENT_TOKENS,
  PITCH_QUANTUM_SEMITONES,
  SCORE_AXIS_QUANTUM,
};
