import { describe, expect, it, vi } from 'vitest';

import { createVoiceCoachSpeechController } from './coach-speech';
import { createVoiceHostAssemblyConfig } from './host-assembly-config';
import { createVoiceInteractionSnapshot } from './orchestrator';
import { createVoiceRuntimeCoordinator } from './runtime-coordinator';
import { createVoiceRuntimeStore } from './runtime-store';

function createHarness(options: { voiceTrainerUrl?: string; voiceTrainerToken?: string | null } = {}) {
  const store = createVoiceRuntimeStore();
  const runtimeStatusController = {
    getState: vi.fn(() => ({ kind: 'runtime-status' }) as any),
    applyHealthStatusPayload: vi.fn(),
    applyInputProviderStatusPayload: vi.fn(),
  };

  let currentMode = 'voice';
  let currentSessionId: string | null = 'session-1';
  let isConnected = false;
  let sessionLease: object = {};

  let questionInput: HTMLInputElement | null = document.createElement('input');
  let targetPresetSelect: HTMLSelectElement | null = document.createElement('select');
  let referencePlayer: HTMLAudioElement | null = document.createElement('audio');
  let promptTextInput: HTMLTextAreaElement | null = document.createElement('textarea');
  let promptFileInput: HTMLInputElement | null = document.createElement('input');
  let referenceFileInput: HTMLInputElement | null = document.createElement('input');
  let domBindings: { kind: string } | null = { kind: 'voice-dom-bindings' };

  const windowRef = {
    location: {
      protocol: 'https:' as const,
      hostname: 'voice.example',
    },
    speechSynthesis: {
      speaking: false,
      pending: false,
    },
    __tvCoach: undefined as undefined | {
      isSpeaking?: () => boolean;
    },
  };

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
    prepareConditioningLatents: vi.fn(),
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
    submitRuntimeCoachQuestion: vi.fn(),
    syncPreset: vi.fn(),
    syncReference: vi.fn(),
    updateCockpitState: vi.fn(),
    updateConditioningState: vi.fn(),
  };

  const resolveSessionMode = vi.fn((mode: string) => mode);
  const addTerminalLine = vi.fn();
  const appendCoachLine = vi.fn();
  const speakCoachLine = vi.fn(() => true);
  const getSessionLease = () => sessionLease;
  const releasePracticeForCoachListening = vi.fn(async () => undefined);

  const config = createVoiceHostAssemblyConfig({
    store,
    runtimeStatusController: runtimeStatusController as any,
    voiceApi: voiceApi as any,
    kernelUrl: 'http://kernel',
    kernelWsUrl: 'ws://kernel',
    voiceTrainerUrl: options.voiceTrainerUrl ?? 'not-a-url',
    voiceTrainerToken: options.voiceTrainerToken ?? null,
    getCurrentMode: () => currentMode,
    getCurrentSessionId: () => currentSessionId,
    getIsConnected: () => isConnected,
    getSessionLease,
    releasePracticeForCoachListening,
    resolveSessionMode,
    addTerminalLine,
    appendCoachLine,
    speakCoachLine,
    getVoiceCoachQuestionInput: () => questionInput,
    getVoiceTargetPresetSelect: () => targetPresetSelect,
    getVoiceReferencePlayer: () => referencePlayer,
    getVoiceConditioningPromptTextInput: () => promptTextInput,
    getVoiceConditioningPromptFileInput: () => promptFileInput,
    getVoiceConditioningReferenceFileInput: () => referenceFileInput,
    getDomBindings: () => domBindings as any,
    document,
    window: windowRef,
  });

  return {
    config,
    store,
    runtimeStatusController,
    voiceApi,
    resolveSessionMode,
    addTerminalLine,
    appendCoachLine,
    speakCoachLine,
    getSessionLease,
    releasePracticeForCoachListening,
    windowRef,
    setCurrentMode(mode: string) {
      currentMode = mode;
    },
    setCurrentSessionId(sessionId: string | null) {
      currentSessionId = sessionId;
    },
    setIsConnected(connected: boolean) {
      isConnected = connected;
    },
    setSessionLease(nextLease: object) {
      sessionLease = nextLease;
    },
    setQuestionInput(nextInput: HTMLInputElement | null) {
      questionInput = nextInput;
    },
    setTargetPresetSelect(nextSelect: HTMLSelectElement | null) {
      targetPresetSelect = nextSelect;
    },
    setReferencePlayer(nextPlayer: HTMLAudioElement | null) {
      referencePlayer = nextPlayer;
    },
    setPromptTextInput(nextInput: HTMLTextAreaElement | null) {
      promptTextInput = nextInput;
    },
    setPromptFileInput(nextInput: HTMLInputElement | null) {
      promptFileInput = nextInput;
    },
    setReferenceFileInput(nextInput: HTMLInputElement | null) {
      referenceFileInput = nextInput;
    },
    setDomBindings(nextBindings: { kind: string } | null) {
      domBindings = nextBindings;
    },
  };
}

describe('voice host assembly config', () => {
  it('preserves live frontend getters while reusing shared dependencies', () => {
    const harness = createHarness();
    const initialSessionLease = harness.getSessionLease();
    const rotatedSessionLease = {};
    const nextQuestionInput = document.createElement('input');
    const nextTargetPresetSelect = document.createElement('select');
    const nextReferencePlayer = document.createElement('audio');
    const nextPromptTextInput = document.createElement('textarea');
    const nextPromptFileInput = document.createElement('input');
    const nextReferenceFileInput = document.createElement('input');
    const nextDomBindings = { kind: 'next-voice-dom-bindings' };

    harness.setCurrentMode('deeptutor');
    harness.setCurrentSessionId('session-2');
    harness.setIsConnected(true);
    harness.setQuestionInput(nextQuestionInput);
    harness.setTargetPresetSelect(nextTargetPresetSelect);
    harness.setReferencePlayer(nextReferencePlayer);
    harness.setPromptTextInput(nextPromptTextInput);
    harness.setPromptFileInput(nextPromptFileInput);
    harness.setReferenceFileInput(nextReferenceFileInput);
    harness.setDomBindings(nextDomBindings);

    expect(harness.config.store).toBe(harness.store);
    expect(harness.config.runtimeStatusController).toBe(harness.runtimeStatusController);
    expect(harness.config.composition.getCurrentMode()).toBe('deeptutor');
    expect(harness.config.composition.getCurrentSessionId()).toBe('session-2');
    expect(harness.config.composition.getIsConnected()).toBe(true);
    expect(harness.config.composition.resolveSessionMode).toBe(harness.resolveSessionMode);
    expect(harness.config.composition.getCoachQuestionInput()).toBe(nextQuestionInput);
    expect(harness.config.composition.document).toBe(document);

    expect(harness.config.orchestration.voiceApi).toBe(harness.voiceApi);
    expect(harness.config.orchestration.kernelUrl).toBe('http://kernel');
    expect(harness.config.orchestration.kernelWsUrl).toBe('ws://kernel');
    expect(harness.config.orchestration.getCurrentMode()).toBe('deeptutor');
    expect(harness.config.orchestration.getCurrentSessionId()).toBe('session-2');
    expect(harness.config.orchestration.getIsConnected()).toBe(true);
    expect(harness.config.orchestration.getSessionLease).toBe(harness.getSessionLease);
    expect(harness.config.orchestration.getSessionLease()).toBe(initialSessionLease);
    harness.setSessionLease(rotatedSessionLease);
    expect(harness.config.orchestration.getSessionLease()).toBe(rotatedSessionLease);
    expect(harness.config.orchestration.releasePracticeForCoachListening)
      .toBe(harness.releasePracticeForCoachListening);
    expect(harness.config.orchestration.addTerminalLine).toBe(harness.addTerminalLine);
    // The coach-line surface must reach the orchestration layer: it is what a
    // non-failure backend acknowledgment renders through.
    expect(harness.config.orchestration.appendCoachLine).toBe(harness.appendCoachLine);
    // Field repair 2026-07-26: the speech seam must survive assembly too — a
    // wordless ack that reaches the thread but not the speaker is the bug.
    expect(harness.config.orchestration.speakCoachLine).toBe(harness.speakCoachLine);
    expect(harness.config.orchestration.getVoiceCoachQuestionInput()).toBe(nextQuestionInput);
    expect(harness.config.orchestration.getVoiceTargetPresetSelect()).toBe(nextTargetPresetSelect);
    expect(harness.config.orchestration.getVoiceReferencePlayer()).toBe(nextReferencePlayer);
    expect(harness.config.orchestration.getVoiceConditioningPromptTextInput()).toBe(nextPromptTextInput);
    expect(harness.config.orchestration.getVoiceConditioningPromptFileInput()).toBe(nextPromptFileInput);
    expect(harness.config.orchestration.getVoiceConditioningReferenceFileInput()).toBe(
      nextReferenceFileInput,
    );
    expect(harness.config.orchestration.getDomBindings()).toBe(nextDomBindings);
  });

  it('routes composition api delegates through voiceApi and derives browser helpers', () => {
    const harness = createHarness();

    harness.config.composition.submitRuntimeCoachQuestionRequest('session-1', 'Next drill?');
    expect(harness.voiceApi.submitRuntimeCoachQuestion).toHaveBeenCalledWith(
      'session-1',
      'Next drill?',
      undefined,
      undefined,
    );
    harness.config.composition.submitRuntimeCoachQuestionRequest(
      'session-1',
      'Live question?',
      undefined,
      undefined,
      'listening-turn-9',
    );
    expect(harness.voiceApi.submitRuntimeCoachQuestion).toHaveBeenLastCalledWith(
      'session-1',
      'Live question?',
      undefined,
      undefined,
      'listening-turn-9',
    );

    const referenceFile = new File(['reference'], 'reference.wav');
    harness.config.composition.prepareConditioningLatentsRequest(
      'session-1',
      'cute-feminine',
      referenceFile,
      'bright reference voice',
    );
    expect(harness.voiceApi.prepareConditioningLatents).toHaveBeenCalledWith(
      'session-1',
      'cute-feminine',
      referenceFile,
      'bright reference voice',
    );

    expect(harness.config.composition.isSpeechSynthesisBusy()).toBe(false);
    harness.windowRef.speechSynthesis.speaking = true;
    expect(harness.config.composition.isSpeechSynthesisBusy()).toBe(true);
    harness.windowRef.speechSynthesis.speaking = false;
    harness.windowRef.speechSynthesis.pending = true;
    expect(harness.config.composition.isSpeechSynthesisBusy()).toBe(true);

    harness.windowRef.speechSynthesis = undefined as any;
    expect(harness.config.composition.isSpeechSynthesisBusy()).toBe(false);

    harness.windowRef.__tvCoach = {
      isSpeaking: () => true,
    };
    expect(harness.config.composition.isSpeechSynthesisBusy()).toBe(true);
    harness.windowRef.__tvCoach = {
      isSpeaking: () => false,
    };
    expect(harness.config.composition.isSpeechSynthesisBusy()).toBe(false);

    expect(harness.config.composition.getVoiceSessionStreamUrl('voice-session-1')).toBe(
      'wss://voice.example:8002/api/v1/voice/sessions/voice-session-1/stream',
    );

    harness.windowRef.location.protocol = 'http:';
    expect(harness.config.composition.getVoiceSessionStreamUrl('voice-session-2')).toBe(
      'ws://voice.example:8002/api/v1/voice/sessions/voice-session-2/stream',
    );
  });

  it('threads VoiceTrainer auth tokens into stream URLs when configured', () => {
    const harness = createHarness({
      voiceTrainerUrl: 'https://trainer.example:8123/voice-trainer',
      voiceTrainerToken: 'token value/1',
    });

    expect(harness.config.composition.getVoiceSessionStreamUrl('voice-session-1')).toBe(
      'wss://trainer.example:8123/voice-trainer/api/v1/voice/sessions/voice-session-1/stream?token=token+value%2F1',
    );
  });

  it('keeps a polling render from reopening capture during pending selected-voice generation', async () => {
    const harness = createHarness();
    let spokenMessageId: string | null = null;
    let generateSignal: AbortSignal | null = null;
    const generateResponse = new Promise<Response>(() => undefined);
    const speechController = createVoiceCoachSpeechController({
      kernelUrl: 'http://kernel',
      getSessionContext: () => ({ currentSessionId: 'session-1', isConnected: true }),
      getRequestedProvider: () => 'voxcpm',
      getReferenceClipId: () => 'selected-reference-clip',
      setLastSpokenCoachMessageId: (messageId) => { spokenMessageId = messageId; },
      getLastSpokenCoachMessageId: () => spokenMessageId,
      setVoxCpmStatus: vi.fn(),
      onPlaybackFinished: vi.fn(),
      onPlaybackError: vi.fn(),
      onRender: vi.fn(),
      fetchImpl: vi.fn((_input, init) => {
        generateSignal = init?.signal ?? null;
        return generateResponse;
      }) as typeof fetch,
    });
    harness.windowRef.__tvCoach = {
      isSpeaking: () => speechController.isSpeaking(),
    };
    const coachMessage = {
      id: 'coach-1',
      role: 'coach' as const,
      channel: 'runtime' as const,
      kind: 'runtime-answer' as const,
      content: 'Let the ending land gently.',
      createdAt: 1,
    };
    const startCoachListening = vi.fn(async () => {
      speechController.stop();
      return true;
    });
    const coordinator = createVoiceRuntimeCoordinator({
      getInteractionSnapshot: () => createVoiceInteractionSnapshot({
        currentMode: 'voice',
        currentSessionId: 'session-1',
        isConnected: true,
        voiceTakeProcessing: false,
        voiceTakeActive: false,
        voiceTransportStatus: 'idle',
        voiceCoachQuestionStatus: 'idle',
        voiceCoachTaskStatus: 'idle',
        voiceDeepTutorLessonStatus: 'idle',
        voiceSpeechRecognitionStatus: 'idle',
        speechSynthesisBusy: harness.config.composition.isSpeechSynthesisBusy(),
        voiceSessionArmed: false,
      }),
      hasInputProvider: () => true,
      supportsAutomaticTurnBoundary: () => true,
      getRecoveryState: () => ({ shouldDisableContinuous: false }),
      getContinuousEnabled: () => true,
      getSpeechRecognitionStatus: () => 'idle',
      getQuestionDraft: () => '',
      getLatestCoachMessage: () => coachMessage,
      getLastSpokenCoachMessageId: () => spokenMessageId,
      runtimeService: {
        canSpeakCoachMessage: () => true,
        speakCoachMessage: (message) => speechController.speak(message, { provider: 'voxcpm' }),
        startCoachListening,
        reopenCoachListeningWithNotice: startCoachListening,
      },
      armPracticeSessionWithNotice: vi.fn(async () => undefined),
      disarmPracticeSession: vi.fn(async () => undefined),
      render: vi.fn(),
      getPostPlaybackContext: () => ({
        currentMode: 'voice',
        currentSessionId: 'session-1',
        isConnected: true,
        hasActiveGuideSession: true,
        voiceSessionArmed: false,
        voiceTakeActive: false,
        voiceTakeProcessing: false,
        voiceTransportStatus: 'idle',
        voiceDeepTutorLessonStatus: 'idle',
        voiceCoachTaskStatus: 'idle',
        voiceCoachQuestionStatus: 'idle',
        referenceMimicAction: 'hold',
      }),
    });

    expect((await coordinator.runRenderHandoff()).action).toBe('speak-latest-coach');
    expect(speechController.isSpeaking()).toBe(true);
    expect((await coordinator.runRenderHandoff()).action).toBe('noop');
    expect(startCoachListening).not.toHaveBeenCalled();
    expect(generateSignal?.aborted).toBe(false);
  });
});
