'use strict';

const crypto = require('crypto');
const { normalizeAttemptFinalizedEvent } = require('./attempt-finalized-event');
const { resolvePitchAlphaCueForShadow } = require('./cue-alpha-authority');
const {
  createFemV1ShadowState,
  normalizeFemV1ShadowState,
  resolveFemV1ShadowSessionTurn,
} = require('./fem-v1-shadow-state');

const FEM_V1_SHADOW_REPLAY_SCHEMA = 'transvoice.fem_v1_shadow_replay.v1';
const FEM_V1_SHADOW_REPLAY_EVENT_SCHEMA = 'transvoice.fem_v1_shadow_replay_event.v1';
const MAX_REPLAY_EVENTS = 4096;
const MAX_EVENT_ID_LENGTH = 160;

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

function digestJson(value) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(canonicalize(value)))
    .digest('hex');
}

function strictEventId(value) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('shadow_replay_event_id_required');
  const text = value.trim();
  if (text.length > MAX_EVENT_ID_LENGTH) throw new Error('shadow_replay_event_id_too_long');
  return text;
}

function normalizeReplayEvent(value) {
  if (!isPlainObject(value) || value.schema !== FEM_V1_SHADOW_REPLAY_EVENT_SCHEMA) {
    throw new Error('shadow_replay_event_required');
  }
  const hasFinalizedEvent = value.finalizedAttemptEvent != null;
  const hasTurnEvidence = value.turnEvidence != null;
  if (hasFinalizedEvent === hasTurnEvidence) {
    throw new Error('shadow_replay_event_payload_invalid');
  }
  const now = value.now == null ? null : Number(value.now);
  if (now != null && !Number.isFinite(now)) throw new Error('shadow_replay_event_time_invalid');
  const sourceSessionRevision = value.sourceSessionRevision == null
    ? null : Number(value.sourceSessionRevision);
  if (sourceSessionRevision != null
    && (!Number.isInteger(sourceSessionRevision) || sourceSessionRevision < 0)) {
    throw new Error('shadow_replay_event_revision_invalid');
  }

  return {
    schema: FEM_V1_SHADOW_REPLAY_EVENT_SCHEMA,
    eventId: strictEventId(value.eventId),
    now,
    sourceSessionRevision,
    finalizedAttemptEvent: hasFinalizedEvent
      ? normalizeAttemptFinalizedEvent(value.finalizedAttemptEvent)
      : null,
    turnEvidence: hasTurnEvidence ? cloneJson(value.turnEvidence) : null,
  };
}

function summarizeTurn(turn) {
  return {
    action: turn?.action || null,
    safetyReason: turn?.safetyReason || null,
    controllerReason: turn?.controllerTurn?.reason || null,
    phase: turn?.controllerTurn?.phase || null,
    focusDimension: turn?.controllerTurn?.focus?.dimension || null,
    cueId: turn?.controllerTurn?.cue?.cueId || null,
    served: turn?.controllerTurn?.served === true,
    trialRequested: turn?.controllerTurn?.trialRequested === true,
    settlement: {
      status: turn?.settlement?.status || null,
      result: turn?.settlement?.result || null,
      trialId: turn?.settlement?.trialId || null,
    },
    finalizedAttempt: {
      ordinal: turn?.finalizedAttemptDisposition?.ordinal || null,
      eligible: turn?.finalizedAttemptDisposition?.eligible === true,
      replayed: turn?.finalizedAttemptDisposition?.replayed === true,
      evidenceDigest: turn?.witness?.finalizedAttempt?.evidenceDigest || null,
    },
  };
}

function replayFemV1ShadowEvents({
  sessionState,
  learnerState,
  events,
  initialShadowState = null,
  cueResolver = resolvePitchAlphaCueForShadow,
} = {}) {
  if (!isPlainObject(sessionState)) throw new Error('shadow_replay_session_state_required');
  if (!isPlainObject(learnerState)) throw new Error('shadow_replay_learner_state_required');
  if (!Array.isArray(events)) throw new Error('shadow_replay_events_required');
  if (events.length > MAX_REPLAY_EVENTS) throw new Error('shadow_replay_event_capacity_exceeded');

  const normalizedEvents = events.map(normalizeReplayEvent);
  const ids = new Set();
  for (const event of normalizedEvents) {
    if (ids.has(event.eventId)) throw new Error('shadow_replay_duplicate_event_id');
    ids.add(event.eventId);
  }

  let state = initialShadowState
    ? normalizeFemV1ShadowState(initialShadowState)
    : createFemV1ShadowState({
      sessionId: sessionState.sessionId,
      sourceSessionRevision: Number.isInteger(sessionState.revision) ? sessionState.revision : null,
      sessionState,
      learnerState,
    });

  const rows = [];
  for (const event of normalizedEvents) {
    const resolved = resolveFemV1ShadowSessionTurn({
      shadowState: state,
      sessionState: {
        ...sessionState,
        revision: event.sourceSessionRevision == null
          ? sessionState.revision
          : event.sourceSessionRevision,
      },
      learnerState,
      sourceSessionRevision: event.sourceSessionRevision == null
        ? (Number.isInteger(sessionState.revision) ? sessionState.revision : null)
        : event.sourceSessionRevision,
      finalizedAttemptEvent: event.finalizedAttemptEvent,
      turnEvidence: event.turnEvidence,
      cueResolver,
      now: event.now,
    });
    state = resolved.nextShadowState;
    rows.push({
      eventId: event.eventId,
      turn: summarizeTurn(resolved.turn),
      shadowRevision: state.revision,
      stateDigest: digestJson(state),
    });
  }

  const receipt = {
    schema: FEM_V1_SHADOW_REPLAY_SCHEMA,
    sessionStateDigest: digestJson(sessionState),
    learnerStateDigest: digestJson(learnerState),
    initialShadowStateDigest: initialShadowState ? digestJson(initialShadowState) : null,
    eventCount: normalizedEvents.length,
    eventsDigest: digestJson(normalizedEvents),
    rows,
    finalShadowState: cloneJson(state),
  };
  return {
    ...receipt,
    replayDigest: digestJson(receipt),
  };
}

function compareFemV1ShadowReplays(left, right) {
  if (!left || left.schema !== FEM_V1_SHADOW_REPLAY_SCHEMA
    || !right || right.schema !== FEM_V1_SHADOW_REPLAY_SCHEMA) {
    throw new Error('shadow_replay_receipts_required');
  }
  return {
    identical: left.replayDigest === right.replayDigest,
    leftDigest: left.replayDigest,
    rightDigest: right.replayDigest,
    eventCountMatches: left.eventCount === right.eventCount,
    finalStateMatches: digestJson(left.finalShadowState) === digestJson(right.finalShadowState),
  };
}

module.exports = {
  FEM_V1_SHADOW_REPLAY_EVENT_SCHEMA,
  FEM_V1_SHADOW_REPLAY_SCHEMA,
  MAX_REPLAY_EVENTS,
  compareFemV1ShadowReplays,
  digestJson,
  normalizeReplayEvent,
  replayFemV1ShadowEvents,
};
