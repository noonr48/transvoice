import type { createVoiceApi } from './api';
import type { VoiceHostAssemblyOptions } from './host-assembly';

type VoiceHostAssemblyCompositionOptions = VoiceHostAssemblyOptions['composition'];
type VoiceHostAssemblyOrchestrationOptions = VoiceHostAssemblyOptions['orchestration'];

type VoiceHostAssemblyConfigVoiceApi =
  VoiceHostAssemblyOrchestrationOptions['voiceApi']
  & Pick<
    ReturnType<typeof createVoiceApi>,
    | 'postVoiceSessionScope'
    | 'prepareConditioningLatents'
    | 'submitRuntimeCoachQuestion'
  >;

type VoiceHostWindowRef = {
  location: Pick<Location, 'hostname' | 'protocol'>;
  speechSynthesis?: Pick<SpeechSynthesis, 'pending' | 'speaking'>;
  __tvCoach?: {
    isSpeaking?: () => boolean;
  };
};

export type VoiceHostAssemblyConfigOptions = {
  store: VoiceHostAssemblyOptions['store'];
  runtimeStatusController: VoiceHostAssemblyOptions['runtimeStatusController'];
  voiceApi: VoiceHostAssemblyConfigVoiceApi;
  kernelUrl: VoiceHostAssemblyOrchestrationOptions['kernelUrl'];
  kernelWsUrl: VoiceHostAssemblyOrchestrationOptions['kernelWsUrl'];
  voiceTrainerUrl: string;
  voiceTrainerToken: string | null;
  voiceInputLiveBearerToken?: string | null;
  getVoiceInputLiveLeaseId?: () => string | null;
  releasePracticeForCoachListening?: () => Promise<void>;
  getCurrentMode: VoiceHostAssemblyCompositionOptions['getCurrentMode'];
  getCurrentSessionId: VoiceHostAssemblyCompositionOptions['getCurrentSessionId'];
  getIsConnected: VoiceHostAssemblyCompositionOptions['getIsConnected'];
  /**
   * Must return one stable object per session ownership epoch and rotate to a
   * fresh, never-reused object on session ID change, disconnect, or reconnect.
   */
  getSessionLease: VoiceHostAssemblyOrchestrationOptions['getSessionLease'];
  resolveSessionMode: VoiceHostAssemblyCompositionOptions['resolveSessionMode'];
  addTerminalLine: VoiceHostAssemblyOrchestrationOptions['addTerminalLine'];
  appendCoachLine?: VoiceHostAssemblyOrchestrationOptions['appendCoachLine'];
  speakCoachLine?: VoiceHostAssemblyOrchestrationOptions['speakCoachLine'];
  getVoiceCoachQuestionInput: VoiceHostAssemblyOrchestrationOptions['getVoiceCoachQuestionInput'];
  getVoiceTargetPresetSelect: VoiceHostAssemblyOrchestrationOptions['getVoiceTargetPresetSelect'];
  getVoiceReferencePlayer: VoiceHostAssemblyOrchestrationOptions['getVoiceReferencePlayer'];
  getVoiceConditioningPromptTextInput: VoiceHostAssemblyOrchestrationOptions['getVoiceConditioningPromptTextInput'];
  getVoiceConditioningPromptFileInput: VoiceHostAssemblyOrchestrationOptions['getVoiceConditioningPromptFileInput'];
  getVoiceConditioningReferenceFileInput: VoiceHostAssemblyOrchestrationOptions['getVoiceConditioningReferenceFileInput'];
  getDomBindings: VoiceHostAssemblyOrchestrationOptions['getDomBindings'];
  document?: VoiceHostAssemblyCompositionOptions['document'];
  window: VoiceHostWindowRef;
  // Wave B lesson surface: optional raw-payload side-channel (see host-assembly).
  onBackendPayload?: (payload: unknown) => void;
};

function isVoiceSpeechSynthesisBusy(windowRef: VoiceHostWindowRef): boolean {
  const browserSpeechBusy = Boolean(
    windowRef.speechSynthesis
    && (windowRef.speechSynthesis.speaking || windowRef.speechSynthesis.pending),
  );
  if (browserSpeechBusy) {
    return true;
  }
  try {
    return windowRef.__tvCoach?.isSpeaking?.() === true;
  } catch {
    return false;
  }
}

function getVoiceSessionStreamUrl(
  windowRef: Pick<VoiceHostWindowRef, 'location'>,
  voiceTrainerUrl: string,
  voiceTrainerToken: string | null,
  voiceSessionId: string,
): string {
  const token = typeof voiceTrainerToken === 'string' && voiceTrainerToken.trim()
    ? voiceTrainerToken.trim()
    : '';
  try {
    const baseUrl = new URL(voiceTrainerUrl);
    const protocol = baseUrl.protocol === 'https:' ? 'wss' : 'ws';
    const basePath = baseUrl.pathname.replace(/\/$/, '');
    const url = new URL(
      `${protocol}://${baseUrl.host}${basePath}/api/v1/voice/sessions/${encodeURIComponent(voiceSessionId)}/stream`,
    );
    if (token) {
      url.searchParams.set('token', token);
    }
    return url.toString();
  } catch {
    const protocol = windowRef.location.protocol === 'https:' ? 'wss' : 'ws';
    const base = `${protocol}://${windowRef.location.hostname}:8002/api/v1/voice/sessions/${encodeURIComponent(voiceSessionId)}/stream`;
    if (!token) {
      return base;
    }
    return `${base}?token=${encodeURIComponent(token)}`;
  }
}

export function createVoiceHostAssemblyConfig(
  options: VoiceHostAssemblyConfigOptions,
): VoiceHostAssemblyOptions {
  return {
    store: options.store,
    runtimeStatusController: options.runtimeStatusController,
    onBackendPayload: options.onBackendPayload,
    composition: {
      getCurrentMode: options.getCurrentMode,
      getCurrentSessionId: options.getCurrentSessionId,
      getIsConnected: options.getIsConnected,
      resolveSessionMode: options.resolveSessionMode,
      getCoachQuestionInput: options.getVoiceCoachQuestionInput,
      submitRuntimeCoachQuestionRequest: (
        sessionId,
        question,
        audioBase64,
        audioFormat,
        listeningTurnId,
      ) => {
        if (!listeningTurnId) {
          return options.voiceApi.submitRuntimeCoachQuestion(
            sessionId,
            question,
            audioBase64,
            audioFormat,
          );
        }
        return options.voiceApi.submitRuntimeCoachQuestion(
          sessionId,
          question,
          audioBase64,
          audioFormat,
          listeningTurnId,
        );
      },
      prepareConditioningLatentsRequest: (sessionId, target, file, promptText) => (
        options.voiceApi.prepareConditioningLatents(sessionId, target, file, promptText)
      ),
      // Scope intents post through the kernel-backed api (this replaces the
      // composition's same-origin fetch default, so cross-origin connection
      // profiles reach the right backend).
      postVoiceSessionScope: (sessionId, scope) => (
        options.voiceApi.postVoiceSessionScope(sessionId, scope)
      ),
      isSpeechSynthesisBusy: () => isVoiceSpeechSynthesisBusy(options.window),
      getVoiceSessionStreamUrl: (voiceSessionId) => (
        getVoiceSessionStreamUrl(options.window, options.voiceTrainerUrl, options.voiceTrainerToken, voiceSessionId)
      ),
      document: options.document,
    },
    orchestration: {
      voiceApi: options.voiceApi,
      kernelUrl: options.kernelUrl,
      kernelWsUrl: options.kernelWsUrl,
      voiceInputLiveBearerToken: options.voiceInputLiveBearerToken ?? null,
      getVoiceInputLiveLeaseId: options.getVoiceInputLiveLeaseId,
      releasePracticeForCoachListening: options.releasePracticeForCoachListening,
      getCurrentMode: options.getCurrentMode,
      getCurrentSessionId: options.getCurrentSessionId,
      getIsConnected: options.getIsConnected,
      getSessionLease: options.getSessionLease,
      addTerminalLine: options.addTerminalLine,
      appendCoachLine: options.appendCoachLine,
      speakCoachLine: options.speakCoachLine,
      getVoiceCoachQuestionInput: options.getVoiceCoachQuestionInput,
      getVoiceTargetPresetSelect: options.getVoiceTargetPresetSelect,
      getVoiceReferencePlayer: options.getVoiceReferencePlayer,
      getVoiceConditioningPromptTextInput: options.getVoiceConditioningPromptTextInput,
      getVoiceConditioningPromptFileInput: options.getVoiceConditioningPromptFileInput,
      getVoiceConditioningReferenceFileInput: options.getVoiceConditioningReferenceFileInput,
      getDomBindings: options.getDomBindings,
    },
  };
}
