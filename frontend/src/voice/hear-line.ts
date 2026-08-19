// Surfacing wave — "Hear it in your target voice".
//
// A quiet button beside the active practice line that speaks the CURRENT line
// text through the EXISTING coach TTS speech path (no LLM call — the caller
// wires `speakLine` to the same speakCoachMessage entry coach replies use,
// which already threads referenceClipId + provider gating). Disabled when no
// line is loaded or the coach is already speaking. Self-contained module:
// owns its DOM lookup + listener; the app calls sync() from the render loop.

import type { VoiceSpeechEmphasis } from './contracts';

export type VoiceHearLineOptions = {
  doc: Document;
  /** The current practice line text (null/empty -> button disabled). */
  getLineText: () => string | null;
  /**
   * Word-emphasis channel: the card token the demo should lean on, or null when
   * the card authors no stress. Absent -> the line is spoken unshaped, exactly
   * as before. Resolved at click time so a card swap is always reflected.
   */
  getLineEmphasis?: () => VoiceSpeechEmphasis | null;
  /**
   * Speak through the existing TTS path; returns whether playback started
   * (the speakCoachMessage contract). The optional emphasis rides with the
   * utterance and is what the gateway shapes the target text around.
   */
  speakLine: (text: string, emphasis?: VoiceSpeechEmphasis | null) => boolean;
  /** Whether the active runtime currently has a usable speech provider. */
  canSpeak?: () => boolean;
  /** True while coach speech is already playing/processing -> button disabled. */
  isSpeaking?: () => boolean;
  addLog?: (kind: 'system' | 'warning', message: string) => void;
};

export function setupVoiceHearLine(options: VoiceHearLineOptions) {
  const buttonEl = options.doc.getElementById('voice-hear-line') as HTMLButtonElement | null;
  let onClick: (() => void) | null = null;

  function log(kind: 'system' | 'warning', message: string): void {
    options.addLog?.(kind, message);
  }

  function resolveLineText(): string | null {
    const raw = options.getLineText();
    const text = typeof raw === 'string' ? raw.trim() : '';
    return text ? text : null;
  }

  function sync(): void {
    if (!buttonEl) return;
    const speaking = options.isSpeaking?.() ?? false;
    const speechAvailable = options.canSpeak?.() ?? true;
    buttonEl.disabled = !resolveLineText() || speaking || !speechAvailable;
  }

  function start(): void {
    if (!buttonEl || onClick) return;
    onClick = () => {
      const text = resolveLineText();
      if (!text || (options.isSpeaking?.() ?? false) || !(options.canSpeak?.() ?? true)) return;
      // Resolved at click time so a card swap is always reflected. Call shape is
      // unchanged when the card authors no stress.
      const lineEmphasis = options.getLineEmphasis?.() ?? null;
      const started = lineEmphasis
        ? options.speakLine(text, lineEmphasis)
        : options.speakLine(text);
      options.doc.defaultView?.dispatchEvent(new CustomEvent('tv-control-effect', {
        detail: {
          control: 'voice-hear-line',
          effect: started ? 'speech-started' : 'speech-failed',
          status: started ? 'succeeded' : 'failed',
        },
      }));
      if (started) {
        log('system', '[voice-surface] hear-line spoken');
      } else {
        log('warning', '[voice-surface] hear-line could not start (speech path unavailable)');
      }
      sync();
    };
    buttonEl.addEventListener('click', onClick);
    sync();
  }

  function dispose(): void {
    if (buttonEl && onClick) {
      buttonEl.removeEventListener('click', onClick);
      onClick = null;
    }
  }

  return { start, sync, dispose };
}

export type VoiceHearLine = ReturnType<typeof setupVoiceHearLine>;
