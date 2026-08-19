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

const evaluation = await call('Runtime.evaluate', {
  expression: String.raw`(() => {
    const visible = (element) => {
      if (!(element instanceof HTMLElement)) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
        const style = getComputedStyle(node);
        if (node.hidden || style.display === 'none' || style.visibility === 'hidden'
          || Number(style.opacity) === 0) return false;
      }
      return true;
    };
    const rgb = (value) => {
      const match = String(value).match(/rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i);
      return match ? match.slice(1, 4).map(Number) : null;
    };
    const luminance = (value) => {
      const channels = rgb(value);
      if (!channels) return null;
      const linear = channels.map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.03928
          ? normalized / 12.92
          : Math.pow((normalized + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    };
    const ratio = (foreground, background) => {
      const first = luminance(foreground);
      const second = luminance(background);
      if (first === null || second === null) return null;
      return Number(((Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)).toFixed(2));
    };
    const backgroundFor = (element) => {
      for (let node = element; node instanceof HTMLElement; node = node.parentElement) {
        const value = getComputedStyle(node).backgroundColor;
        if (value && !/^rgba?\(\s*0[,\s]+0[,\s]+0(?:[,\s]+0)?\s*\)$/i.test(value)
          && value !== 'transparent') return value;
      }
      return getComputedStyle(document.body).backgroundColor;
    };
    const probe = (selector) => {
      const element = document.querySelector(selector);
      if (!(element instanceof HTMLElement)) return { selector, missing: true };
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const foreground = style.color;
      const background = backgroundFor(element);
      return {
        selector,
        visible: visible(element),
        foreground,
        background,
        contrast: ratio(foreground, background),
        fontSize: Number.parseFloat(style.fontSize),
        fontWeight: Number.parseInt(style.fontWeight, 10) || 400,
        rect: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          top: Math.round(rect.top),
          bottom: Math.round(rect.bottom),
        },
      };
    };
    const root = document.getElementById('tv-coach-surface');
    const rootStyle = root ? getComputedStyle(root) : null;
    const visibleButtons = Array.from(document.querySelectorAll('button'))
      .filter(visible)
      .map((button) => button.id || button.textContent.trim());
    return {
      url: location.href,
      viewport: { width: innerWidth, height: innerHeight },
      document: {
        width: document.documentElement.scrollWidth,
        height: document.documentElement.scrollHeight,
        scrollX,
        scrollY,
      },
      surface: {
        visible: visible(root),
        overflow: rootStyle?.overflow || null,
        activity: root?.dataset.activity || null,
      },
      visibleButtons,
      controls: {
        presetExpanded: document.getElementById('tv-coach-preset-button')?.getAttribute('aria-expanded') || null,
        sessionPressed: document.getElementById('tv-coach-session-toggle')?.getAttribute('aria-pressed') || null,
      },
      probes: [
        probe('#tv-coach-preset-button'),
        probe('#tv-coach-session-toggle'),
        probe('#tv-coach-practice-line'),
        probe('#tv-coach-pronunciation'),
        probe('#tv-coach-status'),
      ],
    };
  })()`,
  returnByValue: true,
});
socket.close();

const report = evaluation.result.value;
const failures = [];
if (!report.surface.visible) failures.push('spoken Coach surface is not visible');
if (report.surface.overflow !== 'hidden') failures.push(`Coach surface overflow is ${report.surface.overflow}`);
if (report.viewport.width >= report.viewport.height) failures.push('phone is not portrait');
if (
  report.document.width > report.viewport.width
  || report.document.height > report.viewport.height + 2
  || report.document.scrollX !== 0
  || report.document.scrollY !== 0
) {
  failures.push('Coach document scrolls or overflows');
}
if (JSON.stringify(report.visibleButtons) !== JSON.stringify([
  'tv-coach-preset-button',
  'tv-coach-session-toggle',
])) {
  failures.push(`unexpected visible controls: ${report.visibleButtons.join(', ')}`);
}
for (const probe of report.probes.filter((candidate) => candidate.visible)) {
  if (!Number.isFinite(probe.contrast) || probe.contrast < 4.5) {
    failures.push(`${probe.selector} contrast is ${probe.contrast ?? 'unknown'}:1`);
  }
}
for (const selector of ['#tv-coach-preset-button', '#tv-coach-session-toggle']) {
  const probe = report.probes.find((candidate) => candidate.selector === selector);
  if (!probe?.visible || probe.rect.height < 44) {
    failures.push(`${selector} is not a 44 px visible touch target`);
  }
}
if (report.controls.presetExpanded !== 'false') failures.push('idle preset control is unexpectedly expanded');
if (report.controls.sessionPressed !== 'false') failures.push('idle Start control is unexpectedly pressed');

console.log(JSON.stringify({
  gate: failures.length ? 'FAIL' : 'PASS',
  ...report,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
