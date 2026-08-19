import type { VoiceAppRuntime } from './app-runtime';

type VoiceSessionModePolicyRuntime = Pick<
  VoiceAppRuntime,
  'getSummaryText' | 'hasModeActivity'
>;

type VoiceSessionModePolicyOptions = {
  getVoiceAppRuntime: () => VoiceSessionModePolicyRuntime;
};

export type VoiceSessionModePolicy = ReturnType<typeof createVoiceSessionModePolicy>;

export function createVoiceSessionModePolicy(
  options: VoiceSessionModePolicyOptions,
) {
  function hasVoiceModeActivity(): boolean {
    return options.getVoiceAppRuntime().hasModeActivity();
  }

  function getVoiceSummaryText(): string {
    return options.getVoiceAppRuntime().getSummaryText();
  }

  function getAppSessionPolicyRuntimeVoiceOptions(): {
    hasVoiceModeActivity: () => boolean;
  } {
    return {
      hasVoiceModeActivity,
    };
  }

  return {
    hasVoiceModeActivity,
    getVoiceSummaryText,
    getAppSessionPolicyRuntimeVoiceOptions,
  };
}
