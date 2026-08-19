import { describe, expect, it, vi } from 'vitest';
import {
  createVoiceCoachScopeIntentRunner,
  getVoiceCoachScopeIntent,
  VOICE_COACH_SCOPE_ACKS,
  voiceCoachScopeAckKey,
  voiceCoachScopePatch,
  type VoiceCoachScopeIntent,
} from './coach-routing-core';

// Flow lane — tier / eyes-free voice intents: pattern matching (spec corpus)
// and the runner that executes a matched intent (POST scope -> spoken ack).

describe('voice coach scope intent detection', () => {
  const corpus: Array<[string, VoiceCoachScopeIntent | null]> = [
    // tier: quiet
    ['keep it quiet', { kind: 'tier', tier: 'quiet' }],
    ['quiet please', { kind: 'tier', tier: 'quiet' }],
    ["I can't talk right now", { kind: 'tier', tier: 'quiet' }],
    ['please keep it quiet', { kind: 'tier', tier: 'quiet' }],
    // tier: silent
    ['just listening', { kind: 'tier', tier: 'silent' }],
    ["I'm just listening today", { kind: 'tier', tier: 'silent' }],
    ['going silent', { kind: 'tier', tier: 'silent' }],
    // tier: full
    ['back to full voice', { kind: 'tier', tier: 'full' }],
    ['I can speak freely', { kind: 'tier', tier: 'full' }],
    ['I can talk again', { kind: 'tier', tier: 'full' }],
    // eyes-free on
    ["I'm driving", { kind: 'eyes-free', eyesFree: true }],
    ['I am driving right now', { kind: 'eyes-free', eyesFree: true }],
    ['eyes free', { kind: 'eyes-free', eyesFree: true }],
    ['hands free mode', { kind: 'eyes-free', eyesFree: true }],
    ["I can't look at the screen", { kind: 'eyes-free', eyesFree: true }],
    // eyes-free off
    ['I can look again', { kind: 'eyes-free', eyesFree: false }],
    ['not driving anymore', { kind: 'eyes-free', eyesFree: false }],
    ["I'm not driving any more", { kind: 'eyes-free', eyesFree: false }],
    ['done driving', { kind: 'eyes-free', eyesFree: false }],
    // negatives — must never be swallowed by the scope lane
    ['make this easier', null],
    ['repeat that please', null],
    ['what should we work on next', null],
    ['why are we doing this', null],
    ['I am ready to practice', null],
    ['', null],
  ];

  it('matches the spec corpus', () => {
    for (const [text, expected] of corpus) {
      expect(getVoiceCoachScopeIntent(text), `"${text}"`).toEqual(expected);
    }
  });

  it('negation precedence: "not driving" never reads as driving', () => {
    expect(getVoiceCoachScopeIntent('no, I am not driving anymore')).toEqual({
      kind: 'eyes-free',
      eyesFree: false,
    });
  });

  it('derives ack keys and scope patches per intent', () => {
    expect(voiceCoachScopeAckKey({ kind: 'tier', tier: 'quiet' })).toBe('tier-quiet');
    expect(voiceCoachScopeAckKey({ kind: 'eyes-free', eyesFree: true })).toBe('eyes-free-on');
    expect(voiceCoachScopeAckKey({ kind: 'eyes-free', eyesFree: false })).toBe('eyes-free-off');
    expect(voiceCoachScopePatch({ kind: 'tier', tier: 'silent' })).toEqual({ tier: 'silent' });
    expect(voiceCoachScopePatch({ kind: 'eyes-free', eyesFree: true })).toEqual({ eyesFree: true });
  });

  it('keeps the design copy for the spoken acks', () => {
    expect(VOICE_COACH_SCOPE_ACKS['tier-quiet']).toBe(
      'Quiet works. Humming and listening carry the same practice.',
    );
    expect(VOICE_COACH_SCOPE_ACKS['tier-silent']).toBe(
      "Just listening is a real session. I'll play; you judge by ear.",
    );
    expect(VOICE_COACH_SCOPE_ACKS['eyes-free-on']).toContain('Eyes on the road');
  });
});

describe('voice coach scope intent runner', () => {
  function createRunner(overrides: {
    sessionId?: string | null;
    postSessionScope?: (sessionId: string, scope: unknown) => Promise<unknown>;
  } = {}) {
    const postSessionScope = vi.fn(overrides.postSessionScope ?? (async () => ({})));
    const speakAck = vi.fn(() => true);
    const log = vi.fn();
    const handle = createVoiceCoachScopeIntentRunner({
      getSessionId: () => (overrides.sessionId === undefined ? 'session-1' : overrides.sessionId),
      postSessionScope,
      speakAck,
      log,
    });
    return { handle, postSessionScope, speakAck, log };
  }

  it('consumes a matched intent: POSTs the patch then speaks the ack', async () => {
    const { handle, postSessionScope, speakAck } = createRunner();
    await expect(handle('keep it quiet')).resolves.toBe(true);
    expect(postSessionScope).toHaveBeenCalledWith('session-1', { tier: 'quiet' });
    expect(speakAck).toHaveBeenCalledWith(VOICE_COACH_SCOPE_ACKS['tier-quiet'], 'tier-quiet');
  });

  it('handles eyes-free intents end to end', async () => {
    const { handle, postSessionScope, speakAck } = createRunner();
    await expect(handle("I'm driving")).resolves.toBe(true);
    expect(postSessionScope).toHaveBeenCalledWith('session-1', { eyesFree: true });
    expect(speakAck).toHaveBeenCalledWith(VOICE_COACH_SCOPE_ACKS['eyes-free-on'], 'eyes-free-on');
  });

  it('falls through (returns false, no ack) when the scope route fails', async () => {
    const { handle, speakAck, log } = createRunner({
      postSessionScope: async () => {
        throw new Error('404 scope route missing');
      },
    });
    await expect(handle('keep it quiet')).resolves.toBe(false);
    expect(speakAck).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining('falling through'));
  });

  it('falls through to the tutor when the ack cannot be spoken (patch stays applied)', async () => {
    const postSessionScope = vi.fn(async () => ({}));
    const speakAck = vi.fn(() => false);
    const log = vi.fn();
    const handle = createVoiceCoachScopeIntentRunner({
      getSessionId: () => 'session-1',
      postSessionScope,
      speakAck,
      log,
    });

    // The owner's law: a lane may consume speech only if it answers out loud.
    await expect(handle('keep it quiet')).resolves.toBe(false);
    expect(postSessionScope).toHaveBeenCalledWith('session-1', { tier: 'quiet' });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('falling through'));
  });

  it('does nothing without a session or on a non-intent question', async () => {
    const noSession = createRunner({ sessionId: null });
    await expect(noSession.handle('keep it quiet')).resolves.toBe(false);
    expect(noSession.postSessionScope).not.toHaveBeenCalled();

    const nonIntent = createRunner();
    await expect(nonIntent.handle('how do I sound today')).resolves.toBe(false);
    expect(nonIntent.postSessionScope).not.toHaveBeenCalled();
    expect(nonIntent.speakAck).not.toHaveBeenCalled();
  });
});
