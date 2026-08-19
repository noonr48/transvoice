import { describe, expect, it, vi } from 'vitest';

import {
  getVoiceTutorStandaloneSessionStorageKey,
  resolveVoiceTutorStandaloneSessionId,
} from './standalone-session';

function createStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => {
      values.set(key, value);
    }),
    removeItem: vi.fn((key: string) => {
      values.delete(key);
    }),
    values,
  };
}

describe('voice tutor standalone session id', () => {
  it('creates and stores a backend-scoped session id on first launch', () => {
    const storage = createStorage();
    const resolved = resolveVoiceTutorStandaloneSessionId({
      createSessionId: () => 'session-new',
      locationRef: { search: '' },
      storage,
      storageScope: 'http://127.0.0.1:3021',
    });

    expect(resolved.sessionId).toBe('session-new');
    expect(resolved.source).toBe('new');
    expect(storage.setItem).toHaveBeenCalledWith(resolved.storageKey, 'session-new');
    expect(resolved.storageKey).toBe(getVoiceTutorStandaloneSessionStorageKey('http://127.0.0.1:3021'));
  });

  it('reuses the saved id for the same backend scope', () => {
    const storageKey = getVoiceTutorStandaloneSessionStorageKey('http://127.0.0.1:3021');
    const storage = createStorage({ [storageKey]: 'session-saved' });
    const resolved = resolveVoiceTutorStandaloneSessionId({
      createSessionId: () => 'session-new',
      locationRef: { search: '' },
      storage,
      storageScope: 'http://127.0.0.1:3021',
    });

    expect(resolved.sessionId).toBe('session-saved');
    expect(resolved.source).toBe('storage');
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it('lets explicit session links override saved browser state', () => {
    const storageKey = getVoiceTutorStandaloneSessionStorageKey('http://127.0.0.1:3021');
    const storage = createStorage({ [storageKey]: 'session-saved' });
    const resolved = resolveVoiceTutorStandaloneSessionId({
      createSessionId: () => 'session-new',
      locationRef: { search: '?sessionId=session-linked' },
      storage,
      storageScope: 'http://127.0.0.1:3021',
    });

    expect(resolved.sessionId).toBe('session-linked');
    expect(resolved.source).toBe('query');
    expect(storage.setItem).toHaveBeenCalledWith(storageKey, 'session-linked');
  });

  it('starts a clean session when requested', () => {
    const storageKey = getVoiceTutorStandaloneSessionStorageKey('http://127.0.0.1:3021');
    const storage = createStorage({ [storageKey]: 'session-saved' });
    const resolved = resolveVoiceTutorStandaloneSessionId({
      createSessionId: () => 'session-new',
      locationRef: { search: '?newSession=1&sessionId=session-linked' },
      storage,
      storageScope: 'http://127.0.0.1:3021',
    });

    expect(resolved.sessionId).toBe('session-new');
    expect(resolved.source).toBe('new');
    expect(storage.removeItem).toHaveBeenCalledWith(storageKey);
    expect(storage.setItem).toHaveBeenCalledWith(storageKey, 'session-new');
  });
});
