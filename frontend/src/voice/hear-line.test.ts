import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupVoiceHearLine } from './hear-line';

function mountHearLineDom(): HTMLButtonElement {
  document.body.innerHTML = '<button type="button" id="voice-hear-line" disabled>Hear it in your target voice</button>';
  return document.getElementById('voice-hear-line') as HTMLButtonElement;
}

describe('voice hear-this-line', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  // Crossing proof: clicking invokes the injected speech entry with EXACTLY the
  // current line text (the app wires speakLine to the existing coach TTS path).
  it('speaks exactly the current line text on click', () => {
    const button = mountHearLineDom();
    const speakLine = vi.fn(() => true);
    const addLog = vi.fn();
    const effect = vi.fn();
    window.addEventListener('tv-control-effect', effect, { once: true });
    const hearLine = setupVoiceHearLine({
      doc: document,
      getLineText: () => '  Could you say that again?  ',
      speakLine,
      isSpeaking: () => false,
      addLog,
    });
    hearLine.start();

    expect(button.disabled).toBe(false);
    button.click();

    expect(speakLine).toHaveBeenCalledTimes(1);
    expect(speakLine).toHaveBeenCalledWith('Could you say that again?');
    expect(addLog).toHaveBeenCalledWith('system', '[voice-surface] hear-line spoken');
    expect(effect).toHaveBeenCalledWith(expect.objectContaining({
      detail: { control: 'voice-hear-line', effect: 'speech-started', status: 'succeeded' },
    }));
    hearLine.dispose();
  });

  it('is disabled with no line and does not speak', () => {
    const button = mountHearLineDom();
    const speakLine = vi.fn(() => true);
    const hearLine = setupVoiceHearLine({
      doc: document,
      getLineText: () => null,
      speakLine,
    });
    hearLine.start();

    expect(button.disabled).toBe(true);
    button.click();
    expect(speakLine).not.toHaveBeenCalled();
    hearLine.dispose();
  });

  it('is disabled while the coach is already speaking', () => {
    const button = mountHearLineDom();
    const speakLine = vi.fn(() => true);
    let speaking = true;
    const hearLine = setupVoiceHearLine({
      doc: document,
      getLineText: () => 'A flat white, please.',
      speakLine,
      isSpeaking: () => speaking,
    });
    hearLine.start();

    expect(button.disabled).toBe(true);
    button.click();
    expect(speakLine).not.toHaveBeenCalled();

    // Speech finished -> the render-loop sync re-enables the button.
    speaking = false;
    hearLine.sync();
    expect(button.disabled).toBe(false);
    button.click();
    expect(speakLine).toHaveBeenCalledWith('A flat white, please.');
    hearLine.dispose();
  });

  it('is disabled when no speech provider is available', () => {
    const button = mountHearLineDom();
    const speakLine = vi.fn(() => true);
    let available = false;
    const hearLine = setupVoiceHearLine({
      doc: document,
      getLineText: () => 'A flat white, please.',
      speakLine,
      canSpeak: () => available,
    });
    hearLine.start();

    expect(button.disabled).toBe(true);
    button.click();
    expect(speakLine).not.toHaveBeenCalled();

    available = true;
    hearLine.sync();
    expect(button.disabled).toBe(false);
    hearLine.dispose();
  });

  it('logs a quiet warning when the speech path declines to start', () => {
    mountHearLineDom();
    const addLog = vi.fn();
    const effect = vi.fn();
    window.addEventListener('tv-control-effect', effect, { once: true });
    const hearLine = setupVoiceHearLine({
      doc: document,
      getLineText: () => 'Take it easy.',
      speakLine: () => false,
      addLog,
    });
    hearLine.start();
    (document.getElementById('voice-hear-line') as HTMLButtonElement).click();
    expect(addLog).toHaveBeenCalledWith(
      'warning',
      '[voice-surface] hear-line could not start (speech path unavailable)',
    );
    expect(effect).toHaveBeenCalledWith(expect.objectContaining({
      detail: { control: 'voice-hear-line', effect: 'speech-failed', status: 'failed' },
    }));
    hearLine.dispose();
  });
});
