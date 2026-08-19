'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const path = require('node:path');

const serverPath = path.resolve(__dirname, '..', 'server.js');
let timerCalls = 0;
const timerNames = ['setTimeout', 'setInterval', 'setImmediate'];
const originals = Object.fromEntries(timerNames.map((name) => [name, global[name]]));
const envBefore = { ...process.env };
const listenersBefore = new Map(process.eventNames().map((name) => [name, process.listeners(name)]));
process.env.VOICE_STUDIO_URL = 'https://IMPORT-SNAPSHOT-SENTINEL.invalid/';
try {
  for (const name of timerNames) global[name] = function forbiddenImportTimer() { timerCalls += 1; throw new Error('timer during import'); };
  delete require.cache[serverPath];
  require(serverPath);
} finally {
  for (const name of timerNames) global[name] = originals[name];
  if (envBefore.VOICE_STUDIO_URL === undefined) delete process.env.VOICE_STUDIO_URL;
  else process.env.VOICE_STUDIO_URL = envBefore.VOICE_STUDIO_URL;
}
const api = require(serverPath);
const importEnvAfter = { ...process.env };
const importEventNamesAfter = process.eventNames();
const importListenersAfter = new Map(importEventNamesAfter.map((name) => [name, process.listeners(name)]));

test('1. importing server is environment/listener/timer side-effect free', () => {
  assert.equal(timerCalls, 0);
  assert.deepEqual(importEnvAfter, envBefore);
  assert.deepEqual(importEventNamesAfter, [...listenersBefore.keys()]);
  for (const [name, listeners] of listenersBefore) assert.deepEqual(importListenersAfter.get(name), listeners);
  assert.equal(JSON.stringify(api).includes('IMPORT-SNAPSHOT-SENTINEL'), false);
  assert.equal(Object.keys(api).includes('createVoiceStudioToggleSnippet'), false);
});

function fakeApp() {
  const routes = [];
  const app = { routes };
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all', 'use']) {
    app[method] = (route, ...handlers) => { routes.push({ method, route, handlers }); return app; };
  }
  app.dispatch = async (method, route, req, res) => {
    const entry = routes.find((item) => item.method === method && item.route === route);
    assert.ok(entry, `${method} ${route} registered`);
    let index = 0;
    const next = async (error) => {
      if (error) throw error;
      const handler = entry.handlers[index++];
      if (handler) return handler(req, res, next);
    };
    return next();
  };
  return app;
}

function fakeResponse() {
  return {
    statusCode: 200, headers: {}, body: undefined, writableEnded: false, destroyed: false,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    json(value) { this.body = value; this.writableEnded = true; return this; },
    send(value) { this.body = value; this.writableEnded = true; return this; },
    write(value) { this.body = Buffer.concat([Buffer.isBuffer(this.body) ? this.body : Buffer.alloc(0), Buffer.from(value)]); },
    end() { this.writableEnded = true; },
  };
}

function debugSpy() {
  const calls = [];
  return {
    calls,
    log(...args) { calls.push(args); },
    getEvents() { return []; }, getSummary() { return {}; }, clearEvents() {},
    tailLines() { return ['tail']; }, grepLines() { return ['grep']; },
  };
}

function registrarOptions(overrides = {}) {
  return {
    env: {}, debugImpl: debugSpy(), fetchImpl: async () => { throw new Error('unused fetch'); },
    uploadMiddleware(_req, _res, next) { next(); }, referenceHandler() {},
    assetGetters: { getCoachHtml: () => '<html>coach</html>', getCoachJs: () => 'js', getPhoneticDict: () => 'dict' },
    fsImpl: { readFile(_file, _enc, cb) { cb(null, '<html><body>app</body></html>'); } },
    pathImpl: { join: (...parts) => parts.join('/') }, distDir: '/fake-dist',
    ...overrides,
  };
}

test('2. loadEnvFile preserves parsing and existing values using only fakes', () => {
  const env = { KEEP: 'original' };
  const files = { '/fake/.env': ' A = one \r\nKEEP=changed\nB="two # kept"\nC=three # cut\nD=\'four\'\n# nope\n' };
  const result = api.loadEnvFile({
    fsImpl: { existsSync: (p) => p in files, readFileSync: (p) => files[p] },
    pathImpl: { resolve: () => '/fake/.env' }, env,
  });
  assert.deepEqual(result, { loaded: true, assignedCount: 4 });
  assert.deepEqual(env, { KEEP: 'original', A: 'one', B: 'two # kept', C: 'three', D: 'four' });
  assert.equal(JSON.stringify(result).includes('three'), false);
  assert.deepEqual(api.loadEnvFile({ fsImpl: { existsSync: () => false }, pathImpl: { resolve: () => '/none' }, env: {} }), { loaded: false, assignedCount: 0 });
});

test('3. fatal handlers mirror sanitized fixed events and always exit once', () => {
  for (const failing of ['none', 'debug', 'stderr']) {
    const events = []; const lines = []; const exits = [];
    let handler;
    const debugImpl = { log(...args) { events.push(args); if (failing === 'debug') { if (handler) handler(new Error('REENTER_SECRET')); throw new Error('LOGGER_SECRET'); } } };
    const stderr = { write(line) { lines.push(line); if (failing === 'stderr') throw new Error('STDERR_SECRET'); } };
    handler = api.createFatalHandler({ debugImpl, stderr, exit: (code) => exits.push(code), fatalClass: 'uncaughtException' });
    handler(new Error('RAW_FATAL_SECRET')); handler(new Error('SECOND_SECRET'));
    assert.equal(events.length, 1); assert.equal(lines.length, 1); assert.deepEqual(exits, [1]);
    assert.equal(JSON.stringify([events, lines]).match(/RAW_FATAL_SECRET|LOGGER_SECRET|STDERR_SECRET|REENTER_SECRET/), null);
  }
  const installed = []; const removed = [];
  const processImpl = { on: (name, fn) => installed.push([name, fn]), removeListener: (name, fn) => removed.push([name, fn]) };
  const uninstall = api.installFatalHandlers({ processImpl, debugImpl: { log() {} }, stderr: { write() {} }, exit() {} });
  assert.deepEqual(installed.map(([name]) => name), ['uncaughtException', 'unhandledRejection']);
  uninstall(); assert.deepEqual(removed, installed);

  const witnessed = [];
  const fatal = api.createFatalHandler({
    debugImpl: { log() {} },
    debugBus: { push: (...args) => witnessed.push(args) },
    stderr: { write() {} },
    exit() {},
    fatalClass: 'unhandledRejection',
  });
  fatal(new Error('PRIVATE_FATAL'));
  assert.deepEqual(witnessed, [[
    'error',
    'process',
    'fatal-process-event',
    { class: 'partial-function', fatalClass: 'unhandledRejection' },
  ]]);
  assert.doesNotMatch(JSON.stringify(witnessed), /PRIVATE_FATAL/);
});

test('4. registered Coach HTML contains no injected Studio control or cross-port request', async () => {
  for (const envLine of [
    'VOICE_STUDIO_URL=https://studio-sentinel.invalid/custom///',
    '',
  ]) {
    const env = {};
    api.loadEnvFile({ fsImpl: { existsSync: () => true, readFileSync: () => envLine }, pathImpl: { resolve: () => '/fake/.env' }, env });
    const app = fakeApp();
    api.registerCoachRoutes(app, registrarOptions({ env }));
    const res = fakeResponse();
    await app.dispatch('get', '/app', { query: {} }, res);
    assert.equal(res.body, '<html><body>app</body></html>');
    assert.doesNotMatch(res.body, /vs-toggle|api\/mode|8430|studio-sentinel/i);
  }
});

test('5. debug routes default off; enabled routes cross the real guard; full-file route is absent', async () => {
  const off = fakeApp(); api.registerCoachRoutes(off, registrarOptions());
  assert.equal(off.routes.some((r) => String(r.route).startsWith('/debug/')), false);
  const on = fakeApp();
  api.registerCoachRoutes(on, registrarOptions({ env: { TRANSVOICE_DEBUG_ROUTES_ENABLED: 'yes' }, adminToken: 'guard-secret' }));
  assert.equal(on.routes.some((r) => r.route === '/debug/log/file'), false);
  assert.ok(on.routes.filter((r) => String(r.route).startsWith('/debug/')).every((r) => r.handlers.length === 2));
  const denied = fakeResponse();
  await on.dispatch('get', '/debug/summary', { headers: {}, socket: { remoteAddress: '203.0.113.4' } }, denied);
  assert.equal(denied.statusCode, 403);
  const allowed = fakeResponse();
  await on.dispatch('get', '/debug/summary', { headers: { 'x-sloane-admin-token': 'guard-secret' }, socket: { remoteAddress: '203.0.113.4' } }, allowed);
  assert.equal(allowed.statusCode, 200); assert.deepEqual(allowed.body, {});
});

test('6. registered required asset handlers return generic no-store 503', async () => {
  // /coach now 302-redirects to /app?mode=coach; the coach HTML asset route lives at /coach-legacy.
  for (const [route, method] of [['/coach-legacy', 'getCoachHtml'], ['/static/coach-app.js', 'getCoachJs'], ['/static/phonetic-dict.js', 'getPhoneticDict']]) {
    const getters = { getCoachHtml: () => 'ok', getCoachJs: () => 'ok', getPhoneticDict: () => 'ok' };
    getters[method] = () => { const error = new Error('SECRET_ASSET_PATH'); error.code = 'COACH_ASSET_UNAVAILABLE'; throw error; };
    const app = fakeApp(); api.registerCoachRoutes(app, registrarOptions({ assetGetters: getters }));
    const res = fakeResponse(); await app.dispatch('get', route, {}, res);
    assert.equal(res.statusCode, 503); assert.equal(res.headers['cache-control'], 'no-store');
    assert.equal(res.body, 'Required coach asset is unavailable.'); assert.equal(res.body.includes('SECRET_ASSET_PATH'), false);
  }
});

function response({ ok = true, status = 200, bytes = Buffer.from('audio'), json = {}, headers = {} } = {}) {
  return { ok, status, body: { cancel() {} }, arrayBuffer: async () => bytes, json: async () => json,
    headers: { get: (name) => headers[name.toLowerCase()] || '' } };
}

test('7. real resolver performs two fake crossings and never diagnoses sensitive values', async () => {
  const seeds = ['CLIP_SECRET_77', '/private/PATH_SECRET.wav', 'https://TRAINER_SECRET.invalid', 'https://VOX_SECRET.invalid', 'TOKEN_SECRET'];
  const debugImpl = debugSpy(); const calls = [];
  const resolver = api.createVoxcpmReferenceResolver({
    env: { VOICE_TRAINER_URL: seeds[2], VOXCPM_URL: seeds[3] }, debugImpl,
    fetchImpl: async (url, init) => { calls.push([url, init]); return calls.length === 1 ? response() : response({ json: { path: seeds[1], token: seeds[4] } }); },
  });
  assert.equal(await resolver(seeds[0]), seeds[1]); assert.equal(calls.length, 2);
  const diagnostics = JSON.stringify(debugImpl.calls);
  for (const seed of seeds) assert.equal(diagnostics.includes(seed), false);
  assert.match(diagnostics, /resolved/); assert.match(diagnostics, /complete/); assert.match(diagnostics, /hasReference/);
  for (const scenario of ['validation', 'download', 'upload', 'json']) {
    const spy = debugSpy(); let count = 0;
    const failing = api.createVoxcpmReferenceResolver({ env: { VOICE_TRAINER_URL: seeds[2], VOXCPM_URL: seeds[3] }, debugImpl: spy,
      fetchImpl: async () => { count += 1; if (scenario === 'download') return response({ ok: false, status: 599 }); if (scenario === 'upload' && count === 2) return response({ ok: false, status: 598 }); if (scenario === 'json' && count === 2) return { ...response(), json: async () => { throw new Error('ERROR_SECRET'); } }; return response(); } });
    await assert.rejects(() => failing(scenario === 'validation' ? '!!!' : seeds[0]));
    const text = JSON.stringify(spy.calls); for (const seed of [...seeds, 'ERROR_SECRET']) assert.equal(text.includes(seed), false);
    assert.match(text, /rejected/);
  }
});

test('8. TTS factory and production registrar use injected resolver/fetch without diagnostic leaks', async () => {
  const learner = 'LEARNER_TEXT_SECRET'; const clip = 'CLIP_SECRET_88'; const resolved = '/private/RESOLVED_SECRET.wav';
  const trainer = 'https://TRAINER_WIRE.invalid'; const vox = 'https://VOX_WIRE.invalid'; const debugImpl = debugSpy();
  const calls = [];
  const fetchImpl = async (url) => { calls.push(url); if (calls.length === 1) return response(); if (calls.length === 2) return response({ json: { path: resolved } }); return { ...response({ headers: { 'content-type': 'audio/wav', 'x-audio-format': 'wav' } }), body: null }; };
  const app = fakeApp();
  api.registerCoachRoutes(app, registrarOptions({ env: { VOICE_TRAINER_URL: trainer, VOXCPM_URL: vox }, debugImpl, fetchImpl }));
  const res = fakeResponse();
  await app.dispatch('post', '/voice/tts', { body: { text: learner, referenceClipId: clip }, on() {} }, res);
  assert.equal(calls.length, 3); assert.equal(res.writableEnded, true); assert.equal(res.headers['x-reference-resolved'], 'true');
  const diagnostics = JSON.stringify(debugImpl.calls);
  for (const seed of [learner, clip, resolved, trainer, vox]) assert.equal(diagnostics.includes(seed), false);
  assert.match(diagnostics, /textLength/); assert.match(diagnostics, /bytes/);
});

test('9. direct TTS factory and preset test share injected dependencies with safe output metadata', async () => {
  const learner = 'DIRECT_LEARNER_SECRET'; const clip = 'PRESET_CLIP_SECRET'; const resolved = '/private/PRESET_PATH_SECRET.wav';
  const debugImpl = debugSpy(); let resolverCalls = 0; let fetchCalls = 0;
  const direct = api.createTtsProxyHandler({ debugImpl, env: { VOXCPM_URL: 'https://DIRECT_URL_SECRET.invalid' },
    resolveVoxcpmReferenceImpl: async () => { resolverCalls += 1; return resolved; },
    fetchImpl: async () => { fetchCalls += 1; return { ...response({ headers: { 'content-type': 'audio/wav', 'x-audio-format': 'wav' } }), body: null }; } });
  const directRes = fakeResponse(); await direct({ body: { text: learner, referenceClipId: clip }, on() {} }, directRes);
  assert.equal(resolverCalls, 1); assert.equal(fetchCalls, 1);

  const app = fakeApp();
  api.registerCoachRoutes(app, registrarOptions({ debugImpl, env: { VOXCPM_URL: 'https://DIRECT_URL_SECRET.invalid' },
    resolveVoxcpmReferenceImpl: async () => { resolverCalls += 1; return resolved; },
    fetchImpl: async () => { fetchCalls += 1; return response({ headers: { 'content-type': 'audio/wav' } }); } }));
  const presetRes = fakeResponse();
  await app.dispatch('post', '/voice/presets/test', { body: { text: learner, referenceClipId: clip, phraseIndex: 1 } }, presetRes);
  assert.equal(resolverCalls, 2); assert.equal(fetchCalls, 2);
  assert.equal('x-test-phrase-text' in presetRes.headers, false);
  const diagnostics = JSON.stringify(debugImpl.calls);
  for (const seed of [learner, clip, resolved, 'DIRECT_URL_SECRET']) assert.equal(diagnostics.includes(seed), false);
  assert.match(diagnostics, /textLength/); assert.match(diagnostics, /bytes/);
});

test('10. fully injected main preserves startup order without a Coach-side Studio crossing', () => {
  const order = []; const env = {};
  const app = fakeApp(); app.listen = () => { throw new Error('native listen forbidden'); };
  const standalone = { app, runtime: { config: { host: 'fake', port: 0 } }, start() { order.push('start'); return 'fake-server'; } };
  const result = api.main({ env,
    loadEnvFileImpl({ env: target }) { order.push('env'); target.LOADED = 'yes'; },
    runtimeModuleLoader() { order.push('runtime-module'); return { createVoiceStandaloneApp: () => standalone }; },
    configModuleLoader() { order.push('config-module'); return { config: { ADMIN_TOKEN: 'admin' } }; },
    createVoiceStandaloneAppImpl() { order.push('app'); return standalone; },
    installFatalHandlersImpl() { order.push('fatal'); },
    registerCoachRoutesImpl(_app, options) {
      order.push('routes');
      assert.equal('voiceStudioToggleSnippet' in options, false);
      assert.equal(options.includePresetProxyRoutes, false);
    },
    expressStaticImpl() { return function fakeStatic() {}; },
    fetchImpl: async () => response(), uploadMiddleware() {}, referenceHandler() {},
  });
  assert.equal(result, 'fake-server');
  assert.deepEqual(order.slice(0, 6), ['env', 'runtime-module', 'config-module', 'app', 'fatal', 'routes']);
  assert.equal(order.at(-1), 'start');
});

test('11. real main leaves runtime as sole preset-list/save owner and serves an unmodified Coach shell', async () => {
  const { registerVoiceRuntimeEntrypoints } = require('./voice-runtime-entrypoints');
  const app = fakeApp();
  const env = {};
  const postLoadUrl = 'https://POST_LOAD_STUDIO.invalid/custom///';
  let runtimeRouteCount = 0;
  const operationHandlers = new Proxy({}, { get: () => async () => ({ ok: true }) });
  const sessionHandlers = new Proxy({}, { get: () => async () => ({ payload: {}, statusCode: 200 }) });
  const learnerHandlers = new Proxy({}, { get: () => async () => ({ ok: true }) });
  const runtimeModuleLoader = () => ({
    createVoiceStandaloneApp() {
      registerVoiceRuntimeEntrypoints(app, {
        enableDeepTutorVoiceRoutes: false,
        learnerContextRouteHandlers: learnerHandlers,
        sendRouteError() {},
        voiceOperationRouteHandlers: operationHandlers,
        voiceRouteMiddlewares(_req, _res, next) { next(); },
        voiceSessionRouteHandlers: sessionHandlers,
      });
      runtimeRouteCount = app.routes.length;
      return {
        app,
        runtime: { config: { host: 'fake', port: 0 } },
        start() { return 'fake-server'; },
      };
    },
  });

  api.main({
    env,
    loadEnvFileImpl({ env: target }) { target.VOICE_STUDIO_URL = postLoadUrl; },
    runtimeModuleLoader,
    configModuleLoader: () => ({ config: { ADMIN_TOKEN: 'admin' } }),
    installFatalHandlersImpl() {},
    expressStaticImpl() { return function fakeStatic() {}; },
    fsImpl: { readFile(_file, _enc, cb) { cb(null, '<html><body>main composition</body></html>'); } },
    pathImpl: { join: (...parts) => parts.join('/') },
    distDir: '/fake-dist',
    debugImpl: debugSpy(),
    fetchImpl: async () => { throw new Error('network forbidden'); },
    uploadMiddleware(_req, _res, next) { next(); },
    referenceHandler() {},
  });

  assert.ok(runtimeRouteCount > 2, 'fake standalone registered real representative runtime routes');
  const keys = app.routes.filter((route) => typeof route.route === 'string').map((route) => `${route.method} ${route.route}`);
  assert.equal(keys.filter((key) => key === 'get /voice/presets').length, 1);
  assert.equal(keys.filter((key) => key === 'post /voice/presets/reference/save').length, 1);
  assert.equal(keys.filter((key) => key === 'post /voice/session/start').length, 1);
  const runtimeKeys = new Set(keys.slice(0, runtimeRouteCount));
  const coachKeys = keys.slice(runtimeRouteCount);
  assert.deepEqual(coachKeys.filter((key) => runtimeKeys.has(key)), [], 'coach integration shadows no runtime route');
  assert.ok(coachKeys.includes('post /voice/tts'));
  assert.ok(coachKeys.includes('post /voice/upload-reference'));
  assert.ok(coachKeys.includes('post /voice/presets/test'));

  const html = fakeResponse();
  await app.dispatch('get', '/app', {}, html);
  assert.equal(html.body, '<html><body>main composition</body></html>');
  assert.doesNotMatch(html.body, /POST_LOAD_STUDIO|api\/mode|vs-toggle/);
  assert.equal(html.body.includes('IMPORT-SNAPSHOT-SENTINEL'), false);
  assert.equal(html.body.includes('http://127.0.0.1:8430'), false);

  const isolated = fakeApp();
  api.registerCoachRoutes(isolated, registrarOptions());
  assert.equal(isolated.routes.filter((route) => route.method === 'get' && route.route === '/voice/presets').length, 1);
  assert.equal(isolated.routes.filter((route) => route.method === 'post' && route.route === '/voice/presets/reference/save').length, 1);
});
