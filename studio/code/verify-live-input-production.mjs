import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const gatewayUrl = process.env.TRANSVOICE_GATEWAY_URL || 'http://127.0.0.1:3021';
const gatewayWsUrl = gatewayUrl.replace(/^http/, 'ws');
const deliberatePause = process.argv.includes('--deliberate-pause');
const pauseSplitSeconds = Number(process.env.TRANSVOICE_PAUSE_SPLIT_SECONDS || 2.4);
const candidateSilenceMs = Number(process.env.TRANSVOICE_CANDIDATE_SILENCE_MS || 1800);
const fallbackSilenceMs = Math.max(
  candidateSilenceMs,
  Number(process.env.TRANSVOICE_FALLBACK_SILENCE_MS || 4500),
);
const fixture = process.env.TRANSVOICE_SPEECH_FIXTURE
  || path.join(projectRoot, 'voice-references/aster-tts-sample.wav');
const require = createRequire(path.join(projectRoot, 'package.json'));
const WebSocket = require('ws');

const decode = spawnSync('ffmpeg', [
  '-v', 'error', '-i', fixture, '-f', 's16le', '-ac', '1', '-ar', '16000', 'pipe:1',
], { encoding: null, maxBuffer: 16 * 1024 * 1024 });
if (decode.status !== 0 || !Buffer.isBuffer(decode.stdout) || !decode.stdout.length) {
  throw new Error(`Could not decode the production speech fixture: ${decode.stderr?.toString('utf8') || 'empty audio'}`);
}

const sessionId = `live-input-proof-${randomUUID()}`;
const studentId = `live-input-proof-${randomUUID()}`;
const liveInputLeaseId = `live-input-proof-${randomUUID()}`;
const baseline = await fetch(`${gatewayUrl}/voice/debug/events?since=0&limit=1`)
  .then((response) => response.json());
const baselineSeq = Number(baseline.snapshot?.seq) || 0;
let socket = null;

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${options.method || 'GET'} ${url} failed: ${response.status}`);
  return body;
}

async function recentSeamEvents() {
  const debug = await requestJson(`${gatewayUrl}/voice/debug/events?since=${baselineSeq}&limit=500`);
  return (debug.events || [])
    .filter((event) => event.kind === 'voice-input-live' || event.kind === 'voice-turn-detector')
    .map((event) => ({
      seq: event.seq,
      kind: event.kind,
      message: event.msg,
      data: event.data,
    }));
}

try {
  await requestJson(`${gatewayUrl}/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId,
      studentId,
      forceNewSession: true,
      prepareLiveInput: true,
      activate: false,
      liveInputLeaseId,
    }),
  });

  socket = new WebSocket(`${gatewayWsUrl}/voice/input/live`);
  const envelopes = [];
  socket.on('message', (value) => {
    const payload = JSON.parse(value.toString('utf8'));
    envelopes.push({
      event: payload.event,
      code: payload.code || null,
      transcriptChars: typeof payload.transcript === 'string' ? payload.transcript.length : null,
      receivedAt: Date.now(),
    });
  });
  await new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });

  const openedAt = Date.now();
  socket.send(JSON.stringify({
    type: 'open',
    sessionId,
    liveInputLeaseId,
    sampleRate: 16000,
    candidateSilenceMs,
    silenceHoldMs: fallbackSilenceMs,
  }));
  const acceptedDeadline = Date.now() + 2000;
  while (!envelopes.some(({ event }) => event === 'session-started') && Date.now() < acceptedDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  if (!envelopes.some(({ event }) => event === 'session-started')) {
    throw new Error('The production gateway did not accept the live input lease.');
  }
  await requestJson(`${gatewayUrl}/session/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, studentId, liveInputLeaseId, activate: true }),
  });
  let pausePreserved = null;
  let firstPauseDecision = null;
  if (deliberatePause) {
    const splitBytes = Math.min(
      decode.stdout.length - 2,
      Math.max(2, Math.round(pauseSplitSeconds * 16000) * 2),
    );
    socket.send(decode.stdout.subarray(0, splitBytes));
    const deliberatePauseMs = 1200;
    socket.send(Buffer.alloc(Math.round(16000 * deliberatePauseMs / 1000) * 2));
    if (candidateSilenceMs > deliberatePauseMs) {
      await new Promise((resolve) => setTimeout(resolve, 150));
      firstPauseDecision = 'candidate-not-reached';
    } else {
      const pauseDeadline = Date.now() + 2500;
      while (Date.now() < pauseDeadline) {
        const firstDecisionEvent = (await recentSeamEvents())
          .find((event) => event.message === 'Semantic endpoint decision completed.');
        if (firstDecisionEvent) {
          firstPauseDecision = firstDecisionEvent.data?.outcome || null;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    pausePreserved = ['incomplete', 'candidate-not-reached'].includes(firstPauseDecision)
      && !envelopes.some(({ event }) => event === 'processing');
    if (pausePreserved) {
      socket.send(decode.stdout.subarray(splitBytes));
      socket.send(Buffer.alloc(Math.round(16000 * candidateSilenceMs / 1000) * 2));
    }
  } else {
    socket.send(decode.stdout);
    socket.send(Buffer.alloc(Math.round(16000 * candidateSilenceMs / 1000) * 2));
  }

  let usedFallbackExtension = false;
  const semanticDeadline = Date.now() + 1500;
  while (!envelopes.some(({ event }) => event === 'processing') && Date.now() < semanticDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  if (!envelopes.some(({ event }) => event === 'processing')) {
    usedFallbackExtension = true;
    socket.send(Buffer.alloc(Math.round(16000 * (fallbackSilenceMs - candidateSilenceMs) / 1000) * 2));
  }

  const finalDeadline = Date.now() + 15000;
  while (!envelopes.some(({ event }) => event === 'final-transcript' || event === 'error')
    && Date.now() < finalDeadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }

  const seamEvents = await recentSeamEvents();
  const asrCompleted = seamEvents.find((event) => event.data?.outcome === 'asr-completed');
  const asrStarted = seamEvents.find((event) => event.data?.outcome === 'asr-started');
  const semantic = seamEvents.find((event) => event.message === 'Semantic endpoint decision completed.');
  const final = envelopes.find(({ event }) => event === 'final-transcript');
  const errors = envelopes.filter(({ event }) => event === 'error');
  const hasForbiddenContentField = (value) => {
    if (!value || typeof value !== 'object') return false;
    return Object.entries(value).some(([key, child]) => (
      ['transcript', 'audioBase64', 'pcm16Base64', 'audioBuffer'].includes(key)
      || hasForbiddenContentField(child)
    ));
  };
  const checks = {
    speechDetected: envelopes.some(({ event }) => event === 'speech-start'),
    processingVisible: envelopes.some(({ event }) => event === 'processing'),
    finalTranscript: Boolean(final && final.transcriptChars > 0),
    noErrors: errors.length === 0,
    privacySafeWitnesses: !hasForbiddenContentField(seamEvents),
    providerAsrUnderThreeSeconds: Number(asrCompleted?.data?.asr_ms) > 0
      && Number(asrCompleted?.data?.asr_ms) < 3000,
    ...(deliberatePause ? { deliberatePausePreserved: pausePreserved === true } : {}),
  };

  console.log(JSON.stringify({
    gate: Object.values(checks).every(Boolean) ? 'PASS' : 'FAIL',
    mode: deliberatePause ? 'deliberate-pause' : 'complete-turn',
    fixture: path.relative(projectRoot, fixture),
    audio: { seconds: Number((decode.stdout.length / 2 / 16000).toFixed(2)), pcmBytes: decode.stdout.length },
    endpoint: {
      candidateSilenceMs,
      fallbackSilenceMs,
      usedFallbackExtension,
      boundary: asrStarted?.data?.boundary || null,
      semanticOutcome: semantic?.data?.outcome || null,
      probabilityBand: semantic?.data?.probability_band || null,
      pauseSplitSeconds: deliberatePause ? pauseSplitSeconds : null,
      firstPauseDecision,
      pausePreserved,
    },
    timing: {
      clientOpenToFinalMs: final ? final.receivedAt - openedAt : null,
      openToAsrMs: asrStarted?.data?.open_to_asr_ms ?? null,
      providerAsrMs: asrCompleted?.data?.asr_ms ?? null,
      openToFinalMs: asrCompleted?.data?.open_to_final_ms ?? null,
    },
    envelopes,
    seamEvents,
    checks,
  }, null, 2));
  if (!Object.values(checks).every(Boolean)) process.exitCode = 1;
} finally {
  try { socket?.close(); } catch { /* best-effort probe cleanup */ }
  await fetch(`${gatewayUrl}/session/${encodeURIComponent(sessionId)}/stop`, { method: 'POST' }).catch(() => null);
  await fetch(`${gatewayUrl}/voice/standalone/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' }).catch(() => null);
}
