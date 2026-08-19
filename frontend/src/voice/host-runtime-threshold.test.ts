import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVoiceHostRuntimeComposition } from './host-runtime-composition';
import { createVoiceRuntimeStore } from './runtime-store';

// This jsdom build exposes no window.localStorage (the composition null-guards
// that in production); the stored-mic-check path is exercised through an
// in-memory Storage stub instead.
function createMemoryStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
    setItem: (key: string, value: string) => {
      map.set(key, String(value));
    },
    removeItem: (key: string) => {
      map.delete(key);
    },
    clear: () => {
      map.clear();
    },
  };
}

const memoryStorage = createMemoryStorage();

// Flow lane — noise-adaptive VAD silence threshold:
//   effective = max(base, min(2.5 × noiseFloorRms, 0.06))
// base = advanced-panel override (or the fixed 0.018 default); the noise floor
// comes from the live runtime estimate (voiceInputRuntime.lastNoiseFloorDb)
// first, then the stored per-device mic-check (tvMicCheck:<deviceId>).
// dB → raw RMS conversion: rms = 10^(dB/20).

function createHarness() {
  const store = createVoiceRuntimeStore();
  const browserRuntime = {
    readVoiceInputDevicePreference: vi.fn(() => 'mic-a'),
    writeVoiceInputDevicePreference: vi.fn(),
    buildVoiceAudioInputDevices: vi.fn(() => []),
    getSelectedVoiceAudioInput: vi.fn(() => ({
      deviceId: 'mic-a',
      label: 'Mic A',
      groupId: null,
      isDefault: false,
    })),
    refreshVoiceAudioInputDevices: vi.fn(async () => []),
    compressVoiceTimeline: vi.fn(() => []),
    ensureVoiceCueSheetCard: vi.fn(),
  };

  const composition = createVoiceHostRuntimeComposition({
    store,
    runtimeStatusController: {
      getState: vi.fn(() => ({}) as never),
      applyInputProviderStatusPayload: vi.fn(),
    },
    getCurrentMode: () => 'voice',
    getCurrentSessionId: () => 'session-1',
    getIsConnected: () => true,
    resolveSessionMode: () => 'voice',
    getCoachQuestionInput: () => null,
    render: vi.fn(),
    applyVoiceBackendPayload: vi.fn(),
    submitRuntimeCoachQuestionRequest: vi.fn(),
    prepareConditioningLatentsRequest: vi.fn(),
    getCoachShell: () => null,
    getRuntimeShell: () => null,
    getLiveTransitionController: () => null,
    isSpeechSynthesisBusy: () => false,
    getVoiceSessionStreamUrl: () => 'wss://stream',
    syncPersistedReferenceAnalysis: vi.fn(() => null),
    document,
  }, {
    createVoiceHostActionsController: vi.fn(() => ({}) as never),
    createVoiceAppRuntime: vi.fn(() => ({}) as never),
    createVoiceBrowserRuntime: vi.fn(() => browserRuntime as never),
  });

  function setLiveNoiseFloorDb(noiseFloorDb: number | null): void {
    store.updateUiState((current) => ({
      ...current,
      voiceInputRuntime: {
        ...current.voiceInputRuntime,
        lastNoiseFloorDb: noiseFloorDb,
      },
    }));
  }

  function setPanelThreshold(vadRmsThreshold: number): void {
    store.updateUiState((current) => ({
      ...current,
      advancedPanel: {
        ...current.advancedPanel,
        vadRmsThreshold,
      },
    }));
  }

  return { composition, store, setLiveNoiseFloorDb, setPanelThreshold };
}

describe('noise-adaptive VAD silence threshold', () => {
  beforeEach(() => {
    memoryStorage.clear();
    vi.stubGlobal('localStorage', memoryStorage);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the fixed default when no noise floor is known', () => {
    const harness = createHarness();
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBeCloseTo(0.018, 6);
  });

  it('derives the threshold from the live noise floor (dB → RMS × 2.5)', () => {
    const harness = createHarness();
    // −40 dBFS → rms 0.01 → 2.5 × 0.01 = 0.025 (above the 0.018 default).
    harness.setLiveNoiseFloorDb(-40);
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBeCloseTo(0.025, 6);
  });

  it('never drops below the fixed default in a quiet room', () => {
    const harness = createHarness();
    // −60 dBFS → rms 0.001 → adaptive 0.0025 → clamped up to the 0.018 base.
    harness.setLiveNoiseFloorDb(-60);
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBeCloseTo(0.018, 6);
  });

  it('caps the adaptive lift at the sane max (0.06)', () => {
    const harness = createHarness();
    // −20 dBFS → rms 0.1 → adaptive 0.25 → capped at 0.06.
    harness.setLiveNoiseFloorDb(-20);
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBeCloseTo(0.06, 6);
  });

  it('respects a higher advanced-panel override as the base', () => {
    const harness = createHarness();
    harness.setPanelThreshold(0.03);
    harness.setLiveNoiseFloorDb(-40); // adaptive 0.025 < base 0.03
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBeCloseTo(0.03, 6);
  });

  it('keeps a user base above the adaptive cap intact', () => {
    const harness = createHarness();
    harness.setPanelThreshold(0.08);
    harness.setLiveNoiseFloorDb(-20); // adaptive capped at 0.06 < base 0.08
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBeCloseTo(0.08, 6);
  });

  it('falls back to the stored per-device mic-check floor (tvMicCheck:<deviceId>)', () => {
    memoryStorage.setItem('tvMicCheck:mic-a', JSON.stringify({
      noiseFloorDb: -40,
      speechDb: -20,
      snrDb: 20,
      clippingPct: 0,
      captureReliability: 0.9,
      verdict: 'good',
      at: Date.now(),
    }));
    const harness = createHarness();
    // No live estimate; stored −40 dB → 0.025.
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBeCloseTo(0.025, 6);
  });
});
