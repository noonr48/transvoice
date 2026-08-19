import { afterEach, describe, expect, it, vi } from 'vitest';

const createPcm16CaptureMock = vi.fn(async () => ({
  captureSampleRate: 48000,
  outputSampleRate: 16000,
  frameSize: 1024,
  mode: 'script-processor' as const,
  start: async () => undefined,
  stop: () => undefined,
}));

vi.mock('./audio/pcm16-capture', () => ({
  createPcm16Capture: createPcm16CaptureMock,
}));

const createVoiceAudioContextMock = vi.fn(() => ({
  sampleRate: 48000,
  destination: {},
  createMediaStreamSource: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
  }),
  close: vi.fn(async () => undefined),
}));

vi.mock('./audio/audio-context', () => ({
  createVoiceAudioContext: createVoiceAudioContextMock,
}));

describe('voice practice transport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    createPcm16CaptureMock.mockClear();
    createVoiceAudioContextMock.mockClear();
  });

  it('threads audioPreferWorklet into PCM16 capture options', async () => {
    const getUserMedia = vi.fn(async () => {
      const track = {
        label: 'Mic',
        stop: vi.fn(),
        getSettings: () => ({ deviceId: 'device-1' }),
      };
      return {
        getTracks: () => [track],
        getAudioTracks: () => [track],
      } as any;
    });

    Object.assign(navigator, {
      mediaDevices: {
        getUserMedia,
      },
    });

    class MockWebSocket {
      static OPEN = 1;
      OPEN = 1;
      CLOSING = 2;
      readyState = MockWebSocket.OPEN;
      binaryType = 'arraybuffer';
      private handlers = new Map<string, Array<(...args: any[]) => void>>();

      constructor(_url: string) {
        queueMicrotask(() => {
          this.handlers.get('open')?.forEach((handler) => handler());
        });
      }

      addEventListener(event: string, handler: (...args: any[]) => void) {
        const existing = this.handlers.get(event) || [];
        existing.push(handler);
        this.handlers.set(event, existing);
      }

      send() {}

      close() {}
    }

    Object.assign(globalThis, { WebSocket: MockWebSocket as any });

    const { createVoicePracticeTransportController } = await import('./practice-transport');

    const controller = createVoicePracticeTransportController({
      getState: () => ({
        status: 'idle',
        liveFrame: null,
        liveTrace: [],
        sessionArmed: false,
        takeActive: false,
        takeProcessing: false,
      }),
      setState: (updater) => updater({
        status: 'idle',
        liveFrame: null,
        liveTrace: [],
        sessionArmed: false,
        takeActive: false,
        takeProcessing: false,
      }),
      render: () => undefined,
      getRecoveryContext: () => ({ currentSessionId: 'session-1', isConnected: true, voiceSessionId: 'voice-1' }),
      disarmPracticeSession: async () => ({ success: true } as any),
      applyVoiceBackendPayload: () => undefined,
      updateVoiceUiState: (updater) => updater({} as any),
    });

    await controller.start({
      streamUrl: 'ws://voice.test/stream',
      audioPreferWorklet: false,
      selectedInputDeviceId: null,
      readInputDevicePreference: () => 'default',
      writeInputDevicePreference: () => undefined,
      refreshAudioInputDevices: async () => undefined,
      setSelectedInputDeviceId: () => undefined,
      setAudioInputNotice: () => undefined,
      setResolvedInputLabel: () => undefined,
      setResolvedInputDeviceId: () => undefined,
    });

    expect(createPcm16CaptureMock).toHaveBeenCalled();
    expect(createPcm16CaptureMock.mock.calls[0][0].preferWorklet).toBe(false);
  });
});

