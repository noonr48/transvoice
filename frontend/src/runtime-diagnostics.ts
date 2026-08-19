export type FrontendDiagnosticEntry = {
  kind?: string;
  message?: string;
  source?: string;
  stack?: string;
  timestamp?: number;
};

export type BackendDiagnosticAttributionCategory =
  | 'http'
  | 'timeout'
  | 'network'
  | 'cors-suspected'
  | 'aborted'
  | 'unknown';

export type BackendDiagnosticAttribution = {
  category: BackendDiagnosticAttributionCategory;
  label: string;
  errorName?: string;
  statusText?: string;
  responseType?: string;
  crossOrigin?: boolean;
  suspectedCors?: boolean;
  offlineSuspected?: boolean;
};

export type BackendDiagnosticEntry = {
  id: string;
  kind: string;
  operation: string;
  message: string;
  source: string;
  method?: string;
  status?: number;
  detail?: string;
  timestamp: number;
  firstSeenAt?: number;
  lastSeenAt?: number;
  occurrenceCount?: number;
  attribution?: BackendDiagnosticAttribution;
};

export type BackendDiagnosticInput = {
  kind?: string;
  operation: string;
  message: string;
  source: string;
  method?: string;
  status?: number;
  detail?: string;
  timestamp?: number;
  attribution?: BackendDiagnosticAttribution;
};

type RuntimeDiagnosticWindow = Window & {
  __SLOANE_FRONTEND_ERRORS?: FrontendDiagnosticEntry[];
  __SLOANE_BACKEND_ERRORS?: BackendDiagnosticEntry[];
  __SLOANE_BACKEND_ERROR_SEQ?: number;
  __SLOANE_RECORD_BACKEND_DIAGNOSTIC?: (entry: BackendDiagnosticEntry) => void;
  __SLOANE_SYNC_BACKEND_DIAGNOSTICS?: (entries: BackendDiagnosticEntry[]) => void;
  __SLOANE_RENDER_FRONTEND_ERRORS?: () => void;
  __SLOANE_RENDER_RUNTIME_DIAGNOSTICS?: () => void;
  __tvTelemetry?: {
    event: (
      level: 'error' | 'warn' | 'info',
      seam: string,
      failureClass: string,
      code: string,
      data?: Record<string, unknown>,
    ) => void;
  };
};

const MAX_BACKEND_DIAGNOSTICS = 25;
const ACTIVE_DIAGNOSTIC_MAX_AGE_MS = 30 * 60 * 1000;
const REALISTIC_EPOCH_TIMESTAMP_MIN_MS = Date.UTC(2020, 0, 1);

function getRuntimeWindow(): RuntimeDiagnosticWindow {
  return window as RuntimeDiagnosticWindow;
}

function clip(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
    : normalized;
}

function clipBlock(value: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength
    ? `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`
    : normalized;
}

function ensureBackendDiagnostics(runtimeWindow = getRuntimeWindow()): BackendDiagnosticEntry[] {
  if (!Array.isArray(runtimeWindow.__SLOANE_BACKEND_ERRORS)) {
    runtimeWindow.__SLOANE_BACKEND_ERRORS = [];
  }
  return runtimeWindow.__SLOANE_BACKEND_ERRORS;
}

function cloneBackendDiagnosticEntry(entry: BackendDiagnosticEntry): BackendDiagnosticEntry {
  return {
    ...entry,
    attribution: entry.attribution ? { ...entry.attribution } : undefined,
  };
}

function syncBackendDiagnostics(runtimeWindow = getRuntimeWindow()): void {
  runtimeWindow.__SLOANE_SYNC_BACKEND_DIAGNOSTICS?.(
    ensureBackendDiagnostics(runtimeWindow).map((entry) => cloneBackendDiagnosticEntry(entry)),
  );
}

function nextBackendDiagnosticId(runtimeWindow = getRuntimeWindow()): string {
  if (!runtimeWindow.__SLOANE_BACKEND_ERROR_SEQ) {
    const maxExisting = ensureBackendDiagnostics(runtimeWindow).reduce((max, entry) => {
      const match = String(entry?.id || '').match(/(\d+)$/);
      const value = match ? Number(match[1]) : 0;
      return Number.isFinite(value) ? Math.max(max, value) : max;
    }, 0);
    runtimeWindow.__SLOANE_BACKEND_ERROR_SEQ = maxExisting;
  }
  const nextValue = (runtimeWindow.__SLOANE_BACKEND_ERROR_SEQ || 0) + 1;
  runtimeWindow.__SLOANE_BACKEND_ERROR_SEQ = nextValue;
  return `API-${String(nextValue).padStart(4, '0')}`;
}

function extractJsonErrorMessage(data: unknown): string {
  if (!data || typeof data !== 'object') {
    return '';
  }

  const candidateKeys = ['error', 'message', 'detail', 'reason'];
  for (const key of candidateKeys) {
    const value = (data as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function matchesGenericNetworkFailure(message: string): boolean {
  return /failed to fetch|load failed|networkerror|network request failed/i.test(message);
}

function getResolvedSourceUrl(source: string): URL | null {
  const runtimeWindow = getRuntimeWindow();
  try {
    const baseHref = runtimeWindow.location?.href || 'http://localhost/';
    return new URL(source, baseHref);
  } catch {
    return null;
  }
}

function isCrossOriginSource(source: string): boolean {
  const runtimeWindow = getRuntimeWindow();
  const sourceUrl = getResolvedSourceUrl(source);
  const origin = runtimeWindow.location?.origin || '';
  return Boolean(sourceUrl && origin && sourceUrl.origin !== origin);
}

function normalizeBackendDiagnosticAttribution(
  attribution: BackendDiagnosticAttribution | undefined,
): BackendDiagnosticAttribution | undefined {
  if (!attribution) {
    return undefined;
  }

  const category = (clip(attribution.category || 'unknown', 40) || 'unknown') as BackendDiagnosticAttributionCategory;
  const label = clip(attribution.label || category.toUpperCase(), 32) || category.toUpperCase();

  return {
    category,
    label,
    errorName: clip(attribution.errorName || '', 80) || undefined,
    statusText: clip(attribution.statusText || '', 80) || undefined,
    responseType: clip(attribution.responseType || '', 32) || undefined,
    crossOrigin: typeof attribution.crossOrigin === 'boolean' ? attribution.crossOrigin : undefined,
    suspectedCors: typeof attribution.suspectedCors === 'boolean' ? attribution.suspectedCors : undefined,
    offlineSuspected: typeof attribution.offlineSuspected === 'boolean' ? attribution.offlineSuspected : undefined,
  };
}

function emitRemoteBackendDiagnostic(
  runtimeWindow: RuntimeDiagnosticWindow,
  entry: BackendDiagnosticEntry,
): void {
  const category = entry.attribution?.category || 'unknown';
  const failureClass = category === 'network' || category === 'timeout' || category === 'cors-suspected'
    ? 'not-connected'
    : category === 'aborted'
      ? 'never-received'
      : category === 'http' && typeof entry.status === 'number' && entry.status < 500
        ? 'contract-drift'
        : 'partial-function';
  try {
    runtimeWindow.__tvTelemetry?.event(
      'error',
      'voice-api',
      failureClass,
      `backend-${category}`,
      { ...(typeof entry.status === 'number' ? { status: entry.status } : {}) },
    );
  } catch {
    // Telemetry is advisory and must never break the already-visible diagnostic.
  }
}

export function getFrontendDiagnosticEntries(): FrontendDiagnosticEntry[] {
  const runtimeWindow = getRuntimeWindow();
  return Array.isArray(runtimeWindow.__SLOANE_FRONTEND_ERRORS)
    ? runtimeWindow.__SLOANE_FRONTEND_ERRORS
    : [];
}

export function getBackendDiagnosticEntries(): BackendDiagnosticEntry[] {
  return ensureBackendDiagnostics().slice();
}

function isDiagnosticTimestampActive(timestamp: number | undefined, now = Date.now()): boolean {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp)) {
    return true;
  }
  if (timestamp < REALISTIC_EPOCH_TIMESTAMP_MIN_MS) {
    return true;
  }
  return now - timestamp <= ACTIVE_DIAGNOSTIC_MAX_AGE_MS;
}

function getBackendDiagnosticActivityTimestamp(entry: BackendDiagnosticEntry): number | undefined {
  return typeof entry.lastSeenAt === 'number' ? entry.lastSeenAt : entry.timestamp;
}

function getActiveFrontendDiagnosticEntries(): FrontendDiagnosticEntry[] {
  return getFrontendDiagnosticEntries().filter((entry) => isDiagnosticTimestampActive(entry.timestamp));
}

function getActiveBackendDiagnosticEntries(): BackendDiagnosticEntry[] {
  return getBackendDiagnosticEntries().filter((entry) => (
    isDiagnosticTimestampActive(getBackendDiagnosticActivityTimestamp(entry))
  ));
}

export function getRuntimeDiagnosticCounts(): { frontend: number; backend: number; total: number } {
  const frontend = getActiveFrontendDiagnosticEntries().length;
  const backend = getActiveBackendDiagnosticEntries().length;
  return {
    frontend,
    backend,
    total: frontend + backend,
  };
}

export function updateRuntimeDiagnosticToggleState(): void {
  const runtimeWindow = getRuntimeWindow();
  runtimeWindow.__SLOANE_RENDER_RUNTIME_DIAGNOSTICS?.();
  runtimeWindow.__SLOANE_RENDER_FRONTEND_ERRORS?.();

  const toggle = document.getElementById('debug-toggle');
  if (!toggle) {
    return;
  }

  const counts = getRuntimeDiagnosticCounts();
  toggle.classList.toggle('has-errors', counts.total > 0);
  toggle.title = counts.total > 0
    ? `Runtime issues recorded: ${counts.total} (${counts.frontend} frontend, ${counts.backend} backend)`
    : 'Runtime diagnostics';
}

export function classifyBackendFailure(options: {
  error?: unknown;
  source?: string;
  response?: Response;
  kind?: string;
  status?: number;
}): BackendDiagnosticAttribution {
  if (options.response) {
    return {
      category: 'http',
      label: 'HTTP',
      statusText: clip(options.response.statusText || '', 80) || undefined,
      responseType: clip(options.response.type || '', 32) || undefined,
    };
  }

  const errorName = options.error instanceof Error
    ? clip(options.error.name || '', 80) || undefined
    : undefined;
  const message = getErrorMessage(options.error);
  const source = options.source || '';
  const crossOrigin = isCrossOriginSource(source);
  const genericNetworkFailure = matchesGenericNetworkFailure(message);

  if (options.kind === 'timeout' || isAbortError(options.error) || /timed out/i.test(message)) {
    return {
      category: 'timeout',
      label: 'TIMEOUT',
      errorName,
      crossOrigin: crossOrigin || undefined,
      suspectedCors: false,
      offlineSuspected: crossOrigin ? false : undefined,
    };
  }

  if (options.kind === 'aborted') {
    return {
      category: 'aborted',
      label: 'ABORTED',
      errorName,
      crossOrigin: crossOrigin || undefined,
    };
  }

  if (options.kind === 'cors-suspected') {
    return {
      category: 'cors-suspected',
      label: 'CORS?',
      errorName,
      crossOrigin: true,
      suspectedCors: true,
      offlineSuspected: false,
    };
  }

  if (options.kind === 'http') {
    return {
      category: 'http',
      label: 'HTTP',
      errorName,
      crossOrigin: crossOrigin || undefined,
    };
  }

  if (options.kind === 'network' || genericNetworkFailure) {
    return {
      category: 'network',
      label: 'NETWORK',
      errorName,
      crossOrigin: crossOrigin || undefined,
      suspectedCors: false,
      offlineSuspected: crossOrigin ? false : true,
    };
  }

  return {
    category: 'unknown',
    label: 'UNKNOWN',
    errorName,
    crossOrigin: crossOrigin || undefined,
  };
}

export function pushBackendDiagnostic(input: BackendDiagnosticInput): BackendDiagnosticEntry {
  const runtimeWindow = getRuntimeWindow();
  const entries = ensureBackendDiagnostics(runtimeWindow);
  const now = typeof input.timestamp === 'number' ? input.timestamp : Date.now();
  const kind = clip(input.kind || 'backend', 80) || 'backend';
  const operation = clip(input.operation || 'Backend operation', 160) || 'Backend operation';
  const message = clip(input.message || 'Unknown backend failure', 500) || 'Unknown backend failure';
  const source = clip(input.source || 'backend', 240) || 'backend';
  const method = clip(input.method || '', 24) || undefined;
  const detail = clipBlock(input.detail || '', 1200) || undefined;
  const status = typeof input.status === 'number' ? input.status : undefined;
  const attribution = normalizeBackendDiagnosticAttribution(input.attribution);

  let existingIndex = -1;
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (
      entry.kind === kind
      && entry.operation === operation
      && entry.message === message
      && entry.source === source
      && entry.method === method
      && entry.status === status
      && entry.attribution?.category === attribution?.category
    ) {
      existingIndex = index;
      break;
    }
  }

  if (existingIndex >= 0) {
    const existingEntry = entries[existingIndex];
    const updatedEntry: BackendDiagnosticEntry = {
      ...existingEntry,
      timestamp: now,
      firstSeenAt: typeof existingEntry.firstSeenAt === 'number'
        ? existingEntry.firstSeenAt
        : existingEntry.timestamp,
      lastSeenAt: now,
      occurrenceCount: Math.max(1, existingEntry.occurrenceCount || 1) + 1,
      detail: detail || existingEntry.detail,
      attribution: attribution || existingEntry.attribution,
    };
    entries.splice(existingIndex, 1);
    entries.push(updatedEntry);
    runtimeWindow.__SLOANE_RECORD_BACKEND_DIAGNOSTIC?.(cloneBackendDiagnosticEntry(updatedEntry));
    emitRemoteBackendDiagnostic(runtimeWindow, updatedEntry);
    syncBackendDiagnostics(runtimeWindow);
    updateRuntimeDiagnosticToggleState();
    return updatedEntry;
  }

  const entry: BackendDiagnosticEntry = {
    id: nextBackendDiagnosticId(runtimeWindow),
    kind,
    operation,
    message,
    source,
    method,
    status,
    detail,
    timestamp: now,
    firstSeenAt: now,
    lastSeenAt: now,
    occurrenceCount: 1,
    attribution,
  };

  entries.push(entry);
  if (entries.length > MAX_BACKEND_DIAGNOSTICS) {
    entries.splice(0, entries.length - MAX_BACKEND_DIAGNOSTICS);
  }

  runtimeWindow.__SLOANE_RECORD_BACKEND_DIAGNOSTIC?.(cloneBackendDiagnosticEntry(entry));
  emitRemoteBackendDiagnostic(runtimeWindow, entry);
  syncBackendDiagnostics(runtimeWindow);
  updateRuntimeDiagnosticToggleState();
  return entry;
}

export function resolveBackendDiagnostics(criteria: {
  operation?: string;
  source?: string;
  method?: string;
}): number {
  const runtimeWindow = getRuntimeWindow();
  const entries = ensureBackendDiagnostics(runtimeWindow);

  if (!criteria.operation && !criteria.source && !criteria.method) {
    return 0;
  }

  const nextEntries = entries.filter((entry) => (
    (criteria.operation && entry.operation !== criteria.operation)
    || (criteria.source && entry.source !== criteria.source)
    || (criteria.method && entry.method !== criteria.method)
    || (!criteria.operation && !criteria.source && !criteria.method)
  ));
  const removed = entries.length - nextEntries.length;

  if (removed <= 0) {
    return 0;
  }

  entries.splice(0, entries.length, ...nextEntries);
  syncBackendDiagnostics(runtimeWindow);
  updateRuntimeDiagnosticToggleState();
  return removed;
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message || error.name || 'Unknown error';
  }
  return String(error);
}

export function formatDiagnosticReference(entry: { id?: string } | null | undefined): string {
  return entry?.id ? `[${entry.id}]` : '';
}

export async function getResponseErrorSummary(
  response: Response,
): Promise<{ message: string; detail: string }> {
  const fallbackMessage = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;

  try {
    const text = await response.clone().text();
    const trimmedText = text.trim();
    if (!trimmedText) {
      return { message: fallbackMessage, detail: fallbackMessage };
    }

    try {
      const parsed = JSON.parse(trimmedText);
      const parsedMessage = extractJsonErrorMessage(parsed);
      return {
        message: clip(parsedMessage || fallbackMessage, 500) || fallbackMessage,
        detail: clip(trimmedText, 1200) || fallbackMessage,
      };
    } catch {
      return {
        message: clip(trimmedText, 500) || fallbackMessage,
        detail: clip(trimmedText, 1200) || fallbackMessage,
      };
    }
  } catch {
    return { message: fallbackMessage, detail: fallbackMessage };
  }
}

export async function reportBackendResponseIssue(options: {
  operation: string;
  response: Response;
  source?: string;
  method?: string;
  kind?: string;
  detail?: string;
}): Promise<BackendDiagnosticEntry> {
  const summary = await getResponseErrorSummary(options.response);
  const source = options.source || options.response.url || 'backend';
  return pushBackendDiagnostic({
    kind: options.kind || 'http',
    operation: options.operation,
    message: summary.message,
    source,
    method: options.method,
    status: options.response.status,
    detail: options.detail || summary.detail,
    attribution: classifyBackendFailure({
      response: options.response,
      source,
      kind: options.kind || 'http',
    }),
  });
}

export function reportBackendException(options: {
  operation: string;
  error: unknown;
  source: string;
  method?: string;
  kind?: string;
  status?: number;
  detail?: string;
}): BackendDiagnosticEntry {
  const message = clip(getErrorMessage(options.error), 500) || 'Unknown backend failure';
  const stack = options.error instanceof Error && options.error.stack
    ? options.error.stack
    : '';
  const attribution = classifyBackendFailure({
    error: options.error,
    source: options.source,
    kind: options.kind,
    status: options.status,
  });
  const detailParts = [options.detail, stack].filter(Boolean);

  return pushBackendDiagnostic({
    kind: options.kind || 'network',
    operation: options.operation,
    message,
    source: options.source,
    method: options.method,
    status: options.status,
    detail: detailParts.join('\n'),
    attribution,
  });
}
