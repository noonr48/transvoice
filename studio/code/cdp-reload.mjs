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
let loaded = null;
const loadedPromise = new Promise((resolve) => { loaded = resolve; });
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (message.method === 'Page.loadEventFired') loaded();
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

await call('Page.enable');
await call('Network.enable');
await call('Network.setCacheDisabled', { cacheDisabled: true });
await call('Page.reload', { ignoreCache: true });
await Promise.race([
  loadedPromise,
  new Promise((_, reject) => setTimeout(() => reject(new Error('WebView reload timed out.')), 15000)),
]);
const evaluation = await call('Runtime.evaluate', {
  expression: `(() => {
    const legacyHost = document.getElementById('app');
    const style = legacyHost ? getComputedStyle(legacyHost) : null;
    const box = legacyHost?.getBoundingClientRect();
    return {
      url: location.href,
      title: document.title,
      coachSurface: Boolean(document.getElementById('tv-coach-surface')),
      sessionToggle: Boolean(document.getElementById('tv-coach-session-toggle')),
      legacyRuntimeHostIsolated: Boolean(legacyHost
        && legacyHost.getAttribute('aria-hidden') === 'true'
        && style?.opacity === '0'
        && style?.pointerEvents === 'none'
        && (box?.width || 0) <= 1
        && (box?.height || 0) <= 1),
    };
  })()`,
  returnByValue: true,
});
await call('Network.setCacheDisabled', { cacheDisabled: false });
socket.close();

const result = evaluation.result.value;
console.log(JSON.stringify(result, null, 2));
if (!result.coachSurface || !result.sessionToggle || !result.legacyRuntimeHostIsolated) process.exitCode = 1;
