#!/usr/bin/env node
'use strict';

/**
 * Sync TransVoice backend source from sloane-ui into the standalone project.
 *
 * Usage:
 *   node scripts/sync-from-sloane-ui.mjs          # Copy updated files
 *   node scripts/sync-from-sloane-ui.mjs --check   # Check if sync is needed
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SLOANE_UI_ROOT = path.resolve(__dirname, '../../sloane-ui');
const TRANSVOICE_ROOT = path.resolve(__dirname, '..');

const BACKEND_SYNC_MAP = [
  // [source relative to sloane-ui/backend, target relative to transvoice-app/backend]
  ['voice-standalone-runtime.js', 'voice-standalone-runtime.js'],
  ['voice-standalone-config.js', 'voice-standalone-config.js'],
  ['voice-standalone-server.js', 'voice-standalone-server.js'],
  ['voice-runtime-entrypoints.js', 'voice-runtime-entrypoints.js'],
  ['voice-session-state.js', 'voice-session-state.js'],
  ['voice-cockpit-lines.js', 'voice-cockpit-lines.js'],
  ['voice-cue-sheet.js', 'voice-cue-sheet.js'],
  ['voice-drills.js', 'voice-drills.js'],
  ['voice-phrase-context.js', 'voice-phrase-context.js'],
  ['voice-student-evaluations.js', 'voice-student-evaluations.js'],
  ['voice-tutor-runtime-policy.js', 'voice-tutor-runtime-policy.js'],
  ['deeptutor-voice-adapter.js', 'deeptutor-voice-adapter.js'],
  ['notepad-state.js', 'notepad-state.js'],
  ['notepad-policy.js', 'notepad-policy.js'],
  ['learner-context-service.js', 'learner-context-service.js'],
  ['learner-context-route-handlers.js', 'learner-context-route-handlers.js'],
  ['route-access-control.js', 'route-access-control.js'],
  ['server-route-support.js', 'server-route-support.js'],
  ['entrypoint-runtime-root-support.js', 'entrypoint-runtime-root-support.js'],
  ['legacy-ragflow-runtime-guard.js', 'legacy-ragflow-runtime-guard.js'],
  ['api-error.js', 'api-error.js'],
  ['config.js', 'config.js'],
  ['coaching/index.js', 'coaching/index.js'],
  ['coaching/signal-schema.js', 'coaching/signal-schema.js'],
  ['coaching/signal-builder.js', 'coaching/signal-builder.js'],
  ['coaching/renderer-client.js', 'coaching/renderer-client.js'],
  ['coaching/safety-gates.js', 'coaching/safety-gates.js'],
  ['coaching/policy-gates.js', 'coaching/policy-gates.js'],
  ['coaching/sanitizer.js', 'coaching/sanitizer.js'],
  ['coaching/turn-telemetry.js', 'coaching/turn-telemetry.js'],
  ['coaching/turn-telemetry.test.js', 'coaching/turn-telemetry.test.js'],
  ['eval/coaching-eval.js', 'eval/coaching-eval.js'],
  ['lessons/lesson-planner.js', 'lessons/lesson-planner.js'],
];

const SHARED_SYNC_MAP = [
  ['shared/contracts/voice-backend-payload.cjs', 'shared/contracts/voice-backend-payload.cjs'],
  ['shared/contracts/common.cjs', 'shared/contracts/common.cjs'],
  ['shared/contracts/agent-notepad-policy.cjs', 'shared/contracts/agent-notepad-policy.cjs'],
];

const SCRIPTS_SYNC_MAP = [
  ['scripts/voice-standalone-doctor.mjs', 'scripts/voice-standalone-doctor.mjs'],
];

// --- Frontend sync -------------------------------------------------------
// The standalone Vite frontend lives in transvoice-app/frontend/. The voice
// runtime source is still authored in sloane-ui; pull updates the same way as
// the backend. Two parts:
//   1. FRONTEND_FILE_SYNC_MAP — explicit one-to-one shared files (the launcher
//      HTML, runtime-diagnostics module, host stylesheet, shared coach intents,
//      and the seven public assets). The direct app shell is intentionally NOT
//      synced: frontend/voice-tutor-app.html owns the standalone/mobile coach
//      overlay and would be destroyed by sloane-ui's generic shell.
//   2. FRONTEND_DIR_SYNC — recursively sync sloane-ui/src/voice/ into
//      frontend/src/voice/ (the ~90-module runtime + its tests/fixtures).
//
// [source relative to sloane-ui, target relative to transvoice-app]
const FRONTEND_FILE_SYNC_MAP = [
  ['voice-tutor.html', 'frontend/voice-tutor.html'],
  ['src/runtime-diagnostics.ts', 'frontend/src/runtime-diagnostics.ts'],
  ['src/styles.css', 'frontend/src/styles.css'],
  ['shared/voice/coach-intents.json', 'frontend/shared/voice/coach-intents.json'],
  ['public/voice-tutor-sw.js', 'frontend/public/voice-tutor-sw.js'],
  ['public/voice-tutor-offline.html', 'frontend/public/voice-tutor-offline.html'],
  ['public/voice-tutor.webmanifest', 'frontend/public/voice-tutor.webmanifest'],
  ['public/favicon.svg', 'frontend/public/favicon.svg'],
  ['public/favicon.ico', 'frontend/public/favicon.ico'],
  ['public/health', 'frontend/public/health'],
  ['public/worklets/pcm-stream-player.worklet.js', 'frontend/public/worklets/pcm-stream-player.worklet.js'],
];

// Directory sync: [source dir relative to sloane-ui, target dir relative to transvoice-app]
const FRONTEND_DIR_SYNC = [
  ['src/voice', 'frontend/src/voice'],
];

function sha256(filePath) {
  try {
    const content = fs.readFileSync(filePath);
    return crypto.createHash('sha256').update(content).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Files whose sloane-ui original assumes a DIFFERENT DIRECTORY DEPTH than the
 * standalone layout, plus the exact rewrites that re-root them on the way in.
 *
 * `voice-standalone-server.js` is the process entry point. In sloane-ui it sits
 * one level above `backend/` and beside `dist/`; here it lives INSIDE `backend/`.
 * Copied verbatim, both of its `__dirname`-relative paths are off by one and the
 * gateway cannot boot at all — `Cannot find module './backend/voice-standalone-
 * runtime'`. That is exactly what a blind copy did, and the broken file was
 * committed and shipped into the systemd unit.
 *
 * Rewrites are applied to the COPY and to the up-to-date comparison, so they are
 * idempotent: a synced file already carrying them reports `unchanged`.
 *
 * Each `from` must appear in the source, or the sync fails loudly rather than
 * silently reinstating the bug when upstream edits the line.
 */
const STANDALONE_SERVER_PATHS_FROM = [
  "const { createVoiceStandaloneApp } = require('./backend/voice-standalone-runtime');",
  '',
  "const DIST_DIR = path.resolve(__dirname, 'dist');",
].join('\n');

// The replacement carries its own explanation, so the synced file tells the next
// reader why it differs from upstream instead of looking like a stray edit.
const STANDALONE_SERVER_PATHS_TO = [
  '// BOTH PATHS BELOW ARE RELATIVE TO backend/, WHICH IS WHERE THIS FILE LIVES.',
  '// Re-rooted on sync — see SYNC_REWRITES in scripts/sync-from-sloane-ui.cjs.',
  '// Upstream this file sits one level higher, beside backend/ and dist/. Copied',
  '// verbatim, both paths are off by one and the gateway cannot boot at all.',
  "const { createVoiceStandaloneApp } = require('./voice-standalone-runtime');",
  '',
  "const DIST_DIR = path.resolve(__dirname, '..', 'dist');",
].join('\n');

/**
 * Files this repo has DELIBERATELY diverged on, where the divergence is too
 * large to express as a rewrite. A blind copy would silently revert real work,
 * so the sync REFUSES to touch them and says why.
 *
 * `voice-drills.js` is the live example: it grew `quietCueIndex` and
 * `listVoiceDrillPresetKeys`, and `backend/lessons/self-practice.js` now calls
 * the latter. Overwriting it with the upstream copy would break that require at
 * runtime while every check here still reported success.
 */
const DIVERGED = new Map([
  ['backend/voice-drills.js',
    'carries quietCueIndex + listVoiceDrillPresetKeys, which backend/lessons/self-practice.js requires; '
    + 'upstream lacks both. Port the upstream change by hand, or add the divergence to SYNC_REWRITES.'],
]);

const SYNC_REWRITES = new Map([
  ['backend/voice-standalone-server.js', [
    { from: STANDALONE_SERVER_PATHS_FROM, to: STANDALONE_SERVER_PATHS_TO },
    // The standalone build runs with persistent telemetry ON; upstream does not.
    // Preserved rather than silently reverted — a blind copy would turn it off
    // with no diff to notice, which is how the path bug above got shipped.
    {
      from: 'createVoiceStandaloneApp();',
      to: 'createVoiceStandaloneApp({ enablePersistentTelemetry: true });',
    },
  ]],
]);

/**
 * Read a source file as it should land in this repo.
 * @returns {Buffer} the file content, re-rooted when the target needs it
 */
/** Normalise a target path to the `/`-joined form the tables are keyed by. */
function toKey(targetRel) {
  return targetRel.split(path.sep).join('/');
}

function readForTarget(sourcePath, targetRel) {
  const raw = fs.readFileSync(sourcePath);
  const rewrites = SYNC_REWRITES.get(toKey(targetRel));
  if (!rewrites) return raw;

  let text = raw.toString('utf8');
  for (const { from, to } of rewrites) {
    if (!text.includes(from) && !text.includes(to)) {
      throw new Error(
        `sync rewrite for ${targetRel} no longer matches: expected to find ${JSON.stringify(from)}. `
        + 'Upstream changed the line — re-check the path depth by hand before syncing.',
      );
    }
    text = text.split(from).join(to);
  }
  return Buffer.from(text, 'utf8');
}

// Recursively list every file under `dir`, returning paths relative to `dir`.
function walkFiles(dir, baseDir = dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...walkFiles(abs, baseDir));
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, abs));
    }
  }
  return out;
}

function runSync(checkOnly = false) {
  const allMaps = [
    ...BACKEND_SYNC_MAP.map(([s, t]) => [path.join('backend', s), path.join('backend', t)]),
    ...SHARED_SYNC_MAP,
    ...SCRIPTS_SYNC_MAP.map(([s, t]) => [s, t]),
    ...FRONTEND_FILE_SYNC_MAP,
  ];

  const results = [];
  const drift = [];
  let needsSync = false;

  for (const [sourceRel, targetRel] of allMaps) {
    const sourcePath = path.join(SLOANE_UI_ROOT, sourceRel);
    const targetPath = path.join(TRANSVOICE_ROOT, targetRel);
    if (!fs.existsSync(sourcePath)) {
      results.push({ status: 'missing-source', source: sourceRel });
      continue;
    }
    // Compare against the content that would actually be WRITTEN, not the raw
    // source, so a re-rooted file (see SYNC_REWRITES) settles at `unchanged`
    // instead of looking permanently out of date.
    const incoming = readForTarget(sourcePath, targetRel);
    const divergence = DIVERGED.get(toKey(targetRel));
    if (divergence) {
      // Still HASH it. A static "skipped" line cannot tell a pending hand-port
      // from a no-op, so the skip was uninformative in exactly the case that
      // matters: upstream having moved on since the divergence.
      results.push({
        status: 'diverged',
        source: sourceRel,
        reason: divergence,
        upstreamMoved: crypto.createHash('sha256').update(incoming).digest('hex') !== sha256(targetPath),
      });
      continue;
    }
    const sourceHash = crypto.createHash('sha256').update(incoming).digest('hex');
    const targetHash = sha256(targetPath);

    if (sourceHash === targetHash) {
      results.push({ status: 'unchanged', source: sourceRel });
    } else {
      needsSync = true;
      if (checkOnly) {
        results.push({ status: 'out-of-date', source: sourceRel });
      } else {
        fs.mkdirSync(path.dirname(targetPath), { recursive: true });
        fs.writeFileSync(targetPath, incoming);
        results.push({ status: 'updated', source: sourceRel, target: targetRel });
      }
    }
  }

  // Directory sync: recursively sha-compare each file under the source dir
  // against the target dir; copy when different/missing. Report files that
  // exist on the transvoice side but not in sloane-ui as drift warnings
  // (never delete — the standalone build may legitimately add files).
  for (const [sourceDirRel, targetDirRel] of FRONTEND_DIR_SYNC) {
    const sourceDir = path.join(SLOANE_UI_ROOT, sourceDirRel);
    const targetDir = path.join(TRANSVOICE_ROOT, targetDirRel);

    const sourceFiles = walkFiles(sourceDir);
    for (const rel of sourceFiles) {
      const sourceRel = path.join(sourceDirRel, rel);
      const targetRel = path.join(targetDirRel, rel);
      const sourcePath = path.join(sourceDir, rel);
      const targetPath = path.join(targetDir, rel);
      // Same rewrite path as the explicit file maps — the guard is worthless if
      // a file can slip past it just by arriving through the directory walk.
      const incoming = readForTarget(sourcePath, targetRel);
      const divergence = DIVERGED.get(toKey(targetRel));
      if (divergence) {
        results.push({
          status: 'diverged',
          source: sourceRel,
          reason: divergence,
          upstreamMoved: crypto.createHash('sha256').update(incoming).digest('hex') !== sha256(targetPath),
        });
        continue;
      }
      const sourceHash = crypto.createHash('sha256').update(incoming).digest('hex');
      const targetHash = sha256(targetPath);

      if (sourceHash === targetHash) {
        results.push({ status: 'unchanged', source: sourceRel });
      } else {
        needsSync = true;
        if (checkOnly) {
          results.push({ status: 'out-of-date', source: sourceRel });
        } else {
          fs.mkdirSync(path.dirname(targetPath), { recursive: true });
          fs.writeFileSync(targetPath, incoming);
          results.push({ status: 'updated', source: sourceRel, target: targetRel });
        }
      }
    }

    // Drift: files on the transvoice side with no sloane-ui counterpart.
    const sourceSet = new Set(sourceFiles);
    for (const rel of walkFiles(targetDir)) {
      if (!sourceSet.has(rel)) {
        drift.push(path.join(targetDirRel, rel));
      }
    }
  }

  return { results, needsSync, drift };
}

function main() {
  const checkOnly = process.argv.includes('--check');

  if (!fs.existsSync(SLOANE_UI_ROOT)) {
    console.error(`[TransVoice Sync] Source not found: ${SLOANE_UI_ROOT}`);
    process.exit(1);
  }

  const { results, needsSync, drift } = runSync(checkOnly);

  const updated = results.filter((r) => r.status === 'updated' || r.status === 'out-of-date');
  const unchanged = results.filter((r) => r.status === 'unchanged');
  const missing = results.filter((r) => r.status === 'missing-source');
  const diverged = results.filter((r) => r.status === 'diverged');

  // Deliberate divergences are SKIPPED, never overwritten, and always announced
  // — a silent revert of real work is the failure mode this whole guard exists
  // for. They do not fail the exit code: skipping is the correct outcome, not an
  // error, and a red --check here would train people to ignore it.
  if (diverged.length) {
    console.warn(`[TransVoice Sync] ${diverged.length} file(s) SKIPPED — deliberately diverged from sloane-ui:`);
    for (const r of diverged) {
      // The hash decides which of these two lines you get. "Upstream has changed"
      // is the one that means there is real work waiting.
      console.warn(`  ! ${r.source} — ${r.upstreamMoved
        ? 'UPSTREAM HAS CHANGED since you diverged; a hand-port is pending'
        : 'upstream is unchanged; nothing to port'}`);
      console.warn(`      ${r.reason}`);
    }
  }

  // Drift warnings are informational only — they never delete files and never
  // change the exit code (a clean --check still exits 0).
  if (drift.length) {
    console.warn(`[TransVoice Sync] ${drift.length} frontend file(s) exist locally with no sloane-ui source (drift, not deleted):`);
    for (const f of drift) {
      console.warn(`  ~ ${f}`);
    }
  }

  if (checkOnly) {
    if (needsSync) {
      console.log(`[TransVoice Sync] ${updated.length} file(s) need sync:`);
      for (const r of updated) {
        console.log(`  - ${r.source}`);
      }
      process.exit(1);
    } else {
      console.log(`[TransVoice Sync] All ${unchanged.length} file(s) are up to date.`);
      process.exit(0);
    }
  } else {
    if (updated.length) {
      console.log(`[TransVoice Sync] ${updated.length} file(s) updated:`);
      for (const r of updated) {
        console.log(`  - ${r.source} -> ${r.target}`);
      }
    }
    if (unchanged.length) {
      console.log(`[TransVoice Sync] ${unchanged.length} file(s) unchanged.`);
    }
    if (missing.length) {
      console.warn(`[TransVoice Sync] ${missing.length} source file(s) missing:`);
      for (const r of missing) {
        console.warn(`  - ${r.source}`);
      }
    }
  }
}

main();
