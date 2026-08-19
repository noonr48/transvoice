const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const gatewayUrl = process.env.TRANSVOICE_GATEWAY_URL || 'http://127.0.0.1:3021';
const exerciseStart = process.argv.includes('--exercise-start');

const targets = await fetch(`${cdpUrl}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('/app'));
if (!target) throw new Error('Voice Tutor WebView target not found.');

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

const probeExpression = String.raw`(() => {
  const box = (element) => {
    const rect = element?.getBoundingClientRect();
    return rect ? {
      left: Math.round(rect.left), top: Math.round(rect.top),
      right: Math.round(rect.right), bottom: Math.round(rect.bottom),
      width: Math.round(rect.width), height: Math.round(rect.height),
      centerY: Math.round(rect.top + rect.height / 2),
    } : null;
  };
  const visible = (element) => {
    const rect = element?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return false;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (node.hidden || style.display === 'none' || style.visibility === 'hidden'
        || Number(style.opacity) === 0) return false;
    }
    return true;
  };
  const surface = document.getElementById('tv-coach-surface');
  const canvas = document.getElementById('tv-coach-canvas');
  const line = document.getElementById('tv-coach-practice-line');
  const pronunciation = document.getElementById('tv-coach-pronunciation');
  const preset = document.getElementById('tv-coach-preset-button');
  const toggle = document.getElementById('tv-coach-session-toggle');
  const status = document.getElementById('tv-coach-status');
  const legacyHost = document.getElementById('app');
  const legacyStyle = legacyHost ? getComputedStyle(legacyHost) : null;
  const persistentControls = Array.from(document.querySelectorAll('[data-coach-persistent-control]'))
    .filter(visible).map((element) => element.id).sort();
  const visibleButtons = Array.from(document.querySelectorAll('button'))
    .filter(visible).map((element) => element.id || element.textContent.trim()).sort();
  const messageAffordances = Array.from(document.querySelectorAll(
    'textarea, input[type="text"], input:not([type]), [contenteditable="true"], #voice-coach-question, .voice-coach-bubble'
  )).filter(visible).map((element) => element.id || element.className || element.tagName);
  const surfaceBox = box(surface);
  const canvasBox = box(canvas);
  const lineBox = box(line);
  const pronunciationBox = box(pronunciation);
  const toggleBox = box(toggle);
  return {
    url: location.href,
    title: document.title,
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      width: document.documentElement.scrollWidth,
      height: document.documentElement.scrollHeight,
      scrollX, scrollY,
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      verticalOverflow: document.documentElement.scrollHeight > innerHeight + 2,
    },
    surface: {
      visible: visible(surface), box: surfaceBox,
      activity: surface?.dataset.activity || null,
      sessionState: surface?.dataset.sessionState || null,
      instructionState: surface?.dataset.instructionState || null,
      overflow: surface ? getComputedStyle(surface).overflow : null,
    },
    canvas: {
      box: canvasBox,
      scrollHeight: canvas?.scrollHeight || 0,
      clientHeight: canvas?.clientHeight || 0,
      containsLine: !visible(line) || Boolean(canvasBox && lineBox
        && lineBox.top >= canvasBox.top && lineBox.bottom <= canvasBox.bottom),
      containsPronunciation: !visible(pronunciation) || Boolean(canvasBox && pronunciationBox
        && pronunciationBox.top >= canvasBox.top && pronunciationBox.bottom <= canvasBox.bottom),
    },
    line: { text: line?.textContent?.trim() || '', visible: visible(line), box: lineBox },
    pronunciation: {
      text: pronunciation?.textContent?.trim() || '',
      visible: visible(pronunciation), box: pronunciationBox,
    },
    preset: {
      text: preset?.textContent?.trim() || '',
      visible: visible(preset), expanded: preset?.getAttribute('aria-expanded') || null,
    },
    toggle: {
      text: toggle?.textContent?.trim() || '', visible: visible(toggle), disabled: Boolean(toggle?.disabled),
      pressed: toggle?.getAttribute('aria-pressed') || null, box: toggleBox,
      targetCenterY: Math.round(innerHeight * 2 / 3),
    },
    status: {
      text: status?.textContent?.trim() || '',
      role: status?.getAttribute('role') || null,
      ariaLive: status?.getAttribute('aria-live') || null,
      kind: status?.dataset.kind || null,
      visible: visible(status),
    },
    persistentControls,
    visibleButtons,
    messageAffordances,
    legacyRuntimeHost: {
      ariaHidden: legacyHost?.getAttribute('aria-hidden') || null,
      opacity: legacyStyle?.opacity || null,
      pointerEvents: legacyStyle?.pointerEvents || null,
      box: box(legacyHost),
    },
    scriptAssets: Array.from(document.scripts).map((script) => script.src).filter(Boolean),
  };
})()`;

async function probe() {
  const result = await call('Runtime.evaluate', { expression: probeExpression, returnByValue: true });
  return result.result.value;
}

async function inputStatus() {
  return fetch(`${gatewayUrl}/voice/input/status`).then((response) => response.json());
}

async function waitFor(predicate, timeoutMs = 12000) {
  const deadline = Date.now() + timeoutMs;
  let latest = null;
  while (Date.now() < deadline) {
    latest = await probe();
    if (predicate(latest)) return latest;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Phone state timed out: ${JSON.stringify(latest?.toggle || null)}`);
}

async function clickToggle() {
  await call('Runtime.evaluate', {
    expression: "document.getElementById('tv-coach-session-toggle')?.click()",
    returnByValue: true,
  });
}

const before = await waitFor((value) => value.toggle.visible && !value.toggle.disabled);
const timeline = [{ phase: 'before', activity: before.surface.activity, label: before.toggle.text, status: before.status.text }];
let active = null;
let stopped = null;
let activeInput = null;
let stoppedInput = null;

if (exerciseStart) {
  if (before.toggle.text !== 'Start') throw new Error('Coach was already active; refusing to alter an in-progress lesson.');
  if (!before.preset.text || before.preset.text === 'Choose voice') {
    throw new Error('No tutor voice is selected; refusing to choose one implicitly.');
  }
  await clickToggle();
  const starting = await probe();
  timeline.push({ phase: 'starting', activity: starting.surface.activity, label: starting.toggle.text, status: starting.status.text });
  active = await waitFor((value) => (
    value.toggle.text === 'End'
    && value.toggle.pressed === 'true'
    && value.surface.sessionState === 'active'
    && value.surface.activity !== 'starting'
  ), 20000);
  activeInput = await inputStatus();
  timeline.push({ phase: 'active', activity: active.surface.activity, label: active.toggle.text, status: active.status.text });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  await clickToggle();
  stopped = await waitFor((value) => (
    value.toggle.text === 'Start'
    && value.toggle.pressed === 'false'
    && value.surface.sessionState === 'stopped'
    && value.surface.activity === 'stopped'
  ), 20000);
  for (let attempt = 0; attempt < 40; attempt += 1) {
    stoppedInput = await inputStatus();
    if ((stoppedInput.providers?.backend?.live?.activeConnections || 0) === 0) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  timeline.push({ phase: 'stopped', activity: stopped.surface.activity, label: stopped.toggle.text, status: stopped.status.text });
}

const failures = [];
if (!before.surface.visible) failures.push('Coach surface is not visible');
if (before.document.horizontalOverflow || before.document.verticalOverflow || before.document.scrollX || before.document.scrollY) {
  failures.push('Coach document scrolls or overflows');
}
if (before.surface.overflow !== 'hidden') failures.push(`Coach surface overflow is ${before.surface.overflow}`);
if (JSON.stringify(before.persistentControls) !== JSON.stringify(['tv-coach-preset-button', 'tv-coach-session-toggle'])) {
  failures.push(`persistent controls are ${before.persistentControls.join(', ')}`);
}
if (JSON.stringify(before.visibleButtons) !== JSON.stringify(['tv-coach-preset-button', 'tv-coach-session-toggle'])) {
  failures.push(`visible buttons are ${before.visibleButtons.join(', ')}`);
}
if (before.messageAffordances.length) failures.push(`visible messaging affordances: ${before.messageAffordances.join(', ')}`);
if (!before.canvas.containsLine || !before.canvas.containsPronunciation
  || before.canvas.scrollHeight > before.canvas.clientHeight + 1) failures.push('instruction canvas clips or scrolls');
if (!before.toggle.box || before.toggle.box.height < 44
  || Math.abs(before.toggle.box.centerY - before.toggle.targetCenterY) > 1) failures.push('Start/End control misses its thumb target');
if (before.legacyRuntimeHost.ariaHidden !== 'true' || before.legacyRuntimeHost.opacity !== '0'
  || before.legacyRuntimeHost.pointerEvents !== 'none'
  || before.legacyRuntimeHost.box?.width > 1 || before.legacyRuntimeHost.box?.height > 1) {
  failures.push('legacy runtime host is not fully isolated');
}
if (!before.scriptAssets.some((asset) => asset.includes('/assets/voice-runtime-'))) failures.push('hashed voice runtime asset is missing');
if (exerciseStart) {
  if (timeline[1]?.activity !== 'starting' || timeline[1]?.status !== 'Getting ready…') {
    failures.push('Starting activity update was not observable');
  }
  if (!['ready', 'hearing', 'thinking', 'speaking'].includes(active?.surface.activity)) {
    failures.push(`active activity is ${active?.surface.activity || 'missing'}`);
  }
  if (active?.status.kind !== 'neutral' || active?.status.role !== 'presentation' || active?.status.ariaLive !== 'off') {
    failures.push('routine activity status is announced as an alert');
  }
  if ((activeInput?.providers?.backend?.live?.activeConnections || 0) < 1) failures.push('phone did not open the live PCM socket');
  if (activeInput?.providers?.backend?.live?.detector?.state !== 'ready') failures.push('semantic endpoint detector is not ready');
  if ((stoppedInput?.providers?.backend?.live?.activeConnections || 0) !== 0) failures.push('End did not close the live PCM socket');
  if (stopped?.surface.activity !== 'stopped' || stopped?.status.text !== '') failures.push('stopped state leaves routine status copy visible');
}

console.log(JSON.stringify({
  gate: failures.length ? 'FAIL' : 'PASS',
  mode: exerciseStart ? 'exercise-start' : 'read-only',
  page: target.url,
  before,
  timeline,
  live: exerciseStart ? {
    activeConnections: activeInput?.providers?.backend?.live?.activeConnections ?? null,
    detector: activeInput?.providers?.backend?.live?.detector ?? null,
    stoppedConnections: stoppedInput?.providers?.backend?.live?.activeConnections ?? null,
  } : null,
  failures,
}, null, 2));
socket.close();
if (failures.length) process.exitCode = 1;
