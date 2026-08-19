'use strict';

// B-SESS sessions-ring contract tests (service surface).
// Predictions (written before first run):
//  - old entries (no endReason/tier/sessionId/at) normalize with nulls — additive
//  - addSession with a sessionId UPSERTS: one entry per session, moved to tail
//  - authority is completed > learner-stopped > cut-short
//  - entries without sessionId keep the legacy append behavior

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createLearnerContextService,
  normalizeSessionEntry,
  SESSION_END_REASONS,
  SESSION_TIERS,
} = require('./learner-context-service');

function makeService() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-session-ring-'));
  return createLearnerContextService({ storageRoot: root, logger: { warn() {} } });
}

test('vocab exports', () => {
  assert.deepEqual([...SESSION_END_REASONS], ['completed', 'cut-short', 'learner-stopped']);
  assert.deepEqual([...SESSION_TIERS], ['full', 'quiet', 'silent']);
});

test('pre-upgrade ring entries normalize additively (nulls, never dropped)', () => {
  const legacy = normalizeSessionEntry({
    date: '2026-07-01', startedAt: 1000, minutes: 4, takes: 3, focusAxis: 'pitch', oneLine: '3 takes on pitch',
  });
  assert.equal(legacy.endReason, null);
  assert.equal(legacy.tier, null);
  assert.equal(legacy.sessionId, null);
  assert.equal(legacy.at, null);
  assert.equal(legacy.takes, 3);

  const upgraded = normalizeSessionEntry({
    startedAt: 1000, endedAt: 2000, takes: 1, sessionId: 'sess-a', endReason: 'cut-short', tier: 'quiet',
  });
  assert.equal(upgraded.endReason, 'cut-short');
  assert.equal(upgraded.tier, 'quiet');
  assert.equal(upgraded.sessionId, 'sess-a');
  assert.equal(upgraded.at, 2000);

  const junk = normalizeSessionEntry({ startedAt: 1000, endReason: 'exploded', tier: 'loud' });
  assert.equal(junk.endReason, null);
  assert.equal(junk.tier, null);
});

test('addSession upserts by sessionId: cut-short upgrades to completed, one entry', () => {
  const svc = makeService();
  svc.addSession('s1', {
    sessionId: 'sess-a', startedAt: 1000, endedAt: 2000, minutes: 1, takes: 2,
    focusAxis: 'pitch', oneLine: '2 takes on pitch', endReason: 'cut-short', tier: 'full',
  });
  let profile = svc.readProfile('s1');
  assert.equal(profile.voice.sessions.length, 1);
  assert.equal(profile.voice.sessions[0].endReason, 'cut-short');

  svc.addSession('s1', {
    sessionId: 'sess-a', startedAt: 1000, endedAt: 3000, minutes: 2, takes: 5,
    focusAxis: 'pitch', oneLine: '5 takes on pitch', endReason: 'completed', tier: 'full',
  });
  profile = svc.readProfile('s1');
  assert.equal(profile.voice.sessions.length, 1, 'one entry per sessionId');
  assert.equal(profile.voice.sessions[0].endReason, 'completed');
  assert.equal(profile.voice.sessions[0].takes, 5, 'upsert carries the fresh stats');
  assert.equal(profile.voice.sessions[0].at, 3000);
});

test('upsert moves the refreshed entry to the tail (newest-LAST stays honest)', () => {
  const svc = makeService();
  svc.addSession('s2', { sessionId: 'sess-a', startedAt: 1000, endedAt: 1500, endReason: 'cut-short' });
  svc.addSession('s2', { sessionId: 'sess-b', startedAt: 2000, endedAt: 2500, endReason: 'completed' });
  svc.addSession('s2', { sessionId: 'sess-a', startedAt: 1000, endedAt: 3000, endReason: 'completed' });
  const sessions = svc.readProfile('s2').voice.sessions;
  assert.equal(sessions.length, 2);
  assert.equal(sessions[0].sessionId, 'sess-b');
  assert.equal(sessions[1].sessionId, 'sess-a', 'the re-closed session is newest');
  assert.equal(sessions[1].endReason, 'completed');
});

test('completed is terminal: a later cut-short write never downgrades it', () => {
  const svc = makeService();
  svc.addSession('s3', { sessionId: 'sess-a', startedAt: 1000, endedAt: 2000, takes: 4, endReason: 'completed' });
  svc.addSession('s3', { sessionId: 'sess-a', startedAt: 1000, endedAt: 3000, takes: 0, endReason: 'cut-short' });
  const sessions = svc.readProfile('s3').voice.sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].endReason, 'completed');
  assert.equal(sessions[0].takes, 4, 'the completed record keeps its stats');
});

test('explicit learner End is not downgraded by a later pagehide signal', () => {
  const svc = makeService();
  svc.addSession('s3b', {
    sessionId: 'sess-a',
    startedAt: 1000,
    endedAt: 2000,
    takes: 4,
    endReason: 'learner-stopped',
  });
  svc.addSession('s3b', {
    sessionId: 'sess-a',
    startedAt: 1000,
    endedAt: 3000,
    takes: 0,
    endReason: 'cut-short',
  });
  const sessions = svc.readProfile('s3b').voice.sessions;
  assert.equal(sessions.length, 1);
  assert.equal(sessions[0].endReason, 'learner-stopped');
  assert.equal(sessions[0].takes, 4);
});

test('entries without a sessionId keep legacy append behavior', () => {
  const svc = makeService();
  svc.addSession('s4', { startedAt: 1000, endedAt: 1500 });
  svc.addSession('s4', { startedAt: 2000, endedAt: 2500 });
  assert.equal(svc.readProfile('s4').voice.sessions.length, 2);
});

test('lastSessionAt reflects the latest end signal', () => {
  const svc = makeService();
  svc.addSession('s5', { sessionId: 'sess-a', startedAt: 1000, endedAt: 4321, endReason: 'cut-short' });
  assert.equal(svc.readProfile('s5').voice.lastSessionAt, 4321);
});
