import type { VoiceBackendPayload, VoiceCoachMessageChannel } from './state';

export type VoiceCoachQuestionStatus = 'idle' | 'sending' | 'error';

type VoiceCoachRequestControllerOptions = {
  setQuestionStatus: (status: VoiceCoachQuestionStatus) => void;
  setQuestionError: (error: string | null) => void;
  setPendingChannel: (channel: VoiceCoachMessageChannel) => void;
  clearPendingState: () => void;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  render: () => void;
  clearQuestionInput?: () => void;
  setLastSpokenCoachMessageId?: (messageId: string | null) => void;
};

export type VoiceCoachRequestOptions = {
  pendingChannel: VoiceCoachMessageChannel;
  request: () => Promise<VoiceBackendPayload>;
  clearInputOnSuccess?: boolean;
  repeatLatestCoachOnSuccess?: boolean;
};

export function createVoiceCoachRequestController(options: VoiceCoachRequestControllerOptions) {
  async function submitRequest(requestOptions: VoiceCoachRequestOptions): Promise<VoiceBackendPayload> {
    options.setQuestionStatus('sending');
    options.setQuestionError(null);
    options.setPendingChannel(requestOptions.pendingChannel);
    options.render();

    try {
      const data = await requestOptions.request();
      options.applyVoiceBackendPayload(data);
      options.setQuestionStatus('idle');
      options.setQuestionError(null);
      options.clearPendingState();

      if (requestOptions.clearInputOnSuccess) {
        options.clearQuestionInput?.();
      }

      if (requestOptions.repeatLatestCoachOnSuccess) {
        options.setLastSpokenCoachMessageId?.(null);
      }

      options.render();
      return data;
    } catch (error) {
      options.setQuestionStatus('error');
      options.setQuestionError(error instanceof Error ? error.message : String(error));
      options.clearPendingState();
      options.render();
      throw error;
    }
  }

  return {
    submitRequest,
  };
}
