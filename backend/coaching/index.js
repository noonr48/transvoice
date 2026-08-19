'use strict';

/**
 * TransVoice Coaching Engine — deterministic coaching pipeline.
 *
 * Architecture:
 *   Raw metrics -> SafetyGates -> PolicyGates -> SignalBuilder -> CoachingSignal
 *   CoachingSignal -> RendererClient -> GGUF Model -> Sanitizer -> UI/TTS
 *
 * The deterministic code decides WHAT. The LLM decides HOW.
 */

const { buildCoachingSignal, isValidCoachingSignal, COACHING_SIGNAL_SCHEMA } = require('./signal-schema');
const { buildSignal, detectIssues, detectRecentWin, pickBaseline } = require('./signal-builder');
const { assessSafetyState, assessCaptureReliability, collectAnalyzerSafetyReasons } = require('./safety-gates');
const { resolvePolicy, normalizePracticeMode, isCasualConversation, isRequestingCorrection } = require('./policy-gates');
const { sanitizeCoachReply } = require('./sanitizer');
const { resolveSectionLoopTurn, resolveTakeKey, resolveTakeTranscript } = require('./section-loop');
const { buildDirectReply } = require('./direct-reply');
const { buildTargetMetricBridge, applyTargetMetricDecision } = require('./target-metric-bridge');
const { evaluateTargetMetricRuntime, resolveTargetMetricStage } = require('./target-metric-runtime');
const {
  resolveFeminizationV1Turn,
  FEMINIZATION_V1_CONTROLLER_SCHEMA,
  IMMEDIATE_STOP_FIELDS,
  REDUCE_DIFFICULTY_FLAG_FIELDS,
} = require('./feminization-v1-controller');
const { eligibleObservationsForPhase, isMetricEligibleForPhase } = require('./metric-eligibility');
const { buildPitchCalibrationEvidence } = require('./pitch-calibration-evidence');
const { resolvePitchStepPolicy, defaultPitchStepPolicyConfig } = require('./pitch-reachable-policy');
const { recordCueServed, acknowledgeCueServe, cueServeEligibility } = require('./cue-served-lifecycle');
const { nextFeedbackMode, masteryReviewState, defaultFeedbackPolicy } = require('./feedback-schedule');
const { createPendingMotorTrial, settlePendingMotorTrial } = require('./motor-trial');
const { evaluateFemV1Replay } = require('./fem-v1-replay-evaluator');
const { buildBeginnerSessionCard } = require('./beginner-session-card');
const { beginnerFeedback } = require('./beginner-feedback');
const {
  buildRendererSystemPrompt,
  buildRendererUserMessage,
  buildRendererMessages,
  estimateRendererPromptTokens,
} = require('./renderer-client');

// The renderer is contracted to at most two spoken sentences / 45 words plus
// small optional app-only ops blocks. A 1,024-token allowance turned a rare
// failure to stop into 15–20 seconds of avoidable generation at ~40 tok/s.
const REALTIME_RENDERER_MAX_TOKENS = 256;

/**
 * Full coaching turn: build signal, call model, sanitize.
 *
 * @param {Object} options
 * @param {Object} options.voiceState - Current session voice state
 * @param {Object} options.learnerContext - Learner profile/context (from getVoiceStudentModelSnapshot)
 * @param {Object} options.lessonState - Current lesson state (if any)
 * @param {string} options.userMessage - User's spoken question
 * @param {string} options.practiceMode - Current practice mode
 * @param {string} options.targetPreset - Voice style target
 * @param {Object} options.scenarioPolicy - Scenario-specific overrides
 * @param {Array} options.conversationHistory - Recent coach thread
 * @param {Function} options.callModel - Async fn(messages, opts) -> string
 * @param {string} [options.audioBase64] - Base64-encoded audio for multimodal models
 * @param {string} [options.audioFormat] - Audio format ('wav' or 'mp3')
 * @returns {Promise<{signal, rawReply, sanitizedReply, promptTokens}>}
 */
async function coachingTurn(options = {}) {
  const {
    voiceState,
    learnerContext,
    lessonState,
    userMessage = '',
    practiceMode = 'active_drill',
    targetPreset = 'cute-feminine',
    scenarioPolicy = null,
    conversationHistory = [],
    callModel,
    audioBase64,
    audioFormat,
    // Optional TurnTelemetry — when provided, a deterministic-fallback reply is
    // recorded on it (setFallback) so the turn's observability names the cause.
    telemetry = null,
    // Flow wave: the session's tier/eyes-free scope and the take's kind source.
    // Without these the per-kind honesty layer and the quiet/silent registers
    // are unreachable on this (the main app's) coach path — review finding.
    sessionScope = null,
    repContext = null,
    // 2026-07-26 phase B (sentence teardown): the active practice card's tokens,
    // so the signal can localize WHICH fragment of the line was weakest. Omit it
    // and no sections are computed — every other behavior is unchanged.
    cardTokens = null,
    // 2026-07-26 phase C (sentence teardown): the isolation loop.
    //   sectionLoop            — voiceState.sectionLoop (the live loop, or null)
    //   sectionLoopLastTakeKey — voiceState.sectionLoopLastTakeKey (the re-entry guard)
    //   cardPhrase             — the whole-sentence card phrase, for reassembly
    // All three default from voiceState so a caller that knows nothing about phase C
    // still behaves correctly; the runtime passes them explicitly.
    sectionLoop = undefined,
    sectionLoopLastTakeKey = undefined,
    cardPhrase = '',
    // Whether the strip's active card still belongs to the loop — computed by
    // callers with card-store access; defaults owned (see section-loop.js).
    stripOwned = true,
    // Injectable clock for the loop's enteredAt stamp (tests).
    now = undefined,
    // 2026-07-28 Phase 0 deterministic-first rendering: 'off' (default) never
    // computes the engine reply (byte-identical legacy path); 'shadow'
    // computes + reports it on the result for the runtime to witness but never
    // serves it; 'on' serves it exactly like the section-loop deterministic
    // line.
    directReplyMode = 'off',
  // Feminization v1 controller (certified P1-001): shadow-only by default.
  // The one-action ladder runs on the same evidence the target-metric bridge
  // produced and is exposed on the RESULT for logging/eval — it never mutates
  // the CoachingSignal. Active serving is a later, explicitly gated wiring
  // step (the runtime must pass requireCueServeEvent: true at trial creation).
  femV1ControllerMode = 'shadow',
    // Target-metric v3 follows the same staged-rollout principle. `shadow`
    // computes a separate decision witness but does NOT mutate CoachingSignal;
    // `active` may apply only through the bridge's safety/schema/review gates.
    targetMetricMode = 'shadow',
    targetMotorMap = null,
    targetMetricObservations = null,
    targetMetricPersistence = {},
    targetMetricAllowUnreviewedCues = false,
  } = options;

  // Phase 1.3: pull the baseline snapshot for "vs baseline" deltas — shared helper
  // so this (buffered) path and the streaming path can't drift (see pickBaseline).
  const baseline = pickBaseline(learnerContext);

  // Step 1: Build the deterministic signal
  const signal = buildSignal({
    voiceState,
    learnerContext,
    lessonState,
    userMessage,
    practiceMode,
    targetPreset,
    scenarioPolicy,
    baseline,
    sessionScope,
    repContext,
    cardTokens,
  });

  // Step 1a (2026-08-16): the next-generation target-metric witness. Shadow is
  // deliberately side-effect free: the renderer sees the exact legacy signal,
  // while callers can log/compare the separate deterministic decision. Only an
  // explicit active mode reaches applyTargetMetricDecision, whose own gates
  // preserve existing safety/capture authority and block unreviewed cues.
  const targetMetricRuntime = evaluateTargetMetricRuntime({
  voiceState,
  signal,
  repContext,
  mode: targetMetricMode,
  motorMap: targetMotorMap,
  observations: targetMetricObservations,
  persistenceByDimension: targetMetricPersistence,
  allowUnreviewedCues: targetMetricAllowUnreviewedCues,
  sectionLoopActive: Boolean(
    sectionLoop === undefined ? voiceState?.sectionLoop : sectionLoop,
  ),
});
const targetMetricBridge = targetMetricRuntime.bridge;
const targetMetricShadowWitness = targetMetricRuntime.witness;

  // Step 1a-2 (2026-08-17): the certified feminization-v1 controller witness.
  // Safety/capture map from the SAME signal the legacy pipeline built, so the
  // witness states what the authoritative controller WOULD do this turn under
  // identical evidence. Unknown stays unknown (nulls pass through); no cue
  // resolver is wired yet, so serve decisions correctly fail closed to
  // end_block until reviewed cues are wired at the seam.
  const femV1SelfReport = voiceState?.lastAttemptArtifact?.selfReport
    || voiceState?.selfReport
    || {};
  // Complete stop/flag mapping: every IMMEDIATE_STOP_FIELDS and
  // REDUCE_DIFFICULTY_FLAG_FIELDS entry the controller knows is forwarded
  // (whitelisted over the controller's own exported lists so a new safety
  // field added there is wired here by construction, never silently dropped).
  const femV1SafetyState = {
    effort: femV1SelfReport.effort ?? null,
    discomfort: femV1SelfReport.discomfort ?? null,
    fatigue: femV1SelfReport.fatigue ?? null,
    strain: femV1SelfReport.strain ?? null,
  };
  for (const field of IMMEDIATE_STOP_FIELDS) {
    femV1SafetyState[field] = femV1SelfReport[field] === true;
  }
  for (const field of REDUCE_DIFFICULTY_FLAG_FIELDS) {
    femV1SafetyState[field] = femV1SelfReport[field] === true;
  }
  const femV1ControllerTurn = femV1ControllerMode === 'off' ? null : resolveFeminizationV1Turn({
    safetyState: femV1SafetyState,
    captureState: {
      // Convention: a conversational turn with no take claimed reads
      // usable=true from signal-builder defaults (no take was attempted, so
      // nothing failed); the controller still lands on collect_calibration
      // without take evidence — pinned by the wiring tests.
      usable: signal?.takeQuality?.usable === true,
      reasons: signal?.capture?.reliability && signal.capture.reliability !== 'good'
        ? [`capture_${signal.capture.reliability}`]
        : [],
    },
    curriculumState: {},
    masteryState: voiceState?.beginnerMastery || null,
    observations: Array.isArray(targetMetricBridge?.observations)
      ? targetMetricBridge.observations
      : [],
    pendingTrial: null,
    sessionContext: { stage: targetMetricRuntime?.stage || 'phrase' },
    mode: femV1ControllerMode === 'active' ? 'active' : 'shadow',
  });

  if (telemetry && typeof telemetry.mark === 'function') {
    telemetry.mark('coaching_signal_done_at', { source: 'gateway' });
  }

  // Step 1b (2026-07-26 phase C): the sentence-teardown isolation loop.
  //
  // Ordering is load-bearing. It runs AFTER buildSignal because every input it reads
  // (takeSections.worst, targetFit, takeQuality, policy, takeKind) is produced there,
  // and BEFORE buildRendererMessages because an entry or a reassembly has to reach the
  // model as a signal line. The verdict is returned to the caller, which owns the
  // voiceState write and the card swap — this function stays free of session
  // side-effects.
  const sectionLoopResult = resolveSectionLoopTurn({
    sectionLoop: sectionLoop === undefined ? (voiceState?.sectionLoop || null) : sectionLoop,
    lastTakeKey: sectionLoopLastTakeKey === undefined
      ? (voiceState?.sectionLoopLastTakeKey || null)
      : sectionLoopLastTakeKey,
    signal,
    takeKey: resolveTakeKey(voiceState),
    // The TAKE's transcript, NOT signal.userUtterance (which is this coach turn's
    // message and is a fixed engine string on the post-take route).
    takeTranscript: resolveTakeTranscript(voiceState),
    phrase: cardPhrase || signal?.practiceLine || '',
    now,
    stripOwned,
  });
  if (sectionLoopResult.signalPatch) {
    // Additive top-level block, same convention as phase B's takeSections: attached
    // after buildCoachingSignal, which only carries schema fields.
    signal.sectionLoop = sectionLoopResult.signalPatch;
  }
  if (sectionLoopResult.witness && signal.decisionWitness) {
    signal.decisionWitness.sectionLoop = sectionLoopResult.witness;
  }

  // Step 2: Build the renderer prompt
  const rendererOptions = audioBase64 ? { audioBase64, audioFormat: audioFormat || 'wav' } : {};
  const messages = buildRendererMessages(signal, conversationHistory, rendererOptions);
  const promptTokens = estimateRendererPromptTokens(signal, conversationHistory, rendererOptions);

  // Step 3: Call the model (or use fallback). Payload honesty (2026-07-18):
  // whenever the reply is a DETERMINISTIC fallback rather than the model's own
  // words, the turn is flagged (`fallbackReply: true`) so the session payload
  // never presents canned text as live coaching.
  let rawReply;
  let fallbackReply = false;
  let fallbackReason = null;
  // 2026-07-26 phase C — THE LATENCY LAW. A retry inside an isolation, and the warm
  // exit at the cap, are ENGINE-AUTHORED: the learner has just spoken two words and
  // is waiting to speak them again, so the turn must not pay for a model round-trip.
  // The reply still crosses sanitizeCoachReply below like any other, so the product
  // laws bind it exactly as they bind model output.
  //
  // This is NOT a fallback: `fallbackReply` stays false, because the line is the
  // designed output of the loop, not a substitute for a coach that failed to answer.
  //
  // 2026-07-28 Phase 0 deterministic-first rendering (SHADOW): the direct-reply
  // composer covers the structured intents. 'off' = never computed (the legacy
  // path is byte-identical); 'shadow' = computed and reported on the result
  // (directReplyShadow) for the runtime to log side-by-side, but NEVER served —
  // the model still answers; 'on' = served exactly like the deterministicReply
  // branch (later phases). A section-loop deterministicReply always wins; the
  // composer is not asked at all on those turns (Phase 3 territory).
  const directReplyWitness = {};
  const engineReply = sectionLoopResult.deterministicReply
    || (directReplyMode !== 'off'
      ? buildDirectReply(signal, { conversationHistory, witness: directReplyWitness })
      : null);
  const composerProduced = Boolean(engineReply) && !sectionLoopResult.deterministicReply
    && Boolean(directReplyWitness.templateId);
  const directReplyServed = composerProduced && directReplyMode === 'on';
  const directReplyShadow = composerProduced && directReplyMode === 'shadow'
    ? {
      composer_id: directReplyWitness.composerId,
      intent: directReplyWitness.intent,
      template_id: directReplyWitness.templateId,
      text: engineReply,
      practice_line_present: Boolean(signal.practiceLine),
      would_have_served: true,
    }
    : null;
  if (sectionLoopResult.deterministicReply || directReplyServed) {
    rawReply = engineReply;
  } else if (callModel) {
    if (telemetry && typeof telemetry.mark === 'function') {
      telemetry.mark('llm_request_at', { source: 'gateway' });
    }
    try {
      rawReply = await callModel(messages, {
        maxTokens: REALTIME_RENDERER_MAX_TOKENS,
        // 0.20 = quality-optimal band (prior 47-learner sweep: suitable 0.723, tone good,
        // just under the >=0.30 obedience cliff). Cross-direction technique cues the model
        // still emits at this temp are stripped by sanitizeCoachReply (Step 6.5) plus the
        // system-prompt DIRECTION CONSTRAINT, so direction-safety no longer depends on temp.
        // (Was briefly 0 on a thin single-scenario sweep; reverted after the gate's larynx/
        // throat blind spot was fixed and the live direction filter landed.)
        temperature: 0.2,
      });
    } catch (err) {
      // Model call failed (offline, timeout, etc.) — use deterministic fallback
      rawReply = buildFallbackReply(signal);
      fallbackReply = true;
      fallbackReason = 'model_error';
    } finally {
      if (telemetry && typeof telemetry.mark === 'function') {
        telemetry.mark('llm_done_at', { source: 'gateway' });
      }
    }
    // A thinking model that exhausts max_tokens mid-reasoning returns HTTP 200
    // with EMPTY content (no throw) — fall back instead of shipping an empty
    // coach bubble. buildFallbackReply can itself be '' in conversation mode,
    // so keep a non-empty final default. Runs UNCONDITIONALLY (also after a
    // model_error whose deterministic fallback was '' in converse mode); the
    // first cause wins the recorded reason.
    if (!rawReply || !String(rawReply).trim()) {
      // 2026-07-19: reworded — the old default said "one more line", which is
      // exactly the "one more" pressure form the per-rep reaction law bans.
      rawReply = buildFallbackReply(signal)
        || 'Let’s keep it easy — say a sentence whenever you like, and I’ll listen.';
      fallbackReply = true;
      if (!fallbackReason) fallbackReason = 'empty_content';
    }
  } else {
    // Deterministic fallback when model is unavailable
    rawReply = buildFallbackReply(signal);
    fallbackReply = true;
    fallbackReason = 'no_model';
  }

  if (fallbackReply && telemetry && typeof telemetry.setFallback === 'function') {
    telemetry.setFallback(fallbackReason, { source: 'gateway' });
  }

  // Step 4: Sanitize
  const sanitizedReply = sanitizeCoachReply(rawReply, signal);
  if (telemetry && typeof telemetry.mark === 'function') {
    telemetry.mark('sanitizer_done_at', { source: 'gateway' });
  }

  return {
    signal,
    rawReply,
    sanitizedReply,
    promptTokens,
    messages,
    fallbackReply,
    fallbackReason,
    // 2026-07-28 Phase 0: the SHADOW witness record ({composer_id, intent,
    // template_id, text, practice_line_present, would_have_served}) when the
    // composer produced a reply in 'shadow' mode, else null. The runtime logs
    // it as coach_direct_reply_shadow; coaching/index.js owns no logger.
    directReplyShadow,
    // 2026-08-16 target-metric witness. In shadow mode this is separate from
    // CoachingSignal so the renderer and learner-facing path remain unchanged.
    targetMetricBridge,
    // Privacy-bounded deterministic witness for runtime/eval logging. Never
    // contains transcript, raw observations, audio or cue prose.
    targetMetricShadowWitness,
    // 2026-08-17: the certified fem-v1 controller turn (shadow decision
    // witness; null when femV1ControllerMode is 'off'). Never mutates signal.
    femV1ControllerTurn,
    // Shadow beginner card (wiring increment): what the beginner surface would
    // say this turn under the certified contract. Evidence only — never
    // served, never on the signal. Null when the controller is off.
    femV1BeginnerCard: femV1ControllerMode === 'off'
      ? null
      : buildFemV1ShadowCard(femV1ControllerTurn),
    // 2026-07-26 phase C: the loop verdict. The CALLER owns the consequences —
    // persisting sectionLoop/sectionLoopLastTakeKey onto the session voice state,
    // swapping or restoring the practice card, and emitting the transition witness.
    sectionLoop: sectionLoopResult,
    // NOTE: an `engineAuthoredReply` boolean lived here and was removed — nothing
    // consumed it. "This line came from the cue table" is already recorded, with the
    // cue's id, on the `coach_section_loop` witness the runtime emits, and
    // `sectionLoop.deterministicReply` carries the same fact for any caller that
    // wants it. A second derived flag with no reader is decoration, not telemetry.
  };
}

// ---------------------------------------------------------------------------
// Deterministic per-take fallback templates (2026-07-19 zero-friction wave).
//
// PER-REP COMPLETE REACTIONS: every post-take fallback is complete in itself —
// one grounded observation/cue. Session lifetime belongs only to the learner's
// Start/Stop button, so the coach never offers or recommends an ending.
// The renderer prompt carries the same rule for the live model; these templates
// are the model-free mirror of it (tested for time/prop/plan words).
// ---------------------------------------------------------------------------

const QUIET_SCOPE_FALLBACK = 'Quiet works. Humming and listening carry the same practice.';
const SILENT_SCOPE_FALLBACK = "Just listening is a real session. I'll play; you judge by ear.";
// 2026-07-26: was 'Keep it easy, bright, and forward. One thing at a time.' —
// three states and no action, and 'bright/forward' is feminine-lane wording
// applied to every direction. Then 'Open the first word on a clean, focused
// tone' — an action, but with no body part in it. Now one ARTICULATOR action
// with a location in the line, still direction-neutral.
const NEUTRAL_TAKE_FALLBACK = 'Open the first word with a loose jaw and easy lips, and keep that same shape for the rest of the sentence.';

/**
 * The post-take coach-path fallback: grounded cue (from the deterministic
 * coachMove). Exported for the template-law tests.
 */
function buildPerTakeFallback(signal) {
  const cue = signal?.coachMove?.cue ? String(signal.coachMove.cue).trim() : '';
  const body = cue || NEUTRAL_TAKE_FALLBACK;
  return /[.!?]$/.test(body) ? body : `${body}.`;
}

/**
 * Build a deterministic fallback reply when the model is unavailable.
 */
function buildFallbackReply(signal) {
  if (signal.policy.safetyState === 'stop' || signal.policy.safetyState === 'fatigue_or_strain') {
    return 'Switch to a very gentle hum or lip trill. Keep it easy and unforced.';
  }
  if (signal.capture.reliability === 'low' || signal.capture.reliability === 'unusable') {
    return 'Let\'s get a cleaner recording — move a little closer to the mic and speak clearly.';
  }
  // Session scope register (2026-07-19): a silent session never gets a spoken
  // drill cue; a quiet session with no cue gets the quiet acknowledgment.
  const tier = signal.sessionScope?.tier || null;
  if (tier === 'silent') {
    return SILENT_SCOPE_FALLBACK;
  }
  if (!signal.policy.shouldCorrect) {
    return '';
  }
  if (tier === 'quiet' && !signal.coachMove.cue) {
    return QUIET_SCOPE_FALLBACK;
  }
  // Per-rep complete reaction: grounded cue + open-door closure.
  return buildPerTakeFallback(signal);
}

/**
 * Learner-facing trial creation seam (checkpoint minor M1): ALWAYS requires
 * cue-serve evidence — no barrel caller can create a credit-bearing trial
 * without a served+acknowledged cue, even by explicitly passing
 * requireCueServeEvent:false. Research/legacy callers use the raw
 * createPendingMotorTrial with its documented wiring-pending default.
 */
// Beginner-language focus labels for the shadow card (plan 14.2 register).
// Internal dimension names must never reach the learner — the card builder's
// jargon audit drops any label that slips past this table.
const FOCUS_LABELS = Object.freeze({
  'pitch.register': 'Comfortable pitch',
  'pitch.lower_edge': 'Settled low notes',
  'resonance.global_scale': 'Brighter vowel sound',
  'resonance.frontness_proxy': 'Vowel brightness',
  'prosody.pitch_variability': 'Phrase melody',
  'prosody.phrase_ending': 'Phrase endings',
  'transfer.retention': 'Keeping the new sound',
});

// Controller action -> beginner feedback state for the shadow card. The card
// is EVIDENCE, not serving: it shows what the beginner surface would say this
// turn. No TRY steps can exist until cues are approved (owner gate) — the
// certified card contract already renders that case honestly.
const ACTION_FEEDBACK_STATES = Object.freeze({
  stop_for_safety: 'safety_stop',
  repair_capture: 'could_not_measure',
  reduce_difficulty: 'ease_reset',
  collect_calibration: 'ready_for_instruction',
  teach_awareness: 'ready_for_instruction',
  serve_exercise: 'ready_for_instruction',
  verify_attempt: 'checking_result',
  advance_phase: 'next_step_ready',
  end_block: 'no_actionable_correction',
});

/**
 * Compose the CERTIFIED beginner-feedback copy for actions whose card state
 * has no bespoke builder default (review cycle-1 MAJOR): repair_capture must
 * speak the neutral repair message, not the "sounded very similar" fallback
 * that asserts a measurement comparison which never happened. The three
 * ready_for_instruction states keep message:null so the card builder's
 * phase-aware defaults speak (calibration vs ready copy).
 */
function feedbackForAction(controllerTurn) {
  switch (controllerTurn.action) {
    case 'stop_for_safety':
      // R1-005: typed safety reason flows to reason-specific copy.
      return beginnerFeedback({ safety: { state: 'stop', reason: controllerTurn.safetyReason } });
    case 'repair_capture':
      return beginnerFeedback({
        measurementUsable: false,
        measurementReasons: Array.isArray(controllerTurn.captureReasons)
          ? controllerTurn.captureReasons
          : [],
      });
    case 'reduce_difficulty':
      return beginnerFeedback({ safety: { state: 'reset' } });
    case 'verify_attempt':
      // R1-005 (GPT-Pro §6): a pending-trial resolution is NOT an acoustic
      // outcome — the shadow card must say "checking", never claim movement.
      return beginnerFeedback({ controllerAction: 'verify_attempt' });
    case 'advance_phase':
      // R1-005: phase advancement is progression, not this-attempt
      // verification — never render as worked_verified.
      return beginnerFeedback({ controllerAction: 'advance_phase' });
    case 'end_block':
      return beginnerFeedback({ decision: { status: 'no_reliable_gap' } });
    default:
      return null; // ready_for_instruction states: builder defaults speak
  }
}

/**
 * Build the SHADOW beginner card from the controller turn (wiring increment).
 * Returns null when the controller is off or the turn is malformed — the
 * card is evidence only, never served, and never mutates the signal.
 */
function buildFemV1ShadowCard(controllerTurn) {
  if (!controllerTurn || typeof controllerTurn !== 'object') return null;
  const state = ACTION_FEEDBACK_STATES[controllerTurn.action] || null;
  if (!state) return null;
  const feedback = feedbackForAction(controllerTurn);
  return buildBeginnerSessionCard({
    phase: controllerTurn.phase,
    feedback: feedback || {
      schema: 'transvoice.beginner_feedback.v1',
      state,
      tone: state === 'safety_stop' ? 'stop' : 'neutral',
      message: null,
      nextAction: null,
    },
    focusLabel: controllerTurn.focus ? (FOCUS_LABELS[controllerTurn.focus.dimension] || null) : null,
    trySteps: [],
    hasApprovedDemo: false,
  });
}

function createLearnerFacingTrial(options = {}) {
  return createPendingMotorTrial({
    ...options,
    requireCueServeEvent: true,
  });
}

module.exports = {
  // Schema
  buildCoachingSignal,
  isValidCoachingSignal,
  COACHING_SIGNAL_SCHEMA,

  // Pipeline
  buildSignal,
  coachingTurn,
  buildFallbackReply,
  buildPerTakeFallback,
  buildDirectReply,
  QUIET_SCOPE_FALLBACK,
  SILENT_SCOPE_FALLBACK,

  // Components
  assessSafetyState,
  assessCaptureReliability,
  collectAnalyzerSafetyReasons,
  resolvePolicy,
  normalizePracticeMode,
  isCasualConversation,
  isRequestingCorrection,
  detectIssues,
  detectRecentWin,
  sanitizeCoachReply,
  buildRendererSystemPrompt,
  buildRendererUserMessage,
  buildRendererMessages,
  estimateRendererPromptTokens,
  buildTargetMetricBridge,
  applyTargetMetricDecision,
  resolveTargetMetricStage,
  REALTIME_RENDERER_MAX_TOKENS,

  // Feminization v1 deterministic surface (certified P1-001/P1-002 + P2
  // slice, review cycles through 2026-08-17). The runtime wiring seam: the
  // gateway consumes ONLY this barrel. Trial creation at the seam MUST pass
  // requireCueServeEvent: true (wiring gate recorded in FEMINIZATION_V1_STATUS.md).
  resolveFeminizationV1Turn,
  FEMINIZATION_V1_CONTROLLER_SCHEMA,
  eligibleObservationsForPhase,
  isMetricEligibleForPhase,
  buildPitchCalibrationEvidence,
  resolvePitchStepPolicy,
  defaultPitchStepPolicyConfig,
  recordCueServed,
  acknowledgeCueServe,
  cueServeEligibility,
  nextFeedbackMode,
  masteryReviewState,
  defaultFeedbackPolicy,
  createPendingMotorTrial,
  createLearnerFacingTrial,
  settlePendingMotorTrial,
  evaluateFemV1Replay,
};
