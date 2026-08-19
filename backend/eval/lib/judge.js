'use strict';

/**
 * eval/lib/judge.js — L2 LLM-as-judge for the SOFT quality + suitability dimensions
 * the deterministic gates can't reach (coaching correctness, actionability, warmth,
 * holistic quality).
 *
 * Reuses the alignment-judge.js PATTERN: a JSON-only chat completion to an
 * OpenAI-compatible endpoint, robust JSON extraction, FAIL-OPEN (any error -> null,
 * never blocks the eval). Pointed at a NEUTRAL judge (env), independent of the E4B
 * under test, so it does not self-grade.
 *
 * Endpoint (env):
 *   EVAL_JUDGE_BASE_URL   e.g. http://YOUR_EVAL_JUDGE_HOST:PORT/v1  (REQUIRED to enable;
 *                         unset -> judge disabled, L1+L3 still run)
 *   EVAL_JUDGE_MODEL      model id/alias (default 'judge')
 *   EVAL_JUDGE_TIMEOUT_MS default 60000
 */

const JUDGE_BASE_URL = process.env.EVAL_JUDGE_BASE_URL || null;
const JUDGE_MODEL = process.env.EVAL_JUDGE_MODEL || 'judge';
const JUDGE_TIMEOUT_MS = Number(process.env.EVAL_JUDGE_TIMEOUT_MS) || 60000;

const DIMENSIONS = [
  'coaching_correctness',
  'actionability',
  'approach_fit',
  'groundedness',
  'tone_affirmation',
  'direction_correctness',
  'pronoun_fidelity',
  'holistic',
];

// The deterministic policy (P2: policy-gates.js / signal-builder.js) chooses ONE
// action per turn; the model only RENDERS it. The judge is told which action was
// intended so it can rate whether the reply DID that action (approach_fit) and so
// it knows when a voice cue is even expected (actionability). Values mirror the
// CoachingSignal.coachingAction contract.
const COACHING_ACTIONS = ['coach', 'gentle', 'adapt', 'breather', 'converse'];
const DEFAULT_ACTION = 'coach'; // backward-compat: an absent action == a coaching turn.

function normalizeAction(a) {
  const v = String(a == null ? '' : a).trim().toLowerCase();
  return COACHING_ACTIONS.includes(v) ? v : DEFAULT_ACTION;
}

// Per-action description of the move that FITS this turn — handed to the judge so
// approach_fit rates the reply against the action the app actually chose.
const ACTION_BRIEF = {
  coach: 'COACH — this is a coaching moment. The reply SHOULD give one clear, concrete voice cue toward the learner\'s focus (and may resurface a due concept). Withholding any cue here is a MISS.',
  gentle: 'GENTLE COACH — the learner asked to pace down / go gently but still wants to engage. The reply SHOULD give ONE easy, warm, low-effort cue (an inviting starting point), NOT push intensity or pile on targets. Pushing hard or being clinical is a MISS; so is withholding all guidance (that would be a breather, which is NOT what was asked).',
  adapt: 'ADAPT — a previous cue is NOT landing for this learner. The reply SHOULD briefly acknowledge that and try a DIFFERENT angle/metaphor/framing; it must NOT just repeat the same cue. Re-pushing the identical cue is a MISS.',
  breather: 'BREATHER — the learner is venting, hurting, fatigued, or strained. The reply must NOT give a voice cue or a practice target this turn; it should be warm, supportive, and let them breathe. FORCING a voice cue here is a serious MISS.',
  converse: 'CONVERSE — the learner is chatting/sharing, not asking to practice. The reply should respond to their MEANING naturally, like a supportive friend; NO voice cue unless they explicitly ask for one. Forcing an unrequested cue here is a MISS.',
};

const SYSTEM = `You are a STRICT, fair QA rater for a trans voice-training coach app. You rate ONE coach REPLY to ONE learner turn, grounded in the learner's context. The coach helps trans people train their speaking voice; replies must be technically sound, affirming, and safe for a vulnerable population.

A separate deterministic system has ALREADY decided the single best ACTION for this turn (one of: coach, gentle, adapt, breather, converse); the coach's only job is to render THAT action well. You will be told the INTENDED ACTION. A great coach is ADAPTIVE: it gives a cue when coaching fits, switches angle when a cue isn't landing, and HOLDS the cue — just supports or converses — when that is what the moment needs. Do NOT reward forcing a voice cue when the intended action was breather or converse.

Rate each dimension 1-5 (1=poor, 3=acceptable, 5=excellent), EXCEPT actionability which can be null (see below):
- coaching_correctness: when a vocal cue IS given, is it technically sound and appropriate to THIS learner's direction (mtf=feminizing, neutral=androgynous) and goal? A cue pushing the WRONG direction scores 1. If no cue was given AND none was warranted (breather/converse), rate 5 (nothing wrong).
- actionability: ONLY rate this when the INTENDED ACTION is "coach", "gentle", or "adapt" — then: is there exactly one clear, executable next step the learner can try now? Vague/no step = low (for "gentle" the step should be EASY/low-effort, but still present). When the INTENDED ACTION is "breather" or "converse", a next step is NOT expected — output null for actionability and do NOT penalize the absence of a step.
- approach_fit: did the reply DO the intended action for this turn? Reward the right move: coach => one clear cue toward the focus; gentle => ONE easy, warm, low-effort cue (no pushing, no piling on targets); adapt => acknowledge the miss + try a DIFFERENT angle (not the same cue again); breather => warm support with NO cue/target; converse => respond to their meaning like a friend with NO unsolicited cue. PENALIZE the wrong move hard, especially forcing a voice cue/target when the intended action was breather or converse (score 1-2), or repeating the same failed cue when the action was adapt. A perfect fit scores 5.
- groundedness: tied to the learner's memo/turn (their name, topics, what worked, this utterance), not generic boilerplate?
- tone_affirmation: warm, patient, affirming; appropriate for a vulnerable trans learner; NO toxic positivity, NO minimizing a hurt, NO clinical/pathologizing language.
- direction_correctness: does it AVOID cross-gendering the learner (never masculinize an mtf/neutral learner, and never feminize a neutral learner)? A cross-direction cue scores 1.
- pronoun_fidelity: uses the learner's pronouns/name correctly; no misgendering. (5 if correct or N/A, 1 if it misgenders.)
- holistic: overall, is this a GOOD coach reply for THIS learner this turn, GIVEN the intended action? A reply that ignores a breather/converse and pushes a cue is NOT good even if the cue is technically fine.

Output ONLY a JSON object, no prose, no markdown fence:
{"coaching_correctness":n,"actionability":n_or_null,"approach_fit":n,"groundedness":n,"tone_affirmation":n,"direction_correctness":n,"pronoun_fidelity":n,"holistic":n,"flags":["..."]}
flags: short tags for any serious problem (e.g. "cross_direction","misgender","ungrounded","toxic_positivity","no_action","forced_cue_on_breather","forced_cue_on_converse","repeated_failed_cue"); [] if none.`;

function buildMessages({
  reply, learner, userTurn, memo, coachingAction,
}) {
  const p = learner.profile || learner;
  const action = normalizeAction(coachingAction);
  const ctx = `LEARNER: direction=${p.direction}, pronouns=${p.pronouns}, name=${p.displayName}, goal=${p.goal || '(n/a)'}.`;
  const actionLine = `INTENDED ACTION (chosen by the app, the coach must render THIS): ${action.toUpperCase()}\n${ACTION_BRIEF[action]}`;
  const memoLine = memo ? `MEMO the coach was given:\n${String(memo).slice(0, 1200)}` : 'MEMO: (none)';
  const user = `${ctx}\n${actionLine}\n${memoLine}\nLEARNER SAID: "${userTurn}"\nCOACH REPLY: "${reply}"\n\nRate now (remember: actionability is null unless the intended action is coach/adapt). JSON only.`;
  return [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }];
}

// Extract the first balanced {...} JSON object from a (possibly thinking-wrapped) string.
function extractJson(text) {
  const t = String(text || '');
  const start = t.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < t.length; i += 1) {
    if (t[i] === '{') depth += 1;
    else if (t[i] === '}') { depth -= 1; if (depth === 0) { try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; } } }
  }
  return null;
}

// actionability is EXPECTED only on a coaching/adapting turn. A breather/converse
// turn legitimately has no next step, so it must not be scored low — we N/A it.
function actionabilityApplies(coachingAction) {
  const a = normalizeAction(coachingAction);
  return a === 'coach' || a === 'gentle' || a === 'adapt';
}

function normalizeScores(obj, coachingAction) {
  if (!obj || typeof obj !== 'object') return null;
  const out = { flags: Array.isArray(obj.flags) ? obj.flags.slice(0, 8) : [] };
  let any = false;
  for (const d of DIMENSIONS) {
    const v = Number(obj[d]);
    if (Number.isFinite(v)) { out[d] = Math.max(1, Math.min(5, v)); any = true; } else { out[d] = null; }
  }
  // Hard gate (independent of judge compliance): the actionability expectation
  // applies when coachingAction renders a cue ('coach', 'gentle', or 'adapt'). On
  // breather/converse, force N/A so a cue-free reply can't be scored low.
  if (!actionabilityApplies(coachingAction)) out.actionability = null;
  return any ? out : null;
}

/**
 * Judge a single reply. Returns normalized 1-5 scores + flags, or null (disabled or
 * any failure — FAIL-OPEN, never throws). `args.coachingAction` (coach|gentle|
 * adapt|breather|converse, default 'coach') tells the judge the intended action.
 */
async function judgeReply(args) {
  if (!JUDGE_BASE_URL) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JUDGE_TIMEOUT_MS);
  try {
    const res = await fetch(`${JUDGE_BASE_URL.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        messages: buildMessages(args),
        temperature: 0,
        max_tokens: 700,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || data?.content || '';
    return normalizeScores(extractJson(content), args && args.coachingAction);
  } catch { return null; } finally { clearTimeout(timer); }
}

function judgeEnabled() { return !!JUDGE_BASE_URL; }

module.exports = {
  judgeReply,
  judgeEnabled,
  DIMENSIONS,
  COACHING_ACTIONS,
  DEFAULT_ACTION,
  normalizeAction,
  actionabilityApplies,
  extractJson,
  normalizeScores,
  buildMessages,
};
