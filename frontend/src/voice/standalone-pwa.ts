export const VOICE_TUTOR_SERVICE_WORKER_PATH = '/voice-tutor-sw.js';
export const VOICE_TUTOR_MANIFEST_PATH = '/voice-tutor.webmanifest';

type VoiceTutorPwaStatusKind = 'info' | 'warning';

type VoiceTutorPwaStatusCallback = (message: string, kind?: VoiceTutorPwaStatusKind) => void;

type BeforeInstallPromptChoice = {
  outcome: 'accepted' | 'dismissed';
  platform: string;
};

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<BeforeInstallPromptChoice>;
};

export type VoiceTutorPwaRegistrationResult = {
  supported: boolean;
  registered: boolean;
  reason?: string;
  scope?: string;
};

function isLocalHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
}

function isStandaloneDisplayMode(windowRef: Window): boolean {
  return windowRef.matchMedia?.('(display-mode: standalone)').matches
    || Boolean((windowRef.navigator as Navigator & { standalone?: boolean }).standalone);
}

export function isVoiceTutorStandalonePwaSupported(options: {
  windowRef: Pick<Window, 'isSecureContext' | 'location'>;
  navigatorRef: Navigator;
}): boolean {
  return 'serviceWorker' in options.navigatorRef
    && (options.windowRef.isSecureContext || isLocalHostname(options.windowRef.location.hostname));
}

export async function registerVoiceTutorStandaloneServiceWorker(options: {
  windowRef?: Window;
  navigatorRef?: Navigator;
  serviceWorkerPath?: string;
  onStatus?: VoiceTutorPwaStatusCallback;
} = {}): Promise<VoiceTutorPwaRegistrationResult> {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return { supported: false, registered: false, reason: 'no-browser-context' };
  }
  const windowRef = options.windowRef || window;
  const navigatorRef = options.navigatorRef || navigator;
  if (!isVoiceTutorStandalonePwaSupported({ windowRef, navigatorRef })) {
    options.onStatus?.('Install/offline shell unavailable outside a secure context.', 'warning');
    return { supported: false, registered: false, reason: 'unsupported-context' };
  }
  try {
    // SELF-HEALING: before registering, unregister any EXISTING service workers.
    // The SW caches HTML aggressively and was the #1 cause of "I refreshed but nothing
    // changed" — stale broken HTML kept getting served. By unregistering first, we
    // guarantee a fresh fetch on every load. We then re-register for the current
    // version only (which uses a cache-first strategy keyed on the current build hash).
    try {
      const existing = await navigatorRef.serviceWorker.getRegistrations();
      for (const reg of existing) {
        await reg.unregister();
      }
    } catch {
      // getRegistrations can fail in some contexts — non-fatal.
    }
    const registration = await navigatorRef.serviceWorker.register(
      options.serviceWorkerPath || VOICE_TUTOR_SERVICE_WORKER_PATH,
      { scope: '/' },
    );
    options.onStatus?.(`Offline shell ready (${registration.scope}).`);
    return {
      supported: true,
      registered: true,
      scope: registration.scope,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.onStatus?.(`Install/offline shell failed: ${message}`, 'warning');
    return {
      supported: true,
      registered: false,
      reason: message,
    };
  }
}

export function bindVoiceTutorStandaloneInstallPrompt(options: {
  windowRef?: Window;
  button?: HTMLButtonElement | null;
  status?: HTMLElement | null;
  onStatus?: VoiceTutorPwaStatusCallback;
} = {}): void {
  if (typeof window === 'undefined') {
    return;
  }
  const windowRef = options.windowRef || window;
  const button = options.button || null;
  const status = options.status || null;
  let deferredPrompt: BeforeInstallPromptEvent | null = null;

  const setStatus = (message: string, kind: VoiceTutorPwaStatusKind = 'info') => {
    if (status) {
      status.textContent = message;
      status.classList.toggle('warning', kind === 'warning');
    }
    options.onStatus?.(message, kind);
  };

  if (button) {
    button.hidden = true;
    button.disabled = true;
  }

  if (isStandaloneDisplayMode(windowRef)) {
    setStatus('Installed app context active.');
    return;
  }

  if (!('onbeforeinstallprompt' in windowRef)) {
    setStatus('Install prompt will appear when the browser marks the PWA installable.');
  }

  windowRef.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    if (button) {
      button.hidden = false;
      button.disabled = false;
    }
    setStatus('Install prompt ready.');
  });

  windowRef.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    if (button) {
      button.hidden = true;
      button.disabled = true;
    }
    setStatus('Voice Tutor installed.');
  });

  button?.addEventListener('click', () => {
    if (!deferredPrompt) {
      setStatus('Install prompt is not available yet.', 'warning');
      return;
    }
    button.disabled = true;
    void deferredPrompt.prompt()
      .then(() => deferredPrompt?.userChoice)
      .then((choice) => {
        setStatus(choice?.outcome === 'accepted' ? 'Install accepted.' : 'Install dismissed.');
      })
      .catch((error) => {
        setStatus(`Install prompt failed: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      })
      .finally(() => {
        deferredPrompt = null;
        button.hidden = true;
      });
  });

  windowRef.addEventListener('offline', () => {
    setStatus('Browser is offline. Cached shell may open, but live coaching needs the backend.', 'warning');
  });
  windowRef.addEventListener('online', () => {
    setStatus('Browser is online.');
  });
}
