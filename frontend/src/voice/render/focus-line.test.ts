import { describe, expect, it } from 'vitest';
import { renderVoiceFocusLine } from './focus-line';

describe('voice focus line — Approach B inline emphasis', () => {
  it('falls back to plain text when no cue sheet is loaded', () => {
    const el = document.createElement('h3');
    renderVoiceFocusLine(el, 'yeah, no worries', null);
    expect(el.textContent).toBe('yeah, no worries');
    expect(el.querySelector('span')).toBeNull();
  });

  it('weaves per-word emphasis from the cue tokens and preserves the sentence', () => {
    const el = document.createElement('h3');
    renderVoiceFocusLine(el, 'no worries, that', {
      tokens: [
        { text: 'no', cue: null, emphasis: 'steady' },
        { text: 'worries,', cue: null, emphasis: 'keep-bright' },
        { text: 'that', cue: null, emphasis: 'lift-ending' },
      ],
    } as never);

    expect(el.querySelector('.voice-fl-bright')?.textContent).toBe('worries,');
    expect(el.querySelector('.voice-fl-lift')?.textContent).toBe('that');
    // 'steady' stays a plain text node (no span).
    expect(el.querySelectorAll('span')).toHaveLength(2);
    expect(el.textContent).toBe('no worries, that');
  });

  it('ignores unknown emphasis values (renders plain word)', () => {
    const el = document.createElement('h3');
    renderVoiceFocusLine(el, 'hello there', {
      tokens: [
        { text: 'hello', cue: null, emphasis: 'mystery' },
        { text: 'there', cue: null, emphasis: 'light-start' },
      ],
    } as never);
    expect(el.querySelector('.voice-fl-light')?.textContent).toBe('there');
    expect(el.querySelectorAll('span')).toHaveLength(1);
    expect(el.textContent).toBe('hello there');
  });

  it('never throws on a null element', () => {
    expect(() => renderVoiceFocusLine(null, 'x', null)).not.toThrow();
  });
});
