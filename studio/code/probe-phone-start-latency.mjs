const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const gatewayUrl = process.env.TRANSVOICE_GATEWAY_URL || 'http://127.0.0.1:3021';

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
const runtimeConsole = [];
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Runtime.consoleAPICalled') {
    const values = Array.isArray(message.params?.args)
      ? message.params.args.map((argument) => argument.value ?? argument.description ?? null)
      : [];
    runtimeConsole.push({
      type: message.params?.type || 'log',
      values,
    });
  }
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

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

await call('Runtime.enable');

async function state() {
  return evaluate(`(() => {
    const surface = document.getElementById('tv-coach-surface');
    const toggle = document.getElementById('tv-coach-session-toggle');
    const status = document.getElementById('tv-coach-status');
    return {
      activity: surface?.dataset.activity || null,
      sessionState: surface?.dataset.sessionState || null,
      toggle: toggle?.textContent?.trim() || '',
      disabled: Boolean(toggle?.disabled),
      status: status?.textContent?.trim() || '',
      actualAudio: window.__tvCoach?.isPlaying?.() === true,
    };
  })()`);
}

async function waitFor(predicate, timeoutMs, label, timeline, startedAt) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  let previousKey = '';
  while (Date.now() < deadline) {
    latest = await state();
    const key = JSON.stringify(latest);
    if (key !== previousKey) {
      previousKey = key;
      timeline.push({ elapsedMs: Date.now() - startedAt, ...latest });
    }
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`${label}: ${JSON.stringify(latest)}`);
}

const before = await state();
if (before.toggle !== 'Start' || before.disabled) {
  throw new Error(`Coach must be idle before the start probe: ${JSON.stringify(before)}`);
}

await evaluate(`(() => {
  const events = [];
  const startedAt = performance.now();
  const note = (phase, detail = null) => {
    events.push({
      elapsedMs: Math.round(performance.now() - startedAt),
      phase,
      detail,
    });
  };
  const originalFetch = window.fetch.bind(window);
  const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const OriginalWebSocket = window.WebSocket;
  const OriginalAudioContext = window.AudioContext;
  const OriginalWebkitAudioContext = window.webkitAudioContext;
  const scrub = (value) => {
    try {
      return new URL(typeof value === 'string' ? value : value?.url, location.href).pathname
        .replace(/\\/session\\/[^/]+/g, '/session/:id')
        .replace(/\\/reference\\/[^/]+/g, '/reference/:id');
    } catch {
      return 'unknown';
    }
  };

  window.fetch = async (...args) => {
    const path = scrub(args[0]);
    note('fetch:start', path);
    try {
      const response = await originalFetch(...args);
      note('fetch:end', { path, status: response.status });
      return response;
    } catch (error) {
      note('fetch:error', { path, name: error?.name || 'Error' });
      throw error;
    }
  };
  navigator.mediaDevices.getUserMedia = async (...args) => {
    note('gum:start');
    try {
      const stream = await originalGetUserMedia(...args);
      note('gum:end', {
        tracks: stream.getAudioTracks().length,
        state: stream.getAudioTracks()[0]?.readyState || null,
      });
      return stream;
    } catch (error) {
      note('gum:error', error?.name || 'Error');
      throw error;
    }
  };
  window.WebSocket = new Proxy(OriginalWebSocket, {
    construct(Target, args) {
      note('ws:construct', scrub(args[0]));
      const socket = new Target(...args);
      socket.addEventListener('open', () => note('ws:open'), { once: true });
      socket.addEventListener('message', (event) => {
        try {
          const payload = JSON.parse(String(event.data));
          note('ws:message', payload?.event || 'json');
        } catch {
          note('ws:message', 'binary');
        }
      });
      const originalSend = socket.send.bind(socket);
      socket.send = (data) => {
        if (!socket.__tvFirstSend) {
          socket.__tvFirstSend = true;
          note('ws:first-send', typeof data === 'string' ? 'json' : 'binary');
        }
        return originalSend(data);
      };
      return socket;
    },
  });

  const instrumentAudioContext = (Original) => Original ? new Proxy(Original, {
    construct(Target, args) {
      note('audio-context:construct');
      const context = new Target(...args);
      note('audio-context:ready', { state: context.state, sampleRate: context.sampleRate });
      const originalResume = context.resume.bind(context);
      context.resume = async () => {
        note('audio-context:resume-start');
        const result = await originalResume();
        note('audio-context:resume-end', context.state);
        return result;
      };
      if (context.audioWorklet?.addModule) {
        const originalAddModule = context.audioWorklet.addModule.bind(context.audioWorklet);
        context.audioWorklet.addModule = async (...moduleArgs) => {
          note('worklet:add-start');
          const result = await originalAddModule(...moduleArgs);
          note('worklet:add-end');
          return result;
        };
      }
      return context;
    },
  }) : Original;
  window.AudioContext = instrumentAudioContext(OriginalAudioContext);
  if (OriginalWebkitAudioContext) {
    window.webkitAudioContext = instrumentAudioContext(OriginalWebkitAudioContext);
  }

  window.__tvStartProbe = {
    events,
    note,
    restore() {
      window.fetch = originalFetch;
      navigator.mediaDevices.getUserMedia = originalGetUserMedia;
      window.WebSocket = OriginalWebSocket;
      window.AudioContext = OriginalAudioContext;
      if (OriginalWebkitAudioContext) window.webkitAudioContext = OriginalWebkitAudioContext;
    },
  };
  note('probe:ready');
})()`);

const performanceBaseline = await evaluate('performance.now()');
const startedAt = Date.now();
const timeline = [{ elapsedMs: 0, ...before }];
await evaluate("document.getElementById('tv-coach-session-toggle')?.click()");

let active = null;
let probeError = null;
try {
  active = await waitFor(
    (value) => value.toggle === 'End'
      && value.sessionState === 'active'
      && value.activity !== 'starting',
    30000,
    'Coach did not become active',
    timeline,
    startedAt,
  );
} catch (error) {
  probeError = error;
} finally {
  const latest = await state().catch(() => null);
  if (latest?.toggle === 'End') {
    await evaluate("document.getElementById('tv-coach-session-toggle')?.click()");
    await waitFor(
      (value) => value.toggle === 'Start' && value.sessionState === 'stopped',
      20000,
      'Coach did not stop after latency probe',
      timeline,
      startedAt,
    ).catch(() => null);
  }
}

const resources = await evaluate(`(() => {
  const scrub = (name) => {
    const path = new URL(name, location.href).pathname;
    return path
      .replace(/\\/session\\/[^/]+/g, '/session/:id')
      .replace(/\\/reference\\/[^/]+/g, '/reference/:id');
  };
  return performance.getEntriesByType('resource')
    .filter((entry) => entry.startTime >= ${Number(performanceBaseline)})
    .map((entry) => ({
      path: scrub(entry.name),
      initiator: entry.initiatorType,
      startMs: Math.round(entry.startTime - ${Number(performanceBaseline)}),
      durationMs: Math.round(entry.duration),
      responseEndMs: Math.round(entry.responseEnd - ${Number(performanceBaseline)}),
    }))
    .sort((left, right) => left.startMs - right.startMs);
})()`);
const clientEvents = await evaluate(`(() => {
  const events = window.__tvStartProbe?.events?.slice?.() || [];
  window.__tvStartProbe?.restore?.();
  delete window.__tvStartProbe;
  return events;
})()`);
const hiddenDiagnostics = probeError
  ? await evaluate(`(() => ({
      logs: Array.from(document.querySelectorAll('.voice-standalone-log-line'))
        .slice(-20)
        .map((node) => node.textContent?.trim() || '')
        .filter(Boolean),
      inputProvider: document.getElementById('voice-coach-input-provider-toggle')?.textContent?.trim() || null,
      speechProvider: document.getElementById('voice-coach-speech-provider-toggle')?.textContent?.trim() || null,
      continuousState: document.getElementById('voice-coach-continuous-toggle')?.textContent?.trim() || null,
      recognitionStatus: document.getElementById('voice-coach-question-status')?.textContent?.trim() || null,
    }))()`)
  : null;

const debug = await fetch(`${gatewayUrl}/voice/debug/events?since=${baselineSeq}&limit=500`)
  .then((response) => response.json());
const events = (debug.events || [])
  .filter((event) => (
    event.kind === 'voice-input-live'
    || event.kind === 'client:control'
    || event.kind === 'tts-synthesis'
  ))
  .map((event) => ({
    kind: event.kind,
    message: event.msg,
    outcome: event.data?.outcome || null,
    openToFirstPcmMs: event.data?.open_to_first_pcm_ms ?? null,
  }));
const inputStatus = await fetch(`${gatewayUrl}/voice/input/status`).then((response) => response.json());
socket.close();

console.log(JSON.stringify({
  gate: probeError ? 'FAIL' : 'PASS',
  page: target.url,
  startToReadyMs: active ? timeline.findLast((entry) => (
    entry.toggle === 'End' && entry.sessionState === 'active' && entry.activity !== 'starting'
  ))?.elapsedMs ?? null : null,
  timeline,
  clientEvents,
  resources,
  events,
  runtimeConsole: probeError
    ? runtimeConsole.filter((entry) => entry.values.some((value) => (
        typeof value === 'string' && value.includes('[voice-input-start]')
      )))
    : [],
  hiddenDiagnostics,
  liveAfterStop: {
    activeConnections: inputStatus.providers?.backend?.live?.activeConnections ?? null,
    detector: inputStatus.providers?.backend?.live?.detector ?? null,
  },
  error: probeError instanceof Error ? probeError.message : null,
}, null, 2));

if (probeError) process.exitCode = 1;
