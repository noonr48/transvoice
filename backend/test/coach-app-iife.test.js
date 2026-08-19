'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const candidatePath = path.resolve(__dirname, '../coach-app.js');
const source = fs.readFileSync(candidatePath, 'utf8');
const encoder = new TextEncoder();

function element(id, histories) {
  let text = '';
  const listeners = new Map(), children = [], classes = new Set();
  const el = {
    id, style: {}, disabled: false, value: '', files: [], firstChild: null,
    scrollTop: 0, scrollHeight: 0, className: '', innerHTML: '',
    classList: {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      contains: (name) => classes.has(name),
    },
    setAttribute(name, value) { this[name] = String(value); },
    addEventListener(name, fn) { listeners.set(name, fn); },
    dispatch(name, event = {}) { const fn = listeners.get(name); if (fn) return fn.call(this, event); },
    appendChild(child) { children.push(child); this.firstChild = children[0] || null; this.scrollHeight = children.length; },
    removeChild(child) { const i = children.indexOf(child); if (i >= 0) children.splice(i, 1); this.firstChild = children[0] || null; },
    querySelector(selector) { return selector === '#error-msg' ? histories.elements.get('error-msg') : null; },
    click() { if (this.disabled) return; return this.dispatch('click', { preventDefault() {} }); },
  };
  Object.defineProperty(el, 'textContent', {
    get() { return text; },
    set(value) { text = String(value); histories.text.push({ id, value: text }); },
  });
  el._children = children;
  return el;
}

function bytes(value) { return typeof value === 'string' ? encoder.encode(value) : value; }
function splitBytes(value, cuts) {
  const all = bytes(value), out = []; let from = 0;
  for (const cut of cuts) { out.push(all.slice(from, cut)); from = cut; }
  out.push(all.slice(from)); return out;
}
function event(payload, ending = '\n\n', spacing = ' ') { return 'data:' + spacing + (typeof payload === 'string' ? payload : JSON.stringify(payload)) + ending; }
function done(message) { return { done: true, session: { coachMessage: message } }; }
function pendingRead() { return { pending: true }; }
function pendingReadNonAbort() { return { pendingNonAbort: true }; }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function settle(rounds = 16) { for (let i = 0; i < rounds; i++) await new Promise((resolve) => setImmediate(resolve)); }

function boot(streams = [], options = {}) {
  const h = {
    text: [], elements: new Map(), routes: [], fetchCalls: [], debug: [], tts: [], phonetic: [], timers: [],
    recognition: [], pendingReads: [], pendingFetches: [], beacons: [], micCalls: 0, tracks: [], contexts: [], rafCalls: 0,
    events: [], intervals: [],
  };
  const ids = [
    'debug-panel', 'debug-list', 'dbg-close', 'dbg-clear', 'dbg-fetch-srv', 'error-banner', 'error-msg',
    'conn', 'conn-label', 'pulse-dot', 'meter-track', 'status-text', 'turn-indicator', 'turn-subtext',
    'meter-hint', 'meter-fill', 'turn-chip', 'session-chip', 'mode-chip', 'start-btn', 'end-btn',
    'voice-sample-link', 'voice-quality-note', 'phrase-card', 'phrase-body', 'trail', 'phonetic-transcript',
    'preset-select', 'test-voice-btn',
  ];
  for (const id of ids) h.elements.set(id, element(id, h));
  h.elements.get('error-banner').querySelector = () => h.elements.get('error-msg');
  const body = element('body', h);

  class Recognition {
    constructor() { this.starts = 0; this.aborts = 0; h.recognition.push(this); }
    start() { this.starts++; if (options.recognitionStartError) throw options.recognitionStartError; }
    abort() { this.aborts++; }
  }
  class AudioContext {
    constructor() {
      this.index = h.contexts.length; this.state = this.index === 0 && options.playbackSuspended ? 'suspended' : 'running';
      this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; this.closed = 0; this.resumes = 0; h.contexts.push(this);
    }
    createMediaStreamSource() { return { connect() {} }; }
    createAnalyser() { return { fftSize: 0, frequencyBinCount: 4, getByteFrequencyData() {} }; }
    createBufferSource() { const s = { connect() {}, stop() { if (s.onended) s.onended(); }, start() { Promise.resolve().then(() => s.onended && s.onended()); }, onended: null }; return s; }
    createGain() { return { gain: { setValueAtTime() {}, linearRampToValueAtTime() {} }, connect() {} }; }
    decodeAudioData() { return Promise.resolve({ duration: 0.01, sampleRate: 48000, numberOfChannels: 1 }); }
    resume() { this.resumes++; if (options.resumeDeferred) return options.resumeDeferred.promise.then(() => { this.state = 'running'; }); this.state = 'running'; return Promise.resolve(); }
    close() { this.closed++; this.state = 'closed'; return Promise.resolve(); }
  }
  function responseJson(value) { return { ok: true, status: 200, json: () => Promise.resolve(value) }; }
  function abortError() { const error = new Error('aborted'); error.name = 'AbortError'; return error; }
  function streamResponse(spec, signal) {
    let index = 0;
    return { ok: true, status: 200, body: { getReader() { return { read() {
      if (index >= spec.length) return Promise.resolve({ done: true });
      const item = spec[index++];
      if (item instanceof Error) return Promise.reject(item);
      if (item && (item.pending || item.pendingNonAbort)) return new Promise((resolve, reject) => {
        let settled = false;
        const row = { resolve(value = { done: true }) { if (!settled) { settled = true; resolve(value); } }, reject(error = new Error('pending read rejected')) { if (!settled) { settled = true; reject(error); } } };
        h.pendingReads.push(row);
        if (!item.pendingNonAbort) {
          if (signal && signal.aborted) row.reject(abortError());
          else if (signal) signal.addEventListener('abort', () => row.reject(abortError()), { once: true });
        }
      });
      return Promise.resolve({ done: false, value: bytes(item) });
    } }; } } };
  }
  function fetchFake(url, opts = {}) {
    h.events.push('route:' + url);
    if (!h.routes.includes(url)) h.routes.push(url);
    h.fetchCalls.push({ url, opts });
    if (options.routes && options.routes[url]) return options.routes[url](opts, { responseJson, abortError });
    if (url === '/health') return Promise.resolve(responseJson({ status: 'online' }));
    if (url === '/voice/presets') return Promise.resolve(responseJson([]));
    if (url === '/voice/real-sentence') return Promise.resolve(responseJson({ ok: true }));
    if (url === '/voice/session/start') return Promise.resolve(responseJson({ sessionId: options.sessionId || 'session-1' }));
    if (url === '/voice/coach/stream') {
      assert.ok(streams.length, 'unexpected coach stream route'); const spec = streams.shift();
      if (spec && spec.pendingFetch) return new Promise((resolve, reject) => h.pendingFetches.push({ resolve, reject }));
      return Promise.resolve(streamResponse(spec, opts.signal));
    }
    if (url === '/voice/session/end') return Promise.resolve(responseJson({ ok: true }));
    if (url === '/voice/tts') { const payload = JSON.parse(opts.body); h.tts.push(payload.text); return Promise.resolve({ ok: true, status: 200, headers: { get: () => 'audio/wav' }, arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)) }); }
    if (url === '/debug/log') { h.debug.push(JSON.parse(opts.body)); return Promise.resolve(responseJson({ ok: true })); }
    if (url === '/debug/clear') return Promise.resolve(responseJson({ ok: true }));
    if (url === '/debug/pipeline') return Promise.resolve(responseJson({ events: [] }));
    throw new Error('unexpected route: ' + url);
  }
  const documentListeners = new Map(), windowListeners = new Map(), timerSet = new Set();
  const document = {
    body,
    getElementById(id) { if (!h.elements.has(id)) h.elements.set(id, element(id, h)); return h.elements.get(id); },
    createElement(tag) { return element(tag, h); }, createTextNode(value) { return { textContent: String(value) }; },
    addEventListener(name, fn) { documentListeners.set(name, fn); },
  };
  function defaultStream() { const tracks = [0, 1].slice(0, options.trackCount || 1).map(() => ({ stops: 0, stop() { this.stops++; } })); h.tracks.push(...tracks); return { getTracks: () => tracks }; }
  const context = {
    console: { warn() {}, log() {}, error() {} }, document, window: null,
    navigator: {
      mediaDevices: { getUserMedia: () => { h.events.push('mic:getUserMedia'); h.micCalls++; return options.micDeferred ? options.micDeferred.promise : Promise.resolve(defaultStream()); } },
      sendBeacon: (url, bodyValue) => { h.beacons.push({ url, body: bodyValue }); return true; },
    },
    localStorage: { getItem: () => null, setItem() {} }, fetch: fetchFake, TextDecoder, TextEncoder, Uint8Array, ArrayBuffer,
    AbortController, Blob, FormData, Date, Math, JSON, Promise, setImmediate,
    setTimeout(fn, delay) { const row = { fn, delay, active: true }; h.timers.push(row); timerSet.add(row); return row; },
    clearTimeout(row) { if (row) row.active = false; },
    setInterval(fn, delay) { const row = { fn, delay, active: true }; h.intervals.push(row); h.events.push('interval:' + delay); return row; },
    clearInterval(row) { if (row) row.active = false; },
    requestAnimationFrame() { h.rafCalls++; return 1; }, cancelAnimationFrame() {},
    toPhonetic(text) { h.phonetic.push(text); return text; },
  };
  context.window = Object.assign(context, {
    SpeechRecognition: options.noRecognition ? undefined : Recognition,
    webkitSpeechRecognition: options.noRecognition ? undefined : Recognition,
    AudioContext, webkitAudioContext: AudioContext,
    addEventListener(name, fn) { windowListeners.set(name, fn); },
  });
  vm.runInNewContext(source, context, { filename: candidatePath, timeout: 2000 });
  return {
    h, context,
    async start(expectRecognition = true) { h.elements.get('start-btn').click(); await settle(); if (expectRecognition) assert.ok(h.recognition.length >= 1); },
    async end() { h.elements.get('end-btn').click(); await settle(30); },
    unload() { const fn = windowListeners.get('beforeunload'); if (fn) fn(); },
    async say(text) { const r = h.recognition[h.recognition.length - 1]; assert.equal(typeof r.onresult, 'function'); r.onresult({ resultIndex: 0, results: Object.assign([[{ transcript: text }]], { 0: Object.assign([{ transcript: text }], { isFinal: true }) }) }); await settle(30); },
    async flushDebug() { for (const row of h.timers) if (row.active && row.delay === 500) { row.active = false; row.fn(); } await settle(); },
    diagnostics() { return h.debug.filter((row) => /^SSE_/.test(row.msg)); },
    sinkStrings() { return h.text.map((x) => x.value).concat(h.tts, h.phonetic).concat(h.debug.map((x) => JSON.stringify(x))); },
  };
}

async function oneTurn(spec, text = 'hello') { const app = boot([spec]); await app.start(); await app.say(text); await app.flushDebug(); return app; }
function normalEnds(app, sid) { return app.h.fetchCalls.filter((x) => x.url === '/voice/session/end' && JSON.parse(x.opts.body).sessionId === sid); }
function assertIdle(app) {
  assert.equal(app.h.elements.get('session-chip').textContent, 'Idle');
  assert.equal(app.h.elements.get('mode-chip').textContent, 'Waiting');
  assert.equal(app.h.elements.get('turn-chip').textContent, '0');
  assert.equal(app.h.elements.get('status-text').textContent, 'Ready to start.');
  assert.equal(app.h.elements.get('start-btn').disabled, false);
  assert.equal(app.h.elements.get('end-btn').disabled, true);
  assert.equal(app.context.document.body['data-ready'], 'true');
}

test('RED: full IIFE harness boots with all routes controlled', async () => {
  const app = boot(); await app.start();
  assert.deepEqual(app.h.routes.filter((x) => !x.startsWith('/debug/')).sort(), ['/health', '/voice/presets', '/voice/real-sentence', '/voice/session/start'].sort());
  assert.throws(() => app.context.fetch('/unexpected-native-route'), /unexpected route/);
  assert.equal(app.context.require, undefined); assert.equal(app.context.XMLHttpRequest, undefined); assert.equal(app.context.WebSocket, undefined);
});

test('RED: raw chunks never reach visible or TTS sinks', async () => {
  const raw = 'RAW_HIDDEN_BLOCK_7f91', clean = 'Sanitized answer only.';
  const app = await oneTurn([event({ chunk: raw }), event(done(clean))]);
  assert.deepEqual(app.h.tts, [clean]); assert.equal(app.sinkStrings().some((value) => value.includes(raw)), false);
});

test('RED: authoritative done is the only finalization source', async () => {
  const exact = '  Keep these boundary spaces!  ', app = await oneTurn([event({ chunk: 'raw-not-final' }), event(done(exact))]);
  assert.deepEqual(app.h.tts, [exact]); assert.equal(app.h.elements.get('phrase-body').textContent, exact);
  assert.equal(app.h.elements.get('trail').textContent, exact); assert.deepEqual(app.h.phonetic, [exact]);
});

test('RED: incremental SSE handles fragmented framing and UTF-8', async () => {
  const exact = 'Café 🌙 — exact', wire = event(done(exact), '\r\r', ''), all = bytes(wire), moon = Buffer.from(wire).indexOf(Buffer.from('🌙'));
  const app = await oneTurn(splitBytes(all, [1, moon + 1, moon + 2, all.length - 1])); assert.deepEqual(app.h.tts, [exact]);
});

test('RED: pre-done EOF or failure resets and restarts recognition', async () => {
  const app = boot([[event({ chunk: 'never-final' })], [event(done('Second turn succeeds.'))]]); await app.start();
  const startsBefore = app.h.recognition.length; await app.say('first'); assert.equal(app.h.recognition.length, startsBefore + 1); assert.equal(app.h.tts.length, 0);
  await app.say('second'); assert.deepEqual(app.h.tts, ['Second turn succeeds.']);
});

test('SSE: CR-only line and blank-line separators dispatch events', async () => { const app = await oneTurn([event(done('CR only works'), '\r\r')]); assert.deepEqual(app.h.tts, ['CR only works']); });

test('SSE: CRLF split between byte chunks dispatches each line once', async () => {
  const wire = event(done('split CRLF works'), '\r\n\r\n'), firstCr = wire.indexOf('\r'), secondCr = wire.lastIndexOf('\r');
  const app = await oneTurn(splitBytes(wire, [firstCr + 1, secondCr + 1])); assert.deepEqual(app.h.tts, ['split CRLF works']);
});

test('SSE: pending CR followed by non-LF dispatches prior line once', async () => {
  const app = await oneTurn([':pending-cr-probe\r', 'data:' + JSON.stringify(done('pending CR works')) + '\r\r']); assert.deepEqual(app.h.tts, ['pending CR works']);
});

test('SSE: every multibyte UTF-8 byte split preserves authoritative text', async () => {
  const exact = 'é漢🌙', wire = bytes(event(done(exact)));
  for (let cut = 1; cut < wire.length; cut++) { const app = await oneTurn([wire.slice(0, cut), wire.slice(cut)]); assert.deepEqual(app.h.tts, [exact], 'split at byte ' + cut); }
});

test('SSE: data spacing, multiline data, multiple events, malformed JSON, and marker semantics', async () => {
  const exact = 'multiline accepted';
  const multiline = 'data:{"done":true,\n' + 'data: "session":{"coachMessage":"' + exact + '"}}\n\n';
  const wire = ':comment\nretry: 1\n\n' + event('[DONE]') + 'data:{bad}\n\n' + event({ done: true, session: { coachMessage: '' } }) + multiline + event({ chunk: 'after' });
  const app = await oneTurn([wire]); assert.deepEqual(app.h.tts, [exact]);
  assert.deepEqual(app.diagnostics().map((x) => x.msg), ['SSE_MALFORMED_EVENT', 'SSE_INVALID_DONE', 'SSE_DONE_ACCEPTED', 'SSE_AFTER_DONE_EVENT']);
});

test('SSE: unterminated EOF flush finalizes accepted done', async () => { const app = await oneTurn(['data: ' + JSON.stringify(done('EOF flush'))]); assert.deepEqual(app.h.tts, ['EOF flush']); });

test('SSE: missing and invalid done reset safely with exact diagnostics', async () => {
  const app = boot([[event({ chunk: 'raw' })], [event({ done: true, session: {} }), event(done('recovered'))]]); await app.start(); await app.say('first'); await app.say('second'); await app.flushDebug();
  assert.deepEqual(app.h.tts, ['recovered']); const codes = app.diagnostics().map((x) => x.msg); assert.ok(codes.includes('SSE_MISSING_DONE')); assert.ok(codes.includes('SSE_INVALID_DONE'));
});

test('SSE: pre-done failure resets, restarts recognition, and allows a successful next turn', async () => {
  const app = boot([[new Error('private raw failure')], [event(done('after failure'))]]); await app.start(); const before = app.h.recognition.length;
  await app.say('first'); assert.equal(app.h.recognition.length, before + 1); await app.say('second'); await app.flushDebug(); assert.deepEqual(app.h.tts, ['after failure']);
  assert.ok(app.diagnostics().some((x) => x.msg === 'SSE_STREAM_FAILURE_BEFORE_DONE')); assert.equal(app.sinkStrings().some((x) => x.includes('private raw failure')), false);
});

test('SSE: post-done event and failure preserve one accepted finalization', async () => {
  const exact = 'accepted before failure', app = await oneTurn([event(done(exact)), event(done('must not replace')), event({ chunk: 'post done raw' }), new Error('after done private')]);
  assert.deepEqual(app.h.tts, [exact]); const codes = app.diagnostics().map((x) => x.msg); assert.equal(codes.filter((code) => code === 'SSE_AFTER_DONE_EVENT').length, 2);
  assert.ok(codes.includes('SSE_STREAM_FAILURE_AFTER_DONE')); assert.equal(app.h.recognition.length, 2, 'only playback completion restarts recognition');
});

test('SSE: diagnostics use exactly seven codes and numeric or boolean metadata', async () => {
  const app = boot([[event({ chunk: 'raw' })], [new Error('before')], [event({ done: true, session: {} }), 'data:{bad}\n\n', event(done('ok')), event({ chunk: 'after' }), new Error('after')]]);
  await app.start(); await app.say('missing'); await app.say('failure'); await app.say('mixed'); await app.flushDebug();
  const diagnostics = app.diagnostics(), allowed = new Set(['SSE_DONE_ACCEPTED', 'SSE_MALFORMED_EVENT', 'SSE_INVALID_DONE', 'SSE_MISSING_DONE', 'SSE_STREAM_FAILURE_BEFORE_DONE', 'SSE_AFTER_DONE_EVENT', 'SSE_STREAM_FAILURE_AFTER_DONE']);
  assert.deepEqual(new Set(diagnostics.map((x) => x.msg)), allowed);
  for (const row of diagnostics) for (const value of Object.values(row.data || {})) assert.ok(typeof value === 'number' || typeof value === 'boolean');
});

test('TEARDOWN: End during raw stream stays idle without restart or finalization', async () => {
  const app = boot([[event({ chunk: 'raw still pending' }), pendingRead()]]); await app.start(); await app.say('end this turn'); assert.equal(app.h.pendingReads.length, 1); await app.end(); await app.flushDebug();
  assert.equal(app.h.elements.get('session-chip').textContent, 'Idle'); assert.equal(app.h.elements.get('status-text').textContent, 'Ready to start.'); assert.equal(app.h.recognition.length, 1);
  assert.deepEqual(app.h.tts, []); assert.equal(app.h.elements.get('phrase-body').textContent, ''); assert.equal(app.h.elements.get('trail').textContent, ''); assert.deepEqual(app.h.phonetic, []);
  assert.deepEqual(app.diagnostics(), []); assert.equal(app.h.elements.get('error-msg').textContent, ''); await settle(20); assert.equal(app.h.elements.get('status-text').textContent, 'Ready to start.');
});

test('TEARDOWN: End after accepted done before EOF discards pending finalization', async () => {
  const app = boot([[event(done('must be discarded on End')), pendingRead()]]); await app.start(); await app.say('end after done'); assert.equal(app.h.pendingReads.length, 1); await app.end(); await app.flushDebug();
  assert.equal(app.h.elements.get('session-chip').textContent, 'Idle'); assert.equal(app.h.elements.get('status-text').textContent, 'Ready to start.'); assert.equal(app.h.recognition.length, 1);
  assert.deepEqual(app.h.tts, []); assert.equal(app.h.elements.get('phrase-body').textContent, ''); assert.equal(app.h.elements.get('trail').textContent, ''); assert.deepEqual(app.h.phonetic, []);
  assert.deepEqual(app.diagnostics().map((row) => row.msg), ['SSE_DONE_ACCEPTED']); assert.equal(app.h.elements.get('error-msg').textContent, ''); await settle(20); assert.equal(app.h.elements.get('status-text').textContent, 'Ready to start.');
});

function assertEndInvariant(app, expectedCodes = []) {
  assert.equal(app.h.elements.get('session-chip').textContent, 'Idle'); assert.equal(app.h.elements.get('status-text').textContent, 'Ready to start.'); assert.equal(app.h.recognition.length, 1);
  assert.deepEqual(app.h.tts, []); assert.equal(app.h.elements.get('phrase-body').textContent, ''); assert.equal(app.h.elements.get('trail').textContent, ''); assert.deepEqual(app.h.phonetic, []);
  assert.equal(app.h.elements.get('error-msg').textContent, ''); assert.deepEqual(app.diagnostics().map((row) => row.msg), expectedCodes);
}

test('SUPPLEMENTAL: stale non-Abort reader fulfillment after End cannot progress before or after accepted done', async () => {
  for (const row of [
    { spec: [event({ chunk: 'raw pending' }), pendingReadNonAbort()], codes: [], fulfillment: { done: false, value: bytes(event(done('stale raw fulfillment'))) } },
    { spec: [event(done('accepted then ended')), pendingReadNonAbort()], codes: ['SSE_DONE_ACCEPTED'], fulfillment: { done: true } },
  ]) {
    const app = boot([[...row.spec]]); await app.start(); await app.say('reader fulfillment'); assert.equal(app.h.pendingReads.length, 1); await app.end();
    app.h.pendingReads[0].resolve(row.fulfillment); await settle(30); await app.flushDebug(); assertEndInvariant(app, row.codes);
  }
});

test('SUPPLEMENTAL: stale non-Abort reader rejection after End cannot retry or finalize', async () => {
  for (const row of [
    { spec: [event({ chunk: 'raw pending' }), pendingReadNonAbort()], codes: [] },
    { spec: [event(done('accepted then rejected')), pendingReadNonAbort()], codes: ['SSE_DONE_ACCEPTED'] },
  ]) {
    const app = boot([[...row.spec]]); await app.start(); await app.say('reader rejection'); assert.equal(app.h.pendingReads.length, 1); await app.end();
    app.h.pendingReads[0].reject(new Error('controlled non-Abort reader rejection')); await settle(30); await app.flushDebug(); assertEndInvariant(app, row.codes);
  }
});

test('SUPPLEMENTAL: stale non-Abort fetch rejection after End cannot recover or restart', async () => {
  const app = boot([{ pendingFetch: true }]); await app.start(); await app.say('fetch rejection'); assert.equal(app.h.pendingFetches.length, 1); await app.end();
  app.h.pendingFetches[0].reject(new Error('controlled non-Abort fetch rejection')); await settle(30); await app.flushDebug(); assertEndInvariant(app, []);
});

test('LIFECYCLE: offline health blocks warmup, session, microphone, and recognition', async () => {
  const app = boot([], { routes: { '/health': () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'offline' }) }) } });
  await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
  await app.start(false);
  assert.deepEqual(app.h.routes, ['/health']);
  assert.equal(app.h.micCalls, 0); assert.equal(app.h.recognition.length, 0);
  assertIdle(app); assert.match(app.h.elements.get('error-msg').textContent, /offline|voice tutor|server|connection/i);
});

test('LIFECYCLE: missing SpeechRecognition blocks before health or session creation', async () => {
  const app = boot([], { noRecognition: true }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
  await app.start(false);
  assert.deepEqual(app.h.routes, []); assert.equal(app.h.micCalls, 0); assert.equal(app.h.recognition.length, 0); assert.equal(app.h.contexts.length, 0);
  assert.match(app.h.elements.get('status-text').textContent + ' ' + app.h.elements.get('error-msg').textContent, /not supported|Chrome|Edge/i);
});

test('LIFECYCLE: End is enabled during startup and aborts pending health without later progress', async () => {
  {
    const health = deferred(); let healthCalls = 0;
    const app = boot([], { routes: { '/health': () => (++healthCalls === 1 ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'online' }) }) : health.promise) } });
    await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0; app.h.elements.get('start-btn').click(); await settle();
    assert.equal(app.h.elements.get('end-btn').disabled, false); await app.end(); await app.flushDebug();
    const postEnd = [app.h.elements.get('conn').className, app.h.elements.get('conn-label').textContent, app.h.elements.get('error-msg').textContent, app.h.elements.get('status-text').textContent, app.h.debug.length];
    health.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'offline' }) }); await settle(30); await app.flushDebug();
    assert.deepEqual([app.h.elements.get('conn').className, app.h.elements.get('conn-label').textContent, app.h.elements.get('error-msg').textContent, app.h.elements.get('status-text').textContent, app.h.debug.length], postEnd);
    assertIdle(app); assert.deepEqual(app.h.routes.filter((x) => !x.startsWith('/debug/')), ['/health']); assert.equal(app.h.micCalls, 0); assert.equal(app.h.recognition.length, 0);
  }
  {
    const health = deferred(); let healthCalls = 0;
    const app = boot([], { routes: { '/health': () => (++healthCalls === 1 ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ status: 'online' }) }) : health.promise) } });
    await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0; app.h.elements.get('start-btn').click(); await settle();
    await app.end(); await app.flushDebug();
    const postEnd = [app.h.elements.get('conn').className, app.h.elements.get('conn-label').textContent, app.h.elements.get('error-msg').textContent, app.h.elements.get('status-text').textContent, app.h.debug.length];
    health.reject(new Error('controlled late non-Abort health rejection')); await settle(30); await app.flushDebug();
    assert.deepEqual([app.h.elements.get('conn').className, app.h.elements.get('conn-label').textContent, app.h.elements.get('error-msg').textContent, app.h.elements.get('status-text').textContent, app.h.debug.length], postEnd);
    assertIdle(app); assert.deepEqual(app.h.routes.filter((x) => !x.startsWith('/debug/')), ['/health']); assert.equal(app.h.micCalls, 0); assert.equal(app.h.recognition.length, 0);
  }
  {
    const session = deferred(); const sid = 'late-session-unique';
    const app = boot([], { routes: { '/voice/session/start': () => session.promise } }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.elements.get('start-btn').click(); await settle(); assert.equal(app.h.elements.get('end-btn').disabled, false); assert.equal(app.h.routes.includes('/voice/session/start'), true);
    await app.end(); session.resolve({ ok: true, status: 200, json: () => Promise.resolve({ sessionId: sid }) }); await settle(30);
    assert.equal(normalEnds(app, sid).length, 1); assert.equal(app.h.beacons.length, 0); app.unload(); await settle();
    assert.equal(normalEnds(app, sid).length + app.h.beacons.length, 1); assert.equal(app.h.recognition.length, 0); assertIdle(app);
  }
});

test('LIFECYCLE: late getUserMedia fulfillment after End stops every track and cannot create meter state', async () => {
  {
    const mic = deferred(), tracks = [{ stops: 0, stop() { this.stops++; } }, { stops: 0, stop() { this.stops++; } }];
    const app = boot([], { micDeferred: mic }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.elements.get('start-btn').click(); await settle(); assert.equal(app.h.micCalls, 1); assert.equal(app.h.routes.includes('/voice/session/start'), false);
    await app.end(); mic.resolve({ getTracks: () => tracks }); await settle(30);
    assert.deepEqual(tracks.map((x) => x.stops), [1, 1]); assert.equal(app.h.contexts.length, 1, 'only playback context exists'); assert.equal(app.h.rafCalls, 0);
    assert.equal(app.h.routes.includes('/voice/session/start'), false); assert.equal(app.h.elements.get('error-msg').textContent, ''); assertIdle(app);
  }
  {
    const mic = deferred(), app = boot([], { micDeferred: mic }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.elements.get('start-btn').click(); await settle(); assert.equal(app.h.micCalls, 1); await app.end();
    mic.reject(new Error('controlled late non-Abort mic rejection')); await settle(30);
    assert.equal(app.h.routes.includes('/voice/session/start'), false); assert.equal(app.h.elements.get('error-msg').textContent, ''); assert.equal(app.h.elements.get('meter-hint').textContent, 'Speak to test the mic.'); assertIdle(app);
  }
});

test('LIFECYCLE: suspended playback AudioContext resume is awaited before readiness and recognition', async () => {
  {
    const resume = deferred(); const app = boot([], { playbackSuspended: true, resumeDeferred: resume }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.elements.get('start-btn').click(); await settle(); assert.equal(app.context.document.body['data-ready'], 'false'); assert.deepEqual(app.h.routes, []); assert.equal(app.h.micCalls, 0); assert.equal(app.h.recognition.length, 0);
    resume.resolve(); await settle(30); assert.deepEqual(app.h.routes.slice(0, 3), ['/health', '/voice/real-sentence', '/voice/session/start']); assert.equal(app.h.contexts[0].resumes, 1); assert.equal(app.h.micCalls, 1); assert.equal(app.h.recognition.length, 1);
  }
  {
    const resume = deferred(); const app = boot([], { playbackSuspended: true, resumeDeferred: resume }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.elements.get('start-btn').click(); await settle(); resume.reject(new Error('resume denied')); await settle(30);
    assert.deepEqual(app.h.routes, []); assert.equal(app.h.micCalls, 0); assert.equal(app.h.recognition.length, 0); assertIdle(app); assert.match(app.h.elements.get('error-msg').textContent, /resume|audio|playback|start/i);
  }
});

test('LIFECYCLE: successful startup preserves ordered gates and enables one active session', async () => {
  {
    const sid = 'active-session-unique', app = boot([], { sessionId: sid, playbackSuspended: true }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.events.length = 0; app.h.intervals.length = 0;
    app.h.elements.get('start-btn').click(); assert.equal(app.h.elements.get('end-btn').disabled, false); await settle(30);
    assert.equal(app.h.contexts.length, 2); assert.equal(app.h.contexts[0].resumes, 1); assert.deepEqual(app.h.routes.slice(0, 3), ['/health', '/voice/real-sentence', '/voice/session/start']);
    assert.deepEqual(app.h.events.slice(0, 5), ['route:/health', 'route:/voice/real-sentence', 'mic:getUserMedia', 'route:/voice/session/start', 'interval:30000']);
    assert.equal(app.h.intervals.length, 1);
    assert.equal(app.h.micCalls, 1); assert.equal(app.h.recognition.length, 1); assert.equal(app.h.recognition[0].starts, 1); assert.equal(app.h.elements.get('session-chip').textContent, 'Active'); assert.equal(app.h.elements.get('end-btn').disabled, false);
    const routeCount = app.h.routes.length; app.h.elements.get('start-btn').click(); await settle(); assert.equal(app.h.routes.length, routeCount);
    await app.end(); assert.equal(normalEnds(app, sid).length, 1); assert.equal(app.h.beacons.length, 0); app.unload(); await settle();
    assert.equal(normalEnds(app, sid).length + app.h.beacons.length, 1); assertIdle(app);
  }
  {
    const sid = 'recognition-failure-session', app = boot([], { sessionId: sid, recognitionStartError: new Error('recognition start exploded') }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.events.length = 0; app.h.intervals.length = 0;
    app.h.elements.get('start-btn').click(); await settle(30);
    assert.equal(normalEnds(app, sid).length, 1); assert.equal(app.h.beacons.length, 0); assert.equal(app.h.tracks.every((x) => x.stops === 1), true); assert.equal(app.h.contexts.every((x) => x.state === 'closed'), true);
    assertIdle(app); assert.match(app.h.elements.get('error-msg').textContent + ' ' + app.h.elements.get('status-text').textContent, /recognition|speech|start|exploded/i);
    assert.equal(app.h.elements.get('session-chip').textContent, 'Idle'); assert.equal(app.h.intervals.length, 0); assert.equal(app.h.events.includes('interval:30000'), false);
  }
  {
    const sid = 'unload-first-session', app = boot([], { sessionId: sid }); await settle(); app.h.routes.length = 0; app.h.fetchCalls.length = 0;
    app.h.elements.get('start-btn').click(); await settle(30); app.unload(); app.unload(); await settle();
    assert.equal(normalEnds(app, sid).length, 0); assert.equal(app.h.beacons.length, 1);
  }
});
