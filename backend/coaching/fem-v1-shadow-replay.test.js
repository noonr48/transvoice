'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createBeginnerMasteryState } = require('./beginner-mastery');
const { createAttemptFinalizedEvent } = require('./attempt-finalized-event');
const {
  FEM_V1_SHADOW_REPLAY_EVENT_SCHEMA,
  compareFemV1ShadowReplays,
  replayFemV1ShadowEvents,
} = require('./fem-v1-shadow-replay');

function sessionState() {
  return {
    sessionId: 'replay-session-1',
    stage: 'phrase',
    revision: 3,
    pendingTrial: null,
    attemptSequence: null,
  };
}

function learnerState() {
  return {
    mastery: createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' }),
    motorResponseMap: null,
  };
}

function finalized(eventId, artifactId, overrides = {}) {
  return createAttemptFinalizedEvent({
    eventId,
    sessionId: 'replay-session-1',
    attemptArtifactId: artifactId,
    expectedSessionRevision: 3,
    finalizedAt: overrides.finalizedAt || 1755400000000,
    eligible: overrides.eligible !== false,
    ineligibleReason: overrides.eligible === false ? 'capture_unusable' : null,
    evidence: {
      selfReport: overrides.selfReport || { effort: 2 },
      captureEvidence: overrides.captureEvidence || { usable: true, reasons: [] },
      observations: overrides.observations || [],
    },
  });
}

function replayEvent(eventId, finalizedAttemptEvent, now) {
  return {
    schema: FEM_V1_SHADOW_REPLAY_EVENT_SCHEMA,
    eventId,
    sourceSessionRevision: 3,
    finalizedAttemptEvent,
    now,
  };
}

test('same sealed event stream produces byte-stable replay receipts', () => {
  const events = [
    replayEvent('r1', finalized('a-event-1', 'attempt-1'), 1755400001000),
    replayEvent('r2', finalized('a-event-2', 'attempt-2', { finalizedAt: 1755400002000 }), 1755400002000),
  ];
  const first = replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(), events,
  });
  const second = replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(), events,
  });
  assert.deepEqual(compareFemV1ShadowReplays(first, second), {
    identical: true,
    leftDigest: first.replayDigest,
    rightDigest: second.replayDigest,
    eventCountMatches: true,
    finalStateMatches: true,
  });
  assert.deepEqual(first, second);
  assert.equal(first.finalShadowState.sessionState.attemptSequence.nextOrdinal, 3);
});

test('restart from a serialized midpoint reproduces the uninterrupted final state', () => {
  const firstEvent = replayEvent('r1', finalized('a-event-1', 'attempt-1'), 1755400001000);
  const secondEvent = replayEvent('r2', finalized('a-event-2', 'attempt-2', { finalizedAt: 1755400002000 }), 1755400002000);

  const uninterrupted = replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(), events: [firstEvent, secondEvent],
  });
  const prefix = replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(), events: [firstEvent],
  });
  const restoredState = JSON.parse(JSON.stringify(prefix.finalShadowState));
  const suffix = replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(), events: [secondEvent],
    initialShadowState: restoredState,
  });
  assert.deepEqual(suffix.finalShadowState, uninterrupted.finalShadowState);
});

test('replay receipt is privacy bounded and excludes raw cue prose', () => {
  const result = replayFemV1ShadowEvents({
    sessionState: sessionState(),
    learnerState: learnerState(),
    events: [replayEvent('r1', finalized('a-event-1', 'attempt-1'), 1755400001000)],
  });
  const json = JSON.stringify(result.rows);
  assert.ok(!json.includes('instruction'));
  assert.ok(!json.includes('rationale'));
  assert.ok(!json.includes('observations'));
});

test('duplicate replay event ids fail closed', () => {
  const item = replayEvent('duplicate', finalized('a-event-1', 'attempt-1'), 1755400001000);
  assert.throws(() => replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(), events: [item, item],
  }), /shadow_replay_duplicate_event_id/);
});

test('replay event must contain exactly one authoritative payload type', () => {
  assert.throws(() => replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(),
    events: [{ schema: FEM_V1_SHADOW_REPLAY_EVENT_SCHEMA, eventId: 'empty' }],
  }), /shadow_replay_event_payload_invalid/);
});

test('changing sealed evidence changes the replay digest', () => {
  const a = replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(),
    events: [replayEvent('r1', finalized('a-event-1', 'attempt-1'), 1755400001000)],
  });
  const b = replayFemV1ShadowEvents({
    sessionState: sessionState(), learnerState: learnerState(),
    events: [replayEvent('r1', finalized('a-event-1', 'attempt-1', { selfReport: { effort: 3 } }), 1755400001000)],
  });
  const comparison = compareFemV1ShadowReplays(a, b);
  assert.equal(comparison.identical, false);
  assert.equal(comparison.finalStateMatches, false);
});
