import { readFileSync } from 'node:fs';

const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const gatewayUrl = process.env.TRANSVOICE_GATEWAY_URL || 'http://127.0.0.1:3021';
const witnessLog = process.env.TRANSVOICE_WITNESS_LOG
  || '/home/USER/.local/share/sloane/transvoice/witness.jsonl';
const readOnly = process.argv.includes('--read-only');

const targets = await fetch(`${cdpUrl}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('/app'));
if (!target) throw new Error('Voice Tutor WebView target not found');

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

const evaluation = await call('Runtime.evaluate', {
  expression: `(() => {
    const telemetry = window.__tvTelemetry;
    if (!telemetry || typeof telemetry.event !== 'function') return { installed:false };
    ${readOnly ? '' : "setTimeout(() => { throw new Error('VOICE_TELEMETRY_KILL_PROBE'); }, 0);"}
    return {
      installed:true,
      traceId:telemetry.traceId || null,
      diagnostics:(window.__SLOANE_BACKEND_ERRORS || []).slice(-20).map((entry) => ({
        id:entry.id, kind:entry.kind, operation:entry.operation,
        method:entry.method || null, status:entry.status || null,
        category:entry.attribution && entry.attribution.category || null,
        occurrences:entry.occurrenceCount || 1
      }))
    };
  })()`,
  returnByValue: true,
});
socket.close();

const browser = evaluation.result.value;
if (!browser?.installed || !browser.traceId) throw new Error('pre-bundle telemetry bridge is not installed');

if (readOnly) {
  const health = await fetch(`${gatewayUrl}/voice/debug/health`).then((response) => response.json());
  console.log(JSON.stringify({
    gate: health.telemetry?.status === 'ok' && !health.telemetry?.stale ? 'PASS' : 'FAIL',
    page: target.url,
    traceId: browser.traceId,
    diagnostics: browser.diagnostics,
    telemetry: health.telemetry,
  }, null, 2));
  process.exit(health.telemetry?.status === 'ok' && !health.telemetry?.stale ? 0 : 1);
}

let witnessed = null;
for (let attempt = 0; attempt < 20; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  const page = await fetch(`${gatewayUrl}/voice/debug/events?since=${baselineSeq}&limit=200`)
    .then((response) => response.json());
  witnessed = page.events?.find((event) => (
    event.traceId === browser.traceId
    && event.kind === 'client:client-runtime'
    && event.msg === 'uncaught-error'
    && event.data?.class === 'partial-function'
  ));
  if (witnessed) break;
}

if (!witnessed) throw new Error('global browser error did not cross the client→server seam');

const health = await fetch(`${gatewayUrl}/voice/debug/health`).then((response) => response.json());
if (health.telemetry?.status !== 'ok' || health.telemetry?.stale) {
  throw new Error(`telemetry health is not current: ${JSON.stringify(health.telemetry)}`);
}

const persisted = readFileSync(witnessLog, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map((line) => JSON.parse(line))
  .some((event) => event.traceId === browser.traceId && event.code === 'uncaught-error');
if (!persisted) throw new Error('browser failure reached memory bus but not persistent JSONL');

console.log(JSON.stringify({
  gate: 'PASS',
  page: target.url,
  traceId: browser.traceId,
  witness: {
    seq: witnessed.seq,
    seam: witnessed.kind,
    class: witnessed.data.class,
    code: witnessed.msg,
  },
  persistent: true,
  health: health.telemetry.status,
  diagnostics: browser.diagnostics,
}, null, 2));
