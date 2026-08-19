import type { VoiceCockpitLineAction } from './api';
import { registerVoiceBootstrapListeners, type VoiceBootstrapRefs } from './bootstrap';
import {
  normalizeVoiceUiState,
  type VoiceAdvancedPanelState,
  type VoiceUiState,
} from './state';

type VoiceBootstrapControllerOptions = {
  getCurrentMode: () => string;
  refreshHealthSoon: () => void;
  refreshKnowledgeStatusSoon: () => void;
  getVoiceUiState: () => VoiceUiState;
  updateVoiceUiState: (updater: (state: VoiceUiState) => VoiceUiState) => void;
  getForecastStatus: () => 'idle' | 'loading' | 'error';
  setForecastStatus: (status: 'idle' | 'loading' | 'error') => void;
  setForecastError: (error: string | null) => void;
  getTakeState: () => {
    sessionArmed: boolean;
    takeActive: boolean;
    takeProcessing: boolean;
    suppressPracticeClick: boolean;
  };
  setSuppressPracticeClick: (value: boolean) => void;
  setSelectedInputDeviceId: (deviceId: string) => void;
  writeVoiceInputDevicePreference: (deviceId: string) => void;
  getSelectedVoiceAudioInput: () => { label: string } | null;
  setVoiceAudioInputNotice: (notice: string) => void;
  render: () => void;
  addTerminalLine: (type: 'user' | 'assistant' | 'system', content: string) => void;
  toggleVoiceOverlay: (overlay: 'live' | 'forecast' | 'reference') => void;
  updateVoiceConditioningState: (patch: {
    useTargetProfileStyle?: boolean;
    styleInstruction?: string;
    promptText?: string;
  }) => Promise<unknown>;
  updateVoiceAdvancedPanel?: (patch: Partial<VoiceAdvancedPanelState>) => Promise<unknown>;
  prepareVoiceConditioningLatents: (
    kind: 'prompt' | 'reference',
    file: File,
    promptText?: string,
  ) => Promise<unknown>;
  toggleVoiceCoachInputProvider: () => Promise<unknown> | unknown;
  syncPreset: (preset: string) => Promise<void>;
  updateVoiceCustomPresetDraft: (patch: {
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
  }) => void;
  saveReferencePreset: () => Promise<void>;
  removeVoiceReference: () => Promise<void>;
  seedCustomPresetDraft: () => void;
  saveHandmadePreset: () => Promise<void>;
  editCustomPresetDraft: (presetId: string) => void;
  selectCustomPreset: (presetId: string) => Promise<void>;
  duplicateCustomPreset: (presetId: string) => Promise<void>;
  archiveCustomPreset: (presetId: string) => Promise<void>;
  restoreCustomPreset: (presetId: string) => Promise<void>;
  deleteCustomPreset: (presetId: string) => Promise<void>;
  toggleAdvancedPanel: () => Promise<unknown> | unknown;
  hasActiveDeepTutorGuideSession: () => boolean;
  refreshCockpitLine: (action: Exclude<VoiceCockpitLineAction, 'ensure'>) => Promise<unknown>;
  resumeDeepTutorVoiceLoop: () => Promise<unknown>;
  advanceDeepTutorVoiceLesson: () => Promise<unknown>;
  disarmVoicePracticeSession: () => Promise<unknown>;
  startVoicePracticeSession: () => Promise<unknown>;
  beginVoicePracticeTake: () => Promise<unknown>;
  endVoicePracticeSession: () => Promise<unknown>;
  analyzeReference: (file: File) => Promise<void>;
  projectPhraseForecast: () => Promise<void>;
  submitVoiceCoachQuestion: (question?: string) => Promise<unknown>;
  toggleVoiceCoachContinuousMode: () => Promise<unknown> | unknown;
  toggleVoiceCoachListening: () => Promise<unknown> | unknown;
  toggleVoiceCoachSpeechProvider: () => Promise<unknown> | unknown;
  toggleVoiceCoachSpeech: () => Promise<unknown> | unknown;
  handleReferencePlaybackEvent: (
    eventName: 'play' | 'pause' | 'ended' | 'timeupdate' | 'loadedmetadata' | 'seeked' | 'seeking',
  ) => void;
  refreshVoiceAudioInputDevices: (force?: boolean) => Promise<unknown>;
  alertUser: (message: string) => void;
};

type VoiceBootstrapRegistrationOptions = {
  refs: VoiceBootstrapRefs;
  mediaDevices?: MediaDevices;
};

export type VoiceBootstrapController = ReturnType<typeof createVoiceBootstrapController>;

export function createVoiceBootstrapController(options: VoiceBootstrapControllerOptions) {
  let listenerAbortController: AbortController | null = null;
  let unsubscribeListeners: (() => void) | null = null;

  function disposeListeners(): void {
    unsubscribeListeners?.();
    unsubscribeListeners = null;
    listenerAbortController?.abort();
    listenerAbortController = null;
  }

  function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  function runWithTerminalNotice(label: string, operation: () => Promise<unknown> | unknown): void {
    Promise.resolve()
      .then(operation)
      .catch((error) => {
        options.addTerminalLine('system', `${label}: ${getErrorMessage(error)}`);
      });
  }

  function handleVisibilityVisible(): void {
    if (options.getCurrentMode() !== 'voice') {
      return;
    }

    options.refreshHealthSoon();
    options.refreshKnowledgeStatusSoon();
  }

  function handleVoiceInputDeviceChange(nextDeviceId: string): void {
    options.setSelectedInputDeviceId(nextDeviceId);
    options.writeVoiceInputDevicePreference(nextDeviceId);
    const selectedDevice = options.getSelectedVoiceAudioInput();
    options.setVoiceAudioInputNotice(
      selectedDevice
        ? `${selectedDevice.label} will be used for the next take.`
        : 'The selected input will be used for the next take.',
    );
    options.render();
  }

  function handleVoiceForecastPhraseInput(value: string): void {
    options.updateVoiceUiState((state) => normalizeVoiceUiState({
      ...state,
      forecastPhrase: value,
    }));
    if (options.getForecastStatus() === 'error') {
      options.setForecastStatus('idle');
      options.setForecastError(null);
    }
    options.render();
  }

  async function startVoiceTake(): Promise<void> {
    const { takeProcessing, sessionArmed } = options.getTakeState();
    if (takeProcessing) {
      return;
    }
    if (!sessionArmed) {
      await options.startVoicePracticeSession();
    }
    await options.beginVoicePracticeTake();
  }

  async function finishVoiceTake(): Promise<void> {
    if (!options.getTakeState().takeActive) {
      return;
    }
    options.setSuppressPracticeClick(true);
    await options.endVoicePracticeSession();
  }

  function handleVoiceLineAction(action: Exclude<VoiceCockpitLineAction, 'ensure'>): void {
    if (options.hasActiveDeepTutorGuideSession()) {
      options.addTerminalLine('system', 'DeepTutor owns guided line changes. Ask the coach instead of changing the line directly.');
      options.render();
      return;
    }

    const failureLabel = action === 'regenerate'
      ? 'Line regeneration failed'
      : action === 'next'
        ? 'Next line failed'
        : action === 'pin-toggle'
          ? 'Pin update failed'
          : 'Line update failed';

    options.refreshCockpitLine(action).then(() => {
      options.render();
    }).catch((error) => {
      options.addTerminalLine('system', `${failureLabel}: ${getErrorMessage(error)}`);
    });
  }

  function registerListeners({ refs, mediaDevices }: VoiceBootstrapRegistrationOptions): void {
    disposeListeners();
    listenerAbortController = new AbortController();
    unsubscribeListeners = registerVoiceBootstrapListeners({
      refs,
      mediaDevices,
      signal: listenerAbortController.signal,
      onToggleVoiceOverlay: (overlay) => options.toggleVoiceOverlay(overlay),
      onSaveVoiceConditioning: () => {
        options.updateVoiceConditioningState({
          useTargetProfileStyle: refs.voiceConditioningUseProfileCheckbox?.checked ?? false,
          styleInstruction: refs.voiceConditioningStyleInput?.value.trim() || '',
          promptText: refs.voiceConditioningPromptTextInput?.value.trim() || '',
        }).catch((error) => {
          console.error('[Voice] Failed to save conditioning state', error);
          options.alertUser(`Failed to save tutor voice tuning: ${getErrorMessage(error)}`);
        }).finally(() => {
          options.render();
        });
      },
      onUploadVoiceConditioningSample: (kind, file) => {
        if (kind === 'prompt') {
          const promptText = refs.voiceConditioningPromptTextInput?.value.trim() || '';
          if (!promptText) {
            return;
          }
          options.prepareVoiceConditioningLatents(kind, file, promptText).catch((error) => {
            console.error('[Voice] Failed to prepare prompt conditioning latents', error);
            options.alertUser(`Failed to prepare prompt sample: ${getErrorMessage(error)}`);
          }).finally(() => {
            options.render();
          });
          return;
        }

        options.prepareVoiceConditioningLatents(kind, file).catch((error) => {
          console.error('[Voice] Failed to prepare reference conditioning latents', error);
          options.alertUser(`Failed to prepare reference sample: ${getErrorMessage(error)}`);
        }).finally(() => {
          options.render();
        });
      },
      onVoiceConditioningFileSelectionChange: () => options.render(),
      onToggleVoiceCoachInputProvider: () => {
        void options.toggleVoiceCoachInputProvider();
      },
      onVoicePresetChange: (nextPreset) => {
        void options.syncPreset(nextPreset);
      },
      onVoiceCustomPresetDraftChange: (patch) => {
        options.updateVoiceCustomPresetDraft(patch);
      },
      onSaveReferencePreset: () => {
        runWithTerminalNotice('Saving reference preset failed', () => options.saveReferencePreset());
      },
      onRemoveVoiceReference: () => {
        runWithTerminalNotice('Removing reference failed', () => options.removeVoiceReference());
      },
      onSeedCustomPresetDraft: () => {
        options.seedCustomPresetDraft();
      },
      onSaveHandmadePreset: () => {
        runWithTerminalNotice('Saving handmade preset failed', () => options.saveHandmadePreset());
      },
      onVoiceCustomPresetAction: (action, presetId) => {
        if (action === 'edit') {
          options.editCustomPresetDraft(presetId);
          return;
        }
        if (action === 'use') {
          runWithTerminalNotice('Selecting custom preset failed', () => options.selectCustomPreset(presetId));
          return;
        }
        if (action === 'duplicate') {
          runWithTerminalNotice('Duplicating custom preset failed', () => options.duplicateCustomPreset(presetId));
          return;
        }
        if (action === 'archive') {
          runWithTerminalNotice('Archiving custom preset failed', () => options.archiveCustomPreset(presetId));
          return;
        }
        if (action === 'restore') {
          runWithTerminalNotice('Restoring custom preset failed', () => options.restoreCustomPreset(presetId));
          return;
        }
        runWithTerminalNotice('Deleting custom preset failed', () => options.deleteCustomPreset(presetId));
      },
      onVoiceInputDeviceChange: handleVoiceInputDeviceChange,
      onToggleVoiceAdvancedPanel: () => {
        void options.toggleAdvancedPanel();
      },
      onUpdateVoiceAdvancedPanel: (patch) => {
        options.updateVoiceUiState((state) => normalizeVoiceUiState({
          ...state,
          advancedPanel: {
            ...state.advancedPanel,
            ...patch,
          },
        }));

        options.updateVoiceAdvancedPanel?.(patch).catch((error) => {
          console.error('[Voice] Failed to update advanced panel preferences', error);
          options.alertUser(`Failed to update VAD tuning: ${getErrorMessage(error)}`);
        }).finally(() => {
          options.render();
        });
      },
      onVoiceLineAction: handleVoiceLineAction,
      onStartDeepTutorVoice: () => {
        runWithTerminalNotice('Coach loop action failed', () => options.resumeDeepTutorVoiceLoop());
      },
      onAdvanceDeepTutorVoice: () => {
        if (!options.hasActiveDeepTutorGuideSession()) {
          options.addTerminalLine('system', 'Start guided coach before advancing the lesson.');
          options.render();
          return;
        }
        runWithTerminalNotice('Lesson advance failed', () => options.advanceDeepTutorVoiceLesson());
      },
      onToggleVoicePracticeSession: () => {
        if (options.getTakeState().sessionArmed) {
          runWithTerminalNotice('Voice trainer disarm failed', () => options.disarmVoicePracticeSession());
          return;
        }
        runWithTerminalNotice('Voice trainer start failed', () => options.startVoicePracticeSession());
      },
      onStartVoiceTake: () => {
        runWithTerminalNotice('Voice take start failed', () => startVoiceTake());
      },
      onFinishVoiceTake: () => {
        if (!options.getTakeState().takeActive) {
          return;
        }
        runWithTerminalNotice('Voice take finish failed', () => finishVoiceTake());
      },
      onVoiceTakeButtonClick: () => {
        if (options.getTakeState().suppressPracticeClick) {
          options.setSuppressPracticeClick(false);
          return;
        }
        if (options.getTakeState().takeActive) {
          runWithTerminalNotice('Voice take finish failed', () => options.endVoicePracticeSession());
          return;
        }
        runWithTerminalNotice('Voice take start failed', () => startVoiceTake());
      },
      onVoiceReferenceSelected: (file) => {
        void options.analyzeReference(file);
      },
      onVoiceForecastPhraseInput: handleVoiceForecastPhraseInput,
      onVoiceSelfReportChange: (patch) => {
        options.updateVoiceUiState((state) => normalizeVoiceUiState({
          ...state,
          selfReportDraft: {
            ...state.selfReportDraft,
            ...patch,
          },
        }));
        options.render();
      },
      onGenerateVoiceForecast: () => {
        void options.projectPhraseForecast();
      },
      onSubmitVoiceCoachQuestion: (question) => {
        runWithTerminalNotice('Coach question failed', () => options.submitVoiceCoachQuestion(question));
      },
      onToggleVoiceCoachContinuousMode: () => {
        void options.toggleVoiceCoachContinuousMode();
      },
      onToggleVoiceCoachListening: () => {
        void options.toggleVoiceCoachListening();
      },
      onToggleVoiceCoachSpeechProvider: () => {
        void options.toggleVoiceCoachSpeechProvider();
      },
      onToggleVoiceCoachSpeech: () => {
        void options.toggleVoiceCoachSpeech();
      },
      onVoiceCoachQuickQuestion: (question) => {
        runWithTerminalNotice('Coach question failed', () => options.submitVoiceCoachQuestion(question));
      },
      onVoiceReferencePlaybackEvent: (eventName) => {
        options.handleReferencePlaybackEvent(eventName);
      },
      onVoiceAudioDeviceTopologyChange: () => {
        options.refreshVoiceAudioInputDevices(true).catch((error) => {
          console.warn('[Sloane] Failed to refresh voice inputs after device change:', error);
        });
      },
    });
  }

  return {
    handleVisibilityVisible,
    registerListeners,
  };
}
