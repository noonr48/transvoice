import { describe, expect, it, vi } from 'vitest';

import { createVoiceCoachThreadLineChannel } from './coach-thread-line';
import type { VoiceCoachMessage } from './state';

function createChannel(overrides: {
  isCoachSpeaking?: () => boolean;
  speakStarts?: boolean;
} = {}) {
  const appended: VoiceCoachMessage[] = [];
  const spoken: VoiceCoachMessage[] = [];
  const claimed: VoiceCoachMessage[] = [];
  let tick = 1_000;
  const appendMessage = vi.fn((message: VoiceCoachMessage) => { appended.push(message); });
  const speakMessage = vi.fn((message: VoiceCoachMessage) => {
    spoken.push(message);
    return overrides.speakStarts ?? true;
  });
  const markSpoken = vi.fn((message: VoiceCoachMessage) => { claimed.push(message); });
  const channel = createVoiceCoachThreadLineChannel({
    appendMessage,
    speakMessage,
    markSpoken,
    isCoachSpeaking: overrides.isCoachSpeaking ?? (() => false),
    now: () => { tick += 1; return tick; },
  });
  return { channel, appended, spoken, claimed, appendMessage, speakMessage, markSpoken };
}

describe('voice coach thread line channel', () => {
  it('speaks the SAME message it appended — same id, so nothing can say it twice', () => {
    // The load-bearing invariant. speakCoachMessage marks the id it spoke as the
    // last-spoken coach message, and the render handoff speaks the latest coach
    // message only while that id is still unspoken. A look-alike copy would
    // leave the thread line looking unspoken and the learner would hear the
    // acknowledgment a second time.
    const { channel, appended, spoken } = createChannel();

    const appendedMessage = channel.append('Heard that — steady and easy.');
    expect(channel.speak('Heard that — steady and easy.')).toBe(true);

    expect(appended).toHaveLength(1);
    expect(spoken).toHaveLength(1);
    expect(spoken[0]).toBe(appendedMessage);
    expect(spoken[0].id).toBe(appended[0].id);
  });

  it('trims once and consistently across both surfaces', () => {
    const { channel, appended, spoken } = createChannel();

    channel.append('   Heard that — steady and easy.   ');
    expect(channel.speak('   Heard that — steady and easy.   ')).toBe(true);

    expect(appended[0].content).toBe('Heard that — steady and easy.');
    expect(spoken[0].content).toBe('Heard that — steady and easy.');
  });

  it('never interrupts a tutor who is already speaking — and CLAIMS the line so nothing else says it', () => {
    // Merely declining is not enough. The append schedules a render, and the
    // render handoff speaks the latest coach message whenever its id is still
    // unspoken — that branch has no is-speaking guard, and the speak path stops
    // the current utterance before playing. Claiming the id is what actually
    // withholds the line instead of deferring it into the tutor's sentence.
    const { channel, appended, claimed, speakMessage } = createChannel({ isCoachSpeaking: () => true });

    const message = channel.append('Heard that — steady and easy.');
    expect(channel.speak('Heard that — steady and easy.')).toBe(false);

    // The record of the turn still landed; only the utterance was withheld.
    expect(appended).toHaveLength(1);
    expect(speakMessage).not.toHaveBeenCalled();
    expect(claimed).toEqual([message]);
  });

  it('reports a speech path that could not start, claims the line, and never throws', () => {
    const { channel, appended, claimed, speakMessage } = createChannel({ speakStarts: false });

    const message = channel.append('Heard that — steady and easy.');
    expect(channel.speak('Heard that — steady and easy.')).toBe(false);

    expect(speakMessage).toHaveBeenCalledTimes(1);
    expect(appended).toHaveLength(1);
    // Text is then the whole surface — so no later render handoff may say it.
    expect(claimed).toEqual([message]);
  });

  it('claims nothing when it declines a line that is not the one just appended', () => {
    // Nothing was withheld here, so nothing may be marked as said.
    const { channel, claimed, markSpoken } = createChannel();
    channel.append('Welcome back.');
    expect(channel.speak('Heard that — steady and easy.')).toBe(false);
    expect(markSpoken).not.toHaveBeenCalled();
    expect(claimed).toHaveLength(0);
  });

  it('gives two lines appended in the same millisecond distinct ids', () => {
    // An id is what marks a message spoken; two messages sharing one id would
    // let a claim on the first silence the second.
    const appended: VoiceCoachMessage[] = [];
    const channel = createVoiceCoachThreadLineChannel({
      appendMessage: (message) => { appended.push(message); },
      speakMessage: () => true,
      markSpoken: () => undefined,
      isCoachSpeaking: () => false,
      now: () => 1_000,
    });
    channel.append('One.');
    channel.append('Two.');
    expect(appended).toHaveLength(2);
    expect(appended[0].id).not.toBe(appended[1].id);
  });

  it('refuses to speak text that is not the line just appended', () => {
    const { channel, speakMessage } = createChannel();

    channel.append('Heard that — steady and easy.');
    // A later append moves the target; the stale text no longer matches.
    channel.append('Welcome back.');
    expect(channel.speak('Heard that — steady and easy.')).toBe(false);
    expect(speakMessage).not.toHaveBeenCalled();

    // ...and the current line still speaks.
    expect(channel.speak('Welcome back.')).toBe(true);
  });

  it('speaking before anything was appended is a quiet no-op', () => {
    const { channel, speakMessage, markSpoken } = createChannel();
    expect(channel.speak('Heard that — steady and easy.')).toBe(false);
    expect(speakMessage).not.toHaveBeenCalled();
    expect(markSpoken).not.toHaveBeenCalled();
  });

  it('drops empty copy on both surfaces rather than inventing a line', () => {
    const { channel, appendMessage, speakMessage } = createChannel();

    expect(channel.append('   ')).toBeNull();
    expect(appendMessage).not.toHaveBeenCalled();
    expect(channel.speak('   ')).toBe(false);
    expect(speakMessage).not.toHaveBeenCalled();
  });

  it('keeps the caller-supplied kind, so existing thread lines are unchanged', () => {
    const { channel, appended } = createChannel();
    channel.append('That take was lost.', 'lost-turn');
    expect(appended[0].kind).toBe('lost-turn');
    expect(appended[0].role).toBe('coach');
    expect(appended[0].channel).toBe('coach');
  });
});
