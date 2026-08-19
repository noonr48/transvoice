import { describe, expect, it } from 'vitest';

import { renderVoiceLessonCardStrip } from './card-strip';

describe('renderVoiceLessonCardStrip', () => {
  it('shows the active practice line while the tutor card is unavailable', () => {
    const element = document.createElement('div');

    renderVoiceLessonCardStrip({
      element,
      card: null,
      karaoke: [],
      fallbackPhrase: 'Can you speak freely where you are?',
    });

    expect(element.textContent).toBe('Can you speak freely where you are?');
    expect(element.querySelector('.voice-lesson-card-empty')).not.toBeNull();
  });

  it('uses the calm loading copy only when neither card nor practice line exists', () => {
    const element = document.createElement('div');

    renderVoiceLessonCardStrip({
      element,
      card: null,
      karaoke: [],
      fallbackPhrase: '   ',
    });

    expect(element.textContent).toBe('Your tutor is preparing a phrase…');
  });
});
