'use strict';

const realFs = require('fs');
const path = require('path');

const DEFAULT_LOG_DIR = path.resolve(__dirname, '..', 'logs');
const LOG_FILE = path.join(DEFAULT_LOG_DIR, 'coach-pipeline.log');
const MAX_LINES = 10000;
const MAX_EVENTS = 200;
const MAX_TAIL_LINES = 5000;
const MAX_REGEX_LEN = 200;
const MAX_DEPTH = 6;
const MAX_KEYS = 40;
const MAX_ITEMS = 40;
const MAX_STRING = 512;
const MAX_EVENT_BYTES = 8192;
const REDACTED = '[REDACTED]';
const CIRCULAR = '[Circular]';
const TRUNCATED = '[Truncated]';

const SENSITIVE_KEYS = new Set([
  'token', 'authorization', 'cookie', 'secret', 'password', 'apikey',
  'transcript', 'prompt', 'sessionid', 'learnermemo', 'ttstext',
  'ttsrequesttext', 'requesttext', 'learnertext', 'audiodata',
  'audiobuffer', 'audiobytes', 'audiobase64',
]);
const SENSITIVE_LABEL = '(?:(?:access|refresh|id)?[_-]?token|authorization|cookie|secret|password|api[_-]?key|transcript|prompt|session[_-]?id|learner[_-]?memo|tts[_-]?(?:request[_-]?)?text|request[_-]?text|learner[_-]?text|audio[_-]?(?:data|buffer|bytes|base64))';
const CONTENT_ASSIGNMENT = new RegExp('\\b(?:transcript|prompt|learner[_-]?memo|tts[_-]?(?:request[_-]?)?text|request[_-]?text|learner[_-]?text)\\s*[:=]\\s*[^\\n]*', 'gi');
const CREDENTIAL_ASSIGNMENT = new RegExp('\\b' + SENSITIVE_LABEL + '\\s*[:=]\\s*[^\\s,;&#]+', 'gi');
const QUERY_SECRET = new RegExp('([?&]' + SENSITIVE_LABEL + '=)[^&#\\s]*', 'gi');
const BEARER_TOKEN = /\bbearer\s+[a-z0-9._~+\/-]+/gi;
const JWT_TOKEN = /\beyJ[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\.[a-z0-9_-]{5,}\b/gi;
const AUDIO_PAYLOAD = /\b(?:data:audio\/[^;,]+;base64,|UklGR)[a-z0-9+/=]{16,}/gi;

function truncateText(value) {
  return value.length <= MAX_STRING
    ? value
    : value.slice(0, MAX_STRING - TRUNCATED.length) + TRUNCATED;
}

function sanitizeDiagnosticText(value) {
  let text;
  try { text = String(value === null || value === undefined ? '' : value); }
  catch (_) { return '[Unprintable]'; }
  text = text
    .replace(BEARER_TOKEN, REDACTED)
    .replace(JWT_TOKEN, REDACTED)
    .replace(QUERY_SECRET, function(_match, prefix) { return prefix + REDACTED; })
    .replace(CONTENT_ASSIGNMENT, function(match) {
      const split = match.search(/[:=]/);
      return split >= 0 ? match.slice(0, split + 1) + REDACTED : REDACTED;
    })
    .replace(CREDENTIAL_ASSIGNMENT, function(match) {
      const split = match.search(/[:=]/);
      return split >= 0 ? match.slice(0, split + 1) + REDACTED : REDACTED;
    })
    .replace(AUDIO_PAYLOAD, REDACTED);
  return truncateText(text);
}

function isSensitiveKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  if (SENSITIVE_KEYS.has(normalized)) return true;
  return ['token', 'authorization', 'cookie', 'secret', 'password', 'apikey', 'transcript', 'prompt', 'sessionid', 'learnermemo']
    .some(function(fragment) { return normalized.includes(fragment); });
}

function defineSafeProperty(target, key, value) {
  Object.defineProperty(target, key, {
    value: value,
    enumerable: true,
    configurable: true,
    writable: true,
  });
}

function sanitizeDiagnosticValue(value) {
  const ancestors = new WeakSet();

  function visit(current, depth, key) {
    if (key && isSensitiveKey(key)) return REDACTED;
    if (current === null || typeof current === 'boolean') return current;
    if (typeof current === 'number') return Number.isFinite(current) ? current : sanitizeDiagnosticText(current);
    if (typeof current === 'string') return sanitizeDiagnosticText(current);
    if (typeof current === 'undefined') return undefined;
    if (typeof current === 'bigint' || typeof current === 'symbol' || typeof current === 'function') {
      return sanitizeDiagnosticText(current);
    }
    if (depth >= MAX_DEPTH) return TRUNCATED;
    if (ancestors.has(current)) return CIRCULAR;

    ancestors.add(current);
    try {
      if (Array.isArray(current)) {
        const result = [];
        const itemLimit = current.length > MAX_ITEMS ? MAX_ITEMS - 1 : current.length;
        for (let index = 0; index < itemLimit; index++) result.push(visit(current[index], depth + 1, ''));
        if (current.length > itemLimit) result.push(TRUNCATED);
        return result;
      }

      let keys;
      try { keys = Object.keys(current).sort(); }
      catch (_) { return '[Unreadable]'; }
      const truncated = keys.length > MAX_KEYS;
      if (truncated) keys = keys.slice(0, MAX_KEYS - 1).concat('__truncated__').sort();
      const result = {};
      for (const childKey of keys) {
        if (childKey === '__truncated__' && truncated) {
          defineSafeProperty(result, childKey, TRUNCATED);
          continue;
        }
        let childValue;
        try { childValue = current[childKey]; }
        catch (_) { childValue = '[Unreadable]'; }
        defineSafeProperty(result, sanitizeDiagnosticText(childKey), visit(childValue, depth + 1, childKey));
      }
      return result;
    } finally {
      ancestors.delete(current);
    }
  }

  return visit(value, 0, '');
}

function hasOption(options, key) {
  return Object.prototype.hasOwnProperty.call(options, key);
}

function optionOr(options, key, fallback) {
  return hasOption(options, key) ? options[key] : fallback;
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function cloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}

function freezeDeep(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) freezeDeep(value[key]);
  return value;
}

function boundEvent(fields) {
  let event = sanitizeDiagnosticValue(fields);
  if (Buffer.byteLength(JSON.stringify(event), 'utf8') > MAX_EVENT_BYTES) {
    event = sanitizeDiagnosticValue({
      cat: event.cat,
      data: TRUNCATED,
      elapsed: event.elapsed,
      msg: event.msg,
      t: event.t,
    });
  }
  return freezeDeep(event);
}

function createCoachDebug(options = {}) {
  const fsImpl = optionOr(options, 'fsImpl', realFs);
  const consoleImpl = optionOr(options, 'consoleImpl', console);
  const timerImpl = optionOr(options, 'timerImpl', { setInterval: setInterval, clearInterval: clearInterval });
  const logDir = optionOr(options, 'logDir', DEFAULT_LOG_DIR);
  const now = optionOr(options, 'now', Date.now);
  const maxEvents = positiveInteger(optionOr(options, 'maxEvents', MAX_EVENTS), MAX_EVENTS);
  const maxLines = positiveInteger(optionOr(options, 'maxLines', MAX_LINES), MAX_LINES);
  const logFile = path.join(logDir, 'coach-pipeline.log');
  const events = [];
  const bootTime = now();
  let logStream = null;
  let streamDead = false;
  let trimTimer = null;

  function genericSinkFailure() {
    try {
      if (consoleImpl && typeof consoleImpl.error === 'function') consoleImpl.error('[coach-debug] diagnostic sink unavailable');
    } catch (_) {}
  }

  function repairMode(target, mode) {
    if (!fsImpl || typeof fsImpl.chmodSync !== 'function') return;
    try { fsImpl.chmodSync(target, mode); } catch (_) {}
  }

  function prepareLogPath() {
    try { fsImpl.mkdirSync(logDir, { recursive: true, mode: 0o700 }); } catch (_) {}
    repairMode(logDir, 0o700);
    repairMode(logFile, 0o600);
  }

  function openLogStream() {
    prepareLogPath();
    try {
      logStream = fsImpl.createWriteStream(logFile, { flags: 'a', mode: 0o600 });
      if (!logStream || typeof logStream.write !== 'function') throw new Error('invalid stream');
      repairMode(logFile, 0o600);
      if (typeof logStream.on === 'function') {
        logStream.on('error', function() {
          streamDead = true;
          genericSinkFailure();
        });
      }
      streamDead = false;
    } catch (_) {
      logStream = null;
      streamDead = true;
      genericSinkFailure();
    }
  }

  function timestamp() { return now(); }
  function elapsed() { return ((now() - bootTime) / 1000).toFixed(1) + 's'; }
  function formatTimestamp(value) { return new Date(value === undefined ? now() : value).toISOString().replace('T', ' ').replace('Z', ''); }

  function readLog() {
    try { return fsImpl.readFileSync(logFile, 'utf8'); } catch (_) { return ''; }
  }

  function getLogFileLineCount() {
    return readLog().split(/\r?\n/).filter(function(line) { return line.trim(); }).length;
  }

  function cloneEntry(entry) {
    return freezeDeep(cloneSafe(entry));
  }

  function writeConsole(line) {
    try {
      if (consoleImpl && typeof consoleImpl.log === 'function') consoleImpl.log(line);
    } catch (_) { genericSinkFailure(); }
  }

  function writeFile(line) {
    if (!logStream || !logStream.writable || streamDead || typeof logStream.write !== 'function') return;
    try { logStream.write(line + '\n'); }
    catch (_) {
      streamDead = true;
      genericSinkFailure();
    }
  }

  function endLogStream() {
    if (!logStream) return;
    const stream = logStream;
    logStream = null;
    if (typeof stream.end === 'function') stream.end();
  }

  function log(category, message, data) {
    const event = boundEvent({
      t: timestamp(),
      elapsed: elapsed(),
      cat: sanitizeDiagnosticText(category),
      msg: sanitizeDiagnosticText(message),
      data: data === undefined ? undefined : sanitizeDiagnosticValue(data),
    });
    events.push(event);
    if (events.length > maxEvents) events.splice(0, events.length - maxEvents);
    const detail = event.data === undefined ? '' : ' ' + JSON.stringify(event.data);
    const line = formatTimestamp(event.t) + ' [' + event.cat + '] ' + event.msg + detail;
    writeConsole(line);
    writeFile(line);
    return cloneEntry(event);
  }

  function flushLog() {
    try {
      if (logStream && logStream.writable && typeof logStream.uncork === 'function') logStream.uncork();
    } catch (_) { genericSinkFailure(); }
  }

  function tailLines(n) {
    const count = Math.min(Math.max(n || 100, 1), MAX_TAIL_LINES);
    const content = readLog();
    if (!content) return ['[no log file yet — no events recorded]'];
    return content.split(/\r?\n/).filter(function(line) { return line.trim(); }).slice(-count);
  }

  function grepLines(pattern, maxResults) {
    const max = Math.min(Math.max(maxResults || 50, 1), MAX_TAIL_LINES);
    if (!pattern || pattern.length > MAX_REGEX_LEN) return ['[invalid or too-long pattern]'];
    if (/(\+|\*|\{)\s*(\+|\*|\{)/.test(pattern) || /\)(\+|\*|\{|\?)/.test(pattern)) {
      return ['[rejected: pattern has nested quantifiers (ReDoS risk) — use a simpler pattern]'];
    }
    let regex;
    try { regex = new RegExp(pattern, 'i'); }
    catch (_) { return ['[invalid regex]']; }
    const content = readLog();
    if (!content) return ['[no log file yet]'];
    const lines = content.split(/\r?\n/).filter(function(line) { return line.trim(); });
    const scanLines = lines.length > maxLines ? lines.slice(-maxLines) : lines;
    return scanLines.filter(function(line) { return regex.test(line); }).slice(-max);
  }

  function trimLogFile() {
    try {
      const lines = readLog().split(/\r?\n/).filter(function(line) { return line.trim(); });
      if (lines.length <= maxLines) return;
      endLogStream();
      fsImpl.writeFileSync(logFile, lines.slice(-maxLines).join('\n') + '\n', { mode: 0o600 });
      repairMode(logFile, 0o600);
      openLogStream();
      writeConsole('[coach-debug] log trimmed');
    } catch (_) {
      streamDead = true;
      genericSinkFailure();
      if (!logStream) openLogStream();
    }
  }

  function getEvents(since) {
    const selected = since ? events.filter(function(entry) { return entry.t >= since; }) : events;
    return freezeDeep(selected.map(cloneEntry));
  }

  function clearEvents() {
    events.length = 0;
    log('gateway', 'in-memory buffer cleared', { logFileLines: getLogFileLineCount() });
  }

  function getSummary() {
    const byCategory = {};
    for (const entry of events) byCategory[entry.cat] = (byCategory[entry.cat] || 0) + 1;
    const errors = events.filter(function(entry) { return entry.cat === 'error'; });
    return freezeDeep({
      bootTime: bootTime,
      uptime: elapsed(),
      totalEvents: events.length,
      byCategory: byCategory,
      errorCount: errors.length,
      lastError: errors.length ? cloneEntry(errors[errors.length - 1]) : null,
      logFile: logFile,
      logFileLines: getLogFileLineCount(),
      streamHealthy: !streamDead,
    });
  }

  function close() {
    if (trimTimer !== null && timerImpl && typeof timerImpl.clearInterval === 'function') {
      try { timerImpl.clearInterval(trimTimer); } catch (_) { genericSinkFailure(); }
    }
    trimTimer = null;
    try { endLogStream(); } catch (_) { genericSinkFailure(); }
  }

  openLogStream();
  trimLogFile();
  if (timerImpl && typeof timerImpl.setInterval === 'function') {
    try {
      trimTimer = timerImpl.setInterval(trimLogFile, 5 * 60 * 1000);
      if (trimTimer && typeof trimTimer.unref === 'function') trimTimer.unref();
    } catch (_) {
      trimTimer = null;
      genericSinkFailure();
    }
  }
  log('gateway', 'coach-debug started', { maxLines: maxLines });
  log('gateway', 'log file ready', { existingLines: getLogFileLineCount() });

  return {
    log: log,
    flushLog: flushLog,
    getEvents: getEvents,
    clearEvents: clearEvents,
    getSummary: getSummary,
    tailLines: tailLines,
    grepLines: grepLines,
    trimLogFile: trimLogFile,
    getLogFileLineCount: getLogFileLineCount,
    close: close,
    LOG_FILE: logFile,
    MAX_LINES: maxLines,
  };
}

let singleton = null;
function getSingleton() {
  if (!singleton) singleton = createCoachDebug();
  return singleton;
}

module.exports = {
  createCoachDebug: createCoachDebug,
  sanitizeDiagnosticValue: sanitizeDiagnosticValue,
  sanitizeDiagnosticText: sanitizeDiagnosticText,
  log: function() { return getSingleton().log.apply(null, arguments); },
  flushLog: function() { return getSingleton().flushLog(); },
  getEvents: function() { return getSingleton().getEvents.apply(null, arguments); },
  clearEvents: function() { return getSingleton().clearEvents(); },
  getSummary: function() { return getSingleton().getSummary(); },
  tailLines: function() { return getSingleton().tailLines.apply(null, arguments); },
  grepLines: function() { return getSingleton().grepLines.apply(null, arguments); },
  trimLogFile: function() { return getSingleton().trimLogFile(); },
  getLogFileLineCount: function() { return getSingleton().getLogFileLineCount(); },
  close: function() { return singleton ? singleton.close() : undefined; },
  LOG_FILE: LOG_FILE,
  MAX_LINES: MAX_LINES,
};
