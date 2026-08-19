import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDefaultVoiceUiState } from '../state';
import { createVoiceLessonController } from './controller';

// Flow lane — spoken eyes-free surfaces: when the session payload carries
// sessionScope.eyesFree, fallback-card changes and arm/finalize transitions
// get short deterministic utterances through the injected speech seam
// (hear-line contract). Absent scope/options -> everything stays silent.

type Harness = ReturnType<typeof createHarness>;

function createHarness(overrides: {
  speakLine?: ((text: string) => boolean) | undefined;
  withSpeakLine?: boolean;
} = {}) {
  const uiState = createDefaultVoiceUiState();
  const speakLine = overrides.withSpeakLine === false
    ? undefined
    : vi.fn(overrides.speakLine ?? (() => true));
  let coachSpeaking = false;
  let interactionOwner = 'idle';

  const controller = createVoiceLessonController({
    doc: document,
    getUiState: () => uiState,
    getSessionId: () => 'session-1',
    fetchActiveCard: vi.fn(async () => ({ success: true, card: null })),
    advanceCard: vi.fn(async () => ({ success: true, card: null })),
    attemptAudioUrl: (attemptId: string) => `http://kernel.test/attempts/${attemptId}/audio`,
    submitCoachQuestion: vi.fn(),
    onTakeStartRetry: vi.fn(),
    onNextCard: vi.fn(),
    getLatestCoachText: () => null,
    addLog: vi.fn(),
    speakLine,
    isCoachSpeaking: () => coachSpeaking,
    getInteractionOwner: () => interactionOwner,
  });

  return {
    controller,
    speakLine,
    setCoachSpeaking(value: boolean) {
      coachSpeaking = value;
    },
    setInteractionOwner(value: string) {
      interactionOwner = value;
    },
  };
}

function fallbackCardPayload(id: string, extras: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sessionScope: { eyesFree: true },
    activeCard: {
      id,
      phrase: 'hello there',
      source: 'fallback',
      focus: { axis: 'pitch', statement: 'Keep it light.' },
    },
    ...extras,
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('spoken eyes-free surfaces (lesson controller)', () => {
  it('speaks a fallback card once: "New line: <phrase>. <focus.statement>"', () => {
    const harness: Harness = createHarness();
    harness.controller.applyCoachPayload(fallbackCardPayload('card-1'));

    expect(harness.speakLine).toHaveBeenCalledTimes(1);
    expect(harness.speakLine).toHaveBeenCalledWith('New line: hello there. Keep it light.');

    // Same card again -> no repeat utterance.
    harness.controller.applyCoachPayload(fallbackCardPayload('card-1'));
    expect(harness.speakLine).toHaveBeenCalledTimes(1);
  });

  it('stays silent for tutor-authored cards (they already arrive spoken)', () => {
    const harness = createHarness();
    harness.controller.applyCoachPayload({
      sessionScope: { eyesFree: true },
      activeCard: {
        id: 'card-2',
        phrase: 'tutor line',
        source: 'tutor',
        focus: { axis: 'pitch', statement: 'From the tutor.' },
      },
    });
    expect(harness.speakLine).not.toHaveBeenCalled();
  });

  it('speaks the assigned line even without sessionScope.eyesFree (2026-07-28: the line is always spoken once)', () => {
    const harness = createHarness();
    harness.controller.applyCoachPayload({
      activeCard: {
        id: 'card-3',
        phrase: 'quiet line',
        source: 'fallback',
        focus: { axis: null, statement: null },
      },
    });
    expect(harness.speakLine).toHaveBeenCalledTimes(1);
    expect(harness.speakLine).toHaveBeenCalledWith('New line: quiet line.');
    // ...but the OTHER eyes-free utterances stay gated: no scope, no 'got it'.
    harness.speakLine!.mockClear();
    harness.controller.applyCoachPayload({ strainWatch: { recentFlags: 0 } });
    expect(harness.speakLine).not.toHaveBeenCalled();
  });

  it('speaks "recording" once when practice arms, and again only after leaving practice', () => {
    const harness = createHarness();
    harness.controller.applyCoachPayload({ sessionScope: { eyesFree: true } });
    harness.speakLine!.mockClear();

    harness.setInteractionOwner('practice-armed');
    harness.controller.sync();
    expect(harness.speakLine).toHaveBeenCalledTimes(1);
    expect(harness.speakLine).toHaveBeenCalledWith('recording');

    // Armed -> live is the same hot-mic phase; no second utterance.
    harness.setInteractionOwner('practice-live');
    harness.controller.sync();
    expect(harness.speakLine).toHaveBeenCalledTimes(1);

    // Leaving practice re-arms the confirmation for the next take.
    harness.setInteractionOwner('idle');
    harness.controller.sync();
    harness.setInteractionOwner('practice-live');
    harness.controller.sync();
    expect(harness.speakLine).toHaveBeenCalledTimes(2);
  });

  it('speaks "got it" when a take finalizes (guardian/pin payload seam)', () => {
    const harness = createHarness();
    harness.controller.applyCoachPayload({ sessionScope: { eyesFree: true } });
    harness.speakLine!.mockClear();

    harness.controller.applyCoachPayload({ guardian: null });
    expect(harness.speakLine).toHaveBeenCalledTimes(1);
    expect(harness.speakLine).toHaveBeenCalledWith('got it');
  });

  it('never overlaps coach speech (skips, does not queue)', () => {
    const harness = createHarness();
    harness.controller.applyCoachPayload({ sessionScope: { eyesFree: true } });
    harness.speakLine!.mockClear();

    harness.setCoachSpeaking(true);
    harness.controller.applyCoachPayload({ guardian: null });
    expect(harness.speakLine).not.toHaveBeenCalled();
  });

  it('eyesFree false turns the surfaces back off', () => {
    const harness = createHarness();
    harness.controller.applyCoachPayload({ sessionScope: { eyesFree: true } });
    harness.controller.applyCoachPayload({ sessionScope: { eyesFree: false } });
    harness.speakLine!.mockClear();

    harness.setInteractionOwner('practice-armed');
    harness.controller.sync();
    expect(harness.speakLine).not.toHaveBeenCalled();
  });

  it('is defensive without the optional speech options', () => {
    const harness = createHarness({ withSpeakLine: false });
    expect(() => {
      harness.controller.applyCoachPayload(fallbackCardPayload('card-9'));
      harness.controller.sync();
    }).not.toThrow();
  });
});
