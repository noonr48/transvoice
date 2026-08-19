'use strict';

// ---------------------------------------------------------------------------
// Coach analyzer-take leg (2026-07-26)
//
// The coach surface had two capture seams that never joined: the live input
// socket produced a trimmed 16 kHz segment for the ASR, and the analyzer
// session sat open with nothing ever reaching it. Every coach turn therefore
// carried null metrics, a hum could not be scored at all, and the take-evidence
// freshness gate — correctly — treated everything as absent.
//
// These tests hold the join: every finalized coach segment ALSO becomes a real
// analyzer take, concurrently with the ASR, fail-open in every failure mode,
// landing through the SAME take-finalize path the learner's own practice take
// uses (so the freshness gate cannot tell the two apart).
// ---------------------------------------------------------------------------

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');
const { createVoiceInputLiveConnection, encodePcm16Wav } = require('./voice-input-live');
const {
  assessTakeEvidence,
  resolveTakeEvidenceFreshness,
} = require('./coaching/signal-builder');
const { buildRendererUserMessage } = require('./coaching/renderer-client');

const VOICE_SESSION_ID = 'mock-vt-session-1';
const TAKE_ONESHOT_PATH = `/api/v1/voice/sessions/${VOICE_SESSION_ID}/take-oneshot`;

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

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });
}

/** 16 kHz mono PCM16 that reads as voiced on the live path's RMS scan. */
function pcm(ms, amplitude = 9000, sampleRate = 16000) {
  const samples = Math.round((sampleRate * ms) / 1000);
  const buffer = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    buffer.writeInt16LE(index % 2 ? amplitude : -amplitude, index * 2);
  }
  return buffer;
}

// The exact target block a built-in 'cute-feminine' session expects back, so
// the take passes the same provenance check the solo take path runs.
const BUILT_IN_TARGET = Object.freeze({
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
});

function takeMetrics() {
  return {
    meanPitchHz: 196,
    pitchRangeSt: 5,
    resonanceMean: 0.62,
    weightMean: 0.38,
    targetHitPct: 0.81,
    similarityScore: 0.74,
    advanced: {
      measurementAvailable: true,
      measurementRejectionReasons: [],
      voicedFramePct: 0.92,
      confidentFramePct: 0.9,
      scoreConfidence: 0.82,
      captureReliability: 0.9,
      snrDb: 25,
      clippingPct: 0.001,
      pitchP10Hz: 190,
      pitchTargetOccupancyPct: 80,
      quality: { strainRisk: 0.1, breathyRisk: 0.1 },
      reliabilityFlags: [],
    },
  };
}

/** The trainer's take-finalize payload — identical shape from /take and /take-oneshot. */
function oneshotTakeResponse(requestBody = {}) {
  const attemptArtifactId = `${VOICE_SESSION_ID}-${Math.random().toString(16).slice(2)}`;
  const repContext = requestBody.takeKind ? { kind: requestBody.takeKind } : null;
  return {
    voiceSessionId: VOICE_SESSION_ID,
    status: 'ready',
    streamUrl: `/api/v1/voice/sessions/${VOICE_SESSION_ID}/stream`,
    summary: {
      voiceSessionId: VOICE_SESSION_ID,
      durationMs: 2400,
      targetPreset: 'cute-feminine',
      metrics: takeMetrics(),
      target: { ...BUILT_IN_TARGET },
      issues: [],
      nextDrills: [],
    },
    attemptArtifact: {
      attemptArtifactId,
      clientAttemptId: null,
      voiceSessionId: VOICE_SESSION_ID,
      sloaneSessionId: requestBody.sloaneSessionId || null,
      targetPreset: 'cute-feminine',
      target: { ...BUILT_IN_TARGET },
      referenceClipId: null,
      finalizedAt: Date.now(),
      metrics: takeMetrics(),
      reliabilityFlags: [],
      repContext,
      timeline: [
        { t: 0, voiced: true, pitchHz: 196, pitchScore: 0.9, resonanceScore: 0.62, weightScore: 0.38, confidence: 0.9, loudnessDb: -20 },
        { t: 64, voiced: true, pitchHz: 198, pitchScore: 0.9, resonanceScore: 0.62, weightScore: 0.38, confidence: 0.9, loudnessDb: -20 },
      ],
    },
  };
}

/**
 * A runtime wired to a mock trainer + mock ASR, with both call sites
 * instrumented so a test can prove ordering and concurrency rather than assume
 * it.
 */
function buildHarness({
  takeHandler,
  asrHandler = null,
  asrResult = {
    success: true,
    transcript: 'The gateway heard this promptly',
    confidence: 0.93,
    providerStyle: 'simple',
    transcriptSource: 'backend-asr',
  },
  asrDelayMs = 40,
  coachTakeTimeoutMs = 2500,
  // 2026-07-27: lets a test make the ANALYZER SESSION BIND fail, which is the
  // only remaining way a coach turn legitimately runs with no take.
  sessionStartHandler = null,
  coachAnalyzerBindWaitMs = 2000,
} = {}) {
  const logLines = [];
  const takeRequests = [];
  const analyzerStartCalls = [];
  const spans = { asr: null, take: null };
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-coach-take-'));

  const defaultTakeHandler = async (requestBody) => mockJsonResponse(200, oneshotTakeResponse(requestBody));
  const handler = takeHandler || defaultTakeHandler;

  const fetchImpl = async function fetchImpl(url, options = {}) {
    const target = String(url);
    if (target.includes(TAKE_ONESHOT_PATH)) {
      const requestBody = JSON.parse(options.body || '{}');
      takeRequests.push(requestBody);
      const span = { startedAt: Date.now(), endedAt: null };
      spans.take = span;
      try {
        return await handler(requestBody, options);
      } finally {
        span.endedAt = Date.now();
      }
    }
    if (target.includes('/api/v1/voice/sessions/start')) {
      analyzerStartCalls.push(Date.now());
      if (sessionStartHandler) return sessionStartHandler(options);
      return mockJsonResponse(200, {
        voiceSessionId: VOICE_SESSION_ID,
        status: 'ready',
        targetPreset: 'cute-feminine',
        targetSource: 'built-in',
        referenceClipId: null,
        targetProfileId: null,
        streamUrl: `/api/v1/voice/sessions/${VOICE_SESSION_ID}/stream`,
        createdAt: Date.now(),
      });
    }
    if (target.includes('/end')) return mockJsonResponse(200, { status: 'ended' });
    if (target.includes('/health')) return mockJsonResponse(200, { status: 'ok' });
    return mockJsonResponse(200, {});
  };

  const runtime = createVoiceStandaloneRuntime({
    fetchImpl,
    stateRoot,
    disableSessionPersistence: true,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    voiceCoachTakeTimeoutMs: coachTakeTimeoutMs,
    voiceCoachAnalyzerBindWaitMs: coachAnalyzerBindWaitMs,
    logger: { log: (line) => logLines.push(line), warn() {}, error() {} },
    voiceInputAsrBridge: {
      getStatus: async () => ({ enabled: true, available: true, liveMode: 'buffered' }),
      transcribeAudio: async () => {
        const span = { startedAt: Date.now(), endedAt: null };
        spans.asr = span;
        await sleep(asrDelayMs);
        try {
          return asrHandler ? await asrHandler() : asrResult;
        } finally {
          span.endedAt = Date.now();
        }
      },
    },
  });

  return {
    runtime,
    logLines,
    takeRequests,
    analyzerStartCalls,
    spans,
    stateRoot,
    coachTakeLines: () => logLines.filter((line) => line?.event === 'coach_take'),
    cleanup: () => { try { fs.rmSync(stateRoot, { recursive: true, force: true }); } catch { /* ignore */ } },
  };
}

async function armedSession(harness, { lessonId = null } = {}) {
  const handlers = harness.runtime.voiceOperationRouteHandlers;
  const app = harness.runtime.appCompatibilityRouteHandlers;
  const started = await app.startSession({ sessionId: 'coach-take-session', studentId: 'take-leg-user' });
  const sessionId = started.sessionId || 'coach-take-session';
  await handlers.startVoiceSession({ sessionId, targetPreset: 'cute-feminine' });
  if (lessonId) {
    const session = harness.runtime.sessions.get(sessionId);
    session.voiceState = { ...session.voiceState, lessonId };
  }
  return sessionId;
}

function submitLiveTurn(harness, sessionId, pcmBuffer) {
  return harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
    sessionId,
    requestedProvider: 'backend',
    captureProvider: 'backend',
    audioFormat: 'wav',
    mimeType: 'audio/wav',
    filename: 'voice-input.wav',
    transcriptSource: 'backend-live',
    capturedAt: Date.now(),
  }, {
    audioBuffer: encodePcm16Wav(pcmBuffer, 16000),
    pcmBuffer,
    shouldCommit: () => true,
  });
}

describe('coach analyzer-take leg', () => {
  it('binds one transcript and its exact acoustic take into a single-use listening turn', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      const captured = await submitLiveTurn(harness, sessionId, pcm(900));
      const listeningTurnId = captured.inputTurn.listeningTurnId;

      assert.match(listeningTurnId, /^listening-turn-/);

      // Make the session's mutable "latest take" unusable after capture. The
      // tutor must still receive the usable artifact that belonged to THIS
      // transcript, not whichever take happened to land most recently.
      const session = harness.runtime.sessions.get(sessionId);
      session.voiceState.lastSummary.metrics.advanced.measurementAvailable = false;
      session.voiceState.lastSummary.metrics.advanced.measurementRejectionReasons = ['superseded_fixture'];
      session.voiceState.lastAttemptArtifact.metrics.advanced.measurementAvailable = false;
      session.voiceState.lastAttemptArtifact.metrics.advanced.measurementRejectionReasons = ['superseded_fixture'];

      await harness.runtime.appCompatibilityRouteHandlers.startSession({
        sessionId: 'other-listening-session',
        studentId: 'other-listener',
      });
      await assert.rejects(
        () => harness.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
          sessionId: 'other-listening-session',
          listeningTurnId,
        }),
        (error) => error?.statusCode === 409 && /different session/i.test(error.message),
        'an opaque turn cannot cross session ownership',
      );

      const reply = await harness.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
        sessionId,
        listeningTurnId,
      });

      assert.equal(
        reply.coachingSignal.userUtterance,
        'The gateway heard this promptly',
        'the server-owned packet supplies the trusted transcript',
      );
      assert.equal(
        reply.coachingSignal.takeQuality.usable,
        true,
        'the exact captured take survives later session-state mutation',
      );
      assert.deepEqual(
        {
          semantic: reply.coachingSignal.capture.semanticStatus,
          acoustic: reply.coachingSignal.capture.acousticStatus,
          resolution: reply.coachingSignal.capture.resolution,
        },
        {
          semantic: 'final',
          acoustic: 'usable',
          resolution: 'semantic_measured',
        },
        'the tutor signal receives both evidence lanes from that one capture',
      );
      const tutorPrompt = buildRendererUserMessage(reply.coachingSignal);
      assert.match(tutorPrompt, /Student said: "The gateway heard this promptly"/);
      assert.match(
        tutorPrompt,
        /Listening evidence: words=final \| voice=usable \| joined=semantic_measured/,
        'both lanes reach the tutor renderer together',
      );

      const replay = await harness.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
          sessionId,
          listeningTurnId,
      });
      assert.equal(
        replay.turnId,
        reply.turnId,
        'a network retry replays the first result without generating a second tutor turn',
      );
      assert.deepEqual(replay.coachThread, reply.coachThread);
    } finally {
      harness.cleanup();
    }
  });

  it('does not issue a tutor-bound listening turn when the captured sentence has no transcript', async () => {
    const harness = buildHarness({
      asrHandler: async () => {
        throw new Error('ASR provider offline');
      },
    });
    try {
      const sessionId = await armedSession(harness);
      const captured = await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(captured.inputTurn.evidence.semantic, 'failed');
      assert.equal(captured.inputTurn.evidence.acoustic, 'usable');
      assert.equal(captured.inputTurn.listeningTurnId, undefined);
      assert.ok(
        captured.inputTurn.coachLine,
        'the same listening experience gives an immediate spoken recovery instead of freezing',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('keeps a healthy sentence transcript that arrives after the old 120 ms merge cutoff', async () => {
    const harness = buildHarness({
      asrDelayMs: 540,
      takeHandler: async (requestBody) => {
        await sleep(35);
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    });
    try {
      const sessionId = await armedSession(harness);
      const captured = await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(captured.inputTurn.transcript, 'The gateway heard this promptly');
      assert.equal(captured.inputTurn.evidence.semantic, 'final');
      assert.equal(captured.inputTurn.evidence.acoustic, 'usable');
      assert.match(captured.inputTurn.listeningTurnId, /^listening-turn-/);
    } finally {
      harness.cleanup();
    }
  });

  it('runs the take CONCURRENTLY with the ASR and lands fresh evidence the coach signal can use', async () => {
    const harness = buildHarness({
      asrDelayMs: 60,
      takeHandler: async (requestBody) => {
        await sleep(40);
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    });
    try {
      const sessionId = await armedSession(harness);
      const segment = pcm(900);
      const payload = await submitLiveTurn(harness, sessionId, segment);

      // The turn itself completed normally.
      assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly');
      assert.equal(payload.inputTurn.evidence.semantic, 'final');
      assert.equal(payload.inputTurn.evidence.acoustic, 'usable');
      assert.equal(payload.inputTurn.evidence.resolution, 'semantic_measured');

      // The SAME trimmed segment reached the analyzer, as PCM16 base64.
      assert.equal(harness.takeRequests.length, 1);
      assert.equal(harness.takeRequests[0].pcm16Base64, segment.toString('base64'));
      assert.equal(harness.takeRequests[0].takeKind, 'phrase');
      assert.equal(harness.takeRequests[0].sloaneSessionId, sessionId);

      // CONCURRENCY, proven rather than asserted: the two spans overlap.
      const { asr, take } = harness.spans;
      assert.ok(asr && take, 'both legs should have run');
      assert.ok(
        take.startedAt < asr.endedAt && asr.startedAt < take.endedAt,
        `ASR ${asr.startedAt}-${asr.endedAt} and take ${take.startedAt}-${take.endedAt} should overlap`,
      );

      // The take landed through the real take-finalize path, so the freshness
      // gate sees a FRESH take with real metrics — not the absent case.
      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.ok(voiceState.lastAttemptArtifact, 'the take should be on the session');
      assert.ok(Number.isFinite(voiceState.lastTakeFinalizedAt), 'lastTakeFinalizedAt must be stamped');
      const freshness = resolveTakeEvidenceFreshness(voiceState);
      assert.equal(freshness.fresh, true);
      assert.equal(freshness.reason, 'in_turn_window');

      // Non-null metrics — the thing coach_gates used to log as null.
      const evidence = assessTakeEvidence(voiceState);
      assert.equal(evidence.hasMetrics, true);
      assert.equal(voiceState.lastSummary.metrics.advanced.measurementAvailable, true);
      assert.equal(voiceState.lastAttemptArtifact.metrics.meanPitchHz, 196);

      // One compact witness line for the take.
      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].outcome, 'analyzed');
      assert.equal(witnesses[0].take_kind, 'phrase');
      assert.equal(witnesses[0].has_metrics, true);
      assert.ok(Number.isFinite(witnesses[0].ms));
    } finally {
      harness.cleanup();
    }
  });

  it('take timeout: the turn proceeds, the witness says so, and no evidence is landed', async () => {
    const harness = buildHarness({
      coachTakeTimeoutMs: 30,
      asrDelayMs: 10,
      takeHandler: async (requestBody) => {
        await sleep(400);
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    });
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(600));

      // The spoken turn is untouched by the analyzer being slow.
      assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly');

      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].outcome, 'timeout');
      assert.equal(witnesses[0].has_metrics, false);
      // NOT `>= 30`: `ms` is a Date.now() delta measured against setTimeout(30),
      // and setTimeout fires a hair EARLY on this platform — measured 4 of 400
      // samples at 29 ms. That assertion failed roughly 1 run in 100.
      assert.ok(witnesses[0].ms >= 25, `the witness should report the wait it paid, got ${witnesses[0].ms}`);
      assert.ok(witnesses[0].ms < 400, 'and must not have waited for the slow trainer');

      // Evidence absent — never substituted with anything.
      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.equal(voiceState.lastAttemptArtifact, null);
      assert.equal(voiceState.lastSummary, null);
      assert.equal(voiceState.lastTakeFinalizedAt, null);
    } finally {
      harness.cleanup();
    }
  });

  it('wordless hum + analyzed take: the acknowledgment says heard AND read', async () => {
    const harness = buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    });
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      assert.equal(payload.inputTurn.outcome, 'no-speech');
      assert.equal(payload.inputTurn.wordlessPractice, true);
      assert.equal(payload.inputTurn.takeKind, 'hum_sovt');
      assert.equal(payload.inputTurn.takeAnalyzed, true);
      // A metrics-aware, code-owned line — and never a number in the speech.
      assert.match(payload.inputTurn.coachLine, /read|measured|work from/i);
      assert.doesNotMatch(payload.inputTurn.coachLine, /\d/);
      assert.notEqual(
        payload.inputTurn.coachLine,
        'I could not get a usable voice reading. Try the hum again, easy and unforced.',
      );

      // The hum is a scored take: kind carried, metrics landed.
      assert.equal(harness.takeRequests[0].takeKind, 'hum_sovt');
      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.equal(voiceState.lastAttemptArtifact.repContext.kind, 'hum_sovt');
      assert.equal(assessTakeEvidence(voiceState).hasMetrics, true);
      assert.equal(harness.coachTakeLines()[0].take_kind, 'hum_sovt');
    } finally {
      harness.cleanup();
    }
  });

  it('whitespace-only ASR transcript routes to no-speech, never a 400 after a landed take', async () => {
    // Reviewer advisory 2026-07-26: a success result whose transcript
    // normalizes to nothing previously threw 400 AFTER the take had landed,
    // stranding fresh evidence on a turn that never advanced the input window.
    const harness = buildHarness({
      asrResult: { success: true, transcript: '     ', providerStyle: 'simple', transcriptSource: 'backend-asr' },
    });
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      assert.equal(payload.inputTurn.outcome, 'no-speech');
      // The take still landed — real audio, real evidence.
      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.notEqual(voiceState.lastTakeFinalizedAt, null);
    } finally {
      harness.cleanup();
    }
  });

  it('wordless hum + timed-out take: the retry names the requested action without claiming it was heard', async () => {
    const harness = buildHarness({
      coachTakeTimeoutMs: 25,
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        await sleep(400);
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    });
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      assert.equal(payload.inputTurn.wordlessPractice, true);
      assert.equal(payload.inputTurn.takeAnalyzed, false);
      assert.equal(
        payload.inputTurn.coachLine,
        'I could not get a usable voice reading. Try the hum again, easy and unforced.',
      );
      assert.equal(harness.coachTakeLines()[0].outcome, 'timeout');
    } finally {
      harness.cleanup();
    }
  });

  it('an UNMEASURABLE take never earns the "heard and measured" line', async () => {
    // The real analyzer returns all six core metric fields FINITE even when it
    // reports measurementAvailable=false / no_voiced_frames — they are
    // fallbacks, not readings (measured 2026-07-26: meanPitchHz 201.5,
    // resonanceMean 0.5, similarityScore 0.436 on pure silence). A too-quiet
    // hum produces ASR no-speech AND exactly this take, so testing finiteness
    // would let silence claim a reading. has_metrics defers to the same
    // usability predicate the take-finalize side channels use.
    const harness = buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        const body = oneshotTakeResponse(requestBody);
        for (const block of [body.summary.metrics, body.attemptArtifact.metrics]) {
          // Verbatim analyzer output for a take with no voiced frames.
          block.meanPitchHz = 201.5;
          block.pitchRangeSt = 0;
          block.resonanceMean = 0.5;
          block.weightMean = 0.5;
          block.targetHitPct = 0;
          block.similarityScore = 0.436;
          block.advanced.measurementAvailable = false;
          block.advanced.measurementRejectionReasons = ['no_voiced_frames'];
          block.advanced.voicedFramePct = 0;
          // 2026-07-27 — this fixture used to stop here, leaving reliabilityFlags
          // as the base fixture's empty array, a value the REAL analyzer never
          // emits (audio_analysis.py:3150-3157 always populates it). That made
          // this a FALSE GREEN: the scenario the comment above describes is a
          // TOO-QUIET HUM, which in the field carries the flags below, and a
          // guard reading them silenced exactly this take while the test stayed
          // green. MEASURED on a clean 200 Hz hum at -38.64 dBFS — 0.8 dB under
          // the voicing bar — the flag list is byte-identical to digital
          // silence; LOUDNESS is the only field that separates the two.
          block.advanced.reliabilityFlags = [
            'no_voiced_frames',
            'low_voiced_coverage',
            'low_confidence',
            'low_score_confidence',
            'quiet_input',
          ];
          block.advanced.peakLoudnessDb = -38.64;
          block.advanced.meanLoudnessDb = -38.64;
        }
        return mockJsonResponse(200, body);
      },
    });
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses[0].outcome, 'analyzed');
      assert.equal(witnesses[0].has_metrics, false);
      assert.match(witnesses[0].reason, /^measurement_unusable:/);
      assert.equal(payload.inputTurn.takeAnalyzed, false);
      assert.equal(
        payload.inputTurn.coachLine,
        'I could not get a usable voice reading. Try the hum again, easy and unforced.',
      );
      // The take itself is still a real, auditable take — it just cannot claim
      // a reading. (The side channels suppress its achievement paths already.)
      assert.ok(harness.runtime.sessions.get(sessionId).voiceState.lastAttemptArtifact);
    } finally {
      harness.cleanup();
    }
  });

  it('an empty metrics block also fails the usability bar', async () => {
    const harness = buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        const body = oneshotTakeResponse(requestBody);
        body.summary.metrics = {};
        body.attemptArtifact.metrics = {};
        return mockJsonResponse(200, body);
      },
    });
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));
      assert.equal(harness.coachTakeLines()[0].has_metrics, false);
      assert.match(harness.coachTakeLines()[0].reason, /^measurement_absent:/);
      assert.equal(payload.inputTurn.takeAnalyzed, false);
    } finally {
      harness.cleanup();
    }
  });

  it('a superseded turn lands NOTHING: no take, no stamp, no learner-context write', async () => {
    // Before this leg existed a discarded turn committed nothing at all. It
    // must still commit nothing — a take landed here would carry a
    // lastTakeFinalizedAt that the NEXT turn's freshness window (anchored on an
    // older turn, because a discarded turn never reaches lastProcessedAt) would
    // wrongly accept as in_turn_window.
    const harness = buildHarness({ asrDelayMs: 40 });
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(
        session,
        { coachingDecision: { recommendedDrill: { id: 'starter-easy-hum' } } },
      );
      const pendingBefore = { ...session.voiceState.pendingTakeKind };
      const segment = pcm(600);
      let current = true;
      setTimeout(() => { current = false; }, 10).unref?.();

      await assert.rejects(
        () => harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
          sessionId,
          requestedProvider: 'backend',
          captureProvider: 'backend',
          audioFormat: 'wav',
          mimeType: 'audio/wav',
          filename: 'voice-input.wav',
          capturedAt: Date.now(),
        }, {
          audioBuffer: encodePcm16Wav(segment, 16000),
          pcmBuffer: segment,
          shouldCommit: () => current,
        }),
        /no longer current/,
      );

      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.equal(voiceState.lastTakeFinalizedAt, null, 'a discarded turn must not stamp a take');
      assert.equal(voiceState.lastAttemptArtifact, null);
      assert.equal(voiceState.lastSummary, null);
      assert.deepEqual(
        voiceState.pendingTakeKind,
        pendingBefore,
        'a discarded turn must not consume the engine prescription either',
      );
      // The take DID reach the analyzer; it is simply not landed here.
      assert.equal(harness.takeRequests.length, 1);
      const skipped = harness.coachTakeLines().find((line) => line.outcome === 'skipped');
      assert.ok(skipped, 'the discarded take should still be witnessed');
      assert.equal(skipped.reason, 'turn_superseded');
      assert.equal(skipped.has_metrics, false);
    } finally {
      harness.cleanup();
    }
  });

  it('the take-finalize side channels are reported, not just applied', async () => {
    // applyTakeFinalizeSideChannels mutates the session (it can append a
    // guardian line to the coach thread), so the reply must carry what it did.
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(900));
      assert.ok(payload.guardian, 'the input-turn reply should carry the guardian decision');
      assert.equal(payload.guardian.takeKind, 'phrase');
      assert.ok(payload.strainWatch, 'and the strain watch');
    } finally {
      harness.cleanup();
    }
  });

  it('trainer 404 on an unknown analyzer session: fail-open, witnessed, no evidence', async () => {
    const harness = buildHarness({
      takeHandler: async () => mockJsonResponse(404, { detail: 'Voice session not found' }),
    });
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(600));

      assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly');
      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].outcome, 'error');
      assert.equal(witnesses[0].reason, 'http_404');
      assert.equal(witnesses[0].has_metrics, false);

      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.equal(voiceState.lastAttemptArtifact, null);
      assert.equal(voiceState.lastTakeFinalizedAt, null);
    } finally {
      harness.cleanup();
    }
  });

  it('the practice transport owning the analyzer stream (409) never becomes a double-counted take', async () => {
    // The solo practice transport streams straight into the trainer's WebSocket
    // from the browser; while it holds that single stream slot the trainer
    // answers 409 to a one-shot. That is the race-free double-submission guard,
    // decided at the one place that can see both callers.
    const harness = buildHarness({
      takeHandler: async () => mockJsonResponse(409, {
        detail: 'Voice session "mock-vt-session-1" already has an active stream.',
      }),
    });
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(600));

      assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly');
      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].outcome, 'error');
      assert.equal(witnesses[0].reason, 'http_409');

      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.equal(voiceState.lastAttemptArtifact, null);
      assert.equal(voiceState.lastTakeFinalizedAt, null);
    } finally {
      harness.cleanup();
    }
  });

  it('two overlapping coach segments submit ONE take, not two', async () => {
    const harness = buildHarness({
      asrDelayMs: 80,
      takeHandler: async (requestBody) => {
        await sleep(60);
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    });
    try {
      const sessionId = await armedSession(harness);
      const [first, second] = await Promise.all([
        submitLiveTurn(harness, sessionId, pcm(600)),
        submitLiveTurn(harness, sessionId, pcm(600, 7000)),
      ]);

      // Both turns complete; only one of them contributed a take.
      assert.equal(first.inputTurn.transcript, 'The gateway heard this promptly');
      assert.equal(second.inputTurn.transcript, 'The gateway heard this promptly');
      assert.equal(harness.takeRequests.length, 1, 'the analyzer must see exactly one take');

      const outcomes = harness.coachTakeLines().map((line) => line.outcome).sort();
      assert.deepEqual(outcomes, ['analyzed', 'skipped']);
      const skipped = harness.coachTakeLines().find((line) => line.outcome === 'skipped');
      assert.equal(skipped.reason, 'take_already_in_flight');
    } finally {
      harness.cleanup();
    }
  });

  it('a request that never settles does not block the session\'s later takes', async () => {
    // The in-flight claim is released when we STOP WAITING, not when the
    // request finally settles — otherwise one wedged socket would silently cost
    // this session every take for the rest of its life.
    let call = 0;
    const harness = buildHarness({
      coachTakeTimeoutMs: 30,
      asrDelayMs: 5,
      takeHandler: async (requestBody) => {
        call += 1;
        if (call === 1) await new Promise(() => {}); // never settles
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    });
    try {
      const sessionId = await armedSession(harness);
      await submitLiveTurn(harness, sessionId, pcm(600));
      assert.equal(harness.coachTakeLines()[0].outcome, 'timeout');

      await submitLiveTurn(harness, sessionId, pcm(600));
      assert.equal(harness.takeRequests.length, 2, 'the second turn must still submit a take');
      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 2);
      assert.equal(witnesses[1].outcome, 'analyzed');
      assert.ok(harness.runtime.sessions.get(sessionId).voiceState.lastAttemptArtifact);
    } finally {
      harness.cleanup();
    }
  });

  // ── 2026-07-27 FIELD ROOT CAUSE — this pair replaces one earlier test that
  //    asserted "a turn with no analyzer session bound submits nothing and
  //    WITNESSES NOTHING". That assertion was wrong twice over, and it is why
  //    two consecutive repairs of "the tutor ignores my hums" did not hold:
  //
  //    1. It froze the DEFECT as the contract. The live coach client starts
  //       through POST /session/start, which binds no analyzer session — so
  //       "no analyzer session bound" was not an edge case, it was EVERY coach
  //       turn. The take leg was dead in the field from the day it shipped
  //       (measured on the live gateway: coach_take x0 across a whole uptime,
  //       including turns that produced coach replies).
  //    2. It required the failure to be SILENT, so nothing in any log could
  //       distinguish "the analyzer found no voice" from "the analyzer was
  //       never asked". Both repairs were therefore attempted blind.
  it('a turn with no analyzer session BINDS one and still submits its take', async () => {
    const harness = buildHarness();
    try {
      const app = harness.runtime.appCompatibilityRouteHandlers;
      const started = await app.startSession({ sessionId: 'no-analyzer', studentId: 'take-leg-user' });
      const sessionId = started.sessionId || 'no-analyzer';
      assert.equal(
        harness.runtime.sessions.get(sessionId).voiceState.voiceSessionId,
        null,
        'precondition: the coach client start route binds no analyzer session',
      );

      const payload = await submitLiveTurn(harness, sessionId, pcm(600));

      assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly');
      assert.equal(harness.takeRequests.length, 1, 'the take must actually go out');
      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 1);
      assert.equal(witnesses[0].outcome, 'analyzed');
      assert.equal(
        harness.runtime.sessions.get(sessionId).voiceState.voiceSessionId,
        VOICE_SESSION_ID,
        'the bind must persist so later turns reuse one analyzer session',
      );
      assert.equal(
        harness.logLines.filter((line) => line?.event === 'coach_analyzer_session_bind').length,
        1,
        'the bind is witnessed exactly once',
      );
      // THE OWNER'S POINT, asserted. This is a SPOKEN turn — the ASR returned a
      // clean transcript. Before this repair that transcript was ALL the coach
      // got: proof the learner can speak English, and nothing whatsoever about
      // whether they spoke in the target voice quality. The take evidence
      // landing here is the quality channel finally being open on an ordinary
      // spoken turn, not just on a hum.
      const landed = harness.runtime.sessions.get(sessionId).voiceState.lastAttemptArtifact;
      assert.ok(landed, 'a spoken turn must land DSP evidence, not just words');
      assert.equal(landed.voiceSessionId, VOICE_SESSION_ID);
      assert.equal(
        resolveTakeEvidenceFreshness(harness.runtime.sessions.get(sessionId).voiceState).fresh,
        true,
        'and it must be FRESH, so the next coach turn can actually use it',
      );
      // The spoken turn names its trigger too, so a field payload answers
      // "were those words actually voiced?" without cross-referencing a log.
      assert.equal(payload.inputTurn.turnTrigger, 'transcript');
      assert.equal(payload.inputTurn.voicedEvidence, true);
    } finally {
      harness.cleanup();
    }
  });

  it('a superseded turn cannot commit a late analyzer-session bind', async () => {
    const harness = buildHarness({
      asrDelayMs: 5,
      sessionStartHandler: async () => {
        await sleep(40);
        return mockJsonResponse(200, {
          voiceSessionId: 'late-analyzer-session',
          status: 'ready',
          targetPreset: 'cute-feminine',
          targetSource: 'built-in',
          referenceClipId: null,
          targetProfileId: null,
          streamUrl: '/late-stream',
          createdAt: Date.now(),
        });
      },
    });
    try {
      const started = await harness.runtime.appCompatibilityRouteHandlers.startSession({
        sessionId: 'late-bind-superseded',
        studentId: 'take-leg-user',
      });
      const sessionId = started.sessionId || 'late-bind-superseded';
      const session = harness.runtime.sessions.get(sessionId);
      const before = { ...session.voiceState };
      let current = true;
      setTimeout(() => { current = false; }, 10);

      await assert.rejects(
        () => harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
          sessionId,
          requestedProvider: 'backend',
          captureProvider: 'backend',
          audioFormat: 'wav',
          mimeType: 'audio/wav',
          filename: 'voice-input.wav',
        }, {
          audioBuffer: encodePcm16Wav(pcm(600), 16000),
          pcmBuffer: pcm(600),
          shouldCommit: () => current,
        }),
        /no longer current/,
      );

      assert.equal(session.voiceState.voiceSessionId, before.voiceSessionId);
      assert.equal(session.voiceState.serviceStatus, before.serviceStatus);
      assert.equal(session.voiceState.streamUrl, before.streamUrl);
    } finally {
      harness.cleanup();
    }
  });

  it('when the analyzer session cannot be bound the turn still succeeds and SAYS the take was skipped', async () => {
    // Fail-open is the contract: a coach turn must never die because an
    // additive evidence channel is unavailable. But it must not die QUIETLY
    // either — the skip witness is the whole point.
    const harness = buildHarness({
      sessionStartHandler: async () => mockJsonResponse(503, { error: 'analyzer offline' }),
    });
    try {
      const app = harness.runtime.appCompatibilityRouteHandlers;
      const started = await app.startSession({ sessionId: 'bind-fails', studentId: 'take-leg-user' });
      const sessionId = started.sessionId || 'bind-fails';

      const payload = await submitLiveTurn(harness, sessionId, pcm(600));

      assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly', 'the turn is unharmed');
      assert.equal(harness.takeRequests.length, 0, 'no take can be submitted without an analyzer session');
      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 1, 'the skip is witnessed — never silent');
      assert.equal(witnesses[0].outcome, 'skipped');
      assert.equal(witnesses[0].reason, 'no_analyzer_session');
      const binds = harness.logLines.filter((line) => line?.event === 'coach_analyzer_session_bind');
      assert.equal(binds.length, 1, 'a FAILED bind witnesses its failure once — never also a timeout');
      assert.equal(binds[0].outcome, 'analyzer_bind_failed');
    } finally {
      harness.cleanup();
    }
  });

  it('a HUNG analyzer costs ONE degraded turn, not every turn (reviewer finding, measured)', async () => {
    // The bind is fail-open, which means it may not slow a turn either. A first
    // version awaited it in FRONT of the ASR and short-circuited only on a
    // bound session — so a wedged analyzer left voiceSessionId null forever and
    // every turn re-paid the full deadline. MEASURED at a 300ms budget before
    // the fix: per-turn 306/302/301/302. The single-turn test that used to live
    // here could not see it, which is why it is now multi-turn.
    const waitMs = 120;
    const harness = buildHarness({
      coachAnalyzerBindWaitMs: waitMs,
      asrDelayMs: 5,
      sessionStartHandler: () => new Promise(() => {}), // never settles
    });
    try {
      const app = harness.runtime.appCompatibilityRouteHandlers;
      const started = await app.startSession({ sessionId: 'bind-hangs', studentId: 'take-leg-user' });
      const sessionId = started.sessionId || 'bind-hangs';

      const elapsed = [];
      for (let turn = 0; turn < 4; turn += 1) {
        const startedAt = Date.now();
        const payload = await submitLiveTurn(harness, sessionId, pcm(600));
        elapsed.push(Date.now() - startedAt);
        assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly', 'every turn still answers');
      }

      // Turn 1 may pay the deadline once. Every LATER turn must not.
      for (let turn = 1; turn < elapsed.length; turn += 1) {
        assert.ok(
          elapsed[turn] < waitMs,
          `turn ${turn + 1} must not re-pay the bind deadline (took ${elapsed[turn]}ms, budget ${waitMs}ms) — all: ${JSON.stringify(elapsed)}`,
        );
      }
      assert.equal(harness.analyzerStartCalls.length, 1, 'the analyzer is asked exactly once, not once per turn');
      assert.equal(harness.takeRequests.length, 0, 'no analyzer session means no take, as before');
      const witnesses = harness.coachTakeLines();
      assert.equal(witnesses.length, 4, 'every skipped turn still says so');
      assert.ok(witnesses.every((w) => w.outcome === 'skipped' && w.reason === 'no_analyzer_session'));
      const binds = harness.logLines.filter((line) => line?.event === 'coach_analyzer_session_bind');
      assert.equal(binds.length, 1, 'one wait_timeout, then the cooldown keeps it quiet');
      assert.equal(binds[0].outcome, 'wait_timeout', 'a timeout is named as a timeout, not as a failure');
    } finally {
      harness.cleanup();
    }
  });

  it('a FAILING analyzer is not re-attempted on every turn', async () => {
    // Measured before the cooldown: 4 turns produced 4 doomed /sessions/start
    // round-trips. In the field each one can burn the full 8s fetch budget.
    const harness = buildHarness({
      sessionStartHandler: async () => mockJsonResponse(503, { error: 'analyzer offline' }),
    });
    try {
      const app = harness.runtime.appCompatibilityRouteHandlers;
      const started = await app.startSession({ sessionId: 'bind-fails-often', studentId: 'take-leg-user' });
      const sessionId = started.sessionId || 'bind-fails-often';

      for (let turn = 0; turn < 4; turn += 1) {
        const payload = await submitLiveTurn(harness, sessionId, pcm(600));
        assert.equal(payload.inputTurn.transcript, 'The gateway heard this promptly');
      }

      assert.equal(harness.analyzerStartCalls.length, 1, 'one doomed attempt per session, not one per turn');
      assert.equal(harness.takeRequests.length, 0);
    } finally {
      harness.cleanup();
    }
  });

  it('a turn that carries NO pcm never creates an analyzer session it cannot use', async () => {
    // POST /voice/input/turn (voice-runtime-entrypoints.js) invokes the handler
    // with NO `internal`, so pcmBuffer is undefined and the take can only ever
    // skip. Binding there would strand a real trainer-side analyzer session
    // that nothing can use, and make that route wear this leg's latency for
    // nothing.
    const harness = buildHarness();
    try {
      const app = harness.runtime.appCompatibilityRouteHandlers;
      const started = await app.startSession({ sessionId: 'no-pcm', studentId: 'take-leg-user' });
      const sessionId = started.sessionId || 'no-pcm';

      // EXACTLY the route's call shape: one argument, no `internal`.
      await harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
        sessionId,
        transcript: 'a typed question',
        requestedProvider: 'browser',
        captureProvider: 'browser',
      });

      assert.equal(harness.analyzerStartCalls.length, 0, 'no take is possible, so no analyzer session is created');
      assert.equal(harness.takeRequests.length, 0);
    } finally {
      harness.cleanup();
    }
  });

  it('END TO END: a real live socket segment crosses into the analyzer and lands fresh evidence', async () => {
    // The whole seam in one token: PCM arrives on the live coach socket, the
    // socket's own endpoint policy finalizes the segment, and the SAME trimmed
    // audio comes out the other side as a scored take on the session. Wired
    // exactly as createVoiceStandaloneRuntime wires the live service.
    const harness = buildHarness({ asrDelayMs: 20 });
    try {
      const sessionId = await armedSession(harness);
      const connection = createVoiceInputLiveConnection({
        socket: { readyState: 1, send() {}, on() {}, once() {} },
        getSession: (id) => harness.runtime.sessions.get(id) || null,
        getSessionGeneration: () => 0,
        canOpenSession: () => true,
        isSessionActive: () => true,
        submitTurn: (body, internal) => (
          harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn(body, internal)
        ),
        detector: {
          predict: async () => ({ available: false, reason: 'disabled' }),
          getStatus: () => ({ enabled: false, state: 'disabled' }),
        },
      });
      connection.handleMessage(
        JSON.stringify({ type: 'open', sessionId, sampleRate: 16000 }),
        false,
      );
      connection.handleMessage(pcm(700), true);
      // Silence past the conservative fallback boundary closes the segment.
      connection.handleMessage(pcm(5000, 0), true);
      // Let the finalize -> ASR + take round trip settle.
      for (let tick = 0; tick < 40 && harness.takeRequests.length === 0; tick += 1) {
        await sleep(10);
      }
      await sleep(60);

      assert.equal(harness.takeRequests.length, 1, 'the analyzer should have received the take');
      const submitted = Buffer.from(harness.takeRequests[0].pcm16Base64, 'base64');
      assert.ok(submitted.length > 0);
      assert.equal(submitted.length % 2, 0);
      // Trimmed, not the raw listening window: the 5 s of trailing silence is gone.
      assert.ok(
        submitted.length < (700 + 5000) * 32,
        'the analyzer should get the TRIMMED take, not the whole listening window',
      );

      const voiceState = harness.runtime.sessions.get(sessionId).voiceState;
      assert.ok(voiceState.lastAttemptArtifact, 'the take should have landed on the session');
      assert.equal(resolveTakeEvidenceFreshness(voiceState).fresh, true);
      assert.equal(assessTakeEvidence(voiceState).hasMetrics, true);
      assert.equal(harness.coachTakeLines()[0].outcome, 'analyzed');
      connection.close('test-done');
    } finally {
      harness.cleanup();
    }
  });

  it('the live socket hands the runtime the trimmed PCM and its WAV view of one take', async () => {
    // The seam itself: whatever the ASR is given, the analyzer is given the
    // same take as raw PCM16 — not a second capture and not a re-decoded WAV.
    const handoffs = [];
    const connection = createVoiceInputLiveConnection({
      socket: { readyState: 1, send() {}, on() {}, once() {} },
      getSession: () => ({ id: 's', coachLiveInputGeneration: 0 }),
      isSessionActive: () => true,
      canOpenSession: () => true,
      submitTurn: async (_body, internal) => {
        handoffs.push(internal);
        return { inputTurn: { transcript: 'ok', outcome: 'final' } };
      },
      detector: {
        predict: async () => ({ available: false, reason: 'disabled' }),
        getStatus: () => ({ enabled: false, state: 'disabled' }),
      },
    });
    connection.handleMessage(JSON.stringify({ type: 'open', sessionId: 's', sampleRate: 16000 }), false);
    connection.handleMessage(pcm(400), true);
    // Silence past the conservative fallback boundary closes the segment.
    connection.handleMessage(pcm(5000, 0), true);
    await new Promise((resolve) => { setTimeout(resolve, 30).unref?.(); });

    assert.equal(handoffs.length, 1, 'the segment should have finalized once');
    const internal = handoffs[0];
    assert.ok(Buffer.isBuffer(internal.pcmBuffer), 'the runtime must receive raw PCM16');
    assert.equal(internal.pcmBuffer.length % 2, 0);
    assert.ok(internal.pcmBuffer.length > 0);
    // One take, two views: the WAV the ASR gets wraps exactly this PCM.
    assert.ok(encodePcm16Wav(internal.pcmBuffer, 16000).equals(internal.audioBuffer));
    connection.close('test-done');
  });
});

// ---------------------------------------------------------------------------
// FIELD REPAIR (2026-07-26) — "hums go silent"
//
// Witnessed live: the tutor VERBALLY prescribed an "mhmm" mid-conversation, but
// coach_gates showed take_kind 'phrase' / take_kind_source 'default' for the
// whole session — the machine's practice state never followed the tutor's spoken
// prescription. The learner hummed three times: three 'asr-no-speech' stages,
// ZERO 'wordless_practice_ack' witnesses, because the acknowledgment was gated on
// the ACTIVE DRILL KIND, which the stale state said was a phrase. Each hum fell
// into the plain silent capture-ready re-arm and the learner experienced "the
// tutor stops responding".
//
// Two independent repairs, held here:
//   F1 the acknowledgment is EVIDENCE-gated, not state-gated — a no-speech turn
//      whose analyzer take carries real voiced frames is acknowledged whatever
//      the drill state says, and a genuinely silent one still is not.
//   F2 the ENGINE's own structured recommendation stamps a one-shot
//      pendingTakeKind, so the state follows the prescription for the next take.
// ---------------------------------------------------------------------------

const { VOICED_PRACTICE_LINES } = require('./voice-standalone-runtime');
const { sanitizeCoachReply } = require('./coaching/sanitizer');
const { resolveEngineRecommendedTakeKind } = require('./coaching/signal-builder');

/** Capture runtime witnesses (pushRuntimeWitness) alongside the log lines. */
function withWitnessBus(harness) {
  const witnesses = [];
  harness.runtime.debugBus = {
    push: (level, category, message, metadata) => {
      witnesses.push({ level, category, message, metadata });
    },
  };
  harness.witnesses = witnesses;
  harness.ackWitness = () => witnesses.find(
    ({ metadata }) => metadata?.outcome === 'wordless_practice_ack',
  );
  harness.semanticRetryWitness = () => witnesses.find(
    ({ metadata }) => metadata?.outcome === 'semantic_retry',
  );
  return harness;
}

describe('field repair: a voiced capture is answered according to the requested unit', () => {
  it('phrase/default state + no words accepts positive voice evidence without inventing a transcript', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      // NO lessonId — exactly the field session's state. The take kind resolves
      // to 'phrase' from source 'default', while the analyzer proves voice landed.
      const sessionId = await armedSession(harness);
      const before = harness.runtime.sessions.get(sessionId).voiceState;
      assert.equal(before.lessonId, null, 'the fixture must reproduce the stale state');

      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      // The take stays filed under the state's own kind — nothing lies — but a
      // usable voice-quality reading is not discarded because ASR missed words.
      assert.equal(harness.takeRequests[0].takeKind, 'phrase');
      assert.equal(harness.coachTakeLines()[0].take_kind, 'phrase');
      assert.equal(payload.inputTurn.outcome, 'no-speech');
      assert.equal(payload.inputTurn.wordlessPractice, true);
      assert.equal(payload.inputTurn.semanticRetry, undefined);
      assert.equal(payload.inputTurn.takeKind, 'phrase');
      assert.match(payload.inputTurn.coachLine, /usable voice reading|clearly enough to use|voice reading is ready/i);
      assert.doesNotMatch(payload.inputTurn.coachLine, /again/i);

      const witness = harness.ackWitness();
      assert.ok(witness, `measured acknowledgement witness missing: ${JSON.stringify(harness.witnesses)}`);
      assert.equal(witness.metadata.outcome, 'wordless_practice_ack');
      assert.equal(witness.metadata.ack_basis, 'voiced_evidence');
      assert.equal(witness.metadata.take_kind, 'phrase');
    } finally {
      harness.cleanup();
    }
  });

  it('the accepted measured line is concrete, non-technical, and never asks for another take', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));
      const line = payload.inputTurn.coachLine;

      assert.match(line, /usable voice reading|clearly enough to use|voice reading is ready/i);
      assert.doesNotMatch(line, /again|\bASR\b|\bprovider\b|\bmode\b/i);
      // The runtime returns these directly, bypassing sanitizeCoachReply — so
      // prove the law gate would not have rewritten them anyway.
      assert.equal(sanitizeCoachReply(line, { policy: {} }), line);
    } finally {
      harness.cleanup();
    }
  });

  it('a genuinely silent sentence take gets a retry without claiming voice was heard', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        const body = oneshotTakeResponse(requestBody);
        for (const block of [body.summary.metrics, body.attemptArtifact.metrics]) {
          // Verbatim analyzer output for digital silence (measured 2026-07-26,
          // completed 2026-07-27). The flags and the LOUDNESS FLOOR are what
          // make this silence rather than a quiet hum: a real hum 0.8 dB under
          // the voicing bar emits the identical flag list at -38.64 dB, so
          // omitting loudness here left the two scenarios indistinguishable.
          block.advanced.measurementAvailable = false;
          block.advanced.measurementRejectionReasons = ['no_voiced_frames'];
          block.advanced.voicedFramePct = 0;
          block.advanced.reliabilityFlags = [
            'no_voiced_frames',
            'low_voiced_coverage',
            'low_confidence',
            'low_score_confidence',
            'quiet_input',
          ];
          block.advanced.peakLoudnessDb = -100;
          block.advanced.meanLoudnessDb = -100;
        }
        return mockJsonResponse(200, body);
      },
    }));
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      assert.equal(payload.inputTurn.outcome, 'no-speech');
      assert.equal(payload.inputTurn.wordlessPractice, undefined);
      assert.equal(payload.inputTurn.semanticRetry, true);
      assert.match(payload.inputTurn.coachLine, /didn't catch.*sentence again/i);
      assert.doesNotMatch(payload.inputTurn.coachLine, /heard your voice/i);
      assert.equal(harness.ackWitness(), undefined);
      // The take was analyzed — it simply carried no voice.
      assert.equal(harness.coachTakeLines()[0].outcome, 'analyzed');
    } finally {
      harness.cleanup();
    }
  });

  it('a take that reports NO voicing fields at all is not evidence either', async () => {
    // Absence of a rejection is not proof of phonation. With no voicedFramePct
    // and no pitchValidFrameCount there is nothing to override the drill state
    // with, so the state keeps the last word exactly as it does today.
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        const body = oneshotTakeResponse(requestBody);
        for (const block of [body.summary.metrics, body.attemptArtifact.metrics]) {
          delete block.advanced.voicedFramePct;
          delete block.advanced.pitchValidFrameCount;
        }
        return mockJsonResponse(200, body);
      },
    }));
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));
      assert.equal(payload.inputTurn.wordlessPractice, undefined);
      assert.equal(harness.ackWitness(), undefined);
    } finally {
      harness.cleanup();
    }
  });

  it('a vocalise drill still acknowledges on drill_kind, with its own kind-named line', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      await harness.runtime.voiceOperationRouteHandlers.selectVoiceDrill({
        sessionId,
        lessonId: 'cute-vocalise-hum',
      });
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(
        session,
        { coachingDecision: { recommendedDrill: { id: 'starter-easy-hum' } } },
      );
      assert.equal(
        session.voiceState.practiceProgression,
        null,
        'an engine recommendation cannot reinterpret a learner-selected sound drill',
      );
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      assert.equal(payload.inputTurn.takeKind, 'hum_sovt');
      assert.equal(harness.ackWitness().metadata.ack_basis, 'drill_kind');
      // The richer analyzed line, unchanged by the new basis.
      assert.match(payload.inputTurn.coachLine, /read|measured|work from/i);
      assert.ok(!VOICED_PRACTICE_LINES.includes(payload.inputTurn.coachLine));
      assert.equal(payload.inputTurn.practiceProgression, undefined);
      assert.equal(
        session.voiceState.practiceProgression,
        null,
        'a learner-selected sound drill is not reinterpreted as a sentence scaffold',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('an explicit drill selection retires an engine-owned sentence scaffold', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      session.voiceState = harness.runtime.voiceStateRuntime.updateSessionVoiceState(session, {
        activeLine: {
          id: 'sentence-before-selection',
          displayText: 'It should be an easy morning today.',
          targetPreset: 'cute-feminine',
        },
      });
      harness.runtime.stampEngineRecommendedTakeKind(
        session,
        { coachingDecision: { recommendedDrill: { id: 'starter-easy-hum' } } },
      );
      assert.ok(session.voiceState.practiceProgression);

      await harness.runtime.voiceOperationRouteHandlers.selectVoiceDrill({
        sessionId,
        lessonId: 'cute-vocalise-hum',
      });

      assert.equal(session.voiceState.practiceProgression, null);
      assert.deepEqual(
        harness.runtime.resolveCoachTakeKind(session),
        { kind: 'hum_sovt', source: 'drill-kind' },
      );
    } finally {
      harness.cleanup();
    }
  });

  it('regenerating a line retires both the old sentence scaffold and its prescription', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      session.voiceState = harness.runtime.voiceStateRuntime.updateSessionVoiceState(session, {
        activeLine: {
          id: 'sentence-before-next',
          displayText: 'It should be an easy morning today.',
          targetPreset: 'cute-feminine',
        },
      });
      harness.runtime.stampEngineRecommendedTakeKind(
        session,
        { coachingDecision: { recommendedDrill: { id: 'starter-easy-hum' } } },
      );
      assert.ok(session.voiceState.practiceProgression);
      assert.ok(session.voiceState.pendingTakeKind);

      await harness.runtime.voiceOperationRouteHandlers.updateVoiceCockpitLine({
        sessionId,
        action: 'regenerate',
      });

      assert.equal(session.voiceState.practiceProgression, null);
      assert.equal(session.voiceState.pendingTakeKind, null);
      assert.notEqual(session.voiceState.activeLine?.id, 'sentence-before-next');
    } finally {
      harness.cleanup();
    }
  });
});

describe('field repair: the state follows the ENGINE\'s prescription (pendingTakeKind)', () => {
  const vocaliseSignal = (id) => ({ coachingDecision: { recommendedDrill: { id } } });

  it('reads the engine\'s STRUCTURED recommendation, never the model\'s prose', () => {
    // The id is code-selected (recommendDrillForFocus / a registry pick).
    assert.deepEqual(
      resolveEngineRecommendedTakeKind(vocaliseSignal('starter-easy-hum')),
      { kind: 'hum_sovt', drillId: 'starter-easy-hum' },
    );
    assert.equal(resolveEngineRecommendedTakeKind(vocaliseSignal('masc-vocalise-siren')).kind, 'siren');
    assert.equal(
      resolveEngineRecommendedTakeKind({ coachingDecision: { recommendedDrill: { id: 'x', kind: 'straw_free_sovt' } } }).kind,
      'hum_sovt',
    );
    // A NON-vocalise recommendation prescribes nothing — the drill state keeps
    // the last word.
    assert.equal(resolveEngineRecommendedTakeKind(vocaliseSignal('starter-slowdown')), null);
    assert.equal(resolveEngineRecommendedTakeKind(vocaliseSignal('')), null);
    assert.equal(resolveEngineRecommendedTakeKind(null), null);
    // ENGINE-DECIDES LAW: prose that TALKS about humming is not a prescription.
    // Only the structured recommendation surface can move machine state.
    assert.equal(resolveEngineRecommendedTakeKind({
      coachingDecision: { recommendedDrill: { id: 'starter-slowdown', instruction: 'Hum on "mm" first, then a straw SOVT siren.' } },
      coachMove: { cue: 'Give me a hum.', nextAction: 'hum for me' },
    }), null);
  });

  it('is stamped, consumed by exactly ONE take, and cleared', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      assert.equal(session.voiceState.pendingTakeKind, null, 'nothing pending before a prescription');

      // STAMP — as the coach paths do, from the signal's structured surface.
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));
      assert.equal(session.voiceState.pendingTakeKind.kind, 'hum_sovt');
      assert.equal(session.voiceState.pendingTakeKind.drillId, 'starter-easy-hum');
      assert.equal(session.voiceState.pendingTakeKind.lessonId, null);
      assert.equal(harness.runtime.resolveCoachTakeKind(session).source, 'engine-recommendation');

      // CONSUME — the next take goes out as a hum, and the wordless ack agrees.
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));
      assert.equal(harness.takeRequests[0].takeKind, 'hum_sovt');
      assert.equal(harness.coachTakeLines()[0].take_kind, 'hum_sovt');
      assert.equal(payload.inputTurn.takeKind, 'hum_sovt');
      // 'voiced_evidence', not 'drill_kind': the learner never SELECTED a hum
      // drill, so the acknowledgment rests on the analyzer having confirmed a
      // sound, not on the prescription alone. See the review-repair suite.
      assert.equal(harness.ackWitness().metadata.ack_basis, 'voiced_evidence');

      // CLEARED — one-shot, spent at dispatch, witnessed once.
      assert.equal(
        harness.runtime.sessions.get(sessionId).voiceState.pendingTakeKind,
        null,
        'the prescription must not survive the take it was spent on',
      );
      const cleared = harness.logLines.filter((line) => line?.event === 'coach_take_kind_cleared');
      assert.equal(cleared.length, 1);
      assert.equal(cleared[0].reason, 'take_dispatched');
      assert.notEqual(
        harness.runtime.resolveCoachTakeKind(harness.runtime.sessions.get(sessionId)).source,
        'engine-recommendation',
        'a spent prescription can never be read again',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('an older take cannot consume a newer same-kind prescription', async () => {
    let releaseTake;
    const takeGate = new Promise((resolve) => { releaseTake = resolve; });
    const harness = buildHarness({
      asrDelayMs: 60,
      takeHandler: async (requestBody) => {
        await takeGate;
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    });
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      const signal = { coachingDecision: { recommendedDrill: { id: 'starter-easy-hum' } } };
      const first = harness.runtime.stampEngineRecommendedTakeKind(session, signal);
      const pendingTurn = submitLiveTurn(harness, sessionId, pcm(900));
      while (harness.takeRequests.length === 0) await sleep(1);

      const second = harness.runtime.stampEngineRecommendedTakeKind(session, signal);
      assert.notEqual(second.prescriptionId, first.prescriptionId);
      releaseTake();
      await pendingTurn;

      assert.equal(session.voiceState.pendingTakeKind.prescriptionId, second.prescriptionId);
    } finally {
      releaseTake?.();
      harness.cleanup();
    }
  });

  it('never overrides a drill that DECLARES its own kind — a siren is never re-filed as a hum', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      // This is the correctness bar that matters. The take kind steers the
      // analyzer's per-kind metric contract AND the vocalise-lenient strain bar,
      // so a prescription must never contradict a drill that has already said
      // what this sound is. (A plain phrase drill declares NO kind at all — it
      // resolves to source 'default' — and is exactly the state the engine's
      // prescription is meant to fill in.)
      const sessionId = await armedSession(harness);
      await harness.runtime.voiceOperationRouteHandlers.selectVoiceDrill({
        sessionId,
        lessonId: 'cute-vocalise-siren',
      });
      const session = harness.runtime.sessions.get(sessionId);
      assert.equal(session.voiceState.lessonId, 'cute-vocalise-siren');
      assert.deepEqual(
        harness.runtime.resolveCoachTakeKind(session),
        { kind: 'siren', source: 'drill-kind' },
      );

      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));
      assert.deepEqual(
        harness.runtime.resolveCoachTakeKind(session),
        { kind: 'siren', source: 'drill-kind' },
        'the drill still owns the kind',
      );
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));
      assert.equal(harness.takeRequests[0].takeKind, 'siren');
      assert.equal(payload.inputTurn.takeKind, 'siren');
      // ...and the prescription is untouched, because it was never spent.
      assert.equal(
        harness.runtime.sessions.get(sessionId).voiceState.pendingTakeKind.kind,
        'hum_sovt',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('expires when the drill changes — from both ends', async () => {
    const harness = withWitnessBus(buildHarness());
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);

      // (a) selecting a drill clears it outright.
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));
      assert.ok(session.voiceState.pendingTakeKind);
      await harness.runtime.voiceOperationRouteHandlers.selectVoiceDrill({
        sessionId,
        lessonId: 'cute-light-onset',
      });
      assert.equal(
        harness.runtime.sessions.get(sessionId).voiceState.pendingTakeKind,
        null,
        'selecting a drill retires the old prescription',
      );

      // (b) a lessonId that moved by ANY other route is caught at read time, so
      //     a prescription can never point at a lesson the learner has left.
      const live = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(live, vocaliseSignal('starter-easy-hum'));
      assert.equal(live.voiceState.pendingTakeKind.lessonId, live.voiceState.lessonId);
      live.voiceState = { ...live.voiceState, lessonId: 'some-other-drill' };
      assert.equal(harness.runtime.resolveCoachTakeKind(live).source, 'default');
      assert.equal(live.voiceState.pendingTakeKind, null, 'the stale prescription is cleared on read');
    } finally {
      harness.cleanup();
    }
  });

  it('reselecting the same drill still retires an engine prescription', async () => {
    const harness = withWitnessBus(buildHarness());
    try {
      const sessionId = await armedSession(harness);
      await harness.runtime.voiceOperationRouteHandlers.selectVoiceDrill({
        sessionId,
        lessonId: 'cute-light-onset',
      });
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(
        session,
        vocaliseSignal('starter-easy-hum'),
      );
      assert.ok(session.voiceState.pendingTakeKind);

      await harness.runtime.voiceOperationRouteHandlers.selectVoiceDrill({
        sessionId,
        lessonId: 'cute-light-onset',
      });

      assert.equal(session.voiceState.pendingTakeKind, null);
      assert.equal(
        harness.logLines.filter((line) => line?.event === 'coach_take_kind_cleared').at(-1).reason,
        'drill_selected',
      );
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// F2 WIRING — the stamp must fire on BOTH real coach paths.
//
// The two coach paths do not share a function: the buffered one runs through
// coachingTurn, the SSE one builds its signal and streams itself. A prescription
// that only landed on one of them would leave the other path's learners in the
// exact split-brain state this repair exists to close, so both are driven here
// through their real entry points with a real signal.
// ---------------------------------------------------------------------------

/** A take whose strain sits in the WARN band (0.52) but under the stop (0.70) —
 *  which is what makes the engine's own focus 'strain_reduction' and its
 *  recommendedDrill 'starter-easy-hum'. Measured against the live builder. */
function strainedTakeState() {
  const quality = { strainRisk: 0.58, breathyRisk: 0.05 };
  const metrics = {
    meanPitchHz: 210,
    pitchRangeSt: 5,
    resonanceMean: 0.6,
    weightMean: 0.3,
    targetHitPct: 0.8,
    similarityScore: 0.75,
    quality,
    advanced: {
      measurementAvailable: true,
      measurementRejectionReasons: [],
      voicedFramePct: 0.9,
      confidentFramePct: 0.9,
      scoreConfidence: 0.85,
      captureReliability: 0.9,
      snrDb: 25,
      clippingPct: 0.001,
      quality,
      reliabilityFlags: [],
    },
  };
  const finalizedAt = Date.now();
  return {
    lastSummary: { metrics, targetPreset: 'cute-feminine' },
    lastAttemptArtifact: { attemptArtifactId: 'strained-1', metrics, quality, finalizedAt },
    lastTakeFinalizedAt: finalizedAt,
  };
}

describe('field repair: both coach paths stamp the prescription (wiring)', () => {
  it('the STREAMING coach path stamps what its own signal recommended', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      session.voiceState = { ...session.voiceState, ...strainedTakeState() };
      assert.equal(session.voiceState.pendingTakeKind, null);

      await harness.runtime.generateRealtimeCoachReplyStreaming(
        session,
        'how did that sound',
        { writeHead() {}, write() {}, end() {} },
      );

      const prescribed = harness.logLines.filter((l) => l?.event === 'coach_take_kind_prescribed');
      assert.equal(prescribed.length, 1, 'the streaming path must stamp exactly once');
      assert.equal(prescribed[0].take_kind, 'hum_sovt');
      assert.equal(prescribed[0].drill_id, 'starter-easy-hum');
      assert.equal(
        harness.runtime.sessions.get(sessionId).voiceState.pendingTakeKind.kind,
        'hum_sovt',
      );
      // ...and the next take really goes out under it.
      assert.equal(harness.runtime.resolveCoachTakeKind(
        harness.runtime.sessions.get(sessionId),
      ).source, 'engine-recommendation');
    } finally {
      harness.cleanup();
    }
  });

  it('the BUFFERED coach path stamps it too', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      session.voiceState = { ...session.voiceState, ...strainedTakeState() };

      await harness.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
        sessionId,
        message: 'how did that sound',
      });

      const prescribed = harness.logLines.filter((l) => l?.event === 'coach_take_kind_prescribed');
      assert.equal(prescribed.length, 1, 'the buffered path must stamp exactly once');
      assert.equal(prescribed[0].take_kind, 'hum_sovt');
      assert.equal(
        harness.runtime.sessions.get(sessionId).voiceState.pendingTakeKind.kind,
        'hum_sovt',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('a NON-vocalise turn stamps nothing at all', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      // No take evidence -> no issue -> no vocalise recommendation.
      await harness.runtime.generateRealtimeCoachReplyStreaming(
        harness.runtime.sessions.get(sessionId),
        'how did that sound',
        { writeHead() {}, write() {}, end() {} },
      );
      assert.equal(harness.logLines.filter((l) => l?.event === 'coach_take_kind_prescribed').length, 0);
      assert.equal(harness.runtime.sessions.get(sessionId).voiceState.pendingTakeKind, null);
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// REVIEW REPAIRS (2026-07-26) — two defects the independent review caught in the
// first cut of this fix. Both are about the same thing: a PRESCRIPTION is a
// proposal, not evidence, and it must not be able to outlive its turn or speak
// for the analyzer.
// ---------------------------------------------------------------------------

describe('review repair: a prescription can never manufacture evidence', () => {
  const vocaliseSignal = (id) => ({ coachingDecision: { recommendedDrill: { id } } });

  it('prescribed hum + genuine SILENCE says nothing — the engine proposes, the analyzer confirms', async () => {
    // FIRST CUT WAS WRONG HERE. The acknowledgment reads this turn's take kind
    // from the take outcome, and the prescription had just set that to
    // hum_sovt — so the drill_kind branch fired on a take with zero voiced
    // frames and spoke "Heard the hum". That is a fabricated claim about a
    // sound nobody made, in a session where the learner had selected no hum
    // drill at all. A prescribed kind now carries no warrant of its own.
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        const body = oneshotTakeResponse(requestBody);
        for (const block of [body.summary.metrics, body.attemptArtifact.metrics]) {
          // Genuine silence — flags AND the loudness floor, per the note on the
          // sibling silence fixture above. Without loudness this is
          // indistinguishable from a real hum under the voicing bar.
          block.advanced.measurementAvailable = false;
          block.advanced.measurementRejectionReasons = ['no_voiced_frames'];
          block.advanced.voicedFramePct = 0;
          block.advanced.reliabilityFlags = [
            'no_voiced_frames',
            'low_voiced_coverage',
            'low_confidence',
            'low_score_confidence',
            'quiet_input',
          ];
          block.advanced.peakLoudnessDb = -100;
          block.advanced.meanLoudnessDb = -100;
        }
        return mockJsonResponse(200, body);
      },
    }));
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));

      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      // The take really did go out as a hum — that half is the point of F2.
      assert.equal(harness.takeRequests[0].takeKind, 'hum_sovt');
      // ...and the learner is told NOTHING, because nothing was heard.
      assert.equal(payload.inputTurn.wordlessPractice, undefined);
      assert.equal(payload.inputTurn.coachLine, undefined);
      assert.equal(harness.ackWitness(), undefined);
    } finally {
      harness.cleanup();
    }
  });

  it('prescribed hum + a REAL hum is acknowledged by its kind, on voiced_evidence', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));

      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      assert.equal(payload.inputTurn.wordlessPractice, true);
      assert.equal(payload.inputTurn.takeKind, 'hum_sovt');
      // The analyzer confirmed the sound, so naming it is honest — but the
      // BASIS on the record is the evidence, not the drill state, because the
      // learner never selected a hum drill.
      assert.equal(harness.ackWitness().metadata.ack_basis, 'voiced_evidence');
      assert.match(payload.inputTurn.coachLine, /read|measured|work from/i);
    } finally {
      harness.cleanup();
    }
  });

  it('a SELECTED hum drill still needs no measurement — the learner chose it', async () => {
    // The pre-existing warrant, unchanged: a drill the learner selected is its
    // own evidence that this turn was wordless practice, so a timed-out or
    // An unmeasurable take still gets a concrete retry without an observation claim.
    const harness = withWitnessBus(buildHarness({
      coachTakeTimeoutMs: 25,
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        await sleep(400);
        return mockJsonResponse(200, oneshotTakeResponse(requestBody));
      },
    }));
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await submitLiveTurn(harness, sessionId, pcm(1200));

      assert.equal(payload.inputTurn.wordlessPractice, true);
      assert.equal(harness.ackWitness().metadata.ack_basis, 'drill_kind');
      assert.equal(
        payload.inputTurn.coachLine,
        'I could not get a usable voice reading. Try the hum again, easy and unforced.',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('the take witness records WHERE its kind came from', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));
      await submitLiveTurn(harness, sessionId, pcm(1200));
      // Provenance rides the outcome; without it the acknowledgment cannot tell
      // a kind the learner chose from a kind the engine merely proposed.
      assert.equal(harness.coachTakeLines()[0].take_kind, 'hum_sovt');
      assert.equal(harness.coachTakeLines()[0].take_kind_source, 'engine-recommendation');
    } finally {
      harness.cleanup();
    }
  });
});

describe('review repair: a prescription does not outlive the engine that made it', () => {
  const vocaliseSignal = (id) => ({ coachingDecision: { recommendedDrill: { id } } });

  it('is retired by the next turn that recommends something else', async () => {
    // FIRST CUT WAS WRONG HERE TOO. A coach turn with no take dispatched cannot
    // spend the one-shot, so a hum prescribed three text-only turns ago was
    // still standing — waiting to re-file an ordinary phrase take as a hum and
    // hand it the vocalise-lenient strain bar. The engine's latest word wins.
    const harness = withWitnessBus(buildHarness());
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);

      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));
      assert.equal(session.voiceState.pendingTakeKind.kind, 'hum_sovt');

      // A later turn whose recommendation is NOT a vocalise.
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-slowdown'));
      assert.equal(session.voiceState.pendingTakeKind, null);
      assert.equal(harness.runtime.resolveCoachTakeKind(session).source, 'default');

      const cleared = harness.logLines.filter((line) => line?.event === 'coach_take_kind_cleared');
      assert.equal(cleared.at(-1).reason, 'superseded');

      // ...and the next take really is a plain phrase again.
      await submitLiveTurn(harness, sessionId, pcm(1200));
      assert.equal(harness.takeRequests[0].takeKind, 'phrase');
    } finally {
      harness.cleanup();
    }
  });

  it('goes stale after a long quiet gap rather than steering the take after a break', async () => {
    // A coach turn that dispatches no take cannot spend the one-shot, so
    // without an age bound a hum prescribed before the learner walked away
    // would still be re-filing the first take after they came back — with the
    // vocalise-lenient strain bar and the wrong per-kind metric contract.
    const harness = withWitnessBus(buildHarness());
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));
      assert.equal(harness.runtime.resolveCoachTakeKind(session).source, 'engine-recommendation');

      // Back-date it past the quiet-session window.
      session.voiceState = {
        ...session.voiceState,
        pendingTakeKind: {
          ...session.voiceState.pendingTakeKind,
          stampedAt: Date.now() - (21 * 60 * 1000),
        },
      };

      assert.deepEqual(
        harness.runtime.resolveCoachTakeKind(session),
        { kind: 'phrase', source: 'default' },
      );
      assert.equal(session.voiceState.pendingTakeKind, null);
      assert.equal(
        harness.logLines.filter((line) => line?.event === 'coach_take_kind_cleared').at(-1).reason,
        'expired',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('a later vocalise recommendation replaces the standing one', async () => {
    const harness = withWitnessBus(buildHarness());
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('starter-easy-hum'));
      harness.runtime.stampEngineRecommendedTakeKind(session, vocaliseSignal('masc-vocalise-siren'));
      assert.equal(session.voiceState.pendingTakeKind.kind, 'siren');
    } finally {
      harness.cleanup();
    }
  });
});

// ---------------------------------------------------------------------------
// THE TURN TRIGGER (2026-07-27) — the owner's architectural point, made a rule.
//
// "why are we using an asr? the tutor asks for 'say the words the little cake
//  on the table' and the asr shows the user said exactly those words...but what
//  did that tell the coach? the only thing that the coach got from that was
//  that the user was able to speak english, and never if it spoke correctly in
//  the targetted voice quality"
//
// An ASR yields WORDS. Voice QUALITY comes only from the DSP analyzer. So the
// ASR must not GATE the turn — it is one of two peer evidence sources, and
// confirmed phonation is the other. These tests hold that rule directly, on the
// resolver, rather than only through a whole live turn.
// ---------------------------------------------------------------------------

const {
  VOICE_TURN_TRIGGERS,
  resolveVoiceTurnTrigger,
} = require('./voice-standalone-runtime');

const analyzedTake = (advanced) => ({
  outcome: 'analyzed',
  attemptArtifact: { metrics: { advanced } },
});

// The engine's structured recommendation — a drill id, never the model's prose.
const triggerVocaliseSignal = (id) => ({ coachingDecision: { recommendedDrill: { id } } });

describe('the turn trigger: a turn fires on words OR on confirmed phonation', () => {
  it('a rejecting ASR provider cannot block a DSP-confirmed practice turn', async () => {
    const harness = withWitnessBus(buildHarness({
      asrHandler: async () => {
        throw new Error('ASR provider offline');
      },
    }));
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(payload.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
      assert.equal(payload.inputTurn.voicedEvidence, true);
      assert.equal(payload.inputTurn.evidence.semantic, 'failed');
      assert.equal(payload.inputTurn.evidence.acoustic, 'usable');
      assert.equal(payload.inputTurn.evidence.resolution, 'measured_only');
      assert.equal(payload.inputTurn.responseCommitted, true);
      assert.ok(harness.runtime.sessions.get(sessionId).voiceState.lastAttemptArtifact);
      assert.equal(
        harness.logLines.filter((line) => line?.event === 'voice_turn_trigger').length,
        1,
        'one segment produces one terminal decision',
      );
    } finally {
      harness.cleanup();
    }
  });

  it('ASR words cannot relabel a requested hum as a sentence turn', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: {
        success: true,
        transcript: 'hallucinated little words',
        confidence: 0.31,
        providerStyle: 'simple',
        transcriptSource: 'backend-asr',
      },
    }));
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(payload.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
      assert.equal(payload.inputTurn.evidence.semantic, 'not_applicable');
      assert.equal(payload.inputTurn.wordlessPractice, true);
      assert.equal(payload.inputTurn.listeningTurnId, undefined);
      assert.doesNotMatch(payload.inputTurn.coachLine, /hallucinated|words/i);
    } finally {
      harness.cleanup();
    }
  });

  it('confidence-free Parakeet speech during a requested hum still reaches the tutor', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: {
        success: true,
        transcript: 'Wait how should I do this?',
        providerStyle: 'simple',
        transcriptSource: 'backend-asr',
      },
    }));
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const captured = await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(captured.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.TRANSCRIPT);
      assert.equal(captured.inputTurn.evidence.semantic, 'final');
      assert.equal(captured.inputTurn.transcript, 'Wait how should I do this?');
      assert.match(captured.inputTurn.listeningTurnId, /^listening-turn-/);
      assert.equal(captured.inputTurn.wordlessPractice, undefined);

      const reply = await harness.runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
        sessionId,
        listeningTurnId: captured.inputTurn.listeningTurnId,
      });
      assert.equal(reply.coachingSignal.userUtterance, 'Wait how should I do this?');
      assert.equal(reply.coachingSignal.capture.semanticStatus, 'final');
      assert.equal(reply.coachingSignal.capture.acousticStatus, 'usable');
    } finally {
      harness.cleanup();
    }
  });

  it('short learner controls and questions escape a requested hum', () => {
    for (const transcript of [
      'Why?',
      'Wait what?',
      'Like this?',
      'I cannot',
      'Please stop',
    ]) {
      const trigger = resolveVoiceTurnTrigger({
        transcript,
        transcriptConfidence: 0.99,
        expectedTakeKind: 'hum',
        takeOutcome: analyzedTake({
          measurementAvailable: true,
          voicedFramePct: 0.92,
          pitchValidFrameCount: 300,
        }),
      });
      assert.equal(
        trigger.trigger,
        VOICE_TURN_TRIGGERS.TRANSCRIPT,
        `${transcript} must reach the tutor`,
      );
      assert.equal(trigger.transcript, transcript);
    }
  });

  it('confidence-free short lexical controls escape a requested hum', () => {
    for (const transcript of ['Next', 'Done', 'Okay', 'Yes']) {
      const trigger = resolveVoiceTurnTrigger({
        transcript,
        expectedTakeKind: 'hum',
        takeOutcome: analyzedTake({
          measurementAvailable: true,
          voicedFramePct: 0.92,
          pitchValidFrameCount: 300,
        }),
      });
      assert.equal(
        trigger.trigger,
        VOICE_TURN_TRIGGERS.TRANSCRIPT,
        `${transcript} must reach the tutor without provider confidence`,
      );
      assert.equal(trigger.transcript, transcript);
    }
  });

  it('confidence-free hum-like ASR tokens remain wordless even when repeated', () => {
    for (const transcript of [
      'hm',
      'hmm',
      'hmmm',
      'mhmm',
      'um',
      'umm',
      'uhh',
      'mmm',
      'mm mm mm',
      'hmm hmm hmm',
      'um um um',
    ]) {
      const trigger = resolveVoiceTurnTrigger({
        transcript,
        expectedTakeKind: 'hum',
        takeOutcome: analyzedTake({
          measurementAvailable: true,
          voicedFramePct: 0.92,
          pitchValidFrameCount: 300,
        }),
      });
      assert.equal(trigger.trigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
      assert.equal(trigger.transcript, '');
    }
  });

  it('a slow ASR provider cannot delay a DSP-confirmed practice turn', async () => {
    const harness = withWitnessBus(buildHarness({
      asrDelayMs: 0,
      asrHandler: async () => new Promise(() => {}),
    }));
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await Promise.race([
        submitLiveTurn(harness, sessionId, pcm(900)),
        sleep(400).then(() => {
          throw new Error('DSP-confirmed turn waited for ASR');
        }),
      ]);

      assert.equal(payload.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
      assert.equal(payload.inputTurn.evidence.semantic, 'not_applicable');
      assert.equal(payload.inputTurn.evidence.resolution, 'measured_only');
    } finally {
      harness.cleanup();
    }
  });

  it('a hung ASR cannot delay a DSP-confirmed silent turn', async () => {
    const harness = withWitnessBus(buildHarness({
      asrDelayMs: 0,
      asrHandler: async () => new Promise(() => {}),
      takeHandler: async (requestBody) => {
        const base = oneshotTakeResponse(requestBody);
        const silent = {
          measurementAvailable: false,
          measurementRejectionReasons: ['no_voiced_frames'],
          reliabilityFlags: ['no_voiced_frames'],
          voicedFramePct: 0,
          pitchValidFrameCount: 0,
          peakLoudnessDb: -100,
        };
        base.attemptArtifact.metrics.advanced = silent;
        base.summary.metrics.advanced = silent;
        return mockJsonResponse(200, base);
      },
    }));
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await Promise.race([
        submitLiveTurn(harness, sessionId, pcm(900)),
        sleep(400).then(() => {
          throw new Error('DSP-confirmed silence waited for ASR');
        }),
      ]);

      assert.equal(payload.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.SILENT);
      assert.equal(payload.inputTurn.evidence.semantic, 'not_applicable');
      assert.equal(payload.inputTurn.evidence.resolution, 'silent');
    } finally {
      harness.cleanup();
    }
  });

  it('a hung ASR cannot delay a turn whose acoustic evidence failed', async () => {
    const harness = withWitnessBus(buildHarness({
      asrDelayMs: 0,
      asrHandler: async () => new Promise(() => {}),
      takeHandler: async () => {
        throw new Error('analyzer unavailable');
      },
    }));
    try {
      const sessionId = await armedSession(harness, { lessonId: 'cute-vocalise-hum' });
      const payload = await Promise.race([
        submitLiveTurn(harness, sessionId, pcm(900)),
        sleep(400).then(() => {
          throw new Error('failed acoustic evidence waited for ASR');
        }),
      ]);

      assert.equal(payload.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.UNRESOLVED);
      assert.equal(payload.inputTurn.evidence.semantic, 'not_applicable');
      assert.equal(payload.inputTurn.evidence.acoustic, 'failed');
      assert.equal(payload.inputTurn.evidence.resolution, 'unresolved');
    } finally {
      harness.cleanup();
    }
  });

  it('words alone trigger a turn, and carry the analyzer verdict alongside them', () => {
    const trigger = resolveVoiceTurnTrigger({
      transcript: '  the little cake on the table  ',
      takeOutcome: analyzedTake({ measurementAvailable: true, voicedFramePct: 0.92, pitchValidFrameCount: 300 }),
    });
    assert.equal(trigger.trigger, VOICE_TURN_TRIGGERS.TRANSCRIPT);
    assert.equal(trigger.transcript, 'the little cake on the table');
    // The owner's actual complaint: words alone say only that the learner can
    // speak English. The quality verdict has to ride along, from the DSP.
    assert.equal(trigger.voicedEvidence, true);
  });

  it('NO words but confirmed phonation is a first-class turn, not a failed one', () => {
    const trigger = resolveVoiceTurnTrigger({
      transcript: '',
      takeOutcome: analyzedTake({ measurementAvailable: true, voicedFramePct: 0.94, pitchValidFrameCount: 360 }),
    });
    assert.equal(trigger.trigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
    assert.equal(trigger.voicedEvidence, true);
  });

  it('a short-but-real sound still triggers, rescued by pitched-frame count', () => {
    // MEASURED against the live analyzer: a 1.6s hum inside an 8s segment reads
    // voicedFramePct 0.199 — below the coverage bar — with pitchValidFrameCount
    // 159. That is a real sound and must still be a turn.
    const trigger = resolveVoiceTurnTrigger({
      transcript: '',
      takeOutcome: analyzedTake({ measurementAvailable: true, voicedFramePct: 0.199, pitchValidFrameCount: 159 }),
    });
    assert.equal(trigger.trigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
  });

  it('digital silence is SILENT — only the analyzer may confirm a sound', () => {
    // MEASURED against the live analyzer: digital silence returns
    // measurementAvailable false with reasons ['no_voiced_frames'].
    const trigger = resolveVoiceTurnTrigger({
      transcript: '',
      takeOutcome: analyzedTake({
        measurementAvailable: false,
        voicedFramePct: 0,
        pitchValidFrameCount: 0,
        measurementRejectionReasons: ['no_voiced_frames'],
        reliabilityFlags: ['no_voiced_frames'],
        peakLoudnessDb: -100,
      }),
    });
    assert.equal(trigger.trigger, VOICE_TURN_TRIGGERS.SILENT);
    assert.equal(trigger.voicedEvidence, false);
  });

  it('ABSENCE of a take is unresolved, never silently relabeled as silence', () => {
    for (const takeOutcome of [
      null,
      { outcome: 'timeout' },
      { outcome: 'error', reason: 'http_503' },
      { outcome: 'skipped', reason: 'no_analyzer_session' },
      // Analyzed, but the analyzer reported nothing about voicing at all.
      analyzedTake({}),
    ]) {
      const trigger = resolveVoiceTurnTrigger({ transcript: '', takeOutcome });
      assert.equal(
        trigger.trigger,
        VOICE_TURN_TRIGGERS.UNRESOLVED,
        `absent/failed take must remain unresolved: ${JSON.stringify(takeOutcome)}`,
      );
    }
  });

  it('no_voiced_frames without loudness-floor evidence remains unresolved', () => {
    const trigger = resolveVoiceTurnTrigger({
      transcript: '',
      takeOutcome: analyzedTake({
        measurementAvailable: false,
        voicedFramePct: 0,
        pitchValidFrameCount: 0,
        measurementRejectionReasons: ['no_voiced_frames'],
        reliabilityFlags: ['no_voiced_frames'],
      }),
    });
    assert.equal(trigger.trigger, VOICE_TURN_TRIGGERS.UNRESOLVED);
  });

  it('a voiced phrase turn without words reports its trigger and accepts the measured take', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(payload.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
      assert.equal(payload.inputTurn.voicedEvidence, true);
      assert.equal(payload.inputTurn.wordlessPractice, true);
      assert.equal(payload.inputTurn.semanticRetry, undefined);
      assert.doesNotMatch(payload.inputTurn.coachLine, /again/i);

      const trig = harness.logLines.filter((line) => line?.event === 'voice_turn_trigger');
      assert.equal(trig.length, 1);
      assert.equal(trig[0].trigger, VOICE_TURN_TRIGGERS.VOICED_EVIDENCE);
      assert.equal(trig[0].voiced_evidence, true);
      assert.equal(
        harness.ackWitness()?.metadata?.turn_trigger,
        VOICE_TURN_TRIGGERS.VOICED_EVIDENCE,
      );
    } finally {
      harness.cleanup();
    }
  });

  it('a genuinely silent phrase turn asks for a retry without a fabricated heard claim', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
      takeHandler: async (requestBody) => {
        const base = oneshotTakeResponse(requestBody);
        const silent = {
          measurementAvailable: false,
          measurementRejectionReasons: ['no_voiced_frames'],
          reliabilityFlags: ['no_voiced_frames'],
          voicedFramePct: 0,
          pitchValidFrameCount: 0,
          peakLoudnessDb: -100,
        };
        base.attemptArtifact.metrics.advanced = silent;
        base.summary.metrics.advanced = silent;
        return mockJsonResponse(200, base);
      },
    }));
    try {
      const sessionId = await armedSession(harness);
      const payload = await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(payload.inputTurn.outcome, 'no-speech');
      assert.equal(payload.inputTurn.turnTrigger, VOICE_TURN_TRIGGERS.SILENT);
      assert.equal(payload.inputTurn.voicedEvidence, false);
      assert.ok(!payload.inputTurn.wordlessPractice, 'silence must not be acknowledged');
      assert.equal(payload.inputTurn.semanticRetry, true);
      assert.match(payload.inputTurn.coachLine, /didn't catch.*sentence again/i);
      assert.doesNotMatch(payload.inputTurn.coachLine, /heard your voice/i);
      assert.equal(harness.ackWitness(), undefined);
    } finally {
      harness.cleanup();
    }
  });

  it('STATE-FOLLOWING: an engine-prescribed hum is now actually CONSUMED by a take', async () => {
    // 2026-07-27. The prescription mechanism was wired to both coach paths, but
    // it is SPENT only at the take dispatch site — which returned null on every
    // coach turn. So a prescribed kind was stamped, never consumed, and then
    // cleared by the next non-vocalise recommendation. The field session showed
    // pendingTakeKind null for exactly that reason. With the take leg alive the
    // prescription reaches the analyzer, which is what it was always for.
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      harness.runtime.stampEngineRecommendedTakeKind(session, triggerVocaliseSignal('starter-easy-hum'));
      assert.equal(session.voiceState.pendingTakeKind.kind, 'hum_sovt');

      await submitLiveTurn(harness, sessionId, pcm(900));

      assert.equal(harness.takeRequests.length, 1);
      assert.equal(harness.takeRequests[0].takeKind, 'hum_sovt', 'the analyzer files it as the prescribed kind');
      const witness = harness.coachTakeLines()[0];
      assert.equal(witness.take_kind, 'hum_sovt');
      assert.equal(witness.take_kind_source, 'engine-recommendation');
      assert.equal(session.voiceState.pendingTakeKind, null, 'the one-shot is spent, exactly once');
    } finally {
      harness.cleanup();
    }
  });

  it('a prescribed sound returns to words and accepts measured phrases without advancing lexical progress', async () => {
    const harness = withWitnessBus(buildHarness({
      asrResult: { noSpeech: true, providerStyle: 'simple', transcriptSource: 'backend-asr' },
    }));
    try {
      const sessionId = await armedSession(harness);
      const session = harness.runtime.sessions.get(sessionId);
      session.voiceState = harness.runtime.voiceStateRuntime.updateSessionVoiceState(session, {
        activeLine: {
          id: 'return-line',
          displayText: 'It should be an easy morning today.',
          targetPreset: 'cute-feminine',
        },
      });
      harness.runtime.stampEngineRecommendedTakeKind(
        session,
        triggerVocaliseSignal('starter-easy-hum'),
      );

      const sound = await submitLiveTurn(harness, sessionId, pcm(900));
      assert.equal(harness.takeRequests[0].takeKind, 'hum_sovt');
      assert.equal(sound.inputTurn.practiceProgression.transition, 'bridge');
      assert.match(sound.inputTurn.coachLine, /easy morning/i);

      const bridge = await submitLiveTurn(harness, sessionId, pcm(900));
      assert.equal(harness.takeRequests[1].takeKind, 'phrase');
      assert.equal(bridge.inputTurn.wordlessPractice, true);
      assert.equal(bridge.inputTurn.semanticRetry, undefined);
      assert.equal(bridge.inputTurn.practiceProgression, undefined);
      assert.doesNotMatch(bridge.inputTurn.coachLine, /again/i);
      assert.equal(session.voiceState.practiceProgression.expectedUnit, 'phrase');

      const sentence = await submitLiveTurn(harness, sessionId, pcm(900));
      assert.equal(harness.takeRequests[2].takeKind, 'phrase');
      assert.equal(sentence.inputTurn.wordlessPractice, true);
      assert.equal(sentence.inputTurn.semanticRetry, undefined);
      assert.doesNotMatch(sentence.inputTurn.coachLine, /again/i);
      assert.equal(
        session.voiceState.practiceProgression.expectedUnit,
        'phrase',
        'missing lexical evidence freezes only the lexical step',
      );
    } finally {
      harness.cleanup();
    }
  });
});

// The kind-neutral voiced-practice acknowledgement accepts a usable measured
// turn without pretending ASR recovered the sentence or requesting a repeat.
describe('voicedPracticeLineWithSentence', () => {
  it('acknowledges the reading without quoting or asking for the sentence again', () => {
    const { voicedPracticeLineWithSentence } = require('./voice-standalone-runtime');
    const withLine = voicedPracticeLineWithSentence('seed-a', { activeLine: { displayText: 'how was your day' } });
    assert.match(withLine, /usable voice reading|clearly enough to use|voice reading is ready/i);
    assert.doesNotMatch(withLine, /again|how was your day|"/i);
    // Deterministic on the seed (same take, same line).
    assert.equal(withLine, voicedPracticeLineWithSentence('seed-a', { activeLine: { displayText: 'how was your day' } }));
    const noLine = voicedPracticeLineWithSentence('seed-a', {});
    assert.equal(noLine, withLine);
  });
});

describe('coach ASR audio source — dual-capture race fix (2026-08-05)', () => {
  it('feeds ASR the streamed-PCM WAV the analyzer used, not a divergent recorded blob', async () => {
    const harness = buildHarness();
    try {
      const sessionId = await armedSession(harness);
      // Good "speech" the analyzer measures: a low-amplitude 150 Hz tone, 0.5 s @ 16 kHz.
      const goodPcm = Buffer.alloc(8000);
      for (let i = 0; i < 8000; i += 2) {
        const v = Math.round(Math.sin((i / 2) * 2 * Math.PI * 150 / 16000) * 6000);
        goodPcm.writeInt16LE(v, i);
      }
      // A DIFFERENT-length WAV simulating the divergent/disagreeing recorded blob.
      const divergentBlob = encodePcm16Wav(Buffer.alloc(32000, 0), 16000);
      await harness.runtime.voiceOperationRouteHandlers.submitVoiceInputTurn({
        sessionId,
        requestedProvider: 'backend',
        captureProvider: 'backend',
        audioFormat: 'wav',
        mimeType: 'audio/wav',
        filename: 'voice-input.wav',
        transcriptSource: 'backend-live',
        capturedAt: Date.now(),
      }, {
        audioBuffer: divergentBlob,
        pcmBuffer: goodPcm,
        shouldCommit: () => true,
      });
      const witness = harness.logLines.find((l) => l && l.event === 'coach_asr_source');
      assert.ok(witness, 'coach_asr_source witness must fire on every take');
      assert.equal(witness.source, 'stream-pcm-wav', 'ASR must read the streamed PCM the analyzer used');
      assert.equal(witness.stream_pcm_bytes, goodPcm.length);
      assert.equal(witness.asr_bytes, 44 + goodPcm.length, 'ASR audio must be the WAV built from the stream PCM');
      assert.notEqual(witness.asr_bytes, divergentBlob.length, 'ASR must NOT receive the divergent recorded blob');
    } finally {
      harness.cleanup();
    }
  });
});
