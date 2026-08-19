import { describe, expect, it, vi } from 'vitest';

import { VOICE_COACH_SCOPE_ACKS } from './coach-routing-core';
import { createVoiceHostRuntimeComposition } from './host-runtime-composition';
import { createVoiceRuntimeStore } from './runtime-store';

// Flow lane crossing proof: a scope-intent question submitted through the
// composed submitVoiceCoachQuestion (typed OR voice-captured — the SAME method
// handleCapturedQuestion binds to) is consumed BEFORE clarification routing:
// it POSTs the session-scope patch, speaks the ack through the coach speech
// seam, and never reaches the underlying submit. Everything else delegates
// unchanged.

function createHarness(overrides: {
  postVoiceSessionScope?: (sessionId: string, scope: unknown) => Promise<unknown>;
} = {}) {
  const store = createVoiceRuntimeStore();
  const submitSpy = vi.fn(async (): Promise<void> => undefined);
  const hostActionsController = { submitVoiceCoachQuestion: submitSpy };
  const coachShell = { speakCoachMessage: vi.fn(() => true) };
  const questionInput = document.createElement('input');
  const postVoiceSessionScope = vi.fn(overrides.postVoiceSessionScope ?? (async () => ({})));

  const composition = createVoiceHostRuntimeComposition({
    store,
    runtimeStatusController: {
      getState: vi.fn(() => ({}) as never),
      applyInputProviderStatusPayload: vi.fn(),
    },
    getCurrentMode: () => 'voice',
    getCurrentSessionId: () => 'session-9',
    getIsConnected: () => true,
    resolveSessionMode: () => 'voice',
    getCoachQuestionInput: () => questionInput,
    render: vi.fn(),
    applyVoiceBackendPayload: vi.fn(),
    submitRuntimeCoachQuestionRequest: vi.fn(),
    prepareConditioningLatentsRequest: vi.fn(),
    getCoachShell: () => coachShell as never,
    getRuntimeShell: () => null,
    getLiveTransitionController: () => null,
    isSpeechSynthesisBusy: () => false,
    getVoiceSessionStreamUrl: () => 'wss://stream',
    syncPersistedReferenceAnalysis: vi.fn(() => null),
    postVoiceSessionScope,
    document,
  }, {
    createVoiceHostActionsController: vi.fn(() => hostActionsController as never),
    createVoiceAppRuntime: vi.fn(() => ({}) as never),
    createVoiceBrowserRuntime: vi.fn(() => ({}) as never),
  });

  return { composition, submitSpy, coachShell, questionInput, postVoiceSessionScope };
}

describe('voice host runtime scope-intent decoration', () => {
  it('consumes a spoken scope intent: POST + spoken ack, original submit untouched', async () => {
    const harness = createHarness();

    await harness.composition.voiceHostActionController.submitVoiceCoachQuestion('keep it quiet');

    expect(harness.postVoiceSessionScope).toHaveBeenCalledWith('session-9', { tier: 'quiet' });
    expect(harness.coachShell.speakCoachMessage).toHaveBeenCalledTimes(1);
    const [spokenMessage] = harness.coachShell.speakCoachMessage.mock.calls[0];
    expect(spokenMessage).toMatchObject({
      role: 'coach',
      kind: 'scope-ack',
      content: VOICE_COACH_SCOPE_ACKS['tier-quiet'],
    });
    expect(harness.submitSpy).not.toHaveBeenCalled();
  });

  it('consumes a typed scope intent from the question input and clears it', async () => {
    const harness = createHarness();
    harness.questionInput.value = "I'm driving";

    await harness.composition.voiceHostActionController.submitVoiceCoachQuestion();

    expect(harness.postVoiceSessionScope).toHaveBeenCalledWith('session-9', { eyesFree: true });
    expect(harness.questionInput.value).toBe('');
    expect(harness.submitSpy).not.toHaveBeenCalled();
  });

  it('delegates non-scope questions to the original submit unchanged', async () => {
    const harness = createHarness();

    await harness.composition.voiceHostActionController.submitVoiceCoachQuestion(
      'how do I sound today',
      { listeningTurnId: 'listening-turn-8' },
    );

    expect(harness.postVoiceSessionScope).not.toHaveBeenCalled();
    expect(harness.submitSpy).toHaveBeenCalledWith(
      'how do I sound today',
      { listeningTurnId: 'listening-turn-8' },
    );
  });

  it('honors skipIntentRouting (canned fallback questions bypass the scope lane)', async () => {
    const harness = createHarness();

    await harness.composition.voiceHostActionController.submitVoiceCoachQuestion(
      'keep it quiet',
      { skipIntentRouting: true },
    );

    expect(harness.postVoiceSessionScope).not.toHaveBeenCalled();
    expect(harness.submitSpy).toHaveBeenCalledWith('keep it quiet', { skipIntentRouting: true });
  });

  it('falls through to the coach when the scope route fails (utterance never dropped)', async () => {
    const harness = createHarness({
      postVoiceSessionScope: async () => {
        throw new Error('scope route not shipped yet');
      },
    });

    await harness.composition.voiceHostActionController.submitVoiceCoachQuestion('keep it quiet');

    expect(harness.postVoiceSessionScope).toHaveBeenCalled();
    expect(harness.coachShell.speakCoachMessage).not.toHaveBeenCalled();
    expect(harness.submitSpy).toHaveBeenCalledWith('keep it quiet', {});
  });
});
