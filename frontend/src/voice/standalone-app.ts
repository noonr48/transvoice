import './voice-tutor-redesign.css';
import {
  COACH_TURN_LOST_THREAD_LINE,
  createVoiceApi,
  VOICE_COACH_TURN_SETTLED_EVENT,
  type VoiceCoachTurnSettledDetail,
} from './api';
import { createVoiceDomBindings } from './dom-bindings';
import { createVoiceSurfaceController } from './surface-mode';
import { setupPracticeSurface, type PracticeDrill } from './practice-surface';
import {
  createCoachGraph,
  playTutorMetricTrackHeader,
} from './coach-graph';
import {
  VOICE_TUTOR_METRIC_TRACK_EVENT,
  type VoiceTutorMetricTrackDetail,
} from './coach-speech';
import { getVoiceMetricsFromFrame } from './render/graph';
import {
  bindVoiceFrontDoor,
  updateVoiceFrontDoorVisibility,
  renderVoiceFrontDoorReportCard,
  startVoiceMicReferenceRecording,
  VOICE_MIC_UNAVAILABLE_LINE,
  type VoiceMicRecorderHandle,
} from './front-door';
import type { VoiceReferenceAnalyzeResponse } from './api';
import {
  setupVoiceOnlyCoachSurface,
  VOICE_COACH_PLAYBACK_STATE_EVENT,
  type VoiceOnlyCoachPreset,
  type VoiceOnlyCoachSurface,
} from './coach-surface';
import {
  startVoiceOnlyCoachLifecycle,
  stopVoiceOnlyCoachLifecycle,
} from './coach-session-lifecycle';
import { deriveSessionStage } from './session-reentry';
import { setupVoiceSessionScope } from './session-scope';
import { createVoiceHostAssembly } from './host-assembly';
import { createVoiceHostAssemblyConfig } from './host-assembly-config';
import { createVoiceRuntimeStatusController } from './runtime-status';
import { createVoiceRuntimeStore } from './runtime-store';
import {
  resolveVoiceTutorLaunchConfig,
  type VoiceTutorLaunchConfig,
} from './standalone-launcher';
import {
  checkVoiceTutorStandaloneHealth,
  type VoiceTutorStandaloneHealthSummary,
} from './standalone-health';
import { resolveVoiceTutorStandaloneReadinessStatus } from './standalone-readiness';
import {
  resolveVoiceTutorStandaloneSessionId,
  type VoiceTutorStandaloneSessionStorage,
} from './standalone-session';
import { registerVoiceTutorStandaloneServiceWorker } from './standalone-pwa';
import {
  buildVoiceTutorStandaloneShell,
  parseVoiceTutorSourceHtml,
} from './standalone-dom';
import { getVoiceTutorStandaloneTemplateHtml } from './standalone-template';
import { shouldAutoBootstrapVoiceTutorStandalone } from './standalone-bootstrap-guard';
import { MIC_CHECK_NOISE_SHIFT_LINE, setupVoiceMicCheck } from './mic-check';
import { readVoiceInputDevicePreference } from './browser-runtime';
import { createVoiceLessonController } from './lesson/controller';
import { createVoiceSentenceSlot } from './lesson/sentence-slot';
import { createVoiceMirror } from './lesson/mirror';
import { getLatestVoiceCoachThreadMessage, normalizeDeepTutorVoiceState } from './state';
import { createVoiceCoachThreadLineChannel } from './coach-thread-line';
// Legacy runtime support modules remain mounted behind the voice-only surface.
import { setupVoiceSoundSpelling } from './sound-spelling';
import { setupVoiceLineOverflow } from './line-overflow';
import { bindBackendPayloadTee, setupVoiceCoachHonesty } from './coach-honesty';
import { getCurrentVoiceCueSheet, getVoiceActiveLine } from './view-model';

const VOICE_TRAINER_TOKEN = typeof import.meta.env.VITE_VOICE_TRAINER_TOKEN === 'string'
  && import.meta.env.VITE_VOICE_TRAINER_TOKEN.trim()
  ? import.meta.env.VITE_VOICE_TRAINER_TOKEN.trim()
  : null;

const VOICE_INPUT_LIVE_BEARER_TOKEN = typeof import.meta.env.VITE_VOICE_INPUT_LIVE_BEARER_TOKEN === 'string'
  && import.meta.env.VITE_VOICE_INPUT_LIVE_BEARER_TOKEN.trim()
  ? import.meta.env.VITE_VOICE_INPUT_LIVE_BEARER_TOKEN.trim()
  : null;

/**
 * Deadline for the session-stop request. Comfortably longer than a healthy stop,
 * short enough that a wedged server surfaces as a reported failure the learner
 * can act on rather than a lesson that appears to be stopping forever.
 */
const COACH_STOP_TIMEOUT_MS = 6000;

/**
 * Deadline for the self-practice drill list. Shorter than the stop deadline: this
 * is a read the learner is waiting on with a blank screen in front of them, and
 * failing fast into a retryable message beats a long stare.
 */
const PRACTICE_FETCH_TIMEOUT_MS = 4000;

type VoiceTutorTelemetryWindow = Window & {
  __tvTelemetry?: {
    mark: (phase: string) => void;
    event: (
      level: 'error' | 'warn' | 'info',
      seam: string,
      failureClass: string,
      code: string,
      data?: Record<string, unknown>,
    ) => void;
  };
};

function markVoiceTutorPhase(phase: string): void {
  try {
    (window as VoiceTutorTelemetryWindow).__tvTelemetry?.mark(phase);
  } catch {
    // The app remains usable if its advisory telemetry bridge is unavailable.
  }
}

function reportVoiceTutorFailure(
  seam: string,
  failureClass: string,
  code: string,
  data: Record<string, unknown> = {},
): void {
  try {
    (window as VoiceTutorTelemetryWindow).__tvTelemetry?.event('error', seam, failureClass, code, data);
  } catch {
    // The visible app error remains the primary failure path.
  }
}

function getStandaloneStorage(): VoiceTutorStandaloneSessionStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

async function resolveContinuingCoachSession(
  config: VoiceTutorLaunchConfig,
  requestedSessionId: string,
): Promise<string> {
  try {
    const response = await fetch(`${config.backendUrl.replace(/\/$/, '')}/session/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: requestedSessionId,
        agentId: 'voice',
        activate: false,
      }),
    });
    if (!response.ok) return requestedSessionId;
    const payload = await response.json() as { sessionId?: unknown };
    const resolved = typeof payload.sessionId === 'string' ? payload.sessionId.trim().slice(0, 160) : '';
    return resolved || requestedSessionId;
  } catch {
    return requestedSessionId;
  }
}

function setStandaloneStatus(text: string): void {
  const statusText = document.getElementById('session-status-text');
  if (statusText) {
    statusText.textContent = text;
  }
}

function appendStandaloneLog(type: string, content: string): void {
  const log = document.getElementById('voice-standalone-log');
  if (!log) {
    return;
  }
  const line = document.createElement('div');
  line.className = `voice-standalone-log-line voice-standalone-log-line-${type}`;
  line.textContent = `[${type}] ${content}`;
  log.appendChild(line);
  while (log.children.length > 12) {
    log.firstElementChild?.remove();
  }
}

function renderStandaloneHealthDiagnostics(summary: VoiceTutorStandaloneHealthSummary): void {
  const panel = document.getElementById('voice-standalone-health-panel');
  const summaryEl = document.getElementById('voice-standalone-health-summary');
  const layersEl = document.getElementById('voice-standalone-health-layers');
  if (panel) {
    panel.dataset.status = summary.overall;
  }
  if (summaryEl) {
    summaryEl.textContent = `Overall ${summary.overall.toUpperCase()} · ${new Date(summary.checkedAt).toLocaleTimeString()}`;
  }
  if (!layersEl) {
    return;
  }
  layersEl.replaceChildren(...summary.layers.map((layer) => {
    const chip = document.createElement('span');
    chip.className = `voice-standalone-health-layer voice-standalone-health-layer-${layer.status}`;
    chip.title = `${layer.label}: ${layer.detail}${layer.endpoint ? ` (${layer.endpoint})` : ''}`;
    const label = document.createElement('strong');
    label.textContent = layer.label;
    const detail = document.createElement('span');
    detail.className = 'voice-standalone-health-layer-detail';
    detail.textContent = layer.status.toUpperCase();
    chip.append(label, detail);
    return chip;
  }));
}

function ensureStandaloneHealthDiagnosticsPoller(config: VoiceTutorLaunchConfig): number {
  // Returns the interval id so the caller can clear it on teardown (beforeunload);
  // leaving it running leaks a 30s timer + an in-flight health fetch per page load.
  return window.setInterval(() => {
    void checkVoiceTutorStandaloneHealth(config, {
      windowRef: window,
      navigatorRef: navigator,
    }).then(renderStandaloneHealthDiagnostics)
      .catch((error) => appendStandaloneLog(
        'warning',
        `Runtime diagnostics refresh failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
  }, 30_000);
}

async function runStandaloneDeepReadiness(config: VoiceTutorLaunchConfig): Promise<void> {
  const button = document.getElementById('voice-standalone-deep-check') as HTMLButtonElement | null;
  if (button) {
    button.disabled = true;
    button.textContent = 'Checking…';
  }
  try {
    const summary = await checkVoiceTutorStandaloneHealth(config, {
      forceReadiness: true,
      includeReadiness: true,
      windowRef: window,
      navigatorRef: navigator,
    });
    renderStandaloneHealthDiagnostics(summary);
    appendStandaloneLog('system', `Active readiness ${summary.overall}`);
  } catch (error) {
    appendStandaloneLog(
      'warning',
      `Active readiness failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = 'Run Deep Check';
    }
  }
}

function bindStandaloneDeepReadinessButton(config: VoiceTutorLaunchConfig): void {
  document.getElementById('voice-standalone-deep-check')?.addEventListener('click', () => {
    void runStandaloneDeepReadiness(config);
  });
}

function loadVoiceSourceDocument(): Document {
  return parseVoiceTutorSourceHtml(getVoiceTutorStandaloneTemplateHtml());
}

function mountVoiceTutorShell(config: VoiceTutorLaunchConfig, sourceDocument: Document): void {
  const app = document.getElementById('app');
  if (!app) {
    throw new Error('Missing standalone app root: #app');
  }
  app.className = 'voice-tutor-standalone-app';
  app.replaceChildren(buildVoiceTutorStandaloneShell({
    sourceDocument,
    targetDocument: document,
    backendUrl: config.backendUrl,
  }));
}

async function bootstrapStandaloneVoiceTutor(): Promise<void> {
  markVoiceTutorPhase('bundle-start');
  const config = resolveVoiceTutorLaunchConfig({
    locationRef: window.location,
    storage: getStandaloneStorage(),
  });
  const sourceDocument = loadVoiceSourceDocument();
  mountVoiceTutorShell(config, sourceDocument);
  setStandaloneStatus('STARTING');
  appendStandaloneLog('system', `Connected to ${config.backendUrl}`);
  void registerVoiceTutorStandaloneServiceWorker({
    onStatus: (message, kind = 'info') => appendStandaloneLog(kind === 'warning' ? 'warning' : 'system', message),
  });

  const session = resolveVoiceTutorStandaloneSessionId({
    locationRef: window.location,
    storage: getStandaloneStorage(),
    storageScope: config.backendUrl,
  });
  let sessionId = await resolveContinuingCoachSession(config, session.sessionId);
  if (sessionId !== session.sessionId) {
    try { getStandaloneStorage()?.setItem(session.storageKey, sessionId); } catch { /* storage is advisory */ }
  }
  const sessionLease = Object.freeze({}); // Immutable for this app lifetime.
  let coachLiveInputLeaseId: string | null = null;
  let coachPracticeRelease: Promise<void> = Promise.resolve();
  appendStandaloneLog('system', `Session ${sessionId} (${session.source})`);
  // Tiny shell bridge (B-SESS pause beacon): the shell's pagehide hook needs the
  // live session id + backend origin to sendBeacon the paused marker. Read-only
  // exposure; the id is fixed for this app lifetime.
  try {
    (window as Window & { __tvSession?: { id: string; backendUrl: string } }).__tvSession = {
      id: sessionId,
      backendUrl: config.backendUrl,
    };
  } catch {
    // Exposure is best-effort; the app never depends on it.
  }
  const voiceApi = createVoiceApi({
    kernelUrl: config.backendUrl,
    voiceTrainerUrl: config.voiceTrainerUrl,
    voiceTrainerToken: VOICE_TRAINER_TOKEN,
  });
  const store = createVoiceRuntimeStore();
  const runtimeStatusController = createVoiceRuntimeStatusController();
  const voiceHostAssembly = createVoiceHostAssembly();
  const domBindings = createVoiceDomBindings({ document });

  // Wave B lesson surface. Self-contained controller: owns its DOM lookups +
  // listeners (dispose() tears down). Drives the focus banner, practice card
  // strip + karaoke, compass target region, replay overlay, quick intents, and
  // keyboard — all deterministic (NO model calls).
  const clickById = (id: string): void => {
    const el = document.getElementById(id) as HTMLButtonElement | null;
    el?.click();
  };
  // The speech controller's own "is audio coming out right now" probe, read off
  // the bridge the transport attaches at bootstrap (coach-transport-bootstrap).
  // Deferred lookup: the bridge does not exist until assemble() runs, and this
  // is only ever called at runtime. Absent bridge -> false, never a throw.
  const isCoachSpeechPlaying = (): boolean => (
    (window as Window & { __tvCoach?: { isSpeaking?: () => boolean } })
      .__tvCoach?.isSpeaking?.() === true
  );
  const isCoachAudioPlaying = (): boolean => (
    (window as Window & { __tvCoach?: { isPlaying?: () => boolean } })
      .__tvCoach?.isPlaying?.() === true
  );
  // v1.5: plain coach lines in the thread (the same render path the greeting +
  // coach messages use). Shared by the debrief follow-up and the continuity
  // greeting so a returning learner is always greeted in one voice.
  //
  // 2026-07-26: one channel now owns BOTH surfaces — written and, on a
  // voice-first surface, SAID. Its whole job is that a line which is both is
  // ONE message with ONE id, so nothing can say it twice (coach-thread-line.ts).
  const coachThreadLineChannel = createVoiceCoachThreadLineChannel({
    appendMessage: (message) => {
      store.updateUiState((current) => ({
        ...current,
        coachThread: [...current.coachThread, message],
      }));
      voiceHostAssembly.render();
    },
    // BOTH speaking probes, because they answer different questions and the
    // channel is now the single place the never-interrupt decision is made.
    // `isCoachSpeakingNow` reads the interaction owner + the thread's
    // data-speaking flag; `__tvCoach.isSpeaking()` is the speech controller's
    // own hasActivePlayback(), which is what is true while audio is actually
    // coming out. Missing the second one would leave the common case —
    // "the tutor is mid-sentence" — unguarded.
    isCoachSpeaking: () => isCoachSpeakingNow() || isCoachSpeechPlaying(),
    // The existing coach TTS entry — the same one replies, greetings, hear-line
    // and the eyes-free card lines go through.
    speakMessage: (message) => voiceHostAssembly.runtime.speakCoachMessage(message),
    // The same store field speakCoachMessage itself writes on success. Setting
    // it on a deliberate withhold is what stops the render handoff from picking
    // the line up and speaking it over the tutor a microtask later.
    markSpoken: (message) => store.patchState({ voiceLastSpokenCoachMessageId: message.id }),
  });
  const appendCoachThreadLine = (content: string, kind = 'coach-line'): void => {
    coachThreadLineChannel.append(content, kind);
  };

  // v1.5 one-real-sentence slot — a slim card near the focus banner. NOT a
  // takeover surface (so it stays out of the lesson keyboard guard list).
  const sentenceSlot = createVoiceSentenceSlot({
    doc: document,
    getRealSentence: () => voiceApi.getRealSentence(null, sessionId),
    pickRealSentence: (text) => voiceApi.pickRealSentence(text, { sessionId }),
    onPicked: () => {
      // The backend sets the picked real_sentence card active for the session;
      // pull it so the existing card flow renders it immediately.
      void lessonController.refreshActiveCard();
    },
    addLog: (kind, message) => appendStandaloneLog(kind, message),
  });

  // v1.5 time-lapse mirror — a takeover panel reached from the "Your arc" link.
  const mirror = createVoiceMirror({
    doc: document,
    listMilestones: () => voiceApi.listMilestones(),
    milestoneAudioUrl: (id) => voiceApi.milestoneAudioUrl(id),
    deleteMilestone: (id) => voiceApi.deleteMilestone(id),
    addLog: (kind, message) => appendStandaloneLog(kind, message),
  });

  // Surfacing wave: coach honesty notices. Receives every RAW backend payload
  // (fallbackReply flag) via the same onBackendPayload tee the lesson uses; the
  // selected-voice unavailable notice arrives from coach-speech via its module listener.
  const coachHonesty = setupVoiceCoachHonesty({
    doc: document,
    addLog: (kind, message) => appendStandaloneLog(kind, message),
  });
  // Live coach replies apply through the request-controller / controller-graph
  // paths, which tee the raw payload as a document event (the slice contract
  // drops fallbackReply) — bind that tee to the honesty surface.
  const disposeHonestyTee = bindBackendPayloadTee((payload) => coachHonesty.applyCoachPayload(payload));

  // Surfacing wave: sound-spelling cue-layer toggle (persists tvSoundSpelling).
  const soundSpelling = setupVoiceSoundSpelling({
    doc: document,
    addLog: (kind, message) => appendStandaloneLog(kind, message),
  });

  // Declutter: quiet "⋯ More" disclosure for the folded line actions.
  const lineOverflow = setupVoiceLineOverflow({
    doc: document,
    addLog: (kind, message) => appendStandaloneLog(kind, message),
  });

  // Abandon-trigger fix 6: ambient session-scope (tier) indicator in the coach
  // rail header — a control, never a startup prompt. Adopts the backend's
  // remembered sessionScope from session payloads (applySessionPayload below);
  // taps POST the wire tier and a failed sync stays a quiet local no-op.
  const sessionScope = setupVoiceSessionScope({
    doc: document,
    updateScope: (wireTier) => voiceApi.postVoiceSessionScope(sessionId, { tier: wireTier }),
    addLog: (kind, message) => appendStandaloneLog(kind, message),
  });
  let coachSurface: VoiceOnlyCoachSurface | null = null;

  // Shared "is the coach audibly speaking / producing" probe — the hear-line
  // closure, hoisted so the lesson controller's eyes-free path can reuse it
  // verbatim. Deferred lookups: safe to build before assemble() because it is
  // only ever invoked at runtime.
  const isCoachSpeakingNow = (): boolean => {
    const owner = voiceHostAssembly.getAppRuntime().getVoiceInteractionOwner();
    if (owner === 'coach-speaking' || owner === 'coach-processing') return true;
    return document.getElementById('voice-coach-thread')?.getAttribute('data-speaking') === 'true';
  };

  const getCurrentPracticeLineText = (): string | null => {
    const state = store.getState();
    const ui = state.voiceUiState;
    const lessonBoard = normalizeDeepTutorVoiceState(ui.deeptutorVoiceState).lessonBoard;
    return lessonBoard?.prompt
      || getVoiceActiveLine(ui)?.displayText
      || getCurrentVoiceCueSheet({ voiceUiState: ui, voiceDrillState: state.voiceDrillState })?.phrase
      || null;
  };

  // 2026-07-28: the spoken session opening (owner: "a beginner presses Start,
  // hears nothing, must guess"). ONE deterministic orientation per session,
  // through the same coach-TTS entry as eyes-free lines — not tracked as a
  // coach reply, no LLM welcome (the no-LLM-welcome law stands). Only fires
  // when a line exists to name; the "whenever you're ready" tail doubles as
  // the readiness check.
  let sessionOpeningSpokenFor = '';
  const maybeSpeakSessionOpening = (): void => {
    if (!sessionId || sessionOpeningSpokenFor === sessionId) return;
    const line = getCurrentPracticeLineText();
    if (!line) return;
    sessionOpeningSpokenFor = sessionId;
    voiceHostAssembly.runtime.speakCoachMessage({
      id: `session-opening-${Date.now()}`,
      role: 'coach' as const,
      channel: 'coach' as const,
      kind: 'session-opening',
      content: `Here's how this works: I give you a sentence, you say it back, and I help you with the sound. Your sentence is: "${line}" — say it back whenever you're ready.`,
      createdAt: Date.now(),
      emphasis: null,
    });
  };

  const lessonController = createVoiceLessonController({
    doc: document,
    getUiState: () => store.getUiState(),
    getSessionId: () => sessionId,
    fetchActiveCard: (id) => voiceApi.fetchActiveCard(id),
    advanceCard: (id, opts) => voiceApi.advanceCard(id, opts),
    // Flow-lane eyes-free seams: spoken card lines ride the SAME TTS path as
    // hear-line; the controller stays dormant-defensive without them.
    // The optional second argument is the word-emphasis channel: when the
    // utterance is a practice-line demo the card's stressed word rides on the
    // synthetic message, and coach-speech forwards it to the gateway. Coach
    // free-speech replies never take this path, so they stay unshaped.
    speakLine: (text, emphasis) => voiceHostAssembly.runtime.speakCoachMessage({
      id: `eyes-free-${Date.now()}`,
      role: 'coach' as const,
      channel: 'coach' as const,
      kind: 'eyes-free',
      content: text,
      createdAt: Date.now(),
      emphasis: emphasis ?? null,
    }),
    isCoachSpeaking: isCoachSpeakingNow,
    getInteractionOwner: () => voiceHostAssembly.getAppRuntime().getVoiceInteractionOwner(),
    attemptAudioUrl: (attemptId) => voiceApi.fetchAttemptAudioUrl(attemptId),
    submitCoachQuestion: (question) => {
      // Coach mode is SPOKEN (owner's law, 2026-07-27): there is no typed
      // input or send button to stage this in. Preset questions go straight
      // through the action controller — the same lane as the tap pills.
      void voiceHostAssembly.actions.submitVoiceCoachQuestion(question);
    },
    onTakeStartRetry: () => clickById('voice-start-session'),
    onNextCard: () => clickById('voice-line-next'),
    getLatestCoachText: () => (
      getLatestVoiceCoachThreadMessage(store.getUiState().coachThread, 'coach')?.content || null
    ),
    getPracticeLineText: getCurrentPracticeLineText,
    // v1.5 pin affordance: pin a take as this week's marker.
    pinAttempt: (attemptId) => voiceApi.pinAttempt(attemptId),
    // v1.5: refresh today's sentence after a take (a real_sentence take may have
    // flipped its status to 'ready' server-side).
    onTakeFinalized: () => { void sentenceSlot.refresh(); },
    addLog: (kind, message) => appendStandaloneLog(kind, message),
  });

  voiceHostAssembly.assemble(createVoiceHostAssemblyConfig({
    store,
    runtimeStatusController,
    onBackendPayload: (payload) => {
      lessonController.applyCoachPayload(payload);
      // Surfacing wave: the honesty surface reads the raw fallbackReply flag the
      // shared slice contract drops (defensive — absent flag is a no-op).
      coachHonesty.applyCoachPayload(payload);
      // Fix 6: sessionScope rides every session payload (absent field is a no-op).
      sessionScope.applySessionPayload(payload);
    },
    voiceApi,
    kernelUrl: config.backendUrl,
    kernelWsUrl: config.backendWsUrl,
    voiceTrainerUrl: config.voiceTrainerUrl,
    voiceTrainerToken: VOICE_TRAINER_TOKEN,
    voiceInputLiveBearerToken: VOICE_INPUT_LIVE_BEARER_TOKEN,
    getVoiceInputLiveLeaseId: () => coachLiveInputLeaseId,
    // This surface never exposes the legacy armed-practice transport. Release
    // any restored owner once during boot, then make every visible Start await
    // that same barrier instead of letting legacy teardown cancel the new mic
    // owner it was invoked from.
    releasePracticeForCoachListening: () => coachPracticeRelease,
    getCurrentMode: () => 'voice',
    getCurrentSessionId: () => sessionId,
    getIsConnected: () => true,
    getSessionLease: () => sessionLease,
    resolveSessionMode: () => 'voice',
    addTerminalLine: appendStandaloneLog,
    // Non-failure backend acknowledgments render as ordinary coach lines, in the
    // same thread and the same voice as the greeting and debrief replies.
    appendCoachLine: (text: string) => appendCoachThreadLine(text),
    // ...and on this voice-first surface, say it out loud too. Same TTS entry as
    // every other coach utterance; the append above is the fallback when the
    // speech path is unavailable or the tutor is already talking.
    speakCoachLine: (text: string) => coachThreadLineChannel.speak(text),
    getVoiceCoachQuestionInput: () => domBindings.root.voiceCoachQuestionInput,
    getVoiceTargetPresetSelect: () => domBindings.root.voiceTargetPresetSelect,
    getVoiceReferencePlayer: () => domBindings.root.voiceReferencePlayerEl,
    getVoiceConditioningPromptTextInput: () => domBindings.root.voiceConditioningPromptTextInput,
    getVoiceConditioningPromptFileInput: () => domBindings.root.voiceConditioningPromptFileInput,
    getVoiceConditioningReferenceFileInput: () => domBindings.root.voiceConditioningReferenceFileInput,
    getDomBindings: () => domBindings,
    document,
    window,
  }));

  voiceHostAssembly.lifecycle.registerListeners({
    refs: domBindings.bootstrapRefs,
    mediaDevices: navigator.mediaDevices,
  });

  // A spoken lesson does not fill real-world pauses with chatter. Turn events
  // remain useful for honest failure status, but no think-gap utterance is made.
  const onCoachTurnSettled = (event: Event): void => {
    const detail = (event as CustomEvent<VoiceCoachTurnSettledDetail>).detail;
    if (detail?.lost) {
      appendCoachThreadLine(COACH_TURN_LOST_THREAD_LINE, 'lost-turn');
    }
  };
  document.addEventListener(VOICE_COACH_TURN_SETTLED_EVENT, onCoachTurnSettled);

  // Drive the lesson surface off the actual shared render seam: every internal
  // render also syncs the lesson zones and the one-screen Coach activity. A
  // wrapper around voiceHostAssembly.render misses controller-held references
  // to the bridge and previously left Ready/Hearing/Thinking visibly stale.
  // Fix 5: assigned after setupVoiceMicCheck below; the render loop feeds it the
  // live noise floor so a drifted room can quietly re-offer the check (once).
  let micCheckRef: ReturnType<typeof setupVoiceMicCheck> | null = null;

  /** Whose measured voice the always-visible graph is currently drawing. */
  let graphTurn: 'tutor' | 'learner' | null = null;

  // THE CALL-AND-RESPONSE GRAPH rides the same seam. The learner side consumes
  // live analyser frames below. The tutor side consumes the bounded metric track
  // attached to the exact synthesized speech response and starts only on the
  // transport's first-audio event — never from an uploaded reference proxy.
  const coachGraph = createCoachGraph({ doc: document });
  // The graph is the Coach canvas from startup. Missing tracks park/clear dots;
  // they never replace the primary surface with a practice-copy placeholder.
  coachGraph?.show();
  const onTutorMetricTrack = (event: Event): void => {
    if (!coachGraph) return;
    const detail = (event as CustomEvent<VoiceTutorMetricTrackDetail>).detail;
    graphTurn = null;
    if (!playTutorMetricTrackHeader(
      coachGraph,
      detail?.encodedTrack ?? null,
      detail?.invalidHeaderLength,
    )) {
      return;
    }
    graphTurn = 'tutor';
  };
  document.addEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTutorMetricTrack);
  const onCoachPlaybackState = (event: Event): void => {
    const playing = (event as CustomEvent<{ playing?: unknown }>).detail?.playing === true;
    if (playing || graphTurn !== 'tutor') return;
    coachGraph?.parkTrack('tutor');
    graphTurn = null;
  };
  document.addEventListener(VOICE_COACH_PLAYBACK_STATE_EVENT, onCoachPlaybackState);

  const disposeRenderObserver = voiceHostAssembly.observeRender(() => {
    lessonController.sync();
    coachSurface?.sync();
    micCheckRef?.observeLiveNoiseFloor(store.getUiState().voiceInputRuntime?.lastNoiseFloorDb ?? null);

    // Alternate strictly with actual playback/listening state. The graph shell
    // stays visible; only a valid exact tutor track or live learner measurement
    // activates a moving dot. Missing metadata invents no comparison.
    if (coachGraph) {
      const tutorSpeaking = isCoachAudioPlaying();
      const hearing = document
        .getElementById('tv-coach-surface')?.dataset.activity === 'hearing';
      if (tutorSpeaking) {
        if (graphTurn === 'tutor') {
          coachGraph.show();
        } else {
          graphTurn = null;
          coachGraph.clearTrack('tutor');
        }
      } else if (hearing && graphTurn !== 'learner') {
        graphTurn = 'learner';
        coachGraph.beginTurn('learner');
        coachGraph.show();
      } else if (!hearing && graphTurn !== null) {
        graphTurn = null;
      }
    }

    // Her dot, from the live analyser frame the transport already publishes.
    // Only while she is the one speaking — the graph alternates, and pushing a
    // point during the tutor's turn would draw her line over his mid-demo.
    if (coachGraph && graphTurn === 'learner') {
      // The live frame lives on the RUNTIME store, not the UI state — the UI
      // state carries derived view fields, the analyser frame is transport-level.
      const frame = store.getState().voiceLiveFrame ?? null;
      const metrics = getVoiceMetricsFromFrame(frame);
      if (metrics
        && typeof metrics.meanPitchHz === 'number'
        && typeof metrics.resonanceMean === 'number') {
        coachGraph.push('learner', {
          pitchHz: metrics.meanPitchHz,
          resonance: metrics.resonanceMean,
        });
      }
    }
  });
  lessonController.start();
  // v1.5 surfaces: the one-real-sentence slot + the time-lapse mirror. Both own
  // their listeners; both are disposed on unload alongside the lesson controller.
  sentenceSlot.start();
  mirror.start();
  // Surfacing wave starts.
  coachHonesty.start();
  soundSpelling.start();
  lineOverflow.start();
  // Abandon-trigger fix 6: reveal + drive the ambient tier indicator.
  sessionScope.start();

  // Started below (after the first health check); cleared here on unload so the
  // 30s diagnostics poller does not outlive the page.
  let healthDiagnosticsPollerId: number | null = null;
  window.addEventListener('beforeunload', () => {
    document.removeEventListener(VOICE_COACH_TURN_SETTLED_EVENT, onCoachTurnSettled);
    document.removeEventListener(VOICE_TUTOR_METRIC_TRACK_EVENT, onTutorMetricTrack);
    document.removeEventListener(VOICE_COACH_PLAYBACK_STATE_EVENT, onCoachPlaybackState);
    disposeRenderObserver();
    sessionScope.dispose();
    lessonController.dispose();
    sentenceSlot.dispose();
    mirror.dispose();
    coachHonesty.dispose();
    disposeHonestyTee();
    soundSpelling.dispose();
    lineOverflow.dispose();
    if (healthDiagnosticsPollerId !== null) {
      window.clearInterval(healthDiagnosticsPollerId);
      healthDiagnosticsPollerId = null;
    }
  });

  voiceHostAssembly.runtime.hydrateStoredInputDevicePreference();
  voiceHostAssembly.render();
  voiceHostAssembly.workflow.ensureHealthPoller();
  // Phone resilience: returning from background re-checks health immediately
  // (the 30s poller alone leaves a stale banner after wake).
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void voiceHostAssembly.workflow.refreshHealth();
    }
  });
  const standaloneHealth = await checkVoiceTutorStandaloneHealth(config, {
    windowRef: window,
    navigatorRef: navigator,
  });
  renderStandaloneHealthDiagnostics(standaloneHealth);
  appendStandaloneLog('system', `Runtime diagnostics ${standaloneHealth.overall}`);
  healthDiagnosticsPollerId = ensureStandaloneHealthDiagnosticsPoller(config);
  bindStandaloneDeepReadinessButton(config);
  // Abandon-trigger fix 2a: a degraded backend must never be a dead dark
  // screen. In coach mode every status surface is hidden, so the failure is
  // VOICED where the person is looking — one calm coach-thread line — with a
  // quiet Retry under the thread that re-runs the same health check. Bootstrap
  // simply waits here until a retry succeeds; nothing below runs degraded.
  const DEGRADED_RETRY_ID = 'voice-degraded-retry';
  const ensureDegradedRetryButton = (): HTMLButtonElement | null => {
    const existing = document.getElementById(DEGRADED_RETRY_ID) as HTMLButtonElement | null;
    if (existing) {
      return existing;
    }
    const thread = document.getElementById('voice-coach-thread');
    if (!thread?.parentElement) {
      return null;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.id = DEGRADED_RETRY_ID;
    button.className = 'voice-btn voice-btn-secondary voice-degraded-retry';
    button.textContent = 'Retry';
    thread.parentElement.insertBefore(button, thread.nextSibling);
    return button;
  };
  const waitForDegradedRetry = (): Promise<void> => new Promise((resolve) => {
    const button = ensureDegradedRetryButton();
    if (!button) {
      // No rail to host the button (unexpected) — retry quietly on its own.
      window.setTimeout(resolve, 5000);
      return;
    }
    button.disabled = false;
    button.textContent = 'Retry';
    button.addEventListener('click', () => {
      button.disabled = true;
      button.textContent = 'Trying…';
      resolve();
    }, { once: true });
  });
  // SURFACE SWITCHING (product law 2, amended 2026-07-29). The single permitted
  // NAVIGATION affordance — distinct from the two lesson controls, which stay at
  // two. It hides the coach surface rather than unmounting anything: `#app` owns
  // the transport and the boot guard keys on an element inside it.
  //
  // WIRED BEFORE THE HEALTH GATE, DELIBERATELY. Below this, a degraded backend
  // parks boot in `while (!healthOnline) { await waitForDegradedRetry(); … }`,
  // which never returns while the tutor's model services are down. With the
  // wiring after it, the Practice button silently did nothing — forever, with no
  // error — and that is exactly backwards: self-practice is the mode for when
  // the tutor ISN'T available. It needs no session, no analyzer and no model,
  // only the gateway's drill list, so it must not wait on any of them.
  // Measured in review on a box with VoiceTrainer and the GGUF model down:
  // `body.dataset.tvSurface` was still null and the button still dead after 120s.
  //
  // `onLeaveCoach` is the load-bearing part. Hiding a surface does not stop a
  // microphone, so leaving the coach mid-session would otherwise leave capture
  // and a live tutor running behind an invisible screen.
  //
  // It goes through the coach surface's OWN stop, not the transport helper
  // underneath it. Calling the helper directly stops the audio but leaves the
  // surface's state machine believing the lesson is live — measured in review,
  // the learner came back to a button still reading "End" over a closed mic, and
  // speaking did nothing until they pressed End then Start. The helper stays as
  // the fallback for when no lesson is running.
  //
  // Declared ahead of the controller because the two reference each other: the
  // practice surface's back button drives the controller, and the controller
  // tells the practice surface when it has become visible.
  let practiceSurface: ReturnType<typeof setupPracticeSurface> = null;
  const surfaceController = createVoiceSurfaceController({
    storage: (() => {
      try {
        return window.localStorage;
      } catch {
        // Private browsing can throw on access alone; navigation still works,
        // the choice just is not remembered.
        return null;
      }
    })(),
    onLeaveCoach: async () => {
      // No coach surface yet — still booting, or the backend is degraded and the
      // lesson never mounted — means there is no lesson to stop. This also keeps
      // the wiring safe above the health gate: `stopCoachTransportAndCheckpoint`
      // is defined further down, so it must not be reachable before the coach is.
      if (!coachSurface) return;

      // A LIVE LESSON is the only case where a failed stop may block the switch.
      // Throwing here cancels it, which is right: hiding this surface is what
      // makes the microphone invisible, so a stop that failed must not be
      // followed by hiding.
      if (coachSurface.isActive()) {
        await coachSurface.stopIfActive();
        return;
      }

      // AN IDLE COACH IS DIFFERENT, AND MUST NOT BLOCK THE SWITCH. There is no
      // open microphone and no running lesson to conceal, so a failed checkpoint
      // here protects nothing — while cancelling the switch reproduces exactly
      // the defect this whole block was moved above the health gate to remove:
      // a Practice button that silently does nothing.
      //
      // Reachability is ordinary, not exotic: the gateway is healthy at boot so
      // the coach mounts, then the learner leaves wifi and taps Practice — i.e.
      // the two-free-minutes-at-a-bus-stop case the mode exists for. Measured in
      // review: one spurious stop request, then the switch blocked with an empty
      // status line.
      try {
        await stopCoachTransportAndCheckpoint();
      } catch (error) {
        // Reported, never rethrown. The checkpoint is best-effort bookkeeping for
        // a session that was not running.
        reportVoiceTutorFailure('control', 'partial-function', 'idle-checkpoint-failed', {
          online: navigator.onLine !== false,
          status: 'failed',
        });
        void error;
      }
    },
    onTeardownError: () => {
      reportVoiceTutorFailure('control', 'partial-function', 'surface-teardown-failed', {
        online: navigator.onLine !== false,
        status: 'failed',
      });
      // SAY IT ON SCREEN, not only in telemetry. This fires when a switch was
      // cancelled, so the learner just tapped a button and stayed put; without a
      // message that is indistinguishable from a broken button. The coach's own
      // stop path already writes "Couldn't stop cleanly." for an active lesson,
      // but nothing did for the cancel itself.
      coachSurface?.setStatus('Still finishing the last lesson — try Practice again in a moment.', 'error');
    },
    onChange: (surface) => {
      // Fetch lazily, only once the learner is actually looking at it, and on
      // every arrival — the target preset can change in the coach between visits.
      if (surface === 'practice') practiceSurface?.show();
    },
  });
  const surfaceToggle = document.getElementById('tv-coach-nav-toggle');
  surfaceToggle?.addEventListener('click', () => {
    void surfaceController.toggle();
  });

  // The practice surface owns its own way back. The coach's toggle is inside the
  // coach surface, which is hidden while practice is showing — and the choice is
  // persisted, so without this button a learner who tapped Practice would be
  // stranded on that screen across reloads.
  practiceSurface = setupPracticeSurface({
    doc: document,
    onBack: () => { void surfaceController.set('coach'); },
    loadDrills: async (allowLoud) => {
      const base = config.backendUrl.replace(/\/$/, '');
      // SEND THE LANE FROM LOCAL STATE. The handler falls back to the session's
      // targetPreset, and self-practice deliberately returns an EMPTY menu for an
      // unknown lane rather than substituting a different voice target — so
      // relying on the session meant a learner who had never pressed Start saw
      // "No practice sounds", which is the opposite of a mode whose whole point
      // is that it needs no session. Boot does not create one:
      // bootstrapVoiceModeSession(false, true) starts nothing.
      const ui = store.getUiState();
      const params = new URLSearchParams({
        sessionId,
        targetPreset: ui.targetPreset || 'cute-feminine',
        allowLoud: String(allowLoud),
      });
      // Bounded, for the same reason the stop request is: a gateway that accepts
      // and never answers would latch the surface's single-flight guard forever,
      // turning the retry button, the loud toggle and every later visit into
      // silent no-ops. A rejection here at least draws the retryable message.
      const response = await fetch(`${base}/voice/self-practice?${params.toString()}`, {
        signal: AbortSignal.timeout(PRACTICE_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`self-practice ${response.status}`);
      const payload = await response.json() as { drills?: PracticeDrill[] };
      return Array.isArray(payload?.drills) ? payload.drills : [];
    },
  });
  // Boot straight onto practice when that is the remembered surface.
  if (surfaceController.current === 'practice') practiceSurface?.show();

  let healthOnline = await voiceHostAssembly.workflow.refreshHealth();
  if (!healthOnline) {
    reportVoiceTutorFailure('gateway-health', 'not-connected', 'startup-health-degraded', {
      online: navigator.onLine !== false,
    });
    setStandaloneStatus(resolveVoiceTutorStandaloneReadinessStatus({
      healthOnline,
      healthSummaryStatus: standaloneHealth.overall,
      voiceUiState: store.getUiState(),
    }));
    appendStandaloneLog('system', `Backend health degraded for ${config.backendUrl}`);
    appendCoachThreadLine("Can't reach the practice room — try again in a moment.", 'degraded-boot');
    while (!healthOnline) {
      await waitForDegradedRetry();
      healthOnline = await voiceHostAssembly.workflow.refreshHealth();
      if (!healthOnline) {
        appendStandaloneLog('system', `Backend still unreachable for ${config.backendUrl}`);
      }
    }
    document.getElementById(DEGRADED_RETRY_ID)?.remove();
    appendStandaloneLog('system', `Backend reachable again for ${config.backendUrl}`);
  }
  markVoiceTutorPhase('health-ready');
  // Restore the server-owned target/session contract without starting a new
  // analyzer. Android WebView storage survives an in-place APK update, and the
  // server may already hold a reference/custom target that the fresh local
  // store cannot safely reconstruct from defaults. Analyzer/audio ownership
  // begins only from an explicit practice action after the UI is wired.
  await voiceHostAssembly.sessionState.syncFromBackend(true);
  markVoiceTutorPhase('session-ready');
  // Startup only synchronizes state. Audio is armed by an explicit practice action,
  // after the front-door controls below have been wired and made responsive.
  // Session state was hydrated immediately above. Do not repeat that sync: its
  // cockpit-line ensure can involve the coach model and used to hold Start in
  // the disabled bootstrap shell for tens of seconds.
  await voiceHostAssembly.workflow.bootstrapVoiceModeSession(false, true);
  markVoiceTutorPhase('workflow-ready');

  // The phone Coach has no provider controls because its contract is fixed:
  // backend live capture for the continuous conversation, and VoxCPM conditioned
  // by the selected preset for every tutor utterance. Do not inherit legacy
  // browser-provider defaults from the hidden cockpit.
  const coachRuntimeState = store.updateUiState((state) => ({
    ...state,
    coachVoice: {
      ...state.coachVoice,
      inputProvider: 'backend',
      speechProvider: 'voxcpm',
      speechEnabled: true,
    },
  }));
  void voiceApi.updateCockpitState(sessionId, {
    coachVoice: {
      inputProvider: 'backend',
      speechProvider: 'voxcpm',
      speechEnabled: true,
    },
  }, {
    coachVoice: coachRuntimeState.coachVoice,
    voiceInputRuntime: coachRuntimeState.voiceInputRuntime,
    advancedPanel: coachRuntimeState.advancedPanel,
  }).catch(() => {
    reportVoiceTutorFailure('coach-runtime', 'partial-function', 'provider-policy-sync-failed', {
      online: navigator.onLine !== false,
    });
  });

  const asSurfacePreset = (preset: {
    id?: unknown;
    name?: unknown;
    referenceClipId?: unknown;
    kind?: unknown;
    archived?: unknown;
  } | null | undefined): VoiceOnlyCoachPreset | null => {
    const id = typeof preset?.id === 'string' ? preset.id.trim() : '';
    const name = typeof preset?.name === 'string' ? preset.name.trim() : '';
    const referenceClipId = typeof preset?.referenceClipId === 'string'
      ? preset.referenceClipId.trim()
      : '';
    if (!id || !name || !referenceClipId) return null;
    return {
      id,
      name,
      referenceClipId,
      kind: typeof preset?.kind === 'string' ? preset.kind : 'reference',
      archived: preset?.archived === true,
    };
  };

  const selectedSurfacePreset = (): VoiceOnlyCoachPreset | null => {
    const ui = store.getUiState();
    const libraryPreset = ui.customTargetPresets.find((preset) => (
      preset.id === ui.selectedCustomPresetId
    ));
    return asSurfacePreset(libraryPreset || (
      ui.selectedCustomPresetId && ui.referenceClipId
        ? {
            id: ui.selectedCustomPresetId,
            name: ui.selectedCustomPresetName || ui.referenceClipName || 'Tutor voice',
            referenceClipId: ui.referenceClipId,
            kind: 'reference',
          }
        : null
    ));
  };

  const setContinuousCoachMode = async (
    enabled: boolean,
    persistence: 'persist' | 'local-only' = 'persist',
  ): Promise<boolean> => {
    return voiceHostAssembly.runtime.setCoachContinuousMode(enabled, persistence);
  };

  const postCoachLifecycle = async (
    active: boolean,
    signal?: AbortSignal,
    prepareLiveInput = false,
  ): Promise<void> => {
    const base = config.backendUrl.replace(/\/$/, '');
    const response = active || prepareLiveInput
      ? await fetch(`${base}/session/start`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            agentId: 'voice',
            activate: active,
            prepareLiveInput,
            continuousEnabled: active,
            liveInputLeaseId: coachLiveInputLeaseId,
          }),
          signal,
        })
      // Bounded. A server that accepts the stop and never answers would
      // otherwise hang this promise forever, and everything that awaits a stop —
      // the End button, the navigation teardown — would hang with it.
      : await fetch(`${base}/session/${encodeURIComponent(sessionId)}/stop`, {
          method: 'POST',
          signal: signal ?? AbortSignal.timeout(COACH_STOP_TIMEOUT_MS),
        });
    if (!response.ok) throw new Error(`Coach lifecycle request failed (${response.status}).`);
    if (active || prepareLiveInput) {
      const payload = await response.json() as { sessionId?: unknown };
      const resolvedId = typeof payload.sessionId === 'string' ? payload.sessionId.trim() : '';
      if (resolvedId && resolvedId !== sessionId) {
        sessionId = resolvedId;
        try { getStandaloneStorage()?.setItem(session.storageKey, sessionId); } catch { /* advisory */ }
        const bridge = (window as Window & { __tvSession?: { id: string; backendUrl: string } }).__tvSession;
        if (bridge) bridge.id = sessionId;
      }
    }
  };

  const stopCoachTransportAndCheckpoint = async (): Promise<void> => {
    await stopVoiceOnlyCoachLifecycle({
      stopListening: () => voiceHostAssembly.runtime.stopCoachListening(true),
      stopSpeech: () => voiceHostAssembly.runtime.stopCoachSpeech(),
      disableContinuousCapture: () => setContinuousCoachMode(false),
      markSessionStopped: () => postCoachLifecycle(false),
      reportContinuousDisableFailure: () => reportVoiceTutorFailure(
        'control',
        'partial-function',
        'control-observed',
        {
          control: 'tv-coach-session-toggle',
          online: navigator.onLine !== false,
          status: 'failed',
        },
      ),
    });
    coachLiveInputLeaseId = null;
  };

  // The visible Coach is now one voice-only surface. It delegates audio and
  // model work to the mature hidden runtime, but owns every learner-facing
  // control and never renders the runtime's thread/composer/replay affordances.
  voiceHostAssembly.runtime.stopCoachListening(true);
  voiceHostAssembly.runtime.stopCoachSpeech();
  if (store.getUiState().coachVoice.continuousEnabled) {
    await setContinuousCoachMode(false);
  }
  // The visible Coach is the sole lesson surface. Release any restored hidden
  // practice transport as soon as the page is ready, so the learner's first
  // Start does not pay Android audio-context teardown latency.
  coachPracticeRelease = voiceHostAssembly.getAppRuntime()
    .releaseVoicePracticeForCoachListening()
    .catch(() => undefined);
  coachSurface = setupVoiceOnlyCoachSurface({
    doc: document,
    getPracticeLine: getCurrentPracticeLineText,
    getPronunciation: () => {
      const line = getVoiceActiveLine(store.getUiState());
      const spelling = [
        line?.cueSheet?.styledCueLine,
        line?.cueSheet?.cueLine,
      ].find((value) => typeof value === 'string' && value.trim())?.trim() || '';
      return spelling && spelling !== line?.displayText ? spelling : null;
    },
    getSelectedPreset: selectedSurfacePreset,
    getInteractionOwner: () => voiceHostAssembly.getAppRuntime().getVoiceInteractionOwner(),
    getInputStatus: () => store.getUiState().voiceInputRuntime?.status || 'idle',
    getInputError: () => (
      store.getUiState().voiceInputRuntime?.lastError
      || store.getState().voiceSpeechRecognition.error
      || null
    ),
    getTutorAudioPlaying: () => {
      const bridge = (window as Window & {
        __tvCoach?: { isPlaying?: () => boolean };
      }).__tvCoach;
      return bridge?.isPlaying?.() === true;
    },
    listPresets: async () => {
      const response = await voiceApi.listTargetPresets();
      return (response.presets || [])
        .map((preset) => asSurfacePreset(preset))
        .filter((preset): preset is VoiceOnlyCoachPreset => Boolean(preset));
    },
    selectPreset: async (presetId) => {
      await voiceApi.selectTargetPreset(sessionId, presetId);
      await voiceHostAssembly.sessionState.syncFromBackend(true);
      await voiceHostAssembly.workflow.refreshDrills(true).catch(() => undefined);
      voiceHostAssembly.render();
    },
    uploadPreset: async (name, file) => {
      const analysis = await voiceHostAssembly.workflow.analyzeReference(file);
      if (!analysis) return null;
      const ui = store.getUiState();
      const response = await voiceApi.saveReferencePreset(sessionId, {
        name,
        basePreset: ui.targetPreset || 'cute-feminine',
        referenceClipId: ui.referenceClipId,
        referenceClipName: ui.referenceClipName || file.name,
        referenceAnalysis: ui.referenceAnalysis,
        targetVoiceProfile: ui.targetVoiceProfile,
      });
      return asSurfacePreset(response.preset);
    },
    startSession: (signal) => {
      coachLiveInputLeaseId = `coach-live-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
      return startVoiceOnlyCoachLifecycle({
        signal,
        prepareSession: (prepareSignal) => postCoachLifecycle(false, prepareSignal, true),
        // Activation persists this flag atomically with the durable learner
        // checkpoint, so the local enable must not add another network round trip.
        enableContinuousCapture: () => setContinuousCoachMode(true, 'local-only'),
        startListening: async () => {
          await coachPracticeRelease;
          return voiceHostAssembly.runtime.startCoachListening();
        },
        cancelListening: () => voiceHostAssembly.runtime.stopCoachListening(true),
        // Durable active/restart state is committed only after microphone capture
        // has actually opened. An aborted request is followed by the rollback.
        markSessionActive: (activeSignal) => postCoachLifecycle(true, activeSignal),
        rollbackToStopped: stopCoachTransportAndCheckpoint,
      }).then((started) => {
        // 2026-07-28: the spoken session opening. A beginner presses Start and
        // must never meet silence — one code-owned orientation through the
        // ordinary coach TTS path (not a coach reply, no LLM welcome), once
        // per session, only when a line exists to name.
        if (started) maybeSpeakSessionOpening();
        return started;
      });
    },
    stopSession: stopCoachTransportAndCheckpoint,
    reportFailure: (code) => {
      if (code === 'instruction-length-invalid') {
        reportVoiceTutorFailure(
          'practice-line-fallback',
          'contract-drift',
          'instruction-length-invalid',
          {
            online: navigator.onLine !== false,
            status: 'failed',
          },
        );
        return;
      }
      reportVoiceTutorFailure(
        'control',
        'partial-function',
        'control-observed',
        {
          control: code.startsWith('preset-') ? 'tv-coach-preset-button' : 'tv-coach-session-toggle',
          online: navigator.onLine !== false,
          status: 'failed',
        },
      );
    },
  });


  // Privacy-safe physical-device diagnostics for the spoken-loop seams. This
  // intentionally exposes only finite-state facts: no transcript, prompt,
  // message, session identifier, learner memory, or audio bytes.
  const coachDiagnosticsWindow = window as Window & {
    __tvCoachDiagnostics?: {
      snapshot: () => {
        owner: string;
        frontendInputStatus: string;
        runtimeInputStatus: string;
        continuousEnabled: boolean;
        questionStatus: string;
        taskStatus: string;
        lessonStatus: string;
        practiceTransportStatus: string;
        sessionArmed: boolean;
        takeActive: boolean;
        takeProcessing: boolean;
        speechBusy: boolean;
      };
    };
    __tvCoach?: { isSpeaking?: () => boolean };
  };
  coachDiagnosticsWindow.__tvCoachDiagnostics = {
    snapshot: () => {
      const runtimeState = store.getState();
      const uiState = runtimeState.voiceUiState;
      return {
        owner: voiceHostAssembly.getAppRuntime().getVoiceInteractionOwner(),
        frontendInputStatus: runtimeState.voiceSpeechRecognition.status,
        runtimeInputStatus: uiState.voiceInputRuntime?.status || 'idle',
        continuousEnabled: Boolean(uiState.coachVoice?.continuousEnabled),
        questionStatus: runtimeState.voiceCoachQuestionStatus,
        taskStatus: runtimeState.voiceCoachTaskStatus,
        lessonStatus: runtimeState.voiceDeepTutorLessonStatus,
        practiceTransportStatus: runtimeState.voiceTransportStatus,
        sessionArmed: Boolean(runtimeState.voiceSessionArmed),
        takeActive: Boolean(runtimeState.voiceTakeActive),
        takeProcessing: Boolean(runtimeState.voiceTakeProcessing),
        speechBusy: coachDiagnosticsWindow.__tvCoach?.isSpeaking?.() === true,
      };
    },
  };
  window.addEventListener('beforeunload', () => coachSurface?.dispose(), { once: true });

  // P0.1a voice-copy front door: "upload your target voice" is the first screen.
  // Additive — restored state never auto-arms the mic on a fresh load; the front
  // door simply shows until a target is chosen, then hides to reveal
  // the practice stage. Uploading a sample reuses analyzeReference (which flips the target to
  // the reference); "start with a preset" is the no-sample fallback.
  let presetFallbackChosen = false;
  const refreshFrontDoor = (): void => {
    const ui = store.getUiState();
    const stage = presetFallbackChosen
      ? 'practice'
      : deriveSessionStage({
          voiceSessionId: ui.voiceSessionId,
          targetSource: ui.targetSource,
          referenceClipId: ui.referenceClipId,
        });
    const shown = updateVoiceFrontDoorVisibility(
      domBindings.root,
      stage,
      Boolean(ui.referenceClipId),
      Boolean(ui.frontDoorDismissed) || presetFallbackChosen,
    );
    // Same-decision invariant: the lab panel's takeover class must follow the door.
    // The main render also toggles it (render-dom), but no render runs on the
    // imperative skip path — without this, "start with a preset" left the cockpit
    // grid hidden behind vt-front-door-open until the next backend render.
    domBindings.root.voiceLabPanel?.classList.toggle('vt-front-door-open', shown);
  };

  // P1 clip trust — front-door sub-views (chooser / live recording / report card).
  // Between analyze and "Start practicing" the front door stays open showing the
  // report card; on 'reject' the user cannot proceed. We drive these panels here
  // instead of letting refreshFrontDoor auto-hide on referenceClipId being set.
  const chooserEl = document.getElementById('voice-front-door-chooser');
  const recordingEl = document.getElementById('voice-front-door-recording');
  const reportEl = document.getElementById('voice-front-door-report');
  const welcomeEl = document.getElementById('voice-front-door-welcome');
  const recordButtonEl = document.getElementById('voice-front-door-record') as HTMLButtonElement | null;
  const recordElapsedEl = document.getElementById('voice-front-door-record-elapsed');
  const recordStopEl = document.getElementById('voice-front-door-record-stop') as HTMLButtonElement | null;
  const recordCancelEl = document.getElementById('voice-front-door-record-cancel') as HTMLButtonElement | null;
  const recordMinEl = document.getElementById('voice-front-door-record-min');
  // Fix 1: the calm mic-unavailable line in the chooser (auto-offers the
  // preset escape when the mic can't open). Hidden on every view change;
  // re-revealed only by the record error path below.
  const micDeniedEl = document.getElementById('voice-front-door-mic-denied');

  type FrontDoorView = 'welcome' | 'chooser' | 'recording' | 'report' | 'presets';
  const presetsEl = document.getElementById('voice-front-door-presets');
  const presetListEl = document.getElementById('voice-front-door-preset-list');
  const presetsErrorEl = document.getElementById('voice-front-door-presets-error');
  const showFrontDoorView = (view: FrontDoorView): void => {
    welcomeEl?.classList.toggle('hidden', view !== 'welcome');
    chooserEl?.classList.toggle('hidden', view !== 'chooser');
    recordingEl?.classList.toggle('hidden', view !== 'recording');
    reportEl?.classList.toggle('hidden', view !== 'report');
    presetsEl?.classList.toggle('hidden', view !== 'presets');
    micDeniedEl?.classList.add('hidden');
  };

  // Fix 1: ONE preset escape everywhere — the chooser peer button, the
  // "Just look around first" path, and the report-card reject view all land
  // here (durable dismiss so the shared render rule agrees).
  const choosePresetFallback = (): void => {
    presetFallbackChosen = true;
    store.updateUiState((current) => ({ ...current, frontDoorDismissed: true }));
    refreshFrontDoor();
  };

  // UX pass (2026-07-19): the preset escape shows the SAVED VOICES as tappable
  // cards (name only — a real choice) instead of silently taking a default. The
  // list is fetched BEFORE the panel shows, so an empty library or a load error
  // falls straight through to the old immediate-dismiss behavior with no
  // header-only flash — never a wall.
  let presetPickerBusy = false;
  const openPresetPicker = async (): Promise<void> => {
    if (presetPickerBusy) return;
    if (!presetsEl || !presetListEl) {
      choosePresetFallback();
      return;
    }
    presetPickerBusy = true;
    showFrontDoorView('presets');
    if (presetsErrorEl) {
      presetsErrorEl.textContent = 'Loading saved voices…';
      presetsErrorEl.classList.remove('hidden');
    }
    try {
      const library = await voiceApi.listTargetPresets();
      const presets = (library?.presets ?? []).filter((p) => p && !p.archived);
      if (!presets.length) {
        choosePresetFallback();
        return;
      }
      const cards: HTMLButtonElement[] = [];
      for (const preset of presets) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = 'voice-preset-pick';
        const name = document.createElement('span');
        name.className = 'voice-preset-pick-name';
        name.textContent = preset.name || 'Saved voice';
        card.append(name);
        card.addEventListener('click', () => {
          void (async () => {
            // One selection at a time: the first tap freezes EVERY card, so a
            // quick second tap on a sibling can't race a concurrent select and
            // leave the final target indeterminate.
            if (cards.some((c) => c.disabled)) return;
            for (const c of cards) c.disabled = true;
            try {
              await voiceApi.selectTargetPreset(sessionId, preset.id);
              // Re-key the drill plan to the fresh target via the canonical
              // workflow path; a refresh hiccup is non-fatal (the next backend
              // sync heals it) and must not un-set the already-selected voice.
              await voiceHostAssembly.workflow.refreshDrills(true).catch(() => undefined);
              appendStandaloneLog('system', `Target voice set: ${preset.name || preset.id}`);
              choosePresetFallback();
            } catch (error) {
              for (const c of cards) c.disabled = false;
              if (presetsErrorEl) {
                presetsErrorEl.textContent = "Couldn't set that voice just now — try another, or start plain.";
                presetsErrorEl.classList.remove('hidden');
              }
              appendStandaloneLog('warning', `Preset select failed: ${error instanceof Error ? error.message : String(error)}`);
            }
          })();
        });
        cards.push(card);
      }
      presetListEl.replaceChildren(...cards);
      presetsErrorEl?.classList.add('hidden');
    } catch (error) {
      appendStandaloneLog('warning', `Preset list failed: ${error instanceof Error ? error.message : String(error)}`);
      choosePresetFallback();
    } finally {
      presetPickerBusy = false;
    }
  };
  document.getElementById('voice-front-door-presets-back')?.addEventListener('click', () => {
    showFrontDoorView('chooser');
  });

  const showReportCard = (data: VoiceReferenceAnalyzeResponse | null): void => {
    if (!data) {
      // Analyze failed (error already logged by the workflow); return to chooser.
      showFrontDoorView('chooser');
      return;
    }
    renderVoiceFrontDoorReportCard(
      reportEl,
      data.quality ?? null,
      {
        onProceed: () => {
          // Proceed exactly as a successful analyze does today: reveal practice.
          showFrontDoorView('chooser');
          refreshFrontDoor();
        },
        onTryAgain: () => {
          reportEl?.replaceChildren();
          showFrontDoorView('chooser');
        },
        // Fix 1: a rejected clip is never a wall — the reject view also offers
        // the preset escape (now the saved-voice picker).
        onUsePreset: () => {
          reportEl?.replaceChildren();
          void openPresetPicker();
        },
      },
      { clipName: data.filename || store.getUiState().referenceClipName || null },
    );
    showFrontDoorView('report');
  };

  let micRecorder: VoiceMicRecorderHandle | null = null;
  const submitRecordedClip = async (file: File | null): Promise<void> => {
    micRecorder = null;
    if (recordStopEl) {
      recordStopEl.disabled = true;
    }
    if (!file) {
      // Too short / nothing captured — back to the chooser.
      showFrontDoorView('chooser');
      return;
    }
    const data = await voiceHostAssembly.workflow.analyzeReference(file);
    showReportCard(data);
  };

  recordButtonEl?.addEventListener('click', () => {
    if (micRecorder) {
      return;
    }
    if (recordStopEl) {
      recordStopEl.disabled = true;
    }
    recordMinEl?.classList.remove('hidden');
    if (recordElapsedEl) {
      recordElapsedEl.textContent = '0.0s';
    }
    showFrontDoorView('recording');
    void startVoiceMicReferenceRecording({
      onElapsed: (elapsedMs) => {
        if (recordElapsedEl) {
          recordElapsedEl.textContent = `${(elapsedMs / 1000).toFixed(1)}s`;
        }
      },
      onMinReached: () => {
        if (recordStopEl) {
          recordStopEl.disabled = false;
        }
        recordMinEl?.classList.add('hidden');
      },
      onAutoStop: (reason) => {
        if (reason === 'max-duration' && micRecorder) {
          const handle = micRecorder;
          void handle.stop().then((file) => submitRecordedClip(file));
        }
      },
    })
      .then((handle) => {
        micRecorder = handle;
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        appendStandaloneLog('warning', `Microphone unavailable: ${message}`);
        showFrontDoorView('chooser');
        // Fix 1: mic denied/unavailable is not an error-wall — auto-offer the
        // preset escape with calm copy and hand focus to it.
        if (micDeniedEl) {
          micDeniedEl.textContent = VOICE_MIC_UNAVAILABLE_LINE;
          micDeniedEl.classList.remove('hidden');
        }
        (document.getElementById('voice-front-door-skip') as HTMLButtonElement | null)?.focus();
      });
  });

  recordStopEl?.addEventListener('click', () => {
    if (!micRecorder) {
      return;
    }
    const handle = micRecorder;
    void handle.stop().then((file) => submitRecordedClip(file));
  });

  recordCancelEl?.addEventListener('click', () => {
    micRecorder?.cancel();
    micRecorder = null;
    showFrontDoorView('chooser');
  });

  bindVoiceFrontDoor(domBindings.root, {
    onVoiceReferenceSelected: (file) => {
      void voiceHostAssembly.workflow.analyzeReference(file).then(showReportCard);
    },
    // UX pass: the chooser's preset escape opens the saved-voice picker; the
    // picker itself lands on choosePresetFallback (durable dismiss) after a
    // successful select, or immediately when no saved voices exist.
    onUsePresetFallback: () => { void openPresetPicker(); },
  });

  // Orientation beat: the first-run welcome view. "Let's begin" reveals the
  // target-voice chooser; "Just look around first" is the drop-off — it dismisses
  // the front door (loading a default preset so the cockpit has something to show)
  // via the same durable-dismiss path as the preset fallback.
  document.getElementById('voice-front-door-begin')?.addEventListener('click', () => {
    showFrontDoorView('chooser');
  });
  document.getElementById('voice-front-door-explore')?.addEventListener('click', () => {
    choosePresetFallback();
  });

  // Consumer-hardware wave: first-run mic check. A calm fixed overlay measured
  // on the SAME PCM16 capture plumbing the front-door recording uses. Results
  // feed (a) the live UI state fields the frontend gates/status read and
  // (b) the backend session voiceState (via the cockpit-state patch) so the
  // safety gates' inputRuntime.lastSnrDb / lastClippingPct /
  // lastCaptureReliability checks light up before any scored take exists.
  const getMicCheckDeviceId = (): string => {
    const select = document.getElementById('voice-input-device') as HTMLSelectElement | null;
    return select?.value || readVoiceInputDevicePreference() || 'default';
  };
  const micCheck = setupVoiceMicCheck({
    doc: document,
    storage: getStandaloneStorage(),
    getDeviceId: getMicCheckDeviceId,
    applyRuntimeQuality: (patch) => {
      store.updateUiState((current) => ({
        ...current,
        voiceInputRuntime: { ...current.voiceInputRuntime, ...patch },
      }));
      voiceHostAssembly.render();
      const ui = store.getUiState();
      void voiceApi.updateCockpitState(sessionId, { voiceInputRuntime: patch }, {
        coachVoice: ui.coachVoice,
        voiceInputRuntime: ui.voiceInputRuntime,
        advancedPanel: ui.advancedPanel,
      }).catch((error) => appendStandaloneLog(
        'warning',
        `Mic check state sync failed: ${error instanceof Error ? error.message : String(error)}`,
      ));
    },
    addLog: (kind, message) => appendStandaloneLog(kind, message),
    // Fix 5: when the live noise floor drifts strongly loud vs the stored
    // check, the re-offer is ONE quiet coach-thread line — never a dialog.
    onNoiseFloorShift: () => {
      appendCoachThreadLine(MIC_CHECK_NOISE_SHIFT_LINE, 'mic-recheck-offer');
    },
  });
  micCheckRef = micCheck;
  // First-run offer rides "Let's begin": the chooser reveals underneath and the
  // mic check appears once per input device, BEFORE the target-voice capture.
  document.getElementById('voice-front-door-begin')?.addEventListener('click', () => {
    micCheck.maybeOffer('first-run');
  });
  window.addEventListener('beforeunload', () => micCheck.dispose());

  showFrontDoorView('welcome');
  refreshFrontDoor();

  const readinessState = store.getUiState();
  appendStandaloneLog(
    'system',
    `Readiness inputs: summary=${standaloneHealth.overall} service=${readinessState.serviceStatus} lastError=${readinessState.lastError || 'none'}`,
  );
  setStandaloneStatus(resolveVoiceTutorStandaloneReadinessStatus({
    healthOnline: true,
    healthSummaryStatus: standaloneHealth.overall,
    voiceUiState: readinessState,
  }));
  markVoiceTutorPhase('app-ready');
}

// Only auto-bootstrap on the genuine standalone page (voice-tutor-app.html). This module's
// code is code-split into the shared `voice-runtime` chunk that the full SLOANE dashboard
// ALSO imports; without this guard, merely loading the dashboard would execute
// bootstrapStandaloneVoiceTutor(), which calls app.replaceChildren() on #app — wiping the
// dashboard shell (#terminal-output) and replacing it with the voice standalone view.
// See standalone-bootstrap-guard.ts; mirrors the #voice-launcher-form guard in
// standalone-launcher.ts. Regression: dashboard "Missing app element: #terminal-output".
if (typeof window !== 'undefined' && shouldAutoBootstrapVoiceTutorStandalone()) {
  void bootstrapStandaloneVoiceTutor().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    reportVoiceTutorFailure('client-boot', 'boot-skip', 'startup-failed', {
      online: navigator.onLine !== false,
      phase: 'bootstrap-catch',
    });
    setStandaloneStatus('ERROR');
    appendStandaloneLog('system', `Startup failed: ${message}`);
    console.error('[Voice Tutor Standalone] Startup failed:', error);
  });
}
