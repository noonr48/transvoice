import {
  createVoiceAppRuntime,
  type VoiceAppRuntime,
} from './app-runtime';
import {
  createVoiceBrowserRuntime,
  type VoiceBrowserRuntime,
} from './browser-runtime';
import type { VoiceCoachShellBootstrap } from './coach-shell-bootstrap';
import { VOICE_COACH_SPEAKING_RATE } from './coach-speech-rate';
// 2026-07-27 field repair — see reportVoiceCoachTurnDispatch in coach-input.ts.
import { reportVoiceCoachTurnDispatch } from './coach-input';
import {
  createVoiceCoachScopeIntentRunner,
  type VoiceCoachSessionScopePatch,
} from './coach-routing-core';
import {
  createVoiceHostActionsController,
  type VoiceHostActionsController,
} from './host-actions-controller';
import { readStoredMicCheck } from './mic-check';
import type { VoiceRuntimeStatusState } from './runtime-status';
import type { VoiceRuntimeShell } from './runtime-shell';
import type { VoiceAudioInputDevice } from './runtime-store';
import type { VoiceCoachMessage, VoiceLiveFrame } from './state';

type VoiceAppRuntimeOptions = Parameters<typeof createVoiceAppRuntime>[0];
type VoiceBrowserRuntimeOptions = Parameters<typeof createVoiceBrowserRuntime>[0];
type VoiceHostActionsControllerOptions = Parameters<typeof createVoiceHostActionsController>[0];

type VoiceHostRuntimeStatusController = {
  getState: () => VoiceRuntimeStatusState;
  applyInputProviderStatusPayload: (payload: unknown) => unknown;
};

export type VoiceHostRuntimeCompositionOptions = {
  store: VoiceAppRuntimeOptions['store'];
  runtimeStatusController: VoiceHostRuntimeStatusController;
  getCurrentMode: VoiceAppRuntimeOptions['getCurrentMode'];
  getCurrentSessionId: VoiceAppRuntimeOptions['getCurrentSessionId'];
  getIsConnected: VoiceAppRuntimeOptions['getIsConnected'];
  resolveSessionMode: VoiceHostActionsControllerOptions['resolveSessionMode'];
  getCoachQuestionInput: VoiceHostActionsControllerOptions['getCoachQuestionInput'];
  render: VoiceHostActionsControllerOptions['render'];
  applyVoiceBackendPayload: VoiceHostActionsControllerOptions['applyVoiceBackendPayload'];
  submitRuntimeCoachQuestionRequest: VoiceHostActionsControllerOptions['submitRuntimeCoachQuestionRequest'];
  prepareConditioningLatentsRequest: VoiceHostActionsControllerOptions['prepareConditioningLatentsRequest'];
  getCoachShell: () => VoiceCoachShellBootstrap | null;
  getRuntimeShell: () => VoiceRuntimeShell | null;
  getLiveTransitionController: VoiceHostActionsControllerOptions['getLiveTransitionController'];
  getPracticeAudioRingBuffer?: VoiceHostActionsControllerOptions['getPracticeAudioRingBuffer'];
  isSpeechSynthesisBusy: VoiceAppRuntimeOptions['isSpeechSynthesisBusy'];
  getVoiceSessionStreamUrl: VoiceAppRuntimeOptions['getVoiceSessionStreamUrl'];
  syncPersistedReferenceAnalysis: VoiceAppRuntimeOptions['syncPersistedReferenceAnalysis'];
  /**
   * Flow lane: POST /voice/session/:sessionId/scope (B-SESS contract) for the
   * tier / eyes-free voice intents. Optional — when absent, a same-origin
   * fetch default is used (correct for the served standalone app); a
   * cross-origin connection profile should inject the api-backed
   * implementation instead.
   */
  postVoiceSessionScope?: (
    sessionId: string,
    scope: VoiceCoachSessionScopePatch,
  ) => Promise<unknown>;
  document?: VoiceBrowserRuntimeOptions['document'];
};

export type VoiceHostRuntimeCompositionFactories = {
  createVoiceHostActionsController?: typeof createVoiceHostActionsController;
  createVoiceAppRuntime?: typeof createVoiceAppRuntime;
  createVoiceBrowserRuntime?: typeof createVoiceBrowserRuntime;
};

export type VoiceHostRuntimeComposition = ReturnType<typeof createVoiceHostRuntimeComposition>;

function getLatestCoachMessageId(
  store: Pick<VoiceHostRuntimeCompositionOptions['store'], 'getUiState'>,
): string | null {
  const coachThread = store.getUiState().coachThread;
  for (let index = coachThread.length - 1; index >= 0; index -= 1) {
    const message = coachThread[index];
    if (message?.role === 'coach' && message.id) {
      return message.id;
    }
  }
  return null;
}

/**
 * Same-origin default for the scope route — the served standalone app talks to
 * its own origin. Failure throws so the intent runner can fall through to a
 * normal coach question instead of dropping the utterance.
 */
async function defaultPostVoiceSessionScope(
  sessionId: string,
  scope: VoiceCoachSessionScopePatch,
): Promise<unknown> {
  const response = await fetch(`/voice/session/${encodeURIComponent(sessionId)}/scope`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(scope),
  });
  if (!response.ok) {
    throw new Error(`Voice session scope update failed (${response.status})`);
  }
  return response.json().catch(() => ({}));
}

/* Noise-adaptive VAD threshold (flow lane).
 *   effective = max(base, min(K_NOISE_FLOOR × noiseFloorRms, ADAPTIVE_MAX))
 * base is the advanced-panel value (or the fixed 0.018 default) — the adaptive
 * lift can only RAISE the gate, never lower it below the tuned base.
 * K_NOISE_FLOOR = 2.5 places the speech gate ~8 dB above the measured room
 * floor (20·log10(2.5) ≈ 7.96 dB), inside the classic 6–10 dB VAD margin: low
 * enough to keep quiet speech through, high enough that steady room noise
 * stops arming takes. ADAPTIVE_MAX = 0.06 raw RMS (≈ −24.4 dBFS) caps the lift
 * below the advanced panel's own 0.08 ceiling — a room whose floor pushes the
 * gate past that is beyond raw-RMS VAD, and the degenerate-take hint
 * (coach-input) takes over instead. The mic-check floor is measured with noise
 * suppression OFF while the conversation lane captures with it ON, so the lift
 * errs slightly high (safer against false arms); quiet rooms keep stock
 * behavior via the max(base, …). */
const VAD_NOISE_FLOOR_MULTIPLIER = 2.5;
const VAD_ADAPTIVE_THRESHOLD_MAX = 0.06;
const MIC_CHECK_NOISE_FLOOR_CACHE_TTL_MS = 10_000;

function dbToRms(db: number): number {
  return Math.pow(10, db / 20);
}

export function createVoiceHostRuntimeComposition(
  options: VoiceHostRuntimeCompositionOptions,
  factories: VoiceHostRuntimeCompositionFactories = {},
) {
  const createVoiceHostActionsControllerImpl = (
    factories.createVoiceHostActionsController || createVoiceHostActionsController
  );
  const createVoiceAppRuntimeImpl = factories.createVoiceAppRuntime || createVoiceAppRuntime;
  const createVoiceBrowserRuntimeImpl = factories.createVoiceBrowserRuntime || createVoiceBrowserRuntime;

  let voiceAppRuntime!: VoiceAppRuntime;

  const voiceHostActionController = createVoiceHostActionsControllerImpl({
    store: options.store,
    getAppRuntime: () => voiceAppRuntime,
    getCurrentMode: options.getCurrentMode,
    resolveSessionMode: options.resolveSessionMode,
    getCurrentSessionId: options.getCurrentSessionId,
    getIsConnected: options.getIsConnected,
    getCoachQuestionInput: options.getCoachQuestionInput,
    render: options.render,
    applyVoiceBackendPayload: options.applyVoiceBackendPayload,
    submitRuntimeCoachQuestionRequest: options.submitRuntimeCoachQuestionRequest,
    prepareConditioningLatentsRequest: options.prepareConditioningLatentsRequest,
    getCoachShell: options.getCoachShell,
    getRuntimeShell: options.getRuntimeShell,
    getLiveTransitionController: options.getLiveTransitionController,
    getPracticeAudioRingBuffer: options.getPracticeAudioRingBuffer,
  });

  // Flow lane — session-scope voice intents ("keep it quiet" / "just
  // listening" / "back to full voice" / "I'm driving" / "I can look again").
  // Decorates submitVoiceCoachQuestion IN PLACE (object identity preserved —
  // orchestration and existing tests hold references to this controller).
  // 2026-07-27 (owner's law): this is the ONLY spoken input the client still
  // acts on itself — device modes the tutor cannot execute, each answering
  // with its own spoken acknowledgment. Everything else goes to the tutor,
  // and the tutor decides. A handled intent POSTs the scope patch and speaks
  // through the coach TTS path (hear-line precedent: synthetic message, not
  // threaded); everything else — including skipIntentRouting submits —
  // delegates unchanged.
  const handleVoiceCoachScopeIntent = createVoiceCoachScopeIntentRunner({
    getSessionId: options.getCurrentSessionId,
    postSessionScope: options.postVoiceSessionScope ?? defaultPostVoiceSessionScope,
    speakAck: (text) => speakVoiceCoachMessage({
      id: `scope-ack-${Date.now()}`,
      role: 'coach',
      channel: 'coach',
      kind: 'scope-ack',
      content: text,
      createdAt: Date.now(),
    }),
    log: (line) => console.info(line),
  });
  const originalSubmitVoiceCoachQuestion = voiceHostActionController.submitVoiceCoachQuestion;
  voiceHostActionController.submitVoiceCoachQuestion = async (
    questionOverride?: string,
    submitOptions: {
      skipIntentRouting?: boolean;
      listeningTurnId?: string;
    } = {},
  ): Promise<void> => {
    if (!submitOptions.skipIntentRouting) {
      const question = (questionOverride ?? options.getCoachQuestionInput()?.value ?? '').trim();
      if (question && await handleVoiceCoachScopeIntent(question)) {
        // 2026-07-27 field repair: a scope intent ("keep it quiet", "I'm
        // driving") consumes the turn and answers with its own line, so no
        // coach reply follows. Named, because from outside it looks exactly
        // like the tutor going silent.
        reportVoiceCoachTurnDispatch('info', 'ok', 'coach-turn-declined-scope-intent');
        if (!questionOverride) {
          const questionInput = options.getCoachQuestionInput();
          if (questionInput) {
            questionInput.value = '';
          }
        }
        return;
      }
    }
    return originalSubmitVoiceCoachQuestion?.(questionOverride, submitOptions);
  };

  const voiceAppRuntimeOptions: VoiceAppRuntimeOptions = {
    store: options.store,
    getCurrentMode: options.getCurrentMode,
    getCurrentSessionId: options.getCurrentSessionId,
    getIsConnected: options.getIsConnected,
    getRuntimeShell: options.getRuntimeShell,
    getRuntimeStatusState: () => options.runtimeStatusController.getState(),
    isSpeechSynthesisBusy: options.isSpeechSynthesisBusy,
    getVoiceSessionStreamUrl: options.getVoiceSessionStreamUrl,
    disarmPracticeSession: (reason) => voiceHostActionController.disarmVoicePracticeSession(reason),
    syncPersistedReferenceAnalysis: options.syncPersistedReferenceAnalysis,
    runtimeResetDependencies: {
      stopListening: (resetTranscript) => {
        options.getCoachShell()?.stopCoachListening(resetTranscript);
      },
      stopSpeech: () => {
        options.getCoachShell()?.stopCoachSpeech();
      },
      clearCoachPollTimer: () => {
        options.getCoachShell()?.clearCoachPollTimer();
      },
      getLatestCoachMessageId: () => getLatestCoachMessageId(options.store),
    },
  };

  voiceAppRuntime = createVoiceAppRuntimeImpl(voiceAppRuntimeOptions);

  const voiceBrowserRuntime = createVoiceBrowserRuntimeImpl({
    store: options.store,
    render: options.render,
    document: options.document,
  });

  function hasVoiceModeActivity(): boolean {
    return voiceAppRuntime.hasModeActivity();
  }

  function getVoiceSummaryText(): string {
    return voiceAppRuntime.getSummaryText();
  }

  function readVoiceInputDevicePreference(): string | null {
    return voiceBrowserRuntime.readVoiceInputDevicePreference();
  }

  function writeVoiceInputDevicePreference(deviceId: string | null): void {
    voiceBrowserRuntime.writeVoiceInputDevicePreference(deviceId);
  }

  function buildVoiceAudioInputDevices(devices: MediaDeviceInfo[]): VoiceAudioInputDevice[] {
    return voiceBrowserRuntime.buildVoiceAudioInputDevices(devices);
  }

  function getSelectedVoiceAudioInput(): VoiceAudioInputDevice | null {
    return voiceBrowserRuntime.getSelectedVoiceAudioInput();
  }

  async function refreshVoiceAudioInputDevices(silent = false): Promise<VoiceAudioInputDevice[]> {
    return voiceBrowserRuntime.refreshVoiceAudioInputDevices(silent);
  }

  function compressVoiceTimeline(
    timeline: VoiceLiveFrame[] | null | undefined,
    maxPoints = 120,
  ): VoiceLiveFrame[] {
    return voiceBrowserRuntime.compressVoiceTimeline(timeline, maxPoints);
  }

  function ensureVoiceCueSheetCard(): void {
    voiceBrowserRuntime.ensureVoiceCueSheetCard();
  }

  function stopVoiceCoachSpeech(): void {
    options.getCoachShell()?.stopCoachSpeech();
  }

  function stopVoiceCoachListening(resetTranscript = false): void {
    options.getCoachShell()?.stopCoachListening(resetTranscript);
  }

  async function startVoiceCoachListening(): Promise<boolean> {
    return options.getCoachShell()?.startCoachListening() ?? false;
  }

  function toggleVoiceCoachListening(): void {
    options.getCoachShell()?.toggleCoachListening();
  }

  function toggleVoiceCoachContinuousMode(): void {
    void options.getCoachShell()?.toggleContinuousMode();
  }

  function toggleVoiceCoachSpeechProvider(): void {
    void options.getCoachShell()?.toggleSpeechProvider();
  }

  function toggleVoiceCoachInputProvider(): void {
    void options.getCoachShell()?.toggleInputProvider();
  }

  function clearVoiceCoachPollTimer(): void {
    options.getCoachShell()?.clearCoachPollTimer();
  }

  // Cached stored-mic-check floor (the threshold getter runs on a 100 ms VAD
  // monitor tick — do not hit localStorage/JSON.parse every tick).
  let storedNoiseFloorCache: { deviceId: string; noiseFloorDb: number | null; readAt: number } | null = null;

  function readStoredNoiseFloorDb(): number | null {
    const deviceId = voiceBrowserRuntime.getSelectedVoiceAudioInput()?.deviceId
      || voiceBrowserRuntime.readVoiceInputDevicePreference()
      || 'default';
    const now = Date.now();
    if (
      storedNoiseFloorCache
      && storedNoiseFloorCache.deviceId === deviceId
      && now - storedNoiseFloorCache.readAt < MIC_CHECK_NOISE_FLOOR_CACHE_TTL_MS
    ) {
      return storedNoiseFloorCache.noiseFloorDb;
    }
    let noiseFloorDb: number | null = null;
    try {
      const storage = typeof window !== 'undefined' ? window.localStorage : null;
      const stored = readStoredMicCheck(storage, deviceId);
      noiseFloorDb = typeof stored?.noiseFloorDb === 'number' && Number.isFinite(stored.noiseFloorDb)
        ? stored.noiseFloorDb
        : null;
    } catch {
      noiseFloorDb = null;
    }
    storedNoiseFloorCache = { deviceId, noiseFloorDb, readAt: now };
    return noiseFloorDb;
  }

  function getVoiceCoachInputSilenceThreshold(): number {
    const uiState = options.store.getUiState();
    const threshold = uiState.advancedPanel?.vadRmsThreshold;
    const base = typeof threshold === 'number' && Number.isFinite(threshold) ? threshold : 0.018;
    // Noise floor: prefer the live runtime estimate (mic-check writes it and
    // per-attempt analysis refreshes it), then the persisted per-device
    // mic-check (tvMicCheck:<deviceId> → noiseFloorDb, dB → raw RMS).
    const liveNoiseFloorDb = uiState.voiceInputRuntime?.lastNoiseFloorDb;
    const noiseFloorDb = typeof liveNoiseFloorDb === 'number' && Number.isFinite(liveNoiseFloorDb)
      ? liveNoiseFloorDb
      : readStoredNoiseFloorDb();
    if (noiseFloorDb == null) {
      return base;
    }
    const adaptive = VAD_NOISE_FLOOR_MULTIPLIER * dbToRms(noiseFloorDb);
    return Math.max(base, Math.min(adaptive, VAD_ADAPTIVE_THRESHOLD_MAX));
  }

  function applyVoiceInputProviderStatusPayload(payload: unknown): void {
    options.runtimeStatusController.applyInputProviderStatusPayload(payload);
  }

  function speakVoiceCoachMessage(message: VoiceCoachMessage, rate = VOICE_COACH_SPEAKING_RATE): boolean {
    const coachShell = options.getCoachShell();
    if (!coachShell) {
      return false;
    }
    return coachShell.speakCoachMessage(message, rate);
  }

  return {
    voiceHostActionController,
    voiceAppRuntime,
    voiceAppRuntimeOptions,
    voiceBrowserRuntime,
    hasVoiceModeActivity,
    getVoiceSummaryText,
    readVoiceInputDevicePreference,
    writeVoiceInputDevicePreference,
    buildVoiceAudioInputDevices,
    getSelectedVoiceAudioInput,
    refreshVoiceAudioInputDevices,
    compressVoiceTimeline,
    ensureVoiceCueSheetCard,
    stopVoiceCoachSpeech,
    stopVoiceCoachListening,
    startVoiceCoachListening,
    toggleVoiceCoachListening,
    toggleVoiceCoachContinuousMode,
    toggleVoiceCoachSpeechProvider,
    toggleVoiceCoachInputProvider,
    clearVoiceCoachPollTimer,
    getVoiceCoachInputSilenceThreshold,
    applyVoiceInputProviderStatusPayload,
    speakVoiceCoachMessage,
  };
}
