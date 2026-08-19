'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const fs = require('fs');
const os = require('os');
const path = require('path');

const debug = require('./voice-standalone-debug');

function fakeApp() {
  const routes = [];
  return {
    routes,
    post(path, ...handlers) { routes.push({ method: 'post', path, handlers }); },
    get(path, ...handlers) { routes.push({ method: 'get', path, handlers }); },
  };
}

function response() {
  const res = new EventEmitter(); res.statusCode = 200; res.headersSent = false; res.writableEnded = false;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.payload = payload; res.headersSent = true; res.writableEnded = true; res.emit('finish'); return res; };
  res.end = () => { res.writableEnded = true; res.emit('finish'); };
  res.setHeader = () => {};
  return res;
}

test('1 exact sanitizer exports and deep bounded cyclic redaction', () => {
  for (const name of ['sanitizeStandaloneDebugValue', 'sanitizeStandaloneDebugText', 'sanitizeRequestPath', 'sanitizeRequestUrl']) assert.equal(typeof debug[name], 'function');
  const input = { token: 'TOKEN_SENTINEL', nested: { authorization: 'Bearer AUTH_SENTINEL', safe: 'ok' }, transcript: 'TRANSCRIPT_SENTINEL' };
  input.self = input;
  const out = debug.sanitizeStandaloneDebugValue(input);
  const serialized = JSON.stringify(out);
  for (const seed of ['TOKEN_SENTINEL', 'AUTH_SENTINEL', 'TRANSCRIPT_SENTINEL', 'Bearer']) assert.doesNotMatch(serialized, new RegExp(seed, 'i'));
  assert.match(serialized, /Circular/); assert.equal(out.nested.safe, 'ok');
  assert.ok(debug.sanitizeStandaloneDebugText('x'.repeat(9000)).length <= 512);
});

test('2 matched and fallback route paths redact literal encoded UTF-8 and nested IDs', () => {
  assert.equal(debug.sanitizeRequestPath('/voice/session/private-id', '/voice/session/:sessionId'), '/voice/session/:redacted');
  const cases = [
    ['/voice/session/plain-secret/turns/nested-secret', '/voice/session/:redacted/turns/:redacted'],
    ['/voice/reference/%2Fprivate/audio', '/voice/reference/:redacted/audio'],
    ['/voice/attempt/%3Fsecret/audio', '/voice/attempt/:redacted/audio'],
    ['/voice/milestone/%23secret', '/voice/milestone/:redacted'],
    ['/agents/%E7%A7%98%E5%AF%86/preferences', '/agents/:redacted/preferences'],
    ['/task/private-task/status', '/task/:redacted/status'],
  ];
  for (const [raw, expected] of cases) assert.equal(debug.sanitizeRequestPath(raw), expected);
});

test('3 sanitizeRequestUrl returns only exact path/query metadata with zero query bytes', () => {
  const cases = [
    ['?token=TOKEN_VALUE', 1], ['?authorization=AUTH_VALUE&sessionId=SESSION_VALUE', 2],
    ['?%74oken=ENCODED_VALUE', 1], ['?%E7%A7%98=%E5%AF%86', 1],
    ['?token=A&token=B', 2], ['?user[token]=NESTED&a[b][c]=DEEP', 2],
    ['?&&empty=&', 1], ['?hostile=/path#fragment', 1], ['?', 0],
  ];
  for (const [query, count] of cases) {
    const output = debug.sanitizeRequestUrl(`/voice/session/id${query}`);
    assert.deepEqual(Object.keys(output), ['path', 'queryPresent', 'queryParamCount']);
    assert.equal(output.path, '/voice/session/:redacted'); assert.equal(output.queryPresent, true); assert.equal(output.queryParamCount, count);
    const serialized = JSON.stringify(output);
    for (const forbidden of ['TOKEN_VALUE', 'AUTH_VALUE', 'SESSION_VALUE', 'ENCODED_VALUE', 'NESTED', 'DEEP', 'hostile']) {
      assert.doesNotMatch(serialized, new RegExp(forbidden, 'i'));
    }
  }
  assert.equal(debug.sanitizeRequestUrl('/voice/session/id?' + Array.from({ length: 40 }, (_, i) => `k${i}=v`).join('&')).queryParamCount, 32);
});

test('4 bus sanitizes before storage and logger mirroring', () => {
  const mirrored = []; const logger = { error: (value) => mirrored.push(value), warn: (value) => mirrored.push(value) };
  const bus = debug.createDebugBus({ capacity: 100, logger, now: () => 0 });
  bus.push('error', 'client', 'Bearer MESSAGE_SENTINEL', { prompt: 'PROMPT_SENTINEL', safe: 1 }, 'REQ_SENTINEL');
  const all = JSON.stringify({ events: bus.since(0), snapshot: bus.snapshot(), mirrored });
  for (const seed of ['MESSAGE_SENTINEL', 'PROMPT_SENTINEL', 'REQ_SENTINEL', 'Bearer']) assert.doesNotMatch(all, new RegExp(seed, 'i'));
  assert.match(all, /"safe":1/);
  bus.push('warn', 'bounded', 'bounded', { values: Array.from({ length: 40 }, () => 'x'.repeat(512)) });
  assert.ok(JSON.stringify(bus.since(0).at(-1)).length <= 8192);
});

test('5 real POST ingest then GET poll and logger contain no hostile client values', async () => {
  const app = fakeApp(); const mirrored = [];
  const bus = debug.createDebugBus({ logger: { error: (x) => mirrored.push(x), warn: (x) => mirrored.push(x) }, now: () => 0 });
  debug.attachDebugRoutes(app, bus, { healthProbe: async () => ({ status: 'ok' }), getRuntimeStats: () => ({ uptime_s: 7, memory_mb: 8, node: 'fake' }) });
  const post = app.routes.find((route) => route.method === 'post'); const get = app.routes.find((route) => route.path === '/voice/debug/events');
  const postRes = response();
  post.handlers[0]({ body: { level: 'warn', kind: 'KIND_SECRET', msg: 'Bearer POST_SECRET', data: { learnerMemo: 'MEMO_SECRET', safe: 'kept' }, reqId: 'ID_SECRET' }, headers: {} }, postRes);
  const getRes = response(); get.handlers[0]({ query: {} }, getRes);
  const captured = JSON.stringify({ post: postRes.payload, poll: getRes.payload, mirrored });
  for (const seed of ['KIND_SECRET', 'POST_SECRET', 'MEMO_SECRET', 'ID_SECRET', 'Bearer']) assert.doesNotMatch(captured, new RegExp(seed, 'i'));
  assert.doesNotMatch(captured, /kept/);
});

test('6 request middleware logs exact bounded URL schema and removes listeners', () => {
  const events = []; const bus = { push: (...args) => events.push(args) };
  const middleware = debug.requestLoggingMiddleware(bus, { mutePrefixes: [] });
  const req = { originalUrl: '/voice/session/private?token=QUERY_SECRET&user[token]=NESTED_SECRET', url: '', baseUrl: '', route: { path: '/voice/session/:sessionId' }, method: 'GET', headers: { origin: 'ORIGIN_SECRET', 'user-agent': 'UA_SECRET' } };
  const res = response(); middleware(req, res, () => {}); res.emit('finish');
  const captured = JSON.stringify(events); for (const seed of ['private', 'token', 'QUERY_SECRET', 'NESTED_SECRET', 'ORIGIN_SECRET', 'UA_SECRET']) assert.doesNotMatch(captured, new RegExp(seed, 'i'));
  assert.deepEqual(events[0][3], { method: 'GET', path: '/voice/session/:redacted', status: 200, ms: events[0][3].ms, queryPresent: true, queryParamCount: 2, hasOrigin: true, hasUserAgent: true });
  assert.equal(res.listenerCount('finish'), 0); assert.equal(res.listenerCount('close'), 0);
});

test('7 raw ingest caps at 65536 bytes and cleans every listener', () => {
  const app = fakeApp(); const bus = debug.createDebugBus({ logger: {}, now: () => 0 }); debug.attachDebugRoutes(app, bus, { getRuntimeStats: () => ({}) });
  const route = app.routes.find((entry) => entry.method === 'post'); const req = new EventEmitter(); req.headers = {}; req.destroy = () => { req.destroyed = true; }; const res = response();
  route.handlers[0](req, res); req.emit('data', Buffer.alloc(65537));
  assert.equal(res.statusCode, 413); assert.equal(req.destroyed, true); assert.equal(req.listenerCount('data'), 0); assert.equal(req.listenerCount('error'), 0); assert.equal(req.listenerCount('end'), 0);
});

test('8 health and websocket failures use generic metadata and fake runtime stats', async () => {
  const app = fakeApp(); const events = []; const bus = { push: (...args) => events.push(args), since: () => [], snapshot: () => ({ seq: 0 }) };
  debug.attachDebugRoutes(app, bus, { healthProbe: async () => { throw new Error('HEALTH_SECRET'); }, getRuntimeStats: () => ({ uptime_s: 1, memory_mb: 2, node: 'fake-node' }) });
  const health = app.routes.find((route) => route.path === '/voice/debug/health'); const healthRes = response(); await health.handlers[0]({}, healthRes);
  assert.deepEqual(healthRes.payload.upstream, { status: 'unavailable' }); assert.equal(healthRes.payload.node, 'fake-node'); assert.doesNotMatch(JSON.stringify(healthRes.payload), /HEALTH_SECRET/);
  const wss = new EventEmitter(); debug.attachWsLogging(wss, bus); const ws = new EventEmitter();
  wss.emit('connection', ws, { url: '/voice/session/private?token=WS_SECRET' }); ws.emit('error', new Error('UPSTREAM_SECRET'));
  const captured = JSON.stringify(events); for (const seed of ['private', 'token', 'WS_SECRET', 'UPSTREAM_SECRET']) assert.doesNotMatch(captured, new RegExp(seed, 'i'));
});

test('9 persistent sink writes one boot breadcrumb, failure JSONL, and turns stale health RED', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'voice-witness-'));
  const logPath = path.join(root, 'witness.jsonl');
  const statusPath = path.join(root, 'status.json');
  let now = 1000;
  const sink = debug.createPersistentWitnessSink({
    logPath,
    statusPath,
    now: () => now,
    maxStaleMs: 2000,
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl() {},
    logger: { error() {} },
  });
  sink.start();
  sink.record({
    iso: new Date(now).toISOString(),
    level: 'error',
    kind: 'client:client-runtime',
    msg: 'uncaught-error',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: { class: 'partial-function' },
  });
  sink.record({
    iso: new Date(now).toISOString(),
    level: 'info',
    kind: 'client:control',
    msg: 'control-effect',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: { class: 'ok', control: 'voice-hear-line', effect: 'speech-started' },
  });
  const rows = fs.readFileSync(logPath, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  assert.equal(fs.statSync(logPath).mode & 0o777, 0o600);
  assert.equal(fs.statSync(statusPath).mode & 0o777, 0o600);
  assert.equal(rows.length, 3);
  assert.equal(rows[0].code, 'telemetry_boot');
  assert.equal(rows[1].class, 'partial-function');
  assert.equal(rows[2].code, 'control-effect');
  assert.equal(rows[2].data.effect, 'speech-started');
  assert.equal(sink.health().state, 'ok');
  now += 2001;
  assert.equal(sink.health().state, 'red');
  assert.equal(sink.health().stale, true);
  sink.heartbeat();
  assert.equal(sink.health().state, 'ok');
  assert.equal(JSON.parse(fs.readFileSync(statusPath, 'utf8')).state, 'ok');
  sink.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('10 unwritable persistent sink is advisory but counted with an exact failure class', () => {
  const errors = [];
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  const sink = debug.createPersistentWitnessSink({
    logPath: '/denied/witness.jsonl',
    statusPath: '/denied/status.json',
    fsImpl: { mkdirSync() { throw denied; } },
    setIntervalImpl: () => ({ unref() {} }),
    clearIntervalImpl() {},
    logger: { error: (line) => errors.push(line) },
  });
  sink.start();
  sink.heartbeat();
  assert.equal(sink.health().state, 'degraded');
  assert.equal(sink.health().lastErrorClass, 'partial-function');
  assert.equal(sink.health().failCount, 2);
  assert.equal(errors.length, 1);
  sink.close();
});

test('11 valid client event preserves only safe categorical telemetry and correlation', () => {
  const app = fakeApp();
  const bus = debug.createDebugBus({ logger: {}, now: () => 1000 });
  debug.attachDebugRoutes(app, bus, { getRuntimeStats: () => ({}) });
  const post = app.routes.find((route) => route.method === 'post');
  const res = response();
  post.handlers[0]({
    body: {
      schema: 'transvoice.client_failure.v1',
      level: 'error',
      seam: 'client-runtime',
      class: 'partial-function',
      code: 'uncaught-error',
      phase: 'bundle-start',
      traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
      data: { line: 42, online: true, transcript: 'PRIVATE_VOICE_TEXT', arbitrary: 'DROP_ME' },
    },
    debugReqId: 'server-abcdef',
  }, res);
  assert.equal(res.statusCode, 200);
  const event = bus.since(0).at(-1);
  assert.equal(event.kind, 'client:client-runtime');
  assert.equal(event.msg, 'uncaught-error');
  assert.equal(event.traceId, '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8');
  assert.deepEqual(event.data, { class: 'partial-function', line: 42, online: true, phase: 'bundle-start' });
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE_VOICE_TEXT|DROP_ME|transcript/);
});

test('11b control activation traces are categorical and durable at info level', () => {
  const recorded = [];
  const app = fakeApp();
  const bus = debug.createDebugBus({
    logger: {},
    now: () => 1000,
    sink: { start() {}, record: (event) => recorded.push(event), health: () => ({ state: 'ok', stale: false }) },
  });
  debug.attachDebugRoutes(app, bus, { getRuntimeStats: () => ({}) });
  const post = app.routes.find((route) => route.method === 'post');
  const res = response();
  post.handlers[0]({
    body: {
      schema: 'transvoice.client_failure.v1',
      level: 'info',
      seam: 'control',
      class: 'ok',
      code: 'control-activated',
      phase: 'app-ready',
      traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
      data: { control: 'voice-coach-send', attempt: 3, status: 'received', prompt: 'DROP_ME' },
    },
    debugReqId: 'server-abcdef',
  }, res);
  assert.equal(res.statusCode, 200);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].kind, 'client:control');
  assert.deepEqual(recorded[0].data, {
    attempt: 3,
    class: 'ok',
    control: 'voice-coach-send',
    phase: 'app-ready',
    status: 'received',
  });
  assert.doesNotMatch(JSON.stringify(recorded), /DROP_ME|prompt/);
});

test('11c voice-only Coach controls and effects cross the closed telemetry contract', () => {
  const sessionEvent = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'control',
    class: 'ok',
    code: 'control-effect',
    phase: 'app-ready',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: {
      control: 'tv-coach-session-toggle',
      effect: 'listening-started',
      attempt: 1,
      status: 'succeeded',
    },
  });
  const presetEvent = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'control',
    class: 'ok',
    code: 'control-effect',
    phase: 'app-ready',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: {
      control: 'tv-coach-preset-button',
      effect: 'preset-selected',
      attempt: 2,
      status: 'succeeded',
    },
  });

  assert.deepEqual(sessionEvent.data, {
    attempt: 1,
    control: 'tv-coach-session-toggle',
    effect: 'listening-started',
    status: 'succeeded',
  });
  assert.deepEqual(presetEvent.data, {
    attempt: 2,
    control: 'tv-coach-preset-button',
    effect: 'preset-selected',
    status: 'succeeded',
  });
});

test('11d invalid Coach instruction length crosses as content-free contract drift, not a control failure', () => {
  const event = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'error',
    seam: 'practice-line-fallback',
    class: 'contract-drift',
    code: 'instruction-length-invalid',
    phase: 'app-ready',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: {
      status: 'failed',
      transcript: 'PRIVATE CONTENT MUST NOT CROSS',
    },
  });

  assert.equal(event.code, 'instruction-length-invalid');
  assert.equal(event.seam, 'practice-line-fallback');
  assert.equal(event.failureClass, 'contract-drift');
  assert.equal(event.phase, 'app-ready');
  assert.deepEqual(event.data, { status: 'failed' });
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE|transcript/);
});

test('12 malformed client contract is rejected and witnessed as contract-drift', () => {
  const app = fakeApp();
  const bus = debug.createDebugBus({ logger: {}, now: () => 1000 });
  debug.attachDebugRoutes(app, bus, { getRuntimeStats: () => ({}) });
  const post = app.routes.find((route) => route.method === 'post');
  const res = response();
  post.handlers[0]({ body: { schema: 'wrong', transcript: 'PRIVATE' }, debugReqId: 'server-abcdef' }, res);
  assert.equal(res.statusCode, 400);
  const event = bus.since(0).at(-1);
  assert.equal(event.kind, 'client-ingest');
  assert.equal(event.msg, 'client_event_rejected');
  assert.equal(event.data.class, 'contract-drift');
  assert.doesNotMatch(JSON.stringify(event), /PRIVATE|transcript/);
});

test('12b arbitrary categorical-looking private text cannot cross the closed client vocabulary', () => {
  const privateEvent = {
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'privatevoice',
    class: 'ok',
    code: 'myprivateconfession',
    phase: 'secretmedicaldetail',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: { control: 'deadname-goes-here', effect: 'more-private-text' },
  };
  assert.throws(() => debug.normalizeClientDebugEvent(privateEvent), /invalid client event contract/);

  const safeEvent = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'control',
    class: 'ok',
    code: 'control-effect',
    phase: 'app-ready',
    traceId: 'deadnamealice',
    data: {
      control: 'deadname-goes-here',
      effect: 'more-private-text',
      status: 'private-status',
      visibility: 'private-visibility',
      attempt: Number.MAX_SAFE_INTEGER,
      line: 2.5,
      col: -1,
    },
  });
  assert.deepEqual(safeEvent.data, {});
  assert.equal(safeEvent.traceId, null);
  assert.doesNotMatch(JSON.stringify(safeEvent), /deadname|private|medical|confession/i);
});

test('12c practice-line fallback repair crosses the closed client vocabulary', () => {
  const event = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'warn',
    seam: 'practice-line-fallback',
    class: 'fallback-masking',
    code: 'fallback-repaired',
    phase: 'app-ready',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: { effect: 'state-changed', phrase: 'DROP_ME' },
  });

  assert.equal(event.seam, 'practice-line-fallback');
  assert.equal(event.code, 'fallback-repaired');
  assert.deepEqual(event.data, { effect: 'state-changed' });
  assert.doesNotMatch(JSON.stringify(event), /DROP_ME|phrase/);
});

test('12d TTS synthesis and playback witnesses cross without audio or text content', () => {
  const synthesis = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'tts-synthesis',
    class: 'ok',
    code: 'target-text-generated',
    phase: 'app-ready',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: { status: 'succeeded', transcript: 'DROP_ME', audio: 'DROP_ME' },
  });
  const underrun = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'warn',
    seam: 'tts-playback',
    class: 'partial-function',
    code: 'pcm-underrun',
    phase: 'app-ready',
    data: { status: 'failed', targetText: 'DROP_ME' },
  });
  const completed = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'tts-playback',
    class: 'ok',
    code: 'pcm-playback-complete',
    phase: 'app-ready',
    data: {
      status: 'succeeded',
      sourceSampleRate: 48000,
      playbackSampleRate: 96000,
      queuedSamples: 960000,
      playedSamples: 960000,
      durationMs: 10000,
      underrunCount: 1,
      transcript: 'DROP_ME',
      audio: 'DROP_ME',
    },
  });

  assert.deepEqual(synthesis.data, { status: 'succeeded' });
  assert.deepEqual(underrun.data, { status: 'failed' });
  assert.deepEqual(completed.data, {
    durationMs: 10000,
    playbackSampleRate: 96000,
    playedSamples: 960000,
    queuedSamples: 960000,
    sourceSampleRate: 48000,
    status: 'succeeded',
    underrunCount: 1,
  });
  assert.doesNotMatch(JSON.stringify([synthesis, underrun, completed]), /DROP_ME|transcript|audio|targetText/);
});

test('12e live capture witnesses cross without microphone audio or transcript content', () => {
  const started = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'voice-input-capture',
    class: 'ok',
    code: 'worklet-capture-started',
    phase: 'app-ready',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
    data: { transcript: 'DROP_ME', audio: 'DROP_ME' },
  });
  const missing = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'warn',
    seam: 'voice-input-capture',
    class: 'partial-function',
    code: 'worklet-no-pcm',
    phase: 'app-ready',
    data: { transcript: 'DROP_ME', audio: 'DROP_ME' },
  });

  assert.deepEqual(started.data, {});
  assert.deepEqual(missing.data, {});
  assert.doesNotMatch(JSON.stringify([started, missing]), /DROP_ME|transcript|audio/);
});

test('12f stale listening yields cross the closed client vocabulary without content', () => {
  const event = debug.normalizeClientDebugEvent({
    schema: 'transvoice.client_failure.v1',
    level: 'info',
    seam: 'voice-input-handoff',
    class: 'ok',
    code: 'listening-yielded-to-coach-speech',
    phase: 'app-ready',
    data: { transcript: 'DROP_ME', audio: 'DROP_ME' },
  });

  assert.equal(event.seam, 'voice-input-handoff');
  assert.equal(event.code, 'listening-yielded-to-coach-speech');
  assert.deepEqual(event.data, {});
  assert.doesNotMatch(JSON.stringify(event), /DROP_ME|transcript|audio/);
});

test('13 client failure ingest is rate-limited with one bounded witness', () => {
  const app = fakeApp();
  const bus = debug.createDebugBus({ logger: {}, now: () => 1000 });
  debug.attachDebugRoutes(app, bus, {
    now: () => 1000,
    clientEventRateLimit: 10,
    getRuntimeStats: () => ({}),
  });
  const post = app.routes.find((route) => route.method === 'post');
  const body = {
    schema: 'transvoice.client_failure.v1',
    level: 'warn',
    seam: 'voice-api',
    class: 'not-connected',
    code: 'backend-network',
    traceId: '3a782ab1-ad2d-4ef6-9a4e-92f0e23814d8',
  };

  for (let index = 0; index < 10; index += 1) {
    const res = response();
    post.handlers[0]({ body, debugReqId: `server-${index}` }, res);
    assert.equal(res.statusCode, 200);
  }
  for (let index = 0; index < 2; index += 1) {
    const res = response();
    post.handlers[0]({ body, debugReqId: `limited-${index}` }, res);
    assert.equal(res.statusCode, 429);
  }

  const rateEvents = bus.since(0).filter((event) => event.msg === 'client_event_rate_limited');
  assert.equal(rateEvents.length, 1);
  assert.equal(rateEvents[0].kind, 'client-ingest');
  assert.deepEqual(rateEvents[0].data, { class: 'contract-drift' });
});
