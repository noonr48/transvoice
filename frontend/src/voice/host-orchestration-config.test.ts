import { describe, expect, it, vi } from 'vitest';

import { createVoiceHostOrchestrationConfig } from './host-orchestration-config';
import { createVoiceRuntimeStore } from './runtime-store';
import {
  createVoiceBackendPayload,
  normalizeVoiceLearnerContextState,
} from './state';

function createHarness(overrides: { wireCoachLine?: boolean } = {}) {
  const store = createVoiceRuntimeStore();
  store.updateUiState((current) => ({
    ...current,
    voiceSessionId: 'voice-session-1',
    targetPreset: 'store-preset',
    lastSummary: 'Existing summary',
  }));

  let sessionStateController: { applyBackendPayload: ReturnType<typeof vi.fn> } | null = null;
  let workflowController: {
    selectDrill: ReturnType<typeof vi.fn>;
    refreshHealthSoon: ReturnType<typeof vi.fn>;
    refreshKnowledgeStatusSoon: ReturnType<typeof vi.fn>;
  } | null = null;
  let runtimeShell: { canUseBackendRecordedFallback: ReturnType<typeof vi.fn> } | null = {
    canUseBackendRecordedFallback: vi.fn(() => true),
  };

  const questionInput = document.createElement('input');
  let targetPresetSelect: HTMLSelectElement | null = document.createElement('select');
  targetPresetSelect.innerHTML = '<option value="dom-preset">DOM Preset</option>';
  targetPresetSelect.value = 'dom-preset';
  const promptTextInput = document.createElement('textarea');
  const promptFileInput = document.createElement('input');
  const referenceFileInput = document.createElement('input');

  const appRuntime = {
    getLatestCoachMessage: vi.fn(() => ({
      id: 'coach-1',
      role: 'coach',
    })),
    hasDeepTutorVoiceLesson: vi.fn(() => false),
    assertVoicePracticeTargetUnlocked: vi.fn(),
    releaseVoicePracticeForCoachListening: vi.fn(),
    getVoiceInteractionSnapshot: vi.fn(() => ({ owner: 'coach' })),
    hasActiveDeepTutorGuideSession: vi.fn(() => false),
    getVoiceReferenceMimicState: vi.fn(() => ({ action: 'idle' })),
    shouldRebuildDeepTutorVoiceLesson: vi.fn(() => false),
  };

  const voiceHostActionController = {
    refreshVoiceCockpitLine: vi.fn(),
    resetVoiceCoachRuntimeUiState: vi.fn(),
    startVoicePracticeSession: vi.fn(),
    handoffVoicePracticeToCoachAfterTake: vi.fn(),
    requestVoiceCoachNote: vi.fn(),
    updateVoiceCockpitState: vi.fn(),
    submitVoiceCoachQuestion: vi.fn(),
    armVoicePracticeSessionWithNotice: vi.fn(),
    disarmVoicePracticeSession: vi.fn(async () => true),
    clearVoiceCoachPendingState: vi.fn(),
    submitDeepTutorVoiceQuestion: vi.fn(),
    submitDeepTutorVoiceBriefAction: vi.fn(),
    startDeepTutorVoiceLesson: vi.fn(),
    advanceDeepTutorVoiceLesson: vi.fn(),
    ensureVoiceCoachContinuousLoop: vi.fn(),
    updateVoiceConditioningState: vi.fn(),
    prepareVoiceConditioningLatents: vi.fn(),
    resumeDeepTutorVoiceLoop: vi.fn(),
    beginVoicePracticeTake: vi.fn(),
    endVoicePracticeSession: vi.fn(),
  };

  const hostRuntimeComposition = {
    voiceAppRuntime: appRuntime,
    voiceHostActionController,
    applyVoiceInputProviderStatusPayload: vi.fn(),
    compressVoiceTimeline: vi.fn((timeline) => timeline ?? []),
    getSelectedVoiceAudioInput: vi.fn(() => null),
    getVoiceCoachInputSilenceThreshold: vi.fn(() => 0.018),
    refreshVoiceAudioInputDevices: vi.fn(async () => []),
    speakVoiceCoachMessage: vi.fn(() => true),
    stopVoiceCoachListening: vi.fn(),
    stopVoiceCoachSpeech: vi.fn(),
    toggleVoiceCoachContinuousMode: vi.fn(),
    toggleVoiceCoachInputProvider: vi.fn(),
    toggleVoiceCoachListening: vi.fn(),
    toggleVoiceCoachSpeechProvider: vi.fn(),
    writeVoiceInputDevicePreference: vi.fn(),
  } as any;

  const runtimeStatusController = {
    getState: vi.fn(() => ({}) as any),
    applyHealthStatusPayload: vi.fn(),
    applySpeechStatusPayload: vi.fn(),
    markServiceOffline: vi.fn(),
    planRecoverySafety: vi.fn(() => ({ shouldApply: false, disableReason: null })),
    setKnowledgeStatusText: vi.fn(),
    setRecoverySafetyPending: vi.fn(),
    setVoxCpmStatus: vi.fn(),
  } as any;

  const voiceApi = {
    advanceDeepTutorVoiceLesson: vi.fn(),
    analyzeReference: vi.fn(),
    disarmPracticeSession: vi.fn(),
    getDrills: vi.fn(),
    getHealthSnapshot: vi.fn(),
    getKnowledgeStatus: vi.fn(),
    getReferenceAnalysis: vi.fn(),
    getReferenceAudioUrl: vi.fn(),
    getSessionState: vi.fn(),
    getTaskStatus: vi.fn(),
    projectPhraseForecast: vi.fn(),
    refreshCockpitLine: vi.fn(),
    requestDeepTutorCoach: vi.fn(),
    selectDrill: vi.fn(),
    startCoachTask: vi.fn(),
    startDeepTutorVoiceLesson: vi.fn(),
    startPracticeSession: vi.fn(),
    submitInputRuntimeEvent: vi.fn(),
    submitInputTurn: vi.fn(),
    submitPracticeTake: vi.fn(),
    syncPreset: vi.fn(),
    syncReference: vi.fn(),
    updateCockpitState: vi.fn(),
    updateConditioningState: vi.fn(),
  } as any;

  const render = vi.fn();
  const addTerminalLine = vi.fn();
  const appendCoachLine = vi.fn();
  const speakCoachLine = vi.fn(() => true);
  const startVoiceAudioStream = vi.fn(async () => undefined);
  const stopVoiceAudioStream = vi.fn(async () => undefined);
  const sessionLease = {};
  const releasePracticeForCoachListening = vi.fn(async () => undefined);
  const hostRuntimeBridge = {
    getPracticeTransportState: vi.fn(() => store.getPracticeTransportState()),
    setPracticeTransportState: vi.fn((updater) => {
      store.setPracticeTransportState(updater);
    }),
    updateVoiceUiState: vi.fn((updater) => {
      store.updateUiState(updater);
    }),
    startVoiceAudioStream,
    stopVoiceAudioStream,
    render,
    toggleVoiceOverlay: vi.fn(),
  } as const;

  const config = createVoiceHostOrchestrationConfig({
    hostRuntimeComposition,
    hostRuntimeBridge,
    voiceApi,
    runtimeStatusController,
    store,
    kernelUrl: 'http://kernel',
    kernelWsUrl: 'ws://kernel',
    getCurrentMode: () => 'voice',
    getCurrentSessionId: () => 'session-1',
    getIsConnected: () => true,
    getSessionLease: () => sessionLease,
    releasePracticeForCoachListening,
    addTerminalLine,
    appendCoachLine: overrides.wireCoachLine === false ? undefined : appendCoachLine,
    speakCoachLine: overrides.wireCoachLine === false ? undefined : speakCoachLine,
    getSessionStateController: () => sessionStateController as any,
    getWorkflowController: () => workflowController as any,
    getRuntimeShell: () => runtimeShell as any,
    getVoiceCoachQuestionInput: () => questionInput,
    getVoiceTargetPresetSelect: () => targetPresetSelect,
    getVoiceReferencePlayer: () => null,
    getVoiceConditioningPromptTextInput: () => promptTextInput,
    getVoiceConditioningPromptFileInput: () => promptFileInput,
    getVoiceConditioningReferenceFileInput: () => referenceFileInput,
    getDomBindings: () => null,
  });

  return {
    config,
    store,
    voiceApi,
    appRuntime,
    voiceHostActionController,
    hostRuntimeBridge,
    questionInput,
    promptTextInput,
    promptFileInput,
    referenceFileInput,
    sessionLease,
    releasePracticeForCoachListening,
    addTerminalLine,
    appendCoachLine,
    speakCoachLine,
    render,
    setSessionStateController(controller: typeof sessionStateController) {
      sessionStateController = controller;
    },
    setWorkflowController(controller: typeof workflowController) {
      workflowController = controller;
    },
    setRuntimeShell(shell: typeof runtimeShell) {
      runtimeShell = shell;
    },
    setTargetPresetSelect(select: typeof targetPresetSelect) {
      targetPresetSelect = select;
    },
  };
}

describe('voice host orchestration config', () => {
  it('uses the caller-owned Coach practice-release barrier when supplied', async () => {
    const harness = createHarness();

    await harness.config.controllerGraph.coachTransport.inputController
      .releasePracticeForListening();

    expect(harness.releasePracticeForCoachListening).toHaveBeenCalledOnce();
    expect(harness.appRuntime.releaseVoicePracticeForCoachListening).not.toHaveBeenCalled();
  });

  it('keeps live listening turn identity on the captured-question action seam', async () => {
    const harness = createHarness();
    const handleCapturedQuestion = harness.config.controllerGraph.coachTransport
      .inputController.handleCapturedQuestion;

    await handleCapturedQuestion(
      'How did that sentence sound?',
      { listeningTurnId: 'listening-turn-6' },
    );

    expect(harness.voiceHostActionController.submitVoiceCoachQuestion).toHaveBeenCalledWith(
      'How did that sentence sound?',
      { listeningTurnId: 'listening-turn-6' },
    );
  });

  it('routes an input-controller coach line to the host coach thread, and stays silent when unwired', () => {
    const harness = createHarness();

    harness.config.controllerGraph.coachTransport.inputController
      .appendCoachLine?.('Heard that one as breath, not words.');

    expect(harness.appendCoachLine).toHaveBeenCalledWith('Heard that one as breath, not words.');

    // A host that never wired the surface must simply drop the line.
    const unwired = createHarness({ wireCoachLine: false });
    expect(() => unwired.config.controllerGraph.coachTransport.inputController
      .appendCoachLine?.('dropped')).not.toThrow();
    expect(unwired.appendCoachLine).not.toHaveBeenCalled();
  });

  it('routes an input-controller coach line to the host SPEECH path too, and reports false when unwired', () => {
    // 2026-07-26 field repair: on a voice-first surface an acknowledgment the
    // learner can only read is the failure, not the fix. The controller reaches
    // the host's speech path through this seam; if the seam is not wired the
    // controller must learn that from a plain `false`, never a throw, so the
    // text append remains the whole surface.
    const harness = createHarness();

    const spoken = harness.config.controllerGraph.coachTransport.inputController
      .speakCoachLine?.('Heard that — steady and easy.');

    expect(harness.speakCoachLine).toHaveBeenCalledWith('Heard that — steady and easy.');
    expect(spoken).toBe(true);

    const unwired = createHarness({ wireCoachLine: false });
    expect(unwired.config.controllerGraph.coachTransport.inputController
      .speakCoachLine?.('dropped')).toBe(false);
    expect(unwired.speakCoachLine).not.toHaveBeenCalled();
  });

  it('adds the exact session lease only to the coach input context', () => {
    const harness = createHarness();

    const coachInputContext = harness.config.controllerGraph.coachTransport.inputController
      .getSessionContext();
    expect(coachInputContext).toEqual({
      currentSessionId: 'session-1',
      isConnected: true,
      sessionLease: harness.sessionLease,
    });
    expect(coachInputContext.sessionLease).toBe(harness.sessionLease);

    const unrelatedSessionContexts = [
      harness.config.controllerGraph.coachTransport.speechController.getSessionContext(),
      harness.config.controllerGraph.sessionState.getSessionContext(),
      harness.config.controllerGraph.inputRuntime.getSessionContext(),
    ];
    for (const context of unrelatedSessionContexts) {
      expect(context).toEqual({
        currentSessionId: 'session-1',
        isConnected: true,
      });
      expect(context).not.toHaveProperty('sessionLease');
    }

    const workflowContext = harness.config.controllerGraph.workflow.getSessionContext();
    expect(workflowContext).toEqual({
      currentMode: 'voice',
      currentSessionId: 'session-1',
      isConnected: true,
    });
    expect(workflowContext).not.toHaveProperty('sessionLease');
  });

  it('uses the prebuilt app runtime bundle and reads live ui state', () => {
    const harness = createHarness();

    expect(harness.config.appRuntime.runtime).toBe(harness.appRuntime);
    expect(harness.config.appRuntime.getVoiceUiState().voiceSessionId).toBe('voice-session-1');

    harness.store.updateUiState((current) => ({
      ...current,
      voiceSessionId: 'voice-session-2',
    }));

    expect(harness.config.appRuntime.getVoiceUiState().voiceSessionId).toBe('voice-session-2');
  });

  it('uses the remembered slower-pace preference for cloned tutor speech', () => {
    const harness = createHarness();
    const getDefaultSpeakingRate = harness.config.controllerGraph.coachTransport
      .speechController.getDefaultSpeakingRate;

    expect(getDefaultSpeakingRate()).toBe(0.76);

    const currentModel = harness.store.getState().voiceStudentModelState;
    harness.store.patchState({
      voiceStudentModelState: {
        ...currentModel,
        learnerContext: normalizeVoiceLearnerContextState({
          available: true,
          coachPreferences: [{
            id: 'slower-pace',
            text: 'Prefers a slower coaching pace',
            date: null,
            source: 'learner',
          }],
        }),
      },
    });

    expect(getDefaultSpeakingRate()).toBe(0.65);
  });

  it('reuses the host runtime bridge for shared render and transport delegates', () => {
    const harness = createHarness();

    expect(harness.config.controllerGraph.practiceTransport.getState)
      .toBe(harness.hostRuntimeBridge.getPracticeTransportState);
    expect(harness.config.controllerGraph.practiceTransport.setState)
      .toBe(harness.hostRuntimeBridge.setPracticeTransportState);
    expect(harness.config.controllerGraph.workflow.updateVoiceUiState)
      .toBe(harness.hostRuntimeBridge.updateVoiceUiState);
    expect(harness.config.controllerGraph.workflow.startVoiceAudioStream)
      .toBe(harness.hostRuntimeBridge.startVoiceAudioStream);
    expect(harness.config.controllerGraph.liveTransition.stopAudioStream)
      .toBe(harness.hostRuntimeBridge.stopVoiceAudioStream);
    expect(harness.config.controllerGraph.bootstrap.toggleVoiceOverlay)
      .toBe(harness.hostRuntimeBridge.toggleVoiceOverlay);
    expect(harness.config.sessionModeRuntime.render).toBe(harness.hostRuntimeBridge.render);
  });

  it('forwards the exact take artifact through the production API delegate', async () => {
    const harness = createHarness();
    const attemptArtifact = {
      clientAttemptId: 'attempt-sustained-1',
      repContext: {
        targetPreset: 'masculine',
        targetSource: 'custom-handmade' as const,
        lessonId: 'masc-vocalise-sustained',
        activeLine: null,
        referenceClipId: null,
        referenceClipName: null,
        forecastPhrase: null,
        kind: 'sustained',
        drillId: 'masc-vocalise-sustained',
        tags: ['vocalise', 'stability'],
      },
      selfReport: null,
    };

    await harness.config.controllerGraph.liveTransition.submitPracticeTakeRequest(
      'session-1',
      'manual take end',
      null,
      attemptArtifact,
    );

    expect(harness.config.controllerGraph.liveTransition.getVoiceDrillState())
      .toBe(harness.store.getState().voiceDrillState);
    expect(harness.voiceApi.submitPracticeTake).toHaveBeenCalledWith(
      'session-1',
      'manual take end',
      null,
      attemptArtifact,
    );
  });

  it('routes valid backend payloads through the late-bound session controller and manages question drafts', () => {
    const harness = createHarness();
    const applyBackendPayload = vi.fn();
    harness.setSessionStateController({ applyBackendPayload });

    harness.questionInput.value = 'draft question';
    harness.config.controllerGraph.coachTransport.inputController.setQuestionDraft('captured question');
    expect(harness.questionInput.value).toBe('captured question');

    harness.config.controllerGraph.coachControllers.requestController.applyVoiceBackendPayload({ invalid: true } as any);
    expect(applyBackendPayload).not.toHaveBeenCalled();

    const payload = createVoiceBackendPayload({
      voiceState: {
        voiceSessionId: 'voice-session-1',
      } as any,
    });
    harness.config.controllerGraph.coachControllers.requestController.applyVoiceBackendPayload(payload);
    expect(applyBackendPayload).toHaveBeenCalledWith(payload);

    const learnerContextPayload = createVoiceBackendPayload({
      learnerContext: {
        available: true,
        source: 'local-learner-context',
      },
    });
    harness.config.controllerGraph.coachControllers.requestController.applyVoiceBackendPayload(learnerContextPayload);
    expect(applyBackendPayload).toHaveBeenCalledWith(learnerContextPayload);

    harness.config.controllerGraph.coachControllers.requestController.clearQuestionInput();
    expect(harness.questionInput.value).toBe('');
  });

  it('keeps target preset, runtime-shell, and render delegates late-bound to current refs', async () => {
    const harness = createHarness();
    const selectDrill = vi.fn(async () => undefined);
    const finalizeRender = vi.fn(async () => 'finalized');

    harness.setWorkflowController({
      selectDrill,
      refreshHealthSoon: vi.fn(),
      refreshKnowledgeStatusSoon: vi.fn(),
    });

    expect(harness.config.controllerGraph.liveTransition.getTargetPreset()).toBe('dom-preset');
    harness.setTargetPresetSelect(null);
    expect(harness.config.controllerGraph.liveTransition.getTargetPreset()).toBe('store-preset');

    harness.setRuntimeShell({
      canUseBackendRecordedFallback: vi.fn(() => false),
    });
    expect(harness.config.controllerGraph.coachTransport.inputController.canUseBackendRecordedFallback()).toBe(false);

    harness.promptTextInput.value = 'Prompt text';
    Object.defineProperty(harness.promptFileInput, 'files', {
      configurable: true,
      value: [new File(['prompt'], 'prompt.txt')],
    });
    Object.defineProperty(harness.referenceFileInput, 'files', {
      configurable: true,
      value: [new File(['reference'], 'reference.wav')],
    });

    expect(harness.config.renderController.getConditioningDraftState()).toEqual({
      promptFileSelected: true,
      promptTextPresent: true,
      referenceFileSelected: true,
    });

    await expect(
      harness.config.renderController.finalizeRender?.('voice', {
        finalizeRender,
      } as any),
    ).resolves.toBe('finalized');
    expect(finalizeRender).toHaveBeenCalledWith('voice');

    await harness.config.renderController.selectDrill('drill-1');
    expect(selectDrill).toHaveBeenCalledWith('drill-1');
  });
});
