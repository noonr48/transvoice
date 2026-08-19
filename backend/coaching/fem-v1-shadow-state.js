'use strict';

const crypto = require('crypto');
const { resolveFemV1RuntimeTurn } = require('./fem-v1-runtime-turn');

const FEM_V1_SHADOW_STATE_SCHEMA = 'transvoice.fem_v1_shadow_state.v1';
const MAX_SESSION_ID_LENGTH = 160;
const MAX_EVENT_DIGESTS = 2048;
const SESSION_DELTA_KEYS = new Set(['attemptSequence', 'attemptOrdinal', 'pendingTrial']);
const LEARNER_DELTA_KEYS = new Set(['motorResponseMap']);

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function canonicalize(value, path = 'value') {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path}_non_finite`);
    return value;
  }
  if (Array.isArray(value)) return value.map((item, index) => canonicalize(item, `${path}[${index}]`));
  if (isPlainObject(value)) {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (value[key] === undefined) throw new Error(`${path}.${key}_undefined`);
      out[key] = canonicalize(value[key], `${path}.${key}`);
    }
    return out;
  }
  throw new Error(`${path}_not_json`);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(canonicalize(value)));
}

function strictSessionId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('shadow_session_id_required');
  const text = value.trim();
  if (text.length > MAX_SESSION_ID_LENGTH) throw new Error('shadow_session_id_too_long');
  return text;
}

function shadowStateKey(sessionId) {
  return `fem-v1-shadow:${crypto.createHash('sha256')
    .update(JSON.stringify(['shadow-session', strictSessionId(sessionId)]))
    .digest('hex')
    .slice(0, 40)}`;
}

function createFemV1ShadowState({
  sessionId,
  sourceSessionRevision = null,
  sessionState = {},
  learnerState = {},
  revision = 0,
  appliedEventDigests = [],
  lastWitness = null,
} = {}) {
  const resolvedSessionId = strictSessionId(sessionId);
  if (!Number.isInteger(revision) || revision < 0) throw new Error('shadow_revision_invalid');
  if (sourceSessionRevision != null
    && (!Number.isInteger(sourceSessionRevision) || sourceSessionRevision < 0)) {
    throw new Error('shadow_source_revision_invalid');
  }
  if (!Array.isArray(appliedEventDigests)
    || appliedEventDigests.some((digest) => typeof digest !== 'string' || !/^[0-9a-f]{64}$/.test(digest))) {
    throw new Error('shadow_event_digest_history_invalid');
  }
  if (appliedEventDigests.length > MAX_EVENT_DIGESTS) throw new Error('shadow_event_digest_capacity_reached');

  const normalizedSession = cloneJson(isPlainObject(sessionState) ? sessionState : {});
  normalizedSession.sessionId = resolvedSessionId;
  const normalizedLearner = cloneJson(isPlainObject(learnerState) ? learnerState : {});

  return {
    schema: FEM_V1_SHADOW_STATE_SCHEMA,
    stateKey: shadowStateKey(resolvedSessionId),
    revision,
    sessionId: resolvedSessionId,
    sourceSessionRevision,
    sessionState: normalizedSession,
    learnerState: normalizedLearner,
    appliedEventDigests: [...appliedEventDigests],
    lastWitness: lastWitness == null ? null : cloneJson(lastWitness),
  };
}

function normalizeFemV1ShadowState(value) {
  if (!isPlainObject(value) || value.schema !== FEM_V1_SHADOW_STATE_SCHEMA) {
    throw new Error('fem_v1_shadow_state_required');
  }
  const normalized = createFemV1ShadowState(value);
  if (value.stateKey !== normalized.stateKey) throw new Error('shadow_state_key_mismatch');
  return normalized;
}

function applyShadowStateDelta(state, delta) {
  const nextSession = cloneJson(state.sessionState);
  const nextLearner = cloneJson(state.learnerState);
  const source = isPlainObject(delta) ? delta : {};

  for (const [key, value] of Object.entries(source)) {
    if (SESSION_DELTA_KEYS.has(key)) {
      nextSession[key === 'attemptOrdinal' ? 'lastAttemptOrdinal' : key] = cloneJson(value);
    } else if (LEARNER_DELTA_KEYS.has(key)) {
      nextLearner[key] = cloneJson(value);
    } else {
      throw new Error(`unsupported_shadow_state_delta_key:${key}`);
    }
  }
  return { sessionState: nextSession, learnerState: nextLearner };
}

function applyFemV1ShadowTurn(currentState, runtimeTurn, { sourceSessionRevision = null } = {}) {
  const state = normalizeFemV1ShadowState(currentState);
  if (!runtimeTurn || runtimeTurn.mode !== 'shadow') throw new Error('shadow_runtime_turn_required');
  if (runtimeTurn.proposedStateDelta && Object.keys(runtimeTurn.proposedStateDelta).length > 0) {
    throw new Error('shadow_turn_contains_production_delta');
  }

  const applied = applyShadowStateDelta(state, runtimeTurn.shadowStateDelta || {});
  const evidenceDigest = runtimeTurn?.witness?.finalizedAttempt?.evidenceDigest || null;
  const history = [...state.appliedEventDigests];
  if (evidenceDigest && !history.includes(evidenceDigest)) {
    if (history.length >= MAX_EVENT_DIGESTS) throw new Error('shadow_event_digest_capacity_reached');
    history.push(evidenceDigest);
  }

  return createFemV1ShadowState({
    sessionId: state.sessionId,
    sourceSessionRevision: sourceSessionRevision == null
      ? state.sourceSessionRevision
      : sourceSessionRevision,
    sessionState: applied.sessionState,
    learnerState: applied.learnerState,
    revision: state.revision + 1,
    appliedEventDigests: history,
    lastWitness: runtimeTurn.witness || null,
  });
}

function resolveFemV1ShadowSessionTurn({
  shadowState = null,
  sessionState = {},
  learnerState = {},
  sourceSessionRevision = null,
  finalizedAttemptEvent = null,
  finalizedAttempt = null,
  turnEvidence = null,
  cueResolver = () => null,
  now = null,
} = {}) {
  const sessionId = strictSessionId(sessionState?.sessionId || shadowState?.sessionId);
  const initial = shadowState
    ? normalizeFemV1ShadowState(shadowState)
    : createFemV1ShadowState({
      sessionId,
      sourceSessionRevision,
      sessionState,
      learnerState,
    });
  if (initial.sessionId !== sessionId) throw new Error('shadow_session_mismatch');

  // Shadow owns only its private FEM state. Live session revision remains an
  // evidence-version check for sealed AttemptFinalized events and is not
  // replaced by the shadow state's independent revision counter.
  const workingSession = {
    ...initial.sessionState,
    sessionId,
    stage: sessionState?.stage || initial.sessionState.stage || 'phrase',
    revision: Number.isInteger(sourceSessionRevision)
      ? sourceSessionRevision
      : (Number.isInteger(sessionState?.revision) ? sessionState.revision : null),
  };
  const workingLearner = {
    ...initial.learnerState,
    // Goal/capability policy can be refreshed from the current live snapshot;
    // causal/motor state remains shadow-owned once initialized.
    ...(learnerState?.goalProfile ? { goalProfile: learnerState.goalProfile } : {}),
    ...(learnerState?.capabilityProfile ? { capabilityProfile: learnerState.capabilityProfile } : {}),
    ...(learnerState?.goalCueOverlay ? { goalCueOverlay: learnerState.goalCueOverlay } : {}),
  };

  const turn = resolveFemV1RuntimeTurn({
    mode: 'shadow',
    learnerState: workingLearner,
    sessionState: workingSession,
    finalizedAttemptEvent,
    finalizedAttempt,
    turnEvidence,
    cueResolver,
    now,
  });
  const nextShadowState = applyFemV1ShadowTurn(initial, turn, {
    sourceSessionRevision: Number.isInteger(sourceSessionRevision)
      ? sourceSessionRevision
      : initial.sourceSessionRevision,
  });
  return { turn, nextShadowState };
}

module.exports = {
  FEM_V1_SHADOW_STATE_SCHEMA,
  MAX_EVENT_DIGESTS,
  applyFemV1ShadowTurn,
  createFemV1ShadowState,
  normalizeFemV1ShadowState,
  resolveFemV1ShadowSessionTurn,
  shadowStateKey,
};
