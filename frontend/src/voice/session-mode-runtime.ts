import {
  planDirectFallbackVoiceSessionReentry,
  planRestoredVoiceSessionReentry,
  planStartedVoiceSessionReentry,
  type VoiceSessionReentryPlan,
} from './session-reentry';
import type { VoiceUiState } from './state';

type VoiceSessionModeRuntimeOptions = {
  getVoiceUiState: () => VoiceUiState;
  applySessionReentryPlan: (plan: VoiceSessionReentryPlan) => void;
  render: () => void;
};

type StartedSessionPayload = Parameters<typeof planStartedVoiceSessionReentry>[1];
type RestoredSessionPayload = Parameters<typeof planRestoredVoiceSessionReentry>[1];

export type VoiceSessionModeRuntime = ReturnType<typeof createVoiceSessionModeRuntime>;

export function createVoiceSessionModeRuntime(options: VoiceSessionModeRuntimeOptions) {
  return {
    applyStartedSession(sessionMode: string, data: StartedSessionPayload): void {
      options.applySessionReentryPlan(
        planStartedVoiceSessionReentry(sessionMode, data, options.getVoiceUiState()),
      );
    },
    applyRestoredSession(restoredMode: string, data: RestoredSessionPayload): void {
      options.applySessionReentryPlan(
        planRestoredVoiceSessionReentry(restoredMode, data, options.getVoiceUiState()),
      );
    },
    applyDirectFallbackSession(sessionMode: string): boolean {
      if (sessionMode !== 'voice') {
        return false;
      }

      options.applySessionReentryPlan(
        planDirectFallbackVoiceSessionReentry(sessionMode, options.getVoiceUiState()),
      );
      options.render();
      return true;
    },
  };
}
