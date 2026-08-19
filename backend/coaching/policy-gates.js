'use strict';

/**
 * PolicyGates — deterministic coaching policy decisions.
 *
 * Decides: shouldCorrect, avoidTopics, maxCueCount, conversationPriority, and
 * coachingAction (coach | adapt | breather | converse) — the per-turn action the
 * renderer turns into a directive and the model renders. The app owns this decision
 * so the coach is adaptive, not one-formula. Contract + precedence
 * (breather > converse > adapt > coach) in docs/ADAPTIVE-COACH-PLAN.md.
 */

const PRACTICE_MODES = [
  'active_drill',
  'conversation_practice',
  'reflection',
  'lesson_plan',
  'safety_reset',
];

const COACHING_ACTIONS = ['coach', 'gentle', 'adapt', 'breather', 'converse'];

function normalizePracticeMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase().replace(/[\s-]+/g, '_') : '';
  return PRACTICE_MODES.includes(normalized) ? normalized : 'active_drill';
}

/**
 * Detect if the user's message is casual conversation (not asking for correction).
 */
function isCasualConversation(message) {
  const normalized = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!normalized) return false;
  // Explicit non-correction signals
  if (/\b(?:just chatting|just talking|off topic|random|casual|normal conversation)\b/i.test(normalized)) return true;
  // Questions about non-voice topics
  if (/^(?:what|how|where|when|why|who|do you|can you|have you|did you|is it|are you)\b/i.test(normalized)
    && !/\b(?:voice|pitch|resonance|pronunciation|accent|drill|practice|record|sample)\b/i.test(normalized)) {
    return true;
  }
  return false;
}

/**
 * Detect if the user is explicitly asking for correction or coaching.
 */
function isRequestingCorrection(message) {
  const normalized = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!normalized) return false;
  const namedVoiceRequest = /\b(?:correct|fix|help|how do i|what should i|coach|teach|cue|tip|advice|focus|work on|improve|better)\b/i.test(normalized)
    && /\b(?:voice|pitch|resonance|pronunciation|weight|intonation|accent|vowel|onset|speak|sound|say)\b/i.test(normalized);
  // Inside an active spoken lesson, these ordinary follow-ups unambiguously ask
  // the tutor to assess the just-finished take even when the learner does not
  // repeat the word "voice". Treating them as chit-chat suppresses both the next
  // cue and any due review.
  const contextualTakeRequest = /\b(?:how (?:am i|did i) do(?:ing)?|how (?:was|is) (?:that|it|the take)|how did (?:that|it) sound|what did you (?:hear|notice)|give (?:me )?(?:feedback|your read)|be honest|give it to me straight)\b/i.test(normalized);
  const contextualLessonRequest = /\b(?:where do we (?:start|begin)|what (?:do we|should we) (?:do|work on|start with)|what(?:'s| is) (?:first|next)|ready to (?:start|begin|go|practice)|let(?:'s| us) (?:start|begin|practice))\b/i.test(normalized);
  return namedVoiceRequest || contextualTakeRequest || contextualLessonRequest;
}

/**
 * Detect that the current method/cue isn't landing — either the learner signals
 * struggle in words, or the caller supplies >=2 consecutive non-improving takes on
 * the focus. Drives the 'adapt' action (switch the angle rather than re-push).
 */
function isMethodStalling(message, consecutiveMisses = 0) {
  if (Number(consecutiveMisses) >= 2) return true;
  const n = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!n) return false;
  return /\b(?:still (?:not|can'?t|struggl|stuck|nothing)|not working|isn'?t working|not landing|isn'?t landing|not helping|does(?:n'?t| not) (?:help|work|do anything)|no difference|nothing(?:'s| is)? (?:work|help)|can'?t (?:get|seem|do)|keep (?:struggl|missing|losing|slipping)|over and over|no luck|do(?:n'?t| not) (?:get|understand) (?:it|that|this|how)|tried that|that didn'?t|same (?:problem|thing)|harder than|different (?:way|approach|angle)|no matter (?:how|what))\b/i.test(n);
}

/** Pick between coaching normally and adapting when the method is stalling. */
function coachOrAdapt(userMessage, consecutiveMisses) {
  return isMethodStalling(userMessage, consecutiveMisses) ? 'adapt' : 'coach';
}

/**
 * Specific voice TARGETS a coaching turn addresses. Used to keep "chatting" detection
 * from firing on a coaching turn that names one (e.g. "how was my pitch?"). Deliberately
 * NOT the generic words voice/say/sound — those appear in genuine chit-chat.
 */
const VOICE_TOPIC_RE = /\b(?:pitch|resonance|vocal weight|intonation|accent|vowel|onset|larynx|register|placement|brightness|nasality|breathiness)\b/;

/**
 * Detect a TYPED, UNAMBIGUOUS DECLINE of practice — "I don't want a fix / to practice
 * tonight". Checked UNCONDITIONALLY: it overrides the coarse isRequestingCorrection match
 * (since "don't want a fix ... my voice" trips fix+voice on bare words). Kept to a clear
 * decline ONLY, so it never stops a genuine coaching request. Overwhelm words and the
 * softer "can't do drills right now" live in isOverwhelmed (gated by !requesting).
 */
function isVentingOrHurt(message) {
  const n = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!n) return false;
  return /\b(?:do ?n'?t|do not|don'?t) want\b[^.!?]*\b(?:fix|practice|drills?)\b/.test(n);
}

/**
 * Detect overwhelm / fatigue / distress-from-an-incident in text. Drives 'breather' (a
 * full hold, no cue) but is GATED by !isRequestingCorrection at the call site, so "I'm
 * exhausted but help me with my pitch" still coaches. Distress idioms (a learner reporting
 * they were emotionally hit — often a misgendering moment — need the drill HELD) require
 * emotional framing ("i am thrown", "knocked the wind out of me") so a voice note ("my
 * voice felt thrown off") doesn't trip them. NOTE: an explicit "ease off / go easy / be
 * gentle with me" request is NOT overwhelm — the learner wants to engage, gently — so it
 * lives in isEaseOffRequest below and drives 'gentle', not a full breather hold.
 */
function isOverwhelmed(message) {
  const n = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!n) return false;
  return /\b(?:overwhelmed|exhausted|wrung out|drained|hollowed out|burnt out|burned out|flattened)\b/.test(n)
    || /\b(?:feel|feeling|i'?m|i am|left me|it left me) (?:spent|done|defeated|completely done|so done|thrown|shaken|rattled|reeling)\b/.test(n)
    || /\b(?:knocked the wind out of me|wind (?:was )?knocked out of me|(?:today|that) (?:really )?threw me|threw me (?:today|for a loop)|reeling from)\b/.test(n)
    || /\bjust need (?:a (?:minute|moment|sec|break)|to (?:vent|breathe|stop))\b/.test(n);
}

/**
 * Detect an explicit "ease off / be gentle / take it slow" request — the learner WANTS to
 * practice but asks for LOWER intensity. Drives 'gentle' (a gentle coach: ONE easy, warm,
 * low-effort cue), NOT 'breather' (a full hold). Distinct from isOverwhelmed (distress).
 * Anchored to "me" / explicit pacing so it does NOT fire on "be gentle with my pitch
 * feedback" (an ordinary coaching ask). Fires whether or not an explicit ask is present —
 * "go easy on me, help my pitch" still wants pitch help, just gently.
 */
function isEaseOffRequest(message) {
  const n = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!n) return false;
  return /\bgo easy on me\b/.test(n)
    || /\bbe (?:soft|gentle|kind) with me\b/.test(n)
    || /\bbe (?:nice|kind|gentle) (?:about it|with (?:the |your )?feedback)\b/.test(n)
    || /\bgive it to me gently\b/.test(n)
    || /\bease (?:into it|in)\b/.test(n)
    || /\btake it (?:slow|slowly|easy)\b/.test(n)
    || /\bgo slow(?:ly)?\b/.test(n)
    // 2026-07-28: bare slow-down asks — "slow down", "say it slower", "speak
    // slower". Same shape as "go slow": the learner wants to engage, gently.
    || /\bslow down\b/.test(n)
    || /\b(?:say|speak|read)\s+(?:it\s+)?(?:slower|slowly|more slowly)\b/.test(n)
    || /\b(?:start|keep it) (?:slow|gentle|easy)\b/.test(n);
}

/**
 * Detect a TYPED chatting / sharing / off-practice turn (broader than the explicit
 * conversation_practice mode). Drives 'converse'. GUARDED so it never fires on a turn
 * that names a voice target (that's a coaching take, not chit-chat) — fixes "I just
 * finished my take, how was the pitch?" wrongly reading as converse.
 */
function isChattingOrSharing(message) {
  const n = typeof message === 'string' ? message.trim().toLowerCase() : '';
  if (!n) return false;
  if (VOICE_TOPIC_RE.test(n)) return false;
  return /\bnot (?:a )?(?:practice|drill|voice)(?: thing| today| right now)?\b/.test(n)
    || /\bjust (?:sharing|chatting|wanted to (?:share|say|tell)|telling you)\b/.test(n)
    || /\bhad to tell someone\b/.test(n)
    || /\bhow (?:has|was|is|are) (?:your|you)\b/.test(n)
    || /\bguess what\b/.test(n);
}

/**
 * Build the full policy decision from all inputs.
 */
function resolvePolicy({
  practiceMode = 'active_drill',
  safetyState = 'normal',
  captureReliability = 'good',
  userMessage = '',
  scenarioPolicy = null,
  lessonState = null,
  consecutiveMisses = 0,
  // 2026-07-28: whether the current take produced an acoustically usable
  // measurement (signal-builder threads takeQuality.usable through). Defaults
  // FALSE (fail closed): a caller that does not know keeps the legacy breather.
  takeUsable = false,
  // 2026-07-28: whether THIS turn carries a fresh, scored take (takeQuality +
  // take evidence, threaded by signal-builder). On the spoken path userMessage
  // is the ASR transcript of the take itself, so the text classifiers below
  // must not veto correction on the strength of the drill line's wording.
  hasUsableTake = false,
} = {}) {
  const mode = normalizePracticeMode(practiceMode);
  const policy = {
    shouldCorrect: true,
    maxCueCount: 1,
    avoidTopics: [],
    safetyState,
    conversationPriority: 'normal',
    coachingAction: 'coach',
    mode,
  };

  // Safety overrides everything — ease off, no cue (breather).
  if (safetyState === 'stop') {
    policy.shouldCorrect = false;
    policy.conversationPriority = 'safety';
    policy.coachingAction = 'breather';
    policy.avoidTopics.push('intensity', 'difficulty', 'pushing', 'voice_analysis');
    return policy;
  }

  if (safetyState === 'fatigue_or_strain') {
    policy.shouldCorrect = false;
    policy.conversationPriority = 'safety';
    policy.coachingAction = 'breather';
    policy.avoidTopics.push('intensity', 'difficulty', 'pushing');
    return policy;
  }

  // Capture-only issues: don't analyze voice, just ask for a better capture (no cue).
  // 2026-07-28: the capture_only latch also fires on ASR-side capture faults (low
  // transcript confidence, a speech-input outcome) while the ACOUSTIC measurement
  // came through clean and usable. Forcing a breather there stripped every
  // corrective evidence line, left the model praising unmeasured takes, and made
  // the misses>=2 adapt path unreachable (this branch returned first). So the
  // latch only holds when the take is genuinely unusable; a usable take falls
  // through to the normal policy even in capture_only state.
  if ((safetyState === 'capture_only' && !takeUsable)
    || captureReliability === 'low' || captureReliability === 'unusable') {
    policy.shouldCorrect = false;
    policy.coachingAction = 'breather';
    policy.avoidTopics.push('voice_analysis');
    return policy;
  }

  // Text-driven holds (v3): the runtime derives practiceMode from keywords and
  // safetyState from audio, so a TYPED venting/chatting turn (the common case in a chat
  // coach) would otherwise fall through to `coach`. Detect them from the message so the
  // app holds the cue.
  // (a) An unambiguous DECLINE of practice overrides everything below — a learner who
  // says "I don't want a fix tonight" gets a breather even if the bare words ("fix" +
  // "voice") trip the coarse correction match.
  if (isVentingOrHurt(userMessage)) {
    policy.shouldCorrect = false;
    policy.conversationPriority = 'safety';
    policy.coachingAction = 'breather';
    policy.avoidTopics.push('intensity', 'difficulty', 'pushing');
    return policy;
  }
  // (b) Softer holds — overwhelm/fatigue, "can't do drills right now", chatting — yield to
  // an explicit ask (so "I'm exhausted but help my pitch" still coaches).
  if (!isRequestingCorrection(userMessage)) {
    // Overwhelm / fatigue stated WITHOUT an explicit ask -> breather.
    if (isOverwhelmed(userMessage)) {
      policy.shouldCorrect = false;
      policy.conversationPriority = 'safety';
      policy.coachingAction = 'breather';
      policy.avoidTopics.push('intensity', 'difficulty', 'pushing');
      return policy;
    }
    // "I can't do drills / this right now" — declining practice this turn.
    if (/\b(?:can'?t|cannot)\b[^.!?]*\b(?:right now|today|do (?:this|drills?)|drills?|any (?:of )?(?:this|drills?))\b/.test(String(userMessage || '').toLowerCase())) {
      policy.shouldCorrect = false;
      policy.conversationPriority = 'safety';
      policy.coachingAction = 'breather';
      policy.avoidTopics.push('intensity', 'difficulty', 'pushing');
      return policy;
    }
  }

  // (c) Explicit "ease off / be gentle / take it slow" — the learner wants to engage but
  // asks for LOWER intensity. Not a hold (breather) and not a normal push: a GENTLE coach
  // (one easy, warm, low-effort cue). Checked BEFORE the chatting/casual classifier so a
  // question-form ease-off ("can you go slow with the cues") engages gently instead of
  // reading as chit-chat; and OUTSIDE the !requesting gate so "go easy on me, fix my pitch"
  // still gets gentle pitch help. Safety/decline/overwhelm (above) still win over gentle.
  if (isEaseOffRequest(userMessage)) {
    policy.shouldCorrect = true;
    policy.maxCueCount = 1;
    policy.coachingAction = 'gentle';
    policy.avoidTopics.push('intensity', 'difficulty', 'pushing');
    return policy;
  }

  // Chatting / sharing with no explicit ask -> converse (after the ease-off check above so
  // a pace-down request is not mistaken for chit-chat).
  // 2026-07-28: gated OFF on take-bearing turns. On the spoken path userMessage is
  // the ASR transcript of the TAKE, and the line library is full of question-form
  // drill lines ("how was your day", "what time works for you?") — reading those as
  // chit-chat flipped real drill turns to converse and small-talked the take away.
  // A turn with no fresh scored take (typed chat, takeless talk) is unaffected.
  if (!hasUsableTake
    && !isRequestingCorrection(userMessage)
    && (isCasualConversation(userMessage) || isChattingOrSharing(userMessage))) {
    policy.shouldCorrect = false;
    policy.conversationPriority = 'highest';
    policy.coachingAction = 'converse';
    return policy;
  }

  // Degraded capture: allow coaching but with caveats
  if (captureReliability === 'degraded') {
    policy.maxCueCount = 1;
  }

  // Practice mode rules
  if (mode === 'conversation_practice') {
    if (isCasualConversation(userMessage) && !isRequestingCorrection(userMessage)) {
      policy.shouldCorrect = false;
      policy.conversationPriority = 'highest';
      policy.coachingAction = 'converse';
    } else if (isRequestingCorrection(userMessage)) {
      policy.shouldCorrect = true;
      policy.maxCueCount = 1;
      policy.conversationPriority = 'high';
      policy.coachingAction = coachOrAdapt(userMessage, consecutiveMisses);
    } else {
      // Default conversation: no correction unless asked
      policy.shouldCorrect = false;
      policy.conversationPriority = 'high';
      policy.coachingAction = 'converse';
    }
    return policy;
  }

  if (mode === 'safety_reset') {
    policy.shouldCorrect = false;
    policy.conversationPriority = 'safety';
    policy.coachingAction = 'breather';
    policy.avoidTopics.push('intensity', 'difficulty');
    return policy;
  }

  if (mode === 'reflection') {
    policy.shouldCorrect = true;
    policy.maxCueCount = 1;
    policy.coachingAction = coachOrAdapt(userMessage, consecutiveMisses);
    policy.avoidTopics.push('new_drill');
    return policy;
  }

  if (mode === 'lesson_plan') {
    policy.shouldCorrect = false;
    policy.conversationPriority = 'planning';
    policy.coachingAction = 'converse';
    return policy;
  }

  // Default (active_drill): coach, or adapt if the method is stalling.
  policy.coachingAction = coachOrAdapt(userMessage, consecutiveMisses);

  // Scenario-specific overrides
  if (scenarioPolicy) {
    if (scenarioPolicy.conversationNoCorrection) {
      policy.shouldCorrect = false;
      policy.conversationPriority = 'highest';
      policy.coachingAction = 'converse';
    }
    if (scenarioPolicy.pitchStableDarkLarge) {
      policy.avoidTopics.push('pitch');
    }
    if (Array.isArray(scenarioPolicy.avoidTopics)) {
      policy.avoidTopics.push(...scenarioPolicy.avoidTopics);
    }
  }

  // Deduplicate avoidTopics
  policy.avoidTopics = [...new Set(policy.avoidTopics)];

  return policy;
}

module.exports = {
  resolvePolicy,
  normalizePracticeMode,
  isCasualConversation,
  isRequestingCorrection,
  isMethodStalling,
  isVentingOrHurt,
  isOverwhelmed,
  isEaseOffRequest,
  isChattingOrSharing,
  COACHING_ACTIONS,
};
