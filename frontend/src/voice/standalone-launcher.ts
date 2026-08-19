import {
  bindVoiceTutorStandaloneInstallPrompt,
  registerVoiceTutorStandaloneServiceWorker,
} from './standalone-pwa';
import {
  checkVoiceTutorStandaloneHealth,
  formatVoiceTutorStandaloneHealthReport,
} from './standalone-health';
import { bindLearnerMemorySettings } from './learner-memory-settings';

export type VoiceTutorLaunchConfig = {
  backendUrl: string;
  backendWsUrl: string;
  voiceTrainerUrl: string;
};

export type VoiceTutorConnectionProfile = VoiceTutorLaunchConfig & {
  id: string;
  name: string;
  updatedAt: string;
};

export type VoiceTutorStandaloneSessionSummary = {
  sessionId: string;
  studentId?: string | null;
  updatedAt?: number | null;
  createdAt?: number | null;
  status?: string | null;
  targetPreset?: string | null;
  hasNotepad?: boolean;
  hasSummary?: boolean;
  lastCoachMessage?: string | null;
};

export type VoiceTutorStandaloneSessionListResponse = {
  success: boolean;
  sessions: VoiceTutorStandaloneSessionSummary[];
};

export type VoiceTutorStandaloneLaunchSessionOptions = {
  sessionId?: string | null;
  newSession?: boolean;
};

const STORAGE_KEY = 'sloane:voice-tutor:connection';
const PROFILE_STORAGE_KEY = 'sloane:voice-tutor:connection-profiles';
const ACTIVE_PROFILE_STORAGE_KEY = 'sloane:voice-tutor:active-connection-profile';
const MAX_CONNECTION_PROFILES = 12;

type StoredVoiceTutorLaunchConfig = Partial<VoiceTutorLaunchConfig>;

function isLocalHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

type VoiceTutorUrlProtocol = 'http:' | 'https:' | 'ws:' | 'wss:';

function normalizeVoiceTutorUrl(
  value: unknown,
  fallback: string,
  options: {
    allowedProtocols: VoiceTutorUrlProtocol[];
    defaultProtocol: 'http' | 'ws';
  },
): string {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) {
    return fallback;
  }
  const rawWithScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw)
    ? raw
    : `${options.defaultProtocol}://${raw}`;
  try {
    const parsed = new URL(rawWithScheme);
    if (!options.allowedProtocols.includes(parsed.protocol as VoiceTutorUrlProtocol)) {
      return fallback;
    }
    return trimTrailingSlash(parsed.toString());
  } catch {
    return fallback;
  }
}

function getLauncherStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function normalizeVoiceTutorBaseUrl(value: unknown, fallback = ''): string {
  return normalizeVoiceTutorUrl(value, fallback, {
    allowedProtocols: ['http:', 'https:', 'ws:', 'wss:'],
    defaultProtocol: 'http',
  });
}

export function normalizeVoiceTutorHttpUrl(value: unknown, fallback = ''): string {
  return normalizeVoiceTutorUrl(value, fallback, {
    allowedProtocols: ['http:', 'https:'],
    defaultProtocol: 'http',
  });
}

export function normalizeVoiceTutorWebSocketBaseUrl(value: unknown, fallback = ''): string {
  return normalizeVoiceTutorUrl(value, fallback, {
    allowedProtocols: ['ws:', 'wss:'],
    defaultProtocol: 'ws',
  });
}

export function deriveVoiceTutorWebSocketUrl(backendUrl: string): string {
  try {
    const url = new URL(backendUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.pathname = '';
    url.search = '';
    url.hash = '';
    return trimTrailingSlash(url.toString());
  } catch {
    return '';
  }
}

export function deriveVoiceTrainerUrl(backendUrl: string): string {
  return `${trimTrailingSlash(backendUrl)}/voice-trainer`;
}

export function deriveDefaultVoiceTutorBackendUrl(locationRef: Pick<Location, 'hostname' | 'protocol'>): string {
  const hostname = locationRef.hostname && locationRef.hostname !== '0.0.0.0'
    ? locationRef.hostname
    : '127.0.0.1';
  const protocol = locationRef.protocol === 'https:' && !isLocalHostname(hostname) ? 'https:' : 'http:';
  return `${protocol}//${hostname}:3021`;
}

export function deriveSameOriginVoiceTutorLaunchConfig(
  locationRef: Pick<Location, 'origin' | 'hostname' | 'protocol'>,
): VoiceTutorLaunchConfig {
  const backendUrl = normalizeVoiceTutorHttpUrl(
    locationRef.origin,
    deriveDefaultVoiceTutorBackendUrl(locationRef),
  );
  return {
    backendUrl,
    backendWsUrl: deriveVoiceTutorWebSocketUrl(backendUrl),
    voiceTrainerUrl: deriveVoiceTrainerUrl(backendUrl),
  };
}

export function readVoiceTutorLaunchConfigFromStorage(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): StoredVoiceTutorLaunchConfig {
  if (!storage) {
    return {};
  }
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function writeVoiceTutorLaunchConfigToStorage(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  config: VoiceTutorLaunchConfig,
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
  }
}

function slugifyProfileId(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 80);
  return slug || 'voice-tutor-backend';
}

export function normalizeVoiceTutorProfileName(value: unknown, fallback = 'Voice Tutor backend'): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/gu, ' ') : '';
  return name || fallback;
}

function inferProfileNameFromConfig(config: VoiceTutorLaunchConfig): string {
  try {
    const url = new URL(config.backendUrl);
    return url.host || config.backendUrl;
  } catch {
    return 'Voice Tutor backend';
  }
}

function normalizeVoiceTutorConnectionProfile(value: unknown): VoiceTutorConnectionProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const candidate = value as Partial<VoiceTutorConnectionProfile>;
  const backendUrl = normalizeVoiceTutorHttpUrl(candidate.backendUrl, '');
  if (!backendUrl) {
    return null;
  }
  const config: VoiceTutorLaunchConfig = {
    backendUrl,
    backendWsUrl: normalizeVoiceTutorWebSocketBaseUrl(candidate.backendWsUrl, deriveVoiceTutorWebSocketUrl(backendUrl)),
    voiceTrainerUrl: normalizeVoiceTutorHttpUrl(candidate.voiceTrainerUrl, deriveVoiceTrainerUrl(backendUrl)),
  };
  const name = normalizeVoiceTutorProfileName(candidate.name, inferProfileNameFromConfig(config));
  const id = typeof candidate.id === 'string' && candidate.id.trim()
    ? slugifyProfileId(candidate.id)
    : slugifyProfileId(`${name}-${config.backendUrl}`);
  const updatedAt = typeof candidate.updatedAt === 'string' && candidate.updatedAt.trim()
    ? candidate.updatedAt.trim()
    : new Date(0).toISOString();
  return {
    id,
    name,
    updatedAt,
    ...config,
  };
}

export function createVoiceTutorConnectionProfile(options: {
  config: VoiceTutorLaunchConfig;
  id?: string;
  name?: string;
  now?: Date;
}): VoiceTutorConnectionProfile {
  const name = normalizeVoiceTutorProfileName(options.name, inferProfileNameFromConfig(options.config));
  const updatedAt = (options.now || new Date()).toISOString();
  return {
    ...options.config,
    id: slugifyProfileId(options.id || `${name}-${options.config.backendUrl}`),
    name,
    updatedAt,
  };
}

export function readVoiceTutorConnectionProfilesFromStorage(
  storage: Pick<Storage, 'getItem'> | null | undefined,
): VoiceTutorConnectionProfile[] {
  if (!storage) {
    return [];
  }
  try {
    const raw = storage.getItem(PROFILE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const seen = new Set<string>();
        return parsed
          .map(normalizeVoiceTutorConnectionProfile)
          .filter((profile): profile is VoiceTutorConnectionProfile => {
            if (!profile || seen.has(profile.id)) {
              return false;
            }
            seen.add(profile.id);
            return true;
          })
          .slice(0, MAX_CONNECTION_PROFILES);
      }
    }
  } catch {
    return [];
  }
  const legacy = readVoiceTutorLaunchConfigFromStorage(storage);
  const legacyBackendUrl = normalizeVoiceTutorHttpUrl(legacy.backendUrl, '');
  if (!legacyBackendUrl) {
    return [];
  }
  return [
    createVoiceTutorConnectionProfile({
      config: {
        backendUrl: legacyBackendUrl,
        backendWsUrl: normalizeVoiceTutorWebSocketBaseUrl(legacy.backendWsUrl, deriveVoiceTutorWebSocketUrl(legacyBackendUrl)),
        voiceTrainerUrl: normalizeVoiceTutorHttpUrl(legacy.voiceTrainerUrl, deriveVoiceTrainerUrl(legacyBackendUrl)),
      },
      id: 'last-used',
      name: 'Last used backend',
      now: new Date(0),
    }),
  ];
}

export function writeVoiceTutorConnectionProfilesToStorage(
  storage: Pick<Storage, 'setItem'> | null | undefined,
  profiles: VoiceTutorConnectionProfile[],
): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(profiles.slice(0, MAX_CONNECTION_PROFILES)));
  } catch {
  }
}

export function upsertVoiceTutorConnectionProfile(
  profiles: VoiceTutorConnectionProfile[],
  profile: VoiceTutorConnectionProfile,
): VoiceTutorConnectionProfile[] {
  return [
    profile,
    ...profiles.filter((candidate) => candidate.id !== profile.id),
  ].slice(0, MAX_CONNECTION_PROFILES);
}

export function removeVoiceTutorConnectionProfile(
  profiles: VoiceTutorConnectionProfile[],
  profileId: string,
): VoiceTutorConnectionProfile[] {
  return profiles.filter((profile) => profile.id !== profileId);
}

export function resolveVoiceTutorLaunchConfig(options: {
  locationRef: Pick<Location, 'href' | 'hostname' | 'origin' | 'protocol'>;
  storage?: Pick<Storage, 'getItem'> | null;
}): VoiceTutorLaunchConfig {
  const url = new URL(options.locationRef.href);
  // The Android WebView is a same-origin shell. `sameOrigin=1` is an explicit
  // deployment contract that prevents an old desktop/localhost profile in
  // WebView localStorage from silently taking precedence over the tailnet URL.
  if (url.searchParams.get('sameOrigin') === '1') {
    return deriveSameOriginVoiceTutorLaunchConfig(options.locationRef);
  }
  const stored = readVoiceTutorLaunchConfigFromStorage(options.storage);
  const defaultBackendUrl = deriveDefaultVoiceTutorBackendUrl(options.locationRef);
  const backendUrl = normalizeVoiceTutorHttpUrl(
    url.searchParams.get('backendUrl')
      || url.searchParams.get('voiceKernelUrl')
      || stored.backendUrl,
    defaultBackendUrl,
  );
  const backendWsUrl = normalizeVoiceTutorWebSocketBaseUrl(
    url.searchParams.get('backendWsUrl')
      || url.searchParams.get('voiceKernelWsUrl')
      || stored.backendWsUrl,
    deriveVoiceTutorWebSocketUrl(backendUrl),
  );
  const voiceTrainerUrl = normalizeVoiceTutorHttpUrl(
    url.searchParams.get('voiceTrainerUrl')
      || url.searchParams.get('voiceTutorTrainerUrl')
      || stored.voiceTrainerUrl,
    deriveVoiceTrainerUrl(backendUrl),
  );

  return {
    backendUrl,
    backendWsUrl,
    voiceTrainerUrl,
  };
}

export function hasVoiceTutorLaunchConfigQueryOverride(locationRef: Pick<Location, 'href'>): boolean {
  try {
    const params = new URL(locationRef.href).searchParams;
    return [
      'sameOrigin',
      'backendUrl',
      'voiceKernelUrl',
      'backendWsUrl',
      'voiceKernelWsUrl',
      'voiceTrainerUrl',
      'voiceTutorTrainerUrl',
    ].some((name) => Boolean(params.get(name)?.trim()));
  } catch {
    return false;
  }
}

export function buildVoiceTutorEmbeddedAppUrl(options: {
  locationRef: Pick<Location, 'origin'>;
  config: VoiceTutorLaunchConfig;
}): string {
  const target = new URL('/', options.locationRef.origin);
  target.searchParams.set('sloaneEmbeddedWorkspace', '1');
  target.searchParams.set('sloaneMode', 'voice');
  target.searchParams.set('sloaneVoiceStandalone', '1');
  target.searchParams.set('voiceKernelUrl', options.config.backendUrl);
  target.searchParams.set('voiceKernelWsUrl', options.config.backendWsUrl);
  target.searchParams.set('voiceTrainerUrl', options.config.voiceTrainerUrl);
  return target.toString();
}

export function buildVoiceTutorStandaloneAppUrl(options: {
  locationRef: Pick<Location, 'origin'>;
  config: VoiceTutorLaunchConfig;
  session?: VoiceTutorStandaloneLaunchSessionOptions;
}): string {
  const target = new URL('/voice-tutor-app.html', options.locationRef.origin);
  target.searchParams.set('backendUrl', options.config.backendUrl);
  target.searchParams.set('backendWsUrl', options.config.backendWsUrl);
  target.searchParams.set('voiceTrainerUrl', options.config.voiceTrainerUrl);
  const sessionId = typeof options.session?.sessionId === 'string' ? options.session.sessionId.trim() : '';
  if (sessionId) {
    target.searchParams.set('sessionId', sessionId);
  }
  if (options.session?.newSession) {
    target.searchParams.set('newSession', '1');
  }
  return target.toString();
}

export function buildVoiceTutorStandaloneLauncherUrl(options: {
  locationRef: Pick<Location, 'origin'>;
  config: VoiceTutorLaunchConfig;
}): string {
  const target = new URL('/voice-tutor.html', options.locationRef.origin);
  target.searchParams.set('backendUrl', options.config.backendUrl);
  target.searchParams.set('backendWsUrl', options.config.backendWsUrl);
  target.searchParams.set('voiceTrainerUrl', options.config.voiceTrainerUrl);
  return target.toString();
}

function buildBackendUrl(config: VoiceTutorLaunchConfig, path: string): string {
  return `${trimTrailingSlash(config.backendUrl)}${path}`;
}

export function buildVoiceTutorStandaloneSessionExportUrl(
  config: VoiceTutorLaunchConfig,
  sessionId: string,
): string {
  return buildBackendUrl(
    config,
    `/voice/standalone/sessions/${encodeURIComponent(sessionId)}/export`,
  );
}

export async function fetchVoiceTutorStandaloneSessions(
  config: VoiceTutorLaunchConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<VoiceTutorStandaloneSessionSummary[]> {
  const response = await fetchImpl(buildBackendUrl(config, '/voice/standalone/sessions?limit=100'), {
    cache: 'no-store',
  });
  const payload = await response.json() as Partial<VoiceTutorStandaloneSessionListResponse>;
  if (!response.ok || payload.success === false || !Array.isArray(payload.sessions)) {
    throw new Error(`Session list failed: HTTP ${response.status}`);
  }
  return payload.sessions
    .filter((session): session is VoiceTutorStandaloneSessionSummary => (
      Boolean(session) && typeof session.sessionId === 'string' && session.sessionId.trim().length > 0
    ));
}

export async function deleteVoiceTutorStandaloneSession(
  config: VoiceTutorLaunchConfig,
  sessionId: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const response = await fetchImpl(buildBackendUrl(config, `/voice/standalone/sessions/${encodeURIComponent(sessionId)}`), {
    method: 'DELETE',
  });
  const payload = await response.json().catch(() => null) as { deleted?: boolean } | null;
  if (!response.ok) {
    throw new Error(`Session delete failed: HTTP ${response.status}`);
  }
  return Boolean(payload?.deleted);
}

function getActiveProfileId(storage: Pick<Storage, 'getItem'> | null | undefined): string {
  try {
    return storage?.getItem(ACTIVE_PROFILE_STORAGE_KEY)?.trim() || '';
  } catch {
    return '';
  }
}

function setActiveProfileId(storage: Pick<Storage, 'setItem'> | null | undefined, profileId: string): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(ACTIVE_PROFILE_STORAGE_KEY, profileId);
  } catch {
  }
}

function setStatus(message: string, kind: 'info' | 'warning' = 'info'): void {
  const status = document.getElementById('voice-launcher-status');
  if (!status) {
    return;
  }
  status.textContent = message;
  status.classList.toggle('warning', kind === 'warning');
}

function setPwaStatus(message: string, kind: 'info' | 'warning' = 'info'): void {
  const status = document.getElementById('voice-pwa-status');
  if (!status) {
    return;
  }
  status.textContent = message;
  status.classList.toggle('warning', kind === 'warning');
}

function readFormConfig(defaultConfig: VoiceTutorLaunchConfig): VoiceTutorLaunchConfig {
  const backendInput = document.getElementById('voice-backend-url') as HTMLInputElement | null;
  const wsInput = document.getElementById('voice-backend-ws-url') as HTMLInputElement | null;
  const trainerInput = document.getElementById('voice-trainer-url') as HTMLInputElement | null;
  const backendUrl = normalizeVoiceTutorHttpUrl(backendInput?.value, defaultConfig.backendUrl);
  const backendWsUrl = normalizeVoiceTutorWebSocketBaseUrl(wsInput?.value, deriveVoiceTutorWebSocketUrl(backendUrl));
  const voiceTrainerUrl = normalizeVoiceTutorHttpUrl(trainerInput?.value, deriveVoiceTrainerUrl(backendUrl));
  return {
    backendUrl,
    backendWsUrl,
    voiceTrainerUrl,
  };
}

function readProfileNameInput(defaultConfig: VoiceTutorLaunchConfig): string {
  const profileNameInput = document.getElementById('voice-profile-name') as HTMLInputElement | null;
  return normalizeVoiceTutorProfileName(profileNameInput?.value, inferProfileNameFromConfig(defaultConfig));
}

function writeFormConfig(config: VoiceTutorLaunchConfig, name?: string): void {
  const backendInput = document.getElementById('voice-backend-url') as HTMLInputElement | null;
  const wsInput = document.getElementById('voice-backend-ws-url') as HTMLInputElement | null;
  const trainerInput = document.getElementById('voice-trainer-url') as HTMLInputElement | null;
  const profileNameInput = document.getElementById('voice-profile-name') as HTMLInputElement | null;
  if (backendInput) backendInput.value = config.backendUrl;
  if (wsInput) wsInput.value = config.backendWsUrl;
  if (trainerInput) trainerInput.value = config.voiceTrainerUrl;
  if (profileNameInput) profileNameInput.value = name || inferProfileNameFromConfig(config);
}

function renderConnectionProfileOptions(
  profiles: VoiceTutorConnectionProfile[],
  activeProfileId: string,
): void {
  const select = document.getElementById('voice-connection-profile') as HTMLSelectElement | null;
  if (!select) {
    return;
  }
  select.replaceChildren();
  const unsavedOption = document.createElement('option');
  unsavedOption.value = '';
  unsavedOption.textContent = 'Unsaved / manual connection';
  select.appendChild(unsavedOption);
  for (const profile of profiles) {
    const option = document.createElement('option');
    option.value = profile.id;
    option.textContent = profile.name;
    select.appendChild(option);
  }
  select.value = profiles.some((profile) => profile.id === activeProfileId) ? activeProfileId : '';
}

function buildSecurityWarning(config: VoiceTutorLaunchConfig): string {
  const backendUrl = new URL(config.backendUrl);
  if (!window.isSecureContext) {
    return 'This page is not a secure browser context. Microphone capture may be unavailable unless you use localhost, HTTPS, or a native wrapper.';
  }
  if (window.location.protocol === 'https:' && backendUrl.protocol !== 'https:' && !isLocalHostname(backendUrl.hostname)) {
    return 'The frontend is HTTPS but the backend is plain HTTP. Browser requests or websocket capture may be blocked; use HTTPS/WSS or a native wrapper.';
  }
  return '';
}

function launchVoiceTutor(config: VoiceTutorLaunchConfig): void {
  writeVoiceTutorLaunchConfigToStorage(getLauncherStorage(), config);
  window.location.assign(buildVoiceTutorStandaloneAppUrl({
    locationRef: window.location,
    config,
  }));
}

function launchVoiceTutorSession(
  config: VoiceTutorLaunchConfig,
  session: VoiceTutorStandaloneLaunchSessionOptions = {},
): void {
  writeVoiceTutorLaunchConfigToStorage(getLauncherStorage(), config);
  window.location.assign(buildVoiceTutorStandaloneAppUrl({
    locationRef: window.location,
    config,
    session,
  }));
}

async function checkBackend(
  config: VoiceTutorLaunchConfig,
  options: { deep?: boolean } = {},
): Promise<void> {
  setStatus(`${options.deep ? 'Running deep readiness check for' : 'Checking'} ${config.backendUrl} …`);
  try {
    const summary = await checkVoiceTutorStandaloneHealth(config, {
      forceReadiness: options.deep === true,
      includeReadiness: options.deep === true,
      windowRef: window,
      navigatorRef: navigator,
    });
    setStatus(
      formatVoiceTutorStandaloneHealthReport(summary),
      summary.overall === 'online' ? 'info' : 'warning',
    );
  } catch (error) {
    setStatus(`Backend check failed: ${error instanceof Error ? error.message : String(error)}`, 'warning');
  }
}

async function copyLaunchLink(config: VoiceTutorLaunchConfig): Promise<void> {
  const launchLink = buildVoiceTutorStandaloneLauncherUrl({
    locationRef: window.location,
    config,
  });
  try {
    if (!navigator.clipboard?.writeText) {
      setStatus(`Copy this launch link:\n${launchLink}`);
      return;
    }
    await navigator.clipboard.writeText(launchLink);
    setStatus('Launch link copied. Use it on another device that can reach the same backend URLs.');
  } catch (error) {
    setStatus(`Copy failed. Manual launch link:\n${launchLink}\n${error instanceof Error ? error.message : String(error)}`, 'warning');
  }
}

function normalizeSessionInputValue(value: unknown): string {
  return typeof value === 'string' ? value.trim().slice(0, 160) : '';
}

function formatSessionTimestamp(value: unknown): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) {
    return 'unknown time';
  }
  try {
    return new Date(numeric).toLocaleString();
  } catch {
    return 'unknown time';
  }
}

function formatSessionOption(session: VoiceTutorStandaloneSessionSummary): string {
  const target = session.targetPreset || 'voice practice';
  const status = session.status || 'idle';
  const updated = formatSessionTimestamp(session.updatedAt || session.createdAt);
  return `${target} · ${status} · ${updated}`;
}

function getSessionIdInput(): HTMLInputElement | null {
  return document.getElementById('voice-session-id') as HTMLInputElement | null;
}

function getSelectedSessionId(): string {
  const inputSessionId = normalizeSessionInputValue(getSessionIdInput()?.value);
  if (inputSessionId) {
    return inputSessionId;
  }
  const select = document.getElementById('voice-session-select') as HTMLSelectElement | null;
  return normalizeSessionInputValue(select?.value);
}

function renderSessionOptions(sessions: VoiceTutorStandaloneSessionSummary[]): void {
  const select = document.getElementById('voice-session-select') as HTMLSelectElement | null;
  if (!select) {
    return;
  }
  const previousValue = select.value;
  select.replaceChildren();
  const emptyOption = document.createElement('option');
  emptyOption.value = '';
  emptyOption.textContent = sessions.length ? 'Select a saved session' : 'No sessions loaded';
  select.appendChild(emptyOption);
  for (const session of sessions) {
    const option = document.createElement('option');
    option.value = session.sessionId;
    option.textContent = formatSessionOption(session);
    option.title = session.lastCoachMessage || session.sessionId;
    select.appendChild(option);
  }
  select.value = sessions.some((session) => session.sessionId === previousValue)
    ? previousValue
    : (sessions[0]?.sessionId || '');
  const input = getSessionIdInput();
  if (input && select.value) {
    input.value = select.value;
  }
}

async function loadSessionOptions(config: VoiceTutorLaunchConfig): Promise<VoiceTutorStandaloneSessionSummary[]> {
  setStatus(`Loading sessions from ${config.backendUrl} …`);
  const sessions = await fetchVoiceTutorStandaloneSessions(config);
  renderSessionOptions(sessions);
  setStatus(sessions.length ? `Loaded ${sessions.length} session(s).` : 'No saved sessions found.');
  return sessions;
}

function saveConnectionProfile(
  profiles: VoiceTutorConnectionProfile[],
  selectedProfileId: string,
  config: VoiceTutorLaunchConfig,
): VoiceTutorConnectionProfile[] {
  const profile = createVoiceTutorConnectionProfile({
    config,
    id: selectedProfileId || `${readProfileNameInput(config)}-${config.backendUrl}`,
    name: readProfileNameInput(config),
  });
  const nextProfiles = upsertVoiceTutorConnectionProfile(profiles, profile);
  const storage = getLauncherStorage();
  writeVoiceTutorConnectionProfilesToStorage(storage, nextProfiles);
  setActiveProfileId(storage, profile.id);
  renderConnectionProfileOptions(nextProfiles, profile.id);
  setStatus(`Saved connection profile “${profile.name}”.`);
  return nextProfiles;
}

function bindLauncher(): void {
  const storage = getLauncherStorage();
  bindVoiceTutorStandaloneInstallPrompt({
    button: document.getElementById('voice-install-app') as HTMLButtonElement | null,
    status: document.getElementById('voice-pwa-status'),
  });
  void registerVoiceTutorStandaloneServiceWorker({
    onStatus: setPwaStatus,
  });
  const defaultConfig = resolveVoiceTutorLaunchConfig({
    locationRef: window.location,
    storage,
  });
  let profiles = readVoiceTutorConnectionProfilesFromStorage(storage);
  const activeProfileId = getActiveProfileId(storage);
  const activeProfile = hasVoiceTutorLaunchConfigQueryOverride(window.location)
    ? null
    : profiles.find((profile) => profile.id === activeProfileId);
  const initialConfig = activeProfile || defaultConfig;
  let loadedSessions: VoiceTutorStandaloneSessionSummary[] = [];
  renderConnectionProfileOptions(profiles, activeProfile?.id || '');
  renderSessionOptions(loadedSessions);
  writeFormConfig(initialConfig, activeProfile?.name);
  bindLearnerMemorySettings({
    getBackendUrl: () => readFormConfig(defaultConfig).backendUrl,
  });

  const warning = buildSecurityWarning(initialConfig);
  if (warning) {
    setStatus(warning, 'warning');
  }

  const params = new URL(window.location.href).searchParams;
  if (['1', 'true', 'yes'].includes((params.get('connect') || '').toLowerCase())) {
    launchVoiceTutor(initialConfig);
    return;
  }

  document.getElementById('voice-connection-profile')?.addEventListener('change', (event) => {
    const selectedProfileId = (event.currentTarget as HTMLSelectElement).value;
    const profile = profiles.find((candidate) => candidate.id === selectedProfileId);
    if (profile) {
      setActiveProfileId(storage, profile.id);
      writeFormConfig(profile, profile.name);
      setStatus(`Loaded connection profile “${profile.name}”.`);
      return;
    }
    setActiveProfileId(storage, '');
    setStatus('Using manual connection fields.');
  });

  document.getElementById('voice-launcher-form')?.addEventListener('submit', (event) => {
    event.preventDefault();
    const sessionId = getSelectedSessionId();
    launchVoiceTutorSession(readFormConfig(defaultConfig), sessionId ? { sessionId } : {});
  });

  document.getElementById('voice-save-profile')?.addEventListener('click', () => {
    const select = document.getElementById('voice-connection-profile') as HTMLSelectElement | null;
    profiles = saveConnectionProfile(profiles, select?.value || '', readFormConfig(defaultConfig));
  });

  document.getElementById('voice-delete-profile')?.addEventListener('click', () => {
    const select = document.getElementById('voice-connection-profile') as HTMLSelectElement | null;
    const selectedProfileId = select?.value || '';
    const profile = profiles.find((candidate) => candidate.id === selectedProfileId);
    if (!profile) {
      setStatus('Select a saved profile before deleting.', 'warning');
      return;
    }
    profiles = removeVoiceTutorConnectionProfile(profiles, selectedProfileId);
    writeVoiceTutorConnectionProfilesToStorage(storage, profiles);
    setActiveProfileId(storage, '');
    renderConnectionProfileOptions(profiles, '');
    setStatus(`Deleted connection profile “${profile.name}”.`);
  });

  document.getElementById('voice-health-check')?.addEventListener('click', () => {
    void checkBackend(readFormConfig(defaultConfig));
  });

  document.getElementById('voice-readiness-check')?.addEventListener('click', () => {
    void checkBackend(readFormConfig(defaultConfig), { deep: true });
  });

  document.getElementById('voice-copy-link')?.addEventListener('click', () => {
    void copyLaunchLink(readFormConfig(defaultConfig));
  });

  document.getElementById('voice-load-sessions')?.addEventListener('click', () => {
    void loadSessionOptions(readFormConfig(defaultConfig))
      .then((sessions) => {
        loadedSessions = sessions;
      })
      .catch((error) => {
        setStatus(`Session load failed: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      });
  });

  document.getElementById('voice-session-select')?.addEventListener('change', (event) => {
    const selectedSessionId = normalizeSessionInputValue((event.currentTarget as HTMLSelectElement).value);
    const input = getSessionIdInput();
    if (input) {
      input.value = selectedSessionId;
    }
  });

  document.getElementById('voice-resume-session')?.addEventListener('click', () => {
    const sessionId = getSelectedSessionId();
    if (!sessionId) {
      setStatus('Load sessions or enter a session ID before resuming.', 'warning');
      return;
    }
    launchVoiceTutorSession(readFormConfig(defaultConfig), { sessionId });
  });

  document.getElementById('voice-new-session')?.addEventListener('click', () => {
    launchVoiceTutorSession(readFormConfig(defaultConfig), { newSession: true });
  });

  document.getElementById('voice-export-session')?.addEventListener('click', () => {
    const config = readFormConfig(defaultConfig);
    const sessionId = getSelectedSessionId();
    if (!sessionId) {
      setStatus('Select or enter a session ID before exporting.', 'warning');
      return;
    }
    window.open(buildVoiceTutorStandaloneSessionExportUrl(config, sessionId), '_blank', 'noopener');
  });

  document.getElementById('voice-delete-session')?.addEventListener('click', () => {
    const config = readFormConfig(defaultConfig);
    const sessionId = getSelectedSessionId();
    if (!sessionId) {
      setStatus('Select or enter a session ID before deleting.', 'warning');
      return;
    }
    void deleteVoiceTutorStandaloneSession(config, sessionId)
      .then((deleted) => loadSessionOptions(config).then((sessions) => {
        loadedSessions = sessions;
        setStatus(deleted ? `Deleted session ${sessionId}.` : `Session ${sessionId} was already absent.`);
      }))
      .catch((error) => {
        setStatus(`Session delete failed: ${error instanceof Error ? error.message : String(error)}`, 'warning');
      });
  });

  document.getElementById('voice-use-local')?.addEventListener('click', () => {
    const backendUrl = 'http://127.0.0.1:3021';
    writeFormConfig({
      backendUrl,
      backendWsUrl: deriveVoiceTutorWebSocketUrl(backendUrl),
      voiceTrainerUrl: deriveVoiceTrainerUrl(backendUrl),
    }, 'Local backend');
    renderSessionOptions([]);
    loadedSessions = [];
    setStatus('Using local backend defaults.');
  });

  document.getElementById('voice-use-same-origin')?.addEventListener('click', () => {
    writeFormConfig(deriveSameOriginVoiceTutorLaunchConfig(window.location), 'Same-origin proxy');
    renderSessionOptions([]);
    loadedSessions = [];
    setStatus('Using same-origin HTTPS/WSS proxy defaults.');
  });
}

if (
  typeof window !== 'undefined'
  && typeof document !== 'undefined'
  && document.getElementById('voice-launcher-form')
) {
  bindLauncher();
}
