import type { VoiceCoachSpeechProvider } from './coach-speech';
import type { VoiceCoachMessage } from './state';
import { VOICE_COACH_SPEAKING_RATE } from './coach-speech-rate';

export type VoiceCoachRuntimeService = {
  canSpeakCoachMessage: () => boolean;
  startCoachListening: () => Promise<boolean>;
  reopenCoachListeningWithNotice: (notice?: string) => Promise<boolean>;
  speakCoachMessage: (message: VoiceCoachMessage, rate?: number) => boolean;
  stopCoachListening: (resetTranscript?: boolean) => void;
  stopCoachSpeech: () => void;
};

type VoiceCoachRuntimeServiceOptions = {
  getCurrentMode: () => string;
  canPlaySpeech: () => boolean;
  getSpeechProvider: () => VoiceCoachSpeechProvider | null;
  startListeningTransport: () => Promise<boolean | void>;
  stopListeningTransport: (resetTranscript?: boolean) => void;
  stopSpeechTransport: () => void;
  playSpeechTransport: (
    message: VoiceCoachMessage,
    options: { provider: VoiceCoachSpeechProvider; rate: number },
  ) => boolean;
  addTerminalLine: (type: 'system' | 'user' | 'assistant' | 'error', content: string) => void;
  render: () => void;
};

export function createVoiceCoachRuntimeService(
  options: VoiceCoachRuntimeServiceOptions,
): VoiceCoachRuntimeService {
  function canSpeakCoachMessage(): boolean {
    return options.getCurrentMode() === 'voice'
      && options.canPlaySpeech()
      && Boolean(options.getSpeechProvider());
  }

  async function startCoachListening(): Promise<boolean> {
    try {
      const started = await options.startListeningTransport();
      return started !== false;
    } catch {
      return false;
    }
  }

  async function reopenCoachListeningWithNotice(notice = 'Coach listening reopened.'): Promise<boolean> {
    const started = await startCoachListening();
    if (!started) {
      return false;
    }
    options.addTerminalLine('system', notice);
    options.render();
    return true;
  }

  function speakCoachMessage(message: VoiceCoachMessage, rate = VOICE_COACH_SPEAKING_RATE): boolean {
    if (options.getCurrentMode() !== 'voice') {
      options.stopSpeechTransport();
      options.stopListeningTransport(true);
      return false;
    }

    const provider = options.getSpeechProvider();
    if (!provider || !options.canPlaySpeech()) {
      return false;
    }

    options.stopListeningTransport(false);
    options.stopSpeechTransport();
    return options.playSpeechTransport(message, {
      provider,
      rate,
    });
  }

  function stopCoachListening(resetTranscript = false): void {
    options.stopListeningTransport(resetTranscript);
  }

  function stopCoachSpeech(): void {
    options.stopSpeechTransport();
  }

  return {
    canSpeakCoachMessage,
    startCoachListening,
    reopenCoachListeningWithNotice,
    speakCoachMessage,
    stopCoachListening,
    stopCoachSpeech,
  };
}
