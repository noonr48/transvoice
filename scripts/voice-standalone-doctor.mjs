#!/usr/bin/env node

import process from 'node:process';

function parseArgs(argv) {
  const options = {
    backendUrl: process.env.VOICE_STANDALONE_BACKEND_URL || 'http://127.0.0.1:3021',
    force: true,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--backend-url' || arg === '--backend') {
      options.backendUrl = argv[index + 1] || options.backendUrl;
      index += 1;
    } else if (arg === '--cached') {
      options.force = false;
    } else if (arg === '--force') {
      options.force = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    }
  }
  options.backendUrl = String(options.backendUrl || '').replace(/\/+$/u, '');
  return options;
}

function printHelp() {
  console.log(`Usage: pnpm run voice:doctor -- [--backend-url http://127.0.0.1:3021] [--force|--cached]

Checks the standalone Voice Tutor backend, session store, VoiceTrainer, websocket stream, and GGUF chat completion.`);
}

async function readJson(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { text };
  }
}

async function requestJson(backendUrl, path) {
  const startedAt = Date.now();
  try {
    const response = await fetch(`${backendUrl}${path}`, { cache: 'no-store' });
    const payload = await readJson(response);
    return {
      ok: response.ok,
      status: response.status,
      durationMs: Date.now() - startedAt,
      payload,
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      durationMs: Date.now() - startedAt,
      error: error instanceof Error ? error.message : String(error),
      payload: null,
    };
  }
}

function summarizeProbe(probe) {
  return {
    id: probe.id,
    label: probe.label,
    status: probe.status,
    detail: probe.detail,
    durationMs: probe.durationMs,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (!options.backendUrl) {
    throw new Error('Missing backend URL.');
  }

  const health = await requestJson(options.backendUrl, '/health');
  const sessions = await requestJson(options.backendUrl, '/voice/standalone/sessions?limit=1');
  const readinessPath = `/voice/standalone/readiness${options.force ? '?force=1' : ''}`;
  const readiness = await requestJson(options.backendUrl, readinessPath);
  const readinessProbes = Array.isArray(readiness.payload?.probes)
    ? readiness.payload.probes.map(summarizeProbe)
    : [];
  const success = health.ok
    && health.payload?.status === 'online'
    && sessions.ok
    && sessions.payload?.success !== false
    && readiness.ok
    && readiness.payload?.status === 'online'
    && readinessProbes.every((probe) => probe.status === 'online');

  console.log(JSON.stringify({
    success,
    backendUrl: options.backendUrl,
    forced: options.force,
    checks: {
      health: {
        ok: health.ok,
        status: health.status,
        durationMs: health.durationMs,
        serviceStatus: health.payload?.status || null,
        voiceTrainer: health.payload?.services?.voiceTrainer?.status || null,
        voiceTutorGguf: health.payload?.services?.voiceTutorGguf?.status || null,
        sessionStoreWriteBlocked: health.payload?.sessionStore?.writeBlocked ?? null,
        error: health.error || health.payload?.error || null,
      },
      sessions: {
        ok: sessions.ok,
        status: sessions.status,
        durationMs: sessions.durationMs,
        count: sessions.payload?.count ?? null,
        writeBlocked: sessions.payload?.sessionStore?.writeBlocked ?? null,
        error: sessions.error || sessions.payload?.error || null,
      },
      readiness: {
        ok: readiness.ok,
        status: readiness.status,
        durationMs: readiness.durationMs,
        serviceStatus: readiness.payload?.status || null,
        cached: readiness.payload?.cached === true,
        inFlightShared: readiness.payload?.inFlightShared === true,
        probes: readinessProbes,
        error: readiness.error || readiness.payload?.error || null,
      },
    },
  }, null, 2));

  if (!success) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
