import { describe, expect, it, vi } from 'vitest';

import { createVoiceSessionModePolicy } from './session-mode-policy';

describe('voice session mode policy', () => {
  it('defers voice activity and summary lookups to the late-bound voice app runtime', () => {
    const runtimeA = {
      hasModeActivity: vi.fn(() => false),
      getSummaryText: vi.fn(() => 'Voice summary A'),
    };
    const runtimeB = {
      hasModeActivity: vi.fn(() => true),
      getSummaryText: vi.fn(() => 'Voice summary B'),
    };
    let runtime = runtimeA;
    const getVoiceAppRuntime = vi.fn(() => runtime);

    const policy = createVoiceSessionModePolicy({
      getVoiceAppRuntime,
    });

    expect(getVoiceAppRuntime).not.toHaveBeenCalled();

    runtime = runtimeB;

    expect(policy.hasVoiceModeActivity()).toBe(true);
    expect(policy.getVoiceSummaryText()).toBe('Voice summary B');
    expect(runtimeA.hasModeActivity).not.toHaveBeenCalled();
    expect(runtimeA.getSummaryText).not.toHaveBeenCalled();
    expect(runtimeB.hasModeActivity).toHaveBeenCalledTimes(1);
    expect(runtimeB.getSummaryText).toHaveBeenCalledTimes(1);
  });

  it('exposes app session policy helpers backed by the same voice activity policy', () => {
    const runtime = {
      hasModeActivity: vi.fn(() => true),
      getSummaryText: vi.fn(() => 'Unused summary'),
    };
    const policy = createVoiceSessionModePolicy({
      getVoiceAppRuntime: () => runtime,
    });

    const appSessionPolicyRuntimeVoiceOptions = (
      policy.getAppSessionPolicyRuntimeVoiceOptions()
    );

    expect(appSessionPolicyRuntimeVoiceOptions.hasVoiceModeActivity()).toBe(true);
    expect(runtime.hasModeActivity).toHaveBeenCalledTimes(1);
  });
});
