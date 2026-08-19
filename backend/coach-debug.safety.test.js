'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createCoachDebug,
  sanitizeDiagnosticValue,
  sanitizeDiagnosticText,
} = require('./coach-debug');

function createHarness(initialContent) {
  let content = initialContent || '';
  const calls = [];
  const consoleLines = [];
  const timers = new Set();
  const streams = [];

  function createStream() {
    const stream = {
      writable: true,
      handlers: {},
      on: function(name, fn) { this.handlers[name] = fn; },
      write: function(value) { content += value; },
      uncork: function() {},
      end: function() { this.writable = false; },
    };
    streams.push(stream);
    return stream;
  }

  return {
    fsImpl: {
      mkdirSync: function(target, options) { calls.push(['mkdir', target, options]); },
      chmodSync: function(target, mode) { calls.push(['chmod', target, mode]); },
      createWriteStream: function(target, options) { calls.push(['stream', target, options]); return createStream(); },
      readFileSync: function() { return content; },
      writeFileSync: function(target, value, options) { calls.push(['rewrite', target, value, options]); content = value; },
    },
    consoleImpl: {
      log: function(line) { consoleLines.push(line); },
      error: function(line) { consoleLines.push(line); },
    },
    timerImpl: {
      setInterval: function(fn, ms) {
        const handle = {
          fn: fn,
          ms: ms,
          unrefCalled: false,
          unref: function() { this.unrefCalled = true; },
        };
        timers.add(handle);
        return handle;
      },
      clearInterval: function(handle) { timers.delete(handle); },
    },
    logDir: '/fake/private-logs',
    now: function() { return 1700000000000; },
    calls: calls,
    consoleLines: consoleLines,
    timers: timers,
    streams: streams,
    content: function() { return content; },
  };
}

function scanSinks(debug, harness) {
  return JSON.stringify({
    events: debug.getEvents(),
    console: harness.consoleLines,
    file: harness.content(),
  });
}

test('exports exact factory and sanitizer surfaces', function() {
  assert.equal(typeof createCoachDebug, 'function');
  assert.equal(typeof sanitizeDiagnosticValue, 'function');
  assert.equal(typeof sanitizeDiagnosticText, 'function');
});

test('deep sanitizer redacts exact key families and preserves safe primitives', function() {
  const sentinel = 'KEY_SENTINEL';
  const input = {
    token: sentinel,
    accessToken: sentinel,
    Authorization: sentinel,
    cookie: sentinel,
    secret: sentinel,
    password: sentinel,
    apiKey: sentinel,
    api_key: sentinel,
    transcript: sentinel,
    prompt: sentinel,
    sessionId: sentinel,
    session_id: sentinel,
    learnerMemo: sentinel,
    ttsText: sentinel,
    tts_request_text: sentinel,
    requestText: sentinel,
    nested: { safeBoolean: false, safeNumber: 17 },
  };
  const sanitized = sanitizeDiagnosticValue(input);
  assert.ok(!JSON.stringify(sanitized).includes(sentinel));
  assert.equal(sanitized.nested.safeBoolean, false);
  assert.equal(sanitized.nested.safeNumber, 17);
  assert.equal(sanitized.apiKey, '[REDACTED]');
  assert.deepEqual(Object.keys(sanitized), Object.keys(sanitized).slice().sort());
});

test('text sanitizer kills Bearer, JWT, token query, TTS, request, prompt, memo, session and transcript text', function() {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJTRU5USU5FTCJ9.signature123';
  const cases = [
    ['BEARER_SENTINEL', 'Bearer BEARER_SENTINEL'],
    ['QUERY_SENTINEL', 'https://local.invalid/path?token=QUERY_SENTINEL&safe=1'],
    ['ACCESS_QUERY_SENTINEL', 'https://local.invalid/path?access_token=ACCESS_QUERY_SENTINEL&safe=1'],
    ['TTS_SENTINEL', 'ttsText=TTS_SENTINEL'],
    ['REQUEST_SENTINEL', 'requestText=REQUEST_SENTINEL'],
    ['PROMPT_SENTINEL', 'prompt=PROMPT_SENTINEL'],
    ['MEMO_SENTINEL', 'learnerMemo=MEMO_SENTINEL'],
    ['SESSION_SENTINEL', 'sessionId=SESSION_SENTINEL'],
    ['TRANSCRIPT_SENTINEL', 'transcript=TRANSCRIPT_SENTINEL'],
  ];
  for (const [sentinel, text] of cases) {
    const sanitized = sanitizeDiagnosticText(text);
    assert.ok(!sanitized.includes(sentinel), sentinel);
    assert.match(sanitized, /\[REDACTED\]/, text);
  }
  assert.ok(!sanitizeDiagnosticText(jwt).includes(jwt));
});

test('sanitizer is deterministic, sorts object keys, preserves array order, and marks cycles exactly', function() {
  const shared = { z: 3, a: 1 };
  const cyclic = { z: shared, a: [3, 1, 2] };
  cyclic.self = cyclic;
  const first = sanitizeDiagnosticValue(cyclic);
  const second = sanitizeDiagnosticValue(cyclic);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.deepEqual(Object.keys(first), ['a', 'self', 'z']);
  assert.deepEqual(first.a, [3, 1, 2]);
  assert.equal(first.self, '[Circular]');
  assert.deepEqual(Object.keys(first.z), ['a', 'z']);
});

test('exact depth, object-key, array-item, and string bounds use [Truncated]', function() {
  const longText = sanitizeDiagnosticText('x'.repeat(700));
  assert.equal(longText.length, 512);
  assert.ok(longText.endsWith('[Truncated]'));

  const array = sanitizeDiagnosticValue(Array.from({ length: 60 }, function(_, index) { return index; }));
  assert.equal(array.length, 40);
  assert.deepEqual(array.slice(0, 3), [0, 1, 2]);
  assert.equal(array[39], '[Truncated]');

  const object = {};
  for (let index = 0; index < 60; index++) object['key' + String(index).padStart(2, '0')] = index;
  const sanitizedObject = sanitizeDiagnosticValue(object);
  assert.equal(Object.keys(sanitizedObject).length, 40);
  assert.equal(sanitizedObject.__truncated__, '[Truncated]');
  assert.deepEqual(Object.keys(sanitizedObject), Object.keys(sanitizedObject).slice().sort());

  const deep = { level: 0 };
  let cursor = deep;
  for (let depth = 1; depth < 9; depth++) { cursor.next = { level: depth }; cursor = cursor.next; }
  const sanitizedDeep = sanitizeDiagnosticValue(deep);
  assert.equal(sanitizedDeep.next.next.next.next.next.next, '[Truncated]');
});

test('factory sanitizes before event, memory, console, file, and immutable return boundaries', function() {
  const harness = createHarness();
  const debug = createCoachDebug(Object.assign({}, harness, { maxEvents: 2 }));
  const sentinel = 'SINK_SENTINEL';
  const returned = debug.log('sessionId=' + sentinel, 'requestText=' + sentinel, {
    apiKey: sentinel,
    nested: { transcript: sentinel },
  });
  assert.ok(Object.isFrozen(returned));
  assert.ok(Object.isFrozen(returned.data));
  assert.throws(function() { returned.data.apiKey = sentinel; }, TypeError);
  assert.ok(!scanSinks(debug, harness).includes(sentinel));
  assert.equal(returned.data.apiKey, '[REDACTED]');

  debug.log('safe', 'second');
  debug.log('safe', 'third');
  assert.equal(debug.getEvents().length, 2);
  assert.equal(debug.getEvents()[0].msg, 'second');
  assert.deepEqual(Object.keys(returned), ['cat', 'data', 'elapsed', 'msg', 't']);
  debug.close();
  assert.equal(harness.timers.size, 0);
});

test('serialized events are capped at 8192 bytes with exact truncation marker', function() {
  const harness = createHarness();
  const debug = createCoachDebug(harness);
  const wide = {};
  for (let outer = 0; outer < 39; outer++) {
    wide['outer' + outer] = {};
    for (let inner = 0; inner < 39; inner++) wide['outer' + outer]['inner' + inner] = 'x'.repeat(512);
  }
  const entry = debug.log('bound', 'large event', wide);
  assert.ok(Buffer.byteLength(JSON.stringify(entry), 'utf8') <= 8192);
  assert.equal(entry.data, '[Truncated]');
  debug.close();
});

test('factory honors maxLines/maxEvents and enforces private modes with unref timer', function() {
  const harness = createHarness();
  const debug = createCoachDebug(Object.assign({}, harness, { maxEvents: 3, maxLines: 7 }));
  assert.equal(debug.MAX_LINES, 7);
  for (let index = 0; index < 5; index++) debug.log('bound', 'entry ' + index);
  assert.equal(debug.getEvents().length, 3);
  assert.equal(debug.getEvents()[0].msg, 'entry 2');
  assert.ok(harness.calls.some(function(call) { return call[0] === 'mkdir' && call[2].mode === 0o700; }));
  assert.ok(harness.calls.some(function(call) { return call[0] === 'chmod' && call[1] === harness.logDir && call[2] === 0o700; }));
  assert.ok(harness.calls.some(function(call) { return call[0] === 'stream' && call[2].mode === 0o600; }));
  assert.ok(harness.calls.some(function(call) { return call[0] === 'chmod' && call[1].endsWith('coach-pipeline.log') && call[2] === 0o600; }));
  const healthy = debug.getSummary();
  assert.equal(healthy.streamHealthy, true);
  assert.equal(healthy.logFile, '/fake/private-logs/coach-pipeline.log');
  const handle = Array.from(harness.timers)[0];
  assert.equal(handle.unrefCalled, true);
  debug.close();
  assert.equal(harness.timers.size, 0);
  assert.ok(harness.streams.every(function(stream) { return !stream.writable; }));
});

test('trim rewrite honors configured maxLines and preserves 0600', function() {
  const harness = createHarness('one\ntwo\nthree\nfour\n');
  const debug = createCoachDebug(Object.assign({}, harness, { maxLines: 2 }));
  const rewrite = harness.calls.find(function(call) { return call[0] === 'rewrite'; });
  assert.ok(rewrite);
  assert.equal(rewrite[2], 'three\nfour\n');
  assert.equal(rewrite[3].mode, 0o600);
  assert.ok(harness.calls.some(function(call) { return call[0] === 'chmod' && call[1].endsWith('coach-pipeline.log') && call[2] === 0o600; }));
  debug.close();
  assert.equal(harness.timers.size, 0);
});

test('sink failures emit only a fixed generic diagnostic', function() {
  const harness = createHarness();
  const sentinel = 'RAW_SINK_ERROR_SENTINEL';
  harness.fsImpl.createWriteStream = function() { throw new Error(sentinel); };
  const debug = createCoachDebug(harness);
  assert.equal(debug.getSummary().streamHealthy, false);
  assert.ok(!JSON.stringify(harness.consoleLines).includes(sentinel));
  assert.ok(harness.consoleLines.includes('[coach-debug] diagnostic sink unavailable'));
  assert.ok(harness.consoleLines.every(function(line) {
    return line === '[coach-debug] diagnostic sink unavailable' || !line.includes('unavailable');
  }));
  debug.close();
  assert.equal(harness.timers.size, 0);
});

test('post-open stream errors use the same fixed generic diagnostic', function() {
  const harness = createHarness();
  const debug = createCoachDebug(harness);
  const sentinel = 'ASYNC_STREAM_ERROR_SENTINEL';
  const stream = harness.streams[harness.streams.length - 1];
  stream.handlers.error(new Error(sentinel));
  assert.equal(debug.getSummary().streamHealthy, false);
  assert.ok(!JSON.stringify(harness.consoleLines).includes(sentinel));
  assert.ok(harness.consoleLines.includes('[coach-debug] diagnostic sink unavailable'));
  debug.close();
  assert.equal(harness.timers.size, 0);
});
