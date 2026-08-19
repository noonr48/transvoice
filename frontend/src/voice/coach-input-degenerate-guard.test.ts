import { describe, expect, it, vi } from 'vitest';

import {
  createDegenerateTakeHintGuard,
  DEGENERATE_TAKE_HINT,
  DEGENERATE_TAKE_HINT_AFTER,
} from './coach-input';

// Flow lane — degenerate-take guard: after N consecutive no-speech takes (the
// EXISTING voiceInputRuntime.consecutiveNoSpeechTurns counter), surface ONE
// calm hint per streak through the question-feedback surface.

function createHarness(hintAfter?: number) {
  let consecutive = 0;
  const surfaceHint = vi.fn();
  const log = vi.fn();
  const guard = createDegenerateTakeHintGuard({
    getConsecutiveNoSpeechTurns: () => consecutive,
    surfaceHint,
    log,
    hintAfter,
  });
  return {
    guard,
    surfaceHint,
    log,
    noSpeechTurn() {
      consecutive += 1;
      guard.onNoSpeechTurn();
    },
    resetStreak() {
      consecutive = 0;
    },
  };
}

describe('degenerate-take hint guard', () => {
  it('stays quiet below the threshold', () => {
    const harness = createHarness();
    harness.noSpeechTurn();
    harness.noSpeechTurn();
    expect(harness.surfaceHint).not.toHaveBeenCalled();
  });

  it('surfaces exactly one calm hint when the streak reaches the bar', () => {
    const harness = createHarness();
    for (let i = 0; i < DEGENERATE_TAKE_HINT_AFTER; i += 1) {
      harness.noSpeechTurn();
    }
    expect(harness.surfaceHint).toHaveBeenCalledTimes(1);
    expect(harness.surfaceHint).toHaveBeenCalledWith(DEGENERATE_TAKE_HINT);
    expect(DEGENERATE_TAKE_HINT).toBe('noisy here — tap the orb to talk instead');
    expect(harness.log).toHaveBeenCalledWith(expect.stringContaining('[voice-noise]'));

    // The streak keeps growing — still just the one hint.
    harness.noSpeechTurn();
    harness.noSpeechTurn();
    expect(harness.surfaceHint).toHaveBeenCalledTimes(1);
  });

  it('re-arms after the streak breaks and hints again on the next streak', () => {
    const harness = createHarness();
    for (let i = 0; i < DEGENERATE_TAKE_HINT_AFTER; i += 1) harness.noSpeechTurn();
    expect(harness.surfaceHint).toHaveBeenCalledTimes(1);

    // A successful turn resets the runtime counter; the next short streak stays
    // quiet until it reaches the bar again.
    harness.resetStreak();
    harness.noSpeechTurn();
    expect(harness.surfaceHint).toHaveBeenCalledTimes(1);
    harness.noSpeechTurn();
    harness.noSpeechTurn();
    expect(harness.surfaceHint).toHaveBeenCalledTimes(2);
  });

  it('supports a custom threshold', () => {
    const harness = createHarness(2);
    harness.noSpeechTurn();
    expect(harness.surfaceHint).not.toHaveBeenCalled();
    harness.noSpeechTurn();
    expect(harness.surfaceHint).toHaveBeenCalledTimes(1);
  });
});
