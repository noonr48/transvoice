'use strict';

// ---------------------------------------------------------------------------
// Calibration self-healing — gateway half (2026-07-26)
//
// A VoiceTrainer calibration bump (VOICE_ANALYSIS_VERSION) invalidates every
// reference fingerprint the gateway persisted under the old calibration. The
// trainer re-analyzes the stored reference in place, then rejects the start
// with reason=reference_profile_mismatch because our fingerprint is stale.
// The fingerprint law (_reference_profile_matches, exact equality) is NOT
// relaxed — instead the gateway re-derives the fingerprint for the SAME clip
// and retries the start exactly once.
// ---------------------------------------------------------------------------

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createVoiceStandaloneApp } = require('./voice-standalone-runtime');

const STALE_VERSION = 'voice-metrics-v2';
const CURRENT_VERSION = 'voice-metrics-v3-yin';
const CLIP_ID = 'calibration-clip';

// Verbatim rejection text from the trainer's two rebindable paths. These are
// the ONLY machine signal the gateway gets: the trainer's start route answers
// with HTTPException(400, detail=str(exc)), so the reason token
// (rejected_reference_analysis / reference_profile_mismatch) never reaches the
// wire — only these sentences do.
const TRAINER_PROFILE_MISMATCH_DETAIL =
  'Reference target profile does not match the stored reference analysis.';
const TRAINER_STALE_CALIBRATION_DETAIL =
  'Reference audio uses an older or unknown acoustic calibration; re-analyze the '
  + 'retained audio before deriving a voice target.';

function mockJsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    headers: new Map([['content-type', 'application/json']]),
    async text() { return JSON.stringify(body); },
    async json() { return body; },
  };
}

function referenceAnalysis(version) {
  return {
    clipId: CLIP_ID,
    filename: 'calibration.wav',
    targetPreset: 'cute-feminine',
    durationMs: 6400,
    analysisVersion: version,
    quality: { verdict: 'good', cloneable: true },
    metrics: { advanced: { measurementAvailable: true } },
    timeline: [],
  };
}

// The v2 and v3 profiles differ in their exact bands — that is precisely why
// the persisted v2 fingerprint no longer matches the re-analyzed reference.
function targetProfile(version) {
  const stale = version === STALE_VERSION;
  return {
    profileId: `reference-profile-${CLIP_ID}`,
    clipId: CLIP_ID,
    analysisVersion: version,
    targetPreset: 'cute-feminine',
    sourceFilename: 'calibration.wav',
    durationMs: 6400,
    stylePrompt: 'bright and forward',
    metrics: {
      meanPitchHz: stale ? 203.5 : 207.25,
      pitchRangeSt: 4.6,
      resonanceMean: 0.635,
      weightMean: 0.315,
      targetHitPct: 1,
      similarityScore: 1,
    },
    pitchFloorHz: stale ? 177.5 : 181.25,
    pitchCeilingHz: stale ? 229.5 : 233.25,
    resonanceFloor: 0.535,
    resonanceCeiling: 0.735,
    weightFloor: 0.215,
    weightCeiling: 0.415,
  };
}

// The trainer's real /sessions/start acknowledgement shape
// (services/voice-trainer/src/api/routers/sessions.py start handler).
function startAck(sent) {
  const profile = sent.targetVoiceProfile || {};
  return {
    voiceSessionId: 'vt-calibration-session',
    sloaneSessionId: 'app-session',
    targetPreset: sent.targetPreset,
    referenceClipId: sent.referenceClipId,
    targetSource: sent.targetSource,
    targetProfileId: profile.profileId,
    // The trainer echoes the calibration of the profile it actually bound —
    // after a self-heal that is the freshly re-stamped version.
    analysisVersion: profile.analysisVersion,
    lessonId: null,
    status: 'ready',
    streamUrl: '/api/v1/voice/sessions/vt-calibration-session/stream',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Build a trainer mock that models a calibration bump.
 *
 * `analysisVersionByPhase` flips from stale to current the moment the gateway
 * binds the reference, mimicking the trainer's in-place re-analysis.
 */
function buildTrainerMock(options = {}) {
  const counters = { starts: 0, profileDerivations: 0, referenceReads: 0 };
  const state = { version: STALE_VERSION, profileDerivationStatus: null };

  const fetchImpl = async function fetchImpl(url, requestOptions = {}) {
    const target = String(url);

    if (target.includes('/api/v1/voice/reference/')) {
      counters.referenceReads += 1;
      if (options.referenceReadStatus) {
        return mockJsonResponse(options.referenceReadStatus, { detail: 'reference unavailable' });
      }
      return mockJsonResponse(200, referenceAnalysis(state.version));
    }

    if (target.includes('/api/v1/voice/target/profile')) {
      counters.profileDerivations += 1;
      if (state.profileDerivationStatus) {
        return mockJsonResponse(state.profileDerivationStatus, {
          detail: TRAINER_STALE_CALIBRATION_DETAIL,
        });
      }
      return mockJsonResponse(200, targetProfile(state.version));
    }

    if (target.includes('/api/v1/voice/sessions/start')) {
      counters.starts += 1;
      const sent = JSON.parse(requestOptions.body || '{}');
      const response = options.startResponder(counters.starts, sent, state);
      return response;
    }

    // A saved reference-derived preset — the Coach's normal entry point, and
    // the only path that establishes voiceState.targetBinding.
    if (target.includes('/api/v1/voice/presets/calibration-preset')) {
      return mockJsonResponse(200, {
        id: 'calibration-preset',
        name: 'Calibration preset',
        kind: 'reference',
        basePreset: 'cute-feminine',
        archived: false,
        referenceClipId: CLIP_ID,
        targetVoiceProfile: targetProfile(state.version),
        referenceAnalysis: referenceAnalysis(state.version),
      });
    }

    if (target.includes('/end')) return mockJsonResponse(200, { status: 'ended' });
    if (target.includes('/health')) return mockJsonResponse(200, { status: 'ok' });
    return mockJsonResponse(200, {});
  };

  return { fetchImpl, counters, state };
}

function startTestApp(fetchImpl) {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-calibration-'));
  const standalone = createVoiceStandaloneApp({
    fetchImpl,
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
  });
  return new Promise((resolve) => {
    const server = standalone.app.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        stateRoot,
        runtime: standalone.runtime,
        baseUrl: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

function stopTestApp(ctx) {
  return new Promise((resolve) => {
    ctx.server.close(() => {
      fs.rmSync(ctx.stateRoot, { recursive: true, force: true });
      resolve();
    });
  });
}

async function httpPost(baseUrl, route, data) {
  const response = await fetch(`${baseUrl}${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

async function httpGet(baseUrl, route) {
  const response = await fetch(`${baseUrl}${route}`);
  return { status: response.status, body: await response.json().catch(() => null) };
}

/** Bind a reference target under the OLD calibration, then bump the trainer. */
async function bindStaleReferenceTarget(ctx, state) {
  const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
  const sessionId = appSession.body.sessionId;
  const bound = await httpPost(ctx.baseUrl, '/voice/session/reference', {
    sessionId,
    referenceClipId: CLIP_ID,
    referenceClipName: 'calibration.wav',
  });
  assert.equal(bound.status, 200, 'reference should bind under the old calibration');
  assert.equal(bound.body.voiceState.targetVoiceProfile.analysisVersion, STALE_VERSION);
  // The analyzer is upgraded and self-heals the stored analysis in place.
  state.version = CURRENT_VERSION;
  return sessionId;
}

function rebindingWitnesses(ctx) {
  return ctx.runtime.debugBus.since(0).filter((event) => event.kind === 'target-rebinding');
}

describe('gateway calibration rebind-once', () => {
  it('re-derives the stale fingerprint once and retries the start to success', async () => {
    const mock = buildTrainerMock({
      startResponder: (attempt, sent) => {
        if (attempt === 1) {
          // The persisted v2 fingerprint no longer matches the re-analyzed
          // reference — the trainer's fail-closed fingerprint law rejects it.
          assert.equal(sent.targetVoiceProfile.analysisVersion, STALE_VERSION);
          return mockJsonResponse(400, { detail: TRAINER_PROFILE_MISMATCH_DETAIL });
        }
        assert.equal(sent.targetVoiceProfile.analysisVersion, CURRENT_VERSION);
        return mockJsonResponse(200, startAck(sent));
      },
    });
    const ctx = await startTestApp(mock.fetchImpl);
    try {
      const sessionId = await bindStaleReferenceTarget(ctx, mock.state);
      const derivationsAfterBind = mock.counters.profileDerivations;

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });

      assert.equal(started.status, 200);
      assert.equal(mock.counters.starts, 2, 'exactly one retry');
      assert.equal(
        mock.counters.profileDerivations - derivationsAfterBind,
        1,
        'exactly one profile re-derivation',
      );

      // The refreshed fingerprint is durably bound, paired with the refreshed
      // evidence it was derived from.
      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.targetVoiceProfile.analysisVersion, CURRENT_VERSION);
      assert.equal(current.body.voiceState.referenceAnalysis.analysisVersion, CURRENT_VERSION);
      assert.equal(current.body.voiceState.referenceClipId, CLIP_ID);
      assert.equal(current.body.voiceState.targetVoiceProfile.clipId, CLIP_ID);
      assert.equal(current.body.voiceState.targetPreset, 'cute-feminine');
      // This compatibility session never had an exact binding, and a rebind
      // must not manufacture one.
      assert.ok(!current.body.voiceState.targetBinding);

      const witnesses = rebindingWitnesses(ctx);
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].data.outcome, 'refreshed');
      assert.equal(witnesses[0].data.clip_id, CLIP_ID);
      assert.equal(witnesses[0].data.reason, 'reference_profile_mismatch');
      assert.equal(witnesses[0].data.analysis_version, CURRENT_VERSION);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('refreshes the durable targetBinding so tutor speech does not 409 after a rebind', async () => {
    // voiceState.targetBinding.targetKey hashes the six exact bands AND
    // analysisVersion (voice-target-identity.js:132-145). If a rebind refreshes
    // the profile but leaves the binding behind, requireExactSessionTargetBinding
    // (voice-standalone-runtime.js:1986-2018) recomputes a different targetKey
    // and 409s every tutor-speech turn — trading the start loop for a
    // can't-speak loop.
    const mock = buildTrainerMock({
      startResponder: (attempt, sent) => (
        attempt === 1
          ? mockJsonResponse(400, { detail: TRAINER_PROFILE_MISMATCH_DETAIL })
          : mockJsonResponse(200, startAck(sent))
      ),
    });
    const ctx = await startTestApp(mock.fetchImpl);
    try {
      const appSession = await httpPost(ctx.baseUrl, '/session/start', {});
      const sessionId = appSession.body.sessionId;

      const selected = await httpPost(ctx.baseUrl, '/voice/presets/select', {
        sessionId,
        presetId: 'calibration-preset',
      });
      assert.equal(selected.status, 200);
      const staleBinding = selected.body.voiceState.targetBinding;
      assert.equal(staleBinding.analysisVersion, STALE_VERSION);

      mock.state.version = CURRENT_VERSION;
      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });
      assert.equal(started.status, 200);

      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      const binding = current.body.voiceState.targetBinding;
      const profile = current.body.voiceState.targetVoiceProfile;

      // The binding must travel WITH the refreshed fingerprint, not lag behind it.
      assert.equal(profile.analysisVersion, CURRENT_VERSION);
      assert.equal(binding.analysisVersion, CURRENT_VERSION);
      assert.equal(binding.pitchFloorHz, profile.pitchFloorHz);
      assert.equal(binding.pitchCeilingHz, profile.pitchCeilingHz);
      assert.notEqual(binding.targetKey, staleBinding.targetKey);
      // Identity is preserved across the refresh — same clip, same preset.
      assert.equal(binding.referenceClipId, CLIP_ID);
      assert.equal(binding.presetId, 'calibration-preset');
      assert.equal(binding.targetPreset, 'cute-feminine');
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('rebinds when a bands-identical bump is ACCEPTED under a newer calibration', async () => {
    // The second shape of the trap: a version bump that leaves the six exact
    // bands unchanged. The trainer accepts the start (the fingerprint still
    // matches) and acknowledges the NEW version, while the gateway still
    // expects the old one from its persisted analysis — a 502
    // analysis_version_mismatch that never self-corrects.
    let bandsIdenticalProfile = null;
    const mock = buildTrainerMock({
      startResponder: (attempt, sent) => mockJsonResponse(200, startAck({
        ...sent,
        // The trainer always answers with the calibration IT holds.
        targetVoiceProfile: { ...sent.targetVoiceProfile, analysisVersion: CURRENT_VERSION },
      })),
    });
    // Bands do not move across this bump — only the version string does.
    const originalFetch = mock.fetchImpl;
    const fetchImpl = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/api/v1/voice/target/profile') && mock.state.version === CURRENT_VERSION) {
        bandsIdenticalProfile = { ...targetProfile(STALE_VERSION), analysisVersion: CURRENT_VERSION };
        mock.counters.profileDerivations += 1;
        return mockJsonResponse(200, bandsIdenticalProfile);
      }
      return originalFetch(url, options);
    };

    const ctx = await startTestApp(fetchImpl);
    try {
      const sessionId = await bindStaleReferenceTarget(ctx, mock.state);
      const derivationsAfterBind = mock.counters.profileDerivations;

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });

      assert.equal(started.status, 200, 'the accepted-but-stale start must self-correct');
      assert.equal(mock.counters.starts, 2, 'exactly one retry');
      assert.equal(mock.counters.profileDerivations - derivationsAfterBind, 1);

      const witnesses = rebindingWitnesses(ctx);
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].data.outcome, 'refreshed');
      assert.equal(witnesses[0].data.reason, 'analysis_version_mismatch');

      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.referenceAnalysis.analysisVersion, CURRENT_VERSION);
      assert.equal(current.body.voiceState.targetVoiceProfile.analysisVersion, CURRENT_VERSION);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('does not retry when the analyzer session could not be retired', async () => {
    // Retrying after a FAILED rollback would strand a live analyzer session on
    // the trainer with nothing recording it. An unacknowledged rollback stays a
    // terminal 502 — the same invariant that held before the retry path
    // existed.
    let endAttempts = 0;
    const mock = buildTrainerMock({
      startResponder: (attempt, sent) => mockJsonResponse(200, startAck({
        ...sent,
        targetVoiceProfile: { ...sent.targetVoiceProfile, analysisVersion: CURRENT_VERSION },
      })),
    });
    const originalFetch = mock.fetchImpl;
    const fetchImpl = async (url, options = {}) => {
      const target = String(url);
      if (target.includes('/end')) {
        endAttempts += 1;
        return mockJsonResponse(500, { detail: 'retirement unavailable' });
      }
      return originalFetch(url, options);
    };

    const ctx = await startTestApp(fetchImpl);
    try {
      const sessionId = await bindStaleReferenceTarget(ctx, mock.state);
      const derivationsAfterBind = mock.counters.profileDerivations;

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });

      assert.equal(started.status, 502, 'an unretired analyzer session must fail closed');
      assert.deepEqual(started.body.analyzerAckFailures, ['analysis_version_mismatch']);
      assert.equal(mock.counters.starts, 1, 'no retry, so no second analyzer session');
      assert.equal(endAttempts, 1);
      assert.equal(mock.counters.profileDerivations - derivationsAfterBind, 0, 'no rebind');
      assert.equal(rebindingWitnesses(ctx).length, 0);

      // The failure is still recorded.
      const ackWitness = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'analyzer_ack_mismatch'
      ));
      assert.equal(ackWitness?.data?.rollback_acknowledged, false);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('keeps every non-calibration acknowledgement failure fail-closed', async () => {
    // A genuinely wrong acknowledgement must still 502 with no rebind — the
    // new branch must not become a general-purpose retry.
    const mock = buildTrainerMock({
      startResponder: (attempt, sent) => mockJsonResponse(200, startAck({
        ...sent,
        targetPreset: 'masculine',
      })),
    });
    const ctx = await startTestApp(mock.fetchImpl);
    try {
      const sessionId = await bindStaleReferenceTarget(ctx, mock.state);
      const derivationsAfterBind = mock.counters.profileDerivations;

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });

      assert.equal(started.status, 502);
      assert.deepEqual(started.body.analyzerAckFailures, ['target_preset_mismatch']);
      assert.equal(mock.counters.starts, 1, 'no retry');
      assert.equal(mock.counters.profileDerivations - derivationsAfterBind, 0);
      assert.equal(rebindingWitnesses(ctx).length, 0);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('surfaces the error and rebinds only once when the retry also fails', async () => {
    const mock = buildTrainerMock({
      startResponder: () => mockJsonResponse(400, { detail: TRAINER_PROFILE_MISMATCH_DETAIL }),
    });
    const ctx = await startTestApp(mock.fetchImpl);
    try {
      const sessionId = await bindStaleReferenceTarget(ctx, mock.state);
      const derivationsAfterBind = mock.counters.profileDerivations;

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });

      assert.equal(started.status, 400);
      assert.match(started.body.error, /does not match the stored reference analysis/);
      assert.equal(mock.counters.starts, 2, 'no retry loop — one retry, then surface');
      assert.equal(
        mock.counters.profileDerivations - derivationsAfterBind,
        1,
        'exactly one rebind attempt',
      );

      const witnesses = rebindingWitnesses(ctx);
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].data.outcome, 'refreshed');

      const rejected = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'analyzer_start_rejected'
      ));
      assert.equal(rejected?.data?.rebind_attempted, true);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('never rebinds on a 400 that is not a calibration rejection', async () => {
    const mock = buildTrainerMock({
      startResponder: () => mockJsonResponse(400, { detail: 'Unknown target source.' }),
    });
    const ctx = await startTestApp(mock.fetchImpl);
    try {
      const sessionId = await bindStaleReferenceTarget(ctx, mock.state);
      const derivationsAfterBind = mock.counters.profileDerivations;

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });

      assert.equal(started.status, 400);
      assert.match(started.body.error, /Unknown target source/);
      assert.equal(mock.counters.starts, 1, 'no retry for a non-calibration 400');
      assert.equal(
        mock.counters.profileDerivations - derivationsAfterBind,
        0,
        'no profile re-derivation',
      );
      assert.equal(rebindingWitnesses(ctx).length, 0);

      // The stale binding is left exactly as it was — no silent substitution.
      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.targetVoiceProfile.analysisVersion, STALE_VERSION);

      const rejected = ctx.runtime.debugBus.since(0).find((event) => (
        event.kind === 'target-transition' && event.data?.outcome === 'analyzer_start_rejected'
      ));
      assert.equal(rejected?.data?.rebind_attempted, false);
    } finally {
      await stopTestApp(ctx);
    }
  });

  it('fails silent rather than substituting when re-derivation cannot be trusted', async () => {
    const mock = buildTrainerMock({
      startResponder: () => mockJsonResponse(400, { detail: TRAINER_STALE_CALIBRATION_DETAIL }),
    });
    const ctx = await startTestApp(mock.fetchImpl);
    try {
      const sessionId = await bindStaleReferenceTarget(ctx, mock.state);
      // The retained raw audio is gone on the trainer side, so the trainer
      // cannot self-heal and re-derivation 400s too.
      mock.state.profileDerivationStatus = 400;

      const started = await httpPost(ctx.baseUrl, '/voice/session/start', { sessionId });

      assert.equal(started.status, 400);
      assert.equal(mock.counters.starts, 1, 'a failed rebind must not retry the start');

      const witnesses = rebindingWitnesses(ctx);
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].data.outcome, 'refresh_failed');
      assert.equal(witnesses[0].data.clip_id, CLIP_ID);
      assert.equal(witnesses[0].data.reason, 'rejected_reference_analysis');

      // Fail silent: the previous binding is untouched, never substituted.
      const current = await httpGet(ctx.baseUrl, `/voice/session/${encodeURIComponent(sessionId)}`);
      assert.equal(current.body.voiceState.targetVoiceProfile.analysisVersion, STALE_VERSION);
      assert.equal(current.body.voiceState.referenceClipId, CLIP_ID);
    } finally {
      await stopTestApp(ctx);
    }
  });
});
