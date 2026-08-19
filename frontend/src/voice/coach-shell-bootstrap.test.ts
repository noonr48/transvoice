import { describe, expect, it, vi } from 'vitest';
import { createVoiceCoachShellBootstrap } from './coach-shell-bootstrap';

function createShellOptions() {
  const transport = {
    startCoachListening: vi.fn(() => Promise.resolve(true)),
    stopCoachListening: vi.fn(),
    reopenCoachListeningWithNotice: vi.fn(() => Promise.resolve(true)),
    speakCoachMessage: vi.fn(() => true),
    stopCoachSpeech: vi.fn(),
    toggleCoachListening: vi.fn(),
    runtimeCoordinator: {
      runRenderHandoff: vi.fn(() => Promise.resolve({ action: 'start-continuous-listening' })),
      runDeepTutorResumeHandoff: vi.fn(() => Promise.resolve({ action: 'noop' })),
    },
  } as any;

  const controllers = {
    submitCoachRequest: vi.fn(() => Promise.resolve({ ok: true })),
    clearCoachPollTimer: vi.fn(),
    requestCoachNote: vi.fn(() => Promise.resolve()),
    startDeepTutorLesson: vi.fn(() => Promise.resolve()),
    advanceDeepTutorLesson: vi.fn(() => Promise.resolve()),
    handoffPracticeAfterTake: vi.fn(() => Promise.resolve()),
    resumeDeepTutorLoop: vi.fn(() => Promise.resolve()),
    refreshCockpitLine: vi.fn(() => Promise.resolve()),
    updateCockpitState: vi.fn(() => Promise.resolve()),
    updateConditioningState: vi.fn(() => Promise.resolve()),
    setContinuousMode: vi.fn(() => Promise.resolve(true)),
    toggleContinuousMode: vi.fn(() => Promise.resolve()),
    toggleSpeechProvider: vi.fn(() => Promise.resolve()),
    toggleInputProvider: vi.fn(() => Promise.resolve()),
    toggleSpeechEnabled: vi.fn(() => Promise.resolve()),
    toggleAdvancedPanel: vi.fn(() => Promise.resolve()),
  } as any;

  return {
    transport,
    controllers,
  };
}

describe('voice coach shell bootstrap', () => {
  it('composes the transport, controller, and runtime handoff helpers behind one shell facade', async () => {
    const options = createShellOptions();
    const shell = createVoiceCoachShellBootstrap(options);

    const message = {
      id: 'coach-1',
      role: 'coach',
      channel: 'runtime',
      kind: 'runtime-answer',
      content: 'Try the ending lighter.',
      createdAt: 1,
    } as const;
    const requestOptions = {
      pendingChannel: 'coach' as const,
      request: vi.fn(() => Promise.resolve({})),
      clearInputOnSuccess: true,
    };
    const practiceContext = { voiceSessionArmed: true, voiceTransportStatus: 'streaming' as const };
    const resumeContext = { interaction: { lessonMode: 'active' } } as any;
    const cockpitPatch = { coachVoice: { speechEnabled: true } };
    const conditioningPatch = { promptText: 'hello' };

    await shell.startCoachListening();
    shell.stopCoachListening(true);
    await shell.reopenCoachListeningWithNotice('Reopened');
    shell.speakCoachMessage(message, 0.97);
    shell.stopCoachSpeech();
    shell.toggleCoachListening();
    await shell.submitCoachRequest(requestOptions);
    shell.clearCoachPollTimer();
    await shell.requestCoachNote();
    await shell.startDeepTutorLesson();
    await shell.advanceDeepTutorLesson();
    await shell.handoffPracticeAfterTake(practiceContext);
    await shell.resumeDeepTutorLoop(resumeContext);
    await shell.refreshCockpitLine('regenerate');
    await shell.updateCockpitState(cockpitPatch);
    await shell.updateConditioningState(conditioningPatch);
    await shell.setContinuousMode(true);
    await shell.toggleContinuousMode();
    await shell.toggleSpeechProvider();
    await shell.toggleInputProvider();
    await shell.toggleSpeechEnabled();
    await shell.toggleAdvancedPanel();
    const renderResult = await shell.finalizeRender('voice');
    await shell.runDeepTutorResumeHandoff({ lessonMode: 'active' } as any);

    expect(options.transport.startCoachListening).toHaveBeenCalledTimes(1);
    expect(options.transport.stopCoachListening).toHaveBeenCalledWith(true);
    expect(options.transport.reopenCoachListeningWithNotice).toHaveBeenCalledWith('Reopened');
    expect(options.transport.speakCoachMessage).toHaveBeenCalledWith(message, 0.97);
    expect(options.transport.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(options.transport.toggleCoachListening).toHaveBeenCalledTimes(1);
    expect(options.controllers.submitCoachRequest).toHaveBeenCalledWith(requestOptions);
    expect(options.controllers.clearCoachPollTimer).toHaveBeenCalledTimes(1);
    expect(options.controllers.requestCoachNote).toHaveBeenCalledTimes(1);
    expect(options.controllers.startDeepTutorLesson).toHaveBeenCalledTimes(1);
    expect(options.controllers.advanceDeepTutorLesson).toHaveBeenCalledTimes(1);
    expect(options.controllers.handoffPracticeAfterTake).toHaveBeenCalledWith(practiceContext);
    expect(options.controllers.resumeDeepTutorLoop).toHaveBeenCalledWith(resumeContext);
    expect(options.controllers.refreshCockpitLine).toHaveBeenCalledWith('regenerate');
    expect(options.controllers.updateCockpitState).toHaveBeenCalledWith(cockpitPatch);
    expect(options.controllers.updateConditioningState).toHaveBeenCalledWith(conditioningPatch);
    expect(options.controllers.setContinuousMode).toHaveBeenCalledWith(true);
    expect(options.controllers.toggleContinuousMode).toHaveBeenCalledTimes(1);
    expect(options.controllers.toggleSpeechProvider).toHaveBeenCalledTimes(1);
    expect(options.controllers.toggleInputProvider).toHaveBeenCalledTimes(1);
    expect(options.controllers.toggleSpeechEnabled).toHaveBeenCalledTimes(1);
    expect(options.controllers.toggleAdvancedPanel).toHaveBeenCalledTimes(1);
    expect(options.transport.runtimeCoordinator.runRenderHandoff).toHaveBeenCalledTimes(1);
    expect(options.transport.runtimeCoordinator.runDeepTutorResumeHandoff).toHaveBeenCalledTimes(1);
    expect(renderResult).toEqual({
      kind: 'handoff',
      plan: { action: 'start-continuous-listening' },
    });
    expect(shell.transport).toBe(options.transport);
    expect(shell.controllers).toBe(options.controllers);
    expect(shell.runtimeCoordinator).toBe(options.transport.runtimeCoordinator);
  });

  it('stops coach transport instead of running runtime handoff when voice mode is inactive', async () => {
    const options = createShellOptions();
    const shell = createVoiceCoachShellBootstrap(options);

    const result = await shell.finalizeRender('general');

    expect(options.transport.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(options.transport.stopCoachListening).toHaveBeenCalledWith(true);
    expect(options.transport.runtimeCoordinator.runRenderHandoff).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'stopped' });
  });
});
