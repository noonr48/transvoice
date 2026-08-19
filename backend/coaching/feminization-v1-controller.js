'use strict';

const {
  FEMINIZATION_V1_DOMAIN,
} = require('./feminization-v1-policy');
const { eligibleObservationsForPhase } = require('./metric-eligibility');
const { PHASE_ORDER } = require('./beginner-mastery');
const {
  REDUCE_DIFFICULTY_THRESHOLD,
  parseFivePoint,
} = require('./voice-self-report');

const FEMINIZATION_V1_CONTROLLER_SCHEMA = 'transvoice.feminization_v1_controller.v1';

// Named, reviewable v1 difficulty policy (not a hidden engineering step).
// R1-001: the threshold now comes from the canonical five-point self-report
// contract (voice-self-report.js) — 4+ on the 1-5 scale escalates. The old
// local constant (6 on an invented 0-10 scale) is retired; a typed 1-5
// effort can actually reach this rung now.
const REDUCE_DIFFICULTY_SELF_REPORT_LEVEL = REDUCE_DIFFICULTY_THRESHOLD;

// A cue may only be SERVED to a learner with one of these review states.
// `clinical-review-required` (the default for every library cue) is excluded.
const SERVABLE_CUE_REVIEW_STATUSES = Object.freeze(['approved_internal', 'approved_limited_active']);

// MASTER_PLAN §7.3 immediate-stop self-report set: pain, throat pain, sudden
// voice loss, severe breathlessness/dizziness, explicit stop request, or a
// known clinician-restriction conflict. Any of these stops training outright.
const IMMEDIATE_STOP_FIELDS = Object.freeze([
  'pain',
  'throatPain',
  'explicitStop',
  'voiceLoss',
  'suddenVoiceLoss',
  'severeBreathlessness',
  'severeDizziness',
  'restrictionConflict',
  // Recent laryngeal surgery is a clinician-restriction conflict until cleared:
  // training must not proceed on self-report alone (plan 7.2/7.3).
  'recentLaryngealSurgery',
]);

// Plan 7.2 intake fields that TIER to difficulty reduction rather than a full
// stop: new/increased hoarseness, frequent cough/throat clearing, sudden loss
// of range, and acute respiratory illness make the next turn easier — never a
// harder chase of the acoustic target.
const REDUCE_DIFFICULTY_FLAG_FIELDS = Object.freeze([
  'newOrIncreasedHoarseness',
  'frequentCoughOrThroatClearing',
  'suddenLossOfRange',
  'acuteRespiratoryIllness',
  // Plan 7.2 non-severe variants: breathlessness/dizziness below the severe
  // immediate-stop line still reduce difficulty — never ignored.
  'breathlessness',
  'dizziness',
]);

// §20 required test matrix: in the feminisation pitch foundation phase a
// downward corrective cue must not be served merely because a long-range
// reference sits lower than the learner's note. Phase-scoped direction
// allowlist; absent entry means the phase imposes no direction constraint.
const PHASE_DIRECTION_CONSTRAINTS = Object.freeze({
  pitch_foundation: Object.freeze({
    'pitch.register': Object.freeze(['below']),
  }),
});

const MODES = Object.freeze(['active', 'shadow']);

const BEGINNER_ENTRY_PHASE = 'calibration';

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function normalizeMode(mode) {
  // Fail closed to shadow: an unknown mode never grants active authority.
  return MODES.includes(mode) ? mode : 'shadow';
}

// The learner-facing controller fails CLOSED to the curriculum entrance: an
// unknown or missing phase never lands mid-curriculum. (The shadow runtime's
// `pitch_foundation` default is an evaluation-only convention and is
// deliberately not reused here.)
function resolveBeginnerPhase(value) {
  const phase = typeof value === 'string' ? value.trim() : '';
  return PHASE_ORDER.includes(phase) ? phase : BEGINNER_ENTRY_PHASE;
}

// R1-005: stable typed-reason vocabulary (snake_case wire format), mapped
// from the internal camelCase stop fields — learner-facing copy keys on these.
const SAFETY_REASON_BY_FIELD = Object.freeze({
  pain: 'pain',
  throatPain: 'throat_pain',
  explicitStop: 'explicit_stop',
  voiceLoss: 'voice_loss',
  suddenVoiceLoss: 'sudden_voice_loss',
  severeBreathlessness: 'severe_breathlessness',
  severeDizziness: 'severe_dizziness',
  restrictionConflict: 'restriction_conflict',
  recentLaryngealSurgery: 'recent_laryngeal_surgery',
});

function safetyStopReason(safetyState = {}) {
  // R1-005: return WHICH stop trigger fired (typed), not just that one did —
  // the learner-facing copy must distinguish breathlessness from pain.
  const field = IMMEDIATE_STOP_FIELDS.find((f) => safetyState[f] === true) || null;
  return field ? SAFETY_REASON_BY_FIELD[field] : null;
}

function safetyStopRequested(safetyState = {}) {
  return safetyStopReason(safetyState) != null;
}

function selfReportEscalation(safetyState = {}) {
  // R1-001: strict five-point parsing at the controller boundary too —
  // coercion shapes and out-of-range values are MISSING evidence (never
  // low effort), so they cannot silently pass the escalation check.
  const levels = ['effort', 'discomfort', 'strain', 'fatigue']
    .map((field) => parseFivePoint(safetyState[field]))
    .filter((value) => value != null);
  if (!levels.length) return null;
  return Math.max(...levels);
}

function selfReportReduceFlag(safetyState = {}) {
  return REDUCE_DIFFICULTY_FLAG_FIELDS.find((field) => safetyState[field] === true) || null;
}

function cueIsServable(cue, { dimension, direction, stage }) {
  if (!cue || typeof cue !== 'object') return false;
  if (!SERVABLE_CUE_REVIEW_STATUSES.includes(cue.reviewStatus)) return false;
  if (!Array.isArray(cue.dimensionPatterns) || !cue.dimensionPatterns.includes(dimension)) return false;
  if (!Array.isArray(cue.directions) || !cue.directions.includes(direction)) return false;
  if (!Array.isArray(cue.stages) || !cue.stages.includes(stage)) return false;
  return true;
}

function directionForObservation(observation) {
  const value = finiteOrNull(observation?.value);
  const low = finiteOrNull(observation?.target?.low);
  const high = finiteOrNull(observation?.target?.high);
  if (value == null) return null;
  if (low != null && value < low) return 'below';
  if (high != null && value > high) return 'above';
  return null;
}

/**
 * Deterministic priority order over eligible observations for one phase:
 * importance, then controllability, then original order. Ties stay stable,
 * so identical evidence always yields an identical focus.
 */
function rankEligibleObservations(eligible) {
  return [...eligible]
    .map((observation, index) => ({ observation, index }))
    .sort((a, b) => {
      const importanceDelta = (finiteOrNull(b.observation.importance) || 0)
        - (finiteOrNull(a.observation.importance) || 0);
      if (importanceDelta !== 0) return importanceDelta;
      const controllabilityDelta = (finiteOrNull(b.observation.controllability) || 0)
        - (finiteOrNull(a.observation.controllability) || 0);
      if (controllabilityDelta !== 0) return controllabilityDelta;
      return a.index - b.index;
    })
    .map((entry) => entry.observation);
}

function nextSequentialPhase(phase) {
  const index = PHASE_ORDER.indexOf(phase);
  if (index === -1 || index + 1 >= PHASE_ORDER.length) return null;
  return PHASE_ORDER[index + 1];
}

/**
 * The authoritative beginner turn boundary for Feminization Foundations v1.
 *
 * Exactly one action is returned per turn, in fixed precedence order:
 * safety stop > capture repair > difficulty reduction (escalated self-report
 * cost or plan-7.2 reduce-tier flags) > pending-trial verification >
 * authorized phase advance > early-phase handling (calibration/awareness) >
 * eligible-observation ranking > reviewed-cue serve.
 *
 * The generic target-metric engine is subordinate: it only ever sees
 * observations that survived hard metric eligibility for the CURRENT phase.
 * Shadow mode computes the same decision but requests no trial and serves
 * nothing, so a shadow cue can never receive causal credit.
 */
function resolveFeminizationV1Turn({
  safetyState = {},
  captureState = {},
  curriculumState = {},
  masteryState = null,
  // goalProfile/capabilityProfile/motorResponseMap/goalCueOverlay are
  // reserved by the master-plan 4.2 controller contract. They are
  // deliberately unread until the P2 reachable-target policy and the P5
  // motor split wire them; passing them earlier must not change v1 decisions.
  goalProfile = null,
  capabilityProfile = null,
  observations = [],
  motorResponseMap = null,
  goalCueOverlay = null,
  pendingTrial = null,
  sessionContext = {},
  mode = 'shadow',
  cueResolver = () => null,
} = {}) {
  safetyState = safetyState || {};
  captureState = captureState || {};
  curriculumState = curriculumState || {};
  sessionContext = sessionContext || {};
  observations = Array.isArray(observations) ? observations : [];
  const resolvedMode = normalizeMode(mode);
  const phase = resolveBeginnerPhase(
    curriculumState.phase
    || (masteryState && typeof masteryState === 'object' ? masteryState.curriculumPhase : null),
  );
  const stage = textOrNull(sessionContext.stage) || 'phrase';
  const base = {
    schema: FEMINIZATION_V1_CONTROLLER_SCHEMA,
    domain: FEMINIZATION_V1_DOMAIN,
    mode: resolvedMode,
    phase,
    stage,
  };

  // 1. Pain stops training. Nothing outranks an explicit safety stop.
  //    R1-005: the stop carries the TYPED trigger (safetyReason) so
  //    learner-facing copy can speak the actual reason.
  const typedStopReason = safetyStopReason(safetyState);
  if (typedStopReason) {
    return {
      ...base,
      action: 'stop_for_safety',
      reason: 'safety_stop_requested',
      safetyReason: typedStopReason,
    };
  }

  // 2. Capture validity precedes correction: capture failure is never the
  // learner's failure and never a coaching moment.
  if (captureState.usable !== true) {
    return {
      ...base,
      action: 'repair_capture',
      reason: 'capture_not_usable',
      captureReasons: [...(Array.isArray(captureState.reasons) ? captureState.reasons : [])],
    };
  }

  // 3. Escalating self-reported cost reduces difficulty instead of chasing
  // the acoustic target. Numeric escalation and plan-7.2 reduce-tier flags
  // share this rung; the reason names which fired.
  const escalation = selfReportEscalation(safetyState);
  if (escalation != null && escalation >= REDUCE_DIFFICULTY_SELF_REPORT_LEVEL) {
    return { ...base, action: 'reduce_difficulty', reason: 'self_report_cost_escalated', escalation };
  }
  const reduceFlag = selfReportReduceFlag(safetyState);
  if (reduceFlag) {
    return { ...base, action: 'reduce_difficulty', reason: reduceFlag };
  }

  // 4. An outstanding exact-next trial is resolved before any new cue may be
  // served (exact-next causality). An unrecognized trial object with pending
  // status still blocks serving — fail closed, never fail open.
  if (pendingTrial && typeof pendingTrial === 'object' && pendingTrial.status === 'pending') {
    return {
      ...base,
      action: 'verify_attempt',
      reason: pendingTrial.schema === 'transvoice.pending_motor_trial.v1'
        ? 'pending_trial_open'
        : 'pending_trial_open_schema_unverified',
      pendingTrial,
    };
  }

  // 5. Phase advancement requires explicit external policy authorization with
  // evidence; the controller never advances on attempt counts alone. This
  // check precedes the early-phase returns so calibration and awareness can
  // legitimately advance (sequentially) when a named policy authorizes it.
  if (curriculumState.advancementAuthorized === true) {
    const nextPhase = nextSequentialPhase(phase);
    if (nextPhase) {
      return {
        ...base,
        action: 'advance_phase',
        reason: 'phase_advancement_authorized',
        nextPhase,
      };
    }
  }

  // 6. Early phases never correct: calibration collects, awareness teaches.
  if (phase === 'calibration') {
    return { ...base, action: 'collect_calibration', reason: 'calibration_phase' };
  }
  if (phase === 'awareness') {
    return { ...base, action: 'teach_awareness', reason: 'awareness_phase' };
  }

  // 7. Hard metric eligibility gates everything the ranking can see.
  const eligibility = eligibleObservationsForPhase(observations, { phase });
  if (!eligibility.eligible.length) {
    return {
      ...base,
      action: 'end_block',
      reason: 'no_eligible_observation_for_phase',
      eligibility,
    };
  }

  // 8. Deterministic ranking over eligible observations only. Observations
  // already inside their target region have no corrective direction.
  const ranked = rankEligibleObservations(eligibility.eligible);
  for (const candidate of ranked) {
    const direction = directionForObservation(candidate);
    if (!direction) continue;
    // Phase-scoped direction law (e.g. pitch foundation never corrects
    // downward): a disallowed direction is skipped, never served.
    const allowedDirections = PHASE_DIRECTION_CONSTRAINTS[phase]
      && Object.prototype.hasOwnProperty.call(PHASE_DIRECTION_CONSTRAINTS[phase], candidate.dimension)
      ? PHASE_DIRECTION_CONSTRAINTS[phase][candidate.dimension]
      : null;
    if (allowedDirections && !allowedDirections.includes(direction)) continue;
    const cue = cueResolver(candidate.dimension, direction, stage);
    if (!cueIsServable(cue, { dimension: candidate.dimension, direction, stage })) {
      // No approved cue for this dimension+direction: fail closed. We do not
      // silently fall through to a different, unapproved skill.
      return {
        ...base,
        action: 'end_block',
        reason: 'no_approved_cue_available',
        focus: { dimension: candidate.dimension, direction },
        eligibility,
      };
    }
    // Shadow turns carry no servable cue payload: a caller dispatching on the
    // returned action must not be able to serve in shadow. The cue identity
    // remains for evaluation; the instruction does not.
    const cuePayload = resolvedMode === 'active'
      ? {
        cueId: cue.cueId || null,
        reviewStatus: cue.reviewStatus,
        instruction: cue.instruction || null,
        protectedMetrics: [...(cue.protectedMetrics || [])],
      }
      : {
        cueId: cue.cueId || null,
        reviewStatus: cue.reviewStatus,
      };
    return {
      ...base,
      action: 'serve_exercise',
      reason: null,
      focus: {
        dimension: candidate.dimension,
        direction,
        metricId: candidate.metricId || null,
      },
      cue: cuePayload,
      // Only active mode may actually serve: a shadow decision requests no
      // trial and is never learner-visible, so it can earn no causal credit.
      served: resolvedMode === 'active',
      trialRequested: resolvedMode === 'active',
      eligibility,
    };
  }

  return {
    ...base,
    action: 'end_block',
    reason: 'no_reliable_gap_in_eligible_observations',
    eligibility,
  };
}

module.exports = {
  BEGINNER_ENTRY_PHASE,
  FEMINIZATION_V1_CONTROLLER_SCHEMA,
  IMMEDIATE_STOP_FIELDS,
  MODES,
  PHASE_DIRECTION_CONSTRAINTS,
  SAFETY_REASON_BY_FIELD,
  rankEligibleObservations,
  REDUCE_DIFFICULTY_FLAG_FIELDS,
  REDUCE_DIFFICULTY_SELF_REPORT_LEVEL,
  SERVABLE_CUE_REVIEW_STATUSES,
  resolveFeminizationV1Turn,
};
