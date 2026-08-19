import { shouldStartVoiceCoachContinuousListening, type VoiceCoachLoopRecognitionStatus } from './coach-loop';
import type { VoicePracticeTransportStatus } from './practice-transport';
import {
  createDeepTutorVoiceSharedInteractionState,
  getDeepTutorVoiceLessonMode,
  normalizeDeepTutorVoiceState,
  type DeepTutorVoiceLessonMode,
  type DeepTutorVoicePracticeIntent,
  type DeepTutorVoiceRuntimeOwner,
  type DeepTutorVoiceState,
  type VoiceCoachMessage,
} from './state';

export type VoiceInteractionOwner =
  | 'idle'
  | 'coach-speaking'
  | 'coach-listening'
  | 'coach-processing'
  | 'practice-arming'
  | 'practice-armed'
  | 'practice-live'
  | 'practice-processing';

export type VoicePracticeInteractionState = 'idle' | 'arming' | 'armed' | 'live' | 'processing';
export type VoiceCoachInteractionState = 'idle' | 'listening' | 'processing' | 'speaking';
export type DeepTutorVoiceLessonLifecycle = 'syncing' | 'start-required' | 'active';
export type DeepTutorCoachListeningState = 'idle' | 'armed' | 'listening';
export type DeepTutorPracticeIntent = 'coach' | 'practice';

type VoiceInteractionOwnerOptions = {
  voiceTakeProcessing: boolean;
  voiceTakeActive: boolean;
  voiceTransportStatus: VoicePracticeTransportStatus;
  voiceCoachQuestionStatus: 'idle' | 'sending' | 'error';
  voiceCoachTaskStatus: 'idle' | 'running' | 'error';
  voiceDeepTutorLessonStatus: 'idle' | 'loading' | 'error';
  voiceSpeechRecognitionStatus: 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
  speechSynthesisBusy: boolean;
  voiceSessionArmed: boolean;
};

export type VoiceInteractionSnapshotOptions = VoiceInteractionOwnerOptions & {
  currentMode: string;
  currentSessionId: string | null;
  isConnected: boolean;
};

export type VoiceInteractionSnapshot = {
  currentMode: string;
  currentSessionId: string | null;
  isConnected: boolean;
  owner: VoiceInteractionOwner;
  practiceState: VoicePracticeInteractionState;
  coachState: VoiceCoachInteractionState;
  hasConnectedVoiceSession: boolean;
  hasCoachOwnership: boolean;
  hasPracticeOwnership: boolean;
  hasActivePracticeTake: boolean;
  hasPracticeProcessing: boolean;
  hasPracticeArmingTransition: boolean;
  hasCoachProcessing: boolean;
  hasCoachListening: boolean;
  hasCoachSpeaking: boolean;
};

type DeepTutorVoiceInteractionStateOptions = {
  snapshot: VoiceInteractionSnapshot;
  deeptutorVoiceState?: Partial<DeepTutorVoiceState> | null;
  shouldRebuildLesson: boolean;
  hasActiveGuideSession: boolean;
  voiceDeepTutorLessonStatus: 'idle' | 'loading' | 'error';
  voiceSpeechRecognitionStatus: VoiceCoachLoopRecognitionStatus;
  referenceMimicAction: string | null;
  canUseVoiceCoachVoiceInput: boolean;
  canUseVoiceCoachVoiceInputAfterRelease: boolean;
  latestCoachMessageId: string | null;
  lastSpokenCoachMessageId: string | null;
};

export type DeepTutorVoiceInteractionState = {
  snapshot: VoiceInteractionSnapshot;
  lessonMode: DeepTutorVoiceLessonMode;
  lessonLifecycle: DeepTutorVoiceLessonLifecycle;
  guideStatus: string;
  runtimeOwner: DeepTutorVoiceRuntimeOwner;
  coachListeningState: DeepTutorCoachListeningState;
  practiceIntent: DeepTutorPracticeIntent;
  hasActiveGuideSession: boolean;
  hasHistoricalLessonState: boolean;
  hasReleasablePracticeOwnership: boolean;
  hasPracticeReleaseBlocker: boolean;
  canArmPractice: boolean;
  canReopenCoachListening: boolean;
  canReopenCoachListeningAfterPracticeRelease: boolean;
  hasUnspokenCoachReply: boolean;
  shouldStartLesson: boolean;
};

export type VoiceCoachInputEligibilityOptions = {
  hasInputProvider: boolean;
  ignoreTakeState?: boolean;
};

export type VoicePracticeReleasePlan =
  | { action: 'blocked'; reason: string }
  | { action: 'disarm' }
  | { action: 'noop' };

type VoiceCoachContinuousListeningOptions = {
  snapshot: VoiceInteractionSnapshot;
  hasInputProvider: boolean;
  automaticTurnBoundarySupported: boolean;
  recoveryShouldDisableContinuous: boolean;
  continuousEnabled: boolean;
  voiceSpeechRecognitionStatus: VoiceCoachLoopRecognitionStatus;
  questionDraft: string;
};

type VoiceCoachRenderHandoffOptions = VoiceCoachContinuousListeningOptions & {
  canPlaySpeech: boolean;
  latestCoachMessageId: string | null;
  lastSpokenCoachMessageId: string | null;
};

export type VoiceCoachRenderHandoffPlan =
  | { action: 'speak-latest-coach' }
  | { action: 'start-continuous-listening' }
  | { action: 'noop' };

type VoiceCoachAutoArmOptions = {
  message: VoiceCoachMessage | null;
  currentMode: string;
  currentSessionId: string | null;
  isConnected: boolean;
  continuousEnabled: boolean;
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

export type DeepTutorVoiceResumePlan =
  | { action: 'start-lesson' }
  | { action: 'wait-for-take-processing' }
  | { action: 'arm-practice' }
  | { action: 'disarm-practice-and-listen' }
  | { action: 'disarm-practice-and-speak' }
  | { action: 'disarm-practice' }
  | { action: 'reopen-coach-listening' }
  | { action: 'speak-latest-coach' }
  | { action: 'noop' };

type VoiceCoachPostPlaybackHandoffOptions = VoiceCoachContinuousListeningOptions & VoiceCoachAutoArmOptions;

export type VoiceCoachPostPlaybackHandoffPlan =
  | { action: 'arm-practice'; notice: string }
  | { action: 'start-continuous-listening' }
  | { action: 'noop' };

const AUTO_ARM_MESSAGE_KINDS = new Set([
  'deeptutor-lesson-start',
  'deeptutor-lesson-advance',
  'deeptutor-take-feedback',
]);

function resolveVoicePracticeInteractionState(owner: VoiceInteractionOwner): VoicePracticeInteractionState {
  switch (owner) {
    case 'practice-arming':
      return 'arming';
    case 'practice-armed':
      return 'armed';
    case 'practice-live':
      return 'live';
    case 'practice-processing':
      return 'processing';
    default:
      return 'idle';
  }
}

function resolveVoiceCoachInteractionState(owner: VoiceInteractionOwner): VoiceCoachInteractionState {
  switch (owner) {
    case 'coach-listening':
      return 'listening';
    case 'coach-processing':
      return 'processing';
    case 'coach-speaking':
      return 'speaking';
    default:
      return 'idle';
  }
}

function resolveDeepTutorCoachListeningState(
  voiceSpeechRecognitionStatus: VoiceCoachLoopRecognitionStatus,
): DeepTutorCoachListeningState {
  if (voiceSpeechRecognitionStatus === 'waiting') {
    return 'armed';
  }
  if (voiceSpeechRecognitionStatus === 'listening') {
    return 'listening';
  }
  return 'idle';
}

export function resolveVoiceInteractionOwner(options: VoiceInteractionOwnerOptions): VoiceInteractionOwner {
  if (options.voiceTakeProcessing) {
    return 'practice-processing';
  }
  if (options.voiceTakeActive) {
    return 'practice-live';
  }
  if (options.voiceTransportStatus === 'requesting-mic' || options.voiceTransportStatus === 'connecting') {
    return 'practice-arming';
  }
  if (
    options.voiceCoachQuestionStatus === 'sending'
    || options.voiceCoachTaskStatus === 'running'
    || options.voiceDeepTutorLessonStatus === 'loading'
    || options.voiceSpeechRecognitionStatus === 'processing'
  ) {
    return 'coach-processing';
  }
  if (options.voiceSpeechRecognitionStatus === 'waiting' || options.voiceSpeechRecognitionStatus === 'listening') {
    return 'coach-listening';
  }
  if (options.speechSynthesisBusy) {
    return 'coach-speaking';
  }
  if (options.voiceSessionArmed || options.voiceTransportStatus === 'streaming') {
    return 'practice-armed';
  }
  return 'idle';
}

export function createVoiceInteractionSnapshot(
  options: VoiceInteractionSnapshotOptions,
): VoiceInteractionSnapshot {
  const owner = resolveVoiceInteractionOwner(options);
  const practiceState = resolveVoicePracticeInteractionState(owner);
  const coachState = resolveVoiceCoachInteractionState(owner);
  return {
    currentMode: options.currentMode,
    currentSessionId: options.currentSessionId,
    isConnected: options.isConnected,
    owner,
    practiceState,
    coachState,
    hasConnectedVoiceSession: options.currentMode === 'voice' && Boolean(options.currentSessionId) && options.isConnected,
    hasCoachOwnership: coachState !== 'idle',
    hasPracticeOwnership: practiceState !== 'idle',
    hasActivePracticeTake: practiceState === 'live',
    hasPracticeProcessing: practiceState === 'processing',
    hasPracticeArmingTransition: practiceState === 'arming',
    hasCoachProcessing: coachState === 'processing',
    hasCoachListening: coachState === 'listening',
    hasCoachSpeaking: coachState === 'speaking',
  };
}

export function createDeepTutorVoiceInteractionState(
  options: DeepTutorVoiceInteractionStateOptions,
): DeepTutorVoiceInteractionState {
  const deeptutorInteraction = createDeepTutorVoiceSharedInteractionState(options.deeptutorVoiceState, {
    referenceMimicAction: options.referenceMimicAction,
  });
  const hasActiveGuideSession = options.hasActiveGuideSession ?? deeptutorInteraction.hasActiveGuideSession;
  const lessonLifecycle: DeepTutorVoiceLessonLifecycle = options.voiceDeepTutorLessonStatus === 'loading'
    ? 'syncing'
    : options.shouldRebuildLesson || !hasActiveGuideSession
      ? 'start-required'
      : 'active';
  const practiceIntent: DeepTutorPracticeIntent = deeptutorInteraction.practiceIntent as DeepTutorPracticeIntent;
  const hasReleasablePracticeOwnership = options.snapshot.practiceState === 'armed'
    || options.snapshot.practiceState === 'live';
  const hasPracticeReleaseBlocker = options.snapshot.practiceState === 'arming'
    || options.snapshot.practiceState === 'processing';
  const hasUnspokenCoachReply = Boolean(
    options.latestCoachMessageId && options.latestCoachMessageId !== options.lastSpokenCoachMessageId,
  );

  return {
    snapshot: options.snapshot,
    lessonMode: deeptutorInteraction.lessonMode,
    lessonLifecycle,
    guideStatus: deeptutorInteraction.guideStatus,
    runtimeOwner: deeptutorInteraction.runtimeOwner,
    coachListeningState: resolveDeepTutorCoachListeningState(options.voiceSpeechRecognitionStatus),
    practiceIntent,
    hasActiveGuideSession,
    hasHistoricalLessonState: deeptutorInteraction.hasHistoricalLessonState,
    hasReleasablePracticeOwnership,
    hasPracticeReleaseBlocker,
    canArmPractice: options.snapshot.hasConnectedVoiceSession
      && lessonLifecycle === 'active'
      && practiceIntent === 'practice'
      && options.snapshot.practiceState === 'idle',
    canReopenCoachListening: options.canUseVoiceCoachVoiceInput,
    canReopenCoachListeningAfterPracticeRelease: options.canUseVoiceCoachVoiceInputAfterRelease,
    hasUnspokenCoachReply,
    shouldStartLesson: lessonLifecycle === 'start-required',
  };
}

export function canUseVoiceCoachInput(
  snapshot: VoiceInteractionSnapshot,
  options: VoiceCoachInputEligibilityOptions,
): boolean {
  if (!snapshot.hasConnectedVoiceSession || !options.hasInputProvider) {
    return false;
  }
  if (snapshot.hasPracticeArmingTransition || snapshot.hasCoachProcessing) {
    return false;
  }
  if (!options.ignoreTakeState && (snapshot.hasActivePracticeTake || snapshot.hasPracticeProcessing)) {
    return false;
  }
  return true;
}

export function resolveVoicePracticeReleasePlan(
  snapshot: VoiceInteractionSnapshot,
): VoicePracticeReleasePlan {
  if (snapshot.hasActivePracticeTake || snapshot.hasPracticeProcessing || snapshot.hasPracticeArmingTransition) {
    return {
      action: 'blocked',
      reason: 'Finish the current practice cycle before reopening coach listening.',
    };
  }
  if (snapshot.hasPracticeOwnership) {
    return { action: 'disarm' };
  }
  return { action: 'noop' };
}

export function getVoiceInteractionOwnerCopy(owner: VoiceInteractionOwner): string | null {
  switch (owner) {
    case 'practice-arming':
      return 'Practice transport is taking the mic. Wait for the trainer to finish arming before switching back to coach talk.';
    case 'practice-armed':
      return 'Practice transport owns the mic right now. If you talk to the coach, practice will disarm first so the coach can listen cleanly.';
    case 'practice-live':
      return 'Practice take is live. Finish the take before asking the coach to listen again.';
    case 'practice-processing':
      return 'The latest take is being scored. Coach listening will reopen after the take finishes processing.';
    default:
      return null;
  }
}

export function shouldAutoArmVoicePracticeAfterCoachSpeech(options: VoiceCoachAutoArmOptions): boolean {
  if (!options.message) {
    return false;
  }
  if (
    options.currentMode !== 'voice'
    || !options.currentSessionId
    || !options.isConnected
    || !options.continuousEnabled
    || !options.hasActiveGuideSession
    || options.voiceSessionArmed
    || options.voiceTakeActive
    || options.voiceTakeProcessing
    || options.voiceTransportStatus === 'connecting'
    || options.voiceTransportStatus === 'requesting-mic'
    || options.voiceDeepTutorLessonStatus === 'loading'
    || options.voiceCoachTaskStatus === 'running'
    || options.voiceCoachQuestionStatus === 'sending'
  ) {
    return false;
  }
  if (!AUTO_ARM_MESSAGE_KINDS.has(options.message.kind)) {
    return false;
  }
  return options.referenceMimicAction === 'mimic' || options.referenceMimicAction === 'repeat';
}

function shouldStartVoiceCoachContinuousListeningFromSnapshot(
  options: VoiceCoachContinuousListeningOptions,
): boolean {
  return shouldStartVoiceCoachContinuousListening({
    canUseVoiceInput: canUseVoiceCoachInput(options.snapshot, {
      hasInputProvider: options.hasInputProvider,
    }),
    automaticTurnBoundarySupported: options.automaticTurnBoundarySupported,
    recoveryShouldDisableContinuous: options.recoveryShouldDisableContinuous,
    continuousEnabled: options.continuousEnabled,
    voiceSpeechRecognitionStatus: options.voiceSpeechRecognitionStatus,
    questionDraft: options.questionDraft,
    speechSynthesisBusy: options.snapshot.hasCoachSpeaking,
  });
}

export function resolveVoiceCoachRenderHandoffPlan(
  options: VoiceCoachRenderHandoffOptions,
): VoiceCoachRenderHandoffPlan {
  const hasUnspokenCoachReply = Boolean(
    options.latestCoachMessageId && options.latestCoachMessageId !== options.lastSpokenCoachMessageId,
  );

  if (options.canPlaySpeech && hasUnspokenCoachReply) {
    return { action: 'speak-latest-coach' };
  }
  if (shouldStartVoiceCoachContinuousListeningFromSnapshot(options)) {
    return { action: 'start-continuous-listening' };
  }
  return { action: 'noop' };
}

export function resolveVoiceCoachPostPlaybackHandoffPlan(
  options: VoiceCoachPostPlaybackHandoffOptions,
): VoiceCoachPostPlaybackHandoffPlan {
  if (shouldAutoArmVoicePracticeAfterCoachSpeech(options)) {
    return {
      action: 'arm-practice',
      notice: 'Tutor armed practice for the next coached pass.',
    };
  }
  if (shouldStartVoiceCoachContinuousListeningFromSnapshot(options)) {
    return { action: 'start-continuous-listening' };
  }
  return { action: 'noop' };
}

export function resolveDeepTutorVoiceResumePlan(
  state: DeepTutorVoiceInteractionState,
): DeepTutorVoiceResumePlan {
  if (!state.snapshot.currentSessionId || !state.snapshot.isConnected) {
    return { action: 'noop' };
  }
  if (state.shouldStartLesson) {
    return { action: 'start-lesson' };
  }
  if (state.snapshot.hasPracticeProcessing) {
    return { action: 'wait-for-take-processing' };
  }
  if (state.canArmPractice) {
    return { action: 'arm-practice' };
  }
  if (state.hasPracticeReleaseBlocker) {
    return { action: 'noop' };
  }
  if (state.hasReleasablePracticeOwnership) {
    if (state.canReopenCoachListeningAfterPracticeRelease) {
      return { action: 'disarm-practice-and-listen' };
    }
    if (state.hasUnspokenCoachReply) {
      return { action: 'disarm-practice-and-speak' };
    }
    return { action: 'disarm-practice' };
  }
  if (state.canReopenCoachListening) {
    return { action: 'reopen-coach-listening' };
  }
  if (state.hasUnspokenCoachReply) {
    return { action: 'speak-latest-coach' };
  }
  return { action: 'noop' };
}
