#!/usr/bin/env node
//
// Witness: does the word-emphasis channel actually change the tutor's speech?
//
// The channel's whole premise is that VoxCPM has no prosody API, so the ONLY
// emphasis signal that survives its text normalizer is punctuation — the
// gateway shapes the stressed word into its own short comma-delimited clause.
// That premise is a CLAIM about the acoustic model, not about our code, so it
// has to be measured on real audio.
//
// Four renditions of one fixed line:
//   A   plain text, live gateway :3021                (control)
//   B   same text + emphasisWord, live gateway :3021  (the deployed wire contract)
//   B2  the shaped text sent directly as targetText   (the mechanism control)
//   B3  emphasisWord through a FRESH in-process gateway built from THIS working
//       tree, pointed at the real VoxCPM                (end-to-end proof)
//
// B shows whether the DEPLOYED service shapes; B3 shows whether THIS CODE does,
// without restarting the live unit. B2 isolates the acoustic mechanism from the
// wiring: if B2 shows no boundary change either, comma-clause shaping is dead
// for this engine and the fallback (two-segment synthesis) is the only remaining
// route — this script reports that measurement, it does not build the fallback.
//
// Usage:  node studio/code/verify-tts-emphasis.mjs
// Env:    TRANSVOICE_URL (default http://127.0.0.1:3021)
//         EMPHASIS_AB_DIR (default the scratchpad emphasis-ab directory)

import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// The gateway and this witness must agree on what "shaped" means, so the
// shaping comes from the SAME module the gateway calls — not a re-implementation.
const { shapeEmphasisClause } = require('../../backend/voice-emphasis-shaping.js');

const baseUrl = (process.env.TRANSVOICE_URL || 'http://127.0.0.1:3021').replace(/\/+$/u, '');
const outDir = process.env.EMPHASIS_AB_DIR
  || '/tmp/claude-1000/-home-USER/f67e0f80-8861-4981-91e4-beb429e995b4/scratchpad/emphasis-ab';

// One fixed line. The target word sits mid-sentence so shaping needs commas on
// BOTH sides — the largest boundary change the mechanism can produce.
const LINE = 'I think we can get this done today without any trouble.';
const EMPHASIS_WORD = 'today';
// I(0) think(1) we(2) can(3) get(4) this(5) done(6) today(7) without(8) any(9) trouble(10)
const EMPHASIS_TOKEN_INDEX = 7;
// "today" appears once in this line, so it is occurrence 0. The occurrence — not
// the token index — is what the gateway resolves against, because a caller that
// speaks more than the bare phrase (the eyes-free "New line: …" announcement)
// would otherwise stress a word in its own prefix.
const EMPHASIS_OCCURRENCE = 0;
const SPEAKING_RATE = 0.76;

const shaped = shapeEmphasisClause({ text: LINE, emphasisWord: EMPHASIS_WORD });

async function synthesize(label, body) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/voice/speech/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetText: LINE, speakingRate: SPEAKING_RATE, ...body }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`[${label}] gateway returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
  }
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length === 0) throw new Error(`[${label}] gateway returned an empty audio body.`);

  const wavPath = path.join(outDir, `${label}.wav`);
  if (contentType.includes('wav') || bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
    await writeFile(wavPath, bytes);
  } else {
    // Raw PCM stream -> wrap it so ffprobe/silencedetect can read it.
    const rawPath = path.join(outDir, `${label}.pcm`);
    await writeFile(rawPath, bytes);
    await execFileAsync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', rawPath, wavPath,
    ]);
  }
  return {
    label,
    wavPath,
    bytes: bytes.length,
    contentType,
    requestMs: Math.round(performance.now() - startedAt),
    generationMode: response.headers.get('X-TTS-Generation-Mode'),
    cloned: response.headers.get('X-Voice-Cloned'),
  };
}

/**
 * End-to-end proof for THIS working tree's gateway code without touching the
 * live unit: boot a throwaway standalone app on an ephemeral port, point it at
 * the REAL VoxCPM, and drive one emphasis request through it. The live
 * voice-tutor-standalone.service is never started, stopped, or reloaded here.
 */
async function synthesizeThroughFreshGateway(label, requestBody) {
  const { createVoiceStandaloneApp } = require('../../backend/voice-standalone-runtime.js');
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-emphasis-witness-'));
  const { app } = createVoiceStandaloneApp({
    stateRoot,
    learnerContextRoot: path.join(stateRoot, 'learner-context'),
    disableSessionPersistence: true,
    logger: { log: () => {} },
    env: { VOXCPM_ENABLED: 'true', VOXCPM_URL: 'http://127.0.0.1:8020' },
  });
  const server = await new Promise((resolve, reject) => {
    const listening = app.listen(0, '127.0.0.1', () => resolve(listening));
    listening.on('error', reject);
  });
  const { port } = server.address();
  try {
    const response = await fetch(`http://127.0.0.1:${port}/voice/speech/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targetText: LINE, speakingRate: SPEAKING_RATE, ...requestBody }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`[${label}] fresh gateway returned HTTP ${response.status}: ${detail.slice(0, 300)}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const wavPath = path.join(outDir, `${label}.wav`);
    if (bytes.subarray(0, 4).toString('ascii') === 'RIFF') {
      await writeFile(wavPath, bytes);
    } else {
      const rawPath = path.join(outDir, `${label}.pcm`);
      await writeFile(rawPath, bytes);
      await execFileAsync('ffmpeg', [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-f', 's16le', '-ar', '48000', '-ac', '1', '-i', rawPath, wavPath,
      ]);
    }
    return {
      label,
      wavPath,
      bytes: bytes.length,
      contentType: (response.headers.get('content-type') || '').toLowerCase(),
      generationMode: response.headers.get('X-TTS-Generation-Mode'),
      cloned: response.headers.get('X-Voice-Cloned'),
    };
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }
}

async function durationMs(wavPath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1', wavPath,
  ]);
  return Math.round(Number.parseFloat(stdout.trim()) * 1000);
}

// Pause structure: every interior silence >= 120ms at or below -30dBFS. A clause
// comma is supposed to show up here as a new (or longer) interior gap.
async function silences(wavPath) {
  let stderr = '';
  try {
    const result = await execFileAsync('ffmpeg', [
      '-hide_banner', '-nostats', '-i', wavPath,
      '-af', 'silencedetect=noise=-30dB:d=0.12', '-f', 'null', '-',
    ]);
    stderr = result.stderr;
  } catch (error) {
    stderr = error.stderr || '';
  }
  const found = [];
  let pendingStart = null;
  for (const line of stderr.split('\n')) {
    const start = line.match(/silence_start:\s*(-?[\d.]+)/u);
    if (start) pendingStart = Number.parseFloat(start[1]);
    const end = line.match(/silence_end:\s*(-?[\d.]+)[^|]*\|\s*silence_duration:\s*([\d.]+)/u);
    if (end) {
      found.push({
        startMs: Math.round((pendingStart ?? Number.parseFloat(end[1])) * 1000),
        endMs: Math.round(Number.parseFloat(end[1]) * 1000),
        durationMs: Math.round(Number.parseFloat(end[2]) * 1000),
      });
      pendingStart = null;
    }
  }
  return found;
}

// Silences that touch neither edge — leading/trailing padding is not a pause the
// learner hears as emphasis.
function interior(list, totalMs) {
  return list.filter((gap) => gap.startMs > 60 && gap.endMs < totalMs - 60);
}

function describe(list) {
  if (list.length === 0) return 'none';
  return list.map((gap) => `${gap.startMs}-${gap.endMs}ms (${gap.durationMs}ms)`).join(', ');
}

async function main() {
  await mkdir(outDir, { recursive: true });

  console.log('=== TTS word-emphasis A/B witness ===');
  console.log(`gateway      : ${baseUrl}`);
  console.log(`line         : "${LINE}"`);
  console.log(`emphasisWord : "${EMPHASIS_WORD}" (occurrence ${EMPHASIS_OCCURRENCE}, tokenIndex ${EMPHASIS_TOKEN_INDEX})`);
  console.log(`shaped text  : "${shaped.text}"  [shaped=${shaped.shaped} reason=${shaped.reason}]`);
  console.log('');

  const renditions = [
    await synthesize('A-plain', {}),
    await synthesize('B-emphasis', {
      emphasisWord: EMPHASIS_WORD,
      emphasisOccurrence: EMPHASIS_OCCURRENCE,
      emphasisTokenIndex: EMPHASIS_TOKEN_INDEX,
    }),
    await synthesize('B2-shaped-direct', { targetText: shaped.text }),
    await synthesizeThroughFreshGateway('B3-fresh-gateway', {
      emphasisWord: EMPHASIS_WORD,
      emphasisOccurrence: EMPHASIS_OCCURRENCE,
      emphasisTokenIndex: EMPHASIS_TOKEN_INDEX,
    }),
  ];

  const measured = [];
  for (const rendition of renditions) {
    const totalMs = await durationMs(rendition.wavPath);
    const all = await silences(rendition.wavPath);
    const inner = interior(all, totalMs);
    measured.push({ ...rendition, totalMs, all, inner });
    console.log(`[${rendition.label}]`);
    console.log(`  wav           : ${rendition.wavPath}`);
    console.log(`  bytes         : ${rendition.bytes}  (${rendition.contentType || 'no content-type'})`);
    console.log(`  duration      : ${totalMs} ms`);
    console.log(`  silences      : ${describe(all)}`);
    console.log(`  interior gaps : ${inner.length} -> ${describe(inner)}`);
    console.log('');
  }

  const [plain, contract, mechanism, freshGateway] = measured;

  const report = (label, other) => {
    const deltaMs = other.totalMs - plain.totalMs;
    const gapDelta = other.inner.length - plain.inner.length;
    const innerMsPlain = plain.inner.reduce((sum, gap) => sum + gap.durationMs, 0);
    const innerMsOther = other.inner.reduce((sum, gap) => sum + gap.durationMs, 0);
    const pausesInserted = gapDelta > 0 || innerMsOther - innerMsPlain >= 60;
    console.log(`--- ${label} (${other.label} vs A-plain) ---`);
    console.log(`  duration delta        : ${deltaMs >= 0 ? '+' : ''}${deltaMs} ms`);
    console.log(`  interior gap count    : ${plain.inner.length} -> ${other.inner.length} (${gapDelta >= 0 ? '+' : ''}${gapDelta})`);
    console.log(`  interior silence total: ${innerMsPlain} ms -> ${innerMsOther} ms (${innerMsOther - innerMsPlain >= 0 ? '+' : ''}${innerMsOther - innerMsPlain} ms)`);
    console.log(`  VERDICT: pauses inserted around the emphasized clause: ${pausesInserted ? 'yes' : 'no'}; duration delta ${deltaMs >= 0 ? '+' : ''}${deltaMs} ms`);
    console.log('');
    return { deltaMs, pausesInserted, identical: deltaMs === 0 && gapDelta === 0 };
  };

  const contractResult = report('WIRE CONTRACT (live service)', contract);
  const mechanismResult = report('MECHANISM', mechanism);
  const freshResult = report('THIS TREE END-TO-END', freshGateway);

  console.log('=== SUMMARY ===');
  console.log(
    freshResult.pausesInserted
      ? 'END-TO-END: this working tree\'s gateway + the real VoxCPM produce the shaped\n'
        + 'rendition from emphasisWord alone. The channel works.'
      : 'END-TO-END: this working tree\'s gateway produced NO boundary change. The wiring\n'
        + 'or the mechanism is broken — investigate before shipping.',
  );
  if (contractResult.identical && !mechanismResult.identical) {
    console.log('The LIVE service did NOT shape the text for emphasisWord (B is identical to A):');
    console.log('the running voice-tutor-standalone unit predates this change and was');
    console.log('deliberately not restarted. Restarting it is the activation step.');
  } else if (!contractResult.pausesInserted && !mechanismResult.pausesInserted) {
    console.log('NO measurable boundary change in either B or B2. Comma-clause shaping does');
    console.log('not move this engine. This is the trigger for the two-segment-synthesis');
    console.log('fallback (NOT built here) — reported as a measurement, not a fix.');
  } else {
    console.log(`Comma-clause shaping produces a measurable boundary change (mechanism: ${mechanismResult.pausesInserted ? 'pauses inserted' : 'duration-only'}).`);
  }
  console.log(`wav A : ${plain.wavPath}`);
  console.log(`wav B : ${contract.wavPath}`);
  console.log(`wav B2: ${mechanism.wavPath}`);
  console.log(`wav B3: ${freshGateway.wavPath}`);
}

main().catch((error) => {
  console.error(`verify-tts-emphasis failed: ${error.message}`);
  process.exitCode = 1;
});
