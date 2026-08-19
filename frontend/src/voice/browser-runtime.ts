import type { VoiceLiveFrame } from './state';
import type { VoiceAudioInputDevice, VoiceRuntimeStore, VoiceRuntimeStoreState } from './runtime-store';

export const VOICE_INPUT_DEVICE_STORAGE_KEY = 'sloane-voice-input-device-id';
export const VOICE_AUDIO_INPUT_UNAVAILABLE_MESSAGE = 'This browser context cannot list audio inputs.';
export const VOICE_AUDIO_INPUT_PREFERENCE_FALLBACK_NOTICE = 'Your previously selected input is unavailable, so the trainer switched back to the system default input.';

export type VoiceInputDeviceStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type VoiceBrowserMediaDevices = Pick<MediaDevices, 'enumerateDevices'>;
export type VoiceBrowserRuntimeStore = Pick<VoiceRuntimeStore, 'getState' | 'patchState' | 'getSelectedVoiceAudioInput'>;
export type VoiceBrowserRuntimeWarn = (...args: unknown[]) => void;

export type VoiceInputDevicePreferenceOptions = {
  storage?: VoiceInputDeviceStorage | null;
  storageKey?: string;
  warn?: VoiceBrowserRuntimeWarn;
};

export type VoiceAudioInputRefreshOptions = {
  store: Pick<VoiceRuntimeStore, 'getState' | 'patchState'>;
  render?: (() => void) | null;
  silent?: boolean;
  mediaDevices?: VoiceBrowserMediaDevices | null;
  readVoiceInputDevicePreference?: () => string | null;
  writeVoiceInputDevicePreference?: (deviceId: string | null) => void;
  unavailableMessage?: string;
  unavailableNotice?: string;
};

export type VoiceBrowserRuntimeOptions = {
  store: VoiceBrowserRuntimeStore;
  render?: (() => void) | null;
  storage?: VoiceInputDeviceStorage | null;
  mediaDevices?: VoiceBrowserMediaDevices | null;
  document?: Document | null;
  storageKey?: string;
  warn?: VoiceBrowserRuntimeWarn;
};

export type VoiceBrowserRuntime = ReturnType<typeof createVoiceBrowserRuntime>;

function createDefaultVoiceAudioInputDevice(): VoiceAudioInputDevice {
  return {
    deviceId: 'default',
    label: 'System default input',
    groupId: null,
    isDefault: true,
  };
}

function createFallbackVoiceAudioInputDevices(): VoiceAudioInputDevice[] {
  return [createDefaultVoiceAudioInputDevice()];
}

function normalizeStoredDeviceId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function resolveStorage(storage?: VoiceInputDeviceStorage | null): VoiceInputDeviceStorage | null {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function resolveMediaDevices(
  mediaDevices?: VoiceBrowserMediaDevices | null,
): VoiceBrowserMediaDevices | null {
  if (mediaDevices !== undefined) {
    return mediaDevices;
  }
  if (typeof navigator === 'undefined') {
    return null;
  }
  return navigator.mediaDevices ?? null;
}

function resolveDocument(runtimeDocument?: Document | null): Document | null {
  if (runtimeDocument !== undefined) {
    return runtimeDocument;
  }
  if (typeof document === 'undefined') {
    return null;
  }
  return document;
}

function warnVoiceRuntimeIssue(
  warn: VoiceBrowserRuntimeWarn | undefined,
  message: string,
  error: unknown,
): void {
  if (warn) {
    warn(message, error);
    return;
  }
  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(message, error);
  }
}

function renderIfVisible(render: (() => void) | null | undefined, silent: boolean): void {
  if (!silent) {
    render?.();
  }
}

export function readVoiceInputDevicePreference(
  options: VoiceInputDevicePreferenceOptions = {},
): string | null {
  const storage = resolveStorage(options.storage);
  if (!storage) {
    return null;
  }

  try {
    return normalizeStoredDeviceId(
      storage.getItem(options.storageKey ?? VOICE_INPUT_DEVICE_STORAGE_KEY),
    );
  } catch (error) {
    warnVoiceRuntimeIssue(options.warn, '[Sloane] Failed to read voice input preference:', error);
    return null;
  }
}

export function writeVoiceInputDevicePreference(
  deviceId: string | null,
  options: VoiceInputDevicePreferenceOptions = {},
): void {
  const storage = resolveStorage(options.storage);
  if (!storage) {
    return;
  }

  try {
    const normalizedDeviceId = normalizeStoredDeviceId(deviceId);
    if (normalizedDeviceId) {
      storage.setItem(options.storageKey ?? VOICE_INPUT_DEVICE_STORAGE_KEY, normalizedDeviceId);
    } else {
      storage.removeItem(options.storageKey ?? VOICE_INPUT_DEVICE_STORAGE_KEY);
    }
  } catch (error) {
    warnVoiceRuntimeIssue(options.warn, '[Sloane] Failed to persist voice input preference:', error);
  }
}

export function buildVoiceAudioInputDevices(devices: MediaDeviceInfo[]): VoiceAudioInputDevice[] {
  const inputs = devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({
      deviceId: device.deviceId || `audioinput-${index + 1}`,
      label: device.label?.trim() || (index === 0 ? 'System default input' : `Audio input ${index + 1}`),
      groupId: device.groupId || null,
      isDefault: device.deviceId === 'default' || index === 0,
    }));

  if (!inputs.some((device) => device.deviceId === 'default')) {
    inputs.unshift(createDefaultVoiceAudioInputDevice());
  }

  return inputs;
}

export async function refreshVoiceAudioInputDevices(
  options: VoiceAudioInputRefreshOptions,
): Promise<VoiceAudioInputDevice[]> {
  const mediaDevices = resolveMediaDevices(options.mediaDevices);
  const fallbackDevices = createFallbackVoiceAudioInputDevices();
  const readPreference = options.readVoiceInputDevicePreference ?? (() => null);
  const writePreference = options.writeVoiceInputDevicePreference ?? (() => undefined);
  const unavailableMessage = options.unavailableMessage ?? VOICE_AUDIO_INPUT_UNAVAILABLE_MESSAGE;
  const unavailableNotice = options.unavailableNotice ?? VOICE_AUDIO_INPUT_PREFERENCE_FALLBACK_NOTICE;
  const silent = Boolean(options.silent);

  if (!mediaDevices?.enumerateDevices) {
    const currentState = options.store.getState();
    options.store.patchState({
      voiceAudioInputDevices: fallbackDevices,
      voiceSelectedInputDeviceId: currentState.voiceSelectedInputDeviceId || readPreference() || 'default',
      voiceAudioInputStatus: 'error',
      voiceAudioInputError: unavailableMessage,
    });
    renderIfVisible(options.render, silent);
    return options.store.getState().voiceAudioInputDevices;
  }

  options.store.patchState({
    voiceAudioInputStatus: 'loading',
    voiceAudioInputError: null,
  });
  renderIfVisible(options.render, silent);

  try {
    const devices = buildVoiceAudioInputDevices(await mediaDevices.enumerateDevices());
    const preferredDeviceId = options.store.getState().voiceSelectedInputDeviceId || readPreference();
    const hadPreferredDevice = Boolean(preferredDeviceId);
    const matchedDevice = preferredDeviceId
      ? devices.find((device) => device.deviceId === preferredDeviceId)
      : null;
    const nextSelectedDevice = matchedDevice
      || devices.find((device) => device.deviceId === 'default')
      || devices[0]
      || null;
    const nextSelectedDeviceId = nextSelectedDevice?.deviceId || 'default';

    writePreference(nextSelectedDeviceId);
    options.store.patchState({
      voiceAudioInputDevices: devices,
      voiceSelectedInputDeviceId: nextSelectedDeviceId,
      voiceAudioInputStatus: 'ready',
      voiceAudioInputError: null,
      ...(hadPreferredDevice && !matchedDevice
        ? {
            voiceAudioInputNotice: unavailableNotice,
          }
        : {}),
    });
    renderIfVisible(options.render, silent);
    return options.store.getState().voiceAudioInputDevices;
  } catch (error) {
    const currentState = options.store.getState();
    options.store.patchState({
      voiceAudioInputDevices: fallbackDevices,
      voiceSelectedInputDeviceId: currentState.voiceSelectedInputDeviceId || readPreference() || 'default',
      voiceAudioInputStatus: 'error',
      voiceAudioInputError: error instanceof Error ? error.message : String(error),
    });
    renderIfVisible(options.render, silent);
    return options.store.getState().voiceAudioInputDevices;
  }
}

export function compressVoiceTimeline(
  timeline: Array<VoiceLiveFrame | null | undefined> | null | undefined,
  maxPoints = 120,
): VoiceLiveFrame[] {
  const frames = Array.isArray(timeline)
    ? timeline.filter((frame): frame is VoiceLiveFrame => Boolean(frame))
    : [];
  const boundedMaxPoints = Number.isFinite(maxPoints) ? Math.max(1, Math.floor(maxPoints)) : 120;

  if (frames.length <= boundedMaxPoints) {
    return frames.slice();
  }

  if (boundedMaxPoints === 1) {
    return [frames[frames.length - 1]];
  }

  const lastIndex = frames.length - 1;
  const sampled: VoiceLiveFrame[] = [];
  for (let index = 0; index < boundedMaxPoints; index += 1) {
    const sourceIndex = Math.round((index / (boundedMaxPoints - 1)) * lastIndex);
    sampled.push(frames[sourceIndex]);
  }
  return sampled;
}

export function ensureVoiceCueSheetCard(
  runtimeDocument?: Document | null,
): HTMLElement | null {
  const documentRef = resolveDocument(runtimeDocument);
  if (!documentRef) {
    return null;
  }

  const existingCopy = documentRef.getElementById('voice-cue-sheet-copy');
  if (existingCopy) {
    return existingCopy.closest('.voice-practice-card') as HTMLElement | null;
  }

  const voiceLabGrid = documentRef.querySelector('#voice-lab-panel .voice-lab-grid');
  if (!voiceLabGrid) {
    return null;
  }

  const card = documentRef.createElement('section');
  card.className = 'voice-practice-card';
  card.innerHTML = `
    <h3>Phrase coaching</h3>
    <p id="voice-cue-sheet-copy" class="voice-reference-help">
      Select a drill or project a phrase map to get mouth-shape, airflow, placement, and expression notes under the words.
    </p>
    <div id="voice-cue-sheet-meta" class="voice-cue-sheet-meta"></div>
    <div id="voice-cue-sheet-line" class="voice-cue-sheet-line">
      <div class="voice-phrase-empty">No coached phrase loaded yet.</div>
    </div>
    <div id="voice-cue-sheet-tokens" class="voice-cue-sheet-tokens">
      <div class="voice-phrase-empty">Word-by-word mouth notes will appear here once a drill or phrase map is active.</div>
    </div>
  `;

  const phraseProjectionCard = documentRef
    .getElementById('voice-forecast-phrase')
    ?.closest('.voice-practice-card');
  if (phraseProjectionCard?.parentNode) {
    phraseProjectionCard.parentNode.insertBefore(card, phraseProjectionCard.nextSibling);
    return card;
  }

  voiceLabGrid.appendChild(card);
  return card;
}

export function createVoiceBrowserRuntime(options: VoiceBrowserRuntimeOptions) {
  const storageKey = options.storageKey ?? VOICE_INPUT_DEVICE_STORAGE_KEY;
  const readPreference = () => readVoiceInputDevicePreference({
    storage: options.storage,
    storageKey,
    warn: options.warn,
  });
  const writePreference = (deviceId: string | null) => writeVoiceInputDevicePreference(deviceId, {
    storage: options.storage,
    storageKey,
    warn: options.warn,
  });

  return {
    readVoiceInputDevicePreference: readPreference,
    writeVoiceInputDevicePreference: writePreference,
    buildVoiceAudioInputDevices,
    getSelectedVoiceAudioInput(): VoiceAudioInputDevice | null {
      return options.store.getSelectedVoiceAudioInput();
    },
    refreshVoiceAudioInputDevices(silent = false): Promise<VoiceAudioInputDevice[]> {
      return refreshVoiceAudioInputDevices({
        store: options.store,
        render: options.render,
        silent,
        mediaDevices: options.mediaDevices,
        readVoiceInputDevicePreference: readPreference,
        writeVoiceInputDevicePreference: writePreference,
      });
    },
    compressVoiceTimeline,
    ensureVoiceCueSheetCard(): HTMLElement | null {
      return ensureVoiceCueSheetCard(options.document);
    },
  };
}

export type VoiceAudioInputStatus = VoiceRuntimeStoreState['voiceAudioInputStatus'];
