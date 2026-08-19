import type {
  VoiceAdvancedPanelState,
  VoiceAttemptSummary,
  VoiceBackendPayload,
  VoiceCoachVoiceState,
  VoiceConditioningState,
  VoiceCustomTargetPreset,
  VoiceDrillState,
  VoiceInputRuntimeState,
  VoiceLearnerContextState,
  VoiceLiveFrame,
  VoiceReferenceAnalysis,
  VoiceStudentModelState,
} from './state';
import type {
  VoiceAttemptArtifact,
  VoiceCoachInputProvider,
  VoiceTargetProfile,
  VoiceTargetSource,
} from './contracts';
import type { VoiceKnowledgeStatusPayload } from './knowledge-status';
import {
  formatDiagnosticReference,
  reportBackendException,
  reportBackendResponseIssue,
} from '../runtime-diagnostics';
export type { VoiceBackendPayload } from './state';
export type { VoiceCoachInputProvider } from './contracts';

export type VoiceCockpitLineAction = 'ensure' | 'regenerate' | 'easier' | 'harder' | 'next' | 'pin-toggle';
export type VoiceInputRuntimeEvent = 'idle' | 'waiting' | 'listening' | 'processing' | 'completed' | 'no-speech' | 'error';

export type VoiceInputRuntimeEventRequest = {
  requestedProvider?: VoiceCoachInputProvider;
  effectiveProvider?: VoiceCoachInputProvider | null;
  captureProvider?: VoiceCoachInputProvider | null;
  providerStyle?: string | null;
  transcriptSource?: string | null;
  transcript?: string | null;
  confidence?: number | null;
  captureStartedAt?: number | null;
  speechDetectedAt?: number | null;
  capturedAt?: number | null;
  processedAt?: number | null;
  captureDurationMs?: number | null;
  roundTripMs?: number | null;
  error?: string | null;
};

export type VoiceInputTurnRequest =
  | {
      requestedProvider: VoiceCoachInputProvider;
      captureProvider?: VoiceCoachInputProvider;
      transcript: string;
      confidence?: number | null;
      isFinal?: boolean;
      captureStartedAt?: number | null;
      speechDetectedAt?: number | null;
      capturedAt?: number | null;
      transcriptSource?: string | null;
      audioBlob?: never;
      filename?: never;
      language?: never;
    }
  | {
      requestedProvider: VoiceCoachInputProvider;
      captureProvider?: VoiceCoachInputProvider;
      audioBlob: Blob;
      filename?: string;
      language?: string;
      isFinal?: boolean;
      captureStartedAt?: number | null;
      speechDetectedAt?: number | null;
      capturedAt?: number | null;
      transcriptSource?: string | null;
      transcript?: never;
      confidence?: never;
    };

export type VoiceInputRuntimeResponse = VoiceBackendPayload & Record<string, unknown>;
export type VoiceInputTurnResponse = VoiceBackendPayload & Record<string, unknown> & {
  inputTurn?: {
    transcript?: string | null;
    outcome?: 'completed' | 'no-speech' | null;
  } | null;
};

type VoiceApiConfig = {
  kernelUrl: string;
  voiceTrainerUrl: string;
  voiceTrainerToken?: string | null;
};

export type JsonParseMode = 'strict' | 'empty-object' | 'null';

type ErrorPayload = {
  error?: unknown;
  detail?: unknown;
  message?: unknown;
};

type VoiceHealthResponse = {
  status?: string;
  deepTutorVoiceRoutesEnabled?: boolean;
};

type VoiceSpeechStatusResponse = {
  providers?: {
    voxcpm?: {
      enabled?: boolean;
      available?: boolean;
      infoError?: string | null;
      lastError?: string | null;
    } | null;
  } | null;
};

export type VoiceHealthSnapshot = {
  health: VoiceHealthResponse;
  speechStatus: VoiceSpeechStatusResponse | null;
  inputStatus: unknown | null;
};

export type VoiceDrillSelectionResponse = VoiceBackendPayload & Partial<VoiceDrillState> & {
  drill?: {
    title?: string | null;
  } | null;
};

export type VoicePracticeTakeResponse = VoiceBackendPayload & {
  summary?: VoiceAttemptSummary | null;
};

type VoicePracticeTakeRequestBody = {
  sessionId: string;
  reason: string;
  lastTakeTimeline: VoiceLiveFrame[] | null;
  clientAttemptId?: string | null;
  repContext?: VoiceAttemptArtifact['repContext'];
  selfReport?: VoiceAttemptArtifact['selfReport'];
};

export type VoiceTargetPresetLibraryResponse = VoiceBackendPayload & {
  presets?: VoiceCustomTargetPreset[];
  preset?: VoiceCustomTargetPreset | null;
  deletedPresetId?: string | null;
};

/**
 * Plain-English trust verdict the DSP attaches to an analyzed reference clip
 * (P1 clip trust). `verdict` drives the front-door report card; `cloneable`
 * mirrors the server-side cloning gate (whether VoxCPM is allowed to clone it).
 */
export type VoiceReferenceQualityAssessment = {
  durationMs?: number | null;
  clippingPct?: number | null;
  meanLoudnessDb?: number | null;
  voicedCoveragePct?: number | null;
  flags?: string[];
  verdict?: 'good' | 'usable' | 'reject' | string | null;
  cloneable?: boolean | null;
  summary?: string | null;
  cloneNote?: string | null;
};

export type VoiceReferenceAnalyzeResponse = {
  clipId?: string | null;
  filename?: string | null;
  durationMs?: number | null;
  metrics?: VoiceReferenceAnalysis['metrics'] | null;
  timeline?: VoiceReferenceAnalysis['timeline'];
  targetPreset?: string | null;
  quality?: VoiceReferenceQualityAssessment | null;
  analysisVersion?: string | null;
};

export type VoiceKnowledgeStatusResponse = VoiceKnowledgeStatusPayload & {
  success?: boolean;
  error?: unknown;
};

export type VoiceLearnerContextProfileResponse = VoiceBackendPayload & {
  success?: boolean;
  studentId?: string | null;
  studentModel?: Partial<VoiceStudentModelState> | null;
  learnerContext?: Partial<VoiceLearnerContextState> | null;
  manifest?: VoiceLearnerContextExportManifest | null;
  deletionReceipt?: Record<string, unknown> | null;
  resetReceipt?: Record<string, unknown> | null;
};

// v2 learner memo: narrow views of the additive memo fields the welcome-back
// card + continuity greeting need. These ride on the existing learner-context
// snapshot response (the backend adds them); typed here locally so the P2
// memory surface stays self-contained (no edits to the shared state contracts).
export type VoiceLearnerMemoProfile = {
  displayName?: string | null;
  topics?: string[] | null;
  hobbies?: string[] | null;
};

export type VoiceLearnerMemoReference = {
  clipId?: string | null;
  name?: string | null;
  summary?: string | null;
};

export type VoiceLearnerMemoRecentAttempt = {
  attemptId?: string | null;
  recordedAt?: number | null;
  targetPreset?: string | null;
  targetHitPct?: number | null;
  referenceClipId?: string | null;
  usableForLearning?: boolean | null;
  measurementAvailable?: boolean | null;
  measurementRejectionReasons?: string[] | null;
};

export type VoiceLearnerMemoSnapshot = {
  studentId?: string | null;
  masteryLevel?: string | null;
  profile?: VoiceLearnerMemoProfile | null;
  whatWorked?: string[] | null;
  lastReference?: VoiceLearnerMemoReference | null;
  recentAttempts?: VoiceLearnerMemoRecentAttempt[] | null;
};

// The learner-context profile response with the memo fields surfaced (both at
// the top level and inside learnerContext, mirroring the backend snapshot).
export type VoiceLearnerMemoProfileResponse = VoiceLearnerContextProfileResponse & VoiceLearnerMemoSnapshot & {
  learnerContext?: (Partial<VoiceLearnerContextState> & VoiceLearnerMemoSnapshot) | null;
};

export type VoiceCoachGreeting = {
  line1?: string | null;
  line2?: string | null;
  lines?: string[] | null;
  text?: string | null;
  // v1.5 one-real-sentence: when a debrief is pending, the greeting appends a
  // third line asking how yesterday's sentence went, plus the entry itself so
  // the frontend can render the three quiet outcome buttons. Both are additive
  // (line1/line2 are unchanged); absent when nothing is pending.
  debriefLine?: string | null;
  pendingDebrief?: VoiceRealSentenceEntry | null;
  // B-SESS ambient scope: the learner's remembered daypart tier (wire
  // vocabulary 'full' | 'quiet' | 'silent', null when none) and the one
  // ignorable context question when it fired. Both additive/optional —
  // session-scope.ts seeds the session from tierDefault once, silently.
  tierDefault?: string | null;
  scopeAsk?: string | null;
};

export type VoiceCoachGreetingResponse = {
  success?: boolean;
  sessionId?: string | null;
  studentId?: string | null;
  greeting?: VoiceCoachGreeting | null;
  error?: unknown;
};

// v1.5 one-real-sentence: the bridge from practice to life at minimum dose.
// These ride the dedicated /voice/real-sentence routes (kernel). Typed locally —
// the shared VoiceBackendPayload slice does not model them (same pattern as the
// P2 learner-memo + P3 practice-card fields above).
export type VoiceRealSentenceStatus = 'picked' | 'ready' | 'carried' | 'debriefed';
export type VoiceRealSentenceOutcome = 'said-well' | 'said-rough' | 'not-said';

export type VoiceRealSentenceEntry = {
  id: string;
  text: string;
  pickedAt?: string | null; // local date string
  status: VoiceRealSentenceStatus;
  outcome?: VoiceRealSentenceOutcome | null;
  note?: string | null;
};

export type VoiceRealSentenceResponse = {
  success?: boolean;
  studentId?: string | null;
  today?: VoiceRealSentenceEntry | null;
  pendingDebrief?: VoiceRealSentenceEntry | null;
  suggestions?: string[];
  error?: unknown;
};

export type VoiceRealSentencePickResponse = {
  success?: boolean;
  studentId?: string | null;
  entry?: VoiceRealSentenceEntry | null;
  // The PracticeCard (kind:'real_sentence') created + set active for the session
  // when a sessionId was supplied. The lesson controller renders it via its own
  // card flow; typed unknown here (normalized by lesson/card.ts).
  card?: unknown | null;
  error?: unknown;
};

export type VoiceRealSentenceOutcomeResponse = {
  success?: boolean;
  studentId?: string | null;
  id?: string | null;
  outcome?: VoiceRealSentenceOutcome | null;
  // The warm template line the coach renders into the thread for this outcome.
  coachLine?: string | null;
  error?: unknown;
};

// v1.5 time-lapse mirror: the person's own recorded arc. One pinned take a week
// (guidance, not rule). Kernel proxies to the DSP milestone endpoints.
export type VoiceMilestoneMetricsSummary = {
  meanPitchHz?: number | null;
  resonance?: number | null;
  heldRatio?: number | null;
};

export type VoiceMilestone = {
  id: string;
  date?: string | null;
  label?: string | null;
  attemptId?: string | null;
  durationMs?: number | null;
  metricsSummary?: VoiceMilestoneMetricsSummary | null;
};

export type VoiceMilestoneListResponse = {
  success?: boolean;
  milestones?: VoiceMilestone[];
  error?: unknown;
};

export type VoicePinAttemptResponse = {
  success?: boolean;
  milestone?: VoiceMilestone | null;
  error?: unknown;
};

export type VoiceDeleteMilestoneResponse = {
  success?: boolean;
  error?: unknown;
};

export type VoiceLearnerContextExportManifest = {
  schemaVersion?: string | null;
  studentId?: string | null;
  generatedAt?: number | null;
  consent?: Record<string, unknown> | null;
  eligibility?: Record<string, unknown> | null;
  exclusions?: string[];
  exportEligible?: boolean;
  recentAttemptCount?: number | null;
  source?: Record<string, unknown> | null;
};

export type VoiceLearnerContextExportManifestResponse = {
  success?: boolean;
  studentId?: string | null;
  manifest?: VoiceLearnerContextExportManifest | null;
};

export type VoiceLearnerContextDatasetControlsRequest = {
  consent?: Record<string, unknown> | null;
  eligibility?: Record<string, unknown> | null;
  exclusions?: string[];
  query?: string;
};

export type VoiceLearnerContextProfileUpdateRequest = {
  displayName?: string | null;
  pronouns?: string | null;
  direction?: 'mtf' | 'ftm' | 'neutral' | 'unspecified' | string | null;
  goal?: string | null;
  topics?: string[];
  hobbies?: string[];
  avoid?: string[];
  whatWorked?: Array<string | { text: string; axis?: string | null; date?: string | null }>;
  query?: string;
};

export type VoiceLearnerContextForgetRequest = {
  operation?: 'reset-personalization' | 'delete-all';
  momentId?: string | null;
  removePreference?: string | null;
  query?: string;
};

export type VoiceLearnerContextNotepadHandoffRequest = {
  content?: string | null;
  items?: string[];
  note?: string | null;
  sessionId?: string | null;
  source?: string | null;
  summary?: string | null;
  query?: string;
};

type VoiceCoachTaskStartResponse = {
  taskId?: string | null;
};

type VoiceCoachTaskStatusResponse = {
  status?: string;
  result?: unknown;
  error?: unknown;
};

const pendingVoiceAttemptArtifacts = new Map<string, VoiceAttemptArtifact>();

function createVoiceAttemptArtifactKey(sessionId: string, reason: string): string {
  return `${sessionId}\n${reason}`;
}

export function registerVoiceAttemptArtifact(
  sessionId: string,
  reason: string,
  attemptArtifact: VoiceAttemptArtifact | null | undefined,
): () => void {
  if (!attemptArtifact) {
    return () => undefined;
  }
  const artifactKey = createVoiceAttemptArtifactKey(sessionId, reason);
  pendingVoiceAttemptArtifacts.set(artifactKey, attemptArtifact);
  return () => {
    if (pendingVoiceAttemptArtifacts.get(artifactKey) === attemptArtifact) {
      pendingVoiceAttemptArtifacts.delete(artifactKey);
    }
  };
}

function takeRegisteredVoiceAttemptArtifact(sessionId: string, reason: string): VoiceAttemptArtifact | null {
  const artifactKey = createVoiceAttemptArtifactKey(sessionId, reason);
  const attemptArtifact = pendingVoiceAttemptArtifacts.get(artifactKey) || null;
  pendingVoiceAttemptArtifacts.delete(artifactKey);
  return attemptArtifact;
}

function hasAttemptArtifactField(
  attemptArtifact: VoiceAttemptArtifact,
  field: keyof VoiceAttemptArtifact,
): boolean {
  return Object.prototype.hasOwnProperty.call(attemptArtifact, field);
}

function createVoicePracticeTakeRequestBody(
  sessionId: string,
  reason: string,
  lastTakeTimeline: VoiceLiveFrame[] | null,
  attemptArtifact: VoiceAttemptArtifact | null | undefined,
): VoicePracticeTakeRequestBody {
  const requestBody: VoicePracticeTakeRequestBody = {
    sessionId,
    reason,
    lastTakeTimeline,
  };
  if (!attemptArtifact) {
    return requestBody;
  }
  if (hasAttemptArtifactField(attemptArtifact, 'clientAttemptId')) {
    requestBody.clientAttemptId = attemptArtifact.clientAttemptId ?? null;
  }
  if (hasAttemptArtifactField(attemptArtifact, 'repContext')) {
    requestBody.repContext = attemptArtifact.repContext ?? null;
  }
  if (hasAttemptArtifactField(attemptArtifact, 'selfReport')) {
    requestBody.selfReport = attemptArtifact.selfReport ?? null;
  }
  return requestBody;
}

function createJsonRequest(body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

export async function parseJson<T>(response: Response, mode: JsonParseMode): Promise<T> {
  if (mode === 'strict') {
    return response.json() as Promise<T>;
  }
  const fallback = mode === 'null' ? null : {};
  return response.json().catch(() => fallback as T);
}

export function resolveErrorMessage(
  response: Response,
  data: ErrorPayload | null | undefined,
  usePayloadError: boolean,
): string {
  if (usePayloadError && typeof data?.error === 'string' && data.error.trim()) {
    return data.error.trim();
  }
  if (usePayloadError) {
    const candidate = [data?.detail, data?.message].find((value) => (
      typeof value === 'string' && value.trim()
    ));
    if (typeof candidate === 'string') {
      return candidate.trim();
    }
  }
  return `HTTP ${response.status}`;
}

/**
 * Thrown by {@link requestJson} when the fetch itself rejected — no HTTP
 * response object ever arrived (connection refused, DNS failure, offline,
 * connection dropped). Distinct from HTTP errors (4xx/5xx), which arrive as
 * plain `Error`s: those prove the request reached A server, so retrying them
 * risks double-applying a coach turn.
 */
export class VoiceNetworkRequestError extends Error {
  readonly isVoiceNetworkError = true;

  constructor(message: string) {
    super(message);
    this.name = 'VoiceNetworkRequestError';
  }
}

export async function requestJson<T>(
  input: string,
  init?: RequestInit,
  options: {
    successParseMode?: JsonParseMode;
    errorFromBody?: boolean;
  } = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(input, init);
  } catch (error) {
    const diagnostic = reportBackendException({
      operation: 'Voice API request',
      error,
      source: input,
      method: (init?.method || 'GET').toUpperCase(),
      kind: 'network',
    });
    throw new VoiceNetworkRequestError(`Voice request failed ${formatDiagnosticReference(diagnostic)}: ${diagnostic.message}`);
  }
  if (!response.ok) {
    const diagnosticResponse = response.clone();
    const errorData = options.errorFromBody === false
      ? null
      : await parseJson<ErrorPayload | null>(response, 'empty-object');
    const diagnostic = await reportBackendResponseIssue({
      operation: 'Voice API request',
      response: diagnosticResponse,
      source: input,
      method: (init?.method || 'GET').toUpperCase(),
      kind: 'http',
    });
    throw new Error(`${resolveErrorMessage(response, errorData, options.errorFromBody !== false)} ${formatDiagnosticReference(diagnostic)}`.trim());
  }
  return parseJson<T>(response, options.successParseMode ?? 'strict');
}

export async function requestOptionalJson<T>(input: string): Promise<T | null> {
  const response = await fetch(input).catch((error) => {
    reportBackendException({
      operation: 'Voice optional API request',
      error,
      source: input,
      method: 'GET',
      kind: 'network',
    });
    return null;
  });
  if (!response?.ok) {
    if (response) {
      await reportBackendResponseIssue({
        operation: 'Voice optional API request',
        response,
        source: input,
        method: 'GET',
        kind: 'http',
      });
    }
    return null;
  }
  return parseJson<T | null>(response, 'null');
}

/* ── Coach-turn retry (transient transport failures) ─────────────────────────
 * A coach message POST is NOT idempotent server-side: /voice/coach/message and
 * /voice/coach/runtime both run processVoiceCoachRuntime → generateRealtimeCoachReply,
 * which mutates learner memory BEFORE the model call and appends the turn to the
 * coach thread — and the backend has no turnId/nonce dedup (verified 2026-07-19,
 * backend/voice-standalone-runtime.js:2996ff). A received 5xx (incl. 502-504) can
 * therefore follow a partial or complete server-side apply, so retrying ANY HTTP
 * status risks double-applying the turn. Retry is limited to pure NETWORK errors
 * (fetch rejected — no HTTP response arrived), once, after a short pause, with the
 * byte-identical payload (RequestInit built once, reused).
 */
export const COACH_TURN_RETRY_DELAY_MS = 1_500;

export const COACH_TURN_RETRY_HINT = "connection hiccup — that one didn't reach the coach; try again";

/**
 * Abandon-trigger fix 2b (voiced failure states): when the single retry ALSO
 * fails on the network, the turn is lost — the coach thread gets this one calm
 * line (wired in standalone-app via the settled event below) instead of only
 * the error strip. Honest: a pure network failure means the turn never arrived.
 */
export const COACH_TURN_LOST_THREAD_LINE = "Say that again? That one didn't reach me.";

/**
 * Coach-turn lifecycle tee (document CustomEvents, DOM-optional). Fired by
 * withCoachTurnRetry around every coach-turn POST so zone-local surfaces
 * (think-gap filler, lost-turn thread line) can react without new plumbing
 * through the request controllers — the same document-event tee pattern
 * coach-honesty uses for backend payloads.
 *  - start: a coach turn left the frontend (detail: { source }).
 *  - settled: the turn finished (detail: { source, ok, lost }) — `lost` is true
 *    only when the retry exhausted on a pure network failure (turn never
 *    reached the backend).
 */
export const VOICE_COACH_TURN_START_EVENT = 'tv-coach-turn-start';
export const VOICE_COACH_TURN_SETTLED_EVENT = 'tv-coach-turn-settled';

export type VoiceCoachTurnSettledDetail = {
  source: string | null;
  ok: boolean;
  /** True only for the exhausted pure-network case: the turn never arrived. */
  lost: boolean;
};

function emitCoachTurnEvent(
  name: string,
  detail: { source: string | null } & Partial<Pick<VoiceCoachTurnSettledDetail, 'ok' | 'lost'>>,
): void {
  if (typeof document === 'undefined' || typeof CustomEvent !== 'function') {
    return;
  }
  try {
    document.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {
    // The tee must never break the request path.
  }
}

export function isTransientCoachTurnError(error: unknown): boolean {
  return error instanceof VoiceNetworkRequestError;
}

/**
 * Runs a coach-turn request thunk; on a transient (pure-network) failure, waits
 * ~1.5s and retries ONCE with the same thunk. 4xx/5xx responses are never
 * retried (see the block comment above). If the retry also fails on the network,
 * the calm hint is appended so every existing error surface (question error,
 * input error state) shows it without further wiring.
 */
export async function withCoachTurnRetry<T>(
  run: () => Promise<T>,
  options: {
    delayMs?: number;
    source?: string;
    onRetry?: (error: Error) => void;
  } = {},
): Promise<T> {
  const source = options.source ?? null;
  emitCoachTurnEvent(VOICE_COACH_TURN_START_EVENT, { source });
  try {
    const result = await run();
    emitCoachTurnEvent(VOICE_COACH_TURN_SETTLED_EVENT, { source, ok: true, lost: false });
    return result;
  } catch (error) {
    if (!isTransientCoachTurnError(error)) {
      emitCoachTurnEvent(VOICE_COACH_TURN_SETTLED_EVENT, { source, ok: false, lost: false });
      throw error;
    }
    const delayMs = options.delayMs ?? COACH_TURN_RETRY_DELAY_MS;
    console.info(
      `[coach-turn] transient network failure${options.source ? ` (${options.source})` : ''} — retrying once in ${delayMs}ms`,
    );
    options.onRetry?.(error as Error);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, delayMs);
    });
    try {
      const retried = await run();
      emitCoachTurnEvent(VOICE_COACH_TURN_SETTLED_EVENT, { source, ok: true, lost: false });
      return retried;
    } catch (retryError) {
      const lost = isTransientCoachTurnError(retryError);
      if (lost && retryError instanceof Error) {
        retryError.message = `${retryError.message} (${COACH_TURN_RETRY_HINT})`;
      }
      emitCoachTurnEvent(VOICE_COACH_TURN_SETTLED_EVENT, { source, ok: false, lost });
      throw retryError;
    }
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

export function resolveAudioFormatFromMimeType(mimeType: string): string {
  if (mimeType.includes('webm')) return 'webm';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('mpeg') || mimeType.includes('mp3')) return 'mp3';
  if (mimeType.includes('mp4') || mimeType.includes('m4a')) return 'm4a';
  return 'wav';
}

export function createVoiceApi({ kernelUrl, voiceTrainerUrl, voiceTrainerToken = null }: VoiceApiConfig) {
  const kernel = (path: string) => `${kernelUrl}${path}`;
  const voiceTrainer = (path: string) => `${voiceTrainerUrl}${path}`;
  const voiceTrainerBearerToken = typeof voiceTrainerToken === 'string' && voiceTrainerToken.trim()
    ? voiceTrainerToken.trim()
    : '';

  function withVoiceTrainerAuth(init?: RequestInit): RequestInit | undefined {
    if (!voiceTrainerBearerToken) {
      return init;
    }
    const headers = new Headers(init?.headers);
    headers.set('Authorization', `Bearer ${voiceTrainerBearerToken}`);
    return { ...(init || {}), headers };
  }

  return {
    refreshCockpitLine(sessionId: string, action: VoiceCockpitLineAction): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/cockpit/line'),
        createJsonRequest({ sessionId, action }),
        { successParseMode: 'empty-object' },
      );
    },

    updateCockpitState(
      sessionId: string,
      patch: {
        coachVoice?: Partial<VoiceCoachVoiceState>;
        voiceInputRuntime?: Partial<VoiceInputRuntimeState>;
        advancedPanel?: Partial<VoiceAdvancedPanelState>;
      },
      currentState: {
        coachVoice: VoiceCoachVoiceState;
        voiceInputRuntime: VoiceInputRuntimeState;
        advancedPanel: VoiceAdvancedPanelState;
      },
    ): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/cockpit/state'),
        createJsonRequest({
          sessionId,
          coachVoice: patch.coachVoice ? { ...currentState.coachVoice, ...patch.coachVoice } : undefined,
          voiceInputRuntime: patch.voiceInputRuntime
            ? { ...currentState.voiceInputRuntime, ...patch.voiceInputRuntime }
            : undefined,
          advancedPanel: patch.advancedPanel ? { ...currentState.advancedPanel, ...patch.advancedPanel } : undefined,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    updateConditioningState(
      sessionId: string,
      voiceConditioning: VoiceConditioningState,
    ): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/speech/conditioning'),
        createJsonRequest({ sessionId, voiceConditioning }),
        { successParseMode: 'empty-object' },
      );
    },

    async prepareConditioningLatents(
      sessionId: string,
      target: 'prompt' | 'reference',
      file: File,
      promptText = '',
    ): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/speech/conditioning/latents'),
        createJsonRequest({
          sessionId,
          target,
          filename: file.name,
          audioFormat: (file.name.split('.').pop() || 'wav').toLowerCase(),
          audioBase64: arrayBufferToBase64(await file.arrayBuffer()),
          promptText,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    startDeepTutorVoiceLesson(sessionId: string, rebuildPlan = false): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/deeptutor/voice/session/start'),
        createJsonRequest({ sessionId, rebuildPlan }),
        { successParseMode: 'empty-object' },
      );
    },

    advanceDeepTutorVoiceLesson(sessionId: string): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/deeptutor/voice/session/next'),
        createJsonRequest({ sessionId }),
        { successParseMode: 'empty-object' },
      );
    },

    submitCoachQuestion(sessionId: string, message: string, audioBase64?: string, audioFormat?: string): Promise<VoiceBackendPayload> {
      const body: Record<string, unknown> = { sessionId, message };
      if (audioBase64) {
        body.audioBase64 = audioBase64;
        body.audioFormat = audioFormat || 'wav';
      }
      // Same payload on retry: the RequestInit (body string) is built once.
      const init = createJsonRequest(body);
      return withCoachTurnRetry(() => requestJson<VoiceBackendPayload>(
        kernel('/voice/coach/message'),
        init,
        { successParseMode: 'empty-object' },
      ), { source: '/voice/coach/message' });
    },

    submitRuntimeCoachQuestion(
      sessionId: string,
      message: string,
      audioBase64?: string,
      audioFormat?: string,
      listeningTurnId?: string,
    ): Promise<VoiceBackendPayload> {
      const body: Record<string, unknown> = { sessionId, message };
      if (audioBase64) {
        body.audioBase64 = audioBase64;
        body.audioFormat = audioFormat || 'wav';
      }
      if (listeningTurnId?.trim()) {
        body.listeningTurnId = listeningTurnId;
      }
      const init = createJsonRequest(body);
      return withCoachTurnRetry(() => requestJson<VoiceBackendPayload>(
        kernel('/voice/coach/runtime'),
        init,
        { successParseMode: 'empty-object' },
      ), { source: '/voice/coach/runtime' });
    },


    requestDeepTutorCoach(sessionId: string): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/deeptutor/voice/session/coach'),
        createJsonRequest({ sessionId }),
        { successParseMode: 'empty-object' },
      );
    },

    startCoachTask(sessionId: string): Promise<VoiceCoachTaskStartResponse> {
      return requestJson<VoiceCoachTaskStartResponse>(
        kernel('/voice/coach/start'),
        createJsonRequest({ sessionId }),
        { successParseMode: 'empty-object' },
      );
    },

    getTaskStatus(taskId: string): Promise<VoiceCoachTaskStatusResponse> {
      return requestJson<VoiceCoachTaskStatusResponse>(
        kernel(`/task/${encodeURIComponent(taskId)}/status`),
        undefined,
        { errorFromBody: false },
      );
    },

    async getHealthSnapshot(): Promise<VoiceHealthSnapshot> {
      const [health, speechStatus, inputStatus] = await Promise.all([
        requestJson<VoiceHealthResponse>(kernel('/voice/health'), undefined, { errorFromBody: false }),
        requestOptionalJson<VoiceSpeechStatusResponse>(kernel('/voice/speech/status')),
        requestOptionalJson<unknown>(kernel('/voice/input/status')),
      ]);
      return { health, speechStatus, inputStatus };
    },

    async getKnowledgeStatus(): Promise<VoiceKnowledgeStatusPayload> {
      const data = await requestJson<VoiceKnowledgeStatusResponse>(
        kernel('/knowledge/voice/status'),
        undefined,
        { successParseMode: 'empty-object', errorFromBody: false },
      );
      if (data?.success === false) {
        throw new Error(typeof data.error === 'string' && data.error.trim() ? data.error.trim() : 'Voice knowledge status unavailable.');
      }
      return data;
    },

    getLearnerContextProfile(
      studentId: string,
      query = '',
    ): Promise<VoiceLearnerContextProfileResponse> {
      const params = new URLSearchParams({ studentId });
      if (query.trim()) {
        params.set('query', query.trim());
      }
      return requestJson<VoiceLearnerContextProfileResponse>(
        kernel(`/voice/learner-context/profile?${params.toString()}`),
        undefined,
        { successParseMode: 'empty-object' },
      );
    },

    // v2 learner memo: same endpoint as getLearnerContextProfile, but typed to
    // surface the additive memo fields (profile/whatWorked/lastReference/
    // recentAttempts) the welcome-back card reads off the snapshot response.
    getLearnerMemoProfile(
      studentId: string,
      query = '',
    ): Promise<VoiceLearnerMemoProfileResponse> {
      const params = new URLSearchParams({ studentId });
      if (query.trim()) {
        params.set('query', query.trim());
      }
      return requestJson<VoiceLearnerMemoProfileResponse>(
        kernel(`/voice/learner-context/profile?${params.toString()}`),
        undefined,
        { successParseMode: 'empty-object' },
      );
    },

    // v2 learner memo: fetch the deterministic two-line continuity greeting for
    // session entry. Always resolves (the backend returns a neutral fallback).
    getCoachGreeting(sessionId: string, studentId?: string | null): Promise<VoiceCoachGreetingResponse> {
      const params = new URLSearchParams();
      if (sessionId.trim()) {
        params.set('sessionId', sessionId.trim());
      }
      if (typeof studentId === 'string' && studentId.trim()) {
        params.set('studentId', studentId.trim());
      }
      const queryString = params.toString();
      return requestJson<VoiceCoachGreetingResponse>(
        kernel(`/voice/coach/greeting${queryString ? `?${queryString}` : ''}`),
        undefined,
        { successParseMode: 'empty-object' },
      );
    },

    getLearnerContextExportManifest(studentId: string): Promise<VoiceLearnerContextExportManifestResponse> {
      const params = new URLSearchParams({ studentId });
      return requestJson<VoiceLearnerContextExportManifestResponse>(
        kernel(`/voice/learner-context/export-manifest?${params.toString()}`),
        undefined,
        { successParseMode: 'empty-object' },
      );
    },

    updateLearnerContextDatasetControls(
      studentId: string,
      payload: VoiceLearnerContextDatasetControlsRequest = {},
    ): Promise<VoiceLearnerContextProfileResponse> {
      return requestJson<VoiceLearnerContextProfileResponse>(
        kernel('/voice/learner-context/dataset-controls'),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studentId,
            consent: payload.consent,
            eligibility: payload.eligibility,
            exclusions: payload.exclusions,
            query: payload.query,
          }),
        },
        { successParseMode: 'empty-object' },
      );
    },

    updateLearnerContextProfile(
      studentId: string,
      payload: VoiceLearnerContextProfileUpdateRequest = {},
    ): Promise<VoiceLearnerContextProfileResponse> {
      return requestJson<VoiceLearnerContextProfileResponse>(
        kernel('/voice/learner-context/profile'),
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ studentId, ...payload }),
        },
        { successParseMode: 'empty-object' },
      );
    },

    forgetLearnerContext(
      studentId: string,
      payload: VoiceLearnerContextForgetRequest = {},
    ): Promise<VoiceLearnerContextProfileResponse> {
      return requestJson<VoiceLearnerContextProfileResponse>(
        kernel('/voice/learner-context/forget'),
        createJsonRequest({ studentId, ...payload }),
        { successParseMode: 'empty-object' },
      );
    },

    updateLearnerContextNotepadHandoff(
      studentId: string,
      payload: VoiceLearnerContextNotepadHandoffRequest = {},
    ): Promise<VoiceLearnerContextProfileResponse> {
      return requestJson<VoiceLearnerContextProfileResponse>(
        kernel('/voice/learner-context/notepad-handoff'),
        createJsonRequest({
          studentId,
          content: payload.content,
          items: payload.items,
          note: payload.note,
          sessionId: payload.sessionId,
          source: payload.source,
          summary: payload.summary,
          query: payload.query,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    submitInputRuntimeEvent(
      sessionId: string,
      event: VoiceInputRuntimeEvent,
      options: VoiceInputRuntimeEventRequest = {},
    ): Promise<VoiceInputRuntimeResponse> {
      return requestJson<VoiceInputRuntimeResponse>(
        kernel('/voice/input/runtime'),
        createJsonRequest({
          sessionId,
          event,
          requestedProvider: options.requestedProvider ?? null,
          effectiveProvider: options.effectiveProvider ?? null,
          captureProvider: options.captureProvider ?? null,
          providerStyle: options.providerStyle ?? null,
          transcriptSource: options.transcriptSource ?? null,
          transcript: options.transcript ?? null,
          confidence: options.confidence ?? null,
          captureStartedAt: options.captureStartedAt ?? null,
          speechDetectedAt: options.speechDetectedAt ?? null,
          capturedAt: options.capturedAt ?? null,
          processedAt: options.processedAt ?? null,
          captureDurationMs: options.captureDurationMs ?? null,
          roundTripMs: options.roundTripMs ?? null,
          error: options.error ?? null,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    async submitInputTurn(
      sessionId: string,
      input: VoiceInputTurnRequest,
    ): Promise<VoiceInputTurnResponse> {
      const sharedBody: Record<string, unknown> = {
        sessionId,
        requestedProvider: input.requestedProvider,
        captureProvider: input.captureProvider ?? ('audioBlob' in input ? 'backend' : 'browser'),
        isFinal: input.isFinal !== false,
        captureStartedAt: input.captureStartedAt ?? null,
        speechDetectedAt: input.speechDetectedAt ?? null,
        capturedAt: input.capturedAt ?? null,
        transcriptSource: input.transcriptSource ?? null,
      };

      const body: Record<string, unknown> = { ...sharedBody };
      const audioBlob = 'audioBlob' in input ? input.audioBlob : null;
      if (audioBlob) {
        const audioFormat = resolveAudioFormatFromMimeType(audioBlob.type || 'audio/webm');
        body.audioFormat = audioFormat;
        body.audioBase64 = arrayBufferToBase64(await audioBlob.arrayBuffer());
        body.mimeType = audioBlob.type || 'audio/webm';
        body.filename = input.filename || `voice-turn.${audioFormat}`;
        body.language = input.language || 'auto';
      } else {
        body.transcript = input.transcript;
        body.confidence = input.confidence ?? null;
      }

      // Same payload on retry: audio was base64-encoded above and the
      // RequestInit is built once, so the retry re-sends identical bytes.
      const init = createJsonRequest(body);
      return withCoachTurnRetry(() => requestJson<VoiceInputTurnResponse>(
        kernel('/voice/input/turn'),
        init,
        { successParseMode: 'empty-object' },
      ), { source: '/voice/input/turn' });
    },

    getSessionState(sessionId: string): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel(`/voice/session/${encodeURIComponent(sessionId)}`),
        undefined,
        { errorFromBody: false },
      );
    },

    getDrills(sessionId: string | null, targetPreset: string): Promise<Partial<VoiceDrillState>> {
      const params = new URLSearchParams();
      if (sessionId) {
        params.set('sessionId', sessionId);
      }
      params.set('targetPreset', targetPreset);
      return requestJson<Partial<VoiceDrillState>>(
        kernel(`/voice/drills?${params.toString()}`),
        undefined,
        { successParseMode: 'empty-object' },
      );
    },

    syncPreset(sessionId: string, targetPreset: string): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/session/preset'),
        createJsonRequest({ sessionId, targetPreset }),
        { successParseMode: 'empty-object' },
      );
    },

    listTargetPresets(options: { includeArchived?: boolean } = {}): Promise<VoiceTargetPresetLibraryResponse> {
      const params = new URLSearchParams();
      if (options.includeArchived) {
        params.set('includeArchived', '1');
      }
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel(`/voice/presets${params.size ? `?${params.toString()}` : ''}`),
        undefined,
        { successParseMode: 'empty-object' },
      );
    },

    saveReferencePreset(
      sessionId: string | null,
      payload: {
        presetId?: string | null;
        name?: string;
        basePreset?: string;
        referenceClipId?: string | null;
        referenceClipName?: string;
        referenceAnalysis?: VoiceReferenceAnalysis | null;
        targetVoiceProfile?: VoiceTargetProfile | null;
        expectedUpdatedAt?: number | null;
      } = {},
    ): Promise<VoiceTargetPresetLibraryResponse> {
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel('/voice/presets/reference/save'),
        createJsonRequest({
          sessionId,
          presetId: payload.presetId ?? null,
          name: payload.name ?? '',
          basePreset: payload.basePreset ?? '',
          referenceClipId: payload.referenceClipId ?? null,
          referenceClipName: payload.referenceClipName ?? '',
          referenceAnalysis: payload.referenceAnalysis ?? null,
          targetVoiceProfile: payload.targetVoiceProfile ?? null,
          expectedUpdatedAt: payload.expectedUpdatedAt ?? null,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    saveHandmadePreset(
      sessionId: string | null,
      payload: {
        presetId?: string | null;
        name: string;
        basePreset: string;
        expectedUpdatedAt?: number | null;
        pitchFloorHz: string;
        pitchCeilingHz: string;
        resonanceFloor: string;
        resonanceCeiling: string;
        weightFloor: string;
        weightCeiling: string;
        stylePrompt: string;
        notesText: string;
      },
    ): Promise<VoiceTargetPresetLibraryResponse> {
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel('/voice/presets/handmade/save'),
        createJsonRequest({
          sessionId,
          ...payload,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    selectTargetPreset(sessionId: string | null, presetId: string): Promise<VoiceTargetPresetLibraryResponse> {
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel('/voice/presets/select'),
        createJsonRequest({ sessionId, presetId }),
        { successParseMode: 'empty-object' },
      );
    },

    duplicateTargetPreset(
      sessionId: string | null,
      presetId: string,
      payload: {
        name?: string;
        expectedUpdatedAt?: number | null;
      } = {},
    ): Promise<VoiceTargetPresetLibraryResponse> {
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel('/voice/presets/duplicate'),
        createJsonRequest({
          sessionId,
          presetId,
          name: payload.name ?? '',
          expectedUpdatedAt: payload.expectedUpdatedAt ?? null,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    archiveTargetPreset(
      sessionId: string | null,
      presetId: string,
      expectedUpdatedAt: number | null = null,
    ): Promise<VoiceTargetPresetLibraryResponse> {
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel('/voice/presets/archive'),
        createJsonRequest({ sessionId, presetId, expectedUpdatedAt }),
        { successParseMode: 'empty-object' },
      );
    },

    restoreTargetPreset(
      sessionId: string | null,
      presetId: string,
      expectedUpdatedAt: number | null = null,
    ): Promise<VoiceTargetPresetLibraryResponse> {
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel('/voice/presets/restore'),
        createJsonRequest({ sessionId, presetId, expectedUpdatedAt }),
        { successParseMode: 'empty-object' },
      );
    },

    deleteTargetPreset(
      sessionId: string | null,
      presetId: string,
      expectedUpdatedAt: number | null = null,
    ): Promise<VoiceTargetPresetLibraryResponse> {
      return requestJson<VoiceTargetPresetLibraryResponse>(
        kernel('/voice/presets/delete'),
        createJsonRequest({ sessionId, presetId, expectedUpdatedAt }),
        { successParseMode: 'empty-object' },
      );
    },

    selectDrill(sessionId: string, lessonId: string): Promise<VoiceDrillSelectionResponse> {
      return requestJson<VoiceDrillSelectionResponse>(
        kernel('/voice/drills/select'),
        createJsonRequest({ sessionId, lessonId }),
        { successParseMode: 'empty-object' },
      );
    },

    startPracticeSession(
      sessionId: string,
      options: {
        targetPreset: string;
        referenceClipId: string | null;
        targetVoiceProfile: VoiceTargetProfile | null;
        targetSource: VoiceTargetSource;
      },
    ): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/session/start'),
        createJsonRequest({ sessionId, ...options }),
        { successParseMode: 'empty-object' },
      );
    },

    /**
     * Ambient session scope (B-SESS contract): persist the session's practice
     * scope — a partial patch, wire vocabulary ({ tier?: 'full'|'quiet'|'silent',
     * eyesFree? }). Kernel-backed (this api's base URL), so cross-origin
     * connection profiles work; the composition's same-origin default is
     * replaced with this via host-assembly-config. Failures are treated as
     * quiet no-ops by the ambient indicator (it keeps working locally).
     */
    postVoiceSessionScope(
      sessionId: string,
      scope: { tier?: string; eyesFree?: boolean },
    ): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel(`/voice/session/${encodeURIComponent(sessionId)}/scope`),
        createJsonRequest(scope),
        { successParseMode: 'empty-object' },
      );
    },

    submitPracticeTake(
      sessionId: string,
      reason: string,
      lastTakeTimeline: VoiceLiveFrame[] | null,
      attemptArtifact?: VoiceAttemptArtifact | null,
    ): Promise<VoicePracticeTakeResponse> {
      const registeredAttemptArtifact = takeRegisteredVoiceAttemptArtifact(sessionId, reason);
      return requestJson<VoicePracticeTakeResponse>(
        kernel('/voice/session/take'),
        createJsonRequest(createVoicePracticeTakeRequestBody(
          sessionId,
          reason,
          lastTakeTimeline,
          attemptArtifact === undefined ? registeredAttemptArtifact : attemptArtifact,
        )),
        { successParseMode: 'empty-object' },
      );
    },

    disarmPracticeSession(sessionId: string, reason: string): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/session/disarm'),
        createJsonRequest({ sessionId, reason }),
        { successParseMode: 'empty-object' },
      );
    },

    async analyzeReference(file: File, targetPreset: string): Promise<VoiceReferenceAnalyzeResponse> {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('targetPreset', targetPreset);
      return requestJson<VoiceReferenceAnalyzeResponse>(
        voiceTrainer('/api/v1/voice/reference/analyze'),
        withVoiceTrainerAuth({
          method: 'POST',
          body: formData,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    getReferenceAnalysis(clipId: string): Promise<VoiceReferenceAnalyzeResponse> {
      return requestJson<VoiceReferenceAnalyzeResponse>(
        voiceTrainer(`/api/v1/voice/reference/${encodeURIComponent(clipId)}`),
        withVoiceTrainerAuth(),
        { successParseMode: 'empty-object' },
      );
    },

    getReferenceAudioUrl(clipId: string): string {
      const url = new URL(
        voiceTrainer(`/api/v1/voice/reference/${encodeURIComponent(clipId)}/audio`),
      );
      if (voiceTrainerBearerToken) {
        url.searchParams.set('token', voiceTrainerBearerToken);
      }
      return url.toString();
    },

    syncReference(
      sessionId: string,
      referenceClipId: string | null,
      referenceClipName: string,
    ): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/session/reference'),
        createJsonRequest({
          sessionId,
          referenceClipId,
          referenceClipName,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    projectPhraseForecast(sessionId: string, phrase: string): Promise<VoiceBackendPayload> {
      return requestJson<VoiceBackendPayload>(
        kernel('/voice/phrase-forecast'),
        createJsonRequest({ sessionId, phrase }),
        { successParseMode: 'empty-object' },
      );
    },

    /* lesson-layer (Wave B consumes) — practice card + attempt-audio replay. */

    // Fetch the session's active practice card ({ success, card }). Card is the
    // tutor- or fallback-authored "strip of words"; null when none exists yet.
    fetchActiveCard(sessionId: string): Promise<{ success: boolean; card: unknown | null }> {
      return requestJson<{ success: boolean; card: unknown | null }>(
        kernel(`/voice/card?sessionId=${encodeURIComponent(sessionId)}`),
        withVoiceTrainerAuth(),
        { successParseMode: 'empty-object' },
      );
    },

    // Advance to the next deterministic fallback card (honors optional focus/topics).
    advanceCard(
      sessionId: string,
      options: { focus?: string; topics?: string[] } = {},
    ): Promise<{ success: boolean; card: unknown | null }> {
      return requestJson<{ success: boolean; card: unknown | null }>(
        kernel('/voice/card/advance'),
        createJsonRequest({ sessionId, focus: options.focus, topics: options.topics }),
        { successParseMode: 'empty-object' },
      );
    },

    // Build the kernel URL for a retained attempt-audio WAV (proxied to the DSP
    // service). Returns the URL string for an <audio> element / fetch — the kernel
    // proxy injects auth, so no token is appended here.
    fetchAttemptAudioUrl(attemptId: string): string {
      return kernel(`/voice/attempt/${encodeURIComponent(attemptId)}/audio`);
    },

    /* v1.5 one-real-sentence (kernel routes). An OFFER, never an obligation. */

    // GET /voice/real-sentence -> { today, pendingDebrief, suggestions[3] }.
    // studentId resolves server-side when omitted; we pass it (and an optional
    // sessionId) so the slot reflects the right learner.
    getRealSentence(studentId?: string | null, sessionId?: string | null): Promise<VoiceRealSentenceResponse> {
      const params = new URLSearchParams();
      if (typeof studentId === 'string' && studentId.trim()) {
        params.set('studentId', studentId.trim());
      }
      if (typeof sessionId === 'string' && sessionId.trim()) {
        params.set('sessionId', sessionId.trim());
      }
      const queryString = params.toString();
      return requestJson<VoiceRealSentenceResponse>(
        kernel(`/voice/real-sentence${queryString ? `?${queryString}` : ''}`),
        undefined,
        { successParseMode: 'empty-object' },
      );
    },

    // POST /voice/real-sentence/pick -> { entry, card }. With a sessionId the
    // created card (kind:'real_sentence') becomes the session's active card.
    pickRealSentence(
      text: string,
      options: { studentId?: string | null; sessionId?: string | null } = {},
    ): Promise<VoiceRealSentencePickResponse> {
      return requestJson<VoiceRealSentencePickResponse>(
        kernel('/voice/real-sentence/pick'),
        createJsonRequest({
          text,
          studentId: options.studentId ?? undefined,
          sessionId: options.sessionId ?? undefined,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    // POST /voice/real-sentence/outcome -> { coachLine }. said-rough / not-said
    // write NO negative record server-side; the warm coachLine handles it.
    submitRealSentenceOutcome(
      id: string,
      outcome: VoiceRealSentenceOutcome,
      options: { studentId?: string | null; note?: string | null } = {},
    ): Promise<VoiceRealSentenceOutcomeResponse> {
      return requestJson<VoiceRealSentenceOutcomeResponse>(
        kernel('/voice/real-sentence/outcome'),
        createJsonRequest({
          id,
          outcome,
          studentId: options.studentId ?? undefined,
          note: options.note ?? undefined,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    /* v1.5 time-lapse mirror (kernel proxies to the DSP milestone endpoints). */

    // POST /voice/attempt/:attemptId/pin -> promote a retained take to a weekly
    // milestone marker. studentId resolves server-side; optional label.
    pinAttempt(
      attemptId: string,
      options: { studentId?: string | null; label?: string | null } = {},
    ): Promise<VoicePinAttemptResponse> {
      return requestJson<VoicePinAttemptResponse>(
        kernel(`/voice/attempt/${encodeURIComponent(attemptId)}/pin`),
        createJsonRequest({
          studentId: options.studentId ?? undefined,
          label: options.label ?? undefined,
        }),
        { successParseMode: 'empty-object' },
      );
    },

    // GET /voice/milestones -> milestones oldest-first. The DSP returns a bare
    // array; the kernel proxy passes it through, so accept either shape.
    async listMilestones(studentId?: string | null): Promise<VoiceMilestone[]> {
      const params = new URLSearchParams();
      if (typeof studentId === 'string' && studentId.trim()) {
        params.set('studentId', studentId.trim());
      }
      const queryString = params.toString();
      const data = await requestJson<VoiceMilestoneListResponse | VoiceMilestone[]>(
        kernel(`/voice/milestones${queryString ? `?${queryString}` : ''}`),
        undefined,
        { successParseMode: 'empty-object', errorFromBody: false },
      );
      if (Array.isArray(data)) {
        return data;
      }
      return Array.isArray(data?.milestones) ? data.milestones : [];
    },

    // Build the kernel URL for a pinned milestone's WAV (proxied to the DSP). The
    // kernel proxy injects auth, so no token is appended here.
    milestoneAudioUrl(milestoneId: string): string {
      return kernel(`/voice/milestone/${encodeURIComponent(milestoneId)}/audio`);
    },

    // DELETE /voice/milestone/:id -> unpin a milestone.
    deleteMilestone(milestoneId: string): Promise<VoiceDeleteMilestoneResponse> {
      return requestJson<VoiceDeleteMilestoneResponse>(
        kernel(`/voice/milestone/${encodeURIComponent(milestoneId)}`),
        { method: 'DELETE' },
        { successParseMode: 'empty-object', errorFromBody: false },
      );
    },
  };
}
