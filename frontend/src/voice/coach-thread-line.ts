// Coach thread line channel — append a plain coach line, and (optionally) SAY it.
//
// 2026-07-26 field repair. A wordless-practice acknowledgment used to reach the
// coach thread as TEXT ONLY. On a voice-first surface that is indistinguishable
// from the tutor having stopped responding, which is exactly what was reported:
// the learner hummed three times and heard nothing back.
//
// The whole reason this is a module rather than two closures in the bootstrap is
// the ONE invariant below, which is easy to state and easy to break silently:
//
//   The message that is SPOKEN must be the same message object — the same id —
//   that was APPENDED.
//
// speakCoachMessage records the id it spoke as the last-spoken coach message,
// and the render handoff decides whether to speak the latest coach message by
// asking whether that id is still unspoken (orchestrator.ts
// resolveVoiceCoachRenderHandoffPlan). Speaking a fresh look-alike message would
// therefore leave the appended thread line looking unspoken, and the learner
// would hear the acknowledgment a second time. Same id, said once.

import type { VoiceCoachMessage } from './state';

export type VoiceCoachThreadLineChannelOptions = {
  /** Put the message into the coach thread (and render). */
  appendMessage: (message: VoiceCoachMessage) => void;
  /** True while the tutor is audibly speaking or producing — never interrupt. */
  isCoachSpeaking: () => boolean;
  /** The existing coach TTS entry. Returns whether playback started. */
  speakMessage: (message: VoiceCoachMessage) => boolean;
  /**
   * Record a message id as the last SPOKEN coach message without speaking it.
   *
   * This is the teeth behind "never interrupt". Appending a coach line schedules
   * a render, and the render handoff speaks the latest coach message whenever
   * its id is still unspoken (orchestrator.ts resolveVoiceCoachRenderHandoffPlan
   * — that branch has no is-speaking guard, and runtime-service.speakCoachMessage
   * stops the current speech before playing). So merely declining to speak here
   * does not withhold the utterance; it hands it to the handoff a microtask
   * later, mid-sentence. Claiming the id is what actually withholds it.
   */
  markSpoken: (message: VoiceCoachMessage) => void;
  now?: () => number;
};

export function createVoiceCoachThreadLineChannel(options: VoiceCoachThreadLineChannelOptions) {
  const now = options.now ?? (() => Date.now());
  let lastAppended: VoiceCoachMessage | null = null;
  // Two lines appended inside the same millisecond would otherwise share an id,
  // and an id is what marks a message spoken.
  let sequence = 0;

  function append(content: string, kind = 'coach-line'): VoiceCoachMessage | null {
    const text = (content || '').trim();
    if (!text) return null;
    const createdAt = now();
    sequence += 1;
    const message: VoiceCoachMessage = {
      id: `${kind}-${createdAt}-${sequence}`,
      role: 'coach',
      channel: 'coach',
      kind,
      content: text,
      createdAt,
    };
    lastAppended = message;
    options.appendMessage(message);
    return message;
  }

  /**
   * Speak the line that was just appended. Returns whether playback started.
   *
   * Refuses — quietly, never throwing — in three cases:
   *   - this text is not the line that was just appended, so the id we would be
   *     claiming is not the id sitting in the thread. Nothing is claimed and
   *     nothing is said; the caller simply gets false.
   *   - the tutor is already speaking. Interrupting to say "heard that" would be
   *     a downgrade, and the learner is being answered either way.
   *   - the host's speech path could not start (no provider, wrong mode).
   *
   * In the latter two the line is CLAIMED anyway, so nothing downstream says it
   * afterwards: the thread append is then the whole surface, which is exactly
   * the specified fallback.
   */
  function speak(content: string): boolean {
    const message = lastAppended;
    if (!message || message.content !== (content || '').trim()) return false;
    if (options.isCoachSpeaking()) {
      options.markSpoken(message);
      return false;
    }
    if (options.speakMessage(message)) return true;
    options.markSpoken(message);
    return false;
  }

  return { append, speak };
}

export type VoiceCoachThreadLineChannel = ReturnType<typeof createVoiceCoachThreadLineChannel>;
