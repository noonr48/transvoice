'use strict';

const { resolveVoiceMeasurementUsability } = require('../voice-measurement-validity');

/**
 * One real sentence a day (V1.5 §1 / PRACTICE-PHILOSOPHY modality 2).
 *
 * The bridge from practice to life at minimum dose: ONE sentence the person will
 * actually say today, rehearsed together, asked about tomorrow. An OFFER, never
 * an obligation — a missed day produces NO debt, no broken anything, no negative
 * record. This module is the PURE core (entry normalize/create, deterministic
 * suggestions, the readiness heuristic, the warm outcome/coach templates, and the
 * held-ratio computation). The learner-context service owns persistence of the
 * `voice.realSentences` list + helpers; the route handlers + runtime wire it.
 *
 * BINDING constraints from the contract:
 *  - text <= 120 chars on pick.
 *  - suggestions: deterministic, exactly 3, drawn from learner topics/hobbies +
 *    displayName intro + a small everyday-template pool; NEVER repeats the last
 *    10 picked sentences.
 *  - readiness (advisory ONLY, never gates): >= 2 takes today on the real_sentence
 *    card AND latest held-ratio >= 0.7 -> status 'ready'.
 *  - outcomes: said-well -> whatWorked append; said-rough / not-said -> NO negative
 *    record anywhere, the coach line handles it warmly.
 */

const MAX_SENTENCE_LEN = 120;
const MAX_NOTE_LEN = 240;
const REAL_SENTENCES_CAP = 60; // newest first, capped
const NO_REPEAT_RECENT = 10; // suggestions never repeat the last N picked
const SUGGESTION_COUNT = 3;
const READINESS_MIN_TAKES_TODAY = 2;
const READINESS_HELD_RATIO = 0.7;
// Per-token "held" threshold for the karaoke-style checkpoint scores AND the
// per-frame timeline fallback (a token/frame counts as "held" at/above this).
const HELD_TOKEN_SCORE = 0.6;

const REAL_SENTENCE_STATUSES = Object.freeze(['picked', 'ready', 'carried', 'debriefed']);
const REAL_SENTENCE_OUTCOMES = Object.freeze(['said-well', 'said-rough', 'not-said']);

// Everyday-template pool (the "minimum dose" real-world lines). Kept small +
// deterministic; the displayName intro is generated separately when known.
const EVERYDAY_TEMPLATES = Object.freeze([
  'A flat white, please.',
  'Hi — could you help me find something?',
  'Hello, this is regarding my appointment.',
  'Could I get a table for one?',
  'Thanks so much — have a good one.',
  'Excuse me, do you have this in another size?',
  'Can I pay by card?',
  'Sorry, could you say that again?',
]);

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizeText(value, maxLength) {
  const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
  return s ? s.slice(0, maxLength) : '';
}

function toFiniteOrNull(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Local date string (YYYY-MM-DD) for a timestamp, using the host's local tz —
 * matches `pickedAt` semantics ("local date string" in the contract). `now` is a
 * ms epoch; default = Date.now().
 */
function localDateString(now = Date.now()) {
  const d = new Date(now);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

let rsCounter = 0;
function nextRealSentenceId(now = Date.now()) {
  rsCounter += 1;
  const rand = Math.random().toString(16).slice(2, 8);
  return `rs_${now.toString(36)}_${rsCounter.toString(36)}_${rand}`;
}

/**
 * Normalize a single realSentences entry (additive default-merge, total). An
 * entry without text is dropped (returns null) so the list never carries empties.
 */
function normalizeRealSentenceEntry(value) {
  if (!isRecord(value)) return null;
  const text = normalizeText(value.text, MAX_SENTENCE_LEN);
  if (!text) return null;
  const status = REAL_SENTENCE_STATUSES.includes(value.status) ? value.status : 'picked';
  const outcome = REAL_SENTENCE_OUTCOMES.includes(value.outcome) ? value.outcome : null;
  return {
    id: normalizeText(value.id, 80) || nextRealSentenceId(),
    text,
    pickedAt: normalizeText(value.pickedAt, 32) || localDateString(),
    status,
    outcome,
    note: normalizeText(value.note, MAX_NOTE_LEN),
  };
}

/**
 * Normalize the whole realSentences list: drop empties, keep newest-first order,
 * cap at REAL_SENTENCES_CAP. Order is preserved as-given (callers prepend new
 * entries), so this does NOT re-sort by date — it only de-empties + caps.
 */
function normalizeRealSentences(list) {
  const arr = Array.isArray(list) ? list : [];
  const out = [];
  for (const item of arr) {
    const n = normalizeRealSentenceEntry(item);
    if (n) out.push(n);
    if (out.length >= REAL_SENTENCES_CAP) break;
  }
  return out;
}

/** Today's sentence = first entry with pickedAt === today (newest-first list). */
function findTodaysSentence(list, now = Date.now()) {
  const today = localDateString(now);
  const arr = Array.isArray(list) ? list : [];
  return arr.find((e) => isRecord(e) && e.pickedAt === today) || null;
}

/**
 * Pending debrief = the NEWEST entry that is pre-today AND still open
 * (status in picked|ready|carried). Only ever the single most recent one is
 * surfaced (the contract: "only the most recent one is ever asked about").
 */
function findPendingDebrief(list, now = Date.now()) {
  const today = localDateString(now);
  const arr = Array.isArray(list) ? list : [];
  // List is newest-first, so the first match is the most recent.
  return arr.find((e) => (
    isRecord(e)
    && typeof e.pickedAt === 'string'
    && e.pickedAt < today
    && ['picked', 'ready', 'carried'].includes(e.status)
  )) || null;
}

/**
 * Build exactly SUGGESTION_COUNT deterministic suggestions from the learner
 * profile (topics, hobbies, displayName) + the everyday-template pool. Never
 * repeats any of the last NO_REPEAT_RECENT picked sentences (case-insensitive).
 *
 * Determinism: the candidate ORDER is fixed (name intro, then topic lines, then
 * hobby lines, then everyday templates in declared order). We take the first 3
 * not-recently-picked unique candidates. No randomness.
 */
function buildSuggestions(profile = {}, realSentences = []) {
  const p = isRecord(profile) ? profile : {};
  const displayName = normalizeText(p.displayName, 80);
  const topics = (Array.isArray(p.topics) ? p.topics : [])
    .map((t) => normalizeText(t, 60)).filter(Boolean);
  const hobbies = (Array.isArray(p.hobbies) ? p.hobbies : [])
    .map((h) => normalizeText(h, 60)).filter(Boolean);

  const recent = new Set(
    (Array.isArray(realSentences) ? realSentences : [])
      .slice(0, NO_REPEAT_RECENT)
      .map((e) => (isRecord(e) ? normalizeText(e.text, MAX_SENTENCE_LEN).toLowerCase() : ''))
      .filter(Boolean),
  );

  const candidates = [];
  if (displayName) {
    candidates.push(`Hi, I'm ${displayName} — nice to meet you.`);
  }
  for (const topic of topics) {
    candidates.push(`Have you heard much about ${topic}?`);
  }
  for (const hobby of hobbies) {
    candidates.push(`I've been getting into ${hobby} lately.`);
  }
  // Everyday templates last, in declared order (deterministic backfill).
  for (const tpl of EVERYDAY_TEMPLATES) {
    candidates.push(tpl);
  }

  const out = [];
  const seen = new Set();
  for (const raw of candidates) {
    const text = normalizeText(raw, MAX_SENTENCE_LEN);
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key) || recent.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= SUGGESTION_COUNT) break;
  }

  // Guarantee exactly SUGGESTION_COUNT even if dedup/recent exhausted the pool:
  // backfill from everyday templates ignoring the recent filter (but still
  // unique within the result) so the UI always has 3.
  if (out.length < SUGGESTION_COUNT) {
    for (const tpl of EVERYDAY_TEMPLATES) {
      const key = tpl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(tpl);
      if (out.length >= SUGGESTION_COUNT) break;
    }
  }
  return out.slice(0, SUGGESTION_COUNT);
}

/**
 * Create a new picked entry (PURE — does not persist). Validates the 120-char
 * cap by truncation via normalizeText. Returns null if text is empty.
 */
function createRealSentenceEntry(text, now = Date.now()) {
  const clean = normalizeText(text, MAX_SENTENCE_LEN);
  if (!clean) return null;
  return {
    id: nextRealSentenceId(now),
    text: clean,
    pickedAt: localDateString(now),
    status: 'picked',
    outcome: null,
    note: '',
  };
}

/**
 * Compute the held-ratio (tokens hit / scored tokens) for a take, from the SAME
 * per-token checkpoint scores the karaoke marks use.
 *
 * VERIFIED availability (documented):
 *  - The karaoke per-token marks are computed on the FRONTEND and posted back to
 *    the kernel as `voiceState.phraseComparison.checkpoints` via the existing
 *    POST /voice/session/phrase-comparison route (see runtime saveVoicePhraseComparison
 *    + backend/voice-student-evaluations.js normalizeCheckpoints). Each checkpoint
 *    carries pathMatchScore / laneMatchScore / contourMatchScore / corridorHoldScore
 *    (0..1). There is NO phrase-comparison / per-token field in the DSP attempt
 *    artifact (confirmed: contracts.py / streaming_analyzer.py expose only the
 *    per-FRAME timeline + aggregate metrics).
 *  - Therefore the runtime computes held-ratio server-side with this priority:
 *      1) phraseComparison.checkpoints  — the same source as the karaoke marks:
 *         a checkpoint is "held" when its corridorHoldScore (preferred) else
 *         pathMatchScore is >= HELD_TOKEN_SCORE. ratio = held / scored.
 *      2) DSP artifact `timeline` (VoiceFrame[]) fallback — a voiced frame is
 *         "held" when its pitchScore >= HELD_TOKEN_SCORE. ratio = held / voiced.
 *      3) summary.metrics.targetHitPct — last-resort aggregate. Canonical input
 *         is a 0..1 fraction; the historical 0..100 unit remains accepted.
 *    Returns null when none are available (readiness then simply does not trip).
 *
 * `take` = { phraseComparison?, attemptArtifact?, summary? }.
 */
function computeHeldRatio(take = {}) {
  const t = isRecord(take) ? take : {};
  const artifact = isRecord(t.attemptArtifact) ? t.attemptArtifact : null;
  const summary = isRecord(t.summary)
    ? t.summary
    : (isRecord(artifact?.summary) ? artifact.summary : (artifact || {}));
  const metrics = isRecord(summary.metrics) ? summary.metrics : {};
  const advanced = isRecord(metrics.advanced) ? metrics.advanced : {};
  if (!resolveVoiceMeasurementUsability(advanced).usableForScoring) {
    return null;
  }

  // (1) phraseComparison checkpoints — same source as the karaoke marks.
  const pc = isRecord(t.phraseComparison) ? t.phraseComparison : null;
  const checkpoints = pc && Array.isArray(pc.checkpoints) ? pc.checkpoints : null;
  if (checkpoints && checkpoints.length) {
    let scored = 0;
    let held = 0;
    for (const cp of checkpoints) {
      if (!isRecord(cp)) continue;
      const hold = toFiniteOrNull(cp.corridorHoldScore);
      const path = toFiniteOrNull(cp.pathMatchScore);
      const score = hold != null ? hold : path;
      if (score == null) continue;
      scored += 1;
      if (score >= HELD_TOKEN_SCORE) held += 1;
    }
    if (scored > 0) return held / scored;
  }

  // (2) DSP artifact timeline (per-frame) fallback.
  const timeline = artifact && Array.isArray(artifact.timeline) ? artifact.timeline : null;
  if (timeline && timeline.length) {
    let voiced = 0;
    let held = 0;
    for (const frame of timeline) {
      if (!isRecord(frame) || frame.voiced !== true) continue;
      const score = toFiniteOrNull(frame.pitchScore);
      if (score == null) continue;
      voiced += 1;
      if (score >= HELD_TOKEN_SCORE) held += 1;
    }
    if (voiced > 0) return held / voiced;
  }

  // (3) aggregate targetHitPct fallback.
  const hitPct = toFiniteOrNull(metrics.targetHitPct);
  if (hitPct != null) {
    const fraction = Math.abs(hitPct) > 1 ? hitPct / 100 : hitPct;
    return Math.max(0, Math.min(1, fraction));
  }

  return null;
}

/**
 * Readiness heuristic (deterministic, ADVISORY only — never gates).
 *   ready when: takesToday >= READINESS_MIN_TAKES_TODAY AND latest held-ratio >= 0.7.
 * Returns { ready, takesToday, heldRatio }.
 */
function evaluateReadiness({ takesToday = 0, take = null } = {}) {
  const n = Math.max(0, Math.floor(Number(takesToday) || 0));
  const heldRatio = take ? computeHeldRatio(take) : null;
  const ready = (
    n >= READINESS_MIN_TAKES_TODAY
    && heldRatio != null
    && heldRatio >= READINESS_HELD_RATIO
  );
  return { ready, takesToday: n, heldRatio };
}

/**
 * The warm coach line for an outcome debrief (deterministic). said-well names the
 * win; said-rough / not-said are encouraging and write NO negative record.
 */
function outcomeCoachLine(outcome, text = '') {
  const clean = normalizeText(text, MAX_SENTENCE_LEN);
  switch (outcome) {
    case 'said-well':
      return clean
        ? `You carried "${clean}" out into the world — that's the whole point. Nicely done.`
        : 'You carried it out into the world — that\'s the whole point. Nicely done.';
    case 'said-rough':
      return 'Rough reps in the world still count — that took nerve.';
    case 'not-said':
      return "Days slip — it's still yours when you want it.";
    default:
      return '';
  }
}

/** The whatWorked entry appended on a said-well outcome (no negatives elsewhere). */
function whatWorkedEntryForOutcome(text = '') {
  const clean = normalizeText(text, MAX_SENTENCE_LEN);
  return clean ? `real sentence carried: ${clean}` : 'real sentence carried';
}

/**
 * The greeting follow-up line for a pending debrief (deterministic template).
 * Returns '' when there's nothing pending.
 */
function pendingDebriefGreetingLine(pendingDebrief) {
  if (!isRecord(pendingDebrief)) return '';
  const text = normalizeText(pendingDebrief.text, MAX_SENTENCE_LEN);
  if (!text) return '';
  return `Yesterday's sentence — "${text}". Did it get its moment?`;
}

module.exports = {
  // constants
  MAX_SENTENCE_LEN,
  MAX_NOTE_LEN,
  REAL_SENTENCES_CAP,
  NO_REPEAT_RECENT,
  SUGGESTION_COUNT,
  READINESS_MIN_TAKES_TODAY,
  READINESS_HELD_RATIO,
  HELD_TOKEN_SCORE,
  REAL_SENTENCE_STATUSES,
  REAL_SENTENCE_OUTCOMES,
  EVERYDAY_TEMPLATES,
  // helpers
  localDateString,
  nextRealSentenceId,
  normalizeRealSentenceEntry,
  normalizeRealSentences,
  findTodaysSentence,
  findPendingDebrief,
  buildSuggestions,
  createRealSentenceEntry,
  computeHeldRatio,
  evaluateReadiness,
  outcomeCoachLine,
  whatWorkedEntryForOutcome,
  pendingDebriefGreetingLine,
};
