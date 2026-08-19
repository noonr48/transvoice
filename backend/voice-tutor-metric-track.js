'use strict';

/**
 * The tutor's own travel across the pitch / mouth-shape field (2026-07-30).
 *
 * The call-and-response graph asks the learner to copy a SHAPE: the tutor
 * speaks and its dot travels, then she speaks and her dot travels over the
 * ghost of it. Her half has always worked, because her voice goes through the
 * analyzer. The tutor's half could not, because the app SYNTHESIZES the tutor's
 * speech and never listens to it.
 *
 * This module is the listening. It turns one analysis of synthesized tutor
 * audio into the small time-series the graph plots, and caches it beside the
 * audio it describes.
 *
 * THREE RULES IT OBEYS
 *
 * 1. It never invents a reading. The trust decision is delegated wholesale to
 *    `voice-measurement-validity.js` — the SAME gate that decides whether a
 *    learner's take may be scored, remembered or shown. A tutor reading that
 *    would not be trusted from a learner is not trusted from the tutor either,
 *    and the graph simply has no tutor dot that turn.
 *
 * 2. It is a DISPLAY artifact, not a measurement of record. It is deliberately
 *    lossy — a couple of dozen points, rounded to the precision a dot on a
 *    graph can express — because a shape to copy is all it has to be. It is
 *    never persisted, never trended, never fed back to the coach.
 *
 * 3. Missing is always an acceptable answer. Every function here returns null
 *    rather than throwing, and every caller must treat null as "no tutor dot
 *    this turn". The tutor must still SPEAK.
 */

const { resolveVoiceMeasurementUsability } = require('./voice-measurement-validity');

// A shape, not a recording. The analyzer hands back up to 360 compressed
// frames; the graph needs enough points to draw a gesture and no more. Twenty
// four points across a phrase is a legible contour that fits a response header
// with room to spare.
const DEFAULT_MAX_TRACK_POINTS = 24;

// Node will happily set a header far larger than any proxy will carry. Cap the
// encoded value well under the usual 8 KB total-header budget so a long tutor
// line can never cost the learner her audio.
const MAX_TRACK_HEADER_CHARS = 3072;

const DEFAULT_CACHE_MAX_ENTRIES = 256;

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function finiteOrNull(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function roundTo(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * The identity of a piece of tutor audio.
 *
 * Deliberately the SAME triple the gateway sends upstream to synthesize it —
 * target text, speaking rate, and which reference voice conditions it. Those
 * three inputs are exactly what determine the bytes, so a key built from them
 * is "the same key as the audio" from the only side of the wire that can build
 * one: VoxCPM's own per-segment cache keys live inside the TTS service and are
 * not addressable from here.
 *
 * A missing text yields null — an unkeyable track must not be cached, because
 * a wrong cache hit would draw the wrong shape for the learner to copy.
 */
function buildTutorMetricTrackKey({ text, speakingRate, referenceAudioPath } = {}) {
  const normalizedText = typeof text === 'string' ? text.trim() : '';
  if (!normalizedText) return null;
  const rate = finiteOrNull(speakingRate);
  // Use JSON's canonical round-trippable number spelling: this is the exact
  // numeric value sent in the synthesis body. Rounding here would let two
  // distinct upstream requests alias and attach one rate's track to another's
  // audio. JSON also correctly gives -0 and 0 the same on-wire identity.
  const referencePart = typeof referenceAudioPath === 'string' && referenceAudioPath
    ? referenceAudioPath
    : null;
  // Serialize the tuple structurally. Delimiter concatenation is not injective:
  // a `|` in either the voice identity or synthesized text can otherwise make
  // two different audio requests share one tutor track.
  return JSON.stringify([referencePart, rate == null ? null : rate, normalizedText]);
}

/**
 * A bounded most-recently-used cache.
 *
 * Bounded because tutor lines are unbounded: a long session speaks hundreds of
 * them, and an unbounded map would be a slow leak in a process that is meant to
 * run for days. Insertion-ordered Map + delete-on-read gives LRU for free.
 */
function createTutorMetricTrackCache({ maxEntries = DEFAULT_CACHE_MAX_ENTRIES } = {}) {
  const limit = Math.max(1, Math.round(Number(maxEntries) || DEFAULT_CACHE_MAX_ENTRIES));
  const entries = new Map();

  return {
    get(key) {
      if (!key || !entries.has(key)) return null;
      const value = entries.get(key);
      // Refresh recency.
      entries.delete(key);
      entries.set(key, value);
      return value;
    },
    set(key, value) {
      if (!key || !value) return false;
      if (entries.has(key)) entries.delete(key);
      entries.set(key, value);
      while (entries.size > limit) {
        const oldest = entries.keys().next().value;
        entries.delete(oldest);
      }
      return true;
    },
    has(key) {
      return Boolean(key) && entries.has(key);
    },
    delete(key) {
      return entries.delete(key);
    },
    clear() {
      entries.clear();
    },
    get size() {
      return entries.size;
    },
    get maxEntries() {
      return limit;
    },
  };
}

/**
 * Turn one analyzer response into the tutor's travel, or into nothing.
 *
 * Returns null — never throws, never a partial object — when the audio could
 * not be trusted, when the analyzer found no voiced frames, or when the
 * response is not the shape this expects. A caller that sees null draws no
 * tutor dot, which is a normal turn, not an error.
 */
function buildTutorMetricTrack(analysis, { maxPoints = DEFAULT_MAX_TRACK_POINTS } = {}) {
  if (!isRecord(analysis)) return null;

  const metrics = isRecord(analysis.metrics) ? analysis.metrics : null;
  if (!metrics) return null;

  // The learner's gate, applied to the tutor. A reading too unreliable to score
  // from a learner is too unreliable to hand her as a shape to copy.
  const validity = resolveVoiceMeasurementUsability(metrics);
  if (!validity.usableForScoring) return null;

  const timeline = Array.isArray(analysis.timeline) ? analysis.timeline : [];
  const voiced = timeline.filter((frame) => (
    isRecord(frame)
    && frame.voiced === true
    && finiteOrNull(frame.pitchHz) != null
    && Number(frame.pitchHz) > 0
    && finiteOrNull(frame.resonanceScore) != null
  ));
  // A single point is a dot, not a travel. Two is the minimum shape.
  if (voiced.length < 2) return null;

  const cap = Math.max(2, Math.round(Number(maxPoints) || DEFAULT_MAX_TRACK_POINTS));
  const points = [];
  if (voiced.length <= cap) {
    points.push(...voiced);
  } else {
    // Even spacing across the phrase, endpoints included — the same shape the
    // analyzer's own `compress_timeline` produces, for the same reason.
    const lastIndex = voiced.length - 1;
    for (let index = 0; index < cap; index += 1) {
      points.push(voiced[Math.round((index / (cap - 1)) * lastIndex)]);
    }
  }

  const meanPitchHz = finiteOrNull(metrics.meanPitchHz);
  const resonance = finiteOrNull(metrics.resonanceMean);
  if (meanPitchHz == null || resonance == null) return null;

  return {
    analysisVersion: typeof analysis.analysisVersion === 'string'
      ? analysis.analysisVersion
      : null,
    durationMs: finiteOrNull(analysis.durationMs) != null
      ? Math.max(0, Math.round(Number(analysis.durationMs)))
      : null,
    meanPitchHz: roundTo(meanPitchHz, 1),
    resonance: roundTo(resonance, 3),
    points: points.map((frame) => ({
      tMs: Math.max(0, Math.round(Number(frame.t) || 0)),
      pitchHz: roundTo(Number(frame.pitchHz), 1),
      resonance: roundTo(Number(frame.resonanceScore), 3),
    })),
  };
}

/**
 * Encode a track for the response header that carries the spoken audio.
 *
 * Compact keys because this rides on every tutor line. Returns null when the
 * track is absent, unencodable, or larger than a header should ever be — the
 * caller then sets no header, and the graph misses that turn. Losing a shape is
 * always preferable to risking the audio it belongs to.
 */
function encodeTutorMetricTrackHeader(track) {
  if (!isRecord(track) || !Array.isArray(track.points) || track.points.length < 2) {
    return null;
  }
  let points = track.points;
  for (;;) {
    let encoded;
    try {
      encoded = JSON.stringify({
        v: track.analysisVersion || undefined,
        durationMs: track.durationMs ?? undefined,
        meanPitchHz: track.meanPitchHz,
        resonance: track.resonance,
        points: points.map((point) => [point.tMs, point.pitchHz, point.resonance]),
      });
    } catch {
      return null;
    }
    if (typeof encoded !== 'string') return null;
    // Header values must be latin-1 safe; the payload is numbers plus an ASCII
    // version string, but never trust that without checking.
    if (/[^ -~]/.test(encoded)) return null;
    if (encoded.length <= MAX_TRACK_HEADER_CHARS) return encoded;
    if (points.length <= 2) return null;
    // Too big for a header: thin the shape rather than drop it.
    const thinned = [];
    const lastIndex = points.length - 1;
    const nextCount = Math.max(2, Math.floor(points.length / 2));
    for (let index = 0; index < nextCount; index += 1) {
      thinned.push(points[Math.round((index / (nextCount - 1)) * lastIndex)]);
    }
    points = thinned;
  }
}

/** Inverse of the encoder. Exists so tests can assert on the real wire form. */
function decodeTutorMetricTrackHeader(value) {
  if (typeof value !== 'string' || !value) return null;
  let parsed;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.points)) return null;
  const points = parsed.points
    .filter((point) => Array.isArray(point) && point.length >= 3)
    .map((point) => ({
      tMs: Number(point[0]),
      pitchHz: Number(point[1]),
      resonance: Number(point[2]),
    }))
    .filter((point) => (
      Number.isFinite(point.tMs)
      && Number.isFinite(point.pitchHz)
      && Number.isFinite(point.resonance)
    ));
  if (points.length < 2) return null;
  return {
    analysisVersion: typeof parsed.v === 'string' ? parsed.v : null,
    durationMs: finiteOrNull(parsed.durationMs),
    meanPitchHz: finiteOrNull(parsed.meanPitchHz),
    resonance: finiteOrNull(parsed.resonance),
    points,
  };
}

module.exports = {
  DEFAULT_CACHE_MAX_ENTRIES,
  DEFAULT_MAX_TRACK_POINTS,
  MAX_TRACK_HEADER_CHARS,
  buildTutorMetricTrack,
  buildTutorMetricTrackKey,
  createTutorMetricTrackCache,
  decodeTutorMetricTrackHeader,
  encodeTutorMetricTrackHeader,
};
