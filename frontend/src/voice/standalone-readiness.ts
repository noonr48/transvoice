import type { VoiceUiState } from './state';
import type { VoiceTutorStandaloneOverallHealthStatus } from './standalone-health';

export type VoiceTutorStandaloneReadinessStatus = 'ONLINE' | 'OFFLINE' | 'DEGRADED';

export function resolveVoiceTutorStandaloneReadinessStatus(options: {
  healthOnline: boolean;
  healthSummaryStatus?: VoiceTutorStandaloneOverallHealthStatus | null;
  voiceUiState?: Pick<VoiceUiState, 'serviceStatus' | 'lastError'> | null;
}): VoiceTutorStandaloneReadinessStatus {
  if (options.healthSummaryStatus === 'offline') {
    return 'OFFLINE';
  }
  if (!options.healthOnline) {
    return options.healthSummaryStatus === 'degraded' ? 'DEGRADED' : 'OFFLINE';
  }
  if (options.healthSummaryStatus === 'degraded') {
    return 'DEGRADED';
  }
  // The chip reflects the PRESENT, honestly: serviceStatus 'offline' is the
  // normal idle state before the practice stream is armed, and a historical
  // lastError (which is never cleared) must not permanently degrade a currently
  // healthy stack — past errors live in the session log. Only a CURRENT
  // practice-stream error degrades.
  if (options.voiceUiState?.serviceStatus === 'error') {
    return 'DEGRADED';
  }
  return 'ONLINE';
}
