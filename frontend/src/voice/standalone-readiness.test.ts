import { describe, expect, it } from 'vitest';

import { resolveVoiceTutorStandaloneReadinessStatus } from './standalone-readiness';

describe('voice standalone readiness', () => {
  it('does not report online when the standalone backend health check fails', () => {
    expect(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline: false,
      voiceUiState: {
        serviceStatus: 'online',
        lastError: null,
      },
    })).toBe('OFFLINE');
  });

  it('reports degraded when health is reachable but practice bootstrap records an error', () => {
    expect(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline: true,
      healthSummaryStatus: 'online',
      voiceUiState: {
        serviceStatus: 'error',
        lastError: 'audio transport failed',
      },
    })).toBe('DEGRADED');
  });

  it('does not degrade a currently-healthy stack over a stale historical lastError', () => {
    expect(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline: true,
      healthSummaryStatus: 'online',
      voiceUiState: {
        serviceStatus: 'online',
        lastError: 'an old error from earlier in the session',
      },
    })).toBe('ONLINE');
  });

  it('reports online in the healthy IDLE state (practice stream not yet armed)', () => {
    expect(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline: true,
      healthSummaryStatus: 'online',
      voiceUiState: {
        serviceStatus: 'offline',
        lastError: null,
      },
    })).toBe('ONLINE');
  });

  it('reports online only after healthy bootstrap state', () => {
    expect(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline: true,
      healthSummaryStatus: 'online',
      voiceUiState: {
        serviceStatus: 'online',
        lastError: null,
      },
    })).toBe('ONLINE');
  });

  it('reports degraded when the gateway is reachable but a standalone runtime layer is unhealthy', () => {
    expect(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline: false,
      healthSummaryStatus: 'degraded',
      voiceUiState: {
        serviceStatus: 'offline',
        lastError: null,
      },
    })).toBe('DEGRADED');
  });

  it('reports degraded when browser or session diagnostics are degraded after health bootstrap', () => {
    expect(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline: true,
      healthSummaryStatus: 'degraded',
      voiceUiState: {
        serviceStatus: 'online',
        lastError: null,
      },
    })).toBe('DEGRADED');
  });
});
