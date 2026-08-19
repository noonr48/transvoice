'use strict';

const {
  resolveFeminizationV1Turn,
  IMMEDIATE_STOP_FIELDS,
  REDUCE_DIFFICULTY_FLAG_FIELDS,
} = require('./feminization-v1-controller');
const { normalizeSelfReport } = require('./voice-self-report');
const { settlePendingMotorTrial } = require('./motor-trial');
const {
  ATTEMPT_SEQUENCE_SCHEMA,
  createAttemptSequence,
  recordFinalizedAttempt,
} = require('./session-attempt-sequence');
const {
  attemptFromFinalizedEvent,
  digestJson,
  normalizeAttemptFinalizedEvent,
  resolveCanonicalAttemptEvidence,
} = require('./attempt-finalized-event');

const FEM_V1_RUNTIME_SCHEMA = 'transvoice.fem_v1_runtime_turn.v2';
const MODES = Object.freeze(['active', 'shadow']);
const MAX_ATTEMPT_ID_LENGTH = 160;
const MAX_REASON_LENGTH = 120;

function normalizeMode(mode) {
  return MODES.includes(mode) ? mode : 'shadow';
}

function validateText(value, field, maxLength) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field}_required`);
  const text = value.trim();
  if (text.length > maxLength) throw new Error(`${field}_too_long`);
  return text;
}

function validateAndCloneAttemptSequence(sequence) {
  if (sequence == null) return null;
  if (!sequence || typeof sequence !== 'object' || Array.isArray(sequence)
    || sequence.schema !== ATTEMPT_SEQUENCE_SCHEMA
    || !Array.isArray(sequence.attempts)
    || !Number.isInteger(sequence.nextOrdinal)
    || sequence.nextOrdinal < 1) {
    throw new Error('attempt_sequence_invalid');
  }

  const attempts = [];
  const ids = new Set();
  let priorOrdinal = 0;
  for (const raw of sequence.attempts) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)
      || !Number.isInteger(raw.ordinal) || raw.ordinal < 1 || raw.ordinal <= priorOrdinal
      || typeof raw.eligible !== 'boolean') {
      throw new Error('attempt_sequence_invalid');
    }
    const attemptArtifactId = validateText(
      raw.attemptArtifactId,
      'attempt_sequence_artifact_id',
      MAX_ATTEMPT_ID_LENGTH,
    );
    if (ids.has(attemptArtifactId)) throw new Error('attempt_sequence_duplicate_artifact');
    ids.add(attemptArtifactId);
    let ineligibleReason = null;
    if (raw.eligible !== true) {
      ineligibleReason = validateText(
        raw.ineligibleReason,
        'attempt_sequence_ineligible_reason',
        MAX_REASON_LENGTH,
      );
    }
    attempts.push({
      ordinal: raw.ordinal,
      attemptArtifactId,
      eligible: raw.eligible === true,
      ineligibleReason,
    });
    priorOrdinal = raw.ordinal;
  }
  if (sequence.nextOrdinal <= priorOrdinal) throw new Error('attempt_sequence_next_ordinal_invalid');

  return {
    schema: ATTEMPT_SEQUENCE_SCHEMA,
    nextOrdinal: sequence.nextOrdinal,
    attempts,
  };
}

function consumeFinalizedAttempt(sessionState, finalizedAttempt) {
  const attemptArtifactId = validateText(
    finalizedAttempt?.attemptArtifactId,
    'attempt_artifact_id',
    MAX_ATTEMPT_ID_LENGTH,
  );
  const eligible = finalizedAttempt?.eligible === true;
  const ineligibleReason = eligible
    ? null
    : validateText(finalizedAttempt?.ineligibleReason, 'ineligible_reason', MAX_REASON_LENGTH);

  const disposition = {
    attemptArtifactId,
    eligible,
    ineligibleReason,
    ordinal: null,
    replayed: false,
  };

  const sequence = validateAndCloneAttemptSequence(sessionState?.attemptSequence)
    || createAttemptSequence();

  const existing = sequence.attempts.find((row) => row.attemptArtifactId === attemptArtifactId);
  if (existing) {
    const sameClassification = existing.eligible === eligible
      && (eligible || existing.ineligibleReason === ineligibleReason);
    if (!sameClassification) throw new Error('attempt_artifact_conflict');
    disposition.ordinal = existing.ordinal;
    disposition.replayed = true;
    return { disposition, attemptSequence: sequence, sequenceChanged: false };
  }

  const record = recordFinalizedAttempt(sequence, {
    attemptArtifactId,
    eligible,
    ineligibleReason,
  });
  disposition.ordinal = record.ordinal;
  return { disposition, attemptSequence: sequence, sequenceChanged: true };
}

function normalizeEvidenceObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function buildSafetyState(selfReport) {
  const normalized = normalizeSelfReport(selfReport || {});
  const safetyState = {
    pain: normalized.pain,
    throatPain: normalized.throatPain,
    effort: normalized.effort,
    strain: normalized.strain,
    fatigue: normalized.fatigue,
    discomfort: normalized.discomfort,
  };
  for (const field of IMMEDIATE_STOP_FIELDS) safetyState[field] = selfReport?.[field] === true;
  for (const field of REDUCE_DIFFICULTY_FLAG_FIELDS) safetyState[field] = selfReport?.[field] === true;
  return safetyState;
}

function resolvePendingTrial({
  sessionState,
  finalizedAttempt,
  canonicalOrdinal,
  attemptSequence,
  motorResponseMap,
  nowMs,
}) {
  const trial = sessionState?.pendingTrial;
  if (!trial || typeof trial !== 'object' || trial.status !== 'pending') {
    return { status: 'not_applicable', result: 'no_pending_trial', trialId: null };
  }
  const normalizedSelfReport = normalizeSelfReport(finalizedAttempt?.selfReport || {});
  const pain = normalizedSelfReport.pain === true || normalizedSelfReport.throatPain === true;

  // Pain closes the causal window even when the acoustic take itself was
  // ineligible. A hurting attempt can never be skipped so a later take earns
  // credit for the same cue.
  if (!pain && finalizedAttempt?.eligible !== true) {
    return {
      status: 'not_applicable',
      result: 'attempt_ineligible',
      trialId: trial.trialId || null,
    };
  }

  return settlePendingMotorTrial({
    trial,
    sessionId: sessionState?.sessionId,
    stage: sessionState?.stage,
    afterAttemptArtifactId: finalizedAttempt?.attemptArtifactId,
    afterObservations: Array.isArray(finalizedAttempt?.observations)
      ? finalizedAttempt.observations
      : [],
    selfReport: finalizedAttempt?.selfReport || {},
    motorMap: motorResponseMap || null,
    settledAt: nowMs,
    afterAttemptOrdinal: canonicalOrdinal,
    attemptSequence,
  });
}

function terminalTrialFromSettlement(settlement, fallback) {
  if (settlement && ['settled', 'invalidated'].includes(settlement.status)
    && settlement.trial && typeof settlement.trial === 'object') {
    return settlement.trial;
  }
  return fallback || null;
}

function motorMapFromSettlement(settlement, fallback) {
  if (settlement && Object.prototype.hasOwnProperty.call(settlement, 'motorMap')) {
    return settlement.motorMap;
  }
  return fallback || null;
}

function buildWitness({
  mode,
  controllerTurn,
  settlement,
  disposition,
  phase,
  nowMs,
  attemptSource,
  evidenceDigest,
}) {
  return {
    schema: FEM_V1_RUNTIME_SCHEMA,
    mode,
    at: Number.isFinite(nowMs) ? nowMs : null,
    turn: {
      action: controllerTurn?.action || null,
      safetyReason: controllerTurn?.safetyReason || null,
      phase,
      focusDimension: controllerTurn?.focus?.dimension || null,
      cueId: controllerTurn?.cue?.cueId || null,
    },
    settlement: {
      status: settlement?.status || null,
      result: settlement?.result || null,
      trialId: settlement?.trialId || null,
    },
    finalizedAttempt: {
      source: attemptSource,
      ordinal: disposition?.ordinal || null,
      eligible: disposition?.eligible === true,
      replayed: disposition?.replayed === true,
      evidenceDigest: evidenceDigest || null,
    },
    rejectionReasons: controllerTurn?.eligibility?.rejected
      ? controllerTurn.eligibility.rejected.slice(0, 8).map((row) => row.reason)
      : [],
  };
}

function resolveFemV1RuntimeTurn({
  mode = 'shadow',
  learnerState = {},
  sessionState = {},
  finalizedAttemptEvent = null,
  finalizedAttempt = null,
  turnEvidence = null,
  cueResolver = () => null,
  now = null,
} = {}) {
  const resolvedMode = normalizeMode(mode);
  const nowMs = Number.isFinite(now) ? now : null;

  if (finalizedAttemptEvent && finalizedAttempt) {
    throw new Error('multiple_finalized_attempt_sources');
  }

  let attemptSource = 'none';
  let event = null;
  let resolvedAttempt = null;
  if (finalizedAttemptEvent) {
    event = normalizeAttemptFinalizedEvent(finalizedAttemptEvent);
    if (sessionState?.sessionId && event.sessionId !== sessionState.sessionId) {
      throw new Error('attempt_event_session_mismatch');
    }
    if (event.expectedSessionRevision != null && Number.isInteger(sessionState?.revision)
      && event.expectedSessionRevision !== sessionState.revision) {
      throw new Error('attempt_event_revision_mismatch');
    }
    resolvedAttempt = attemptFromFinalizedEvent(event);
    const merged = resolveCanonicalAttemptEvidence(resolvedAttempt, turnEvidence);
    if (digestJson(merged) !== event.evidenceDigest) {
      throw new Error('attempt_evidence_conflict:sealed_event');
    }
    attemptSource = 'explicit_event';
  } else if (finalizedAttempt) {
    const evidence = resolveCanonicalAttemptEvidence(finalizedAttempt, turnEvidence);
    resolvedAttempt = {
      ...finalizedAttempt,
      selfReport: evidence.selfReport,
      captureEvidence: evidence.captureEvidence,
      observations: evidence.observations,
    };
    attemptSource = 'legacy_attempt';
  }

  const consumption = resolvedAttempt
    ? consumeFinalizedAttempt(sessionState, resolvedAttempt)
    : {
      disposition: null,
      attemptSequence: validateAndCloneAttemptSequence(sessionState?.attemptSequence),
      sequenceChanged: false,
    };
  const disposition = consumption.disposition;
  const workingAttemptSequence = consumption.attemptSequence;

  const turnOnlyEvidence = normalizeEvidenceObject(turnEvidence);
  const canonicalEvidence = resolvedAttempt
    ? {
      selfReport: resolvedAttempt.selfReport || {},
      captureEvidence: resolvedAttempt.captureEvidence || {},
      observations: Array.isArray(resolvedAttempt.observations) ? resolvedAttempt.observations : [],
    }
    : {
      selfReport: normalizeEvidenceObject(turnOnlyEvidence.selfReport),
      captureEvidence: normalizeEvidenceObject(turnOnlyEvidence.captureEvidence),
      observations: Array.isArray(turnOnlyEvidence.observations) ? turnOnlyEvidence.observations : [],
    };

  const selfReport = canonicalEvidence.selfReport;
  const safetyState = buildSafetyState(selfReport);
  const captureSource = canonicalEvidence.captureEvidence;
  const captureState = Object.keys(captureSource).length > 0
    ? {
      usable: captureSource.usable === true,
      reasons: Array.isArray(captureSource.reasons) ? captureSource.reasons.slice(0, 8) : [],
    }
    : { usable: true, reasons: [] };

  let settlement = { status: 'not_applicable', result: 'no_pending_trial', trialId: null };
  if (resolvedAttempt) {
    settlement = resolvePendingTrial({
      sessionState,
      finalizedAttempt: resolvedAttempt,
      canonicalOrdinal: disposition?.ordinal ?? null,
      attemptSequence: workingAttemptSequence,
      motorResponseMap: learnerState?.motorResponseMap || null,
      nowMs,
    });
  } else if (sessionState?.pendingTrial?.status === 'pending') {
    settlement = {
      status: 'not_applicable',
      result: 'awaiting_next_attempt',
      trialId: sessionState.pendingTrial.trialId || null,
    };
  }

  // The controller must see post-settlement working state. Passing the original
  // pending object here can cause a terminally settled trial to be re-requested.
  const workingPendingTrial = terminalTrialFromSettlement(settlement, sessionState?.pendingTrial);
  const workingMotorResponseMap = motorMapFromSettlement(
    settlement,
    learnerState?.motorResponseMap || null,
  );

  const controllerTurn = resolveFeminizationV1Turn({
    safetyState,
    captureState,
    curriculumState: { phase: learnerState?.mastery?.curriculumPhase || 'calibration' },
    masteryState: learnerState?.mastery || null,
    goalProfile: learnerState?.goalProfile || null,
    capabilityProfile: learnerState?.capabilityProfile || null,
    observations: canonicalEvidence.observations,
    motorResponseMap: workingMotorResponseMap,
    goalCueOverlay: learnerState?.goalCueOverlay || null,
    pendingTrial: workingPendingTrial,
    sessionContext: {
      sessionId: sessionState?.sessionId || event?.sessionId || null,
      stage: sessionState?.stage || 'phrase',
    },
    mode: resolvedMode,
    cueResolver,
  });

  const stateDelta = {
    ...(consumption.sequenceChanged && workingAttemptSequence
      ? { attemptSequence: workingAttemptSequence }
      : {}),
    ...(disposition?.ordinal != null ? { attemptOrdinal: disposition.ordinal } : {}),
    ...(['settled', 'invalidated'].includes(settlement?.status) && settlement?.trial
      ? { pendingTrial: settlement.trial }
      : {}),
    ...(settlement?.motorMapUpdated === true
      ? { motorResponseMap: settlement.motorMap }
      : {}),
  };

  const witness = buildWitness({
    mode: resolvedMode,
    controllerTurn,
    settlement,
    disposition,
    phase: controllerTurn?.phase || null,
    nowMs,
    attemptSource,
    evidenceDigest: event?.evidenceDigest
      || (resolvedAttempt ? digestJson(canonicalEvidence) : null),
  });

  return {
    schema: FEM_V1_RUNTIME_SCHEMA,
    mode: resolvedMode,
    action: controllerTurn?.action || null,
    safetyReason: controllerTurn?.safetyReason || null,
    settlement,
    controllerTurn,
    finalizedAttemptDisposition: disposition,
    witness,
    // Shadow state is explicitly non-production state. It allows deterministic
    // multi-turn replay/sequence tracking without granting causal credit for a
    // cue that was never actually served.
    shadowStateDelta: resolvedMode === 'shadow' ? stateDelta : {},
    proposedStateDelta: resolvedMode === 'active' ? stateDelta : {},
  };
}

module.exports = {
  FEM_V1_RUNTIME_SCHEMA,
  MODES,
  consumeFinalizedAttempt,
  resolveFemV1RuntimeTurn,
  validateAndCloneAttemptSequence,
};
