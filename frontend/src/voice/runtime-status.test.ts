import { describe, expect, it } from 'vitest';
import { createDefaultVoiceUiState } from './state';
import {
  createVoiceRuntimeStatusController,
  type VoiceRuntimeEnvironment,
} from './runtime-status';

const connectedVoiceEnvironment: VoiceRuntimeEnvironment = {
  currentMode: 'voice',
  currentSessionId: 'session-1',
  isConnected: true,
  browserSpeechRecognitionSupported: true,
  browserSpeechSynthesisSupported: true,
  canUseBackendCapture: true,
  canUseBackendRecordedFallback: true,
};

describe('voice runtime status controller', () => {
  it('tracks DeepTutor voice route availability from health payloads', () => {
    const controller = createVoiceRuntimeStatusController();

    expect(controller.getState().deepTutorVoiceRoutesEnabled).toBeNull();
    controller.applyHealthStatusPayload({ deepTutorVoiceRoutesEnabled: false });
    expect(controller.getState().deepTutorVoiceRoutesEnabled).toBe(false);
    controller.applyHealthStatusPayload({ deepTutorVoiceRoutesEnabled: true });
    expect(controller.getState().deepTutorVoiceRoutesEnabled).toBe(true);
  });

  it('normalizes backend input provider payloads into one backend status snapshot', () => {
    const controller = createVoiceRuntimeStatusController();

    controller.applyInputProviderStatusPayload({
      providers: {
        backend: {
          enabled: true,
          available: true,
          lastError: ' ASR offline ',
          capabilities: {
            normalizedTurnContract: true,
            liveCapture: true,
            finalTranscript: true,
            interimTranscript: true,
            vad: true,
            bargeInCancel: true,
          },
          live: {
            requested: {
              mode: 'custom-local',
            },
            effective: {
              activeMode: 'custom-local',
              engine: 'provider-websocket',
            },
            verified: true,
            available: true,
          },
          plannedFeatures: {
            vad: true,
            bargeInCancel: true,
          },
        },
      },
    });

    const state = controller.getState();
    expect(state.input.backend.enabled).toBe(true);
    expect(state.input.backend.available).toBe(true);
    expect(state.input.backend.error).toBe('ASR offline');
    expect(state.input.backend.capabilities.liveCapture).toBe(true);
    expect(state.input.backend.liveStatus.actualMode).toBe('custom-local');
    expect(state.input.backend.plannedVad).toBe(true);
    expect(state.input.backend.plannedBargeIn).toBe(true);
  });

  it('preserves verified backend availability across narrow mutation payloads', () => {
    const controller = createVoiceRuntimeStatusController();
    controller.applyInputProviderStatusPayload({
      providers: {
        backend: {
          enabled: true,
          available: true,
          capabilities: {
            liveCapture: true,
            recordedCapture: true,
            automaticTurnBoundary: true,
          },
        },
      },
    });

    controller.applyInputProviderStatusPayload({
      voiceInputRuntime: {
        status: 'idle',
      },
    });

    expect(controller.getEffectiveInputProvider({
      ...connectedVoiceEnvironment,
      requestedProvider: 'backend',
    })).toBe('backend');
    expect(controller.getState().input.backend.available).toBe(true);
  });

  it('falls back backend input to browser capture when backend live capture is unavailable', () => {
    const controller = createVoiceRuntimeStatusController();

    const effectiveProvider = controller.getEffectiveInputProvider({
      ...connectedVoiceEnvironment,
      requestedProvider: 'backend',
    });
    const fallbackActive = controller.isInputProviderFallbackActive({
      ...connectedVoiceEnvironment,
      requestedProvider: 'backend',
    }, effectiveProvider);

    expect(effectiveProvider).toBe('browser');
    expect(fallbackActive).toBe(true);
  });

  it('falls back a saved browser input preference to backend capture in WebView', () => {
    const controller = createVoiceRuntimeStatusController();
    controller.applyInputProviderStatusPayload({
      providers: {
        backend: {
          enabled: true,
          available: true,
          capabilities: { liveCapture: true },
        },
      },
    });
    const webViewEnvironment = {
      ...connectedVoiceEnvironment,
      browserSpeechRecognitionSupported: false,
      requestedProvider: 'browser' as const,
    };

    expect(controller.getEffectiveInputProvider(webViewEnvironment)).toBe('backend');
    expect(controller.isInputProviderFallbackActive(webViewEnvironment)).toBe(true);
  });

  it('prefers VoxCPM when available and falls back to browser speech otherwise', () => {
    const controller = createVoiceRuntimeStatusController();

    controller.applySpeechStatusPayload({
      providers: {
        voxcpm: {
          enabled: true,
          available: true,
          infoError: null,
          lastError: null,
        },
      },
    });
    expect(controller.getEffectiveSpeechProvider({
      ...connectedVoiceEnvironment,
      requestedProvider: 'voxcpm',
    })).toBe('voxcpm');

    controller.setVoxCpmStatus({
      available: false,
      error: 'Bridge offline',
    });
    expect(controller.getEffectiveSpeechProvider({
      ...connectedVoiceEnvironment,
      requestedProvider: 'voxcpm',
    })).toBe('browser');
    expect(controller.isSpeechProviderFallbackActive({
      ...connectedVoiceEnvironment,
      requestedProvider: 'voxcpm',
    })).toBe(true);
  });

  it('falls back a saved browser preference to VoxCPM when WebView has no speech synthesis', () => {
    const controller = createVoiceRuntimeStatusController();
    controller.applySpeechStatusPayload({
      providers: {
        voxcpm: {
          enabled: true,
          available: true,
          infoError: null,
          lastError: null,
        },
      },
    });
    const webViewEnvironment = {
      ...connectedVoiceEnvironment,
      browserSpeechSynthesisSupported: false,
      requestedProvider: 'browser' as const,
    };

    expect(controller.getEffectiveSpeechProvider(webViewEnvironment)).toBe('voxcpm');
    expect(controller.isSpeechProviderFallbackActive(webViewEnvironment)).toBe(true);
  });

  it('plans recovery-safety disable only when continuous mode is active and not already pending', () => {
    const controller = createVoiceRuntimeStatusController();
    const runtime = createDefaultVoiceUiState().voiceInputRuntime;
    runtime.captureProvider = 'backend';
    runtime.consecutiveErrorTurns = 2;

    const recovery = controller.getInputRecoveryState(runtime, {
      ...connectedVoiceEnvironment,
      requestedInputProvider: 'backend',
      effectiveInputProvider: 'backend',
    });
    const initialPlan = controller.planRecoverySafety({
      continuousEnabled: true,
      recovery,
    });

    controller.setRecoverySafetyPending(true);
    const pendingPlan = controller.planRecoverySafety({
      continuousEnabled: true,
      recovery,
    });

    expect(initialPlan.shouldApply).toBe(true);
    expect(initialPlan.disableReason).toContain('Hands-free was paused');
    expect(pendingPlan.shouldApply).toBe(false);
  });

  it('derives conditioning status copy from target-style and prepared samples', () => {
    const controller = createVoiceRuntimeStatusController();

    const text = controller.getConditioningStatusText({
      useTargetProfileStyle: true,
      styleInstruction: 'warm and steady',
      promptLatentsReady: true,
      promptAudioName: 'prompt.wav',
      referenceLatentsReady: true,
      referenceAudioName: 'reference.wav',
    }, {
      stylePrompt: 'Teacherly and calm',
    });

    expect(text).toContain('target profile style');
    expect(text).toContain('style: warm and steady');
    expect(text).toContain('prompt sample ready (prompt.wav)');
    expect(text).toContain('reference sample ready (reference.wav)');
  });
});
