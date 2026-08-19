import intentConfig from '../../shared/voice/coach-intents.json';

export type VoiceCoachClarificationIntent =
  | 'repeat'
  | 'repeat-slower'
  | 'advance'
  | 'hold'
  | 'why'
  | 'easier'
  | 'harder'
  | 'practice-ready'
  | 'practice-stop';

export type VoiceCoachRoutingDecision = {
  normalizedQuestion: string;
  intent: VoiceCoachClarificationIntent | null;
  shouldDeferToFrontend: boolean;
  shouldEscalateToDeepTutor: boolean;
};

export type VoiceCoachHandlingRoute =
  | 'legacy'
  | 'deeptutor-realtime'
  | 'deeptutor-guide'
  | 'deeptutor-brief-action'
  | 'deeptutor-advance';

export type VoiceCoachHandlingDecision = VoiceCoachRoutingDecision & {
  route: VoiceCoachHandlingRoute;
  channel: 'coach' | 'legacy' | 'runtime' | 'deeptutor' | 'shortcut';
};

export function normalizeVoiceCoachIntentText(text = ''): string {
  let normalized = String(text || '')
    .toLowerCase()
    // Apostrophes COLLAPSE ("don't" -> "dont") instead of splitting ("don t").
    // Splitting made every \bdon'?t\b-style configured pattern unmatchable, so
    // "don't move on" fell through to the move+on hand matcher and routed to
    // 'advance' — the exact opposite of the spoken command.
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const prefixPattern = /^(?:please|coach|okay|ok|hey coach|can you|could you|can we|could we|will you)\s+/;
  while (prefixPattern.test(normalized)) {
    normalized = normalized.replace(prefixPattern, '').trim();
  }
  return normalized.replace(/\s+(?:please|now)$/g, '').trim();
}

function buildVoiceCoachIntentWordHelpers(normalized: string): {
  hasWord: (...values: string[]) => boolean;
  hasStem: (...values: string[]) => boolean;
} {
  const words = normalized.split(' ').filter(Boolean);
  return {
    hasWord: (...values) => values.some((value) => words.includes(value)),
    hasStem: (...values) => words.some((word) => values.some((value) => word.startsWith(value))),
  };
}

function matchesConfiguredPattern(normalized: string, key: keyof typeof intentConfig): boolean {
  return intentConfig[key].some((pattern) => new RegExp(pattern).test(normalized));
}

// ---------------------------------------------------------------------------
// THE COMMAND-SHAPE GATE (2026-07-27 field repair)
// ---------------------------------------------------------------------------
//
// STATUS (same day, owner's law): RETAINED BUT UNWIRED. Hours after this gate
// shipped, the owner ruled "all user speech goes to the tutor, and the tutor
// decides" — the clarification-CONSUMPTION lane was deleted outright, so no
// production code path calls the clarification classifier below any more (the
// only production import from this module is the scope-intent runner). The
// classifier + gate + fixtures corpus are kept, tests and all, as the
// documented, regression-pinned description of what a spoken COMMAND looks
// like — the natural seed if command handling ever returns SERVER-side, where
// the tutor itself would do the deciding. Do not re-wire it into the client
// submit path; that is the exact failure the owner's law removed.
//
// THE INCIDENT. A learner spoke normal sentences to the tutor and heard nothing
// back, turn after turn. The matchers below run on EVERY auto-submitted
// transcript, and they are deliberately generous so short spoken commands land
// ("again", "wait", "too hard"). But generous matchers applied to full
// conversational sentences CONSUME them: measured live, "i'll try to go a bit
// higher" matched practice-ready (try + go), silently armed the practice mic,
// and every following turn hit the silent "already armed" notice. The learner's
// side of a coaching conversation is FULL of these words — that is what talking
// about your own attempts sounds like.
//
// THE RULE. An utterance is treated as a COMMAND only when it is SHAPED like
// one: short, and made entirely of command vocabulary and carrier words. The
// moment it carries any other content ("higher", "nasal", "felt") it is
// conversation, the intent is discarded, and the turn flows to the real coach —
// which always answers out loud. False negatives are cheap (the LLM coach
// handles "make it easier please, this one hurts" perfectly well); false
// positives are dead air.
const COMMAND_UTTERANCE_MAX_WORDS = 8;

// One membership set, two kinds of members: CARRIER words (grammar, fillers,
// contractions — never carry command meaning on their own) and COMMAND
// vocabulary (every word used by the configured patterns in
// shared/voice/coach-intents.json and the hand matchers below). A word that is
// in neither is CONTENT, and content means conversation. Deliberately absent:
// voice, sound, pitch, breath, higher, lower, softer — the learner's
// self-description vocabulary must never gate-pass as a command.
const COMMAND_SAFE_WORDS = new Set([
  // carriers
  'a', 'an', 'the', 'to', 'and', 'then', 'so', 'just', 'really', 'now', 'well',
  'um', 'uh', 'hmm', 'oh', 'yeah', 'yes', 'no', 'okay', 'ok', 'not',
  'dont', 'didnt', 'cant', 'cannot', 'couldnt', 'wont', 'wouldnt', 'shouldnt',
  'isnt', 'wasnt', 'doesnt',
  'i', 'im', 'ill', 'id', 'ive', 'me', 'my', 'we', 'lets', 'let', 'you', 'your',
  'it', 'its', 'that', 'thats', 'this', 'these', 'there', 'here',
  'is', 'are', 'was', 'were', 'be', 'been', 'am',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'shall', 'may',
  'please', 'hey',
  // repeat / repeat-slower
  'repeat', 'again', 'replay', 'restate', 'run', 'back', 'over', 'say', 'tell',
  'show', 'one', 'more', 'time', 'slower', 'slow', 'down', 'slowly', 'walk',
  'through',
  // advance
  'next', 'move', 'on', 'continue', 'go', 'going', 'advance', 'another', 'new',
  'line', 'forward', 'keep', 'lesson', 'work', 'what', 'whats',
  // hold
  'hold', 'stay', 'yet', 'wait', 'linger', 'stick', 'with', 'part', 'pass',
  'bit', 'ready',
  // why
  'why', 'drill', 'doing', 'point', 'reason', 'explain', 'purpose',
  // easier / harder
  'easier', 'easy', 'simpler', 'simple', 'gentler', 'gentle', 'lighter', 'hard',
  'harder', 'challenging', 'less', 'dial', 'off', 'turn', 'up', 'stronger',
  'push', 'step', 'too', 'make', 'give',
  // practice-ready / practice-stop
  'practice', 'take', 'shot', 'mic', 'want', 'try', 'start', 'arm', 'when',
  'stop', 'pause', 'disarm', 'release', 'coach', 'coaching', 'resume',
  'listen', 'open', 'return', 'mode',
]);

/**
 * True when the (already normalized) utterance is SHAPED like a spoken command:
 * at most COMMAND_UTTERANCE_MAX_WORDS words, every one of them command-safe.
 * Exported for the routing corpus tests.
 */
export function isVoiceCoachCommandShaped(normalized: string): boolean {
  const words = normalized.split(' ').filter(Boolean);
  if (!words.length || words.length > COMMAND_UTTERANCE_MAX_WORDS) {
    return false;
  }
  return words.every((word) => COMMAND_SAFE_WORDS.has(word));
}

export function getVoiceCoachClarificationIntent(question = ''): VoiceCoachClarificationIntent | null {
  const normalized = normalizeVoiceCoachIntentText(question);
  if (!normalized) {
    return null;
  }
  const intent = resolveRawVoiceCoachClarificationIntent(normalized);
  if (!intent) {
    return null;
  }
  // The gate runs AFTER the raw match on purpose: the raw matchers stay the
  // single description of what each command LOOKS like, and the gate is the
  // single description of what a command IS. A gated-out utterance is not an
  // error — it is a conversational turn, and the caller submits it to the
  // coach, which answers out loud.
  return isVoiceCoachCommandShaped(normalized) ? intent : null;
}

function resolveRawVoiceCoachClarificationIntent(normalized: string): VoiceCoachClarificationIntent | null {
  const { hasWord, hasStem } = buildVoiceCoachIntentWordHelpers(normalized);
  const wantsRepeat = matchesConfiguredPattern(normalized, 'repeat');
  const wantsSlower = matchesConfiguredPattern(normalized, 'repeatSlower');
  if (wantsSlower && (wantsRepeat || /\b(?:say|do|go|walk)\b/.test(normalized))) {
    return 'repeat-slower';
  }
  if (wantsSlower && (hasWord('again', 'repeat', 'replay') || hasStem('walk'))) {
    return 'repeat-slower';
  }
  if (wantsRepeat) {
    return 'repeat';
  }
  if (
    (hasStem('repeat', 'replay', 'restate')
      || (hasWord('again') && (hasWord('say') || hasWord('tell') || hasWord('show') || hasWord('walk'))))
    && !hasStem('hard', 'easy')
  ) {
    return 'repeat';
  }

  // A configured HOLD phrase vetoes advance BEFORE advance is consulted:
  // "don't move on" contains "move on", and without this guard the negated
  // command routes to 'advance' — the exact opposite of what was said. The
  // veto is deliberately biased toward HOLD: a mixed utterance like "wait,
  // next one" reads as hold here (reviewer-measured), which keeps the learner
  // in place — the recoverable mistake — rather than skipping them forward.
  const wantsHold = matchesConfiguredPattern(normalized, 'hold');
  if (!wantsHold && matchesConfiguredPattern(normalized, 'advance')) {
    return 'advance';
  }
  if (
    !wantsHold
    && (hasStem('next', 'advance', 'continue', 'proceed')
      || ((hasWord('move') || hasWord('go') || hasWord('keep')) && (hasWord('on') || hasWord('forward') || hasWord('going'))))
  ) {
    return 'advance';
  }

  if (wantsHold) {
    return 'hold';
  }
  if (
    (hasStem('hold', 'stay', 'wait', 'linger', 'stick', 'pause') || (hasWord('keep') && hasWord('here')))
    && (hasWord('here') || hasWord('this') || hasWord('there') || hasWord('bit'))
  ) {
    return 'hold';
  }

  if (matchesConfiguredPattern(normalized, 'why')) {
    return 'why';
  }

  if (matchesConfiguredPattern(normalized, 'easier')) {
    return 'easier';
  }
  if (
    hasStem('easier', 'simpl', 'gentl', 'lighter')
    || ((hasWord('less') || hasWord('more')) && hasWord('simple'))
    || (hasWord('back') && hasStem('off'))
  ) {
    return 'easier';
  }

  if (matchesConfiguredPattern(normalized, 'harder')) {
    return 'harder';
  }
  if (
    hasStem('harder', 'challeng', 'push', 'stronger')
    || (hasWord('step') && hasWord('up'))
    || (hasWord('turn') && hasWord('up'))
  ) {
    return 'harder';
  }

  if (matchesConfiguredPattern(normalized, 'practiceReady')) {
    return 'practice-ready';
  }
  if (
    (hasStem('ready') || hasStem('try'))
    && (hasWord('practice') || hasWord('pass') || hasWord('take') || hasWord('shot') || hasWord('mic') || hasWord('go'))
  ) {
    return 'practice-ready';
  }

  if (matchesConfiguredPattern(normalized, 'practiceStop')) {
    return 'practice-stop';
  }
  if (
    (hasStem('stop', 'pause', 'disarm', 'release') || (hasWord('back') && hasWord('coach')))
    && (hasWord('practice') || hasWord('coach') || hasWord('mic'))
  ) {
    return 'practice-stop';
  }

  return null;
}

export function resolveVoiceCoachRoutingDecision(question = ''): VoiceCoachRoutingDecision {
  const normalizedQuestion = normalizeVoiceCoachIntentText(question);
  if (!normalizedQuestion) {
    return {
      normalizedQuestion,
      intent: null,
      shouldDeferToFrontend: false,
      shouldEscalateToDeepTutor: false,
    };
  }

  const intent = getVoiceCoachClarificationIntent(normalizedQuestion);
  const shouldEscalateToDeepTutor = intent === 'easier'
    || intent === 'harder'
    || matchesConfiguredPattern(normalizedQuestion, 'deepEscalation');

  return {
    normalizedQuestion,
    intent,
    shouldDeferToFrontend: Boolean(intent),
    shouldEscalateToDeepTutor,
  };
}

export function resolveVoiceCoachHandlingDecision(
  question = '',
  hasActiveGuideSession = false,
): VoiceCoachHandlingDecision {
  const routingDecision = resolveVoiceCoachRoutingDecision(question);
  if (!hasActiveGuideSession) {
    return {
      ...routingDecision,
      route: 'legacy',
      channel: 'legacy',
    };
  }
  if (routingDecision.intent === 'advance') {
    return {
      ...routingDecision,
      route: 'deeptutor-advance',
      channel: 'deeptutor',
    };
  }
  if (
    routingDecision.intent === 'repeat'
    || routingDecision.intent === 'repeat-slower'
    || routingDecision.intent === 'why'
    || routingDecision.intent === 'hold'
  ) {
    return {
      ...routingDecision,
      route: 'deeptutor-brief-action',
      channel: 'shortcut',
    };
  }
  if (routingDecision.shouldEscalateToDeepTutor) {
    return {
      ...routingDecision,
      route: 'deeptutor-guide',
      channel: 'deeptutor',
    };
  }
  return {
    ...routingDecision,
    route: 'deeptutor-realtime',
    channel: 'runtime',
  };
}

export function shouldEscalateRealtimeVoiceQuestion(question = ''): boolean {
  return resolveVoiceCoachRoutingDecision(question).shouldEscalateToDeepTutor;
}

export function shouldDeferVoiceCoachRoutingToFrontend(question = ''): boolean {
  return resolveVoiceCoachRoutingDecision(question).shouldDeferToFrontend;
}

/* ===========================================================================
 * Flow lane — session-scope voice intents (tier + eyes-free).
 *
 * "keep it quiet" / "just listening" / "back to full voice" / "I'm driving" /
 * "I can look again" are consumed BEFORE clarification routing (mirroring how
 * repeat/easier are consumed inside submitVoiceCoachQuestion) and applied via
 * POST /voice/session/:sessionId/scope { tier?, eyesFree? } (B-SESS contract),
 * answered with a short spoken acknowledgment. Detection + copy live here
 * (pure, testable); execution is composed in host-runtime-composition.
 * ======================================================================== */

export type VoiceCoachSessionTier = 'full' | 'quiet' | 'silent';

export type VoiceCoachScopeIntent =
  | { kind: 'tier'; tier: VoiceCoachSessionTier }
  | { kind: 'eyes-free'; eyesFree: boolean };

export type VoiceCoachSessionScopePatch = {
  tier?: VoiceCoachSessionTier;
  eyesFree?: boolean;
};

/** Spoken acknowledgments (design copy — calm, time-blind, zero-prop). */
export const VOICE_COACH_SCOPE_ACKS = {
  'tier-quiet': 'Quiet works. Humming and listening carry the same practice.',
  'tier-silent': "Just listening is a real session. I'll play; you judge by ear.",
  'tier-full': "Full voice it is. We'll work with the whole instrument.",
  'eyes-free-on': "Eyes on the road — everything here works by voice. If it gets busy, just go quiet; I'll wait.",
  'eyes-free-off': "Good — the screen's back when you want it. Voice still works for everything.",
} as const;

export type VoiceCoachScopeAckKey = keyof typeof VOICE_COACH_SCOPE_ACKS;

export function getVoiceCoachScopeIntent(question = ''): VoiceCoachScopeIntent | null {
  const normalized = normalizeVoiceCoachIntentText(question);
  if (!normalized) {
    return null;
  }
  // Negations first: "not driving" must never fall into "driving".
  if (matchesConfiguredPattern(normalized, 'eyesFreeOff')) {
    return { kind: 'eyes-free', eyesFree: false };
  }
  if (matchesConfiguredPattern(normalized, 'eyesFreeOn')) {
    return { kind: 'eyes-free', eyesFree: true };
  }
  if (matchesConfiguredPattern(normalized, 'tierSilent')) {
    return { kind: 'tier', tier: 'silent' };
  }
  if (matchesConfiguredPattern(normalized, 'tierQuiet')) {
    return { kind: 'tier', tier: 'quiet' };
  }
  if (matchesConfiguredPattern(normalized, 'tierFull')) {
    return { kind: 'tier', tier: 'full' };
  }
  return null;
}

export function voiceCoachScopeAckKey(intent: VoiceCoachScopeIntent): VoiceCoachScopeAckKey {
  if (intent.kind === 'tier') {
    return `tier-${intent.tier}`;
  }
  return intent.eyesFree ? 'eyes-free-on' : 'eyes-free-off';
}

export function voiceCoachScopePatch(intent: VoiceCoachScopeIntent): VoiceCoachSessionScopePatch {
  return intent.kind === 'tier' ? { tier: intent.tier } : { eyesFree: intent.eyesFree };
}

export type VoiceCoachScopeIntentRunnerOptions = {
  getSessionId: () => string | null;
  /** POST /voice/session/:sessionId/scope (B-SESS contract). */
  postSessionScope: (sessionId: string, scope: VoiceCoachSessionScopePatch) => Promise<unknown>;
  /** Speak the short acknowledgment through the coach TTS path. */
  speakAck: (text: string, ackKey: VoiceCoachScopeAckKey) => boolean;
  log?: (line: string) => void;
};

/**
 * Returns a handler that consumes a scope-intent question end-to-end
 * (POST scope, then speak the ack) and reports whether it did. A failed POST
 * (e.g. a backend without the scope route yet) falls through — the utterance
 * then flows to the coach as a normal question instead of being dropped.
 */
export function createVoiceCoachScopeIntentRunner(options: VoiceCoachScopeIntentRunnerOptions) {
  return async function handleVoiceCoachScopeIntent(question: string): Promise<boolean> {
    const intent = getVoiceCoachScopeIntent(question);
    if (!intent) {
      return false;
    }
    const sessionId = options.getSessionId();
    if (!sessionId) {
      return false;
    }
    const patch = voiceCoachScopePatch(intent);
    const ackKey = voiceCoachScopeAckKey(intent);
    try {
      await options.postSessionScope(sessionId, patch);
    } catch (error) {
      options.log?.(
        `[voice-scope] scope route failed; falling through to coach (${
          error instanceof Error ? error.message : String(error)
        })`,
      );
      return false;
    }
    options.log?.(`[voice-scope] applied ${JSON.stringify(patch)} (${ackKey})`);
    // 2026-07-27 (owner's law): this is the ONLY lane that may consume speech,
    // and it may consume ONLY what it answers out loud. If the ack cannot be
    // spoken (no coach shell, speech path down), the scope patch stays applied
    // — the device-mode change is still what was asked for — but the turn
    // falls through to the tutor, whose reply is the audible response.
    const spoken = options.speakAck(VOICE_COACH_SCOPE_ACKS[ackKey], ackKey) === true;
    if (!spoken) {
      options.log?.(`[voice-scope] ack could not be spoken; falling through to coach (${ackKey})`);
      return false;
    }
    return true;
  };
}
