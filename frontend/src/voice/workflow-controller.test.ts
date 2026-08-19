import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  VoiceBackendPayload,
  VoiceDrillState,
  VoiceReferenceAnalysis,
  VoiceUiState,
} from './state';
import {
  createDefaultVoiceDrillState,
  createDefaultVoiceUiState,
  normalizeVoiceUiState,
} from './state';
import { createVoiceWorkflowController } from './workflow-controller';

function mountCustomPresetStatusDom() {
  document.body.innerHTML = `
    <button id="voice-save-reference-preset" type="button"></button>
    <button id="voice-seed-custom-preset" type="button"></button>
    <div id="voice-custom-preset-list"></div>
    <p id="voice-custom-preset-library-status"></p>
    <p id="voice-custom-preset-workspace-status"></p>
  `;
}

afterEach(() => {
  document.body.innerHTML = '';
});

function createHarness(options: {
  currentSessionId?: string | null;
  isConnected?: boolean;
  currentMode?: string;
  voiceTransportStatus?: string | null;
  voiceUiState?: VoiceUiState;
  syncSessionStateFromBackend?: (silenceCoach?: boolean) => Promise<VoiceUiState | null>;
} = {}) {
  let currentMode = options.currentMode ?? 'voice';
  let voiceUiState = options.voiceUiState || createDefaultVoiceUiState();
  let voiceDrillState: VoiceDrillState = createDefaultVoiceDrillState({ targetPreset: voiceUiState.targetPreset });
  let voiceDrillStatus: 'idle' | 'loading' | 'error' = 'idle';
  let voiceDrillError: string | null = null;
  let voiceDrillSelectionPendingId: string | null = null;
  let voiceForecastStatus: 'idle' | 'loading' | 'error' = 'idle';
  let voiceForecastError: string | null = null;
  let voiceLiveTrace: unknown[] = [];
  let voiceLastTakeTrace: unknown[] = [];

  const applyVoiceBackendPayload = vi.fn((payload: VoiceBackendPayload) => {
    if (payload.voiceState) {
      voiceUiState = normalizeVoiceUiState({
        ...voiceUiState,
        ...payload.voiceState,
      });
    }
  });
  const syncSessionStateFromBackend = vi.fn(options.syncSessionStateFromBackend || (async () => voiceUiState));
  const getHealthSnapshot = vi.fn(async () => ({
    health: { status: 'online' },
    speechStatus: { providers: { voxcpm: { enabled: true, available: true } } },
    inputStatus: { providers: { backend: { enabled: true, available: true } } },
  }));
  const getKnowledgeStatus = vi.fn(async () => ({
    statusSurface: {
      label: 'Ready',
      state: 'ready',
    },
  }));
  const applySpeechStatusPayload = vi.fn();
  const applyHealthStatusPayload = vi.fn();
  const applyInputProviderStatusPayload = vi.fn();
  const markVoiceServiceOffline = vi.fn();
  const setKnowledgeStatusText = vi.fn();
  const getDrillsRequest = vi.fn(async () => ({
    targetPreset: voiceUiState.targetPreset,
    selectedLessonId: 'lesson-1',
    drills: [
      {
        id: 'lesson-1',
        title: 'Bright ending',
        focus: 'ending',
        phrase: 'Lift the ending',
        description: 'Keep the release bright.',
        cues: ['lift', 'forward'],
        tags: ['ending'],
      },
    ],
    recommendedIds: ['lesson-1'],
  }));
  const syncPresetRequest = vi.fn(async (_sessionId: string, targetPreset: string) => ({
    voiceState: {
      targetPreset,
      lastError: null,
    },
  }));
  const listTargetPresetsRequest = vi.fn(async () => ({
    presets: [
      {
        id: 'preset-1',
        name: 'Saved Voice',
        kind: 'reference',
        basePreset: 'cute-feminine',
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        archivedAt: null,
        targetVoiceProfile: null,
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        referenceAnalysis: null,
      },
    ],
  }));
  const saveReferencePresetRequest = vi.fn(async (_sessionId: string | null, payload?: { presetId?: string | null; name?: string }) => ({
    presets: [
      {
        id: payload?.presetId || 'preset-new',
        name: payload?.name || 'Saved Voice',
        kind: 'reference',
        basePreset: 'cute-feminine',
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        archivedAt: null,
        targetVoiceProfile: null,
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        referenceAnalysis: null,
      },
    ],
    preset: {
      id: payload?.presetId || 'preset-new',
      name: payload?.name || 'Saved Voice',
      kind: 'reference',
      basePreset: 'cute-feminine',
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      archivedAt: null,
      targetVoiceProfile: null,
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      referenceAnalysis: null,
    },
  }));
  const saveHandmadePresetRequest = vi.fn(async () => ({
    voiceState: {
      targetPreset: 'bright-playful',
      targetSource: 'custom-handmade',
      selectedCustomPresetId: 'preset-2',
      selectedCustomPresetName: 'Handmade Voice',
      lastError: null,
    },
    presets: [
      {
        id: 'preset-2',
        name: 'Handmade Voice',
        kind: 'handmade',
        basePreset: 'bright-playful',
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        archivedAt: null,
        targetVoiceProfile: {
          sourceFilename: 'Handmade Voice',
          targetPreset: 'bright-playful',
          pitchFloorHz: 170,
          pitchCeilingHz: 240,
          resonanceFloor: 0.55,
          resonanceCeiling: 0.82,
          weightFloor: 0.18,
          weightCeiling: 0.42,
          stylePrompt: 'sweet',
          notes: ['easy'],
        } as any,
        referenceClipId: null,
        referenceClipName: null,
        referenceAnalysis: null,
      },
    ],
    preset: {
      id: 'preset-2',
      name: 'Handmade Voice',
      kind: 'handmade',
      basePreset: 'bright-playful',
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      archivedAt: null,
      targetVoiceProfile: {
        sourceFilename: 'Handmade Voice',
        targetPreset: 'bright-playful',
        pitchFloorHz: 170,
        pitchCeilingHz: 240,
        resonanceFloor: 0.55,
        resonanceCeiling: 0.82,
        weightFloor: 0.18,
        weightCeiling: 0.42,
        stylePrompt: 'sweet',
        notes: ['easy'],
      } as any,
        referenceClipId: null,
        referenceClipName: null,
        referenceAnalysis: null,
    },
  }));
  const selectTargetPresetRequest = vi.fn(async (_sessionId: string | null, presetId: string) => ({
    voiceState: {
      selectedCustomPresetId: presetId,
      selectedCustomPresetName: 'Saved Voice',
      targetSource: 'custom-reference',
      lastError: null,
    },
    presets: [
      {
        id: presetId,
        name: 'Saved Voice',
        kind: 'reference',
        basePreset: 'cute-feminine',
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        archivedAt: null,
        targetVoiceProfile: null,
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        referenceAnalysis: null,
      },
    ],
    preset: {
      id: presetId,
      name: 'Saved Voice',
      kind: 'reference',
      basePreset: 'cute-feminine',
      createdAt: 1,
      updatedAt: 2,
      archived: false,
      archivedAt: null,
      targetVoiceProfile: null,
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      referenceAnalysis: null,
    },
  }));
  const duplicateTargetPresetRequest = vi.fn(async (_sessionId: string | null, presetId: string) => ({
    preset: {
      id: `${presetId}-copy`,
      name: 'Saved Voice Copy',
      kind: 'reference',
      basePreset: 'cute-feminine',
      createdAt: 1,
      updatedAt: 3,
      archived: false,
      archivedAt: null,
      targetVoiceProfile: null,
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      referenceAnalysis: null,
    },
    presets: [
      {
        id: presetId,
        name: 'Saved Voice',
        kind: 'reference',
        basePreset: 'cute-feminine',
        createdAt: 1,
        updatedAt: 2,
        archived: false,
        archivedAt: null,
        targetVoiceProfile: null,
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        referenceAnalysis: null,
      },
      {
        id: `${presetId}-copy`,
        name: 'Saved Voice Copy',
        kind: 'reference',
        basePreset: 'cute-feminine',
        createdAt: 1,
        updatedAt: 3,
        archived: false,
        archivedAt: null,
        targetVoiceProfile: null,
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        referenceAnalysis: null,
      },
    ],
  }));
  const archiveTargetPresetRequest = vi.fn(async (_sessionId: string | null, presetId: string) => ({
    preset: {
      id: presetId,
      name: 'Saved Voice',
      kind: 'reference',
      basePreset: 'cute-feminine',
      createdAt: 1,
      updatedAt: 4,
      archived: true,
      archivedAt: 4,
      targetVoiceProfile: null,
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      referenceAnalysis: null,
    },
    presets: [],
  }));
  const restoreTargetPresetRequest = vi.fn(async (_sessionId: string | null, presetId: string) => ({
    preset: {
      id: presetId,
      name: 'Saved Voice',
      kind: 'reference',
      basePreset: 'cute-feminine',
      createdAt: 1,
      updatedAt: 5,
      archived: false,
      archivedAt: null,
      targetVoiceProfile: null,
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      referenceAnalysis: null,
    },
    presets: [
      {
        id: presetId,
        name: 'Saved Voice',
        kind: 'reference',
        basePreset: 'cute-feminine',
        createdAt: 1,
        updatedAt: 5,
        archived: false,
        archivedAt: null,
        targetVoiceProfile: null,
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        referenceAnalysis: null,
      },
    ],
  }));
  const deleteTargetPresetRequest = vi.fn(async (_sessionId: string | null, presetId: string) => ({
    deletedPresetId: presetId,
    presets: [],
  }));
  const selectDrillRequest = vi.fn(async (_sessionId: string, drillId: string) => ({
    voiceState: {
      lessonId: drillId,
      lastError: null,
    },
    drill: {
      title: 'Guided bright ending',
    },
    selectedLessonId: drillId,
    drills: [
      {
        id: drillId,
        title: 'Guided bright ending',
        focus: 'ending',
        phrase: 'Guide the ending',
        description: 'Guide drill',
        cues: ['lift'],
        tags: ['guided'],
      },
    ],
    recommendedIds: [drillId],
  }));
  const analyzeReferenceRequest = vi.fn(async (_file: File, targetPreset: string) => ({
    clipId: 'clip-1',
    filename: 'reference.wav',
    durationMs: 1200,
    targetPreset,
    timeline: [],
    metrics: null,
  }));
  const syncReferenceRequest = vi.fn(async () => ({
    voiceState: {
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      lastError: null,
    },
  }));
  const projectPhraseForecastRequest = vi.fn(async (_sessionId: string, phrase: string) => ({
    voiceState: {
      forecastPhrase: phrase,
      phraseForecast: {
        phrase,
        summary: 'Projected phrase',
      },
      lastError: null,
    },
  }));
  const adoptResolvedReferenceAnalysis = vi.fn((data: { clipId?: string | null; filename?: string | null }) => ({
    clipId: data.clipId || null,
    filename: data.filename || null,
    durationMs: 1200,
    metrics: null,
    timeline: [],
  } satisfies VoiceReferenceAnalysis));
  const refreshCockpitLine = vi.fn(async () => null);
  const render = vi.fn();
  const addTerminalLine = vi.fn();
  const startVoiceAudioStream = vi.fn(async () => undefined);
  const startVoicePracticeSession = vi.fn(async () => true);
  const assertPracticeTargetUnlocked = vi.fn();

  const controller = createVoiceWorkflowController({
    getSessionContext: () => ({
      currentSessionId: options.currentSessionId === undefined ? 'session-1' : options.currentSessionId,
      isConnected: options.isConnected ?? true,
      currentMode,
    }),
    getVoiceUiState: () => voiceUiState,
    updateVoiceUiState: (updater) => {
      voiceUiState = normalizeVoiceUiState(updater(voiceUiState));
    },
    getVoiceTransportStatus: () => options.voiceTransportStatus ?? 'idle',
    getRequestedTargetPreset: () => voiceUiState.targetPreset || 'cute-feminine',
    assertPracticeTargetUnlocked,
    applyVoiceBackendPayload,
    syncSessionStateFromBackend,
    getHealthSnapshot,
    getKnowledgeStatus,
    applyHealthStatusPayload,
    applySpeechStatusPayload,
    applyInputProviderStatusPayload,
    markVoiceServiceOffline,
    setKnowledgeStatusText,
    getDrillsRequest,
    syncPresetRequest,
    listTargetPresetsRequest,
    saveReferencePresetRequest,
    saveHandmadePresetRequest,
    selectTargetPresetRequest,
    duplicateTargetPresetRequest,
    archiveTargetPresetRequest,
    restoreTargetPresetRequest,
    deleteTargetPresetRequest,
    selectDrillRequest,
    analyzeReferenceRequest,
    syncReferenceRequest,
    projectPhraseForecastRequest,
    adoptResolvedReferenceAnalysis,
    refreshCockpitLine,
    setDrillState: (state) => {
      voiceDrillState = state;
    },
    setDrillStatus: (status) => {
      voiceDrillStatus = status;
    },
    setDrillError: (error) => {
      voiceDrillError = error;
    },
    setDrillSelectionPendingId: (drillId) => {
      voiceDrillSelectionPendingId = drillId;
    },
    setForecastStatus: (status) => {
      voiceForecastStatus = status;
    },
    setForecastError: (error) => {
      voiceForecastError = error;
    },
    resetVoiceTraces: () => {
      voiceLiveTrace = [];
      voiceLastTakeTrace = [];
    },
    clearLastTakeTrace: () => {
      voiceLastTakeTrace = [];
    },
    render,
    addTerminalLine,
    startVoiceAudioStream,
    startVoicePracticeSession,
  });

  return {
    controller,
    setCurrentMode: (mode: string) => {
      currentMode = mode;
    },
    getVoiceUiState: () => voiceUiState,
    getVoiceDrillState: () => voiceDrillState,
    getVoiceDrillStatus: () => voiceDrillStatus,
    getVoiceDrillError: () => voiceDrillError,
    getVoiceDrillSelectionPendingId: () => voiceDrillSelectionPendingId,
    getVoiceForecastStatus: () => voiceForecastStatus,
    getVoiceForecastError: () => voiceForecastError,
    getVoiceLiveTrace: () => voiceLiveTrace,
    getVoiceLastTakeTrace: () => voiceLastTakeTrace,
    applyVoiceBackendPayload,
    syncSessionStateFromBackend,
    getHealthSnapshot,
    getKnowledgeStatus,
    applyHealthStatusPayload,
    applySpeechStatusPayload,
    applyInputProviderStatusPayload,
    markVoiceServiceOffline,
    setKnowledgeStatusText,
    getDrillsRequest,
    syncPresetRequest,
    listTargetPresetsRequest,
    saveReferencePresetRequest,
    saveHandmadePresetRequest,
    selectTargetPresetRequest,
    duplicateTargetPresetRequest,
    archiveTargetPresetRequest,
    restoreTargetPresetRequest,
    deleteTargetPresetRequest,
    selectDrillRequest,
    analyzeReferenceRequest,
    syncReferenceRequest,
    projectPhraseForecastRequest,
    adoptResolvedReferenceAnalysis,
    refreshCockpitLine,
    render,
    addTerminalLine,
    startVoiceAudioStream,
    startVoicePracticeSession,
    assertPracticeTargetUnlocked,
  };
}

describe('voice workflow controller', () => {
  it('refreshes voice health and applies provider status payloads', async () => {
    const harness = createHarness();

    await expect(harness.controller.refreshHealth()).resolves.toBe(true);

    expect(harness.applySpeechStatusPayload).toHaveBeenCalledTimes(1);
    expect(harness.applyInputProviderStatusPayload).toHaveBeenCalledTimes(1);
    expect(harness.getVoiceUiState()).toMatchObject({
      serviceStatus: 'online',
      lastError: null,
    });
    expect(harness.render).toHaveBeenCalledTimes(1);
  });

  it('refreshes drills and syncs the selected lesson back into voice UI state', async () => {
    const harness = createHarness();

    await harness.controller.refreshDrills();

    expect(harness.getDrillsRequest).toHaveBeenCalledWith('session-1', 'cute-feminine');
    expect(harness.getVoiceDrillState()).toMatchObject({
      selectedLessonId: 'lesson-1',
    });
    expect(harness.getVoiceUiState().lessonId).toBe('lesson-1');
    expect(harness.getVoiceDrillStatus()).toBe('idle');
    expect(harness.getVoiceDrillError()).toBe(null);
  });

  it('applies offline preset changes locally without calling the backend', async () => {
    const harness = createHarness({
      currentSessionId: null,
      isConnected: false,
      voiceUiState: createDefaultVoiceUiState({
        targetPreset: 'cute-feminine',
        lessonId: 'lesson-old',
        targetVoiceProfile: {
          preset: 'cute-feminine',
        } as any,
        phraseForecast: {
          phrase: 'old phrase',
        } as any,
        forecastPhrase: 'old phrase',
      }),
    });

    await harness.controller.syncPreset('warm');

    expect(harness.syncPresetRequest).not.toHaveBeenCalled();
    expect(harness.getVoiceUiState()).toMatchObject({
      targetPreset: 'warm',
      lessonId: null,
      targetVoiceProfile: null,
      phraseForecast: null,
      forecastPhrase: null,
    });
    expect(harness.getVoiceDrillState().targetPreset).toBe('warm');
    expect(harness.getVoiceForecastStatus()).toBe('idle');
    expect(harness.getVoiceForecastError()).toBe(null);
    expect(harness.getVoiceLiveTrace()).toEqual([]);
    expect(harness.getVoiceLastTakeTrace()).toEqual([]);
  });

  it('surfaces drill selection failures while clearing the pending state', async () => {
    const harness = createHarness();
    harness.selectDrillRequest.mockRejectedValueOnce(new Error('Drill unavailable.'));

    await expect(harness.controller.selectDrill('lesson-1')).rejects.toThrow('Drill unavailable.');

    expect(harness.getVoiceDrillError()).toBe('Drill unavailable.');
    expect(harness.getVoiceUiState().lastError).toBe('Drill unavailable.');
    expect(harness.getVoiceDrillSelectionPendingId()).toBe(null);
  });

  it('analyzes and syncs a reference clip through the shared workflow path', async () => {
    const harness = createHarness();
    const file = new File(['test'], 'voice-ref.wav', { type: 'audio/wav' });

    await harness.controller.analyzeReference(file);

    expect(harness.analyzeReferenceRequest).toHaveBeenCalledWith(file, 'cute-feminine');
    expect(harness.syncReferenceRequest).toHaveBeenCalledWith('session-1', 'clip-1', 'reference.wav');
    expect(harness.applyVoiceBackendPayload).toHaveBeenCalledTimes(1);
    expect(harness.adoptResolvedReferenceAnalysis).toHaveBeenCalledTimes(1);
    expect(harness.getVoiceUiState()).toMatchObject({
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
      // P0.3: an uploaded reference OWNS the target (voice-copy front door).
      targetSource: 'reference',
      lastError: null,
    });
    expect(harness.getVoiceForecastStatus()).toBe('idle');
    expect(harness.refreshCockpitLine).toHaveBeenCalledWith('regenerate');
    expect(harness.addTerminalLine).toHaveBeenCalledWith('system', 'Reference ready: reference.wav');
  });

  it('refreshes the custom target preset library', async () => {
    const harness = createHarness();

    await harness.controller.refreshTargetPresets();

    expect(harness.listTargetPresetsRequest).toHaveBeenCalledTimes(1);
    expect(harness.getVoiceUiState().customTargetPresets).toHaveLength(1);
    expect(harness.getVoiceUiState().customTargetPresets[0]?.name).toBe('Saved Voice');
  });

  it('applies learner-context-only backend payloads from target preset library responses', async () => {
    const harness = createHarness();
    harness.listTargetPresetsRequest.mockResolvedValueOnce({
      learnerContext: {
        available: true,
        source: 'local-learner-context',
        targetPreset: 'australian-bright-feminine',
      },
      presets: [],
    });

    await harness.controller.refreshTargetPresets();

    expect(harness.applyVoiceBackendPayload).toHaveBeenCalledWith(expect.objectContaining({
      learnerContext: expect.objectContaining({
        source: 'local-learner-context',
      }),
    }));
  });

  it('defaults reference saves to creating a new preset until reference rename mode is entered', async () => {
    mountCustomPresetStatusDom();
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        referenceClipId: 'clip-9',
        referenceClipName: 'fresh-reference.wav',
        customTargetPresets: [
          {
            id: 'preset-1',
            name: 'Saved Voice',
            kind: 'reference',
            basePreset: 'cute-feminine',
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            archivedAt: null,
            targetVoiceProfile: null,
            referenceClipId: 'clip-1',
            referenceClipName: 'reference.wav',
            referenceAnalysis: null,
          },
        ],
        customTargetPresetDraft: {
          presetId: 'preset-1',
          name: 'Saved Voice',
          basePreset: 'cute-feminine',
          pitchFloorHz: '',
          pitchCeilingHz: '',
          resonanceFloor: '',
          resonanceCeiling: '',
          weightFloor: '',
          weightCeiling: '',
          stylePrompt: '',
          notesText: '',
        },
      }),
    });

    await harness.controller.saveReferencePreset();

    expect(harness.saveReferencePresetRequest).toHaveBeenCalledWith('session-1', expect.objectContaining({
      presetId: null,
      name: 'fresh-reference.wav',
      referenceClipId: 'clip-9',
    }));
    expect(harness.getVoiceUiState().customTargetPresetDraft.presetId).toBe(null);
    expect(document.getElementById('voice-save-reference-preset')?.textContent).toBe('Save Current Reference As New');
  });

  it('enters explicit reference rename mode before updating a saved reference preset', async () => {
    mountCustomPresetStatusDom();
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        customTargetPresets: [
          {
            id: 'preset-1',
            name: 'Saved Voice',
            kind: 'reference',
            basePreset: 'cute-feminine',
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            archivedAt: null,
            targetVoiceProfile: null,
            referenceClipId: 'clip-1',
            referenceClipName: 'reference.wav',
            referenceAnalysis: null,
          },
        ],
      }),
    });

    harness.controller.editCustomPresetDraft('preset-1');

    expect(document.getElementById('voice-save-reference-preset')?.textContent).toBe('Update Reference Preset');
    expect(document.getElementById('voice-custom-preset-workspace-status')?.textContent).toContain('renaming saved reference');

    await harness.controller.saveReferencePreset();

    expect(harness.saveReferencePresetRequest).toHaveBeenCalledWith('session-1', expect.objectContaining({
      presetId: 'preset-1',
      name: 'Saved Voice',
      expectedUpdatedAt: 2,
    }));
  });

  it('saves a handmade custom preset and applies it back into voice UI state', async () => {
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        customTargetPresetDraft: {
          presetId: null,
          name: 'Handmade Voice',
          basePreset: 'bright-playful',
          pitchFloorHz: '170',
          pitchCeilingHz: '240',
          resonanceFloor: '0.55',
          resonanceCeiling: '0.82',
          weightFloor: '0.18',
          weightCeiling: '0.42',
          stylePrompt: 'sweet',
          notesText: 'easy',
        },
      }),
    });

    await harness.controller.saveHandmadePreset();

    expect(harness.saveHandmadePresetRequest).toHaveBeenCalledWith('session-1', expect.objectContaining({
      name: 'Handmade Voice',
      basePreset: 'bright-playful',
      pitchFloorHz: '170',
    }));
    expect(harness.getVoiceUiState()).toMatchObject({
      targetPreset: 'bright-playful',
      targetSource: 'custom-handmade',
      selectedCustomPresetId: 'preset-2',
      selectedCustomPresetName: 'Handmade Voice',
    });
    expect(harness.getVoiceUiState().customTargetPresets).toHaveLength(1);
    expect(harness.addTerminalLine).toHaveBeenCalledWith('system', 'Saved handmade preset: Handmade Voice');
  });

  it('can save a reference preset without an active session and applies it locally', async () => {
    mountCustomPresetStatusDom();
    const harness = createHarness({
      currentSessionId: null,
      isConnected: false,
      voiceUiState: createDefaultVoiceUiState({
        serviceStatus: 'online',
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
      }),
    });

    await harness.controller.saveReferencePreset();

    expect(harness.saveReferencePresetRequest).toHaveBeenCalledWith(null, expect.objectContaining({
      referenceClipId: 'clip-1',
      referenceClipName: 'reference.wav',
    }));
    expect(harness.getVoiceUiState()).toMatchObject({
      selectedCustomPresetId: 'preset-new',
      selectedCustomPresetName: 'reference.wav',
      targetSource: 'custom-reference',
    });
  });

  it('loads a saved preset locally when no session is active', async () => {
    const harness = createHarness({
      currentSessionId: null,
      isConnected: false,
    });

    await harness.controller.selectCustomPreset('preset-1');

    expect(harness.selectTargetPresetRequest).toHaveBeenCalledWith(null, 'preset-1');
    expect(harness.getVoiceUiState()).toMatchObject({
      selectedCustomPresetId: 'preset-1',
      selectedCustomPresetName: 'Saved Voice',
      targetSource: 'custom-reference',
    });
  });

  it('applies the canonical custom target profile when selection is connected', async () => {
    const harness = createHarness();
    // The base preset is incidental — this test proves the CANONICAL profile from
    // the preset record wins over the server's partial voiceState echo. (2026-07-30:
    // was 'gender-neutral'; re-pointed to a live preset.)
    const canonicalPreset = {
      id: 'preset-connected',
      name: 'Connected Handmade Voice',
      kind: 'handmade' as const,
      basePreset: 'soft-feminine',
      createdAt: 10,
      updatedAt: 20,
      archived: false,
      archivedAt: null,
      targetVoiceProfile: {
        profileId: 'profile-connected',
        sourceFilename: 'Connected Handmade Voice',
        durationMs: 0,
        targetPreset: 'soft-feminine',
        metrics: {
          meanPitchHz: 154,
          pitchRangeSt: 0,
          resonanceMean: 0.48,
          weightMean: 0.52,
          targetHitPct: 0,
          similarityScore: 0,
        },
        pitchFloorHz: 142,
        pitchCeilingHz: 168,
        resonanceFloor: 0.4,
        resonanceCeiling: 0.56,
        weightFloor: 0.44,
        weightCeiling: 0.6,
        stylePrompt: 'calm and centered',
        notes: ['exact connected profile'],
        advancedBands: {
          pitchP10HzFloor: 144,
          pitchP90HzCeiling: 166,
          voicedFramePctFloor: 0.6,
          formantLite: {
            f2FloorHz: 1500,
            frontnessFloor: 0.4,
          },
        },
        analysisVersion: 'voice-metrics-v2',
      },
      referenceClipId: null,
      referenceClipName: null,
      referenceAnalysis: null,
    };
    harness.selectTargetPresetRequest.mockResolvedValueOnce({
      voiceState: {
        targetPreset: 'wrong-partial-server-value',
        targetSource: 'custom-reference',
        selectedCustomPresetId: canonicalPreset.id,
        selectedCustomPresetName: canonicalPreset.name,
        targetVoiceProfile: {
          pitchFloorHz: 999,
        },
      } as any,
      presets: [canonicalPreset],
      preset: canonicalPreset,
    });

    await harness.controller.selectCustomPreset(canonicalPreset.id);

    expect(harness.assertPracticeTargetUnlocked).toHaveBeenCalledWith('changing the voice preset');
    expect(harness.selectTargetPresetRequest).toHaveBeenCalledWith('session-1', canonicalPreset.id);
    expect(harness.getVoiceUiState()).toMatchObject({
      targetPreset: 'soft-feminine',
      targetSource: 'custom-handmade',
      selectedCustomPresetId: canonicalPreset.id,
      selectedCustomPresetName: canonicalPreset.name,
      referenceClipId: null,
      referenceClipName: null,
      targetVoiceProfile: {
        profileId: 'profile-connected',
        sourceFilename: 'Connected Handmade Voice',
        durationMs: 0,
        targetPreset: 'soft-feminine',
        metrics: {
          meanPitchHz: 154,
          pitchRangeSt: 0,
          resonanceMean: 0.48,
          weightMean: 0.52,
          targetHitPct: 0,
          similarityScore: 0,
        },
        pitchFloorHz: 142,
        pitchCeilingHz: 168,
        resonanceFloor: 0.4,
        resonanceCeiling: 0.56,
        weightFloor: 0.44,
        weightCeiling: 0.6,
        stylePrompt: 'calm and centered',
        notes: ['exact connected profile'],
        advancedBands: {
          pitchP10HzFloor: 144,
          pitchP90HzCeiling: 166,
          voicedFramePctFloor: 0.6,
          formantLite: {
            f2FloorHz: 1500,
            frontnessFloor: 0.4,
          },
        },
        analysisVersion: 'voice-metrics-v2',
      },
    });
  });

  it('checks the practice-target lock before requesting a custom preset selection', async () => {
    const harness = createHarness();
    harness.assertPracticeTargetUnlocked.mockImplementationOnce(() => {
      throw new Error('practice target locked');
    });

    await harness.controller.selectCustomPreset('preset-1');

    expect(harness.selectTargetPresetRequest).not.toHaveBeenCalled();
    expect(harness.getVoiceUiState().lastError).toBe('practice target locked');
  });

  it('archives the active preset locally when no session is active', async () => {
    const harness = createHarness({
      currentSessionId: null,
      isConnected: false,
      voiceUiState: createDefaultVoiceUiState({
        serviceStatus: 'online',
        referenceClipId: 'clip-1',
        referenceClipName: 'reference.wav',
        selectedCustomPresetId: 'preset-1',
        selectedCustomPresetName: 'Saved Voice',
        targetSource: 'custom-reference',
        customTargetPresets: [
          {
            id: 'preset-1',
            name: 'Saved Voice',
            kind: 'reference',
            basePreset: 'cute-feminine',
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            archivedAt: null,
            targetVoiceProfile: null,
            referenceClipId: 'clip-1',
            referenceClipName: 'reference.wav',
            referenceAnalysis: null,
          },
        ],
      }),
    });

    await harness.controller.archiveCustomPreset('preset-1');

    expect(harness.archiveTargetPresetRequest).toHaveBeenCalledWith(null, 'preset-1', 2);
    expect(harness.getVoiceUiState()).toMatchObject({
      selectedCustomPresetId: null,
      targetSource: 'reference',
    });
  });

  it('keeps the handmade workspace draft intact when loading a saved target', async () => {
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        customTargetPresets: [
          {
            id: 'preset-1',
            name: 'Saved Voice',
            kind: 'reference',
            basePreset: 'cute-feminine',
            createdAt: 1,
            updatedAt: 2,
            archived: false,
            archivedAt: null,
            targetVoiceProfile: null,
            referenceClipId: 'clip-1',
            referenceClipName: 'reference.wav',
            referenceAnalysis: null,
          },
        ],
        customTargetPresetDraft: {
          presetId: null,
          name: 'Workspace Draft',
          basePreset: 'bright-playful',
          pitchFloorHz: '170',
          pitchCeilingHz: '240',
          resonanceFloor: '0.55',
          resonanceCeiling: '0.82',
          weightFloor: '0.18',
          weightCeiling: '0.42',
          stylePrompt: 'sweet',
          notesText: 'keep it light',
        },
      }),
    });

    await harness.controller.selectCustomPreset('preset-1');

    expect(harness.getVoiceUiState().customTargetPresetDraft).toMatchObject({
      presetId: null,
      name: 'Workspace Draft',
      basePreset: 'bright-playful',
      pitchFloorHz: '170',
    });
  });

  it('exits reference rename mode after loading a fresh reference clip', async () => {
    mountCustomPresetStatusDom();
    const harness = createHarness({
      voiceUiState: createDefaultVoiceUiState({
        customTargetPresets: [
          {
            id: 'preset-1',
            name: 'Saved Voice',
            kind: 'reference',
            basePreset: 'cute-feminine',
            createdAt: 1,
            updatedAt: 2,
            targetVoiceProfile: null,
            referenceClipId: 'clip-1',
            referenceClipName: 'reference.wav',
            referenceAnalysis: null,
          },
        ],
      }),
    });
    const file = new File(['test'], 'new-reference.wav', { type: 'audio/wav' });

    harness.controller.editCustomPresetDraft('preset-1');
    await harness.controller.analyzeReference(file);

    expect(harness.getVoiceUiState().customTargetPresetDraft.presetId).toBe(null);
    expect(document.getElementById('voice-save-reference-preset')?.textContent).toBe('Save Current Reference As New');
  });

  it('bootstraps voice mode by refreshing status, syncing session state, and resuming the existing session', async () => {
    const harness = createHarness();
    harness.syncSessionStateFromBackend.mockImplementationOnce(async () => {
      harness.applyVoiceBackendPayload({
        voiceState: {
          voiceSessionId: 'voice-session-1',
        },
      });
      return harness.getVoiceUiState();
    });

    await harness.controller.bootstrapVoiceModeSession(true);

    expect(harness.getKnowledgeStatus).toHaveBeenCalledTimes(1);
    expect(harness.setKnowledgeStatusText).toHaveBeenCalledWith('Ready');
    expect(harness.listTargetPresetsRequest).toHaveBeenCalledTimes(1);
    expect(harness.getHealthSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.applyHealthStatusPayload).toHaveBeenCalledWith({ status: 'online' });
    expect(harness.syncSessionStateFromBackend).toHaveBeenCalledWith(true);
    expect(harness.startVoiceAudioStream).toHaveBeenCalledTimes(1);
    expect(harness.startVoicePracticeSession).not.toHaveBeenCalled();
  });

  it('does not repeat session hydration when the caller already synchronized it', async () => {
    const harness = createHarness();

    await harness.controller.bootstrapVoiceModeSession(false, true);

    expect(harness.syncSessionStateFromBackend).not.toHaveBeenCalled();
    expect(harness.listTargetPresetsRequest).toHaveBeenCalledTimes(1);
    expect(harness.getHealthSnapshot).toHaveBeenCalledTimes(2);
    expect(harness.startVoiceAudioStream).not.toHaveBeenCalled();
    expect(harness.startVoicePracticeSession).not.toHaveBeenCalled();
  });
});
