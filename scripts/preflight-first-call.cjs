#!/usr/bin/env node
'use strict';

const { readFileSync, lstatSync, readlinkSync, realpathSync, existsSync, openSync, fstatSync, closeSync, constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');

const EXPECTED_ROOT = '/home/USER
const EXPECTED_BRANCH = 'voice-memory-v5';
const PLANNING_BASELINE = '54b3f7662e1c71f1b86ab7ceacf6aff8759a968d';
const PROCESS_OWNER = 'agent-process';
const EVIDENCE_ROOT = '/home/USER
const UNIT_PATH = '/home/USER
const REVIEWED_UNIT_SHA256 = '3986d991cf0fa9a4fe65346f0ee3948a0af9e95e126c9f80a0182f3d0955b018';
const ANCHOR_V2_SHA256 = '6ea04a5f1197970de39ea44b4a79a49597dc42bd519606e4467acb5666d16453';
const REVIEW_V2_SHA256 = 'c06fbdd9ddb51beddb271ac36aca0ed6ca65a882a25896cda120afdc08d059bc';
const CONFIRMATION_V2_SHA256 = '1289b13c70436520130a50d292a99dfb39b066a7ec5c33806578f651d729c6ae';
const ANCHOR_V2_ARTIFACTS = Object.freeze([
  Object.freeze({ path: 'COMMIT-EVIDENCE-ANCHOR-v2.md', bytes: 9176, sha256: '4fa97c0af11f7dd485f142c2a741eb6faf6ce0037f9cac1c81a6c43ba7577749' }),
  Object.freeze({ path: 'COMMIT-EVIDENCE-ANCHOR-v2.md.sha256', bytes: 95, sha256: '0288ff5c4c7c9fff9b4494f722c78720d22609a5de82779b642e04668fc4dfef' }),
  Object.freeze({ path: 'commit-anchor-v2/package-manifest.json', bytes: 2759, sha256: '5c7bdf65cbfab7bf7616815236f298171807fabf274f25f315e82a0998ef1158' }),
  Object.freeze({ path: 'commit-anchor-v2/package-manifest.json.sha256', bytes: 88, sha256: '7ffab31bf829968c1827ef92e17d0e65251b8027926c225b769dc73058e56867' }),
  Object.freeze({ path: 'commit-anchor-v2/anchor.json', bytes: 3908, sha256: ANCHOR_V2_SHA256 }),
  Object.freeze({ path: 'commit-anchor-v2/anchor.json.sha256', bytes: 78, sha256: 'a5a37c6d3342bc77e1c37aa967c80bcc728caa140b1c47b8d1739b4b2c244889' }),
  Object.freeze({ path: 'commit-anchor-v2/audit/audit_parser.py', bytes: 1225, sha256: '891ebb6d28a0779d44fc3c7579652b68ce7035df3e0fe6afd7381e30931e0f1b' }),
  Object.freeze({ path: 'commit-anchor-v2/audit/runtime-manifest.json', bytes: 2284, sha256: 'eaedf8f9514d25892c5543b3bbc17473c6aad2c133f64372d06f5e96b7474712' }),
  Object.freeze({ path: 'commit-anchor-v2/audit/runtime-manifest.json.sha256', bytes: 88, sha256: '1c76fe616241a2c2fcaf44b3458eae5c0e845ae5c6d59a7678c23c3792325414' }),
  Object.freeze({ path: 'commit-anchor/runtime-review/attempt-1/index1-command.stdout', bytes: 31914, sha256: '5d6d795f0c693f9fe9fd67f5017ccd5fc30d5c4578467ba56b15046261ba0d9d' }),
  Object.freeze({ path: 'commit-anchor/runtime-review/attempt-1/index2-command.stdout', bytes: 31914, sha256: '5d6d795f0c693f9fe9fd67f5017ccd5fc30d5c4578467ba56b15046261ba0d9d' }),
  Object.freeze({ path: 'commit-anchor-v2/SHA256SUMS', bytes: 4164, sha256: '654f77f9f8fc6905aa886be050e8a5e33e43a4d21158243e26887607e7294541' }),
  Object.freeze({ path: 'commit-anchor-v2/sha256-check.receipt.json', bytes: 2496, sha256: 'f96b167e3cc73b245f8188f669d8b11d933739e71b4db9645a6cf8e56be9dfd7' }),
  Object.freeze({ path: 'boundary/foreign-worktree.json', bytes: 100037, sha256: '4077daf5cf35b35014373a6078ac0a5bae1e9840c93f63c4e0bf2bfcde5b36ff' }),
  Object.freeze({ path: 'commit-anchor/foreign-index.z', bytes: 31521, sha256: '583d56d4ea989e2c7e50cdb5a91cab60e6336b31db03cf89a10cb8fa31e22913' }),
  Object.freeze({ path: 'commit-anchor/foreign-cached-binary.diff', bytes: 0, sha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855' }),
  Object.freeze({ path: 'commit-anchor/sha256-ledger.txt', bytes: 253, sha256: '87c45f2624a3ed21984123d1b3730c5e0c0d1b5b09f4f2740a1f5c78de1a30c6' }),
  Object.freeze({ path: 'commit-anchor-v2/reviews/review.schema.json', bytes: 6129, sha256: '6ac10b78c1f8885f13812acd1924ff5563a2d706401d69a589c62f3adefd8a07' }),
  Object.freeze({ path: 'commit-anchor-v2/reviews/review.json', bytes: 2246, sha256: REVIEW_V2_SHA256 }),
  Object.freeze({ path: 'commit-anchor-v2/reviews/confirmation.schema.json', bytes: 2085, sha256: 'f3853ef584b1a9da3468cade551ab6702772d64eca6d4a6385c385f93f270c70' }),
  Object.freeze({ path: 'commit-anchor-v2/reviews/confirmation.json', bytes: 882, sha256: CONFIRMATION_V2_SHA256 }),
  Object.freeze({ path: 'commit-anchor-v2/reviews/anchor-v2-p8-confirmation-independent-rehash.json', bytes: 60230, sha256: '67f1e7f3bfaf7c8694b6c99eac86c27115f371cb8451729deccd1d340077aafc' }),
]);

const LEASE_PATHS = Object.freeze([
  'backend/coach-app.js',
  'backend/test/coach-app-iife.test.js',
  'scripts/preflight-first-call.cjs',
  'docs/FIRST_CALL_RUNBOOK.md',
  'backend/coach-debug.js',
  'backend/coach-debug.safety.test.js',
  'tests/test-coach-debug.js',
  'backend/coach-page.js',
  'backend/coach-page.safety.test.js',
  'backend/coaching/renderer-client.js',
  'backend/coaching/consumption-v5.test.js',
  'backend/coaching/renderer-client.safety.test.js',
  'backend/voice-standalone-runtime.js',
  'backend/voice-standalone-debug.js',
  'backend/voice-standalone-safety.test.js',
  'backend/voice-standalone-debug.safety.test.js',
  'server.js',
  'backend/server.safety.test.js',
]);

const COMMIT_GROUPS = Object.freeze([
  Object.freeze({ message: 'Gate and cancel coach startup while preserving R12 behavior', paths: Object.freeze(LEASE_PATHS.slice(0, 2)) }),
  Object.freeze({ message: 'Add hermetic first-call preflight', paths: Object.freeze(LEASE_PATHS.slice(2, 3)) }),
  Object.freeze({ message: 'Document offline gate and deferred first-live procedure', paths: Object.freeze(LEASE_PATHS.slice(3, 4)) }),
  Object.freeze({ message: 'Harden first-call readiness safety boundaries', paths: Object.freeze(LEASE_PATHS.slice(4)) }),
  Object.freeze({ message: 'Separate postcommit boundary evidence from precommit anchor', paths: Object.freeze([LEASE_PATHS[2]]) }),
]);
const PRECOMMIT_COMMIT_GROUPS = Object.freeze(COMMIT_GROUPS.slice(0, 4));

const CUSTODY_SEEDS = ['server.js', 'backend/voice-standalone-runtime.js', 'backend/coach-page.html'];
const R12_SOURCE_PATH = '/home/USER
const R12_RUNNER_PATH = '/home/USER
const EXTERNAL_STYLE_MODULE = '/home/USER
const EXTERNAL_STYLE_CALLER = 'backend/coaching/sanitizer.js';
const EXTERNAL_STYLE_TEST_CONTRACTS = [
  {
    command: 'node --test --test-reporter=tap backend/coaching/sanitizer-direction.test.js',
    cwd: EXPECTED_ROOT,
    sourcePath: 'backend/coaching/sanitizer-direction.test.js',
    tests: [
      'MTF: whole-reply cross-direction -> safe fallback',
      'MTF: strips the cross-direction sentence, keeps the benign one',
      'MTF: correct-direction reply passes through unchanged (content-wise)',
      'FTM: whole-reply cross-direction -> safe fallback',
      'FTM: correct-direction (chest/weight/lower-larynx) reply is NOT stripped',
      'neutral learner: direction filter is a no-op (no wrong direction)',
      'direction filter does not fire when styleTarget is absent',
      'signal.direction is authoritative: filter fires even with an unknown preset "x" (MTF)',
      'signal.direction wins over a neutral preset (androgynous, FTM)',
      'negation: a correct caution ("don\'t lower your larynx") is NOT stripped (MTF)',
    ],
  },
  {
    command: 'node --test --test-reporter=tap /home/USER
    cwd: '/home/USER
    sourcePath: '/home/USER
    tests: [
      'directionCueViolation: feminizing cues are rejected in MASCULINIZING records',
      'directionCueViolation: correct same-direction cues PASS',
      'directionCueViolation: contrastive take-references are NOT flagged',
      'directionCueViolation: effort words (lighter onset/touch) are NOT gendered cues',
      'directionCueViolation: masculinizing cues are rejected in FEMINIZING records',
      'evaluateV3SingleTurn wires the direction gate (masc record + fem cue rejects)',
      'anti-quit regex now catches "take a quick break" and "before we pause" (incl. curly apostrophe)',
      'debrief momentCoherent: gendered read must match direction',
    ],
  },
];

const TEST_NAMES = [
  'RED: full IIFE harness boots with all routes controlled',
  'RED: raw chunks never reach visible or TTS sinks',
  'RED: authoritative done is the only finalization source',
  'RED: incremental SSE handles fragmented framing and UTF-8',
  'RED: pre-done EOF or failure resets and restarts recognition',
  'SSE: CR-only line and blank-line separators dispatch events',
  'SSE: CRLF split between byte chunks dispatches each line once',
  'SSE: pending CR followed by non-LF dispatches prior line once',
  'SSE: every multibyte UTF-8 byte split preserves authoritative text',
  'SSE: data spacing, multiline data, multiple events, malformed JSON, and marker semantics',
  'SSE: unterminated EOF flush finalizes accepted done',
  'SSE: missing and invalid done reset safely with exact diagnostics',
  'SSE: pre-done failure resets, restarts recognition, and allows a successful next turn',
  'SSE: post-done event and failure preserve one accepted finalization',
  'SSE: diagnostics use exactly seven codes and numeric or boolean metadata',
  'TEARDOWN: End during raw stream stays idle without restart or finalization',
  'TEARDOWN: End after accepted done before EOF discards pending finalization',
  'SUPPLEMENTAL: stale non-Abort reader fulfillment after End cannot progress before or after accepted done',
  'SUPPLEMENTAL: stale non-Abort reader rejection after End cannot retry or finalize',
  'SUPPLEMENTAL: stale non-Abort f' + 'etch rejection after End cannot recover or restart',
  'LIFECYCLE: offline health blocks warmup, session, microphone, and recognition',
  'LIFECYCLE: missing SpeechRecognition blocks before health or session creation',
  'LIFECYCLE: End is enabled during startup and aborts pending health without later progress',
  'LIFECYCLE: late getUserMedia fulfillment after End stops every track and cannot create meter state',
  'LIFECYCLE: suspended playback AudioContext resume is awaited before readiness and recognition',
  'LIFECYCLE: successful startup preserves ordered gates and enables one active session',
];

const MUTANTS = [
  'diag-sse-done-accepted',
  'diag-sse-malformed-event',
  'diag-sse-invalid-done',
  'diag-sse-missing-done',
  'diag-sse-stream-failure-before-done',
  'diag-sse-after-done-event',
  'diag-sse-stream-failure-after-done',
  'raw-leak',
  'double-finalize',
  'teardown-reader-rejection-invariant',
  'teardown-reader-fulfillment-invariant',
  'teardown-outer-rejection-guard',
];

const EXPECTED_MUTATION_FAILURES = {
  'diag-sse-done-accepted': [TEST_NAMES[9], TEST_NAMES[14], TEST_NAMES[16], TEST_NAMES[17], TEST_NAMES[18]],
  'diag-sse-malformed-event': [TEST_NAMES[9], TEST_NAMES[14]],
  'diag-sse-invalid-done': [TEST_NAMES[9], TEST_NAMES[11], TEST_NAMES[14]],
  'diag-sse-missing-done': [TEST_NAMES[11], TEST_NAMES[14]],
  'diag-sse-stream-failure-before-done': [TEST_NAMES[12], TEST_NAMES[14]],
  'diag-sse-after-done-event': [TEST_NAMES[9], TEST_NAMES[13], TEST_NAMES[14]],
  'diag-sse-stream-failure-after-done': [TEST_NAMES[13], TEST_NAMES[14]],
  'raw-leak': [TEST_NAMES[1]],
  'double-finalize': [TEST_NAMES[9], TEST_NAMES[13]],
  'teardown-reader-rejection-invariant': [TEST_NAMES[15], TEST_NAMES[16], TEST_NAMES[18]],
  'teardown-reader-fulfillment-invariant': [TEST_NAMES[17]],
  'teardown-outer-rejection-guard': [TEST_NAMES[19]],
};

const SSE_CODES = [
  'SSE_DONE_ACCEPTED',
  'SSE_MALFORMED_EVENT',
  'SSE_INVALID_DONE',
  'SSE_MISSING_DONE',
  'SSE_STREAM_FAILURE_BEFORE_DONE',
  'SSE_AFTER_DONE_EVENT',
  'SSE_STREAM_FAILURE_AFTER_DONE',
];

const APPROVED_RUNBOOK_COMMAND = 'node scripts/preflight-first-call.cjs';
const RUNBOOK_RELATIVE_PATH = 'docs/FIRST_CALL_RUNBOOK.md';
const REVIEWED_RUNBOOK_SHA256 = 'e0bb208e58f5b64b23fa1c8f0301b3de0916bbde98ff35b2b5bea1c74b489dcb';
const REVIEWED_RUNBOOK_BYTES = 7873;
const RUNBOOK_REVIEW_PROVENANCE = 'terminal runbook-review PASS session ses_0a100b9e9ffemw8Ud7EPEczK8R; TV-PREFLIGHT-I4-RUNBOOK-REPAIR1 receipt';
const REVIEWED_RUNBOOK_INLINE_CODE = new Set([
  '/home/USER 'baseline', 'lease', 'CLEAN_BASELINE', 'OWNED_VERIFIED',
  'mutation', 'hermetic', 'OFFLINE_READY', '0', 'BLOCKED', '1', 'FAIL', '2', 'PASS', 'WARN_DO_NOT_USE',
  'DEFERRED', 'FIRST_LIVE_ONLY', 'BLOCKING_UNKNOWN', 'offlineReady', 'false', UNIT_PATH, REVIEWED_UNIT_SHA256,
  'Environment=', 'After=', 'Wants=', 'offlineReady=false', 'VOXCPM_ENABLED=true',
  'VOXCPM_URL=http://127.0.0.1:8020', 'scripts/start-all-with-tts.sh', `${EVIDENCE_ROOT}/`,
  'overall: OFFLINE_READY', 'offlineReady: true', 'processOwner', 'agent-process', '/coach', 'SpeechRecognition',
  'data-ready=true',
]);

const LIVE_CHECKS = [
  'service-health',
  'browser-microphone',
  'one-session-short-turn',
  'quality-latency',
].map((id) => ({ id, status: 'DEFERRED', reason: 'FIRST_LIVE_ONLY' }));

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sameSet(left, right) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length
    && [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function sameList(left, right) {
  return Array.isArray(left) && Array.isArray(right) && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function redactString(value) {
  let output = String(value);
  output = output.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/@\s:]+(?::[^/@\s]*)?@/gi, '$1[REDACTED]@');
  output = output.replace(/([a-z][a-z0-9+.-]*:\/\/[^\s?#]+)\?[^\s#]*/gi, '$1?[REDACTED]');
  output = output.replace(/\b(?:authorization|proxy-authorization|cookie|set-cookie)\s*:\s*[^\r\n]*/gi, '[REDACTED]');
  output = output.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]');
  output = output.replace(/\b(?:api[_-]?key|access[_-]?key|accessToken|clientSecret|privateKey|secretKey|sessionId|token|password|passwd|secret|credential|authorization|cookie|auth[_-]?token|bearer[_-]?token)\b(?:\s*[:=]\s*[^\s,;]+)?/gi, '[REDACTED]');
  return output;
}

function isSecretKey(key) {
  const normalized = String(key).replace(/[^a-z0-9]/gi, '').toLowerCase();
  return new Set(['apikey', 'accesskey', 'accesstoken', 'clientsecret', 'privatekey', 'secretkey', 'sessionid', 'token', 'password', 'passwd', 'secret', 'credential', 'credentials', 'authorization', 'cookie', 'setcookie', 'authtoken', 'bearertoken']).has(normalized);
}

function sanitize(value) {
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map(sanitize);
  if (value && typeof value === 'object') {
    const clean = {};
    for (const [key, child] of Object.entries(value)) {
      const secretName = isSecretKey(key);
      clean[secretName ? '[REDACTED]' : redactString(key)] = secretName ? '[REDACTED]' : sanitize(child);
    }
    return clean;
  }
  return value;
}

function readBytes(filePath) {
  try {
    return { ok: true, bytes: readFileSync(filePath) };
  } catch (error) {
    return { ok: false, error: redactString(error.code || error.name || 'read error') };
  }
}

function readJsonCandidate(relativePaths) {
  for (const relativePath of relativePaths) {
    const absolutePath = path.join(EVIDENCE_ROOT, relativePath);
    const result = readLockedEvidenceFile(EVIDENCE_ROOT, relativePath);
    if (!result.ok) continue;
    try {
      return { ok: true, relativePath, absolutePath, value: JSON.parse(result.bytes.toString('utf8')), sha256: sha256(result.bytes) };
    } catch (error) {
      return { ok: false, relativePath, error: 'invalid JSON' };
    }
  }
  return { ok: false, relativePath: relativePaths[0], error: 'missing evidence' };
}

function isSafeRepoPath(value) {
  return typeof value === 'string' && value.length > 0 && !value.startsWith('-') && !path.isAbsolute(value)
    && !value.includes('\0') && !value.includes(':') && value.split('/').every((part) => part && part !== '.' && part !== '..');
}

function isAllowedCommand(executable, args) {
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === 'string')) return false;
  if (executable === process.execPath) {
    return (args.length === 2 && args[0] === '--check' && LEASE_PATHS.filter((name) => /\.c?js$/.test(name)).includes(args[1]))
      || (args.length === 3 && args[0] === '--test' && args[1] === '--test-reporter=tap' && args[2] === 'backend/test/coach-app-iife.test.js');
  }
  if (executable !== '/usr/bin/git') return false;
  if (sameList(args, ['rev-parse', '--show-toplevel']) || sameList(args, ['rev-parse', '--abbrev-ref', 'HEAD']) || sameList(args, ['rev-parse', 'HEAD'])) return true;
  if (args.length === 4 && args[0] === 'merge-base' && args[1] === '--is-ancestor' && /^[a-f0-9]{40}$/.test(args[2]) && args[3] === 'HEAD') return true;
  if (sameList(args, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])) return true;
  if (sameList(args, ['ls-files', '--stage', '-z'])) return true;
  if (sameList(args, ['diff', '--cached', '--name-status', '-z', '--find-renames', '--find-copies', '--find-copies-harder'])) return true;
  if (args.length >= 9 && sameList(args.slice(0, 8), ['diff', '--cached', '--binary', '--no-ext-diff', '--find-renames', '--find-copies', '--find-copies-harder', '--'])
    && args.slice(8).every(isSafeRepoPath) && new Set(args.slice(8)).size === args.slice(8).length) return true;
  if (args[0] === 'diff' && args.includes('--') && args.slice(args.indexOf('--') + 1).every(isSafeRepoPath)) {
    const options = args.slice(1, args.indexOf('--'));
    return sameList(options, ['--binary', '--no-ext-diff']) || sameList(options, ['--cached', '--binary', '--no-ext-diff']);
  }
  if (args[0] === 'ls-files' && args[1] === '--stage' && args[2] === '-z' && args[3] === '--' && args.slice(4).length > 0 && args.slice(4).every(isSafeRepoPath)) return true;
  if (args[0] === 'ls-tree' && args.length === 6 && sameList(args.slice(1, 5), ['--full-tree', '-z', 'HEAD', '--']) && isSafeRepoPath(args[5])) return true;
  if (args[0] === 'ls-tree' && args.length === 5 && sameList(args.slice(1, 4), ['--full-tree', '-r', '-z']) && /^[a-f0-9]{40}$/.test(args[4])) return true;
  if (args[0] === 'show' && args.length === 2 && /^(?:(?:HEAD|[a-f0-9]{40}):|:)[^:\0]+$/.test(args[1]) && isSafeRepoPath(args[1].slice(args[1].indexOf(':') + 1))) return true;
  if (args[0] === 'show' && args.length === 4 && args[1] === '--format=%H' && args[2] === '--no-patch' && /^[a-f0-9]{40}\^\{commit\}$/.test(args[3])) return true;
  if (args[0] === 'show' && args.length === 4 && ['--format=%P', '--format=%s'].includes(args[1]) && args[2] === '--no-patch' && /^[a-f0-9]{40}$/.test(args[3])) return true;
  if (args[0] === 'diff-tree' && args.length === 6 && sameList(args.slice(1, 5), ['--no-commit-id', '--name-only', '-r', '-z']) && /^[a-f0-9]{40}$/.test(args[5])) return true;
  return false;
}

function runAllowed(executable, args, cwd) {
  if (!isAllowedCommand(executable, args)) throw new Error('subprocess denied by exact static allowlist');
  return spawnSync(executable, args, {
    cwd,
    shell: false,
    maxBuffer: 8 * 1024 * 1024,
    windowsHide: true,
  });
}

function git(args, cwd) {
  return runAllowed('/usr/bin/git', args, cwd);
}

function gitText(args, cwd) {
  const result = git(args, cwd);
  return result.status === 0 ? result.stdout.toString('utf8').trim() : null;
}

function parseNulList(output) {
  const parts = String(output).split('\0');
  if (parts.pop() !== '') throw new Error('Git NUL record stream is unterminated');
  return parts;
}

function parsePorcelainV1Z(output) {
  const parts = parseNulList(output);
  const rows = [];
  for (let index = 0; index < parts.length; index++) {
    const record = parts[index];
    if (!/^[ MADRCU?!]{2} /.test(record)) throw new Error('Malformed Git status record');
    const status = record.slice(0, 2);
    const row = { status, path: record.slice(3), originalPath: null };
    if (/[RC]/.test(status)) {
      if (++index >= parts.length) throw new Error('Git rename/copy record lacks original path');
      row.originalPath = parts[index];
    }
    rows.push(row);
  }
  return rows;
}

function statusRowIsForeign(row) {
  return !LEASE_PATHS.includes(row.path) || (row.originalPath !== null && !LEASE_PATHS.includes(row.originalPath));
}

function parseStageZ(output, expectedPath) {
  const records = parseNulList(output);
  if (records.length === 0) return null;
  if (records.length !== 1) throw new Error(`Index has ${records.length} stages for ${expectedPath}`);
  const match = records[0].match(/^(\d{6}) ([a-f0-9]{40,64}) 0\t([\s\S]+)$/);
  if (!match || match[3] !== expectedPath) throw new Error(`Malformed index identity for ${expectedPath}`);
  return { mode: match[1], blob: match[2] };
}

function parseTreeZ(output, expectedPath) {
  const records = parseNulList(output);
  if (records.length === 0) return null;
  if (records.length !== 1) throw new Error(`HEAD has ${records.length} identities for ${expectedPath}`);
  const match = records[0].match(/^(\d{6}) blob ([a-f0-9]{40,64})\t([\s\S]+)$/);
  if (!match || match[3] !== expectedPath) throw new Error(`Malformed HEAD identity for ${expectedPath}`);
  return { mode: match[1], blob: match[2] };
}

function canonicalizeMarkdownLineEndings(source) {
  // Structural checks treat CRLF and lone CR as LF. The integrity lock still hashes raw bytes.
  return String(source).replace(/\r\n?/g, '\n');
}

function validateRunbookMarkdownStructure(source) {
  const lines = canonicalizeMarkdownLineEndings(source).split(/(?<=\n)/);
  const fences = [];
  const outside = [];
  let open = null;
  for (const lineWithEnding of lines) {
    const line = lineWithEnding.endsWith('\n') ? lineWithEnding.slice(0, -1) : lineWithEnding;
    if (!open) {
      const match = line.match(/^ {0,3}(`{3,}|~{3,})([^`]*)$/);
      if (!match) { outside.push(line); continue; }
      open = { marker: match[1][0], length: match[1].length, language: match[2].trim(), body: '' };
      continue;
    }
    const close = line.match(/^ {0,3}(`{3,}|~{3,})\s*$/);
    if (close && close[1][0] === open.marker && close[1].length >= open.length) {
      fences.push(open);
      open = null;
    } else open.body += lineWithEnding;
  }
  if (open || fences.length !== 1) return false;
  const [fence] = fences;
  if (fence.language !== 'bash' || fence.body !== `${APPROVED_RUNBOOK_COMMAND}\n`) return false;
  if (outside.some((line) => /^(?: {4}|\t)/.test(line))) return false;
  return outside.every((line) => [...line.matchAll(/`([^`\n]+)`/g)]
    .every((match) => REVIEWED_RUNBOOK_INLINE_CODE.has(match[1])));
}

function inspectRunbookArtifact(bytes, lock = { sha256: REVIEWED_RUNBOOK_SHA256, bytes: REVIEWED_RUNBOOK_BYTES }) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== lock.bytes || sha256(bytes) !== lock.sha256) {
    return { valid: false, stage: 'hash' };
  }
  return validateRunbookMarkdownStructure(bytes.toString('utf8'))
    ? { valid: true, stage: 'accepted' }
    : { valid: false, stage: 'structure' };
}

function fileTypeOf(stat) {
  return stat.isSymbolicLink() ? 'symlink'
    : stat.isFile() ? 'regular'
      : stat.isDirectory() ? 'directory'
        : stat.isFIFO && stat.isFIFO() ? 'fifo'
          : 'special';
}

function statIdentity(stat) {
  if (['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some((key) => stat[key] === undefined || stat[key] === null)) {
    throw new Error('locked file identity is incomplete');
  }
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    size: String(stat.size),
    mtimeNs: String(stat.mtimeNs),
    ctimeNs: String(stat.ctimeNs),
  };
}

function sameStatIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino && left.size === right.size
    && left.mtimeNs === right.mtimeNs && left.ctimeNs === right.ctimeNs;
}

function readLockedRegularFile(filePath, fsOps = null) {
  const ops = fsOps || {
    constants,
    lstat: (...args) => lstatSync(...args, { bigint: true }),
    realpath: (...args) => realpathSync(...args),
    open: (...args) => openSync(...args),
    fstat: (...args) => fstatSync(...args, { bigint: true }),
    read: (...args) => readFileSync(...args),
    close: (...args) => closeSync(...args),
  };
  const canonicalPath = path.resolve(filePath);
  const base = { canonicalPath, realPath: null, fileType: 'unavailable', mode: null };
  let fd = null;
  let result;
  try {
    if (!ops.constants || !Number.isInteger(ops.constants.O_RDONLY)
      || !Number.isInteger(ops.constants.O_NOFOLLOW) || ops.constants.O_NOFOLLOW === 0) {
      throw new Error('O_NOFOLLOW is unavailable');
    }
    const before = ops.lstat(canonicalPath);
    const fileType = fileTypeOf(before);
    const modeMask = typeof before.mode === 'bigint' ? 0o177777n : 0o177777;
    const observed = { ...base, fileType, mode: Number(before.mode & modeMask).toString(8) };
    if (fileType !== 'regular') return { ...observed, ok: false, reason: 'runbook path is not a regular file' };
    if (before.nlink !== undefined && before.nlink !== 1n && before.nlink !== 1) return { ...observed, ok: false, reason: 'locked file must have exactly one hard link' };
    const permissionMask = typeof before.mode === 'bigint' ? 0o022n : 0o022;
    if ((before.mode & permissionMask) !== (typeof before.mode === 'bigint' ? 0n : 0)) return { ...observed, ok: false, reason: 'locked file is group/world writable' };
    const beforeRealPath = path.resolve(ops.realpath(canonicalPath));
    if (beforeRealPath !== canonicalPath) return { ...observed, realPath: beforeRealPath, ok: false, reason: 'runbook realpath differs from canonical repository path' };

    fd = ops.open(canonicalPath, ops.constants.O_RDONLY | ops.constants.O_NOFOLLOW);
    const fdBefore = ops.fstat(fd);
    if (fileTypeOf(fdBefore) !== 'regular') throw new Error('opened runbook is not a regular file');
    if (fdBefore.nlink !== undefined && fdBefore.nlink !== 1n && fdBefore.nlink !== 1) throw new Error('opened file must have exactly one hard link');
    const fdBeforePermissionMask = typeof fdBefore.mode === 'bigint' ? 0o022n : 0o022;
    if ((fdBefore.mode & fdBeforePermissionMask) !== (typeof fdBefore.mode === 'bigint' ? 0n : 0)) throw new Error('opened file is group/world writable');
    if (Number(fdBefore.size) > 4 * 1024 * 1024) throw new Error('locked file exceeds size bound');
    const beforeIdentity = statIdentity(before);
    const fdBeforeIdentity = statIdentity(fdBefore);
    if (!sameStatIdentity(beforeIdentity, fdBeforeIdentity)) throw new Error('locked file identity changed before open');

    const bytes = ops.read(fd);
    if (!Buffer.isBuffer(bytes)) throw new Error('runbook fd read did not return bytes');
    const fdAfter = ops.fstat(fd);
    const fdAfterIdentity = statIdentity(fdAfter);
    const fdAfterPermissionMask = typeof fdAfter.mode === 'bigint' ? 0o022n : 0o022;
    if (fileTypeOf(fdAfter) !== 'regular'
      || (fdAfter.nlink !== undefined && fdAfter.nlink !== 1n && fdAfter.nlink !== 1)
      || (fdAfter.mode & fdAfterPermissionMask) !== (typeof fdAfter.mode === 'bigint' ? 0n : 0)
      || !sameStatIdentity(fdBeforeIdentity, fdAfterIdentity)) {
      throw new Error('opened locked file changed during read');
    }
    if (String(bytes.length) !== fdBeforeIdentity.size) throw new Error('runbook fd read length differs from locked size');

    const after = ops.lstat(canonicalPath);
    if (fileTypeOf(after) !== 'regular') throw new Error('runbook path changed to a non-regular file after read');
    const afterRealPath = path.resolve(ops.realpath(canonicalPath));
    if (afterRealPath !== canonicalPath) throw new Error('runbook realpath changed after read');
    const afterConfirm = ops.lstat(canonicalPath);
    const afterIdentity = statIdentity(after);
    const afterConfirmIdentity = statIdentity(afterConfirm);
    const afterPermissionMask = typeof after.mode === 'bigint' ? 0o022n : 0o022;
    const confirmPermissionMask = typeof afterConfirm.mode === 'bigint' ? 0o022n : 0o022;
    if (fileTypeOf(afterConfirm) !== 'regular'
      || (after.nlink !== undefined && after.nlink !== 1n && after.nlink !== 1)
      || (afterConfirm.nlink !== undefined && afterConfirm.nlink !== 1n && afterConfirm.nlink !== 1)
      || (after.mode & afterPermissionMask) !== (typeof after.mode === 'bigint' ? 0n : 0)
      || (afterConfirm.mode & confirmPermissionMask) !== (typeof afterConfirm.mode === 'bigint' ? 0n : 0)
      || !sameStatIdentity(fdAfterIdentity, afterIdentity)
      || !sameStatIdentity(fdAfterIdentity, afterConfirmIdentity)) {
      throw new Error('runbook path inode changed after read');
    }
    result = { ...observed, realPath: afterRealPath, ok: true, bytes, dev: fdAfterIdentity.dev,
      ino: fdAfterIdentity.ino, size: fdAfterIdentity.size, mtimeNs: fdAfterIdentity.mtimeNs,
      ctimeNs: fdAfterIdentity.ctimeNs, bytesSha256: sha256(bytes) };
  } catch (error) {
    result = { ...base, ok: false, reason: `locked runbook read failed: ${redactString(error.code || error.message || error.name || 'read error')}` };
  } finally {
    if (fd !== null) {
      try { ops.close(fd); } catch (error) {
        result = { ...base, ok: false, reason: `locked runbook close failed: ${redactString(error.code || error.message || error.name || 'close error')}` };
      }
    }
  }
  return result;
}

function readLockedEvidenceFile(baseDir, relativePath, fsOps = null) {
  const root = path.resolve(EVIDENCE_ROOT);
  const base = path.resolve(baseDir);
  const target = typeof relativePath === 'string' ? path.resolve(base, relativePath) : '';
  if (!target || (target !== root && !target.startsWith(`${root}${path.sep}`))
    || (base !== root && !base.startsWith(`${root}${path.sep}`))) {
    return { ok: false, canonicalPath: target || null, reason: 'evidence path escapes transaction root' };
  }
  if (!fsOps) {
    try {
      const rootReal = path.resolve(realpathSync(root));
      if (rootReal !== root) return { ok: false, canonicalPath: target, reason: 'transaction root realpath differs' };
      const relative = path.relative(root, target);
      let cursor = root;
      for (const component of relative.split(path.sep)) {
        cursor = path.join(cursor, component);
        if (cursor === target) break;
        if (lstatSync(cursor).isSymbolicLink()) return { ok: false, canonicalPath: target, reason: 'evidence path has symlink component' };
      }
    } catch (error) {
      return { ok: false, canonicalPath: target, reason: `evidence component validation failed: ${redactString(error.code || error.message || error.name)}` };
    }
  }
  const result = readLockedRegularFile(target, fsOps);
  return result.ok && result.realPath && (result.realPath === root || result.realPath.startsWith(`${root}${path.sep}`))
    ? result
    : { ...result, ok: false, reason: result.reason || 'evidence realpath escapes transaction root' };
}

function inspectRunbookPath(repoRoot, fsOps = null) {
  const canonicalRoot = path.resolve(repoRoot);
  const canonicalPath = path.resolve(canonicalRoot, RUNBOOK_RELATIVE_PATH);
  const base = { path: RUNBOOK_RELATIVE_PATH, canonicalPath, realPath: null, fileType: 'unavailable', mode: null };
  if (!canonicalPath.startsWith(`${canonicalRoot}${path.sep}`)) return { ...base, ok: false, reason: 'canonical runbook path escapes repository root' };
  return { ...base, ...readLockedRegularFile(canonicalPath, fsOps), path: RUNBOOK_RELATIVE_PATH };
}

function validateRunbookExecutableSurface(source) {
  const bytes = Buffer.from(String(source), 'utf8');
  return inspectRunbookArtifact(bytes, { sha256: sha256(bytes), bytes: bytes.length }).valid;
}

function extractDependencySpecifiers(source, relativePath) {
  const specs = [];
  const patterns = [
    /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of String(source).matchAll(pattern)) specs.push(match[1]);
  if (/\.html?$/.test(relativePath)) {
    for (const match of String(source).matchAll(/<script\b[^>]+src=["']([^"']+)["']/gi)) specs.push(match[1]);
    for (const match of String(source).matchAll(/<link\b[^>]+href=["']([^"']+)["']/gi)) specs.push(`presentation:${match[1]}`);
  }
  return [...new Set(specs)];
}

function resolveDependency(files, fromPath, specifier) {
  if (specifier.startsWith('presentation:')) return { warning: 'presentation-only dependency', specifier: specifier.slice('presentation:'.length) };
  if (specifier === './cli-tools/structured-memory-tools' && fromPath === 'backend/learner-context-service.js') return { warning: 'classified guarded optional local module', specifier };
  if (specifier === EXTERNAL_STYLE_MODULE && fromPath === EXTERNAL_STYLE_CALLER) return { external: specifier, callCritical: true };
  if (specifier.startsWith('/static/')) return files.has(`backend/${specifier.slice('/static/'.length)}`) ? `backend/${specifier.slice('/static/'.length)}` : null;
  if (!specifier.startsWith('.') && !path.isAbsolute(specifier)) return undefined;
  if (path.isAbsolute(specifier)) return { external: specifier };
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(fromPath), specifier));
  if (base.startsWith('../') || base === '..') return { external: specifier };
  for (const candidate of [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.json`, `${base}/index.js`]) {
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function discoverDependencyClosureFromMap(files, seeds) {
  const queue = [...seeds];
  const paths = new Set();
  const edges = [];
  const issues = [];
  const warnings = [];
  const externalDependencies = [];
  while (queue.length) {
    const current = queue.shift();
    if (paths.has(current)) continue;
    paths.add(current);
    if (!files.has(current)) { issues.push({ from: current, specifier: current, reason: 'missing seed or dependency' }); continue; }
    for (const specifier of extractDependencySpecifiers(files.get(current), current)) {
      const resolved = resolveDependency(files, current, specifier);
      if (resolved === undefined) continue;
      if (resolved && resolved.warning) { warnings.push({ from: current, specifier: resolved.specifier, reason: resolved.warning }); continue; }
      if (resolved && resolved.external && resolved.callCritical) {
        externalDependencies.push({ from: current, path: resolved.external });
        continue;
      }
      if (!resolved || resolved.external) {
        issues.push({ from: current, specifier, reason: resolved ? 'external dependency' : 'unresolved dependency' });
        continue;
      }
      edges.push({ from: current, to: resolved, specifier });
      if (!paths.has(resolved)) queue.push(resolved);
    }
  }
  return { paths: [...paths].sort(), edges, issues, warnings, externalDependencies };
}

function discoverDependencyClosure(repoRoot, seeds) {
  const files = new Map();
  const queue = [...seeds];
  const seen = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (seen.has(current)) continue;
    seen.add(current);
    const read = readBytes(path.join(repoRoot, current));
    if (!read.ok) continue;
    const source = read.bytes.toString('utf8');
    files.set(current, source);
    for (const specifier of extractDependencySpecifiers(source, current)) {
      if (specifier.startsWith('presentation:')) continue;
      if (!specifier.startsWith('.') && !specifier.startsWith('/static/')) continue;
      const base = specifier.startsWith('/static/') ? `backend/${specifier.slice(8)}` : path.posix.normalize(path.posix.join(path.posix.dirname(current), specifier));
      for (const candidate of [base, `${base}.js`, `${base}.cjs`, `${base}.mjs`, `${base}.json`, `${base}/index.js`]) {
        if (existsSync(path.join(repoRoot, candidate))) { queue.push(candidate); break; }
      }
    }
  }
  return discoverDependencyClosureFromMap(files, seeds);
}

function discoverRepoRoot() {
  return gitText(['rev-parse', '--show-toplevel'], path.resolve(__dirname, '..'));
}

function tokenizeUnitValue(value) {
  const tokens = [];
  let token = '';
  let quote = null;
  let escaped = false;
  for (const character of value) {
    if (escaped) { token += character; escaped = false; continue; }
    if (character === '\\') { escaped = true; continue; }
    if (quote) {
      if (character === quote) quote = null;
      else token += character;
      continue;
    }
    if (character === '"' || character === "'") { quote = character; continue; }
    if (/\s/.test(character)) {
      if (token) { tokens.push(token); token = ''; }
    } else token += character;
  }
  if (escaped || quote) throw new Error('unterminated unit value');
  if (token) tokens.push(token);
  return tokens;
}

function parseUnit(source) {
  const logicalLines = [];
  let pending = '';
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = pending + rawLine;
    if (/\\\s*$/.test(line)) { pending = line.replace(/\\\s*$/, ' '); continue; }
    logicalLines.push(line); pending = '';
  }
  if (pending) throw new Error('unterminated unit continuation');

  let section = '';
  const environments = new Map();
  const after = [];
  const wants = [];
  for (const rawLine of logicalLines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const sectionMatch = line.match(/^\[([^\]]+)\]$/);
    if (sectionMatch) { section = sectionMatch[1]; continue; }
    const separator = line.indexOf('=');
    if (separator < 1 || !section) throw new Error('malformed unit directive');
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (section === 'Service' && key === 'Environment') {
      for (const assignment of tokenizeUnitValue(value)) {
        const equals = assignment.indexOf('=');
        if (equals < 1) throw new Error('ambiguous environment assignment');
        const name = assignment.slice(0, equals);
        const setting = assignment.slice(equals + 1);
        if (environments.has(name) && environments.get(name) !== setting) throw new Error('conflicting environment assignment');
        environments.set(name, setting);
      }
    } else if (section === 'Unit' && key === 'After') after.push(...tokenizeUnitValue(value));
    else if (section === 'Unit' && key === 'Wants') wants.push(...tokenizeUnitValue(value));
  }
  return { environments, after, wants };
}

function evaluateUnitRead(read, runbookPolicy, reviewedSha256 = REVIEWED_UNIT_SHA256) {
  const result = {
    path: UNIT_PATH,
    reviewedSha256,
    currentSha256: null,
    readable: false,
    parseStatus: 'UNAVAILABLE',
    plannedUse: false,
    ownershipConflict: false,
    status: 'BLOCKING_UNKNOWN',
  };
  if (!read.ok) return { result, detail: `Installed unit unavailable (${read.error}); no prior facts used.` };
  result.readable = true;
  result.currentSha256 = sha256(read.bytes);
  let parsed;
  try {
    parsed = parseUnit(read.bytes.toString('utf8'));
  } catch (error) {
    result.parseStatus = 'AMBIGUOUS';
    return { result, detail: 'Installed unit is readable but its current static content is ambiguous.' };
  }

  const reviewed = result.currentSha256 === reviewedSha256;
  const reviewedFactsConfirmed = parsed.environments.get('VOXCPM_ENABLED') === 'true'
    && parsed.environments.get('VOXCPM_URL') === 'http://127.0.0.1:8020'
    && !parsed.after.some((name) => /voxcpm/i.test(name))
    && !parsed.wants.some((name) => /voxcpm/i.test(name));
  result.parseStatus = reviewed ? 'CONFIRMED' : 'CHANGED_CONFIRMED';
  result.plannedUse = !runbookPolicy.explicitNonUse;
  result.ownershipConflict = !runbookPolicy.agentProcessOwner || result.plannedUse;

  if (reviewed && !reviewedFactsConfirmed) {
    result.parseStatus = 'AMBIGUOUS';
    result.status = 'FAIL';
    return { result, detail: 'Reviewed-hash unit did not confirm every required fact from current bytes.' };
  }
  if (result.ownershipConflict) {
    result.status = 'FAIL';
    return { result, detail: 'Static planned ownership or use conflicts with the selected owner.' };
  }
  result.status = 'WARN_DO_NOT_USE';
  return {
    result,
    detail: reviewed
      ? 'Current reviewed bytes parsed and confirmed; the unit remains forbidden.'
      : 'Changed current bytes parsed freshly; static policy selects agent-process and forbids unit use.',
  };
}

function evaluateUnit(runbookPolicy) {
  return evaluateUnitRead(readBytes(UNIT_PATH), runbookPolicy);
}

function parseTap(output) {
  const subtests = [];
  const plans = [];
  let pending = null;
  for (const line of String(output).split(/\r?\n/)) {
    const plan = line.match(/^1\.\.(\d+)$/);
    if (plan) { plans.push(Number(plan[1])); continue; }
    const subtest = line.match(/^# Subtest: (.*)$/);
    if (subtest) { pending = subtest[1]; continue; }
    const result = line.match(/^(not ok|ok) (\d+) - (.*?)(?: #.*)?$/);
    if (result) {
      const name = pending || result[3];
      subtests.push({ index: Number(result[2]), name, pass: result[1] === 'ok', skipped: /#\s*(?:SKIP|TODO)\b/i.test(line) });
      pending = null;
    }
  }
  Object.defineProperty(subtests, 'plans', { value: plans, enumerable: false });
  return subtests;
}

function checkRunbook(repoRoot) {
  const inspected = inspectRunbookPath(repoRoot);
  const pathEvidence = [`type:${inspected.fileType}`, `mode:${inspected.mode || 'unavailable'}`, `realpath:${inspected.realPath || 'unavailable'}`, `canonical:${inspected.canonicalPath}`,
    `fd-dev:${inspected.dev || 'unavailable'}`, `fd-ino:${inspected.ino || 'unavailable'}`, `fd-size:${inspected.size || 'unavailable'}`];
  if (!inspected.ok) return {
    status: inspected.fileType === 'unavailable' ? 'BLOCKING_UNKNOWN' : 'FAIL',
    detail: `Runbook metadata validation failed: ${inspected.reason}.`,
    evidence: pathEvidence,
  };
  const source = inspected.bytes.toString('utf8');
  const headings = [...source.matchAll(/^#{1,6}\s+(.+)$/gm)].map((match) => match[1].trim());
  const required = ['OFFLINE_READY', 'Status meanings', 'Config check', 'Evidence location', 'Blockers and Stop Conditions', 'FIRST_LIVE_ONLY — Deferred and Not Authorized', 'Rollback'];
  const agentProcessOwner = /future gateway owner is \*\*agent-process\*\*/i.test(source)
    && /startup and stopping/i.test(source);
  const explicitNonUse = /Never use, reload, edit, enable, or promote that dormant gateway unit\./.test(source);
  const artifact = inspectRunbookArtifact(inspected.bytes);
  const complete = required.every((heading) => headings.includes(heading))
    && artifact.valid
    && source.includes(UNIT_PATH)
    && source.includes(REVIEWED_UNIT_SHA256)
    && agentProcessOwner
    && explicitNonUse
    && /offlineReady=false/.test(source)
    && /not-yet-authorized|minimal first-live|not authorized/i.test(source);
  return {
    status: complete ? 'PASS' : 'FAIL',
    detail: complete ? 'The exact independently reviewed runbook artifact is locked and has one bash fence containing only the preflight command.' : `Runbook integrity or structure failed at ${artifact.stage}.`,
    evidence: [...pathEvidence, `sha256:${sha256(inspected.bytes)}`, `bytes:${inspected.bytes.length}`, `review:${RUNBOOK_REVIEW_PROVENANCE}`],
    policy: { agentProcessOwner, explicitNonUse },
  };
}

function showBytes(spec, repoRoot) {
  const result = git(['show', spec], repoRoot);
  return result.status === 0 ? Buffer.from(result.stdout) : null;
}

function isAllowedWorktreeKind(fileType) {
  return fileType === 'regular' || fileType === 'symlink';
}

function deriveCustodyIdentity(repoRoot, relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  let stat;
  try { stat = lstatSync(absolutePath); } catch { return { path: relativePath, validFile: false, reason: 'missing worktree path' }; }
  const fileType = stat.isSymbolicLink() ? 'symlink' : stat.isFile() ? 'regular' : 'other';
  const symlinkTarget = stat.isSymbolicLink() ? readlinkSync(absolutePath) : null;
  const worktreeBytes = fileType === 'symlink' ? Buffer.from(symlinkTarget) : fileType === 'regular' ? readFileSync(absolutePath) : null;
  if (!isAllowedWorktreeKind(fileType) || !worktreeBytes) return { path: relativePath, validFile: false, reason: 'worktree path is not a regular file or symlink' };
  const stageResult = git(['ls-files', '--stage', '-z', '--', relativePath], repoRoot);
  const treeResult = git(['ls-tree', '--full-tree', '-z', 'HEAD', '--', relativePath], repoRoot);
  if (stageResult.status !== 0 || treeResult.status !== 0) return { path: relativePath, validFile: false, reason: 'Git identity unavailable' };
  let index;
  let head;
  try { index = parseStageZ(stageResult.stdout, relativePath); head = parseTreeZ(treeResult.stdout, relativePath); } catch (error) { return { path: relativePath, validFile: false, reason: error.message }; }
  const headBytes = showBytes(`HEAD:${relativePath}`, repoRoot);
  const indexBytes = index ? showBytes(`:${relativePath}`, repoRoot) : null;
  const unstaged = git(['diff', '--binary', '--no-ext-diff', '--', relativePath], repoRoot);
  const staged = git(['diff', '--cached', '--binary', '--no-ext-diff', '--', relativePath], repoRoot);
  if (unstaged.status !== 0 || staged.status !== 0) return { path: relativePath, validFile: false, reason: 'diff identity unavailable' };
  return {
    path: relativePath,
    validFile: true,
    fileType,
    mode: (stat.mode & 0o177777).toString(8),
    symlinkTarget,
    headSha256: headBytes ? sha256(headBytes) : null,
    indexSha256: indexBytes ? sha256(indexBytes) : null,
    worktreeSha256: sha256(worktreeBytes),
    headMode: head ? head.mode : null,
    headBlob: head ? head.blob : null,
    indexMode: index ? index.mode : null,
    indexBlob: index ? index.blob : null,
    unstagedDiffSha256: sha256(unstaged.stdout),
    unstagedDiffBytes: Buffer.byteLength(unstaged.stdout),
    stagedDiffSha256: sha256(staged.stdout),
    stagedDiffBytes: Buffer.byteLength(staged.stdout),
  };
}

function focusedTestsValid(tests) {
  return Array.isArray(tests) && tests.length > 0 && tests.every((test) => test && typeof test === 'object'
    && typeof test.command === 'string' && test.command.length > 0
    && typeof test.cwd === 'string' && path.isAbsolute(test.cwd)
    && /^[a-f0-9]{64}$/.test(test.sourceSha256 || '') && /^[a-f0-9]{64}$/.test(test.targetSha256 || '')
    && Array.isArray(test.expectedTests) && test.expectedTests.length > 0 && test.expectedTests.every((name) => typeof name === 'string' && name.length > 0)
    && (test.exit === 0 || test.exitCode === 0)
    && /^[a-f0-9]{64}$/.test(test.outputSha256 || '')
    && Number.isInteger(test.outputBytes) && test.outputBytes > 0
    && test.outputEvidence && test.metadataEvidence);
}

function validateCustodyRow(row, actual, edgeSources = [], evidenceValid = false) {
  if (!row || !actual || !actual.validFile || !['CLEAN_BASELINE', 'OWNED_VERIFIED'].includes(row.status)) return false;
  const mode = String(row.mode || row.filesystemMode || '').replace(/^0+/, '');
  const identityMatches = row.fileType === actual.fileType && mode === actual.mode.replace(/^0+/, '')
    && (row.symlinkTarget === actual.symlinkTarget || (row.symlink === false && actual.symlinkTarget === null))
    && row.headSha256 === actual.headSha256 && row.indexSha256 === actual.indexSha256
    && row.worktreeSha256 === actual.worktreeSha256
    && row.unstagedDiffSha256 === actual.unstagedDiffSha256 && row.unstagedDiffBytes === actual.unstagedDiffBytes
    && row.stagedDiffSha256 === actual.stagedDiffSha256 && row.stagedDiffBytes === actual.stagedDiffBytes
    && (row.headBlob || row.headBlobOid || null) === actual.headBlob
    && (row.gitModeHead || row.headMode || null) === actual.headMode
    && (row.indexBlob || row.indexBlobOid || null) === actual.indexBlob
    && (row.gitModeIndex || row.indexMode || null) === actual.indexMode;
  const provenance = typeof (row.directCallPath || row.directLink) === 'string'
    && edgeSources.some((source) => String(row.directCallPath || row.directLink).includes(source))
    && row.provenanceEvidence && typeof row.provenanceEvidence.path === 'string';
  const clean = row.status === 'CLEAN_BASELINE' && actual.headSha256 !== null
    && actual.headSha256 === actual.indexSha256 && actual.indexSha256 === actual.worktreeSha256
    && actual.unstagedDiffBytes === 0 && actual.stagedDiffBytes === 0 && focusedTestsValid(row.focusedTests);
  const owned = row.status === 'OWNED_VERIFIED' && row.reviewedDiff === true
    && typeof row.owner === 'string' && row.owner.trim().length > 0
    && typeof (row.intendedPurpose || row.intent) === 'string' && String(row.intendedPurpose || row.intent).trim().length > 0
    && typeof row.authoringEvidence === 'string' && row.authoringEvidence.trim().length > 0 && !/\bABSENT\b/i.test(row.authoringEvidence)
    && focusedTestsValid(row.focusedTests);
  return identityMatches && provenance && evidenceValid && (clean || owned);
}

function readVerifiedReceipt(baseDir, descriptor, allowEmpty = false) {
  if (!descriptor || typeof descriptor !== 'object' || !isSafeRepoPath(descriptor.path)
    || !/^[a-f0-9]{64}$/.test(descriptor.sha256 || '') || !Number.isInteger(descriptor.bytes)
    || descriptor.bytes < (allowEmpty ? 0 : 1)) return null;
  const read = readLockedEvidenceFile(baseDir, descriptor.path);
  return read.ok && read.bytes.length === descriptor.bytes && sha256(read.bytes) === descriptor.sha256 ? read.bytes : null;
}

function verifyReceiptFile(baseDir, descriptor) {
  return readVerifiedReceipt(baseDir, descriptor) !== null;
}

function parseJsonBytes(bytes) {
  try { return JSON.parse(bytes.toString('utf8')); } catch { return null; }
}

function tapContractValid(rows, expectedNames) {
  return Array.isArray(rows) && Array.isArray(expectedNames) && rows.length === expectedNames.length
    && rows.plans.length === 1 && rows.plans[0] === expectedNames.length
    && rows.every((entry, index) => entry.index === index + 1 && entry.name === expectedNames[index] && entry.pass && !entry.skipped);
}

function validateFocusedTestBytes(rowPath, test, output, metadataBytes, approvedContract = null, currentBindings = null) {
  if (!output || !metadataBytes || sha256(output) !== test.outputSha256 || output.length !== test.outputBytes) return false;
  const metadata = parseJsonBytes(metadataBytes);
  const rows = parseTap(output.toString('utf8'));
  const contract = approvedContract || { command: test.command, cwd: test.cwd, tests: test.expectedTests };
  const bindings = currentBindings || { sourceSha256: test.sourceSha256, targetSha256: test.targetSha256 };
  return metadata && metadata.path === rowPath && metadata.command === test.command && metadata.exit === 0
    && test.command === contract.command && test.cwd === contract.cwd && metadata.cwd === contract.cwd
    && test.sourceSha256 === bindings.sourceSha256 && metadata.sourceSha256 === bindings.sourceSha256
    && test.targetSha256 === bindings.targetSha256 && metadata.targetSha256 === bindings.targetSha256
    && sameList(test.expectedTests, contract.tests) && sameList(metadata.tests && metadata.tests.map((entry) => entry.name), contract.tests)
    && metadata.outputSha256 === test.outputSha256 && metadata.outputBytes === test.outputBytes
    && metadata.testCount === contract.tests.length && metadata.passCount === metadata.testCount
    && metadata.failCount === 0 && metadata.skipCount === 0 && tapContractValid(rows, contract.tests);
}

function validateFocusedTestEvidence(rowPath, test, baseDir, approvedContract = null, currentBindings = null) {
  const output = readVerifiedReceipt(baseDir, test && test.outputEvidence);
  const metadataBytes = readVerifiedReceipt(baseDir, test && test.metadataEvidence);
  return validateFocusedTestBytes(rowPath, test, output, metadataBytes, approvedContract, currentBindings);
}

function validateProvenanceBytes(row, provenanceBytes) {
  const provenance = provenanceBytes && parseJsonBytes(provenanceBytes);
  return Boolean(provenance && provenance.path === row.path && provenance.directCallPath === (row.directCallPath || row.directLink)
    && Array.isArray(provenance.sources) && provenance.sources.length > 0);
}

function validateCustodyEvidence(row, baseDir) {
  const provenanceBytes = readVerifiedReceipt(baseDir, row && row.provenanceEvidence);
  if (!validateProvenanceBytes(row, provenanceBytes)) return false;
  if (row.status === 'OWNED_VERIFIED') {
    const ownershipBytes = readVerifiedReceipt(baseDir, row.ownershipEvidence);
    if (!ownershipBytes) return false;
    let ownership;
    try { ownership = JSON.parse(ownershipBytes.toString('utf8')); } catch { return false; }
    if (ownership.path !== row.path || ownership.owner !== row.owner || ownership.worktreeSha256 !== row.worktreeSha256
      || ownership.intent !== (row.intendedPurpose || row.intent)) return false;
  }
  return Array.isArray(row.focusedTests) && row.focusedTests.length > 0
    && row.focusedTests.every((test) => validateFocusedTestEvidence(row.path, test, baseDir));
}

function validateCustodyManifest(value, actualByPath, closure, evidenceByPath = new Map()) {
  const rows = Array.isArray(value) ? value : value && value.custody;
  if (!Array.isArray(rows) || closure.issues.length) return { valid: false, rows: [] };
  const byPath = new Map(rows.map((row) => [row && row.path, row]));
  const output = closure.paths.map((relativePath) => {
    const edgeSources = closure.edges.filter((edge) => edge.to === relativePath).map((edge) => edge.from);
    const row = byPath.get(relativePath);
    const actual = actualByPath.get(relativePath);
    return { path: relativePath, status: validateCustodyRow(row, actual, edgeSources.length ? edgeSources : [relativePath], evidenceByPath.get(relativePath) === true) ? row.status : 'BLOCKING_UNKNOWN', actual, focusedTests: row && row.focusedTests ? sanitize(row.focusedTests).slice(0, 8) : [] };
  });
  return { valid: output.length === closure.paths.length && output.every((row) => row.status !== 'BLOCKING_UNKNOWN'), rows: output };
}

function deriveExternalIdentity(absolutePath) {
  let stat;
  try { stat = lstatSync(absolutePath); } catch { return { path: absolutePath, validFile: false, readable: false, reason: 'missing external dependency' }; }
  const fileType = stat.isFile() ? 'regular' : stat.isSymbolicLink() ? 'symlink' : 'other';
  if (fileType !== 'regular') return { path: absolutePath, validFile: false, readable: false, fileType, mode: (stat.mode & 0o177777).toString(8), reason: 'external dependency is not a regular file' };
  const read = readBytes(absolutePath);
  if (!read.ok) return { path: absolutePath, validFile: false, readable: false, fileType, mode: (stat.mode & 0o177777).toString(8), reason: 'external dependency is unreadable' };
  return { path: absolutePath, validFile: true, readable: true, fileType, mode: (stat.mode & 0o177777).toString(8), sizeBytes: read.bytes.length, worktreeSha256: sha256(read.bytes) };
}

function validateExternalCustodyRow(row, actual, caller, evidenceValid = false) {
  if (!row || row.path !== EXTERNAL_STYLE_MODULE || !actual || !actual.validFile || !actual.readable
    || !['CLEAN_BASELINE', 'OWNED_VERIFIED'].includes(row.status)) return false;
  const mode = String(row.mode || row.filesystemMode || '').replace(/^0+/, '');
  const identityMatches = row.fileType === actual.fileType && mode === actual.mode.replace(/^0+/, '')
    && row.worktreeSha256 === actual.worktreeSha256 && row.sizeBytes === actual.sizeBytes;
  const provenance = typeof (row.directCallPath || row.directLink) === 'string'
    && String(row.directCallPath || row.directLink).includes(caller)
    && row.provenanceEvidence && typeof row.provenanceEvidence.path === 'string';
  const owned = row.status === 'OWNED_VERIFIED' && row.reviewedDiff === true
    && typeof row.owner === 'string' && row.owner.trim().length > 0
    && typeof (row.intendedPurpose || row.intent) === 'string' && String(row.intendedPurpose || row.intent).trim().length > 0
    && typeof row.authoringEvidence === 'string' && row.authoringEvidence.trim().length > 0 && !/\bABSENT\b/i.test(row.authoringEvidence);
  const clean = row.status === 'CLEAN_BASELINE';
  return identityMatches && provenance && evidenceValid && focusedTestsValid(row.focusedTests) && (clean || owned);
}

function validateExternalCustodyManifest(value, actual, evidenceValid = false) {
  const rows = Array.isArray(value) ? value : value && value.custody;
  const row = Array.isArray(rows) ? rows.find((candidate) => candidate && candidate.path === EXTERNAL_STYLE_MODULE) : null;
  return { valid: validateExternalCustodyRow(row, actual, EXTERNAL_STYLE_CALLER, evidenceValid), row };
}

function validateExternalProvenanceBytes(row, provenanceBytes, caller) {
  if (!validateProvenanceBytes(row, provenanceBytes)) return false;
  const provenance = parseJsonBytes(provenanceBytes);
  return provenance.sources.includes(caller);
}

function focusedContractBindings(repoRoot, contract) {
  const source = readBytes(path.isAbsolute(contract.sourcePath) ? contract.sourcePath : path.join(repoRoot, contract.sourcePath));
  const target = readBytes(EXTERNAL_STYLE_MODULE);
  return source.ok && target.ok ? { sourceSha256: sha256(source.bytes), targetSha256: sha256(target.bytes) } : null;
}

function validateExternalCustodyEvidence(row, baseDir, repoRoot) {
  const provenanceBytes = readVerifiedReceipt(baseDir, row && row.provenanceEvidence);
  if (!validateExternalProvenanceBytes(row, provenanceBytes, EXTERNAL_STYLE_CALLER)) return false;
  if (!Array.isArray(row.focusedTests) || row.focusedTests.length !== EXTERNAL_STYLE_TEST_CONTRACTS.length) return false;
  const byCommand = new Map(row.focusedTests.map((test) => [test && test.command, test]));
  if (byCommand.size !== EXTERNAL_STYLE_TEST_CONTRACTS.length) return false;
  const testsValid = EXTERNAL_STYLE_TEST_CONTRACTS.every((contract) => {
    const bindings = focusedContractBindings(repoRoot, contract);
    const test = byCommand.get(contract.command);
    return bindings && test && validateFocusedTestEvidence(row.path, test, baseDir, contract, bindings);
  });
  if (!testsValid) return false;
  if (row.status !== 'OWNED_VERIFIED') return true;
  const ownershipBytes = readVerifiedReceipt(baseDir, row.ownershipEvidence);
  const ownership = ownershipBytes && parseJsonBytes(ownershipBytes);
  return Boolean(ownership && ownership.path === row.path && ownership.owner === row.owner
    && ownership.worktreeSha256 === row.worktreeSha256 && ownership.intent === (row.intendedPurpose || row.intent));
}

function checkCustody(repoRoot) {
  const closure = discoverDependencyClosure(repoRoot, CUSTODY_SEEDS);
  const receipt = readJsonCandidate(['custody/manifest.json', 'custody/custody-manifest.json']);
  if (!receipt.ok) {
    const externalActual = deriveExternalIdentity(EXTERNAL_STYLE_MODULE);
    return {
      status: 'BLOCKING_UNKNOWN',
      detail: `Custody manifest ${receipt.error}; discovered ${closure.paths.length} local paths, ${closure.issues.length} unresolved executable dependencies, ${closure.externalDependencies.length} call-critical external dependencies, and ${closure.warnings.length} presentation warnings.`,
      evidence: [`external:${EXTERNAL_STYLE_MODULE}:sha256:${externalActual.worktreeSha256 || 'unavailable'}`],
      custody: [{ path: EXTERNAL_STYLE_MODULE, status: 'BLOCKING_UNKNOWN', ...externalActual, focusedTests: [] }],
    };
  }
  const rows = Array.isArray(receipt.value) ? receipt.value : receipt.value.custody;
  const allPaths = new Set([...closure.paths, ...(Array.isArray(rows) ? rows.map((row) => row && row.path).filter(isSafeRepoPath) : [])]);
  const actual = new Map([...allPaths].map((relativePath) => [relativePath, deriveCustodyIdentity(repoRoot, relativePath)]));
  const baseDir = path.dirname(receipt.absolutePath);
  const evidence = new Map((Array.isArray(rows) ? rows : []).map((row) => [row && row.path, validateCustodyEvidence(row, baseDir)]));
  const validation = validateCustodyManifest(receipt.value, actual, closure, evidence);
  const externalActual = deriveExternalIdentity(EXTERNAL_STYLE_MODULE);
  const externalEvidenceValid = Array.isArray(rows)
    && rows.some((row) => row && row.path === EXTERNAL_STYLE_MODULE && validateExternalCustodyEvidence(row, baseDir, repoRoot));
  const externalValidation = validateExternalCustodyManifest(receipt.value, externalActual, externalEvidenceValid);
  const dependencyDeclared = closure.externalDependencies.length === 1
    && closure.externalDependencies[0].from === EXTERNAL_STYLE_CALLER
    && closure.externalDependencies[0].path === EXTERNAL_STYLE_MODULE;
  const valid = validation.valid && dependencyDeclared && externalValidation.valid;
  const externalOutput = { path: EXTERNAL_STYLE_MODULE, status: externalValidation.valid ? externalValidation.row.status : 'BLOCKING_UNKNOWN', ...externalActual,
    focusedTests: externalValidation.row && externalValidation.row.focusedTests ? sanitize(externalValidation.row.focusedTests).slice(0, 8) : [] };
  return {
    status: valid ? 'PASS' : 'BLOCKING_UNKNOWN',
    detail: valid ? `Every path in the ${closure.paths.length}-file discovered local call-path closure and the call-critical external executable dependency has rederived identity, provenance, and parsed focused-test evidence; ${closure.warnings.length} presentation dependencies are warnings.` : `Custody evidence failed rederivation or dependency closure (${closure.paths.length} local paths, ${closure.issues.length} unresolved executable dependencies, ${closure.externalDependencies.length} call-critical external dependencies, ${closure.warnings.length} presentation warnings).`,
    evidence: [`${receipt.relativePath}:sha256:${receipt.sha256}`, `external:${EXTERNAL_STYLE_MODULE}:sha256:${externalActual.worktreeSha256 || 'unavailable'}`, ...closure.warnings.map((warning) => `warning:${warning.from}:${warning.reason}`).slice(0, 8)],
    custody: [...validation.rows.map((row) => ({ path: row.path, status: row.status, ...(row.actual || {}), focusedTests: row.focusedTests })), externalOutput],
  };
}

function observeForeignWorktreeRow(repoRoot, current) {
  const absolutePath = path.join(repoRoot, current.path);
  let stat;
  try { stat = lstatSync(absolutePath); } catch { stat = null; }
  if (current.status === ' D') {
    const stageResult = git(['ls-files', '--stage', '-z', '--', current.path], repoRoot);
    const treeResult = git(['ls-tree', '--full-tree', '-z', 'HEAD', '--', current.path], repoRoot);
    if (stageResult.status !== 0 || treeResult.status !== 0) return { valid: false };
    let index;
    let head;
    try { index = parseStageZ(stageResult.stdout, current.path); head = parseTreeZ(treeResult.stdout, current.path); } catch { return { valid: false }; }
    const indexBytes = index && showBytes(`:${current.path}`, repoRoot);
    const headBytes = head && showBytes(`HEAD:${current.path}`, repoRoot);
    return { valid: !stat && Boolean(index && head && indexBytes && headBytes), statExists: Boolean(stat), index, head,
      indexSha256: indexBytes ? sha256(indexBytes) : null, headSha256: headBytes ? sha256(headBytes) : null };
  }
  if (!stat || (!stat.isFile() && !stat.isSymbolicLink())) return { valid: false, statExists: Boolean(stat) };
  const fileType = stat.isSymbolicLink() ? 'symlink' : 'regular';
  const symlinkTarget = stat.isSymbolicLink() ? readlinkSync(absolutePath) : null;
  const bytes = stat.isSymbolicLink() ? Buffer.from(symlinkTarget) : readFileSync(absolutePath);
  return { valid: true, statExists: true, fileType, mode: (stat.mode & 0o177777).toString(8), symlinkTarget, worktreeSha256: sha256(bytes) };
}

function validateForeignWorktreeReceipt(receipt, currentRows, observations, context) {
  const receiptRows = receipt && receipt.paths;
  if (!receipt || !Array.isArray(receiptRows) || !Array.isArray(currentRows) || !(observations instanceof Map)
    || receipt.repoRoot !== context.repoRoot || receipt.branch !== context.branch || receipt.head !== context.head
    || receipt.statusPorcelainV1ZSha256 !== sha256(context.statusBytes)
    || receipt.statusPorcelainV1ZBytes !== context.statusBytes.length || receiptRows.length !== currentRows.length) return false;
  const keys = receiptRows.map((row) => `${row && row.status}\0${row && row.path}\0${row && row.originalPath || ''}`);
  if (new Set(keys).size !== receiptRows.length) return false;
  const byKey = new Map(receiptRows.map((row, index) => [keys[index], row]));
  return currentRows.every((current) => {
    if (!isSafeRepoPath(current.path) || (current.originalPath !== null && !isSafeRepoPath(current.originalPath)) || !statusRowIsForeign(current)) return false;
    const key = `${current.status}\0${current.path}\0${current.originalPath || ''}`;
    const recorded = byKey.get(key);
    const observed = observations.get(key);
    if (!recorded || !observed || !observed.valid) return false;
    if (current.status === ' D') {
      return current.originalPath === null && !observed.statExists && recorded.fileType === 'missing'
        && recorded.blockingType === null && recorded.mode === null && recorded.worktreeSha256 === null
        && observed.index && observed.head
        && recorded.indexMode === observed.index.mode && recorded.indexBlob === observed.index.blob && recorded.indexSha256 === observed.indexSha256
        && recorded.headMode === observed.head.mode && recorded.headBlob === observed.head.blob && recorded.headSha256 === observed.headSha256;
    }
    return current.status !== 'D ' && observed.statExists
      && recorded.fileType === observed.fileType && String(recorded.mode || '').replace(/^0+/, '') === observed.mode.replace(/^0+/, '')
      && (recorded.symlinkTarget || null) === observed.symlinkTarget && recorded.worktreeSha256 === observed.worktreeSha256;
  });
}

function checkRepositoryScope(repoRoot) {
  const result = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoRoot);
  if (result.status !== 0) return { status: 'FAIL', detail: 'Repository change scope could not be read.', evidence: [] };
  let rows;
  try { rows = parsePorcelainV1Z(result.stdout); } catch (error) { return { status: 'FAIL', detail: error.message, evidence: [] }; }
  const foreign = rows.filter(statusRowIsForeign);
  if (!foreign.length) return { status: 'PASS', detail: `Every current repository change is inside the ${LEASE_PATHS.length}-path lease.`, evidence: [] };
  const receipt = readJsonCandidate(['boundary/postcommit-foreign-worktree.json', 'boundary/foreign-worktree.json', 'preflight/foreign-worktree.json']);
  if (!receipt.ok) return { status: 'BLOCKING_UNKNOWN', detail: `Foreign worktree boundary receipt ${receipt.error}.`, evidence: [] };
  const observations = new Map(foreign.map((current) => {
    const key = `${current.status}\0${current.path}\0${current.originalPath || ''}`;
    return [key, observeForeignWorktreeRow(repoRoot, current)];
  }));
  const valid = validateForeignWorktreeReceipt(receipt.value, foreign, observations, {
    repoRoot,
    branch: gitText(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot),
    head: gitText(['rev-parse', 'HEAD'], repoRoot),
    statusBytes: Buffer.from(result.stdout),
  });
  return {
    status: valid ? 'PASS' : 'BLOCKING_UNKNOWN',
    detail: valid ? 'Every foreign worktree change matches the read-only boundary receipt.' : 'Foreign worktree state is unrecorded or has drifted.',
    evidence: [`${receipt.relativePath}:sha256:${receipt.sha256}`],
  };
}

function validateMutationTapRows(mutantId, tapRows) {
  const expectedNames = TEST_NAMES.slice(0, 20);
  const expectedFailing = EXPECTED_MUTATION_FAILURES[mutantId];
  if (!Array.isArray(expectedFailing) || expectedFailing.length === 0 || !Array.isArray(tapRows)
    || tapRows.length !== expectedNames.length || tapRows.plans.length !== 1 || tapRows.plans[0] !== 20
    || !tapRows.every((entry, index) => entry.index === index + 1 && entry.name === expectedNames[index] && !entry.skipped)) return false;
  const failing = new Set(expectedFailing);
  return tapRows.every((entry) => entry.pass === !failing.has(entry.name));
}

function validateMutationArtifactBytes(row, bindings, raw) {
  const metadata = raw && raw.metadata && parseJsonBytes(raw.metadata);
  const tapRows = raw && raw.stdout ? parseTap(raw.stdout.toString('utf8')) : [];
  const failing = tapRows.filter((entry) => !entry.pass).map((entry) => entry.name);
  return metadata && metadata.id === row.id && Number.isInteger(metadata.exit) && metadata.exit !== 0 && metadata.exit === row.exit
    && ['coachSha256', 'testSha256', 'sourceSha256', 'runnerSha256'].every((key) => metadata.bindings && metadata.bindings[key] === bindings[key])
    && metadata.stdoutSha256 === sha256(raw.stdout) && metadata.stderrSha256 === sha256(raw.stderr)
    && metadata.stdoutBytes === raw.stdout.length && metadata.stderrBytes === raw.stderr.length
    && validateMutationTapRows(row.id, tapRows)
    && sameList(failing, TEST_NAMES.slice(0, 20).filter((name) => EXPECTED_MUTATION_FAILURES[row.id].includes(name)))
    && sameSet(row.actualFailingTests || row.observedFailingTests, failing);
}

function validateMutationArtifacts(row, baseDir, bindings) {
  const prefix = `mutations/${row && row.id}/`;
  const artifacts = row && row.artifacts;
  if (!artifacts || !['stdout', 'stderr', 'metadata'].every((key) => artifacts[key] && artifacts[key].path.startsWith(prefix))) return false;
  const stdout = readVerifiedReceipt(baseDir, artifacts.stdout);
  const stderr = readVerifiedReceipt(baseDir, artifacts.stderr, true);
  const metadata = readVerifiedReceipt(baseDir, artifacts.metadata);
  return Boolean(stdout && stderr && metadata && validateMutationArtifactBytes(row, bindings, { stdout, stderr, metadata }));
}

function validateMutationReceipt(value, bindings, baseDir = null) {
  if (!value || !bindings || !value.bindings || !['coachSha256', 'testSha256', 'sourceSha256', 'runnerSha256'].every((key) => value.bindings[key] === bindings[key])) return false;
  const rows = Array.isArray(value.mutants) ? value.mutants : value.mutations;
  if (!Array.isArray(rows) || rows.length !== MUTANTS.length) return false;
  const byId = new Map(rows.map((row) => [row && row.id, row]));
  return byId.size === MUTANTS.length && MUTANTS.every((id) => {
    const row = byId.get(id);
    const observed = row && (row.actualFailingTests || row.observedFailingTests);
    return row && row.status === 'KILLED' && Number.isInteger(row.exit) && row.exit !== 0
      && EXPECTED_MUTATION_FAILURES[id].length > 0
      && sameSet(row.expectedFailingTests, EXPECTED_MUTATION_FAILURES[id])
      && sameSet(observed, EXPECTED_MUTATION_FAILURES[id])
      && typeof baseDir === 'string' && validateMutationArtifacts(row, baseDir, bindings);
  });
}

function mutationBindings(repoRoot) {
  const paths = {
    coachSha256: path.join(repoRoot, 'backend/coach-app.js'),
    testSha256: path.join(repoRoot, 'backend/test/coach-app-iife.test.js'),
    sourceSha256: R12_SOURCE_PATH,
    runnerSha256: R12_RUNNER_PATH,
  };
  const bindings = {};
  for (const [key, filePath] of Object.entries(paths)) {
    const read = readBytes(filePath);
    if (!read.ok) return null;
    bindings[key] = sha256(read.bytes);
  }
  return bindings;
}

function checkMutationEvidence(repoRoot) {
  const receipt = readJsonCandidate(['mutation/summary.json', 'tests/r12-mutation-summary.json']);
  if (!receipt.ok) return { status: 'BLOCKING_UNKNOWN', detail: `R12 mutation receipt ${receipt.error}.`, evidence: [] };
  const bindings = mutationBindings(repoRoot);
  const valid = bindings && validateMutationReceipt(receipt.value, bindings, path.dirname(receipt.absolutePath));
  return {
    status: valid ? 'PASS' : 'BLOCKING_UNKNOWN',
    detail: valid ? 'All 12 mutants have hash-bound raw stdout/stderr/metadata, parsed TAP failures, nonzero exits, hardcoded nonempty accepted sets, and current coach/test/source/runner bindings.' : 'R12 mutation evidence lacks independently hash-bound raw artifacts, parsed TAP failures, current bindings, or exact nonempty failing sets.',
    evidence: [`${receipt.relativePath}:sha256:${receipt.sha256}`],
  };
}

function splitNulBuffers(output) {
  const bytes = Buffer.from(output);
  if (!bytes.length) return [];
  if (bytes[bytes.length - 1] !== 0) throw new Error('Git NUL record stream is unterminated');
  const parts = [];
  let start = 0;
  for (let index = 0; index < bytes.length; index++) {
    if (bytes[index] === 0) { parts.push(bytes.subarray(start, index)); start = index + 1; }
  }
  return parts;
}

function decodeGitPath(bytes) {
  const value = Buffer.from(bytes).toString('utf8');
  if (!Buffer.from(value, 'utf8').equals(Buffer.from(bytes)) || !isSafeRepoPath(value)) throw new Error('Git path is invalid or unsafe');
  return value;
}

function parseIndexStageRecords(output) {
  const records = splitNulBuffers(output);
  const parsed = records.map((raw) => {
    const tab = raw.indexOf(0x09);
    if (tab < 0) throw new Error('Malformed index record');
    const header = raw.subarray(0, tab).toString('ascii');
    const match = header.match(/^([0-7]{6}) ([a-f0-9]{40}|[a-f0-9]{64}) ([0-3])$/);
    if (!match) throw new Error('Malformed index identity');
    const pathBytes = raw.subarray(tab + 1);
    const relativePath = decodeGitPath(pathBytes);
    return { mode: match[1], objectId: match[2], stage: Number(match[3]), path: relativePath, pathBytes: Buffer.from(pathBytes), raw: Buffer.from(raw) };
  });
  const identities = parsed.map((record) => `${record.path}\0${record.stage}`);
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate index path/stage record');
  return parsed;
}

function canonicalForeignIndexBytes(output) {
  const records = parseIndexStageRecords(output).filter((record) => !LEASE_PATHS.includes(record.path));
  records.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes)
    || left.stage - right.stage || Buffer.compare(left.raw, right.raw));
  return Buffer.concat(records.map((record) => Buffer.concat([record.raw, Buffer.from([0])] )));
}

function canonicalForeignTreeBytes(output) {
  const records = splitNulBuffers(output).map((raw) => {
    const tab = raw.indexOf(0x09);
    if (tab < 0) throw new Error('Malformed tree record');
    const match = raw.subarray(0, tab).toString('ascii').match(/^([0-7]{6}) (blob|commit) ([a-f0-9]{40}|[a-f0-9]{64})$/);
    if (!match) throw new Error('Malformed tree identity');
    const pathBytes = raw.subarray(tab + 1);
    return { path: decodeGitPath(pathBytes), pathBytes: Buffer.from(pathBytes), raw: Buffer.from(raw) };
  }).filter((record) => !LEASE_PATHS.includes(record.path));
  const identities = records.map((record) => record.path);
  if (new Set(identities).size !== identities.length) throw new Error('Duplicate tree path record');
  records.sort((left, right) => Buffer.compare(left.pathBytes, right.pathBytes) || Buffer.compare(left.raw, right.raw));
  return Buffer.concat(records.map((record) => Buffer.concat([record.raw, Buffer.from([0])] )));
}

function readCommitForeignTree(repoRoot, commit) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) return null;
  const result = git(['ls-tree', '--full-tree', '-r', '-z', commit], repoRoot);
  if (result.status !== 0) return null;
  try { return canonicalForeignTreeBytes(result.stdout); } catch { return null; }
}

function stripOneTerminalGitEol(output) {
  const text = Buffer.from(output).toString('utf8');
  return text.endsWith('\r\n') ? text.slice(0, -2) : text.endsWith('\n') ? text.slice(0, -1) : text;
}

function parseNameStatusZ(output) {
  const fields = splitNulBuffers(output);
  const records = [];
  const identities = new Set();
  for (let index = 0; index < fields.length;) {
    const status = fields[index++].toString('ascii');
    let arity;
    if (/^[AMDTU]$/.test(status)) arity = 1;
    else if (/^[RC](?:100|[1-9]?[0-9])$/.test(status)) arity = 2;
    else throw new Error('Unknown or malformed staged status');
    if (index + arity > fields.length) throw new Error('Staged status record lacks endpoints');
    const endpointBytes = fields.slice(index, index + arity).map((value) => Buffer.from(value));
    index += arity;
    const endpoints = endpointBytes.map(decodeGitPath);
    if (new Set(endpoints).size !== endpoints.length) throw new Error('Ambiguous duplicate staged endpoints');
    const identity = `${status}\0${endpoints.join('\0')}`;
    if (identities.has(identity)) throw new Error('Duplicate staged status record');
    identities.add(identity);
    records.push({ status, endpoints, endpointBytes });
  }
  return records;
}

function foreignBinaryDiffPaths(output) {
  const paths = new Map();
  for (const record of parseNameStatusZ(output)) {
    if (record.endpoints.every((relativePath) => LEASE_PATHS.includes(relativePath))) continue;
    record.endpoints.forEach((relativePath, index) => paths.set(relativePath, record.endpointBytes[index]));
  }
  return [...paths].sort((left, right) => Buffer.compare(left[1], right[1])).map(([relativePath]) => relativePath);
}

function oldDestinationOnlyForeignPaths(output) {
  return parseNameStatusZ(output).map((record) => record.endpoints[record.endpoints.length - 1])
    .filter((relativePath) => !LEASE_PATHS.includes(relativePath));
}

function readCurrentForeignIndex(repoRoot) {
  const result = git(['ls-files', '--stage', '-z'], repoRoot);
  if (result.status !== 0) return null;
  try { return canonicalForeignIndexBytes(result.stdout); } catch { return null; }
}

function readCurrentForeignBinaryDiff(repoRoot) {
  const discoveryArgs = ['diff', '--cached', '--name-status', '-z', '--find-renames', '--find-copies', '--find-copies-harder'];
  const result = git(discoveryArgs, repoRoot);
  if (result.status !== 0) return null;
  let names;
  try { names = foreignBinaryDiffPaths(result.stdout); } catch { return null; }
  if (!names.length) return Buffer.alloc(0);
  const diff = git(['diff', '--cached', '--binary', '--no-ext-diff', '--find-renames', '--find-copies', '--find-copies-harder', '--', ...names], repoRoot);
  return diff.status === 0 ? Buffer.from(diff.stdout) : null;
}

function currentForeignIndexEvidence(repoRoot) {
  const index = readCurrentForeignIndex(repoRoot);
  const binaryDiff = readCurrentForeignBinaryDiff(repoRoot);
  return index !== null && binaryDiff !== null ? { index, binaryDiff } : null;
}

function observeCommit(repoRoot, commit, expectedPaths) {
  if (!/^[a-f0-9]{40}$/.test(commit || '')) return { exists: false, parents: [], message: null, paths: [], blobs: {} };
  const exists = git(['show', '--format=%H', '--no-patch', `${commit}^{commit}`], repoRoot);
  if (exists.status !== 0 || exists.stdout.toString('utf8').trim() !== commit) return { exists: false, parents: [], message: null, paths: [], blobs: {} };
  const parents = git(['show', '--format=%P', '--no-patch', commit], repoRoot);
  const subject = git(['show', '--format=%s', '--no-patch', commit], repoRoot);
  const tree = git(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', commit], repoRoot);
  if (tree.status !== 0 || parents.status !== 0 || subject.status !== 0) return { exists: false, parents: [], message: null, paths: [], blobs: {} };
  let paths;
  try { paths = parseNulList(tree.stdout); } catch { return { exists: false, parents: [], message: null, paths: [], blobs: {} }; }
  const blobs = {};
  for (const relativePath of expectedPaths) {
    const bytes = showBytes(`${commit}:${relativePath}`, repoRoot);
    blobs[relativePath] = bytes ? sha256(bytes) : null;
  }
  const parentList = parents.stdout.toString('utf8').trim().split(/\s+/).filter(Boolean);
  const foreignParentTree = parentList.length === 1 ? readCommitForeignTree(repoRoot, parentList[0]) : null;
  const foreignCommitTree = readCommitForeignTree(repoRoot, commit);
  return { exists: true, parents: parentList, message: stripOneTerminalGitEol(subject.stdout), paths, blobs,
    foreignParentTree, foreignCommitTree };
}

function jsonEqual(left, right) {
  if (typeof left !== typeof right || left === null || right === null) return left === right;
  if (Array.isArray(left) || Array.isArray(right)) return Array.isArray(left) && Array.isArray(right)
    && left.length === right.length && left.every((value, index) => jsonEqual(value, right[index]));
  if (typeof left !== 'object') return left === right;
  const leftKeys = Object.keys(left); const rightKeys = Object.keys(right);
  return sameList(leftKeys.sort(), rightKeys.sort()) && leftKeys.every((key) => jsonEqual(left[key], right[key]));
}

function canonicalGeneratedJson(value) {
  const sort = (item) => {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== 'object') return item;
    return Object.fromEntries(Object.keys(item).sort().map((key) => [key, sort(item[key])]));
  };
  return Buffer.from(`${JSON.stringify(sort(value), null, 2)}\n`);
}

function strictSchemaValidate(value, schema, root = schema) {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || jsonEqual(schema.not, {})) return false;
  if ('$ref' in schema) {
    const prefix = '#/$defs/';
    return Object.keys(schema).length === 1 && typeof schema.$ref === 'string' && schema.$ref.startsWith(prefix)
      && root.$defs && strictSchemaValidate(value, root.$defs[schema.$ref.slice(prefix.length)], root);
  }
  if ('const' in schema) return Object.keys(schema).length === 1 && jsonEqual(value, schema.const);
  if (schema.type === 'object') {
    const allowed = new Set(['$schema', '$defs', 'type', 'additionalProperties', 'required', 'properties']);
    const properties = schema.properties; const required = schema.required;
    return Object.keys(schema).every((key) => allowed.has(key)) && schema.additionalProperties === false
      && value && typeof value === 'object' && !Array.isArray(value) && properties && typeof properties === 'object'
      && Array.isArray(required) && new Set(required).size === required.length
      && sameSet(required, Object.keys(properties)) && sameSet(Object.keys(value), Object.keys(properties))
      && Object.keys(properties).every((key) => strictSchemaValidate(value[key], properties[key], root));
  }
  if (schema.type === 'array') {
    const allowed = new Set(['type', 'minItems', 'maxItems', 'prefixItems', 'items']);
    return Object.keys(schema).every((key) => allowed.has(key)) && Array.isArray(value) && Array.isArray(schema.prefixItems)
      && schema.items === false && schema.minItems === schema.prefixItems.length && schema.maxItems === schema.prefixItems.length
      && value.length === schema.prefixItems.length && value.every((item, index) => strictSchemaValidate(item, schema.prefixItems[index], root));
  }
  return false;
}

function readExactArtifact(descriptor) {
  const read = readLockedEvidenceFile(EVIDENCE_ROOT, descriptor.path);
  return read.ok && read.bytes.length === descriptor.bytes && sha256(read.bytes) === descriptor.sha256 ? read.bytes : null;
}

function readStrictJsonArtifact(descriptor) {
  const bytes = readExactArtifact(descriptor);
  return bytes ? parseJsonBytes(bytes) : null;
}

function repositorySnapshot(repoRoot) {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const head = git(['rev-parse', 'HEAD'], repoRoot);
  const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=all'], repoRoot);
  return branch.status === 0 && head.status === 0 && status.status === 0 ? {
    branch: branch.stdout.toString('utf8').trim(), head: head.stdout.toString('utf8').trim(),
    status: Buffer.from(status.stdout), indexLockAbsent: !existsSync(path.join(repoRoot, '.git', 'index.lock')),
  } : null;
}

function snapshotsEqual(left, right) {
  return left && right && left.branch === right.branch && left.head === right.head
    && left.indexLockAbsent && right.indexLockAbsent && left.status.equals(right.status);
}

function readStableLeasedFiles(repoRoot, reader = readLockedRegularFile) {
  const snapshot = {};
  for (const relativePath of LEASE_PATHS) {
    const result = reader(path.join(repoRoot, relativePath));
    if (!result || !result.ok || !result.bytesSha256
      || ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs'].some((key) => result[key] === undefined || result[key] === null)) return null;
    snapshot[relativePath] = {
      dev: result.dev,
      ino: result.ino,
      size: result.size,
      mtimeNs: result.mtimeNs,
      ctimeNs: result.ctimeNs,
      sha256: result.bytesSha256,
    };
  }
  return snapshot;
}

function leasedSnapshotsEqual(left, right) {
  return left && right && sameList(Object.keys(left), LEASE_PATHS) && sameList(Object.keys(right), LEASE_PATHS)
    && LEASE_PATHS.every((relativePath) => jsonEqual(left[relativePath], right[relativePath]));
}

function stableForeignComposite(repoRoot, attempts = 3, readers = null) {
  const ops = { snapshot: repositorySnapshot, index: readCurrentForeignIndex, diff: readCurrentForeignBinaryDiff,
    leased: readStableLeasedFiles, ...(readers || {}) };
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const leasedBefore = ops.leased(repoRoot);
    const before = ops.snapshot(repoRoot);
    const index1 = ops.index(repoRoot);
    const diff1 = ops.diff(repoRoot);
    const index2 = ops.index(repoRoot);
    const diff2 = ops.diff(repoRoot);
    const after = ops.snapshot(repoRoot);
    const leasedAfter = ops.leased(repoRoot);
    if (before && after && index1 && diff1 && index2 && diff2 && snapshotsEqual(before, after)
      && index1.equals(index2) && diff1.equals(diff2) && leasedSnapshotsEqual(leasedBefore, leasedAfter)) {
      return { attempt, before, after, index: index2, binaryDiff: diff2, leased: leasedAfter };
    }
  }
  return null;
}

function validateAnchorPackage(artifacts = ANCHOR_V2_ARTIFACTS) {
  const byPath = new Map(artifacts.map((descriptor) => [descriptor.path, descriptor]));
  if (byPath.size !== ANCHOR_V2_ARTIFACTS.length || !ANCHOR_V2_ARTIFACTS.every((expected) => {
    const actual = byPath.get(expected.path);
    return actual && jsonEqual(actual, expected) && readExactArtifact(actual) !== null;
  })) return false;
  const packageManifest = readStrictJsonArtifact(byPath.get('commit-anchor-v2/package-manifest.json'));
  const anchor = readStrictJsonArtifact(byPath.get('commit-anchor-v2/anchor.json'));
  const reviewSchema = readStrictJsonArtifact(byPath.get('commit-anchor-v2/reviews/review.schema.json'));
  const review = readStrictJsonArtifact(byPath.get('commit-anchor-v2/reviews/review.json'));
  const confirmationSchema = readStrictJsonArtifact(byPath.get('commit-anchor-v2/reviews/confirmation.schema.json'));
  const confirmation = readStrictJsonArtifact(byPath.get('commit-anchor-v2/reviews/confirmation.json'));
  const rehash = readStrictJsonArtifact(byPath.get('commit-anchor-v2/reviews/anchor-v2-p8-confirmation-independent-rehash.json'));
  if (!packageManifest || !anchor || !reviewSchema || !review || !confirmationSchema || !confirmation || !rehash) return false;
  const groups = PRECOMMIT_COMMIT_GROUPS.map((group, index) => ({ ordinal: index + 1, subject: group.message, paths: [...group.paths] }));
  return packageManifest.schema === 'transvoice.anchor-v2-package-manifest.v4' && packageManifest.branch === EXPECTED_BRANCH
    && packageManifest.baselineHead === PLANNING_BASELINE && packageManifest.anchor.sha256 === ANCHOR_V2_SHA256
    && anchor.schema === 'transvoice.precommit-foreign-state-anchor.v2' && anchor.repoRoot === EXPECTED_ROOT
    && anchor.branch === EXPECTED_BRANCH && anchor.baselineHead === PLANNING_BASELINE
    && sameList(anchor.leases, LEASE_PATHS) && jsonEqual(anchor.commitGroups, groups)
    && strictSchemaValidate(review, reviewSchema) && review.verdict === 'PASS' && review.findingsCount === 0
    && review.sessionId === 'ses_09f7389c5ffemWSbHcPpq0dr3Q' && review.reviewerIdentity === review.sessionId
    && strictSchemaValidate(confirmation, confirmationSchema) && confirmation.verdict === 'PASS' && confirmation.findingsCount === 0
    && confirmation.sessionId === review.sessionId && confirmation.reviewerIdentity === review.sessionId
    && confirmation.reviewSchema.sha256 === byPath.get('commit-anchor-v2/reviews/review.schema.json').sha256
    && confirmation.reviewSchema.bytes === byPath.get('commit-anchor-v2/reviews/review.schema.json').bytes
    && confirmation.reviewReceipt.sha256 === REVIEW_V2_SHA256 && confirmation.reviewReceipt.bytes === 2246
    && rehash.schema === 'transvoice.anchor-v2-independent-rehash.v3' && rehash.verdict === 'PASS'
    && rehash.findingsCount === 0 && Array.isArray(rehash.generatedFiles) && rehash.generatedFiles.length === 0
    && Array.isArray(rehash.pycacheBefore) && rehash.pycacheBefore.length === 0
    && Array.isArray(rehash.pycacheAfter) && rehash.pycacheAfter.length === 0;
}

function checkAnchorV2(repoRoot) {
  const packageValid = validateAnchorPackage();
  const stable = packageValid ? stableForeignComposite(repoRoot) : null;
  const anchorIndex = readExactArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path === 'commit-anchor/foreign-index.z'));
  const anchorDiff = readExactArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path === 'commit-anchor/foreign-cached-binary.diff'));
  const valid = Boolean(packageValid && stable && stable.before.branch === EXPECTED_BRANCH
    && anchorIndex && anchorDiff && stable.index.equals(anchorIndex) && stable.binaryDiff.equals(anchorDiff));
  return {
    status: valid ? 'PASS' : 'FAIL',
    detail: valid ? `Exact anchor-v2 package, review/confirmation, P8 rehash, and stable foreign index/diff match on attempt ${stable.attempt}.`
      : 'Anchor-v2 artifact bindings, review/confirmation contract, stable repository state, or foreign anchor equality failed.',
    evidence: valid ? [`anchor:sha256:${ANCHOR_V2_SHA256}`, `review:sha256:${REVIEW_V2_SHA256}`, `confirmation:sha256:${CONFIRMATION_V2_SHA256}`] : [],
  };
}

function validateCommitReceiptRow(row, observed, expectedGroup, currentHashes, currentOwnedPaths = null) {
  const expectedPaths = expectedGroup && expectedGroup.paths;
  const pathsRequiredCurrent = currentOwnedPaths || expectedPaths;
  const exactKeys = ['blobSha256', 'commit', 'parent', 'paths', 'subject'];
  if (!row || !sameSet(Object.keys(row), exactKeys) || !/^[a-f0-9]{40}$/.test(row.commit || '') || !expectedGroup
    || row.subject !== expectedGroup.message || !sameList(row.paths, expectedPaths) || !observed || !observed.exists
    || observed.message !== expectedGroup.message || !sameSet(observed.paths, expectedPaths) || observed.paths.length !== expectedPaths.length) return false;
  const declaredBlobs = row.blobSha256;
  return declaredBlobs && typeof declaredBlobs === 'object' && !Array.isArray(declaredBlobs)
    && sameSet(Object.keys(declaredBlobs), expectedPaths)
    && expectedPaths.every((relativePath) => /^[a-f0-9]{64}$/.test(declaredBlobs[relativePath] || '')
      && declaredBlobs[relativePath] === observed.blobs[relativePath]
      && (!pathsRequiredCurrent.includes(relativePath) || observed.blobs[relativePath] === currentHashes[relativePath]))
    && observed.foreignParentTree && observed.foreignCommitTree && observed.foreignParentTree.equals(observed.foreignCommitTree);
}

function validateCommitChain({ rows, observations, expectedGroups = COMMIT_GROUPS, currentHashes, currentHead,
  baseline = PLANNING_BASELINE, currentForeign, anchorForeign }) {
  if (!Array.isArray(rows) || !Array.isArray(observations) || rows.length !== expectedGroups.length
    || observations.length !== expectedGroups.length || new Set(rows.map((row) => row && row.commit)).size !== expectedGroups.length
    || !currentForeign || !anchorForeign || !currentForeign.index.equals(anchorForeign.index)
    || !currentForeign.binaryDiff.equals(anchorForeign.binaryDiff)) return false;
  const expectedUnion = expectedGroups.flatMap((group) => group.paths);
  const expectedUnionUnique = [...new Set(expectedUnion)];
  if (!sameSet(expectedUnionUnique, LEASE_PATHS)) return false;
  const expectedCounts = {};
  for (const relativePath of expectedUnion) expectedCounts[relativePath] = (expectedCounts[relativePath] || 0) + 1;
  const duplicatePaths = Object.keys(expectedCounts).filter((relativePath) => expectedCounts[relativePath] > 1);
  if (duplicatePaths.length !== 1 || duplicatePaths[0] !== LEASE_PATHS[2] || expectedCounts[LEASE_PATHS[2]] !== 2
    || !LEASE_PATHS.every((relativePath) => relativePath === LEASE_PATHS[2] || expectedCounts[relativePath] === 1)) return false;
  const latestOwner = {};
  expectedGroups.forEach((group, index) => group.paths.forEach((relativePath) => { latestOwner[relativePath] = index; }));
  for (let index = 0; index < expectedGroups.length; index++) {
    const expectedParent = index === 0 ? baseline : rows[index - 1].commit;
    if (rows[index].parent !== expectedParent || observations[index].parents.length !== 1
      || observations[index].parents[0] !== expectedParent
      || !validateCommitReceiptRow(rows[index], observations[index], expectedGroups[index], currentHashes,
        expectedGroups[index].paths.filter((relativePath) => latestOwner[relativePath] === index))) return false;
  }
  return rows[rows.length - 1].commit === currentHead;
}

function buildCommitSchema(manifest) {
  const rowDefs = {};
  manifest.rows.forEach((row, index) => {
    rowDefs[`row${index + 1}`] = { type: 'object', additionalProperties: false,
      required: ['commit', 'subject', 'parent', 'paths', 'blobSha256'], properties: {
        commit: { const: row.commit }, subject: { const: row.subject }, parent: { const: row.parent },
        paths: { const: row.paths }, blobSha256: { const: row.blobSha256 },
      } };
  });
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', type: 'object', additionalProperties: false,
    required: ['schema', 'anchor', 'baselineHead', 'rows', 'finalHead'], properties: {
      schema: { const: manifest.schema }, anchor: { const: manifest.anchor }, baselineHead: { const: PLANNING_BASELINE },
      rows: { type: 'array', minItems: 5, maxItems: 5, prefixItems: [1, 2, 3, 4, 5].map((n) => ({ $ref: `#/$defs/row${n}` })), items: false },
      finalHead: { const: manifest.finalHead },
    }, $defs: rowDefs };
}

function strictCommitManifestEnvelope(manifest) {
  return manifest && sameSet(Object.keys(manifest), ['schema', 'anchor', 'baselineHead', 'rows', 'finalHead'])
    && manifest.schema === 'transvoice.five-commit-evidence.v3' && manifest.baselineHead === PLANNING_BASELINE
    && manifest.anchor && sameSet(Object.keys(manifest.anchor), ['sha256', 'reviewSha256', 'confirmationSha256'])
    && manifest.anchor.sha256 === ANCHOR_V2_SHA256 && manifest.anchor.reviewSha256 === REVIEW_V2_SHA256
    && manifest.anchor.confirmationSha256 === CONFIRMATION_V2_SHA256 && Array.isArray(manifest.rows) && manifest.rows.length === 5
    && manifest.rows.every((row, index) => row && sameSet(Object.keys(row), ['commit', 'subject', 'parent', 'paths', 'blobSha256'])
      && row.subject === COMMIT_GROUPS[index].message && sameList(row.paths, COMMIT_GROUPS[index].paths));
}

function checkCommitEvidence(repoRoot) {
  const schemaRead = readLockedEvidenceFile(EVIDENCE_ROOT, 'commits/manifest.schema.json');
  const manifestRead = readLockedEvidenceFile(EVIDENCE_ROOT, 'commits/manifest.json');
  if (!schemaRead.ok || !manifestRead.ok) return { status: 'BLOCKING_UNKNOWN', detail: 'Final package-generated commit schema/receipt is not present.', evidence: [] };
  const schema = parseJsonBytes(schemaRead.bytes); const manifest = parseJsonBytes(manifestRead.bytes);
  if (!schema || !strictCommitManifestEnvelope(manifest) || !jsonEqual(schema, buildCommitSchema(manifest)) || !strictSchemaValidate(manifest, schema)
    || !schemaRead.bytes.equals(canonicalGeneratedJson(schema)) || !manifestRead.bytes.equals(canonicalGeneratedJson(manifest))) {
    return { status: 'BLOCKING_UNKNOWN', detail: 'Commit manifest/schema is malformed, open, self-attested, or not the exact package-generated contract.', evidence: [] };
  }
  const stable = stableForeignComposite(repoRoot);
  const currentHashes = stable ? Object.fromEntries(LEASE_PATHS.map((relativePath) => [relativePath, stable.leased[relativePath].sha256])) : {};
  const anchorIndex = readExactArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path === 'commit-anchor/foreign-index.z'));
  const anchorDiff = readExactArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path === 'commit-anchor/foreign-cached-binary.diff'));
  const observations = manifest.rows.map((row, index) => observeCommit(repoRoot, row.commit, COMMIT_GROUPS[index].paths));
  const valid = stable && anchorIndex && anchorDiff && validateCommitChain({ rows: manifest.rows, observations, currentHashes,
    currentHead: stable.after.head, currentForeign: stable, anchorForeign: { index: anchorIndex, binaryDiff: anchorDiff } })
    && manifest.finalHead === stable.after.head;
  return {
    status: valid ? 'PASS' : 'BLOCKING_UNKNOWN',
    detail: valid ? 'Package-generated closed manifest proves the exact five-commit chain, current blobs, parent-to-commit foreign trees, and stable final foreign anchor.'
      : 'Exact five-commit ancestry, subjects, groups, current blobs, foreign trees, final head, or stable final anchor is incomplete.',
    evidence: [`commits/manifest.json:sha256:${sha256(manifestRead.bytes)}`, `commits/manifest.schema.json:sha256:${sha256(schemaRead.bytes)}`],
  };
}

function maskJsStringsAndComments(source) {
  const chars = [...String(source)];
  let quote = null;
  let regex = false;
  let regexClass = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let canStartRegex = true;
  let templateExpressionDepth = 0;
  const templateOuterDepths = [];
  for (let index = 0; index < chars.length; index++) {
    const character = chars[index];
    const next = chars[index + 1];
    if (lineComment) { if (character === '\n') lineComment = false; else chars[index] = ' '; continue; }
    if (blockComment) { chars[index] = character === '\n' ? '\n' : ' '; if (character === '*' && next === '/') { chars[index + 1] = ' '; blockComment = false; index++; } continue; }
    if (quote) {
      chars[index] = character === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (quote === '`' && character === '$' && next === '{') {
        chars[index + 1] = ' ';
        quote = null;
        templateExpressionDepth = 1;
        canStartRegex = true;
        index++;
      } else if (character === quote) {
        quote = null;
        if (character === '`') templateExpressionDepth = templateOuterDepths.pop() || 0;
        canStartRegex = false;
      }
      continue;
    }
    if (regex) {
      chars[index] = character === '\n' ? '\n' : ' ';
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '[') regexClass = true;
      else if (character === ']') regexClass = false;
      else if (character === '/' && !regexClass) { regex = false; canStartRegex = false; }
      continue;
    }
    if (character === '/' && next === '/') { chars[index] = chars[index + 1] = ' '; lineComment = true; index++; continue; }
    if (character === '/' && next === '*') { chars[index] = chars[index + 1] = ' '; blockComment = true; index++; continue; }
    if (character === '/' && canStartRegex) { regex = true; regexClass = false; escaped = false; chars[index] = ' '; continue; }
    if (templateExpressionDepth > 0 && character === '{') { templateExpressionDepth++; canStartRegex = true; continue; }
    if (templateExpressionDepth > 0 && character === '}') {
      templateExpressionDepth--;
      if (templateExpressionDepth === 0) { chars[index] = ' '; quote = '`'; }
      else canStartRegex = false;
      continue;
    }
    if (character === "'" || character === '"' || character === '`') {
      if (character === '`') { templateOuterDepths.push(templateExpressionDepth); templateExpressionDepth = 0; }
      quote = character;
      chars[index] = ' ';
    }
    else if (/[A-Za-z_$]/.test(character)) {
      let end = index + 1;
      while (end < chars.length && /[\w$]/.test(chars[end])) end++;
      const word = chars.slice(index, end).join('');
      canStartRegex = ['return', 'case', 'throw', 'else', 'do', 'yield', 'await', 'typeof', 'void', 'delete', 'in', 'of', 'instanceof'].includes(word);
      index = end - 1;
    } else if (/\d/.test(character)) {
      while (index + 1 < chars.length && /[\w.]/.test(chars[index + 1])) index++;
      canStartRegex = false;
    } else if (!/\s/.test(character)) {
      canStartRegex = !/[)\]}]/.test(character) && character !== '.';
    }
  }
  return chars.join('');
}

function validateHermeticSource(source) {
  const text = String(source);
  const readName = 'read' + 'FileSync';
  const statName = 'lstat' + 'Sync';
  const linkName = 'readlink' + 'Sync';
  const realName = 'realpath' + 'Sync';
  const existsName = 'exists' + 'Sync';
  const openName = 'open' + 'Sync';
  const fstatName = 'fstat' + 'Sync';
  const closeName = 'close' + 'Sync';
  const spawnName = 'spawn' + 'Sync';
  const loaderName = 'requ' + 'ire';
  const exactImports = [
    `const { ${readName}, ${statName}, ${linkName}, ${realName}, ${existsName}, ${openName}, ${fstatName}, ${closeName}, constants } = ${loaderName}('node:fs');`,
    `const path = ${loaderName}('node:path');`,
    `const crypto = ${loaderName}('node:crypto');`,
    `const { ${spawnName} } = ${loaderName}('node:child_process');`,
  ];
  const lines = text.split(/\r?\n/);
  if (!exactImports.every((expected) => lines.filter((line) => line === expected).length === 1)) return false;
  const withoutImports = lines.map((line) => exactImports.includes(line) ? '' : line).join('\n');
  const code = maskJsStringsAndComments(withoutImports);
  const bareLoader = new RegExp(`\\b${'requ' + 'ire'}\\b(?!\\s*\\.main\\b)`);
  const reflection = new RegExp(`\\b${'Ref' + 'lect'}\\b`);
  if (bareLoader.test(code) || reflection.test(code)
    || /\bimport\s*(?:\(|\{|\*|[A-Za-z_$])|\.(?:apply|call|bind)\s*\(|\[[^\]\n]+\]\s*\(|\bprocess\s*\.\s*(?:binding|_linkedBinding)\s*\(|\bmodule\s*\.\s*(?:_load|constructor)\b|\b(?:eval|Function)\s*\(/.test(code)) return false;
  const capabilities = [readName, statName, linkName, realName, existsName, openName, fstatName, closeName, spawnName];
  for (const name of capabilities) {
    const uses = [...code.matchAll(new RegExp(`\\b${name}\\b`, 'g'))];
    if (!uses.length || uses.some((match) => !/^\s*\(/.test(code.slice(match.index + name.length)))) return false;
  }
  const spawnCalls = [...code.matchAll(/\bspawnSync\s*\(/g)].map((match) => match.index);
  const allowedStart = code.indexOf('function runAllowed(');
  const allowedEnd = code.indexOf('\nfunction git(', allowedStart);
  if (spawnCalls.length !== 1 || allowedStart < 0 || allowedEnd < 0 || spawnCalls[0] < allowedStart || spawnCalls[0] > allowedEnd) return false;
  return true;
}

function checkSelfHermeticity(repoRoot, testSource) {
  const selfRead = readBytes(__filename);
  if (!selfRead.ok) return { status: 'FAIL', detail: 'Preflight source is unreadable.', evidence: [] };
  const source = selfRead.bytes.toString('utf8');
  const sourceValid = validateHermeticSource(source);
  const trapValid = /throw new Error\('unexpected route: '\s*\+\s*url\)/.test(testSource)
    && /vm\.runInNewContext\(/.test(testSource)
    && !/\brequire\s*:/.test(testSource);
  const valid = sourceValid && trapValid;
  return {
    status: valid ? 'PASS' : 'FAIL',
    detail: valid ? 'Every subprocess call crosses runAllowed, imports are static-approved, filesystem APIs are read-only, and the in-memory unexpected-route trap is present.' : 'Subprocess crossing, static imports, read-only filesystem APIs, or unexpected-route trap failed.',
    evidence: [`scripts/preflight-first-call.cjs:sha256:${sha256(selfRead.bytes)}`, `backend/test/coach-app-iife.test.js:sha256:${sha256(testSource)}`],
  };
}

function selfTestBasics() {
  if (sha256('abc') !== 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad') throw new Error('sha256 helper');
  if (!redactString('https://name:value@example.test/a?q=secret').includes('[REDACTED]')) throw new Error('redaction helper');
  const secrets = sanitize({ accessToken: 'plain-a', clientSecret: 'plain-b', authorization: 'plain-c', focusedTests: [{ nested: { API_KEY: 'plain-d' } }] });
  if (/plain-[a-d]/.test(JSON.stringify(secrets))) throw new Error('normalized nested secret-value redaction helper');
  const parsed = parseUnit('[Unit]\nAfter=a.service\nWants=b.service\n[Service]\nEnvironment="A=1" B=2\n');
  if (parsed.environments.get('A') !== '1' || parsed.after[0] !== 'a.service') throw new Error('unit parser helper');
  const tap = parseTap('# Subtest: sample\nok 1 - sample\n1..1\n');
  if (tap.length !== 1 || !tap[0].pass || tap[0].index !== 1 || tap[0].name !== 'sample' || !sameList(tap.plans, [1])) throw new Error('TAP parser helper');
  if (!sameSet(['b', 'a'], ['a', 'b'])) throw new Error('set helper');
}

function selfTestUnitTruthTable() {
  const policy = { agentProcessOwner: true, explicitNonUse: true };
  const reviewedSource = Buffer.from('[Unit]\nAfter=a.service\nWants=b.service\n[Service]\nEnvironment=VOXCPM_ENABLED=true\nEnvironment=VOXCPM_URL=http://127.0.0.1:8020\n');
  const reviewed = evaluateUnitRead({ ok: true, bytes: reviewedSource }, policy, sha256(reviewedSource));
  if (reviewed.result.status !== 'WARN_DO_NOT_USE' || reviewed.result.parseStatus !== 'CONFIRMED') throw new Error('reviewed unit branch');
  const changed = evaluateUnitRead({ ok: true, bytes: reviewedSource }, policy, '0'.repeat(64));
  if (changed.result.status !== 'WARN_DO_NOT_USE' || changed.result.parseStatus !== 'CHANGED_CONFIRMED') throw new Error('changed unit branch');
  const ambiguous = evaluateUnitRead({ ok: true, bytes: Buffer.from('[Unit]\nAfter="unterminated\n') }, policy, '0'.repeat(64));
  if (ambiguous.result.status !== 'BLOCKING_UNKNOWN' || ambiguous.result.parseStatus !== 'AMBIGUOUS') throw new Error('ambiguous unit branch');
  const unavailable = evaluateUnitRead({ ok: false, error: 'missing' }, policy);
  if (unavailable.result.status !== 'BLOCKING_UNKNOWN' || unavailable.result.readable) throw new Error('unavailable unit branch');
}

function selfTestRunbookIntegrity() {
  const runbook = readBytes(path.join(EXPECTED_ROOT, 'docs/FIRST_CALL_RUNBOOK.md'));
  if (!runbook.ok || !inspectRunbookArtifact(runbook.bytes).valid) throw new Error('reviewed runbook artifact lock');

  for (let index = 0; index < runbook.bytes.length; index++) {
    const mutated = Buffer.from(runbook.bytes);
    mutated[index] ^= 1;
    if (inspectRunbookArtifact(mutated).stage !== 'hash') throw new Error(`runbook byte mutation ${index} bypassed hash lock`);
  }
  const replacement = Buffer.from(runbook.bytes);
  replacement[Math.floor(replacement.length / 3)] = replacement[Math.floor(replacement.length / 3)] === 0x5a ? 0xa5 : 0x5a;
  const multiBit = Buffer.from(runbook.bytes);
  multiBit[Math.floor(multiBit.length / 2)] ^= 0xa5;
  const representativeMutations = [
    ['multi-bit', multiBit],
    ['replacement', replacement],
    ['truncation', runbook.bytes.subarray(0, runbook.bytes.length - 1)],
    ['extension', Buffer.concat([runbook.bytes, Buffer.from([0])])],
  ];
  for (const [name, bytes] of representativeMutations) {
    if (inspectRunbookArtifact(bytes).stage !== 'hash') throw new Error(`runbook ${name} mutation bypassed hash lock`);
  }
  const appended = ['nc 127.0.0.1 1', 'socat - TCP:127.0.0.1:1', 'timeout 1 curl http://127.0.0.1/', 'command node scripts/preflight-first-call.cjs', 'node -e "process.exit()"'];
  const fenceMutations = [
    '\n```sh\necho extra\n```\n',
    '\n```bash\nnode scripts/preflight-first-call.cjs\n```\n',
    Buffer.from(runbook.bytes).toString('utf8').replace('```bash', '```sh'),
    Buffer.from(runbook.bytes).toString('utf8').replace(`${APPROVED_RUNBOOK_COMMAND}\n`, `${APPROVED_RUNBOOK_COMMAND} --changed\n`),
  ];
  for (const mutation of [...appended.map((value) => `\n${value}\n`), ...fenceMutations]) {
    const bytes = mutation.includes('# TransVoice') ? Buffer.from(mutation) : Buffer.concat([runbook.bytes, Buffer.from(mutation)]);
    if (inspectRunbookArtifact(bytes).stage !== 'hash') throw new Error('runbook append/fence mutation bypassed hash lock');
  }

  const validFixture = `# Runbook\n\n\`\`\`bash\n${APPROVED_RUNBOOK_COMMAND}\n\`\`\`\n`;
  if (!validateRunbookExecutableSurface(validFixture)
    || validateRunbookExecutableSurface(validFixture.replace('```bash', '```sh'))
    || validateRunbookExecutableSurface(`${validFixture}\n\`\`\`text\nextra\n\`\`\``)
    || validateRunbookExecutableSurface(validFixture.replace('# Runbook', '    node unsafe.js'))
    || validateRunbookExecutableSurface(`${validFixture}\nInline \`node unsafe.js\`.\n`)
    || validateRunbookExecutableSurface(`${validFixture}\nInline \`curl\`.\n`)) {
    throw new Error('runbook Markdown sole-command structure');
  }
}

function selfTestRunbookPathValidator() {
  const canonicalPath = path.join(EXPECTED_ROOT, RUNBOOK_RELATIVE_PATH);
  const statFixture = (kind, ino = 11n, size = 12n, nlink = 1n, mode = null, mtimeNs = 13n, ctimeNs = 14n) => ({
    mode: mode === null ? (kind === 'regular' ? 0o100644n : kind === 'symlink' ? 0o120777n : kind === 'directory' ? 0o040755n : kind === 'fifo' ? 0o010600n : 0o020600n) : mode,
    dev: 7n,
    ino,
    size,
    nlink,
    mtimeNs,
    ctimeNs,
    isSymbolicLink: () => kind === 'symlink',
    isFile: () => kind === 'regular',
    isDirectory: () => kind === 'directory',
    isFIFO: () => kind === 'fifo',
  });
  const fixture = ({ before = [statFixture('regular')], fdStats = [statFixture('regular'), statFixture('regular')],
    realpaths = [canonicalPath, canonicalPath], bytes = Buffer.from('locked bytes'), openError = null, noFollow = 0x20000 } = {}) => {
    let reads = 0; let pathReads = 0; let closes = 0; let opens = 0; let lstatIndex = 0; let fstatIndex = 0; let realIndex = 0;
    const fd = 41;
    return {
      ops: {
        constants: { O_RDONLY: 0, O_NOFOLLOW: noFollow },
        lstat: () => before[Math.min(lstatIndex++, before.length - 1)],
        realpath: () => realpaths[Math.min(realIndex++, realpaths.length - 1)],
        open: (_path, flags) => { opens++; if (flags !== noFollow) throw new Error('missing no-follow flag'); if (openError) throw openError; return fd; },
        fstat: (actualFd) => { if (actualFd !== fd) throw new Error('wrong fd stat'); return fdStats[Math.min(fstatIndex++, fdStats.length - 1)]; },
        read: (actualFd) => { if (actualFd !== fd) throw new Error('pathname substituted for fd'); reads++; return Buffer.from(bytes); },
        close: (actualFd) => { if (actualFd !== fd) throw new Error('wrong fd close'); closes++; },
        readPath: () => { pathReads++; return Buffer.from('attacker bytes'); },
      },
      counts: () => ({ reads, pathReads, closes, opens }),
    };
  };

  const regular = fixture();
  const accepted = inspectRunbookPath(EXPECTED_ROOT, regular.ops);
  if (!accepted.ok || accepted.fileType !== 'regular' || accepted.mode !== '100644'
    || accepted.bytes.toString() !== 'locked bytes' || regular.counts().reads !== 1 || regular.counts().pathReads !== 0
    || regular.counts().closes !== 1) throw new Error('regular locked runbook fixture rejected');
  for (const kind of ['symlink', 'directory', 'fifo', 'special']) {
    const rejected = fixture({ before: [statFixture(kind)] });
    const result = inspectRunbookPath(EXPECTED_ROOT, rejected.ops);
    if (result.ok || result.fileType !== kind || rejected.counts().reads !== 0 || rejected.counts().opens !== 0) throw new Error(`${kind} runbook metadata fixture accepted or read`);
  }
  const escaped = fixture({ realpaths: [path.join(EXPECTED_ROOT, '..', 'outside-runbook.md')] });
  const escapedResult = inspectRunbookPath(EXPECTED_ROOT, escaped.ops);
  if (escapedResult.ok || escapedResult.reason !== 'runbook realpath differs from canonical repository path'
    || escaped.counts().reads !== 0 || escaped.counts().opens !== 0) throw new Error('escaped runbook realpath fixture accepted or read');

  const symlinkSwap = fixture({ openError: Object.assign(new Error('symlink refused'), { code: 'ELOOP' }) });
  const replacement = fixture({ before: [statFixture('regular', 11n), statFixture('regular', 22n)] });
  const postSymlink = fixture({ before: [statFixture('regular'), statFixture('symlink')] });
  const postCanonicalDrift = fixture({ realpaths: [canonicalPath, path.join(EXPECTED_ROOT, '..', 'outside-runbook.md')] });
  const fdInodeSwap = fixture({ fdStats: [statFixture('regular', 11n), statFixture('regular', 22n)] });
  const truncation = fixture({ fdStats: [statFixture('regular', 11n, 12n), statFixture('regular', 11n, 5n)] });
  const shortRead = fixture({ fdStats: [statFixture('regular', 11n, 13n), statFixture('regular', 11n, 13n)] });
  const specialFd = fixture({ fdStats: [statFixture('special'), statFixture('special')] });
  const unavailableNoFollow = fixture({ noFollow: 0 });
  for (const [name, candidate] of Object.entries({ symlinkSwap, replacement, postSymlink, postCanonicalDrift, fdInodeSwap, truncation, shortRead, specialFd, unavailableNoFollow })) {
    const result = inspectRunbookPath(EXPECTED_ROOT, candidate.ops);
    if (result.ok) throw new Error(`${name} locked runbook race fixture accepted`);
    if (candidate.counts().opens > 0 && candidate.counts().closes !== (name === 'symlinkSwap' ? 0 : 1)) throw new Error(`${name} runbook fd was not closed exactly once`);
  }
  const evidencePath = path.join(EVIDENCE_ROOT, 'commits', 'fixture', 'before.index');
  const lockedEvidence = fixture({ realpaths: [evidencePath, evidencePath] });
  const evidenceResult = readLockedEvidenceFile(EVIDENCE_ROOT, 'commits/fixture/before.index', lockedEvidence.ops);
  const evidenceSymlink = fixture({ before: [statFixture('symlink')], realpaths: [evidencePath] });
  const evidenceRace = fixture({ before: [statFixture('regular', 11n), statFixture('regular', 22n)], realpaths: [evidencePath, evidencePath] });
  if (!evidenceResult.ok || lockedEvidence.counts().reads !== 1 || lockedEvidence.counts().pathReads !== 0
    || readLockedEvidenceFile(EVIDENCE_ROOT, '../escape', lockedEvidence.ops).ok
    || readLockedEvidenceFile(EVIDENCE_ROOT, 'commits/fixture/before.index', evidenceSymlink.ops).ok
    || readLockedEvidenceFile(EVIDENCE_ROOT, 'commits/fixture/before.index', evidenceRace.ops).ok) {
    throw new Error('locked transaction evidence containment/symlink/race contract');
  }

  const unsafeStats = [
    ['hardlink', statFixture('regular', 11n, 12n, 2n)],
    ['group-write', statFixture('regular', 11n, 12n, 1n, 0o100664n)],
    ['other-write', statFixture('regular', 11n, 12n, 1n, 0o100646n)],
  ];
  const oldProtectionWouldAccept = (stat) => fileTypeOf(stat) === 'regular';
  for (const [name, unsafeStat] of unsafeStats) {
    if (!oldProtectionWouldAccept(unsafeStat)) throw new Error(`${name} mutation witness did not expose old protection`);
    const direct = fixture({ before: [unsafeStat], fdStats: [unsafeStat, unsafeStat] });
    const runbook = fixture({ before: [unsafeStat], fdStats: [unsafeStat, unsafeStat] });
    const evidence = fixture({ before: [unsafeStat], fdStats: [unsafeStat, unsafeStat], realpaths: [evidencePath, evidencePath] });
    if (readLockedRegularFile(canonicalPath, direct.ops).ok || inspectRunbookPath(EXPECTED_ROOT, runbook.ops).ok
      || readLockedEvidenceFile(EVIDENCE_ROOT, 'commits/fixture/before.index', evidence.ops).ok
      || direct.counts().opens !== 0 || runbook.counts().opens !== 0 || evidence.counts().opens !== 0) {
      throw new Error(`${name} secure-reader layer accepted unsafe metadata`);
    }
  }
}

function selfTestSecurityValidators() {
  if (!isAllowedCommand(process.execPath, ['--test', '--test-reporter=tap', 'backend/test/coach-app-iife.test.js'])) throw new Error('exact Node test allowlist');
  if (isAllowedCommand(process.execPath, ['--test', 'attacker.js']) || isAllowedCommand('/usr/bin/git', ['diff', '--output=owned', '--', 'safe.js'])) throw new Error('unsafe subprocess arguments accepted');
  const statusRows = parsePorcelainV1Z(' M path with space.js\0R  new\nname.js\0old name.js\0?? untracked/file.js\0');
  if (statusRows.length !== 3 || statusRows[1].originalPath !== 'old name.js' || statusRows[2].path !== 'untracked/file.js') throw new Error('NUL-safe status parser');
  if (!statusRowIsForeign({ path: LEASE_PATHS[0], originalPath: 'foreign.js' }) || !statusRowIsForeign({ path: 'foreign.js', originalPath: LEASE_PATHS[0] })
    || statusRowIsForeign({ path: LEASE_PATHS[0], originalPath: LEASE_PATHS[1] })) throw new Error('rename lease-boundary guard');
  if (isAllowedWorktreeKind('directory') || !isAllowedWorktreeKind('regular')) throw new Error('untracked directory guard');

  const files = new Map([['root.js', "require('./new dependency')"], ['new dependency.js', 'module.exports = 1;']]);
  const closure = discoverDependencyClosureFromMap(files, ['root.js']);
  if (!closure.paths.includes('new dependency.js') || closure.issues.length) throw new Error('new dependency discovery');
  const dependencyFixtures = new Map([
    ['page.html', '<link rel="icon" href="/static/favicon.svg"><script src="./app.js"></script>'],
    ['app.js', 'module.exports = 1;'],
  ]);
  const dependencyClosure = discoverDependencyClosureFromMap(dependencyFixtures, ['page.html']);
  if (dependencyClosure.issues.length || dependencyClosure.warnings.length !== 1 || !dependencyClosure.paths.includes('app.js')) throw new Error('presentation dependency classification');
  const externalClosure = discoverDependencyClosureFromMap(new Map([[EXTERNAL_STYLE_CALLER, `require('${EXTERNAL_STYLE_MODULE}')`]]), [EXTERNAL_STYLE_CALLER]);
  if (externalClosure.issues.length || externalClosure.warnings.length || externalClosure.externalDependencies.length !== 1
    || externalClosure.externalDependencies[0].path !== EXTERNAL_STYLE_MODULE) throw new Error('call-critical external dependency classification');
  const unresolved = discoverDependencyClosureFromMap(new Map([['root.js', "require('./unknown-local')"]]), ['root.js']);
  if (unresolved.issues.length !== 1) throw new Error('unclassified executable dependency did not block');
  const hermeticBase = [
    "const { readFileSync, lstatSync, readlinkSync, realpathSync, existsSync, openSync, fstatSync, closeSync, constants } = require('node:fs');", "const path = require('node:path');", "const crypto = require('node:crypto');",
    "const { spawnSync } = require('node:child_process');", 'function runAllowed() { readFileSync("x"); lstatSync("x"); readlinkSync("x"); realpathSync("x"); existsSync("x"); const fd = openSync("x", constants.O_RDONLY); fstatSync(fd); closeSync(fd); return spawnSync("/usr/bin/git", []); }',
    'function git() { return runAllowed(); }',
  ].join('\n');
  if (!validateHermeticSource(hermeticBase)
    || validateHermeticSource(`${hermeticBase}\nspawnSync('curl', ['x']);`)
    || validateHermeticSource(`${hermeticBase}\nconst net = require('node:' + 'http');`)
    || validateHermeticSource(`${hermeticBase}\nconst io = { readFileSync }; io.readFileSync('x');`)
    || validateHermeticSource(`${hermeticBase}\nconst launch = spawnSync; launch('curl', []);`)
    || validateHermeticSource(`${hermeticBase}\nReflect.apply(spawnSync, null, ['curl', []]);`)
    || validateHermeticSource(`${hermeticBase}\nspawnSync.call(null, 'curl', []);`)
    || validateHermeticSource(`${hermeticBase}\nconst method = 'spawnSync'; globalThis[method]('curl');`)
    || validateHermeticSource(hermeticBase + "\nconst hidden = `${spawnSync('curl', [])}`;")
    || validateHermeticSource(`${hermeticBase}\nprocess.binding('spawn_sync');`)
    || validateHermeticSource(`${hermeticBase}\nimport('node:http');`)) throw new Error('hermetic source crossing/read-only guard');
}

function selfTestEvidenceValidators() {
  const bindings = { coachSha256: 'a'.repeat(64), testSha256: 'b'.repeat(64), sourceSha256: 'c'.repeat(64), runnerSha256: 'd'.repeat(64) };
  const mutantId = MUTANTS[0];
  const expectedFailing = new Set(EXPECTED_MUTATION_FAILURES[mutantId]);
  const stdout = Buffer.from(`${TEST_NAMES.slice(0, 20).map((name, index) => `# Subtest: ${name}\n${expectedFailing.has(name) ? 'not ok' : 'ok'} ${index + 1} - ${name}\n`).join('')}1..20\n`);
  const stderr = Buffer.alloc(0);
  const metadata = Buffer.from(JSON.stringify({ id: mutantId, exit: 1, bindings, stdoutSha256: sha256(stdout), stderrSha256: sha256(stderr), stdoutBytes: stdout.length, stderrBytes: 0 }));
  const mutationRow = { id: mutantId, exit: 1, actualFailingTests: [...EXPECTED_MUTATION_FAILURES[mutantId]] };
  if (!validateMutationArtifactBytes(mutationRow, bindings, { stdout, stderr, metadata })) throw new Error('complete raw mutation artifact rejected');
  if (!sameList(EXPECTED_MUTATION_FAILURES['diag-sse-done-accepted'], [TEST_NAMES[9], TEST_NAMES[14], TEST_NAMES[16], TEST_NAMES[17], TEST_NAMES[18]])
    || !sameList(EXPECTED_MUTATION_FAILURES['teardown-reader-rejection-invariant'], [TEST_NAMES[15], TEST_NAMES[16], TEST_NAMES[18]])) throw new Error('approved expanded mutation partitions drifted');
  const truncatedStdout = Buffer.from(stdout.toString('utf8').split('# Subtest: TEARDOWN: End during raw stream')[0]);
  const truncatedMetadata = Buffer.from(JSON.stringify({ id: mutantId, exit: 1, bindings, stdoutSha256: sha256(truncatedStdout), stderrSha256: sha256(stderr), stdoutBytes: truncatedStdout.length, stderrBytes: 0 }));
  if (validateMutationArtifactBytes(mutationRow, bindings, { stdout: truncatedStdout, stderr, metadata: truncatedMetadata })) throw new Error('truncated mutation TAP accepted');
  const duplicatePlan = parseTap(`${stdout}1..20\n`);
  const missingPlan = parseTap(stdout.toString('utf8').replace('1..20\n', ''));
  const duplicateIndex = parseTap(stdout.toString('utf8').replace('ok 2 -', 'ok 1 -'));
  if (validateMutationTapRows(mutantId, duplicatePlan) || validateMutationTapRows(mutantId, missingPlan)
    || validateMutationTapRows(mutantId, duplicateIndex)) throw new Error('mutation TAP plan/index forgery accepted');
  const mutation = { bindings, mutants: MUTANTS.map((id) => ({ id, status: 'KILLED', exit: 1, expectedFailingTests: [...EXPECTED_MUTATION_FAILURES[id]], actualFailingTests: [...EXPECTED_MUTATION_FAILURES[id]] })) };
  if (validateMutationReceipt(mutation, bindings)) throw new Error('summary-only mutation evidence accepted');
  mutation.mutants[0].expectedFailingTests = [];
  if (validateMutationReceipt(mutation, bindings)) throw new Error('empty mutation set accepted');

  const emptyHash = sha256('');
  const actual = { validFile: true, fileType: 'regular', mode: '100644', symlinkTarget: null, headSha256: '1'.repeat(64), indexSha256: '1'.repeat(64), worktreeSha256: '1'.repeat(64), headBlob: '2'.repeat(40), headMode: '100644', indexBlob: '2'.repeat(40), indexMode: '100644', unstagedDiffSha256: emptyHash, unstagedDiffBytes: 0, stagedDiffSha256: emptyHash, stagedDiffBytes: 0 };
  const focusedOutput = Buffer.from('# Subtest: focused\nok 1 - focused\n1..1\n# tests 1\n# pass 1\n# fail 0\n');
  const focusedTest = { command: 'node --test x', cwd: EXPECTED_ROOT, sourceSha256: '7'.repeat(64), targetSha256: '8'.repeat(64), expectedTests: ['focused'], exit: 0,
    outputSha256: sha256(focusedOutput), outputBytes: focusedOutput.length, outputEvidence: {}, metadataEvidence: {} };
  const focusedMetadata = Buffer.from(JSON.stringify({ path: 'target.js', command: focusedTest.command, cwd: focusedTest.cwd, sourceSha256: focusedTest.sourceSha256,
    targetSha256: focusedTest.targetSha256, exit: 0, outputSha256: focusedTest.outputSha256, outputBytes: focusedTest.outputBytes,
    testCount: 1, passCount: 1, failCount: 0, skipCount: 0, tests: [{ name: 'focused', pass: true, skipped: false }] }));
  const unrelatedOutput = Buffer.from('# Subtest: unrelated\nok 1 - unrelated\n1..1\n');
  const unrelatedTest = { ...focusedTest, outputSha256: sha256(unrelatedOutput), outputBytes: unrelatedOutput.length };
  const unrelatedMetadata = Buffer.from(JSON.stringify({ ...JSON.parse(focusedMetadata), outputSha256: unrelatedTest.outputSha256,
    outputBytes: unrelatedTest.outputBytes, tests: [{ name: 'unrelated', pass: true, skipped: false }] }));
  if (!validateFocusedTestBytes('target.js', focusedTest, focusedOutput, focusedMetadata)
    || validateFocusedTestBytes('other.js', focusedTest, focusedOutput, focusedMetadata)
    || validateFocusedTestBytes('target.js', unrelatedTest, unrelatedOutput, unrelatedMetadata)
    || validateFocusedTestBytes('target.js', { ...focusedTest, outputBytes: 0 }, Buffer.alloc(0), focusedMetadata)) throw new Error('focused-test raw evidence validation');
  const custody = { status: 'CLEAN_BASELINE', fileType: 'regular', mode: '100644', symlinkTarget: null, headSha256: actual.headSha256, indexSha256: actual.indexSha256, worktreeSha256: actual.worktreeSha256, headBlob: actual.headBlob, gitModeHead: '100644', indexBlob: actual.indexBlob, gitModeIndex: '100644', unstagedDiffSha256: emptyHash, unstagedDiffBytes: 0, stagedDiffSha256: emptyHash, stagedDiffBytes: 0, directCallPath: 'root.js imports target.js', provenanceEvidence: { path: 'target.provenance.json', sha256: '3'.repeat(64), bytes: 1 }, focusedTests: [focusedTest] };
  if (!validateCustodyRow(custody, actual, ['root.js'], true)) throw new Error('valid custody identity rejected');
  const provenance = Buffer.from(JSON.stringify({ path: 'target.js', directCallPath: custody.directCallPath, sources: ['root.js'] }));
  if (!validateProvenanceBytes({ ...custody, path: 'target.js' }, provenance)
    || validateProvenanceBytes({ ...custody, path: 'other.js' }, provenance)
    || validateProvenanceBytes({ ...custody, path: 'target.js' }, Buffer.alloc(0))) throw new Error('provenance raw evidence validation');
  if (validateCustodyRow({ ...custody, status: 'OWNED_VERIFIED', owner: 'x', intendedPurpose: 'x', reviewedDiff: true, authoringEvidence: 'ABSENT', focusedTests: [] }, actual, ['root.js'], true)) throw new Error('malicious custody receipt accepted');
  const externalActual = { path: EXTERNAL_STYLE_MODULE, validFile: true, readable: true, fileType: 'regular', mode: '100644', sizeBytes: 42, worktreeSha256: '4'.repeat(64) };
  const externalRow = { path: EXTERNAL_STYLE_MODULE, status: 'CLEAN_BASELINE', fileType: 'regular', mode: '100644', sizeBytes: 42, worktreeSha256: externalActual.worktreeSha256,
    directCallPath: `${EXTERNAL_STYLE_CALLER} imports external style module`, provenanceEvidence: { path: 'external.provenance.json', sha256: '5'.repeat(64), bytes: 1 }, focusedTests: [focusedTest] };
  const externalProvenance = Buffer.from(JSON.stringify({ path: EXTERNAL_STYLE_MODULE, directCallPath: externalRow.directCallPath, sources: [EXTERNAL_STYLE_CALLER] }));
  const unrelatedProvenance = Buffer.from(JSON.stringify({ path: EXTERNAL_STYLE_MODULE, directCallPath: externalRow.directCallPath, sources: ['unrelated.js'] }));
  if (!validateExternalCustodyRow(externalRow, externalActual, EXTERNAL_STYLE_CALLER, true)
    || !validateExternalProvenanceBytes(externalRow, externalProvenance, EXTERNAL_STYLE_CALLER)
    || validateExternalProvenanceBytes(externalRow, unrelatedProvenance, EXTERNAL_STYLE_CALLER)
    || validateExternalCustodyRow(externalRow, { ...externalActual, validFile: false, readable: false }, EXTERNAL_STYLE_CALLER, true)
    || validateExternalCustodyRow(externalRow, { ...externalActual, worktreeSha256: '6'.repeat(64) }, EXTERNAL_STYLE_CALLER, true)
    || validateExternalCustodyManifest({ custody: [] }, externalActual, true).valid
    || validateExternalCustodyRow(externalRow, externalActual, EXTERNAL_STYLE_CALLER, false)) throw new Error('external executable custody fail-closed validation');

  const approved = EXTERNAL_STYLE_TEST_CONTRACTS[0];
  const approvedBindings = { sourceSha256: '9'.repeat(64), targetSha256: 'a'.repeat(64) };
  const approvedOutput = Buffer.from(`${approved.tests.map((name, index) => `# Subtest: ${name}\nok ${index + 1} - ${name}\n`).join('')}1..${approved.tests.length}\n`);
  const approvedTest = { command: approved.command, cwd: approved.cwd, ...approvedBindings, expectedTests: [...approved.tests], exit: 0,
    outputSha256: sha256(approvedOutput), outputBytes: approvedOutput.length };
  const approvedMetadata = Buffer.from(JSON.stringify({ path: EXTERNAL_STYLE_MODULE, command: approved.command, cwd: approved.cwd, ...approvedBindings,
    exit: 0, outputSha256: approvedTest.outputSha256, outputBytes: approvedTest.outputBytes, testCount: approved.tests.length,
    passCount: approved.tests.length, failCount: 0, skipCount: 0, tests: approved.tests.map((name) => ({ name, pass: true, skipped: false })) }));
  if (!validateFocusedTestBytes(EXTERNAL_STYLE_MODULE, approvedTest, approvedOutput, approvedMetadata, approved, approvedBindings)
    || validateFocusedTestBytes(EXTERNAL_STYLE_MODULE, { ...approvedTest, command: 'node --test unrelated.js' }, approvedOutput, approvedMetadata, approved, approvedBindings)
    || validateFocusedTestBytes(EXTERNAL_STYLE_MODULE, { ...approvedTest, targetSha256: 'b'.repeat(64) }, approvedOutput, approvedMetadata, approved, approvedBindings)) {
    throw new Error('external focused-test path/command/binding contract');
  }

  const statusBytes = Buffer.from(' D deleted.js\0');
  const foreignCurrent = [{ status: ' D', path: 'deleted.js', originalPath: null }];
  const foreignKey = ' D\0deleted.js\0';
  const foreignObserved = new Map([[foreignKey, { valid: true, statExists: false,
    index: { mode: '100644', blob: '1'.repeat(40) }, head: { mode: '100644', blob: '1'.repeat(40) },
    indexSha256: '2'.repeat(64), headSha256: '2'.repeat(64) }]]);
  const foreignContext = { repoRoot: EXPECTED_ROOT, branch: EXPECTED_BRANCH, head: PLANNING_BASELINE, statusBytes };
  const foreignReceipt = { repoRoot: EXPECTED_ROOT, branch: EXPECTED_BRANCH, head: PLANNING_BASELINE,
    statusPorcelainV1ZSha256: sha256(statusBytes), statusPorcelainV1ZBytes: statusBytes.length,
    paths: [{ status: ' D', path: 'deleted.js', originalPath: null, fileType: 'missing', mode: null, worktreeSha256: null, blockingType: null,
      indexMode: '100644', indexBlob: '1'.repeat(40), indexSha256: '2'.repeat(64), headMode: '100644', headBlob: '1'.repeat(40), headSha256: '2'.repeat(64) }] };
  if (!validateForeignWorktreeReceipt(foreignReceipt, foreignCurrent, foreignObserved, foreignContext)
    || validateForeignWorktreeReceipt({ ...foreignReceipt, paths: [...foreignReceipt.paths, foreignReceipt.paths[0]] }, foreignCurrent, foreignObserved, foreignContext)
    || validateForeignWorktreeReceipt({ ...foreignReceipt, statusPorcelainV1ZSha256: '0'.repeat(64) }, foreignCurrent, foreignObserved, foreignContext)
    || validateForeignWorktreeReceipt({ ...foreignReceipt, paths: [{ ...foreignReceipt.paths[0], indexBlob: '3'.repeat(40) }] }, foreignCurrent, foreignObserved, foreignContext)
    || validateForeignWorktreeReceipt(foreignReceipt, [{ status: '??', path: 'deleted.js', originalPath: null }], foreignObserved, foreignContext)
    || validateForeignWorktreeReceipt({ ...foreignReceipt, paths: [{ ...foreignReceipt.paths[0], path: LEASE_PATHS[0] }] }, [{ status: ' D', path: LEASE_PATHS[0], originalPath: null }], foreignObserved, foreignContext)) {
    throw new Error('foreign deletion receipt bijection/identity guard');
  }
  if (validateCommitReceiptRow({ blobSha256: {} }, { exists: false, paths: [], blobs: {} }, { message: 'x', paths: ['x'] }, {}, null, null)) throw new Error('nonexistent commit accepted');

  const redacted = JSON.stringify(sanitize({ token: 'a', privateKey: 'b', secretKey: 'c', sessionId: 'd', headers: { authorization: 'Bearer abc.def', cookie: 'sid=plain' }, line: 'Authorization: Bearer complete.value' }));
  if (/abc\.def|complete\.value|sid=plain|"a"|"b"|"c"|"d"/.test(redacted)) throw new Error('expanded redaction coverage');
}

function selfTestCommit5ChainContract() {
  const commits = ['1', '2', '3', '4', '5'].map((value) => value.repeat(40));
  const currentHashes = Object.fromEntries(LEASE_PATHS.map((relativePath, index) => [relativePath, sha256(`${index}:${relativePath}`)]));
  const rows = COMMIT_GROUPS.map((group, index) => ({
    commit: commits[index], subject: group.message, parent: index ? commits[index - 1] : PLANNING_BASELINE, paths: [...group.paths],
    blobSha256: Object.fromEntries(group.paths.map((relativePath) => [relativePath, currentHashes[relativePath]])),
  }));
  const currentForeign = { index: Buffer.from('current-index'), binaryDiff: Buffer.from('current-diff') };
  const observations = COMMIT_GROUPS.map((group, index) => ({ exists: true, parents: [index ? commits[index - 1] : PLANNING_BASELINE], message: group.message,
      paths: [...group.paths], blobs: Object.fromEntries(group.paths.map((relativePath) => [relativePath, currentHashes[relativePath]])),
      foreignParentTree: Buffer.from(`tree-${index}`), foreignCommitTree: Buffer.from(`tree-${index}`) }));
  const valid = (candidateRows = rows, candidateObservations = observations, head = commits[4], foreign = currentForeign) => validateCommitChain({
    rows: candidateRows, observations: candidateObservations, currentHashes, currentHead: head, currentForeign: foreign, anchorForeign: currentForeign,
  });
  const cloneRows = () => structuredClone(rows);
  const cloneObservations = () => observations.map((item) => ({ ...structuredClone(item),
    foreignParentTree: Buffer.from(item.foreignParentTree), foreignCommitTree: Buffer.from(item.foreignCommitTree) }));
  if (!valid() || LEASE_PATHS.length !== 18 || new Set(LEASE_PATHS).size !== 18 || COMMIT_GROUPS.length !== 5) throw new Error('positive five-commit oracle');
  if (stripOneTerminalGitEol(Buffer.from(' exact subject \r\n')) !== ' exact subject '
    || stripOneTerminalGitEol(Buffer.from(' exact subject \n\n')) !== ' exact subject \n') throw new Error('transaction-root descriptor base/exact subject EOL contract');

  for (const relativePath of COMMIT_GROUPS[3].paths) {
    const attacked = cloneObservations(); attacked[3].paths = attacked[3].paths.filter((value) => value !== relativePath);
    if (valid(rows, attacked)) throw new Error(`missing commit-4 path accepted: ${relativePath}`);
  }
  for (const attack of [
    (candidate) => candidate[3].paths.push('foreign.js'),
    (candidate) => candidate[3].paths.push(candidate[3].paths[0]),
    (candidate) => { candidate[0].paths.push(candidate[3].paths.shift()); },
    (candidate) => { candidate[3].paths.push(candidate[0].paths.shift()); },
    (candidate) => { candidate[2].paths.push(...candidate[3].paths.splice(0, 7)); },
  ]) {
    const attacked = cloneObservations(); attack(attacked); if (valid(rows, attacked)) throw new Error('commit group path attack accepted');
  }
  const reorderedRows = cloneRows(); [reorderedRows[1], reorderedRows[2]] = [reorderedRows[2], reorderedRows[1]];
  if (valid(reorderedRows) || valid(rows.slice(0, 4), observations.slice(0, 4))) throw new Error('row count/order attack accepted');
  const sixthRows = [...cloneRows(), structuredClone(rows[4])]; const sixthObservations = [...cloneObservations(), cloneObservations()[4]];
  if (valid(sixthRows, sixthObservations)) throw new Error('sixth row accepted');
  for (let index = 0; index < rows.length; index++) {
    const wrong = cloneRows(); wrong[index].subject = 'wrong'; if (valid(wrong)) throw new Error('wrong commit subject accepted');
    const missing = cloneRows(); delete missing[index].subject; if (valid(missing)) throw new Error('missing commit subject accepted');
    const paddedSubject = cloneObservations(); paddedSubject[index].message = `${COMMIT_GROUPS[index].message} `;
    if (valid(rows, paddedSubject)) throw new Error('whitespace-normalized subject accepted');
    const keyMissing = cloneRows(); delete keyMissing[index].blobSha256[COMMIT_GROUPS[index].paths[0]]; if (valid(keyMissing)) throw new Error('missing blob key accepted');
    const keyExtra = cloneRows(); keyExtra[index].blobSha256['foreign.js'] = '0'.repeat(64); if (valid(keyExtra)) throw new Error('extra blob key accepted');
    const rowEvidence = cloneRows(); rowEvidence[index][`foreign${'Evidence'}`] = { before: 'self-attested', after: 'self-attested' };
    if (valid(rowEvidence)) throw new Error('row-local foreign self-attestation accepted');
    const treeDrift = cloneObservations(); treeDrift[index].foreignCommitTree = Buffer.from('changed-tree');
    if (valid(rows, treeDrift)) throw new Error('foreign parent-to-commit tree drift accepted');
  }
  const driftHashes = { ...currentHashes, [LEASE_PATHS[0]]: '0'.repeat(64) };
  if (validateCommitChain({ rows, observations, currentHashes: driftHashes, currentHead: commits[4], currentForeign })) throw new Error('current worktree blob drift accepted');
  for (let index = 0; index < observations.length; index++) {
    const broken = cloneObservations(); broken[index].parents = ['f'.repeat(40)]; if (valid(rows, broken)) throw new Error('broken ancestry accepted');
  }
  const merge = cloneObservations(); merge[2].parents.push('e'.repeat(40));
  const duplicate = cloneRows(); duplicate[4].commit = duplicate[3].commit;
  if (valid(rows, merge) || valid(duplicate) || valid(rows, observations, commits[3]) || valid(rows, observations, 'f'.repeat(40))) throw new Error('ancestry/final-head attack accepted');
  if (valid(rows, observations, commits[4], { index: Buffer.from('changed'), binaryDiff: Buffer.from('changed') })) throw new Error('non-anchor final foreign state accepted');

  const manifest = { schema: 'transvoice.five-commit-evidence.v3', anchor: { sha256: ANCHOR_V2_SHA256,
    reviewSha256: REVIEW_V2_SHA256, confirmationSha256: CONFIRMATION_V2_SHA256 }, baselineHead: PLANNING_BASELINE,
  rows, finalHead: commits[4] };
  const schema = buildCommitSchema(manifest);
  if (!strictCommitManifestEnvelope(manifest) || !strictSchemaValidate(manifest, schema)
    || !canonicalGeneratedJson(manifest).equals(Buffer.from(`${JSON.stringify(JSON.parse(canonicalGeneratedJson(manifest)), null, 2)}\n`))) {
    throw new Error('closed generated manifest rejected');
  }
  const unknown = structuredClone(manifest); unknown.rows[0][`foreign${'Evidence'}`] = {};
  const badBinding = structuredClone(manifest); badBinding.anchor.reviewSha256 = '0'.repeat(64);
  if (strictCommitManifestEnvelope(unknown) || strictSchemaValidate(unknown, schema) || strictCommitManifestEnvelope(badBinding)) throw new Error('manifest unknown key or binding accepted');

  const reviewSchema = readStrictJsonArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path.endsWith('/review.schema.json')));
  const review = readStrictJsonArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path.endsWith('/review.json')));
  const confirmationSchema = readStrictJsonArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path.endsWith('/confirmation.schema.json')));
  const confirmation = readStrictJsonArtifact(ANCHOR_V2_ARTIFACTS.find((item) => item.path.endsWith('/confirmation.json')));
  const malformedReview = structuredClone(review); malformedReview.bindings.anchor.sha256 = '0'.repeat(64);
  const malformedConfirmation = structuredClone(confirmation); malformedConfirmation.reviewReceipt.bytes++;
  if (!strictSchemaValidate(review, reviewSchema) || strictSchemaValidate(malformedReview, reviewSchema)
    || !strictSchemaValidate(confirmation, confirmationSchema) || strictSchemaValidate(malformedConfirmation, confirmationSchema)) {
    throw new Error('review/confirmation malformed binding validation');
  }

  const stableSnapshot = { branch: EXPECTED_BRANCH, head: PLANNING_BASELINE, status: Buffer.from('same'), indexLockAbsent: true };
  const stableLeased = Object.fromEntries(LEASE_PATHS.map((relativePath, index) => [relativePath, {
    dev: '7', ino: String(index + 1), size: '12', mtimeNs: '13', ctimeNs: '14', mode: '100644', nlink: '1',
    sha256: sha256(relativePath),
  }]));
  const metadataOnlyLeasedSnapshotsEqual = (left, right) => {
    const metadataKeys = ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'];
    return left && right && sameList(Object.keys(left), LEASE_PATHS) && sameList(Object.keys(right), LEASE_PATHS)
      && LEASE_PATHS.every((relativePath) => metadataKeys.every((key) => left[relativePath][key] === right[relativePath][key]));
  };
  let positiveLeasedCalls = 0; let positiveForeignReads = 0;
  const positiveStable = stableForeignComposite(EXPECTED_ROOT, 1, {
    snapshot: () => ({ ...stableSnapshot, status: Buffer.from(stableSnapshot.status) }),
    index: () => { positiveForeignReads++; return Buffer.from('i'); },
    diff: () => { positiveForeignReads++; return Buffer.from('d'); },
    leased: () => { positiveLeasedCalls++; return structuredClone(stableLeased); },
  });
  if (!positiveStable || positiveStable.attempt !== 1 || positiveLeasedCalls !== 2 || positiveForeignReads !== 4
    || !leasedSnapshotsEqual(stableLeased, structuredClone(stableLeased))) {
    throw new Error('same-metadata same-hash positive stable control rejected');
  }

  const beforeContent = Buffer.from('content-A');
  const afterContent = Buffer.from('content-B');
  const hashDriftBefore = structuredClone(stableLeased);
  const hashDriftAfter = structuredClone(stableLeased);
  hashDriftBefore[LEASE_PATHS[0]].size = String(beforeContent.length);
  hashDriftAfter[LEASE_PATHS[0]].size = String(afterContent.length);
  hashDriftBefore[LEASE_PATHS[0]].sha256 = sha256(beforeContent);
  hashDriftAfter[LEASE_PATHS[0]].sha256 = sha256(afterContent);
  const exactHashOnlyDrift = beforeContent.length === afterContent.length
    && hashDriftBefore[LEASE_PATHS[0]].sha256 !== hashDriftAfter[LEASE_PATHS[0]].sha256
    && metadataOnlyLeasedSnapshotsEqual(hashDriftBefore, hashDriftAfter);
  if (!exactHashOnlyDrift || leasedSnapshotsEqual(hashDriftBefore, hashDriftAfter)
    || !metadataOnlyLeasedSnapshotsEqual(hashDriftBefore, hashDriftAfter)) {
    throw new Error('SHA-omitting comparator mutation witness did not isolate hash-only drift');
  }
  let hashDriftCalls = 0; let hashDriftForeignReads = 0;
  const hashDriftRetry = stableForeignComposite(EXPECTED_ROOT, 2, {
    snapshot: () => ({ ...stableSnapshot, status: Buffer.from(stableSnapshot.status) }),
    index: () => { hashDriftForeignReads++; return Buffer.from('i'); },
    diff: () => { hashDriftForeignReads++; return Buffer.from('d'); },
    leased: () => {
      hashDriftCalls++;
      if (hashDriftCalls === 1) return structuredClone(hashDriftBefore);
      if (hashDriftCalls === 2) return structuredClone(hashDriftAfter);
      return structuredClone(hashDriftBefore);
    },
  });
  if (!hashDriftRetry || hashDriftRetry.attempt !== 2 || hashDriftCalls !== 4 || hashDriftForeignReads !== 8
    || hashDriftRetry.leased[LEASE_PATHS[0]].sha256 !== hashDriftBefore[LEASE_PATHS[0]].sha256) {
    throw new Error('hash-only leased-byte drift did not retry the full composite');
  }
  let indexCall = 0;
  const stable = stableForeignComposite(EXPECTED_ROOT, 1, { snapshot: () => ({ ...stableSnapshot, status: Buffer.from(stableSnapshot.status) }),
    index: () => Buffer.from(indexCall++ ? 'i2' : 'i1'), diff: () => Buffer.from('d'), leased: () => structuredClone(stableLeased) });
  if (stable) throw new Error('torn composite index reads accepted');
  const lockDrift = stableForeignComposite(EXPECTED_ROOT, 1, { snapshot: (() => { let call = 0; return () => ({ ...stableSnapshot,
    status: Buffer.from(stableSnapshot.status), indexLockAbsent: call++ === 0 }); })(), index: () => Buffer.from('i'), diff: () => Buffer.from('d'),
  leased: () => structuredClone(stableLeased) });
  if (lockDrift) throw new Error('index-lock drift accepted');

  let leasedCall = 0; let foreignReads = 0;
  const leasedRetry = stableForeignComposite(EXPECTED_ROOT, 2, {
    snapshot: () => ({ ...stableSnapshot, status: Buffer.from(stableSnapshot.status) }),
    index: () => { foreignReads++; return Buffer.from('i'); },
    diff: () => { foreignReads++; return Buffer.from('d'); },
    leased: () => {
      const value = structuredClone(stableLeased);
      if (leasedCall++ === 1) value[LEASE_PATHS[0]].mtimeNs = 'changed';
      return value;
    },
  });
  if (!leasedRetry || leasedRetry.attempt !== 2 || foreignReads !== 8 || leasedCall !== 4
    || leasedRetry.leased[LEASE_PATHS[0]].sha256 !== stableLeased[LEASE_PATHS[0]].sha256) {
    throw new Error('leased-byte drift did not retry the full composite');
  }

  const tamperedArtifacts = ANCHOR_V2_ARTIFACTS.map((item) => ({ ...item })); tamperedArtifacts[0].sha256 = '0'.repeat(64);
  if (!validateAnchorPackage() || validateAnchorPackage(tamperedArtifacts)) throw new Error('anchor package exact binding validation');
}

function selfTestForeignIndexContract() {
  const indexRecord = (relativePath, stage = 0, objectId = 'a'.repeat(40)) => Buffer.from(`100644 ${objectId} ${stage}\t${relativePath}\0`);
  const foreignSpace = 'foreign path.js'; const foreignNewline = 'foreign\npath.js';
  const fullIndex = Buffer.concat([indexRecord(LEASE_PATHS[0]), indexRecord(foreignNewline, 2, 'b'.repeat(40)), indexRecord(foreignSpace)]);
  const canonical = canonicalForeignIndexBytes(fullIndex);
  if (canonical.includes(Buffer.from(LEASE_PATHS[0])) || !canonical.includes(Buffer.from(foreignSpace)) || !canonical.includes(Buffer.from(foreignNewline))) throw new Error('complete-index lease filtering/canonicalization');
  if (!canonicalForeignIndexBytes(Buffer.concat([indexRecord(foreignSpace), indexRecord(LEASE_PATHS[1])])).equals(indexRecord(foreignSpace))) throw new Error('exact raw index record preservation');
  for (const malformed of [Buffer.from('100644 bad 0\tx\0'), Buffer.from(`100644 ${'a'.repeat(40)} 0\tx`), Buffer.concat([indexRecord('x'), indexRecord('x')])]) {
    let rejected = false; try { canonicalForeignIndexBytes(malformed); } catch { rejected = true; } if (!rejected) throw new Error('malformed/duplicate index accepted');
  }
  const treeRecord = (relativePath, objectId = 'c'.repeat(40)) => Buffer.from(`100644 blob ${objectId}\t${relativePath}\0`);
  const foreignTree = canonicalForeignTreeBytes(Buffer.concat([treeRecord(LEASE_PATHS[0]), treeRecord(foreignNewline), treeRecord(foreignSpace)]));
  if (foreignTree.includes(Buffer.from(LEASE_PATHS[0])) || !foreignTree.includes(Buffer.from(foreignNewline)) || !foreignTree.includes(Buffer.from(foreignSpace))) throw new Error('foreign Git tree filtering/canonicalization');
  const statusFixture = (status, ...endpoints) => Buffer.concat([Buffer.from(`${status}\0`), ...endpoints.map((value) => Buffer.from(`${value}\0`))]);
  const crossings = [
    statusFixture('R100', foreignSpace, LEASE_PATHS[0]), statusFixture('R90', LEASE_PATHS[0], foreignNewline),
    statusFixture('C100', foreignNewline, LEASE_PATHS[1]), statusFixture('C75', foreignSpace, LEASE_PATHS[2]), statusFixture('D', foreignNewline),
  ];
  for (const fixture of crossings) {
    const parsed = parseNameStatusZ(fixture); const paths = foreignBinaryDiffPaths(fixture);
    if (!parsed.length || !parsed[0].endpoints.every((endpoint) => paths.includes(endpoint))) throw new Error('foreign rename/copy/delete endpoint omitted');
  }
  for (const fixture of [statusFixture('A', LEASE_PATHS[0]), statusFixture('M', LEASE_PATHS[1]), statusFixture('D', LEASE_PATHS[2]),
    statusFixture('R100', LEASE_PATHS[0], LEASE_PATHS[1]), statusFixture('C100', LEASE_PATHS[0], LEASE_PATHS[1])]) {
    if (foreignBinaryDiffPaths(fixture).length) throw new Error('leased-only staged record classified foreign');
  }
  if (foreignBinaryDiffPaths(statusFixture('A', LEASE_PATHS[0])).length) throw new Error('leased similar add invented copy source');
  for (const malformed of [Buffer.from('R100\0source\0'), Buffer.from('Cbad\0a\0b\0'), Buffer.from('R100\0same\0same\0'), Buffer.from('A\0path')]) {
    let rejected = false; try { parseNameStatusZ(malformed); } catch { rejected = true; } if (!rejected) throw new Error('malformed name-status accepted');
  }
  const discover = ['diff', '--cached', '--name-status', '-z', '--find-renames', '--find-copies', '--find-copies-harder'];
  const binary = ['diff', '--cached', '--binary', '--no-ext-diff', '--find-renames', '--find-copies', '--find-copies-harder', '--', foreignSpace, LEASE_PATHS[0]];
  const tree = ['ls-tree', '--full-tree', '-r', '-z', 'a'.repeat(40)];
  if (!isAllowedCommand('/usr/bin/git', ['ls-files', '--stage', '-z']) || !isAllowedCommand('/usr/bin/git', discover)
    || !isAllowedCommand('/usr/bin/git', binary) || !isAllowedCommand('/usr/bin/git', tree) || isAllowedCommand('/usr/bin/git', discover.slice(0, -1))
    || isAllowedCommand('/usr/bin/git', binary.filter((value) => value !== '--find-copies-harder'))
    || isAllowedCommand('/usr/bin/git', tree.slice(0, -1))
    || isAllowedCommand('/usr/bin/git', ['diff', '--cached', '--name-status', '--find-renames', '--find-copies', '--find-copies-harder'])) throw new Error('foreign evidence command allowlist');
  if (!LEASE_PATHS.slice(4).every((relativePath) => !statusRowIsForeign({ path: relativePath, originalPath: null }))
    || !statusRowIsForeign({ path: LEASE_PATHS[4], originalPath: foreignSpace })) throw new Error('eighteen-path worktree lease classification');
}

function selfTestForeignTransitions() {
  const indexRecord = (relativePath, objectId = 'a'.repeat(40)) => Buffer.from(`100644 ${objectId} 0\t${relativePath}\0`);
  const statusFixture = (status, ...endpoints) => Buffer.concat([Buffer.from(`${status}\0`), ...endpoints.map((value) => Buffer.from(`${value}\0`))]);
  const transition = ({ beforeIndex, afterIndex, status, beforeDiff = Buffer.alloc(0), afterDiff = Buffer.from('foreign transition'), oldMustMiss = false }) => {
    const before = canonicalForeignIndexBytes(beforeIndex);
    const after = canonicalForeignIndexBytes(afterIndex);
    const endpoints = foreignBinaryDiffPaths(status);
    const old = oldDestinationOnlyForeignPaths(status);
    if (oldMustMiss && old.length !== 0) throw new Error('old destination-only discovery unexpectedly caught transition');
    if (before.equals(after) && beforeDiff.equals(afterDiff)) throw new Error('foreign transition did not change protected state');
    return endpoints;
  };
  for (const suffix of [' path.js', '\npath.js']) {
    const foreign = `foreign${suffix}`;
    const leased = LEASE_PATHS[0];
    let endpoints = transition({ beforeIndex: indexRecord(foreign), afterIndex: Buffer.alloc(0), status: statusFixture('D', foreign) });
    if (!sameSet(endpoints, [foreign])) throw new Error('foreign delete transition endpoint loss');
    endpoints = transition({ beforeIndex: indexRecord(foreign), afterIndex: indexRecord(leased), status: statusFixture('R100', foreign, leased), oldMustMiss: true });
    if (!sameSet(endpoints, [foreign, leased])) throw new Error('foreign-to-leased rename transition endpoint loss');
    endpoints = transition({ beforeIndex: indexRecord(leased), afterIndex: indexRecord(foreign), status: statusFixture('R100', leased, foreign) });
    if (!sameSet(endpoints, [leased, foreign])) throw new Error('leased-to-foreign rename transition endpoint loss');
    endpoints = transition({ beforeIndex: indexRecord(foreign), afterIndex: Buffer.concat([indexRecord(foreign), indexRecord(leased)]),
      status: statusFixture('C100', foreign, leased), oldMustMiss: true });
    if (!sameSet(endpoints, [foreign, leased])) throw new Error('unchanged-foreign-to-leased copy transition endpoint loss');
    endpoints = transition({ beforeIndex: indexRecord(foreign), afterIndex: Buffer.concat([indexRecord(foreign, 'b'.repeat(40)), indexRecord(leased)]),
      status: statusFixture('C75', foreign, leased) });
    if (!sameSet(endpoints, [foreign, leased])) throw new Error('changed-foreign-to-leased copy transition endpoint loss');
  }
  const stableForeign = indexRecord('stable foreign.js');
  const leasedAddAfter = Buffer.concat([stableForeign, indexRecord(LEASE_PATHS[1])]);
  if (!canonicalForeignIndexBytes(stableForeign).equals(canonicalForeignIndexBytes(leasedAddAfter))
    || foreignBinaryDiffPaths(statusFixture('A', LEASE_PATHS[1])).length
    || oldDestinationOnlyForeignPaths(statusFixture('A', LEASE_PATHS[1])).length) throw new Error('leased-only/similar-content add changed foreign state');
  for (const status of ['M', 'D']) {
    const before = Buffer.concat([stableForeign, indexRecord(LEASE_PATHS[2])]);
    const after = status === 'D' ? stableForeign : Buffer.concat([stableForeign, indexRecord(LEASE_PATHS[2], 'b'.repeat(40))]);
    if (!canonicalForeignIndexBytes(before).equals(canonicalForeignIndexBytes(after))
      || foreignBinaryDiffPaths(statusFixture(status, LEASE_PATHS[2])).length) throw new Error(`leased-only ${status} changed foreign state`);
  }
  const leasedRename = statusFixture('R100', LEASE_PATHS[0], LEASE_PATHS[1]);
  if (foreignBinaryDiffPaths(leasedRename).length || oldDestinationOnlyForeignPaths(leasedRename).length) throw new Error('leased-only rename classified foreign');
}

function selfTestPostcommitEvidenceSplit() {
  if (PRECOMMIT_COMMIT_GROUPS.length !== 4 || COMMIT_GROUPS.length !== 5) throw new Error('precommit/five-commit group split structure');
  if (!sameList(PRECOMMIT_COMMIT_GROUPS, COMMIT_GROUPS.slice(0, 4))) throw new Error('precommit groups must be first four of five');

  const anchorGroups = PRECOMMIT_COMMIT_GROUPS.map((group, index) => ({ ordinal: index + 1, subject: group.message, paths: [...group.paths] }));
  if (anchorGroups.length !== 4 || anchorGroups[3].subject !== COMMIT_GROUPS[3].message) throw new Error('anchor group derivation from precommit subset');

  const fullUnion = COMMIT_GROUPS.flatMap((group) => group.paths);
  const precommitUnion = PRECOMMIT_COMMIT_GROUPS.flatMap((group) => group.paths);
  if (!sameList(precommitUnion, LEASE_PATHS) || new Set(precommitUnion).size !== LEASE_PATHS.length) throw new Error('precommit union must be exact 18 with no duplicates');
  if (sameList(fullUnion, LEASE_PATHS)) throw new Error('full five-commit union must NOT equal lease list (script appears twice)');
  if (!sameSet([...new Set(fullUnion)], LEASE_PATHS)) throw new Error('five-commit unique union must equal 18 leases');

  const scriptPath = LEASE_PATHS[2];
  const scriptAppearances = COMMIT_GROUPS.filter((group) => group.paths.includes(scriptPath));
  if (scriptAppearances.length !== 2 || scriptAppearances[0].message !== COMMIT_GROUPS[1].message || scriptAppearances[1].message !== COMMIT_GROUPS[4].message) throw new Error('script must appear in row2 and row5 only');
  for (let index = 0; index < LEASE_PATHS.length; index++) {
    if (index === 2) continue;
    const appearances = COMMIT_GROUPS.filter((group) => group.paths.includes(LEASE_PATHS[index]));
    if (appearances.length !== 1) throw new Error(`non-script lease must appear exactly once: ${LEASE_PATHS[index]}`);
  }
  if (COMMIT_GROUPS[4].message !== 'Separate postcommit boundary evidence from precommit anchor' || !sameList(COMMIT_GROUPS[4].paths, [scriptPath])) throw new Error('fifth commit group exact contract');

  const commits = ['a', 'b', 'c', 'd', 'e'].map((value) => value.repeat(40));
  const blobHash = (relativePath) => sha256(`blob:${relativePath}`);
  const rows5 = COMMIT_GROUPS.map((group, index) => ({
    commit: commits[index], subject: group.message, parent: index ? commits[index - 1] : PLANNING_BASELINE, paths: [...group.paths],
    blobSha256: Object.fromEntries(group.paths.map((relativePath) => [relativePath, blobHash(relativePath)])),
  }));
  const observations5 = COMMIT_GROUPS.map((group, index) => ({ exists: true, parents: [index ? commits[index - 1] : PLANNING_BASELINE], message: group.message,
    paths: [...group.paths], blobs: Object.fromEntries(group.paths.map((relativePath) => [relativePath, blobHash(relativePath)])),
    foreignParentTree: Buffer.from(`tree-${index}`), foreignCommitTree: Buffer.from(`tree-${index}`) }));
  const foreign = { index: Buffer.from('idx'), binaryDiff: Buffer.from('diff') };
  const currentHashes = Object.fromEntries(LEASE_PATHS.map((relativePath) => [relativePath, blobHash(relativePath)]));

  if (!validateCommitChain({ rows: rows5, observations: observations5, currentHashes, currentHead: commits[4], currentForeign: foreign, anchorForeign: foreign })) throw new Error('five-row positive ancestry/finalHead/subject/path/blob/tree');

  const historicalScriptHash = sha256('historical preflight script');
  rows5[1].blobSha256[scriptPath] = historicalScriptHash;
  observations5[1].blobs[scriptPath] = historicalScriptHash;
  if (!validateCommitChain({ rows: rows5, observations: observations5, currentHashes, currentHead: commits[4], currentForeign: foreign, anchorForeign: foreign })) throw new Error('historical duplicate lease blob rejected when latest owner matches current bytes');

  const rows4 = rows5.slice(0, 4); const obs4 = observations5.slice(0, 4);
  if (validateCommitChain({ rows: rows4, observations: obs4, currentHashes, currentHead: commits[3], currentForeign: foreign, anchorForeign: foreign })) throw new Error('four-row chain must be rejected by five-commit validator');

  const wrongHead = [...rows5]; if (validateCommitChain({ rows: wrongHead, observations: observations5, currentHashes, currentHead: commits[3], currentForeign: foreign, anchorForeign: foreign })) throw new Error('wrong finalHead accepted');
  const wrongSubject = structuredClone(rows5); wrongSubject[4].subject = 'wrong'; if (validateCommitChain({ rows: wrongSubject, observations: observations5, currentHashes, currentHead: commits[4], currentForeign: foreign, anchorForeign: foreign })) throw new Error('wrong row5 subject accepted');
  const wrongParent = structuredClone(rows5); wrongParent[4].parent = 'f'.repeat(40); if (validateCommitChain({ rows: wrongParent, observations: observations5, currentHashes, currentHead: commits[4], currentForeign: foreign, anchorForeign: foreign })) throw new Error('wrong row5 parent accepted');
  const wrongBlob = structuredClone(rows5); wrongBlob[4].blobSha256[scriptPath] = '0'.repeat(64); if (validateCommitChain({ rows: wrongBlob, observations: observations5, currentHashes, currentHead: commits[4], currentForeign: foreign, anchorForeign: foreign })) throw new Error('wrong row5 blob accepted');
  const wrongTree = observations5.map((item) => ({ ...structuredClone(item), foreignParentTree: Buffer.from(item.foreignParentTree), foreignCommitTree: Buffer.from(item.foreignCommitTree) })); wrongTree[4].foreignCommitTree = Buffer.from('changed'); if (validateCommitChain({ rows: rows5, observations: wrongTree, currentHashes, currentHead: commits[4], currentForeign: foreign, anchorForeign: foreign })) throw new Error('row5 tree drift accepted');

  const driftHashes = { ...currentHashes, [scriptPath]: '0'.repeat(64) };
  if (validateCommitChain({ rows: rows5, observations: observations5, currentHashes: driftHashes, currentHead: commits[4], currentForeign: foreign, anchorForeign: foreign })) throw new Error('hash-only lease drift accepted');

  const statusBytes = Buffer.from('?? foreign.js\0?? other.js\0');
  const foreignCurrent = [{ status: '??', path: 'foreign.js', originalPath: null }, { status: '??', path: 'other.js', originalPath: null }];
  const foreignObserved = new Map([
    ['??\0foreign.js\0', { valid: true, statExists: true, fileType: 'regular', mode: '100644', symlinkTarget: null, worktreeSha256: '1'.repeat(64) }],
    ['??\0other.js\0', { valid: true, statExists: true, fileType: 'regular', mode: '100644', symlinkTarget: null, worktreeSha256: '2'.repeat(64) }],
  ]);
  const context = { repoRoot: EXPECTED_ROOT, branch: EXPECTED_BRANCH, head: PLANNING_BASELINE, statusBytes };
  const validReceipt = { repoRoot: EXPECTED_ROOT, branch: EXPECTED_BRANCH, head: PLANNING_BASELINE,
    statusPorcelainV1ZSha256: sha256(statusBytes), statusPorcelainV1ZBytes: statusBytes.length,
    paths: [
      { status: '??', path: 'foreign.js', originalPath: null, fileType: 'regular', mode: '100644', symlinkTarget: null, worktreeSha256: '1'.repeat(64) },
      { status: '??', path: 'other.js', originalPath: null, fileType: 'regular', mode: '100644', symlinkTarget: null, worktreeSha256: '2'.repeat(64) },
    ] };
  if (!validateForeignWorktreeReceipt(validReceipt, foreignCurrent, foreignObserved, context)) throw new Error('postcommit boundary positive receipt rejected');

  const staleHead = { ...structuredClone(validReceipt), head: 'e'.repeat(40) };
  if (validateForeignWorktreeReceipt(staleHead, foreignCurrent, foreignObserved, context)) throw new Error('stale postcommit receipt head accepted');
  const staleStatus = { ...structuredClone(validReceipt), statusPorcelainV1ZSha256: '0'.repeat(64) };
  if (validateForeignWorktreeReceipt(staleStatus, foreignCurrent, foreignObserved, context)) throw new Error('stale postcommit receipt status hash accepted');
  const wrongPath = structuredClone(validReceipt); wrongPath.paths[0].path = 'foreign2.js';
  if (validateForeignWorktreeReceipt(wrongPath, foreignCurrent, foreignObserved, context)) throw new Error('wrong postcommit receipt path accepted');
  const tamperedHash = structuredClone(validReceipt); tamperedHash.paths[0].worktreeSha256 = '0'.repeat(64);
  if (validateForeignWorktreeReceipt(tamperedHash, foreignCurrent, foreignObserved, context)) throw new Error('tampered postcommit receipt blob hash accepted');
  const missingRow = { ...structuredClone(validReceipt), paths: validReceipt.paths.slice(0, 1) };
  if (validateForeignWorktreeReceipt(missingRow, foreignCurrent, foreignObserved, context)) throw new Error('missing postcommit receipt row accepted');
  const extraForeign = [...foreignCurrent, { status: '??', path: 'extra.js', originalPath: null }];
  if (validateForeignWorktreeReceipt(validReceipt, extraForeign, foreignObserved, context)) throw new Error('extra foreign row accepted by receipt');

  const oldBoundaryBytes = Buffer.from('?? foreign.js\0?? other.js\0');
  const oldBoundaryContext = { ...context, statusBytes: oldBoundaryBytes };
  const oldBoundaryReceipt = { ...structuredClone(validReceipt), statusPorcelainV1ZSha256: sha256(oldBoundaryBytes), statusPorcelainV1ZBytes: oldBoundaryBytes.length };
  if (!validateForeignWorktreeReceipt(oldBoundaryReceipt, foreignCurrent, foreignObserved, oldBoundaryContext)) throw new Error('old boundary format must still validate with matching context');

  const anchorPaths = new Set(ANCHOR_V2_ARTIFACTS.map((item) => item.path));
  if (anchorPaths.has('boundary/postcommit-foreign-worktree.json')) throw new Error('postcommit boundary path must not be in anchor artifact list');
  if (!anchorPaths.has('boundary/foreign-worktree.json')) throw new Error('old boundary path must remain in anchor artifact list');
  const scopeReadsPostcommitFirst = checkRepositoryScope.toString().includes("'boundary/postcommit-foreign-worktree.json', 'boundary/foreign-worktree.json', 'preflight/foreign-worktree.json'");
  if (!scopeReadsPostcommitFirst) throw new Error('scope check must read postcommit boundary path first, then old fallbacks');
  const manifest5 = { schema: 'transvoice.five-commit-evidence.v3', anchor: { sha256: ANCHOR_V2_SHA256, reviewSha256: REVIEW_V2_SHA256, confirmationSha256: CONFIRMATION_V2_SHA256 }, baselineHead: PLANNING_BASELINE, rows: rows5, finalHead: commits[4] };
  if (!strictCommitManifestEnvelope(manifest5)) throw new Error('five-commit manifest envelope rejected');
  const manifest4 = { ...structuredClone(manifest5), rows: rows5.slice(0, 4), finalHead: commits[3], schema: 'transvoice.four-commit-evidence.v2' };
  if (strictCommitManifestEnvelope(manifest4)) throw new Error('four-commit manifest must be rejected by five-commit envelope');
  const schema5 = buildCommitSchema(manifest5);
  if (schema5.properties.rows.minItems !== 5 || schema5.properties.rows.maxItems !== 5 || schema5.properties.rows.prefixItems.length !== 5) throw new Error('five-commit schema must require exactly 5 rows');
}

function runSelfTests() {
  selfTestBasics();
  selfTestUnitTruthTable();
  selfTestRunbookIntegrity();
  selfTestRunbookPathValidator();
  selfTestSecurityValidators();
  selfTestEvidenceValidators();
  selfTestCommit5ChainContract();
  selfTestPostcommitEvidenceSplit();
  selfTestForeignIndexContract();
  selfTestForeignTransitions();
}

function addCheck(checks, id, phase, status, detail, evidence = []) {
  checks.push({ id, phase, status, detail: redactString(detail), evidence: evidence.map(redactString).slice(0, 12) });
}

function checkRepositoryState(repoRoot, checks) {
  const branch = gitText(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
  const head = gitText(['rev-parse', 'HEAD'], repoRoot);
  const baselineIsAncestor = git(['merge-base', '--is-ancestor', PLANNING_BASELINE, 'HEAD'], repoRoot).status === 0;
  const branchPass = repoRoot === EXPECTED_ROOT && branch === EXPECTED_BRANCH && baselineIsAncestor && /^[a-f0-9]{40}$/.test(head || '');
  addCheck(checks, 'branch-baseline', 'OFFLINE_READY', branchPass ? 'PASS' : 'FAIL', branchPass
    ? 'Expected repository, branch, and planning-baseline ancestry confirmed.'
    : 'Repository, branch, HEAD, or planning-baseline ancestry does not match the approved plan.', [`head:${head || 'unavailable'}`]);

  const leaseHashes = {};
  let leasesPresent = true;
  for (const relativePath of LEASE_PATHS) {
    const read = readBytes(path.join(repoRoot, relativePath));
    if (!read.ok) leasesPresent = false;
    leaseHashes[relativePath] = read.ok ? sha256(read.bytes) : null;
  }
  addCheck(checks, 'lease-artifacts', 'OFFLINE_READY', leasesPresent ? 'PASS' : 'BLOCKING_UNKNOWN', leasesPresent
    ? `All ${LEASE_PATHS.length} leased artifacts are present and hashed.` : 'One or more leased artifacts are missing or unreadable.', Object.entries(leaseHashes).map(([name, hash]) => `${name}:sha256:${hash || 'unavailable'}`));

  const repositoryScope = checkRepositoryScope(repoRoot);
  addCheck(checks, 'repository-change-scope', 'OFFLINE_READY', repositoryScope.status, repositoryScope.detail, repositoryScope.evidence);

  const syntaxTargets = LEASE_PATHS.filter((name) => /\.c?js$/.test(name));
  const syntaxFailures = [];
  for (const relativePath of syntaxTargets) {
    if (!leaseHashes[relativePath]) { syntaxFailures.push(relativePath); continue; }
    const result = runAllowed(process.execPath, ['--check', relativePath], repoRoot);
    if (result.status !== 0) syntaxFailures.push(relativePath);
  }
  addCheck(checks, 'javascript-syntax', 'OFFLINE_READY', syntaxFailures.length ? 'FAIL' : 'PASS', syntaxFailures.length
    ? `Syntax failed for ${syntaxFailures.join(', ')}.` : `All ${syntaxTargets.length} leased JavaScript files pass the Node syntax check.`);
  return { branch, head, baselineIsAncestor, syntaxFailures };
}

function checkWholeIife(repoRoot, checks, syntaxFailures) {
  const testPath = path.join(repoRoot, 'backend/test/coach-app-iife.test.js');
  const testRead = readBytes(testPath);
  const testSource = testRead.ok ? testRead.bytes.toString('utf8') : '';
  let testRows = [];
  let testExit = null;
  if (testRead.ok && !syntaxFailures.includes('backend/test/coach-app-iife.test.js')) {
    const result = runAllowed(process.execPath, ['--test', '--test-reporter=tap', 'backend/test/coach-app-iife.test.js'], repoRoot);
    testExit = result.status;
    testRows = parseTap(`${result.stdout}\n${result.stderr}`);
  }
  const exactNames = testRows.length === 26 && testRows.plans.length === 1 && testRows.plans[0] === 26
    && testRows.every((row, index) => row.index === index + 1 && row.name === TEST_NAMES[index]);
  const exactResults = testExit === 0 && exactNames && testRows.every((row) => row.pass && !row.skipped);
  addCheck(checks, 'whole-iife-exact-names', 'OFFLINE_READY', exactNames ? 'PASS' : 'FAIL', exactNames
    ? 'The whole-IIFE suite reports the exact ordered 26-test contract.' : `Whole-IIFE suite reported ${testRows.length} parsed tests; exact ordered 26 names required.`);
  addCheck(checks, 'whole-iife-results', 'OFFLINE_READY', exactResults ? 'PASS' : 'FAIL', exactResults
    ? 'Whole-IIFE suite reports 26 pass, 0 fail, skip, or todo.' : 'Whole-IIFE suite does not report an exact clean 26/26 result.');
  const r12Pass = testRows.length >= 20 && testRows.slice(0, 20).every((row, index) => row.name === TEST_NAMES[index] && row.pass && !row.skipped);
  addCheck(checks, 'r12-core-results', 'OFFLINE_READY', r12Pass ? 'PASS' : 'FAIL', r12Pass
    ? 'All 20 preserved R12 contracts pass under the whole-IIFE harness.' : 'The 20 preserved R12 contracts are missing, renamed, or failing.');
  const cleanupPass = exactResults && [TEST_NAMES[22], TEST_NAMES[25]].every((name) => testRows.some((row) => row.name === name && row.pass));
  addCheck(checks, 'exactly-once-session-cleanup', 'OFFLINE_READY', cleanupPass ? 'PASS' : 'FAIL', cleanupPass
    ? 'Lifecycle tests prove one cleanup owner across normal and unload transports.' : 'Passing lifecycle evidence for exactly-once cleanup is unavailable.');
  return testSource;
}

function checkSourceContract(repoRoot, checks, testSource) {
  const coachRead = readBytes(path.join(repoRoot, 'backend/coach-app.js'));
  const coachSource = coachRead.ok ? coachRead.bytes.toString('utf8') : '';
  const codeBlock = (coachSource.match(/var SSE_DIAGNOSTIC_CODES = \{([\s\S]*?)\n\s*\};/) || [])[1] || '';
  const foundCodes = [...codeBlock.matchAll(/\b(SSE_[A-Z_]+)\s*:/g)].map((match) => match[1]);
  const codesPass = sameSet(foundCodes, SSE_CODES) && foundCodes.length === SSE_CODES.length;
  addCheck(checks, 'sse-diagnostic-allowlist', 'OFFLINE_READY', codesPass ? 'PASS' : 'FAIL', codesPass
    ? 'Client source contains exactly the seven approved SSE diagnostic codes.' : 'Client SSE diagnostic code allowlist differs from the approved seven-code set.');

  const hermetic = checkSelfHermeticity(repoRoot, testSource);
  addCheck(checks, 'hermetic-static-and-route-trap', 'OFFLINE_READY', hermetic.status, hermetic.detail, hermetic.evidence);
}

function checkExternalEvidence(repoRoot, checks) {
  const mutation = checkMutationEvidence(repoRoot);
  addCheck(checks, 'r12-mutation-replay', 'OFFLINE_READY', mutation.status, mutation.detail, mutation.evidence);

  const custodyResult = checkCustody(repoRoot);
  addCheck(checks, 'dirty-call-path-custody', 'OFFLINE_READY', custodyResult.status, custodyResult.detail, custodyResult.evidence);

  const runbook = checkRunbook(repoRoot);
  addCheck(checks, 'runbook', 'OFFLINE_READY', runbook.status, runbook.detail, runbook.evidence);
  const ownerPass = runbook.policy && runbook.policy.agentProcessOwner && runbook.policy.explicitNonUse;
  addCheck(checks, 'process-owner-policy', 'OFFLINE_READY', ownerPass ? 'PASS' : 'FAIL', ownerPass
    ? 'agent-process is the future gateway owner and the dormant unit is forbidden.' : 'Future gateway ownership or explicit dormant-unit non-use is absent or ambiguous.');

  const unit = evaluateUnit(runbook.policy || { agentProcessOwner: false, explicitNonUse: false });
  addCheck(checks, 'installed-unit-static-truth-table', 'OFFLINE_READY', unit.result.status, unit.detail, unit.result.currentSha256 ? [`static-file:sha256:${unit.result.currentSha256}`] : []);

  const anchorV2 = checkAnchorV2(repoRoot);
  addCheck(checks, 'commit-evidence-anchor-v2', 'OFFLINE_READY', anchorV2.status, anchorV2.detail, anchorV2.evidence);

  const commitEvidence = checkCommitEvidence(repoRoot);
  addCheck(checks, 'commit-isolation-foreign-index', 'OFFLINE_READY', commitEvidence.status, commitEvidence.detail, commitEvidence.evidence);

  for (const live of LIVE_CHECKS) addCheck(checks, live.id, 'FIRST_LIVE_ONLY', 'DEFERRED', 'FIRST_LIVE_ONLY');
  return { custodyResult, unit };
}

function summarizeChecks(checks) {
  const summary = { pass: 0, warn: 0, deferred: 0, blockingUnknown: 0, fail: 0 };
  for (const check of checks) {
    if (check.status === 'PASS') summary.pass++;
    else if (check.status === 'WARN_DO_NOT_USE') summary.warn++;
    else if (check.status === 'DEFERRED') summary.deferred++;
    else if (check.status === 'BLOCKING_UNKNOWN') summary.blockingUnknown++;
    else if (check.status === 'FAIL') summary.fail++;
  }
  return summary;
}

function main() {
  runSelfTests();
  const checks = [];
  const repoRoot = discoverRepoRoot();
  if (!repoRoot) throw new Error('repository root discovery failed');
  const repository = checkRepositoryState(repoRoot, checks);
  const testSource = checkWholeIife(repoRoot, checks, repository.syntaxFailures);
  checkSourceContract(repoRoot, checks, testSource);
  const { custodyResult, unit } = checkExternalEvidence(repoRoot, checks);
  const summary = summarizeChecks(checks);
  const overall = summary.fail ? 'FAIL' : summary.blockingUnknown ? 'BLOCKED' : 'OFFLINE_READY';
  const offlineReady = overall === 'OFFLINE_READY';
  const output = sanitize({
    schema: 'transvoice.first-call-preflight.v1',
    generatedAt: new Date().toISOString(),
    repoRoot,
    branch: repository.branch,
    planningBaseline: PLANNING_BASELINE,
    head: repository.head,
    baselineIsAncestor: repository.baselineIsAncestor,
    processOwner: PROCESS_OWNER,
    installedUnit: unit.result,
    overall,
    offlineReady,
    summary,
    checks,
    custody: custodyResult.custody,
    liveChecks: LIVE_CHECKS,
  });
  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  process.exitCode = offlineReady ? 0 : 1;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    const fallback = sanitize({
      schema: 'transvoice.first-call-preflight.v1',
      generatedAt: new Date().toISOString(),
      repoRoot: null,
      branch: null,
      planningBaseline: PLANNING_BASELINE,
      head: null,
      baselineIsAncestor: false,
      processOwner: PROCESS_OWNER,
      installedUnit: { path: UNIT_PATH, reviewedSha256: REVIEWED_UNIT_SHA256, currentSha256: null, readable: false, parseStatus: 'UNAVAILABLE', plannedUse: false, ownershipConflict: false, status: 'BLOCKING_UNKNOWN' },
      overall: 'FAIL',
      offlineReady: false,
      summary: { pass: 0, warn: 0, deferred: 0, blockingUnknown: 0, fail: 1 },
      checks: [{ id: 'internal-error', phase: 'OFFLINE_READY', status: 'FAIL', detail: redactString(error && error.message ? error.message : 'internal error'), evidence: [] }],
      custody: [],
      liveChecks: LIVE_CHECKS,
    });
    process.stdout.write(`${JSON.stringify(fallback, null, 2)}\n`);
    process.stderr.write('preflight internal error; see sanitized JSON result\n');
    process.exitCode = 2;
  }
}

module.exports = {
  LEASE_PATHS, COMMIT_GROUPS, PRECOMMIT_COMMIT_GROUPS, ANCHOR_V2_ARTIFACTS,
  sha256, sameSet, sameList, redactString, sanitize, isSecretKey,
  isSafeRepoPath, isAllowedCommand, parseNulList, parsePorcelainV1Z, statusRowIsForeign, parseStageZ,
  readLockedRegularFile, readLockedEvidenceFile, readVerifiedReceipt,
  extractDependencySpecifiers, discoverDependencyClosureFromMap,
  validateMutationTapRows, validateMutationArtifactBytes, validateMutationReceipt, validateFocusedTestBytes, validateProvenanceBytes,
  validateCustodyRow, validateCustodyManifest, deriveExternalIdentity, validateExternalCustodyRow, validateExternalCustodyManifest,
  validateExternalProvenanceBytes, validateExternalCustodyEvidence,
  validateForeignWorktreeReceipt, splitNulBuffers, parseIndexStageRecords, canonicalForeignIndexBytes, canonicalForeignTreeBytes,
  parseNameStatusZ, foreignBinaryDiffPaths, oldDestinationOnlyForeignPaths, readCurrentForeignIndex, readCurrentForeignBinaryDiff,
  readCommitForeignTree, stripOneTerminalGitEol, jsonEqual, canonicalGeneratedJson, strictSchemaValidate,
  readStableLeasedFiles, leasedSnapshotsEqual, stableForeignComposite, validateAnchorPackage,
  validateCommitReceiptRow, validateCommitChain, strictCommitManifestEnvelope, buildCommitSchema, validateHermeticSource,
  tokenizeUnitValue, parseUnit, parseTap, evaluateUnitRead, canonicalizeMarkdownLineEndings,
  validateRunbookMarkdownStructure, inspectRunbookArtifact, readLockedRegularFile, inspectRunbookPath, validateRunbookExecutableSurface, runSelfTests,
};
