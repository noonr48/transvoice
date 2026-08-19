'use strict';

const { containsInternalJargon, SAFETY_STOP_MESSAGES } = require('./beginner-feedback');

const BEGINNER_SESSION_CARD_SCHEMA = 'transvoice.beginner_session_card.v1';

// Feedback states the card knows how to speak. Anything else fails closed to
// the neutral "no reliable change" presentation — never an internal label.
const KNOWN_FEEDBACK_STATES = Object.freeze([
  'ready_for_instruction',
  'could_not_measure',
  'no_reliable_change',
  'movement_needs_confirmation',
  'change_was_mixed',
  'change_too_effortful',
  'cue_not_helping_yet',
  'verified_progress',
  'ease_reset',
  'safety_stop',
  'no_actionable_correction',
  // R1-005 (GPT-Pro §6): controller actions are not acoustic outcomes —
  // verify/advance get their own non-claiming states.
  'checking_result',
  'next_step_ready',
]);

const FALLBACK_RESULT_MESSAGE = 'That take sounded very similar to the last one. Try the exercise once more.';
const READY_RESULT_MESSAGE = 'Your setup is ready. Start the exercise whenever you like.';
const CALIBRATION_RESULT_MESSAGE = 'Give a few easy, comfortable samples so today\'s practice has a starting point. Listening back is part of the setup.';
const FALLBACK_NEXT_MESSAGE = 'Take your time. Record whenever you are ready.';
const SAFETY_NEXT_MESSAGE = 'Rest your voice now. You can come back to practice later.';

const NEXT_MESSAGES = Object.freeze({
  could_not_measure: 'Adjust the setup a little, then record once more.',
  no_reliable_change: 'Try a different exercise if the same one feels stale.',
  movement_needs_confirmation: 'Repeat the same experiment once more so it can be checked.',
  change_was_mixed: 'Try the exercise again while keeping everything else steady.',
  change_too_effortful: 'Make the next attempt smaller and easier.',
  cue_not_helping_yet: 'Switch to a different exercise rather than pushing harder.',
  verified_progress: 'Try it once without the guide.',
  ease_reset: 'Keep the next attempt easy and short.',
  no_actionable_correction: 'Keep practising normally; nothing needs changing right now.',
});

/**
 * Why feedback is withdrawing (checkpoint UX lens F1): the learner must hear
 * the REASON the guide fades — they own the voice, not the graph — or the
 * withdrawal reads as the app going cold. Keyed by the deterministic
 * feedback-schedule mode; copy lives here with the rest of the learner-facing
 * card language (the schedule module stays a copy-free state machine).
 */
const FADING_WHY_MESSAGES = Object.freeze({
  hidden_guide: 'The guide stays off for this one. You know the feeling now — trust it and go.',
  new_prompt: 'New words, same feeling you just found. The guide stays away so the voice becomes yours.',
  retention_check: 'First let us see what stayed with you from last time. The guide comes back after.',
});

function textOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/**
 * The beginner practice card (plan §14): TODAY'S FOCUS / LISTEN / TRY /
 * RESULT / NEXT, in beginner language only.
 *
 * Laws enforced here:
 * - Safety stop dominates the whole card: no focus, no steps, stop language.
 * - Capture failure is neutral — the recording failed, never the learner.
 * - No internal vocabulary in the default view (jargon-audited on build).
 * - Technical detail (phase, feedback state) is OPT-IN and never default.
 * - Unknown feedback states fail closed to the neutral no-change card.
 */
function buildBeginnerSessionCard({
  phase = 'calibration',
  feedback = null,
  focusLabel = null,
  trySteps = [],
  hasApprovedDemo = false,
  feedbackMode = null,
} = {}, { includeTechnicalDetails = false } = {}) {
  const rawState = feedback && typeof feedback === 'object' ? textOrNull(feedback.state) : null;
  const state = KNOWN_FEEDBACK_STATES.includes(rawState)
    ? rawState
    : 'no_reliable_change';
  const suppliedMessage = feedback && typeof feedback === 'object'
    ? textOrNull(feedback.message)
    : null;

  if (state === 'safety_stop') {
    const safetyReason = typeof feedback?.safetyReason === 'string' && feedback.safetyReason.trim()
      ? feedback.safetyReason.trim().slice(0, 60)
      : null;
    const card = {
      schema: BEGINNER_SESSION_CARD_SCHEMA,
      // R1-005: the typed stop reason rides the CARD top level (contract:
      // adapters and tests read card.safetyReason), with reason-specific
      // copy when the vocabulary knows it.
      safetyReason,
      focus: { label: null, otherFocusMentioned: [] },
      listen: { hasApprovedDemo: false },
      try: { steps: [] },
      result: {
        state: 'safety_stop',
        message: suppliedMessage
          || (safetyReason && SAFETY_STOP_MESSAGES[safetyReason])
          || 'Stop this exercise. Voice training should not hurt. Rest your voice and do not continue while pain is present.',
      },
      next: { message: SAFETY_NEXT_MESSAGE },
      // Safety stop: NO record affordance — the learner rests, full stop
      // (plan 7.3: stop means stop, not record one more).
      record: null,
      feedback: null,
      technicalDetails: null,
    };
    if (containsInternalJargon(card)) {
      // Defensive: never ship jargon, even from caller-supplied stop copy.
      card.result.message = 'Stop this exercise. Voice training should not hurt. Do not continue while pain is present.';
    }
    return card;
  }

  let resultMessage = suppliedMessage;
  if (!resultMessage) {
    if (state === 'ready_for_instruction') {
      resultMessage = phase === 'calibration'
        ? CALIBRATION_RESULT_MESSAGE
        : READY_RESULT_MESSAGE;
    } else if (state === 'no_reliable_change') {
      resultMessage = FALLBACK_RESULT_MESSAGE;
    }
    // All other known states carry caller-supplied beginner-feedback copy;
    // if it is missing, fail closed to the neutral fallback.
    resultMessage = resultMessage || FALLBACK_RESULT_MESSAGE;
  }
  if (containsInternalJargon({ m: resultMessage })) {
    resultMessage = FALLBACK_RESULT_MESSAGE;
  }

  const steps = (Array.isArray(trySteps) ? trySteps : [])
    .map((step) => textOrNull(step))
    .filter(Boolean)
    // Full-card jargon audit (plan 14.4): caller-supplied steps are checked
    // against the extended internal-terms list; an offending step is dropped,
    // never shipped. Failing closed to fewer steps beats smuggling internals.
    .filter((step) => !containsInternalJargon({ s: step }));

  const auditedFocusLabel = textOrNull(focusLabel);
  const safeFocusLabel = auditedFocusLabel && !containsInternalJargon({ f: auditedFocusLabel })
    ? auditedFocusLabel
    : null;
  const safeFadingMode = typeof feedbackMode === 'string'
    && Object.prototype.hasOwnProperty.call(FADING_WHY_MESSAGES, feedbackMode)
    ? feedbackMode
    : null;

  const card = {
    schema: BEGINNER_SESSION_CARD_SCHEMA,
    focus: { label: safeFocusLabel, otherFocusMentioned: [] },
    listen: { hasApprovedDemo: hasApprovedDemo === true },
    try: { steps },
    // Plan 14.2 five-part shape: RECORD is an explicit affordance of the
    // card, not implied wording — the frontend renders the button.
    record: { affordance: 'button', label: 'Record' },
    result: { state, message: resultMessage },
    next: {
      message: NEXT_MESSAGES[state] || FALLBACK_NEXT_MESSAGE,
    },
    // Fading explanation (UX lens F1): when a fading mode is supplied, the
    // learner hears WHY the guide is withdrawing. Absent mode -> null field.
    feedback: safeFadingMode
      ? { mode: safeFadingMode, whyMessage: FADING_WHY_MESSAGES[safeFadingMode] }
      : null,
    technicalDetails: null,
  };

  // Default-view backstop: after assembly, the learner-facing projection
  // (everything except the opt-in technicalDetails block) must contain no
  // internal vocabulary. If anything slipped through a caller-supplied
  // surface, fail closed to the neutral card body.
  const defaultView = {
    focus: card.focus,
    listen: card.listen,
    try: card.try,
    record: card.record,
    result: card.result,
    next: card.next,
    feedback: card.feedback,
  };
  if (containsInternalJargon(defaultView)) {
    card.focus.label = null;
    card.try.steps = [];
    card.result.message = FALLBACK_RESULT_MESSAGE;
    card.next.message = FALLBACK_NEXT_MESSAGE;
  }

  if (includeTechnicalDetails === true) {
    card.technicalDetails = {
      phase,
      feedbackState: state,
    };
  }
  return card;
}

module.exports = {
  BEGINNER_SESSION_CARD_SCHEMA,
  FADING_WHY_MESSAGES,
  KNOWN_FEEDBACK_STATES,
  buildBeginnerSessionCard,
};
