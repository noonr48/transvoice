'use strict';

const { resolveFeminizationV1Turn, IMMEDIATE_STOP_FIELDS, REDUCE_DIFFICULTY_FLAG_FIELDS } = require('./feminization-v1-controller');
const { normalizeSelfReport, parseFivePoint } = require('./voice-self-report');
const { settlePendingMotorTrial } = require('./motor-trial');

/**
 * TV-FEM-R2-001 — the shared FEM runtime orchestrator (GPT-Pro §3).
 *
 * One pure boundary used by BOTH the buffered and SSE coaching paths so they
 * can never develop separate coaching semantics:
 *
 *   normalize strict input contracts
 *   → record finalized attempt in the session sequence
 *   → settle/invalidate pending trial (exact-next)
 *   → resolve safety and capture state
 *   → run the authoritative controller
 *   → build the beginner card
 *   → emit a privacy-bounded witness
 *   → return a PROPOSED state delta (applied by the caller in active mode;
 *     never applied here)
 *
 * Shadow mode: computes the identical turn, writes nothing (empty delta),
 * retains the bounded witness for evaluation. Active mode: same computation;
 * the delta is a proposal — the CALLER owns atomic application.
 */

const FEM_V1_RUNTIME_SCHEMA = 'transvoice.fem_v1_runtime_turn.v1';
const MODES = Object.freeze(['active', 'shadow']);

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : 'shadow';
}

/**
 * Consume one finalized attempt into the session's attempt sequence.
 * Eligible attempts require no reason; ineligible attempts REQUIRE a
 * deterministic reason (the sequence module enforces this — we just delegate).
 */
function consumeFinalizedAttempt(sessionState, finalizedAttempt) {
  const disposition = {
    attemptArtifactId: typeof finalizedAttempt?.attemptArtifactId === 'string'
      ? finalizedAttempt.attemptArtifactId.slice(0, 160)
      : null,
    eligible: finalizedAttempt?.eligible === true,
    ineligibleReason: typeof finalizedAttempt?.ineligibleReason === 'string'
      ? finalizedAttempt.ineligibleReason.slice(0, 120)
      : null,
    ordinal: null,
  };
  const seq = sessionState?.attemptSequence;
  if (seq && typeof seq === 'object' && !Array.isArray(seq)
    && seq.schema === 'transvoice.session_attempt_sequence.v1' && disposition.attemptArtifactId) {
    const { recordFinalizedAttempt } = require('./session-attempt-sequence');
    const record = recordFinalizedAttempt(seq, {
      attemptArtifactId: disposition.attemptArtifactId,
      eligible: disposition.eligible,
      ineligibleReason: disposition.ineligibleReason,
    });
    disposition.ordinal = record.ordinal;
  }
  return disposition;
}

/**
 * Resolve the pending trial against the finalized attempt (exact-next).
 * Returns the settlement result or a not_applicable marker; null trial = null.
 */
function resolvePendingTrial(sessionState, finalizedAttempt, nowMs) {
  const trial = sessionState?.pendingTrial;
  if (!trial || typeof trial !== 'object' || trial.status !== 'pending') {
    return { status: 'not_applicable', result: 'no_pending_trial', trialId: null };
  }
  if (!finalizedAttempt?.eligible) {
    return {
      status: 'not_applicable',
      result: 'attempt_ineligible',
      trialId: trial.trialId || null,
    };
  }
  const settlement = settlePendingMotorTrial({
    trial,
    sessionId: sessionState?.sessionId,
    stage: sessionState?.stage,
    afterAttemptArtifactId: finalizedAttempt.attemptArtifactId,
    afterObservations: Array.isArray(finalizedAttempt.observations)
      ? finalizedAttempt.observations
      : [],
    selfReport: finalizedAttempt.selfReport || {},
    settledAt: nowMs,
    afterAttemptOrdinal: finalizedAttempt.ordinal ?? null,
    attemptSequence: sessionState?.attemptSequence || null,
  });
  return settlement;
}

/**
 * Build the privacy-bounded witness. NEVER contains: raw observations,
 * audio, transcripts, cue prose, formant tracks, or learner-identifying
 * free text — only bounded identifiers and decision summaries.
 */
function buildWitness({ mode, controllerTurn, settlement, disposition, phase, nowMs }) {
  return {
    schema: FEM_V1_RUNTIME_SCHEMA,
    mode,
    at: Number.isFinite(nowMs) ? nowMs : null,
    turn: {
      action: controllerTurn?.action || null,
      safetyReason: controllerTurn?.safetyReason || null,
      phase,
      focusDimension: controllerTurn?.focus?.dimension || null,
    },
    settlement: {
      status: settlement?.status || null,
      result: settlement?.result || null,
      trialId: settlement?.trialId || null,
    },
    finalizedAttempt: {
      ordinal: disposition?.ordinal || null,
      eligible: disposition?.eligible === true,
    },
    rejectionReasons: controllerTurn?.eligibility?.rejected
      ? controllerTurn.eligibility.rejected.slice(0, 8).map((r) => r.reason)
      : [],
  };
}

/**
 * The shared FEM runtime turn. Pure: no IO, no clock reads (now is injected),
 * no state application. The caller owns persistence and serving.
 */
function resolveFemV1RuntimeTurn({
  mode = 'shadow',
  learnerState = {},
  sessionState = {},
  finalizedAttempt = null,
  cueResolver = () => null,
  now = null,
} = {}) {
  const resolvedMode = normalizeMode(mode);
  const nowMs = Number.isFinite(now) ? now : null;

  // 1. Consume the finalized attempt into the sequence (ineligible attempts
  //    carry their deterministic reason — never silently skipped).
  const disposition = finalizedAttempt
    ? consumeFinalizedAttempt(sessionState, finalizedAttempt)
    : null;

  // 2. Safety short-circuit: a pain-carrying attempt settles nothing and
  //    stops the turn outright (settlement of a hurting take would credit
  //    a cue from pain — forbidden).
  const selfReport = finalizedAttempt?.selfReport
    ? normalizeSelfReport(finalizedAttempt.selfReport)
    : normalizeSelfReport({});

  // 3. Resolve the pending trial (exact-next) BEFORE the controller runs —
  //    but only when the attempt was eligible and no pain was reported.
  let settlement = { status: 'not_applicable', result: 'no_pending_trial', trialId: null };
  if (finalizedAttempt && !selfReport.pain && !selfReport.throatPain) {
    settlement = resolvePendingTrial(sessionState, finalizedAttempt, nowMs);
  } else if (sessionState?.pendingTrial && sessionState.pendingTrial.status === 'pending') {
    // Review cycle-1 follow-up: pain-skip on a REAL pending trial gets its
    // own label (not the misleading no_pending_trial default).
    settlement = { status: 'not_applicable', result: 'pain_skipped_settlement', trialId: String(sessionState.pendingTrial.trialId || '').slice(0, 120) || null };
  }

  // 4. Build the controller inputs from strict contracts.
  const captureState = finalizedAttempt?.captureEvidence
    && typeof finalizedAttempt.captureEvidence === 'object'
    ? {
      usable: finalizedAttempt.captureEvidence.usable === true,
      reasons: Array.isArray(finalizedAttempt.captureEvidence.reasons)
        ? finalizedAttempt.captureEvidence.reasons.slice(0, 8)
        : [],
    }
    : { usable: true, reasons: [] };

  const safetyState = {
    pain: selfReport.pain,
    throatPain: selfReport.throatPain,
    effort: selfReport.effort,
    strain: selfReport.strain,
    fatigue: selfReport.fatigue,
    discomfort: selfReport.discomfort,
  };
  // Review cycle-1 MAJOR fix: forward ALL stop/flag fields — whitelisted over
  // the controller's own exported lists (same pattern as coaching/index.js)
  // so adopting this orchestrator can never silently drop voiceLoss,
  // severeBreathlessness, hoarseness, etc.
  for (const field of IMMEDIATE_STOP_FIELDS) {
    safetyState[field] = finalizedAttempt?.selfReport?.[field] === true;
  }
  for (const field of REDUCE_DIFFICULTY_FLAG_FIELDS) {
    safetyState[field] = finalizedAttempt?.selfReport?.[field] === true;
  }

  // 5. The authoritative controller turn.
  const controllerTurn = resolveFeminizationV1Turn({
    safetyState,
    captureState,
    curriculumState: {
      phase: learnerState?.mastery?.curriculumPhase || 'calibration',
    },
    masteryState: learnerState?.mastery || null,
    goalProfile: learnerState?.goalProfile || null,
    capabilityProfile: learnerState?.capabilityProfile || null,
    observations: Array.isArray(finalizedAttempt?.observations)
      ? finalizedAttempt.observations
      : [],
    motorResponseMap: learnerState?.motorResponseMap || null,
    goalCueOverlay: learnerState?.goalCueOverlay || null,
    pendingTrial: sessionState?.pendingTrial || null,
    sessionContext: {
      sessionId: sessionState?.sessionId || null,
      stage: sessionState?.stage || 'phrase',
    },
    mode: resolvedMode,
    cueResolver,
  });

  // 6. Witness + proposed delta.
  const witness = buildWitness({
    mode: resolvedMode,
    controllerTurn,
    settlement,
    disposition,
    phase: controllerTurn?.phase || null,
    nowMs,
  });

  const proposedStateDelta = resolvedMode === 'shadow'
    ? {}
    : {
      // Proposals only — the caller applies atomically in active mode.
      ...(settlement?.status === 'settled' ? { settleTrial: settlement } : {}),
      ...(disposition?.ordinal != null ? { attemptOrdinal: disposition.ordinal } : {}),
    };

  return {
    schema: FEM_V1_RUNTIME_SCHEMA,
    mode: resolvedMode,
    action: controllerTurn?.action || null,
    safetyReason: controllerTurn?.safetyReason || null,
    settlement,
    controllerTurn,
    finalizedAttemptDisposition: disposition,
    witness,
    proposedStateDelta,
  };
}

module.exports = {
  FEM_V1_RUNTIME_SCHEMA,
  MODES,
  resolveFemV1RuntimeTurn,
};
