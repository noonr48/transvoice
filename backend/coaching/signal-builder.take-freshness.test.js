'use strict';

// Defect 3 (2026-07-26) — STALE take evidence must not drive repair_capture.
//
// Live witness: two coach turns on 2026-07-26 both resolved intent
// `repair_capture` with ZERO voice-trainer traffic. No fresh take existed at
// all; the coach was judging (and rejecting) a take from whenever the last DSP
// analysis happened, so it asked the learner to "record again" forever.
//
// The rule under test: a take is FRESH iff it was finalized at or after the
// start of the current turn window = max(session start, PREVIOUS input turn).
// Stale take evidence is treated as ABSENT (measurementAvailable null path,
// which stays usable) rather than as a REJECTED take.
//
// Prediction before running: stale -> continue_conversation with
// takeFreshness.gated true; fresh-and-rejected -> repair_capture; fresh-and-
// usable -> unchanged; no window -> unchanged (legacy callers untouched).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSignal,
  resolveTakeEvidenceFreshness,
  withTakeEvidenceAbsent,
} = require('./signal-builder');
const { assessSafetyState } = require('./safety-gates');
const { createVoiceStandaloneRuntime } = require('../voice-standalone-runtime');

const SESSION_STARTED_AT = 1_800_000_000_000;
const PREVIOUS_INPUT_TURN_AT = SESSION_STARTED_AT + 60_000;
const NOW = PREVIOUS_INPUT_TURN_AT + 30_000;

// An artifact the analyzer REJECTED: no voiced frames, no usable measurement.
// This is the shape that legitimately forces repair_capture.
function rejectedTake(finalizedAt) {
  const advanced = {
    measurementAvailable: false,
    scoreConfidence: 0.1,
    voicedFramePct: 0.02,
    confidentFramePct: 0.05,
    pitchValidFrameCount: 0,
    reliabilityFlags: ['no_voiced_frames'],
  };
  return {
    sessionStartedAt: SESSION_STARTED_AT,
    voiceInputRuntime: { previousInputTurnAt: PREVIOUS_INPUT_TURN_AT },
    lastTakeFinalizedAt: finalizedAt,
    lastSummary: { metrics: { meanPitchHz: 180, targetHitPct: 0.4, advanced } },
    lastAttemptArtifact: { finalizedAt, metrics: { advanced }, summary: { metrics: { advanced } } },
  };
}

// A clean, measured take.
function usableTake(finalizedAt) {
  const advanced = {
    measurementAvailable: true,
    scoreConfidence: 0.9,
    voicedFramePct: 0.85,
    confidentFramePct: 0.8,
    captureReliability: 0.9,
    pitchValidFrameCount: 120,
    snrDb: 24,
    clippingPct: 0,
  };
  return {
    sessionStartedAt: SESSION_STARTED_AT,
    voiceInputRuntime: { previousInputTurnAt: PREVIOUS_INPUT_TURN_AT },
    lastTakeFinalizedAt: finalizedAt,
    lastSummary: { metrics: { meanPitchHz: 190, targetHitPct: 0.82, advanced } },
    lastAttemptArtifact: { finalizedAt, metrics: { advanced }, summary: { metrics: { advanced } } },
  };
}

// ---------------------------------------------------------------------------
// The three behaviors the fix must guarantee
// ---------------------------------------------------------------------------

test('STALE rejected take: intent falls through to resolveIntent, NOT repair_capture', () => {
  // Finalized 5 s BEFORE the previous input turn -> belongs to a previous turn.
  const signal = buildSignal({
    voiceState: rejectedTake(PREVIOUS_INPUT_TURN_AT - 5_000),
    userMessage: 'How did that sound?',
    now: NOW,
  });

  assert.notEqual(
    signal.coachMove.intent,
    'repair_capture',
    'a take from a previous turn cannot demand a re-record now',
  );
  assert.equal(signal.coachMove.intent, 'continue_conversation');
  assert.equal(signal.decisionWitness.intent.takeFreshness.gated, true);
  assert.equal(signal.decisionWitness.intent.takeFreshness.reason, 'before_turn_window');
  // Treated as ABSENT, not as rejected: measurementAvailable is null, not false.
  assert.equal(signal.decisionWitness.metricContract.measurementAvailable, null);
});

test('FRESH rejected take: repair_capture still fires (the legitimate case)', () => {
  const signal = buildSignal({
    voiceState: rejectedTake(PREVIOUS_INPUT_TURN_AT + 1_000),
    userMessage: 'How did that sound?',
    now: NOW,
  });

  assert.equal(signal.coachMove.intent, 'repair_capture');
  assert.equal(signal.decisionWitness.intent.takeFreshness.gated, false);
  assert.equal(signal.decisionWitness.intent.takeFreshness.reason, 'in_turn_window');
  assert.equal(signal.decisionWitness.metricContract.measurementAvailable, false);
});

test('FRESH usable take: unchanged by the gate', () => {
  const gated = buildSignal({
    voiceState: usableTake(PREVIOUS_INPUT_TURN_AT + 1_000),
    userMessage: '',
    now: NOW,
  });
  const ungated = buildSignal({
    // Same take, no window to test against -> the legacy path.
    voiceState: { ...usableTake(PREVIOUS_INPUT_TURN_AT + 1_000), sessionStartedAt: null, voiceInputRuntime: {} },
    userMessage: '',
    now: NOW,
  });

  assert.equal(gated.coachMove.intent, ungated.coachMove.intent);
  assert.equal(gated.decisionWitness.intent.takeFreshness.gated, false);
  assert.equal(gated.decisionWitness.metricContract.measurementAvailable, true);
});

test('a take with no timestamp at all, inside a real session, is treated as absent', () => {
  const state = rejectedTake(null);
  delete state.lastTakeFinalizedAt;
  state.lastAttemptArtifact = {
    metrics: state.lastAttemptArtifact.metrics,
    summary: state.lastAttemptArtifact.summary,
  };
  const signal = buildSignal({ voiceState: state, userMessage: '', now: NOW });

  assert.notEqual(signal.coachMove.intent, 'repair_capture');
  assert.equal(signal.decisionWitness.intent.takeFreshness.reason, 'take_timestamp_missing');
});

test('safety capture_only cannot latch from a stale take alone', () => {
  // Capture-kind analyzer reasons only (low SNR + low confidence): with a FRESH
  // take this is exactly the capture_only path.
  const captureFault = (finalizedAt) => {
    const advanced = { scoreConfidence: 0.2, snrDb: 4, voicedFramePct: 0.9, confidentFramePct: 0.9 };
    return {
      sessionStartedAt: SESSION_STARTED_AT,
      voiceInputRuntime: { previousInputTurnAt: PREVIOUS_INPUT_TURN_AT },
      lastTakeFinalizedAt: finalizedAt,
      lastSummary: { metrics: { meanPitchHz: 180, advanced } },
      lastAttemptArtifact: { finalizedAt, metrics: { advanced }, summary: { metrics: { advanced } } },
    };
  };

  const freshState = captureFault(PREVIOUS_INPUT_TURN_AT + 1_000);
  const staleState = captureFault(SESSION_STARTED_AT - 86_400_000);

  // The gate's own contract, read straight off the safety assessor.
  assert.equal(
    assessSafetyState(freshState).state,
    'capture_only',
    'a fresh capture fault still speaks',
  );
  assert.equal(
    assessSafetyState(withTakeEvidenceAbsent(staleState)).state,
    'normal',
    'the same fault, once its stale take is gated out, has nothing to latch on',
  );

  // And end to end, through buildSignal, where the freshness gate decides.
  assert.equal(buildSignal({ voiceState: freshState, now: NOW }).coachMove.intent, 'repair_capture');
  const stale = buildSignal({ voiceState: staleState, now: NOW });
  assert.notEqual(stale.coachMove.intent, 'repair_capture', 'yesterday\'s capture fault does not gate today');
  assert.equal(stale.decisionWitness.intent.takeFreshness.gated, true);
});

// ---------------------------------------------------------------------------
// The rule itself
// ---------------------------------------------------------------------------

test('resolveTakeEvidenceFreshness: window = max(session start, previous input turn)', () => {
  const base = {
    sessionStartedAt: SESSION_STARTED_AT,
    voiceInputRuntime: { previousInputTurnAt: PREVIOUS_INPUT_TURN_AT },
    lastSummary: { metrics: {} },
  };

  // The later of the two wins: a take after session start but BEFORE the
  // previous input turn is still stale.
  assert.equal(
    resolveTakeEvidenceFreshness({ ...base, lastTakeFinalizedAt: SESSION_STARTED_AT + 1 }).fresh,
    false,
  );
  assert.equal(
    resolveTakeEvidenceFreshness({ ...base, lastTakeFinalizedAt: PREVIOUS_INPUT_TURN_AT }).fresh,
    true,
    'exactly at the window start counts as inside it',
  );
  // No previous input turn yet (first turn of a session): session start is the window.
  const firstTurn = { ...base, voiceInputRuntime: {} };
  assert.equal(
    resolveTakeEvidenceFreshness({ ...firstTurn, lastTakeFinalizedAt: SESSION_STARTED_AT + 1 }).fresh,
    true,
  );
  assert.equal(
    resolveTakeEvidenceFreshness({ ...firstTurn, lastTakeFinalizedAt: SESSION_STARTED_AT - 1 }).fresh,
    false,
  );
});

test('resolveTakeEvidenceFreshness fails OPEN when there is nothing to judge', () => {
  // No window at all -> never gated (every legacy caller keeps its behavior).
  assert.deepEqual(
    resolveTakeEvidenceFreshness({ lastSummary: { metrics: {} } }),
    { fresh: true, reason: 'window_unknown', takeFinalizedAt: null, turnWindowStartedAt: null },
  );
  // Window, but no take evidence -> nothing to gate.
  assert.equal(
    resolveTakeEvidenceFreshness({ sessionStartedAt: SESSION_STARTED_AT }).reason,
    'no_take_evidence',
  );
  // An explicit caller window overrides the derived one.
  assert.equal(
    resolveTakeEvidenceFreshness(
      { sessionStartedAt: 0, lastSummary: { metrics: {} }, lastTakeFinalizedAt: 500 },
      { turnWindowStartedAt: 1000 },
    ).fresh,
    false,
  );
});

// ---------------------------------------------------------------------------
// The witness, driven end to end through the runtime
// ---------------------------------------------------------------------------

function createCoachRuntime(events) {
  return createVoiceStandaloneRuntime({
    logger: { log: (event) => events.push(event), warn() {}, error() {} },
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
      recordVoiceAttempt: () => {},
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
}

test('the runtime logs coach_take_freshness ONLY when the gate actually fires', async () => {
  const staleEvents = [];
  const staleRuntime = createCoachRuntime(staleEvents);
  await staleRuntime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'stale-coach', studentId: 'stale-learner',
  });
  const staleSession = staleRuntime.sessions.get('stale-coach');
  const stale = rejectedTake(Date.now() - 86_400_000);
  staleSession.voiceState = {
    ...staleSession.voiceState,
    sessionStartedAt: Date.now() - 60_000,
    lastSummary: stale.lastSummary,
    lastAttemptArtifact: stale.lastAttemptArtifact,
    lastTakeFinalizedAt: Date.now() - 86_400_000,
  };
  await staleRuntime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId: 'stale-coach',
    message: 'How did that sound?',
  });
  const fired = staleEvents.find((event) => event?.event === 'coach_take_freshness');
  assert.ok(fired, `coach_take_freshness missing: ${JSON.stringify(staleEvents.map((e) => e.event))}`);
  assert.equal(fired.outcome, 'stale_take_evidence_ignored');
  assert.equal(fired.reason, 'before_turn_window');
  assert.notEqual(fired.intent, 'repair_capture');

  // A healthy turn adds NO new line.
  const healthyEvents = [];
  const healthyRuntime = createCoachRuntime(healthyEvents);
  await healthyRuntime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'fresh-coach', studentId: 'fresh-learner',
  });
  const healthySession = healthyRuntime.sessions.get('fresh-coach');
  const fresh = usableTake(Date.now());
  healthySession.voiceState = {
    ...healthySession.voiceState,
    sessionStartedAt: Date.now() - 60_000,
    lastSummary: fresh.lastSummary,
    lastAttemptArtifact: fresh.lastAttemptArtifact,
    lastTakeFinalizedAt: Date.now(),
  };
  await healthyRuntime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId: 'fresh-coach',
    message: 'How did that sound?',
  });
  assert.equal(
    healthyEvents.some((event) => event?.event === 'coach_take_freshness'),
    false,
    'a healthy turn emits zero new lines',
  );
});

test('withTakeEvidenceAbsent removes only the take, never the session', () => {
  const state = {
    ...usableTake(NOW),
    targetVoiceProfile: { profileId: 'p1' },
    activeLine: { displayText: 'a line' },
    coachThread: [{ role: 'coach' }],
  };
  const absent = withTakeEvidenceAbsent(state);
  assert.equal(absent.lastSummary, null);
  assert.equal(absent.lastAttemptArtifact, null);
  assert.deepEqual(absent.targetVoiceProfile, { profileId: 'p1' });
  assert.deepEqual(absent.activeLine, { displayText: 'a line' });
  assert.deepEqual(absent.coachThread, [{ role: 'coach' }]);
  assert.equal(state.lastSummary != null, true, 'the original state is not mutated');
});

// ---------------------------------------------------------------------------
// Defect 3 follow-up (reviewer advisory A2) — the CALLER's repContext must be
// gated too. The runtime derives repContext from voiceState.lastAttemptArtifact
// and passes it into buildSignal, where the ARGUMENT wins over the gated state.
// Ungated, a day-old hum kept setting takeKind 'hum_sovt' — and with it the
// vocalise-LENIENT strain warn bar — on a turn with no fresh take at all.
// ---------------------------------------------------------------------------

test('a gated turn does not take its takeKind from the stale take (caller + builder agree)', async () => {
  const runtime = createVoiceStandaloneRuntime({
    logger: false,
    sessions: new Map(),
    learnerContextService: {
      readProfile: () => ({ voice: { coachCheckpoint: null } }),
      updateCoachCheckpoint: () => {},
      getVoiceStudentModelSnapshot: async () => null,
      recordVoiceAttempt: () => {},
    },
    fetchImpl: async () => { throw new Error('offline test'); },
  });
  await runtime.appCompatibilityRouteHandlers.startSession({
    sessionId: 'kind-gate', studentId: 'kind-learner',
  });
  const session = runtime.sessions.get('kind-gate');

  // A hum take from YESTERDAY, with the sticky repContext it stamped.
  const humRepContext = { drill: { id: 'cute-vocalise-hum', kind: 'hum_sovt', tags: ['vocalise'] } };
  const staleHum = {
    sessionStartedAt: Date.now() - 60_000,
    lastTakeFinalizedAt: Date.now() - 86_400_000,
    repContext: humRepContext,
    lastSummary: { metrics: { meanPitchHz: 180, advanced: { measurementAvailable: true } } },
    lastAttemptArtifact: {
      finalizedAt: Date.now() - 86_400_000,
      repContext: humRepContext,
      summary: { metrics: { advanced: { measurementAvailable: true } } },
    },
  };
  session.voiceState = { ...session.voiceState, ...staleHum };

  const stale = await runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId: 'kind-gate', message: 'How did that sound?',
  });
  assert.notEqual(
    stale.coachingSignal.takeKind,
    'hum_sovt',
    'yesterday\'s hum must not set today\'s take kind',
  );
  assert.equal(stale.coachingSignal.takeKind, 'phrase');
  assert.equal(stale.coachingSignal.decisionWitness.takeKind.source, 'default');
  assert.equal(
    stale.coachingSignal.decisionWitness.strainInterpretation,
    'standard',
    'the vocalise-lenient strain bar must not ride a stale take',
  );

  // The SAME hum, finalized inside this turn window, is still honoured.
  session.voiceState = {
    ...session.voiceState,
    lastTakeFinalizedAt: Date.now(),
    repContext: humRepContext,
    lastAttemptArtifact: { ...staleHum.lastAttemptArtifact, finalizedAt: Date.now() },
  };
  const fresh = await runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId: 'kind-gate', message: 'How did that sound?',
  });
  assert.equal(fresh.coachingSignal.takeKind, 'hum_sovt', 'a fresh hum is still a hum');
  assert.equal(fresh.coachingSignal.decisionWitness.strainInterpretation, 'vocalise-lenient');
});

test('withTakeEvidenceAbsent also drops the sticky take repContext', () => {
  const absent = withTakeEvidenceAbsent({
    repContext: { drill: { kind: 'hum_sovt' } },
    lessonId: 'cute-phrase-1',
    targetPreset: 'cute-feminine',
  });
  assert.equal(absent.repContext, null);
  assert.equal(absent.lessonId, 'cute-phrase-1', 'the SELECTED drill is live state, not take evidence');
  assert.equal(absent.targetPreset, 'cute-feminine');
});
