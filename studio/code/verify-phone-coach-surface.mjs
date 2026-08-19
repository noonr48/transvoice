const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const reload = process.argv.includes('--reload');
const startedAt = Date.now();

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

if (reload) {
  await call('Page.enable');
  await call('Page.reload', { ignoreCache: true });
}

let ready = false;
for (let attempt = 0; attempt < 80; attempt += 1) {
  const probe = await call('Runtime.evaluate', {
    expression: `Boolean(
      document.readyState === 'complete'
      && document.getElementById('tv-coach-session-toggle')
      && window.__tvCoach
    )`,
    returnByValue: true,
  }).catch(() => null);
  if (probe?.result?.value === true) {
    ready = true;
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) throw new Error('Coach page did not become ready after reload.');

if (reload) {
  // App bootstrap attaches the bridge before the persisted named preset has
  // finished hydrating. Wait read-only for that stable surface, but let the
  // final gate report a missing preset instead of mutating one into place.
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const settled = await call('Runtime.evaluate', {
      expression: `(() => {
        const toggle = document.getElementById('tv-coach-session-toggle');
        const preset = document.getElementById('tv-coach-preset-button')?.textContent?.trim();
        return Boolean(toggle && !toggle.disabled && preset && preset !== 'Choose voice');
      })()`,
      returnByValue: true,
    }).catch(() => null);
    if (settled?.result?.value === true) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const evaluation = await call('Runtime.evaluate', {
  expression: `(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none'
        && style.visibility !== 'hidden'
        && Number(style.opacity) > 0
        && rect.width > 0
        && rect.height > 0;
    };
    const buttons = Array.from(document.querySelectorAll('button'))
      .filter(visible)
      .map((button) => {
        const rect = button.getBoundingClientRect();
        return {
          id: button.id,
          text: button.textContent.trim().replace(/\\s+/g, ' '),
          disabled: button.disabled,
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        };
      });
    const messageAffordances = Array.from(document.querySelectorAll(
      'textarea, input:not([type="file"]), [contenteditable="true"]',
    )).filter(visible).map((element) => element.id || element.tagName);
    const toggle = document.getElementById('tv-coach-session-toggle');
    const toggleRect = toggle?.getBoundingClientRect();
    const referencePlayer = document.getElementById('voice-reference-player');
    const scriptSources = Array.from(document.scripts)
      .map((script) => script.src)
      .filter(Boolean);
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        scrollX,
        scrollY,
      },
      buttons,
      messageAffordances,
      activity: document.getElementById('tv-coach-surface')?.dataset.activity || null,
      toggleCenterY: toggleRect ? Math.round(toggleRect.top + toggleRect.height / 2) : null,
      preset: document.getElementById('tv-coach-preset-button')?.textContent?.trim() || null,
      referencePlayerSource: referencePlayer?.getAttribute('src') || null,
      scriptSources,
      diagnostics: (window.__SLOANE_BACKEND_ERRORS || []).slice(-20).map((entry) => ({
        kind: entry.kind,
        operation: entry.operation,
        status: entry.status || null,
        category: entry.attribution?.category || null,
      })),
    };
  })()`,
  returnByValue: true,
});
socket.close();

const result = evaluation.result.value;
result.settledAfterMs = Date.now() - startedAt;
const failures = [];
if (result.viewport.width >= result.viewport.height) failures.push('phone is not portrait');
if (result.document.width > result.viewport.width) failures.push('horizontal document overflow');
if (result.document.height > result.viewport.height + 2) failures.push('vertical document overflow');
if (result.document.scrollX !== 0 || result.document.scrollY !== 0) failures.push('document is scrolled');
if (result.buttons.length !== 2) failures.push(`expected exactly two visible buttons, got ${result.buttons.length}`);
if (!result.buttons.some((button) => button.id === 'tv-coach-preset-button')) failures.push('preset control missing');
if (!result.buttons.some((button) => button.id === 'tv-coach-session-toggle' && button.text === 'Start')) {
  failures.push('learner-owned Start control is not idle and visible');
}
if (result.buttons.some((button) => button.id === 'tv-coach-session-toggle' && button.disabled)) {
  failures.push('Start is disabled');
}
if (!result.preset || result.preset === 'Choose voice') failures.push('no named tutor preset is selected');
if (result.messageAffordances.length) failures.push('visible text/message affordance exists');
if (result.activity !== 'stopped') failures.push(`expected stopped activity, got ${result.activity}`);
const targetCenter = result.viewport.height * (2 / 3);
if (!Number.isFinite(result.toggleCenterY) || Math.abs(result.toggleCenterY - targetCenter) > 3) {
  failures.push(`Start center is not at 2/3 viewport: ${result.toggleCenterY}`);
}
if (result.referencePlayerSource !== null) failures.push('Coach page attached the preset recording to an audio player');
if (!result.scriptSources.some((source) => /\/assets\/voice-runtime-[A-Za-z0-9_-]+\.js$/.test(source))) {
  failures.push('hashed production runtime bundle missing');
}
if (result.diagnostics.length) failures.push(`page has ${result.diagnostics.length} runtime diagnostic(s)`);

console.log(JSON.stringify({
  gate: failures.length ? 'FAIL' : 'PASS',
  mode: reload ? 'read-only-reload' : 'read-only',
  ...result,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
