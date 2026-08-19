import { describe, expect, it, vi } from 'vitest';

import { resolveVoiceTutorStandaloneEntrypoint } from './standalone-entrypoint';

function createWindowRef(href: string) {
  const url = new URL(href);
  return {
    history: {
      replaceState: vi.fn(),
    },
    location: {
      href: url.toString(),
      hostname: url.hostname,
      origin: url.origin,
      pathname: url.pathname,
      protocol: url.protocol,
    },
  };
}

describe('voice tutor standalone entrypoint', () => {
  it('stays disabled for the normal SLOANE app', () => {
    const resolved = resolveVoiceTutorStandaloneEntrypoint({
      windowRef: createWindowRef('http://127.0.0.1:1420/'),
      env: {},
    });

    expect(resolved.enabled).toBe(false);
    expect(resolved.kernelUrl).toBeNull();
    expect(resolved.voiceTrainerUrl).toBeNull();
  });

  it('defaults standalone voice mode to the local gateway and VoiceTrainer proxy', () => {
    const resolved = resolveVoiceTutorStandaloneEntrypoint({
      windowRef: createWindowRef('http://127.0.0.1:1420/?sloaneVoiceStandalone=1'),
      env: {},
    });

    expect(resolved.enabled).toBe(true);
    expect(resolved.source).toBe('query');
    expect(resolved.kernelUrl).toBe('http://127.0.0.1:3021');
    expect(resolved.kernelWsUrl).toBe('ws://127.0.0.1:3021');
    expect(resolved.voiceTrainerUrl).toBe('http://127.0.0.1:3021/voice-trainer');
  });

  it('keeps remote browser host alignment for standalone preview URLs', () => {
    const resolved = resolveVoiceTutorStandaloneEntrypoint({
      windowRef: createWindowRef('http://100.74.168.24:1421/?sloaneVoiceStandalone=1'),
      env: {},
    });

    expect(resolved.kernelUrl).toBe('http://100.74.168.24:3021');
    expect(resolved.voiceTrainerUrl).toBe('http://100.74.168.24:3021/voice-trainer');
  });

  it('allows query overrides for kernel and VoiceTrainer URLs', () => {
    const resolved = resolveVoiceTutorStandaloneEntrypoint({
      windowRef: createWindowRef(
        'http://127.0.0.1:1420/?sloaneVoiceStandalone=1&voiceKernelUrl=http%3A%2F%2Fvoice.local%3A3021&voiceTrainerUrl=http%3A%2F%2Fvoice.local%3A3021%2Fvoice-trainer',
      ),
      env: {},
    });

    expect(resolved.kernelUrl).toBe('http://voice.local:3021');
    expect(resolved.kernelWsUrl).toBe('ws://voice.local:3021');
    expect(resolved.voiceTrainerUrl).toBe('http://voice.local:3021/voice-trainer');
  });

  it('enforces embedded voice mode before app composition reads URL state', () => {
    const windowRef = createWindowRef('http://127.0.0.1:1420/?sloaneVoiceStandalone=1');
    const resolved = resolveVoiceTutorStandaloneEntrypoint({ windowRef, env: {} });

    resolved.applyEmbeddedWorkspaceMode();

    const replaceCall = windowRef.history.replaceState.mock.calls[0];
    expect(String(replaceCall?.[2])).toContain('sloaneEmbeddedWorkspace=1');
    expect(String(replaceCall?.[2])).toContain('sloaneMode=voice');
  });
});
