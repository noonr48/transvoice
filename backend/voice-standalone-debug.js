'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const DEFAULT_CAPACITY = 1000;
const DEFAULT_LOG_MAX_BYTES = 1024 * 1024;
const DEFAULT_HEALTH_STALE_MS = 150000;
const DEFAULT_HEARTBEAT_MS = 60000;
const MAX_DEPTH = 6;
const MAX_KEYS = 40;
const MAX_ITEMS = 40;
const MAX_STRING = 512;
const MAX_SERIALIZED = 8192;
const SECRET_KEY = /token|authorization|cookie|secret|password|api[_-]?key|transcript|prompt|session[_-]?id|learner[_-]?memo|tts|request[_-]?text/i;
const SECRET_TEXT = /(bearer\s+[a-z0-9._~+\/-]+|(?:token|authorization|cookie|secret|password|api[_-]?key|session[_-]?id|learner[_-]?memo|transcript|prompt)=([^\s&]+)|eyJ[a-z0-9_-]+\.[a-z0-9_-]+\.[a-z0-9_-]+)/gi;
const ROUTE_NOUNS = new Set(['session', 'sessions', 'turn', 'turns', 'task', 'tasks', 'reference', 'references', 'attempt', 'attempts', 'milestone', 'milestones', 'job', 'jobs', 'agent', 'agents', 'clip', 'clips']);
const FIXED_ACTIONS = new Set(['start', 'stop', 'freeze', 'notepad', 'todo', 'frozen', 'prune', 'export', 'telemetry', 'status', 'analytics', 'export-golden', 'analyze', 'audio', 'pin', 'preferences', 'knowledge-access', 'list', 'current', 'next', 'message', 'coach', 'preset', 'take', 'disarm', 'end']);
const FAILURE_CLASSES = new Set(['never-received', 'not-joined', 'dead-function', 'boot-skip', 'not-connected', 'wrong-path', 'fallback-masking', 'rot', 'partial-function', 'contract-drift']);
const CLIENT_EVENT_CLASSES = new Set([...FAILURE_CLASSES, 'ok']);
const CLIENT_EVENT_SEAMS = new Set([
  'client-boot', 'client-network', 'client-runtime', 'control',
  // 2026-07-27 field repair: the CLIENT end of the transcript -> coach-reply
  // crossing. A finished transcript that the client silently declines to submit
  // is indistinguishable, from the server, from a turn that was never spoken —
  // which is exactly how a live turn died unexplained. This seam names the
  // decision every time it is made.
  'coach-turn-dispatch',
  'gateway-health', 'practice-line-fallback', 'tts-playback', 'tts-synthesis',
  'turn-telemetry', 'voice-api', 'voice-input-capture', 'voice-input-handoff',
]);
const CLIENT_EVENT_CODES = new Set([
  'backend-aborted', 'backend-cors-suspected', 'backend-http', 'backend-network',
  'backend-timeout', 'backend-unknown', 'boot-incomplete', 'boot-ready', 'boot-start',
  'boot-timeout', 'browser-offline', 'control-activated', 'control-effect',
  'control-observed', 'startup-failed', 'startup-health-degraded',
  'fallback-repaired', 'instruction-length-invalid',
  'pcm-overflow', 'pcm-underrun', 'pcm-playback-complete', 'playback-interrupted',
  'target-text-generated', 'listening-yielded-to-coach-speech',
  'audio-context-not-running', 'script-processor-capture-started',
  'script-processor-first-pcm', 'script-processor-no-pcm',
  'worklet-capture-started', 'worklet-first-pcm', 'worklet-no-pcm',
  'turn-telemetry-http', 'turn-telemetry-network', 'uncaught-error',
  'unhandled-rejection',
  // 2026-07-27 field repair — every outcome of the client's auto-submit
  // decision, so "the coach never replied" always has a named cause on ONE side
  // of the wire or the other. `dispatched` is the only healthy one; each of the
  // rest was a silent return before this line existed.
  'coach-turn-dispatched', 'coach-turn-skipped-duplicate-segment',
  'coach-turn-skipped-no-transcript', 'coach-turn-skipped-manual',
  'coach-turn-declined-no-session', 'coach-turn-declined-not-connected',
  'coach-turn-declined-intent-routed', 'coach-turn-declined-scope-intent',
  'coach-turn-declined-owner-superseded',
  'coach-turn-declined-no-shell',
]);
const CLIENT_PHASES = new Set([
  'app-ready',
  'bootstrap-catch',
  'bundle-start',
  'health-ready',
  'pre-bundle',
  'session-ready',
  'unknown',
  'workflow-ready',
]);
const CLIENT_CONTROLS = new Set([
  'anonymous-button', 'tv-mode-btn-coach', 'tv-mode-btn-explore',
  'voice-advanced-toggle', 'voice-coach-input-provider-toggle', 'voice-coach-live-toggle',
  'voice-coach-provider-toggle', 'voice-coach-quick-action', 'voice-coach-send',
  'voice-coach-speech-toggle', 'voice-coach-voice-toggle', 'voice-conditioning-prompt-upload',
  'voice-conditioning-reference-upload', 'voice-conditioning-save', 'voice-deeptutor-next',
  'voice-deeptutor-start', 'voice-end-session', 'voice-forecast-generate',
  'voice-front-door-begin', 'voice-front-door-explore', 'voice-front-door-mic-check',
  'voice-front-door-presets-back', 'voice-front-door-record', 'voice-front-door-record-cancel',
  'voice-front-door-record-stop', 'voice-front-door-skip', 'voice-hear-line',
  'voice-lesson-debrief-dismiss', 'voice-lesson-debrief-not', 'voice-lesson-debrief-rough',
  'voice-lesson-debrief-well', 'voice-lesson-intent-break', 'voice-lesson-intent-help',
  'voice-lesson-intent-listen', 'voice-lesson-mirror-close', 'voice-lesson-mirror-link',
  'voice-lesson-mirror-play', 'voice-lesson-pin-offer-button', 'voice-lesson-replay-close',
  'voice-lesson-replay-offer', 'voice-lesson-sentence-cancel', 'voice-lesson-sentence-choose',
  'voice-lesson-sentence-pick', 'voice-line-easier', 'voice-line-harder',
  'voice-line-more-toggle', 'voice-line-next', 'voice-line-pin', 'voice-line-regenerate',
  'voice-mic-check-close', 'voice-mic-check-rerun', 'voice-mic-check-start',
  'voice-remove-reference', 'voice-save-handmade-preset', 'voice-save-reference-preset',
  'voice-review-row-listen',
  'voice-seed-custom-preset', 'voice-session-scope', 'voice-sound-spelling-toggle',
  'voice-start-session', 'voice-toggle-forecast-path', 'voice-toggle-live-path',
  'voice-toggle-reference-path', 'voice-welcome-back-change', 'voice-welcome-back-continue',
  'tv-coach-preset-button', 'tv-coach-session-toggle', 'tv-coach-upload-cancel',
  'tv-coach-upload-open', 'tv-coach-upload-save',
  'vs-studio-toggle',
]);
const CLIENT_EFFECTS = new Set([
  'listening-started', 'no-dom-change', 'preset-selected', 'replay-opened',
  'session-stopped', 'speech-failed', 'speech-started', 'state-changed',
]);
const CLIENT_STATUSES = new Set(['failed', 'received', 'succeeded']);
const CLIENT_VISIBILITIES = new Set(['hidden', 'prerender', 'visible']);
const CLIENT_DATA_KEYS = new Set([
  'attempt', 'changed', 'col', 'control', 'effect', 'line', 'online', 'phase',
  'status', 'visibility', 'sourceSampleRate', 'playbackSampleRate',
  'queuedSamples', 'playedSamples', 'durationMs', 'underrunCount',
]);
const CLIENT_AUDIO_COUNT_KEYS = new Set([
  'sourceSampleRate', 'playbackSampleRate', 'queuedSamples', 'playedSamples',
  'durationMs', 'underrunCount',
]);

function resolveStandaloneWitnessPaths(env = process.env) {
  const root = env.TRANSVOICE_TELEMETRY_DIR
    || path.join(os.homedir(), '.local', 'share', 'sloane', 'transvoice');
  return {
    logPath: env.TRANSVOICE_WITNESS_LOG || path.join(root, 'witness.jsonl'),
    statusPath: env.TRANSVOICE_TELEMETRY_STATUS || path.join(root, 'status.json'),
  };
}

function classifyWitnessSinkError(error) {
  return /ENOENT|ENOTDIR/i.test(String(error)) ? 'wrong-path' : 'partial-function';
}

function createPersistentWitnessSink(options = {}) {
  const fsImpl = options.fsImpl || fs;
  const now = options.now || Date.now;
  const logger = options.logger || console;
  const setIntervalImpl = options.setIntervalImpl || setInterval;
  const clearIntervalImpl = options.clearIntervalImpl || clearInterval;
  const resolved = resolveStandaloneWitnessPaths(options.env || process.env);
  const logPath = options.logPath || resolved.logPath;
  const statusPath = options.statusPath || resolved.statusPath;
  const maxBytes = Math.max(4096, Number(options.maxBytes) || DEFAULT_LOG_MAX_BYTES);
  const maxStaleMs = Math.max(1000, Number(options.maxStaleMs) || DEFAULT_HEALTH_STALE_MS);
  const heartbeatMs = Math.max(1000, Number(options.heartbeatMs) || DEFAULT_HEARTBEAT_MS);
  let timer = null;
  let sinkWarningEmitted = false;
  const state = {
    state: 'starting',
    ts: Number(now()),
    startedAt: Number(now()),
    lastSuccessAt: null,
    failCount: 0,
    lastError: null,
    lastErrorClass: null,
  };

  const publicState = () => ({
    state: state.state,
    ts: state.ts,
    startedAt: state.startedAt,
    lastSuccessAt: state.lastSuccessAt,
    failCount: state.failCount,
    lastError: state.lastError,
    lastErrorClass: state.lastErrorClass,
  });

  function ensureParent(filePath) {
    const parent = path.dirname(filePath);
    fsImpl.mkdirSync(parent, { recursive: true, mode: 0o700 });
    fsImpl.chmodSync?.(parent, 0o700);
  }

  function writeStatus() {
    ensureParent(statusPath);
    const temporaryPath = `${statusPath}.tmp`;
    fsImpl.writeFileSync(temporaryPath, `${JSON.stringify(publicState())}\n`, { encoding: 'utf8', mode: 0o600 });
    fsImpl.renameSync(temporaryPath, statusPath);
    fsImpl.chmodSync?.(statusPath, 0o600);
  }

  function markFailure(error) {
    state.state = 'degraded';
    state.ts = Number(now());
    state.failCount += 1;
    state.lastError = sanitizeStandaloneDebugText(error?.code || error?.name || 'sink-write-failed', 80);
    state.lastErrorClass = classifyWitnessSinkError(error);
    if (!sinkWarningEmitted) {
      sinkWarningEmitted = true;
      logger.error?.(`[voice-telemetry] persistent sink unavailable (${state.lastErrorClass}:${state.lastError})`);
    }
  }

  function heartbeat() {
    state.ts = Number(now());
    try {
      ensureParent(logPath);
      const handle = fsImpl.openSync?.(logPath, 'a', 0o600);
      if (handle !== undefined) fsImpl.closeSync?.(handle);
      fsImpl.chmodSync?.(logPath, 0o600);
      state.state = 'ok';
      state.lastSuccessAt = state.ts;
      state.lastError = null;
      state.lastErrorClass = null;
      writeStatus();
      sinkWarningEmitted = false;
    } catch (error) {
      markFailure(error);
    }
  }

  function append(row) {
    try {
      ensureParent(logPath);
      try {
        if (fsImpl.statSync(logPath).size > maxBytes) {
          fsImpl.renameSync(logPath, `${logPath}.1`);
        }
      } catch (error) {
        if (error?.code !== 'ENOENT') throw error;
      }
      fsImpl.appendFileSync(logPath, `${JSON.stringify(row)}\n`, { encoding: 'utf8', mode: 0o600 });
      fsImpl.chmodSync?.(logPath, 0o600);
      state.state = 'ok';
      state.ts = Number(now());
      state.lastSuccessAt = state.ts;
      state.lastError = null;
      state.lastErrorClass = null;
      writeStatus();
      sinkWarningEmitted = false;
      return true;
    } catch (error) {
      markFailure(error);
      return false;
    }
  }

  function start() {
    append({
      ts: new Date(now()).toISOString(),
      level: 'info',
      component: 'voice-tutor',
      seam: 'S6:persistent-sink',
      class: 'boot',
      code: 'telemetry_boot',
    });
    if (!timer) {
      timer = setIntervalImpl(heartbeat, heartbeatMs);
      timer?.unref?.();
    }
  }

  function record(event) {
    // Failures are always durable. Control traces are the one healthy-path
    // exception: without them a remote "button did nothing" report has only
    // the server end of the crossing and cannot distinguish a dead handler
    // from a transport failure. Other info/debug chatter stays ring-only.
    const durableControlTrace = event?.level === 'info' && event?.kind === 'client:control';
    if (!event || (!['warn', 'error'].includes(event.level) && !durableControlTrace)) return true;
    return append({
      ts: event.iso,
      level: event.level,
      component: 'voice-tutor',
      seam: event.kind,
      class: event.data?.class || 'partial-function',
      code: event.msg,
      traceId: event.traceId,
      data: event.data,
    });
  }

  function health() {
    const ageMs = Math.max(0, Number(now()) - state.ts);
    const stale = ageMs > maxStaleMs;
    return {
      ...publicState(),
      state: stale ? 'red' : state.state,
      stale,
      ageMs,
      maxStaleMs,
    };
  }

  function close() {
    if (timer) clearIntervalImpl(timer);
    timer = null;
  }

  return { append, close, health, heartbeat, record, start };
}

function sanitizeStandaloneDebugText(value, maxLength = MAX_STRING) {
  return String(value ?? '')
    .replace(SECRET_TEXT, '[REDACTED]')
    .slice(0, Math.max(0, Math.min(MAX_STRING, maxLength)));
}

function sanitizeStandaloneDebugValue(value, options = {}, seen = new WeakSet(), depth = 0) {
  if (value == null || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') return sanitizeStandaloneDebugText(value, options.maxString || MAX_STRING);
  if (typeof value === 'bigint') return String(value);
  if (typeof value !== 'object') return sanitizeStandaloneDebugText(String(value));
  if (seen.has(value)) return '[Circular]';
  if (depth >= MAX_DEPTH) return '[Truncated]';
  seen.add(value);
  let output;
  if (Array.isArray(value)) {
    output = value.slice(0, MAX_ITEMS).map((entry) => sanitizeStandaloneDebugValue(entry, options, seen, depth + 1));
    if (value.length > MAX_ITEMS) output.push('[Truncated]');
  } else {
    output = {};
    const keys = Object.keys(value).sort().slice(0, MAX_KEYS);
    for (const key of keys) {
      output[key] = SECRET_KEY.test(key)
        ? '[REDACTED]'
        : sanitizeStandaloneDebugValue(value[key], options, seen, depth + 1);
    }
    if (Object.keys(value).length > MAX_KEYS) output._truncated = true;
  }
  seen.delete(value);
  try {
    if (JSON.stringify(output).length > MAX_SERIALIZED) return '[Truncated]';
  } catch { return '[Truncated]'; }
  return output;
}

function sanitizeRequestPath(value, routeTemplate = '') {
  const rawPath = String(routeTemplate || value || '/').split(/[?#]/, 1)[0] || '/';
  const segments = rawPath.replace(/\/{2,}/g, '/').split('/').filter(Boolean);
  const output = [];
  let redactNext = false;
  for (const segment of segments) {
    if (segment === '*') { output.push('*'); redactNext = false; continue; }
    if (segment.startsWith(':')) { output.push(':redacted'); redactNext = false; continue; }
    if (redactNext && !FIXED_ACTIONS.has(segment.toLowerCase())) {
      output.push(':redacted');
      redactNext = false;
      continue;
    }
    output.push(segment.slice(0, 64));
    redactNext = ROUTE_NOUNS.has(segment.toLowerCase());
  }
  return (`/${output.join('/')}` || '/').slice(0, 512);
}

function sanitizeRequestUrl(value, routeTemplate = '') {
  const raw = String(value || '');
  const hashIndex = raw.indexOf('#');
  const beforeFragment = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = beforeFragment.indexOf('?');
  const queryPresent = queryIndex >= 0;
  let queryParamCount = 0;
  if (queryPresent) {
    const query = beforeFragment.slice(queryIndex + 1);
    queryParamCount = Math.min(32, query.split('&').filter(Boolean).length);
  }
  return {
    path: sanitizeRequestPath(raw, routeTemplate),
    queryPresent,
    queryParamCount,
  };
}

function normalizeTraceId(value) {
  const candidate = String(value || '').trim();
  return /^[a-z0-9-]{6,64}$/i.test(candidate) ? candidate : null;
}

function normalizeClientTraceId(value) {
  const candidate = String(value || '').trim();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(candidate)
    ? candidate
    : null;
}

function normalizeClientDebugEvent(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new TypeError('client event must be an object');
  }
  const schema = String(body.schema || '');
  if (schema !== 'transvoice.client_failure.v1') {
    throw new TypeError('unsupported client event schema');
  }
  const level = ['error', 'warn', 'info'].includes(body.level) ? body.level : null;
  const seam = sanitizeStandaloneDebugText(body.seam || '', 48);
  const failureClass = sanitizeStandaloneDebugText(body.class || '', 32);
  const code = sanitizeStandaloneDebugText(body.code || '', 80);
  const phase = sanitizeStandaloneDebugText(body.phase || 'unknown', 48);
  const baseCode = code.endsWith('.suppressed') ? code.slice(0, -11) : code;
  if (!level || !CLIENT_EVENT_SEAMS.has(seam) || !CLIENT_EVENT_CLASSES.has(failureClass) || !CLIENT_EVENT_CODES.has(baseCode) || !CLIENT_PHASES.has(phase)) {
    throw new TypeError('invalid client event contract');
  }
  const data = {};
  if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
    for (const key of Object.keys(body.data).sort()) {
      if (!CLIENT_DATA_KEYS.has(key)) continue;
      const value = body.data[key];
      if (typeof value === 'boolean') {
        data[key] = value;
      } else if (typeof value === 'number' && Number.isFinite(value)) {
        if (key === 'status' && Number.isInteger(value) && value >= 100 && value <= 599) data[key] = value;
        else if (key === 'attempt' && Number.isInteger(value) && value >= 0 && value <= 1000000) data[key] = value;
        else if ((key === 'line' || key === 'col') && Number.isInteger(value) && value >= 0 && value <= 10000000) data[key] = value;
        else if (CLIENT_AUDIO_COUNT_KEYS.has(key) && Number.isInteger(value) && value >= 0 && value <= 1000000000) data[key] = value;
      } else if (typeof value === 'string') {
        const safeValue = sanitizeStandaloneDebugText(value, 48);
        if (key === 'control' && CLIENT_CONTROLS.has(safeValue)) data[key] = safeValue;
        else if (key === 'effect' && CLIENT_EFFECTS.has(safeValue)) data[key] = safeValue;
        else if (key === 'phase' && CLIENT_PHASES.has(safeValue)) data[key] = safeValue;
        else if (key === 'status' && CLIENT_STATUSES.has(safeValue)) data[key] = safeValue;
        else if (key === 'visibility' && CLIENT_VISIBILITIES.has(safeValue)) data[key] = safeValue;
      }
    }
  }
  return {
    level,
    seam,
    failureClass,
    code,
    phase,
    traceId: normalizeClientTraceId(body.traceId),
    data,
  };
}

function createDebugBus({ capacity = DEFAULT_CAPACITY, logger = console, now = Date.now, sink = null } = {}) {
  const cap = Math.max(100, Math.floor(capacity || DEFAULT_CAPACITY));
  const events = [];
  const priority = new Set(['error', 'warn']);
  const failuresBySeam = new Map();
  let seq = 0;
  function push(level, kind, msg, data = null, reqId = null) {
    seq += 1;
    const safeLevel = ['error', 'warn', 'info', 'debug'].includes(level) ? level : 'info';
    const candidate = {
      seq,
      ts: Number(now()),
      iso: new Date(now()).toISOString(),
      level: safeLevel,
      kind: sanitizeStandaloneDebugText(kind || 'system', 32),
      msg: sanitizeStandaloneDebugText(msg || '', 512),
      data: sanitizeStandaloneDebugValue(data),
      traceId: normalizeTraceId(reqId),
    };
    if (JSON.stringify(candidate).length > MAX_SERIALIZED) candidate.data = '[Truncated]';
    const evt = Object.freeze(candidate);
    events.push(evt);
    while (events.length > cap) {
      const index = events.findIndex((entry) => !priority.has(entry.level));
      events.splice(index < 0 ? 0 : index, 1);
    }
    const mirror = `${evt.kind}: ${evt.msg}`;
    if (safeLevel === 'error') logger.error?.(`[debug-bus] ${mirror}`);
    else if (safeLevel === 'warn') logger.warn?.(`[debug-bus] ${mirror}`);
    if (priority.has(safeLevel)) {
      const previous = failuresBySeam.get(evt.kind) || { failCount: 0 };
      failuresBySeam.set(evt.kind, {
        failCount: previous.failCount + 1,
        lastFailureAt: evt.ts,
        lastClass: evt.data?.class || 'partial-function',
        lastCode: evt.msg,
      });
    }
    sink?.record?.(evt);
    return evt;
  }
  function since(cursor) { const from = Number(cursor) || 0; return events.filter((event) => event.seq > from); }
  function snapshot() { return { capacity: cap, count: events.length, seq, oldest: events[0] || null, newest: events[events.length - 1] || null }; }
  function health() {
    const sinkHealth = sink?.health?.() || { state: 'memory-only', stale: false };
    return {
      status: sinkHealth.state,
      stale: sinkHealth.stale,
      sink: sinkHealth,
      failures: Object.fromEntries(failuresBySeam),
    };
  }
  sink?.start?.();
  return { close: () => sink?.close?.(), health, push, since, snapshot };
}

function requestLoggingMiddleware(bus, options = {}) {
  const quietPrefixes = options.quietPrefixes || ['/assets/', '/favicon', '/fonts', '/voice-tutor.webmanifest'];
  const mutePrefixes = options.mutePrefixes || ['/voice/debug/'];
  return function debugRequestLogger(req, res, next) {
    const rawUrl = req.originalUrl || req.url || '';
    if (mutePrefixes.some((prefix) => rawUrl.startsWith(prefix))) { next(); return; }
    const reqId = crypto.randomBytes(6).toString('hex');
    req.debugReqId = reqId;
    res.setHeader?.('X-Debug-ReqId', reqId);
    const start = req.rawBodyStartAt || Date.now();
    let logged = false;
    const finish = (aborted = false) => {
      if (logged) return;
      logged = true;
      const ms = Math.max(0, Date.now() - start);
      const status = Number(res.statusCode) || 0;
      const method = sanitizeStandaloneDebugText(req.method || 'UNKNOWN', 12).toUpperCase();
      const safeUrl = sanitizeRequestUrl(rawUrl, `${req.baseUrl || ''}${req.route?.path || ''}`);
      const isQuiet = quietPrefixes.some((prefix) => safeUrl.path.startsWith(prefix));
      const level = aborted || status >= 400 ? (status >= 500 ? 'error' : 'warn') : (isQuiet ? 'debug' : 'info');
      bus.push(level, 'http', `${method} ${safeUrl.path} ${aborted ? 'aborted' : status} ${ms}ms`, {
        method, path: safeUrl.path, status, ms,
        ...(aborted ? { class: 'never-received' } : {}),
        ...(!aborted && status >= 500 ? { class: 'partial-function' } : {}),
        ...(!aborted && status >= 400 && status < 500 ? { class: 'contract-drift' } : {}),
        queryPresent: safeUrl.queryPresent,
        queryParamCount: safeUrl.queryParamCount,
        hasOrigin: Boolean(req.headers?.origin),
        hasUserAgent: Boolean(req.headers?.['user-agent']),
        ...(aborted ? { aborted: true } : {}),
      }, reqId);
      res.removeListener?.('finish', onFinish);
      res.removeListener?.('close', onClose);
    };
    const onFinish = () => finish(false);
    const onClose = () => { if (!res.writableEnded) finish(true); };
    res.once('finish', onFinish);
    res.once('close', onClose);
    next();
  };
}

function attachDebugRoutes(app, bus, options = {}) {
  const healthProbe = options.healthProbe || (async () => ({}));
  const getRuntimeStats = options.getRuntimeStats || (() => ({ uptime_s: Math.round(process.uptime()), memory_mb: Math.round(process.memoryUsage().rss / 1024 / 1024), node: process.version }));
  const now = options.now || Date.now;
  const clientEventRateLimit = Math.max(10, Number(options.clientEventRateLimit) || 120);
  let clientEventWindowStartedAt = Number(now());
  let clientEventCount = 0;
  let clientRateLimitWitnessed = false;
  app.post('/voice/debug/event', (req, res) => {
    const currentTime = Number(now());
    if (currentTime - clientEventWindowStartedAt >= 60000) {
      clientEventWindowStartedAt = currentTime;
      clientEventCount = 0;
      clientRateLimitWitnessed = false;
    }
    clientEventCount += 1;
    if (clientEventCount > clientEventRateLimit) {
      if (!clientRateLimitWitnessed) {
        clientRateLimitWitnessed = true;
        bus.push('warn', 'client-ingest', 'client_event_rate_limited', { class: 'contract-drift' }, req.debugReqId);
      }
      res.status(429).json({ ok: false, error: 'client event rate limited' });
      return;
    }
    const handle = (body) => {
      let event;
      try {
        event = normalizeClientDebugEvent(body);
      } catch {
        bus.push('warn', 'client-ingest', 'client_event_rejected', { class: 'contract-drift' }, req.debugReqId);
        res.status(400).json({ ok: false, error: 'invalid client event' });
        return;
      }
      bus.push(event.level, `client:${event.seam}`, event.code, {
        class: event.failureClass,
        phase: event.phase,
        ...event.data,
      }, event.traceId || req.debugReqId);
      res.json({ ok: true, seq: bus.snapshot().seq });
    };
    if (req.body !== undefined) { handle(req.body); return; }
    const chunks = [];
    let bytes = 0;
    let terminal = false;
    const cleanup = () => { req.removeListener('data', onData); req.removeListener('error', onError); req.removeListener('end', onEnd); };
    const fail = (status, error) => {
      if (terminal) return;
      terminal = true;
      cleanup();
      bus.push('warn', 'client-ingest', status === 413 ? 'client_event_too_large' : 'client_event_invalid', { class: 'contract-drift', status }, req.debugReqId);
      res.status(status).json({ ok: false, error });
    };
    const onData = (chunk) => { bytes += chunk.length; if (bytes > 65536) { fail(413, 'payload too large'); req.destroy?.(); } else chunks.push(chunk); };
    const onError = () => fail(400, 'invalid request');
    const onEnd = () => {
      if (terminal) return;
      cleanup();
      try {
        terminal = true;
        handle(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {});
      } catch {
        terminal = false;
        fail(400, 'invalid json');
      }
    };
    req.on('data', onData); req.on('error', onError); req.on('end', onEnd);
  });
  app.get('/voice/debug/events', (req, res) => {
    const since = Math.max(0, parseInt(req.query?.since, 10) || 0);
    const limit = Math.max(1, Math.min(parseInt(req.query?.limit, 10) || 200, 1000));
    const events = bus.since(since).slice(-limit);
    res.json({ ok: true, since, upTo: events.length ? events[events.length - 1].seq : since, events, snapshot: bus.snapshot() });
  });
  app.get('/voice/debug/health', async (_req, res) => {
    let upstream = { status: 'unknown' };
    try { upstream = sanitizeStandaloneDebugValue(await healthProbe()); } catch { upstream = { status: 'unavailable' }; }
    res.json({ ok: true, ...sanitizeStandaloneDebugValue(getRuntimeStats()), bus: bus.snapshot(), telemetry: bus.health?.(), upstream });
  });
}

function attachWsLogging(wss, bus) {
  if (!wss?.on) return;
  wss.on('connection', (ws, req) => {
    const safeUrl = sanitizeRequestUrl(req?.url || req?.originalUrl || '/');
    bus.push('info', 'ws-proxy', `WS connect ${safeUrl.path}`, safeUrl);
    ws.on('close', () => bus.push('debug', 'ws-proxy', `WS closed ${safeUrl.path}`, safeUrl));
    ws.on('error', () => bus.push('error', 'ws-proxy', `WS error ${safeUrl.path}`, { ...safeUrl, outcome: 'error' }));
  });
}

module.exports = {
  attachDebugRoutes,
  attachWsLogging,
  createDebugBus,
  createPersistentWitnessSink,
  normalizeClientDebugEvent,
  requestLoggingMiddleware,
  resolveStandaloneWitnessPaths,
  sanitizeStandaloneDebugText,
  sanitizeStandaloneDebugValue,
  sanitizeRequestPath,
  sanitizeRequestUrl,
};
