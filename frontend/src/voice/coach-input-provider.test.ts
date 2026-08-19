import { describe, expect, it } from 'vitest';
import {
  getNextVoiceCoachInputProvider,
  isVoiceCoachInputProviderSwitchAllowed,
} from './coach-input-provider';

describe('voice coach input provider switching', () => {
  it('switches from browser to backend', () => {
    expect(getNextVoiceCoachInputProvider('browser')).toBe('backend');
  });

  it('blocks switching back to browser when browser speech recognition is unavailable', () => {
    expect(isVoiceCoachInputProviderSwitchAllowed({
      requestedProvider: 'backend',
      browserSpeechRecognitionSupported: false,
    })).toBe(false);
  });

  it('still allows switching away from an unsupported browser path', () => {
    expect(isVoiceCoachInputProviderSwitchAllowed({
      requestedProvider: 'browser',
      browserSpeechRecognitionSupported: false,
    })).toBe(true);
  });
});
