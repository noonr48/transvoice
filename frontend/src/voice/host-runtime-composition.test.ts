import { describe, expect, it, vi } from 'vitest';

import { createVoiceHostRuntimeComposition } from './host-runtime-composition';
import { createVoiceRuntimeStore } from './runtime-store';

function createHarness() {
  const store = createVoiceRuntimeStore();
  store.updateUiState((current) => ({
    ...current,
    coachThread: [
      {
        id: 'user-1',
        role: 'user',
        channel: 'coach',
        kind: 'reply',
        content: 'Question',
        createdAt: 1,
      },
      {
        id: 'coach-2',
        role: 'coach',
        channel: 'coach',
        kind: 'reply',
        content: 'Answer',
        createdAt: 2,
      },
    ],
  }));

  const captured: Record<string, any> = {};
  const render = vi.fn();
  const runtimeStatusController = {
    getState: vi.fn(() => ({ kind: 'runtime-status' }) as any),
    applyHealthStatusPayload: vi.fn(),
    applyInputProviderStatusPayload: vi.fn(),
  };

  let coachShell: any = null;
  let runtimeShell: any = null;

  const hostActionsController = {
    disarmVoicePracticeSession: vi.fn(async () => true),
  };
  const appRuntime = {
    hasModeActivity: vi.fn(() => true),
    getSummaryText: vi.fn(() => 'Voice summary'),
  };
  const builtDevices = [
    {
      deviceId: 'usb-mic',
      label: 'USB Mic',
      groupId: null,
      isDefault: false,
    },
  ];
  const selectedDevice = {
    deviceId: 'selected-mic',
    label: 'Selected Mic',
    groupId: null,
    isDefault: false,
  };
  const compressedTimeline = [
    {
      t: 1,
      voiced: true,
      pitchHz: 200,
      pitchScore: 0.5,
      resonanceScore: 0.4,
      weightScore: 0.3,
      confidence: 0.8,
      loudnessDb: -18,
    },
  ];
  const browserRuntime = {
    readVoiceInputDevicePreference: vi.fn(() => 'usb-mic'),
    writeVoiceInputDevicePreference: vi.fn(),
    buildVoiceAudioInputDevices: vi.fn(() => builtDevices),
    getSelectedVoiceAudioInput: vi.fn(() => selectedDevice),
    refreshVoiceAudioInputDevices: vi.fn(async () => builtDevices),
    compressVoiceTimeline: vi.fn(() => compressedTimeline),
    ensureVoiceCueSheetCard: vi.fn(() => ({ id: 'cue-card' })),
  };

  const composition = createVoiceHostRuntimeComposition({
    store,
    runtimeStatusController,
    getCurrentMode: () => 'voice',
    getCurrentSessionId: () => 'session-1',
    getIsConnected: () => true,
    resolveSessionMode: () => 'voice',
    getCoachQuestionInput: () => null,
    render,
    applyVoiceBackendPayload: vi.fn(),
    submitRuntimeCoachQuestionRequest: vi.fn(),
    prepareConditioningLatentsRequest: vi.fn(),
    getCoachShell: () => coachShell,
    getRuntimeShell: () => runtimeShell,
    getLiveTransitionController: () => null,
    isSpeechSynthesisBusy: () => false,
    getVoiceSessionStreamUrl: (voiceSessionId) => `wss://${voiceSessionId}`,
    syncPersistedReferenceAnalysis: vi.fn(() => null),
    document,
  }, {
    createVoiceHostActionsController: vi.fn((config) => {
      captured.hostActions = config;
      return hostActionsController as any;
    }),
    createVoiceAppRuntime: vi.fn((config) => {
      captured.appRuntime = config;
      return appRuntime as any;
    }),
    createVoiceBrowserRuntime: vi.fn((config) => {
      captured.browserRuntime = config;
      return browserRuntime as any;
    }),
  });

  const coachShellImpl = {
    stopCoachListening: vi.fn(),
    startCoachListening: vi.fn(async () => true),
    toggleCoachListening: vi.fn(),
    toggleContinuousMode: vi.fn(async () => undefined),
    toggleSpeechProvider: vi.fn(async () => undefined),
    toggleInputProvider: vi.fn(async () => undefined),
    clearCoachPollTimer: vi.fn(),
    speakCoachMessage: vi.fn(() => true),
    stopCoachSpeech: vi.fn(),
  };
  const runtimeShellImpl = { id: 'runtime-shell' };

  return {
    composition,
    captured,
    store,
    render,
    runtimeStatusController,
    hostActionsController,
    appRuntime,
    browserRuntime,
    coachShellImpl,
    runtimeShellImpl,
    setCoachShell(value: unknown) {
      coachShell = value;
    },
    setRuntimeShell(value: unknown) {
      runtimeShell = value;
    },
  };
}

describe('voice host runtime composition', () => {
  it('keeps host action and app runtime dependencies late-bound to the coach and runtime shells', async () => {
    const harness = createHarness();

    expect(harness.composition.voiceHostActionController).toBe(harness.hostActionsController);
    expect(harness.composition.voiceAppRuntime).toBe(harness.appRuntime);
    expect(harness.composition.voiceBrowserRuntime).toBe(harness.browserRuntime);
    expect(harness.captured.hostActions.getAppRuntime()).toBe(harness.appRuntime);
    expect(harness.captured.hostActions.getCoachShell()).toBeNull();
    expect(harness.captured.hostActions.getRuntimeShell()).toBeNull();
    expect(harness.captured.appRuntime.getRuntimeShell()).toBeNull();

    await expect(harness.captured.appRuntime.disarmPracticeSession('manual disarm')).resolves.toBe(true);
    expect(harness.hostActionsController.disarmVoicePracticeSession).toHaveBeenCalledWith('manual disarm');

    harness.setCoachShell(harness.coachShellImpl);
    harness.setRuntimeShell(harness.runtimeShellImpl);

    expect(harness.captured.hostActions.getCoachShell()).toBe(harness.coachShellImpl);
    expect(harness.captured.hostActions.getRuntimeShell()).toBe(harness.runtimeShellImpl);
    expect(harness.captured.appRuntime.getRuntimeShell()).toBe(harness.runtimeShellImpl);

    harness.captured.appRuntime.runtimeResetDependencies.stopListening(true);
    harness.captured.appRuntime.runtimeResetDependencies.stopSpeech();
    harness.captured.appRuntime.runtimeResetDependencies.clearCoachPollTimer();

    expect(harness.coachShellImpl.stopCoachListening).toHaveBeenCalledWith(true);
    expect(harness.coachShellImpl.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(harness.coachShellImpl.clearCoachPollTimer).toHaveBeenCalledTimes(1);
    expect(harness.captured.appRuntime.runtimeResetDependencies.getLatestCoachMessageId()).toBe('coach-2');
  });

  it('delegates browser, coach, and app-runtime helper wrappers through the composed seam', async () => {
    const harness = createHarness();
    harness.setCoachShell(harness.coachShellImpl);

    expect(harness.composition.hasVoiceModeActivity()).toBe(true);
    expect(harness.composition.getVoiceSummaryText()).toBe('Voice summary');
    expect(harness.appRuntime.hasModeActivity).toHaveBeenCalledTimes(1);
    expect(harness.appRuntime.getSummaryText).toHaveBeenCalledTimes(1);

    expect(harness.composition.readVoiceInputDevicePreference()).toBe('usb-mic');
    harness.composition.writeVoiceInputDevicePreference('new-mic');
    expect(harness.composition.buildVoiceAudioInputDevices([] as MediaDeviceInfo[])).toEqual([
      {
        deviceId: 'usb-mic',
        label: 'USB Mic',
        groupId: null,
        isDefault: false,
      },
    ]);
    expect(harness.composition.getSelectedVoiceAudioInput()).toEqual({
      deviceId: 'selected-mic',
      label: 'Selected Mic',
      groupId: null,
      isDefault: false,
    });
    await expect(harness.composition.refreshVoiceAudioInputDevices(true)).resolves.toEqual([
      {
        deviceId: 'usb-mic',
        label: 'USB Mic',
        groupId: null,
        isDefault: false,
      },
    ]);
    expect(harness.composition.compressVoiceTimeline([], 60)).toEqual([
      {
        t: 1,
        voiced: true,
        pitchHz: 200,
        pitchScore: 0.5,
        resonanceScore: 0.4,
        weightScore: 0.3,
        confidence: 0.8,
        loudnessDb: -18,
      },
    ]);
    harness.composition.ensureVoiceCueSheetCard();

    expect(harness.browserRuntime.readVoiceInputDevicePreference).toHaveBeenCalledTimes(1);
    expect(harness.browserRuntime.writeVoiceInputDevicePreference).toHaveBeenCalledWith('new-mic');
    expect(harness.browserRuntime.buildVoiceAudioInputDevices).toHaveBeenCalledWith([]);
    expect(harness.browserRuntime.getSelectedVoiceAudioInput).toHaveBeenCalledTimes(1);
    expect(harness.browserRuntime.refreshVoiceAudioInputDevices).toHaveBeenCalledWith(true);
    expect(harness.browserRuntime.compressVoiceTimeline).toHaveBeenCalledWith([], 60);
    expect(harness.browserRuntime.ensureVoiceCueSheetCard).toHaveBeenCalledTimes(1);

    await expect(harness.composition.startVoiceCoachListening()).resolves.toBe(true);
    harness.composition.stopVoiceCoachListening(true);
    harness.composition.stopVoiceCoachSpeech();
    harness.composition.toggleVoiceCoachListening();
    harness.composition.toggleVoiceCoachContinuousMode();
    harness.composition.toggleVoiceCoachSpeechProvider();
    harness.composition.toggleVoiceCoachInputProvider();
    harness.composition.clearVoiceCoachPollTimer();

    expect(harness.coachShellImpl.startCoachListening).toHaveBeenCalledTimes(1);
    expect(harness.coachShellImpl.stopCoachListening).toHaveBeenCalledWith(true);
    expect(harness.coachShellImpl.stopCoachSpeech).toHaveBeenCalledTimes(1);
    expect(harness.coachShellImpl.toggleCoachListening).toHaveBeenCalledTimes(1);
    expect(harness.coachShellImpl.toggleContinuousMode).toHaveBeenCalledTimes(1);
    expect(harness.coachShellImpl.toggleSpeechProvider).toHaveBeenCalledTimes(1);
    expect(harness.coachShellImpl.toggleInputProvider).toHaveBeenCalledTimes(1);
    expect(harness.coachShellImpl.clearCoachPollTimer).toHaveBeenCalledTimes(1);

    expect(harness.composition.speakVoiceCoachMessage({
      id: 'coach-3',
      role: 'coach',
      channel: 'coach',
      kind: 'reply',
      content: 'Listen to the vowel shape.',
      createdAt: 3,
    })).toBe(true);
    expect(harness.coachShellImpl.speakCoachMessage).toHaveBeenCalledWith({
      id: 'coach-3',
      role: 'coach',
      channel: 'coach',
      kind: 'reply',
      content: 'Listen to the vowel shape.',
      createdAt: 3,
    }, 0.76);

    harness.composition.applyVoiceInputProviderStatusPayload({ provider: 'backend' });
    expect(harness.runtimeStatusController.applyInputProviderStatusPayload)
      .toHaveBeenCalledWith({ provider: 'backend' });
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBe(0.018);

    harness.store.updateUiState((current) => ({
      ...current,
      advancedPanel: {
        ...current.advancedPanel,
        vadRmsThreshold: 0.02,
      },
    }));
    expect(harness.composition.getVoiceCoachInputSilenceThreshold()).toBe(0.02);
  });

  it('returns safe defaults when no coach shell is available', async () => {
    const harness = createHarness();

    await expect(harness.composition.startVoiceCoachListening()).resolves.toBe(false);
    expect(harness.composition.speakVoiceCoachMessage({
      id: 'coach-4',
      role: 'coach',
      channel: 'coach',
      kind: 'reply',
      content: 'No shell',
      createdAt: 4,
    })).toBe(false);
  });
});
