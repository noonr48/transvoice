'use strict';

const assert = require('node:assert/strict');
const { createCoachDebug } = require('../backend/coach-debug');

function createHarness() {
  let content = '';
  const calls = [];
  const consoleLines = [];
  const timers = new Set();
  const stream = {
    writable: true,
    uncorkCalls: 0,
    on: function() {},
    write: function(value) { calls.push(['stream-write', value]); content += value; },
    uncork: function() { this.uncorkCalls++; calls.push(['uncork', this.uncorkCalls]); },
    end: function() { this.writable = false; },
  };
  return {
    fsImpl: {
      mkdirSync: function(target, options) { calls.push(['mkdir', target, options]); },
      chmodSync: function(target, mode) { calls.push(['chmod', target, mode]); },
      createWriteStream: function(target, options) { calls.push(['stream', target, options]); stream.writable = true; return stream; },
      readFileSync: function() { return content; },
      writeFileSync: function(target, value, options) { calls.push(['write', target, options]); content = value; },
    },
    consoleImpl: {
      log: function(line) { consoleLines.push(line); },
      error: function(line) { consoleLines.push(line); },
    },
    timerImpl: {
      setInterval: function(fn, ms) {
        const handle = { fn: fn, ms: ms, unref: function() { this.unrefCalled = true; } };
        timers.add(handle);
        return handle;
      },
      clearInterval: function(handle) { timers.delete(handle); },
    },
    logDir: '/fake/logs',
    now: function() { return 1700000000000; },
    calls: calls,
    consoleLines: consoleLines,
    timers: timers,
    stream: stream,
    content: function() { return content; },
  };
}

const harness = createHarness();
const debug = createCoachDebug(harness);
debug.clearEvents();
const sentinel = 'LEGACY_SECRET_SENTINEL';
const marker = 'unit-test-marker';
const entry = debug.log('test', marker, { apiKey: sentinel, foo: 'bar' });

assert.equal(entry.cat, 'test', 'log returns entry with category');
assert.match(entry.msg, /unit-test-marker/, 'log returns entry with message');
assert.equal(entry.data.apiKey, '[REDACTED]', 'returned entry is redacted');
const lastWriteBeforeFlush = harness.calls.map(function(call) { return call[0]; }).lastIndexOf('stream-write');
debug.flushLog();
assert.equal(harness.stream.uncorkCalls, 1, 'flush uncorks healthy stream exactly once');
assert.ok(harness.calls.map(function(call) { return call[0]; }).lastIndexOf('uncork') > lastWriteBeforeFlush, 'flush uncork occurs after prior stream writes');
harness.stream.writable = false;
debug.flushLog();
assert.equal(harness.stream.uncorkCalls, 1, 'flush does not uncork an unwritable stream');
harness.stream.writable = true;
assert.match(harness.content(), /unit-test-marker/, 'entry reaches fake file');
assert.ok(debug.tailLines(5).some(function(line) { return line.includes(marker); }), 'tail returns log hit');
assert.ok(debug.grepLines(marker, 10).some(function(line) { return line.includes(marker); }), 'grep returns log hit');
assert.deepEqual(debug.grepLines('[', 10), ['[invalid regex]'], 'invalid regex is rejected');
assert.match(debug.grepLines('(a+)+$', 10)[0], /rejected/, 'ReDoS pattern is rejected');
assert.match(debug.grepLines('a'.repeat(300), 10)[0], /too-long/, 'overlong regex is rejected');

const summary = debug.getSummary();
assert.equal(typeof summary.logFileLines, 'number', 'summary line count is numeric');
assert.ok(summary.logFileLines > 0, 'summary line count is positive');
assert.equal(typeof summary.streamHealthy, 'boolean', 'summary stream health is boolean');
assert.equal(summary.streamHealthy, true, 'stream is healthy');
assert.equal(debug.MAX_LINES, 10000, 'MAX_LINES retains default');
assert.equal(debug.LOG_FILE, '/fake/logs/coach-pipeline.log', 'log filename uses fake directory');
assert.ok(debug.getLogFileLineCount() > 0, 'line count helper is positive');
assert.ok(harness.calls.some(function(call) { return call[0] === 'mkdir' && call[2].mode === 0o700; }), 'directory create mode is 0700');
assert.ok(harness.calls.some(function(call) { return call[0] === 'chmod' && call[1] === '/fake/logs' && call[2] === 0o700; }), 'directory mode is repaired to 0700');
assert.ok(harness.calls.some(function(call) { return call[0] === 'stream' && call[2].mode === 0o600; }), 'file stream mode is 0600');
assert.ok(harness.calls.some(function(call) { return call[0] === 'chmod' && call[1].endsWith('coach-pipeline.log') && call[2] === 0o600; }), 'file mode is repaired to 0600');
assert.ok(!JSON.stringify(debug.getEvents()).includes(sentinel), 'event memory excludes sentinel');
assert.ok(!JSON.stringify(harness.consoleLines).includes(sentinel), 'fake console excludes sentinel');
assert.ok(!harness.content().includes(sentinel), 'fake file excludes sentinel');

debug.close();
assert.equal(harness.timers.size, 0, 'no fake timer remains open');
assert.equal(harness.stream.writable, false, 'fake stream is closed');
console.log('=== coach-debug legacy: passed ===');
