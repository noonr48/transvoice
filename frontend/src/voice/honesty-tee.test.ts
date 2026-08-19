import { describe, expect, it, vi } from 'vitest';

import {
  bindBackendPayloadTee,
  emitBackendPayloadTee,
  setupVoiceCoachHonesty,
} from './coach-honesty';

// Regression for the W4 blocker: live coach replies apply through the
// request-controller / controller-graph paths, which do NOT go through the
// host-assembly onBackendPayload tee — the honesty chip must be fed by the
// document-event tee those apply sites emit.
describe('backend payload tee (honesty seam)', () => {
  it('delivers emitted payloads to the bound listener and stops after dispose', () => {
    const seen: unknown[] = [];
    const dispose = bindBackendPayloadTee((payload) => seen.push(payload));

    const payload = { fallbackReply: true, voiceState: {} };
    emitBackendPayloadTee(payload);
    expect(seen).toEqual([payload]);

    dispose();
    emitBackendPayloadTee({ fallbackReply: true });
    expect(seen).toHaveLength(1);
  });

  it('ignores empty payloads', () => {
    const listener = vi.fn();
    const dispose = bindBackendPayloadTee(listener);
    emitBackendPayloadTee(null);
    emitBackendPayloadTee(undefined);
    expect(listener).not.toHaveBeenCalled();
    dispose();
  });

  it('drives the fallback chip end-to-end through the tee (the live-path shape)', () => {
    document.body.innerHTML = `
      <p id="voice-coach-fallback-note" class="hidden" hidden></p>
      <p id="voice-speech-standin-note" class="hidden" hidden></p>
    `;
    const honesty = setupVoiceCoachHonesty({ doc: document, addLog: () => {} });
    honesty.start();
    const dispose = bindBackendPayloadTee((payload) => honesty.applyCoachPayload(payload));

    emitBackendPayloadTee({ fallbackReply: true, voiceState: {} });
    expect(honesty.isFallbackShown()).toBe(true);

    dispose();
    honesty.dispose();
  });
});
