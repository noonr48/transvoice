import type { VoiceSessionStage } from './session-reentry';
import type { VoiceReferenceQualityAssessment } from './api';
import { createVoiceAudioContext } from './audio/audio-context';
import { createPcm16Capture, type Pcm16CaptureHandle } from './audio/pcm16-capture';

/**
 * Voice-copy front door (P0.1a). "Upload the target voice" is the first screen of a
 * session: the uploaded sample owns the target (see workflow-controller.analyzeReference,
 * which flips targetSource -> 'reference'). The preset chooser is the no-sample fallback.
 * This is pure DOM wiring over the EXISTING reference path — no new backend API.
 */
export interface VoiceFrontDoorElements {
  voiceFrontDoorEl: HTMLElement | null;
  voiceFrontDoorInputEl: HTMLInputElement | null;
  voiceFrontDoorSkipEl: HTMLButtonElement | null;
}

export interface VoiceFrontDoorCallbacks {
  /** Reuses the existing reference entry point (analyzeReference). */
  onVoiceReferenceSelected: (file: File) => void;
  /** Start a session from a built-in preset instead of a sample. */
  onUsePresetFallback: () => void;
}

export function bindVoiceFrontDoor(
  elements: VoiceFrontDoorElements,
  callbacks: VoiceFrontDoorCallbacks,
): void {
  elements.voiceFrontDoorInputEl?.addEventListener('change', (event) => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file) {
      callbacks.onVoiceReferenceSelected(file);
    }
    // Clear so re-selecting the same file re-fires change.
    input.value = '';
  });
  elements.voiceFrontDoorSkipEl?.addEventListener('click', () => {
    callbacks.onUsePresetFallback();
  });
}

/**
 * The single source of truth for whether the front-door takeover should show.
 * Visible only until a target is chosen: at warm-up, or at the target stage while
 * no reference has been loaded yet. A durable `dismissed` flag (set by the preset
 * fallback) hides it for good even though the per-render stage may re-derive to
 * warmup/target. Once a reference exists (or practice/review is underway) it hides,
 * revealing the practice stage.
 */
export function shouldShowVoiceFrontDoor(
  stage: VoiceSessionStage,
  hasReference: boolean,
  dismissed = false,
): boolean {
  if (dismissed) {
    return false;
  }
  return stage === 'warmup' || (stage === 'target' && !hasReference);
}

/**
 * Toggle the front-door section visibility via the global
 * `.hidden { display: none !important }` convention and return whether it is shown
 * (so the caller can also drive the `.vt-front-door-open` takeover class on the lab
 * panel from the same decision). Keeps the visibility rule in one place.
 */
export function updateVoiceFrontDoorVisibility(
  elements: VoiceFrontDoorElements,
  stage: VoiceSessionStage,
  hasReference: boolean,
  dismissed = false,
): boolean {
  const showFrontDoor = shouldShowVoiceFrontDoor(stage, hasReference, dismissed);
  elements.voiceFrontDoorEl?.classList.toggle('hidden', !showFrontDoor);
  return showFrontDoor;
}

/* ===========================================================================
 * P1 clip trust — front-door report card
 *
 * After a reference is analyzed, instead of silently proceeding we render a
 * calm "clip report card": three plain checks (long enough · clearly voiced ·
 * clean audio), a one-line "what we heard" summary, a coach-voice line (cloned
 * vs default), and a primary "Start practicing" + secondary "Try a different
 * clip". On verdict='reject' we show the reason and do NOT proceed. Minimal and
 * numberless per the design doc — exact figures live in title tooltips.
 * ======================================================================== */

export interface VoiceFrontDoorReportCallbacks {
  /** Proceed into practice exactly as a successful analyze does today. */
  onProceed: () => void;
  /** Discard this clip and return to the upload/record chooser. */
  onTryAgain: () => void;
  /**
   * Abandon-trigger fix 1: the preset escape on the REJECT view. A rejected
   * clip must never be a wall — offered alongside "try another clip" so the
   * person can start practicing right now. Optional so existing callers/tests
   * stay valid; the button renders only when provided.
   */
  onUsePreset?: () => void;
}

/** The preset escape label — shared by the chooser peer button (template) and
 *  the report-card reject view. One phrasing everywhere. */
export const VOICE_PRESET_ESCAPE_LABEL = 'Start now with a preset — add your voice later';

/** Abandon-trigger fix 1: calm chooser line when the mic can't be opened
 *  (permission denied / no device). An open door, not an error-wall. */
export const VOICE_MIC_UNAVAILABLE_LINE =
  "The mic didn't open — that's fine. Start with a preset now and add your voice whenever you like.";

type ReportCheckState = 'pass' | 'warn' | 'fail';

const CHECK_GLYPH: Record<ReportCheckState, string> = {
  pass: '✓', // ✓
  warn: '△', // △
  fail: '✗', // ✗
};

function flagSet(quality: VoiceReferenceQualityAssessment | null | undefined): Set<string> {
  return new Set(Array.isArray(quality?.flags) ? quality?.flags ?? [] : []);
}

/** "Long enough" check: rejected when very short, warned on the short-sample flag. */
function deriveDurationCheck(
  quality: VoiceReferenceQualityAssessment | null | undefined,
): ReportCheckState {
  const durationMs = Number(quality?.durationMs ?? 0);
  if (durationMs > 0 && durationMs < 1500) {
    return 'fail';
  }
  if (flagSet(quality).has('short_sample') || (durationMs > 0 && durationMs < 4000)) {
    return 'warn';
  }
  return 'pass';
}

/** "Clearly voiced" check: low voiced coverage / confidence soften or fail it. */
function deriveVoicedCheck(
  quality: VoiceReferenceQualityAssessment | null | undefined,
): ReportCheckState {
  const coverage = Number(quality?.voicedCoveragePct ?? 0);
  if (coverage > 0 && coverage < 0.15) {
    return 'fail';
  }
  const flags = flagSet(quality);
  if (flags.has('low_voiced_coverage') || flags.has('low_confidence') || flags.has('low_score_confidence')) {
    return 'warn';
  }
  return 'pass';
}

/** "Clean audio" check: clipping or quiet input degrade it. */
function deriveCleanCheck(
  quality: VoiceReferenceQualityAssessment | null | undefined,
): ReportCheckState {
  const clipping = Number(quality?.clippingPct ?? 0);
  if (clipping > 0.05 || flagSet(quality).has('quiet_input')) {
    return 'warn';
  }
  return 'pass';
}

function buildReportCheckRow(
  label: string,
  state: ReportCheckState,
  title: string,
  doc: Document,
): HTMLElement {
  const row = doc.createElement('li');
  row.className = `voice-report-check voice-report-check-${state}`;
  row.title = title;
  const glyph = doc.createElement('span');
  glyph.className = 'voice-report-check-glyph';
  glyph.setAttribute('aria-hidden', 'true');
  glyph.textContent = CHECK_GLYPH[state];
  const text = doc.createElement('span');
  text.className = 'voice-report-check-label';
  text.textContent = label;
  row.append(glyph, text);
  return row;
}

/**
 * Render the clip report card into `container` (typically the front-door card).
 * Pure DOM — no store coupling. Returns nothing; the buttons call back into the
 * provided callbacks. Re-rendering replaces prior content in the container.
 */
export function renderVoiceFrontDoorReportCard(
  container: HTMLElement | null,
  quality: VoiceReferenceQualityAssessment | null | undefined,
  callbacks: VoiceFrontDoorReportCallbacks,
  options: { clipName?: string | null } = {},
): void {
  if (!container) {
    return;
  }
  const doc = container.ownerDocument || document;
  container.replaceChildren();

  const verdict = typeof quality?.verdict === 'string' ? quality.verdict : 'good';
  const rejected = verdict === 'reject';
  const cloneable = quality?.cloneable !== false;

  const card = doc.createElement('div');
  card.className = `voice-report-card voice-report-card-${rejected ? 'reject' : verdict === 'usable' ? 'usable' : 'good'}`;

  const eyebrow = doc.createElement('span');
  eyebrow.className = 'voice-chip-label';
  eyebrow.textContent = rejected ? "Let's try another clip" : 'Your target voice';
  card.append(eyebrow);

  if (options.clipName) {
    const name = doc.createElement('p');
    name.className = 'voice-report-clip-name';
    name.textContent = options.clipName;
    card.append(name);
  }

  // Three plain checks.
  const durationCheck = deriveDurationCheck(quality);
  const voicedCheck = deriveVoicedCheck(quality);
  const cleanCheck = deriveCleanCheck(quality);
  const durationSec = quality?.durationMs ? Math.round(Number(quality.durationMs) / 100) / 10 : null;
  const clippingPctText = quality?.clippingPct != null
    ? `${(Number(quality.clippingPct) * 100).toFixed(1)}% clipped`
    : 'clipping unknown';
  const coverageText = quality?.voicedCoveragePct != null
    ? `${Math.round(Number(quality.voicedCoveragePct) * 100)}% voiced`
    : 'voicing unknown';

  const checks = doc.createElement('ul');
  checks.className = 'voice-report-checks';
  checks.append(
    buildReportCheckRow(
      'Long enough',
      durationCheck,
      durationSec != null ? `Clip length: ${durationSec}s` : 'Clip length',
      doc,
    ),
    buildReportCheckRow('Clearly voiced', voicedCheck, coverageText, doc),
    buildReportCheckRow('Clean audio', cleanCheck, clippingPctText, doc),
  );
  card.append(checks);

  // "What we heard" one-liner from the DSP summary.
  if (quality?.summary) {
    const summary = doc.createElement('p');
    summary.className = 'voice-report-summary';
    summary.textContent = quality.summary;
    card.append(summary);
  }

  // Coach-voice line: cloned vs default.
  if (!rejected) {
    const coachVoice = doc.createElement('p');
    coachVoice.className = `voice-report-coach-voice ${cloneable ? 'is-cloned' : 'is-default'}`;
    coachVoice.textContent = quality?.cloneNote
      || (cloneable
        ? 'Demos will be spoken in your target voice.'
        : 'Clip too noisy to clone — using the default coach voice.');
    card.append(coachVoice);
  }

  // Actions.
  const actions = doc.createElement('div');
  actions.className = 'voice-report-actions';

  if (!rejected) {
    const proceed = doc.createElement('button');
    proceed.type = 'button';
    proceed.className = 'voice-btn voice-btn-primary voice-report-proceed';
    proceed.textContent = 'Start practicing';
    proceed.addEventListener('click', () => callbacks.onProceed());
    actions.append(proceed);
  }

  const tryAgain = doc.createElement('button');
  tryAgain.type = 'button';
  tryAgain.className = `voice-btn voice-report-try-again ${rejected ? 'voice-btn-primary' : 'voice-btn-secondary'}`;
  tryAgain.textContent = rejected ? 'Upload or record another clip' : 'Try a different clip';
  tryAgain.addEventListener('click', () => callbacks.onTryAgain());
  actions.append(tryAgain);

  // Fix 1: the reject view also offers the preset escape — another clip is a
  // path, never the only path.
  if (rejected && callbacks.onUsePreset) {
    const usePreset = doc.createElement('button');
    usePreset.type = 'button';
    usePreset.className = 'voice-btn voice-btn-secondary voice-report-use-preset';
    usePreset.textContent = VOICE_PRESET_ESCAPE_LABEL;
    usePreset.addEventListener('click', () => callbacks.onUsePreset?.());
    actions.append(usePreset);
  }

  card.append(actions);
  container.append(card);
}

/* ===========================================================================
 * P1 clip trust — mic-recorded reference
 *
 * IMPLEMENTATION CONSTRAINT: the DSP needs ffmpeg for non-WAV. We deliberately
 * avoid MediaRecorder/webm and instead reuse the PCM16 capture machinery
 * (createPcm16Capture) to gather mono 16 kHz PCM, then build a WAV file
 * client-side (RIFF header + PCM16) and submit it through the SAME analyze path
 * as an upload. Guided 10–20s recording with a live elapsed indicator + Stop;
 * Stop is enabled only after a 4s minimum.
 * ======================================================================== */

const MIC_RECORD_SAMPLE_RATE = 16000;
const MIC_RECORD_MIN_MS = 4000;
const MIC_RECORD_MAX_MS = 20000;

/** Wrap accumulated little-endian PCM16 frames in a 16-bit mono WAV (RIFF). */
export function encodePcm16FramesToWavBlob(
  frames: ArrayBuffer[],
  sampleRate: number,
): Blob {
  const dataLength = frames.reduce((total, frame) => total + frame.byteLength, 0);
  const buffer = new ArrayBuffer(44 + dataLength);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  const numChannels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // audio format = PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataLength, true);

  // Copy raw PCM16 bytes verbatim (frames are already int16 LE from the worklet).
  const bytes = new Uint8Array(buffer);
  let offset = 44;
  for (const frame of frames) {
    bytes.set(new Uint8Array(frame), offset);
    offset += frame.byteLength;
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

export interface VoiceMicRecorderCallbacks {
  /** Fired ~10x/sec while recording with elapsed ms (drives the live indicator). */
  onElapsed?: (elapsedMs: number) => void;
  /** Fired once when the min-duration threshold is crossed (Stop becomes valid). */
  onMinReached?: () => void;
  /** Fired when capture stops on its own (max duration) or on error. */
  onAutoStop?: (reason: 'max-duration' | 'error', error?: Error) => void;
}

export interface VoiceMicRecorderHandle {
  /** Stop capture and return the recorded clip as a WAV File (null if too short). */
  stop: () => Promise<File | null>;
  /** Abort without producing a file (e.g. user cancelled / unmounted). */
  cancel: () => void;
  readonly minMs: number;
  readonly maxMs: number;
}

/**
 * Start a guided mic recording. Acquires the mic, captures PCM16 @ 16 kHz via
 * the shared worklet, and accumulates frames. `stop()` builds a WAV File and
 * resolves with it (or null if under the 4s minimum). Auto-stops at 20s.
 */
export async function startVoiceMicReferenceRecording(
  callbacks: VoiceMicRecorderCallbacks = {},
): Promise<VoiceMicRecorderHandle> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser.');
  }

  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });

  const audioContext = createVoiceAudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const frames: ArrayBuffer[] = [];
  const startedAt = Date.now();
  let minReachedFired = false;
  let stopped = false;
  let capture: Pcm16CaptureHandle | null = null;
  let tickTimer: ReturnType<typeof setInterval> | null = null;

  const teardown = (): void => {
    if (tickTimer) {
      clearInterval(tickTimer);
      tickTimer = null;
    }
    try {
      capture?.stop();
    } catch {
      // ignore teardown failures
    }
    try {
      sourceNode.disconnect();
    } catch {
      // ignore
    }
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {
        // ignore
      }
    }
    void audioContext.close().catch(() => undefined);
  };

  try {
    capture = await createPcm16Capture({
      audioContext,
      sourceNode,
      outputSampleRate: MIC_RECORD_SAMPLE_RATE,
      frameSize: 1024,
      onFrame: (frame) => {
        if (!stopped) {
          frames.push(frame);
        }
      },
    });
    await capture.start();
  } catch (error) {
    teardown();
    throw error instanceof Error ? error : new Error(String(error));
  }

  const finalize = (): File | null => {
    if (stopped) {
      return null;
    }
    stopped = true;
    const elapsedMs = Date.now() - startedAt;
    teardown();
    if (elapsedMs < MIC_RECORD_MIN_MS || frames.length === 0) {
      return null;
    }
    const blob = encodePcm16FramesToWavBlob(frames, MIC_RECORD_SAMPLE_RATE);
    const filename = `mic-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.wav`;
    return new File([blob], filename, { type: 'audio/wav' });
  };

  tickTimer = setInterval(() => {
    if (stopped) {
      return;
    }
    const elapsedMs = Date.now() - startedAt;
    callbacks.onElapsed?.(elapsedMs);
    if (!minReachedFired && elapsedMs >= MIC_RECORD_MIN_MS) {
      minReachedFired = true;
      callbacks.onMinReached?.();
    }
    if (elapsedMs >= MIC_RECORD_MAX_MS) {
      // Auto-stop at the cap; the caller's onAutoStop handler should submit it.
      callbacks.onAutoStop?.('max-duration');
    }
  }, 100);

  return {
    minMs: MIC_RECORD_MIN_MS,
    maxMs: MIC_RECORD_MAX_MS,
    async stop() {
      return finalize();
    },
    cancel() {
      if (!stopped) {
        stopped = true;
        teardown();
      }
    },
  };
}
