'use strict';

const crypto = require('crypto');
const {
  comparisonIdentityKey,
  normalizeObservation,
} = require('./metric-observations');
const { verifyCueEffect } = require('./target-coaching-engine');
const { recordCueOutcome } = require('./motor-map');
const { CUE_SERVED_EVENT_SCHEMA, cueServeEligibility } = require('./cue-served-lifecycle');
const { nextEligibleOrdinalAfter } = require('./session-attempt-sequence');
const { parseFivePoint } = require('./voice-self-report');

const MOTOR_TRIAL_SCHEMA = 'transvoice.pending_motor_trial.v1';
const MOTOR_TRIAL_RESULT_SCHEMA = 'transvoice.motor_trial_result.v1';

function textOrNull(value) {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeStringArray(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map(textOrNull)
    .filter(Boolean))];
}

function deterministicTrialId({ sessionId, cueId, beforeAttemptArtifactId, comparisonKey }) {
  const material = [sessionId, cueId, beforeAttemptArtifactId, comparisonKey]
    .map((value) => textOrNull(value) || '')
    .join('|');
  if (!material.replace(/\|/g, '')) return null;
  return `mt-${crypto.createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

function safeObservationSnapshot(raw, { fallbackAttemptArtifactId = null } = {}) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const observation = normalizeObservation(raw);
  if (!observation.metricId || !observation.dimension || observation.value == null) return null;
  return {
    schema: observation.schema,
    metricId: observation.metricId,
    metricDefinitionVersion: observation.metricDefinitionVersion,
    dimension: observation.dimension,
    value: observation.value,
    unit: observation.unit,
    phoneme: observation.phoneme,
    word: observation.word,
    contextKind: observation.contextKind,
    // Controlled-probe comparison identity is REQUIRED by verification
    // (verifyCueEffect re-derives the identity key from this snapshot); a
    // context id string, not learner content. Without it, a controlled-
    // vowel before-take can never identity-match its exact-next after-take
    // (every resonance settle would invalidate as context_changed).
    comparisonContextKey: observation.comparisonContextKey || null,
    sourceKind: observation.sourceKind,
    attemptArtifactId: observation.attemptArtifactId || textOrNull(fallbackAttemptArtifactId),
    taskId: observation.taskId,
    takeKind: observation.takeKind,
    analysisProfile: observation.analysisProfile,
    confidence: { ...observation.confidence },
    target: { ...observation.target },
    flags: [...observation.flags],
    persistenceCount: observation.persistenceCount,
    importance: observation.importance,
    controllability: observation.controllability,
    // Preserve only metric semantics required by targetDistance / verification.
    metadata: {
      ...(observation.metadata?.targetScaleUnit
        ? { targetScaleUnit: observation.metadata.targetScaleUnit }
        : {}),
    },
  };
}

function observationForComparisonKey(observations, comparisonKey) {
  if (!comparisonKey) return null;
  return (Array.isArray(observations) ? observations : [])
    .map(normalizeObservation)
    .find((item) => item.comparisonKey === comparisonKey) || null;
}

function protectedBeforeSnapshots(decision, observations, beforeAttemptArtifactId) {
  const dimensions = normalizeStringArray(decision?.action?.protectedMetrics)
    .filter((dimension) => dimension !== 'safety.effort');
  const focus = decision?.focus || {};
  const targetKey = textOrNull(focus.targetKey);
  const taskId = textOrNull(focus.taskId);
  const takeKind = textOrNull(focus.takeKind);
  const normalized = (Array.isArray(observations) ? observations : []).map(normalizeObservation);

  const out = [];
  for (const dimension of dimensions) {
    const item = normalized.find((candidate) => (
      candidate.dimension === dimension
      && (!candidate.attemptArtifactId || candidate.attemptArtifactId === beforeAttemptArtifactId)
      && (!targetKey || candidate.target?.targetKey === targetKey)
      && (!taskId || candidate.taskId === taskId)
      && (!takeKind || candidate.takeKind === takeKind)
    ));
    const snapshot = safeObservationSnapshot(item, { fallbackAttemptArtifactId: beforeAttemptArtifactId });
    if (snapshot) out.push(snapshot);
  }
  return out;
}

function compactDecision(decision) {
  if (!decision || decision.status !== 'coach' || !decision.focus || !decision.action?.cueId) {
    return null;
  }
  return {
    schema: decision.schema || null,
    engineVersion: decision.engineVersion || null,
    status: 'coach',
    focus: {
      metricId: textOrNull(decision.focus.metricId),
      dimension: textOrNull(decision.focus.dimension),
      direction: textOrNull(decision.focus.direction),
      comparisonKey: textOrNull(decision.focus.comparisonKey),
      targetKey: textOrNull(decision.focus.targetKey),
      attemptArtifactId: textOrNull(decision.focus.attemptArtifactId),
      taskId: textOrNull(decision.focus.taskId),
      takeKind: textOrNull(decision.focus.takeKind),
      analysisProfile: textOrNull(decision.focus.analysisProfile),
    },
    action: {
      cueId: textOrNull(decision.action.cueId),
      reviewStatus: textOrNull(decision.action.reviewStatus),
      protectedMetrics: normalizeStringArray(decision.action.protectedMetrics),
      protectedRules: decision.action.protectedRules
        && typeof decision.action.protectedRules === 'object'
        && !Array.isArray(decision.action.protectedRules)
        ? JSON.parse(JSON.stringify(decision.action.protectedRules))
        : {},
    },
  };
}

function resolveCueServeBinding(cueServeEvent, {
  requireCueServeEvent,
  issuedAt,
  expectedCueId = null,
  expectedSessionId = null,
} = {}) {
  if (!cueServeEvent || typeof cueServeEvent !== 'object') {
    return requireCueServeEvent === true
      ? { status: 'rejected', reason: 'cue_serve_event_required' }
      : { status: 'none', binding: null };
  }
  if (cueServeEvent.schema !== CUE_SERVED_EVENT_SCHEMA) {
    return { status: 'rejected', reason: 'cue_serve_event_invalid' };
  }
  const eligibility = cueServeEligibility({ event: cueServeEvent, at: issuedAt });
  if (eligibility.eligible !== true) {
    return { status: 'rejected', reason: 'cue_serve_event_not_eligible' };
  }
  // Identity: the binding must attest THIS decision's cue in THIS session —
  // a serve+acknowledgement of a different cue must never earn credit here.
  if (expectedCueId && cueServeEvent.cueId !== expectedCueId) {
    return { status: 'rejected', reason: 'cue_serve_event_cue_mismatch' };
  }
  if (expectedSessionId && cueServeEvent.sessionId !== expectedSessionId) {
    return { status: 'rejected', reason: 'cue_serve_event_session_mismatch' };
  }
  return {
    status: 'bound',
    binding: {
      schema: CUE_SERVED_EVENT_SCHEMA,
      cueId: cueServeEvent.cueId,
      cueReviewStatus: cueServeEvent.cueReviewStatus,
      sessionId: cueServeEvent.sessionId,
      servedAt: cueServeEvent.servedAt,
      acknowledgedAt: cueServeEvent.acknowledgedAt,
    },
  };
}

function createPendingMotorTrial({
  decision,
  beforeObservations = [],
  sessionId,
  stage = 'phrase',
  selfReport = {},
  issuedAt = Date.now(),
  trialId = null,
  cueServeEvent = null,
  requireCueServeEvent = false,
  attemptSequence = null,
  baselineAttemptOrdinal = null,
} = {}) {
  const compact = compactDecision(decision);
  if (!compact) {
    return { status: 'not_created', reason: 'coach_decision_required', trial: null };
  }

  // Session identity must be resolved BEFORE the cue-serve binding so the
  // binding is verified against THIS trial's session.
  const resolvedSessionId = textOrNull(sessionId);
  if (!resolvedSessionId) {
    return { status: 'not_created', reason: 'session_id_required', trial: null };
  }

  // Exact-next causality: when a caller requires a cue-serve binding, the
  // reviewed cue must have been served AND acknowledged (within its window,
  // at or before this trial creation) AND must be THIS decision's cue in
  // THIS session — or no trial exists at all. Without this, a decision could
  // earn credit from a cue the learner never saw, or never saw for this task.
  const cueServe = resolveCueServeBinding(cueServeEvent, {
    requireCueServeEvent,
    issuedAt,
    expectedCueId: compact.action.cueId,
    expectedSessionId: resolvedSessionId,
  });
  if (cueServe.status === 'rejected') {
    return { status: 'not_created', reason: cueServe.reason, trial: null };
  }

  // R1-003 exact-next enforcement basis: bind the baseline ordinal when a
  // session attempt sequence is supplied. (The expected-next ordinal cannot
  // be computed at creation — attempts finalize after the trial opens.)
  // Settlement performs the authoritative check against the sequence
  // snapshot at settle time: the settling attempt must be the FIRST eligible
  // finalized attempt after the baseline. Ineligible attempts between are
  // lawfully skipped; an eligible attempt between baseline and the settling
  // attempt is a cherry-pick and terminally invalidates. Legacy trials
  // (no sequence) keep old behavior.
  const baselineOrdinal = finiteOrNull(baselineAttemptOrdinal);
  const sequenceBound = Boolean(
    attemptSequence
      && typeof attemptSequence === 'object'
      && !Array.isArray(attemptSequence)
      && attemptSequence.schema === 'transvoice.session_attempt_sequence.v1'
      && baselineOrdinal != null,
  );

  const focusKey = compact.focus.comparisonKey;
  const focusBefore = observationForComparisonKey(beforeObservations, focusKey);
  if (!focusBefore) {
    return { status: 'not_created', reason: 'focus_before_observation_missing', trial: null };
  }
  const beforeAttemptArtifactId = textOrNull(
    compact.focus.attemptArtifactId || focusBefore.attemptArtifactId,
  );
  if (!beforeAttemptArtifactId) {
    return { status: 'not_created', reason: 'before_attempt_id_required', trial: null };
  }
  if (focusBefore.attemptArtifactId && focusBefore.attemptArtifactId !== beforeAttemptArtifactId) {
    return { status: 'not_created', reason: 'before_attempt_mismatch', trial: null };
  }

  const focusSnapshot = safeObservationSnapshot(
    focusBefore,
    { fallbackAttemptArtifactId: beforeAttemptArtifactId },
  );
  if (!focusSnapshot) {
    return { status: 'not_created', reason: 'focus_before_observation_invalid', trial: null };
  }
  const protectedSnapshots = protectedBeforeSnapshots(
    compact,
    beforeObservations,
    beforeAttemptArtifactId,
  );
  const beforeSnapshotByKey = new Map();
  for (const item of [focusSnapshot, ...protectedSnapshots]) {
    beforeSnapshotByKey.set(comparisonIdentityKey(item), item);
  }
  const resolvedStage = textOrNull(stage);
  if (!resolvedStage) {
    return { status: 'not_created', reason: 'stage_required', trial: null };
  }
  const resolvedTrialId = textOrNull(trialId) || deterministicTrialId({
    sessionId: resolvedSessionId,
    cueId: compact.action.cueId,
    beforeAttemptArtifactId,
    comparisonKey: focusKey,
  });

  return {
    status: 'created',
    reason: null,
    trial: {
      schema: MOTOR_TRIAL_SCHEMA,
      trialId: resolvedTrialId,
      status: 'pending',
      sessionId: resolvedSessionId,
      issuedAt: finiteOrNull(issuedAt) ?? Date.now(),
      stage: resolvedStage,
      cueId: compact.action.cueId,
      cueReviewStatus: compact.action.reviewStatus,
      focusDimension: compact.focus.dimension,
      focusComparisonKey: focusKey,
      targetKey: compact.focus.targetKey || focusBefore.target?.targetKey || null,
      beforeAttemptArtifactId,
      taskId: compact.focus.taskId || focusBefore.taskId || null,
      takeKind: compact.focus.takeKind || focusBefore.takeKind || null,
      analysisProfile: compact.focus.analysisProfile || focusBefore.analysisProfile || null,
      protectedMetrics: [...compact.action.protectedMetrics],
      protectedRules: JSON.parse(JSON.stringify(compact.action.protectedRules || {})),
      effortBefore: parseFivePoint(selfReport?.effort),
      strainBefore: parseFivePoint(selfReport?.strain),
      fatigueBefore: parseFivePoint(selfReport?.fatigue),
      discomfortBefore: parseFivePoint(selfReport?.discomfort),
      painBefore: selfReport?.pain === true || selfReport?.throatPain === true,
      cueServe: cueServe.binding,
      // R1-003 ordinal binding (null for legacy unbound trials):
      baselineAttemptOrdinal: sequenceBound ? baselineOrdinal : null,
      attemptSequenceBound: sequenceBound,
      // The exact baseline evidence required to verify this cue. No transcript,
      // audio, cue prose, or unrelated observation vector is retained.
      beforeObservations: [...beforeSnapshotByKey.values()],
      decision: compact,
      candidatePolicy: {
        consumeNextFinalizedAttempt: true,
        allowSkipToLaterAttempt: false,
      },
    },
  };
}

function candidateContext(afterObservations, explicit = {}) {
  const normalized = (Array.isArray(afterObservations) ? afterObservations : [])
    .map(normalizeObservation);
  const first = normalized[0] || null;
  return {
    attemptArtifactId: textOrNull(explicit.attemptArtifactId)
      || textOrNull(first?.attemptArtifactId),
    targetKey: textOrNull(explicit.targetKey)
      || textOrNull(first?.target?.targetKey),
    taskId: textOrNull(explicit.taskId)
      || textOrNull(first?.taskId),
    takeKind: textOrNull(explicit.takeKind)
      || textOrNull(first?.takeKind),
    analysisProfile: textOrNull(explicit.analysisProfile)
      || textOrNull(first?.analysisProfile),
    stage: textOrNull(explicit.stage),
    observations: normalized,
  };
}

function terminalTrial(trial, status, result, candidate = null) {
  return {
    ...trial,
    status,
    terminalResult: result,
    afterAttemptArtifactId: candidate?.attemptArtifactId || null,
  };
}

function invalidate(trial, reason, candidate = null) {
  return {
    schema: MOTOR_TRIAL_RESULT_SCHEMA,
    status: 'invalidated',
    result: reason,
    trialId: trial?.trialId || null,
    cueId: trial?.cueId || null,
    beforeAttemptArtifactId: trial?.beforeAttemptArtifactId || null,
    afterAttemptArtifactId: candidate?.attemptArtifactId || null,
    trial: trial ? terminalTrial(trial, 'invalidated', reason, candidate) : null,
    verification: null,
    motorMapUpdated: false,
  };
}

function invalidatePendingMotorTrial(trial, reason = 'cue_superseded') {
  if (!trial || trial.schema !== MOTOR_TRIAL_SCHEMA || trial.status !== 'pending') {
    return {
      schema: MOTOR_TRIAL_RESULT_SCHEMA,
      status: 'not_applicable',
      result: 'pending_trial_required',
      trialId: trial?.trialId || null,
      trial: trial || null,
      motorMapUpdated: false,
    };
  }
  return invalidate(trial, textOrNull(reason) || 'cue_superseded');
}

function settlePendingMotorTrial({
  trial,
  sessionId,
  stage = null,
  afterObservations = [],
  afterAttemptArtifactId = null,
  targetKey = null,
  taskId = null,
  takeKind = null,
  analysisProfile = null,
  selfReport = {},
  motorMap = null,
  settledAt = null,
  afterAttemptOrdinal = null,
  attemptSequence = null,
} = {}) {
  if (!trial || trial.schema !== MOTOR_TRIAL_SCHEMA || trial.status !== 'pending') {
    return {
      schema: MOTOR_TRIAL_RESULT_SCHEMA,
      status: 'not_applicable',
      result: 'pending_trial_required',
      trialId: trial?.trialId || null,
      trial: trial || null,
      motorMap,
      motorMapUpdated: false,
    };
  }

  const candidate = candidateContext(afterObservations, {
    attemptArtifactId: afterAttemptArtifactId,
    targetKey,
    taskId,
    takeKind,
    analysisProfile,
    stage,
  });
  const resolvedSessionId = textOrNull(sessionId);
  if (!resolvedSessionId || resolvedSessionId !== trial.sessionId) {
    return { ...invalidate(trial, 'session_changed', candidate), motorMap };
  }
  if (!candidate.attemptArtifactId) {
    return { ...invalidate(trial, 'after_attempt_id_required', candidate), motorMap };
  }
  if (candidate.attemptArtifactId === trial.beforeAttemptArtifactId) {
    return { ...invalidate(trial, 'before_attempt_repeated', candidate), motorMap };
  }
  if (trial.stage && candidate.stage !== trial.stage) {
    return { ...invalidate(trial, 'stage_changed', candidate), motorMap };
  }
  if (trial.targetKey && candidate.targetKey !== trial.targetKey) {
    return { ...invalidate(trial, 'target_changed', candidate), motorMap };
  }
  if (trial.taskId && candidate.taskId !== trial.taskId) {
    return { ...invalidate(trial, 'task_changed', candidate), motorMap };
  }
  if (trial.takeKind && candidate.takeKind !== trial.takeKind) {
    return { ...invalidate(trial, 'take_kind_changed', candidate), motorMap };
  }
  if (trial.analysisProfile && candidate.analysisProfile !== trial.analysisProfile) {
    return { ...invalidate(trial, 'analysis_profile_changed', candidate), motorMap };
  }
  if (candidate.observations.some((item) => (
    item.attemptArtifactId && item.attemptArtifactId !== candidate.attemptArtifactId
  ))) {
    return { ...invalidate(trial, 'mixed_after_attempt_evidence', candidate), motorMap };
  }

  // Plan §13 terminal invalidation: pain reported at/for the after-take ends
  // the trial — a cue never earns credit from a take that hurt, regardless
  // of acoustic outcome.
  if (selfReport?.pain === true || selfReport?.throatPain === true) {
    return { ...invalidate(trial, 'pain_reported', candidate), motorMap };
  }

  // Exact-next window (plan §13 expiry): a cue-serve-bound trial may only
  // settle on a take INSIDE the serve window. Unknown take time is unknown —
  // fail closed; a take after the window expires the trial.
  if (trial.cueServe) {
    const settledAtMs = finiteOrNull(settledAt);
    if (settledAtMs == null) {
      return { ...invalidate(trial, 'take_time_unknown', candidate), motorMap };
    }
    const serveEligibility = cueServeEligibility({
      event: {
        schema: CUE_SERVED_EVENT_SCHEMA,
        cueId: trial.cueServe.cueId,
        cueReviewStatus: trial.cueServe.cueReviewStatus,
        sessionId: trial.sessionId,
        servedAt: trial.cueServe.servedAt,
        acknowledged: true,
        acknowledgedAt: trial.cueServe.acknowledgedAt,
      },
      at: settledAtMs,
    });
    if (serveEligibility.eligible !== true) {
      return { ...invalidate(trial, 'take_outside_cue_serve_window', candidate), motorMap };
    }
  }

  // R1-003 exact-next enforcement: when the trial carries an ordinal
  // binding, settlement is lawful ONLY on the FIRST eligible finalized
  // attempt after the baseline — verified against the sequence snapshot at
  // settle time (creation cannot know which attempts will finalize later).
  // Unknown ordinal fails closed; stale ordinal (the baseline itself or
  // earlier) fails; an eligible intervening attempt means cherry-picking and
  // terminally invalidates.
  if (trial.attemptSequenceBound === true) {
    const ordinal = finiteOrNull(afterAttemptOrdinal);
    if (ordinal == null) {
      return { ...invalidate(trial, 'attempt_ordinal_required', candidate), motorMap };
    }
    if (trial.baselineAttemptOrdinal != null && ordinal <= trial.baselineAttemptOrdinal) {
      return { ...invalidate(trial, 'attempt_not_next', candidate), motorMap };
    }
    const seq = attemptSequence
      && typeof attemptSequence === 'object'
      && !Array.isArray(attemptSequence)
      && attemptSequence.schema === 'transvoice.session_attempt_sequence.v1'
      ? attemptSequence
      : null;
    if (!seq) {
      // Bound trial settled without its sequence: unknown eligibility of
      // intervening attempts — fail closed.
      return { ...invalidate(trial, 'attempt_sequence_required', candidate), motorMap };
    }
    const firstEligible = nextEligibleOrdinalAfter(seq, trial.baselineAttemptOrdinal);
    if (firstEligible == null || ordinal !== firstEligible) {
      return { ...invalidate(trial, 'intervening_eligible_attempt_skipped', candidate), motorMap };
    }
  }

  const focusAfter = observationForComparisonKey(
    candidate.observations,
    trial.focusComparisonKey,
  );
  if (!focusAfter) {
    return { ...invalidate(trial, 'no_comparable_focus_evidence', candidate), motorMap };
  }

  // R1-001 F1 (hardening review): strict five-point parsing at settle too.
  const effortAfter = parseFivePoint(selfReport?.effort);
  const verification = verifyCueEffect(
    trial.decision,
    trial.beforeObservations,
    candidate.observations,
    { effortBefore: trial.effortBefore, effortAfter },
  );
  if (!verification || !['verified', 'invalidated'].includes(verification.status)) {
    return {
      ...invalidate(trial, verification?.result || 'verification_incomplete', candidate),
      motorMap,
      verification: verification || null,
    };
  }
  if (verification.status === 'invalidated') {
    return {
      ...invalidate(trial, verification.result || 'verification_invalidated', candidate),
      motorMap,
      verification,
    };
  }

  const nextMotorMap = recordCueOutcome(motorMap, {
    cueId: trial.cueId,
    focusDimension: trial.focusDimension,
    beforeObservations: trial.beforeObservations,
    afterObservations: candidate.observations,
    protectedDimensions: trial.protectedMetrics,
    protectedRules: trial.protectedRules,
    effortBefore: trial.effortBefore,
    effortAfter,
    verification,
  });

  return {
    schema: MOTOR_TRIAL_RESULT_SCHEMA,
    status: 'settled',
    result: verification.result,
    trialId: trial.trialId,
    cueId: trial.cueId,
    beforeAttemptArtifactId: trial.beforeAttemptArtifactId,
    afterAttemptArtifactId: candidate.attemptArtifactId,
    trial: terminalTrial(trial, 'settled', verification.result, candidate),
    verification,
    motorMap: nextMotorMap,
    motorMapUpdated: JSON.stringify(nextMotorMap) !== JSON.stringify(motorMap),
  };
}

module.exports = {
  MOTOR_TRIAL_RESULT_SCHEMA,
  MOTOR_TRIAL_SCHEMA,
  createPendingMotorTrial,
  deterministicTrialId,
  invalidatePendingMotorTrial,
  resolveCueServeBinding,
  safeObservationSnapshot,
  settlePendingMotorTrial,
};
