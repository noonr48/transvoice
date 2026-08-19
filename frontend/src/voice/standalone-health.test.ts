import { describe, expect, it, vi } from 'vitest';

import {
  checkVoiceTutorStandaloneHealth,
  formatVoiceTutorStandaloneHealthReport,
  type VoiceTutorStandaloneHealthSummary,
} from './standalone-health';
import type { VoiceTutorLaunchConfig } from './standalone-launcher';

const config: VoiceTutorLaunchConfig = {
  backendUrl: 'http://voice.local:3021',
  backendWsUrl: 'ws://voice.local:3021',
  voiceTrainerUrl: 'http://voice.local:3021/voice-trainer',
};

function jsonResponse(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(payload),
  } as Response;
}

function browserOptions(overrides: {
  isSecureContext?: boolean;
  protocol?: string;
  hostname?: string;
  hasGetUserMedia?: boolean;
} = {}) {
  return {
    windowRef: {
      isSecureContext: overrides.isSecureContext ?? true,
      location: {
        protocol: overrides.protocol ?? 'https:',
        hostname: overrides.hostname ?? 'voice.example.com',
      },
    } as Pick<Window, 'isSecureContext' | 'location'>,
    navigatorRef: {
      mediaDevices: overrides.hasGetUserMedia === false
        ? {}
        : { getUserMedia: vi.fn() },
    } as Pick<Navigator, 'mediaDevices'>,
  };
}

function getLayer(summary: VoiceTutorStandaloneHealthSummary, id: string) {
  const layer = summary.layers.find((candidate) => candidate.id === id);
  if (!layer) {
    throw new Error(`Missing layer ${id}`);
  }
  return layer;
}

describe('voice standalone layered health', () => {
  it('reports online only when gateway, sessions, services, and browser mic are ready', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return jsonResponse(200, {
          status: 'online',
          services: {
            voiceTrainer: { status: 'online' },
            voiceTutorGguf: { status: 'online' },
          },
        });
      }
      return jsonResponse(200, {
        success: true,
        sessionStore: { writeBlocked: false },
        sessions: [],
      });
    }) as unknown as typeof fetch;

    const summary = await checkVoiceTutorStandaloneHealth(config, {
      fetchImpl,
      now: new Date('2026-05-28T00:00:00.000Z'),
      ...browserOptions(),
    });

    expect(summary.overall).toBe('online');
    expect(summary.layers.map((layer) => [layer.id, layer.status])).toEqual([
      ['gateway', 'online'],
      ['sessionStore', 'online'],
      ['voiceTrainer', 'online'],
      ['voiceTutorGguf', 'online'],
      ['browserMic', 'online'],
    ]);
    expect(fetchImpl).toHaveBeenCalledWith('http://voice.local:3021/health', { cache: 'no-store' });
    expect(fetchImpl).toHaveBeenCalledWith('http://voice.local:3021/voice/standalone/sessions?limit=1', { cache: 'no-store' });
  });

  it('keeps gateway and session status visible when a dependency makes /health fail', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return jsonResponse(503, {
          status: 'degraded',
          services: {
            voiceTrainer: { status: 'offline', error: 'trainer refused connection' },
            voiceTutorGguf: { status: 'online' },
          },
        });
      }
      return jsonResponse(200, {
        success: true,
        sessionStore: { writeBlocked: false },
        sessions: [],
      });
    }) as unknown as typeof fetch;

    const summary = await checkVoiceTutorStandaloneHealth(config, {
      fetchImpl,
      ...browserOptions(),
    });

    expect(summary.overall).toBe('degraded');
    expect(getLayer(summary, 'gateway').status).toBe('online');
    expect(getLayer(summary, 'sessionStore').status).toBe('online');
    expect(getLayer(summary, 'voiceTrainer').status).toBe('offline');
    expect(getLayer(summary, 'voiceTutorGguf').status).toBe('online');
    expect(formatVoiceTutorStandaloneHealthReport(summary)).toContain('VoiceTrainer: OFFLINE');
  });

  it('can include active readiness probes without masking cheap liveness layers', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return jsonResponse(200, {
          status: 'online',
          services: {
            voiceTrainer: { status: 'online' },
            voiceTutorGguf: { status: 'online' },
          },
        });
      }
      if (url.includes('/voice/standalone/readiness')) {
        return jsonResponse(503, {
          status: 'offline',
          probes: [
            { id: 'sessionStoreWrite', label: 'Session store write', status: 'online', detail: 'Saved 1 session.', durationMs: 4 },
            { id: 'voiceTrainerCleanup', label: 'VoiceTrainer cleanup', status: 'online', detail: 'Ended readiness session.', durationMs: 5 },
            { id: 'voiceTutorGgufChat', label: 'GGUF chat completion', status: 'offline', detail: 'HTTP 500', durationMs: 25 },
          ],
        });
      }
      return jsonResponse(200, {
        success: true,
        sessionStore: { writeBlocked: false },
        sessions: [],
      });
    }) as unknown as typeof fetch;

    const summary = await checkVoiceTutorStandaloneHealth(config, {
      fetchImpl,
      forceReadiness: true,
      includeReadiness: true,
      ...browserOptions(),
    });

    expect(summary.overall).toBe('degraded');
    expect(getLayer(summary, 'gateway').status).toBe('online');
    expect(getLayer(summary, 'sessionStoreWrite')).toMatchObject({
      status: 'online',
      detail: 'Saved 1 session. (4ms)',
    });
    expect(getLayer(summary, 'voiceTutorGgufChat')).toMatchObject({
      status: 'offline',
      detail: 'HTTP 500 (25ms)',
    });
    expect(getLayer(summary, 'voiceTrainerCleanup')).toMatchObject({
      status: 'online',
      detail: 'Ended readiness session. (5ms)',
    });
    expect(summary.readinessPayload).toEqual(expect.objectContaining({ status: 'offline' }));
    expect(fetchImpl).toHaveBeenCalledWith('http://voice.local:3021/voice/standalone/readiness?force=1', { cache: 'no-store' });
  });

  it('marks session persistence and browser mic as degraded with actionable detail', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.endsWith('/health')) {
        return jsonResponse(200, {
          status: 'online',
          services: {
            voiceTrainer: { status: 'online' },
            voiceTutorGguf: { status: 'online' },
          },
        });
      }
      return jsonResponse(200, {
        success: true,
        sessionStore: {
          writeBlocked: true,
          writeBlockedReason: 'read-only filesystem',
        },
        sessions: [],
      });
    }) as unknown as typeof fetch;

    const summary = await checkVoiceTutorStandaloneHealth(config, {
      fetchImpl,
      ...browserOptions({
        isSecureContext: false,
        protocol: 'http:',
        hostname: 'voice.example.com',
      }),
    });

    expect(summary.overall).toBe('degraded');
    expect(getLayer(summary, 'sessionStore')).toMatchObject({
      status: 'degraded',
      detail: 'Session writes are blocked: read-only filesystem',
    });
    expect(getLayer(summary, 'browserMic')).toMatchObject({
      status: 'degraded',
      detail: 'Microphone capture requires localhost, HTTPS, or a native wrapper.',
    });
  });

  it('reports offline only when the backend gateway cannot be reached', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('network unreachable');
    }) as unknown as typeof fetch;

    const summary = await checkVoiceTutorStandaloneHealth(config, {
      fetchImpl,
      ...browserOptions(),
    });

    expect(summary.overall).toBe('offline');
    expect(getLayer(summary, 'gateway').status).toBe('offline');
    expect(summary.errors).toEqual(['network unreachable', 'network unreachable']);
  });
});
