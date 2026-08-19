#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const { getCoachHtml, getCoachJs, getPhoneticDict } = require('./backend/coach-page');
const debug = require('./backend/coach-debug');
const { createSensitiveRouteGuard } = require('./backend/route-access-control');

function loadEnvFile({ fsImpl = fs, pathImpl = path, env = process.env, targetPath } = {}) {
  const envPath = targetPath || pathImpl.resolve(__dirname, '.env');
  if (!fsImpl.existsSync(envPath)) return { loaded: false, assignedCount: 0 };
  let assignedCount = 0;
  const lines = fsImpl.readFileSync(envPath, 'utf8').replace(/\r\n?/g, '\n').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip inline comments (only if not inside quotes)
    if (!value.startsWith('"') && !value.startsWith("'")) {
      const commentIdx = value.indexOf(' #');
      if (commentIdx >= 0) value = value.slice(0, commentIdx).trim();
    }
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in env)) {
      env[key] = value;
      assignedCount += 1;
    }
  }
  return { loaded: true, assignedCount };
}

function createFatalHandler({ debugImpl, debugBus = null, stderr, exit, fatalClass }) {
  if (!debugImpl || typeof debugImpl.log !== 'function') throw new TypeError('debugImpl.log required');
  if (!stderr || typeof stderr.write !== 'function') throw new TypeError('stderr.write required');
  if (typeof exit !== 'function') throw new TypeError('exit required');
  let handled = false;
  const safeClass = fatalClass === 'unhandledRejection' ? 'unhandledRejection' : 'uncaughtException';
  return function fatalHandler() {
    if (handled) return;
    handled = true;
    try {
      try {
        debugBus?.push?.('error', 'process', 'fatal-process-event', {
          class: 'partial-function',
          fatalClass: safeClass,
        });
      } catch (_) {}
      try { debugImpl.log('error', 'fatal process event', { fatalClass: safeClass }); } catch (_) {}
      try { stderr.write('[FATAL] fatal process event\n'); } catch (_) {}
    } finally {
      exit(1);
    }
  };
}

function installFatalHandlers({ processImpl = process, debugImpl = debug, debugBus = null, stderr = process.stderr, exit = process.exit.bind(process) } = {}) {
  const handlers = {
    uncaughtException: createFatalHandler({ debugImpl, debugBus, stderr, exit, fatalClass: 'uncaughtException' }),
    unhandledRejection: createFatalHandler({ debugImpl, debugBus, stderr, exit, fatalClass: 'unhandledRejection' }),
  };
  processImpl.on('uncaughtException', handlers.uncaughtException);
  processImpl.on('unhandledRejection', handlers.unhandledRejection);
  return function uninstall() {
    processImpl.removeListener('uncaughtException', handlers.uncaughtException);
    processImpl.removeListener('unhandledRejection', handlers.unhandledRejection);
  };
}

const DIST_DIR = path.resolve(__dirname, 'dist');

function createUploadMiddleware() {
  const multer = require('multer');
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
      const ok = /^audio\//.test(file.mimetype);
      cb(ok ? null : new Error('only audio files accepted'), ok);
    },
  }).single('file');
}

// S2: stream upstream audio to client (lower latency, less memory)
function createVoxcpmReferenceResolver({ fetchImpl, env, debugImpl }) {
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');
  if (!env || typeof env !== 'object') throw new TypeError('env required');
  if (!debugImpl || typeof debugImpl.log !== 'function') throw new TypeError('debugImpl.log required');
  return async function resolveVoxcpmReference(clipId) {
    const started = Date.now();
    const log = (outcome, stage, hasReference) => debugImpl.log('tts', 'reference resolution', {
      outcome, stage, durationMs: Math.max(0, Math.min(Date.now() - started, 60000)), hasReference: Boolean(hasReference),
    });
    const safeId = String(clipId).replace(/[^A-Za-z0-9_-]/g, '');
    if (!safeId || safeId.length > 128) { log('rejected', 'validate', false); throw new Error('Invalid voice reference.'); }
    const trainerUrl = env.VOICE_TRAINER_URL || 'http://127.0.0.1:8002';
    const voxcpmUrl = env.VOXCPM_URL || 'http://127.0.0.1:8020';
    try {
      const refResp = await fetchImpl(`${trainerUrl}/api/v1/voice/reference/${safeId}/audio`, { signal: AbortSignal.timeout(15000) });
      if (!refResp.ok) { try { refResp.body && refResp.body.cancel(); } catch (_) {} log('rejected', 'download', false); throw new Error('Voice reference download failed.'); }
      const audioBuffer = await refResp.arrayBuffer();
      const uploadResp = await fetchImpl(`${voxcpmUrl}/v1/reference-audio`, {
        method: 'POST', headers: { 'Content-Type': 'audio/wav' }, body: audioBuffer, signal: AbortSignal.timeout(15000),
      });
      if (!uploadResp.ok) { try { uploadResp.body && uploadResp.body.cancel(); } catch (_) {} log('rejected', 'upload', false); throw new Error('Voice reference upload failed.'); }
      let result;
      try { result = await uploadResp.json(); } catch (_) { log('rejected', 'complete', false); throw new Error('Voice reference response invalid.'); }
      if (!result || typeof result.path !== 'string' || !result.path) { log('rejected', 'complete', false); throw new Error('Voice reference response invalid.'); }
      log('resolved', 'complete', true);
      return result.path;
    } catch (error) {
      if (/^Voice reference|^Invalid voice/.test(error && error.message || '')) throw error;
      log('rejected', 'complete', false);
      throw new Error('Voice reference unavailable.');
    }
  };
}

function safeTtsLog(debugImpl, category, message, data) {
  try { debugImpl.log(category, message, data); } catch (_) {}
}

function createTtsProxyHandler({ debugImpl, fetchImpl, env, resolveVoxcpmReferenceImpl }) {
  if (!debugImpl || typeof debugImpl.log !== 'function') throw new TypeError('debugImpl.log required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl required');
  if (!env || typeof env !== 'object') throw new TypeError('env required');
  if (typeof resolveVoxcpmReferenceImpl !== 'function') throw new TypeError('resolveVoxcpmReferenceImpl required');
  return async function handleTtsProxyCreated(req, res) {
  const text = typeof (req.body && req.body.text) === 'string' ? req.body.text.slice(0, 2000) : '';
  const refClipId = (req.body && req.body.referenceClipId) || null;
  var refResolved = true;
  if (!text) {
    safeTtsLog(debugImpl, 'tts', 'tts request rejected', { textLength: 0, hasReference: Boolean(refClipId) });
    res.status(400).json({ success: false, error: 'text required' }); return;
  }
  safeTtsLog(debugImpl, 'tts', 'tts request', { textLength: text.length, hasReference: Boolean(refClipId) });
  try {
    const voxcpmUrl = env.VOXCPM_URL || 'http://127.0.0.1:8020';
    const body = { text: text, speakingRate: 1.03 };
    if (refClipId) {
      try {
        body.reference_audio_path = await resolveVoxcpmReferenceImpl(refClipId);
        body.voice_profile_id = 'clone'; // use clone mode (no design description prepend)
      } catch(e) {
        safeTtsLog(debugImpl, 'tts', 'reference resolution rejected', { hasReference: true, referenceResolved: false });
        refResolved = false;
        // Continue without reference — falls back to default voice
      }
    }
    const t0 = Date.now();
    const upstream = await fetchImpl(`${voxcpmUrl}/v1/tts/wav`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30000),
    });
    const ms = Date.now() - t0;
    if (!upstream.ok) {
      safeTtsLog(debugImpl, 'tts', 'tts upstream rejected', { status: Number(upstream.status) || 0, durationMs: ms, hasReference: Boolean(refClipId), referenceResolved: refResolved });
      res.status(502).json({ success: false, error: `TTS returned ${upstream.status}` }); return;
    }
    const ct = upstream.headers.get('content-type') || '';
    const af = upstream.headers.get('x-audio-format') || '';
    const format = /^(wav|pcm|mp3|ogg)$/i.test(af) ? af.toLowerCase() : 'unknown';
    safeTtsLog(debugImpl, 'tts', 'tts upstream complete', { status: Number(upstream.status) || 0, durationMs: ms, format, hasReference: Boolean(refClipId), referenceResolved: refResolved });
    res.setHeader('Content-Type', ct || 'audio/wav');
    res.setHeader('Cache-Control', 'no-store');
    if (refClipId) res.setHeader('X-Reference-Resolved', refResolved ? 'true' : 'false');
    let totalBytes = 0;
    if (upstream.body) {
      const reader = upstream.body.getReader();
      req.on('close', () => { try { reader.cancel(); } catch {} });
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done || res.destroyed) break;
          totalBytes += value.length;
          res.write(value);
        }
      } catch (_) { safeTtsLog(debugImpl, 'tts', 'tts stream interrupted', { hasReference: Boolean(refClipId) }); }
      finally { try { reader.releaseLock(); } catch {} if (!res.writableEnded) res.end(); }
      safeTtsLog(debugImpl, 'tts', 'tts response complete', { bytes: totalBytes, format, hasReference: Boolean(refClipId) });
    } else {
      const buffer = await upstream.arrayBuffer();
      totalBytes = buffer.byteLength;
      res.send(Buffer.from(buffer));
      safeTtsLog(debugImpl, 'tts', 'tts response complete', { bytes: totalBytes, format, hasReference: Boolean(refClipId) });
    }
  } catch (err) {
    const isTimeout = err.name === 'TimeoutError';
    safeTtsLog(debugImpl, 'tts', 'tts request failed', { hasReference: Boolean(refClipId) });
    res.status(isTimeout ? 504 : 502).json({ success: false, error: isTimeout ? 'TTS timeout' : 'TTS service unavailable' });
  }
  };
}

function handleTtsProxy(req, res) {
  const env = process.env;
  const fetchImpl = global.fetch;
  const resolver = createVoxcpmReferenceResolver({ fetchImpl, env, debugImpl: debug });
  return createTtsProxyHandler({ debugImpl: debug, fetchImpl, env, resolveVoxcpmReferenceImpl: resolver })(req, res);
}

const MAX_AUDIO_SECONDS = 30;

// ── Audio Quality Pipeline ──
// Cleans reference audio uploads using broadcast-grade ffmpeg filters:
//   1. highpass=f=85  — removes low-frequency rumble (HVAC, traffic, mic handling) below voice range
//   2. afftdn=nr=12   — adaptive FFT noise reduction (moderate, broadcast range 10-20, no voice artifacts)
//   3. loudnorm       — EBU R128 loudness normalization to -16 LUFS (podcast/broadcast standard)
// Conservative settings: female voice F0 starts ~165Hz (highpass=85 is safe), nr=12 is gentle,
// loudnorm single-pass normalizes without dynamic compression. Non-destructive: if ffmpeg fails,
// the original audio is used unchanged.
function cleanReferenceAudio(audioBuffer) {
  return new Promise(function(resolve) {
    var report = { applied: false, noiseReduction: false, loudnessNormalized: false, highpass: false, skipped: false };
    var tmpIn = path.join(require('os').tmpdir(), 'coach-clean-' + Date.now() + '-in');
    var tmpOut = tmpIn + '-out.wav';
    try {
      fs.writeFileSync(tmpIn, audioBuffer);
      // Combined filter chain: highpass → afftdn → loudnorm
      // Order matters: remove rumble first, then reduce noise on cleaner signal, then normalize loudness
      var filterChain = 'highpass=f=85,afftdn=nr=12:nf=-25,loudnorm=I=-16:TP=-1.5:LRA=11';
      var trimPart = ''; // trim is handled separately below if needed
      var cmd = 'ffmpeg -y -i "' + tmpIn + '" -af "' + filterChain + '" -ar 48000 -ac 1 "' + tmpOut + '"';
      require('child_process').execSync(cmd, { timeout: 20000, stdio: 'pipe' });
      var cleanedBuffer = fs.readFileSync(tmpOut);
      // Guard: cleaned output should exist and be non-trivial
      if (cleanedBuffer.length < 1000) {
        debug.log('reference', 'cleaning produced tiny output (' + cleanedBuffer.length + ' bytes) — skipping');
        report.skipped = true;
        report.skipReason = 'cleaning produced invalid output';
        resolve({ buffer: null, report: report });
        return;
      }
      report.applied = true;
      report.noiseReduction = true;
      report.loudnessNormalized = true;
      report.highpass = true;
      report.inputBytes = audioBuffer.length;
      report.outputBytes = cleanedBuffer.length;
      debug.log('reference', 'audio cleaned: ' + audioBuffer.length + ' → ' + cleanedBuffer.length + ' bytes (highpass+afftdn+loudnorm)');
      resolve({ buffer: cleanedBuffer, report: report });
    } catch(e) {
      debug.log('reference', 'cleaning failed: ' + e.message + ' (using original audio)');
      report.skipped = true;
      report.skipReason = e.message.slice(0, 120);
      resolve({ buffer: null, report: report });
    } finally {
      try { fs.unlinkSync(tmpIn); } catch(e){}
      try { fs.unlinkSync(tmpOut); } catch(e){}
    }
  });
}

async function handleReferenceProxy(req, res) {
  if (!req.file) { res.status(400).json({ success: false, error: 'audio file required' }); return; }
  if (req.file.size < 1000) { res.status(400).json({ success: false, error: 'audio file too small (min 1KB)' }); return; }
  debug.log('reference', 'upload received: ' + req.file.originalname + ', ' + req.file.size + ' bytes, ' + req.file.mimetype);
  try {
    let audioBuffer = req.file.buffer;
    let trimmed = false;
    let originalDuration = 0;
    let cleaningReport = null;

    // Step 1: Probe duration
    const tmpProbe = path.join(require('os').tmpdir(), 'coach-probe-' + Date.now());
    try {
      fs.writeFileSync(tmpProbe, audioBuffer);
      const probe = require('child_process').execSync(
        'ffprobe -v quiet -show_entries format=duration -of csv=p=0 "' + tmpProbe + '"',
        { timeout: 5000, encoding: 'utf8' }
      ).trim();
      originalDuration = parseFloat(probe);
      debug.log('reference', 'uploaded audio: ' + originalDuration.toFixed(1) + 's, ' + (audioBuffer.length / 1024).toFixed(0) + 'KB');
    } catch(e) {
      debug.log('reference', 'probe failed, assuming duration OK: ' + e.message);
    } finally {
      try { fs.unlinkSync(tmpProbe); } catch(e){}
    }

    // Step 2: Clean audio (noise reduction + volume normalization)
    const cleanResult = await cleanReferenceAudio(audioBuffer);
    cleaningReport = cleanResult.report;
    if (cleanResult.buffer) {
      audioBuffer = cleanResult.buffer;
    }

    // Step 3: Trim if still too long
    if (originalDuration > MAX_AUDIO_SECONDS) {
      debug.log('reference', 'trimming from ' + originalDuration.toFixed(1) + 's to ' + MAX_AUDIO_SECONDS + 's');
      const tmpIn = path.join(require('os').tmpdir(), 'coach-trim-' + Date.now() + '-in');
      const tmpOut = tmpIn + '-out.wav';
      try {
        fs.writeFileSync(tmpIn, audioBuffer);
        require('child_process').execSync(
          'ffmpeg -y -i "' + tmpIn + '" -t ' + MAX_AUDIO_SECONDS + ' -ar 48000 -ac 1 "' + tmpOut + '"',
          { timeout: 15000, stdio: 'pipe' }
        );
        audioBuffer = fs.readFileSync(tmpOut);
        trimmed = true;
      } catch(e) {
        debug.log('error', 'ffmpeg trim failed: ' + e.message + ' (using untrimmed)');
      } finally {
        try { fs.unlinkSync(tmpIn); } catch(e){}
        try { fs.unlinkSync(tmpOut); } catch(e){}
      }
    }

    const trainerUrl = process.env.VOICE_TRAINER_URL || 'http://127.0.0.1:8002';
    const form = new FormData();
    form.append('file', new Blob([audioBuffer], { type: 'audio/wav' }), req.file.originalname);
    if (req.body && req.body.targetPreset) form.append('targetPreset', req.body.targetPreset);
    const upstream = await fetch(`${trainerUrl}/api/v1/voice/reference/analyze`, {
      method: 'POST', body: form, signal: AbortSignal.timeout(30000),
    });
    if (!upstream.ok) {
      debug.log('error', 'VoiceTrainer reference/analyze returned ' + upstream.status);
      res.status(502).json({ success: false, error: `VoiceTrainer returned ${upstream.status}` });
      return;
    }
    const data = await upstream.json();
    debug.log('reference', 'analyzed: verdict=' + (data.quality||{}).verdict + ' cloneable=' + (data.quality||{}).cloneable + ' clipId=' + data.clipId);

    // Attach processing metadata to response
    if (cleaningReport && cleaningReport.applied) {
      data.cleaned = true;
      data.cleaningReport = cleaningReport;
    }
    if (trimmed) {
      data.trimmed = true;
      data.originalDurationSec = originalDuration;
      data.trimmedToSec = MAX_AUDIO_SECONDS;
      data.trimWarning = 'Audio was ' + originalDuration.toFixed(1) + 's — automatically trimmed to ' + MAX_AUDIO_SECONDS + 's.';
    }
    debug.log('reference', 'final result: verdict=' + (data.quality||{}).verdict + ' cleaned=' + !!data.cleaned + ' trimmed=' + !!data.trimmed);
    res.json(data);
  } catch (err) {
    debug.log('error', 'reference proxy failed: ' + err.message);
    res.status(502).json({ success: false, error: 'Reference analysis unavailable' });
  }
}

function isLegacyDebugRoutesEnabled(env) {
  return /^(1|true|yes|on)$/i.test(String(env && env.TRANSVOICE_DEBUG_ROUTES_ENABLED || '').trim());
}

function sendCoachAssetUnavailable(res) {
  res.status(503);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  return res.send('Required coach asset is unavailable.');
}

function registerCoachRoutes(app, options = {}) {
  const debugImpl = options.debugImpl || debug;
  const fetchImpl = options.fetchImpl || global.fetch;
  const env = options.env || process.env;
  const assetGetters = options.assetGetters || { getCoachHtml, getCoachJs, getPhoneticDict };
  const uploadMiddleware = options.uploadMiddleware || createUploadMiddleware();
  const referenceHandler = options.referenceHandler || handleReferenceProxy;
  const resolveVoxcpmReferenceImpl = options.resolveVoxcpmReferenceImpl
    || createVoxcpmReferenceResolver({ fetchImpl, env, debugImpl });
  const ttsHandler = options.ttsHandler
    || createTtsProxyHandler({ debugImpl, fetchImpl, env, resolveVoxcpmReferenceImpl });
  const sensitiveRouteGuard = options.sensitiveRouteGuard || createSensitiveRouteGuard({
    adminToken: options.adminToken === undefined ? env.SLOANE_ADMIN_TOKEN : options.adminToken,
    routeLabel: 'TransVoice debug route',
  });
  const unavailable = (error) => Boolean(error && error.code === 'COACH_ASSET_UNAVAILABLE');
  const assetRoute = (getter, type, coachNoCache = false) => function coachAssetRoute(_req, res, next) {
    try {
      res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
      if (coachNoCache) {
        res.set('Pragma', 'no-cache');
        res.set('Expires', '0');
      }
      if (type) res.type(type);
      res.send(getter());
    } catch (error) {
      if (unavailable(error)) return sendCoachAssetUnavailable(res);
      if (typeof next === 'function') return next(error);
      throw error;
    }
  };
  // ── /static/coach-app.js — voice tutor client JS ──
  app.get('/static/coach-app.js', assetRoute(assetGetters.getCoachJs, 'application/javascript'));

  // ── /static/phonetic-dict.js — pronunciation spelling dictionary ──
  app.get('/static/phonetic-dict.js', assetRoute(assetGetters.getPhoneticDict, 'application/javascript'));

  app.post('/voice/tts', ttsHandler);
  app.post('/voice/upload-reference', uploadMiddleware, referenceHandler);

  const fsImpl = options.fsImpl || fs;
  const pathImpl = options.pathImpl || path;
  const distDir = options.distDir || DIST_DIR;
  function serveAppHtml(_req, res, file) {
    fsImpl.readFile(pathImpl.join(distDir, file), 'utf8', (err, html) => {
      if (err) { res.status(500).send('frontend not built'); return; }
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    });
  }
  app.get('/voice-tutor-app.html', (req, res) => serveAppHtml(req, res, 'voice-tutor-app.html'));
  app.get('/app', (req, res) => serveAppHtml(req, res, 'voice-tutor-app.html'));

  // /coach is retired as a destination: the tutor app owns the coaching surface
  // at /app?mode=coach, so this route 302-redirects there and old links or
  // bookmarks keep working. Original query params are carried across. The prior
  // standalone coach page itself stays reachable at /coach-legacy so nothing is
  // lost.
  app.get('/coach', (req, res) => {
    const params = new URLSearchParams();
    params.set('mode', 'coach');
    for (const [key, value] of Object.entries((req && req.query) || {})) {
      if (key !== 'mode' && typeof value === 'string' && value) params.set(key, value);
    }
    res.redirect(302, `/app?${params.toString()}`);
  });
  app.get('/coach-legacy', assetRoute(assetGetters.getCoachHtml, 'text/html', true));

  // ── Debug endpoints ──────────────────────────────────────
  if (isLegacyDebugRoutesEnabled(env)) {
  app.get('/debug/pipeline', sensitiveRouteGuard, (_req, res) => {
    const since = _req.query.since ? parseInt(_req.query.since, 10) : 0;
    res.json({ events: debugImpl.getEvents(since), summary: debugImpl.getSummary() });
  });
  app.get('/debug/summary', sensitiveRouteGuard, (_req, res) => res.json(debugImpl.getSummary()));
  app.post('/debug/clear', sensitiveRouteGuard, (_req, res) => { debugImpl.clearEvents(); res.json({ ok: true }); });
  app.post('/debug/log', sensitiveRouteGuard, (req, res) => {
    const { cat, msg, data } = req.body || {};
    if(cat && msg) debugImpl.log('client', 'client diagnostic', { categoryPresent: true, dataPresent: data !== undefined });
    res.json({ ok: true });
  });
  app.get('/debug/log/tail', sensitiveRouteGuard, (req, res) => {
    const n = Math.min(Math.max(parseInt(req.query.lines || req.query.n || '100', 10) || 100, 1), 500);
    res.type('text/plain').send(debugImpl.tailLines(n).join('\n'));
  });
  app.get('/debug/log/grep', sensitiveRouteGuard, (req, res) => {
    const pattern = String(req.query.q || '').slice(0, 200);
    if(!pattern) { res.status(400).type('text/plain').send('Usage: /debug/log/grep?q=error'); return; }
    const max = Math.min(Math.max(parseInt(req.query.max || '50', 10) || 50, 1), 200);
    res.type('text/plain').send(debugImpl.grepLines(pattern, max).join('\n'));
  });
  }

  // Standalone runtime owns these two routes in production. Keep the legacy
  // proxy registrations available for isolated registrar consumers only.
  if (options.includePresetProxyRoutes !== false) {
  app.get('/voice/presets', async (_req, res) => {
    try {
      const trainerUrl = env.VOICE_TRAINER_URL || 'http://127.0.0.1:8002';
      const upstream = await fetchImpl(`${trainerUrl}/api/v1/voice/presets`, { signal: AbortSignal.timeout(10000) });
      if (!upstream.ok) {
        safeTtsLog(debugImpl, 'session', 'preset list rejected', { status: Number(upstream.status) || 0 });
        res.status(502).json({ success: false, error: 'VoiceTrainer ' + upstream.status });
        return;
      }
      const data = await upstream.json();
      safeTtsLog(debugImpl, 'session', 'preset list complete', { status: Number(upstream.status) || 200 });
      res.json(data);
    } catch (_) {
      safeTtsLog(debugImpl, 'session', 'preset list failed', {});
      res.status(502).json({ success: false, error: 'Could not load presets' });
    }
  });
  app.post('/voice/presets/reference/save', async (req, res) => {
    try {
      const trainerUrl = env.VOICE_TRAINER_URL || 'http://127.0.0.1:8002';
      const upstream = await fetchImpl(`${trainerUrl}/api/v1/voice/presets/reference/save`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req.body), signal: AbortSignal.timeout(10000),
      });
      if (!upstream.ok) {
        const errBody = await upstream.text();
        safeTtsLog(debugImpl, 'session', 'preset save rejected', { status: Number(upstream.status) || 0 });
        res.status(upstream.status).json({ success: false, error: errBody.slice(0, 200) });
        return;
      }
      const data = await upstream.json();
      safeTtsLog(debugImpl, 'session', 'preset save complete', { status: Number(upstream.status) || 200 });
      res.json(data);
    } catch (_) {
      safeTtsLog(debugImpl, 'session', 'preset save failed', {});
      res.status(502).json({ success: false, error: 'Could not save preset' });
    }
  });
  }

  // ── Preset test: generate a sample TTS clip to verify clone quality ──
  // Takes a referenceClipId, generates a short test phrase, returns the audio.
  // This lets the user verify "does this voice actually sound right?" before committing.
  app.post('/voice/presets/test', async (req, res) => {
    var clipId = (req.body && req.body.referenceClipId) || null;
    if (!clipId) {
      res.status(400).json({ success: false, error: 'referenceClipId required' });
      return;
    }
    // Standard test phrases designed to exercise pitch range, resonance, and prosody
    var testPhrases = [
      "Hey, good morning! I'm so glad you're here. Let's practice together.",
      "The quick brown fox jumps over the lazy dog. Can you match my voice?",
      "Welcome back. Today we're going to work on resonance and pitch. Ready?"
    ];
    var phraseIdx = (typeof req.body.phraseIndex === 'number' && req.body.phraseIndex >= 0 && req.body.phraseIndex < testPhrases.length) ? req.body.phraseIndex : 0;
    var testText = (req.body.text || testPhrases[phraseIdx]).slice(0, 500); // cap at 500 chars to prevent expensive arbitrary-length TTS
    safeTtsLog(debugImpl, 'tts', 'preset test request', { textLength: testText.length, hasReference: true });
    try {
      var voxcpmUrl = env.VOXCPM_URL || 'http://127.0.0.1:8020';
      var refResolved = true;
      var body = { text: testText, speakingRate: 1.03 };
      try {
        body.reference_audio_path = await resolveVoxcpmReferenceImpl(clipId);
        body.voice_profile_id = 'clone';
      } catch(e) {
        safeTtsLog(debugImpl, 'tts', 'preset test reference rejected', { hasReference: true, referenceResolved: false });
        refResolved = false;
        res.status(502).json({ success: false, error: 'Could not load voice reference.' });
        return;
      }
      var t0 = Date.now();
      var upstream = await fetchImpl(voxcpmUrl + '/v1/tts/wav', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      });
      var ms = Date.now() - t0;
      if (!upstream.ok) {
        safeTtsLog(debugImpl, 'tts', 'preset test upstream rejected', { status: Number(upstream.status) || 0, durationMs: ms, hasReference: true });
        res.status(502).json({ success: false, error: 'TTS generation failed (' + upstream.status + ')' });
        return;
      }
      var ct = upstream.headers.get('content-type') || 'audio/wav';
      res.setHeader('Content-Type', ct);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('X-Test-Phrase-Index', String(phraseIdx));
      var buffer = await upstream.arrayBuffer();
      res.send(Buffer.from(buffer));
      safeTtsLog(debugImpl, 'tts', 'preset test complete', { bytes: buffer.byteLength, status: Number(upstream.status) || 0, durationMs: ms, hasReference: true, referenceResolved: refResolved });
    } catch (err) {
      var isTimeout = err.name === 'TimeoutError';
      safeTtsLog(debugImpl, 'tts', 'preset test failed', { hasReference: true });
      res.status(isTimeout ? 504 : 502).json({ success: false, error: isTimeout ? 'TTS timeout' : 'TTS service unavailable' });
    }
  });

  // Multer error handler — scoped to the upload route path
  app.use('/voice/upload-reference', function(err, _req, res, _next) {
    debug.log('error', 'multer/upload error: ' + (err.code || err.message || 'unknown'));
    if (err && (err.code || '').startsWith('LIMIT_')) {
      return res.status(400).json({ success: false, error: err.message });
    }
    if (err && err.message === 'only audio files accepted') {
      return res.status(400).json({ success: false, error: err.message });
    }
    res.status(500).json({ success: false, error: 'upload error' });
  });

  // Global Express error handler — catches any unhandled error in ANY route
  app.use(function(err, req, res, _next) {
    debug.log('error', 'unhandled: ' + (err.message || err) + ' ' + req.method + ' ' + req.url, { stack: err.stack ? err.stack.split('\n').slice(0,3).join(' | ') : undefined });
    if(res.headersSent) return;
    res.status(500).json({ success: false, error: 'internal server error' });
  });
}

function main(options = {}) {
  const env = options.env || process.env;
  const fsImpl = options.fsImpl || fs;
  const pathImpl = options.pathImpl || path;
  const loadEnvFileImpl = options.loadEnvFileImpl || loadEnvFile;
  loadEnvFileImpl({ fsImpl, pathImpl, env, targetPath: options.targetPath });
  const runtimeModule = options.runtimeModuleLoader
    ? options.runtimeModuleLoader()
    : require('./backend/voice-standalone-runtime');
  const configModule = options.configModuleLoader
    ? options.configModuleLoader()
    : require('./backend/config');
  const createVoiceStandaloneAppImpl = options.createVoiceStandaloneAppImpl || runtimeModule.createVoiceStandaloneApp;
  const standalone = createVoiceStandaloneAppImpl({
    enablePersistentTelemetry: true,
    ...(options.standaloneOptions || {}),
  });
  const { app, runtime } = standalone;
  const installFatalHandlersImpl = options.installFatalHandlersImpl || installFatalHandlers;
  installFatalHandlersImpl({
    processImpl: options.processImpl || process,
    debugImpl: options.debugImpl || debug,
    debugBus: standalone.debugBus || null,
    stderr: options.stderr || process.stderr,
    exit: options.exit || process.exit.bind(process),
  });
  // Runtime entrypoints are already registered by createVoiceStandaloneApp.
  // Add only coach-owned routes here; runtime remains the sole preset-list/save owner.
  const registerCoachRoutesImpl = options.registerCoachRoutesImpl || registerCoachRoutes;
  const adminToken = configModule && configModule.config ? configModule.config.ADMIN_TOKEN : undefined;
  registerCoachRoutesImpl(app, {
    env,
    fsImpl,
    pathImpl,
    distDir: options.distDir || DIST_DIR,
    debugImpl: options.debugImpl || debug,
    fetchImpl: options.fetchImpl || global.fetch,
    adminToken,
    sensitiveRouteGuard: options.sensitiveRouteGuard,
    uploadMiddleware: options.uploadMiddleware,
    referenceHandler: options.referenceHandler,
    includePresetProxyRoutes: false,
  });

  // Serve the built frontend from dist/
  const staticMiddleware = (options.expressStaticImpl || express.static)(options.distDir || DIST_DIR, {
    index: false, // Don't auto-serve index.html for '/'
    maxAge: '1h',
    setHeaders(res, filePath) {
      // HTML files should not be cached aggressively
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  });
  app.use(staticMiddleware);

  // SPA-style fallback: /app is handled above by the voice-only Coach shell.

  // ── favicon — quiet 204 to prevent 404 log spam ──
  app.get('/favicon.ico', (_req, res) => res.status(204).end());

  // Root serves the launcher
  app.get('/', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'voice-tutor.html'));
  });

  // Serve the Electron AppImage from electron/release/ — a dedicated route so it survives
  // vite build (which wipes dist/). The AppImage is built by `cd electron && npm run dist`.
  const ELECTRON_RELEASE = path.resolve(__dirname, 'electron', 'release');
  app.get('/VoiceTutor-1.0.0.AppImage', (_req, res) => {
    const appImagePath = path.join(ELECTRON_RELEASE, 'Voice Tutor-1.0.0.AppImage');
    res.sendFile(appImagePath);
  });

  const server = standalone.start({
    logger: console,
  });

  console.log(`[TransVoice] Frontend: http://${runtime.config.host}:${runtime.config.port}/`);
  console.log(`[TransVoice] App:      http://${runtime.config.host}:${runtime.config.port}/voice-tutor-app.html`);
  console.log(`[TransVoice] Health:   http://${runtime.config.host}:${runtime.config.port}/health`);

  return server;
}

if (require.main === module) {
  main();
}

module.exports = {
  loadEnvFile,
  createFatalHandler,
  installFatalHandlers,
  registerCoachRoutes,
  sendCoachAssetUnavailable,
  createVoxcpmReferenceResolver,
  createTtsProxyHandler,
  handleTtsProxy,
  isLegacyDebugRoutesEnabled,
  main,
};
