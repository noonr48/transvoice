'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');

const { createVoiceTurnDetector } = require('./voice-turn-detector');

function createFakeWorker(onRequest = () => {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('exit', 0, 'SIGTERM');
  };
  let buffered = '';
  child.stdin.on('data', (chunk) => {
    buffered += chunk.toString('utf8');
    const lines = buffered.split('\n');
    buffered = lines.pop();
    for (const line of lines) {
      if (line.trim()) onRequest(JSON.parse(line), child);
    }
  });
  queueMicrotask(() => child.stdout.write(`${JSON.stringify({ type: 'ready', protocol: 1 })}\n`));
  return child;
}

test('disabled Smart Turn stays optional and never spawns a worker', async () => {
  let spawnCalls = 0;
  const detector = createVoiceTurnDetector({
    enabled: false,
    spawnImpl: () => { spawnCalls += 1; },
  });

  assert.deepEqual(await detector.predict(Buffer.from([1, 2])), {
    available: false,
    complete: null,
    probability: null,
    reason: 'disabled',
  });
  assert.equal(spawnCalls, 0);
  assert.deepEqual(detector.getStatus(), {
    enabled: false,
    state: 'disabled',
    available: false,
    pending: 0,
    fallbackCount: 0,
    lastError: null,
  });
});

test('worker adapter sends bounded PCM through protocol v1 and resolves a prediction', async () => {
  let request = null;
  const detector = createVoiceTurnDetector({
    enabled: true,
    pythonPath: '/runtime/python',
    workerPath: '/app/worker.py',
    modelPath: '/runtime/model.onnx',
    spawnImpl: (command, args, options) => {
      assert.equal(command, '/runtime/python');
      assert.deepEqual(args, ['/app/worker.py', '--model', '/runtime/model.onnx']);
      assert.deepEqual(options.stdio, ['pipe', 'pipe', 'pipe']);
      return createFakeWorker((payload, child) => {
        request = payload;
        child.stdout.write(`${JSON.stringify({
          type: 'prediction', id: payload.id, complete: true, probability: 0.83,
        })}\n`);
      });
    },
  });

  const pcm = Buffer.alloc(10 * 16000 * 2, 7);
  const result = await detector.predict(pcm);

  assert.equal(request.protocol, 1);
  assert.equal(request.sampleRate, 16000);
  assert.equal(Buffer.from(request.pcm16Base64, 'base64').length, 8 * 16000 * 2);
  assert.deepEqual(result, {
    available: true,
    complete: true,
    probability: 0.83,
    reason: null,
  });
  assert.equal(detector.getStatus().state, 'ready');
  detector.close();
});

test('worker can be warmed before the first spoken pause without sending audio', async () => {
  let spawnCalls = 0;
  const witnesses = [];
  const detector = createVoiceTurnDetector({
    enabled: true,
    spawnImpl: () => {
      spawnCalls += 1;
      return createFakeWorker();
    },
    onWitness: (level, category, message, metadata) => {
      witnesses.push({ level, category, message, metadata });
    },
  });

  assert.equal(await detector.start(), true);
  assert.equal(spawnCalls, 1);
  assert.equal(detector.getStatus().state, 'ready');
  assert.deepEqual(witnesses.at(-1).metadata, { outcome: 'ready' });
  detector.close();
});

test('timeout degrades safely, increments a bounded fallback counter, and logs no content', async () => {
  const witnesses = [];
  const detector = createVoiceTurnDetector({
    enabled: true,
    timeoutMs: 20,
    spawnImpl: () => createFakeWorker(),
    onWitness: (level, category, message, metadata) => {
      witnesses.push({ level, category, message, metadata });
    },
  });

  const result = await detector.predict(Buffer.from([11, 12, 13, 14]));

  assert.equal(result.available, false);
  assert.equal(result.complete, null);
  assert.equal(result.reason, 'timeout');
  assert.equal(detector.getStatus().state, 'degraded');
  assert.equal(detector.getStatus().fallbackCount, 1);
  assert.equal(JSON.stringify(witnesses).includes('CwwN'), false);
  const timeoutWitness = witnesses.find((entry) => entry.metadata?.outcome === 'timeout');
  assert.deepEqual(Object.keys(timeoutWitness.metadata).sort(), ['outcome', 'pending']);
  detector.close();
});

test('queue overflow and worker crash fail open to the conservative silence policy', async () => {
  let child;
  const detector = createVoiceTurnDetector({
    enabled: true,
    maxQueue: 1,
    timeoutMs: 1000,
    spawnImpl: () => {
      child = createFakeWorker();
      return child;
    },
  });

  const pending = detector.predict(Buffer.alloc(3200));
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(await detector.predict(Buffer.alloc(3200)), {
    available: false,
    complete: null,
    probability: null,
    reason: 'queue-full',
  });
  child.emit('exit', 1, null);
  assert.equal((await pending).reason, 'worker-exit');
  assert.equal(detector.getStatus().state, 'degraded');
  assert.equal(detector.getStatus().pending, 0);
  detector.close();
});

test('malformed worker output never resolves a turn as complete', async () => {
  const detector = createVoiceTurnDetector({
    enabled: true,
    timeoutMs: 20,
    spawnImpl: () => {
      const child = createFakeWorker((_payload, worker) => {
        worker.stdout.write('{not-json}\n');
      });
      return child;
    },
  });

  const result = await detector.predict(Buffer.alloc(3200));
  assert.equal(result.complete, null);
  assert.equal(result.reason, 'timeout');
  detector.close();
});

test('a worker that never becomes ready cannot hang spoken turn-taking', async () => {
  const detector = createVoiceTurnDetector({
    enabled: true,
    startupTimeoutMs: 20,
    spawnImpl: () => {
      const child = new EventEmitter();
      child.stdout = new PassThrough();
      child.stderr = new PassThrough();
      child.stdin = new PassThrough();
      child.kill = () => child.emit('exit', 0, 'SIGTERM');
      return child;
    },
  });

  const result = await detector.predict(Buffer.alloc(3200));
  assert.equal(result.complete, null);
  assert.equal(result.reason, 'startup-timeout');
  assert.equal(detector.getStatus().state, 'degraded');
  detector.close();
});
