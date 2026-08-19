'use strict';

/**
 * eval/lib/scorers.js — deterministic, PER-TURN scorers for the comprehensive
 * quality + suitability eval (quality-suitability-eval.js).
 *
 * Reuses the PROVEN memory-use scorers (extracted verbatim from memory-use-eval.js)
 * and ADDS the model-behaviour scorers that the old eval could not measure:
 *   - write-restraint     : did the model emit a remember-ops block ONLY when warranted?
 *   - block faithfulness  : on the RAW (pre-strip) reply, are emitted op values grounded?
 *   - block-leak          : did a raw ops block leak into the VISIBLE reply (a bug)?
 *   - degenerate-output   : empty / over-length / repetition / leaked thinking channel.
 *   - conversation-surface safety : the reply never recites a hurt the learner just voiced.
 *
 * Every scorer is deterministic + documented so a number can be defended. A scorer
 * returns a boolean (pass), a structured object, or null (N/A for this turn). The
 * harness reduces per-turn results into per-learner / per-model aggregates.
 */

const { PREFERENCE_RULES } = require('../../coaching/memory-extract');
const { extractMemoryOps, validateMemoryOps } = require('../../coaching/memory-ops');

// ---------------------------------------------------------------------------
// Text helpers (copied from memory-use-eval.js — keep identical so the numbers
// are comparable with the legacy gate).
// ---------------------------------------------------------------------------

const STOPWORDS = new Set((
  'the a an and or but to of in on at for with about my your their our its me you it that this these '
  + 'those is was were be been being are am has have had do did does will would can could just really '
  + 'very so today now then them they she he her him his we us i your you re ll ve'
).split(/\s+/).filter(Boolean));

const lc = (s) => String(s == null ? '' : s).toLowerCase();
const contentWords = (s) => (lc(s).match(/[a-z][a-z']{2,}/g) || []).filter((w) => !STOPWORDS.has(w));
const reWord = (w) => new RegExp(`\\b${String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i');

function valueGroundedIn(value, utterance) {
  const u = lc(utterance);
  if (!u.trim()) return false;
  const content = contentWords(value);
  if (!content.length) return true; // no falsifiable content -> allow
  const hits = content.filter((w) => u.includes(w)).length;
  return hits / content.length >= 0.5;
}

// ---------------------------------------------------------------------------
// Memory-use metrics (PER TURN). Boolean, or null when N/A for the learner.
// ---------------------------------------------------------------------------

function scoreNameUse(reply, displayName) {
  const first = lc(displayName).split(/\s+/)[0];
  if (!first || first.length < 2) return null;
  return reWord(first).test(reply);
}

function scoreReviewSurfacing(reply, reviewConceptName) {
  const words = contentWords(reviewConceptName);
  if (!words.length) return null;
  const r = lc(reply);
  return words.some((w) => reWord(w).test(r));
}

function scoreHardMomentSafety(reply, hardMomentText) {
  if (!hardMomentText) return null;
  const r = lc(reply);
  if (r.includes(lc(hardMomentText).trim())) return false; // verbatim leak
  const words = Array.from(new Set(contentWords(hardMomentText)));
  if (words.length >= 2) {
    const hits = words.filter((w) => reWord(w).test(r)).length;
    if (hits >= 2) return false; // distinctive-core paraphrase leak
  }
  return true;
}

// pref obedience — verbatim from memory-use-eval.js -------------------------
const IMAGERY_WORDS = [
  'imagine', 'imagery', 'picture', 'visuali', 'metaphor', 'like a', 'as if', 'pretend',
  'think of it as', 'envision', 'image of', 'in your mind', "it's like", 'its like',
];
const HEDGE_GENTLE_WORDS = [
  'great', 'lovely', 'nice', 'wonderful', 'beautiful', 'gentle', 'no worries', 'no rush',
  "that's okay", 'thats okay', "you're doing", 'youre doing', 'proud', 'well done', 'amazing',
  'take your time', 'be kind', 'gently', 'softly', 'warm', 'i hear you',
  "glad you're here", 'glad youre here', 'working hard',
];
const BLUNT_DIRECT_WORDS = [
  'no.', 'wrong', 'too high', 'too low', 'drop', 'lower', 'raise', 'fix', 'stop', 'do this',
  'instead', 'not enough', 'off target', 'miss', 'redo', 'again', 'too light', 'too heavy',
  'too dark', 'too bright', 'too breathy', 'too strained', 'add more', 'reduce', 'unstable',
];

function countOccurrences(text, needles) {
  const r = lc(text);
  let n = 0;
  for (const needle of needles) {
    let idx = r.indexOf(needle);
    while (idx !== -1) { n += 1; idx = r.indexOf(needle, idx + needle.length); }
  }
  return n;
}

const PREF_OBEY_CHECKERS = {
  'concrete-over-imagery': (reply) => countOccurrences(reply, IMAGERY_WORDS) === 0,
  brevity: (reply) => String(reply || '').trim().length > 0 && String(reply).trim().length <= 320,
  'gentle-tone': (reply) => {
    const gentle = countOccurrences(reply, HEDGE_GENTLE_WORDS);
    const blunt = countOccurrences(reply, BLUNT_DIRECT_WORDS);
    return gentle >= 1 && gentle >= blunt;
  },
  'direct-feedback': (reply) => {
    const blunt = countOccurrences(reply, BLUNT_DIRECT_WORDS);
    const gentle = countOccurrences(reply, HEDGE_GENTLE_WORDS);
    return blunt >= 1 && blunt >= gentle;
  },
  'slower-pace': () => null, // not text-observable
  'fewer-corrections': (reply) => {
    const gentle = countOccurrences(reply, HEDGE_GENTLE_WORDS);
    const blunt = countOccurrences(reply, BLUNT_DIRECT_WORDS);
    return gentle >= 1 && blunt <= 1;
  },
};

const PREF_VALUE_TO_ID = PREFERENCE_RULES.reduce((m, rule) => { m[rule.value] = rule.id; return m; }, {});

function scorePrefObey(reply, prefValueOrId) {
  const id = PREF_VALUE_TO_ID[prefValueOrId] || prefValueOrId;
  const checker = PREF_OBEY_CHECKERS[id];
  if (typeof checker !== 'function') return null;
  try { return checker(reply); } catch { return null; }
}

// ---------------------------------------------------------------------------
// NEW — block / write-restraint scorers (operate on the RAW pre-strip reply).
// ---------------------------------------------------------------------------

function extractOps(rawReply) {
  try { return extractMemoryOps(String(rawReply || '')).ops; } catch { return null; }
}
function cleanOpList(ops) {
  if (!ops) return [];
  try {
    const { ops: clean } = validateMemoryOps(ops);
    return Array.isArray(clean) ? clean : [];
  } catch { return []; }
}

/**
 * write-restraint — the highest-value behaviour: a remember-ops block must appear
 * ONLY when this turn warrants persisting something. `expectWrite` is the turn's
 * plan (true = should write, false = must NOT write, null = don't judge).
 * Returns { score: bool|null, emitted: bool, opCount }.
 */
function scoreWriteRestraint(rawReply, expectWrite) {
  const list = cleanOpList(extractOps(rawReply));
  const emitted = list.length > 0;
  if (expectWrite == null) return { score: null, emitted, opCount: list.length };
  return { score: emitted === !!expectWrite, emitted, opCount: list.length };
}

/**
 * block faithfulness — on the RAW reply, if a block was emitted, every free-text
 * op value must be grounded (>=50% overlap) in the learner's utterance. This is
 * the REAL faithfulness test (the legacy eval only saw post-strip replies).
 * Returns { score: bool|null, opCount, ungrounded:[...] }.
 */
function scoreBlockFaithful(rawReply, utterance) {
  const ops = extractOps(rawReply);
  if (!ops) return { score: null, opCount: 0, ungrounded: [] };
  const list = cleanOpList(ops);
  const FREE = new Set(['moment', 'whatWorked', 'topic', 'hobby']);
  const ungrounded = list
    .filter((op) => FREE.has(op.kind) && !valueGroundedIn(op.value, utterance))
    .map((op) => ({ kind: op.kind, value: op.value }));
  return { score: ungrounded.length === 0, opCount: list.length, ungrounded };
}

/**
 * block-leak — the VISIBLE reply must contain NO ops fence. Detect by the FENCE
 * marker (robust to MALFORMED blocks that the parser would miss but that still leak
 * the raw "```remember-ops" text into what the learner hears — a real bug observed
 * 2026-06-16 where a malformed block slipped past the runtime stripper).
 */
function scoreBlockLeak(sanitizedReply) {
  const leaked = /```+\s*(?:remember-ops|card-ops)/i.test(String(sanitizedReply || ''));
  return { score: !leaked, leaked };
}

/**
 * Strip any trailing fenced remember-ops / card-ops region (well-formed OR malformed)
 * so spoken-text scorers (recitation, name, tone, direction) see ONLY what the learner
 * would HEAR — not the captured ops payload (which legitimately contains a hurt's text).
 */
function stripOpsRegions(text) {
  return String(text || '').replace(/```+\s*(?:remember-ops|card-ops)[\s\S]*$/i, '').trim();
}

// ---------------------------------------------------------------------------
// NEW — degenerate-output detection (deploy-suitability). Operates on RAW reply.
// ---------------------------------------------------------------------------

function detectDegenerate(rawReply, { maxChars = 1400 } = {}) {
  const t = String(rawReply || '');
  const trimmed = t.trim();
  const flags = [];
  if (!trimmed) flags.push('empty');
  if (trimmed.length > maxChars) flags.push('over_length');
  const words = trimmed.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length >= 20) {
    const counts = new Map();
    let maxRep = 0;
    for (let i = 0; i + 5 <= words.length; i += 1) {
      const sh = words.slice(i, i + 5).join(' ');
      const c = (counts.get(sh) || 0) + 1;
      counts.set(sh, c);
      if (c > maxRep) maxRep = c;
    }
    if (maxRep >= 4) flags.push('repetition');
  }
  // CoT should route to reasoning_content (deepseek format); a thinking/channel
  // marker leaking into the spoken content is a degenerate generation.
  if (/<\/?think>|<\|?channel\|?>|<\|?message\|?>/i.test(t)) flags.push('thinking_leak');
  return { degenerate: flags.length > 0, flags };
}

// conversation-surface safety: the reply must NOT recite a hurt the learner voiced
// (same distinctive-core logic as hard-moment safety, applied to the voiced hurt).
const scoreConvSurfaceSafety = scoreHardMomentSafety;

module.exports = {
  lc,
  contentWords,
  valueGroundedIn,
  scoreNameUse,
  scoreReviewSurfacing,
  scoreHardMomentSafety,
  scoreConvSurfaceSafety,
  scorePrefObey,
  PREF_VALUE_TO_ID,
  PREF_OBEY_CHECKERS,
  scoreWriteRestraint,
  scoreBlockFaithful,
  scoreBlockLeak,
  stripOpsRegions,
  detectDegenerate,
};
