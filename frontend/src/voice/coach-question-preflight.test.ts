import { describe, expect, it } from 'vitest';
import { resolveVoiceCoachPendingChannel } from './coach-question-preflight';

// 2026-07-27 (owner's law): ALL learner speech goes to the tutor, and the
// tutor decides. The clarification-plan resolver that used to be tested here
// is gone with the consumption lane; the pending channel is now simply the
// truthful name of the one pipe every question takes.
describe('voice coach question preflight', () => {
  it('labels every question with the pipe it actually takes', () => {
    expect(resolveVoiceCoachPendingChannel('what should I listen for on the ending?', true)).toBe('runtime');
    expect(resolveVoiceCoachPendingChannel('what should I listen for on the ending?', false)).toBe('legacy');
    // Command-shaped utterances are NOT special any more — same pipe.
    expect(resolveVoiceCoachPendingChannel('say that again', true)).toBe('runtime');
    expect(resolveVoiceCoachPendingChannel("i'm ready", false)).toBe('legacy');
  });
});
