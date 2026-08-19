import type { VoiceCoachInputProvider } from './api';

export function getNextVoiceCoachInputProvider(
  requestedProvider: VoiceCoachInputProvider,
): VoiceCoachInputProvider {
  return requestedProvider === 'browser' ? 'backend' : 'browser';
}

export function isVoiceCoachInputProviderSwitchAllowed({
  requestedProvider,
  browserSpeechRecognitionSupported,
}: {
  requestedProvider: VoiceCoachInputProvider;
  browserSpeechRecognitionSupported: boolean;
}): boolean {
  const nextProvider = getNextVoiceCoachInputProvider(requestedProvider);
  if (nextProvider === 'browser' && !browserSpeechRecognitionSupported) {
    return false;
  }
  return true;
}
