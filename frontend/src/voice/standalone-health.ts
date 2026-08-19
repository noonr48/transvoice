import type { VoiceTutorLaunchConfig } from './standalone-launcher';

export type VoiceTutorStandaloneHealthLayerId =
  | 'gateway'
  | 'sessionStore'
  | 'voiceTrainer'
  | 'voiceTutorGguf'
  | 'browserMic'
  | 'activeReadiness'
  | 'sessionStoreWrite'
  | 'voiceTrainerSession'
  | 'voiceTrainerStream'
  | 'voiceTrainerCleanup'
  | 'voiceTutorGgufChat';

export type VoiceTutorStandaloneHealthLayerStatus = 'online' | 'degraded' | 'offline' | 'unknown';

export type VoiceTutorStandaloneOverallHealthStatus = 'online' | 'degraded' | 'offline';

export type VoiceTutorStandaloneHealthLayer = {
  id: VoiceTutorStandaloneHealthLayerId;
  label: string;
  status: VoiceTutorStandaloneHealthLayerStatus;
  detail: string;
  endpoint?: string;
};

export type VoiceTutorStandaloneHealthSummary = {
  overall: VoiceTutorStandaloneOverallHealthStatus;
  backendUrl: string;
  checkedAt: string;
  layers: VoiceTutorStandaloneHealthLayer[];
  errors: string[];
  healthPayload: unknown | null;
  sessionPayload: unknown | null;
  readinessPayload: unknown | null;
};

type HealthCheckOptions = {
  fetchImpl?: typeof fetch;
  forceReadiness?: boolean;
  includeReadiness?: boolean;
  windowRef?: Pick<Window, 'isSecureContext' | 'location'> | null;
  navigatorRef?: Pick<Navigator, 'mediaDevices'> | null;
  now?: Date;
};

type FetchProbe = {
  url: string;
  reachable: boolean;
  ok: boolean;
  status: number;
  payload: unknown | null;
  error: string | null;
};

type ServiceStatusPayload = {
  status?: unknown;
  payload?: unknown;
};

type ReadinessProbePayload = {
  id?: unknown;
  label?: unknown;
  status?: unknown;
  detail?: unknown;
  durationMs?: unknown;
};

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function buildBackendUrl(config: VoiceTutorLaunchConfig, path: string): string {
  return `${trimTrailingSlash(config.backendUrl)}${path}`;
}

async function readResponsePayload(response: Response): Promise<unknown | null> {
  const responseWithText = response as Response & { text?: () => Promise<string> };
  if (typeof responseWithText.text === 'function') {
    const text = await responseWithText.text();
    if (!text.trim()) {
      return null;
    }
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  }
  const responseWithJson = response as Response & { json?: () => Promise<unknown> };
  if (typeof responseWithJson.json === 'function') {
    return responseWithJson.json().catch(() => null);
  }
  return null;
}

async function fetchProbe(fetchImpl: typeof fetch, url: string): Promise<FetchProbe> {
  try {
    const response = await fetchImpl(url, { cache: 'no-store' });
    return {
      url,
      reachable: true,
      ok: response.ok,
      status: response.status,
      payload: await readResponsePayload(response),
      error: null,
    };
  } catch (error) {
    return {
      url,
      reachable: false,
      ok: false,
      status: 0,
      payload: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function getObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? value as Record<string, unknown> : null;
}

function getNestedObject(value: unknown, path: string[]): Record<string, unknown> | null {
  let current: unknown = value;
  for (const segment of path) {
    const object = getObject(current);
    if (!object) {
      return null;
    }
    current = object[segment];
  }
  return getObject(current);
}

function normalizeServiceLayerStatus(
  healthProbe: FetchProbe,
  service: ServiceStatusPayload | null,
): VoiceTutorStandaloneHealthLayerStatus {
  const rawStatus = typeof service?.status === 'string' ? service.status.toLowerCase() : '';
  if (rawStatus === 'online' || rawStatus === 'ok' || rawStatus === 'healthy') {
    return 'online';
  }
  if (rawStatus === 'degraded' || rawStatus === 'warning' || rawStatus === 'partial') {
    return 'degraded';
  }
  if (rawStatus === 'offline' || rawStatus === 'error' || rawStatus === 'failed' || rawStatus === 'unavailable') {
    return 'offline';
  }
  return healthProbe.reachable ? 'unknown' : 'offline';
}

function normalizeLayerStatus(value: unknown, fallback: VoiceTutorStandaloneHealthLayerStatus): VoiceTutorStandaloneHealthLayerStatus {
  const normalized = typeof value === 'string' ? value.toLowerCase() : '';
  return ['online', 'degraded', 'offline', 'unknown'].includes(normalized)
    ? normalized as VoiceTutorStandaloneHealthLayerStatus
    : fallback;
}

function formatServiceDetail(
  healthProbe: FetchProbe,
  service: ServiceStatusPayload | null,
  fallback: string,
): string {
  const serviceObject = getObject(service);
  const servicePayload = getObject(service?.payload);
  if (serviceObject?.targetModelPresent === false) {
    return 'Configured GGUF model is not present in the runtime model list.';
  }
  const detail = servicePayload?.detail
    || servicePayload?.message
    || servicePayload?.error
    || serviceObject?.detail
    || serviceObject?.message
    || serviceObject?.error;
  if (typeof detail === 'string' && detail.trim()) {
    return detail.trim();
  }
  if (!healthProbe.reachable && healthProbe.error) {
    return healthProbe.error;
  }
  if (healthProbe.reachable && !healthProbe.ok) {
    return `Health endpoint returned HTTP ${healthProbe.status}`;
  }
  return fallback;
}

function getServiceStatus(payload: unknown, key: string): ServiceStatusPayload | null {
  return getNestedObject(payload, ['services', key]) as ServiceStatusPayload | null;
}

function inspectSessionStore(sessionProbe: FetchProbe): VoiceTutorStandaloneHealthLayer {
  const sessionStore = getNestedObject(sessionProbe.payload, ['sessionStore']);
  const writeBlocked = sessionStore?.writeBlocked === true;
  const writeBlockedReason = typeof sessionStore?.writeBlockedReason === 'string'
    ? sessionStore.writeBlockedReason.trim()
    : '';
  const success = getObject(sessionProbe.payload)?.success;
  if (sessionProbe.ok && success !== false && !writeBlocked) {
    return {
      id: 'sessionStore',
      label: 'Session store',
      status: 'online',
      detail: 'Session listing is reachable and writable.',
      endpoint: sessionProbe.url,
    };
  }
  if (sessionProbe.reachable) {
    return {
      id: 'sessionStore',
      label: 'Session store',
      status: 'degraded',
      detail: writeBlocked
        ? `Session writes are blocked${writeBlockedReason ? `: ${writeBlockedReason}` : '.'}`
        : `Session endpoint returned HTTP ${sessionProbe.status}.`,
      endpoint: sessionProbe.url,
    };
  }
  return {
    id: 'sessionStore',
    label: 'Session store',
    status: 'offline',
    detail: sessionProbe.error || 'Session endpoint is unreachable.',
    endpoint: sessionProbe.url,
  };
}

function isLocalHostname(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '::1'].includes(hostname) || hostname.endsWith('.localhost');
}

function inspectBrowserMic(options: Pick<HealthCheckOptions, 'windowRef' | 'navigatorRef'>): VoiceTutorStandaloneHealthLayer {
  const mediaDevices = options.navigatorRef?.mediaDevices;
  const hasGetUserMedia = typeof mediaDevices?.getUserMedia === 'function';
  const location = options.windowRef?.location;
  const isSecureContext = options.windowRef?.isSecureContext === true
    || Boolean(location && location.protocol === 'http:' && isLocalHostname(location.hostname));
  if (!options.windowRef || !options.navigatorRef) {
    return {
      id: 'browserMic',
      label: 'Browser mic',
      status: 'unknown',
      detail: 'Browser microphone capability can only be inspected in the frontend runtime.',
    };
  }
  if (!hasGetUserMedia) {
    return {
      id: 'browserMic',
      label: 'Browser mic',
      status: 'degraded',
      detail: 'navigator.mediaDevices.getUserMedia is unavailable.',
    };
  }
  if (!isSecureContext) {
    return {
      id: 'browserMic',
      label: 'Browser mic',
      status: 'degraded',
      detail: 'Microphone capture requires localhost, HTTPS, or a native wrapper.',
    };
  }
  return {
    id: 'browserMic',
    label: 'Browser mic',
    status: 'online',
    detail: 'Microphone capture API is available.',
  };
}

function normalizeReadinessProbeId(value: unknown): VoiceTutorStandaloneHealthLayerId {
  const id = typeof value === 'string' ? value.trim() : '';
  if ([
    'sessionStoreWrite',
    'voiceTrainerSession',
    'voiceTrainerStream',
    'voiceTrainerCleanup',
    'voiceTutorGgufChat',
  ].includes(id)) {
    return id as VoiceTutorStandaloneHealthLayerId;
  }
  return 'activeReadiness';
}

function inspectReadinessLayers(readinessProbe: FetchProbe | null): VoiceTutorStandaloneHealthLayer[] {
  if (!readinessProbe) {
    return [];
  }
  const probes = getObject(readinessProbe.payload)?.probes;
  if (Array.isArray(probes) && probes.length > 0) {
    return probes
      .filter((probe): probe is ReadinessProbePayload => Boolean(probe) && typeof probe === 'object')
      .map((probe) => {
        const durationMs = Number(probe.durationMs);
        const detail = typeof probe.detail === 'string' && probe.detail.trim()
          ? probe.detail.trim()
          : 'Active readiness probe completed.';
        return {
          id: normalizeReadinessProbeId(probe.id),
          label: typeof probe.label === 'string' && probe.label.trim() ? probe.label.trim() : 'Active readiness',
          status: normalizeLayerStatus(probe.status, readinessProbe.ok ? 'unknown' : 'degraded'),
          detail: Number.isFinite(durationMs) && durationMs >= 0
            ? `${detail} (${Math.round(durationMs)}ms)`
            : detail,
          endpoint: readinessProbe.url,
        };
      });
  }
  return [{
    id: 'activeReadiness',
    label: 'Active readiness',
    status: readinessProbe.reachable ? 'degraded' : 'offline',
    detail: readinessProbe.error || `Readiness endpoint returned HTTP ${readinessProbe.status}.`,
    endpoint: readinessProbe.url,
  }];
}

function resolveOverallHealth(layers: VoiceTutorStandaloneHealthLayer[]): VoiceTutorStandaloneOverallHealthStatus {
  const gateway = layers.find((layer) => layer.id === 'gateway');
  if (!gateway || gateway.status === 'offline') {
    return 'offline';
  }
  return layers.some((layer) => layer.status !== 'online') ? 'degraded' : 'online';
}

export async function checkVoiceTutorStandaloneHealth(
  config: VoiceTutorLaunchConfig,
  options: HealthCheckOptions = {},
): Promise<VoiceTutorStandaloneHealthSummary> {
  const fetchImpl = options.fetchImpl || fetch;
  const healthUrl = buildBackendUrl(config, '/health');
  const sessionUrl = buildBackendUrl(config, '/voice/standalone/sessions?limit=1');
  const readinessUrl = buildBackendUrl(
    config,
    options.forceReadiness ? '/voice/standalone/readiness?force=1' : '/voice/standalone/readiness',
  );
  const [healthProbe, sessionProbe, readinessProbe] = await Promise.all([
    fetchProbe(fetchImpl, healthUrl),
    fetchProbe(fetchImpl, sessionUrl),
    options.includeReadiness ? fetchProbe(fetchImpl, readinessUrl) : Promise.resolve(null),
  ]);
  const voiceTrainer = getServiceStatus(healthProbe.payload, 'voiceTrainer');
  const voiceTutorGguf = getServiceStatus(healthProbe.payload, 'voiceTutorGguf');
  const gatewayReachable = healthProbe.reachable || sessionProbe.reachable;
  const gatewayLayer: VoiceTutorStandaloneHealthLayer = {
    id: 'gateway',
    label: 'Gateway',
    status: gatewayReachable ? 'online' : 'offline',
    detail: gatewayReachable
      ? `Backend responded${healthProbe.reachable ? ` at /health (${healthProbe.status})` : ' through the session endpoint'}.`
      : healthProbe.error || sessionProbe.error || 'Backend is unreachable.',
    endpoint: config.backendUrl,
  };
  const layers: VoiceTutorStandaloneHealthLayer[] = [
    gatewayLayer,
    inspectSessionStore(sessionProbe),
    {
      id: 'voiceTrainer',
      label: 'VoiceTrainer',
      status: normalizeServiceLayerStatus(healthProbe, voiceTrainer),
      detail: formatServiceDetail(healthProbe, voiceTrainer, 'VoiceTrainer status was not reported by /health.'),
      endpoint: config.voiceTrainerUrl,
    },
    {
      id: 'voiceTutorGguf',
      label: 'Voice Tutor GGUF',
      status: normalizeServiceLayerStatus(healthProbe, voiceTutorGguf),
      detail: formatServiceDetail(healthProbe, voiceTutorGguf, 'GGUF runtime status was not reported by /health.'),
      endpoint: healthUrl,
    },
    inspectBrowserMic(options),
    ...inspectReadinessLayers(readinessProbe),
  ];
  return {
    overall: resolveOverallHealth(layers),
    backendUrl: config.backendUrl,
    checkedAt: (options.now || new Date()).toISOString(),
    layers,
    errors: [healthProbe.error, sessionProbe.error, readinessProbe?.error].filter((error): error is string => Boolean(error)),
    healthPayload: healthProbe.payload,
    sessionPayload: sessionProbe.payload,
    readinessPayload: readinessProbe?.payload || null,
  };
}

export function formatVoiceTutorStandaloneHealthReport(summary: VoiceTutorStandaloneHealthSummary): string {
  const lines = [
    `Overall: ${summary.overall.toUpperCase()}`,
    ...summary.layers.map((layer) => `${layer.label}: ${layer.status.toUpperCase()} — ${layer.detail}`),
  ];
  return lines.join('\n');
}
