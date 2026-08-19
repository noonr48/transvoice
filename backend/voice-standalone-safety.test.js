'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');

const { createSensitiveRouteGuard } = require('./route-access-control');
const { registerVoiceRuntimeEntrypoints } = require('./voice-runtime-entrypoints');
const runtimeModule = require('./voice-standalone-runtime');

function fakeApp() {
  const routes = [];
  const app = { routes };
  for (const method of ['get', 'post', 'put', 'delete', 'all', 'use']) {
    app[method] = (path, ...handlers) => {
      if (typeof path === 'function') { handlers.unshift(path); path = null; }
      routes.push({ method, path, handlers });
    };
  }
  app.listen = (_port, _host, callback) => { app.listenCalls = (app.listenCalls || 0) + 1; callback?.(); return app.server; };
  app.server = new EventEmitter();
  return app;
}

function response() {
  const res = new EventEmitter();
  res.statusCode = 200; res.headers = {}; res.headersSent = false; res.writableEnded = false;
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (payload) => { res.jsonCalls = (res.jsonCalls || 0) + 1; res.payload = payload; res.headersSent = true; res.writableEnded = true; res.emit('finish'); return res; };
  res.setHeader = (key, value) => { res.headers[key.toLowerCase()] = value; };
  res.end = (body) => { res.endCalls = (res.endCalls || 0) + 1; res.body = body; res.writableEnded = true; res.emit('finish'); };
  res.destroy = () => { res.destroyCalls = (res.destroyCalls || 0) + 1; res.destroyed = true; res.emit('close'); };
  return res;
}

async function dispatch(handlers, req, res) {
  let index = 0;
  const next = async () => {
    const handler = handlers[index++];
    if (!handler) return;
    let downstream = null;
    const result = handler(req, res, () => { downstream = next(); return downstream; });
    await result;
    if (downstream) await downstream;
  };
  await next();
}

function remoteReq(extra = {}) { return { headers: {}, socket: { remoteAddress: '203.0.113.5' }, ...extra }; }

function supportRuntime() {
  const noOp = async () => ({ success: true });
  return {
    appCompatibilityRouteHandlers: new Proxy({}, { get: () => noOp }),
    standaloneSessionRouteHandlers: new Proxy({}, { get: (target, key) => target[key] || noOp }),
    voiceSessionRouteHandlers: { getVoiceHealth: async () => ({ statusCode: 200, payload: {} }), getStandaloneReadiness: async () => ({ statusCode: 200, payload: {} }) },
    config: { defaultStudentId: 'student', evalPath: null, voiceTrainerUrl: 'http://trainer.invalid', voiceTrainerAuthToken: '' },
    sessions: new Map(), tasks: new Map(), practiceCards: {}, learnerContextService: {},
    getSessionTelemetryHistory: () => [], resolveLessonState: () => null,
  };
}

test('1 exports required Wave D seams', () => {
  for (const name of ['registerStandaloneSupportRoutes', 'authorizeVoiceTrainerUpgrade', 'createVoiceTrainerUpgradeHandler', 'attachVoiceTrainerWebSocketProxy', 'proxyHttpRequest', 'createVoiceStandaloneSessionStore']) {
    assert.equal(typeof runtimeModule[name], 'function', name);
  }
});

test('2 real dispatcher and real guard deny then authorize /voice/session/start', async () => {
  const app = fakeApp(); let calls = 0;
  const guard = createSensitiveRouteGuard({ adminToken: 'admin', allowLocalRequests: false });
  const noOp = async () => ({ success: true });
  registerVoiceRuntimeEntrypoints(app, {
    enableDeepTutorVoiceRoutes: false,
    voiceRouteMiddlewares: guard,
    learnerContextRouteHandlers: new Proxy({}, { get: () => noOp }),
    voiceSessionRouteHandlers: new Proxy({}, { get: () => noOp }),
    voiceOperationRouteHandlers: new Proxy({ startVoiceSession: async () => { calls += 1; return { success: true }; } }, { get: (target, key) => target[key] || noOp }),
  });
  const route = app.routes.find((entry) => entry.path === '/voice/session/start');
  const denied = response(); await dispatch(route.handlers, remoteReq({ body: {} }), denied);
  assert.equal(denied.statusCode, 403); assert.equal(calls, 0);
  const allowed = response(); await dispatch(route.handlers, remoteReq({ body: {}, headers: { 'x-sloane-admin-token': 'admin' } }), allowed);
  assert.equal(calls, 1);
});

test('3 support registrar puts the same guard before every non-health handler and crosses it', async () => {
  const app = fakeApp(); const guard = createSensitiveRouteGuard({ adminToken: 'admin', allowLocalRequests: false });
  const runtime = supportRuntime(); let calls = 0;
  runtime.standaloneSessionRouteHandlers.listSessions = () => { calls += 1; return { success: true }; };
  runtimeModule.registerStandaloneSupportRoutes(app, runtime, { sensitiveRouteGuard: guard });
  for (const route of app.routes.filter((entry) => entry.path !== '/health')) assert.equal(route.handlers[0], guard, route.path);
  const route = app.routes.find((entry) => entry.path === '/voice/standalone/sessions');
  await dispatch(route.handlers, remoteReq({ query: {} }), response()); assert.equal(calls, 0);
  await dispatch(route.handlers, remoteReq({ query: {}, headers: { 'x-sloane-admin-token': 'admin' } }), response()); assert.equal(calls, 1);
});

test('4 construction passes one guard identity to dispatcher, support and debug mount', () => {
  const app = fakeApp(); const guard = () => {};
  const seen = {};
  runtimeModule.createVoiceStandaloneApp({
    runtime: { config: { corsEnabled: false, requestJsonLimit: '1kb', host: 'x', port: 1, voiceTrainerUrl: 'x', voiceTutorGgufBaseUrl: 'x', voiceTutorGgufModel: 'x' } },
    appFactory: () => app, sensitiveRouteGuard: guard,
    createDebugBusImpl: () => ({ push() {} }), requestLoggingMiddlewareImpl: () => (_q, _s, n) => n(),
    registerVoiceRuntimeEntrypointsImpl: (_app, deps) => { seen.dispatcher = deps.voiceRouteMiddlewares; },
    registerStandaloneSupportRoutesImpl: (_app, _runtime, opts) => { seen.support = opts.sensitiveRouteGuard; },
    attachDebugRoutesImpl: (_app) => { _app.routes.push({ method: 'debug-attached', path: null, handlers: [] }); },
  });
  seen.debug = app.routes.find((entry) => entry.method === 'use' && entry.path === '/voice/debug').handlers[0];
  assert.equal(seen.dispatcher, guard); assert.equal(seen.support, guard); assert.equal(seen.debug, guard);
  assert.ok(app.routes.findIndex((entry) => entry.path === '/voice/debug') < app.routes.findIndex((entry) => entry.method === 'debug-attached'));
});

test('5 start calls fake listen and injected attachment once with exact guard and authorization closure', () => {
  const app = fakeApp(); const guard = createSensitiveRouteGuard({ adminToken: 'admin', allowLocalRequests: false }); let attachment;
  const standalone = runtimeModule.createVoiceStandaloneApp({
    runtime: { config: { corsEnabled: false, requestJsonLimit: '1kb', host: 'h', port: 2, voiceTrainerUrl: 't', voiceTutorGgufBaseUrl: 'g', voiceTutorGgufModel: 'm' } },
    appFactory: () => app, sensitiveRouteGuard: guard,
    createDebugBusImpl: () => ({ push() {} }), requestLoggingMiddlewareImpl: () => (_q, _s, n) => n(),
    registerVoiceRuntimeEntrypointsImpl: () => {}, registerStandaloneSupportRoutesImpl: () => {}, attachDebugRoutesImpl: () => {},
    attachVoiceTrainerWebSocketProxyImpl: (...args) => { attachment = args; },
  });
  const server = standalone.start({ logger: { log() {} } });
  assert.equal(app.listenCalls, 1); assert.equal(attachment[0], server); assert.equal(attachment[2].sensitiveRouteGuard, guard);
  assert.equal(attachment[2].authorizeUpgrade(remoteReq()).allowed, false);
  assert.equal(attachment[2].authorizeUpgrade(remoteReq({ headers: { 'x-sloane-admin-token': 'admin' } })).allowed, true);
});

test('6 real start attachment denies before constructors and authorizes once', () => {
  const app = fakeApp(); let handleCalls = 0; let ctorCalls = 0;
  class FakeWss { constructor() { FakeWss.calls = (FakeWss.calls || 0) + 1; } handleUpgrade(_r, _s, _h, callback) { handleCalls += 1; callback(new EventEmitter()); } }
  function FakeWs() { ctorCalls += 1; const ws = new EventEmitter(); ws.readyState = 0; ws.close = () => {}; ws.send = () => {}; return ws; }
  FakeWs.OPEN = 1; FakeWs.CONNECTING = 0;
  const standalone = runtimeModule.createVoiceStandaloneApp({
    runtime: { config: { corsEnabled: false, requestJsonLimit: '1kb', host: 'h', port: 2, voiceTrainerUrl: 'http://trainer.invalid', voiceTrainerAuthToken: '', voiceTutorGgufBaseUrl: 'g', voiceTutorGgufModel: 'm' } },
    appFactory: () => app, adminToken: 'admin',
    createDebugBusImpl: () => ({ push() {} }), requestLoggingMiddlewareImpl: () => (_q, _s, n) => n(),
    registerVoiceRuntimeEntrypointsImpl: () => {}, registerStandaloneSupportRoutesImpl: () => {}, attachDebugRoutesImpl: () => {},
  });
  standalone.start({ logger: { log() {}, warn() {} }, WebSocketServerCtor: FakeWss, WebSocketCtor: FakeWs });
  const socket = { destroyed: false, writes: 0, destroys: 0, write() { this.writes += 1; }, destroy() { this.destroyed = true; this.destroys += 1; } };
  app.server.emit('upgrade', remoteReq({ url: '/voice-trainer/ws' }), socket, Buffer.alloc(0));
  assert.equal(socket.writes, 1); assert.equal(socket.destroys, 1); assert.equal(handleCalls, 0); assert.equal(ctorCalls, 0);
  app.server.emit('upgrade', remoteReq({ url: '/voice-trainer/ws', headers: { 'x-sloane-admin-token': 'admin' } }), { destroyed: false, write() {}, destroy() {} }, Buffer.alloc(0));
  assert.equal(handleCalls, 1); assert.equal(ctorCalls, 1); assert.equal(FakeWss.calls, 1);
  const secondDenied = { destroyed: false, writes: 0, destroys: 0, write() { this.writes += 1; }, destroy() { this.destroyed = true; this.destroys += 1; } };
  app.server.emit('upgrade', remoteReq({ url: '/voice-trainer/ws' }), secondDenied, Buffer.alloc(0));
  app.server.emit('upgrade', remoteReq({ url: '/voice-trainer/ws', headers: { 'x-sloane-admin-token': 'admin' } }), { destroyed: false, write() {}, destroy() {} }, Buffer.alloc(0));
  assert.equal(secondDenied.destroys, 1); assert.equal(handleCalls, 2); assert.equal(ctorCalls, 2);
});

test('7 session store uses 0700 directory and 0600 temp/final atomic write', () => {
  const calls = [];
  const fsImpl = { mkdirSync: (...a) => calls.push(['mkdir', ...a]), chmodSync: (...a) => calls.push(['chmod', ...a]), writeFileSync: (...a) => calls.push(['write', ...a]), renameSync: (...a) => calls.push(['rename', ...a]), unlinkSync: (...a) => calls.push(['unlink', ...a]) };
  runtimeModule.createVoiceStandaloneSessionStore({ storePath: '/private/store/sessions.json', fsImpl, logger: false }).saveSessions(new Map());
  assert.ok(calls.some((c) => c[0] === 'mkdir' && c[2].mode === 0o700));
  assert.ok(calls.some((c) => c[0] === 'write' && c[3].mode === 0o600));
  assert.ok(calls.some((c) => c[0] === 'rename'));
  assert.ok(calls.some((c) => c[0] === 'chmod' && c[1].endsWith('sessions.json') && c[2] === 0o600));
  const failedCalls = [];
  const failedFs = { mkdirSync() {}, chmodSync() {}, writeFileSync() {}, renameSync() { throw new Error('rename failed'); }, unlinkSync: (...args) => failedCalls.push(args) };
  assert.throws(() => runtimeModule.createVoiceStandaloneSessionStore({ storePath: '/private/store/sessions.json', fsImpl: failedFs, logger: false }).saveSessions(new Map()), /rename failed/);
  assert.equal(failedCalls.length, 1); assert.match(failedCalls[0][0], /\.tmp$/);
  const loadCalls = [];
  const existingFs = {
    mkdirSync: (...args) => loadCalls.push(['mkdir', ...args]),
    chmodSync: (...args) => loadCalls.push(['chmod', ...args]),
    readFileSync: (...args) => { loadCalls.push(['read', ...args]); return JSON.stringify({ schemaVersion: 'voice-standalone-sessions-v1', sessions: [] }); },
  };
  runtimeModule.createVoiceStandaloneSessionStore({ storePath: '/private/store/sessions.json', fsImpl: existingFs, logger: false }).loadSessions();
  assert.deepEqual(loadCalls.slice(0, 4), [
    ['mkdir', '/private/store', { recursive: true, mode: 0o700 }],
    ['chmod', '/private/store', 0o700],
    ['chmod', '/private/store/sessions.json', 0o600],
    ['read', '/private/store/sessions.json', 'utf8'],
  ]);
  const missingFs = { mkdirSync() {}, chmodSync(target) { if (target.endsWith('sessions.json')) { const error = new Error('missing'); error.code = 'ENOENT'; throw error; } }, readFileSync() { throw new Error('must not read'); } };
  assert.equal(runtimeModule.createVoiceStandaloneSessionStore({ storePath: '/private/store/sessions.json', fsImpl: missingFs, logger: false }).loadSessions().size, 0);
});

function proxyClient() {
  const state = {};
  return { state, request(options, callback) { state.options = options; state.callback = callback; const req = new EventEmitter(); req.end = (body) => { state.ends = (state.ends || 0) + 1; state.body = body; }; req.write = (chunk) => { state.raw = Buffer.concat([state.raw || Buffer.alloc(0), Buffer.from(chunk)]); }; req.destroy = () => { state.destroys = (state.destroys || 0) + 1; }; req.setTimeout = (_ms, cb) => { state.timeout = cb; }; state.request = req; return req; } };
}

test('8 parsed/raw/bodyless proxy, timeout, abort and cleanup use only fakes', () => {
  const parsedClient = proxyClient(); const parsedReq = new EventEmitter(); parsedReq.method = 'POST'; parsedReq.headers = { 'content-length': '999', 'content-type': 'application/x-www-form-urlencoded', 'content-encoding': 'gzip', connection: 'x-hop', 'x-hop': 'remove' }; parsedReq.body = { a: 1 };
  runtimeModule.proxyHttpRequest(parsedReq, response(), 'http://trainer.invalid/x', { httpClient: parsedClient });
  assert.equal(parsedClient.state.ends, 1); assert.equal(parsedClient.state.body.toString(), '{"a":1}'); assert.equal(parsedClient.state.options.headers['content-length'], '7');
  assert.equal(parsedClient.state.options.headers['x-hop'], undefined);
  assert.equal(parsedClient.state.options.headers['content-type'], 'application/json'); assert.equal(parsedClient.state.options.headers['content-encoding'], undefined);
  const rawClient = proxyClient(); const rawReq = new EventEmitter(); rawReq.method = 'POST'; rawReq.headers = {}; rawReq.readable = true; rawReq.readableEnded = false; rawReq.pipe = (dest) => { rawReq.pipeCalls = (rawReq.pipeCalls || 0) + 1; dest.write(Buffer.from('raw')); return dest; };
  runtimeModule.proxyHttpRequest(rawReq, response(), 'http://trainer.invalid/raw', { httpClient: rawClient }); assert.equal(rawReq.pipeCalls, 1); assert.equal(rawClient.state.raw.toString(), 'raw');
  const bodylessClient = proxyClient(); const bodyless = new EventEmitter(); bodyless.method = 'GET'; bodyless.headers = {}; bodyless.readable = false;
  const bodylessRes = response(); runtimeModule.proxyHttpRequest(bodyless, bodylessRes, 'http://trainer.invalid/get', { httpClient: bodylessClient }); assert.equal(bodylessClient.state.ends, 1);
  const upstream = new EventEmitter(); upstream.statusCode = 201; upstream.headers = { connection: 'x-private', 'x-private': 'remove', 'content-type': 'text/plain' }; upstream.pipe = (dest) => dest.end('response'); upstream.destroy = () => {};
  bodylessClient.state.callback(upstream);
  assert.equal(bodylessRes.statusCode, 201); assert.equal(bodylessRes.headers['x-private'], undefined); assert.equal(bodylessRes.headers['content-type'], 'text/plain'); assert.equal(bodylessRes.body, 'response');
  assert.equal(bodyless.listenerCount('aborted'), 0); assert.equal(bodylessRes.listenerCount('close'), 0); assert.equal(upstream.listenerCount('error'), 0);
  const timeoutClient = proxyClient(); const timeoutReq = new EventEmitter(); timeoutReq.method = 'GET'; timeoutReq.headers = {}; timeoutReq.readable = false; const timeoutRes = response();
  runtimeModule.proxyHttpRequest(timeoutReq, timeoutRes, 'http://trainer.invalid/t', { httpClient: timeoutClient, timeoutMs: 1 }); timeoutClient.state.timeout(); assert.equal(timeoutRes.statusCode, 504); assert.equal(timeoutClient.state.destroys, 1);
  const abortClient = proxyClient(); const abortReq = new EventEmitter(); abortReq.method = 'GET'; abortReq.headers = {}; abortReq.readable = false; const abortRes = response();
  runtimeModule.proxyHttpRequest(abortReq, abortRes, 'http://trainer.invalid/a', { httpClient: abortClient }); abortReq.emit('aborted'); assert.equal(abortClient.state.destroys, 1); assert.equal(abortReq.listenerCount('aborted'), 0); assert.equal(abortRes.listenerCount('close'), 0);
  const upstreamAbortClient = proxyClient(); const upstreamAbortReq = new EventEmitter(); upstreamAbortReq.method = 'GET'; upstreamAbortReq.headers = {}; upstreamAbortReq.readable = false; upstreamAbortReq.destroy = () => { upstreamAbortReq.destroyCalls = (upstreamAbortReq.destroyCalls || 0) + 1; upstreamAbortReq.destroyed = true; }; const upstreamAbortRes = response();
  runtimeModule.proxyHttpRequest(upstreamAbortReq, upstreamAbortRes, 'http://trainer.invalid/u', { httpClient: upstreamAbortClient });
  const abortedUpstream = new EventEmitter(); abortedUpstream.statusCode = 200; abortedUpstream.headers = {}; abortedUpstream.pipe = () => {}; abortedUpstream.destroy = () => { abortedUpstream.destroyCalls = (abortedUpstream.destroyCalls || 0) + 1; abortedUpstream.destroyed = true; };
  upstreamAbortClient.state.callback(abortedUpstream); abortedUpstream.emit('aborted');
  assert.equal(abortedUpstream.destroyCalls, 1); assert.equal(upstreamAbortReq.destroyCalls, 1); assert.equal(upstreamAbortRes.destroyCalls, 1); assert.equal(abortedUpstream.listenerCount('aborted'), 0); assert.equal(upstreamAbortRes.listenerCount('close'), 0);
  const requestErrorClient = proxyClient(); const requestErrorReq = new EventEmitter(); requestErrorReq.method = 'GET'; requestErrorReq.headers = {}; requestErrorReq.readable = false; requestErrorReq.unpipe = () => { requestErrorReq.unpipeCalls = (requestErrorReq.unpipeCalls || 0) + 1; }; const requestErrorRes = response();
  runtimeModule.proxyHttpRequest(requestErrorReq, requestErrorRes, 'http://trainer.invalid/request-error', { httpClient: requestErrorClient });
  const requestErrorUpstream = new EventEmitter(); requestErrorUpstream.statusCode = 200; requestErrorUpstream.headers = {}; requestErrorUpstream.pipe = () => {}; requestErrorUpstream.unpipe = () => { requestErrorUpstream.unpipeCalls = (requestErrorUpstream.unpipeCalls || 0) + 1; }; requestErrorUpstream.destroy = () => { requestErrorUpstream.destroyCalls = (requestErrorUpstream.destroyCalls || 0) + 1; };
  requestErrorClient.state.callback(requestErrorUpstream); const savedRequestError = requestErrorClient.state.request.listeners('error')[0]; requestErrorClient.state.request.emit('error', new Error('REQUEST_SECRET'));
  assert.equal(requestErrorClient.state.destroys, 1); assert.equal(requestErrorUpstream.destroyCalls, 1); assert.equal(requestErrorUpstream.unpipeCalls, 1); assert.equal(requestErrorReq.unpipeCalls, 1); assert.equal(requestErrorRes.statusCode, 502); assert.equal(requestErrorRes.jsonCalls, 1); assert.equal(requestErrorRes.payload.error, 'VoiceTrainer proxy failed.'); assert.equal(requestErrorClient.state.timeout, undefined); assert.equal(requestErrorClient.state.request.listenerCount('error'), 0); assert.equal(requestErrorUpstream.listenerCount('error'), 0); assert.equal(requestErrorRes.listenerCount('close'), 0);
  savedRequestError(new Error('LATE_REQUEST_SECRET')); assert.equal(requestErrorRes.jsonCalls, 1); assert.equal(requestErrorClient.state.destroys, 1);
  const lateUpstream = { destroyCalls: 0, destroy() { this.destroyCalls += 1; } }; requestErrorClient.state.callback(lateUpstream); assert.equal(lateUpstream.destroyCalls, 1); assert.equal(requestErrorRes.jsonCalls, 1);
  const responseErrorClient = proxyClient(); const responseErrorReq = new EventEmitter(); responseErrorReq.method = 'GET'; responseErrorReq.headers = {}; responseErrorReq.readable = false; responseErrorReq.unpipe = () => { responseErrorReq.unpipeCalls = (responseErrorReq.unpipeCalls || 0) + 1; }; const responseErrorRes = response();
  runtimeModule.proxyHttpRequest(responseErrorReq, responseErrorRes, 'http://trainer.invalid/response-error', { httpClient: responseErrorClient });
  const failedUpstream = new EventEmitter(); failedUpstream.statusCode = 200; failedUpstream.headers = {}; failedUpstream.pipe = () => {}; failedUpstream.unpipe = () => { failedUpstream.unpipeCalls = (failedUpstream.unpipeCalls || 0) + 1; }; failedUpstream.destroy = () => { failedUpstream.destroyCalls = (failedUpstream.destroyCalls || 0) + 1; };
  responseErrorClient.state.callback(failedUpstream); const savedResponseError = failedUpstream.listeners('error')[0]; responseErrorRes.headersSent = true; failedUpstream.emit('error', new Error('RESPONSE_SECRET'));
  assert.equal(responseErrorClient.state.destroys, 1); assert.equal(failedUpstream.destroyCalls, 1); assert.equal(failedUpstream.unpipeCalls, 1); assert.equal(responseErrorReq.unpipeCalls, 1); assert.equal(responseErrorRes.jsonCalls || 0, 0); assert.equal(responseErrorRes.endCalls, 1); assert.equal(responseErrorClient.state.timeout, undefined); assert.equal(failedUpstream.listenerCount('error'), 0); assert.equal(responseErrorRes.listenerCount('close'), 0);
  savedResponseError(new Error('LATE_RESPONSE_SECRET')); assert.equal(responseErrorRes.endCalls, 1); assert.equal(failedUpstream.destroyCalls, 1);
});
