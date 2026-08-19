import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  extractVoiceSessionScope,
  normalizeVoiceSessionTier,
  setupVoiceSessionScope,
  VOICE_SESSION_SCOPE_STORAGE_KEY,
  VOICE_SESSION_TIER_LABELS,
  VOICE_SESSION_TIER_ORDER,
  VOICE_SESSION_TIER_WIRE,
} from './session-scope';

type FakeStorage = Pick<Storage, 'getItem' | 'setItem'> & { data: Map<string, string> };

function fakeStorage(): FakeStorage {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

function scopeButton(): HTMLButtonElement {
  return document.getElementById('voice-session-scope') as HTMLButtonElement;
}

describe('session-scope tier normalization + payload extraction', () => {
  it('normalizes the wire vocabulary and calm synonyms; unknown -> null', () => {
    expect(normalizeVoiceSessionTier('full')).toBe('speaking');
    expect(normalizeVoiceSessionTier('quiet')).toBe('quiet');
    expect(normalizeVoiceSessionTier('silent')).toBe('listening');
    expect(normalizeVoiceSessionTier('LISTENING')).toBe('listening');
    expect(normalizeVoiceSessionTier('speaking')).toBe('speaking');
    expect(normalizeVoiceSessionTier('turbo')).toBeNull();
    expect(normalizeVoiceSessionTier(42)).toBeNull();
    expect(normalizeVoiceSessionTier(null)).toBeNull();
  });

  it('maps every canonical tier to a wire value the scope route accepts', () => {
    // Contract (B-SESS, live): only full | quiet | silent avoid a 400.
    expect(VOICE_SESSION_TIER_ORDER.map((tier) => VOICE_SESSION_TIER_WIRE[tier]))
      .toEqual(['full', 'quiet', 'silent']);
  });

  it('extracts sessionScope from the payload top level or extras, defensively', () => {
    expect(extractVoiceSessionScope({ sessionScope: { tier: 'silent', eyesFree: true } }))
      .toEqual({ tier: 'listening', eyesFree: true });
    expect(extractVoiceSessionScope({ extras: { sessionScope: { tier: 'full' } } }))
      .toEqual({ tier: 'speaking', eyesFree: null });
    expect(extractVoiceSessionScope({})).toBeNull();
    expect(extractVoiceSessionScope(null)).toBeNull();
    expect(extractVoiceSessionScope({ sessionScope: 'quiet' })).toBeNull();
    // Unknown tier inside a present scope: tier null, eyesFree still read.
    expect(extractVoiceSessionScope({ sessionScope: { tier: '??', eyesFree: false } }))
      .toEqual({ tier: null, eyesFree: false });
  });
});

describe('session-scope indicator (ambient control — never a gate)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div class="voice-coach-rail-header">
        <button type="button" id="voice-session-scope" class="voice-session-scope hidden">Speaking freely</button>
      </div>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('start() reveals the control with the calm default label and adds no dialog', () => {
    const handle = setupVoiceSessionScope({ doc: document, storage: fakeStorage() });
    handle.start();
    expect(scopeButton().classList.contains('hidden')).toBe(false);
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.speaking);
    // A control, never a startup prompt: nothing modal appears anywhere.
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    handle.dispose();
  });

  it('cycles tiers on tap and POSTs only wire vocabulary', async () => {
    const updateScope = vi.fn().mockResolvedValue({});
    const storage = fakeStorage();
    const handle = setupVoiceSessionScope({ doc: document, storage, updateScope });
    handle.start();

    scopeButton().click();
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.quiet);
    scopeButton().click();
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.listening);
    scopeButton().click();
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.speaking);

    expect(updateScope.mock.calls.map((call) => call[0])).toEqual(['quiet', 'silent', 'full']);
    // The person's last choice persists locally for the next open.
    expect(storage.data.get(VOICE_SESSION_SCOPE_STORAGE_KEY)).toBe('speaking');
    handle.dispose();
  });

  it('restores the stored tier on start', () => {
    const storage = fakeStorage();
    storage.data.set(VOICE_SESSION_SCOPE_STORAGE_KEY, 'listening');
    const handle = setupVoiceSessionScope({ doc: document, storage });
    handle.start();
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.listening);
    handle.dispose();
  });

  it('adopts the backend sessionScope from payloads until the person taps', () => {
    const handle = setupVoiceSessionScope({ doc: document, storage: fakeStorage() });
    handle.start();

    handle.applySessionPayload({ sessionScope: { tier: 'silent', eyesFree: true } });
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.listening);
    expect(handle.getEyesFree()).toBe(true);

    // The tap wins for the rest of the session — payload echoes never override.
    scopeButton().click(); // listening -> speaking
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.speaking);
    handle.applySessionPayload({ sessionScope: { tier: 'silent' } });
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.speaking);
    handle.dispose();
  });

  it('stays functional when the backend half is absent (POST rejects quietly)', async () => {
    const logs: string[] = [];
    const updateScope = vi.fn().mockRejectedValue(new Error('HTTP 404'));
    const handle = setupVoiceSessionScope({
      doc: document,
      storage: fakeStorage(),
      updateScope,
      addLog: (kind, message) => logs.push(`${kind}:${message}`),
    });
    handle.start();
    scopeButton().click();
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.quiet);
    await vi.waitFor(() => {
      expect(logs.some((line) => line.includes('backend sync skipped'))).toBe(true);
    });
    // The indicator itself never regressed.
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.quiet);
    handle.dispose();
  });

  it('missing button disables the surface without throwing', () => {
    document.body.innerHTML = '';
    const handle = setupVoiceSessionScope({ doc: document, storage: fakeStorage() });
    expect(() => {
      handle.start();
      handle.applySessionPayload({ sessionScope: { tier: 'quiet' } });
      handle.cycle();
      handle.dispose();
    }).not.toThrow();
  });
});

describe('session-scope remembered-habit seeding (greeting.tierDefault)', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <button type="button" id="voice-session-scope" class="voice-session-scope hidden"></button>
    `;
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
  });

  it('seeds ONCE from a different remembered tier while the session sits at the default', () => {
    const updateScope = vi.fn().mockResolvedValue({});
    const handle = setupVoiceSessionScope({ doc: document, storage: fakeStorage(), updateScope });
    handle.start();

    handle.seedFromGreeting('quiet');
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.quiet);
    expect(updateScope).toHaveBeenCalledTimes(1);
    expect(updateScope).toHaveBeenCalledWith('quiet');

    // Second greeting echo never re-seeds.
    handle.seedFromGreeting('silent');
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.quiet);
    expect(updateScope).toHaveBeenCalledTimes(1);
    handle.dispose();
  });

  it('never seeds over a user tap or a non-default session scope', () => {
    const updateScope = vi.fn().mockResolvedValue({});
    const handle = setupVoiceSessionScope({ doc: document, storage: fakeStorage(), updateScope });
    handle.start();

    // The person tapped first: their choice stands.
    scopeButton().click(); // speaking -> quiet (one POST)
    handle.seedFromGreeting('silent');
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.quiet);
    expect(updateScope).toHaveBeenCalledTimes(1);
    handle.dispose();

    // A session already carrying a non-default scope is left alone.
    const updateScope2 = vi.fn().mockResolvedValue({});
    const handle2 = setupVoiceSessionScope({ doc: document, storage: fakeStorage(), updateScope: updateScope2 });
    handle2.start();
    handle2.applySessionPayload({ sessionScope: { tier: 'silent' } });
    handle2.seedFromGreeting('quiet');
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.listening);
    expect(updateScope2).not.toHaveBeenCalled();
    handle2.dispose();
  });

  it('ignores null/unknown remembered tiers and a tierDefault equal to the default', () => {
    const updateScope = vi.fn().mockResolvedValue({});
    const handle = setupVoiceSessionScope({ doc: document, storage: fakeStorage(), updateScope });
    handle.start();
    handle.seedFromGreeting(null);
    handle.seedFromGreeting('??');
    handle.seedFromGreeting('full'); // same as the current default — nothing to seed
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.speaking);
    expect(updateScope).not.toHaveBeenCalled();
    // ...and those no-ops did not burn the one-shot: a real seed still works.
    handle.seedFromGreeting('silent');
    expect(scopeButton().textContent).toBe(VOICE_SESSION_TIER_LABELS.listening);
    expect(updateScope).toHaveBeenCalledWith('silent');
    handle.dispose();
  });
});
