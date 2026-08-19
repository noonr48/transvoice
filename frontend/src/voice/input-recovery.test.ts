import { describe, expect, it } from 'vitest';
import { createDefaultVoiceUiState } from './state';
import {
  buildVoiceInputRuntimeRecoveryReset,
  createDefaultVoiceCoachBackendLiveStatus,
  getVoiceInputRecoveryState,
} from './input-recovery';

describe('voice input recovery', () => {
  it('flags repeated backend capture failures as critical and recommends browser fallback', () => {
    const runtime = createDefaultVoiceUiState().voiceInputRuntime;
    runtime.captureProvider = 'backend';
    runtime.consecutiveErrorTurns = 2;

    const recovery = getVoiceInputRecoveryState(runtime, {
      requestedInputProvider: 'backend',
      effectiveInputProvider: 'backend',
    });

    expect(recovery.level).toBe('critical');
    expect(recovery.suggestedInputProvider).toBe('browser');
    expect(recovery.shouldDisableContinuous).toBe(true);
  });

  it('surfaces browser fallback when backend input is requested but unavailable', () => {
    const runtime = createDefaultVoiceUiState().voiceInputRuntime;
    runtime.captureProvider = 'browser';

    const recovery = getVoiceInputRecoveryState(runtime, {
      requestedInputProvider: 'backend',
      effectiveInputProvider: 'browser',
      inputProviderFallbackActive: true,
      backendInputError: 'ASR offline',
    });

    expect(recovery.level).toBe('warning');
    expect(recovery.runtimePill).toBe('browser fallback');
    expect(recovery.coachCopy).toContain('ASR offline');
  });

  it('keeps continuous conversation available on verified buffered live capture', () => {
    const runtime = createDefaultVoiceUiState().voiceInputRuntime;
    const backendLiveStatus = createDefaultVoiceCoachBackendLiveStatus();
    backendLiveStatus.actualMode = 'buffered';

    const recovery = getVoiceInputRecoveryState(runtime, {
      requestedInputProvider: 'backend',
      effectiveInputProvider: 'backend',
      backendLiveStatus,
    });

    expect(recovery.level).toBe('ok');
    expect(recovery.runtimePill).toBeNull();
    expect(recovery.shouldDisableContinuous).toBe(false);
  });

  it('resets recovery-sensitive runtime state while preserving provider intent', () => {
    const runtime = createDefaultVoiceUiState().voiceInputRuntime;
    runtime.status = 'error';
    runtime.lastOutcome = 'error';
    runtime.requestedProvider = 'backend';
    runtime.effectiveProvider = 'browser';
    runtime.captureProvider = 'browser';
    runtime.lastTranscript = 'hello';
    runtime.consecutiveErrorTurns = 3;
    runtime.consecutiveNoSpeechTurns = 2;
    runtime.lastError = 'Boom';

    const reset = buildVoiceInputRuntimeRecoveryReset(runtime, {
      requestedProvider: 'backend',
      effectiveProvider: 'backend',
    });

    expect(reset.status).toBe('idle');
    expect(reset.lastOutcome).toBe('idle');
    expect(reset.requestedProvider).toBe('backend');
    expect(reset.effectiveProvider).toBe('backend');
    expect(reset.captureProvider).toBeNull();
    expect(reset.lastTranscript).toBeNull();
    expect(reset.consecutiveErrorTurns).toBe(0);
    expect(reset.consecutiveNoSpeechTurns).toBe(0);
    expect(reset.lastError).toBeNull();
  });
});
