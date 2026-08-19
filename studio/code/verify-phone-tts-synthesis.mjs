const usage = `Silent physical-phone tutor synthesis verifier

Prerequisites:
  1. A connected, unlocked phone is already showing the TransVoice /app Coach page.
  2. Chrome/WebView debugging is forwarded to TRANSVOICE_CDP_URL (default http://127.0.0.1:9223).
  3. The page owns an active session with a selected named voice preset.
  4. For a release-grade PASS, set VOICE_ASR_URL to the reachable Parakeet service and pass --verify-asr.

Usage:
  VOICE_ASR_URL=http://host:8765 node studio/code/verify-phone-tts-synthesis.mjs --verify-asr
  node studio/code/verify-phone-tts-synthesis.mjs --headers-only  # exits incomplete; never PASS

This script fetches and hashes PCM inside the phone WebView. It never constructs a player or emits phone audio.`;

if (process.argv.includes('--help')) {
  console.log(usage);
  process.exit(0);
}

const cdpUrl = process.env.TRANSVOICE_CDP_URL || 'http://127.0.0.1:9223';
const speakingRate = 0.76;
const targetText = 'Keep the sound forward. Let bright land clearly, then soften the ending.';
const verifyAsr = process.argv.includes('--verify-asr');
const headersOnly = process.argv.includes('--headers-only');
const asrBaseUrl = process.env.VOICE_ASR_URL || process.env.TRANSVOICE_ASR_URL || '';

if (verifyAsr === headersOnly) {
  throw new Error(`Choose exactly one of --verify-asr or --headers-only.\n\n${usage}`);
}
if (verifyAsr && !asrBaseUrl) {
  throw new Error(`VOICE_ASR_URL is required for an ASR-backed PASS.\n\n${usage}`);
}
if (typeof WebSocket !== 'function') {
  throw new Error('This verifier requires a Node runtime with the global WebSocket API.');
}

function pcm16ToWav(pcm, sampleRate) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const targets = await fetch(`${cdpUrl}/json`).then((response) => response.json());
const target = targets.find((candidate) => candidate.type === 'page' && candidate.url.includes('/app'));
if (!target) throw new Error('Voice Tutor WebView target not found.');

const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  socket.addEventListener('open', resolve, { once: true });
  socket.addEventListener('error', reject, { once: true });
});

let requestId = 0;
const pending = new Map();
socket.addEventListener('message', ({ data }) => {
  const message = JSON.parse(data);
  if (!message.id || !pending.has(message.id)) return;
  const waiter = pending.get(message.id);
  pending.delete(message.id);
  if (message.error) waiter.reject(new Error(message.error.message));
  else waiter.resolve(message.result);
});
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++requestId;
  pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params }));
});

const evaluation = await call('Runtime.evaluate', {
  expression: `(${async function silentlyVerifyTutorSynthesis(text, rate, includeAudio) {
    const sessionId = globalThis.__tvSession?.id;
    if (!sessionId) throw new Error('Phone session is unavailable.');
    const response = await fetch('/voice/speech/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, targetText: text, speakingRate: rate }),
    });
    const bytes = await response.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const header = (name) => response.headers.get(name);
    const sampleRate = Number(header('X-Audio-Sample-Rate'));
    let audioBase64 = null;
    if (includeAudio) {
      const view = new Uint8Array(bytes);
      const chunks = [];
      for (let offset = 0; offset < view.length; offset += 0x8000) {
        chunks.push(String.fromCharCode(...view.subarray(offset, offset + 0x8000)));
      }
      audioBase64 = btoa(chunks.join(''));
    }
    return {
      status: response.status,
      ok: response.ok,
      contentType: header('Content-Type'),
      provider: header('X-Voice-Speech-Provider'),
      referenceResolved: header('X-Reference-Resolved'),
      voiceCloned: header('X-Voice-Cloned'),
      generationMode: header('X-TTS-Generation-Mode'),
      referenceAudioRole: header('X-Reference-Audio-Role'),
      speakingRate: Number(header('X-Speaking-Rate-Applied')),
      audioFormat: header('X-Audio-Format'),
      sampleRate,
      byteLength: bytes.byteLength,
      durationSeconds: sampleRate > 0 ? bytes.byteLength / 2 / sampleRate : null,
      sha256: Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(''),
      targetTextLength: text.length,
      targetWordCount: text.trim().split(/\s+/).length,
      audioBase64,
    };
  }})(${JSON.stringify(targetText)}, ${speakingRate}, ${verifyAsr})`,
  awaitPromise: true,
  returnByValue: true,
});
socket.close();

if (evaluation.exceptionDetails) {
  throw new Error(evaluation.exceptionDetails.exception?.description || 'Phone synthesis evaluation failed.');
}
const result = evaluation.result.value;
const audioBase64 = result?.audioBase64 || null;
delete result.audioBase64;
const failures = [];
if (!result?.ok || result.status !== 200) failures.push(`HTTP ${result?.status ?? 'missing'}`);
if (result?.provider !== 'voxcpm') failures.push(`provider=${result?.provider ?? 'missing'}`);
if (result?.referenceResolved !== 'true') failures.push('selected reference was not resolved');
if (result?.voiceCloned !== 'true') failures.push('voice clone was not proven');
if (result?.generationMode !== 'cloned-synthesis') failures.push(`generationMode=${result?.generationMode ?? 'missing'}`);
if (result?.referenceAudioRole !== 'conditioning-only') failures.push(`referenceAudioRole=${result?.referenceAudioRole ?? 'missing'}`);
if (Math.abs(Number(result?.speakingRate) - speakingRate) > 0.005) failures.push(`speakingRate=${result?.speakingRate ?? 'missing'}`);
if (result?.audioFormat !== 'pcm_s16le' || result?.sampleRate !== 48_000) failures.push('PCM format metadata mismatch');
if (!Number.isFinite(result?.durationSeconds) || result.durationSeconds < 2) failures.push('generated audio is unexpectedly short');
if (!/^[0-9a-f]{64}$/.test(result?.sha256 || '')) failures.push('generated audio digest is missing');

let asr = null;
if (verifyAsr) {
  if (!audioBase64) {
    failures.push('ASR proof audio was not returned');
  } else {
    const pcm = Buffer.from(audioBase64, 'base64');
    const wav = pcm16ToWav(pcm, result.sampleRate);
    const form = new FormData();
    form.append('file', new Blob([wav], { type: 'audio/wav' }), 'synthetic-tutor.wav');
    const transcribeUrl = new URL('/transcribe', `${asrBaseUrl.replace(/\/+$/, '')}/`);
    transcribeUrl.searchParams.set('language', 'en');
    transcribeUrl.searchParams.set('return_timestamps', 'true');
    const response = await fetch(transcribeUrl, { method: 'POST', body: form });
    const payload = await response.json();
    const entry = Array.isArray(payload?.result) ? payload.result[0] : payload?.result;
    const transcript = String(
      payload?.text || payload?.transcript || entry?.clean_text || entry?.text || '',
    ).trim();
    const normalized = transcript.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
    asr = { status: response.status, transcript };
    if (!response.ok) failures.push(`ASR HTTP ${response.status}`);
    for (const phrase of ['keep the sound forward', 'bright', 'soften the ending']) {
      if (!normalized.includes(phrase)) failures.push(`ASR missed required phrase: ${phrase}`);
    }
  }
}

const gate = failures.length ? 'FAIL' : (verifyAsr ? 'PASS' : 'INCOMPLETE');
console.log(JSON.stringify({
  gate,
  mode: 'silent-fetch-no-playback',
  page: target.url,
  result,
  asr,
  failures,
}, null, 2));
if (failures.length) process.exitCode = 1;
else if (!verifyAsr) process.exitCode = 2;
