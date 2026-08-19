import { describe, expect, it, vi } from 'vitest';

import { createVoiceRuntimeStore } from './runtime-store';
import { createVoiceHostRuntimeBridge } from './host-runtime-bridge';

describe('voice host runtime bridge', () => {
  it('binds render and transport helpers through one late-bound runtime seam', async () => {
    const store = createVoiceRuntimeStore();
    const render = vi.fn();
    const start = vi.fn(async () => undefined);
    const stop = vi.fn(async () => undefined);
    const readInputDevicePreference = vi.fn(() => 'usb-mic');
    const writeInputDevicePreference = vi.fn();
    const refreshAudioInputDevices = vi.fn(async () => []);
    const bridge = createVoiceHostRuntimeBridge({
      store,
      getAppRuntime: () => ({
        getResolvedVoiceStreamUrl: () => 'wss://voice-session-1',
      } as any),
      getAudioRuntime: () => ({
        readInputDevicePreference,
        writeInputDevicePreference,
        refreshAudioInputDevices,
      }),
    });

    bridge.bind({
      practiceTransport: { start, stop },
      renderController: { render },
    });

    bridge.toggleVoiceOverlay('live');
    expect(store.getState().voiceOverlayVisibility.live).toBe(false);
    expect(render).toHaveBeenCalledTimes(1);

    store.patchState({
      voiceSelectedInputDeviceId: 'focused-mic',
    });
    await bridge.startVoiceAudioStream();
    expect(start).toHaveBeenCalledTimes(1);
    const startOptions = start.mock.calls[0][0];
    expect(startOptions.streamUrl).toBe('wss://voice-session-1');
    expect(startOptions.selectedInputDeviceId).toBe('focused-mic');
    expect(startOptions.readInputDevicePreference).toBe(readInputDevicePreference);
    expect(startOptions.writeInputDevicePreference).toBe(writeInputDevicePreference);
    expect(startOptions.refreshAudioInputDevices).toBe(refreshAudioInputDevices);

    startOptions.setSelectedInputDeviceId('updated-mic');
    startOptions.setAudioInputNotice('Mic switched');
    startOptions.setResolvedInputLabel('Studio Mic');
    startOptions.setResolvedInputDeviceId('resolved-mic');
    expect(store.getState().voiceSelectedInputDeviceId).toBe('updated-mic');
    expect(store.getState().voiceAudioInputNotice).toBe('Mic switched');
    expect(store.getState().voiceResolvedInputLabel).toBe('Studio Mic');
    expect(store.getState().voiceResolvedInputDeviceId).toBe('resolved-mic');

    await bridge.stopVoiceAudioStream(true);
    expect(stop).toHaveBeenCalledWith(true);
  });

  it('mirrors runtime-store transport and ui state helpers', () => {
    const store = createVoiceRuntimeStore();
    const bridge = createVoiceHostRuntimeBridge({
      store,
      getAppRuntime: () => ({
        getResolvedVoiceStreamUrl: () => null,
      } as any),
      getAudioRuntime: () => ({
        readInputDevicePreference: () => null,
        writeInputDevicePreference: () => undefined,
        refreshAudioInputDevices: async () => [],
      }),
    });

    bridge.setPracticeTransportState((current) => ({
      ...current,
      status: 'streaming',
      sessionArmed: true,
    }));
    expect(bridge.getPracticeTransportState()).toMatchObject({
      status: 'streaming',
      sessionArmed: true,
    });

    bridge.updateVoiceUiState((current) => ({
      ...current,
      targetPreset: 'bright-playful',
    }));
    expect(store.getUiState().targetPreset).toBe('bright-playful');
  });

  it('notifies removable observers for every internal render seam', () => {
    const store = createVoiceRuntimeStore();
    const render = vi.fn();
    const observer = vi.fn();
    const bridge = createVoiceHostRuntimeBridge({
      store,
      getAppRuntime: () => ({
        getResolvedVoiceStreamUrl: () => null,
      } as any),
      getAudioRuntime: () => ({
        readInputDevicePreference: () => null,
        writeInputDevicePreference: () => undefined,
        refreshAudioInputDevices: async () => [],
      }),
    });
    bridge.bind({ renderController: { render } });
    const removeObserver = bridge.observeRender(observer);

    bridge.render();
    bridge.toggleVoiceOverlay('live');
    expect(render).toHaveBeenCalledTimes(2);
    expect(observer).toHaveBeenCalledTimes(2);

    removeObserver();
    bridge.render();
    expect(render).toHaveBeenCalledTimes(3);
    expect(observer).toHaveBeenCalledTimes(2);
  });
});
