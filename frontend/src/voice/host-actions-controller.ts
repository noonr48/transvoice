import type { VoiceBackendPayload, VoiceCockpitLineAction } from './api';
import { resolveVoiceCoachPendingChannel } from './coach-question-preflight';
import {
  shouldStartVoiceCoachContinuousListening as resolveShouldStartVoiceCoachContinuousListening,
} from './coach-loop';
import type { VoiceCoachShellBootstrap } from './coach-shell-bootstrap';
// 2026-07-27 field repair: the client-end witness for the transcript ->
// coach-reply crossing. Lives with the live-input controller because that is
// where its healthy twin (`coach-turn-dispatched`) is emitted.
import { reportVoiceCoachTurnDispatch } from './coach-input';
import type { VoiceRuntimeStore, VoiceCoachRuntimeResetOptions } from './runtime-store';
import type { VoiceRuntimeShell } from './runtime-shell';
import type {
  VoiceAdvancedPanelState,
  VoiceCoachVoiceState,
  VoiceConditioningState,
  VoiceInputRuntimeState,
} from './state';
import type { VoiceAppRuntime } from './app-runtime';

type VoiceCoachQuestionInputRef = Pick<HTMLInputElement, 'value'> | null;

type VoiceLiveTransitionActions = {
  startPracticeSession: (config?: {
    silent?: boolean;
    successNotice?: string | null;
  }) => Promise<boolean>;
  beginPracticeTake: () => boolean;
  endPracticeTake: (reason?: string) => Promise<boolean>;
  disarmPracticeSession: (reason?: string) => Promise<boolean>;
  prepareForSessionTransition: (reason: string) => Promise<void>;
};

type VoiceHostActionsControllerOptions = {
  store: VoiceRuntimeStore;
  getAppRuntime: () => Pick<
    VoiceAppRuntime,
    | 'canUseVoiceCoachVoiceInputFromSnapshot'
    | 'getDeepTutorVoiceInteractionState'
    | 'getLatestCoachMessage'
    | 'getVoiceInteractionSnapshot'
    | 'getVoiceReferenceMimicState'
    | 'hasActiveDeepTutorGuideSession'
    | 'shouldAutoReturnPracticeToCoachAfterTake'
  >;
  getCurrentMode: () => string;
  resolveSessionMode: () => string;
  getCurrentSessionId: () => string | null;
  getIsConnected: () => boolean;
  getCoachQuestionInput: () => VoiceCoachQuestionInputRef;
  render: () => void;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  submitRuntimeCoachQuestionRequest: (
    sessionId: string,
    message: string,
    audioBase64?: string,
    audioFormat?: string,
    listeningTurnId?: string,
  ) => Promise<VoiceBackendPayload>;
  prepareConditioningLatentsRequest: (
    sessionId: string,
    target: 'prompt' | 'reference',
    file: File,
    promptText?: string,
  ) => Promise<VoiceBackendPayload>;
  getCoachShell: () => VoiceCoachShellBootstrap | null;
  getRuntimeShell: () => VoiceRuntimeShell | null;
  getLiveTransitionController: () => VoiceLiveTransitionActions | null;
  getPracticeAudioRingBuffer?: () => { toBase64Wav: () => string; durationSeconds: number } | null;
};

type VoiceCockpitStatePatch = {
  coachVoice?: Partial<VoiceCoachVoiceState>;
  voiceInputRuntime?: Partial<VoiceInputRuntimeState>;
  advancedPanel?: Partial<VoiceAdvancedPanelState>;
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export type VoiceHostActionsController = ReturnType<typeof createVoiceHostActionsController>;

export function createVoiceHostActionsController(
  options: VoiceHostActionsControllerOptions,
) {
  function getAppRuntime() {
    return options.getAppRuntime();
  }

  function clearVoiceCoachPendingState(): void {
    options.store.clearPendingCoachState();
  }

  function stopVoiceCoachListening(resetTranscript = false): void {
    options.getCoachShell()?.stopCoachListening(resetTranscript);
  }

  async function startVoiceCoachListening(): Promise<boolean> {
    const coachShell = options.getCoachShell();
    if (!coachShell) {
      return false;
    }
    return coachShell.startCoachListening();
  }

  function stopVoiceCoachSpeech(): void {
    options.getCoachShell()?.stopCoachSpeech();
  }

  function clearVoiceCoachPollTimer(): void {
    options.getCoachShell()?.clearCoachPollTimer();
  }

  async function startVoicePracticeSession(
    silent = false,
    successNotice?: string,
  ): Promise<boolean> {
    const liveTransitionController = options.getLiveTransitionController();
    if (!liveTransitionController) {
      return false;
    }
    return liveTransitionController.startPracticeSession({
      silent,
      successNotice: successNotice || null,
    });
  }

  async function beginVoicePracticeTake(): Promise<void> {
    options.getLiveTransitionController()?.beginPracticeTake();
  }

  async function endVoicePracticeSession(reason = 'manual take end'): Promise<boolean> {
    const liveTransitionController = options.getLiveTransitionController();
    if (!liveTransitionController) {
      return false;
    }
    return liveTransitionController.endPracticeTake(reason);
  }

  async function disarmVoicePracticeSession(reason = 'manual disarm'): Promise<boolean> {
    const liveTransitionController = options.getLiveTransitionController();
    if (!liveTransitionController) {
      return false;
    }
    return liveTransitionController.disarmPracticeSession(reason);
  }

  async function armVoicePracticeSessionWithNotice(
    notice: string,
    silent = true,
  ): Promise<boolean> {
    const armed = await startVoicePracticeSession(silent, notice);
    if (armed) {
      options.render();
    }
    // 2026-07-27: the clarification executor speaks a confirmation after this
    // resolves, so it needs to know whether arming actually happened — a spoken
    // "practice is armed" over a failed arm would be a lie into dead air.
    return armed;
  }

  async function reopenVoiceCoachListeningWithNotice(
    notice = 'Coach listening reopened.',
  ): Promise<void> {
    await options.getCoachShell()?.reopenCoachListeningWithNotice(notice);
  }

  function resetVoiceCoachRuntimeUiState(
    resetOptions: VoiceCoachRuntimeResetOptions = {},
  ): void {
    options.store.resetCoachRuntimeUiState(resetOptions, {
      stopListening: (resetTranscript) => {
        stopVoiceCoachListening(resetTranscript);
      },
      stopSpeech: () => {
        stopVoiceCoachSpeech();
      },
      clearCoachPollTimer: () => {
        clearVoiceCoachPollTimer();
      },
      getLatestCoachMessageId: () => getAppRuntime().getLatestCoachMessage()?.id || null,
    });
  }

  function ensureVoiceCoachContinuousLoop(): void {
    const runtimeShell = options.getRuntimeShell();
    if (!runtimeShell) {
      return;
    }

    const voiceState = options.store.getState();
    const appRuntime = getAppRuntime();
    const interaction = appRuntime.getVoiceInteractionSnapshot();
    if (!resolveShouldStartVoiceCoachContinuousListening({
      canUseVoiceInput: appRuntime.canUseVoiceCoachVoiceInputFromSnapshot(interaction),
      automaticTurnBoundarySupported: runtimeShell.supportsAutomaticTurnBoundary(),
      recoveryShouldDisableContinuous: runtimeShell.getInputRecoveryState().shouldDisableContinuous,
      continuousEnabled: Boolean(voiceState.voiceUiState.coachVoice?.continuousEnabled),
      voiceSpeechRecognitionStatus: voiceState.voiceSpeechRecognition.status,
      questionDraft: options.getCoachQuestionInput()?.value || '',
      speechSynthesisBusy: interaction.hasCoachSpeaking,
    })) {
      return;
    }

    void startVoiceCoachListening().catch((error) => {
      options.store.setSpeechRecognitionState((current) => ({
        ...current,
        status: 'error',
        error: getErrorMessage(error),
      }));
      options.render();
    });
  }

  async function requestVoiceCoachNote(): Promise<void> {
    await options.getCoachShell()?.requestCoachNote();
  }

  async function handoffVoicePracticeToCoachAfterTake(): Promise<void> {
    if (!getAppRuntime().shouldAutoReturnPracticeToCoachAfterTake()) {
      return;
    }
    const voiceState = options.store.getState();
    await options.getCoachShell()?.handoffPracticeAfterTake({
      voiceSessionArmed: voiceState.voiceSessionArmed,
      voiceTransportStatus: voiceState.voiceTransportStatus,
    });
  }

  async function resumeDeepTutorVoiceLoop(): Promise<void> {
    const appRuntime = getAppRuntime();
    const referenceMimicState = appRuntime.getVoiceReferenceMimicState();
    await options.getCoachShell()?.resumeDeepTutorLoop({
      interaction: appRuntime.getDeepTutorVoiceInteractionState(referenceMimicState.action),
    });
  }

  async function refreshVoiceCockpitLine(
    action: VoiceCockpitLineAction = 'ensure',
  ): Promise<void> {
    await options.getCoachShell()?.refreshCockpitLine(action);
  }

  async function updateVoiceCockpitState(patch: VoiceCockpitStatePatch): Promise<void> {
    await options.getCoachShell()?.updateCockpitState(patch);
  }

  async function updateVoiceConditioningState(
    patch: Partial<VoiceConditioningState>,
  ): Promise<void> {
    await options.getCoachShell()?.updateConditioningState(patch);
  }

  async function prepareVoiceConditioningLatents(
    target: 'prompt' | 'reference',
    file: File,
    promptText = '',
  ): Promise<void> {
    const currentSessionId = options.getCurrentSessionId();
    if (!currentSessionId || !options.getIsConnected()) {
      throw new Error('Connect the session before preparing VoxCPM conditioning.');
    }

    const data = await options.prepareConditioningLatentsRequest(
      currentSessionId,
      target,
      file,
      promptText,
    );
    options.applyVoiceBackendPayload(data);
  }

  async function advanceDeepTutorVoiceLesson(): Promise<void> {
    await options.getCoachShell()?.advanceDeepTutorLesson();
  }

  async function submitVoiceCoachQuestion(
    questionOverride?: string,
    // Threaded through unchanged for the composition's scope-intent wrapper
    // (host-runtime-composition.ts), which is the only remaining reader of
    // skipIntentRouting. The controller itself routes nothing any more.
    _submitOptions: {
      skipIntentRouting?: boolean;
      listeningTurnId?: string;
    } = {},
  ): Promise<void> {
    const question = (questionOverride ?? options.getCoachQuestionInput()?.value ?? '').trim();
    const currentSessionId = options.getCurrentSessionId();
    // 2026-07-27 field repair: each of these was a bare `return`. A learner's
    // finished transcript would be dropped here with no line anywhere, which is
    // indistinguishable from the coach turn failing — and is what made the live
    // "no reply" fault unexplainable from any log.
    if (!question || !currentSessionId || !options.getIsConnected()) {
      if (question) {
        reportVoiceCoachTurnDispatch(
          'warn',
          'not-connected',
          currentSessionId ? 'coach-turn-declined-not-connected' : 'coach-turn-declined-no-session',
        );
      }
      return;
    }

    stopVoiceCoachListening(true);
    stopVoiceCoachSpeech();
    // 2026-07-27 (owner's law): ALL learner speech goes to the tutor, and the
    // tutor decides. The clarification-intent consumption that used to sit here
    // ("i'm ready" armed the mic instead of being answered) is gone — the only
    // spoken input the client still acts on itself are the device-mode scope
    // intents (quiet / eyes-free), which the tutor cannot execute and which
    // always answer out loud.

    if (!options.getCoachShell()) {
      // The optional chain below would make this a no-op with no trace at all.
      reportVoiceCoachTurnDispatch('error', 'dead-function', 'coach-turn-declined-no-shell');
      return;
    }

    await options.getCoachShell()?.submitCoachRequest({
      pendingChannel: resolveVoiceCoachPendingChannel(
        question,
        getAppRuntime().hasActiveDeepTutorGuideSession(),
      ),
      request: () => {
        const listeningTurnId = _submitOptions.listeningTurnId;
        if (listeningTurnId?.trim()) {
          return options.submitRuntimeCoachQuestionRequest(
            currentSessionId,
            question,
            undefined,
            undefined,
            listeningTurnId,
          );
        }
        // The practice ring is a separate capture lane. It is safe only for a
        // legacy question with no server-bound listening turn; otherwise it
        // could attach attempt A's audio to attempt B's transcript and metrics.
        const ringBuffer = options.getPracticeAudioRingBuffer?.();
        const audioBase64 = ringBuffer && ringBuffer.durationSeconds > 0.5
          ? ringBuffer.toBase64Wav()
          : undefined;
        return options.submitRuntimeCoachQuestionRequest(
          currentSessionId,
          question,
          audioBase64,
          audioBase64 ? 'wav' : undefined,
        );
      },
      clearInputOnSuccess: true,
    });
  }

  async function prepareForLiveSessionTransition(reason: string): Promise<void> {
    if (options.resolveSessionMode() !== 'voice' && options.getCurrentMode() !== 'voice') {
      return;
    }

    await options.getLiveTransitionController()?.prepareForSessionTransition(reason);
  }

  return {
    clearVoiceCoachPendingState,
    armVoicePracticeSessionWithNotice,
    reopenVoiceCoachListeningWithNotice,
    resetVoiceCoachRuntimeUiState,
    ensureVoiceCoachContinuousLoop,
    requestVoiceCoachNote,
    handoffVoicePracticeToCoachAfterTake,
    resumeDeepTutorVoiceLoop,
    refreshVoiceCockpitLine,
    updateVoiceCockpitState,
    updateVoiceConditioningState,
    prepareVoiceConditioningLatents,
    advanceDeepTutorVoiceLesson,
    submitVoiceCoachQuestion,
    startVoicePracticeSession,
    beginVoicePracticeTake,
    endVoicePracticeSession,
    disarmVoicePracticeSession,
    prepareForLiveSessionTransition,
    stopVoiceCoachListening,
    startVoiceCoachListening,
    stopVoiceCoachSpeech,
    clearVoiceCoachPollTimer,
  };
}
