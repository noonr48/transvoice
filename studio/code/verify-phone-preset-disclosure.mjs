const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';

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

async function evaluate(expression) {
  const result = await call('Runtime.evaluate', { expression, returnByValue: true });
  if (result.exceptionDetails) {
    throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  }
  return result.result.value;
}

async function waitFor(expression, description) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const value = await evaluate(expression);
    if (value) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(description);
}

const before = await evaluate(`(() => ({
  sessionAction: document.getElementById('tv-coach-session-toggle')?.textContent?.trim() || '',
  preset: document.getElementById('tv-coach-preset-button')?.textContent?.trim() || '',
}))()`);
if (before.sessionAction !== 'Start') {
  throw new Error('Coach is active; refusing to alter an in-progress lesson.');
}

try {
  await evaluate(`document.getElementById('tv-coach-preset-button')?.click()`);
  await waitFor(
    `(() => {
      const menu = document.getElementById('tv-coach-preset-menu');
      const list = document.getElementById('tv-coach-preset-list');
      return Boolean(menu && !menu.hidden && list?.getAttribute('aria-busy') !== 'true');
    })()`,
    'Preset disclosure did not finish opening.',
  );
  const opened = await evaluate(`(() => {
    const menu = document.getElementById('tv-coach-preset-menu');
    const opener = document.getElementById('tv-coach-preset-button');
    const options = Array.from(document.querySelectorAll('[data-coach-preset-id]')).map((button) => ({
      idPresent: Boolean(button.dataset.coachPresetId),
      name: button.textContent?.trim() || '',
      pressed: button.getAttribute('aria-pressed'),
      minHeight: Number.parseFloat(getComputedStyle(button).minHeight),
    }));
    return {
      role: menu?.getAttribute('role') || null,
      label: menu?.getAttribute('aria-label') || null,
      expanded: opener?.getAttribute('aria-expanded') || null,
      controls: opener?.getAttribute('aria-controls') || null,
      focusInside: Boolean(menu?.contains(document.activeElement)),
      activeId: document.activeElement?.id || null,
      options,
      uploadText: document.getElementById('tv-coach-upload-open')?.textContent?.trim() || '',
      selectedCount: options.filter((option) => option.pressed === 'true').length,
      menuScrolls: Boolean(menu && menu.scrollHeight > menu.clientHeight + 1),
    };
  })()`);

  await evaluate(`document.getElementById('tv-coach-upload-open')?.click()`);
  const upload = await evaluate(`(() => {
    const form = document.getElementById('tv-coach-upload-form');
    const name = document.getElementById('tv-coach-upload-name');
    const file = document.getElementById('tv-coach-upload-file');
    return {
      visible: Boolean(form && !form.hidden),
      focusName: document.activeElement === name,
      nameRequired: name?.required === true,
      nameMaxLength: name?.maxLength || null,
      fileRequired: file?.required === true,
      fileAccept: file?.getAttribute('accept') || '',
      cancelText: document.getElementById('tv-coach-upload-cancel')?.textContent?.trim() || '',
      saveText: document.getElementById('tv-coach-upload-save')?.textContent?.trim() || '',
    };
  })()`);
  await evaluate(`document.getElementById('tv-coach-upload-cancel')?.click()`);
  const cancelled = await evaluate(`(() => ({
    menuOpen: !document.getElementById('tv-coach-preset-menu')?.hidden,
    formHidden: document.getElementById('tv-coach-upload-form')?.hidden === true,
    activeId: document.activeElement?.id || null,
  }))()`);
  await evaluate(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  const escaped = await evaluate(`(() => ({
    menuHidden: document.getElementById('tv-coach-preset-menu')?.hidden === true,
    expanded: document.getElementById('tv-coach-preset-button')?.getAttribute('aria-expanded') || null,
    activeId: document.activeElement?.id || null,
    selectedPreset: document.getElementById('tv-coach-preset-button')?.textContent?.trim() || '',
  }))()`);

  const failures = [];
  if (opened.role !== 'region' || opened.label !== 'Tutor voices') failures.push('preset disclosure lacks its labelled region');
  if (opened.expanded !== 'true' || opened.controls !== 'tv-coach-preset-menu') failures.push('preset opener state is not truthful');
  if (!opened.focusInside) failures.push('opening the preset disclosure did not move focus inside');
  if (!opened.options.length) failures.push('no named uploaded voice preset is available');
  if (opened.options.some((option) => !option.idPresent || !option.name || option.minHeight < 44)) {
    failures.push('a preset option lacks identity, name, or a 44 px touch target');
  }
  if (opened.selectedCount !== 1) failures.push(`expected one selected preset, got ${opened.selectedCount}`);
  if (opened.uploadText !== 'Upload new voice sample') failures.push('upload action does not describe a voice sample');
  if (!upload.visible || !upload.focusName || !upload.nameRequired || upload.nameMaxLength !== 160) {
    failures.push('voice naming form is not ready and focused');
  }
  if (!upload.fileRequired || !upload.fileAccept.includes('audio/*')) failures.push('voice sample input does not require audio');
  if (upload.cancelText !== 'Cancel' || upload.saveText !== 'Save voice') failures.push('upload actions are unclear');
  if (!cancelled.menuOpen || !cancelled.formHidden || cancelled.activeId !== 'tv-coach-upload-open') {
    failures.push('Cancel did not return focus inside the preset disclosure');
  }
  if (!escaped.menuHidden || escaped.expanded !== 'false' || escaped.activeId !== 'tv-coach-preset-button') {
    failures.push('Escape did not close the disclosure and restore focus');
  }
  if (escaped.selectedPreset !== before.preset) failures.push('read-only disclosure check changed the selected tutor voice');

  console.log(JSON.stringify({
    gate: failures.length ? 'FAIL' : 'PASS',
    page: target.url,
    before,
    opened,
    upload,
    cancelled,
    escaped,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await evaluate(`(() => {
    const menu = document.getElementById('tv-coach-preset-menu');
    if (menu && !menu.hidden) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    }
    return true;
  })()`).catch(() => null);
  socket.close();
}
