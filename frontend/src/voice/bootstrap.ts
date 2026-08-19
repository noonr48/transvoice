import type { VoiceAdvancedPanelState, VoiceSelfReport } from './state';

type VoiceBootstrapOverlay = 'live' | 'forecast' | 'reference';
type VoiceBootstrapLineAction = 'regenerate' | 'easier' | 'harder' | 'next' | 'pin-toggle';
type VoiceBootstrapConditioningSampleKind = 'prompt' | 'reference';
type VoiceBootstrapPlaybackEvent =
  | 'play'
  | 'pause'
  | 'ended'
  | 'timeupdate'
  | 'loadedmetadata'
  | 'seeked'
  | 'seeking';

export type VoiceBootstrapRefs = {
  voiceAdvancedToggleBtn: HTMLButtonElement;
  voiceTargetPresetSelect: HTMLSelectElement;
  voiceCustomPresetNameInput: HTMLInputElement;
  voiceCustomPresetBasePresetSelect: HTMLSelectElement;
  voiceCustomPresetPitchFloorInput: HTMLInputElement;
  voiceCustomPresetPitchCeilingInput: HTMLInputElement;
  voiceCustomPresetResonanceFloorInput: HTMLInputElement;
  voiceCustomPresetResonanceCeilingInput: HTMLInputElement;
  voiceCustomPresetWeightFloorInput: HTMLInputElement;
  voiceCustomPresetWeightCeilingInput: HTMLInputElement;
  voiceCustomPresetStylePromptInput: HTMLInputElement;
  voiceCustomPresetNotesInput: HTMLTextAreaElement;
  voiceSaveReferencePresetBtn: HTMLButtonElement;
  voiceRemoveReferenceBtn: HTMLButtonElement;
  voiceSeedCustomPresetBtn: HTMLButtonElement;
  voiceSaveHandmadePresetBtn: HTMLButtonElement;
  voiceCustomPresetListEl: HTMLElement;
  voiceInputDeviceSelect: HTMLSelectElement;
  voiceConditioningUseProfileCheckbox: HTMLInputElement;
  voiceConditioningStyleInput: HTMLInputElement;
  voiceConditioningPromptTextInput: HTMLInputElement;
  voiceForecastPhraseInput: HTMLInputElement;
  voiceForecastGenerateBtn: HTMLButtonElement;
  voiceSelfReportEffortSelect: HTMLSelectElement;
  voiceSelfReportStrainSelect: HTMLSelectElement;
  voiceSelfReportFatigueSelect: HTMLSelectElement;
  voiceSelfReportDifficultySelect: HTMLSelectElement;
  voiceSelfReportConfidenceSelect: HTMLSelectElement;
  voiceToggleLivePathBtn: HTMLButtonElement;
  voiceToggleForecastPathBtn: HTMLButtonElement;
  voiceToggleReferencePathBtn: HTMLButtonElement;
  voiceStartSessionBtn: HTMLButtonElement;
  voiceEndSessionBtn: HTMLButtonElement;
  voiceReferenceInput: HTMLInputElement;
  voiceReferencePlayerEl: HTMLAudioElement;
  voiceDeepTutorStartBtn: HTMLButtonElement;
  voiceDeepTutorNextBtn: HTMLButtonElement;
  voiceLineRegenerateBtn: HTMLButtonElement;
  voiceLineEasierBtn: HTMLButtonElement;
  voiceLineHarderBtn: HTMLButtonElement;
  voiceLineNextBtn: HTMLButtonElement;
  voiceLinePinBtn: HTMLButtonElement;
  voiceCoachQuestionInput: HTMLInputElement | null;
  voiceCoachLiveToggleBtn: HTMLButtonElement;
  voiceCoachVoiceToggleBtn: HTMLButtonElement;
  voiceCoachSendBtn: HTMLButtonElement | null;
  voiceCoachSpeechToggleBtn: HTMLButtonElement;
  voiceCoachProviderToggleBtn: HTMLButtonElement;
  voiceCoachInputProviderToggleBtn: HTMLButtonElement;
  voiceConditioningPromptFileInput: HTMLInputElement;
  voiceConditioningReferenceFileInput: HTMLInputElement;
  voiceConditioningSaveBtn: HTMLButtonElement;
  voiceConditioningPromptUploadBtn: HTMLButtonElement;
  voiceConditioningReferenceUploadBtn: HTMLButtonElement;
  voiceCoachQuestionButtons: HTMLElement[];
  voiceVadRmsThresholdInput: HTMLInputElement;
  voiceVadSilenceHoldMsInput: HTMLInputElement;
  voiceVadNoSpeechTimeoutMsInput: HTMLInputElement;
  voiceVadMinSpeechMsInput: HTMLInputElement;
  voiceAudioPreferWorkletCheckbox: HTMLInputElement;
};

type VoiceBootstrapRegistration = {
  refs: VoiceBootstrapRefs;
  mediaDevices?: MediaDevices;
  signal?: AbortSignal;
  onToggleVoiceOverlay: (overlay: VoiceBootstrapOverlay) => void;
  onSaveVoiceConditioning: () => void;
  onUploadVoiceConditioningSample: (kind: VoiceBootstrapConditioningSampleKind, file: File) => void;
  onVoiceConditioningFileSelectionChange: () => void;
  onToggleVoiceCoachInputProvider: () => void;
  onVoicePresetChange: (preset: string) => void;
  onVoiceCustomPresetDraftChange: (patch: {
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
  onSaveReferencePreset: () => void;
  onRemoveVoiceReference: () => void;
  onSeedCustomPresetDraft: () => void;
  onSaveHandmadePreset: () => void;
  onVoiceCustomPresetAction: (
    action: 'use' | 'edit' | 'duplicate' | 'archive' | 'restore' | 'delete',
    presetId: string,
  ) => void;
  onVoiceInputDeviceChange: (deviceId: string) => void;
  onToggleVoiceAdvancedPanel: () => void;
  onVoiceLineAction: (action: VoiceBootstrapLineAction) => void;
  onStartDeepTutorVoice: () => void;
  onAdvanceDeepTutorVoice: () => void;
  onToggleVoicePracticeSession: () => void;
  onStartVoiceTake: () => void;
  onFinishVoiceTake: () => void;
  onVoiceTakeButtonClick: () => void;
  onVoiceReferenceSelected: (file: File) => void;
  onVoiceForecastPhraseInput: (value: string) => void;
  onVoiceSelfReportChange: (patch: Partial<VoiceSelfReport>) => void;
  onGenerateVoiceForecast: () => void;
  onSubmitVoiceCoachQuestion: (question?: string) => void;
  onToggleVoiceCoachContinuousMode: () => void;
  onToggleVoiceCoachListening: () => void;
  onToggleVoiceCoachSpeechProvider: () => void;
  onToggleVoiceCoachSpeech: () => void;
  onVoiceCoachQuickQuestion: (question: string) => void;
  onVoiceReferencePlaybackEvent: (eventName: VoiceBootstrapPlaybackEvent) => void;
  onVoiceAudioDeviceTopologyChange: () => void;
  onUpdateVoiceAdvancedPanel?: (patch: Partial<VoiceAdvancedPanelState>) => void;
};

export function registerVoiceBootstrapListeners(config: VoiceBootstrapRegistration): () => void {
  const { refs, mediaDevices, signal } = config;
  let disposed = false;
  const cleanups: Array<() => void> = [];

  const dispose = () => {
    if (disposed) return;
    disposed = true;
    cleanups.splice(0).forEach((cleanup) => cleanup());
  };

  if (signal?.aborted) {
    return dispose;
  }

  if (signal) {
    signal.addEventListener('abort', dispose, { once: true });
    cleanups.push(() => signal.removeEventListener('abort', dispose));
  }

  const withSignal = (options?: AddEventListenerOptions | boolean) => {
    if (!signal) return options;
    if (typeof options === 'boolean') {
      return { capture: options, signal };
    }
    return { ...(options || {}), signal };
  };

  const listen = (
    target: EventTarget | null | undefined,
    event: string,
    handler: EventListenerOrEventListenerObject,
    options?: AddEventListenerOptions | boolean,
  ) => {
    if (!target || typeof (target as EventTarget).addEventListener !== 'function') {
      return;
    }

    const resolved = withSignal(options);
    try {
      (target as any).addEventListener(event, handler, resolved);
    } catch {
      // Older DOM shims may not understand AbortSignal in listener options.
      (target as any).addEventListener(event, handler, options as any);
    }

    cleanups.push(() => {
      (target as any).removeEventListener(event, handler, options as any);
    });
  };

  const updateAdvancedPanel = (patch: Partial<VoiceAdvancedPanelState>) => {
    config.onUpdateVoiceAdvancedPanel?.(patch);
  };

  const clampNumber = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
  const parseFloatOrFallback = (raw: string, fallback: number) => {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : fallback;
  };
  const parseIntOrFallback = (raw: string, fallback: number) => {
    const trimmed = raw.trim();
    if (!trimmed) return fallback;
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? Math.round(numeric) : fallback;
  };
  const parseSelfReportScale = (raw: string): number | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const numeric = Number(trimmed);
    if (!Number.isFinite(numeric)) return null;
    const rounded = Math.round(numeric);
    return rounded >= 1 && rounded <= 5 ? rounded : null;
  };

  listen(refs.voiceToggleLivePathBtn, 'click', () => config.onToggleVoiceOverlay('live'));
  listen(refs.voiceToggleForecastPathBtn, 'click', () => config.onToggleVoiceOverlay('forecast'));
  listen(refs.voiceToggleReferencePathBtn, 'click', () => config.onToggleVoiceOverlay('reference'));
  listen(refs.voiceConditioningSaveBtn, 'click', () => config.onSaveVoiceConditioning());
  listen(refs.voiceConditioningPromptUploadBtn, 'click', () => {
    const file = refs.voiceConditioningPromptFileInput?.files?.[0];
    if (!file) {
      return;
    }
    config.onUploadVoiceConditioningSample('prompt', file);
  });
  listen(refs.voiceConditioningReferenceUploadBtn, 'click', () => {
    const file = refs.voiceConditioningReferenceFileInput?.files?.[0];
    if (!file) {
      return;
    }
    config.onUploadVoiceConditioningSample('reference', file);
  });
  listen(refs.voiceConditioningPromptFileInput, 'change', () => config.onVoiceConditioningFileSelectionChange());
  listen(refs.voiceConditioningReferenceFileInput, 'change', () => config.onVoiceConditioningFileSelectionChange());
  listen(refs.voiceCoachInputProviderToggleBtn, 'click', () => config.onToggleVoiceCoachInputProvider());
  listen(refs.voiceTargetPresetSelect, 'change', () => {
    config.onVoicePresetChange(refs.voiceTargetPresetSelect.value || 'cute-feminine');
  });
  listen(refs.voiceCustomPresetNameInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      name: refs.voiceCustomPresetNameInput.value,
    });
  });
  listen(refs.voiceCustomPresetBasePresetSelect, 'change', () => {
    config.onVoiceCustomPresetDraftChange({
      basePreset: refs.voiceCustomPresetBasePresetSelect.value || 'cute-feminine',
    });
  });
  listen(refs.voiceCustomPresetPitchFloorInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      pitchFloorHz: refs.voiceCustomPresetPitchFloorInput.value,
    });
  });
  listen(refs.voiceCustomPresetPitchCeilingInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      pitchCeilingHz: refs.voiceCustomPresetPitchCeilingInput.value,
    });
  });
  listen(refs.voiceCustomPresetResonanceFloorInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      resonanceFloor: refs.voiceCustomPresetResonanceFloorInput.value,
    });
  });
  listen(refs.voiceCustomPresetResonanceCeilingInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      resonanceCeiling: refs.voiceCustomPresetResonanceCeilingInput.value,
    });
  });
  listen(refs.voiceCustomPresetWeightFloorInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      weightFloor: refs.voiceCustomPresetWeightFloorInput.value,
    });
  });
  listen(refs.voiceCustomPresetWeightCeilingInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      weightCeiling: refs.voiceCustomPresetWeightCeilingInput.value,
    });
  });
  listen(refs.voiceCustomPresetStylePromptInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      stylePrompt: refs.voiceCustomPresetStylePromptInput.value,
    });
  });
  listen(refs.voiceCustomPresetNotesInput, 'input', () => {
    config.onVoiceCustomPresetDraftChange({
      notesText: refs.voiceCustomPresetNotesInput.value,
    });
  });
  listen(refs.voiceSaveReferencePresetBtn, 'click', () => config.onSaveReferencePreset());
  listen(refs.voiceRemoveReferenceBtn, 'click', () => config.onRemoveVoiceReference());
  listen(refs.voiceSeedCustomPresetBtn, 'click', () => config.onSeedCustomPresetDraft());
  listen(refs.voiceSaveHandmadePresetBtn, 'click', () => config.onSaveHandmadePreset());
  listen(refs.voiceCustomPresetListEl, 'click', (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest<HTMLElement>('[data-voice-custom-preset-action]')
      : null;
    if (!target) {
      return;
    }
    const presetId = target.dataset.voiceCustomPresetId || '';
    const action = target.dataset.voiceCustomPresetAction || '';
    if (
      !presetId
      || !['use', 'edit', 'duplicate', 'archive', 'restore', 'delete'].includes(action)
    ) {
      return;
    }
    config.onVoiceCustomPresetAction(action as 'use' | 'edit' | 'duplicate' | 'archive' | 'restore' | 'delete', presetId);
  });
  listen(refs.voiceInputDeviceSelect, 'change', () => {
    config.onVoiceInputDeviceChange(refs.voiceInputDeviceSelect.value || 'default');
  });
  listen(refs.voiceAdvancedToggleBtn, 'click', () => config.onToggleVoiceAdvancedPanel());
  listen(refs.voiceVadRmsThresholdInput, 'change', () => {
    const next = clampNumber(parseFloatOrFallback(refs.voiceVadRmsThresholdInput.value, 0.018), 0.003, 0.08);
    updateAdvancedPanel({ vadRmsThreshold: Number(next.toFixed(4)) });
  });
  listen(refs.voiceVadSilenceHoldMsInput, 'change', () => {
    const next = clampNumber(parseIntOrFallback(refs.voiceVadSilenceHoldMsInput.value, 900), 300, 2400);
    updateAdvancedPanel({ vadSilenceHoldMs: next });
  });
  listen(refs.voiceVadNoSpeechTimeoutMsInput, 'change', () => {
    const next = clampNumber(parseIntOrFallback(refs.voiceVadNoSpeechTimeoutMsInput.value, 12000), 2000, 20000);
    updateAdvancedPanel({ vadNoSpeechTimeoutMs: next });
  });
  listen(refs.voiceVadMinSpeechMsInput, 'change', () => {
    const next = clampNumber(parseIntOrFallback(refs.voiceVadMinSpeechMsInput.value, 350), 150, 2000);
    updateAdvancedPanel({ vadMinSpeechMs: next });
  });
  listen(refs.voiceAudioPreferWorkletCheckbox, 'change', () => {
    updateAdvancedPanel({ audioPreferWorklet: Boolean(refs.voiceAudioPreferWorkletCheckbox.checked) });
  });
  listen(refs.voiceLineRegenerateBtn, 'click', () => config.onVoiceLineAction('regenerate'));
  listen(refs.voiceLineEasierBtn, 'click', () => config.onVoiceLineAction('easier'));
  listen(refs.voiceLineHarderBtn, 'click', () => config.onVoiceLineAction('harder'));
  listen(refs.voiceLineNextBtn, 'click', () => config.onVoiceLineAction('next'));
  listen(refs.voiceLinePinBtn, 'click', () => config.onVoiceLineAction('pin-toggle'));
  listen(refs.voiceDeepTutorStartBtn, 'click', () => config.onStartDeepTutorVoice());
  listen(refs.voiceDeepTutorNextBtn, 'click', () => config.onAdvanceDeepTutorVoice());
  listen(refs.voiceStartSessionBtn, 'click', () => config.onToggleVoicePracticeSession());
  listen(refs.voiceEndSessionBtn, 'pointerdown', (event) => {
    event.preventDefault();
    config.onStartVoiceTake();
  });
  listen(refs.voiceEndSessionBtn, 'pointerup', (event) => {
    event.preventDefault();
    config.onFinishVoiceTake();
  });
  listen(refs.voiceEndSessionBtn, 'pointerleave', () => config.onFinishVoiceTake());
  listen(refs.voiceEndSessionBtn, 'pointercancel', () => config.onFinishVoiceTake());
  listen(refs.voiceEndSessionBtn, 'click', () => config.onVoiceTakeButtonClick());
  listen(refs.voiceReferenceInput, 'change', () => {
    const file = refs.voiceReferenceInput.files?.[0];
    if (!file) {
      return;
    }
    config.onVoiceReferenceSelected(file);
    refs.voiceReferenceInput.value = '';
  });
  listen(refs.voiceForecastPhraseInput, 'input', () => {
    config.onVoiceForecastPhraseInput(refs.voiceForecastPhraseInput.value);
  });
  listen(refs.voiceSelfReportEffortSelect, 'change', () => {
    config.onVoiceSelfReportChange({ effort: parseSelfReportScale(refs.voiceSelfReportEffortSelect.value) });
  });
  listen(refs.voiceSelfReportStrainSelect, 'change', () => {
    config.onVoiceSelfReportChange({ strain: parseSelfReportScale(refs.voiceSelfReportStrainSelect.value) });
  });
  listen(refs.voiceSelfReportFatigueSelect, 'change', () => {
    config.onVoiceSelfReportChange({ fatigue: parseSelfReportScale(refs.voiceSelfReportFatigueSelect.value) });
  });
  listen(refs.voiceSelfReportDifficultySelect, 'change', () => {
    config.onVoiceSelfReportChange({
      perceivedDifficulty: parseSelfReportScale(refs.voiceSelfReportDifficultySelect.value),
    });
  });
  listen(refs.voiceSelfReportConfidenceSelect, 'change', () => {
    config.onVoiceSelfReportChange({ confidence: parseSelfReportScale(refs.voiceSelfReportConfidenceSelect.value) });
  });
  listen(refs.voiceForecastPhraseInput, 'keydown', (event) => {
    const keyboardEvent = event as KeyboardEvent;
    if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      config.onGenerateVoiceForecast();
    }
  });
  listen(refs.voiceForecastGenerateBtn, 'click', () => config.onGenerateVoiceForecast());
  // 2026-07-27 (owner's law): coach mode is SPOKEN. The typed input and its
  // send button are gone from current templates (refs bind null); the guards
  // keep legacy embeddings working without resurrecting typing here.
  if (refs.voiceCoachSendBtn) {
    listen(refs.voiceCoachSendBtn, 'click', () => config.onSubmitVoiceCoachQuestion());
  }
  listen(refs.voiceCoachLiveToggleBtn, 'click', () => config.onToggleVoiceCoachContinuousMode());
  listen(refs.voiceCoachVoiceToggleBtn, 'click', () => config.onToggleVoiceCoachListening());
  listen(refs.voiceCoachProviderToggleBtn, 'click', () => config.onToggleVoiceCoachSpeechProvider());
  if (refs.voiceCoachQuestionInput) {
    listen(refs.voiceCoachQuestionInput, 'keydown', (event) => {
      const keyboardEvent = event as KeyboardEvent;
      if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
        keyboardEvent.preventDefault();
        config.onSubmitVoiceCoachQuestion();
      }
    });
  }
  listen(refs.voiceCoachSpeechToggleBtn, 'click', () => config.onToggleVoiceCoachSpeech());
  refs.voiceCoachQuestionButtons.forEach((button) => {
    listen(button, 'click', () => {
      const question = button.dataset.voiceCoachQuestion || '';
      if (!question) {
        return;
      }
      config.onVoiceCoachQuickQuestion(question);
    });
  });
  listen(refs.voiceReferencePlayerEl, 'play', () => config.onVoiceReferencePlaybackEvent('play'));
  listen(refs.voiceReferencePlayerEl, 'pause', () => config.onVoiceReferencePlaybackEvent('pause'));
  listen(refs.voiceReferencePlayerEl, 'ended', () => config.onVoiceReferencePlaybackEvent('ended'));
  ['timeupdate', 'loadedmetadata', 'seeked', 'seeking'].forEach((eventName) => {
    listen(refs.voiceReferencePlayerEl, eventName, () => {
      config.onVoiceReferencePlaybackEvent(eventName as VoiceBootstrapPlaybackEvent);
    });
  });
  listen(mediaDevices as any, 'devicechange', () => config.onVoiceAudioDeviceTopologyChange());

  return dispose;
}
