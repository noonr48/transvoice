import type { VoiceCoachMessage } from './state';

export type VoiceCoachLoopRecognitionStatus =
  | 'idle'
  | 'waiting'
  | 'listening'
  | 'processing'
  | 'error'
  | 'unsupported';

type VoiceCoachContinuousLoopOptions = {
  canUseVoiceInput: boolean;
  automaticTurnBoundarySupported: boolean;
  recoveryShouldDisableContinuous: boolean;
  continuousEnabled: boolean;
};

type VoiceCoachContinuousListenStartOptions = VoiceCoachContinuousLoopOptions & {
  voiceSpeechRecognitionStatus: VoiceCoachLoopRecognitionStatus;
  questionDraft: string;
  speechSynthesisBusy: boolean;
};

type VoiceCoachMessagePlaybackOptions = {
  currentMode: string;
  speechEnabled: boolean;
  speechProviderAvailable: boolean;
};

type VoiceCoachLatestReplyOptions = VoiceCoachMessagePlaybackOptions & {
  latestCoachMessage: VoiceCoachMessage | null;
  lastSpokenCoachMessageId: string | null;
};

export function shouldRunContinuousVoiceCoachLoop(options: VoiceCoachContinuousLoopOptions): boolean {
  return Boolean(
    options.canUseVoiceInput
    && options.automaticTurnBoundarySupported
    && !options.recoveryShouldDisableContinuous
    && options.continuousEnabled,
  );
}

export function shouldStartVoiceCoachContinuousListening(
  options: VoiceCoachContinuousListenStartOptions,
): boolean {
  if (!shouldRunContinuousVoiceCoachLoop(options)) {
    return false;
  }
  if (
    options.voiceSpeechRecognitionStatus === 'waiting'
    || options.voiceSpeechRecognitionStatus === 'listening'
    || options.voiceSpeechRecognitionStatus === 'processing'
  ) {
    return false;
  }
  if (options.questionDraft.trim()) {
    return false;
  }
  return !options.speechSynthesisBusy;
}

export function canPlayVoiceCoachMessage(options: VoiceCoachMessagePlaybackOptions): boolean {
  return options.currentMode === 'voice'
    && options.speechEnabled
    && options.speechProviderAvailable;
}

export function shouldSpeakLatestVoiceCoachReply(options: VoiceCoachLatestReplyOptions): boolean {
  return canPlayVoiceCoachMessage(options)
    && Boolean(options.latestCoachMessage)
    && options.latestCoachMessage?.id !== options.lastSpokenCoachMessageId;
}
