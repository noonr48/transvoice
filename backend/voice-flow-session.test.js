'use strict';

// B-SESS flow-session backbone tests (runtime surface).
// Predictions (written before first run):
//  - pause beacon then clean close -> ONE ring entry, endReason 'completed'
//  - repeated beacon with no intervening activity -> second write skipped
//  - sweep ring-writes ONLY stale + lesson-active + not-ended sessions, once
//  - init-time sweep catches stale sessions restored at construction
//  - scope route validates enum/boolean, partial-updates, echoes sessionScope
//  - ring entries carry {sessionId, at, endReason, tier}

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createVoiceStandaloneApp,
  createVoiceStandaloneRuntime,
} = require('./voice-standalone-runtime');
const { createLearnerContextService } = require('./learner-context-service');

const STALE_MS = 21 * 60 * 1000; // past the 20-minute staleness cutoff

function makeTempService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-flow-session-'));
  return createLearnerContextService({ storageRoot: root, logger: { warn() {} } });
}

function makeSession(overrides = {}) {
  const now = Date.now();
  return {
    id: 'sess-flow-1',
    agentId: 'voice-tutor-standalone',
    studentId: 'flow-tester',
    createdAt: now,
    updatedAt: now,
    mode: 'voice',
    voiceState: { status: 'ready' },
    lessonState: { status: 'active' },
    ...overrides,
  };
}

function makeRuntime({ learnerContextService, sessions = new Map() } = {}) {
  return createVoiceStandaloneRuntime({
    logger: false,
    sessions,
    learnerContextService,
    fetchImpl: async () => { throw new Error('offline (test)'); },
  });
}

test('beacon then clean close converges on ONE ring entry, upgraded to completed', async () => {
  const svc = makeTempService();
  const runtime = makeRuntime({ learnerContextService: svc });
  const session = makeSession();
  runtime.sessions.set(session.id, session);

  const beacon = runtime.voiceOperationRouteHandlers.pauseVoiceSessionBeacon(session.id);
  assert.equal(beacon.success, true);
  assert.equal(beacon.recorded, true);
  assert.equal(beacon.hadActivity, false);

  let profile = svc.readProfile('flow-tester');
  assert.equal(profile.voice.sessions.length, 1);
  assert.equal(profile.voice.sessions[0].endReason, 'cut-short');
  assert.equal(profile.voice.sessions[0].sessionId, session.id);
  assert.equal(profile.voice.sessions[0].tier, 'full');
  assert.ok(Number.isFinite(profile.voice.sessions[0].at));

  // The session must stay resumable: nothing ended, nothing torn down.
  assert.notEqual(runtime.sessions.get(session.id).voiceState.status, 'ended');

  await runtime.voiceOperationRouteHandlers.endVoiceSession({ sessionId: session.id });

  profile = svc.readProfile('flow-tester');
  assert.equal(profile.voice.sessions.length, 1, 'clean close must NOT double-write');
  assert.equal(profile.voice.sessions[0].endReason, 'completed');
  assert.equal(profile.voice.sessions[0].sessionId, session.id);
});

test('repeated beacon with no intervening activity is skipped; activity re-arms it', () => {
  const svc = makeTempService();
  const runtime = makeRuntime({ learnerContextService: svc });
  const session = makeSession({ id: 'sess-flow-2', studentId: 'flow-tester-2' });
  runtime.sessions.set(session.id, session);

  const first = runtime.voiceOperationRouteHandlers.pauseVoiceSessionBeacon(session.id);
  assert.equal(first.recorded, true);
  const second = runtime.voiceOperationRouteHandlers.pauseVoiceSessionBeacon(session.id);
  assert.equal(second.recorded, false, 'no activity since last ring write -> skip');

  let profile = svc.readProfile('flow-tester-2');
  assert.equal(profile.voice.sessions.length, 1);

  // Simulate later activity, then another abandon: same single entry, refreshed.
  session.updatedAt = Date.now() + 25;
  const third = runtime.voiceOperationRouteHandlers.pauseVoiceSessionBeacon(session.id);
  assert.equal(third.recorded, true);
  profile = svc.readProfile('flow-tester-2');
  assert.equal(profile.voice.sessions.length, 1, 'upsert by sessionId keeps one entry');
  assert.equal(profile.voice.sessions[0].endReason, 'cut-short');
});

test('beacon on unknown or ended sessions records nothing', () => {
  const svc = makeTempService();
  const runtime = makeRuntime({ learnerContextService: svc });
  const missing = runtime.voiceOperationRouteHandlers.pauseVoiceSessionBeacon('sess-nope');
  assert.equal(missing.success, true);
  assert.equal(missing.recorded, false);
  assert.equal(missing.reason, 'not-found');

  const ended = makeSession({ id: 'sess-ended', voiceState: { status: 'ended' } });
  runtime.sessions.set(ended.id, ended);
  const result = runtime.voiceOperationRouteHandlers.pauseVoiceSessionBeacon(ended.id);
  assert.equal(result.recorded, false);
  assert.equal(svc.readProfile('flow-tester').voice.sessions.length, 0);
});

test('sweep ring-writes stale lesson-active sessions only, and is idempotent', () => {
  const svc = makeTempService();
  const runtime = makeRuntime({ learnerContextService: svc });
  const now = Date.now();
  const staleActive = makeSession({
    id: 'sess-stale-active', studentId: 'sweep-tester', updatedAt: now - STALE_MS,
  });
  const freshActive = makeSession({
    id: 'sess-fresh-active', studentId: 'sweep-tester', updatedAt: now,
  });
  const staleEnded = makeSession({
    id: 'sess-stale-ended', studentId: 'sweep-tester', updatedAt: now - STALE_MS,
    voiceState: { status: 'ended' },
  });
  const staleComplete = makeSession({
    id: 'sess-stale-complete', studentId: 'sweep-tester', updatedAt: now - STALE_MS,
    lessonState: { status: 'complete' },
  });
  for (const s of [staleActive, freshActive, staleEnded, staleComplete]) {
    runtime.sessions.set(s.id, s);
  }

  assert.equal(runtime.sweepStaleCutShortSessions(), 1, 'exactly the stale+active session');
  const profile = svc.readProfile('sweep-tester');
  assert.equal(profile.voice.sessions.length, 1);
  assert.equal(profile.voice.sessions[0].sessionId, 'sess-stale-active');
  assert.equal(profile.voice.sessions[0].endReason, 'cut-short');

  assert.equal(runtime.sweepStaleCutShortSessions(), 0, 're-sweep writes nothing new');
  assert.equal(svc.readProfile('sweep-tester').voice.sessions.length, 1);
});

test('runtime init sweeps sessions restored with a live lesson and stale updatedAt', () => {
  const svc = makeTempService();
  const sessions = new Map();
  const stale = makeSession({
    id: 'sess-restored-stale', studentId: 'restore-tester', updatedAt: Date.now() - STALE_MS,
  });
  sessions.set(stale.id, stale);
  makeRuntime({ learnerContextService: svc, sessions });

  const profile = svc.readProfile('restore-tester');
  assert.equal(profile.voice.sessions.length, 1);
  assert.equal(profile.voice.sessions[0].endReason, 'cut-short');
  assert.equal(profile.voice.sessions[0].sessionId, 'sess-restored-stale');
});

test('clean close persists the session sessionScope tier onto the ring entry', async () => {
  const calls = [];
  const runtime = makeRuntime({
    learnerContextService: {
      addSession: (studentId, entry) => calls.push({ studentId, entry }),
      getVoiceStudentModelSnapshot: async () => null,
    },
  });
  const session = makeSession({
    id: 'sess-tier', studentId: 'tier-tester', sessionScope: { tier: 'quiet', eyesFree: true },
  });
  runtime.sessions.set(session.id, session);

  await runtime.voiceOperationRouteHandlers.endVoiceSession({ sessionId: session.id });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].entry.tier, 'quiet');
  assert.equal(calls[0].entry.endReason, 'completed');
  assert.equal(calls[0].entry.sessionId, 'sess-tier');
  assert.ok(Number.isFinite(calls[0].entry.endedAt));
});

test('scope + paused routes: guard-mirrored registration, validation, payload echo', async () => {
  const { app, runtime } = createVoiceStandaloneApp({
    logger: false,
    sessions: new Map(),
    learnerContextService: {
      addSession: () => {},
      getVoiceStudentModelSnapshot: async () => null,
    },
    fetchImpl: async () => { throw new Error('offline (test)'); },
  });
  const session = makeSession({ id: 'sess-http-1', studentId: 'http-tester' });
  runtime.sessions.set(session.id, session);

  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    // Default scope rides every session payload (extras key `sessionScope`).
    const getResp = await fetch(`${base}/voice/session/sess-http-1`);
    assert.equal(getResp.status, 200);
    const getBody = await getResp.json();
    assert.deepEqual(getBody.sessionScope, { tier: 'full', eyesFree: false });

    // Partial update: tier only.
    const quietResp = await fetch(`${base}/voice/session/sess-http-1/scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'quiet' }),
    });
    assert.equal(quietResp.status, 200);
    const quietBody = await quietResp.json();
    assert.deepEqual(quietBody.sessionScope, { tier: 'quiet', eyesFree: false });

    // Partial update: eyesFree only (tier preserved).
    const eyesResp = await fetch(`${base}/voice/session/sess-http-1/scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eyesFree: true }),
    });
    assert.equal(eyesResp.status, 200);
    assert.deepEqual((await eyesResp.json()).sessionScope, { tier: 'quiet', eyesFree: true });

    // Enum/boolean validation.
    const badTier = await fetch(`${base}/voice/session/sess-http-1/scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'loud' }),
    });
    assert.equal(badTier.status, 400);
    const badEyes = await fetch(`${base}/voice/session/sess-http-1/scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eyesFree: 'yes' }),
    });
    assert.equal(badEyes.status, 400);
    const unknown = await fetch(`${base}/voice/session/sess-none/scope`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tier: 'full' }),
    });
    assert.equal(unknown.status, 404);

    // Pause beacon: sendBeacon-shaped request (text/plain, opaque body, no
    // custom headers) must be admitted and handled from the path param alone.
    const beaconResp = await fetch(`${base}/voice/session/sess-http-1/paused`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'beacon',
    });
    assert.equal(beaconResp.status, 200);
    const beaconBody = await beaconResp.json();
    assert.equal(beaconBody.success, true);
    assert.equal(beaconBody.recorded, true);
    const beaconMissing = await fetch(`${base}/voice/session/sess-none/paused`, { method: 'POST' });
    assert.equal(beaconMissing.status, 200);
    assert.equal((await beaconMissing.json()).recorded, false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
