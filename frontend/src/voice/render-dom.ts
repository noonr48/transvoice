import type {
  VoiceCoachControlsViewModel,
  VoiceInputPanelViewModel,
  VoiceInputRuntimeViewModel,
  VoicePanelControlsViewModel,
  VoiceReferenceViewModel,
  VoiceSidebarSummaryViewModel,
  VoiceStageViewModel,
} from './view-model';
import { updateVoiceFrontDoorVisibility } from './front-door';
import type { VoiceSessionStage } from './session-reentry';

const VOICE_SESSION_STAGE_ORDER: VoiceSessionStage[] = ['warmup', 'target', 'practice', 'review'];

function replacePills(container: HTMLElement, pills: string[]): void {
  container.replaceChildren();
  for (const pillText of pills) {
    const pillEl = document.createElement('span');
    pillEl.className = 'voice-pill';
    pillEl.textContent = pillText;
    container.appendChild(pillEl);
  }
}

function replaceReviewList(
  container: HTMLElement,
  items: {
    timeText: string;
    durationText: string;
    metricText: string;
    attemptId: string | null;
    hasAudio: boolean;
  }[],
): void {
  container.replaceChildren();
  if (items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'voice-phrase-empty';
    empty.textContent = 'Finish a take to see your session takes here.';
    container.appendChild(empty);
    return;
  }
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'voice-review-row';

    const timeEl = document.createElement('span');
    timeEl.className = 'voice-review-row-time';
    timeEl.textContent = item.timeText;

    const durationEl = document.createElement('span');
    durationEl.className = 'voice-review-row-duration';
    durationEl.textContent = item.durationText;

    const metricEl = document.createElement('span');
    metricEl.className = 'voice-review-row-metric';
    metricEl.textContent = item.metricText;

    row.append(timeEl, durationEl, metricEl);

    // Surfacing wave: a quiet per-row Listen. Markup only — the click is handled
    // by ONE delegated listener the lesson controller owns (rows are rebuilt
    // every render, so per-row listeners would need constant rebinding). No
    // attempt id -> no button; audio explicitly not kept -> disabled + title.
    if (item.attemptId) {
      const listenBtn = document.createElement('button');
      listenBtn.type = 'button';
      listenBtn.className = 'voice-review-row-listen';
      listenBtn.textContent = 'Listen';
      listenBtn.dataset.attemptId = item.attemptId;
      if (!item.hasAudio) {
        listenBtn.disabled = true;
        listenBtn.title = 'no audio kept for this take';
      }
      row.appendChild(listenBtn);
    }

    container.appendChild(row);
  }
}

// Surfacing wave witness: log the due-line transition once per show/hide flip,
// not per render frame (render-dom runs every frame and has no log sink of its
// own; console is the same channel render-controller already uses).
let lastReviewDueShown = false;

export type VoiceRenderSummaryDomElements = {
  voiceSidebarPresetEl: HTMLElement;
  voiceServiceHealthEl: HTMLElement;
  voiceSessionStatusEl: HTMLElement;
  voiceStudentMasteryEl: HTMLElement;
  voiceStudentReviewCountEl: HTMLElement;
  voiceKnowledgeStatusEl: HTMLElement;
  voiceReferenceSummaryEl: HTMLElement;
  voiceTargetProfileSummaryEl: HTMLElement;
  voiceCurrentDrillEl: HTMLElement;
  voiceTargetProfileCopyEl: HTMLElement;
  voiceDrillCopyEl: HTMLElement;
  voiceSummaryOverviewEl: HTMLElement;
  voiceStudentConceptsEl: HTMLElement;
  voiceStudentFocusEl: HTMLElement;
  voiceLearnerContextStatusEl: HTMLElement;
  voiceLearnerContextDatasetEl: HTMLElement;
  voiceLearnerContextNotepadEl: HTMLElement;
  voiceLearnerContextInlineStatusEl: HTMLElement | null;
  voiceLearnerContextInlineDatasetEl: HTMLElement | null;
  voiceLearnerContextInlineNotepadEl: HTMLElement | null;
  voiceCoachCopyEl: HTMLElement;
  voiceCueSheetCopyEl: HTMLElement;
  voicePhraseComparisonCopyEl: HTMLElement;
  voiceForecastCopyEl: HTMLElement;
  voiceInputSelectedEl: HTMLElement;
  voiceInputLevelEl: HTMLElement;
  voiceInputSignalEl: HTMLElement;
  voiceInputReliabilityEl: HTMLElement;
  voiceInputCopyEl: HTMLElement;
  voiceInputRuntimeStatusEl: HTMLElement;
  voiceInputRuntimeProviderEl: HTMLElement;
  voiceInputRuntimeLatencyEl: HTMLElement;
  voiceInputRuntimeCountsEl: HTMLElement;
  voiceInputRuntimeCopyEl: HTMLElement;
  voiceInputRuntimePillsEl: HTMLElement;
  voiceGraphStatusEl: HTMLElement;
  voiceLiveCueEl: HTMLElement;
  voiceSessionSpineEl: HTMLElement;
  voiceStreamUrlEl: HTMLElement | null;
  voiceStageSessionEl: HTMLElement;
  voiceStageTargetEl: HTMLElement;
  voiceStageReferenceEl: HTMLElement;
  voiceStageTargetVoiceEl: HTMLElement;
  voiceStageForecastEl: HTMLElement;
  voiceStageDrillEl: HTMLElement;
  voiceStageMatchEl: HTMLElement;
  voiceStageLaneEl: HTMLElement;
  voiceStageContourEl: HTMLElement;
  voiceStageZoneEl: HTMLElement;
  voiceReferencePlaybackCopyEl: HTMLElement;
  voiceReferencePlayerEl: HTMLAudioElement | null;
  voiceReferenceMimicMetaEl: HTMLElement;
  voiceActiveDrillTitleEl: HTMLElement;
  voiceActiveDrillCopyEl: HTMLElement;
  voiceActiveDrillStateEl: HTMLElement;
  // Redesign: front-door takeover + Review-stage panel + spine hint + XY-map a11y.
  voiceLabPanelEl: HTMLElement;
  voiceFrontDoorEl: HTMLElement | null;
  voiceFrontDoorInputEl: HTMLInputElement | null;
  voiceFrontDoorSkipEl: HTMLButtonElement | null;
  voiceSpineHintEl: HTMLElement | null;
  voiceReviewPanelEl: HTMLElement | null;
  voiceReviewSummaryEl: HTMLElement | null;
  voiceReviewFocusEl: HTMLElement | null;
  voiceReviewListEl: HTMLElement | null;
  /** Surfacing wave: calm "due for review" line inside the visible Review panel. */
  voiceReviewDueEl?: HTMLElement | null;
  voiceGraphShellEl: HTMLElement | null;
  memoryStatsEl: HTMLElement | null;
  stageStatusEl: HTMLElement | null;
};

export type VoiceRenderSummaryDomState = {
  sidebarSummaryView: VoiceSidebarSummaryViewModel;
  coachPanelCopyText: string;
  cueSheetCopyText: string;
  phraseComparisonCopyText: string;
  forecastCopyText: string;
  inputPanel: VoiceInputPanelViewModel;
  inputRuntimeView: VoiceInputRuntimeViewModel;
  stageView: VoiceStageViewModel;
  referenceView: VoiceReferenceViewModel;
  activeDrillCopyText: string;
  activeDrillStateText: string;
  isVoiceMode: boolean;
};

export function applyVoiceRenderSummaryDom(
  elements: VoiceRenderSummaryDomElements,
  state: VoiceRenderSummaryDomState,
): void {
  elements.voiceSidebarPresetEl.textContent = state.sidebarSummaryView.sidebarPresetText;
  elements.voiceServiceHealthEl.textContent = state.sidebarSummaryView.serviceHealthText;
  elements.voiceSessionStatusEl.textContent = state.sidebarSummaryView.sessionStatusText;
  elements.voiceStudentMasteryEl.textContent = state.sidebarSummaryView.studentMasteryText;
  elements.voiceStudentReviewCountEl.textContent = state.sidebarSummaryView.studentReviewCountText;
  elements.voiceKnowledgeStatusEl.textContent = state.sidebarSummaryView.knowledgeStatusText;
  elements.voiceReferenceSummaryEl.textContent = state.sidebarSummaryView.referenceSummaryText;
  elements.voiceTargetProfileSummaryEl.textContent = state.sidebarSummaryView.targetProfileSummaryText;
  elements.voiceCurrentDrillEl.textContent = state.sidebarSummaryView.currentDrillText;
  elements.voiceTargetProfileCopyEl.textContent = state.sidebarSummaryView.targetProfileCopyText;
  elements.voiceDrillCopyEl.textContent = state.sidebarSummaryView.drillCopyText;
  elements.voiceSummaryOverviewEl.textContent = state.sidebarSummaryView.summaryOverviewText;
  elements.voiceStudentConceptsEl.textContent = state.sidebarSummaryView.studentConceptsText;
  elements.voiceStudentFocusEl.textContent = state.sidebarSummaryView.studentFocusText;
  elements.voiceLearnerContextStatusEl.textContent = state.sidebarSummaryView.learnerContextStatusText;
  elements.voiceLearnerContextDatasetEl.textContent = state.sidebarSummaryView.learnerContextDatasetText;
  elements.voiceLearnerContextNotepadEl.textContent = state.sidebarSummaryView.learnerContextNotepadText;
  if (elements.voiceLearnerContextInlineStatusEl) {
    elements.voiceLearnerContextInlineStatusEl.textContent = state.sidebarSummaryView.learnerContextStatusText;
  }
  if (elements.voiceLearnerContextInlineDatasetEl) {
    elements.voiceLearnerContextInlineDatasetEl.textContent = state.sidebarSummaryView.learnerContextDatasetText;
  }
  if (elements.voiceLearnerContextInlineNotepadEl) {
    elements.voiceLearnerContextInlineNotepadEl.textContent = state.sidebarSummaryView.learnerContextNotepadText;
  }
  elements.voiceActiveDrillTitleEl.textContent = state.sidebarSummaryView.activeDrillTitleText;

  elements.voiceCoachCopyEl.textContent = state.coachPanelCopyText;
  elements.voiceCueSheetCopyEl.textContent = state.cueSheetCopyText;
  elements.voicePhraseComparisonCopyEl.textContent = state.phraseComparisonCopyText;
  elements.voiceForecastCopyEl.textContent = state.forecastCopyText;
  elements.voiceInputSelectedEl.textContent = state.inputPanel.selectedText;
  elements.voiceInputLevelEl.textContent = state.inputPanel.levelText;
  elements.voiceInputSignalEl.textContent = state.inputPanel.signalText;
  elements.voiceInputReliabilityEl.textContent = state.inputPanel.reliabilityText;
  elements.voiceInputCopyEl.textContent = state.inputPanel.copyText;
  elements.voiceInputRuntimeStatusEl.textContent = state.inputRuntimeView.statusText;
  elements.voiceInputRuntimeProviderEl.textContent = state.inputRuntimeView.providerText;
  elements.voiceInputRuntimeLatencyEl.textContent = state.inputRuntimeView.latencyText;
  elements.voiceInputRuntimeCountsEl.textContent = state.inputRuntimeView.countsText;
  elements.voiceInputRuntimeCopyEl.textContent = state.inputRuntimeView.copyText;
  replacePills(elements.voiceInputRuntimePillsEl, state.inputRuntimeView.pills);

  elements.voiceGraphStatusEl.textContent = state.stageView.graphStatusText;
  elements.voiceLiveCueEl.textContent = state.stageView.liveCueText;

  // Front-door takeover: visibility flows through the main render every frame so it can
  // never read as a floating peer card. updateVoiceFrontDoorVisibility owns the rule
  // (warmup, or target without a reference, unless durably dismissed); the same decision
  // drives the `.vt-front-door-open` class on the lab panel, which the CSS uses to hide
  // ALL practice content while the door is up.
  const showFrontDoor = updateVoiceFrontDoorVisibility(
    {
      voiceFrontDoorEl: elements.voiceFrontDoorEl,
      voiceFrontDoorInputEl: elements.voiceFrontDoorInputEl,
      voiceFrontDoorSkipEl: elements.voiceFrontDoorSkipEl,
    },
    state.stageView.sessionStage,
    state.stageView.hasReference,
    state.stageView.frontDoorDismissed,
  );
  elements.voiceLabPanelEl.classList.toggle('vt-front-door-open', showFrontDoor);

  // Real 4-step stepper: current stage = `active` + aria-current; prior stages = `done`.
  const activeStageIndex = VOICE_SESSION_STAGE_ORDER.indexOf(state.stageView.sessionStage);
  for (const step of Array.from(
    elements.voiceSessionSpineEl.querySelectorAll<HTMLElement>('.voice-spine-step'),
  )) {
    const isActive = step.dataset.stage === state.stageView.sessionStage;
    const stepIndex = VOICE_SESSION_STAGE_ORDER.indexOf((step.dataset.stage ?? '') as VoiceSessionStage);
    const isDone = activeStageIndex >= 0 && stepIndex >= 0 && stepIndex < activeStageIndex;
    step.classList.toggle('active', isActive);
    step.classList.toggle('done', isDone);
    if (isActive) {
      step.setAttribute('aria-current', 'step');
    } else {
      step.removeAttribute('aria-current');
    }
  }
  if (elements.voiceSpineHintEl) {
    elements.voiceSpineHintEl.textContent = state.stageView.spineHintText;
  }

  // Stream URL chip removed from the surface — null-guard the (now optional) binding.
  if (elements.voiceStreamUrlEl) {
    elements.voiceStreamUrlEl.textContent = state.stageView.streamUrlText;
  }
  elements.voiceStageSessionEl.textContent = state.stageView.sessionText;
  elements.voiceStageTargetEl.textContent = state.stageView.targetText;
  elements.voiceStageReferenceEl.textContent = state.stageView.referenceText;
  elements.voiceStageTargetVoiceEl.textContent = state.stageView.targetVoiceText;
  elements.voiceStageForecastEl.textContent = state.stageView.forecastText;
  elements.voiceStageDrillEl.textContent = state.stageView.drillText;
  elements.voiceStageMatchEl.textContent = state.stageView.matchText;
  elements.voiceStageLaneEl.textContent = state.stageView.laneText;
  elements.voiceStageContourEl.textContent = state.stageView.contourText;
  elements.voiceStageZoneEl.textContent = state.stageView.zoneText;

  elements.voiceReferencePlaybackCopyEl.textContent = state.referenceView.playbackCopyText;
  elements.voiceReferencePlayerEl?.classList.toggle('hidden', !state.referenceView.showPlayer);
  replacePills(elements.voiceReferenceMimicMetaEl, state.referenceView.mimicPills);

  elements.voiceActiveDrillCopyEl.textContent = state.activeDrillCopyText;
  elements.voiceActiveDrillStateEl.textContent = state.activeDrillStateText;

  // Review-stage panel: a stage-GATED disclosure shown only at `review`, built strictly
  // on existing per-session signals (attemptArtifacts + lastSummary).
  const showReviewPanel = state.stageView.sessionStage === 'review';
  elements.voiceReviewPanelEl?.classList.toggle('hidden', !showReviewPanel);
  if (elements.voiceReviewSummaryEl) {
    elements.voiceReviewSummaryEl.textContent = state.stageView.reviewSummaryText;
  }
  if (elements.voiceReviewFocusEl) {
    elements.voiceReviewFocusEl.textContent = state.stageView.reviewFocusText;
  }
  if (elements.voiceReviewListEl) {
    replaceReviewList(elements.voiceReviewListEl, state.stageView.reviewListItems);
  }
  // Surfacing wave: the due-for-review line is part of the visible Review panel.
  // Shown only when the view-model computed a non-null line (>0 due).
  if (elements.voiceReviewDueEl) {
    const dueText = state.sidebarSummaryView.reviewDueText;
    elements.voiceReviewDueEl.textContent = dueText ?? '';
    elements.voiceReviewDueEl.classList.toggle('hidden', !dueText);
    const dueShown = Boolean(dueText);
    if (dueShown !== lastReviewDueShown) {
      lastReviewDueShown = dueShown;
      console.info(dueShown ? '[voice-surface] due-now shown' : '[voice-surface] due-now hidden');
    }
  }

  // XY-map a11y: keep the live aria-label in sync with the latest take metrics.
  if (elements.voiceGraphShellEl) {
    elements.voiceGraphShellEl.setAttribute('aria-label', state.stageView.graphAriaLabel);
  }

  if (state.isVoiceMode) {
    if (elements.memoryStatsEl) {
      elements.memoryStatsEl.textContent = state.stageView.shellMemoryStatsText;
    }
    if (elements.stageStatusEl) {
      elements.stageStatusEl.textContent = state.stageView.shellStageStatusText;
    }
  }
}

export type VoiceRenderControlsDomElements = {
  voiceTargetPresetSelect: HTMLSelectElement;
  voiceCustomPresetNameInput: HTMLInputElement | null;
  voiceCustomPresetBasePresetSelect: HTMLSelectElement | null;
  voiceCustomPresetPitchFloorInput: HTMLInputElement | null;
  voiceCustomPresetPitchCeilingInput: HTMLInputElement | null;
  voiceCustomPresetResonanceFloorInput: HTMLInputElement | null;
  voiceCustomPresetResonanceCeilingInput: HTMLInputElement | null;
  voiceCustomPresetWeightFloorInput: HTMLInputElement | null;
  voiceCustomPresetWeightCeilingInput: HTMLInputElement | null;
  voiceCustomPresetStylePromptInput: HTMLInputElement | null;
  voiceCustomPresetNotesInput: HTMLTextAreaElement | null;
  voiceSaveReferencePresetBtn: HTMLButtonElement | null;
  voiceRemoveReferenceBtn: HTMLButtonElement | null;
  voiceSeedCustomPresetBtn: HTMLButtonElement | null;
  voiceSaveHandmadePresetBtn: HTMLButtonElement | null;
  voiceConditioningUseProfileCheckbox: HTMLInputElement | null;
  voiceConditioningStyleInput: HTMLInputElement | null;
  voiceConditioningPromptTextInput: HTMLInputElement | HTMLTextAreaElement | null;
  voiceConditioningStatusEl: HTMLElement | null;
  voiceForecastPhraseInput: HTMLInputElement;
  voiceForecastGenerateBtn: HTMLButtonElement;
  voiceSelfReportEffortSelect: HTMLSelectElement;
  voiceSelfReportStrainSelect: HTMLSelectElement;
  voiceSelfReportFatigueSelect: HTMLSelectElement;
  voiceSelfReportDifficultySelect: HTMLSelectElement;
  voiceSelfReportConfidenceSelect: HTMLSelectElement;
  voiceSelfReportCopyEl: HTMLElement;
  voiceStartSessionBtn: HTMLButtonElement;
  voiceEndSessionBtn: HTMLButtonElement;
  voiceLineRegenerateBtn: HTMLButtonElement;
  voiceLineEasierBtn: HTMLButtonElement;
  voiceLineHarderBtn: HTMLButtonElement;
  voiceLineNextBtn: HTMLButtonElement;
  voiceLinePinBtn: HTMLButtonElement;
  voiceReferenceInput: HTMLInputElement;
  voiceDeepTutorStartBtn: HTMLButtonElement;
  voiceDeepTutorNextBtn: HTMLButtonElement;
  voiceAdvancedToggleBtn: HTMLButtonElement;
  voiceAdvancedContentEl: HTMLElement;
  voiceLabPanel: HTMLElement;
  voiceCoachSendBtn: HTMLButtonElement | null;
  voiceCoachLiveToggleBtn: HTMLButtonElement;
  voiceCoachVoiceToggleBtn: HTMLButtonElement;
  voiceCoachQuestionInput: HTMLInputElement | null;
  voiceCoachSpeechToggleBtn: HTMLButtonElement;
  voiceCoachProviderToggleBtn: HTMLButtonElement | null;
  voiceCoachInputProviderToggleBtn: HTMLButtonElement | null;
  voiceConditioningSaveBtn: HTMLButtonElement | null;
  voiceConditioningPromptUploadBtn: HTMLButtonElement | null;
  voiceConditioningReferenceUploadBtn: HTMLButtonElement | null;
  voiceInputDeviceSelect: HTMLSelectElement;
};

export type VoiceRenderControlsDomState = {
  panelControls: VoicePanelControlsViewModel;
  coachControls: VoiceCoachControlsViewModel;
};

export function applyVoiceRenderControlsDom(
  elements: VoiceRenderControlsDomElements,
  state: VoiceRenderControlsDomState,
): void {
  elements.voiceTargetPresetSelect.value = state.panelControls.targetPresetValue;
  elements.voiceTargetPresetSelect.disabled = state.panelControls.targetPresetDisabled;
  if (
    elements.voiceCustomPresetNameInput
    && elements.voiceCustomPresetNameInput.value !== state.panelControls.customPresetNameValue
  ) {
    elements.voiceCustomPresetNameInput.value = state.panelControls.customPresetNameValue;
  }
  if (elements.voiceCustomPresetNameInput) {
    elements.voiceCustomPresetNameInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (elements.voiceCustomPresetBasePresetSelect) {
    elements.voiceCustomPresetBasePresetSelect.value = state.panelControls.customPresetBasePresetValue;
    elements.voiceCustomPresetBasePresetSelect.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetPitchFloorInput
    && elements.voiceCustomPresetPitchFloorInput.value !== state.panelControls.customPresetPitchFloorValue
  ) {
    elements.voiceCustomPresetPitchFloorInput.value = state.panelControls.customPresetPitchFloorValue;
  }
  if (elements.voiceCustomPresetPitchFloorInput) {
    elements.voiceCustomPresetPitchFloorInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetPitchCeilingInput
    && elements.voiceCustomPresetPitchCeilingInput.value !== state.panelControls.customPresetPitchCeilingValue
  ) {
    elements.voiceCustomPresetPitchCeilingInput.value = state.panelControls.customPresetPitchCeilingValue;
  }
  if (elements.voiceCustomPresetPitchCeilingInput) {
    elements.voiceCustomPresetPitchCeilingInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetResonanceFloorInput
    && elements.voiceCustomPresetResonanceFloorInput.value !== state.panelControls.customPresetResonanceFloorValue
  ) {
    elements.voiceCustomPresetResonanceFloorInput.value = state.panelControls.customPresetResonanceFloorValue;
  }
  if (elements.voiceCustomPresetResonanceFloorInput) {
    elements.voiceCustomPresetResonanceFloorInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetResonanceCeilingInput
    && elements.voiceCustomPresetResonanceCeilingInput.value !== state.panelControls.customPresetResonanceCeilingValue
  ) {
    elements.voiceCustomPresetResonanceCeilingInput.value = state.panelControls.customPresetResonanceCeilingValue;
  }
  if (elements.voiceCustomPresetResonanceCeilingInput) {
    elements.voiceCustomPresetResonanceCeilingInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetWeightFloorInput
    && elements.voiceCustomPresetWeightFloorInput.value !== state.panelControls.customPresetWeightFloorValue
  ) {
    elements.voiceCustomPresetWeightFloorInput.value = state.panelControls.customPresetWeightFloorValue;
  }
  if (elements.voiceCustomPresetWeightFloorInput) {
    elements.voiceCustomPresetWeightFloorInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetWeightCeilingInput
    && elements.voiceCustomPresetWeightCeilingInput.value !== state.panelControls.customPresetWeightCeilingValue
  ) {
    elements.voiceCustomPresetWeightCeilingInput.value = state.panelControls.customPresetWeightCeilingValue;
  }
  if (elements.voiceCustomPresetWeightCeilingInput) {
    elements.voiceCustomPresetWeightCeilingInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetStylePromptInput
    && elements.voiceCustomPresetStylePromptInput.value !== state.panelControls.customPresetStylePromptValue
  ) {
    elements.voiceCustomPresetStylePromptInput.value = state.panelControls.customPresetStylePromptValue;
  }
  if (elements.voiceCustomPresetStylePromptInput) {
    elements.voiceCustomPresetStylePromptInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (
    elements.voiceCustomPresetNotesInput
    && elements.voiceCustomPresetNotesInput.value !== state.panelControls.customPresetNotesValue
  ) {
    elements.voiceCustomPresetNotesInput.value = state.panelControls.customPresetNotesValue;
  }
  if (elements.voiceCustomPresetNotesInput) {
    elements.voiceCustomPresetNotesInput.disabled = state.panelControls.customPresetWorkspaceDisabled;
  }
  if (elements.voiceSaveReferencePresetBtn) {
    elements.voiceSaveReferencePresetBtn.disabled = state.panelControls.saveReferencePresetDisabled;
  }
  if (elements.voiceRemoveReferenceBtn) {
    elements.voiceRemoveReferenceBtn.disabled = state.panelControls.removeReferenceDisabled;
  }
  if (elements.voiceSeedCustomPresetBtn) {
    elements.voiceSeedCustomPresetBtn.disabled = state.panelControls.seedCustomPresetDisabled;
  }
  if (elements.voiceSaveHandmadePresetBtn) {
    elements.voiceSaveHandmadePresetBtn.disabled = state.panelControls.saveHandmadePresetDisabled;
    elements.voiceSaveHandmadePresetBtn.textContent = state.panelControls.saveHandmadePresetText;
  }

  if (elements.voiceConditioningUseProfileCheckbox) {
    elements.voiceConditioningUseProfileCheckbox.checked = state.panelControls.conditioningUseProfileChecked;
  }
  if (
    elements.voiceConditioningStyleInput
    && elements.voiceConditioningStyleInput.value !== state.panelControls.conditioningStyleValue
  ) {
    elements.voiceConditioningStyleInput.value = state.panelControls.conditioningStyleValue;
  }
  if (
    elements.voiceConditioningPromptTextInput
    && elements.voiceConditioningPromptTextInput.value !== state.panelControls.conditioningPromptValue
  ) {
    elements.voiceConditioningPromptTextInput.value = state.panelControls.conditioningPromptValue;
  }
  if (elements.voiceConditioningStatusEl) {
    elements.voiceConditioningStatusEl.textContent = state.panelControls.conditioningStatusText;
  }
  if (elements.voiceForecastPhraseInput.value !== state.panelControls.forecastPhraseValue) {
    elements.voiceForecastPhraseInput.value = state.panelControls.forecastPhraseValue;
  }
  elements.voiceForecastPhraseInput.disabled = state.panelControls.forecastPhraseDisabled;
  elements.voiceForecastGenerateBtn.textContent = state.panelControls.forecastGenerateText;
  elements.voiceForecastGenerateBtn.disabled = state.panelControls.forecastGenerateDisabled;
  elements.voiceSelfReportEffortSelect.value = state.panelControls.selfReportEffortValue;
  elements.voiceSelfReportStrainSelect.value = state.panelControls.selfReportStrainValue;
  elements.voiceSelfReportFatigueSelect.value = state.panelControls.selfReportFatigueValue;
  elements.voiceSelfReportDifficultySelect.value = state.panelControls.selfReportDifficultyValue;
  elements.voiceSelfReportConfidenceSelect.value = state.panelControls.selfReportConfidenceValue;
  elements.voiceSelfReportEffortSelect.disabled = state.panelControls.selfReportDisabled;
  elements.voiceSelfReportStrainSelect.disabled = state.panelControls.selfReportDisabled;
  elements.voiceSelfReportFatigueSelect.disabled = state.panelControls.selfReportDisabled;
  elements.voiceSelfReportDifficultySelect.disabled = state.panelControls.selfReportDisabled;
  elements.voiceSelfReportConfidenceSelect.disabled = state.panelControls.selfReportDisabled;
  elements.voiceSelfReportCopyEl.textContent = state.panelControls.selfReportCopyText;
  elements.voiceStartSessionBtn.textContent = state.panelControls.startSessionText;
  elements.voiceStartSessionBtn.disabled = state.panelControls.startSessionDisabled;
  elements.voiceEndSessionBtn.textContent = state.panelControls.endSessionText;
  elements.voiceEndSessionBtn.disabled = state.panelControls.endSessionDisabled;
  elements.voiceLineRegenerateBtn.disabled = state.panelControls.lineRegenerateDisabled;
  elements.voiceLineEasierBtn.disabled = state.panelControls.lineEasierDisabled;
  elements.voiceLineHarderBtn.disabled = state.panelControls.lineHarderDisabled;
  elements.voiceLineNextBtn.disabled = state.panelControls.lineNextDisabled;
  elements.voiceLinePinBtn.disabled = state.panelControls.linePinDisabled;
  elements.voiceReferenceInput.disabled = state.panelControls.referenceInputDisabled;
  elements.voiceDeepTutorStartBtn.disabled = state.panelControls.deepTutorStartDisabled;
  elements.voiceDeepTutorStartBtn.title = state.panelControls.deepTutorStartTitle;
  elements.voiceDeepTutorNextBtn.disabled = state.panelControls.deepTutorNextDisabled;
  elements.voiceDeepTutorNextBtn.title = state.panelControls.deepTutorNextTitle;
  elements.voiceAdvancedToggleBtn.textContent = state.panelControls.advancedToggleText;
  elements.voiceAdvancedToggleBtn.setAttribute('aria-expanded', state.panelControls.advancedExpanded ? 'true' : 'false');
  elements.voiceAdvancedContentEl.classList.toggle('hidden', !state.panelControls.showAdvancedContent);
  elements.voiceLabPanel.classList.toggle('voice-lab-panel-advanced', state.panelControls.useAdvancedLabPanelClass);
  if (elements.voiceCoachSendBtn) {
    elements.voiceCoachSendBtn.disabled = state.panelControls.coachSendDisabled;
  }
  if (elements.voiceConditioningSaveBtn) {
    elements.voiceConditioningSaveBtn.disabled = state.panelControls.conditioningSaveDisabled;
  }
  if (elements.voiceConditioningPromptUploadBtn) {
    elements.voiceConditioningPromptUploadBtn.disabled = state.panelControls.conditioningPromptUploadDisabled;
  }
  if (elements.voiceConditioningReferenceUploadBtn) {
    elements.voiceConditioningReferenceUploadBtn.disabled = state.panelControls.conditioningReferenceUploadDisabled;
  }
  elements.voiceInputDeviceSelect.disabled = state.panelControls.inputDeviceDisabled;

  elements.voiceCoachLiveToggleBtn.textContent = state.coachControls.handsFreeToggle.text;
  elements.voiceCoachLiveToggleBtn.disabled = state.coachControls.handsFreeToggle.disabled;
  elements.voiceCoachLiveToggleBtn.title = state.coachControls.handsFreeToggle.title;
  elements.voiceCoachVoiceToggleBtn.textContent = state.coachControls.voiceAskToggle.text;
  elements.voiceCoachVoiceToggleBtn.disabled = state.coachControls.voiceAskToggle.disabled;
  if (elements.voiceCoachQuestionInput) {
    elements.voiceCoachQuestionInput.placeholder = state.coachControls.questionPlaceholder; // DOM attribute (allow-placeholder)
  }
  elements.voiceCoachSpeechToggleBtn.textContent = state.coachControls.speechToggle.text;
  elements.voiceCoachSpeechToggleBtn.disabled = state.coachControls.speechToggle.disabled;
  if (elements.voiceCoachProviderToggleBtn) {
    elements.voiceCoachProviderToggleBtn.textContent = state.coachControls.speechProviderToggle.text;
    elements.voiceCoachProviderToggleBtn.disabled = state.coachControls.speechProviderToggle.disabled;
    elements.voiceCoachProviderToggleBtn.title = state.coachControls.speechProviderToggle.title;
  }
  if (elements.voiceCoachInputProviderToggleBtn) {
    elements.voiceCoachInputProviderToggleBtn.textContent = state.coachControls.inputProviderToggle.text;
    elements.voiceCoachInputProviderToggleBtn.disabled = state.coachControls.inputProviderToggle.disabled;
    elements.voiceCoachInputProviderToggleBtn.title = state.coachControls.inputProviderToggle.title;
  }
}
