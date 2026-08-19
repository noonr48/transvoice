import { spawn, spawnSync } from 'node:child_process';
import path from 'node:path';

const projectRoot = path.resolve(import.meta.dirname, '../..');
const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const gatewayUrl = process.env.TRANSVOICE_GATEWAY_URL || 'http://127.0.0.1:3021';
const fixture = process.env.TRANSVOICE_ACOUSTIC_FIXTURE
  || path.join(projectRoot, 'voice-references/aster-tts-sample.wav');
const sink = process.env.TRANSVOICE_ACOUSTIC_SINK
  || 'alsa_output.usb-Generic_USB_Audio-00.HiFi_5_1__Speaker__sink';
const acousticOutput = process.env.TRANSVOICE_ACOUSTIC_OUTPUT || 'host-speaker';
const injectedPhoneSocket = acousticOutput === 'phone-socket-fixture';
const loopTimeoutMs = Math.max(
  20_000,
  Number(process.env.TRANSVOICE_SPOKEN_LOOP_TIMEOUT_MS) || 45_000,
);

const targets = await fetch(`${cdpUrl}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('/app'));
if (!target) throw new Error('Voice Tutor WebView target not found.');

const baseline = await fetch(`${gatewayUrl}/voice/debug/events?since=0&limit=1`)
  .then((response) => response.json());
const baselineSeq = Number(baseline.snapshot?.seq) || 0;
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++requestId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

async function probe() {
  const result = await call('Runtime.evaluate', {
    expression: `(() => {
      const root = document.getElementById('tv-coach-surface');
      const status = document.getElementById('tv-coach-status');
      const toggle = document.getElementById('tv-coach-session-toggle');
      const preset = document.getElementById('tv-coach-preset-button');
      const hiddenQuestion = document.getElementById('voice-coach-question');
      const hiddenContinuous = document.getElementById('voice-coach-live-toggle');
      const hiddenThread = document.getElementById('voice-coach-thread');
      const diagnostics = window.__tvCoachDiagnostics?.snapshot?.() || null;
      const lastHandoff = window.__tvCoachLastHandoff || null;
      return {
        activity: root?.dataset.activity || null,
        sessionState: root?.dataset.sessionState || null,
        status: status?.textContent?.trim() || '',
        statusKind: status?.dataset.kind || null,
        toggle: toggle?.textContent?.trim() || '',
        preset: preset?.textContent?.trim() || '',
        actualAudio: window.__tvCoach?.isPlaying?.() === true,
        speechBusy: window.__tvCoach?.isSpeaking?.() === true,
        questionDraft: hiddenQuestion?.value || '',
        hiddenContinuousLabel: hiddenContinuous?.textContent?.trim() || '',
        hiddenThreadSpeaking: hiddenThread?.getAttribute('data-speaking') || null,
        diagnostics,
        lastHandoff,
      };
    })()`,
    returnByValue: true,
  });
  return result.result.value;
}

async function clickToggle() {
  await call('Runtime.evaluate', {
    expression: "document.getElementById('tv-coach-session-toggle')?.click()",
    returnByValue: true,
  });
}

async function installPhoneSocketFixtureProbe() {
  await call('Runtime.evaluate', {
    expression: `(() => {
      const OriginalWebSocket = window.WebSocket;
      const probe = {
        socket: null,
        nativeSend: null,
        dropMicrophoneFrames: false,
        restore() {
          window.WebSocket = OriginalWebSocket;
        },
      };
      window.__tvPhoneSocketFixture = probe;
      window.WebSocket = new Proxy(OriginalWebSocket, {
        construct(Target, args) {
          const socket = new Target(...args);
          let pathname = '';
          try { pathname = new URL(String(args[0]), location.href).pathname; } catch {}
          if (pathname !== '/voice/input/live') return socket;
          const nativeSend = socket.send.bind(socket);
          probe.socket = socket;
          probe.nativeSend = nativeSend;
          socket.send = (data) => {
            if (probe.dropMicrophoneFrames && typeof data !== 'string') return;
            return nativeSend(data);
          };
          return socket;
        },
      });
      return true;
    })()`,
    returnByValue: true,
  });
}

async function restorePhoneSocketFixtureProbe() {
  await call('Runtime.evaluate', {
    expression: `(() => {
      window.__tvPhoneSocketFixture?.restore?.();
      delete window.__tvPhoneSocketFixture;
      return true;
    })()`,
    returnByValue: true,
  }).catch(() => null);
}

function decodeFixtureToPcm16() {
  const conversion = spawnSync('ffmpeg', [
    '-v', 'error',
    '-i', fixture,
    '-f', 's16le',
    '-ac', '1',
    '-ar', '16000',
    'pipe:1',
  ], {
    maxBuffer: 4 * 1024 * 1024,
  });
  if (conversion.error) throw conversion.error;
  if (conversion.status !== 0 || !conversion.stdout?.length) {
    throw new Error(`PCM fixture conversion failed: ${String(conversion.stderr || '').slice(0, 400)}`);
  }
  return conversion.stdout;
}

async function injectFixtureThroughPhoneSocket() {
  const pcm = decodeFixtureToPcm16();
  const evaluation = await call('Runtime.evaluate', {
    expression: `(async () => {
      const probe = window.__tvPhoneSocketFixture;
      const socket = probe?.socket;
      const nativeSend = probe?.nativeSend;
      if (!(socket instanceof WebSocket) || socket.readyState !== WebSocket.OPEN || typeof nativeSend !== 'function') {
        throw new Error('Phone live PCM socket is unavailable for fixture injection.');
      }
      const encoded = ${JSON.stringify(pcm.toString('base64'))};
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
      probe.dropMicrophoneFrames = true;
      const frameBytes = 2048;
      let frameCount = 0;
      let fixtureFramesSent = 0;
      const sendFrame = (frame) => {
        if (socket.readyState !== WebSocket.OPEN) return false;
        nativeSend(frame.buffer);
        frameCount += 1;
        return true;
      };
      for (let offset = 0; offset < bytes.length; offset += frameBytes) {
        const frame = new Uint8Array(frameBytes);
        frame.set(bytes.subarray(offset, Math.min(bytes.length, offset + frameBytes)));
        if (!sendFrame(frame)) {
          throw new Error('Phone live PCM socket closed before the speech fixture was fully injected.');
        }
        fixtureFramesSent += 1;
        await new Promise((resolve) => setTimeout(resolve, 64));
      }
      const silenceFrames = Math.ceil(4600 / 64);
      let silenceFramesSent = 0;
      for (; silenceFramesSent < silenceFrames; silenceFramesSent += 1) {
        if (!sendFrame(new Uint8Array(frameBytes))) break;
        await new Promise((resolve) => setTimeout(resolve, 64));
      }
      // The fixture owns only the first learner turn. Release the proxy before
      // the tutor finishes so the reopened capture can prove the Pixel's real
      // microphone path with its own first PCM frame and capture-ready signal.
      probe.dropMicrophoneFrames = false;
      return {
        frameCount,
        fixtureFramesSent,
        pcmBytes: bytes.length,
        silenceFrames,
        silenceFramesSent,
        socketClosedAfterFixture: socket.readyState !== WebSocket.OPEN,
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (evaluation.exceptionDetails) {
    throw new Error(evaluation.exceptionDetails.exception?.description || 'Phone PCM fixture injection failed.');
  }
  return evaluation.result.value;
}

async function waitFor(predicate, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await probe();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`${description}: ${JSON.stringify(latest)}`);
}

function playFixture() {
  return new Promise((resolve, reject) => {
    const child = spawn('paplay', [`--device=${sink}`, '--volume=50000', fixture], {
      stdio: ['ignore', 'ignore', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8').slice(0, 400); });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Acoustic fixture playback failed (${code}): ${stderr.trim()}`));
    });
  });
}

async function playSelectedReferenceOnPhone() {
  const result = await call('Runtime.evaluate', {
    expression: `(async () => {
      const sessionId = window.__tvSession?.id;
      if (!sessionId) throw new Error('Phone session identity is unavailable.');
      const payload = await fetch('/voice/session/' + encodeURIComponent(sessionId)).then((response) => response.json());
      const clipId = payload?.voiceState?.referenceClipId || payload?.session?.voiceState?.referenceClipId;
      if (!clipId) throw new Error('Selected tutor reference is unavailable.');
      const audio = new Audio('/voice/reference/' + encodeURIComponent(clipId) + '/audio');
      audio.volume = 1;
      window.__tvAcousticProbe = audio;
      await audio.play();
      await new Promise((resolve, reject) => {
        audio.addEventListener('ended', resolve, { once: true });
        audio.addEventListener('error', () => reject(new Error('Phone reference playback failed.')), { once: true });
      });
      return true;
    })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Phone reference playback failed.');
}

const timeline = [];
const startedAt = Date.now();
let lastActivity = null;
let lastSignature = null;
let playbackError = null;
let finalState = null;

try {
  const before = await probe();
  if (before.toggle !== 'Start') throw new Error('Coach is already active; refusing to alter an in-progress lesson.');
  if (!before.preset || before.preset === 'Choose voice') throw new Error('No selected tutor voice.');
  if (injectedPhoneSocket) await installPhoneSocketFixtureProbe();
  await clickToggle();
  await waitFor(
    (value) => value.toggle === 'End' && value.activity === 'ready',
    20000,
    'Coach did not reach Ready',
  );

  const playback = (
    injectedPhoneSocket
      ? injectFixtureThroughPhoneSocket()
      : acousticOutput === 'phone-reference'
        ? playSelectedReferenceOnPhone()
        : playFixture()
  ).catch((error) => { playbackError = error; });
  const deadline = Date.now() + loopTimeoutMs;
  let observedSpeaking = false;
  while (Date.now() < deadline) {
    const state = await probe();
    finalState = state;
    const signature = JSON.stringify([
      state.activity,
      state.status,
      state.actualAudio,
      state.speechBusy,
      state.questionDraft,
      state.hiddenContinuousLabel,
      state.hiddenThreadSpeaking,
      state.diagnostics,
      state.lastHandoff,
    ]);
    if (signature !== lastSignature) {
      lastSignature = signature;
      lastActivity = state.activity;
      timeline.push({
        activity: state.activity,
        elapsedMs: Date.now() - startedAt,
        actualAudio: state.actualAudio,
        speechBusy: state.speechBusy,
        statusKind: state.statusKind,
        status: state.status,
        questionDraftPresent: Boolean(state.questionDraft),
        hiddenContinuousLabel: state.hiddenContinuousLabel,
        hiddenThreadSpeaking: state.hiddenThreadSpeaking,
        diagnostics: state.diagnostics,
        lastHandoff: state.lastHandoff,
      });
    }
    if (state.activity === 'speaking' && state.actualAudio) observedSpeaking = true;
    if (observedSpeaking && state.activity === 'ready' && !state.actualAudio) break;
    if (state.statusKind === 'error') break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  await playback;
} finally {
  try {
    const state = await probe();
    if (state.toggle === 'End') {
      await clickToggle();
      await waitFor((value) => value.toggle === 'Start', 20000, 'Coach did not stop');
    }
  } finally {
    if (injectedPhoneSocket) await restorePhoneSocketFixtureProbe();
    socket.close();
  }
}

if (playbackError) throw playbackError;
const debug = await fetch(`${gatewayUrl}/voice/debug/events?since=${baselineSeq}&limit=500`)
  .then((response) => response.json());
const seamEvents = (debug.events || [])
  .filter((event) => event.kind === 'voice-input-live')
  .map((event) => ({
    message: event.msg,
    outcome: event.data?.outcome || null,
    boundary: event.data?.boundary || null,
    asrMs: event.data?.asr_ms ?? null,
  }));
const activities = new Set(timeline.map((entry) => entry.activity));
const failures = [];
const speakingIndex = timeline.findIndex(
  (entry) => entry.activity === 'speaking' && entry.actualAudio,
);
const returnedReadyAfterSpeaking = speakingIndex >= 0 && timeline
  .slice(speakingIndex + 1)
  .some((entry) => entry.activity === 'ready' && !entry.actualAudio);
const lastHandoff = [...timeline]
  .reverse()
  .find((entry) => entry.lastHandoff)?.lastHandoff || finalState?.lastHandoff || null;
const countOutcome = (outcome) => seamEvents.filter((event) => event.outcome === outcome).length;
if (!activities.has('hearing')) failures.push('phone microphone did not expose positive speech evidence');
if (!activities.has('thinking')) failures.push('spoken turn did not reach coach processing');
if (speakingIndex < 0) {
  failures.push('selected tutor voice did not produce an actual-audio Speaking witness');
}
if (!seamEvents.some(({ outcome }) => outcome === 'asr-completed')) failures.push('live PCM did not complete GPU ASR');
if (seamEvents.some(({ outcome }) => outcome === 'asr-failed')) failures.push('GPU ASR failed');
if (!returnedReadyAfterSpeaking) failures.push('Coach did not return to microphone-ready after tutor playback');
if (
  lastHandoff?.action !== 'start-continuous-listening'
  || lastHandoff?.listeningStarted !== true
) {
  failures.push('post-playback listening handoff did not acknowledge a successful microphone reopen');
}
if (countOutcome('session-opened') < 2 || countOutcome('capture-ready') < 2) {
  failures.push('backend did not confirm a second live microphone session after tutor playback');
}
if (finalState?.statusKind === 'error') failures.push('Coach surfaced an actionable runtime error');

console.log(JSON.stringify({
  gate: failures.length ? 'FAIL' : 'PASS',
  page: target.url,
  fixture: path.relative(projectRoot, fixture),
  acousticOutput,
  inputPath: injectedPhoneSocket ? 'phone-webview-live-socket-fixture' : 'room-air-acoustic',
  sink: acousticOutput === 'host-speaker' ? sink : null,
  timeline,
  seamEvents,
  postPlayback: {
    returnedReadyAfterSpeaking,
    lastHandoff,
    liveSessionsOpened: countOutcome('session-opened'),
    captureReadyCount: countOutcome('capture-ready'),
  },
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
