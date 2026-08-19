import type { VoiceAppRuntime } from './app-runtime';
import type {
  VoicePracticeTransportSnapshot,
  VoicePracticeTransportStartOptions,
} from './practice-transport';
import type { Pcm16RingBuffer } from './audio/pcm16-ring-buffer';
import type { VoiceRenderController } from './render-controller';
import type { VoiceOverlayVisibility, VoiceRuntimeStore } from './runtime-store';
import type { VoiceUiState } from './state';

type VoiceHostRuntimeBridgePracticeTransport = {
  start: (options: VoicePracticeTransportStartOptions) => Promise<void>;
  stop: (preserveFrame?: boolean) => Promise<void>;
  getAudioRingBuffer?: () => Pcm16RingBuffer;
};

type VoiceHostRuntimeBridgeRenderController = Pick<VoiceRenderController, 'render'>;

type VoiceHostRuntimeBridgeAudioRuntime = Pick<
  VoicePracticeTransportStartOptions,
  'readInputDevicePreference' | 'writeInputDevicePreference' | 'refreshAudioInputDevices'
>;

export type VoiceHostRuntimeBridgeOptions = {
  store: VoiceRuntimeStore;
  getAppRuntime: () => Pick<VoiceAppRuntime, 'getResolvedVoiceStreamUrl'>;
  getAudioRuntime: () => VoiceHostRuntimeBridgeAudioRuntime;
};

export type VoiceHostRuntimeBridgeBindings = {
  practiceTransport?: VoiceHostRuntimeBridgePracticeTransport | null;
  renderController?: VoiceHostRuntimeBridgeRenderController | null;
};

export type VoiceHostRuntimeBridge = ReturnType<typeof createVoiceHostRuntimeBridge>;

export function createVoiceHostRuntimeBridge(options: VoiceHostRuntimeBridgeOptions) {
  let practiceTransport: VoiceHostRuntimeBridgePracticeTransport | null = null;
  let renderController: VoiceHostRuntimeBridgeRenderController | null = null;
  const renderObservers = new Set<() => void>();

  function bind(bindings: VoiceHostRuntimeBridgeBindings): void {
    if ('practiceTransport' in bindings) {
      practiceTransport = bindings.practiceTransport ?? null;
    }
    if ('renderController' in bindings) {
      renderController = bindings.renderController ?? null;
    }
  }

  function render(): void {
    renderController?.render();
    renderObservers.forEach((observer) => {
      try {
        observer();
      } catch (error) {
        console.warn('[Voice] Render observer failed:', error);
      }
    });
  }

  function observeRender(observer: () => void): () => void {
    renderObservers.add(observer);
    return () => {
      renderObservers.delete(observer);
    };
  }

  function toggleVoiceOverlay(overlay: keyof VoiceOverlayVisibility): void {
    options.store.toggleOverlay(overlay);
    render();
  }

  function getPracticeTransportState(): VoicePracticeTransportSnapshot {
    return options.store.getPracticeTransportState();
  }

  function setPracticeTransportState(
    updater: (state: VoicePracticeTransportSnapshot) => VoicePracticeTransportSnapshot,
  ): void {
    options.store.setPracticeTransportState(updater);
  }

  function updateVoiceUiState(
    updater: (state: VoiceUiState) => VoiceUiState,
  ): void {
    options.store.updateUiState(updater);
  }

  async function stopVoiceAudioStream(preserveFrame = false): Promise<void> {
    await practiceTransport?.stop(preserveFrame);
  }

  async function startVoiceAudioStream(): Promise<void> {
    if (!practiceTransport) {
      throw new Error('Voice practice transport runtime is not bound.');
    }

    const voiceState = options.store.getState();
    const audioRuntime = options.getAudioRuntime();
    await practiceTransport.start({
      streamUrl: options.getAppRuntime().getResolvedVoiceStreamUrl(),
      audioPreferWorklet: options.store.getUiState().advancedPanel.audioPreferWorklet,
      selectedInputDeviceId: voiceState.voiceSelectedInputDeviceId,
      readInputDevicePreference: audioRuntime.readInputDevicePreference,
      writeInputDevicePreference: audioRuntime.writeInputDevicePreference,
      refreshAudioInputDevices: audioRuntime.refreshAudioInputDevices,
      setSelectedInputDeviceId: (deviceId) => {
        options.store.patchState({
          voiceSelectedInputDeviceId: deviceId,
        });
      },
      setAudioInputNotice: (notice) => {
        options.store.patchState({
          voiceAudioInputNotice: notice,
        });
      },
      setResolvedInputLabel: (label) => {
        options.store.patchState({
          voiceResolvedInputLabel: label,
        });
      },
      setResolvedInputDeviceId: (deviceId) => {
        options.store.patchState({
          voiceResolvedInputDeviceId: deviceId,
        });
      },
    });
  }

  return {
    bind,
    render,
    observeRender,
    toggleVoiceOverlay,
    getPracticeTransportState,
    setPracticeTransportState,
    updateVoiceUiState,
    stopVoiceAudioStream,
    startVoiceAudioStream,
    getPracticeAudioRingBuffer: () => practiceTransport?.getAudioRingBuffer?.() ?? null,
  };
}
