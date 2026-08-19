'use strict';

const { resolveFeminizationV1Turn, IMMEDIATE_STOP_FIELDS, REDUCE_DIFFICULTY_FLAG_FIELDS } = require('./feminization-v1-controller');
const { normalizeSelfReport } = require('./voice-self-report');
const { settlePendingMotorTrial } = require('./motor-trial');
const { recordFinalizedAttempt } = require('./session-attempt-sequence');

/**
 * Shared FEM v1 runtime boundary.
 *
 * This function is intentionally side-effect free. It may calculate the exact
 * state replacement an active caller would need, but it never mutates the
 * caller's learner/session objects. Shadow therefore means no learning-state
 * mutation in the strong sense, including attempt sequencing.
 */
const FEM_V1_RUNTIME_SCHEMA = 'transvoice.fem_v1_runtime_turn.v1';
const MODES = Object.freeze(['active', 'shadow']);
const ATTEMPT_SEQUENCE_SCHEMA = 'transvoice.session_attempt_sequence.v1';

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : 'shadow';
}

function cloneAttemptSequence(sequence) {
  if (!sequence || typeof sequence !== 'object' || Array.isArray(sequence)
    || sequence.schema !== ATTEMPT_SEQUENCE_SCHEMA
    || !Array.isArray(sequence.attempts)
    || !Number.isFinite(sequence.nextOrdinal)) return null;
  return {
    schema: sequence.schema,
    nextOrdinal: sequence.nextOrdinal,
    attempts: sequence.attempts.map((attempt) => ({ ...attempt })),
  };
}

/**
 * Consume a finalized attempt on a private sequence copy. Replaying the same
 * artifact ID is idempotent when its eligibility classification agrees; reuse
 * with conflicting semantics fails closed.
 */
function consumeFinalizedAttempt(sessionState, finalizedAttempt) {
  const disposition = {
    attemptArtifactId: typeof finalizedAttempt?.attemptArtifactId === 'string'
      ? finalizedAttempt.attemptArtifactId.trim().slice(0, 160)
      : null,
    eligible: finalizedAttempt?.eligible === true,
    ineligibleReason: typeof finalizedAttempt?.ineligibleReason === 'string'
      ? finalizedAttempt.ineligibleReason.trim().slice(0, 120)
      : null,
    ordinal: null,
    replayed: false,
  };

  const sequence = cloneAttemptSequence(sessionState?.attemptSequence);
  if (!sequence || !disposition.attemptArtifactId) {
    return { disposition, attemptSequence: sequence, sequenceChanged: false };
  }

  const existing = sequence.attempts.find(
    (row) => row?.attemptArtifactId === disposition.attemptArtifactId,
  );
  if (existing) {
    const sameClassification = existing.eligible === disposition.eligible
      && (existing.eligible === true
        || existing.ineligibleReason === disposition.ineligibleReason);
    if (!sameClassification) throw new Error('attempt_artifact_conflict');
    disposition.ordinal = existing.ordinal;
    disposition.replayed = true;
    return { disposition, attemptSequence: sequence, sequenceChanged: false };
  }

  const record = recordFinalizedAttempt(sequence, {
    attemptArtifactId: disposition.attemptArtifactId,
    eligible: disposition.eligible,
    ineligibleReason: disposition.ineligibleReason,
  });
  disposition.ordinal = record.ordinal;
  return { disposition, attemptSequence: sequence, sequenceChanged: true };
}

function resolvePendingTrial(sessionState, finalizedAttempt, canonicalOrdinal, attemptSequence, nowMs) {
  const trial = sessionState?.pendingTrial;
  if (!trial || typeof trial !== 'object' || trial.status !== 'pending') {
    return { status: 'not_applicable', result: 'no_pending_trial', trialId: null };
  }
  if (!finalizedAttempt?.eligible) {
    return { status: 'not_applicable', result: 'attempt_ineligible', trialId: trial.trialId || null };
  }
  return settlePendingMotorTrial({
    trial,
    sessionId: sessionState?.sessionId,
    stage: sessionState?.stage,
    afterAttemptArtifactId: finalizedAttempt.attemptArtifactId,
    afterObservations: Array.isArray(finalizedAttempt.observations) ? finalizedAttempt.observations : [],
    selfReport: finalizedAttempt.selfReport || {},
    settledAt: nowMs,
    // Caller-supplied ordinals are never authority. Exact-next causality binds
    // to the ordinal assigned by the runtime's monotonic attempt sequence.
    afterAttemptOrdinal: canonicalOrdinal,
    attemptSequence,
  });
}

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
      replayed: disposition?.replayed === true,
    },
    rejectionReasons: controllerTurn?.eligibility?.rejected
      ? controllerTurn.eligibility.rejected.slice(0, 8).map((r) => r.reason)
      : [],
  };
}

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

  const consumption = finalizedAttempt
    ? consumeFinalizedAttempt(sessionState, finalizedAttempt)
    : {
      disposition: null,
      attemptSequence: cloneAttemptSequence(sessionState?.attemptSequence),
      sequenceChanged: false,
    };
  const disposition = consumption.disposition;
  const workingAttemptSequence = consumption.attemptSequence;

  const selfReport = finalizedAttempt?.selfReport
    ? normalizeSelfReport(finalizedAttempt.selfReport)
    : normalizeSelfReport({});

  let settlement = { status: 'not_applicable', result: 'no_pending_trial', trialId: null };
  if (finalizedAttempt && !selfReport.pain && !selfReport.throatPain) {
    settlement = resolvePendingTrial(
      sessionState,
      finalizedAttempt,
      disposition?.ordinal ?? null,
      workingAttemptSequence,
      nowMs,
    );
  } else if (sessionState?.pendingTrial && sessionState.pendingTrial.status === 'pending') {
    settlement = {
      status: 'not_applicable',
      result: 'pain_skipped_settlement',
      trialId: String(sessionState.pendingTrial.trialId || '').slice(0, 120) || null,
    };
  }

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
  for (const field of IMMEDIATE_STOP_FIELDS) {
    safetyState[field] = finalizedAttempt?.selfReport?.[field] === true;
  }
  for (const field of REDUCE_DIFFICULTY_FLAG_FIELDS) {
    safetyState[field] = finalizedAttempt?.selfReport?.[field] === true;
  }

  const controllerTurn = resolveFeminizationV1Turn({
    safetyState,
    captureState,
    curriculumState: { phase: learnerState?.mastery?.curriculumPhase || 'calibration' },
    masteryState: learnerState?.mastery || null,
    goalProfile: learnerState?.goalProfile || null,
    capabilityProfile: learnerState?.capabilityProfile || null,
    observations: Array.isArray(finalizedAttempt?.observations) ? finalizedAttempt.observations : [],
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
      ...(settlement?.status === 'settled' ? { settleTrial: settlement } : {}),
      ...(consumption.sequenceChanged && workingAttemptSequence
        ? { attemptSequence: workingAttemptSequence }
        : {}),
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
