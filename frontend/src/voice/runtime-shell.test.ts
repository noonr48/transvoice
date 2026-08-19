import { describe, expect, it } from 'vitest';
import { createDefaultVoiceUiState } from './state';
import { createVoiceRuntimeStatusController } from './runtime-status';
import { createVoiceRuntimeShell } from './runtime-shell';

function createShell(options: {
  currentMode?: string;
  currentSessionId?: string | null;
  isConnected?: boolean;
  canUseBackendCapture?: boolean;
  canUseBackendRecordedFallback?: boolean;
  hasBrowserSpeechRecognitionSupport?: boolean;
  hasBrowserSpeechSynthesisSupport?: boolean;
  voiceUiState?: ReturnType<typeof createDefaultVoiceUiState>;
} = {}) {
  let voiceUiState = options.voiceUiState || createDefaultVoiceUiState();
  const runtimeStatusController = createVoiceRuntimeStatusController();

  const shell = createVoiceRuntimeShell({
    runtimeStatusController,
    getCurrentMode: () => options.currentMode ?? 'voice',
    getCurrentSessionId: () => options.currentSessionId === undefined ? 'session-1' : options.currentSessionId,
    getIsConnected: () => options.isConnected ?? true,
    getVoiceUiState: () => voiceUiState,
    canUseBackendCapture: () => options.canUseBackendCapture ?? true,
    canUseBackendRecordedFallback: () => options.canUseBackendRecordedFallback ?? true,
    hasBrowserSpeechRecognitionSupport: () => options.hasBrowserSpeechRecognitionSupport ?? true,
    hasBrowserSpeechSynthesisSupport: () => options.hasBrowserSpeechSynthesisSupport ?? true,
  });

  return {
    shell,
    runtimeStatusController,
    setVoiceUiState: (nextState: ReturnType<typeof createDefaultVoiceUiState>) => {
      voiceUiState = nextState;
    },
  };
}

describe('voice runtime shell', () => {
  it('resolves the backend input path when requested and available', () => {
    const { shell, runtimeStatusController } = createShell({
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: false,
          speechProvider: 'browser',
          inputProvider: 'backend',
        },
      }),
    });

    runtimeStatusController.applyInputProviderStatusPayload({
      providers: {
        backend: {
          enabled: true,
          available: true,
          capabilities: {
            normalizedTurnContract: true,
            liveCapture: true,
            finalTranscript: true,
            interimTranscript: true,
            vad: true,
            bargeInCancel: true,
          },
        },
      },
    });

    expect(shell.getRequestedInputProvider()).toBe('backend');
    expect(shell.getEffectiveInputProvider()).toBe('backend');
    expect(shell.isInputProviderFallbackActive()).toBe(false);
    expect(shell.getEffectiveInputCapabilities()).toMatchObject({
      liveCapture: true,
      interimTranscript: true,
    });
    expect(shell.supportsAutomaticTurnBoundary()).toBe(true);
    expect(shell.getRuntimeEnvironment()).toMatchObject({
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
      canUseBackendCapture: true,
      browserSpeechRecognitionSupported: true,
      browserSpeechSynthesisSupported: true,
    });
  });

  it('uses verified recorded ASR with local turn boundaries in WebView', () => {
    const { shell, runtimeStatusController } = createShell({
      hasBrowserSpeechRecognitionSupport: false,
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: false,
          speechProvider: 'voxcpm',
          inputProvider: 'backend',
        },
      }),
    });
    runtimeStatusController.applyInputProviderStatusPayload({
      providers: {
        backend: {
          enabled: true,
          available: true,
          capabilities: {
            liveCapture: false,
            recordedCapture: true,
            automaticTurnBoundary: true,
            vad: true,
          },
        },
      },
    });

    expect(shell.getEffectiveInputProvider()).toBe('backend');
    expect(shell.getEffectiveInputCapabilities()).toMatchObject({
      liveCapture: false,
      recordedCapture: true,
      automaticTurnBoundary: true,
    });
    expect(shell.supportsAutomaticTurnBoundary()).toBe(true);
  });

  it('falls back to browser input when backend capture is unavailable', () => {
    const { shell } = createShell({
      canUseBackendCapture: false,
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: false,
          speechProvider: 'browser',
          inputProvider: 'backend',
        },
      }),
    });

    expect(shell.canUseBackendRecordedFallback()).toBe(true);
    expect(shell.getEffectiveInputProvider()).toBe('browser');
    expect(shell.isInputProviderFallbackActive()).toBe(true);
    expect(shell.supportsAutomaticTurnBoundary()).toBe(true);
  });

  it('falls back from VoxCPM to browser speech when needed and exposes conditioning copy', () => {
    const { shell, runtimeStatusController } = createShell({
      voiceUiState: createDefaultVoiceUiState({
        coachVoice: {
          speechEnabled: true,
          continuousEnabled: false,
          speechProvider: 'voxcpm',
          inputProvider: 'browser',
        },
        voiceConditioning: {
          useTargetProfileStyle: false,
          styleInstruction: 'soft and airy',
          promptText: '',
          promptAudioName: null,
          promptLatentsReady: false,
          referenceAudioName: null,
          referenceLatentsReady: false,
        },
      }),
    });

    runtimeStatusController.setVoxCpmStatus({
      available: false,
      error: 'offline',
    });

    expect(shell.getRequestedSpeechProvider()).toBe('voxcpm');
    expect(shell.getEffectiveSpeechProvider()).toBe('browser');
    expect(shell.isSpeechProviderFallbackActive()).toBe(true);
    expect(shell.getConditioningStatusText()).toContain('style: soft and airy');
  });
});
