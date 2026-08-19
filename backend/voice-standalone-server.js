#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');

// Load .env file if it exists (no dotenv dependency needed)
const envPath = path.resolve(__dirname, '.env');
if (fs.existsSync(envPath)) {
  const lines = fs.readFileSync(envPath, 'utf8').replace(/\r\n?/g, '\n').split('\n');
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
    if (!(key in process.env)) {
      process.env[key] = value;
    }
  }
}

// BOTH PATHS BELOW ARE RELATIVE TO backend/, WHICH IS WHERE THIS FILE LIVES.
// Re-rooted on sync — see SYNC_REWRITES in scripts/sync-from-sloane-ui.cjs.
// Upstream this file sits one level higher, beside backend/ and dist/. Copied
// verbatim, both paths are off by one and the gateway cannot boot at all.
const { createVoiceStandaloneApp } = require('./voice-standalone-runtime');

const DIST_DIR = path.resolve(__dirname, '..', 'dist');

function main() {
  const standalone = createVoiceStandaloneApp({ enablePersistentTelemetry: true });
  const { app, runtime } = standalone;

  // Serve the built frontend from dist/
  app.use(express.static(DIST_DIR, {
    index: false, // Don't auto-serve index.html for '/'
    maxAge: '1h',
    setHeaders(res, filePath) {
      // HTML files should not be cached aggressively
      if (filePath.endsWith('.html')) {
        res.setHeader('Cache-Control', 'no-cache');
      }
    },
  }));

  // SPA-style fallback: serve voice-tutor-app.html for the app route
  app.get('/app', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'voice-tutor-app.html'));
  });

  // Root serves the launcher
  app.get('/', (_req, res) => {
    res.sendFile(path.join(DIST_DIR, 'voice-tutor.html'));
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

module.exports = { main };
