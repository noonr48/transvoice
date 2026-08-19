'use strict';

// Spaced-repetition + mastery math, ported from the Sloane structured-memory
// substrate (sloane-local/simplemem/cross/structured.py — mastery_step/level +
// sm2_step). PURE, deterministic, no deps, no LLM, no network — so the voice
// tutor gets real per-concept EWMA mastery + SM-2 review scheduling while still
// running fully offline/standalone. We adopt Sloane's ALGORITHMS, not its system.

const DAY_MS = 86_400_000;

// ── per-skill EWMA mastery (structured.py mastery_step / mastery_level) ──────
const MASTERY_EWMA_ALPHA = 0.3;
const MASTERY_MIN_ATTEMPTS = 3;
const MASTERY_BANDS = [[0.85, 'mastered'], [0.65, 'proficient'], [0.40, 'developing']];

function masteryLevelFor(attempts, ewma) {
  if (!(Number(attempts) >= MASTERY_MIN_ATTEMPTS)) return 'novice';
  for (const [threshold, level] of MASTERY_BANDS) {
    if (ewma >= threshold) return level;
  }
  return 'novice';
}

// One EWMA update. `outcome` truthy = a success. First observation SEEDS the ewma
// (no decay toward 0). Returns {attempts, successes, ewma, level}.
function masteryStep(prev, outcome) {
  const a = Math.max(0, Number(prev && prev.attempts) || 0);
  const s = Math.max(0, Number(prev && prev.successes) || 0);
  const prevEwma = Number.isFinite(prev && prev.ewma) ? prev.ewma : 0;
  const o = outcome ? 1 : 0;
  const ewma = a === 0 ? o : (MASTERY_EWMA_ALPHA * o + (1 - MASTERY_EWMA_ALPHA) * prevEwma);
  const attempts = a + 1;
  const successes = s + (outcome ? 1 : 0);
  return { attempts, successes, ewma, level: masteryLevelFor(attempts, ewma) };
}

// ── SM-2 spaced repetition (structured.py sm2_step) ─────────────────────────
const SM2_MIN_EASE = 1.3;
const SM2_DEFAULT_EASE = 2.5;

function roundHalfUp(x) { return Math.floor(x + 0.5); } // canonical SM-2 rounding

// One SM-2 update. grade 0..5; q<3 is a lapse. nowMs injected (pure). Returns
// {ease, intervalDays, reps, lapses, dueAt} where dueAt is a ms-epoch number.
function sm2Step(prev, grade, nowMs) {
  const ease = Number.isFinite(prev && prev.ease) ? prev.ease : SM2_DEFAULT_EASE;
  const intervalDays = Math.max(0, Number(prev && prev.intervalDays) || 0);
  const reps = Math.max(0, Number(prev && prev.reps) || 0);
  const lapses = Math.max(0, Number(prev && prev.lapses) || 0);
  const gradeNum = Number(grade);
  // non-numeric/NaN grade → conservative lapse (q=0), never propagate NaN into ease/interval
  const q = Number.isFinite(gradeNum) ? Math.max(0, Math.min(5, Math.round(gradeNum))) : 0;
  const newEase = Math.max(SM2_MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  let newReps;
  let newLapses;
  let newInterval;
  if (q < 3) {
    newReps = 0;
    newLapses = lapses + 1;
    newInterval = 1;
  } else {
    if (reps === 0) newInterval = 1;
    else if (reps === 1) newInterval = 6;
    else newInterval = roundHalfUp(intervalDays * newEase);
    newReps = reps + 1;
    newLapses = lapses;
  }
  const base = Number.isFinite(nowMs) ? nowMs : Date.now();
  return { ease: newEase, intervalDays: newInterval, reps: newReps, lapses: newLapses, dueAt: base + newInterval * DAY_MS };
}

module.exports = {
  DAY_MS,
  MASTERY_EWMA_ALPHA, MASTERY_MIN_ATTEMPTS,
  masteryLevelFor, masteryStep,
  SM2_MIN_EASE, SM2_DEFAULT_EASE, roundHalfUp, sm2Step,
};
