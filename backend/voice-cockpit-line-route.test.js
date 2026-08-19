'use strict';

// Route-level coverage for POST /voice/cockpit/line after the 2026-07-19
// catalog wiring: `regenerate` serves lines from the voice-cockpit-lines
// LINE_LIBRARY (per-preset seed pool) while ensure/next keep the drill path.
// Proves a non-default (soft-feminine) session serves that preset's catalog
// lines. RE-POINTED 2026-07-26: was the masculine preset, retired with the
// masculinizing direction. RE-POINTED again 2026-07-30 (the neutral presets are
// retired too): soft-feminine is the non-default lane now. Nothing here is about
// direction — the test only needs a live preset that is not the default.

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createVoiceStandaloneApp } = require('./voice-standalone-runtime');
const { pickVoiceCockpitCatalogLine } = require('./voice-cockpit-lines');

function offlineFetchImpl() {
  // Hermetic: every upstream call fails fast; the routes under test never need one.
  return async () => {
    throw new Error('offline test fetch — no upstream allowed');
  };
}

function startTestApp() {
  return new Promise((resolve, reject) => {
    const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-cockpit-test-'));
    try {
      const { app, runtime } = createVoiceStandaloneApp({
        fetchImpl: offlineFetchImpl(),
        disableSessionPersistence: true,
        stateRoot,
        learnerContextRoot: path.join(stateRoot, 'learner-context'),
      });
      const server = app.listen(0, '127.0.0.1', () => {
        resolve({ server, runtime, stateRoot, baseUrl: `http://127.0.0.1:${server.address().port}` });
      });
      server.on('error', (error) => {
        fs.rmSync(stateRoot, { recursive: true, force: true });
        reject(error);
      });
    } catch (error) {
      fs.rmSync(stateRoot, { recursive: true, force: true });
      reject(error);
    }
  });
}

async function httpPost(baseUrl, path, body) {
  const resp = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  return { status: resp.status, body: await resp.json() };
}

describe('POST /voice/cockpit/line catalog wiring', () => {
  let ctx;
  let sessionId;

  before(async () => {
    ctx = await startTestApp();
    const { status, body } = await httpPost(ctx.baseUrl, '/session/start', { targetPreset: 'soft-feminine' });
    assert.equal(status, 200);
    assert.ok(body.sessionId, 'session id issued');
    assert.equal(body.voiceState.targetPreset, 'soft-feminine');
    sessionId = body.sessionId;
  });

  after(async () => {
    if (!ctx?.server) return;
    await new Promise((resolve) => {
      ctx.server.close(() => resolve());
      ctx.server.closeAllConnections?.();
    });
    fs.rmSync(ctx.stateRoot, { recursive: true, force: true });
  });

  it('regenerate serves a soft-* catalog line for a soft-feminine session', async () => {
    const { status, body } = await httpPost(ctx.baseUrl, '/voice/cockpit/line', {
      sessionId,
      action: 'regenerate',
    });
    assert.equal(status, 200);
    const line = body.voiceState.activeLine;
    assert.ok(line, 'active line present');
    assert.match(line.id, /^generated-soft-feminine-soft-/, `catalog id, got "${line.id}"`);
    assert.equal(line.source, 'generated');
    assert.equal(line.targetPreset, 'soft-feminine');
    assert.ok(line.displayText.trim().length > 0, 'display text present');
    assert.ok(line.cueSheet, 'cue sheet attached');
    assert.equal(line.pinned, false, 'unpinned by default');
  });

  it('a second regenerate rotates to a different catalog line', async () => {
    const first = await httpPost(ctx.baseUrl, '/voice/cockpit/line', { sessionId, action: 'regenerate' });
    const second = await httpPost(ctx.baseUrl, '/voice/cockpit/line', { sessionId, action: 'regenerate' });
    const firstLine = first.body.voiceState.activeLine;
    const secondLine = second.body.voiceState.activeLine;
    assert.match(secondLine.id, /^generated-soft-feminine-soft-/);
    assert.notEqual(secondLine.displayText, firstLine.displayText, 'rotation varies the phrase');
  });

  it('next keeps the drill path (complementary sources, not competing)', async () => {
    const { status, body } = await httpPost(ctx.baseUrl, '/voice/cockpit/line', {
      sessionId,
      action: 'next',
    });
    assert.equal(status, 200);
    const line = body.voiceState.activeLine;
    assert.ok(line);
    assert.match(line.id, /^voice-line-next/, `drill-path id, got "${line.id}"`);
    assert.doesNotMatch(line.id, /^generated-/);
  });

  it('regenerate on a default session serves the cute-feminine catalog', async () => {
    // Continuity now resumes a learner's prior checkpoint by default. This test
    // explicitly asks for a clean session because it is validating defaults.
    const started = await httpPost(ctx.baseUrl, '/session/start', {
      forceNewSession: true,
      studentId: 'fresh-default-catalog',
    });
    const defaultSessionId = started.body.sessionId;
    const { body } = await httpPost(ctx.baseUrl, '/voice/cockpit/line', {
      sessionId: defaultSessionId,
      action: 'regenerate',
    });
    assert.match(body.voiceState.activeLine.id, /^generated-cute-feminine-cute-/);
  });
});

describe('pickVoiceCockpitCatalogLine', () => {
  it('rotates deterministically from the current catalog line and wraps', () => {
    const first = pickVoiceCockpitCatalogLine({ targetPreset: 'soft-feminine' });
    const second = pickVoiceCockpitCatalogLine({
      targetPreset: 'soft-feminine',
      currentLineId: first.id,
      excludeText: first.displayText,
    });
    assert.notEqual(second.displayText, first.displayText);
    assert.match(second.id, /^generated-soft-feminine-soft-/);
  });

  it('skips a repeated display text even when the id is not a catalog id', () => {
    const first = pickVoiceCockpitCatalogLine({ targetPreset: 'soft-feminine' });
    const next = pickVoiceCockpitCatalogLine({
      targetPreset: 'soft-feminine',
      currentLineId: 'voice-line-ensure-abc123',
      excludeText: first.displayText,
    });
    assert.notEqual(next.displayText, first.displayText);
  });

  it('strips internal ranking fields from the served line', () => {
    const line = pickVoiceCockpitCatalogLine({ targetPreset: 'soft-feminine' });
    assert.ok(!('_tags' in line), 'no _tags leak');
    assert.ok(!('_referenceFriendly' in line), 'no _referenceFriendly leak');
  });

  it('falls back to the cute-feminine pool on unknown presets', () => {
    const line = pickVoiceCockpitCatalogLine({ targetPreset: 'mystery-voice' });
    assert.match(line.id, /^generated-cute-feminine-/);
  });
});
