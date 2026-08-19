import type {
  VoiceCockpitLineAction,
  VoiceTargetPresetLibraryResponse,
  VoiceDrillSelectionResponse,
  VoiceHealthSnapshot,
  VoiceReferenceAnalyzeResponse,
} from './api';
import { getVoiceKnowledgeStatusLabel, type VoiceKnowledgeStatusPayload } from './knowledge-status';
import { planVoiceModeBootstrap } from './session-reentry';
import {
  buildVoiceCustomTargetPresetDraftFromPreset,
  buildVoiceCustomTargetPresetDraftFromVoiceState,
  createDefaultVoiceDrillState,
  getVoiceBackendPayloadSlices,
  hasVoiceBackendPayload,
  normalizeVoiceDrillState,
  normalizeVoiceUiState,
  type VoiceBackendPayload,
  type VoiceDrillState,
  type VoiceReferenceAnalysis,
  type VoiceUiState,
} from './state';

type VoiceWorkflowControllerOptions = {
  getSessionContext: () => {
    currentSessionId: string | null;
    isConnected: boolean;
    currentMode: string;
  };
  getVoiceUiState: () => VoiceUiState;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  getVoiceTransportStatus: () => string | null;
  getRequestedTargetPreset: () => string;
  assertPracticeTargetUnlocked: (actionLabel: string) => void;
  applyVoiceBackendPayload: (payload: VoiceBackendPayload) => void;
  syncSessionStateFromBackend: (silenceCoach?: boolean) => Promise<VoiceUiState | null>;
  getHealthSnapshot: () => Promise<VoiceHealthSnapshot>;
  getKnowledgeStatus: () => Promise<VoiceKnowledgeStatusPayload>;
  applyHealthStatusPayload: (payload: unknown) => void;
  applySpeechStatusPayload: (payload: unknown) => void;
  applyInputProviderStatusPayload: (payload: unknown) => void;
  markVoiceServiceOffline: (message: string) => void;
  setKnowledgeStatusText: (text: string) => void;
  getDrillsRequest: (sessionId: string | null, targetPreset: string) => Promise<Partial<VoiceDrillState>>;
  syncPresetRequest: (sessionId: string, targetPreset: string) => Promise<VoiceBackendPayload>;
  listTargetPresetsRequest: (options?: { includeArchived?: boolean }) => Promise<VoiceTargetPresetLibraryResponse>;
  saveReferencePresetRequest: (
    sessionId: string | null,
    payload?: {
      presetId?: string | null;
      name?: string;
      basePreset?: string;
      referenceClipId?: string | null;
      referenceClipName?: string;
      referenceAnalysis?: VoiceReferenceAnalysis | null;
      targetVoiceProfile?: VoiceUiState['targetVoiceProfile'] | null;
      expectedUpdatedAt?: number | null;
    },
  ) => Promise<VoiceTargetPresetLibraryResponse>;
  saveHandmadePresetRequest: (
    sessionId: string | null,
    payload: {
      presetId?: string | null;
      name: string;
      basePreset: string;
      expectedUpdatedAt?: number | null;
      pitchFloorHz: string;
      pitchCeilingHz: string;
      resonanceFloor: string;
      resonanceCeiling: string;
      weightFloor: string;
      weightCeiling: string;
      stylePrompt: string;
      notesText: string;
    },
  ) => Promise<VoiceTargetPresetLibraryResponse>;
  selectTargetPresetRequest: (sessionId: string | null, presetId: string) => Promise<VoiceTargetPresetLibraryResponse>;
  duplicateTargetPresetRequest: (
    sessionId: string | null,
    presetId: string,
    payload?: { name?: string; expectedUpdatedAt?: number | null },
  ) => Promise<VoiceTargetPresetLibraryResponse>;
  archiveTargetPresetRequest: (
    sessionId: string | null,
    presetId: string,
    expectedUpdatedAt?: number | null,
  ) => Promise<VoiceTargetPresetLibraryResponse>;
  restoreTargetPresetRequest: (
    sessionId: string | null,
    presetId: string,
    expectedUpdatedAt?: number | null,
  ) => Promise<VoiceTargetPresetLibraryResponse>;
  deleteTargetPresetRequest: (
    sessionId: string | null,
    presetId: string,
    expectedUpdatedAt?: number | null,
  ) => Promise<VoiceTargetPresetLibraryResponse>;
  selectDrillRequest: (sessionId: string, drillId: string) => Promise<VoiceDrillSelectionResponse>;
  analyzeReferenceRequest: (file: File, targetPreset: string) => Promise<VoiceReferenceAnalyzeResponse>;
  syncReferenceRequest: (
    sessionId: string,
    referenceClipId: string | null,
    referenceClipName: string,
  ) => Promise<VoiceBackendPayload>;
  projectPhraseForecastRequest: (sessionId: string, phrase: string) => Promise<VoiceBackendPayload>;
  adoptResolvedReferenceAnalysis: (
    data: VoiceReferenceAnalyzeResponse,
    fallbackFilename?: string | null,
  ) => VoiceReferenceAnalysis;
  refreshCockpitLine: (action: VoiceCockpitLineAction) => Promise<unknown>;
  setDrillState: (state: VoiceDrillState) => void;
  setDrillStatus: (status: 'idle' | 'loading' | 'error') => void;
  setDrillError: (error: string | null) => void;
  setDrillSelectionPendingId: (drillId: string | null) => void;
  setForecastStatus: (status: 'idle' | 'loading' | 'error') => void;
  setForecastError: (error: string | null) => void;
  resetVoiceTraces: () => void;
  clearLastTakeTrace: () => void;
  render: () => void;
  addTerminalLine: (type: 'user' | 'assistant' | 'system', content: string) => void;
  startVoiceAudioStream: () => Promise<void>;
  startVoicePracticeSession: (silent?: boolean, successNotice?: string) => Promise<boolean>;
  setIntervalImpl?: typeof window.setInterval;
  clearIntervalImpl?: typeof window.clearInterval;
  pollIntervalMs?: number;
};

export type VoiceWorkflowController = ReturnType<typeof createVoiceWorkflowController>;

export function createVoiceWorkflowController(options: VoiceWorkflowControllerOptions) {
  type VoiceCustomPresetLibraryStatus = 'idle' | 'loading' | 'ready' | 'error';
  type VoiceCustomPresetWorkspaceMode = 'handmade' | 'reference';
  type VoiceCustomPresetAction = 'use' | 'edit' | 'duplicate' | 'archive' | 'restore' | 'delete';

  const customPresetLibraryStatusId = 'voice-custom-preset-library-status';
  const customPresetWorkspaceStatusId = 'voice-custom-preset-workspace-status';
  const customPresetListId = 'voice-custom-preset-list';
  const saveReferencePresetButtonId = 'voice-save-reference-preset';
  const seedCustomPresetButtonId = 'voice-seed-custom-preset';

  let voiceHealthPollTimer: number | null = null;
  let customPresetLibraryStatus: VoiceCustomPresetLibraryStatus = 'idle';
  let customPresetLibraryError: string | null = null;
  let customPresetWorkspaceMode: VoiceCustomPresetWorkspaceMode = 'handmade';
  let activeCustomPresetAction: { presetId: string | null; action: VoiceCustomPresetAction | null } = {
    presetId: null,
    action: null,
  };
  const setIntervalImpl = options.setIntervalImpl || window.setInterval.bind(window);
  const clearIntervalImpl = options.clearIntervalImpl || window.clearInterval.bind(window);
  const pollIntervalMs = options.pollIntervalMs ?? 10_000;

  function patchVoiceUiState(patch: Partial<VoiceUiState>): VoiceUiState {
    let nextState: VoiceUiState | null = null;
    options.updateVoiceUiState((state) => {
      nextState = normalizeVoiceUiState({
        ...state,
        ...patch,
      });
      return nextState;
    });
    return nextState || options.getVoiceUiState();
  }

  function setLastError(message: string | null): VoiceUiState {
    return patchVoiceUiState({
      lastError: message,
    });
  }

  function getCustomPresetById(presetId: string | null | undefined) {
    if (!presetId) {
      return null;
    }
    return options.getVoiceUiState().customTargetPresets.find((entry) => entry.id === presetId) || null;
  }

  function setCustomPresetLibraryState(status: VoiceCustomPresetLibraryStatus, error: string | null = null): void {
    customPresetLibraryStatus = status;
    customPresetLibraryError = error;
    syncCustomPresetWorkspaceUi();
  }

  function setActiveCustomPresetAction(action: VoiceCustomPresetAction | null, presetId: string | null = null): void {
    activeCustomPresetAction = {
      action,
      presetId,
    };
    syncCustomPresetWorkspaceUi();
  }

  function hasCustomPresetDraftContent(): boolean {
    const draft = options.getVoiceUiState().customTargetPresetDraft;
    return Boolean(
      draft.presetId
      || draft.name.trim()
      || draft.pitchFloorHz.trim()
      || draft.pitchCeilingHz.trim()
      || draft.resonanceFloor.trim()
      || draft.resonanceCeiling.trim()
      || draft.weightFloor.trim()
      || draft.weightCeiling.trim()
      || draft.stylePrompt.trim()
      || draft.notesText.trim(),
    );
  }

  function buildSeededHandmadeDraft() {
    const voiceUiState = options.getVoiceUiState();
    const seededDraft = buildVoiceCustomTargetPresetDraftFromVoiceState(voiceUiState);
    return {
      ...seededDraft,
      presetId: null,
      name: voiceUiState.targetSource === 'custom-handmade'
        ? seededDraft.name
        : '',
    };
  }

  function sanitizeCustomPresetDraftForCurrentMode(): void {
    const currentDraft = options.getVoiceUiState().customTargetPresetDraft;
    if (!currentDraft.presetId) {
      return;
    }

    const draftPreset = getCustomPresetById(currentDraft.presetId);
    if (!draftPreset) {
      patchVoiceUiState({
        customTargetPresetDraft: {
          ...currentDraft,
          presetId: null,
        },
      });
      return;
    }

    if (draftPreset.kind === 'reference' && customPresetWorkspaceMode !== 'reference') {
      patchVoiceUiState({
        customTargetPresetDraft: {
          ...currentDraft,
          presetId: null,
        },
      });
    }
  }

  function exitReferencePresetEditMode(): void {
    const currentDraft = options.getVoiceUiState().customTargetPresetDraft;
    const draftPreset = getCustomPresetById(currentDraft.presetId);
    if (draftPreset?.kind === 'reference') {
      patchVoiceUiState({
        customTargetPresetDraft: {
          ...currentDraft,
          presetId: null,
          name: '',
        },
      });
    }
    customPresetWorkspaceMode = 'handmade';
  }

  function applyCustomPresetLocally(preset: VoiceUiState['customTargetPresets'][number] | null | undefined): void {
    if (!preset || preset.archived) {
      return;
    }
    patchVoiceUiState({
      targetPreset: preset.basePreset || options.getVoiceUiState().targetPreset || 'cute-feminine',
      lessonId: null,
      referenceClipId: preset.referenceClipId || null,
      referenceClipName: preset.referenceClipName || null,
      referenceAnalysis: preset.referenceAnalysis || null,
      selectedCustomPresetId: preset.id,
      selectedCustomPresetName: preset.name,
      targetSource: preset.kind === 'handmade' ? 'custom-handmade' : 'custom-reference',
      targetVoiceProfile: preset.targetVoiceProfile || null,
      phraseForecast: null,
      forecastPhrase: null,
      phraseComparison: null,
      lastTakeTimeline: null,
      lastError: null,
    });
  }

  function detachRemovedCustomPresetLocally(preset: VoiceUiState['customTargetPresets'][number] | null | undefined): void {
    if (!preset) {
      return;
    }
    const voiceUiState = options.getVoiceUiState();
    if (voiceUiState.selectedCustomPresetId !== preset.id) {
      return;
    }
    patchVoiceUiState({
      selectedCustomPresetId: null,
      selectedCustomPresetName: null,
      targetSource: preset.kind === 'reference' && voiceUiState.referenceClipId ? 'reference' : 'built-in',
      targetVoiceProfile: preset.kind === 'handmade' ? null : voiceUiState.targetVoiceProfile,
      phraseForecast: preset.kind === 'handmade' ? null : voiceUiState.phraseForecast,
      forecastPhrase: preset.kind === 'handmade' ? null : voiceUiState.forecastPhrase,
      phraseComparison: preset.kind === 'handmade' ? null : voiceUiState.phraseComparison,
      lastTakeTimeline: preset.kind === 'handmade' ? null : voiceUiState.lastTakeTimeline,
      lastError: null,
    });
  }

  function syncCustomPresetWorkspaceUi(): void {
    if (typeof document === 'undefined') {
      return;
    }

    const voiceUiState = options.getVoiceUiState();
    const draft = voiceUiState.customTargetPresetDraft;
    const draftPreset = getCustomPresetById(draft.presetId);
    const { currentSessionId, isConnected } = options.getSessionContext();

    const libraryStatusEl = document.getElementById(customPresetLibraryStatusId);
    const workspaceStatusEl = document.getElementById(customPresetWorkspaceStatusId);
    const listEl = document.getElementById(customPresetListId);
    const saveReferenceButton = document.getElementById(saveReferencePresetButtonId) as HTMLButtonElement | null;
    const seedWorkspaceButton = document.getElementById(seedCustomPresetButtonId) as HTMLButtonElement | null;

    const editingReferencePreset = customPresetWorkspaceMode === 'reference' && draftPreset?.kind === 'reference';
    const editingHandmadePreset = draftPreset?.kind === 'handmade';

    if (saveReferenceButton) {
      saveReferenceButton.textContent = editingReferencePreset
        ? 'Update Reference Preset'
        : 'Save Current Reference As New';
      saveReferenceButton.title = editingReferencePreset
        ? 'Updates this saved reference preset with the active clip.'
        : 'Creates a new saved reference preset from the active clip.';
    }

    if (seedWorkspaceButton) {
      seedWorkspaceButton.textContent = hasCustomPresetDraftContent() || editingReferencePreset || editingHandmadePreset
        ? 'Reset / Seed Workspace'
        : 'Seed Workspace';
      seedWorkspaceButton.title = 'Exits preset edit mode and copies the active target into the handmade workspace.';
    }

    if (listEl) {
      listEl.setAttribute('aria-busy', customPresetLibraryStatus === 'loading' ? 'true' : 'false');
      const actionButtons = Array.from(listEl.querySelectorAll<HTMLButtonElement>('[data-voice-custom-preset-action]'));
      for (const button of actionButtons) {
        const presetId = button.dataset.voiceCustomPresetId || '';
        const action = button.dataset.voiceCustomPresetAction as VoiceCustomPresetAction | undefined;
        const isPending = presetId === activeCustomPresetAction.presetId && action === activeCustomPresetAction.action;
        button.disabled = isPending || customPresetLibraryStatus === 'loading';
        if (isPending) {
          button.dataset.pending = 'true';
        } else {
          delete button.dataset.pending;
        }
      }
    }

    if (libraryStatusEl) {
      let libraryMessage = '';
      if (customPresetLibraryStatus === 'loading') {
        libraryMessage = 'Loading saved target library…';
      } else if (customPresetLibraryStatus === 'error') {
        libraryMessage = `Saved target library error: ${customPresetLibraryError || 'Unknown error'}. Existing workspace edits stay local until the next successful refresh.`;
      } else if (!voiceUiState.customTargetPresets.length) {
        libraryMessage = 'Library ready. Save Current Reference As New or Save Handmade Preset to create your first reusable target.';
      } else {
        const activeCount = voiceUiState.customTargetPresets.filter((preset) => !preset.archived).length;
        const archivedCount = voiceUiState.customTargetPresets.filter((preset) => preset.archived).length;
        libraryMessage = `Library ready • ${activeCount} active preset${activeCount === 1 ? '' : 's'}${archivedCount ? ` • ${archivedCount} archived` : ''}. Use Rename on a saved reference before updating it; otherwise reference saves create a new preset.`;
        if (!currentSessionId || !isConnected) {
          libraryMessage += ' You can manage saved targets without an active practice session.';
        }
      }
      libraryStatusEl.textContent = libraryMessage;
      libraryStatusEl.dataset.state = customPresetLibraryStatus;
    }

    if (workspaceStatusEl) {
      let workspaceMessage = '';
      if (editingReferencePreset && draftPreset) {
        workspaceMessage = `Workspace mode: renaming saved reference “${draftPreset.name}”. Only the name is editable here. Save Current Reference updates this library entry, and Reset / Seed Workspace exits reference edit mode.`;
      } else if (editingHandmadePreset && draftPreset) {
        workspaceMessage = `Workspace mode: editing handmade preset “${draftPreset.name}”. Save Handmade Preset updates it. Save Current Reference still creates a new preset unless you first choose Rename on a saved reference.`;
      } else if (voiceUiState.targetVoiceProfile || voiceUiState.referenceClipId) {
        workspaceMessage = 'Workspace mode: new handmade draft. Reset / Seed Workspace copies the active target into the editor. Save Current Reference creates a new preset unless you explicitly enter reference rename mode.';
      } else {
        workspaceMessage = 'Workspace mode: blank handmade draft. Load a reference or choose Reset / Seed Workspace to start from the active target.';
      }
      workspaceStatusEl.textContent = workspaceMessage;
      workspaceStatusEl.dataset.mode = editingReferencePreset
        ? 'reference-edit'
        : editingHandmadePreset
          ? 'handmade-edit'
          : 'handmade-new';
    }
  }

  function applyTargetPresetLibraryResponse(data: VoiceTargetPresetLibraryResponse | null | undefined): void {
    if (!data) {
      return;
    }
    if (hasVoiceBackendPayload(data)) {
      options.applyVoiceBackendPayload(data);
    }
    if (!Array.isArray(data.presets)) {
      return;
    }
    patchVoiceUiState({
      customTargetPresets: data.presets,
    });
    sanitizeCustomPresetDraftForCurrentMode();
    setCustomPresetLibraryState('ready');
  }

  async function refreshHealth(): Promise<boolean> {
    try {
      const { health, speechStatus, inputStatus } = await options.getHealthSnapshot();
      options.applyHealthStatusPayload(health);
      if (speechStatus) {
        options.applySpeechStatusPayload(speechStatus);
      }
      if (inputStatus) {
        options.applyInputProviderStatusPayload(inputStatus);
      }
      patchVoiceUiState({
        serviceStatus: health.status === 'online' ? 'online' : 'offline',
        lastError: null,
      });
      options.render();
      return health.status === 'online';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.markVoiceServiceOffline(message);
      patchVoiceUiState({
        serviceStatus: 'offline',
        lastError: message,
      });
      options.render();
      return false;
    }
  }

  async function refreshKnowledgeStatus(): Promise<void> {
    try {
      const data = await options.getKnowledgeStatus();
      options.setKnowledgeStatusText(getVoiceKnowledgeStatusLabel(data));
    } catch (error) {
      options.setKnowledgeStatusText('Unavailable');
      console.warn('[Sloane] Voice knowledge status refresh failed:', error);
    }
    options.render();
  }

  function refreshHealthSoon(): void {
    void refreshHealth();
  }

  function refreshKnowledgeStatusSoon(): void {
    void refreshKnowledgeStatus();
  }

  function ensureHealthPoller(): void {
    if (voiceHealthPollTimer !== null) {
      return;
    }

    voiceHealthPollTimer = setIntervalImpl(() => {
      if (options.getSessionContext().currentMode !== 'voice') {
        return;
      }
      refreshHealthSoon();
      refreshKnowledgeStatusSoon();
    }, pollIntervalMs) as unknown as number;
  }

  async function refreshDrills(silent = false): Promise<VoiceDrillState | null> {
    const { isConnected, currentSessionId } = options.getSessionContext();
    if (!isConnected) {
      return null;
    }

    options.setDrillStatus('loading');
    options.setDrillError(null);
    if (!silent) {
      options.render();
    }

    try {
      const data = await options.getDrillsRequest(currentSessionId, options.getVoiceUiState().targetPreset || 'cute-feminine');
      const nextDrillState = normalizeVoiceDrillState(data);
      options.setDrillState(nextDrillState);
      patchVoiceUiState({
        lessonId: nextDrillState.selectedLessonId || null,
      });
      options.setDrillStatus('idle');
      options.setDrillError(null);
      options.render();
      return nextDrillState;
    } catch (error) {
      options.setDrillStatus('error');
      options.setDrillError(error instanceof Error ? error.message : String(error));
      options.render();
      return null;
    }
  }

  async function refreshTargetPresets(): Promise<void> {
    setCustomPresetLibraryState('loading');
    try {
      const data = await options.listTargetPresetsRequest({ includeArchived: true });
      applyTargetPresetLibraryResponse(data);
      options.render();
      syncCustomPresetWorkspaceUi();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      console.warn('[Sloane] Failed to refresh custom voice presets:', error);
    }
  }

  async function syncPreset(targetPreset: string): Promise<void> {
    try {
      options.assertPracticeTargetUnlocked('changing the voice preset');
      const { currentSessionId, isConnected } = options.getSessionContext();

      if (!currentSessionId || !isConnected) {
        patchVoiceUiState({
          targetPreset,
          targetSource: 'built-in',
          selectedCustomPresetId: null,
          selectedCustomPresetName: null,
          lessonId: null,
          targetVoiceProfile: null,
          phraseForecast: null,
          forecastPhrase: null,
        });
        options.setDrillState(createDefaultVoiceDrillState({ targetPreset }));
        options.setForecastStatus('idle');
        options.setForecastError(null);
        options.resetVoiceTraces();
        options.render();
        return;
      }

      const data = await options.syncPresetRequest(currentSessionId, targetPreset);
      options.applyVoiceBackendPayload(data);
      options.setDrillState(createDefaultVoiceDrillState({ targetPreset }));
      options.setForecastStatus('idle');
      options.setForecastError(null);
      options.resetVoiceTraces();
      await refreshDrills(true);
      await options.refreshCockpitLine('regenerate').catch(() => null);
      options.render();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      options.render();
      options.addTerminalLine('system', `Preset update failed: ${message}`);
    }
  }

  async function selectDrill(drillId: string): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected || !drillId) {
      return;
    }

    options.assertPracticeTargetUnlocked('switching drills');
    options.setDrillSelectionPendingId(drillId);
    options.setDrillError(null);
    options.render();

    try {
      const data = await options.selectDrillRequest(currentSessionId, drillId);
      const { voiceState } = getVoiceBackendPayloadSlices(data);
      options.applyVoiceBackendPayload(data);
      setLastError(voiceState?.lastError || null);
      options.setDrillState(normalizeVoiceDrillState(data));
      options.setForecastStatus('idle');
      options.setForecastError(null);
      options.clearLastTakeTrace();
      await options.refreshCockpitLine('regenerate').catch(() => null);
      options.render();
      options.addTerminalLine('system', `Guided drill loaded: ${data.drill?.title || drillId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.setDrillError(message);
      setLastError(message);
      options.render();
      throw error;
    } finally {
      options.setDrillSelectionPendingId(null);
      options.render();
    }
  }

  async function analyzeReference(file: File): Promise<VoiceReferenceAnalyzeResponse | null> {
    try {
      options.assertPracticeTargetUnlocked('loading a new reference');
      const data = await options.analyzeReferenceRequest(file, options.getRequestedTargetPreset());
      exitReferencePresetEditMode();

      const { currentSessionId, isConnected } = options.getSessionContext();
      let backendPayload: VoiceBackendPayload | null = null;
      if (currentSessionId && isConnected) {
        backendPayload = await options.syncReferenceRequest(
          currentSessionId,
          data.clipId || null,
          data.filename || file.name,
        );
        options.applyVoiceBackendPayload(backendPayload);
      }

      const { voiceState: backendVoiceState } = getVoiceBackendPayloadSlices(backendPayload);
      patchVoiceUiState({
        ...(backendVoiceState || {}),
        referenceClipId: data.clipId || null,
        referenceClipName: data.filename || file.name,
        referenceAnalysis: options.adoptResolvedReferenceAnalysis(data, data.filename || file.name),
        // P0.3: the uploaded reference OWNS the target (voice-copy front door). The derived
        // target profile arrives via the backendVoiceState spread above; presets stay the
        // no-sample fallback (removeReference / syncPreset revert targetSource to 'built-in').
        targetSource: 'reference',
        lastError: backendVoiceState?.lastError || null,
      });
      options.setForecastStatus('idle');
      options.setForecastError(null);
      options.clearLastTakeTrace();
      await refreshDrills(true);
      await options.refreshCockpitLine('regenerate').catch(() => null);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Reference ready: ${options.getVoiceUiState().referenceClipName}`);
      // Return the raw analyze response so the front-door report card can render
      // the clip-trust verdict (quality.verdict / cloneable / summary) from it.
      return data;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      options.render();
      options.addTerminalLine('system', `Reference analysis failed: ${message}`);
      return null;
    }
  }

  async function removeReference(): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      exitReferencePresetEditMode();
      patchVoiceUiState({
        referenceClipId: null,
        referenceClipName: null,
        referenceAnalysis: null,
        targetVoiceProfile: null,
        phraseForecast: null,
        forecastPhrase: null,
        targetSource: 'built-in',
        selectedCustomPresetId: null,
        selectedCustomPresetName: null,
      });
      options.render();
      syncCustomPresetWorkspaceUi();
      return;
    }

    try {
      exitReferencePresetEditMode();
      const data = await options.syncReferenceRequest(currentSessionId, null, '');
      options.applyVoiceBackendPayload(data);
      options.setForecastStatus('idle');
      options.setForecastError(null);
      options.clearLastTakeTrace();
      await refreshDrills(true);
      await options.refreshCockpitLine('regenerate').catch(() => null);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', 'Reference removed. Reverted to preset guidance.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLastError(message);
      options.render();
      options.addTerminalLine('system', `Reference removal failed: ${message}`);
    }
  }

  async function saveReferencePreset(): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const voiceUiState = options.getVoiceUiState();
    if (!voiceUiState.referenceClipId) {
      return;
    }

    try {
      sanitizeCustomPresetDraftForCurrentMode();
      const draft = voiceUiState.customTargetPresetDraft;
      const draftPreset = getCustomPresetById(draft.presetId);
      const editingReferencePreset = customPresetWorkspaceMode === 'reference' && draftPreset?.kind === 'reference';
      setActiveCustomPresetAction(editingReferencePreset ? 'edit' : null, editingReferencePreset ? draftPreset?.id || null : null);
      const data = await options.saveReferencePresetRequest(
        currentSessionId && isConnected ? currentSessionId : null,
        {
          presetId: editingReferencePreset ? draft.presetId : null,
          name: editingReferencePreset
            ? draft.name || voiceUiState.referenceClipName || ''
            : voiceUiState.referenceClipName || '',
          basePreset: voiceUiState.targetPreset || 'cute-feminine',
          referenceClipId: voiceUiState.referenceClipId,
          referenceClipName: voiceUiState.referenceClipName || '',
          referenceAnalysis: voiceUiState.referenceAnalysis || null,
          targetVoiceProfile: voiceUiState.targetVoiceProfile || null,
          expectedUpdatedAt: editingReferencePreset ? draftPreset?.updatedAt ?? null : null,
        },
      );
      applyTargetPresetLibraryResponse(data);
      const savedPreset = data.preset || null;
      patchVoiceUiState({
        customTargetPresetDraft: editingReferencePreset && savedPreset
          ? buildVoiceCustomTargetPresetDraftFromPreset(savedPreset)
          : options.getVoiceUiState().customTargetPresetDraft,
        lastError: null,
      });
      if (!currentSessionId || !isConnected) {
        applyCustomPresetLocally(savedPreset);
      }
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Saved reference preset: ${savedPreset?.name || 'custom target'}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      setLastError(message);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Saving reference preset failed: ${message}`);
    } finally {
      setActiveCustomPresetAction(null, null);
    }
  }

  async function saveHandmadePreset(): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const draft = options.getVoiceUiState().customTargetPresetDraft;
    const draftPreset = getCustomPresetById(draft.presetId);
    try {
      setActiveCustomPresetAction(draftPreset?.kind === 'handmade' ? 'edit' : null, draftPreset?.kind === 'handmade' ? draftPreset.id : null);
      const data = await options.saveHandmadePresetRequest(currentSessionId && isConnected ? currentSessionId : null, {
        presetId: draftPreset?.kind === 'handmade' ? draft.presetId : null,
        name: draft.name,
        basePreset: draft.basePreset || options.getVoiceUiState().targetPreset || 'cute-feminine',
        expectedUpdatedAt: draftPreset?.kind === 'handmade' ? draftPreset.updatedAt ?? null : null,
        pitchFloorHz: draft.pitchFloorHz,
        pitchCeilingHz: draft.pitchCeilingHz,
        resonanceFloor: draft.resonanceFloor,
        resonanceCeiling: draft.resonanceCeiling,
        weightFloor: draft.weightFloor,
        weightCeiling: draft.weightCeiling,
        stylePrompt: draft.stylePrompt,
        notesText: draft.notesText,
      });
      applyTargetPresetLibraryResponse(data);
      const savedPreset = data.preset || null;
      customPresetWorkspaceMode = 'handmade';
      patchVoiceUiState({
        customTargetPresetDraft: savedPreset
          ? buildVoiceCustomTargetPresetDraftFromPreset(savedPreset)
          : options.getVoiceUiState().customTargetPresetDraft,
        lastError: null,
      });
      if (!currentSessionId || !isConnected) {
        applyCustomPresetLocally(savedPreset);
      }
      options.setForecastStatus('idle');
      options.setForecastError(null);
      options.clearLastTakeTrace();
      if (currentSessionId && isConnected) {
        await refreshDrills(true);
      }
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Saved handmade preset: ${savedPreset?.name || draft.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      setLastError(message);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Saving handmade preset failed: ${message}`);
    } finally {
      setActiveCustomPresetAction(null, null);
    }
  }

  async function selectCustomPreset(presetId: string): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    try {
      options.assertPracticeTargetUnlocked('changing the voice preset');
      setActiveCustomPresetAction('use', presetId);
      const data = await options.selectTargetPresetRequest(currentSessionId && isConnected ? currentSessionId : null, presetId);
      applyTargetPresetLibraryResponse(data);
      applyCustomPresetLocally(data.preset || getCustomPresetById(presetId));
      if (customPresetWorkspaceMode === 'reference' && options.getVoiceUiState().customTargetPresetDraft.presetId !== presetId) {
        exitReferencePresetEditMode();
      }
      patchVoiceUiState({
        lastError: null,
      });
      options.setForecastStatus('idle');
      options.setForecastError(null);
      options.clearLastTakeTrace();
      await refreshDrills(true);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Loaded custom target: ${data.preset?.name || presetId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      setLastError(message);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Custom preset load failed: ${message}`);
    } finally {
      setActiveCustomPresetAction(null, null);
    }
  }

  async function deleteCustomPreset(presetId: string): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const preset = getCustomPresetById(presetId);

    try {
      setActiveCustomPresetAction('delete', presetId);
      const data = await options.deleteTargetPresetRequest(
        currentSessionId && isConnected ? currentSessionId : null,
        presetId,
        preset?.updatedAt ?? null,
      );
      applyTargetPresetLibraryResponse(data);
      if (!currentSessionId || !isConnected) {
        detachRemovedCustomPresetLocally(preset);
      }
      const deletedPresetId = data.deletedPresetId || presetId;
      const currentDraft = options.getVoiceUiState().customTargetPresetDraft;
      if (currentDraft.presetId === deletedPresetId) {
        customPresetWorkspaceMode = 'handmade';
        patchVoiceUiState({
          customTargetPresetDraft: buildSeededHandmadeDraft(),
          lastError: null,
        });
      }
      if (currentSessionId && isConnected) {
        await refreshDrills(true);
      }
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', 'Custom preset deleted.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      setLastError(message);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Deleting custom preset failed: ${message}`);
    } finally {
      setActiveCustomPresetAction(null, null);
    }
  }

  async function duplicateCustomPreset(presetId: string): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const preset = getCustomPresetById(presetId);
    if (!preset) {
      return;
    }

    try {
      setActiveCustomPresetAction('duplicate', presetId);
      const data = await options.duplicateTargetPresetRequest(
        currentSessionId && isConnected ? currentSessionId : null,
        presetId,
        {
          name: `${preset.name} Copy`,
          expectedUpdatedAt: preset.updatedAt ?? null,
        },
      );
      applyTargetPresetLibraryResponse(data);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Duplicated custom preset: ${data.preset?.name || `${preset.name} Copy`}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      setLastError(message);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Duplicating custom preset failed: ${message}`);
    } finally {
      setActiveCustomPresetAction(null, null);
    }
  }

  async function archiveCustomPreset(presetId: string): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const preset = getCustomPresetById(presetId);
    if (!preset) {
      return;
    }

    try {
      setActiveCustomPresetAction('archive', presetId);
      const data = await options.archiveTargetPresetRequest(
        currentSessionId && isConnected ? currentSessionId : null,
        presetId,
        preset.updatedAt ?? null,
      );
      applyTargetPresetLibraryResponse(data);
      if (!currentSessionId || !isConnected) {
        detachRemovedCustomPresetLocally(preset);
      } else {
        await refreshDrills(true);
      }
      const currentDraft = options.getVoiceUiState().customTargetPresetDraft;
      if (currentDraft.presetId === presetId) {
        customPresetWorkspaceMode = 'handmade';
        patchVoiceUiState({
          customTargetPresetDraft: buildSeededHandmadeDraft(),
          lastError: null,
        });
      }
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Archived custom preset: ${preset.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      setLastError(message);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Archiving custom preset failed: ${message}`);
    } finally {
      setActiveCustomPresetAction(null, null);
    }
  }

  async function restoreCustomPreset(presetId: string): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    const preset = getCustomPresetById(presetId);
    if (!preset) {
      return;
    }

    try {
      setActiveCustomPresetAction('restore', presetId);
      const data = await options.restoreTargetPresetRequest(
        currentSessionId && isConnected ? currentSessionId : null,
        presetId,
        preset.updatedAt ?? null,
      );
      applyTargetPresetLibraryResponse(data);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Restored custom preset: ${data.preset?.name || preset.name}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setCustomPresetLibraryState('error', message);
      setLastError(message);
      options.render();
      syncCustomPresetWorkspaceUi();
      options.addTerminalLine('system', `Restoring custom preset failed: ${message}`);
    } finally {
      setActiveCustomPresetAction(null, null);
    }
  }

  function updateCustomPresetDraft(patch: {
    presetId?: string | null;
    name?: string;
    basePreset?: string;
    pitchFloorHz?: string;
    pitchCeilingHz?: string;
    resonanceFloor?: string;
    resonanceCeiling?: string;
    weightFloor?: string;
    weightCeiling?: string;
    stylePrompt?: string;
    notesText?: string;
  }): void {
    const currentDraft = options.getVoiceUiState().customTargetPresetDraft;
    const draftPreset = getCustomPresetById(currentDraft.presetId);
    const referenceOnlyPatch = Object.keys(patch).every((key) => key === 'name');
    const preservePresetId = draftPreset?.kind === 'handmade' || (draftPreset?.kind === 'reference' && customPresetWorkspaceMode === 'reference' && referenceOnlyPatch);
    if (!(draftPreset?.kind === 'reference' && customPresetWorkspaceMode === 'reference' && referenceOnlyPatch)) {
      customPresetWorkspaceMode = 'handmade';
    }
    patchVoiceUiState({
      customTargetPresetDraft: {
        ...currentDraft,
        ...patch,
        presetId: preservePresetId ? currentDraft.presetId : null,
      },
    });
    options.render();
    syncCustomPresetWorkspaceUi();
  }

  function seedCustomPresetDraft(): void {
    customPresetWorkspaceMode = 'handmade';
    patchVoiceUiState({
      customTargetPresetDraft: buildSeededHandmadeDraft(),
    });
    options.render();
    syncCustomPresetWorkspaceUi();
  }

  function editCustomPresetDraft(presetId: string): void {
    const preset = options.getVoiceUiState().customTargetPresets.find((entry) => entry.id === presetId) || null;
    customPresetWorkspaceMode = preset?.kind === 'reference' ? 'reference' : 'handmade';
    patchVoiceUiState({
      customTargetPresetDraft: buildVoiceCustomTargetPresetDraftFromPreset(preset),
    });
    options.render();
    syncCustomPresetWorkspaceUi();
  }

  async function projectPhraseForecast(phraseOverride?: string): Promise<void> {
    const { currentSessionId, isConnected } = options.getSessionContext();
    if (!currentSessionId || !isConnected) {
      return;
    }

    options.assertPracticeTargetUnlocked('projecting a new phrase map');
    const phrase = (phraseOverride ?? options.getVoiceUiState().forecastPhrase ?? '').trim();
    if (!phrase) {
      options.setForecastStatus('error');
      options.setForecastError('Enter a phrase to project.');
      options.render();
      return;
    }

    options.setForecastStatus('loading');
    options.setForecastError(null);
    patchVoiceUiState({
      forecastPhrase: phrase,
    });
    options.render();

    try {
      const data = await options.projectPhraseForecastRequest(currentSessionId, phrase);
      options.applyVoiceBackendPayload(data);
      setLastError(null);
      options.setForecastStatus('idle');
      await options.refreshCockpitLine('regenerate').catch(() => null);
      options.render();
      options.addTerminalLine('system', `Phrase map ready: "${phrase}"`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.setForecastStatus('error');
      options.setForecastError(message);
      setLastError(message);
      options.render();
      options.addTerminalLine('system', `Phrase map failed: ${message}`);
    }
  }

  async function bootstrapVoiceModeSession(
    autoStart = true,
    sessionAlreadySynced = false,
  ): Promise<void> {
    syncCustomPresetWorkspaceUi();
    options.render();
    await refreshKnowledgeStatus();
    const voiceOnline = await refreshHealth();
    if (!voiceOnline) {
      return;
    }

    if (!sessionAlreadySynced) {
      await options.syncSessionStateFromBackend(true);
    }
    await refreshTargetPresets();
    await refreshHealth();
    const bootstrapPlan = planVoiceModeBootstrap({
      autoStart,
      voiceSessionId: options.getVoiceUiState().voiceSessionId,
      voiceTransportStatus: options.getVoiceTransportStatus(),
    });

    if (bootstrapPlan.shouldResumeExistingSession) {
      try {
        await options.startVoiceAudioStream();
        options.render();
      } catch (error) {
        console.warn('[Sloane] Failed to re-arm existing voice session:', error);
      }
      return;
    }

    if (bootstrapPlan.shouldAutoStartPractice) {
      await options.startVoicePracticeSession(true);
    }
  }

  return {
    refreshHealth,
    refreshKnowledgeStatus,
    refreshHealthSoon,
    refreshKnowledgeStatusSoon,
    ensureHealthPoller,
    refreshDrills,
    syncPreset,
    refreshTargetPresets,
    selectDrill,
    analyzeReference,
    removeReference,
    saveReferencePreset,
    saveHandmadePreset,
    selectCustomPreset,
    duplicateCustomPreset,
    archiveCustomPreset,
    restoreCustomPreset,
    deleteCustomPreset,
    updateCustomPresetDraft,
    seedCustomPresetDraft,
    editCustomPresetDraft,
    projectPhraseForecast,
    bootstrapVoiceModeSession,
    stopHealthPoller: () => {
      if (voiceHealthPollTimer !== null) {
        clearIntervalImpl(voiceHealthPollTimer);
        voiceHealthPollTimer = null;
      }
    },
  };
}
