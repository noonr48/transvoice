import { describe, expect, it, vi } from 'vitest';
import type { VoiceBootstrapRefs } from './bootstrap';
import { createVoiceBootstrapController } from './bootstrap-controller';
import { createDefaultVoiceUiState, normalizeVoiceUiState, type VoiceUiState } from './state';

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createRefs(): VoiceBootstrapRefs {
  const createButton = () => document.createElement('button') as HTMLButtonElement;
  const createInput = (type = 'text') => {
    const element = document.createElement('input') as HTMLInputElement;
    element.type = type;
    return element;
  };

  const voiceTargetPresetSelect = document.createElement('select') as HTMLSelectElement;
  voiceTargetPresetSelect.appendChild(new Option('Cute', 'cute-feminine'));
  voiceTargetPresetSelect.appendChild(new Option('Warm', 'warm'));

  const voiceInputDeviceSelect = document.createElement('select') as HTMLSelectElement;
  voiceInputDeviceSelect.appendChild(new Option('Default', 'default'));
  voiceInputDeviceSelect.appendChild(new Option('USB', 'usb'));

  const voiceCoachQuestionButton = createButton();
  voiceCoachQuestionButton.dataset.voiceCoachQuestion = 'How do I brighten this?';

  return {
    voiceAdvancedToggleBtn: createButton(),
    voiceTargetPresetSelect,
    voiceInputDeviceSelect,
    voiceConditioningUseProfileCheckbox: createInput('checkbox'),
    voiceConditioningStyleInput: createInput(),
	    voiceConditioningPromptTextInput: createInput(),
	    voiceForecastPhraseInput: createInput(),
	    voiceForecastGenerateBtn: createButton(),
	    voiceSelfReportEffortSelect: document.createElement('select') as HTMLSelectElement,
	    voiceSelfReportStrainSelect: document.createElement('select') as HTMLSelectElement,
	    voiceSelfReportFatigueSelect: document.createElement('select') as HTMLSelectElement,
	    voiceSelfReportDifficultySelect: document.createElement('select') as HTMLSelectElement,
	    voiceSelfReportConfidenceSelect: document.createElement('select') as HTMLSelectElement,
	    voiceToggleLivePathBtn: createButton(),
    voiceToggleForecastPathBtn: createButton(),
    voiceToggleReferencePathBtn: createButton(),
    voiceStartSessionBtn: createButton(),
    voiceEndSessionBtn: createButton(),
    voiceReferenceInput: createInput('file'),
    voiceReferencePlayerEl: document.createElement('audio') as HTMLAudioElement,
    voiceDeepTutorStartBtn: createButton(),
    voiceDeepTutorNextBtn: createButton(),
    voiceLineRegenerateBtn: createButton(),
    voiceLineEasierBtn: createButton(),
    voiceLineHarderBtn: createButton(),
    voiceLineNextBtn: createButton(),
    voiceLinePinBtn: createButton(),
    voiceCoachQuestionInput: createInput(),
    voiceCoachLiveToggleBtn: createButton(),
    voiceCoachVoiceToggleBtn: createButton(),
    voiceCoachSendBtn: createButton(),
    voiceCoachSpeechToggleBtn: createButton(),
    voiceCoachProviderToggleBtn: createButton(),
    voiceCoachInputProviderToggleBtn: createButton(),
    voiceConditioningPromptFileInput: createInput('file'),
    voiceConditioningReferenceFileInput: createInput('file'),
    voiceConditioningSaveBtn: createButton(),
    voiceConditioningPromptUploadBtn: createButton(),
    voiceConditioningReferenceUploadBtn: createButton(),
    voiceCoachQuestionButtons: [voiceCoachQuestionButton],
    voiceVadRmsThresholdInput: createInput('number'),
    voiceVadSilenceHoldMsInput: createInput('number'),
    voiceVadNoSpeechTimeoutMsInput: createInput('number'),
    voiceVadMinSpeechMsInput: createInput('number'),
    voiceAudioPreferWorkletCheckbox: createInput('checkbox'),
  };
}

function createHarness(options: {
  currentMode?: string;
  forecastStatus?: 'idle' | 'loading' | 'error';
  forecastError?: string | null;
  takeState?: {
    sessionArmed: boolean;
    takeActive: boolean;
    takeProcessing: boolean;
    suppressPracticeClick: boolean;
  };
} = {}) {
  let currentMode = options.currentMode ?? 'voice';
  let voiceUiState: VoiceUiState = createDefaultVoiceUiState();
  let forecastStatus = options.forecastStatus ?? 'idle';
  let forecastError = options.forecastError ?? null;
  let selectedInputDeviceId = 'default';
  let voiceAudioInputNotice = '';
  const takeState = {
    sessionArmed: false,
    takeActive: false,
    takeProcessing: false,
    suppressPracticeClick: false,
    ...(options.takeState || {}),
  };

  const refreshHealthSoon = vi.fn();
  const refreshKnowledgeStatusSoon = vi.fn();
  const render = vi.fn();
  const addTerminalLine = vi.fn();
  const writeVoiceInputDevicePreference = vi.fn();
  const updateVoiceConditioningState = vi.fn(async () => undefined);
  const updateVoiceAdvancedPanel = vi.fn(async () => undefined);
  const prepareVoiceConditioningLatents = vi.fn(async () => undefined);
  const toggleVoiceCoachInputProvider = vi.fn();
  const syncPreset = vi.fn(async () => undefined);
  const toggleAdvancedPanel = vi.fn(async () => undefined);
  const hasActiveDeepTutorGuideSession = vi.fn(() => false);
  const refreshCockpitLine = vi.fn(async () => undefined);
  const resumeDeepTutorVoiceLoop = vi.fn(async () => undefined);
  const advanceDeepTutorVoiceLesson = vi.fn(async () => undefined);
  const disarmVoicePracticeSession = vi.fn(async () => undefined);
  const startVoicePracticeSession = vi.fn(async () => undefined);
  const beginVoicePracticeTake = vi.fn(async () => {
    takeState.takeActive = true;
  });
  const endVoicePracticeSession = vi.fn(async () => {
    takeState.takeActive = false;
  });
  const analyzeReference = vi.fn(async () => undefined);
  const projectPhraseForecast = vi.fn(async () => undefined);
  const submitVoiceCoachQuestion = vi.fn(async () => undefined);
  const toggleVoiceCoachContinuousMode = vi.fn();
  const toggleVoiceCoachListening = vi.fn();
  const toggleVoiceCoachSpeechProvider = vi.fn();
  const toggleVoiceCoachSpeech = vi.fn();
  const handleReferencePlaybackEvent = vi.fn();
  const refreshVoiceAudioInputDevices = vi.fn(async () => undefined);
  const alertUser = vi.fn();

  const controller = createVoiceBootstrapController({
    getCurrentMode: () => currentMode,
    refreshHealthSoon,
    refreshKnowledgeStatusSoon,
    getVoiceUiState: () => voiceUiState,
    updateVoiceUiState: (updater) => {
      voiceUiState = normalizeVoiceUiState(updater(voiceUiState));
    },
    getForecastStatus: () => forecastStatus,
    setForecastStatus: (status) => {
      forecastStatus = status;
    },
    setForecastError: (error) => {
      forecastError = error;
    },
    getTakeState: () => takeState,
    setSuppressPracticeClick: (value) => {
      takeState.suppressPracticeClick = value;
    },
    setSelectedInputDeviceId: (deviceId) => {
      selectedInputDeviceId = deviceId;
    },
    writeVoiceInputDevicePreference,
    getSelectedVoiceAudioInput: () => (
      selectedInputDeviceId === 'usb'
        ? { label: 'USB Mic' }
        : null
    ),
    setVoiceAudioInputNotice: (notice) => {
      voiceAudioInputNotice = notice;
    },
    render,
    addTerminalLine,
    toggleVoiceOverlay: vi.fn(),
    updateVoiceConditioningState,
    updateVoiceAdvancedPanel,
    prepareVoiceConditioningLatents,
    toggleVoiceCoachInputProvider,
    syncPreset,
    toggleAdvancedPanel,
    hasActiveDeepTutorGuideSession,
    refreshCockpitLine,
    resumeDeepTutorVoiceLoop,
    advanceDeepTutorVoiceLesson,
    disarmVoicePracticeSession,
    startVoicePracticeSession,
    beginVoicePracticeTake,
    endVoicePracticeSession,
    analyzeReference,
    projectPhraseForecast,
    submitVoiceCoachQuestion,
    toggleVoiceCoachContinuousMode,
    toggleVoiceCoachListening,
    toggleVoiceCoachSpeechProvider,
    toggleVoiceCoachSpeech,
    handleReferencePlaybackEvent,
    refreshVoiceAudioInputDevices,
    alertUser,
  });

  return {
    controller,
    createRefs,
    setCurrentMode: (mode: string) => {
      currentMode = mode;
    },
    getVoiceUiState: () => voiceUiState,
    getForecastStatus: () => forecastStatus,
    getForecastError: () => forecastError,
    getSelectedInputDeviceId: () => selectedInputDeviceId,
    getVoiceAudioInputNotice: () => voiceAudioInputNotice,
    getTakeState: () => takeState,
    refreshHealthSoon,
    refreshKnowledgeStatusSoon,
    render,
    addTerminalLine,
    writeVoiceInputDevicePreference,
    updateVoiceConditioningState,
    updateVoiceAdvancedPanel,
    syncPreset,
    hasActiveDeepTutorGuideSession,
    refreshCockpitLine,
    projectPhraseForecast,
    advanceDeepTutorVoiceLesson,
    beginVoicePracticeTake,
    endVoicePracticeSession,
  };
}

describe('voice bootstrap controller', () => {
  it('refreshes voice runtime status only when voice mode is visible', () => {
    const harness = createHarness({ currentMode: 'general' });

    harness.controller.handleVisibilityVisible();
    expect(harness.refreshHealthSoon).not.toHaveBeenCalled();
    expect(harness.refreshKnowledgeStatusSoon).not.toHaveBeenCalled();

    harness.setCurrentMode('voice');
    harness.controller.handleVisibilityVisible();

    expect(harness.refreshHealthSoon).toHaveBeenCalledTimes(1);
    expect(harness.refreshKnowledgeStatusSoon).toHaveBeenCalledTimes(1);
  });

	  it('updates the forecast phrase and clears forecast errors through the bootstrap listeners', () => {
    const harness = createHarness({ forecastStatus: 'error', forecastError: 'old error' });
    const refs = harness.createRefs();

    harness.controller.registerListeners({ refs });
    refs.voiceForecastPhraseInput.value = 'lift the ending';
    refs.voiceForecastPhraseInput.dispatchEvent(new Event('input'));

    expect(harness.getVoiceUiState().forecastPhrase).toBe('lift the ending');
    expect(harness.getForecastStatus()).toBe('idle');
    expect(harness.getForecastError()).toBe(null);
    expect(harness.render).toHaveBeenCalledTimes(1);
	  });

	  it('updates the take self-report draft through the bootstrap listeners', () => {
	    const harness = createHarness();
	    const refs = harness.createRefs();

	    harness.controller.registerListeners({ refs });
	    refs.voiceSelfReportEffortSelect.innerHTML = '<option value=""></option><option value="4">4</option>';
	    refs.voiceSelfReportStrainSelect.innerHTML = '<option value=""></option><option value="2">2</option>';
	    refs.voiceSelfReportFatigueSelect.innerHTML = '<option value=""></option><option value="4">4</option>';
	    refs.voiceSelfReportDifficultySelect.innerHTML = '<option value=""></option><option value="5">5</option>';
	    refs.voiceSelfReportConfidenceSelect.innerHTML = '<option value=""></option><option value="3">3</option>';
	    refs.voiceSelfReportEffortSelect.value = '4';
	    refs.voiceSelfReportEffortSelect.dispatchEvent(new Event('change'));
	    refs.voiceSelfReportStrainSelect.value = '2';
	    refs.voiceSelfReportStrainSelect.dispatchEvent(new Event('change'));
	    refs.voiceSelfReportFatigueSelect.value = '4';
	    refs.voiceSelfReportFatigueSelect.dispatchEvent(new Event('change'));
	    refs.voiceSelfReportDifficultySelect.value = '5';
	    refs.voiceSelfReportDifficultySelect.dispatchEvent(new Event('change'));
	    refs.voiceSelfReportConfidenceSelect.value = '3';
	    refs.voiceSelfReportConfidenceSelect.dispatchEvent(new Event('change'));

	    expect(harness.getVoiceUiState().selfReportDraft).toMatchObject({
	      effort: 4,
	      strain: 2,
	      fatigue: 4,
	      perceivedDifficulty: 5,
	      confidence: 3,
	    });
	    expect(harness.render).toHaveBeenCalledTimes(5);
	  });

  it('blocks direct line mutation while DeepTutor owns the guided drill', () => {
    const harness = createHarness();
    const refs = harness.createRefs();
    harness.hasActiveDeepTutorGuideSession.mockReturnValue(true);

    harness.controller.registerListeners({ refs });
    refs.voiceLineRegenerateBtn.click();

    expect(harness.refreshCockpitLine).not.toHaveBeenCalled();
    expect(harness.addTerminalLine).toHaveBeenCalledWith(
      'system',
      'DeepTutor owns guided line changes. Ask the coach instead of changing the line directly.',
    );
    expect(harness.render).toHaveBeenCalledTimes(1);
  });

  it('syncs input-device selection state and notice copy from the bootstrap listeners', () => {
    const harness = createHarness();
    const refs = harness.createRefs();

    harness.controller.registerListeners({ refs });
    refs.voiceInputDeviceSelect.value = 'usb';
    refs.voiceInputDeviceSelect.dispatchEvent(new Event('change'));

    expect(harness.getSelectedInputDeviceId()).toBe('usb');
    expect(harness.writeVoiceInputDevicePreference).toHaveBeenCalledWith('usb');
    expect(harness.getVoiceAudioInputNotice()).toBe('USB Mic will be used for the next take.');
    expect(harness.render).toHaveBeenCalledTimes(1);
  });

  it('does not double-trigger actions when listeners are registered more than once', () => {
    const harness = createHarness();
    const refs = harness.createRefs();

    harness.controller.registerListeners({ refs });
    harness.controller.registerListeners({ refs });

    refs.voiceForecastGenerateBtn.click();

    expect(harness.projectPhraseForecast).toHaveBeenCalledTimes(1);
  });

  it('reads conditioning draft fields from refs before saving', async () => {
    const harness = createHarness();
    const refs = harness.createRefs();

    harness.controller.registerListeners({ refs });
    refs.voiceConditioningUseProfileCheckbox.checked = true;
    refs.voiceConditioningStyleInput.value = '  brighter and lighter  ';
    refs.voiceConditioningPromptTextInput.value = '  keep the release soft  ';
    refs.voiceConditioningSaveBtn.click();
    await flushAsyncWork();

    expect(harness.updateVoiceConditioningState).toHaveBeenCalledWith({
      useTargetProfileStyle: true,
      styleInstruction: 'brighter and lighter',
      promptText: 'keep the release soft',
    });
    expect(harness.render).toHaveBeenCalledTimes(1);
  });

  it('persists VAD tuning changes through the bootstrap listeners', async () => {
    const harness = createHarness();
    const refs = harness.createRefs();

    harness.controller.registerListeners({ refs });
    refs.voiceVadRmsThresholdInput.value = '0.02';
    refs.voiceVadRmsThresholdInput.dispatchEvent(new Event('change'));
    await flushAsyncWork();

    expect(harness.updateVoiceAdvancedPanel).toHaveBeenCalledWith({ vadRmsThreshold: 0.02 });
    expect(harness.getVoiceUiState().advancedPanel.vadRmsThreshold).toBe(0.02);
    expect(harness.render).toHaveBeenCalledTimes(1);
  });

  it('keeps the pointer-up take flow from double-firing on the follow-up click event', async () => {
    const harness = createHarness({
      takeState: {
        sessionArmed: true,
        takeActive: false,
        takeProcessing: false,
        suppressPracticeClick: false,
      },
    });
    const refs = harness.createRefs();

    harness.controller.registerListeners({ refs });
    refs.voiceEndSessionBtn.dispatchEvent(new Event('pointerdown'));
    await flushAsyncWork();
    refs.voiceEndSessionBtn.dispatchEvent(new Event('pointerup'));
    await flushAsyncWork();
    refs.voiceEndSessionBtn.click();
    await flushAsyncWork();

    expect(harness.beginVoicePracticeTake).toHaveBeenCalledTimes(1);
    expect(harness.endVoicePracticeSession).toHaveBeenCalledTimes(1);
    expect(harness.getTakeState().suppressPracticeClick).toBe(false);
  });
});
