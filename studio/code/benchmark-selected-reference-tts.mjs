#!/usr/bin/env node

const baseUrl = (process.env.VOXCPM_URL || 'http://127.0.0.1:8020').replace(/\/+$/u, '');
const referenceAudioPath = process.env.TTS_REFERENCE_AUDIO_PATH || '';
const requestedRuns = Number.parseInt(process.env.TTS_BENCHMARK_RUNS || '10', 10);
const runs = Number.isFinite(requestedRuns) ? Math.min(30, Math.max(3, requestedRuns)) : 10;

if (!referenceAudioPath) {
  throw new Error('TTS_REFERENCE_AUDIO_PATH is required.');
}

function nearestRankPercentile(values, fraction) {
  const ordered = [...values].sort((a, b) => a - b);
  return ordered[Math.max(0, Math.ceil(ordered.length * fraction) - 1)];
}

function median(values) {
  const ordered = [...values].sort((a, b) => a - b);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

const markers = [
  'easy', 'calm', 'soft', 'open', 'warm', 'free', 'even', 'kind', 'mild', 'airy',
  'safe', 'slow', 'true', 'clear', 'light', 'quiet', 'round', 'gentle', 'simple', 'steady',
  'smooth', 'natural', 'settled', 'relaxed', 'forward', 'patient', 'bright', 'grounded', 'focused', 'fluid',
];

async function readGeneratedAudio(targetText) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      target_text: targetText,
      speakingRate: 0.76,
      cache: false,
      reference_audio_path: referenceAudioPath,
    }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`VoxCPM generation failed with HTTP ${response.status}.`);
  }
  if (response.headers.get('x-tts-generation-mode') !== 'cloned-synthesis') {
    throw new Error('Benchmark response did not prove cloned synthesis.');
  }
  if (response.headers.get('x-reference-audio-role') !== 'conditioning-only') {
    throw new Error('Benchmark response did not prove conditioning-only reference use.');
  }
  if (response.headers.get('x-speaking-rate-applied') !== '0.76') {
    throw new Error('Benchmark response did not prove tutor rate 0.76.');
  }

  const reader = response.body.getReader();
  const first = await reader.read();
  if (first.done || !first.value?.length) {
    throw new Error('VoxCPM generation returned an empty audio body.');
  }
  const firstPcmMs = Math.round(performance.now() - startedAt);
  let bytes = first.value?.length || 0;
  while (!first.done) {
    const next = await reader.read();
    if (next.done) break;
    bytes += next.value.length;
  }
  return {
    first_pcm_ms: firstPcmMs,
    total_ms: Math.round(performance.now() - startedAt),
    bytes,
  };
}

const primeStartedAt = performance.now();
const primeResponse = await fetch(`${baseUrl}/v1/reference-audio/prime`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ reference_audio_path: referenceAudioPath }),
});
if (!primeResponse.ok) {
  throw new Error(`Reference prewarm failed with HTTP ${primeResponse.status}.`);
}
const prime = await primeResponse.json();
const prewarmMs = Math.round(performance.now() - primeStartedAt);

const rows = [];
for (let index = 0; index < runs; index += 1) {
  const token = markers[index];
  rows.push(await readGeneratedAudio(
    `Keep this opening ${token} and clear. Let the ${token} ending settle without adding extra weight.`,
  ));
}

const firstPcm = rows.map((row) => row.first_pcm_ms);
const maximum = Math.max(...firstPcm);
process.stdout.write(`${JSON.stringify({
  success: true,
  score: -maximum,
  summary: `selected-reference first-PCM observed maximum ${maximum} ms across ${runs} unique uncached lines`,
  metrics: {
    runs,
    prewarm_cache_hit: prime.cache_hit === true,
    prewarm_ms: prewarmMs,
    first_pcm_median_ms: median(firstPcm),
    first_pcm_p95_nearest_rank_ms: nearestRankPercentile(firstPcm, 0.95),
    first_pcm_max_ms: maximum,
    total_median_ms: median(rows.map((row) => row.total_ms)),
    bytes_min: Math.min(...rows.map((row) => row.bytes)),
    bytes_max: Math.max(...rows.map((row) => row.bytes)),
  },
})}\n`);
