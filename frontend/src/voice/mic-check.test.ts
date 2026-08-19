import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  analyzePcm16Frame,
  buildMicCheckResult,
  buildMicCheckRuntimePatch,
  computeMicCheckCaptureReliability,
  deriveMicCheckVerdict,
  MIC_CHECK_CANCELLED_COPY,
  MIC_CHECK_NOISE_FLOOR_DEVIATION_DB,
  MIC_CHECK_STOP_LABEL,
  MIC_CHECK_STORAGE_PREFIX,
  MIC_CHECK_VERDICT_COPY,
  micCheckStorageKey,
  readStoredMicCheck,
  setupVoiceMicCheck,
  shouldOfferMicCheck,
  summarizeMicCheck,
  writeStoredMicCheck,
  type MicCheckCaptureOptions,
  type MicCheckCaptureResult,
  type MicCheckFrameStats,
  type MicCheckStorage,
} from './mic-check';

function pcm16Frame(amplitude: number, length = 1024, clippedFraction = 0): ArrayBuffer {
  const samples = new Int16Array(length);
  const clippedCount = Math.round(length * clippedFraction);
  for (let i = 0; i < length; i += 1) {
    if (i < clippedCount) {
      samples[i] = i % 2 === 0 ? 32767 : -32768;
    } else {
      const value = Math.round(amplitude * 32768);
      samples[i] = i % 2 === 0 ? value : -value;
    }
  }
  return samples.buffer;
}

function statsFrames(rms: number, count: number, clippedFraction = 0): MicCheckFrameStats[] {
  return Array.from({ length: count }, () => ({ rms, clippedFraction }));
}

function fakeStorage(): MicCheckStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe('mic-check frame analysis', () => {
  it('measures RMS and clipping from a PCM16 frame', () => {
    const clean = analyzePcm16Frame(pcm16Frame(0.05));
    expect(clean.rms).toBeCloseTo(0.05, 3);
    expect(clean.clippedFraction).toBe(0);

    const hot = analyzePcm16Frame(pcm16Frame(0.5, 1024, 0.1));
    expect(hot.clippedFraction).toBeCloseTo(0.1, 2);
  });

  it('handles an empty frame without NaN', () => {
    expect(analyzePcm16Frame(new ArrayBuffer(0))).toEqual({ rms: 0, clippedFraction: 0 });
  });
});

describe('mic-check verdicts from synthetic frame series', () => {
  it('good: clear voice over a quiet room', () => {
    const measurement = summarizeMicCheck(statsFrames(0.005, 60), statsFrames(0.05, 70));
    expect(measurement.snrDb).toBeCloseTo(20, 0);
    expect(deriveMicCheckVerdict(measurement)).toBe('good');
  });

  it('too-quiet: faint voice even in a quiet room', () => {
    const measurement = summarizeMicCheck(statsFrames(0.001, 60), statsFrames(0.008, 70));
    expect(measurement.speechDb).toBeLessThan(-33);
    expect(deriveMicCheckVerdict(measurement)).toBe('too-quiet');
  });

  it('noisy: decent voice level but a loud room floor', () => {
    const measurement = summarizeMicCheck(statsFrames(0.02, 60), statsFrames(0.05, 70));
    expect(measurement.snrDb).toBeLessThan(12);
    expect(measurement.speechDb).toBeGreaterThanOrEqual(-33);
    expect(deriveMicCheckVerdict(measurement)).toBe('noisy');
  });

  it('clipping: sustained saturation wins over everything else', () => {
    const measurement = summarizeMicCheck(statsFrames(0.005, 60), statsFrames(0.4, 70, 0.06));
    expect(measurement.clippingPct).toBeGreaterThanOrEqual(0.02);
    expect(deriveMicCheckVerdict(measurement)).toBe('clipping');
  });

  it('mirrors the gates: 1% clipping is tolerated, 2% is not', () => {
    const mild = summarizeMicCheck(statsFrames(0.005, 60), statsFrames(0.05, 70, 0.01));
    expect(deriveMicCheckVerdict(mild)).toBe('good');
    const sustained = summarizeMicCheck(statsFrames(0.005, 60), statsFrames(0.05, 70, 0.02));
    expect(deriveMicCheckVerdict(sustained)).toBe('clipping');
  });

  it('captureReliability composite rises with clean capture and falls with faults', () => {
    const good = computeMicCheckCaptureReliability({ noiseFloorDb: -60, speechDb: -20, snrDb: 40, clippingPct: 0 });
    const bad = computeMicCheckCaptureReliability({ noiseFloorDb: -30, speechDb: -40, snrDb: 4, clippingPct: 0.06 });
    expect(good).toBeGreaterThan(0.9);
    expect(bad).toBeLessThan(0.3);
  });
});

describe('mic-check persistence per device', () => {
  it('round-trips a result and keys by deviceId', () => {
    const storage = fakeStorage();
    const result = buildMicCheckResult('usb-mic-1', {
      noiseFloorDb: -52.1, speechDb: -24.5, snrDb: 27.6, clippingPct: 0.001,
    }, 1770000000000);
    writeStoredMicCheck(storage, result);

    expect(storage.data.has(`${MIC_CHECK_STORAGE_PREFIX}usb-mic-1`)).toBe(true);
    const restored = readStoredMicCheck(storage, 'usb-mic-1');
    expect(restored).not.toBeNull();
    expect(restored?.snrDb).toBe(27.6);
    expect(restored?.verdict).toBe('good');
    expect(restored?.at).toBe(1770000000000);
    expect(readStoredMicCheck(storage, 'other-device')).toBeNull();
  });

  it('treats corrupted JSON as absent', () => {
    const storage = fakeStorage();
    storage.setItem(micCheckStorageKey('default'), '{not json');
    expect(readStoredMicCheck(storage, 'default')).toBeNull();
    expect(shouldOfferMicCheck(storage, 'default')).toBe(true);
  });

  it('offers on first run and re-offers on a device change only', () => {
    const storage = fakeStorage();
    expect(shouldOfferMicCheck(storage, 'default')).toBe(true);
    writeStoredMicCheck(storage, buildMicCheckResult('default', {
      noiseFloorDb: -50, speechDb: -25, snrDb: 25, clippingPct: 0,
    }));
    expect(shouldOfferMicCheck(storage, 'default')).toBe(false);
    // A NEW input device has no stored result -> offer again.
    expect(shouldOfferMicCheck(storage, 'headset-77')).toBe(true);
  });
});

describe('mic-check runtime crossing (state fields the gates read)', () => {
  it('builds the exact voiceInputRuntime patch fields', () => {
    const result = buildMicCheckResult('default', {
      noiseFloorDb: -50, speechDb: -25, snrDb: 25, clippingPct: 0.004,
    });
    expect(buildMicCheckRuntimePatch(result)).toEqual({
      lastNoiseFloorDb: -50,
      lastAverageLevelDb: -25,
      lastSnrDb: 25,
      lastClippingPct: 0.004,
      lastCaptureReliability: result.captureReliability,
    });
  });
});

describe('mic-check DOM wiring', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button type="button" id="voice-front-door-mic-check"></button>
      <section id="voice-mic-check" class="hidden">
        <p id="voice-mic-check-copy"></p>
        <p id="voice-mic-check-line" class="hidden"></p>
        <span id="voice-mic-check-progress"></span>
        <p id="voice-mic-check-verdict" class="hidden"></p>
        <button type="button" id="voice-mic-check-start"></button>
        <button type="button" id="voice-mic-check-close"></button>
      </section>
      <select id="voice-input-device">
        <option value="default" selected>default</option>
        <option value="headset-77">headset</option>
      </select>
      <button id="voice-mic-check-rerun" type="button"></button>
      <p id="voice-mic-check-last"></p>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('runs the two phases, announces the verdict in ink, persists, and feeds the runtime', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const storage = fakeStorage();
    const applied: unknown[] = [];
    const logs: string[] = [];
    const handle = setupVoiceMicCheck({
      doc: document,
      storage,
      getDeviceId: () => 'default',
      applyRuntimeQuality: (patch) => applied.push(patch),
      addLog: (kind, message) => logs.push(`${kind}:${message}`),
      capture: async (options) => {
        options.onPhase?.('quiet');
        options.onProgress?.(0.4);
        options.onPhase?.('speech');
        options.onProgress?.(1);
        return {
          quietFrames: [pcm16Frame(0.005), pcm16Frame(0.005)].map(analyzePcm16Frame),
          speechFrames: [pcm16Frame(0.05), pcm16Frame(0.05)].map(analyzePcm16Frame),
        };
      },
    });

    handle.open('first-run');
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(false);

    (document.getElementById('voice-mic-check-start') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(document.getElementById('voice-mic-check-verdict')?.classList.contains('hidden')).toBe(false);
    });

    const verdictText = document.getElementById('voice-mic-check-verdict')?.textContent;
    expect(verdictText).toBe(MIC_CHECK_VERDICT_COPY.good);
    expect(readStoredMicCheck(storage, 'default')?.verdict).toBe('good');
    expect(applied).toHaveLength(1);
    expect((applied[0] as { lastSnrDb: number }).lastSnrDb).toBeCloseTo(20, 0);
    expect(logs.some((line) => line.startsWith('system:Mic check: good'))).toBe(true);
    // '[mic-check]' console witnesses fired (started + phases + verdict).
    const witnessLines = infoSpy.mock.calls.map((call) => String(call[0]));
    expect(witnessLines.some((line) => line.startsWith('[mic-check] started'))).toBe(true);
    expect(witnessLines.some((line) => line.startsWith('[mic-check] verdict=good'))).toBe(true);

    handle.close();
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(true);
    handle.dispose();
  });

  it('re-offers when the input device changes to an unmeasured one', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const storage = fakeStorage();
    // Current device already measured -> no offer on setup or same-device change.
    writeStoredMicCheck(storage, buildMicCheckResult('default', {
      noiseFloorDb: -50, speechDb: -25, snrDb: 25, clippingPct: 0,
    }));
    const select = document.getElementById('voice-input-device') as HTMLSelectElement;
    const handle = setupVoiceMicCheck({
      doc: document,
      storage,
      getDeviceId: () => select.value,
      applyRuntimeQuality: () => undefined,
      capture: async () => ({ quietFrames: [], speechFrames: [] }),
    });

    expect(handle.maybeOffer('first-run')).toBe(false);
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(true);

    select.value = 'headset-77';
    select.dispatchEvent(new Event('change'));
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(false);
    handle.dispose();
  });

  it('front-door and drawer affordances open the panel manually', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const storage = fakeStorage();
    const handle = setupVoiceMicCheck({
      doc: document,
      storage,
      getDeviceId: () => 'default',
      applyRuntimeQuality: () => undefined,
      capture: async () => ({ quietFrames: [], speechFrames: [] }),
    });
    (document.getElementById('voice-front-door-mic-check') as HTMLButtonElement).click();
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(false);
    handle.close();
    (document.getElementById('voice-mic-check-rerun') as HTMLButtonElement).click();
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(false);
    handle.dispose();
  });

  it('reports a calm failure line when capture cannot start', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const logs: string[] = [];
    const handle = setupVoiceMicCheck({
      doc: document,
      storage: fakeStorage(),
      getDeviceId: () => 'default',
      applyRuntimeQuality: () => undefined,
      addLog: (kind, message) => logs.push(`${kind}:${message}`),
      capture: async () => {
        throw new Error('Permission denied');
      },
    });
    handle.open('manual');
    (document.getElementById('voice-mic-check-start') as HTMLButtonElement).click();
    await vi.waitFor(() => {
      expect(logs.some((line) => line.startsWith('warning:Mic check could not run'))).toBe(true);
    });
    expect(document.getElementById('voice-mic-check-copy')?.textContent).toContain('could not reach the microphone');
    handle.dispose();
  });
});

describe('mic-check softening (abandon-trigger fix 5)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button type="button" id="voice-front-door-mic-check"></button>
      <section id="voice-mic-check" class="hidden">
        <p id="voice-mic-check-copy"></p>
        <p id="voice-mic-check-line" class="hidden"></p>
        <span id="voice-mic-check-progress"></span>
        <p id="voice-mic-check-verdict" class="hidden"></p>
        <button type="button" id="voice-mic-check-start"></button>
        <button type="button" id="voice-mic-check-close">Not now</button>
      </section>
      <p id="voice-mic-check-last"></p>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  function cancellableCapture() {
    return async (options: MicCheckCaptureOptions): Promise<MicCheckCaptureResult> => {
      // Wait until the DOM layer flips its cancel flag, like the real tick loop.
      await vi.waitFor(() => {
        expect(options.isCancelled?.()).toBe(true);
      });
      return {
        quietFrames: [analyzePcm16Frame(pcm16Frame(0.005))],
        speechFrames: [],
        cancelled: true,
      };
    };
  }

  it('the close affordance becomes a quiet Stop mid-run and discards partials cleanly', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const storage = fakeStorage();
    const applied: unknown[] = [];
    const logs: string[] = [];
    const handle = setupVoiceMicCheck({
      doc: document,
      storage,
      getDeviceId: () => 'default',
      applyRuntimeQuality: (patch) => applied.push(patch),
      addLog: (kind, message) => logs.push(`${kind}:${message}`),
      capture: cancellableCapture(),
    });

    handle.open('manual');
    const closeEl = document.getElementById('voice-mic-check-close') as HTMLButtonElement;
    expect(closeEl.textContent).toBe('Not now');
    (document.getElementById('voice-mic-check-start') as HTMLButtonElement).click();
    expect(closeEl.textContent).toBe(MIC_CHECK_STOP_LABEL);

    closeEl.click(); // mid-run: stop, not close
    await vi.waitFor(() => {
      expect(document.getElementById('voice-mic-check-copy')?.textContent).toBe(MIC_CHECK_CANCELLED_COPY);
    });

    // Discarded cleanly: nothing stored, nothing patched, no error tone.
    expect(storage.data.size).toBe(0);
    expect(applied).toHaveLength(0);
    expect(logs.some((line) => line.startsWith('warning:'))).toBe(false);
    expect(logs.some((line) => line.includes('nothing saved'))).toBe(true);
    // The panel stayed open at idle, ready to run again or close.
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(false);
    expect((document.getElementById('voice-mic-check-start') as HTMLButtonElement).disabled).toBe(false);
    expect(closeEl.textContent).toBe('Not now');
    handle.dispose();
  });

  it('Escape cancels a running check; on an idle panel it closes', async () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const handle = setupVoiceMicCheck({
      doc: document,
      storage: fakeStorage(),
      getDeviceId: () => 'default',
      applyRuntimeQuality: () => undefined,
      capture: cancellableCapture(),
    });
    handle.open('manual');
    (document.getElementById('voice-mic-check-start') as HTMLButtonElement).click();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await vi.waitFor(() => {
      expect(document.getElementById('voice-mic-check-copy')?.textContent).toBe(MIC_CHECK_CANCELLED_COPY);
    });
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(true);
    handle.dispose();
  });

  it('noisy verdict affirms the place and invites re-checking — no relocation order', () => {
    const noisy = MIC_CHECK_VERDICT_COPY.noisy;
    expect(noisy).toContain('checking again anytime is fine');
    expect(noisy.toLowerCase()).toContain('still a fine place to practice');
    // The old copy nudged the person to move ("a quieter spot") — gone.
    expect(noisy.toLowerCase()).not.toContain('quieter spot');
    expect(noisy.toLowerCase()).not.toContain('move somewhere');
  });

  it('re-offers quietly, ONCE, when the live noise floor drifts strongly above the stored check', () => {
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const storage = fakeStorage();
    writeStoredMicCheck(storage, buildMicCheckResult('default', {
      noiseFloorDb: -50, speechDb: -25, snrDb: 25, clippingPct: 0,
    }));
    const shifts: unknown[] = [];
    const handle = setupVoiceMicCheck({
      doc: document,
      storage,
      getDeviceId: () => 'default',
      applyRuntimeQuality: () => undefined,
      onNoiseFloorShift: (details) => shifts.push(details),
      capture: async () => ({ quietFrames: [], speechFrames: [] }),
    });

    handle.observeLiveNoiseFloor(null); // no data -> no offer
    handle.observeLiveNoiseFloor(-45); // 5 dB over -> under the threshold
    expect(shifts).toHaveLength(0);

    handle.observeLiveNoiseFloor(-50 + MIC_CHECK_NOISE_FLOOR_DEVIATION_DB); // exactly at threshold
    expect(shifts).toHaveLength(1);
    expect(shifts[0]).toEqual({ liveNoiseFloorDb: -40, storedNoiseFloorDb: -50 });

    // Quiet and once: further drift never re-fires, and no dialog ever opened.
    handle.observeLiveNoiseFloor(-20);
    expect(shifts).toHaveLength(1);
    expect(document.getElementById('voice-mic-check')?.classList.contains('hidden')).toBe(true);
    handle.dispose();
  });

  it('never re-offers without a stored check to compare against', () => {
    const shifts: unknown[] = [];
    const handle = setupVoiceMicCheck({
      doc: document,
      storage: fakeStorage(),
      getDeviceId: () => 'default',
      applyRuntimeQuality: () => undefined,
      onNoiseFloorShift: (details) => shifts.push(details),
      capture: async () => ({ quietFrames: [], speechFrames: [] }),
    });
    handle.observeLiveNoiseFloor(-10);
    expect(shifts).toHaveLength(0);
    handle.dispose();
  });
});
