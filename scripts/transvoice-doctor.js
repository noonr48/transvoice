#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const net = require('net');

// ─── Config ──────────────────────────────────────────────────────────────────

const ROOT = path.resolve(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const STATE_ROOT_DEFAULT = path.join(
  process.env.HOME || '/home/USER
  '.local', 'state', 'sloane', 'voice-standalone',
);

const SERVICES = {
  gateway:     { port: 3021, label: 'Gateway (3021)' },
  voiceTrainer:{ port: 8002, label: 'VoiceTrainer (8002)' },
  gguf:        { port: 8019, label: 'GGUF Model (8019)' },
  tts:         { port: 8020, label: 'TTS Service (8020)' },
};

const GATEWAY = 'http://127.0.0.1:3021';
const TTS     = 'http://127.0.0.1:8020';
const TRAINER = 'http://127.0.0.1:8002';
const GGUF    = 'http://127.0.0.1:8019';

const REQUIRED_ENV_VARS = [
  'VOXCPM_ENABLED',
  'VOXCPM_URL',
  'VOICE_STANDALONE_PORT',
  'VOICE_TRAINER_URL',
  'VOICE_TUTOR_GGUF_BASE_URL',
];

// ─── CLI Flags ───────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const FLAG_JSON  = args.includes('--json');
const FLAG_QUICK = args.includes('--quick');
const FLAG_FIX   = args.includes('--fix');

// ─── Colors ──────────────────────────────────────────────────────────────────

const supportsColor = process.stdout.isTTY && !FLAG_JSON;
const C = {
  green:  supportsColor ? '\x1b[32m' : '',
  red:    supportsColor ? '\x1b[31m' : '',
  yellow: supportsColor ? '\x1b[33m' : '',
  cyan:   supportsColor ? '\x1b[36m' : '',
  dim:    supportsColor ? '\x1b[2m' : '',
  bold:   supportsColor ? '\x1b[1m' : '',
  reset:  supportsColor ? '\x1b[0m' : '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return {};
  const lines = fs.readFileSync(filePath, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  const env = {};
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const ci = value.indexOf(' #');
      if (ci >= 0) value = value.slice(0, ci).trim();
    }
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

async function httpGet(url, { timeoutMs = 5000, headers = {} } = {}) {
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    const text = await resp.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { text }; }
    return { ok: resp.ok, status: resp.status, durationMs: Date.now() - t0, body, headers: resp.headers, error: null };
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - t0, body: null, headers: null, error: err.message || String(err) };
  }
}

async function httpPost(url, bodyObj, { timeoutMs = 15000, headers = {}, raw = false } = {}) {
  const t0 = Date.now();
  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(bodyObj),
      signal: AbortSignal.timeout(timeoutMs),
      cache: 'no-store',
    });
    if (raw) {
      const buf = Buffer.from(await resp.arrayBuffer());
      return { ok: resp.ok, status: resp.status, durationMs: Date.now() - t0, body: buf, headers: resp.headers, error: null };
    }
    const text = await resp.text();
    let body;
    try { body = text ? JSON.parse(text) : null; } catch { body = { text }; }
    return { ok: resp.ok, status: resp.status, durationMs: Date.now() - t0, body, headers: resp.headers, error: null };
  } catch (err) {
    return { ok: false, status: 0, durationMs: Date.now() - t0, body: null, headers: null, error: err.message || String(err) };
  }
}

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true)); // port in use
    server.once('listening', () => { server.close(); resolve(false); }); // port free
    server.listen(port, '127.0.0.1');
  });
}

function formatDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatUptime(seconds) {
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// ─── Result Tracking ─────────────────────────────────────────────────────────

const results = [];
let passed = 0;
let failed = 0;
let warnings = 0;

function ok(section, label, detail, extra = {}) {
  const r = { section, label, status: 'pass', detail, ...extra };
  results.push(r);
  passed++;
  if (!FLAG_JSON) console.log(`${C.green}[✓]${C.reset} ${label.padEnd(26)} — ${detail}`);
}

function warn(section, label, detail, extra = {}) {
  const r = { section, label, status: 'warn', detail, ...extra };
  results.push(r);
  warnings++;
  if (!FLAG_JSON) console.log(`${C.yellow}[!]${C.reset} ${label.padEnd(26)} — ${detail}`);
}

function fail(section, label, detail, fix = '', extra = {}) {
  const r = { section, label, status: 'fail', detail, fix, ...extra };
  results.push(r);
  failed++;
  if (!FLAG_JSON) console.log(`${C.red}[✗]${C.reset} ${label.padEnd(26)} — ${C.red}FAILED: ${detail}${C.reset}`);
}

function sectionHeader(title) {
  if (!FLAG_JSON) console.log(`\n${C.cyan}── ${title} ${'─'.repeat(Math.max(0, 40 - title.length))}${C.reset}`);
}

// ─── Check: Service Health ───────────────────────────────────────────────────

async function checkServiceHealth() {
  sectionHeader('Service Health');

  // Gateway
  const gw = await httpGet(`${GATEWAY}/health`);
  if (gw.ok && gw.body?.status === 'online') {
    ok('health', 'Gateway (3021)', `healthy (${gw.durationMs}ms)`);
  } else if (gw.status > 0 && gw.body) {
    // 503 = running but degraded (dependency down). Still reachable.
    const degraded = [];
    const svc = gw.body.services || {};
    if (svc.voiceTrainer?.status !== 'online') degraded.push('VoiceTrainer');
    if (svc.voiceTutorGguf?.status !== 'online') degraded.push('GGUF');
    const reason = degraded.length ? ` — degraded: ${degraded.join(', ')}` : '';
    warn('health', 'Gateway (3021)', `running but status=${gw.body.status || gw.status}${reason} (${gw.durationMs}ms)`);
  } else {
    fail('health', 'Gateway (3021)', gw.error || `HTTP ${gw.status}`,
      'cd /home/USER && node server.js');
  }

  // VoiceTrainer
  const vt = await httpGet(`${TRAINER}/health`);
  if (vt.ok) {
    ok('health', 'VoiceTrainer (8002)', `healthy (${vt.durationMs}ms)`);
  } else {
    fail('health', 'VoiceTrainer (8002)', vt.error || `HTTP ${vt.status}`,
      'Check VoiceTrainer service is running on port 8002');
  }

  // GGUF Model
  const gguf = await httpGet(`${GGUF}/v1/models`);
  if (gguf.ok && gguf.body) {
    const models = gguf.body.data || gguf.body;
    const modelId = Array.isArray(models) && models.length > 0
      ? (models[0].id || models[0])
      : 'unknown';
    ok('health', 'GGUF Model (8019)', `healthy, model=${modelId} (${gguf.durationMs}ms)`);
  } else {
    fail('health', 'GGUF Model (8019)', gguf.error || `HTTP ${gguf.status}`,
      'Check GGUF model server is running on port 8019');
  }

  // TTS Service
  const tts = await httpGet(`${TTS}/health`);
  if (tts.ok && tts.body?.ok) {
    const loaded = tts.body.model_loaded ? 'loaded' : 'not loaded';
    const dev = tts.body.device || 'unknown';
    const cache = tts.body.cache_size ?? '?';
    ok('health', 'TTS Service (8020)', `healthy, device=${dev}, cache=${cache}, model=${loaded} (${tts.durationMs}ms)`);
  } else if (tts.ok) {
    warn('health', 'TTS Service (8020)', `responding but unhealthy (${tts.durationMs}ms)`);
  } else {
    fail('health', 'TTS Service (8020)', tts.error || `HTTP ${tts.status}`,
      'cd /home/USER && CUDA_VISIBLE_DEVICES=1 .venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8020');
  }
}

// ─── Check: TTS Deep Check ───────────────────────────────────────────────────

async function checkTTSDeep() {
  sectionHeader('TTS Deep Check');

  // Health detail
  const health = await httpGet(`${TTS}/health`);
  if (health.ok && health.body) {
    const b = health.body;
    ok('tts-deep', 'Model loaded',
      `device=${b.device || '?'}, cache=${b.cache_size ?? '?'}, sample_rate=${b.sample_rate || '?'}`);
  } else {
    fail('tts-deep', 'Model loaded', health.error || 'TTS unreachable');
    return; // skip rest of deep checks if TTS is down
  }

  // Ready
  const ready = await httpGet(`${TTS}/ready`);
  if (ready.ok && ready.body?.ready) {
    ok('tts-deep', 'Service ready', 'true');
  } else if (ready.status === 503) {
    warn('tts-deep', 'Service ready', 'false — model still loading');
  } else {
    fail('tts-deep', 'Service ready', ready.error || `HTTP ${ready.status}`);
  }

  // Metrics
  const metrics = await httpGet(`${TTS}/metrics`);
  if (metrics.ok && metrics.body) {
    const m = metrics.body;
    const hitRate = m.cache_hit_rate != null ? `${(m.cache_hit_rate * 100).toFixed(0)}%` : '?';
    const uptime = m.uptime_seconds ? formatUptime(m.uptime_seconds) : '?';
    ok('tts-deep', 'Metrics',
      `${m.request_count ?? 0} requests, ${hitRate} cache hit rate, ${uptime} uptime`);
  } else {
    fail('tts-deep', 'Metrics', metrics.error || 'unavailable');
  }

  // Synthesis test (short text)
  const testText = 'Hello, this is a diagnostic test.';
  const synth = await httpPost(`${TTS}/generate`, { target_text: testText }, { timeoutMs: 30000, raw: true });
  if (synth.ok && synth.body && synth.body.length > 100) {
    ok('tts-deep', 'Synthesis test',
      `${formatDuration(synth.durationMs)}, ${synth.body.length} bytes`);
  } else if (synth.ok) {
    warn('tts-deep', 'Synthesis test',
      `returned ${synth.body?.length || 0} bytes — may be too short`);
  } else {
    fail('tts-deep', 'Synthesis test', synth.error || `HTTP ${synth.status}`);
  }

  // Info
  const info = await httpGet(`${TTS}/info`);
  if (info.ok && info.body) {
    const i = info.body;
    ok('tts-deep', 'Model info',
      `${i.model_id || '?'}, optimize=${i.optimize ?? '?'}, denoiser=${i.denoiser ?? '?'}, engine=${i.engine || '?'}`);
  } else {
    fail('tts-deep', 'Model info', info.error || 'unavailable');
  }
}

// ─── Check: Gateway → TTS Integration ───────────────────────────────────────

async function checkGatewayTTSIntegration() {
  sectionHeader('Gateway → TTS Integration');

  // Speech status
  const status = await httpGet(`${GATEWAY}/voice/speech/status`);
  if (status.ok && status.body?.providers) {
    const voxcpm = status.body.providers.voxcpm;
    if (voxcpm) {
      const detail = `enabled=${voxcpm.enabled}, available=${voxcpm.available}, cloning=${voxcpm.cloning?.supported ?? '?'}`;
      if (voxcpm.available) {
        ok('gateway-tts', 'Speech status', `voxcpm: ${detail}`);
      } else {
        warn('gateway-tts', 'Speech status', `voxcpm: ${detail} — ${voxcpm.lastError || 'not available'}`);
      }
    } else {
      warn('gateway-tts', 'Speech status', 'voxcpm provider not found in response');
    }
  } else {
    fail('gateway-tts', 'Speech status', status.error || `HTTP ${status.status}`);
  }

  // Speech generate
  const genText = 'Testing gateway speech proxy.';
  const gen = await httpPost(`${GATEWAY}/voice/speech/generate`,
    { targetText: genText }, { timeoutMs: 30000, raw: true });
  if (gen.ok && gen.body && gen.body.length > 100) {
    const provider = gen.headers?.get('x-voice-speech-provider') || '?';
    const streamId = gen.headers?.get('x-voice-speech-stream-id') || '?';
    ok('gateway-tts', 'Speech generate',
      `${gen.status}, provider=${provider}, stream=${streamId}, ${gen.body.length} bytes (${gen.durationMs}ms)`);
  } else if (gen.status === 501) {
    warn('gateway-tts', 'Speech generate', 'VoxCPM not enabled — set VOXCPM_ENABLED=true');
  } else {
    fail('gateway-tts', 'Speech generate', gen.error || `HTTP ${gen.status}`);
  }

  // Response headers check
  if (gen.ok && gen.headers) {
    const provider = gen.headers.get('x-voice-speech-provider');
    const streamId = gen.headers.get('x-voice-speech-stream-id');
    if (provider && streamId) {
      ok('gateway-tts', 'Response headers',
        `X-Voice-Speech-Provider=${provider}, X-Voice-Speech-Stream-Id=${streamId}`);
    } else {
      warn('gateway-tts', 'Response headers',
        `missing headers: provider=${provider || 'absent'}, stream=${streamId || 'absent'}`);
    }
  }
}

// ─── Check: Gateway → VoiceTrainer Integration ──────────────────────────────

async function checkGatewayVoiceTrainerIntegration() {
  sectionHeader('Gateway → VoiceTrainer Integration');

  // Session start
  const sessStart = await httpPost(`${GATEWAY}/voice/session/start`, {
    targetPreset: 'australian-bright-feminine',
    lessonId: 'doctor-diagnostic',
  });
  if (sessStart.ok && sessStart.body?.success !== false) {
    const sid = sessStart.body?.session?.id || sessStart.body?.voiceSessionId || '?';
    ok('gateway-trainer', 'Session start', `created session=${sid} (${sessStart.durationMs}ms)`);
  } else {
    fail('gateway-trainer', 'Session start',
      sessStart.body?.error || sessStart.error || `HTTP ${sessStart.status}`,
      'Check VoiceTrainer: curl http://127.0.0.1:8002/health');
  }

  // Readiness
  const readiness = await httpGet(`${GATEWAY}/voice/standalone/readiness`);
  if ((readiness.ok || readiness.status > 0) && readiness.body) {
    const probes = readiness.body.probes || [];
    const online = probes.filter(p => p.status === 'online').length;
    const total = probes.length;
    if (readiness.body.status === 'online') {
      ok('gateway-trainer', 'Standalone readiness',
        `${readiness.body.status}, ${online}/${total} probes online (${readiness.durationMs}ms)`);
    } else {
      const failedProbes = probes.filter(p => p.status !== 'online');
      const failedLabels = failedProbes.map(p => p.label).join(', ');
      warn('gateway-trainer', 'Standalone readiness',
        `${online}/${total} probes online — failed: ${failedLabels}`);
    }
  } else {
    fail('gateway-trainer', 'Standalone readiness',
      readiness.error || `HTTP ${readiness.status}`,
      'Check dependent services: GGUF model, VoiceTrainer, TTS');
  }
}

// ─── Check: Gateway → GGUF Integration ──────────────────────────────────────

async function checkGatewayGGUFIntegration() {
  sectionHeader('Gateway → GGUF Integration');

  // First need a session for coaching
  const sessions = await httpGet(`${GATEWAY}/voice/standalone/sessions?limit=1`);
  let sessionId = null;
  if (sessions.ok && sessions.body?.sessions?.length > 0) {
    sessionId = sessions.body.sessions[0].id;
  }

  if (!sessionId) {
    // Create one
    const created = await httpPost(`${GATEWAY}/voice/session/start`, {
      targetPreset: 'australian-bright-feminine',
      lessonId: 'doctor-gguf-check',
    });
    sessionId = created.body?.session?.id;
  }

  if (!sessionId) {
    warn('gateway-gguf', 'Coach runtime', 'skipped — no session available');
    warn('gateway-gguf', 'Coach stream', 'skipped — no session available');
    return;
  }

  // Coach runtime (non-streaming)
  const coach = await httpPost(`${GATEWAY}/voice/coach/runtime`, {
    sessionId,
    message: 'Readiness check: respond briefly.',
  }, { timeoutMs: 20000 });
  if (coach.ok && coach.body?.success !== false) {
    ok('gateway-gguf', 'Coach runtime',
      `reply received (${coach.durationMs}ms)`);
  } else {
    fail('gateway-gguf', 'Coach runtime',
      coach.body?.error || coach.error || `HTTP ${coach.status}`,
      'Ensure GGUF model is running: check port 8019');
  }

  // Coach stream (SSE)
  const streamT0 = Date.now();
  try {
    const resp = await fetch(`${GATEWAY}/voice/coach/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message: 'Stream check.' }),
      signal: AbortSignal.timeout(20000),
    });
    const elapsed = Date.now() - streamT0;
    if (resp.ok) {
      // Read a small chunk to confirm it works
      const reader = resp.body.getReader();
      const { value } = await reader.read();
      reader.cancel();
      if (value && value.length > 0) {
        ok('gateway-gguf', 'Coach stream', `SSE stream started (${elapsed}ms)`);
      } else {
        warn('gateway-gguf', 'Coach stream', 'stream opened but no data received');
      }
    } else {
      fail('gateway-gguf', 'Coach stream', `HTTP ${resp.status} (${elapsed}ms)`);
    }
  } catch (err) {
    fail('gateway-gguf', 'Coach stream', err.message);
  }
}

// ─── Check: Voice Cloning Pipeline ──────────────────────────────────────────

async function checkVoiceCloningPipeline() {
  sectionHeader('Voice Cloning Pipeline');

  // Check if any session has a reference clip
  const sessions = await httpGet(`${GATEWAY}/voice/standalone/sessions?limit=10`);
  let refClipId = null;
  let sessionWithRef = null;
  if (sessions.ok && sessions.body?.sessions) {
    for (const sess of sessions.body.sessions) {
      const clipId = sess.voiceState?.referenceClipId;
      if (clipId) {
        refClipId = clipId;
        sessionWithRef = sess;
        break;
      }
    }
  }

  if (refClipId) {
    ok('cloning', 'Reference loaded', `clipId=${refClipId}, sessionId=${sessionWithRef?.id || '?'}`);
  } else {
    warn('cloning', 'Reference loaded', 'no session with reference clip found — voice cloning not active');
  }

  // Try generating with a session that has a reference
  if (sessionWithRef?.id) {
    const gen = await httpPost(`${GATEWAY}/voice/speech/generate`, {
      targetText: 'Cloning test.',
      sessionId: sessionWithRef.id,
    }, { timeoutMs: 15000, raw: true });

    if (gen.ok && gen.headers) {
      const cloned = gen.headers.get('x-voice-cloned');
      if (cloned === 'true') {
        ok('cloning', 'Clone header present', 'X-Voice-Cloned: true');
      } else {
        warn('cloning', 'Clone header present', `X-Voice-Cloned header ${cloned === null ? 'absent' : '=' + cloned}`);
      }
    } else {
      warn('cloning', 'Clone header present', 'could not test — generate failed');
    }
  } else {
    warn('cloning', 'Clone header present', 'skipped — no session with reference');
  }

  // Check if reference audio is cached on TTS
  if (refClipId) {
    const refDir = '/tmp/voxcpm-refs';
    if (fs.existsSync(refDir)) {
      const files = fs.readdirSync(refDir).filter(f => f.includes(refClipId.slice(0, 8)));
      if (files.length > 0) {
        const fpath = path.join(refDir, files[0]);
        const stat = fs.statSync(fpath);
        ok('cloning', 'Reference cached', `${fpath} (${(stat.size / 1024).toFixed(1)}KB)`);
      } else {
        warn('cloning', 'Reference cached', `${refDir} exists but no file matching clipId prefix`);
      }
    } else {
      warn('cloning', 'Reference cached', `${refDir} does not exist — TTS may not have cached refs`);
    }
  } else {
    warn('cloning', 'Reference cached', 'skipped — no reference clip to verify');
  }
}

// ─── Check: Configuration Validation ────────────────────────────────────────

async function checkConfiguration() {
  sectionHeader('Configuration');

  // .env file
  if (fs.existsSync(ENV_PATH)) {
    const envVars = parseEnvFile(ENV_PATH);
    const count = Object.keys(envVars).length;
    ok('config', '.env file', `${count} vars loaded`);
  } else {
    fail('config', '.env file', 'not found',
      `Create ${ENV_PATH} from .env.example`);
  }

  // Required env vars
  const envVars = parseEnvFile(ENV_PATH);
  const missing = REQUIRED_ENV_VARS.filter(v => !envVars[v]);
  if (missing.length === 0) {
    ok('config', 'Required vars', 'all set');
  } else {
    fail('config', 'Required vars', `missing: ${missing.join(', ')}`,
      `Add missing vars to ${ENV_PATH}`);
  }

  // Port conflicts
  const ports = [3021, 8002, 8019, 8020];
  const portStatuses = [];
  for (const p of ports) {
    const inUse = await checkPort(p);
    portStatuses.push({ port: p, inUse });
  }
  // All ports being "in use" is expected — the services should be running on them
  // The real check is whether they respond to health checks (done above)
  ok('config', 'Port availability', 'checked — see service health above for port status');

  // GPU check
  try {
    const smi = execSync('nvidia-smi --query-gpu=name,memory.free,memory.total --format=csv,noheader,nounits 2>/dev/null', {
      timeout: 5000,
      encoding: 'utf8',
    }).trim();
    if (smi) {
      const gpus = smi.split('\n').map(line => {
        const [name, free, total] = line.split(',').map(s => s.trim());
        return { name, freeMB: Number(free), totalMB: Number(total) };
      });
      const gpu = gpus[0];
      if (gpu) {
        ok('config', 'GPU available',
          `${gpu.name}, ${(gpu.freeMB / 1024).toFixed(1)}GB free / ${(gpu.totalMB / 1024).toFixed(1)}GB total`);
      } else {
        warn('config', 'GPU available', 'nvidia-smi returned no GPUs');
      }
    } else {
      warn('config', 'GPU available', 'nvidia-smi returned empty');
    }
  } catch (err) {
    fail('config', 'GPU available', 'nvidia-smi not found or failed',
      'Install NVIDIA drivers and CUDA toolkit');
  }
}

// ─── Check: Cache & Storage ─────────────────────────────────────────────────

async function checkCacheStorage() {
  sectionHeader('Cache & Storage');

  // Resolve state root
  const envVars = parseEnvFile(ENV_PATH);
  const stateRoot = envVars.VOICE_STANDALONE_STATE_ROOT || STATE_ROOT_DEFAULT;

  // TTS cache dir
  const ttsCacheDir = path.join(ROOT, 'services', 'voxcpm-tts', 'runtime-cache');
  if (fs.existsSync(ttsCacheDir)) {
    try {
      const entries = fs.readdirSync(ttsCacheDir);
      let totalSize = 0;
      for (const e of entries) {
        try {
          const stat = fs.statSync(path.join(ttsCacheDir, e));
          if (stat.isFile()) totalSize += stat.size;
        } catch { /* ignore */ }
      }
      ok('storage', 'TTS cache dir',
        `${entries.length} entries, ${(totalSize / (1024 * 1024)).toFixed(1)}MB`);
    } catch (err) {
      warn('storage', 'TTS cache dir', `exists but unreadable: ${err.message}`);
    }
  } else {
    warn('storage', 'TTS cache dir', `not found at ${ttsCacheDir}`);
  }

  // Session store
  const sessionStorePath = path.join(stateRoot, 'sessions.json');
  if (fs.existsSync(sessionStorePath)) {
    try {
      const content = fs.readFileSync(sessionStorePath, 'utf8');
      const data = JSON.parse(content);
      const sessionCount = Array.isArray(data.sessions) ? data.sessions.length : '?';
      const writeBlocked = data.writeBlocked === true;
      const detail = `${sessionCount} sessions${writeBlocked ? ', WRITE BLOCKED' : ''}`;
      ok('storage', 'Session store', detail);
    } catch (err) {
      fail('storage', 'Session store', `invalid JSON: ${err.message}`,
        `Check ${sessionStorePath} for corruption`);
    }
  } else {
    warn('storage', 'Session store', `not found at ${sessionStorePath}`);
  }

  // Learner context dir
  const learnerDir = envVars.LEARNER_CONTEXT_STATE_PATH
    || path.join(stateRoot, 'learner-context');
  if (fs.existsSync(learnerDir)) {
    try {
      const entries = fs.readdirSync(learnerDir);
      ok('storage', 'Learner context', `${entries.length} entries in ${learnerDir}`);
    } catch {
      ok('storage', 'Learner context', `directory exists at ${learnerDir}`);
    }
  } else {
    warn('storage', 'Learner context', `not found at ${learnerDir}`);
  }
}

// ─── Check: Latency Benchmarks ──────────────────────────────────────────────

async function checkLatencyBenchmarks() {
  sectionHeader('Latency Benchmarks');

  // TTS cold synthesis (use a unique phrase unlikely to be cached)
  const coldText = `Diagnostic cold test ${Date.now()}.`;
  const cold = await httpPost(`${TTS}/generate`, { target_text: coldText }, {
    timeoutMs: 60000,
    raw: true,
  });
  if (cold.ok && cold.body && cold.body.length > 100) {
    // Estimate RTF: ~48000 sample rate, 16-bit mono = 2 bytes/sample
    // Approximate audio duration from byte count
    const audioDurationSec = cold.body.length / (48000 * 2);
    const synthDurationSec = cold.durationMs / 1000;
    const rtf = synthDurationSec / Math.max(audioDurationSec, 0.001);
    ok('latency', 'TTS cold synthesis',
      `${formatDuration(cold.durationMs)} (RTF ${rtf.toFixed(2)})`);
  } else {
    fail('latency', 'TTS cold synthesis', cold.error || `HTTP ${cold.status}`);
  }

  // TTS cached synthesis (use same text again)
  if (cold.ok) {
    const cached = await httpPost(`${TTS}/generate`, { target_text: coldText }, {
      timeoutMs: 15000,
      raw: true,
    });
    if (cached.ok && cached.body && cached.body.length > 100) {
      const speedup = cold.durationMs > 0 ? (cold.durationMs / cached.durationMs).toFixed(1) : '?';
      ok('latency', 'TTS cached synthesis',
        `${formatDuration(cached.durationMs)} (${speedup}x faster)`);
    } else {
      warn('latency', 'TTS cached synthesis', cached.error || 'cache may not have hit');
    }
  }

  // Gateway proxy latency (end-to-end)
  const proxyText = `Gateway proxy test ${Date.now()}.`;
  const proxy = await httpPost(`${GATEWAY}/voice/speech/generate`, {
    targetText: proxyText,
  }, { timeoutMs: 60000, raw: true });
  if (proxy.ok && proxy.body && proxy.body.length > 100) {
    ok('latency', 'Gateway proxy', `${formatDuration(proxy.durationMs)} end-to-end`);
  } else if (proxy.status === 501) {
    warn('latency', 'Gateway proxy', 'VoxCPM not enabled — cannot benchmark');
  } else {
    fail('latency', 'Gateway proxy', proxy.error || `HTTP ${proxy.status}`);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scripts/transvoice-doctor.js [options]

Options:
  --json     Output machine-readable JSON
  --quick    Skip latency benchmarks
  --fix      Show suggested fix commands for failures
  --help     Show this help

TransVoice Doctor — comprehensive system diagnostics.`);
    return;
  }

  const startTime = Date.now();

  if (!FLAG_JSON) {
    console.log(`${C.bold}${C.cyan}═══════════════════════════════════════${C.reset}`);
    console.log(`${C.bold}${C.cyan}  TransVoice Doctor — System Diagnostics${C.reset}`);
    console.log(`${C.bold}${C.cyan}═══════════════════════════════════════${C.reset}`);
  }

  await checkServiceHealth();
  await checkTTSDeep();
  await checkGatewayTTSIntegration();
  await checkGatewayVoiceTrainerIntegration();
  await checkGatewayGGUFIntegration();
  await checkVoiceCloningPipeline();
  await checkConfiguration();
  await checkCacheStorage();

  if (!FLAG_QUICK) {
    await checkLatencyBenchmarks();
  }

  const totalMs = Date.now() - startTime;
  const total = passed + failed + warnings;

  if (FLAG_JSON) {
    console.log(JSON.stringify({
      summary: { total, passed, failed, warnings, durationMs: totalMs },
      results,
    }, null, 2));
  } else {
    console.log(`\n${C.bold}${C.cyan}═══════════════════════════════════════${C.reset}`);
    const summaryColor = failed > 0 ? C.red : C.green;
    console.log(`${C.bold}  Summary: ${summaryColor}${passed}/${total} checks passed${C.reset}${failed > 0 ? `, ${C.red}${failed} failed${C.reset}` : ''}${warnings > 0 ? `, ${C.yellow}${warnings} warnings${C.reset}` : ''} (${formatDuration(totalMs)})`);
    console.log(`${C.bold}${C.cyan}═══════════════════════════════════════${C.reset}`);

    if (failed > 0) {
      console.log(`\n${C.red}${C.bold}Failed checks:${C.reset}`);
      let idx = 1;
      for (const r of results) {
        if (r.status === 'fail') {
          console.log(`  ${idx}. ${r.label} — ${C.red}${r.detail}${C.reset}`);
          if (r.fix || FLAG_FIX) {
            const fixCmd = r.fix || 'No fix suggested';
            console.log(`     ${C.yellow}→ ${fixCmd}${C.reset}`);
          }
          idx++;
        }
      }
    }

    if (warnings > 0 && !FLAG_FIX) {
      console.log(`\n${C.yellow}${C.bold}Warnings:${C.reset}`);
      for (const r of results) {
        if (r.status === 'warn') {
          console.log(`  ${C.yellow}! ${r.label} — ${r.detail}${C.reset}`);
        }
      }
    }
  }

  process.exitCode = failed > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`${C.red}Fatal error: ${err.message}${C.reset}`);
  if (FLAG_JSON) {
    console.log(JSON.stringify({ summary: { total: 0, passed: 0, failed: 1, warnings: 0 }, error: err.message }));
  }
  process.exitCode = 1;
});
