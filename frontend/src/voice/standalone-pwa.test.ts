import { describe, expect, it, vi } from 'vitest';

import {
  bindVoiceTutorStandaloneInstallPrompt,
  isVoiceTutorStandalonePwaSupported,
  registerVoiceTutorStandaloneServiceWorker,
  VOICE_TUTOR_MANIFEST_PATH,
  VOICE_TUTOR_SERVICE_WORKER_PATH,
} from './standalone-pwa';

function createWindowRef(href: string, isSecureContext = true): Window {
  const url = new URL(href);
  return {
    isSecureContext,
    location: {
      hostname: url.hostname,
    },
    matchMedia: vi.fn(() => ({ matches: false })),
    addEventListener: vi.fn(),
  } as unknown as Window;
}

describe('voice standalone PWA helpers', () => {
  it('uses stable public asset paths for manifest and service worker', () => {
    expect(VOICE_TUTOR_MANIFEST_PATH).toBe('/voice-tutor.webmanifest');
    expect(VOICE_TUTOR_SERVICE_WORKER_PATH).toBe('/voice-tutor-sw.js');
  });

  it('requires service worker support plus secure or local context', () => {
    expect(isVoiceTutorStandalonePwaSupported({
      windowRef: createWindowRef('https://voice.example.com/voice-tutor.html'),
      navigatorRef: { serviceWorker: {} } as Navigator,
    })).toBe(true);
    expect(isVoiceTutorStandalonePwaSupported({
      windowRef: createWindowRef('http://voice.example.com/voice-tutor.html', false),
      navigatorRef: { serviceWorker: {} } as Navigator,
    })).toBe(false);
    expect(isVoiceTutorStandalonePwaSupported({
      windowRef: createWindowRef('http://127.0.0.1:1421/voice-tutor.html', false),
      navigatorRef: { serviceWorker: {} } as Navigator,
    })).toBe(true);
  });

  it('registers the standalone service worker at root scope', async () => {
    const register = vi.fn(async () => ({ scope: 'https://voice.example.com/' }));
    const onStatus = vi.fn();

    await expect(registerVoiceTutorStandaloneServiceWorker({
      windowRef: createWindowRef('https://voice.example.com/voice-tutor.html'),
      navigatorRef: { serviceWorker: { register } } as unknown as Navigator,
      onStatus,
    })).resolves.toEqual({
      supported: true,
      registered: true,
      scope: 'https://voice.example.com/',
    });

    expect(register).toHaveBeenCalledWith('/voice-tutor-sw.js', { scope: '/' });
    expect(onStatus).toHaveBeenCalledWith('Offline shell ready (https://voice.example.com/).');
  });

  it('exposes the deferred install prompt when the browser allows installation', async () => {
    const button = document.createElement('button');
    const status = document.createElement('div');

    bindVoiceTutorStandaloneInstallPrompt({ button, status });

    const promptEvent = new Event('beforeinstallprompt') as Event & {
      prompt: ReturnType<typeof vi.fn>;
      userChoice: Promise<{ outcome: 'accepted'; platform: string }>;
    };
    promptEvent.prompt = vi.fn(async () => undefined);
    promptEvent.userChoice = Promise.resolve({ outcome: 'accepted', platform: 'web' });
    const preventDefault = vi.spyOn(promptEvent, 'preventDefault');

    window.dispatchEvent(promptEvent);
    expect(preventDefault).toHaveBeenCalled();
    expect(button.hidden).toBe(false);
    expect(button.disabled).toBe(false);
    expect(status.textContent).toBe('Install prompt ready.');

    button.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(promptEvent.prompt).toHaveBeenCalled();
    expect(status.textContent).toBe('Install accepted.');
  });
});
