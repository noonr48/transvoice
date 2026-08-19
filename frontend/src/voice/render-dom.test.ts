import { describe, expect, it } from 'vitest';
import {
  applyVoiceRenderControlsDom,
  applyVoiceRenderSummaryDom,
} from './render-dom';

function createSummaryElements() {
  return {
    voiceSidebarPresetEl: document.createElement('div'),
    voiceServiceHealthEl: document.createElement('div'),
    voiceSessionStatusEl: document.createElement('div'),
    voiceStudentMasteryEl: document.createElement('div'),
    voiceStudentReviewCountEl: document.createElement('div'),
    voiceKnowledgeStatusEl: document.createElement('div'),
    voiceReferenceSummaryEl: document.createElement('div'),
    voiceTargetProfileSummaryEl: document.createElement('div'),
    voiceCurrentDrillEl: document.createElement('div'),
    voiceTargetProfileCopyEl: document.createElement('div'),
    voiceDrillCopyEl: document.createElement('div'),
    voiceSummaryOverviewEl: document.createElement('div'),
    voiceStudentConceptsEl: document.createElement('div'),
    voiceStudentFocusEl: document.createElement('div'),
    voiceLearnerContextStatusEl: document.createElement('div'),
    voiceLearnerContextDatasetEl: document.createElement('div'),
    voiceLearnerContextNotepadEl: document.createElement('div'),
    voiceLearnerContextInlineStatusEl: document.createElement('div'),
    voiceLearnerContextInlineDatasetEl: document.createElement('div'),
    voiceLearnerContextInlineNotepadEl: document.createElement('div'),
    voiceCoachCopyEl: document.createElement('div'),
    voiceCueSheetCopyEl: document.createElement('div'),
    voicePhraseComparisonCopyEl: document.createElement('div'),
    voiceForecastCopyEl: document.createElement('div'),
    voiceInputSelectedEl: document.createElement('div'),
    voiceInputLevelEl: document.createElement('div'),
    voiceInputSignalEl: document.createElement('div'),
    voiceInputReliabilityEl: document.createElement('div'),
    voiceInputCopyEl: document.createElement('div'),
    voiceInputRuntimeStatusEl: document.createElement('div'),
    voiceInputRuntimeProviderEl: document.createElement('div'),
    voiceInputRuntimeLatencyEl: document.createElement('div'),
    voiceInputRuntimeCountsEl: document.createElement('div'),
    voiceInputRuntimeCopyEl: document.createElement('div'),
    voiceInputRuntimePillsEl: document.createElement('div'),
    voiceGraphStatusEl: document.createElement('div'),
    voiceLiveCueEl: document.createElement('p'),
    voiceSessionSpineEl: document.createElement('nav'),
    voiceStreamUrlEl: document.createElement('div'),
    voiceStageSessionEl: document.createElement('div'),
    voiceStageTargetEl: document.createElement('div'),
    voiceStageReferenceEl: document.createElement('div'),
    voiceStageTargetVoiceEl: document.createElement('div'),
    voiceStageForecastEl: document.createElement('div'),
    voiceStageDrillEl: document.createElement('div'),
    voiceStageMatchEl: document.createElement('div'),
    voiceStageLaneEl: document.createElement('div'),
    voiceStageContourEl: document.createElement('div'),
    voiceStageZoneEl: document.createElement('div'),
    voiceReferencePlaybackCopyEl: document.createElement('div'),
    voiceReferencePlayerEl: document.createElement('audio'),
    voiceReferenceMimicMetaEl: document.createElement('div'),
    voiceActiveDrillTitleEl: document.createElement('div'),
    voiceActiveDrillCopyEl: document.createElement('div'),
    voiceActiveDrillStateEl: document.createElement('div'),
    voiceLabPanelEl: document.createElement('div'),
    voiceFrontDoorEl: document.createElement('section'),
    voiceFrontDoorInputEl: document.createElement('input'),
    voiceFrontDoorSkipEl: document.createElement('button'),
    voiceSpineHintEl: document.createElement('p'),
    voiceReviewPanelEl: document.createElement('section'),
    voiceReviewSummaryEl: document.createElement('p'),
    voiceReviewFocusEl: document.createElement('p'),
    voiceReviewListEl: document.createElement('div'),
    voiceReviewDueEl: document.createElement('p'),
    voiceGraphShellEl: document.createElement('div'),
    memoryStatsEl: document.createElement('div'),
    stageStatusEl: document.createElement('div'),
  };
}

function createControlsElements() {
  const voiceTargetPresetSelect = document.createElement('select');
  const presetOption = document.createElement('option');
  presetOption.value = 'cute-feminine';
  presetOption.textContent = 'Cute Feminine';
  voiceTargetPresetSelect.appendChild(presetOption);

  return {
    voiceTargetPresetSelect,
    voiceConditioningUseProfileCheckbox: document.createElement('input'),
    voiceConditioningStyleInput: document.createElement('input'),
    voiceConditioningPromptTextInput: document.createElement('textarea'),
	    voiceConditioningStatusEl: document.createElement('div'),
	    voiceForecastPhraseInput: document.createElement('input'),
	    voiceForecastGenerateBtn: document.createElement('button'),
	    voiceSelfReportEffortSelect: document.createElement('select'),
	    voiceSelfReportStrainSelect: document.createElement('select'),
	    voiceSelfReportFatigueSelect: document.createElement('select'),
	    voiceSelfReportDifficultySelect: document.createElement('select'),
	    voiceSelfReportConfidenceSelect: document.createElement('select'),
	    voiceSelfReportCopyEl: document.createElement('div'),
	    voiceStartSessionBtn: document.createElement('button'),
    voiceEndSessionBtn: document.createElement('button'),
    voiceLineRegenerateBtn: document.createElement('button'),
    voiceLineEasierBtn: document.createElement('button'),
    voiceLineHarderBtn: document.createElement('button'),
    voiceLineNextBtn: document.createElement('button'),
    voiceLinePinBtn: document.createElement('button'),
    voiceReferenceInput: document.createElement('input'),
    voiceDeepTutorStartBtn: document.createElement('button'),
    voiceDeepTutorNextBtn: document.createElement('button'),
    voiceAdvancedToggleBtn: document.createElement('button'),
    voiceAdvancedContentEl: document.createElement('div'),
    voiceLabPanel: document.createElement('div'),
    voiceCoachSendBtn: document.createElement('button'),
    voiceCoachLiveToggleBtn: document.createElement('button'),
    voiceCoachVoiceToggleBtn: document.createElement('button'),
    voiceCoachQuestionInput: document.createElement('input'),
    voiceCoachSpeechToggleBtn: document.createElement('button'),
    voiceCoachProviderToggleBtn: document.createElement('button'),
    voiceCoachInputProviderToggleBtn: document.createElement('button'),
    voiceConditioningSaveBtn: document.createElement('button'),
    voiceConditioningPromptUploadBtn: document.createElement('button'),
    voiceConditioningReferenceUploadBtn: document.createElement('button'),
    voiceInputDeviceSelect: document.createElement('select'),
  };
}

describe('voice render dom', () => {
  it('applies summary view-model state to the voice dom', () => {
    const elements = createSummaryElements();
    elements.voiceReferencePlayerEl.classList.add('hidden');
    for (const stage of ['warmup', 'target', 'practice', 'review']) {
      const step = document.createElement('span');
      step.className = 'voice-spine-step';
      step.dataset.stage = stage;
      elements.voiceSessionSpineEl.appendChild(step);
    }
    elements.voiceReviewPanelEl.classList.add('hidden');

    applyVoiceRenderSummaryDom(elements, {
      sidebarSummaryView: {
        sidebarPresetText: 'Preset A',
        serviceHealthText: 'Healthy',
        sessionStatusText: 'Connected',
        studentMasteryText: 'Mastery 70%',
        studentReviewCountText: '2 reviews',
        knowledgeStatusText: 'Ready',
        referenceSummaryText: 'Reference loaded',
        targetProfileSummaryText: 'Target profile',
        currentDrillText: 'Drill 1',
        targetProfileCopyText: 'Target voice copy',
        drillCopyText: 'Drill copy',
        summaryOverviewText: 'Overview',
        studentConceptsText: 'Concepts',
        studentFocusText: 'Focus',
        learnerContextStatusText: 'Learner ready',
        learnerContextDatasetText: 'Dataset ready',
        learnerContextNotepadText: 'Planner handoff',
        activeDrillTitleText: 'Active drill',
        reviewDueText: '2 focuses due for review today — pitch glide • resonance',
      },
      coachPanelCopyText: 'Coach copy',
      cueSheetCopyText: 'Cue sheet copy',
      phraseComparisonCopyText: 'Phrase comparison',
      forecastCopyText: 'Forecast copy',
      inputPanel: {
        selectedText: 'Mic 1',
        levelText: '-12 dB',
        signalText: 'Strong',
        reliabilityText: 'Stable',
        copyText: 'Input copy',
      },
      inputRuntimeView: {
        statusText: 'Listening',
        providerText: 'Browser',
        latencyText: '120 ms',
        countsText: '3 turns',
        copyText: 'Runtime copy',
        pills: ['browser', 'fast'],
        evidenceSummary: null,
      },
      stageView: {
        sessionStage: 'review',
        hasReference: true,
        frontDoorDismissed: false,
        liveCueText: 'Ready when you are — start a take to get live coaching.',
        spineHintText: 'Review your takes, then start the next line.',
        reviewSummaryText: '2 takes this session • best target hit 80%',
        reviewFocusText: 'Focus: pitch drift • Next: humming glide',
        reviewListItems: [
          { timeText: '10:30', durationText: '4s', metricText: 'hit 70% • sim 60%', attemptId: 'attempt-1', hasAudio: true },
          { timeText: '10:35', durationText: '5s', metricText: 'hit 80% • sim 65%', attemptId: 'attempt-2', hasAudio: false },
        ],
        graphAriaLabel: 'Voice trainer XY map: pitch on the vertical axis, resonance on the horizontal axis.',
        graphStatusText: 'Graph ready',
        streamUrlText: 'ws://stream',
        sessionText: 'session-1',
        targetText: 'Target',
        referenceText: 'Reference',
        targetVoiceText: 'Voice',
        forecastText: 'Forecast',
        drillText: 'Drill',
        matchText: 'Match',
        laneText: 'Lane',
        contourText: 'Contour',
        zoneText: 'Zone',
        shellMemoryStatsText: 'Memory',
        shellStageStatusText: 'Stage ready',
      },
      referenceView: {
        summaryText: 'unused',
        playbackCopyText: 'Playback copy',
        showPlayer: true,
        mimicPills: ['repeat', 'hold'],
      },
      activeDrillCopyText: 'Active drill copy',
      activeDrillStateText: 'Active state',
      isVoiceMode: true,
    });

    expect(elements.voiceSidebarPresetEl.textContent).toBe('Preset A');
    expect(elements.voiceCoachCopyEl.textContent).toBe('Coach copy');
    expect(elements.voiceLearnerContextStatusEl.textContent).toBe('Learner ready');
    expect(elements.voiceLearnerContextDatasetEl.textContent).toBe('Dataset ready');
    expect(elements.voiceLearnerContextNotepadEl.textContent).toBe('Planner handoff');
    expect(elements.voiceLearnerContextInlineStatusEl.textContent).toBe('Learner ready');
    expect(elements.voiceLearnerContextInlineDatasetEl.textContent).toBe('Dataset ready');
    expect(elements.voiceLearnerContextInlineNotepadEl.textContent).toBe('Planner handoff');
    expect(elements.voiceInputRuntimeStatusEl.textContent).toBe('Listening');
    expect(elements.voiceInputRuntimePillsEl.children).toHaveLength(2);
    expect(elements.voiceReferencePlayerEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceReferenceMimicMetaEl.children).toHaveLength(2);
    expect(elements.voiceGraphStatusEl.textContent).toBe('Graph ready');
    expect(elements.voiceActiveDrillCopyEl.textContent).toBe('Active drill copy');
    expect(elements.memoryStatsEl.textContent).toBe('Memory');
    expect(elements.stageStatusEl.textContent).toBe('Stage ready');
    // Front-door takeover: review stage with a reference loaded => door hidden, no takeover.
    expect(elements.voiceFrontDoorEl.classList.contains('hidden')).toBe(true);
    expect(elements.voiceLabPanelEl.classList.contains('vt-front-door-open')).toBe(false);
    // Real stepper: review is active with aria-current; earlier stages marked done.
    const steps = Array.from(
      elements.voiceSessionSpineEl.querySelectorAll<HTMLElement>('.voice-spine-step'),
    );
    const reviewStep = steps.find((step) => step.dataset.stage === 'review');
    const warmupStep = steps.find((step) => step.dataset.stage === 'warmup');
    expect(reviewStep?.classList.contains('active')).toBe(true);
    expect(reviewStep?.getAttribute('aria-current')).toBe('step');
    expect(warmupStep?.classList.contains('done')).toBe(true);
    expect(warmupStep?.getAttribute('aria-current')).toBeNull();
    expect(elements.voiceSpineHintEl.textContent).toBe('Review your takes, then start the next line.');
    // Review panel shown at review stage, populated from existing signals.
    expect(elements.voiceReviewPanelEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceReviewSummaryEl.textContent).toBe('2 takes this session • best target hit 80%');
    expect(elements.voiceReviewFocusEl.textContent).toBe('Focus: pitch drift • Next: humming glide');
    expect(elements.voiceReviewListEl.querySelectorAll('.voice-review-row')).toHaveLength(2);
    // Surfacing wave: per-row Listen markup (delegated click lives in the lesson controller).
    const listenButtons = elements.voiceReviewListEl.querySelectorAll<HTMLButtonElement>('.voice-review-row-listen');
    expect(listenButtons).toHaveLength(2);
    expect(listenButtons[0].dataset.attemptId).toBe('attempt-1');
    expect(listenButtons[0].disabled).toBe(false);
    expect(listenButtons[1].dataset.attemptId).toBe('attempt-2');
    expect(listenButtons[1].disabled).toBe(true);
    expect(listenButtons[1].title).toBe('no audio kept for this take');
    // Surfacing wave: the due-for-review line is visible with the computed text.
    expect(elements.voiceReviewDueEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceReviewDueEl.textContent).toBe('2 focuses due for review today — pitch glide • resonance');
    expect(elements.voiceGraphShellEl.getAttribute('aria-label')).toContain('XY map');
  });

  it('shows the front-door takeover at warmup and hides the review panel', () => {
    const elements = createSummaryElements();
    for (const stage of ['warmup', 'target', 'practice', 'review']) {
      const step = document.createElement('span');
      step.className = 'voice-spine-step';
      step.dataset.stage = stage;
      elements.voiceSessionSpineEl.appendChild(step);
    }

    applyVoiceRenderSummaryDom(elements, {
      sidebarSummaryView: {
        sidebarPresetText: '', serviceHealthText: '', sessionStatusText: '', studentMasteryText: '',
        studentReviewCountText: '', knowledgeStatusText: '', referenceSummaryText: '',
        targetProfileSummaryText: '', currentDrillText: '', targetProfileCopyText: '', drillCopyText: '',
        summaryOverviewText: '', studentConceptsText: '', studentFocusText: '', learnerContextStatusText: '',
        learnerContextDatasetText: '', learnerContextNotepadText: '', activeDrillTitleText: '',
        reviewDueText: null,
      },
      coachPanelCopyText: '', cueSheetCopyText: '', phraseComparisonCopyText: '', forecastCopyText: '',
      inputPanel: { selectedText: '', levelText: '', signalText: '', reliabilityText: '', copyText: '' },
      inputRuntimeView: {
        statusText: '', providerText: '', latencyText: '', countsText: '', copyText: '',
        pills: [], evidenceSummary: null,
      },
      stageView: {
        sessionStage: 'warmup',
        hasReference: false,
        frontDoorDismissed: false,
        liveCueText: 'Ready when you are — start a take to get live coaching.',
        spineHintText: 'Upload the voice you want to move toward.',
        reviewSummaryText: 'No takes this session yet.',
        reviewFocusText: 'Keep practicing to build a focus summary.',
        reviewListItems: [],
        graphAriaLabel: 'Voice trainer XY map: pitch on the vertical axis, resonance on the horizontal axis.',
        graphStatusText: '', streamUrlText: '', sessionText: '', targetText: '', referenceText: '',
        targetVoiceText: '', forecastText: '', drillText: '', matchText: '', laneText: '',
        contourText: '', zoneText: '', shellMemoryStatsText: '', shellStageStatusText: '',
      },
      referenceView: { summaryText: '', playbackCopyText: '', showPlayer: false, mimicPills: [] },
      activeDrillCopyText: '', activeDrillStateText: '', isVoiceMode: true,
    });

    expect(elements.voiceFrontDoorEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceLabPanelEl.classList.contains('vt-front-door-open')).toBe(true);
    expect(elements.voiceReviewPanelEl.classList.contains('hidden')).toBe(true);
    expect(elements.voiceReviewListEl.querySelector('.voice-phrase-empty')?.textContent)
      .toBe('Finish a take to see your session takes here.');
  });

  it('keeps the front-door dismissed when frontDoorDismissed is set', () => {
    const elements = createSummaryElements();
    applyVoiceRenderSummaryDom(elements, {
      sidebarSummaryView: {
        sidebarPresetText: '', serviceHealthText: '', sessionStatusText: '', studentMasteryText: '',
        studentReviewCountText: '', knowledgeStatusText: '', referenceSummaryText: '',
        targetProfileSummaryText: '', currentDrillText: '', targetProfileCopyText: '', drillCopyText: '',
        summaryOverviewText: '', studentConceptsText: '', studentFocusText: '', learnerContextStatusText: '',
        learnerContextDatasetText: '', learnerContextNotepadText: '', activeDrillTitleText: '',
        reviewDueText: null,
      },
      coachPanelCopyText: '', cueSheetCopyText: '', phraseComparisonCopyText: '', forecastCopyText: '',
      inputPanel: { selectedText: '', levelText: '', signalText: '', reliabilityText: '', copyText: '' },
      inputRuntimeView: {
        statusText: '', providerText: '', latencyText: '', countsText: '', copyText: '',
        pills: [], evidenceSummary: null,
      },
      stageView: {
        sessionStage: 'warmup',
        hasReference: false,
        frontDoorDismissed: true,
        liveCueText: 'Ready when you are — start a take to get live coaching.',
        spineHintText: 'Upload the voice you want to move toward.',
        reviewSummaryText: '', reviewFocusText: '', reviewListItems: [],
        graphAriaLabel: 'Voice trainer XY map.',
        graphStatusText: '', streamUrlText: '', sessionText: '', targetText: '', referenceText: '',
        targetVoiceText: '', forecastText: '', drillText: '', matchText: '', laneText: '',
        contourText: '', zoneText: '', shellMemoryStatsText: '', shellStageStatusText: '',
      },
      referenceView: { summaryText: '', playbackCopyText: '', showPlayer: false, mimicPills: [] },
      activeDrillCopyText: '', activeDrillStateText: '', isVoiceMode: true,
    });

    expect(elements.voiceFrontDoorEl.classList.contains('hidden')).toBe(true);
    expect(elements.voiceLabPanelEl.classList.contains('vt-front-door-open')).toBe(false);
  });

  it('applies control view-model state to the voice dom', () => {
    const elements = createControlsElements();

    applyVoiceRenderControlsDom(elements, {
      panelControls: {
        targetPresetValue: 'cute-feminine',
        targetPresetDisabled: true,
        conditioningUseProfileChecked: true,
        conditioningStyleValue: 'soft',
        conditioningPromptValue: 'prompt text',
        conditioningStatusText: 'Conditioned',
        forecastPhraseValue: 'hello',
	        forecastPhraseDisabled: true,
	        forecastGenerateText: 'Forecasting...',
	        forecastGenerateDisabled: true,
	        selfReportEffortValue: '2',
	        selfReportStrainValue: '1',
	        selfReportFatigueValue: '5',
	        selfReportDifficultyValue: '3',
	        selfReportConfidenceValue: '4',
	        selfReportDisabled: true,
	        selfReportCopyText: 'Will log with the next take.',
	        startSessionText: 'Arm Practice',
        startSessionDisabled: false,
        endSessionText: 'Take',
        endSessionDisabled: true,
        lineRegenerateDisabled: true,
        lineEasierDisabled: false,
        lineHarderDisabled: true,
        lineNextDisabled: false,
        linePinDisabled: true,
        referenceInputDisabled: false,
        deepTutorStartDisabled: false,
        deepTutorNextDisabled: true,
        deepTutorStartTitle: 'Ready',
        deepTutorNextTitle: 'Need guide',
        advancedToggleText: 'Advanced: On',
        advancedExpanded: true,
        showAdvancedContent: true,
        useAdvancedLabPanelClass: true,
        coachSendDisabled: true,
        conditioningSaveDisabled: true,
        conditioningPromptUploadDisabled: false,
        conditioningReferenceUploadDisabled: true,
        inputDeviceDisabled: true,
      },
      coachControls: {
        handsFreeToggle: {
          text: 'Hands-Free: On',
          disabled: false,
          title: 'ready',
        },
        voiceAskToggle: {
          text: 'Talk to Coach',
          disabled: true,
        },
        questionPlaceholder: 'Ask the coach',
        speechToggle: {
          text: 'Coach Voice: On',
          disabled: false,
        },
        speechProviderToggle: {
          text: 'Speech: Browser',
          disabled: true,
          title: 'fallback',
        },
        inputProviderToggle: {
          text: 'Input: Backend',
          disabled: false,
          title: 'live',
        },
      },
    });

    expect(elements.voiceTargetPresetSelect.value).toBe('cute-feminine');
    expect(elements.voiceTargetPresetSelect.disabled).toBe(true);
    expect(elements.voiceConditioningUseProfileCheckbox.checked).toBe(true);
    expect(elements.voiceConditioningStyleInput.value).toBe('soft');
	    expect(elements.voiceConditioningPromptTextInput.value).toBe('prompt text');
	    expect(elements.voiceSelfReportCopyEl.textContent).toBe('Will log with the next take.');
	    expect(elements.voiceSelfReportEffortSelect.disabled).toBe(true);
	    expect(elements.voiceSelfReportFatigueSelect.disabled).toBe(true);
	    expect(elements.voiceAdvancedToggleBtn.getAttribute('aria-expanded')).toBe('true');
    expect(elements.voiceAdvancedContentEl.classList.contains('hidden')).toBe(false);
    expect(elements.voiceLabPanel.classList.contains('voice-lab-panel-advanced')).toBe(true);
    expect(elements.voiceCoachLiveToggleBtn.textContent).toBe('Hands-Free: On');
    expect(elements.voiceCoachVoiceToggleBtn.disabled).toBe(true);
    expect(elements.voiceCoachQuestionInput.placeholder).toBe('Ask the coach');
    expect(elements.voiceCoachProviderToggleBtn?.title).toBe('fallback');
    expect(elements.voiceCoachInputProviderToggleBtn?.textContent).toBe('Input: Backend');
    expect(elements.voiceDeepTutorStartBtn.title).toBe('Ready');
    expect(elements.voiceDeepTutorNextBtn.title).toBe('Need guide');
    expect(elements.voiceConditioningSaveBtn?.disabled).toBe(true);
    expect(elements.voiceConditioningReferenceUploadBtn?.disabled).toBe(true);
    expect(elements.voiceInputDeviceSelect.disabled).toBe(true);
  });
});
