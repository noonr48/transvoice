import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VoiceLiveFrame } from './state';
import { createVoiceRuntimeStore } from './runtime-store';
import {
  buildVoiceAudioInputDevices,
  compressVoiceTimeline,
  createVoiceBrowserRuntime,
  ensureVoiceCueSheetCard,
  readVoiceInputDevicePreference,
  refreshVoiceAudioInputDevices,
  VOICE_AUDIO_INPUT_PREFERENCE_FALLBACK_NOTICE,
  VOICE_AUDIO_INPUT_UNAVAILABLE_MESSAGE,
  VOICE_INPUT_DEVICE_STORAGE_KEY,
  writeVoiceInputDevicePreference,
  type VoiceBrowserMediaDevices,
  type VoiceInputDeviceStorage,
} from './browser-runtime';

function createDevice(
  kind: MediaDeviceKind,
  overrides: Partial<MediaDeviceInfo> = {},
): MediaDeviceInfo {
  return {
    deviceId: '',
    groupId: '',
    kind,
    label: '',
    toJSON: () => ({}),
    ...overrides,
  } as MediaDeviceInfo;
}

function createStorage(
  initial: Record<string, string> = {},
): VoiceInputDeviceStorage & {
  values: Map<string, string>;
  getItem: ReturnType<typeof vi.fn>;
  setItem: ReturnType<typeof vi.fn>;
  removeItem: ReturnType<typeof vi.fn>;
} {
  const values = new Map(Object.entries(initial));

  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
  };
}

function createFrames(count: number): VoiceLiveFrame[] {
  return Array.from({ length: count }, (_, index) => ({
    t: index * 10,
    voiced: index % 2 === 0,
    pitchHz: 180 + index,
    pitchScore: 0.5,
    resonanceScore: 0.4,
    weightScore: 0.3,
    confidence: 0.8,
    loudnessDb: -18,
  }));
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('voice browser runtime', () => {
  it('reads and writes trimmed voice input device preferences', () => {
    const storage = createStorage();

    writeVoiceInputDevicePreference('  usb-mic  ', { storage });
    expect(storage.setItem).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY, 'usb-mic');
    expect(readVoiceInputDevicePreference({ storage })).toBe('usb-mic');

    writeVoiceInputDevicePreference('   ', { storage });
    expect(storage.removeItem).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY);
    expect(readVoiceInputDevicePreference({ storage })).toBe(null);
  });

  it('swallows storage failures and warns when preference access is blocked', () => {
    const warn = vi.fn();
    const storage: VoiceInputDeviceStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
      removeItem: () => undefined,
    };

    expect(readVoiceInputDevicePreference({ storage, warn })).toBe(null);
    writeVoiceInputDevicePreference('usb-mic', { storage, warn });

    expect(warn).toHaveBeenNthCalledWith(
      1,
      '[Sloane] Failed to read voice input preference:',
      expect.any(Error),
    );
    expect(warn).toHaveBeenNthCalledWith(
      2,
      '[Sloane] Failed to persist voice input preference:',
      expect.any(Error),
    );
  });

  it('builds browser-visible audio input devices and inserts a default option when needed', () => {
    const devices = buildVoiceAudioInputDevices([
      createDevice('audioinput'),
      createDevice('audiooutput', { deviceId: 'speaker-1', label: 'Speakers' }),
      createDevice('audioinput', { deviceId: 'usb-mic', label: ' USB Mic ', groupId: 'group-2' }),
    ]);

    expect(devices).toEqual([
      {
        deviceId: 'default',
        label: 'System default input',
        groupId: null,
        isDefault: true,
      },
      {
        deviceId: 'audioinput-1',
        label: 'System default input',
        groupId: null,
        isDefault: true,
      },
      {
        deviceId: 'usb-mic',
        label: 'USB Mic',
        groupId: 'group-2',
        isDefault: false,
      },
    ]);
  });

  it('falls back to a default input when the browser cannot enumerate devices', async () => {
    const store = createVoiceRuntimeStore();
    const storage = createStorage({
      [VOICE_INPUT_DEVICE_STORAGE_KEY]: 'stored-mic',
    });
    const render = vi.fn();
    const runtime = createVoiceBrowserRuntime({
      store,
      storage,
      mediaDevices: null,
      render,
      document,
    });

    const devices = await runtime.refreshVoiceAudioInputDevices();

    expect(devices).toEqual([
      {
        deviceId: 'default',
        label: 'System default input',
        groupId: null,
        isDefault: true,
      },
    ]);
    expect(store.getState()).toMatchObject({
      voiceSelectedInputDeviceId: 'stored-mic',
      voiceAudioInputStatus: 'error',
      voiceAudioInputError: VOICE_AUDIO_INPUT_UNAVAILABLE_MESSAGE,
    });
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('refreshes audio input devices, persists the selected device, and keeps renders silent when requested', async () => {
    const store = createVoiceRuntimeStore();
    const storage = createStorage({
      [VOICE_INPUT_DEVICE_STORAGE_KEY]: 'usb-mic',
    });
    const render = vi.fn();
    const mediaDevices: VoiceBrowserMediaDevices = {
      enumerateDevices: vi.fn(async () => [
        createDevice('audioinput', { deviceId: 'default', label: 'Browser default' }),
        createDevice('audioinput', { deviceId: 'usb-mic', label: 'USB Mic' }),
      ]),
    };
    const runtime = createVoiceBrowserRuntime({
      store,
      storage,
      mediaDevices,
      render,
      document,
    });

    const devices = await runtime.refreshVoiceAudioInputDevices(true);

    expect(mediaDevices.enumerateDevices).toHaveBeenCalledTimes(1);
    expect(devices.map((device) => device.deviceId)).toEqual(['default', 'usb-mic']);
    expect(store.getState()).toMatchObject({
      voiceSelectedInputDeviceId: 'usb-mic',
      voiceAudioInputStatus: 'ready',
      voiceAudioInputError: null,
    });
    expect(storage.setItem).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY, 'usb-mic');
    expect(render).not.toHaveBeenCalled();
    expect(runtime.getSelectedVoiceAudioInput()).toMatchObject({
      deviceId: 'usb-mic',
      label: 'USB Mic',
    });
  });

  it('notices when a preferred input disappears during refresh', async () => {
    const store = createVoiceRuntimeStore({
      voiceSelectedInputDeviceId: 'missing-mic',
    });
    const storage = createStorage();
    const mediaDevices: VoiceBrowserMediaDevices = {
      enumerateDevices: vi.fn(async () => [
        createDevice('audioinput', { deviceId: 'default', label: 'Browser default' }),
        createDevice('audioinput', { deviceId: 'built-in', label: 'Built-in mic' }),
      ]),
    };

    const devices = await refreshVoiceAudioInputDevices({
      store,
      mediaDevices,
      readVoiceInputDevicePreference: () => null,
      writeVoiceInputDevicePreference: (deviceId) => {
        writeVoiceInputDevicePreference(deviceId, { storage });
      },
    });

    expect(devices.map((device) => device.deviceId)).toEqual(['default', 'built-in']);
    expect(store.getState()).toMatchObject({
      voiceSelectedInputDeviceId: 'default',
      voiceAudioInputStatus: 'ready',
      voiceAudioInputNotice: VOICE_AUDIO_INPUT_PREFERENCE_FALLBACK_NOTICE,
    });
    expect(storage.setItem).toHaveBeenCalledWith(VOICE_INPUT_DEVICE_STORAGE_KEY, 'default');
  });

  it('captures enumerateDevices failures with a fallback device list', async () => {
    const store = createVoiceRuntimeStore({
      voiceSelectedInputDeviceId: 'usb-mic',
    });
    const mediaDevices: VoiceBrowserMediaDevices = {
      enumerateDevices: vi.fn(async () => {
        throw new Error('scan failed');
      }),
    };

    const devices = await refreshVoiceAudioInputDevices({
      store,
      mediaDevices,
      readVoiceInputDevicePreference: () => 'stored-mic',
    });

    expect(devices).toEqual([
      {
        deviceId: 'default',
        label: 'System default input',
        groupId: null,
        isDefault: true,
      },
    ]);
    expect(store.getState()).toMatchObject({
      voiceSelectedInputDeviceId: 'usb-mic',
      voiceAudioInputStatus: 'error',
      voiceAudioInputError: 'scan failed',
    });
  });

  it('compresses long voice timelines to an even sample of points', () => {
    const compressed = compressVoiceTimeline(createFrames(6), 3);

    expect(compressed).toHaveLength(3);
    expect(compressed.map((frame) => frame.t)).toEqual([0, 30, 50]);
  });

  it('ensures the cue-sheet card is inserted once after the forecast card when present', () => {
    document.body.innerHTML = `
      <div id="voice-lab-panel">
        <div class="voice-lab-grid">
          <section class="voice-practice-card" id="forecast-card">
            <div id="voice-forecast-phrase">Forecast phrase</div>
          </section>
          <section class="voice-practice-card" id="tail-card"></section>
        </div>
      </div>
    `;

    const insertedCard = ensureVoiceCueSheetCard(document);
    const grid = document.querySelector('#voice-lab-panel .voice-lab-grid');

    expect(insertedCard).not.toBeNull();
    expect(grid?.children[1]).toBe(insertedCard);
    expect(insertedCard?.querySelector('#voice-cue-sheet-copy')).toBeInTheDocument();

    const secondCall = ensureVoiceCueSheetCard(document);
    expect(secondCall).toBe(insertedCard);
    expect(document.querySelectorAll('#voice-cue-sheet-copy')).toHaveLength(1);
  });
});
