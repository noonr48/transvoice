'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');

const PROTOCOL_VERSION = 1;
const SAMPLE_RATE = 16000;
const MAX_AUDIO_SECONDS = 8;
const MAX_PCM_BYTES = SAMPLE_RATE * 2 * MAX_AUDIO_SECONDS;

function normalizePositiveInteger(value, fallback, minimum = 1) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(minimum, Math.round(numeric)) : fallback;
}

function unavailable(reason) {
  return {
    available: false,
    complete: null,
    probability: null,
    reason,
  };
}

function createVoiceTurnDetector(options = {}) {
  const enabled = options.enabled === true;
  const pythonPath = options.pythonPath || 'python3';
  const workerPath = options.workerPath || path.join(__dirname, '..', 'services', 'smart-turn', 'worker.py');
  const modelPath = options.modelPath || '';
  const spawnImpl = options.spawnImpl || spawn;
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, 500, 20);
  const startupTimeoutMs = normalizePositiveInteger(options.startupTimeoutMs, 3000, 20);
  const maxQueue = normalizePositiveInteger(options.maxQueue, 8);
  const onWitness = typeof options.onWitness === 'function' ? options.onWitness : () => {};

  let state = enabled ? 'unavailable' : 'disabled';
  let child = null;
  let stdoutBuffer = '';
  let nextId = 1;
  let fallbackCount = 0;
  let lastError = null;
  let readyPromise = null;
  let settleReady = null;
  let readyTimer = null;
  const pending = new Map();

  function witness(level, message, metadata) {
    try {
      onWitness(level, 'voice-turn-detector', message, metadata);
    } catch {
      // Observability must never alter turn-taking.
    }
  }

  function settleWorkerReady(value) {
    if (readyTimer) clearTimeout(readyTimer);
    readyTimer = null;
    const settle = settleReady;
    settleReady = null;
    settle?.(value);
  }

  function settlePrediction(entry, value) {
    clearTimeout(entry.timer);
    pending.delete(entry.id);
    entry.resolve(value);
  }

  function failPending(reason) {
    const entries = [...pending.values()];
    for (const entry of entries) settlePrediction(entry, unavailable(reason));
    if (entries.length) fallbackCount += entries.length;
  }

  function degrade(reason, outcome = reason) {
    if (state !== 'closed') state = 'degraded';
    lastError = reason;
    witness('warn', 'Smart Turn is unavailable; conservative silence fallback remains active.', {
      outcome,
      pending: pending.size,
    });
  }

  function handleLine(line) {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch {
      witness('warn', 'Smart Turn worker returned malformed output.', {
        outcome: 'malformed-output',
        pending: pending.size,
      });
      return;
    }
    if (payload?.type === 'ready' && payload.protocol === PROTOCOL_VERSION) {
      state = 'ready';
      lastError = null;
      witness('info', 'Smart Turn worker is ready.', { outcome: 'ready' });
      settleWorkerReady(true);
      return;
    }
    if (payload?.type === 'error') {
      const entry = pending.get(String(payload.id));
      if (!entry) return;
      settlePrediction(entry, unavailable('worker-prediction-error'));
      fallbackCount += 1;
      degrade('worker-prediction-error');
      return;
    }
    if (payload?.type !== 'prediction') return;
    const entry = pending.get(String(payload.id));
    if (!entry) return;
    const probability = Number(payload.probability);
    if (typeof payload.complete !== 'boolean' || !Number.isFinite(probability)) {
      settlePrediction(entry, unavailable('invalid-prediction'));
      fallbackCount += 1;
      degrade('invalid-prediction');
      return;
    }
    settlePrediction(entry, {
      available: true,
      complete: payload.complete,
      probability: Math.min(1, Math.max(0, probability)),
      reason: null,
    });
  }

  function startWorker() {
    if (!enabled || state === 'closed') return Promise.resolve(false);
    if (state === 'ready' && child) return Promise.resolve(true);
    if (readyPromise) return readyPromise;

    state = 'starting';
    readyPromise = new Promise((resolve) => { settleReady = resolve; });
    try {
      const args = [workerPath];
      if (modelPath) args.push('--model', modelPath);
      const worker = spawnImpl(pythonPath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      child = worker;
      readyTimer = setTimeout(() => {
        if (child !== worker || state === 'ready' || state === 'closed') return;
        readyPromise = null;
        settleWorkerReady(false);
        degrade('startup-timeout');
        child = null;
        try { worker.kill?.('SIGTERM'); } catch { /* best-effort timeout cleanup */ }
      }, startupTimeoutMs);
      worker.stdout?.on?.('data', (chunk) => {
        stdoutBuffer += chunk.toString('utf8');
        const lines = stdoutBuffer.split('\n');
        stdoutBuffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) handleLine(line);
      });
      worker.stderr?.on?.('data', () => {
        // Never forward arbitrary worker stderr: dependency errors can contain
        // local paths and turn content must never enter telemetry.
      });
      worker.once?.('error', (error) => {
        if (child !== worker) return;
        settleWorkerReady(false);
        readyPromise = null;
        child = null;
        degrade(error?.code || 'worker-error', 'worker-error');
        failPending('worker-error');
      });
      worker.once?.('exit', () => {
        if (child !== worker) return;
        settleWorkerReady(false);
        readyPromise = null;
        child = null;
        if (state !== 'closed') degrade('worker-exit', 'worker-exit');
        failPending('worker-exit');
      });
    } catch (error) {
      settleWorkerReady(false);
      readyPromise = null;
      child = null;
      degrade(error?.code || 'worker-start-failed', 'worker-start-failed');
      return Promise.resolve(false);
    }
    return readyPromise;
  }

  async function predict(pcm16) {
    if (!enabled) return unavailable('disabled');
    if (state === 'closed') return unavailable('closed');
    if (!Buffer.isBuffer(pcm16) || pcm16.length === 0) return unavailable('empty-audio');
    if (pending.size >= maxQueue) {
      fallbackCount += 1;
      witness('warn', 'Smart Turn queue is full; conservative silence fallback remains active.', {
        outcome: 'queue-full',
        pending: pending.size,
      });
      return unavailable('queue-full');
    }
    const ready = await startWorker();
    if (!ready || !child?.stdin?.writable || state !== 'ready') {
      fallbackCount += 1;
      return unavailable(lastError || 'worker-unavailable');
    }

    const id = String(nextId++);
    const tail = pcm16.subarray(Math.max(0, pcm16.length - MAX_PCM_BYTES));
    return new Promise((resolve) => {
      const entry = { id, resolve, timer: null };
      entry.timer = setTimeout(() => {
        if (!pending.has(id)) return;
        settlePrediction(entry, unavailable('timeout'));
        fallbackCount += 1;
        degrade('timeout');
      }, timeoutMs);
      pending.set(id, entry);
      try {
        child.stdin.write(`${JSON.stringify({
          protocol: PROTOCOL_VERSION,
          type: 'predict',
          id,
          sampleRate: SAMPLE_RATE,
          pcm16Base64: tail.toString('base64'),
        })}\n`);
      } catch {
        settlePrediction(entry, unavailable('worker-write-failed'));
        fallbackCount += 1;
        degrade('worker-write-failed');
      }
    });
  }

  function getStatus() {
    return {
      enabled,
      state,
      available: state === 'ready',
      pending: pending.size,
      fallbackCount,
      lastError,
    };
  }

  function close() {
    if (state === 'closed') return;
    state = 'closed';
    settleWorkerReady(false);
    readyPromise = null;
    failPending('closed');
    try { child?.kill?.('SIGTERM'); } catch { /* best-effort shutdown */ }
    child = null;
  }

  return { close, getStatus, predict, start: startWorker };
}

module.exports = {
  MAX_AUDIO_SECONDS,
  MAX_PCM_BYTES,
  PROTOCOL_VERSION,
  SAMPLE_RATE,
  createVoiceTurnDetector,
};
