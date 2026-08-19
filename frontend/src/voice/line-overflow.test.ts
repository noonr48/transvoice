import { beforeEach, describe, expect, it, vi } from 'vitest';
import { setupVoiceLineOverflow } from './line-overflow';

function mountLineActionsDom(): { toggle: HTMLButtonElement; tray: HTMLElement } {
  document.body.innerHTML = `
    <div id="voice-line-actions">
      <button id="voice-line-next" type="button">Next Line</button>
      <button id="voice-line-more-toggle" type="button" aria-expanded="false" aria-controls="voice-line-overflow">⋯ More</button>
      <div id="voice-line-overflow" class="voice-line-overflow hidden">
        <div id="voice-lesson-actions">
          <button id="voice-deeptutor-start" type="button">Guided Coach</button>
        </div>
        <button id="voice-line-regenerate" type="button">Regenerate</button>
        <button id="voice-line-pin" type="button">Pin Line</button>
      </div>
    </div>
  `;
  return {
    toggle: document.getElementById('voice-line-more-toggle') as HTMLButtonElement,
    tray: document.getElementById('voice-line-overflow') as HTMLElement,
  };
}

describe('voice line-action overflow disclosure', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts folded with aria-expanded=false', () => {
    const { toggle, tray } = mountLineActionsDom();
    const overflow = setupVoiceLineOverflow({ doc: document });
    overflow.start();

    expect(overflow.isOpen()).toBe(false);
    expect(tray.classList.contains('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('click opens the tray, sets aria-expanded, and click again folds it', () => {
    const { toggle, tray } = mountLineActionsDom();
    const addLog = vi.fn();
    const overflow = setupVoiceLineOverflow({ doc: document, addLog });
    overflow.start();

    toggle.click();
    expect(overflow.isOpen()).toBe(true);
    expect(tray.classList.contains('hidden')).toBe(false);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(addLog).toHaveBeenCalledWith('system', '[voice-surface] line overflow open');

    toggle.click();
    expect(overflow.isOpen()).toBe(false);
    expect(tray.classList.contains('hidden')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the folded buttons intact and focusable inside the tray', () => {
    mountLineActionsDom();
    const overflow = setupVoiceLineOverflow({ doc: document });
    overflow.start();

    for (const id of ['voice-deeptutor-start', 'voice-line-regenerate', 'voice-line-pin']) {
      const button = document.getElementById(id);
      expect(button, id).not.toBeNull();
      expect(button?.tagName).toBe('BUTTON');
    }
  });

  it('dispose removes the listener', () => {
    const { toggle } = mountLineActionsDom();
    const overflow = setupVoiceLineOverflow({ doc: document });
    overflow.start();
    overflow.dispose();

    toggle.click();
    expect(overflow.isOpen()).toBe(false);
  });

  it('tolerates an absent toggle or tray without throwing', () => {
    document.body.innerHTML = '<div></div>';
    const overflow = setupVoiceLineOverflow({ doc: document });
    expect(() => overflow.start()).not.toThrow();
    expect(overflow.isOpen()).toBe(false);
    expect(() => overflow.dispose()).not.toThrow();
  });
});
