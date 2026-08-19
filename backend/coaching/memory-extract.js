'use strict';

/**
 * memory-extract — DETERMINISTIC, LLM-FREE memory capture (Wave 2A).
 *
 * WHY: the tutor's conversational memory (coaching preferences) normally flows
 * ONLY through the GGUF's trailing ```remember-ops``` block (coaching/memory-ops.js).
 * When the model is offline, buildFallbackReply emits no block, so a stated
 * preference like "imagery confuses me" is silently lost — contradicting the
 * product goal that the app runs WITHOUT an LLM. This module captures the
 * HIGH-CONFIDENCE, closed-list slice of that memory deterministically from the
 * learner's OWN utterance, with NO model call, emitting the SAME op shape that
 * coaching/memory-ops.js::applyMemoryOps already consumes.
 *
 * SCOPE (precision-first, deliberately narrow):
 *   - coaching PREFERENCES matched against a closed pattern list. A captured
 *     preference becomes a HARD CONSTRAINT in the coach prompt (renderer-client.js
 *     buildRendererSystemPrompt), so a FALSE positive is costly — every rule fires
 *     only on a clear, coach-directed preference statement, and most turns capture
 *     nothing (mirrors the model's trained restraint).
 *
 * EXPLICITLY DEFERRED to the Wave 4 small-NN salience/kind gate:
 *   - free-text identity MOMENTS ("got ma'am'd on the phone") — a rule list cannot
 *     capture these without false positives, and a WRONG identity moment is worse
 *     than a missed one.
 *   - open-ended topics/hobbies — low value, high ambiguity for rules.
 * Acoustic whatWorked is already captured deterministically at the
 * /voice/real-sentence/outcome endpoint (voice-standalone-runtime.js); this module
 * does NOT duplicate it.
 *
 * Output: ops in coaching/memory-ops.js shape ({ kind:'preference', value }), so
 * validateMemoryOps + applyMemoryOps consume them UNCHANGED. Idempotent across
 * turns: the canonical value strings are stable, and addCoachPreference dedupes by
 * lowercased text (learner-context-service.js normalizeCoachPreferencesList).
 */

const MAX_EXTRACT = 2; // a single utterance rarely states more than one clean preference
const MAX_TRANSCRIPT_LEN = 600; // bound the scanned text (a coaching utterance, not an essay)

/** Lowercase, fold curly/modifier apostrophes to ', collapse whitespace, bound length. */
function normalizeTranscript(value) {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, MAX_TRANSCRIPT_LEN * 2)
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'") // ‘ ’ ʼ -> '
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TRANSCRIPT_LEN);
}

// "be [softeners] <adj>" is a COACHING preference only when it's aimed at the
// coach — a polite request ("can you be…", "please be…", "I want you to be…") or
// "be <adj> … with/to/on me" — NOT a self-directed voice/life GOAL ("I want to be
// gentle in my everyday voice"). `adj` is a regex alternation fragment. This is the
// load-bearing precision gate for the tone rules: the subject population (trans
// voice learners) constantly describe being gentle/direct/feminine in their OWN
// voice, which must NOT be captured as a coaching-style preference.
const BE_SOFT = '(a )?(little |bit |lil |more |less |very |really |so |extra )*';
function coachDirectedBe(t, adj) {
  const request = new RegExp(`\\b((can|could|would|will) you (please )?be|please be|i'?d like you to be|i (want|need) you to be|let'?s be) ${BE_SOFT}(${adj})\\b`);
  const withMe = new RegExp(`\\bbe ${BE_SOFT}(${adj})\\b[^.?!]{0,15}\\b(with|to|on) me\\b`);
  return request.test(t) || withMe.test(t);
}

// Self-directed goal markers — when present, a "be <adj>" is the learner's OWN
// goal, not a request for how the coach should behave (the goals-vs-style collision).
const SELF_GOAL = /\b(i (want|wanna|need|'?d like|hope|wish) to (be|sound)|i'?m (trying|working on)|my goal\b|i want to sound)\b/;

// Practice MATERIAL nouns (the drill/sentence/audio the learner works ON) — used to
// suppress "this drill is too fast" (material difficulty) vs "slow down the lesson"
// (a real coaching-pace request). NOTE: deliberately excludes lesson/coaching/pace.
const MATERIAL_NOUN = '(drill|exercise|example|sentence|phrase|passage|word|words|audio|clip|recording|track|line|prompt|vowel|consonant)';

/**
 * Closed list of coaching-preference rules. Precision-first:
 *   - `test(t)` fires only on a clear, coach-directed preference signal.
 *   - optional `unless(t)` suppresses a known false-positive context (e.g. the
 *     learner describing their OWN voice/goal rather than directing the coach).
 *   - `value` is the CANONICAL, stable preference text stored (the dedupe key),
 *     phrased as an instruction the coach can obey (it lands in the "Coaching
 *     preferences" memo line, treated as a hard constraint).
 * `direct-feedback` and `gentle-tone` are intentional opposites; they key off
 * disjoint phrasings and will not co-fire on the same utterance.
 */
const PREFERENCE_RULES = [
  {
    id: 'concrete-over-imagery',
    value: 'Prefers concrete physical cues over imagery or metaphor',
    test: (t) =>
      (/\b(imagery|metaphors?|visuali[sz]\w*|imagine|picture( it)?|analog(y|ies)|abstract)\b/.test(t)
        && /(confus\w*|don'?t (get|understand|work|help)|hard to (get|understand|follow)|\blost\b|not help\w*|doesn'?t (work|help)|too abstract|no more|\bless\b|\bstop\b|\bavoid\b|instead)/.test(t))
      // an explicit ask for concrete CUES/INSTRUCTIONS — a cue-domain noun is REQUIRED,
      // so "give me a concrete example/sentence/plan" or "I need specific words" do NOT fire.
      || /\b(concrete|physical|literal|specific|step by step)\b[^.?!]{0,40}\b(cue|cues|instruction|instructions|direction|directions)\b/.test(t),
  },
  {
    id: 'slower-pace',
    value: 'Prefers a slower coaching pace',
    test: (t) => /\b(slow down|slow it down|go slower|too fast for me|you'?re going too fast|going too fast|can you slow|could you slow|please slow)\b/.test(t),
    // Suppress when the learner describes their OWN voice/speech rate, or merely ASKS
    // whether they/we should slow down — not a directive to slow the lesson. Allows an
    // intervening modal ("do I need to slow…") and "should we".
    unless: (t) =>
      /\bmy( own)? (pitch|voice|speech|talking|rate|tempo|words?|phrases?)\b/.test(t)
      || /\b(should (i|we)|do (i|we)|can (i|we)|i should|when i) (need to |have to |gotta |wanna )?(slow|speak|talk|sound|go)\b/.test(t)
      || /\bi(?:'?m| am| was)? (talk|speak|sound|go(?:ing)?|rush)\w*\b/.test(t) // "i'm going too fast" (own rate)
      // the practice MATERIAL itself is too fast ("this drill is too fast"), not a
      // request to slow the COACHING. Requires the material to be the SUBJECT of the
      // speed (material + copula + fast/slow) — so "slow down on this exercise" (a real
      // coach-pace request that merely mentions material) still fires.
      || new RegExp(`\\b(this|that|the) ${MATERIAL_NOUN}\\b[^.?!]{0,20}\\b(is|was|are|were|feels?|felt|seems?|gets?|getting|going)\\b[^.?!]{0,15}\\b(too )?(fast|slow|quick)\\b`).test(t),
  },
  {
    id: 'fewer-corrections',
    value: 'Prefers fewer corrections and more encouragement',
    test: (t) => /\b(stop correcting|don'?t correct|quit correcting|less correct\w*|too many corrections?|stop nitpick\w*|don'?t nitpick|stop pointing out)\b/.test(t),
    // Suppress SELF-correction ("stop correcting MYSELF / my own pitch") — that's the
    // learner's own habit, not a request to be corrected less BY THE COACH. "correcting
    // me" is left to fire (the coach correcting the learner is exactly the target).
    unless: (t) => /\b(correct(ing)?|point(ing)? out)\b[^.?!]{0,25}\b(myself|my own|to myself)\b/.test(t),
  },
  {
    id: 'gentle-tone',
    value: 'Prefers a gentle, patient, encouraging tone',
    test: (t) =>
      coachDirectedBe(t, 'gentle|patient|encouraging|kind|nicer|gentler|softer|supportive')
      // "too harsh/tough/hard" require a COACH TARGET — bare forms describe the
      // learner's own acoustic output ("that vowel sounds too harsh") or the
      // material's difficulty ("this drill is too tough"), both in-domain noise.
      || /\b(you'?re (being )?too (harsh|critical|tough|hard|mean|strict)|you are (being )?too (harsh|critical|tough|hard|mean|strict)|too (harsh|tough|hard|critical|strict) on me|stop being so (harsh|critical|tough|strict|hard)|go easy on me|ease up on me)\b/.test(t),
    unless: (t) => SELF_GOAL.test(t),
  },
  {
    id: 'direct-feedback',
    value: 'Prefers direct, blunt feedback',
    // "honest" is intentionally EXCLUDED — it is overwhelmingly a hedge ("to be
    // honest…", "be honest, was that good?"), not a request for blunt coaching.
    test: (t) =>
      coachDirectedBe(t, 'direct|blunt|straight')
      || /\b(don'?t sugarcoat|do not sugarcoat|tell me straight|give it to me straight|don'?t hold back|be real with me)\b/.test(t),
    unless: (t) => SELF_GOAL.test(t),
  },
  {
    id: 'brevity',
    value: 'Prefers short, concise coaching',
    // bare "too long" dropped (ambiguous with the learner's own sentence length).
    test: (t) => /\b(keep it (short|brief)|be brief|too wordy|too much talk\w*|less talk\w*|shorter cues?|just (the )?one cue|don'?t over-?explain|stop over-?explain\w*|you talk too much)\b/.test(t),
    // Suppress when it's about the learner's OWN output ("my answer/sentence was too
    // wordy") or their own habit ("i keep it short"), not a request for terser coaching.
    unless: (t) =>
      /\bmy (answer|answers|response|responses|sentence|sentences|reply|replies|wording|speech|talking)\b/.test(t)
      || /\bi (keep|kept|want|wanna|try|tried|like|need|should|usually|tend)\b[^.?!]{0,15}\b(short|brief|concise)\b/.test(t)
      || /\bi(?:'?m| am)\b[^.?!]{0,15}\b(wordy|long-?winded)\b/.test(t), // "i am too wordy" (own habit)
  },
];

/**
 * Extract deterministic memory ops from a single learner utterance.
 * Returns ops in coaching/memory-ops.js shape: [{ kind:'preference', value }].
 * Pure + never throws. Empty array when nothing matches (the common case).
 * Caps at MAX_EXTRACT and never repeats a rule.
 */
function extractDeterministicMemoryOps(transcript) {
  const t = normalizeTranscript(transcript);
  if (!t) return [];
  const ops = [];
  for (const rule of PREFERENCE_RULES) {
    if (ops.length >= MAX_EXTRACT) break;
    try {
      if (!rule.test(t)) continue;
      if (typeof rule.unless === 'function' && rule.unless(t)) continue;
      ops.push({ kind: 'preference', preferenceId: rule.id, value: rule.value });
    } catch {
      // a malformed rule must never break capture
    }
  }
  return ops;
}

module.exports = {
  extractDeterministicMemoryOps,
  normalizeTranscript,
  PREFERENCE_RULES,
  MAX_EXTRACT,
};
