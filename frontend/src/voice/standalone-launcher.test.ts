import { describe, expect, it, vi } from 'vitest';

import {
  buildVoiceTutorEmbeddedAppUrl,
  buildVoiceTutorStandaloneAppUrl,
  buildVoiceTutorStandaloneLauncherUrl,
  buildVoiceTutorStandaloneSessionExportUrl,
  createVoiceTutorConnectionProfile,
  deleteVoiceTutorStandaloneSession,
  deriveDefaultVoiceTutorBackendUrl,
  deriveSameOriginVoiceTutorLaunchConfig,
  deriveVoiceTrainerUrl,
  deriveVoiceTutorWebSocketUrl,
  fetchVoiceTutorStandaloneSessions,
  hasVoiceTutorLaunchConfigQueryOverride,
  readVoiceTutorConnectionProfilesFromStorage,
  normalizeVoiceTutorBaseUrl,
  normalizeVoiceTutorHttpUrl,
  normalizeVoiceTutorWebSocketBaseUrl,
  removeVoiceTutorConnectionProfile,
  readVoiceTutorLaunchConfigFromStorage,
  resolveVoiceTutorLaunchConfig,
  upsertVoiceTutorConnectionProfile,
  writeVoiceTutorConnectionProfilesToStorage,
  writeVoiceTutorLaunchConfigToStorage,
} from './standalone-launcher';

function createLocationRef(href: string) {
  const url = new URL(href);
  return {
    href: url.href,
    hostname: url.hostname,
    origin: url.origin,
    protocol: url.protocol,
  };
}

describe('voice standalone launcher', () => {
  it('derives local and remote default backend URLs from the frontend host', () => {
    expect(deriveDefaultVoiceTutorBackendUrl(createLocationRef('http://127.0.0.1:1421/voice-tutor.html')))
      .toBe('http://127.0.0.1:3021');
    expect(deriveDefaultVoiceTutorBackendUrl(createLocationRef('https://voice.example.com/voice-tutor.html')))
      .toBe('https://voice.example.com:3021');
  });

  it('derives same-origin HTTPS/WSS proxy config for deployed frontend hosts', () => {
    expect(deriveSameOriginVoiceTutorLaunchConfig(createLocationRef('https://voice.example.com/voice-tutor.html')))
      .toEqual({
        backendUrl: 'https://voice.example.com',
        backendWsUrl: 'wss://voice.example.com',
        voiceTrainerUrl: 'https://voice.example.com/voice-trainer',
      });
    expect(deriveSameOriginVoiceTutorLaunchConfig(createLocationRef('http://127.0.0.1:1421/voice-tutor.html')))
      .toEqual({
        backendUrl: 'http://127.0.0.1:1421',
        backendWsUrl: 'ws://127.0.0.1:1421',
        voiceTrainerUrl: 'http://127.0.0.1:1421/voice-trainer',
      });
  });

  it('normalizes backend, websocket, and trainer URLs', () => {
    expect(normalizeVoiceTutorBaseUrl('voice.local:3021/')).toBe('http://voice.local:3021');
    expect(deriveVoiceTutorWebSocketUrl('https://voice.example.com:3021')).toBe('wss://voice.example.com:3021');
    expect(deriveVoiceTrainerUrl('http://127.0.0.1:3021/')).toBe('http://127.0.0.1:3021/voice-trainer');
  });

  it('keeps HTTP and websocket launcher fields on their expected schemes', () => {
    expect(normalizeVoiceTutorHttpUrl('ws://backend.local:3021', 'http://fallback.local:3021'))
      .toBe('http://fallback.local:3021');
    expect(normalizeVoiceTutorHttpUrl('backend.local:3021', 'http://fallback.local:3021'))
      .toBe('http://backend.local:3021');
    expect(normalizeVoiceTutorWebSocketBaseUrl('http://backend.local:3021', 'ws://fallback.local:3021'))
      .toBe('ws://fallback.local:3021');
    expect(normalizeVoiceTutorWebSocketBaseUrl('backend.local:3021', 'ws://fallback.local:3021'))
      .toBe('ws://backend.local:3021');
  });

  it('prefers query parameters over stored launcher config', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        backendUrl: 'http://stored:3021',
        backendWsUrl: 'ws://stored:3021',
        voiceTrainerUrl: 'http://stored:3021/voice-trainer',
      })),
    };
    const config = resolveVoiceTutorLaunchConfig({
      locationRef: createLocationRef(
        'http://frontend.local/voice-tutor.html?backendUrl=http://backend.local:3021&backendWsUrl=ws://backend.local:3021&voiceTrainerUrl=http://trainer.local:8002',
      ),
      storage,
    });
    expect(config).toEqual({
      backendUrl: 'http://backend.local:3021',
      backendWsUrl: 'ws://backend.local:3021',
      voiceTrainerUrl: 'http://trainer.local:8002',
    });
  });

  it('forces the Android same-origin contract ahead of stale stored profiles', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        backendUrl: 'http://127.0.0.1:3021',
        backendWsUrl: 'ws://127.0.0.1:3021',
        voiceTrainerUrl: 'http://127.0.0.1:8002',
      })),
    };
    expect(resolveVoiceTutorLaunchConfig({
      locationRef: createLocationRef('https://DEVBOX.tail7b6aff.ts.net:3021/app?sameOrigin=1'),
      storage,
    })).toEqual({
      backendUrl: 'https://DEVBOX.tail7b6aff.ts.net:3021',
      backendWsUrl: 'wss://DEVBOX.tail7b6aff.ts.net:3021',
      voiceTrainerUrl: 'https://DEVBOX.tail7b6aff.ts.net:3021/voice-trainer',
    });
  });

  it('detects query overrides so shareable links are not masked by saved profiles', () => {
    expect(hasVoiceTutorLaunchConfigQueryOverride(createLocationRef('http://frontend.local/voice-tutor.html')))
      .toBe(false);
    expect(hasVoiceTutorLaunchConfigQueryOverride(createLocationRef('http://frontend.local/voice-tutor.html?backendUrl=http://backend.local:3021')))
      .toBe(true);
    expect(hasVoiceTutorLaunchConfigQueryOverride(createLocationRef('http://frontend.local/voice-tutor.html?voiceKernelWsUrl=ws://backend.local:3021')))
      .toBe(true);
    expect(hasVoiceTutorLaunchConfigQueryOverride(createLocationRef('https://voice.example.com/app?sameOrigin=1')))
      .toBe(true);
  });

  it('falls back when stored or query config uses the wrong URL scheme for a field', () => {
    const storage = {
      getItem: vi.fn(() => JSON.stringify({
        backendUrl: 'ws://stored:3021',
        backendWsUrl: 'http://stored:3021',
        voiceTrainerUrl: 'ws://stored:3021/voice-trainer',
      })),
    };
    const config = resolveVoiceTutorLaunchConfig({
      locationRef: createLocationRef('http://frontend.local:1421/voice-tutor.html?backendWsUrl=http://bad-ws.local:3021'),
      storage,
    });

    expect(config).toEqual({
      backendUrl: 'http://frontend.local:3021',
      backendWsUrl: 'ws://frontend.local:3021',
      voiceTrainerUrl: 'http://frontend.local:3021/voice-trainer',
    });
  });

  it('builds the embedded voice app handoff URL', () => {
    const url = new URL(buildVoiceTutorEmbeddedAppUrl({
      locationRef: createLocationRef('http://frontend.local:1421/voice-tutor.html'),
      config: {
        backendUrl: 'http://backend.local:3021',
        backendWsUrl: 'ws://backend.local:3021',
        voiceTrainerUrl: 'http://backend.local:3021/voice-trainer',
      },
    }));
    expect(url.origin).toBe('http://frontend.local:1421');
    expect(url.pathname).toBe('/');
    expect(url.searchParams.get('sloaneEmbeddedWorkspace')).toBe('1');
    expect(url.searchParams.get('sloaneMode')).toBe('voice');
    expect(url.searchParams.get('sloaneVoiceStandalone')).toBe('1');
    expect(url.searchParams.get('voiceKernelUrl')).toBe('http://backend.local:3021');
    expect(url.searchParams.get('voiceKernelWsUrl')).toBe('ws://backend.local:3021');
    expect(url.searchParams.get('voiceTrainerUrl')).toBe('http://backend.local:3021/voice-trainer');
  });

  it('builds the direct standalone app handoff URL', () => {
    const url = new URL(buildVoiceTutorStandaloneAppUrl({
      locationRef: createLocationRef('http://frontend.local:1421/voice-tutor.html'),
      config: {
        backendUrl: 'http://backend.local:3021',
        backendWsUrl: 'ws://backend.local:3021',
        voiceTrainerUrl: 'http://backend.local:3021/voice-trainer',
      },
    }));
    expect(url.origin).toBe('http://frontend.local:1421');
    expect(url.pathname).toBe('/voice-tutor-app.html');
    expect(url.searchParams.get('backendUrl')).toBe('http://backend.local:3021');
    expect(url.searchParams.get('backendWsUrl')).toBe('ws://backend.local:3021');
    expect(url.searchParams.get('voiceTrainerUrl')).toBe('http://backend.local:3021/voice-trainer');
    expect(url.searchParams.get('sloaneEmbeddedWorkspace')).toBeNull();
  });

  it('adds session resume and clean-start params to the direct handoff URL', () => {
    const config = {
      backendUrl: 'http://backend.local:3021',
      backendWsUrl: 'ws://backend.local:3021',
      voiceTrainerUrl: 'http://backend.local:3021/voice-trainer',
    };
    const resumeUrl = new URL(buildVoiceTutorStandaloneAppUrl({
      locationRef: createLocationRef('http://frontend.local:1421/voice-tutor.html'),
      config,
      session: { sessionId: 'voice-session-1' },
    }));
    const cleanUrl = new URL(buildVoiceTutorStandaloneAppUrl({
      locationRef: createLocationRef('http://frontend.local:1421/voice-tutor.html'),
      config,
      session: { newSession: true },
    }));

    expect(resumeUrl.searchParams.get('sessionId')).toBe('voice-session-1');
    expect(cleanUrl.searchParams.get('newSession')).toBe('1');
  });

  it('builds a shareable standalone launcher URL with backend profile params', () => {
    const url = new URL(buildVoiceTutorStandaloneLauncherUrl({
      locationRef: createLocationRef('https://voice.example.com/voice-tutor.html'),
      config: {
        backendUrl: 'https://backend.example.com:3021',
        backendWsUrl: 'wss://backend.example.com:3021',
        voiceTrainerUrl: 'https://backend.example.com:3021/voice-trainer',
      },
    }));

    expect(url.origin).toBe('https://voice.example.com');
    expect(url.pathname).toBe('/voice-tutor.html');
    expect(url.searchParams.get('backendUrl')).toBe('https://backend.example.com:3021');
    expect(url.searchParams.get('backendWsUrl')).toBe('wss://backend.example.com:3021');
    expect(url.searchParams.get('voiceTrainerUrl')).toBe('https://backend.example.com:3021/voice-trainer');
  });

  it('lists, exports, and deletes standalone sessions through the backend', async () => {
    const config = {
      backendUrl: 'http://backend.local:3021',
      backendWsUrl: 'ws://backend.local:3021',
      voiceTrainerUrl: 'http://backend.local:3021/voice-trainer',
    };
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => ({
      ok: true,
      status: 200,
      json: async () => (
        init?.method === 'DELETE'
          ? { success: true, deleted: true }
          : { success: true, sessions: [{ sessionId: 'voice-session-1', targetPreset: 'cute-feminine' }] }
      ),
    })) as unknown as typeof fetch;

    await expect(fetchVoiceTutorStandaloneSessions(config, fetchImpl)).resolves.toEqual([
      { sessionId: 'voice-session-1', targetPreset: 'cute-feminine' },
    ]);
    await expect(deleteVoiceTutorStandaloneSession(config, 'voice-session-1', fetchImpl)).resolves.toBe(true);
    expect(buildVoiceTutorStandaloneSessionExportUrl(config, 'voice-session-1'))
      .toBe('http://backend.local:3021/voice/standalone/sessions/voice-session-1/export');
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend.local:3021/voice/standalone/sessions?limit=100',
      { cache: 'no-store' },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      'http://backend.local:3021/voice/standalone/sessions/voice-session-1',
      { method: 'DELETE' },
    );
  });

  it('persists launcher config when storage is available', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) || null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const config = {
      backendUrl: 'http://backend.local:3021',
      backendWsUrl: 'ws://backend.local:3021',
      voiceTrainerUrl: 'http://backend.local:3021/voice-trainer',
    };
    writeVoiceTutorLaunchConfigToStorage(storage, config);
    expect(readVoiceTutorLaunchConfigFromStorage(storage)).toEqual(config);
  });

  it('persists multiple connection profiles with normalized URLs', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: vi.fn((key: string) => values.get(key) || null),
      setItem: vi.fn((key: string, value: string) => {
        values.set(key, value);
      }),
    };
    const localProfile = createVoiceTutorConnectionProfile({
      id: 'Local Backend',
      name: 'Local Backend',
      now: new Date('2026-05-28T00:00:00.000Z'),
      config: {
        backendUrl: 'http://127.0.0.1:3021',
        backendWsUrl: 'ws://127.0.0.1:3021',
        voiceTrainerUrl: 'http://127.0.0.1:3021/voice-trainer',
      },
    });
    const remoteProfile = createVoiceTutorConnectionProfile({
      id: 'meta-backend',
      name: 'Meta backend',
      now: new Date('2026-05-28T00:01:00.000Z'),
      config: {
        backendUrl: 'https://meta.example.com:3021',
        backendWsUrl: 'wss://meta.example.com:3021',
        voiceTrainerUrl: 'https://meta.example.com:3021/voice-trainer',
      },
    });

    writeVoiceTutorConnectionProfilesToStorage(storage, [localProfile, remoteProfile]);

    expect(readVoiceTutorConnectionProfilesFromStorage(storage)).toEqual([
      localProfile,
      remoteProfile,
    ]);
  });

  it('migrates a legacy last-used connection into a profile list', () => {
    const storage = {
      getItem: vi.fn((key: string) => {
        if (key !== 'sloane:voice-tutor:connection') {
          return null;
        }
        return JSON.stringify({
          backendUrl: 'http://legacy.local:3021',
          backendWsUrl: 'ws://legacy.local:3021',
          voiceTrainerUrl: 'http://legacy.local:3021/voice-trainer',
        });
      }),
    };

    expect(readVoiceTutorConnectionProfilesFromStorage(storage)).toEqual([
      {
        id: 'last-used',
        name: 'Last used backend',
        updatedAt: '1970-01-01T00:00:00.000Z',
        backendUrl: 'http://legacy.local:3021',
        backendWsUrl: 'ws://legacy.local:3021',
        voiceTrainerUrl: 'http://legacy.local:3021/voice-trainer',
      },
    ]);
  });

  it('upserts, caps, and removes connection profiles deterministically', () => {
    const originalProfile = createVoiceTutorConnectionProfile({
      id: 'local',
      name: 'Local backend',
      now: new Date('2026-05-28T00:00:00.000Z'),
      config: {
        backendUrl: 'http://127.0.0.1:3021',
        backendWsUrl: 'ws://127.0.0.1:3021',
        voiceTrainerUrl: 'http://127.0.0.1:3021/voice-trainer',
      },
    });
    const replacementProfile = createVoiceTutorConnectionProfile({
      id: 'local',
      name: 'Local backend updated',
      now: new Date('2026-05-28T00:01:00.000Z'),
      config: {
        backendUrl: 'http://localhost:3021',
        backendWsUrl: 'ws://localhost:3021',
        voiceTrainerUrl: 'http://localhost:3021/voice-trainer',
      },
    });
    const generatedProfiles = Array.from({ length: 14 }, (_, index) => createVoiceTutorConnectionProfile({
      id: `profile-${index}`,
      name: `Profile ${index}`,
      now: new Date(`2026-05-28T00:${String(index).padStart(2, '0')}:00.000Z`),
      config: {
        backendUrl: `http://voice-${index}.local:3021`,
        backendWsUrl: `ws://voice-${index}.local:3021`,
        voiceTrainerUrl: `http://voice-${index}.local:3021/voice-trainer`,
      },
    }));

    const upserted = upsertVoiceTutorConnectionProfile([originalProfile], replacementProfile);
    expect(upserted).toEqual([replacementProfile]);
    expect(upsertVoiceTutorConnectionProfile(generatedProfiles, replacementProfile)).toHaveLength(12);
    expect(removeVoiceTutorConnectionProfile(upserted, 'local')).toEqual([]);
  });
});
