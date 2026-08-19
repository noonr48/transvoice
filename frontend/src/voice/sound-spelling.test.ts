import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  setupVoiceSoundSpelling,
  VOICE_SOUND_SPELLING_OFF_CLASS,
  VOICE_SOUND_SPELLING_STORAGE_KEY,
} from './sound-spelling';

function mountSoundSpellingDom(): { toggle: HTMLButtonElement; panel: HTMLElement } {
  document.body.innerHTML = `
    <div id="voice-lab-panel">
      <button type="button" id="voice-sound-spelling-toggle" aria-pressed="true">Sound-spelling: on</button>
    </div>
  `;
  return {
    toggle: document.getElementById('voice-sound-spelling-toggle') as HTMLButtonElement,
    panel: document.getElementById('voice-lab-panel') as HTMLElement,
  };
}

function createMemoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    dump: () => Object.fromEntries(map),
  };
}

describe('voice sound-spelling toggle', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults ON and toggles the container class + persists on click', () => {
    const { toggle, panel } = mountSoundSpellingDom();
    const storage = createMemoryStorage();
    const addLog = vi.fn();
    const soundSpelling = setupVoiceSoundSpelling({ doc: document, storage, addLog });
    soundSpelling.start();

    expect(soundSpelling.isOn()).toBe(true);
    expect(panel.classList.contains(VOICE_SOUND_SPELLING_OFF_CLASS)).toBe(false);
    expect(toggle.textContent).toBe('Sound-spelling: on');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    expect(soundSpelling.isOn()).toBe(false);
    expect(panel.classList.contains(VOICE_SOUND_SPELLING_OFF_CLASS)).toBe(true);
    expect(toggle.textContent).toBe('Sound-spelling: off');
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(storage.dump()[VOICE_SOUND_SPELLING_STORAGE_KEY]).toBe('off');
    expect(addLog).toHaveBeenCalledWith('system', '[voice-surface] sound-spelling off');

    toggle.click();
    expect(soundSpelling.isOn()).toBe(true);
    expect(panel.classList.contains(VOICE_SOUND_SPELLING_OFF_CLASS)).toBe(false);
    expect(storage.dump()[VOICE_SOUND_SPELLING_STORAGE_KEY]).toBe('on');
    soundSpelling.dispose();
  });

  it('restores a stored off preference at start', () => {
    const { toggle, panel } = mountSoundSpellingDom();
    const storage = createMemoryStorage({ [VOICE_SOUND_SPELLING_STORAGE_KEY]: 'off' });
    const soundSpelling = setupVoiceSoundSpelling({ doc: document, storage });
    soundSpelling.start();

    expect(soundSpelling.isOn()).toBe(false);
    expect(panel.classList.contains(VOICE_SOUND_SPELLING_OFF_CLASS)).toBe(true);
    expect(toggle.textContent).toBe('Sound-spelling: off');
    soundSpelling.dispose();
  });

  it('survives absent storage and absent DOM nodes', () => {
    // No DOM at all -> start/dispose are safe no-ops.
    const detached = setupVoiceSoundSpelling({ doc: document, storage: null });
    expect(() => {
      detached.start();
      detached.dispose();
    }).not.toThrow();
    expect(detached.isOn()).toBe(true);
  });
});
