import type { VoiceCoachLoopRecognitionStatus } from './coach-loop';
import type { VoicePracticeTransportStatus } from './practice-transport';
import type { VoiceCoachRuntimeService } from './runtime-service';
import type { VoiceCoachMessage } from './state';
import {
  resolveDeepTutorVoiceResumePlan,
  type DeepTutorVoiceInteractionState,
  type DeepTutorVoiceResumePlan,
  resolveVoiceCoachPostPlaybackHandoffPlan,
  resolveVoiceCoachRenderHandoffPlan,
  type VoiceCoachPostPlaybackHandoffPlan,
  type VoiceCoachRenderHandoffPlan,
  type VoiceInteractionSnapshot,
} from './orchestrator';

type VoiceRuntimeRecoveryState = {
  shouldDisableContinuous: boolean;
};

type VoiceRuntimeCoordinatorOptions = {
  getInteractionSnapshot: () => VoiceInteractionSnapshot;
  hasInputProvider: () => boolean;
  supportsAutomaticTurnBoundary: () => boolean;
  getRecoveryState: () => VoiceRuntimeRecoveryState;
  getContinuousEnabled: () => boolean;
  getSpeechRecognitionStatus: () => VoiceCoachLoopRecognitionStatus;
  getQuestionDraft: () => string;
  getLatestCoachMessage: () => VoiceCoachMessage | null;
  getLastSpokenCoachMessageId: () => string | null;
  onPostPlaybackHandoff?: (detail: {
    action: VoiceCoachPostPlaybackHandoffPlan['action'];
    listeningStarted: boolean | null;
    owner: VoiceInteractionSnapshot['owner'];
    hasInputProvider: boolean;
    automaticTurnBoundarySupported: boolean;
    recoveryShouldDisableContinuous: boolean;
    continuousEnabled: boolean;
    recognitionStatus: VoiceCoachLoopRecognitionStatus;
    questionDraftPresent: boolean;
    speechSynthesisBusy: boolean;
  }) => void;
  runtimeService: Pick<
    VoiceCoachRuntimeService,
    'canSpeakCoachMessage' | 'speakCoachMessage' | 'startCoachListening' | 'reopenCoachListeningWithNotice'
  >;
  // Promise<boolean> since 2026-07-27 (did arming actually happen). The
  // handoff paths here run right AFTER a spoken coach message, so they ignore
  // the result; the clarification executor is the caller that speaks on it.
  armPracticeSessionWithNotice: (notice: string) => Promise<boolean>;
  disarmPracticeSession: (reason: string) => Promise<void>;
  onPracticeArmError?: (message: string) => void;
  render: () => void;
  getPostPlaybackContext: () => {
    currentMode: string;
    currentSessionId: string | null;
    isConnected: boolean;
    hasActiveGuideSession: boolean;
    voiceSessionArmed: boolean;
    voiceTakeActive: boolean;
    voiceTakeProcessing: boolean;
    voiceTransportStatus: VoicePracticeTransportStatus;
    voiceDeepTutorLessonStatus: 'idle' | 'loading' | 'error';
    voiceCoachTaskStatus: 'idle' | 'running' | 'error';
    voiceCoachQuestionStatus: 'idle' | 'sending' | 'error';
    referenceMimicAction: string | null;
  };
};

export function createVoiceRuntimeCoordinator(options: VoiceRuntimeCoordinatorOptions) {
  let pendingContinuousListening: Promise<boolean> | null = null;

  function getSharedRuntimeState() {
    const snapshot = options.getInteractionSnapshot();
    const recovery = options.getRecoveryState();
    const latestCoachMessage = options.getLatestCoachMessage();

    return {
      snapshot,
      latestCoachMessage,
      hasInputProvider: options.hasInputProvider(),
      automaticTurnBoundarySupported: options.supportsAutomaticTurnBoundary(),
      recoveryShouldDisableContinuous: recovery.shouldDisableContinuous,
      continuousEnabled: options.getContinuousEnabled(),
      voiceSpeechRecognitionStatus: options.getSpeechRecognitionStatus(),
      questionDraft: options.getQuestionDraft(),
      lastSpokenCoachMessageId: options.getLastSpokenCoachMessageId(),
    };
  }

  function startContinuousListening(): Promise<boolean> {
    if (pendingContinuousListening) {
      return pendingContinuousListening;
    }
    const operation = Promise.resolve().then(
      () => options.runtimeService.startCoachListening(),
    );
    pendingContinuousListening = operation;
    void operation.then(
      () => {
        if (pendingContinuousListening === operation) {
          pendingContinuousListening = null;
        }
      },
      () => {
        if (pendingContinuousListening === operation) {
          pendingContinuousListening = null;
        }
      },
    );
    return operation;
  }

  function reportPostPlaybackHandoff(
    shared: ReturnType<typeof getSharedRuntimeState>,
    action: VoiceCoachPostPlaybackHandoffPlan['action'],
    listeningStarted: boolean | null,
  ): void {
    options.onPostPlaybackHandoff?.({
      action,
      listeningStarted,
      owner: shared.snapshot.owner,
      hasInputProvider: shared.hasInputProvider,
      automaticTurnBoundarySupported: shared.automaticTurnBoundarySupported,
      recoveryShouldDisableContinuous: shared.recoveryShouldDisableContinuous,
      continuousEnabled: shared.continuousEnabled,
      recognitionStatus: shared.voiceSpeechRecognitionStatus,
      questionDraftPresent: Boolean(shared.questionDraft.trim()),
      speechSynthesisBusy: shared.snapshot.hasCoachSpeaking,
    });
  }

  async function runRenderHandoff(): Promise<VoiceCoachRenderHandoffPlan> {
    const shared = getSharedRuntimeState();
    const plan = resolveVoiceCoachRenderHandoffPlan({
      ...shared,
      canPlaySpeech: options.runtimeService.canSpeakCoachMessage(),
      latestCoachMessageId: shared.latestCoachMessage?.id || null,
    });

    if (plan.action === 'speak-latest-coach') {
      if (shared.latestCoachMessage && options.runtimeService.speakCoachMessage(shared.latestCoachMessage)) {
        return plan;
      }

      const fallbackPlan = resolveVoiceCoachRenderHandoffPlan({
        ...shared,
        canPlaySpeech: false,
        latestCoachMessageId: shared.latestCoachMessage?.id || null,
      });
      if (fallbackPlan.action === 'start-continuous-listening') {
        await startContinuousListening();
      }
      return fallbackPlan;
    }

    if (plan.action === 'start-continuous-listening') {
      await startContinuousListening();
    }

    return plan;
  }

  async function runPostPlaybackHandoff(): Promise<VoiceCoachPostPlaybackHandoffPlan> {
    const shared = getSharedRuntimeState();
    const plan = resolveVoiceCoachPostPlaybackHandoffPlan({
      ...shared,
      ...options.getPostPlaybackContext(),
      message: shared.latestCoachMessage,
    });

    if (plan.action === 'arm-practice') {
      try {
        await options.armPracticeSessionWithNotice(plan.notice);
      } catch (error) {
        options.onPracticeArmError?.(error instanceof Error ? error.message : String(error));
      }
      reportPostPlaybackHandoff(shared, plan.action, null);
      return plan;
    }

    if (plan.action === 'start-continuous-listening') {
      const listeningStarted = await startContinuousListening();
      reportPostPlaybackHandoff(shared, plan.action, listeningStarted);
      return plan;
    }

    reportPostPlaybackHandoff(shared, plan.action, null);
    return plan;
  }

  async function runDeepTutorResumeHandoff(
    interaction: DeepTutorVoiceInteractionState,
  ): Promise<DeepTutorVoiceResumePlan> {
    const latestCoachMessage = options.getLatestCoachMessage();
    const plan = resolveDeepTutorVoiceResumePlan(interaction);

    switch (plan.action) {
      case 'start-lesson':
        return plan;
      case 'wait-for-take-processing':
      case 'noop':
        options.render();
        return plan;
      case 'arm-practice':
        await options.armPracticeSessionWithNotice('Practice armed for the next coached pass.');
        return plan;
      case 'disarm-practice-and-listen':
        await options.disarmPracticeSession('resume coach loop');
        await options.runtimeService.reopenCoachListeningWithNotice();
        return plan;
      case 'disarm-practice-and-speak':
        await options.disarmPracticeSession('resume coach loop');
        if (latestCoachMessage) {
          options.runtimeService.speakCoachMessage(latestCoachMessage);
        }
        options.render();
        return plan;
      case 'disarm-practice':
        await options.disarmPracticeSession('resume coach loop');
        options.render();
        return plan;
      case 'reopen-coach-listening':
        await options.runtimeService.reopenCoachListeningWithNotice();
        return plan;
      case 'speak-latest-coach':
        if (latestCoachMessage) {
          options.runtimeService.speakCoachMessage(latestCoachMessage);
        }
        options.render();
        return plan;
      default:
        options.render();
        return plan;
    }
  }

  return {
    runDeepTutorResumeHandoff,
    runRenderHandoff,
    runPostPlaybackHandoff,
  };
}
