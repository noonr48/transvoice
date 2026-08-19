import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  noteVoiceSpeechReferenceResolution,
  setupVoiceCoachHonesty,
} from './coach-honesty';

function mountHonestyDom(): { fallbackEl: HTMLElement; standinEl: HTMLElement } {
  document.body.innerHTML = `
    <p id="voice-coach-fallback-note" class="hidden">Coach is offline — basic guidance mode</p>
    <p id="voice-speech-standin-note" class="hidden">Tutor voice unavailable — the selected voice sample could not be used</p>
  `;
  return {
    fallbackEl: document.getElementById('voice-coach-fallback-note') as HTMLElement,
    standinEl: document.getElementById('voice-speech-standin-note') as HTMLElement,
  };
}

function coachReplyPayload(extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    voiceState: {
      coachThread: [
        { id: 'u1', role: 'user', content: 'How was that?' },
        { id: 'c1', role: 'coach', content: 'The ending held — keep it that light.' },
      ],
      ...extras,
    },
  };
}

describe('voice coach honesty surfaces', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('shows the fallback chip on fallbackReply and clears it on the next real reply', () => {
    const { fallbackEl } = mountHonestyDom();
    const addLog = vi.fn();
    const honesty = setupVoiceCoachHonesty({ doc: document, addLog });
    honesty.start();

    // Defensive: payloads without the flag are a no-op.
    honesty.applyCoachPayload(coachReplyPayload());
    expect(fallbackEl.classList.contains('hidden')).toBe(true);

    // Top-level flag turns the chip on.
    honesty.applyCoachPayload({ ...coachReplyPayload(), fallbackReply: true });
    expect(fallbackEl.classList.contains('hidden')).toBe(false);
    expect(honesty.isFallbackShown()).toBe(true);
    expect(addLog).toHaveBeenCalledWith('system', '[voice-surface] fallback chip on');

    // Unrelated payloads (no coach reply) must NOT clear the chip.
    honesty.applyCoachPayload({ voiceState: { status: 'active' } });
    expect(fallbackEl.classList.contains('hidden')).toBe(false);

    // The next REAL coach reply clears it.
    honesty.applyCoachPayload(coachReplyPayload());
    expect(fallbackEl.classList.contains('hidden')).toBe(true);
    expect(addLog).toHaveBeenCalledWith('system', '[voice-surface] fallback chip off');
    honesty.dispose();
  });

  it('reads the fallback flag from inside voiceState as well', () => {
    const { fallbackEl } = mountHonestyDom();
    const honesty = setupVoiceCoachHonesty({ doc: document });
    honesty.start();
    honesty.applyCoachPayload(coachReplyPayload({ fallbackReply: true }));
    expect(fallbackEl.classList.contains('hidden')).toBe(false);
    honesty.dispose();
  });

  it('shows the selected-voice unavailable notice once per session via the speech listener', () => {
    const { standinEl } = mountHonestyDom();
    const addLog = vi.fn();
    const honesty = setupVoiceCoachHonesty({ doc: document, addLog });
    honesty.start();

    // Resolved references never surface the notice.
    noteVoiceSpeechReferenceResolution(true);
    expect(standinEl.classList.contains('hidden')).toBe(true);

    // The transport reports an unresolved reference -> notice shows once.
    noteVoiceSpeechReferenceResolution(false);
    expect(standinEl.classList.contains('hidden')).toBe(false);
    expect(addLog).toHaveBeenCalledWith('system', '[voice-surface] tutor voice unavailable notice shown');

    // Once per session: manual hide then a second report stays quiet.
    standinEl.classList.add('hidden');
    noteVoiceSpeechReferenceResolution(false);
    expect(standinEl.classList.contains('hidden')).toBe(true);
    honesty.dispose();

    // After dispose the listener is detached (no throw, no effect).
    expect(() => noteVoiceSpeechReferenceResolution(false)).not.toThrow();
  });

  it('never throws on malformed payloads', () => {
    mountHonestyDom();
    const honesty = setupVoiceCoachHonesty({ doc: document });
    honesty.start();
    expect(() => {
      honesty.applyCoachPayload(null);
      honesty.applyCoachPayload('nope');
      honesty.applyCoachPayload({ voiceState: 42 });
      honesty.applyCoachPayload({ voiceState: { coachThread: 'bad' } });
    }).not.toThrow();
    honesty.dispose();
  });
});
