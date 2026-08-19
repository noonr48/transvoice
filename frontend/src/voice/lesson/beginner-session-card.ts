// Beginner session card — frontend consumption of the certified fem-v1 card
// contract (backend: coaching/beginner-session-card.js, schema
// transvoice.beginner_session_card.v1).
//
// Mirrors the card.ts pattern: pure module, defensive normalizer over the raw
// payload, no DOM, no state.ts coupling. The backend owns copy production and
// the jargon audit; this module owns STRUCTURAL consumption: unknown or
// malformed payloads fail closed to null (no card), and the safety-stop
// collapse (no record affordance, no steps) is enforced client-side too as
// defense in depth — even a buggy payload cannot model a record button on a
// stop card.

export type BeginnerCardFeedbackMode = 'hidden_guide' | 'new_prompt' | 'retention_check';

// Backend KNOWN_FEEDBACK_STATES — the result vocabulary. Unknown states fail
// closed (null card): the frontend never invents rendering for a state it
// does not know.
export const BEGINNER_CARD_RESULT_STATES = [
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
  // R1-005: controller actions are not acoustic outcomes — these two never
  // claim movement; they describe checking and progression states.
  'checking_result',
  'next_step_ready',
] as const;

export type BeginnerCardResultState = typeof BEGINNER_CARD_RESULT_STATES[number];

const FEEDBACK_MODES: BeginnerCardFeedbackMode[] = ['hidden_guide', 'new_prompt', 'retention_check'];
const MAX_STEPS = 8;
const MAX_TEXT = 400;

export type BeginnerSessionCard = {
  focusLabel: string | null;
  listenHasDemo: boolean;
  trySteps: string[];
  showRecord: boolean;
  recordLabel: string;
  resultState: BeginnerCardResultState;
  resultMessage: string;
  nextMessage: string;
  fadingWhy: string | null;
  fadingMode: BeginnerCardFeedbackMode | null;
  isSafetyStop: boolean;
};

function asTrimmedString(value: unknown, maxLength = MAX_TEXT): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text ? text.slice(0, maxLength) : null;
}

function normalizeSteps(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const steps: string[] = [];
  for (const item of value) {
    const step = asTrimmedString(item);
    if (step) steps.push(step);
    if (steps.length >= MAX_STEPS) break;
  }
  return steps;
}

/**
 * Normalize a raw `beginnerSessionCard` payload into the render model.
 * Returns null when the payload is not a usable card — callers treat
 * "no card" uniformly and keep the existing lesson surface.
 */
export function normalizeBeginnerSessionCard(value: unknown): BeginnerSessionCard | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;

  // Structural contract: must carry the beginner card schema. A payload
  // without it is not this card — fail closed rather than guessing a shape.
  if (record.schema !== 'transvoice.beginner_session_card.v1') return null;

  const result = record.result && typeof record.result === 'object'
    ? record.result as Record<string, unknown>
    : null;
  const resultStateRaw = asTrimmedString(result?.state, 80);
  const resultState = resultStateRaw
    && (BEGINNER_CARD_RESULT_STATES as readonly string[]).includes(resultStateRaw)
      ? resultStateRaw as BeginnerCardResultState
      : null;
  const resultMessage = asTrimmedString(result?.message);
  if (!resultState || !resultMessage) return null; // a card without a speakable result is not a card

  const next = record.next && typeof record.next === 'object'
    ? record.next as Record<string, unknown>
    : {};
  const nextMessage = asTrimmedString(next.message);
  if (!nextMessage) return null;

  const focus = record.focus && typeof record.focus === 'object'
    ? record.focus as Record<string, unknown>
    : {};
  const focusLabel = asTrimmedString(focus.label, 120);

  const listen = record.listen && typeof record.listen === 'object'
    ? record.listen as Record<string, unknown>
    : {};
  const listenHasDemo = listen.hasApprovedDemo === true;

  const trySteps = normalizeSteps(record.try && typeof record.try === 'object'
    ? (record.try as Record<string, unknown>).steps
    : record.try);

  const feedbackRaw = record.feedback && typeof record.feedback === 'object'
    ? record.feedback as Record<string, unknown>
    : null;
  const fadingModeRaw = asTrimmedString(feedbackRaw?.mode, 40);
  const candidateMode = fadingModeRaw && FEEDBACK_MODES.includes(fadingModeRaw as BeginnerCardFeedbackMode)
    ? fadingModeRaw as BeginnerCardFeedbackMode
    : null;
  // The fading contract is mode + WHY together (UX-lens law: the learner
  // must hear why the guide withdraws). A mode without its why-message is
  // an incomplete payload — fail closed to no fading block, never a bare
  // mode label that reads as the app going cold.
  const fadingWhy = candidateMode ? asTrimmedString(feedbackRaw?.whyMessage) : null;
  const fadingMode = fadingWhy ? candidateMode : null;

  const isSafetyStop = resultState === 'safety_stop';

  // F3 (defense in depth): a stop card carries no fading block either —
  // even a buggy payload cannot pair a why-message with stop language.
  const effectiveFadingMode = isSafetyStop ? null : fadingMode;
  const effectiveFadingWhy = isSafetyStop ? null : fadingWhy;

  // Record affordance: client-side safety-stop enforcement (defense in depth
  // — the backend already nulls it; a buggy payload cannot re-arm it here).
  const recordPayload = record.record && typeof record.record === 'object'
    ? record.record as Record<string, unknown>
    : null;
  const showRecord = !isSafetyStop && recordPayload !== null;
  const recordLabel = showRecord ? (asTrimmedString(recordPayload?.label, 40) ?? 'Record') : '';

  return {
    // A stop card carries no focus and no steps — the whole card is the stop.
    focusLabel: isSafetyStop ? null : focusLabel,
    listenHasDemo: isSafetyStop ? false : listenHasDemo,
    trySteps: isSafetyStop ? [] : trySteps,
    showRecord,
    recordLabel,
    resultState,
    resultMessage,
    nextMessage,
    fadingWhy: effectiveFadingWhy,
    fadingMode: effectiveFadingMode,
    isSafetyStop,
  };
}
