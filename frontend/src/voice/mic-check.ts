import { createVoiceAudioContext } from './audio/audio-context';
import { createPcm16Capture, type Pcm16CaptureHandle } from './audio/pcm16-capture';
import type { VoiceInputRuntimeState } from './state';

/**
 * First-run mic check (consumer-hardware wave, 2026-07-19).
 *
 * The product law: normal people, no professional setup. Capture deliberately
 * runs with AGC/NS/EC off (correct for measurement), so nothing compensates for
 * a hot gain knob, a faint laptop mic, or a loud room — and the capture-quality
 * gates (snrDb < 12 / clippingPct >= 0.02 / captureReliability < 0.5) need real
 * numbers to fire. This module measures those numbers ONCE, calmly, before the
 * target-voice capture: ~4 s of "stay quiet" (noise floor) then ~5 s of one
 * easy line (speech level, SNR, clipping), reusing the SAME PCM16 worklet
 * plumbing the front-door mic recording uses — no second audio pipeline.
 *
 * Results are (a) told to the person in plain language (ink, no red, no
 * scores), (b) persisted per input device (localStorage `tvMicCheck:<deviceId>`)
 * so the offer only happens on first run / device change, and (c) fed into the
 * live session state fields the gates and UI already read
 * (voiceInputRuntime.lastNoiseFloorDb / lastSnrDb / lastClippingPct /
 * lastCaptureReliability).
 */

export const MIC_CHECK_STORAGE_PREFIX = 'tvMicCheck:';
export const MIC_CHECK_QUIET_MS = 4000;
export const MIC_CHECK_SPEECH_MS = 5000;
export const MIC_CHECK_SAMPLE_RATE = 16000;
export const MIC_CHECK_FRAME_SIZE = 1024;

/** One easy, natural line — short words, no plosive minefield. */
export const MIC_CHECK_SPEECH_LINE = 'Here I am, saying one easy line out loud.';

/** Thresholds mirror the backend gates + analyzer flags (single source of intent):
 *  snr < 12 dB = the safety-gates "poor signal-to-noise" bar;
 *  clipping >= 0.02 = the sustained-clipping bar (2.5x under the clone gate's 5%);
 *  speech < -33 dBFS = the analyzer's quiet_input flag bar. */
export const MIC_CHECK_MIN_SNR_DB = 12;
export const MIC_CHECK_MAX_CLIPPING_PCT = 0.02;
export const MIC_CHECK_MIN_SPEECH_DB = -33;

export type MicCheckVerdict = 'good' | 'too-quiet' | 'noisy' | 'clipping';

/** Plain-language verdicts in the philosophy voice — ink, no red, no scores.
 *  Softening pass (abandon-trigger fix 5): the noisy verdict affirms the place
 *  is fine for practice (it only reads a little less precisely) and carries the
 *  standing "checking again anytime is fine" — never a relocation order. */
export const MIC_CHECK_VERDICT_COPY: Record<MicCheckVerdict, string> = {
  good: 'Your mic is ready — clear voice, quiet room.',
  'too-quiet': 'Your voice is faint here — move closer to the mic or lift the input level.',
  noisy: "There's a lot of room noise, so the readings come out a little less precise. This is still a fine place to practice — checking again anytime is fine.",
  clipping: 'The mic is running hot — lower the input level a touch.',
};

/** Fix 5: cancel copy — a stopped check is a non-event, never an error tone. */
export const MIC_CHECK_CANCELLED_COPY = 'Stopped — no problem. Run the check again whenever you like.';

/** Fix 5: the quiet stop affordance label while a check is running. */
export const MIC_CHECK_STOP_LABEL = 'Stop the check';

/** Fix 5: re-offer threshold — the live noise floor sitting this many dB above
 *  the stored check's floor means the room sounds meaningfully different. */
export const MIC_CHECK_NOISE_FLOOR_DEVIATION_DB = 10;

/** Fix 5: the quiet, once-per-session re-offer line (a coach-thread line, not a
 *  dialog) when the room has drifted loud since the stored check. */
export const MIC_CHECK_NOISE_SHIFT_LINE =
  'The room sounds different from the last mic check — running it again anytime is fine, and practicing right here is fine too.';

export type MicCheckFrameStats = {
  /** Linear RMS of the frame, 0..1 (PCM16 normalized by 32768). */
  rms: number;
  /** Fraction of samples in the frame at/over saturation (|x| >= 0.985). */
  clippedFraction: number;
};

export type MicCheckMeasurement = {
  noiseFloorDb: number;
  speechDb: number;
  snrDb: number;
  clippingPct: number;
};

export type MicCheckResult = MicCheckMeasurement & {
  deviceId: string;
  captureReliability: number;
  verdict: MicCheckVerdict;
  at: number;
};

export type MicCheckStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const RMS_DB_FLOOR = 1e-5; // matches the analyzer's loudness clamp (-100 dB)

export function rmsToDb(rms: number): number {
  return 20 * Math.log10(Math.max(Number(rms) || 0, RMS_DB_FLOOR));
}

function percentile(values: number[], pct: number): number {
  if (!values.length) {
    return 0;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (Math.min(100, Math.max(0, pct)) / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) {
    return sorted[low];
  }
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/** Per-frame stats from a little-endian PCM16 frame (the worklet's output). */
export function analyzePcm16Frame(frame: ArrayBuffer): MicCheckFrameStats {
  const samples = new Int16Array(frame);
  if (!samples.length) {
    return { rms: 0, clippedFraction: 0 };
  }
  let sumSquares = 0;
  let clipped = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const normalized = samples[i] / 32768;
    sumSquares += normalized * normalized;
    if (Math.abs(normalized) >= 0.985) {
      clipped += 1;
    }
  }
  return {
    rms: Math.sqrt(sumSquares / samples.length),
    clippedFraction: clipped / samples.length,
  };
}

/**
 * Aggregate the two phases into the measurement.
 *  - noise floor: median quiet-phase frame RMS -> dB (the whole phase IS the
 *    floor; the median stays robust to a cough or chair creak).
 *  - speech level: 75th-percentile speech-phase frame RMS -> dB (robust to the
 *    silent gaps around the spoken line without chasing one peak).
 *  - SNR: speech level minus noise floor.
 *  - clipping: mean clipped-sample fraction across the SPEECH phase (a quiet
 *    room cannot clip; the hot-gain fault shows while speaking).
 */
export function summarizeMicCheck(
  quietFrames: MicCheckFrameStats[],
  speechFrames: MicCheckFrameStats[],
): MicCheckMeasurement {
  const noiseFloorDb = rmsToDb(percentile(quietFrames.map((f) => f.rms), 50));
  const speechDb = rmsToDb(percentile(speechFrames.map((f) => f.rms), 75));
  const clippingPct = speechFrames.length
    ? speechFrames.reduce((total, f) => total + f.clippedFraction, 0) / speechFrames.length
    : 0;
  return {
    noiseFloorDb: Number(noiseFloorDb.toFixed(2)),
    speechDb: Number(speechDb.toFixed(2)),
    snrDb: Number((speechDb - noiseFloorDb).toFixed(2)),
    clippingPct: Number(clippingPct.toFixed(4)),
  };
}

/**
 * Verdict order matters: a hot mic clips regardless of level, so clipping wins;
 * a faint voice explains a low SNR better than "noise" does, so quiet is
 * checked before noisy.
 */
export function deriveMicCheckVerdict(measurement: MicCheckMeasurement): MicCheckVerdict {
  if (measurement.clippingPct >= MIC_CHECK_MAX_CLIPPING_PCT) {
    return 'clipping';
  }
  if (measurement.speechDb < MIC_CHECK_MIN_SPEECH_DB) {
    return 'too-quiet';
  }
  if (measurement.snrDb < MIC_CHECK_MIN_SNR_DB) {
    return 'noisy';
  }
  return 'good';
}

/**
 * The same channel composite the analyzer computes attempt-level
 * (audio_analysis.build_attempt_metrics): SNR 0.45 · clipping 0.25 ·
 * level 0.30, each clamped 0..1. Here all three components always exist, so no
 * renormalization branch is needed.
 */
export function computeMicCheckCaptureReliability(measurement: MicCheckMeasurement): number {
  const snrComponent = clamp01(measurement.snrDb / 24);
  const clipComponent = clamp01(1 - measurement.clippingPct / 0.05);
  const levelComponent = clamp01((measurement.speechDb + 45) / 25);
  return Number((0.45 * snrComponent + 0.25 * clipComponent + 0.3 * levelComponent).toFixed(3));
}

export function buildMicCheckResult(
  deviceId: string,
  measurement: MicCheckMeasurement,
  at = Date.now(),
): MicCheckResult {
  return {
    deviceId,
    ...measurement,
    captureReliability: computeMicCheckCaptureReliability(measurement),
    verdict: deriveMicCheckVerdict(measurement),
    at,
  };
}

export function micCheckStorageKey(deviceId: string): string {
  return `${MIC_CHECK_STORAGE_PREFIX}${(deviceId || 'default').trim() || 'default'}`;
}

export function readStoredMicCheck(
  storage: MicCheckStorage | null,
  deviceId: string,
): MicCheckResult | null {
  if (!storage) {
    return null;
  }
  try {
    const raw = storage.getItem(micCheckStorageKey(deviceId));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<MicCheckResult>;
    if (
      !parsed
      || typeof parsed !== 'object'
      || !Number.isFinite(Number(parsed.snrDb))
      || !Number.isFinite(Number(parsed.noiseFloorDb))
      || !Number.isFinite(Number(parsed.clippingPct))
      || !Number.isFinite(Number(parsed.at))
    ) {
      return null;
    }
    const measurement: MicCheckMeasurement = {
      noiseFloorDb: Number(parsed.noiseFloorDb),
      speechDb: Number(parsed.speechDb ?? 0),
      snrDb: Number(parsed.snrDb),
      clippingPct: Number(parsed.clippingPct),
    };
    return {
      deviceId: (deviceId || 'default').trim() || 'default',
      ...measurement,
      captureReliability: Number.isFinite(Number(parsed.captureReliability))
        ? Number(parsed.captureReliability)
        : computeMicCheckCaptureReliability(measurement),
      verdict: deriveMicCheckVerdict(measurement),
      at: Number(parsed.at),
    };
  } catch {
    return null;
  }
}

export function writeStoredMicCheck(
  storage: MicCheckStorage | null,
  result: MicCheckResult,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(
      micCheckStorageKey(result.deviceId),
      JSON.stringify({
        noiseFloorDb: result.noiseFloorDb,
        speechDb: result.speechDb,
        snrDb: result.snrDb,
        clippingPct: result.clippingPct,
        captureReliability: result.captureReliability,
        verdict: result.verdict,
        at: result.at,
      }),
    );
  } catch {
    // Storage may be unavailable (private mode) — the check still ran.
  }
}

/** Offer the check when this device has never been measured. */
export function shouldOfferMicCheck(
  storage: MicCheckStorage | null,
  deviceId: string,
): boolean {
  return readStoredMicCheck(storage, deviceId) == null;
}

/** The live session state fields the gates/UI read (state.ts voiceInputRuntime). */
export function buildMicCheckRuntimePatch(
  result: MicCheckResult,
): Partial<VoiceInputRuntimeState> {
  return {
    lastNoiseFloorDb: result.noiseFloorDb,
    lastAverageLevelDb: result.speechDb,
    lastSnrDb: result.snrDb,
    lastClippingPct: result.clippingPct,
    lastCaptureReliability: result.captureReliability,
  };
}

export type MicCheckPhase = 'quiet' | 'speech';

export type MicCheckCaptureCallbacks = {
  /** Fired when a phase begins. */
  onPhase?: (phase: MicCheckPhase) => void;
  /** Fired ~10x/sec with overall progress 0..1 across both phases. */
  onProgress?: (fraction: number) => void;
};

export type MicCheckCaptureOptions = MicCheckCaptureCallbacks & {
  deviceId?: string;
  quietMs?: number;
  speechMs?: number;
  /** Fix 5: polled each tick — returning true tears down mid-run and resolves
   *  with `cancelled: true` (partial frames are discarded by the caller). */
  isCancelled?: () => boolean;
};

export type MicCheckCaptureResult = {
  quietFrames: MicCheckFrameStats[];
  speechFrames: MicCheckFrameStats[];
  cancelled?: boolean;
};

/**
 * Run the two-phase capture on the SAME plumbing the front-door mic recording
 * uses: getUserMedia with AGC/NS/EC off (the measurement contract), a shared
 * AudioContext, and the PCM16 worklet capture. Resolves with the raw phase
 * frame stats; the caller summarizes/persists/announces.
 */
export async function runVoiceMicCheckCapture(
  options: MicCheckCaptureOptions = {},
): Promise<MicCheckCaptureResult> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Microphone capture is not available in this browser.');
  }
  const deviceId = (options.deviceId || '').trim();
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
      ...(deviceId && deviceId !== 'default' ? { deviceId: { ideal: deviceId } } : {}),
    },
  });

  const audioContext = createVoiceAudioContext();
  const sourceNode = audioContext.createMediaStreamSource(stream);
  const quietMs = options.quietMs ?? MIC_CHECK_QUIET_MS;
  const speechMs = options.speechMs ?? MIC_CHECK_SPEECH_MS;
  const totalMs = quietMs + speechMs;
  const quietFrames: MicCheckFrameStats[] = [];
  const speechFrames: MicCheckFrameStats[] = [];
  let phase: MicCheckPhase = 'quiet';
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
      outputSampleRate: MIC_CHECK_SAMPLE_RATE,
      frameSize: MIC_CHECK_FRAME_SIZE,
      onFrame: (frame) => {
        const stats = analyzePcm16Frame(frame);
        (phase === 'quiet' ? quietFrames : speechFrames).push(stats);
      },
    });
    await capture.start();
  } catch (error) {
    teardown();
    throw error instanceof Error ? error : new Error(String(error));
  }

  options.onPhase?.('quiet');
  const startedAt = Date.now();

  return new Promise((resolve) => {
    tickTimer = setInterval(() => {
      // Fix 5: cancel is a clean early resolve — same teardown, no error path.
      if (options.isCancelled?.()) {
        teardown();
        resolve({ quietFrames, speechFrames, cancelled: true });
        return;
      }
      const elapsed = Date.now() - startedAt;
      options.onProgress?.(Math.min(1, elapsed / totalMs));
      if (phase === 'quiet' && elapsed >= quietMs) {
        phase = 'speech';
        options.onPhase?.('speech');
      }
      if (elapsed >= totalMs) {
        teardown();
        resolve({ quietFrames, speechFrames });
      }
    }, 100);
  });
}

/* ===========================================================================
 * DOM wiring — the calm #voice-mic-check panel (template section in BOTH
 * voice-tutor-template.html and standalone-template.ts), its front-door and
 * advanced-drawer affordances, and the device-change re-offer.
 * ======================================================================== */

export type VoiceMicCheckSetupOptions = {
  doc: Document;
  storage: MicCheckStorage | null;
  /** The active input deviceId (advanced-drawer select / stored preference). */
  getDeviceId: () => string;
  /** Feed the live session state the gates/UI read (store + backend patch). */
  applyRuntimeQuality: (patch: Partial<VoiceInputRuntimeState>, result: MicCheckResult) => void;
  /** The standalone log line (appendStandaloneLog pattern). */
  addLog?: (kind: string, message: string) => void;
  /** Called when the panel closes (e.g. reveal the front-door chooser again). */
  onClosed?: () => void;
  /** Fix 5: fired at most ONCE per setup when the live noise floor sits
   *  ≥ MIC_CHECK_NOISE_FLOOR_DEVIATION_DB above this device's stored check —
   *  the caller surfaces MIC_CHECK_NOISE_SHIFT_LINE quietly (never a modal). */
  onNoiseFloorShift?: (details: { liveNoiseFloorDb: number; storedNoiseFloorDb: number }) => void;
  /** Test seam: replace the real capture with a synthetic one. */
  capture?: (options: MicCheckCaptureOptions) => Promise<MicCheckCaptureResult>;
};

export type VoiceMicCheckHandle = {
  open: (reason: 'first-run' | 'manual' | 'device-change') => void;
  close: () => void;
  /** Open only when this device has no stored result. Returns whether opened. */
  maybeOffer: (reason: 'first-run' | 'device-change', deviceId?: string) => boolean;
  /** Fix 5: stop a running check — partial results are discarded cleanly. */
  cancel: () => void;
  /** Fix 5: feed the live runtime noise floor (render-loop driven); compares
   *  against the stored check and quietly re-offers once on strong deviation. */
  observeLiveNoiseFloor: (liveNoiseFloorDb: number | null | undefined) => void;
  isRunning: () => boolean;
  dispose: () => void;
};

function formatMicCheckNumbers(result: MicCheckResult): string {
  return `noise ${result.noiseFloorDb.toFixed(1)} dB · voice ${result.speechDb.toFixed(1)} dB · snr ${result.snrDb.toFixed(1)} dB · clipping ${(result.clippingPct * 100).toFixed(1)}%`;
}

export function setupVoiceMicCheck(options: VoiceMicCheckSetupOptions): VoiceMicCheckHandle {
  const { doc } = options;
  const sectionEl = doc.getElementById('voice-mic-check');
  const copyEl = doc.getElementById('voice-mic-check-copy');
  const lineEl = doc.getElementById('voice-mic-check-line');
  const verdictEl = doc.getElementById('voice-mic-check-verdict');
  const progressEl = doc.getElementById('voice-mic-check-progress');
  const startEl = doc.getElementById('voice-mic-check-start') as HTMLButtonElement | null;
  const closeEl = doc.getElementById('voice-mic-check-close') as HTMLButtonElement | null;
  const frontDoorButtonEl = doc.getElementById('voice-front-door-mic-check') as HTMLButtonElement | null;
  const rerunButtonEl = doc.getElementById('voice-mic-check-rerun') as HTMLButtonElement | null;
  const lastEl = doc.getElementById('voice-mic-check-last');
  const deviceSelectEl = doc.getElementById('voice-input-device') as HTMLSelectElement | null;
  const runCapture = options.capture ?? runVoiceMicCheckCapture;
  const log = (kind: string, message: string): void => options.addLog?.(kind, message);
  let running = false;
  let cancelRequested = false;
  let noiseShiftNotified = false;

  const idleCopy = 'Two small steps — a moment of quiet, then one easy line. Quick and done.';

  const renderLastResult = (): void => {
    if (!lastEl) {
      return;
    }
    const stored = readStoredMicCheck(options.storage, options.getDeviceId());
    lastEl.textContent = stored
      ? `Last check: ${MIC_CHECK_VERDICT_COPY[stored.verdict]}`
      : 'No mic check for this input yet.';
  };

  const setProgress = (fraction: number): void => {
    if (progressEl) {
      (progressEl as HTMLElement).style.width = `${Math.round(fraction * 100)}%`;
    }
  };

  const setCloseLabel = (label: string): void => {
    if (closeEl) {
      closeEl.textContent = label;
    }
  };

  const resetPanel = (): void => {
    if (copyEl) {
      copyEl.textContent = idleCopy;
    }
    lineEl?.classList.add('hidden');
    verdictEl?.classList.add('hidden');
    if (verdictEl) {
      verdictEl.textContent = '';
    }
    setProgress(0);
    if (startEl) {
      startEl.disabled = false;
      startEl.textContent = 'Start the mic check';
    }
    setCloseLabel('Not now');
  };

  const open = (reason: 'first-run' | 'manual' | 'device-change'): void => {
    resetPanel();
    sectionEl?.classList.remove('hidden');
    console.info(`[mic-check] opened (${reason}) device=${options.getDeviceId()}`);
  };

  // Fix 5: cancel is always allowed mid-run — a quiet stop, never an error.
  const cancel = (): void => {
    if (!running) {
      return;
    }
    cancelRequested = true;
  };

  const close = (): void => {
    if (running) {
      // Fix 5: mid-run the same affordance stops the check instead of being
      // ignored; the run resolves as cancelled and the panel resets to idle.
      cancel();
      return;
    }
    sectionEl?.classList.add('hidden');
    options.onClosed?.();
  };

  const maybeOffer = (reason: 'first-run' | 'device-change', deviceId?: string): boolean => {
    const targetDeviceId = deviceId ?? options.getDeviceId();
    if (!shouldOfferMicCheck(options.storage, targetDeviceId)) {
      return false;
    }
    open(reason);
    return true;
  };

  const start = async (): Promise<void> => {
    if (running) {
      return;
    }
    running = true;
    cancelRequested = false;
    const deviceId = options.getDeviceId();
    console.info(`[mic-check] started device=${deviceId}`);
    if (startEl) {
      startEl.disabled = true;
      startEl.textContent = 'Listening…';
    }
    setCloseLabel(MIC_CHECK_STOP_LABEL);
    verdictEl?.classList.add('hidden');
    try {
      const { quietFrames, speechFrames, cancelled } = await runCapture({
        deviceId,
        isCancelled: () => cancelRequested,
        onPhase: (phase) => {
          console.info(`[mic-check] phase=${phase}`);
          if (phase === 'quiet') {
            if (copyEl) {
              copyEl.textContent = 'Stay quiet a moment — listening to the room…';
            }
            lineEl?.classList.add('hidden');
          } else {
            if (copyEl) {
              copyEl.textContent = 'Now say one easy line:';
            }
            lineEl?.classList.remove('hidden');
          }
        },
        onProgress: setProgress,
      });
      if (cancelled || cancelRequested) {
        // Fix 5: partial results are discarded cleanly — nothing is stored,
        // nothing is patched into the runtime, no error tone anywhere.
        console.info('[mic-check] cancelled — partial results discarded');
        log('system', 'Mic check stopped — nothing saved');
        resetPanel();
        if (copyEl) {
          copyEl.textContent = MIC_CHECK_CANCELLED_COPY;
        }
        return;
      }
      const measurement = summarizeMicCheck(quietFrames, speechFrames);
      const result = buildMicCheckResult(deviceId, measurement);
      writeStoredMicCheck(options.storage, result);
      options.applyRuntimeQuality(buildMicCheckRuntimePatch(result), result);
      console.info(`[mic-check] verdict=${result.verdict} ${formatMicCheckNumbers(result)} captureReliability=${result.captureReliability}`);
      log('system', `Mic check: ${result.verdict} (${formatMicCheckNumbers(result)})`);
      if (copyEl) {
        copyEl.textContent = 'Here is what we heard:';
      }
      lineEl?.classList.add('hidden');
      if (verdictEl) {
        verdictEl.textContent = MIC_CHECK_VERDICT_COPY[result.verdict];
        verdictEl.classList.remove('hidden');
      }
      if (startEl) {
        startEl.disabled = false;
        startEl.textContent = 'Check again';
      }
      renderLastResult();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.info(`[mic-check] failed: ${message}`);
      log('warning', `Mic check could not run: ${message}`);
      if (copyEl) {
        copyEl.textContent = 'We could not reach the microphone — check the browser permission, then try again.';
      }
      if (startEl) {
        startEl.disabled = false;
        startEl.textContent = 'Try again';
      }
    } finally {
      running = false;
      cancelRequested = false;
      setCloseLabel('Not now');
    }
  };

  // Fix 5: quiet re-offer when the live room stops matching the stored check.
  // Once per setup, threshold-gated, and only ever a callback — the caller
  // surfaces one ignorable line; this never opens the dialog on its own.
  const observeLiveNoiseFloor = (liveNoiseFloorDb: number | null | undefined): void => {
    if (noiseShiftNotified || running) {
      return;
    }
    if (liveNoiseFloorDb == null) {
      return; // no live reading yet (Number(null) would read as 0 dB — a trap)
    }
    const liveDb = Number(liveNoiseFloorDb);
    if (!Number.isFinite(liveDb)) {
      return;
    }
    const stored = readStoredMicCheck(options.storage, options.getDeviceId());
    if (!stored || !Number.isFinite(stored.noiseFloorDb)) {
      return;
    }
    if (liveDb - stored.noiseFloorDb < MIC_CHECK_NOISE_FLOOR_DEVIATION_DB) {
      return;
    }
    noiseShiftNotified = true;
    console.info(`[mic-check] live noise floor ${liveDb.toFixed(1)} dB vs stored ${stored.noiseFloorDb.toFixed(1)} dB — quiet re-offer`);
    log('system', 'Mic check re-offer: room noise has shifted since the stored check');
    options.onNoiseFloorShift?.({ liveNoiseFloorDb: liveDb, storedNoiseFloorDb: stored.noiseFloorDb });
  };

  const onStartClick = (): void => {
    void start();
  };
  const onCloseClick = (): void => {
    close();
  };
  const onAffordanceClick = (): void => {
    open('manual');
  };
  const onDeviceChange = (): void => {
    const deviceId = deviceSelectEl?.value || options.getDeviceId();
    renderLastResult();
    if (maybeOffer('device-change', deviceId)) {
      console.info(`[mic-check] device changed to ${deviceId} — offering a fresh check`);
    }
  };
  // Fix 5: Escape cancels a running check (quietly); on an idle open panel it
  // simply closes — the same paths the buttons take, nothing new to learn.
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape') {
      return;
    }
    if (!sectionEl || sectionEl.classList.contains('hidden')) {
      return;
    }
    if (running) {
      cancel();
    } else {
      close();
    }
  };

  startEl?.addEventListener('click', onStartClick);
  closeEl?.addEventListener('click', onCloseClick);
  frontDoorButtonEl?.addEventListener('click', onAffordanceClick);
  rerunButtonEl?.addEventListener('click', onAffordanceClick);
  deviceSelectEl?.addEventListener('change', onDeviceChange);
  doc.addEventListener('keydown', onKeyDown);
  renderLastResult();

  return {
    open,
    close,
    maybeOffer,
    cancel,
    observeLiveNoiseFloor,
    isRunning: () => running,
    dispose: () => {
      startEl?.removeEventListener('click', onStartClick);
      closeEl?.removeEventListener('click', onCloseClick);
      frontDoorButtonEl?.removeEventListener('click', onAffordanceClick);
      rerunButtonEl?.removeEventListener('click', onAffordanceClick);
      deviceSelectEl?.removeEventListener('change', onDeviceChange);
      doc.removeEventListener('keydown', onKeyDown);
    },
  };
}
