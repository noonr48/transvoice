export const VOICE_TUTOR_STANDALONE_SESSION_ID_STORAGE_KEY = 'sloane.voiceTutor.standalone.sessionId.v1';

export type VoiceTutorStandaloneSessionIdSource = 'query' | 'storage' | 'new';

export interface VoiceTutorStandaloneSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface VoiceTutorStandaloneSessionResolution {
  sessionId: string;
  source: VoiceTutorStandaloneSessionIdSource;
  storageKey: string;
}

export interface ResolveVoiceTutorStandaloneSessionIdOptions {
  createSessionId?: () => string;
  locationRef?: Pick<Location, 'search'> | null;
  storage?: VoiceTutorStandaloneSessionStorage | null;
  storageScope?: string | null;
}

function normalizeStandaloneSessionId(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, 160) : null;
}

function createDefaultStandaloneSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `voice-standalone-${crypto.randomUUID()}`;
  }
  return `voice-standalone-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hashStorageScope(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return (hash >>> 0).toString(36);
}

export function getVoiceTutorStandaloneSessionStorageKey(scope?: string | null): string {
  const normalizedScope = normalizeStandaloneSessionId(scope || '');
  if (!normalizedScope) {
    return VOICE_TUTOR_STANDALONE_SESSION_ID_STORAGE_KEY;
  }
  return `${VOICE_TUTOR_STANDALONE_SESSION_ID_STORAGE_KEY}.${hashStorageScope(normalizedScope)}`;
}

function persistSessionId(storage: VoiceTutorStandaloneSessionStorage | null | undefined, key: string, sessionId: string): void {
  try {
    storage?.setItem(key, sessionId);
  } catch {
    // Browser storage may be blocked. The app can still use the resolved ID for this run.
  }
}

function removePersistedSessionId(storage: VoiceTutorStandaloneSessionStorage | null | undefined, key: string): void {
  try {
    storage?.removeItem(key);
  } catch {
    // Browser storage may be blocked. Ignore reset failures.
  }
}

function readPersistedSessionId(storage: VoiceTutorStandaloneSessionStorage | null | undefined, key: string): string | null {
  try {
    return normalizeStandaloneSessionId(storage?.getItem(key) || null);
  } catch {
    return null;
  }
}

function resolveQuerySessionId(params: URLSearchParams): string | null {
  return normalizeStandaloneSessionId(
    params.get('sessionId')
      || params.get('sloaneSessionId')
      || params.get('voiceTutorSessionId'),
  );
}

function shouldCreateNewSession(params: URLSearchParams): boolean {
  const value = String(params.get('newSession') || params.get('resetSession') || '').trim().toLowerCase();
  return ['1', 'true', 'yes', 'new'].includes(value);
}

export function resolveVoiceTutorStandaloneSessionId(
  options: ResolveVoiceTutorStandaloneSessionIdOptions = {},
): VoiceTutorStandaloneSessionResolution {
  const storageKey = getVoiceTutorStandaloneSessionStorageKey(options.storageScope);
  const params = new URLSearchParams(options.locationRef?.search || '');
  const createSessionId = options.createSessionId || createDefaultStandaloneSessionId;

  if (shouldCreateNewSession(params)) {
    removePersistedSessionId(options.storage, storageKey);
    const sessionId = createSessionId();
    persistSessionId(options.storage, storageKey, sessionId);
    return { sessionId, source: 'new', storageKey };
  }

  const querySessionId = resolveQuerySessionId(params);
  if (querySessionId) {
    persistSessionId(options.storage, storageKey, querySessionId);
    return { sessionId: querySessionId, source: 'query', storageKey };
  }

  const storedSessionId = readPersistedSessionId(options.storage, storageKey);
  if (storedSessionId) {
    return { sessionId: storedSessionId, source: 'storage', storageKey };
  }

  const sessionId = createSessionId();
  persistSessionId(options.storage, storageKey, sessionId);
  return { sessionId, source: 'new', storageKey };
}
