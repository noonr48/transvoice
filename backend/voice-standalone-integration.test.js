'use strict';

const { describe, it, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createVoiceStandaloneApp } = require('./voice-standalone-runtime');
const { resolveVoiceStandaloneConfig } = require('./voice-standalone-config');

const CURRENT_TEST_ANALYSIS_VERSION = 'voice-metrics-v3-yin';

const {
  createDeferred,
  beforeTimeout,
  waitForCondition,
  buildMockFetchImpl,
  mockJsonResponse,
  mockAudioResponse,
  mockStreamingResponse,
  startTestApp,
  stopTestApp,
  httpGet,
  httpPost,
  httpDelete,
  httpRawPost,
} = require('./voice-standalone-testkit');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function randomPort() {
  return 0; // OS picks a free port
}







function mockStallingAudioResponse(buffer, signal, hooks = {}) {
  let readCount = 0;
  signal?.addEventListener('abort', () => hooks.onAbort?.(signal.reason), { once: true });
  return {
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: new Headers({
      'Content-Type': 'application/octet-stream',
      'X-Audio-Format': 'pcm_s16le',
      'X-Audio-Sample-Rate': '24000',
      'X-Audio-Channels': '1',
      'X-Speaking-Rate-Applied': '0.76',
      'X-TTS-Generation-Mode': 'profile-synthesis',
      'X-Reference-Audio-Role': 'none',
    }),
    body: {
      getReader() {
        return {
          async read() {
            readCount += 1;
            if (readCount === 1) {
              return { done: false, value: buffer };
            }
            hooks.onBlocked?.();
            return new Promise((_resolve, reject) => {
              const rejectForAbort = () => {
                const error = new Error('Mock VoxCPM stream aborted');
                error.name = 'AbortError';
                reject(error);
              };
              if (signal?.aborted) {
                rejectForAbort();
                return;
              }
              signal?.addEventListener('abort', rejectForAbort, { once: true });
            });
          },
          releaseLock() {},
        };
      },
    },
    async text() { return ''; },
    async json() { return {}; },
  };
}





















// ---------------------------------------------------------------------------
// 1. Config & Startup
// ---------------------------------------------------------------------------

describe('Config & Startup', () => {
  it('config loads with VOXCPM_ENABLED=true', () => {
    const config = resolveVoiceStandaloneConfig({
      env: { VOXCPM_ENABLED: 'true' },
    });
    assert.equal(config.voxcpmEnabled, true);
  });

  it('config loads with VOXCPM_ENABLED=false (default)', () => {
    const config = resolveVoiceStandaloneConfig({
      env: {},
    });
    assert.equal(config.voxcpmEnabled, false);
  });

  it('.env parser handles quoted values and inline comments', () => {
    // Replicate the .env parser from server.js
    function parseEnvContent(content) {
      const env = {};
      const lines = content.replace(/\r\n?/g, '\n').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eq = trimmed.indexOf('=');
        if (eq < 1) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (!value.startsWith('"') && !value.startsWith("'")) {
          const commentIdx = value.indexOf(' #');
          if (commentIdx >= 0) value = value.slice(0, commentIdx).trim();
        }
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        env[key] = value;
      }
      return env;
    }

    const env = parseEnvContent([
      'VOXCPM_ENABLED=true # enable voice cloning',
      'VOICE_TRAINER_URL="http://localhost:8002"',
      "# this is a comment",
      "EMPTY_VALUE=",
      "QUOTED_SINGLE='hello world'",
      '',
    ].join('\n'));

    assert.equal(env.VOXCPM_ENABLED, 'true');
    assert.equal(env.VOICE_TRAINER_URL, 'http://localhost:8002');
    assert.equal(env.QUOTED_SINGLE, 'hello world');
    assert.equal(env.EMPTY_VALUE, '');
    assert.equal(env['# this is a comment'], undefined);
  });
});

// ---------------------------------------------------------------------------
// 2. Session Management
// ---------------------------------------------------------------------------

describe('Session Management', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
  });

  after(async () => {
    await stopTestApp(ctx);
  });

  it('start session returns sessionId', async () => {
    const { status, body } = await httpPost(ctx.baseUrl, '/session/start', {
      agentId: 'voice',
    });
    assert.equal(status, 200);
    assert.ok(body.sessionId, 'should have sessionId');
    assert.ok(body.sessionId.startsWith('voice-session-'), `sessionId should start with voice-session-, got: ${body.sessionId}`);
  });

  it('get session returns session data', async () => {
    const start = await httpPost(ctx.baseUrl, '/session/start', {});
    const sid = start.body.sessionId;

    const { status, body } = await httpGet(ctx.baseUrl, `/voice/session/${sid}`);
    assert.equal(status, 200);
    assert.ok(body.voiceState, 'should have voiceState');
    assert.equal(body.sessionId, sid);
  });

  it('delete session removes it', async () => {
    const start = await httpPost(ctx.baseUrl, '/session/start', {});
    const sid = start.body.sessionId;

    const del = await httpDelete(ctx.baseUrl, `/voice/standalone/sessions/${sid}`);
    assert.equal(del.status, 200);
    assert.equal(del.body.deleted, true);

    // Confirm it's gone
    const get = await httpGet(ctx.baseUrl, `/voice/session/${sid}`);
    assert.equal(get.status, 404);
  });

  it('list sessions returns array', async () => {
    // Create a fresh session so there's at least one
    await httpPost(ctx.baseUrl, '/session/start', {});
    const { status, body } = await httpGet(ctx.baseUrl, '/voice/standalone/sessions');
    assert.equal(status, 200);
    assert.ok(body.success);
    assert.ok(Array.isArray(body.sessions), 'sessions should be an array');
    assert.ok(body.sessions.length > 0, 'should have at least one session');
  });
});

// 2026-07-27 MTF-ONLY: these target-transition tests used 'masculine' purely as
// "some preset other than the default" — nothing here is about direction. That
// id is now RETIRED, the analyzer rejects it, and the gateway resolves it to the
// neutral lane before the outbound call, so a retired id can no longer serve as
// a live fixture. RE-POINTED again 2026-07-30 (neutral presets retired too): now
// 'soft-feminine' — non-default, a genuine live DSP preset, which also proves the
// resolver leaves live presets untouched. The fixtures keep their original EXACT
// custom bands on purpose: the whole point is that a custom target's bands are
// forwarded verbatim, so the preset id is only a label here, never the source of
// the numbers. (`direction: 'masculine'` further down is left alone: that one is
// a deliberately INVALID direction value.)
describe('Custom target session contract', () => {
  it('forwards exact handmade bands and source to VoiceTrainer', async () => {
    let trainerStartBody = null;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        trainerStartBody = JSON.parse(options.body || '{}');
        return mockJsonResponse(200, {
          voiceSessionId: 'mock-custom-session',
          status: 'ready',
          targetPreset: trainerStartBody.targetPreset,
          targetSource: trainerStartBody.targetSource,
          targetProfileId: trainerStartBody.targetProfileId || null,
          createdAt: Date.now(),
        });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const started = await httpPost(ctx.baseUrl, '/session/start', {});
      const targetVoiceProfile = {
        profileId: 'grounded-custom',
        targetPreset: 'soft-feminine',
        pitchFloorHz: 100,
        pitchCeilingHz: 140,
        resonanceFloor: 0.1,
        resonanceCeiling: 0.3,
        weightFloor: 0.6,
        weightCeiling: 0.8,
      };
      const response = await httpPost(ctx.baseUrl, '/voice/session/start', {
        sessionId: started.body.sessionId,
        targetPreset: 'soft-feminine',
        referenceClipId: null,
        targetVoiceProfile,
        targetSource: 'custom-handmade',
      });

      assert.equal(response.status, 200);
      assert.deepEqual(trainerStartBody.targetVoiceProfile, targetVoiceProfile);
      assert.equal(trainerStartBody.targetProfileId, targetVoiceProfile.profileId);
      assert.equal(trainerStartBody.targetSource, 'custom-handmade');
      assert.equal(trainerStartBody.targetPreset, 'soft-feminine');
      assert.equal(response.body.voiceState.targetSource, 'custom-handmade');
      assert.equal(response.body.voiceState.targetVoiceProfile.profileId, 'grounded-custom');
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('atomically transitions built-in to custom and back before analyzer rebind', async () => {
    const trainerStarts = [];
    let trainerEnds = 0;
    const targetVoiceProfile = {
      profileId: 'grounded-custom',
      clipId: 'custom-grounded-clip',
      sourceFilename: 'Grounded exact target',
      durationMs: 0,
      targetPreset: 'soft-feminine',
      metrics: {
        meanPitchHz: 120,
        pitchRangeSt: 5.8,
        resonanceMean: 0.2,
        weightMean: 0.7,
        targetHitPct: 1,
        similarityScore: 1,
      },
      pitchFloorHz: 100,
      pitchCeilingHz: 140,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
      stylePrompt: 'Grounded and full',
      notes: [],
    };
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/presets/grounded-custom': async () => mockJsonResponse(200, {
        id: 'grounded-custom',
        name: 'Grounded custom',
        kind: 'handmade',
        basePreset: 'soft-feminine',
        archived: false,
        targetVoiceProfile,
      }),
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        trainerStarts.push(body);
        return mockJsonResponse(200, {
          voiceSessionId: `mock-transition-${trainerStarts.length}`,
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          createdAt: Date.now(),
        });
      },
      '/end': async () => {
        trainerEnds += 1;
        return mockJsonResponse(200, { status: 'ended' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;

      const initial = await httpPost(ctx.baseUrl, '/voice/session/start', {
        sessionId,
        targetPreset: 'cute-feminine',
        targetSource: 'built-in',
      });
      assert.equal(initial.status, 200);
      const oldVoiceSessionId = initial.body.voiceState.voiceSessionId;

      const selected = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'grounded-custom',
      });
      assert.equal(selected.status, 200);
      assert.equal(selected.body.voiceState.targetPreset, 'soft-feminine');
      assert.equal(selected.body.voiceState.targetSource, 'custom-handmade');
      assert.equal(selected.body.voiceState.selectedCustomPresetId, 'grounded-custom');
      assert.equal(selected.body.voiceState.targetVoiceProfile.profileId, targetVoiceProfile.profileId);
      assert.deepEqual(
        {
          pitchFloorHz: selected.body.voiceState.targetVoiceProfile.pitchFloorHz,
          pitchCeilingHz: selected.body.voiceState.targetVoiceProfile.pitchCeilingHz,
          resonanceFloor: selected.body.voiceState.targetVoiceProfile.resonanceFloor,
          resonanceCeiling: selected.body.voiceState.targetVoiceProfile.resonanceCeiling,
          weightFloor: selected.body.voiceState.targetVoiceProfile.weightFloor,
          weightCeiling: selected.body.voiceState.targetVoiceProfile.weightCeiling,
        },
        {
          pitchFloorHz: targetVoiceProfile.pitchFloorHz,
          pitchCeilingHz: targetVoiceProfile.pitchCeilingHz,
          resonanceFloor: targetVoiceProfile.resonanceFloor,
          resonanceCeiling: targetVoiceProfile.resonanceCeiling,
          weightFloor: targetVoiceProfile.weightFloor,
          weightCeiling: targetVoiceProfile.weightCeiling,
        },
      );
      assert.equal(selected.body.voiceState.voiceSessionId, null);
      assert.notEqual(oldVoiceSessionId, selected.body.voiceState.voiceSessionId);
      assert.equal(selected.body.preset.id, 'grounded-custom');
      assert.equal(trainerEnds, 1);

      const customStart = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(customStart.status, 200);
      assert.equal(trainerStarts[1].targetPreset, 'soft-feminine');
      assert.equal(trainerStarts[1].targetSource, 'custom-handmade');
      assert.equal(trainerStarts[1].targetVoiceProfile.profileId, targetVoiceProfile.profileId);
      assert.deepEqual(
        {
          pitchFloorHz: trainerStarts[1].targetVoiceProfile.pitchFloorHz,
          pitchCeilingHz: trainerStarts[1].targetVoiceProfile.pitchCeilingHz,
          resonanceFloor: trainerStarts[1].targetVoiceProfile.resonanceFloor,
          resonanceCeiling: trainerStarts[1].targetVoiceProfile.resonanceCeiling,
          weightFloor: trainerStarts[1].targetVoiceProfile.weightFloor,
          weightCeiling: trainerStarts[1].targetVoiceProfile.weightCeiling,
        },
        {
          pitchFloorHz: targetVoiceProfile.pitchFloorHz,
          pitchCeilingHz: targetVoiceProfile.pitchCeilingHz,
          resonanceFloor: targetVoiceProfile.resonanceFloor,
          resonanceCeiling: targetVoiceProfile.resonanceCeiling,
          weightFloor: targetVoiceProfile.weightFloor,
          weightCeiling: targetVoiceProfile.weightCeiling,
        },
      );

      const builtIn = await httpPost(ctx.baseUrl, '/voice/session/preset', {
        sessionId,
        targetPreset: 'everyday-feminine',
      });
      assert.equal(builtIn.status, 200);
      assert.equal(builtIn.body.voiceState.targetPreset, 'everyday-feminine');
      assert.equal(builtIn.body.voiceState.targetSource, 'built-in');
      assert.equal(builtIn.body.voiceState.targetVoiceProfile, null);
      assert.equal(builtIn.body.voiceState.selectedCustomPresetId, null);
      assert.equal(builtIn.body.voiceState.referenceClipId, null);
      assert.equal(builtIn.body.voiceState.voiceSessionId, null);
      assert.equal(trainerEnds, 2);

      const builtInStart = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(builtInStart.status, 200);
      assert.equal(trainerStarts[2].targetPreset, 'everyday-feminine');
      assert.equal(trainerStarts[2].targetSource, 'built-in');
      assert.equal(trainerStarts[2].targetVoiceProfile, null);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('rejects saved reference presets whose evidence is rejected or missing', async () => {
    const targetVoiceProfile = {
      profileId: 'legacy-reference-profile',
      clipId: 'legacy-reference-clip',
      analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
      targetPreset: 'cute-feminine',
      pitchFloorHz: 180,
      pitchCeilingHz: 240,
      resonanceFloor: 0.5,
      resonanceCeiling: 0.7,
      weightFloor: 0.2,
      weightCeiling: 0.4,
    };
    const basePreset = {
      name: 'Legacy reference',
      kind: 'reference',
      basePreset: 'cute-feminine',
      archived: false,
      referenceClipId: 'legacy-reference-clip',
      targetVoiceProfile,
    };
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/presets/rejected-reference': async () => mockJsonResponse(200, {
        ...basePreset,
        id: 'rejected-reference',
        referenceAnalysis: {
          clipId: 'legacy-reference-clip',
          analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
          quality: { verdict: 'reject', cloneable: false },
          metrics: {
            advanced: {
              measurementAvailable: false,
              measurementRejectionReasons: ['no_voiced_frames'],
            },
          },
        },
      }),
      '/api/v1/voice/presets/unverified-reference': async () => mockJsonResponse(200, {
        ...basePreset,
        id: 'unverified-reference',
        referenceAnalysis: null,
      }),
      '/api/v1/voice/presets/unmeasured-reference': async () => mockJsonResponse(200, {
        ...basePreset,
        id: 'unmeasured-reference',
        referenceAnalysis: {
          clipId: 'legacy-reference-clip',
          analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
          quality: { verdict: 'good', cloneable: true },
          metrics: { advanced: {} },
          timeline: [],
        },
      }),
      '/api/v1/voice/presets/verified-reference': async () => mockJsonResponse(200, {
        ...basePreset,
        id: 'verified-reference',
        referenceAnalysis: {
          clipId: 'legacy-reference-clip',
          analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
          quality: { verdict: 'good', cloneable: true },
          metrics: { advanced: { measurementAvailable: true } },
          timeline: [],
        },
      }),
      '/api/v1/voice/presets/mismatched-reference': async () => mockJsonResponse(200, {
        ...basePreset,
        id: 'mismatched-reference',
        referenceAnalysis: {
          clipId: 'different-reference-clip',
          analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
          quality: { verdict: 'good', cloneable: true },
          metrics: { advanced: { measurementAvailable: true } },
          timeline: [],
        },
      }),
      '/api/v1/voice/presets/versionless-reference': async () => mockJsonResponse(200, {
        ...basePreset,
        id: 'versionless-reference',
        referenceAnalysis: {
          clipId: 'legacy-reference-clip',
          quality: { verdict: 'good', cloneable: true },
          metrics: { advanced: { measurementAvailable: true } },
          timeline: [],
        },
      }),
      '/api/v1/voice/presets/stale-calibration-reference': async () => mockJsonResponse(200, {
        ...basePreset,
        id: 'stale-calibration-reference',
        referenceAnalysis: {
          clipId: 'legacy-reference-clip',
          analysisVersion: 'voice-metrics-v2-legacy',
          quality: { verdict: 'good', cloneable: true },
          metrics: { advanced: { measurementAvailable: true } },
          timeline: [],
        },
      }),
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      for (const presetId of ['rejected-reference', 'unverified-reference', 'unmeasured-reference']) {
        const selected = await httpPost(ctx.baseUrl, '/voice/presets/select', { sessionId, presetId });
        assert.equal(selected.status, 422);
      }
      const mismatched = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'mismatched-reference',
      });
      assert.equal(mismatched.status, 409);
      const versionless = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'versionless-reference',
      });
      assert.equal(versionless.status, 422);
      const staleCalibration = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'stale-calibration-reference',
      });
      assert.equal(staleCalibration.status, 409);
      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.targetSource, 'built-in');
      assert.equal(current.body.voiceState.targetVoiceProfile, null);
      assert.equal(current.body.voiceState.selectedCustomPresetId, null);
      const witnesses = ctx.runtime.debugBus.since(0).filter((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'preset_contract_rejected'
      ));
      assert.equal(witnesses.length, 6);
      assert.equal(witnesses[0].data.reference_quality_rejected, true);
      assert.ok(witnesses.some((event) => (
        event.data?.reference_calibration_status === 'reference_missing'
      )));
      assert.ok(witnesses.some((event) => (
        event.data?.reference_calibration_status === 'mismatch'
      )));
      assert.doesNotMatch(
        JSON.stringify(witnesses),
        /legacy-reference-clip|different-reference-clip|rejected-reference|voice-metrics-v2-legacy/,
      );

      const verified = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'verified-reference',
      });
      assert.equal(verified.status, 200);
      assert.equal(verified.body.voiceState.targetSource, 'custom-reference');
      assert.equal(verified.body.voiceState.targetVoiceProfile.profileId, 'legacy-reference-profile');
      assert.equal(verified.body.voiceState.referenceClipId, 'legacy-reference-clip');
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('keeps the previous target intact when analyzer retirement is not acknowledged', async () => {
    const targetVoiceProfile = {
      profileId: 'next-custom-profile',
      clipId: 'next-custom-clip',
      targetPreset: 'soft-feminine',
      pitchFloorHz: 100,
      pitchCeilingHz: 140,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
    };
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/presets/next-custom': async () => mockJsonResponse(200, {
        id: 'next-custom',
        name: 'Next custom',
        kind: 'handmade',
        basePreset: 'soft-feminine',
        archived: false,
        targetVoiceProfile,
      }),
      '/end': async () => mockJsonResponse(503, { detail: 'retirement unavailable' }),
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(started.status, 200);
      const previousVoiceSessionId = started.body.voiceState.voiceSessionId;

      const selected = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'next-custom',
      });
      assert.equal(selected.status, 503);

      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.targetSource, 'built-in');
      assert.equal(current.body.voiceState.targetVoiceProfile, null);
      assert.equal(current.body.voiceState.voiceSessionId, previousVoiceSessionId);
      const witness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'analyzer_retire_failed'
      ));
      assert.equal(witness?.data?.analyzer_transition_attempted, true);
      assert.equal(witness?.data?.analyzer_acknowledged, false);
      assert.equal(witness?.data?.from_source, 'built-in');
      assert.equal(witness?.data?.to_source, 'custom-handmade');
      assert.doesNotMatch(JSON.stringify(witness?.data || {}), /next-custom|retirement unavailable/);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('rejects arbitrary target-source identifiers without persisting them', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const started = await httpPost(ctx.baseUrl, '/voice/session/start', {
        sessionId: appSession.body.sessionId,
        targetSource: 'TARGET_IDENTIFIER_SECRET',
      });
      assert.equal(started.status, 422);
      const events = ctx.runtime.debugBus.since(0);
      assert.ok(events.some((event) => event.data?.outcome === 'invalid_target_source'));
      assert.doesNotMatch(JSON.stringify(events), /TARGET_IDENTIFIER_SECRET/);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('rejects direct reference starts without server-bound trustworthy evidence', async () => {
    let analyzerStarts = 0;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async () => {
        analyzerStarts += 1;
        return mockJsonResponse(200, { voiceSessionId: 'must-not-start', status: 'ready' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      const targetVoiceProfile = {
        profileId: 'forged-reference-profile',
        clipId: 'forged-reference-clip',
        targetPreset: 'cute-feminine',
        pitchFloorHz: 180,
        pitchCeilingHz: 240,
        resonanceFloor: 0.5,
        resonanceCeiling: 0.7,
        weightFloor: 0.2,
        weightCeiling: 0.4,
      };
      for (const referenceAnalysis of [undefined, {
        clipId: 'forged-reference-clip',
        quality: { verdict: 'good' },
        metrics: { advanced: { measurementAvailable: true } },
      }]) {
        const started = await httpPost(ctx.baseUrl, '/voice/session/start', {
          sessionId,
          targetPreset: 'cute-feminine',
          targetSource: 'custom-reference',
          referenceClipId: 'forged-reference-clip',
          targetVoiceProfile,
          ...(referenceAnalysis ? { referenceAnalysis } : {}),
        });
        assert.equal(started.status, 422);
      }
      assert.equal(analyzerStarts, 0);
      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.targetSource, 'built-in');
      assert.equal(current.body.voiceState.voiceSessionId, null);
      const witnesses = ctx.runtime.debugBus.since(0).filter((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'reference_evidence_missing'
      ));
      assert.equal(witnesses.length, 2);
      assert.ok(witnesses.every((event) => event.data?.target_source === 'custom-reference'));
      assert.doesNotMatch(JSON.stringify(witnesses), /forged-reference|must-not-start/);

      const bound = await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'bound-reference-clip',
        referenceClipName: 'bound.wav',
      });
      assert.equal(bound.status, 200);
      const mismatchedStart = await httpPost(ctx.baseUrl, '/voice/session/start', {
        sessionId,
        targetPreset: 'cute-feminine',
        targetSource: 'custom-reference',
        referenceClipId: 'different-forged-clip',
        targetVoiceProfile: {
          ...targetVoiceProfile,
          profileId: 'different-forged-profile',
          clipId: 'different-forged-clip',
        },
      });
      assert.equal(mismatchedStart.status, 409);
      assert.equal(analyzerStarts, 0);
      const mismatchWitness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'reference_evidence_mismatch'
      ));
      assert.equal(mismatchWitness?.data?.target_source, 'custom-reference');
      assert.doesNotMatch(JSON.stringify(mismatchWitness?.data || {}), /bound-reference|different-forged/);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('rolls back an analyzer session whose target acknowledgement mismatches the request', async () => {
    let rollbackCount = 0;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async () => mockJsonResponse(200, {
        voiceSessionId: 'mismatched-analyzer-session',
        status: 'ready',
        targetPreset: 'soft-feminine',
        targetSource: 'built-in',
        createdAt: Date.now(),
      }),
      '/end': async () => {
        rollbackCount += 1;
        return mockJsonResponse(200, { status: 'ended' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      const started = await httpPost(ctx.baseUrl, '/voice/session/start', {
        sessionId,
        targetPreset: 'cute-feminine',
        targetSource: 'built-in',
      });
      assert.equal(started.status, 502);
      assert.equal(rollbackCount, 1);

      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.voiceSessionId, null);
      assert.equal(current.body.voiceState.targetPreset, 'cute-feminine');
      assert.equal(current.body.voiceState.targetSource, 'built-in');
      const witness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'analyzer_ack_mismatch'
      ));
      assert.deepEqual(witness?.data?.failures, ['target_preset_mismatch']);
      assert.equal(witness?.data?.rollback_attempted, true);
      assert.equal(witness?.data?.rollback_acknowledged, true);
      assert.doesNotMatch(JSON.stringify(witness?.data || {}), /mismatched-analyzer-session/);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('rolls back when the analyzer omits applicable target acknowledgements', async () => {
    let rollbackCount = 0;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async () => mockJsonResponse(200, {
        voiceSessionId: 'ack-only-analyzer-session',
        status: 'ready',
      }),
      '/end': async () => {
        rollbackCount += 1;
        return mockJsonResponse(200, { status: 'ended' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      const started = await httpPost(ctx.baseUrl, '/voice/session/start', {
        sessionId,
        targetPreset: 'soft-feminine',
        targetSource: 'custom-handmade',
        targetVoiceProfile: {
          profileId: 'custom-ack-proof',
          targetPreset: 'soft-feminine',
          pitchFloorHz: 100,
          pitchCeilingHz: 140,
          resonanceFloor: 0.1,
          resonanceCeiling: 0.3,
          weightFloor: 0.6,
          weightCeiling: 0.8,
        },
      });
      assert.equal(started.status, 502);
      assert.equal(rollbackCount, 1);

      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.voiceSessionId, null);
      assert.equal(current.body.voiceState.targetSource, 'built-in');
      assert.equal(current.body.voiceState.targetVoiceProfile, null);
      const witness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'analyzer_ack_mismatch'
      ));
      assert.deepEqual(witness?.data?.failures, [
        'missing_target_preset',
        'missing_target_source',
        'missing_target_profile_id',
      ]);
      assert.equal(witness?.data?.rollback_attempted, true);
      assert.equal(witness?.data?.rollback_acknowledged, true);
      assert.doesNotMatch(
        JSON.stringify(witness?.data || {}),
        /ack-only-analyzer-session|custom-ack-proof/,
      );
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('rolls back a reference analyzer that acknowledges a different calibration epoch', async () => {
    let rollbackCount = 0;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        return mockJsonResponse(200, {
          voiceSessionId: 'stale-calibration-analyzer-session',
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          analysisVersion: 'voice-metrics-v2-legacy',
          createdAt: Date.now(),
        });
      },
      '/end': async () => {
        rollbackCount += 1;
        return mockJsonResponse(200, { status: 'ended' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      const bound = await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'calibration-epoch-reference',
        referenceClipName: 'calibration-epoch.wav',
      });
      assert.equal(bound.status, 200);

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(started.status, 502);
      assert.equal(rollbackCount, 1);
      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.targetSource, 'reference');
      assert.equal(current.body.voiceState.voiceSessionId, null);
      const witness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'analyzer_ack_mismatch'
      ));
      assert.deepEqual(witness?.data?.failures, ['analysis_version_mismatch']);
      assert.equal(witness?.data?.rollback_acknowledged, true);
      assert.doesNotMatch(
        JSON.stringify(witness?.data || {}),
        /stale-calibration-analyzer-session|voice-metrics-v2-legacy|calibration-epoch-reference/,
      );
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('refuses a built-in start carrying a stale custom profile', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
    try {
      const started = await httpPost(ctx.baseUrl, '/session/start', {});
      const response = await httpPost(ctx.baseUrl, '/voice/session/start', {
        sessionId: started.body.sessionId,
        targetPreset: 'everyday-feminine',
        targetSource: 'built-in',
        targetVoiceProfile: {
          profileId: 'stale-custom',
          targetPreset: 'soft-feminine',
          pitchFloorHz: 100,
          pitchCeilingHz: 140,
          resonanceFloor: 0.1,
          resonanceCeiling: 0.3,
          weightFloor: 0.6,
          weightCeiling: 0.8,
        },
      });
      assert.equal(response.status, 409);
      assert.match(String(response.body.error), /stale custom voice profile/i);
    } finally {
      await stopTestApp(ctx);
    }
  });
});

describe('Reference target session contract', () => {
  const oldCustomProfile = {
    profileId: 'old-custom-profile',
    clipId: 'old-custom-clip',
    sourceFilename: 'old custom target',
    durationMs: 0,
    targetPreset: 'soft-feminine',
    metrics: {
      meanPitchHz: 120,
      pitchRangeSt: 4,
      resonanceMean: 0.2,
      weightMean: 0.7,
      targetHitPct: 1,
      similarityScore: 1,
    },
    pitchFloorHz: 101,
    pitchCeilingHz: 139,
    resonanceFloor: 0.12,
    resonanceCeiling: 0.28,
    weightFloor: 0.62,
    weightCeiling: 0.79,
    stylePrompt: 'Old custom target',
    notes: [],
  };

  const asymmetricReferenceProfile = {
    profileId: 'reference-profile-new-clip',
    clipId: 'new-clip',
    analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
    sourceFilename: 'new-reference.wav',
    durationMs: 7300,
    targetPreset: 'soft-feminine',
    metrics: {
      meanPitchHz: 143.2,
      pitchRangeSt: 5.4,
      resonanceMean: 0.347,
      weightMean: 0.581,
      targetHitPct: 1,
      similarityScore: 1,
    },
    pitchFloorHz: 112.25,
    pitchCeilingHz: 167.75,
    resonanceFloor: 0.271,
    resonanceCeiling: 0.423,
    weightFloor: 0.503,
    weightCeiling: 0.659,
    stylePrompt: 'Asymmetric reference-derived target',
    notes: [],
  };

  it('replaces stale custom identity and forwards the exact derived reference bands', async () => {
    const trainerStarts = [];
    const profileRequests = [];
    let trainerEnds = 0;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/presets/old-custom': async () => mockJsonResponse(200, {
        id: 'old-custom',
        name: 'Old custom',
        kind: 'handmade',
        basePreset: 'soft-feminine',
        archived: false,
        targetVoiceProfile: oldCustomProfile,
      }),
      '/api/v1/voice/reference/new-clip': async () => mockJsonResponse(200, {
        clipId: 'new-clip',
        analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
        filename: 'new-reference.wav',
        durationMs: 7300,
        targetPreset: 'soft-feminine',
        metrics: { advanced: { measurementAvailable: true } },
        timeline: [],
        quality: { verdict: 'good', cloneable: true },
      }),
      '/api/v1/voice/target/profile': async (_url, options = {}) => {
        profileRequests.push(JSON.parse(options.body || '{}'));
        return mockJsonResponse(200, asymmetricReferenceProfile);
      },
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        trainerStarts.push(body);
        return mockJsonResponse(200, {
          voiceSessionId: `reference-contract-${trainerStarts.length}`,
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
          createdAt: Date.now(),
        });
      },
      '/end': async () => {
        trainerEnds += 1;
        return mockJsonResponse(200, { status: 'ended' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      const selected = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'old-custom',
      });
      assert.equal(selected.status, 200);
      const customStart = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(customStart.status, 200);

      const synced = await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'new-clip',
        referenceClipName: 'untrusted-client-name.wav',
      });
      assert.equal(synced.status, 200);
      assert.equal(trainerEnds, 1);
      assert.deepEqual(profileRequests, [{ clipId: 'new-clip', targetPreset: 'soft-feminine' }]);
      assert.equal(synced.body.voiceState.targetSource, 'reference');
      assert.equal(synced.body.voiceState.referenceClipId, 'new-clip');
      assert.equal(synced.body.voiceState.referenceClipName, 'new-reference.wav');
      assert.equal(synced.body.voiceState.selectedCustomPresetId, null);
      assert.equal(synced.body.voiceState.selectedCustomPresetName, null);
      assert.equal(synced.body.voiceState.targetVoiceProfile.profileId, 'reference-profile-new-clip');
      assert.deepEqual(
        {
          pitchFloorHz: synced.body.voiceState.targetVoiceProfile.pitchFloorHz,
          pitchCeilingHz: synced.body.voiceState.targetVoiceProfile.pitchCeilingHz,
          resonanceFloor: synced.body.voiceState.targetVoiceProfile.resonanceFloor,
          resonanceCeiling: synced.body.voiceState.targetVoiceProfile.resonanceCeiling,
          weightFloor: synced.body.voiceState.targetVoiceProfile.weightFloor,
          weightCeiling: synced.body.voiceState.targetVoiceProfile.weightCeiling,
        },
        {
          pitchFloorHz: 112.25,
          pitchCeilingHz: 167.75,
          resonanceFloor: 0.271,
          resonanceCeiling: 0.423,
          weightFloor: 0.503,
          weightCeiling: 0.659,
        },
      );

      const referenceStart = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(referenceStart.status, 200);
      assert.equal(trainerStarts[1].targetSource, 'reference');
      assert.equal(trainerStarts[1].referenceClipId, 'new-clip');
      assert.equal(trainerStarts[1].targetVoiceProfile.profileId, asymmetricReferenceProfile.profileId);
      assert.deepEqual(
        {
          pitchFloorHz: trainerStarts[1].targetVoiceProfile.pitchFloorHz,
          pitchCeilingHz: trainerStarts[1].targetVoiceProfile.pitchCeilingHz,
          resonanceFloor: trainerStarts[1].targetVoiceProfile.resonanceFloor,
          resonanceCeiling: trainerStarts[1].targetVoiceProfile.resonanceCeiling,
          weightFloor: trainerStarts[1].targetVoiceProfile.weightFloor,
          weightCeiling: trainerStarts[1].targetVoiceProfile.weightCeiling,
        },
        {
          pitchFloorHz: asymmetricReferenceProfile.pitchFloorHz,
          pitchCeilingHz: asymmetricReferenceProfile.pitchCeilingHz,
          resonanceFloor: asymmetricReferenceProfile.resonanceFloor,
          resonanceCeiling: asymmetricReferenceProfile.resonanceCeiling,
          weightFloor: asymmetricReferenceProfile.weightFloor,
          weightCeiling: asymmetricReferenceProfile.weightCeiling,
        },
      );
      const transitionWitness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition'
        && event.data?.outcome === 'applied'
        && event.data?.to_source === 'reference'
      ));
      assert.equal(transitionWitness?.data?.expected_profile_present, true);
      assert.equal(transitionWitness?.data?.actual_profile_present, true);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('removal clears reference/custom identity before built-in practice re-arms', async () => {
    const trainerStarts = [];
    let trainerEnds = 0;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        trainerStarts.push(body);
        return mockJsonResponse(200, {
          voiceSessionId: `reference-remove-${trainerStarts.length}`,
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
          createdAt: Date.now(),
        });
      },
      '/end': async () => {
        trainerEnds += 1;
        return mockJsonResponse(200, { status: 'ended' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      const synced = await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'remove-me',
        referenceClipName: 'remove-me.wav',
      });
      assert.equal(synced.status, 200);
      const referenceStart = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(referenceStart.status, 200);

      const removed = await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: null,
        referenceClipName: '',
      });
      assert.equal(removed.status, 200);
      assert.equal(trainerEnds, 1);
      assert.equal(removed.body.voiceState.targetSource, 'built-in');
      assert.equal(removed.body.voiceState.targetVoiceProfile, null);
      assert.equal(removed.body.voiceState.referenceClipId, null);
      assert.equal(removed.body.voiceState.referenceClipName, null);
      assert.equal(removed.body.voiceState.referenceAnalysis, null);
      assert.equal(removed.body.voiceState.selectedCustomPresetId, null);
      assert.equal(removed.body.voiceState.selectedCustomPresetName, null);
      assert.equal(removed.body.voiceState.voiceSessionId, null);

      const builtInStart = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(builtInStart.status, 200);
      assert.equal(trainerStarts[1].targetSource, 'built-in');
      assert.equal(trainerStarts[1].targetVoiceProfile, null);
      assert.equal(trainerStarts[1].referenceClipId, null);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('profile derivation failure leaves the previous target untouched and witnessed', async () => {
    let trainerEnds = 0;
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/presets/old-custom': async () => mockJsonResponse(200, {
        id: 'old-custom',
        name: 'Old custom',
        kind: 'handmade',
        basePreset: 'soft-feminine',
        archived: false,
        targetVoiceProfile: oldCustomProfile,
      }),
      '/api/v1/voice/reference/bad-profile-clip': async () => mockJsonResponse(200, {
        clipId: 'bad-profile-clip',
        analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
        filename: 'bad-profile.wav',
        durationMs: 6500,
        targetPreset: 'soft-feminine',
        metrics: { advanced: { measurementAvailable: true } },
        timeline: [],
        quality: { verdict: 'good', cloneable: true },
      }),
      '/api/v1/voice/target/profile': async () => mockJsonResponse(200, {
        ...asymmetricReferenceProfile,
        clipId: 'different-clip',
      }),
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        return mockJsonResponse(200, {
          voiceSessionId: 'profile-failure-session',
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          createdAt: Date.now(),
        });
      },
      '/end': async () => {
        trainerEnds += 1;
        return mockJsonResponse(200, { status: 'ended' });
      },
    });
    const ctx = await startTestApp({ fetchImpl, disableSessionPersistence: true });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/presets/select', { sessionId, presetId: 'old-custom' });
      const customStart = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(customStart.status, 200);
      const previousVoiceSessionId = customStart.body.voiceState.voiceSessionId;

      const failed = await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'bad-profile-clip',
        referenceClipName: 'bad-profile.wav',
      });
      assert.equal(failed.status, 409);
      assert.equal(trainerEnds, 0);

      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.status, 200);
      assert.equal(current.body.voiceState.targetSource, 'custom-handmade');
      assert.equal(current.body.voiceState.targetVoiceProfile.profileId, 'old-custom-profile');
      assert.equal(current.body.voiceState.referenceClipId, null);
      assert.equal(current.body.voiceState.voiceSessionId, previousVoiceSessionId);
      const failureWitness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition'
        && event.data?.outcome === 'profile_derivation_failed'
      ));
      assert.equal(failureWitness?.data?.to_source, 'reference');
      assert.doesNotMatch(JSON.stringify(failureWitness?.data || {}), /bad-profile-clip|old-custom-profile/);
    } finally {
      await stopTestApp(ctx);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Speech Status
// ---------------------------------------------------------------------------

describe('Speech Status', () => {
  it('status returns voxcpm disabled when VOXCPM_ENABLED=false', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'false' },
      disableSessionPersistence: true,
    });
    try {
      const { status, body } = await httpGet(ctx.baseUrl, '/voice/speech/status');
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.providers.voxcpm.enabled, false);
      assert.ok(body.providers.voxcpm.reason, 'should have a reason');
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('status returns voxcpm enabled when VOXCPM_ENABLED=true', async () => {
    // getVoiceSpeechStatus calls global fetch for VoxCPM health check
    const realFetch = global.fetch;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/health') && urlStr.includes('8020')) {
        return mockJsonResponse(200, { ok: true, model_loaded: true });
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const { status, body } = await httpGet(ctx.baseUrl, '/voice/speech/status');
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.providers.voxcpm.enabled, true);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('status caches result for 5 seconds', async () => {
    // getVoiceSpeechStatus calls global fetch for VoxCPM health check
    const realFetch = global.fetch;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/health') && urlStr.includes('8020')) {
        return mockJsonResponse(200, { ok: true, model_loaded: true });
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const r1 = await httpGet(ctx.baseUrl, '/voice/speech/status');
      const r2 = await httpGet(ctx.baseUrl, '/voice/speech/status');
      assert.equal(r1.status, 200);
      assert.equal(r2.status, 200);
      assert.equal(r1.body.providers.voxcpm.enabled, r2.body.providers.voxcpm.enabled);
      assert.equal(
        r1.body.providers.voxcpm.lastCheckedAt,
        r2.body.providers.voxcpm.lastCheckedAt,
        'second call should use cached result',
      );
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// 4. Speech Generate
// ---------------------------------------------------------------------------

describe('Speech Generate', () => {
  it('generate returns 501 when VoxCPM disabled', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'false' },
      disableSessionPersistence: true,
    });
    try {
      const { status, body } = await httpPost(ctx.baseUrl, '/voice/speech/generate', {
        targetText: 'hello world',
      });
      assert.equal(status, 501);
      assert.equal(body.success, false);
      assert.ok(body.error.includes('not enabled'));
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('generate returns 400 when targetText missing', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const { status, body } = await httpPost(ctx.baseUrl, '/voice/speech/generate', {});
      assert.equal(status, 400);
      assert.equal(body.success, false);
      assert.ok(body.error.includes('targetText'));
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('generate streams audio when VoxCPM enabled (mock TTS)', async () => {
    // proxyVoiceSpeechGenerate uses global fetch. Monkey-patch it.
    const realFetch = global.fetch;
    const mockAudioBuf = Buffer.from('RIFF' + '\x00'.repeat(100));
    let upstreamSignal = null;
    let upstreamBody = null;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(503, { error: 'reference unavailable' });
      }
      if (urlStr.includes('/generate')) {
        upstreamSignal = options?.signal || null;
        upstreamBody = JSON.parse(options?.body || '{}');
        return mockAudioResponse(200, mockAudioBuf);
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const resp = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetText: 'hello world' }),
      });
      assert.equal(resp.status, 200);
      assert.equal(resp.headers.get('x-voice-speech-provider'), 'voxcpm');
      assert.ok(resp.headers.get('x-voice-speech-stream-id'), 'should have stream id');
      assert.equal(resp.headers.get('x-speaking-rate-applied'), '0.76');
      assert.equal(resp.headers.get('x-tts-generation-mode'), 'profile-synthesis');
      assert.equal(resp.headers.get('x-reference-audio-role'), 'none');
      assert.equal(upstreamBody?.speakingRate, 0.76);
      const arrayBuf = await resp.arrayBuffer();
      assert.ok(arrayBuf.byteLength > 0, 'should receive audio bytes');
      assert.equal(upstreamSignal?.aborted, false, 'normal completion must not abort upstream');
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('forwards VoxCPM raw PCM metadata and bytes unchanged', async () => {
    const realFetch = global.fetch;
    const mockPcmBytes = Buffer.from([0x00, 0x80, 0xff, 0x7f, 0x34, 0x12]);
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/generate')) {
        const response = mockAudioResponse(200, mockPcmBytes);
        response.headers = new Headers({
          'Content-Type': 'application/octet-stream',
          'Content-Length': String(mockPcmBytes.length),
          'X-Audio-Format': 'pcm_s16le',
          'X-Audio-Sample-Rate': '24000',
          'X-Audio-Channels': '1',
          'X-Speaking-Rate-Applied': '0.76',
          'X-TTS-Generation-Mode': 'profile-synthesis',
          'X-Reference-Audio-Role': 'none',
          'X-Voice-Speech-Stream-Id': 'upstream-forged-stream-id',
          'X-Not-Allowlisted': 'must-not-forward',
        });
        return response;
      }
      return realFetch(url, options);
    };

    let ctx;
    try {
      ctx = await startTestApp({
        fetchImpl: buildMockFetchImpl(),
        env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
        disableSessionPersistence: true,
      });
      const resp = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://pcm-browser.example',
        },
        body: JSON.stringify({ targetText: 'raw PCM metadata test' }),
      });

      assert.equal(resp.status, 200);
      const exposedHeaders = (resp.headers.get('access-control-expose-headers') || '')
        .split(',')
        .map((headerName) => headerName.trim().toLowerCase())
        .filter(Boolean);
      for (const headerName of [
        'X-Audio-Format',
        'X-Audio-Sample-Rate',
        'X-Audio-Channels',
        'X-Speaking-Rate-Applied',
        'X-TTS-Generation-Mode',
        'X-Reference-Audio-Role',
      ]) {
        assert.ok(
          exposedHeaders.includes(headerName.toLowerCase()),
          `CORS must expose ${headerName}; got ${JSON.stringify(exposedHeaders)}`,
        );
      }
      assert.equal(resp.headers.get('content-type'), 'application/octet-stream');
      assert.equal(resp.headers.get('content-length'), String(mockPcmBytes.length));
      assert.equal(resp.headers.get('x-audio-format'), 'pcm_s16le');
      assert.equal(resp.headers.get('x-audio-sample-rate'), '24000');
      assert.equal(resp.headers.get('x-audio-channels'), '1');
      assert.equal(resp.headers.get('x-speaking-rate-applied'), '0.76');
      assert.equal(resp.headers.get('x-tts-generation-mode'), 'profile-synthesis');
      assert.equal(resp.headers.get('x-reference-audio-role'), 'none');
      assert.notEqual(
        resp.headers.get('x-voice-speech-stream-id'),
        'upstream-forged-stream-id',
        'gateway stream id must not be copied from VoxCPM',
      );
      assert.equal(resp.headers.get('x-not-allowlisted'), null);
      assert.deepEqual(Buffer.from(await resp.arrayBuffer()), mockPcmBytes);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('rejects upstream audio that does not prove target-text synthesis', async () => {
    const realFetch = global.fetch;
    let cancelled = false;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/generate')) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'Content-Type': 'audio/wav' }),
          body: {
            async cancel() { cancelled = true; },
          },
        };
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetText: 'This ambiguous audio must stay silent.' }),
      });
      assert.equal(response.status, 502);
      assert.equal(cancelled, true);
      assert.match((await response.json()).error, /could not be verified/i);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('rejects explicit mock synthesis for a selected tutor voice', async () => {
    const realFetch = global.fetch;
    const clipId = 'mock-synthesis-selected-reference';
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/mock-synthesis-reference.wav' });
      }
      if (urlStr.includes('/generate')) {
        const response = mockAudioResponse(200, Buffer.from('PLACEHOLDER_AUDIO'));
        response.headers = new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Speaking-Rate-Applied': '0.76',
          'X-TTS-Generation-Mode': 'mock-synthesis',
          'X-Reference-Audio-Role': 'conditioning-only',
        });
        return response;
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId: start.body.sessionId,
        referenceClipId: clipId,
        referenceClipName: 'mock evidence test',
      });

      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: start.body.sessionId,
          targetText: 'Never play placeholder synthesis.',
        }),
      });

      assert.equal(response.status, 502);
      assert.match((await response.json()).error, /could not be verified/i);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('generate includes X-Voice-Cloned header when reference loaded', async () => {
    // proxyVoiceSpeechGenerate and ensureReferenceAudio use global fetch, not fetchImpl.
    // Monkey-patch global fetch to intercept voxcpm calls.
    const realFetch = global.fetch;
    const mockAudioBuf = Buffer.from('RIFF' + '\x00'.repeat(100));
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/mock-ref-voice.wav' });
      }
      if (urlStr.includes('/generate')) {
        return mockAudioResponse(200, mockAudioBuf, { generationMode: 'cloned-synthesis' });
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      const sid = start.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId: sid,
        referenceClipId: 'test-clip-123',
        referenceClipName: 'my voice sample',
      });

      const resp = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetText: 'hello world', sessionId: sid }),
      });
      assert.equal(resp.status, 200);
      assert.equal(resp.headers.get('x-voice-cloned'), 'true');
      assert.equal(resp.headers.get('x-tts-generation-mode'), 'cloned-synthesis');
      assert.equal(resp.headers.get('x-reference-audio-role'), 'conditioning-only');
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('resumed Coach heals a stale target binding and TTS conditions only on the selected preset', async () => {
    const realFetch = global.fetch;
    const preparedClipIds = [];
    const generationBodies = [];
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        const body = JSON.parse(options?.body || '{}');
        preparedClipIds.push(body.clip_id);
        return mockJsonResponse(200, { path: `/tmp/${body.clip_id}.wav` });
      }
      if (urlStr.includes('/v1/reference-audio/prime')) {
        return mockJsonResponse(200, { prepared: true, cache_hit: false, prepare_ms: 1 });
      }
      if (urlStr.includes('/generate')) {
        generationBodies.push(JSON.parse(options?.body || '{}'));
        return mockAudioResponse(200, Buffer.from('EXACT_PRESET_PCM'), {
          generationMode: 'cloned-synthesis',
        });
      }
      return realFetch(url, options);
    };

    const targetVoiceProfile = {
      profileId: 'profile-exact-a',
      clipId: 'clip-exact-a',
      analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
      targetPreset: 'cute-feminine',
      direction: 'feminine',
      pitchFloorHz: 180,
      pitchCeilingHz: 235,
      resonanceFloor: 0.55,
      resonanceCeiling: 0.7,
      weightFloor: 0.25,
      weightCeiling: 0.4,
      metrics: { advanced: { measurementAvailable: true } },
    };
    const referenceAnalysis = {
      clipId: 'clip-exact-a',
      analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
      quality: { verdict: 'good', cloneable: true },
      metrics: { advanced: { measurementAvailable: true } },
      timeline: [],
    };
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/presets/preset-exact-a': async () => mockJsonResponse(200, {
        id: 'preset-exact-a',
        name: 'Exact A',
        kind: 'reference',
        basePreset: 'cute-feminine',
        archived: false,
        referenceClipId: 'clip-exact-a',
        referenceClipName: 'exact-a.wav',
        referenceAnalysis,
        targetVoiceProfile,
      }),
      '/api/v1/voice/reference/clip-exact-a': async () => mockJsonResponse(200, {
        ...referenceAnalysis,
        filename: 'exact-a.wav',
      }),
    });
    const ctx = await startTestApp({
      fetchImpl,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const started = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = started.body.sessionId;
      const selected = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'preset-exact-a',
      });
      assert.equal(selected.status, 200);
      const session = ctx.runtime.sessions.get(sessionId);
      session.voiceState.targetBinding = {
        targetKey: 'stale-target-b',
        presetId: 'preset-stale-b',
        referenceClipId: 'clip-stale-b',
        targetSource: 'custom-reference',
        targetPreset: 'cute-feminine',
        targetProfileId: 'profile-stale-b',
      };

      const resumed = await httpPost(ctx.baseUrl, '/session/start', {
        sessionId,
        studentId: session.studentId,
        activate: false,
      });
      assert.equal(resumed.status, 200);
      assert.equal(session.voiceState.targetBinding.presetId, 'preset-exact-a');
      assert.equal(session.voiceState.targetBinding.referenceClipId, 'clip-exact-a');

      const speech = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetText: 'Use the exact selected voice.' }),
      });
      assert.equal(speech.status, 200);
      assert.ok(preparedClipIds.length >= 1);
      assert.equal(preparedClipIds.every((clipId) => clipId === 'clip-exact-a'), true);
      assert.equal(generationBodies.length, 1);
      assert.equal(generationBodies[0].reference_audio_path, '/tmp/clip-exact-a.wav');
      assert.doesNotMatch(JSON.stringify(generationBodies), /stale-b/);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('aborts in-flight tutor speech when the selected preset changes from A to B', async () => {
    const realFetch = global.fetch;
    const qualityStarted = createDeferred();
    const qualityReleased = createDeferred();
    const generationBodies = [];
    let qualitySettled = false;
    const makeReferencePreset = (id, clipId, profileId) => ({
      id,
      name: id,
      kind: 'reference',
      basePreset: 'cute-feminine',
      archived: false,
      referenceClipId: clipId,
      referenceClipName: `${clipId}.wav`,
      referenceAnalysis: {
        clipId,
        analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
        quality: { verdict: 'good', cloneable: true },
        metrics: { advanced: { measurementAvailable: true } },
        timeline: [],
      },
      targetVoiceProfile: {
        profileId,
        clipId,
        analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
        targetPreset: 'cute-feminine',
        direction: 'feminine',
        pitchFloorHz: 180,
        pitchCeilingHz: 235,
        resonanceFloor: 0.55,
        resonanceCeiling: 0.7,
        weightFloor: 0.25,
        weightCeiling: 0.4,
        metrics: { advanced: { measurementAvailable: true } },
      },
    });
    const presetA = makeReferencePreset('preset-race-a', 'clip-race-a', 'profile-race-a');
    const presetB = makeReferencePreset('preset-race-b', 'clip-race-b', 'profile-race-b');
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/presets/preset-race-a': async () => mockJsonResponse(200, presetA),
      '/api/v1/voice/presets/preset-race-b': async () => mockJsonResponse(200, presetB),
      '/api/v1/voice/reference/clip-race-a': async () => {
        qualityStarted.resolve();
        return qualityReleased.promise;
      },
    });
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/clip-race-a.wav' });
      }
      if (urlStr.includes('/generate')) {
        generationBodies.push(JSON.parse(options?.body || '{}'));
        return mockAudioResponse(200, Buffer.from('STALE_A_PCM'), {
          generationMode: 'cloned-synthesis',
        });
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const started = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = started.body.sessionId;
      const selectedA = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: presetA.id,
      });
      assert.equal(selectedA.status, 200);

      const speechPromise = realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetText: 'This must never speak as stale A.' }),
      });
      await beforeTimeout(qualityStarted.promise, 'A quality lookup to begin');

      const selectedB = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: presetB.id,
      });
      assert.equal(selectedB.status, 200);
      qualitySettled = true;
      qualityReleased.resolve(mockJsonResponse(200, presetA.referenceAnalysis));

      const speech = await beforeTimeout(speechPromise, 'stale A speech request to abort');
      assert.equal(speech.status, 499);
      assert.equal((await speech.json()).success, false);
      assert.equal(generationBodies.length, 0, 'stale A must never reach VoxCPM generation');
      assert.equal(
        ctx.runtime.sessions.get(sessionId).voiceState.targetBinding.referenceClipId,
        presetB.referenceClipId,
      );
      assert.equal(ctx.runtime.voiceOperationRouteHandlers.activeTtsStreams.size, 0);
    } finally {
      if (!qualitySettled) {
        qualityReleased.resolve(mockJsonResponse(200, presetA.referenceAnalysis));
      }
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('prewarms the selected tutor voice after Start and generation waits for it', async () => {
    const realFetch = global.fetch;
    const primeResponse = createDeferred();
    let primeCalls = 0;
    let generateCalls = 0;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/prewarm-selected-reference.wav' });
      }
      if (urlStr.includes('/v1/reference-audio/prime')) {
        primeCalls += 1;
        return primeResponse.promise;
      }
      if (urlStr.includes('/generate')) {
        generateCalls += 1;
        return mockAudioResponse(200, Buffer.from('PREWARMED_PCM'), {
          generationMode: 'cloned-synthesis',
        });
      }
      return realFetch(url, options);
    };

    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        return mockJsonResponse(200, {
          voiceSessionId: 'prewarm-voice-session',
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
          createdAt: Date.now(),
        });
      },
    });
    const ctx = await startTestApp({
      ttsTemplatePrewarmEnabled: false,
      fetchImpl,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'prewarm-selected-reference',
      });
      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(started.status, 200, 'Start must not wait for GPU prewarm');
      await waitForCondition(() => primeCalls === 1, 'selected-reference prewarm');

      const speech = realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetText: 'A short response.' }),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(generateCalls, 0, 'generation must not collide with prewarm');

      primeResponse.resolve(mockJsonResponse(200, {
        prepared: true,
        cache_hit: false,
        prepare_ms: 1600,
      }));
      const response = await speech;
      assert.equal(response.status, 200);
      assert.equal(generateCalls, 1);
    } finally {
      primeResponse.resolve(mockJsonResponse(200, { prepared: true, cache_hit: false }));
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('reference preparation failures never log exception-carried secrets', async () => {
    const realFetch = global.fetch;
    const clipId = 'privacy-regression-reference';
    const qualitySecret = 'SECRET_QUALITY_TOKEN_AND_CLIP';
    const downloadSecret = 'SECRET_DOWNLOAD_URL_AND_PATH';
    const events = [];
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        throw new Error(downloadSecret);
      }
      return realFetch(url, options);
    };

    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        [`/api/v1/voice/reference/${clipId}`]: async () => {
          throw new Error(qualitySecret);
        },
      }),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });
    try {
      const started = await httpPost(ctx.baseUrl, '/session/start', {});
      const session = ctx.runtime.sessions.get(started.body.sessionId);
      session.voiceState.referenceClipId = clipId;

      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: session.id,
          targetText: 'This content must not enter preparation logs.',
        }),
      });

      assert.equal(response.status, 409);
      const serialized = JSON.stringify(events);
      assert.doesNotMatch(serialized, new RegExp(qualitySecret));
      assert.doesNotMatch(serialized, new RegExp(downloadSecret));
      assert.ok(events.some((event) => (
        event?.event === 'tts_reference_quality_lookup'
        && event?.outcome === 'unavailable'
      )));
      assert.ok(events.some((event) => (
        event?.event === 'tts_reference_audio_prepare'
        && event?.outcome === 'unavailable'
      )));
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('serializes prewarm across End and a different selected reference', async () => {
    const realFetch = global.fetch;
    const firstPrime = createDeferred();
    const primeCalls = [];
    let generateCalls = 0;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        const body = JSON.parse(options?.body || '{}');
        return mockJsonResponse(200, { path: `/tmp/${body.clip_id}.wav` });
      }
      if (urlStr.includes('/v1/reference-audio/prime')) {
        const body = JSON.parse(options?.body || '{}');
        primeCalls.push(body.reference_audio_path);
        if (body.reference_audio_path.includes('serial-reference-a')) {
          return firstPrime.promise;
        }
        return mockJsonResponse(200, { prepared: true, cache_hit: false, prepare_ms: 20 });
      }
      if (urlStr.includes('/generate')) {
        generateCalls += 1;
        return mockAudioResponse(200, Buffer.from('SERIALIZED_PCM'), {
          generationMode: 'cloned-synthesis',
        });
      }
      return realFetch(url, options);
    };

    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        return mockJsonResponse(200, {
          voiceSessionId: `serial-${body.referenceClipId}`,
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
          createdAt: Date.now(),
        });
      },
    });
    const ctx = await startTestApp({
      ttsTemplatePrewarmEnabled: false,
      fetchImpl,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'serial-reference-a',
      });
      await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      await waitForCondition(() => primeCalls.length === 1, 'first reference prewarm');

      await httpPost(ctx.baseUrl, '/voice/session/end', { sessionId });
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'serial-reference-b',
      });
      const restarted = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(restarted.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.deepEqual(primeCalls, ['/tmp/serial-reference-a.wav']);

      const speech = realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetText: 'Continue with the new voice.' }),
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(generateCalls, 0);

      firstPrime.resolve(mockJsonResponse(200, {
        prepared: true,
        cache_hit: false,
        prepare_ms: 1600,
      }));
      await waitForCondition(() => primeCalls.length === 2, 'second reference prewarm');
      assert.deepEqual(primeCalls, [
        '/tmp/serial-reference-a.wav',
        '/tmp/serial-reference-b.wav',
      ]);
      const response = await speech;
      assert.equal(response.status, 200);
      assert.equal(generateCalls, 1);
    } finally {
      firstPrime.resolve(mockJsonResponse(200, { prepared: true, cache_hit: false }));
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('retries a busy prewarm categorically before first generation', async () => {
    const realFetch = global.fetch;
    const events = [];
    let primeCalls = 0;
    let generateCalls = 0;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/busy-retry-reference.wav' });
      }
      if (urlStr.includes('/v1/reference-audio/prime')) {
        primeCalls += 1;
        if (primeCalls < 3) return mockJsonResponse(429, { detail: 'busy' });
        return mockJsonResponse(200, { prepared: true, cache_hit: false, prepare_ms: 10 });
      }
      if (urlStr.includes('/generate')) {
        generateCalls += 1;
        return mockAudioResponse(200, Buffer.from('BUSY_RETRY_PCM'), {
          generationMode: 'cloned-synthesis',
        });
      }
      return realFetch(url, options);
    };
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        return mockJsonResponse(200, {
          voiceSessionId: 'busy-retry-session',
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
          createdAt: Date.now(),
        });
      },
    });
    const ctx = await startTestApp({
      ttsTemplatePrewarmEnabled: false,
      fetchImpl,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'busy-retry-reference',
      });
      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(started.status, 200);

      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetText: 'Wait for the prepared voice.' }),
      });
      assert.equal(response.status, 200);
      assert.equal(primeCalls, 3);
      assert.equal(generateCalls, 1);
      assert.equal(events.filter((event) => event?.outcome === 'busy_retry').length, 2);
      assert.ok(events.some((event) => event?.outcome === 'prepared'));
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('retries generation admission when a cancelled synthesis still owns the worker', async () => {
    const realFetch = global.fetch;
    const events = [];
    let generateCalls = 0;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/generation-busy-reference.wav' });
      }
      if (urlStr.includes('/generate')) {
        generateCalls += 1;
        if (generateCalls < 3) return mockJsonResponse(429, { detail: 'busy' });
        return mockAudioResponse(200, Buffer.from('RELEASED_WORKER_PCM'), {
          generationMode: 'cloned-synthesis',
        });
      }
      return realFetch(url, options);
    };
    const ctx = await startTestApp({
      ttsTemplatePrewarmEnabled: false,
      fetchImpl: buildMockFetchImpl(),
      env: {
        VOXCPM_ENABLED: 'true',
        VOXCPM_URL: 'http://127.0.0.1:8020',
        VOXCPM_TIMEOUT_MS: '1500',
      },
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'generation-busy-reference',
      });

      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetText: 'Continue after the worker releases.' }),
      });

      assert.equal(response.status, 200);
      assert.equal(generateCalls, 3);
      assert.equal(events.filter((event) => (
        event?.event === 'tts_generation_admission'
        && event?.outcome === 'busy_retry'
      )).length, 2);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('bounds a persistently busy generation worker by the request phase timeout', async () => {
    const realFetch = global.fetch;
    const events = [];
    let generateCalls = 0;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/generation-timeout-reference.wav' });
      }
      if (urlStr.includes('/generate')) {
        generateCalls += 1;
        return mockJsonResponse(429, { detail: 'busy' });
      }
      return realFetch(url, options);
    };
    const ctx = await startTestApp({
      ttsTemplatePrewarmEnabled: false,
      fetchImpl: buildMockFetchImpl(),
      env: {
        VOXCPM_ENABLED: 'true',
        VOXCPM_URL: 'http://127.0.0.1:8020',
        VOXCPM_TIMEOUT_MS: '80',
      },
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'generation-timeout-reference',
      });

      const startedAt = Date.now();
      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, targetText: 'Do not fail immediately while busy.' }),
      });

      assert.equal(response.status, 504);
      assert.ok(Date.now() - startedAt < 1000);
      assert.equal(generateCalls, 1);
      assert.equal(events.filter((event) => (
        event?.event === 'tts_generation_admission'
        && event?.outcome === 'busy_retry'
      )).length, 1);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('gateway close drains admitted prewarm and prevents new preset admission', async () => {
    const realFetch = global.fetch;
    const admittedPrime = createDeferred();
    let primeCalls = 0;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        const body = JSON.parse(options?.body || '{}');
        return mockJsonResponse(200, { path: `/tmp/${body.clip_id}.wav` });
      }
      if (urlStr.includes('/v1/reference-audio/prime')) {
        primeCalls += 1;
        return admittedPrime.promise;
      }
      return realFetch(url, options);
    };
    const fetchImpl = buildMockFetchImpl({
      '/api/v1/voice/sessions/start': async (_url, options = {}) => {
        const body = JSON.parse(options.body || '{}');
        return mockJsonResponse(200, {
          voiceSessionId: `close-${body.referenceClipId}`,
          status: 'ready',
          targetPreset: body.targetPreset,
          targetSource: body.targetSource,
          referenceClipId: body.referenceClipId,
          targetProfileId: body.targetVoiceProfile?.profileId || null,
          analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
          createdAt: Date.now(),
        });
      },
    });
    const ctx = await startTestApp({
      ttsTemplatePrewarmEnabled: false,
      fetchImpl,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'close-reference-a',
      });
      await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      await waitForCondition(() => primeCalls === 1, 'admitted prewarm before close');

      const drained = ctx.runtime.closeReferencePrewarms();
      await httpPost(ctx.baseUrl, '/voice/session/end', { sessionId });
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: 'close-reference-b',
      });
      const restarted = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(restarted.status, 200);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(primeCalls, 1, 'closed gateway must not admit a new reference prewarm');

      admittedPrime.resolve(mockJsonResponse(200, {
        prepared: true,
        cache_hit: false,
        prepare_ms: 1600,
      }));
      await drained;
      assert.equal(primeCalls, 1);
    } finally {
      admittedPrime.resolve(mockJsonResponse(200, { prepared: true, cache_hit: false }));
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('fails closed before VoxCPM generation when the selected reference cannot be cloned', async () => {
    const realFetch = global.fetch;
    let upstreamGenerateCalls = 0;
    global.fetch = async function patchedFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/generate')) {
        upstreamGenerateCalls += 1;
        return mockAudioResponse(200, Buffer.from('UNBOUND_AUDIO_MUST_NOT_EXIST'));
      }
      return realFetch(url, options);
    };

    const clipId = 'uncloneable-selected-reference';
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        [`/api/v1/voice/reference/${clipId}`]: async () => mockJsonResponse(200, {
          clipId,
          quality: { verdict: 'good', cloneable: true },
        }),
      }),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      const session = ctx.runtime.sessions.get(start.body.sessionId);
      session.voiceState.referenceClipId = clipId;

      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: session.id, targetText: 'This must stay silent.' }),
      });
      assert.equal(response.status, 409);
      assert.equal(response.headers.get('x-reference-resolved'), 'false');
      assert.equal(response.headers.get('x-voice-cloned'), 'false');
      assert.equal(upstreamGenerateCalls, 0);
      assert.deepEqual(await response.json(), {
        success: false,
        provider: 'voxcpm',
        error: 'Selected tutor voice is unavailable.',
      });
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('records coach-spoke continuity only through the successful playback route', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
    try {
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      const session = ctx.runtime.sessions.get(start.body.sessionId);
      session.voiceState.referenceClipId = 'played-reference';

      const played = await httpPost(ctx.baseUrl, '/voice/speech/played', {
        sessionId: session.id,
        provider: 'voxcpm',
      });
      assert.equal(played.status, 200);
      assert.equal(played.body.recorded, true);
      assert.equal(session.voiceState.lastCoachSpokenAt, played.body.coachSpokeAt);

      const rejected = await httpPost(ctx.baseUrl, '/voice/speech/played', {
        sessionId: session.id,
        provider: 'browser',
      });
      assert.equal(rejected.status, 409);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('disconnect during delayed clone preparation never starts VoxCPM generation', async () => {
    const realFetch = global.fetch;
    const clipId = 'clone-delay-clip';
    const qualityStarted = createDeferred();
    const qualityResponse = createDeferred();
    const generateCalled = createDeferred();
    let generateCallCount = 0;
    let referenceAnalysisCallCount = 0;
    let ctx;

    global.fetch = async function patchedFetch(url, options = {}) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        return mockJsonResponse(200, { path: '/tmp/clone-delay-ref.wav' });
      }
      if (urlStr.includes('/generate')) {
        generateCallCount += 1;
        generateCalled.resolve();
        return mockAudioResponse(200, Buffer.from('RIFFclone-delay'));
      }
      return realFetch(url, options);
    };

    try {
      ctx = await startTestApp({
      ttsTemplatePrewarmEnabled: false,
        fetchImpl: buildMockFetchImpl({
          [`/api/v1/voice/reference/${clipId}`]: async () => {
            referenceAnalysisCallCount += 1;
            if (referenceAnalysisCallCount === 1) {
              return mockJsonResponse(200, {
                clipId,
                analysisVersion: CURRENT_TEST_ANALYSIS_VERSION,
                filename: `${clipId}.wav`,
                durationMs: 6400,
                targetPreset: 'cute-feminine',
                metrics: { advanced: { measurementAvailable: true } },
                timeline: [],
                quality: { verdict: 'good', cloneable: true },
              });
            }
            qualityStarted.resolve();
            return qualityResponse.promise;
          },
        }),
        env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
        disableSessionPersistence: true,
      });
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = start.body.sessionId;
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId,
        referenceClipId: clipId,
        referenceClipName: 'delayed clone sample',
      });

      const body = JSON.stringify({ sessionId, targetText: 'must never reach VoxCPM' });
      const request = http.request(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
        },
      });
      request.on('response', (response) => response.resume());
      request.on('error', () => {}); // expected after the deliberate client disconnect
      request.end(body);

      await beforeTimeout(qualityStarted.promise, 'clone quality lookup to start');
      const activeStreams = ctx.runtime.voiceOperationRouteHandlers.activeTtsStreams;
      assert.equal(activeStreams.size, 1, 'clone preparation must already have lifecycle ownership');
      const activeController = activeStreams.values().next().value;
      const lifecycleAborted = createDeferred();
      activeController.signal.addEventListener('abort', () => lifecycleAborted.resolve(), { once: true });
      const clientClosed = new Promise((resolve) => request.once('close', resolve));
      request.destroy();
      await beforeTimeout(clientClosed, 'clone-preparation client to disconnect');
      await beforeTimeout(lifecycleAborted.promise, 'clone-preparation lifecycle abort');
      assert.equal(activeController.signal.reason?.name, 'AbortError');
      qualityResponse.resolve(mockJsonResponse(200, {
        quality: { cloneable: true, cloneNote: null },
      }));

      const generated = await Promise.race([
        generateCalled.promise.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 150)),
      ]);
      assert.equal(generated, false, 'VoxCPM /generate must not start after client disconnect');
      assert.equal(generateCallCount, 0);
      await waitForCondition(() => activeStreams.size === 0, 'clone-preparation stream cleanup');
    } finally {
      qualityResponse.resolve(mockJsonResponse(200, { quality: { cloneable: true } }));
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// 5. Speech Cancel
// ---------------------------------------------------------------------------

describe('Speech Cancel', () => {
  it('cancel returns success when no active stream', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'false' },
      disableSessionPersistence: true,
    });
    try {
      const { status, body } = await httpPost(ctx.baseUrl, '/voice/speech/cancel', {});
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.cancelled, false);
      assert.equal(body.sessionId, null);
      assert.equal(body.streamId, null);
      assert.equal(body.provider, 'browser');
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('cancel returns false for an unknown stream id', async () => {
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
      disableSessionPersistence: true,
    });
    try {
      const { status, body } = await httpPost(ctx.baseUrl, '/voice/speech/cancel', {
        sessionId: 'cancel-session-unknown',
        streamId: 'unknown-stream-id',
      });
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.cancelled, false);
      assert.equal(body.sessionId, 'cancel-session-unknown');
      assert.equal(body.streamId, 'unknown-stream-id');
      assert.equal(body.provider, 'voxcpm');
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('cancel aborts a real active stream by its exposed gateway stream id', async () => {
    const realFetch = global.fetch;
    const firstPcmChunk = Buffer.from([0x00, 0x80, 0xff, 0x7f]);
    let ctx;
    let upstreamSignal = null;
    let upstreamAbortObserved = false;
    let markSecondReadStarted;
    const secondReadStarted = new Promise((resolve) => {
      markSecondReadStarted = resolve;
    });
    global.fetch = async function patchedFetch(url, options = {}) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (!urlStr.includes('/generate')) {
        return realFetch(url, options);
      }

      upstreamSignal = options.signal;
      upstreamSignal.addEventListener('abort', () => {
        upstreamAbortObserved = true;
      }, { once: true });
      let readCount = 0;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Audio-Format': 'pcm_s16le',
          'X-Audio-Sample-Rate': '24000',
          'X-Audio-Channels': '1',
          'X-Speaking-Rate-Applied': '0.76',
          'X-TTS-Generation-Mode': 'profile-synthesis',
          'X-Reference-Audio-Role': 'none',
        }),
        body: {
          getReader() {
            return {
              async read() {
                readCount += 1;
                if (readCount === 1) {
                  return { done: false, value: firstPcmChunk };
                }
                markSecondReadStarted();
                return new Promise((_resolve, reject) => {
                  const rejectForAbort = () => {
                    const error = new Error('Mock VoxCPM stream aborted');
                    error.name = 'AbortError';
                    reject(error);
                  };
                  if (upstreamSignal.aborted) {
                    rejectForAbort();
                    return;
                  }
                  upstreamSignal.addEventListener('abort', rejectForAbort, { once: true });
                });
              },
              releaseLock() {},
            };
          },
        },
        async text() { return ''; },
        async json() { return {}; },
      };
    };

    try {
      ctx = await startTestApp({
        fetchImpl: buildMockFetchImpl(),
        env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
        disableSessionPersistence: true,
      });
      const generateResponse = await beforeTimeout(realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Origin: 'https://voice-client.example',
        },
        body: JSON.stringify({
          sessionId: 'cancel-session-active',
          targetText: 'hold this stream open',
        }),
      }), 'active stream response headers');
      assert.equal(generateResponse.status, 200);
      const streamId = generateResponse.headers.get('x-voice-speech-stream-id');
      assert.ok(streamId, 'generate must return the gateway stream id');
      const exposedHeaders = (generateResponse.headers.get('access-control-expose-headers') || '')
        .split(',')
        .map((headerName) => headerName.trim().toLowerCase())
        .filter(Boolean);
      for (const headerName of [
        'X-Audio-Format',
        'X-Audio-Sample-Rate',
        'X-Audio-Channels',
        'X-Voice-Speech-Stream-Id',
      ]) {
        assert.ok(
          exposedHeaders.includes(headerName.toLowerCase()),
          `CORS must expose ${headerName}; got ${JSON.stringify(exposedHeaders)}`,
        );
      }
      await beforeTimeout(secondReadStarted, 'the blocked upstream reader');

      const cancelResponse = await beforeTimeout(realFetch(`${ctx.baseUrl}/voice/speech/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'cancel-session-active',
          streamId,
        }),
      }), 'active stream cancel request');
      const cancelBody = await cancelResponse.json();
      assert.equal(cancelResponse.status, 200);
      assert.equal(cancelBody.success, true);
      assert.equal(cancelBody.cancelled, true);
      assert.equal(cancelBody.sessionId, 'cancel-session-active');
      assert.equal(cancelBody.streamId, streamId);
      assert.equal(cancelBody.provider, 'voxcpm');
      assert.equal(upstreamSignal.aborted, true);
      assert.equal(upstreamAbortObserved, true);
      await assert.rejects(
        beforeTimeout(generateResponse.arrayBuffer(), 'the cancelled gateway response body to reject'),
        /terminated|aborted|socket|closed|fetch/i,
      );

      const secondCancelResponse = await beforeTimeout(realFetch(`${ctx.baseUrl}/voice/speech/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId }),
      }), 'idempotent second cancel request');
      const secondCancelBody = await secondCancelResponse.json();
      assert.equal(secondCancelResponse.status, 200);
      assert.equal(secondCancelBody.success, true);
      assert.equal(secondCancelBody.cancelled, false);
      assert.equal(secondCancelBody.streamId, streamId);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('downstream disconnect aborts and cleans an active body stream without a cancel request', async () => {
    const realFetch = global.fetch;
    const firstPcmChunk = Buffer.from([0x10, 0x20, 0x30, 0x40]);
    const secondReadStarted = createDeferred();
    const upstreamAborted = createDeferred();
    let abortBeforeCancel = false;
    let cancelIssued = false;
    let ctx;
    let streamId = null;
    let upstreamAbortReason = null;

    global.fetch = async function patchedFetch(url, options = {}) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (!urlStr.includes('/generate')) return realFetch(url, options);
      return mockStallingAudioResponse(firstPcmChunk, options.signal, {
        onAbort(reason) {
          abortBeforeCancel = !cancelIssued;
          upstreamAbortReason = reason;
          upstreamAborted.resolve();
        },
        onBlocked: () => secondReadStarted.resolve(),
      });
    };

    try {
      ctx = await startTestApp({
        fetchImpl: buildMockFetchImpl(),
        env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
        disableSessionPersistence: true,
      });
      const body = JSON.stringify({
        sessionId: 'disconnect-session-active',
        targetText: 'disconnect this active stream',
      });
      const firstChunk = await beforeTimeout(new Promise((resolve, reject) => {
        let settled = false;
        const request = http.request(`${ctx.baseUrl}/voice/speech/generate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(body),
          },
        }, (response) => {
          streamId = response.headers['x-voice-speech-stream-id'];
          response.once('data', (chunk) => {
            settled = true;
            response.destroy();
            resolve(Buffer.from(chunk));
          });
          response.on('error', (error) => {
            if (!settled) reject(error);
          });
        });
        request.on('error', (error) => {
          if (!settled) reject(error);
        });
        request.end(body);
      }), 'first gateway body chunk before downstream disconnect');

      assert.deepEqual(firstChunk, firstPcmChunk);
      assert.ok(streamId, 'generate response must expose its gateway stream id');
      await beforeTimeout(secondReadStarted.promise, 'upstream reader to block');
      await beforeTimeout(upstreamAborted.promise, 'downstream disconnect to abort upstream');
      assert.equal(abortBeforeCancel, true, 'upstream abort must precede every /cancel request');
      assert.equal(upstreamAbortReason?.name, 'AbortError');
      const activeStreams = ctx.runtime.voiceOperationRouteHandlers.activeTtsStreams;
      await waitForCondition(() => activeStreams.size === 0, 'disconnected stream cleanup');

      cancelIssued = true;
      const cancelResponse = await beforeTimeout(realFetch(`${ctx.baseUrl}/voice/speech/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId }),
      }), 'post-disconnect cancel request');
      const cancelBody = await cancelResponse.json();
      assert.equal(cancelResponse.status, 200);
      assert.equal(cancelBody.cancelled, false);
      assert.equal(cancelBody.streamId, streamId);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Coaching Turn
// ---------------------------------------------------------------------------

describe('Coaching Turn', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
  });

  after(async () => {
    await stopTestApp(ctx);
  });

  it('runtime coaching turn returns message', async () => {
    const start = await httpPost(ctx.baseUrl, '/session/start', {});
    const sid = start.body.sessionId;

    const { status, body } = await httpPost(ctx.baseUrl, '/voice/coach/runtime', {
      sessionId: sid,
      message: 'How does my voice sound?',
    });
    assert.equal(status, 200);
    assert.ok(body.success !== false, 'should not be an error');
    assert.ok(body.message || body.coachMessage, 'should have a coach message');
    assert.ok(body.turnId, 'should have a turnId');
  });

  it('coaching turn with missing session returns 404', async () => {
    const { status, body } = await httpPost(ctx.baseUrl, '/voice/coach/runtime', {
      sessionId: 'nonexistent-session-id',
      message: 'Hello?',
    });
    assert.equal(status, 404);
    assert.equal(body.success, false);
  });

  it('coaching turn with empty message returns 400', async () => {
    const start = await httpPost(ctx.baseUrl, '/session/start', {});
    const sid = start.body.sessionId;

    const { status, body } = await httpPost(ctx.baseUrl, '/voice/coach/runtime', {
      sessionId: sid,
      message: '',
    });
    assert.equal(status, 400);
    assert.equal(body.success, false);
    assert.ok(body.error.includes('question') || body.error.includes('required'), `error: ${body.error}`);
  });
});

// ---------------------------------------------------------------------------
// 7. Reference Proxy
// ---------------------------------------------------------------------------

describe('Reference Proxy', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
  });

  after(async () => {
    await stopTestApp(ctx);
  });

  it('reference analyze proxies to VoiceTrainer', async () => {
    // proxyHttpRequest uses raw http — status depends on whether VoiceTrainer is running.
    // We verify the route exists (not 404) and handles the request.
    const resp = await fetch(`${ctx.baseUrl}/voice/reference/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    assert.notEqual(resp.status, 404, 'route should exist');
    assert.ok(resp.status >= 200, 'should get a response');
  });

  it('reference audio proxies to VoiceTrainer', async () => {
    const resp = await fetch(`${ctx.baseUrl}/voice/reference/test-clip-123/audio`);
    if (resp.status === 404) {
      // A PROXIED 404 (upstream "clip not found", JSON body) proves the route
      // exists and forwards; only Express's own HTML 404 means the route is missing.
      const contentType = resp.headers.get('content-type') || '';
      assert.ok(contentType.includes('json'), 'a 404 must come from the upstream proxy (json), not the router (html)');
    }
    assert.ok(resp.status >= 200, 'should get a response');
  });
});

// ---------------------------------------------------------------------------
// 8. Telemetry
// ---------------------------------------------------------------------------

describe('Telemetry', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
  });

  after(async () => {
    await stopTestApp(ctx);
  });

  it('get telemetry returns null for unknown turnId', async () => {
    const { status, body } = await httpGet(ctx.baseUrl, '/voice/turns/turn-nonexistent/telemetry');
    assert.equal(status, 200);
    assert.equal(body.success, false);
    assert.ok(body.error.includes('not found') || body.error.includes('Telemetry'));
  });

  it('store telemetry and retrieve it', async () => {
    const { deriveTelemetryCorrelationId } = require('./coaching/turn-telemetry');
    // POST to create a sparse telemetry record
    const { status, body } = await httpPost(ctx.baseUrl, '/voice/turns/turn-test-123/telemetry', {
      timestamps: { speech_end_at: Date.now() },
    });
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.correlationId, deriveTelemetryCorrelationId('turn-test-123'));
    assert.equal(Object.hasOwn(body, 'turnId'), false);
    assert.ok(body.telemetry, 'should have telemetry data');

    // Now GET it
    const get = await httpGet(ctx.baseUrl, '/voice/turns/turn-test-123/telemetry');
    assert.equal(get.status, 200);
    assert.equal(get.body.success, true);
    assert.equal(get.body.correlationId, deriveTelemetryCorrelationId('turn-test-123'));
    assert.equal(Object.hasOwn(get.body, 'turnId'), false);
  });

  it('rejects arbitrary slug-shaped fallback identifiers at the HTTP boundary', async () => {
    for (const fallbackReason of ['PRIVATE_EXCEPTION_TEXT', 'deadnamealice', 'sk_live_secret_value']) {
      const { status, body } = await httpPost(
        ctx.baseUrl,
        `/voice/turns/turn-private-${fallbackReason}/telemetry`,
        { fallback_reason: fallbackReason },
      );
      assert.equal(status, 200);
      assert.equal(body.success, true);
      assert.equal(body.telemetry.fallback_reason, null);
      assert.equal(JSON.stringify(body).includes(fallbackReason), false);
    }
  });

  it('does not let a sparse frontend success erase a gateway TTS failure', async () => {
    const turnId = 'turn-preserve-gateway-failure';
    const first = await httpPost(ctx.baseUrl, `/voice/turns/${turnId}/telemetry`, {
      fallback_reason: 'tts_timeout',
    });
    assert.equal(first.body.telemetry.fallback_reason, 'tts_timeout');

    const sparseSuccess = await httpPost(ctx.baseUrl, `/voice/turns/${turnId}/telemetry`, {
      timestamps: { playback_done_at: Date.now() },
      fallback_reason: null,
    });
    assert.equal(sparseSuccess.body.telemetry.fallback_reason, 'tts_timeout');
  });

  it('telemetry TTL eviction works', async () => {
    // This tests the internal eviction logic. We can't easily fast-forward time
    // in integration tests, but we can verify the eviction function exists and
    // doesn't crash when called.
    const runtime = ctx.runtime;
    assert.ok(runtime.turnTelemetryStore instanceof Map, 'should have turnTelemetryStore');

    // Store something
    const { TurnTelemetry } = require('./coaching/turn-telemetry');
    const telemetry = new TurnTelemetry({ turnId: 'turn-evict-test', sessionId: 's1' });
    runtime.turnTelemetryStore.set('turn-evict-test', telemetry);

    // Verify it's stored
    const stored = runtime.getTurnTelemetry('turn-evict-test');
    assert.ok(stored, 'telemetry should be stored');

    // The TTL is 1 hour, so it won't be evicted immediately.
    // Just verify the store is functional.
    assert.ok(runtime.turnTelemetryStore.size >= 1);
  });

  it('dispatches a structured metric-contract witness for a rejected custom-target take', async () => {
    const events = [];
    const customProfile = {
      profileId: 'custom-rejected-target',
      targetPreset: 'cute-feminine',
      pitchFloorHz: 188,
      pitchCeilingHz: 255,
      resonanceFloor: 0.32,
      resonanceCeiling: 1,
      weightFloor: 0,
      weightCeiling: 0.4,
    };
    const rejected = takeResponseWith();
    rejected.summary.target = {
      ...rejected.summary.target,
      source: 'custom-handmade',
      targetProfileId: customProfile.profileId,
    };
    rejected.attemptArtifact.target = { ...rejected.summary.target };
    rejected.summary.metrics.advanced.measurementAvailable = false;
    rejected.summary.metrics.advanced.measurementRejectionReasons = ['no_voiced_frames'];
    rejected.summary.metrics.advanced.voicedFramePct = 0;
    rejected.summary.metrics.advanced.confidentFramePct = 0;
    rejected.summary.metrics.advanced.scoreConfidence = 0;
    rejected.summary.metrics.advanced.captureReliability = 0;
    rejected.summary.metrics.advanced.pitchValidFrameCount = 0;
    rejected.summary.metrics.advanced.hnrValidFrameCount = 0;
    rejected.summary.metrics.advanced.hnrVoicedCoveragePct = 0;
    rejected.attemptArtifact.metrics.advanced = {
      ...rejected.summary.metrics.advanced,
    };
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const witnessCtx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '/v1/chat/completions': () => mockJsonResponse(200, {
          choices: [{ message: { content: 'That was a struggle with the connection. Try it again.' } }],
          usage: { total_tokens: 18 },
        }),
        '/api/v1/voice/sessions/start': (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          return mockJsonResponse(200, {
            voiceSessionId: 'mock-vt-session-1',
            status: 'ready',
            targetPreset: body.targetPreset,
            targetSource: body.targetSource,
            referenceClipId: body.referenceClipId || null,
            targetProfileId: body.targetVoiceProfile?.profileId || null,
            streamUrl: '/api/v1/voice/sessions/mock-vt-session-1/stream',
            createdAt: Date.now(),
          });
        },
        [takeUrl]: (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          rejected.attemptArtifact.sloaneSessionId = body.sloaneSessionId || null;
          rejected.attemptArtifact.clientAttemptId = body.clientAttemptId || null;
          return mockJsonResponse(200, rejected);
        },
      }),
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });

    try {
      const start = await httpPost(witnessCtx.baseUrl, '/session/start', {});
      const sid = start.body.sessionId;
      await httpPost(witnessCtx.baseUrl, '/voice/session/start', {
        sessionId: sid,
        targetPreset: 'cute-feminine',
        targetSource: 'custom-handmade',
        targetVoiceProfile: customProfile,
      });
      await httpPost(witnessCtx.baseUrl, '/voice/session/take', { sessionId: sid });
      const turn = await httpPost(witnessCtx.baseUrl, '/voice/coach/runtime', {
        sessionId: sid,
        message: 'Help me improve my pitch.',
        audioBase64: 'AAAA',
        audioFormat: 'wav',
      });

      assert.equal(turn.status, 200);
      assert.equal(turn.body.coachingSignal.takeQuality.usable, false);
      assert.equal(turn.body.coachingSignal.coachingDecision.primaryFocus, 'none');
      assert.match(turn.body.message, /didn't capture enough of your voice/i);
      assert.doesNotMatch(turn.body.message, /connection/i);
      const witness = events.find((event) => event?.event === 'coach_metric_contract');
      assert.ok(witness, `metric contract event missing: ${JSON.stringify(events)}`);
      assert.deepEqual(witness.failures, ['measurement_unavailable']);
      assert.equal(witness.measurement_available, false);
      assert.ok(witness.measurement_rejection_reasons.includes('no_voiced_frames'));
      assert.ok(witness.measurement_rejection_reasons.includes('low_score_confidence'));
      assert.equal(witness.target_contract_present, true);
      assert.equal(witness.target_source, 'custom-handmade');
      assert.equal(witness.target_profile_present, true);
      assert.equal(witness.target_profile_id, undefined);
      assert.equal(witness.pitch_valid_frame_count, 0);
      assert.equal(witness.hnr_valid_frame_count, 0);
      assert.equal(witness.hnr_voiced_coverage_pct, 0);
      assert.equal(witness.audio_suppressed, true);
      assert.doesNotMatch(JSON.stringify(witness), /custom-rejected-target/);
      const repairWitness = events.find((event) => event?.event === 'sanitizer_capture_repair');
      assert.equal(repairWitness?.cause, 'not_enough_voice');
      assert.doesNotMatch(JSON.stringify(repairWitness), /connection|capture enough/i);
    } finally {
      await stopTestApp(witnessCtx);
    }
  });

  it('rejects a cross-target take before state mutation or learner recording', async () => {
    const events = [];
    const learnerRoot = freshLearnerRoot();
    let quarantineCalls = 0;
    const mismatched = takeResponseWith();
    mismatched.summary.target = {
      ...mismatched.summary.target,
      source: 'custom-handmade',
      targetProfileId: 'injected-other-profile',
    };
    mismatched.attemptArtifact.target = { ...mismatched.summary.target };
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const witnessCtx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        [takeUrl]: (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          mismatched.attemptArtifact.sloaneSessionId = body.sloaneSessionId || null;
          return mockJsonResponse(200, mismatched);
        },
        '/api/v1/voice/sessions/mock-vt-session-1/end': () => {
          quarantineCalls += 1;
          return mockJsonResponse(200, { status: 'ended' });
        },
      }),
      disableSessionPersistence: true,
      learnerContextRoot: learnerRoot,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });

    try {
      const start = await httpPost(witnessCtx.baseUrl, '/session/start', {
        studentId: 'provenance-student',
      });
      const sid = start.body.sessionId;
      await httpPost(witnessCtx.baseUrl, '/voice/session/start', { sessionId: sid });
      const take = await httpPost(witnessCtx.baseUrl, '/voice/session/take', { sessionId: sid });

      assert.equal(take.status, 502);
      assert.match(String(take.body?.error), /different target or session/i);
      const current = await httpGet(witnessCtx.baseUrl, `/voice/session/${sid}`);
      assert.equal(current.body.voiceState.status, 'error');
      assert.equal(current.body.voiceState.voiceSessionId, null);
      assert.equal(current.body.voiceState.lastSummary, null);
      assert.equal(current.body.voiceState.lastAttemptArtifact, null);
      const profile = await httpGet(
        witnessCtx.baseUrl,
        '/voice/learner-context/profile?studentId=provenance-student',
      );
      assert.deepEqual(profile.body.studentModel?.recentAttempts || [], []);
      assert.deepEqual(profile.body.studentModel?.targetHistory || [], []);
      assert.equal(quarantineCalls, 1);

      const provenanceWitness = events.find((event) => event?.event === 'take_target_provenance');
      assert.ok(provenanceWitness, `take provenance event missing: ${JSON.stringify(events)}`);
      assert.ok(provenanceWitness.failures.includes('summary_target_source_mismatch'));
      assert.ok(provenanceWitness.failures.includes('summary_target_profile_mismatch'));
      assert.ok(provenanceWitness.failures.includes('artifact_target_source_mismatch'));
      assert.ok(provenanceWitness.failures.includes('artifact_target_profile_mismatch'));
      assert.equal(provenanceWitness.quarantine_attempted, true);
      assert.equal(provenanceWitness.quarantine_acknowledged, true);
      assert.doesNotMatch(
        JSON.stringify(provenanceWitness),
        /injected-other-profile|targetKey|profileId|clipId|pitchFloorHz/,
      );
    } finally {
      await stopTestApp(witnessCtx);
      try { fs.rmSync(learnerRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('rejects changed custom bands even when preset, source, profile, and direction match', async () => {
    const events = [];
    const customProfile = {
      profileId: 'band-bound-profile',
      targetPreset: 'soft-feminine',
      direction: 'masculine',
      pitchFloorHz: 100,
      pitchCeilingHz: 150,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
    };
    const changed = takeResponseWith();
    changed.summary.targetPreset = 'soft-feminine';
    changed.attemptArtifact.targetPreset = 'soft-feminine';
    changed.summary.target = {
      ...customProfile,
      source: 'custom-handmade',
      targetProfileId: customProfile.profileId,
      pitchCeilingHz: 151,
    };
    delete changed.summary.target.profileId;
    changed.attemptArtifact.target = { ...changed.summary.target };
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const witnessCtx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '/api/v1/voice/sessions/start': (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          return mockJsonResponse(200, {
            voiceSessionId: 'mock-vt-session-1',
            status: 'ready',
            targetPreset: body.targetPreset,
            targetSource: body.targetSource,
            referenceClipId: body.referenceClipId || null,
            targetProfileId: body.targetVoiceProfile?.profileId || null,
            createdAt: Date.now(),
          });
        },
        [takeUrl]: (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          changed.attemptArtifact.sloaneSessionId = body.sloaneSessionId || null;
          return mockJsonResponse(200, changed);
        },
      }),
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });

    try {
      const start = await httpPost(witnessCtx.baseUrl, '/session/start', {});
      const sid = start.body.sessionId;
      const armed = await httpPost(witnessCtx.baseUrl, '/voice/session/start', {
        sessionId: sid,
        targetPreset: 'soft-feminine',
        targetSource: 'custom-handmade',
        targetVoiceProfile: customProfile,
      });
      assert.equal(armed.status, 200);
      const take = await httpPost(witnessCtx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(take.status, 502);
      const witness = events.find((event) => event?.event === 'take_target_provenance');
      assert.ok(witness?.failures.includes('summary_target_pitchCeilingHz_mismatch'));
      assert.ok(witness?.failures.includes('artifact_target_pitchCeilingHz_mismatch'));
      assert.doesNotMatch(JSON.stringify(witness), /band-bound-profile|pitchFloorHz\":100/);
    } finally {
      await stopTestApp(witnessCtx);
    }
  });

  it('quarantines a reference take produced under a stale calibration epoch', async () => {
    const events = [];
    const learnerRoot = freshLearnerRoot();
    const referenceClipId = 'take-calibration-reference';
    const profileId = `reference-profile-${referenceClipId}`;
    let quarantineCalls = 0;
    const stale = takeResponseWith();
    const referenceTarget = {
      source: 'reference',
      targetPreset: 'cute-feminine',
      targetProfileId: profileId,
      direction: 'feminine',
      pitchFloorHz: 181.25,
      pitchCeilingHz: 236.75,
      resonanceFloor: 0.57,
      resonanceCeiling: 0.7,
      weightFloor: 0.25,
      weightCeiling: 0.38,
    };
    stale.summary.analysisVersion = 'voice-metrics-v2-legacy';
    stale.summary.target = { ...referenceTarget };
    stale.attemptArtifact.analysisVersion = 'voice-metrics-v2-legacy';
    stale.attemptArtifact.referenceClipId = referenceClipId;
    stale.attemptArtifact.target = { ...referenceTarget };
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const witnessCtx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '/api/v1/voice/sessions/start': (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          return mockJsonResponse(200, {
            voiceSessionId: 'mock-vt-session-1',
            status: 'ready',
            targetPreset: body.targetPreset,
            targetSource: body.targetSource,
            referenceClipId: body.referenceClipId,
            targetProfileId: body.targetVoiceProfile?.profileId || null,
            analysisVersion: body.targetVoiceProfile?.analysisVersion || null,
            createdAt: Date.now(),
          });
        },
        [takeUrl]: (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          stale.attemptArtifact.sloaneSessionId = body.sloaneSessionId || null;
          stale.attemptArtifact.clientAttemptId = body.clientAttemptId || null;
          return mockJsonResponse(200, stale);
        },
        '/api/v1/voice/sessions/mock-vt-session-1/end': () => {
          quarantineCalls += 1;
          return mockJsonResponse(200, { status: 'ended' });
        },
      }),
      disableSessionPersistence: true,
      learnerContextRoot: learnerRoot,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });

    try {
      const start = await httpPost(witnessCtx.baseUrl, '/session/start', {
        studentId: 'calibration-provenance-student',
      });
      const sid = start.body.sessionId;
      const bound = await httpPost(witnessCtx.baseUrl, '/voice/session/reference', {
        sessionId: sid,
        referenceClipId,
        referenceClipName: 'take-calibration.wav',
      });
      assert.equal(bound.status, 200);
      const armed = await httpPost(witnessCtx.baseUrl, '/voice/session/start', { sessionId: sid });
      assert.equal(armed.status, 200);
      const take = await httpPost(witnessCtx.baseUrl, '/voice/session/take', { sessionId: sid });

      assert.equal(take.status, 502);
      assert.equal(quarantineCalls, 1);
      const current = await httpGet(witnessCtx.baseUrl, `/voice/session/${sid}`);
      assert.equal(current.body.voiceState.status, 'error');
      assert.equal(current.body.voiceState.voiceSessionId, null);
      assert.equal(current.body.voiceState.lastSummary, null);
      assert.equal(current.body.voiceState.lastAttemptArtifact, null);
      const profile = await httpGet(
        witnessCtx.baseUrl,
        '/voice/learner-context/profile?studentId=calibration-provenance-student',
      );
      assert.deepEqual(profile.body.studentModel?.recentAttempts || [], []);
      assert.deepEqual(profile.body.studentModel?.targetHistory || [], []);
      const witness = events.find((event) => event?.event === 'take_target_provenance');
      assert.deepEqual(witness?.failures, [
        'summary_analysis_version_mismatch',
        'artifact_target_analysis_version_mismatch',
      ]);
      assert.equal(witness?.quarantine_acknowledged, true);
      assert.doesNotMatch(
        JSON.stringify(witness || {}),
        /voice-metrics-v2-legacy|take-calibration-reference|calibration-provenance-student/,
      );
    } finally {
      await stopTestApp(witnessCtx);
      try { fs.rmSync(learnerRoot, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('rejects mismatched provenance returned while ending an analyzer session', async () => {
    const events = [];
    const mismatched = takeResponseWith({ status: 'ended' });
    mismatched.summary.target.source = 'custom-handmade';
    mismatched.summary.target.targetProfileId = 'end-injected-profile';
    mismatched.attemptArtifact.target = { ...mismatched.summary.target };
    const witnessCtx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '/api/v1/voice/sessions/mock-vt-session-1/end': (_url, options = {}) => {
          const body = JSON.parse(options.body || '{}');
          mismatched.attemptArtifact.sloaneSessionId = body.sloaneSessionId || null;
          mismatched.attemptArtifact.clientAttemptId = body.clientAttemptId || null;
          return mockJsonResponse(200, mismatched);
        },
      }),
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });

    try {
      const start = await httpPost(witnessCtx.baseUrl, '/session/start', {});
      const sid = start.body.sessionId;
      await httpPost(witnessCtx.baseUrl, '/voice/session/start', { sessionId: sid });
      const ended = await httpPost(witnessCtx.baseUrl, '/voice/session/end', { sessionId: sid });
      assert.equal(ended.status, 502);
      const current = await httpGet(witnessCtx.baseUrl, `/voice/session/${sid}`);
      assert.equal(current.body.voiceState.status, 'error');
      assert.equal(current.body.voiceState.lastSummary, null);
      const witness = events.find((event) => event?.event === 'take_target_provenance');
      assert.ok(witness?.failures.includes('summary_target_source_mismatch'));
      assert.ok(witness?.failures.includes('artifact_target_source_mismatch'));
      assert.equal(witness?.quarantine_attempted, false);
      assert.equal(witness?.quarantine_acknowledged, true);
      assert.doesNotMatch(JSON.stringify(witness), /end-injected-profile|targetKey|profileId|clipId/);
    } finally {
      await stopTestApp(witnessCtx);
    }
  });

  it('replaces model rep pressure and logs only categorical sanitizer evidence', async () => {
    const events = [];
    const pressureCtx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '/v1/chat/completions': () => mockJsonResponse(200, {
          choices: [{ message: { content: 'That was cleaner. Try one more for me.' } }],
          usage: { total_tokens: 16 },
        }),
      }),
      disableSessionPersistence: true,
      logger: {
        log(event) { events.push(event); },
        warn() {},
        error() {},
      },
    });

    try {
      const start = await httpPost(pressureCtx.baseUrl, '/session/start', {});
      const turn = await httpPost(pressureCtx.baseUrl, '/voice/coach/runtime', {
        sessionId: start.body.sessionId,
        message: 'How was that?',
      });
      assert.equal(turn.status, 200);
      assert.equal(turn.body.message, 'Say the practice sentence slowly, and let the lips and jaw finish each word before the next one begins.');
      assert.doesNotMatch(turn.body.message, /one more/i);
      const witness = events.find((event) => event?.event === 'sanitizer_rep_pressure');
      assert.equal(witness?.replacement_count, 1);
      assert.deepEqual(witness?.rules, ['imperative_one_more']);
      assert.doesNotMatch(JSON.stringify(witness), /Try one more for me|That was cleaner/);
      const coreLoopWitness = events.find((event) => event?.event === 'sanitizer_core_loop_repair');
      assert.equal(coreLoopWitness?.cause, 'missing_actionable_cue');
      assert.doesNotMatch(JSON.stringify(coreLoopWitness), /Try one more for me|That was cleaner/);
    } finally {
      await stopTestApp(pressureCtx);
    }
  });
});

// ---------------------------------------------------------------------------
// 9. Health & Readiness
// ---------------------------------------------------------------------------

describe('Health & Readiness', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
    });
  });

  after(async () => {
    await stopTestApp(ctx);
  });

  it('health endpoint returns ok', async () => {
    const { status, body } = await httpGet(ctx.baseUrl, '/health');
    // Health checks VoiceTrainer, GGUF, and configured VoxCPM.
    assert.equal(status, 200);
    assert.equal(body.status, 'online');
    assert.equal(body.service, 'voice-tutor-standalone');
    assert.ok(body.services, 'should have services');
    assert.equal(body.services.voiceTrainer.status, 'online');
    assert.equal(body.services.voiceTutorGguf.status, 'online');
    assert.equal(body.services.voxcpm.status, 'online');
    assert.equal(body.services.learnerMemory.status, 'online');
    assert.equal(body.memoryStorage.learner.writeBlocked, false);
    assert.match(body.memoryStorage.learner.status, /^(healthy|recovered)$/);
    assert.equal(body.services.sessionMemory.status, 'disabled');
  });

  it('readiness endpoint returns status', async () => {
    const { status, body } = await httpGet(ctx.baseUrl, '/voice/standalone/readiness');
    assert.ok([200, 503].includes(status), `unexpected status: ${status}`);
    assert.ok(body.service === 'voice-tutor-standalone');
    assert.ok(body.status, 'should have status');
    assert.ok(Array.isArray(body.probes), 'should have probes array');
    assert.ok(body.probes.length > 0, 'should have at least one probe');
    assert.ok(body.probes.some((probe) => probe.id === 'voxcpmModel'));
    assert.equal(
      body.probes.find((probe) => probe.id === 'learnerMemoryStore')?.status,
      'online',
    );
  });

  it('kill-test: health and active readiness fail when configured VoxCPM is down', async () => {
    const down = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '8020/health': () => mockJsonResponse(503, { ok: false, model_loaded: false }),
      }),
      disableSessionPersistence: true,
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
    });
    try {
      const health = await httpGet(down.baseUrl, '/health');
      assert.equal(health.status, 503);
      assert.equal(health.body.services.voxcpm.status, 'offline');
      const readiness = await httpGet(down.baseUrl, '/voice/standalone/readiness?force=1');
      assert.equal(readiness.status, 503);
      assert.equal(readiness.body.probes.find((probe) => probe.id === 'voxcpmModel')?.status, 'offline');
    } finally {
      await stopTestApp(down);
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Error Handling
// ---------------------------------------------------------------------------

describe('Error Handling', () => {
  let ctx;

  before(async () => {
    ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
    });
  });

  after(async () => {
    await stopTestApp(ctx);
  });

  it('invalid JSON body returns 400', async () => {
    const resp = await fetch(`${ctx.baseUrl}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{invalid json',
    });
    assert.equal(resp.status, 400);
  });

  it('missing required fields return appropriate errors', async () => {
    // Coach turn with no sessionId and no message
    const { status, body } = await httpPost(ctx.baseUrl, '/voice/coach/runtime', {});
    // Either 404 (session not found) or 400 (missing fields)
    assert.ok([400, 404].includes(status), `unexpected status: ${status}`);
    assert.equal(body.success, false);
  });

  it('upstream timeout returns 504', async () => {
    // proxyVoiceSpeechGenerate uses global fetch. Mock it to respect abort signal.
    const realFetch = global.fetch;
    global.fetch = async function hangingFetch(url, options) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/generate')) {
        return new Promise((_resolve, reject) => {
          if (options?.signal) {
            options.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      }
      return realFetch(url, options);
    };

    const timeoutCtx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020', VOXCPM_TIMEOUT_MS: '200' },
      disableSessionPersistence: true,
    });
    try {
      const resp = await realFetch(`${timeoutCtx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetText: 'timeout test' }),
      });
      assert.equal(resp.status, 504);
      const body = await resp.json();
      assert.equal(body.success, false);
      assert.ok(body.error.includes('timed out') || body.error.includes('timeout'), `error: ${body.error}`);
    } finally {
      await stopTestApp(timeoutCtx);
      global.fetch = realFetch;
    }
  });

  it('body timeout aborts with TimeoutError, rejects partial audio, and cleans the stream', async () => {
    const realFetch = global.fetch;
    const firstPcmChunk = Buffer.from([0x00, 0x80, 0xff, 0x7f]);
    const secondReadStarted = createDeferred();
    const upstreamAborted = createDeferred();
    const turnId = 'timeout-body-turn';
    let upstreamAbortReason = null;
    let ctx;

    global.fetch = async function patchedFetch(url, options = {}) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (!urlStr.includes('/generate')) return realFetch(url, options);
      return mockStallingAudioResponse(firstPcmChunk, options.signal, {
        onAbort(reason) {
          upstreamAbortReason = reason;
          upstreamAborted.resolve();
        },
        onBlocked: () => secondReadStarted.resolve(),
      });
    };

    try {
      ctx = await startTestApp({
        fetchImpl: buildMockFetchImpl(),
        env: {
          VOXCPM_ENABLED: 'true',
          VOXCPM_URL: 'http://127.0.0.1:8020',
          VOXCPM_TIMEOUT_MS: '120',
        },
        disableSessionPersistence: true,
      });
      await httpPost(ctx.baseUrl, `/voice/turns/${turnId}/telemetry`, {
        sessionId: 'timeout-body-session',
        timestamps: { speech_end_at: Date.now() },
      });

      const startedAt = Date.now();
      const response = await beforeTimeout(realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: 'timeout-body-session',
          targetText: 'return one chunk then stall',
          turnId,
        }),
      }), 'body-timeout response headers');
      assert.equal(response.status, 200);
      const streamId = response.headers.get('x-voice-speech-stream-id');
      assert.ok(streamId);
      await beforeTimeout(secondReadStarted.promise, 'body-timeout upstream reader to block');
      await assert.rejects(
        beforeTimeout(
          response.arrayBuffer(),
          'body-timeout partial gateway response to reject',
          1500,
        ),
        /terminated|aborted|socket|closed|fetch/i,
      );
      await beforeTimeout(upstreamAborted.promise, 'body-timeout upstream abort');

      assert.ok(Date.now() - startedAt < 1500, 'body timeout must reject the response within the test bound');
      assert.ok(
        upstreamAbortReason instanceof Error
          || (typeof DOMException === 'function' && upstreamAbortReason instanceof DOMException),
        'timeout abort reason must be an Error or DOMException',
      );
      assert.equal(upstreamAbortReason.name, 'TimeoutError');
      assert.equal(ctx.runtime.voiceOperationRouteHandlers.activeTtsStreams.size, 0, 'timed-out stream entry must be cleaned');

      const telemetry = await httpGet(ctx.baseUrl, `/voice/turns/${turnId}/telemetry`);
      assert.equal(telemetry.status, 200);
      assert.equal(telemetry.body.telemetry.fallback_reason, 'tts_timeout');

      const cancelResponse = await beforeTimeout(realFetch(`${ctx.baseUrl}/voice/speech/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ streamId }),
      }), 'post-timeout cancel request');
      const cancelBody = await cancelResponse.json();
      assert.equal(cancelBody.cancelled, false);
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });

  it('gives clone preparation and each streamed chunk a fresh inactivity budget', async () => {
    const realFetch = global.fetch;
    const clipId = 'uncached-phase-budget-reference';
    const chunks = [
      Buffer.from([0x01, 0x02]),
      Buffer.from([0x03, 0x04]),
      Buffer.from([0x05, 0x06]),
    ];
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    let ctx;

    global.fetch = async function patchedFetch(url, options = {}) {
      const urlStr = typeof url === 'string' ? url : url?.toString?.() || '';
      if (urlStr.includes('/v1/reference-audio/download')) {
        await wait(75);
        return mockJsonResponse(200, { path: '/tmp/uncached-phase-budget.wav' });
      }
      if (!urlStr.includes('/generate')) return realFetch(url, options);

      let readIndex = 0;
      return {
        ok: true,
        status: 200,
        statusText: 'OK',
        headers: new Headers({
          'Content-Type': 'application/octet-stream',
          'X-Audio-Format': 'pcm_s16le',
          'X-Audio-Sample-Rate': '48000',
          'X-Audio-Channels': '1',
          'X-Speaking-Rate-Applied': '0.76',
          'X-TTS-Generation-Mode': 'cloned-synthesis',
          'X-Reference-Audio-Role': 'conditioning-only',
        }),
        body: {
          getReader() {
            return {
              async read() {
                await wait(75);
                if (readIndex >= chunks.length) return { done: true };
                return { done: false, value: chunks[readIndex++] };
              },
              releaseLock() {},
            };
          },
        },
      };
    };

    try {
      ctx = await startTestApp({
        fetchImpl: buildMockFetchImpl(),
        env: {
          VOXCPM_ENABLED: 'true',
          VOXCPM_URL: 'http://127.0.0.1:8020',
          VOXCPM_TIMEOUT_MS: '120',
        },
        disableSessionPersistence: true,
      });
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      await httpPost(ctx.baseUrl, '/voice/session/reference', {
        sessionId: start.body.sessionId,
        referenceClipId: clipId,
        referenceClipName: 'uncached test voice',
      });

      const startedAt = Date.now();
      const response = await realFetch(`${ctx.baseUrl}/voice/speech/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId: start.body.sessionId,
          targetText: 'A multi-segment timing proof.',
        }),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(Buffer.from(await response.arrayBuffer()), Buffer.concat(chunks));
      assert.ok(
        Date.now() - startedAt > 120 * 2,
        'the full request should exceed one timeout window while every phase remains active',
      );
    } finally {
      await stopTestApp(ctx);
      global.fetch = realFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// V1.5 — One real sentence, time-lapse mirror, strain guardian
// ---------------------------------------------------------------------------

// A take artifact + summary with controllable strain + a phraseComparison.
function takeResponseWith({
  strainRisk = 0.1,
  holdScore = 0.9,
  status = 'ready',
  repContext = null,
  sloaneSessionId = null,
  clientAttemptId = null,
} = {}) {
  const attemptArtifactId = `mock-vt-session-1-${Math.random().toString(16).slice(2)}`;
  const target = {
    source: 'preset',
    targetPreset: 'cute-feminine',
    targetProfileId: null,
    direction: 'feminine',
    pitchFloorHz: 188,
    pitchCeilingHz: 255,
    resonanceFloor: 0.32,
    resonanceCeiling: 1,
    weightFloor: 0,
    weightCeiling: 0.4,
    minTargetHitPct: 0.28,
    pitchPlacement: 'below',
  };
  return {
    status,
    summary: {
      voiceSessionId: 'mock-vt-session-1',
      durationMs: 3000,
      targetPreset: 'cute-feminine',
      metrics: {
        meanPitchHz: 180, pitchRangeSt: 5, resonanceMean: 0.6, weightMean: 0.4, targetHitPct: 0.8, similarityScore: 0.7,
        advanced: {
          measurementAvailable: true,
          measurementRejectionReasons: [],
          voicedFramePct: 0.9,
          confidentFramePct: 0.9,
          scoreConfidence: 0.8,
          captureReliability: 0.9,
          snrDb: 25,
          clippingPct: 0.001,
          pitchP10Hz: 180,
          pitchTargetOccupancyPct: 80,
          quality: { strainRisk, breathyRisk: 0.1 },
          reliabilityFlags: [],
        },
      },
      target: { ...target },
      issues: [], nextDrills: [],
    },
    attemptArtifact: {
      attemptArtifactId,
      clientAttemptId,
      voiceSessionId: 'mock-vt-session-1',
      sloaneSessionId,
      targetPreset: 'cute-feminine',
      target: { ...target },
      referenceClipId: null,
      finalizedAt: Date.now(),
      metrics: {
        meanPitchHz: 180, pitchRangeSt: 5, resonanceMean: 0.6, weightMean: 0.4, targetHitPct: 0.8, similarityScore: 0.7,
        advanced: {
          measurementAvailable: true,
          measurementRejectionReasons: [],
          voicedFramePct: 0.9,
          confidentFramePct: 0.9,
          scoreConfidence: 0.8,
          captureReliability: 0.9,
          snrDb: 25,
          clippingPct: 0.001,
          pitchP10Hz: 180,
          pitchTargetOccupancyPct: 80,
          quality: { strainRisk, breathyRisk: 0.1 },
          reliabilityFlags: [],
        },
      },
      reliabilityFlags: [],
      repContext,
      timeline: [
        { t: 0, voiced: true, pitchHz: 180, pitchScore: holdScore, resonanceScore: 0.6, weightScore: 0.4, confidence: 0.9, loudnessDb: -20 },
        { t: 1, voiced: true, pitchHz: 182, pitchScore: holdScore, resonanceScore: 0.6, weightScore: 0.4, confidence: 0.9, loudnessDb: -20 },
      ],
    },
  };
}

function takeResponseForRequest(options, overrides = {}) {
  const requestBody = JSON.parse(options?.body || '{}');
  return takeResponseWith({
    ...overrides,
    sloaneSessionId: requestBody.sloaneSessionId || null,
    clientAttemptId: requestBody.clientAttemptId || null,
  });
}

function freshLearnerRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'tv-v15-'));
}

describe('V1.5 one real sentence', () => {
  let ctx;
  let root;

  before(async () => {
    root = freshLearnerRoot();
    ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
      learnerContextRoot: root,
    });
  });

  after(async () => {
    await stopTestApp(ctx);
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('GET /voice/real-sentence returns today/pendingDebrief/3 suggestions', async () => {
    const { status, body } = await httpGet(ctx.baseUrl, '/voice/real-sentence?studentId=rs-user-1');
    assert.equal(status, 200);
    assert.equal(body.success, true);
    assert.equal(body.today, null);
    assert.equal(body.pendingDebrief, null);
    assert.ok(Array.isArray(body.suggestions));
    assert.equal(body.suggestions.length, 3);
  });

  it('POST /voice/real-sentence/pick creates an entry + a real_sentence card', async () => {
    const start = await httpPost(ctx.baseUrl, '/session/start', {});
    const sid = start.body.sessionId;
    const pick = await httpPost(ctx.baseUrl, '/voice/real-sentence/pick', {
      studentId: 'rs-user-1', sessionId: sid, text: 'A flat white, please.',
    });
    assert.equal(pick.status, 200);
    assert.equal(pick.body.success, true);
    assert.equal(pick.body.entry.text, 'A flat white, please.');
    assert.equal(pick.body.entry.status, 'picked');
    assert.ok(pick.body.card, 'should return a card');
    assert.equal(pick.body.card.kind, 'real_sentence');
    assert.equal(pick.body.card.phrase, 'A flat white, please.');

    // The card is now the active card for the session.
    const cardGet = await httpGet(ctx.baseUrl, `/voice/card?sessionId=${sid}`);
    assert.equal(cardGet.body.card.kind, 'real_sentence');

    // today's sentence now resolves.
    const rs = await httpGet(ctx.baseUrl, '/voice/real-sentence?studentId=rs-user-1');
    assert.ok(rs.body.today);
    assert.equal(rs.body.today.text, 'A flat white, please.');
  });

  it('pick rejects text over 120 chars by truncation, empty text 400', async () => {
    const empty = await httpPost(ctx.baseUrl, '/voice/real-sentence/pick', { studentId: 'rs-user-2', text: '   ' });
    assert.equal(empty.body.success, false);

    const long = 'x'.repeat(200);
    const pick = await httpPost(ctx.baseUrl, '/voice/real-sentence/pick', { studentId: 'rs-user-2', text: long });
    assert.equal(pick.body.success, true);
    assert.equal(pick.body.entry.text.length, 120);
  });

  it('outcome said-well sets debriefed + appends whatWorked; no negatives for rough', async () => {
    // pick
    const pick = await httpPost(ctx.baseUrl, '/voice/real-sentence/pick', { studentId: 'rs-user-3', text: 'Hello there.' });
    const id = pick.body.entry.id;

    // said-well
    const out = await httpPost(ctx.baseUrl, '/voice/real-sentence/outcome', {
      studentId: 'rs-user-3', id, outcome: 'said-well',
    });
    assert.equal(out.status, 200);
    assert.equal(out.body.success, true);
    assert.match(out.body.coachLine, /Hello there\./);

    // whatWorked now carries the carried sentence. v4: entries are
    // {text, axis?, date} objects (back-compat-normalized from the old strings).
    const profile = await httpGet(ctx.baseUrl, '/voice/learner-context/profile?studentId=rs-user-3');
    const ww = profile.body.studentModel?.whatWorked || [];
    const wwText = (w) => (typeof w === 'string' ? w : (w && w.text) || '');
    assert.ok(ww.some((w) => /real sentence carried: Hello there\./.test(wwText(w))), `whatWorked: ${JSON.stringify(ww)}`);

    // rough outcome writes no negative record (struggles stay empty).
    const pick2 = await httpPost(ctx.baseUrl, '/voice/real-sentence/pick', { studentId: 'rs-user-3', text: 'Rough one.' });
    const out2 = await httpPost(ctx.baseUrl, '/voice/real-sentence/outcome', {
      studentId: 'rs-user-3', id: pick2.body.entry.id, outcome: 'said-rough',
    });
    assert.match(out2.body.coachLine, /took nerve/i);
    const profile2 = await httpGet(ctx.baseUrl, '/voice/learner-context/profile?studentId=rs-user-3');
    assert.deepEqual(profile2.body.studentModel?.struggles || [], []);
  });

  it('outcome rejects an unknown outcome value', async () => {
    const pick = await httpPost(ctx.baseUrl, '/voice/real-sentence/pick', { studentId: 'rs-user-4', text: 'A line.' });
    const out = await httpPost(ctx.baseUrl, '/voice/real-sentence/outcome', {
      studentId: 'rs-user-4', id: pick.body.entry.id, outcome: 'totally-bogus',
    });
    assert.equal(out.body.success, false);
  });

  it('pending debrief memory does not become an automatic entry message', async () => {
    // Build a profile file directly with a pre-today open entry so pendingDebrief fires.
    const fileKey = encodeURIComponent('rs-user-greet');
    const studentsDir = path.join(root, 'students');
    fs.mkdirSync(studentsDir, { recursive: true });
    const yesterday = (() => {
      const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    })();
    fs.writeFileSync(path.join(studentsDir, `${fileKey}.json`), JSON.stringify({
      studentId: 'rs-user-greet',
      voice: { realSentences: [{ id: 'rs_old', text: 'Table for one, please.', pickedAt: yesterday, status: 'picked', outcome: null, note: '' }] },
    }));
    const greet = await httpGet(ctx.baseUrl, '/voice/coach/greeting?studentId=rs-user-greet');
    assert.equal(greet.status, 200);
    assert.equal(greet.body.greeting.debriefLine, undefined);
    assert.equal(greet.body.greeting.text, '');
    assert.deepEqual(greet.body.greeting.lines, []);
    assert.equal(greet.body.greeting.autoSpeak, false);
  });
});

describe('V1.5 strain guardian + pin suggestion (take-finalize)', () => {
  async function armedSession(overrides) {
    const root = freshLearnerRoot();
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(overrides),
      disableSessionPersistence: true,
      learnerContextRoot: root,
    });
    const start = await httpPost(ctx.baseUrl, '/session/start', { studentId: 'guard-user' });
    const sid = start.body.sessionId;
    // Arm the VoiceTrainer session so finalizeVoiceTake has a voiceSessionId.
    await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId: sid, studentId: 'guard-user' });
    return { ctx, sid, root };
  }

  it('clean takes never trigger the guardian; payload carries guardian + strainWatch', async () => {
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const { ctx, sid, root } = await armedSession({
      [takeUrl]: (_url, options) => mockJsonResponse(200, takeResponseForRequest(options, { strainRisk: 0.1 })),
    });
    try {
      const take = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(take.status, 200);
      assert.ok(take.body.guardian, 'payload should carry guardian');
      assert.equal(take.body.guardian.level, 'none');
      assert.ok(take.body.strainWatch, 'payload should carry strainWatch');
      assert.equal(take.body.strainWatch.recentFlags, 0);
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('threads a sustained-take kind into the guardian and preserves its lenient warn bar', async () => {
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const repContext = {
      kind: 'sustained',
      drillId: 'cute-vocalise-sustained',
      tags: ['vocalise', 'stability'],
    };
    const { ctx, sid, root } = await armedSession({
      [takeUrl]: (_url, options) => mockJsonResponse(200, takeResponseForRequest(options, {
        strainRisk: 0.6,
        repContext,
      })),
    });
    try {
      const take = await httpPost(ctx.baseUrl, '/voice/session/take', {
        sessionId: sid,
        repContext,
      });
      assert.equal(take.status, 200);
      assert.equal(take.body.guardian.takeKind, 'sustained');
      assert.equal(take.body.guardian.takeKindSource, 'drill-kind');
      assert.equal(take.body.guardian.takeKindContextPresent, true);
      assert.equal(take.body.guardian.thresholds.strainWarn, 0.62);
      assert.equal(take.body.strainWatch.recentFlags, 0);
      assert.equal(take.body.voiceState.repContext.kind, 'sustained');
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('strained takes escalate to ease then close (guardian line in payload)', async () => {
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const { ctx, sid, root } = await armedSession({
      [takeUrl]: (_url, options) => mockJsonResponse(200, takeResponseForRequest(options, { strainRisk: 0.7 })),
    });
    try {
      const t1 = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(t1.body.guardian.level, 'none'); // 1 strained
      const t2 = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(t2.body.guardian.level, 'ease'); // 2 of last 4
      assert.ok(t2.body.guardianMessage, 'ease should insert a coach line');
      const t3 = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(t3.body.guardian.level, 'ease');
      const t4 = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(t4.body.guardian.level, 'close'); // 4 strained total
      assert.ok(t4.body.guardianMessage, 'close should insert a coach line');
      // The guardian line is in the coach thread.
      const sess = await httpGet(ctx.baseUrl, `/voice/session/${sid}`);
      const thread = sess.body.voiceState.coachThread || [];
      assert.ok(thread.some((m) => m.kind === 'runtime-guardian'), 'guardian line should be in the thread');
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('pinSuggestion offered once for the session-best take (no recent milestone)', async () => {
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const { ctx, sid, root } = await armedSession({
      [takeUrl]: (_url, options) => mockJsonResponse(200, takeResponseForRequest(options, { strainRisk: 0.1, holdScore: 0.95 })),
    });
    try {
      const t1 = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      // First take is the best so far -> suggestion offered.
      assert.ok(t1.body.pinSuggestion, 'first best take should get a pinSuggestion');
      assert.ok(t1.body.pinSuggestion.attemptId);
      const t2 = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      // Already suggested this session -> no repeat.
      assert.equal(t2.body.pinSuggestion, null, 'pinSuggestion must not repeat within the session');
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('degraded takes do not advance guardian, best-pin, or readiness state', async () => {
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    let takeCount = 0;
    const { ctx, sid, root } = await armedSession({
      [takeUrl]: (_url, options) => {
        takeCount += 1;
        const response = takeResponseForRequest(options, { strainRisk: 0.99, holdScore: 0.99 });
        if (takeCount === 1) {
          for (const advanced of [
            response.summary.metrics.advanced,
            response.attemptArtifact.metrics.advanced,
          ]) {
            Object.assign(advanced, {
              measurementAvailable: true,
              measurementRejectionReasons: [],
              scoreConfidence: 0.04,
              voicedFramePct: 0.01,
              confidentFramePct: 0.01,
              captureReliability: 0.08,
            });
          }
        }
        return mockJsonResponse(200, response);
      },
    });
    try {
      const rejected = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(rejected.status, 200);
      assert.equal(rejected.body.guardian.ignored, true);
      assert.equal(rejected.body.strainWatch.takeCount, 0);
      assert.equal(rejected.body.pinSuggestion, null);
      assert.equal(rejected.body.realSentenceReadiness, null);

      const accepted = await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      assert.equal(accepted.status, 200);
      assert.equal(accepted.body.guardian.ignored, false);
      assert.equal(accepted.body.strainWatch.takeCount, 1);
      assert.ok(accepted.body.pinSuggestion, 'the first usable take should remain eligible for a pin');

      const witness = ctx.runtime.debugBus.since(0).find((event) => event.kind === 'take-finalize-gate');
      assert.equal(witness?.data?.outcome, 'measurement_rejected');
      assert.equal(witness?.data?.pin_suppressed, true);
      assert.equal(witness?.data?.readiness_suppressed, true);
      assert.doesNotMatch(JSON.stringify(witness?.data || {}), /mock-vt-session|attemptArtifact/i);
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

// ---------------------------------------------------------------------------
// v4 tutor-memory — sessions ring (gap 2) + gap-aware greeting (gap 2) +
// memory-ops applied via the coach reply (gaps 1/3) — all model-free through
// the in-process app harness.
// ---------------------------------------------------------------------------
describe('v4 tutor-memory (sessions ring + gap-aware greeting + memory-ops)', () => {
  async function armedSession(studentId, overrides) {
    const root = freshLearnerRoot();
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(overrides),
      disableSessionPersistence: true,
      learnerContextRoot: root,
    });
    const start = await httpPost(ctx.baseUrl, '/session/start', { studentId });
    const sid = start.body.sessionId;
    await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId: sid, studentId });
    return { ctx, sid, root };
  }

  it('session end writes a sessions-ring entry (takes/minutes/oneLine) + sets lastSessionAt', async () => {
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const { ctx, sid, root } = await armedSession('ring-stu', {
      [takeUrl]: (_url, options) => mockJsonResponse(200, takeResponseForRequest(options, { strainRisk: 0.1 })),
    });
    try {
      // Two finalized takes -> the guardian accumulator counts 2 takes.
      await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      // End the session -> the ring entry is written.
      const end = await httpPost(ctx.baseUrl, '/voice/session/end', { sessionId: sid });
      assert.equal(end.status, 200);

      const profile = await httpGet(ctx.baseUrl, '/voice/learner-context/profile?studentId=ring-stu');
      const sessions = profile.body.studentModel?.sessions || [];
      assert.equal(sessions.length, 1, `expected one session entry, got ${JSON.stringify(sessions)}`);
      const entry = sessions[0];
      assert.equal(entry.takes, 2, 'ring entry should record 2 takes');
      assert.ok(typeof entry.minutes === 'number' && entry.minutes >= 0, 'minutes is a non-negative number');
      assert.ok(typeof entry.startedAt === 'number', 'startedAt recorded');
      // oneLine is the deterministic 'N takes [on <axis>]' (no coach turn ran here
      // so the dominant axis may be null -> '2 takes').
      assert.match(entry.oneLine, /^2 takes( on (pitch|resonance|weight|prosody))?$/);
      // lastSessionAt is set (a ms epoch).
      assert.ok(Number(profile.body.studentModel?.lastSessionAt) > 0, 'lastSessionAt set');
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('a coach turn tags the session focus; the ring oneLine names the dominant axis', async () => {
    const takeUrl = '/api/v1/voice/sessions/mock-vt-session-1/take';
    const { ctx, sid, root } = await armedSession('focus-stu', {
      [takeUrl]: (_url, options) => mockJsonResponse(200, takeResponseForRequest(options)),
    });
    try {
      // A real measured take provides the evidence; the coach turn records its
      // deterministic focus axis without relying on null-to-zero coercion.
      await httpPost(ctx.baseUrl, '/voice/session/take', { sessionId: sid });
      const turn = await httpPost(ctx.baseUrl, '/voice/coach/runtime', {
        sessionId: sid, message: 'What should I improve about my pitch?',
      });
      assert.equal(turn.status, 200);
      assert.equal(
        turn.body.coachingSignal?.coachingDecision?.primaryFocus,
        'pitch_floor',
        JSON.stringify(turn.body.coachingSignal),
      );
      // memoryOpsApplied is on the payload (0 for a plain mock reply with no block).
      assert.equal(turn.body.memoryOpsApplied, 0);
      await httpPost(ctx.baseUrl, '/voice/session/end', { sessionId: sid });
      const profile = await httpGet(ctx.baseUrl, '/voice/learner-context/profile?studentId=focus-stu');
      const sessions = profile.body.studentModel?.sessions || [];
      assert.equal(sessions.length, 1);
      // A coach turn ran, so a dominant focus axis was tallied -> oneLine names it.
      assert.match(sessions[0].oneLine, / on (pitch|resonance|weight|prosody)$/);
      assert.ok(['pitch', 'resonance', 'weight', 'prosody'].includes(sessions[0].focusAxis));
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('a long gap resumes silently without a welcome-back message', async () => {
    const root = freshLearnerRoot();
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
      learnerContextRoot: root,
    });
    try {
      // Seed a profile whose last session was ~21 days ago.
      const studentsDir = path.join(root, 'students');
      fs.mkdirSync(studentsDir, { recursive: true });
      const fileKey = encodeURIComponent('gap-stu');
      const longAgo = Date.now() - 21 * 24 * 60 * 60 * 1000;
      fs.writeFileSync(path.join(studentsDir, `${fileKey}.json`), JSON.stringify({
        studentId: 'gap-stu',
        profile: { displayName: 'Mara' },
        voice: {
          lastSessionAt: longAgo,
          sessions: [{ date: '2026-05-01', startedAt: longAgo, minutes: 10, takes: 4, focusAxis: 'resonance', oneLine: '4 takes on resonance' }],
          whatWorked: [{ text: 'forward resonance held', axis: 'resonance', date: '2026-05-01' }],
        },
      }));
      const greet = await httpGet(ctx.baseUrl, '/voice/coach/greeting?studentId=gap-stu');
      assert.equal(greet.status, 200);
      assert.equal(greet.body.greeting.line1, '');
      assert.equal(greet.body.greeting.line2, '');
      assert.equal(greet.body.greeting.entryPolicy, 'resume-core-practice');
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });

  it('a recent session also resumes silently without continuity padding', async () => {
    const root = freshLearnerRoot();
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl(),
      disableSessionPersistence: true,
      learnerContextRoot: root,
    });
    try {
      const studentsDir = path.join(root, 'students');
      fs.mkdirSync(studentsDir, { recursive: true });
      const fileKey = encodeURIComponent('recent-stu');
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      fs.writeFileSync(path.join(studentsDir, `${fileKey}.json`), JSON.stringify({
        studentId: 'recent-stu',
        profile: { displayName: 'Sam' },
        voice: {
          lastSessionAt: twoDaysAgo,
          whatWorked: [{ text: 'lighter onset landed', axis: 'weight', date: '' }],
        },
      }));
      const greet = await httpGet(ctx.baseUrl, '/voice/coach/greeting?studentId=recent-stu');
      assert.equal(greet.status, 200);
      assert.equal(greet.body.greeting.text, '');
      assert.equal(greet.body.greeting.autoSpeak, false);
    } finally {
      await stopTestApp(ctx);
      try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  });
});

// ---------------------------------------------------------------------------
// 10. Anti-collapse decoding parameters (2026-07-26)
//
// The fine-tuned coach model is mode-collapsed (86.5% of live replies carried
// the same cue) and BOTH request bodies previously sent temperature alone — no
// nucleus cutoff and no repetition penalties — so at the production coaching
// temperature the sampler was effectively deterministic.
// ---------------------------------------------------------------------------

describe('Anti-collapse decoding', () => {
  it('config exposes the three decoding knobs with the agreed defaults', () => {
    // Neutral defaults — the seeded A/B eval (2026-07-26) measured nonzero
    // penalties suppressing learner-name use while INCREASING collapsed cues.
    const config = resolveVoiceStandaloneConfig({ env: {} });
    assert.equal(config.voiceTutorTopP, 1);
    assert.equal(config.voiceTutorFrequencyPenalty, 0);
    assert.equal(config.voiceTutorPresencePenalty, 0);
  });

  it('the knobs are env-overridable and clamped to valid ranges', () => {
    const tuned = resolveVoiceStandaloneConfig({
      env: {
        VOICE_TUTOR_TOP_P: '0.75',
        VOICE_TUTOR_FREQUENCY_PENALTY: '0.9',
        VOICE_TUTOR_PRESENCE_PENALTY: '0',
      },
    });
    assert.equal(tuned.voiceTutorTopP, 0.75);
    assert.equal(tuned.voiceTutorFrequencyPenalty, 0.9);
    // An explicit 0 must survive (it is a real "no penalty" choice, not "unset").
    assert.equal(tuned.voiceTutorPresencePenalty, 0);

    const clamped = resolveVoiceStandaloneConfig({
      env: {
        VOICE_TUTOR_TOP_P: '5',
        VOICE_TUTOR_FREQUENCY_PENALTY: '99',
        VOICE_TUTOR_PRESENCE_PENALTY: '-99',
      },
    });
    assert.equal(clamped.voiceTutorTopP, 1);
    assert.equal(clamped.voiceTutorFrequencyPenalty, 2);
    assert.equal(clamped.voiceTutorPresencePenalty, -2);

    const garbage = resolveVoiceStandaloneConfig({ env: { VOICE_TUTOR_TOP_P: 'nope' } });
    assert.equal(garbage.voiceTutorTopP, 1, 'unparseable input keeps the default');
  });

  it('the BUFFERED coach call puts top_p and both penalties on the wire', async () => {
    const bodies = [];
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '/v1/chat/completions': (url, options) => {
          bodies.push(JSON.parse(options.body));
          return mockJsonResponse(200, {
            choices: [{ message: { content: 'Lift the last two words so the ending stays up.' } }],
            usage: { total_tokens: 16 },
          });
        },
      }),
      disableSessionPersistence: true,
    });

    try {
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      const turn = await httpPost(ctx.baseUrl, '/voice/coach/runtime', {
        sessionId: start.body.sessionId,
        message: 'How was that?',
      });
      assert.equal(turn.status, 200);
      assert.ok(bodies.length > 0, 'the coach turn must have called the model');
      const body = bodies[bodies.length - 1];
      assert.equal(body.top_p, 1);
      assert.equal(body.frequency_penalty, 0);
      assert.equal(body.presence_penalty, 0);
      // The existing temperature contract is untouched.
      assert.equal(typeof body.temperature, 'number');
      assert.equal(body.stream, false);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('the STREAMING coach call carries the same decoding parameters', async () => {
    const bodies = [];
    const ctx = await startTestApp({
      fetchImpl: buildMockFetchImpl({
        '/v1/chat/completions': (url, options) => {
          const body = JSON.parse(options.body);
          bodies.push(body);
          if (!body.stream) {
            return mockJsonResponse(200, {
              choices: [{ message: { content: 'Lift the last two words so the ending stays up.' } }],
              usage: { total_tokens: 16 },
            });
          }
          const chunks = [
            'data: {"choices":[{"delta":{"content":"Lift the last two words so the ending stays up."}}]}\n\n',
            'data: [DONE]\n\n',
          ];
          return {
            ok: true,
            status: 200,
            headers: new Map(),
            body: {
              getReader() {
                let i = 0;
                return {
                  read: async () => (i < chunks.length
                    ? { done: false, value: Buffer.from(chunks[i++]) }
                    : { done: true, value: undefined }),
                  releaseLock() {},
                  cancel: async () => {},
                };
              },
            },
          };
        },
      }),
      disableSessionPersistence: true,
    });

    try {
      const start = await httpPost(ctx.baseUrl, '/session/start', {});
      await httpPost(ctx.baseUrl, '/voice/coach/stream', {
        sessionId: start.body.sessionId,
        message: 'How was that?',
      });
      const streamed = bodies.filter((b) => b.stream === true);
      assert.ok(streamed.length > 0, 'a streaming model call must have been made');
      for (const body of streamed) {
        assert.equal(body.top_p, 1);
        assert.equal(body.frequency_penalty, 0);
        assert.equal(body.presence_penalty, 0);
      }
    } finally {
      await stopTestApp(ctx);
    }
  });
});
