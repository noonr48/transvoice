'use strict';

/**
 * TV-FEM-R1-001 — canonical versioned self-report contract.
 *
 * GPT-Pro review finding 2.3: three inconsistent scale assumptions coexisted
 * (Python ge=1/le=5; calibration comments "0-10"; controller threshold 6).
 * This module is the ONE authority: a 1–5 integer-point application scale
 * (matching the only live producer, VoiceTrainer contracts.py), strict
 * numeric parsing (typeof number && finite — booleans/arrays/strings/blank
 * are MISSING, never measurements), and a versioned schema id.
 *
 * Every evidence boundary consumes this contract; none may re-implement it.
 */

const VOICE_SELF_REPORT_SCHEMA = 'transvoice.voice_self_report.v1';
const SCALE = 'five_point';
const MIN = 1;
const MAX = 5;

/**
 * Strict five-point parse: a real finite number in [1,5], or null.
 * Booleans, arrays, strings, NaN, Infinity, blank → null (missing evidence).
 */
function parseFivePoint(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  if (value < MIN || value > MAX) return null;
  return value;
}

/**
 * Normalize one raw self-report object against the canonical contract.
 * Unknown keys pass through untouched (forward compat); known numeric
 * fields strict-parse; booleans require typeof boolean.
 */
function normalizeSelfReport(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    schema: VOICE_SELF_REPORT_SCHEMA,
    scale: SCALE,
    pain: source.pain === true,
    throatPain: source.throatPain === true,
    effort: parseFivePoint(source.effort),
    strain: parseFivePoint(source.strain),
    fatigue: parseFivePoint(source.fatigue),
    discomfort: parseFivePoint(source.discomfort),
    // Free passthrough (self-report UIs may add fields; contract versions them)
    extra: (() => {
      const known = new Set(['schema', 'scale', 'pain', 'throatPain', 'effort', 'strain', 'fatigue', 'discomfort']);
      const out = {};
      for (const [k, v] of Object.entries(source)) {
        if (!known.has(k)) out[k] = v;
      }
      return out;
    })(),
  };
}

/**
 * Difficulty-escalation threshold on the 1–5 scale (named, versioned).
 * 4 or 5 = escalate (reduce difficulty); the review's "6+ on 0-10" was the
 * old invention — the canonical equivalent on five-point is >= 4.
 */
const REDUCE_DIFFICULTY_THRESHOLD = 4;

/**
 * Comfort bound on the 1–5 scale: effort at or below this is "comfortable"
 * for calibration movement verification. Old 0-10 bound of 5 (midpoint)
 * maps to 3 (midpoint of 1–5).
 */
const COMFORT_EFFORT_BOUND = 3;

module.exports = {
  COMFORT_EFFORT_BOUND,
  MAX,
  MIN,
  REDUCE_DIFFICULTY_THRESHOLD,
  SCALE,
  VOICE_SELF_REPORT_SCHEMA,
  normalizeSelfReport,
  parseFivePoint,
};
