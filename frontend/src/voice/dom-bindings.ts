import type { VoiceBootstrapRefs } from './bootstrap';
import type {
  VoiceRenderControlsDomElements,
  VoiceRenderSummaryDomElements,
} from './render-dom';
import type { VoiceRenderOrchestrationElements } from './render/orchestration';

type VoiceDomBindingsOptions = {
  document: Document;
  memoryStatsEl?: HTMLElement | null;
  stageStatusEl?: HTMLElement | null;
};

export type VoiceDomRootRefs = {
  voicePanel: HTMLElement;
  voiceLabPanel: HTMLElement;
  voiceStagePanel: HTMLElement;
  voiceTargetPresetSelect: HTMLSelectElement;
  voiceReferencePlayerEl: HTMLAudioElement;
  // 2026-07-27 (owner's law): coach mode is SPOKEN — the typed question input
  // was removed from the template, so this ref is null on current surfaces.
  // Kept nullable (not deleted) because the controller API accepts an input
  // ref and every consumer already handles its absence.
  voiceCoachQuestionInput: HTMLInputElement | null;
  voiceConditioningPromptTextInput: HTMLInputElement;
  voiceConditioningPromptFileInput: HTMLInputElement;
  voiceConditioningReferenceFileInput: HTMLInputElement;
  voiceFrontDoorEl: HTMLElement | null;
  voiceFrontDoorInputEl: HTMLInputElement | null;
  voiceFrontDoorSkipEl: HTMLButtonElement | null;
};

export type VoiceDomBindings = {
  root: VoiceDomRootRefs;
  renderSummaryElements: VoiceRenderSummaryDomElements;
  renderControlsElements: VoiceRenderControlsDomElements;
  renderOrchestrationElements: VoiceRenderOrchestrationElements;
  bootstrapRefs: VoiceBootstrapRefs;
};

function getRequiredElement<T extends Element>(document: Document, id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing voice element: #${id}`);
  }
  return element as unknown as T;
}

function getRequiredSelector<T extends Element>(document: Document, selector: string): T {
  const element = document.querySelector(selector);
  if (!element) {
    throw new Error(`Missing voice element: ${selector}`);
  }
  return element as T;
}

export function createVoiceDomBindings({
  document,
  memoryStatsEl = null,
  stageStatusEl = null,
}: VoiceDomBindingsOptions): VoiceDomBindings {
  const voicePanel = getRequiredElement<HTMLElement>(document, 'voice-panel');
  const voiceLabPanel = getRequiredElement<HTMLElement>(document, 'voice-lab-panel');
  const voiceStagePanel = getRequiredElement<HTMLElement>(document, 'voice-stage-panel');
  const voiceAdvancedToggleBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-advanced-toggle');
  const voiceAdvancedContentEl = getRequiredElement<HTMLElement>(document, 'voice-advanced-content');
  const voiceTargetPresetSelect = getRequiredElement<HTMLSelectElement>(document, 'voice-target-preset');
  const voiceCustomPresetNameInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-name');
  const voiceCustomPresetBasePresetSelect = getRequiredElement<HTMLSelectElement>(document, 'voice-custom-preset-base');
  const voiceCustomPresetPitchFloorInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-pitch-floor');
  const voiceCustomPresetPitchCeilingInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-pitch-ceiling');
  const voiceCustomPresetResonanceFloorInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-resonance-floor');
  const voiceCustomPresetResonanceCeilingInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-resonance-ceiling');
  const voiceCustomPresetWeightFloorInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-weight-floor');
  const voiceCustomPresetWeightCeilingInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-weight-ceiling');
  const voiceCustomPresetStylePromptInput = getRequiredElement<HTMLInputElement>(document, 'voice-custom-preset-style-prompt');
  const voiceCustomPresetNotesInput = getRequiredElement<HTMLTextAreaElement>(document, 'voice-custom-preset-notes');
  const voiceSaveReferencePresetBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-save-reference-preset');
  const voiceRemoveReferenceBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-remove-reference');
  const voiceSeedCustomPresetBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-seed-custom-preset');
  const voiceSaveHandmadePresetBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-save-handmade-preset');
  const voiceCustomPresetListEl = getRequiredElement<HTMLElement>(document, 'voice-custom-preset-list');
  const voiceServiceHealthEl = getRequiredElement<HTMLElement>(document, 'voice-service-health');
  const voiceSessionStatusEl = getRequiredElement<HTMLElement>(document, 'voice-session-status');
  const voiceSidebarPresetEl = getRequiredElement<HTMLElement>(document, 'voice-sidebar-preset');
  const voiceStudentMasteryEl = getRequiredElement<HTMLElement>(document, 'voice-student-mastery');
  const voiceStudentReviewCountEl = getRequiredElement<HTMLElement>(document, 'voice-student-review-count');
  const voiceKnowledgeStatusEl = getRequiredElement<HTMLElement>(document, 'voice-knowledge-status');
  const voiceReferenceSummaryEl = getRequiredElement<HTMLElement>(document, 'voice-reference-summary');
  const voiceTargetProfileSummaryEl = getRequiredElement<HTMLElement>(document, 'voice-target-profile-summary');
  const voiceCurrentDrillEl = getRequiredElement<HTMLElement>(document, 'voice-current-drill');
  const voiceRecommendedDrillsEl = getRequiredElement<HTMLElement>(document, 'voice-recommended-drills');
  const voiceSummaryOverviewEl = getRequiredElement<HTMLElement>(document, 'voice-summary-overview');
  const voiceStudentConceptsEl = getRequiredElement<HTMLElement>(document, 'voice-student-concepts');
  const voiceStudentFocusEl = getRequiredElement<HTMLElement>(document, 'voice-student-focus');
  const voiceLearnerContextStatusEl = getRequiredElement<HTMLElement>(document, 'voice-learner-context-status');
  const voiceLearnerContextDatasetEl = getRequiredElement<HTMLElement>(document, 'voice-learner-context-dataset');
  const voiceLearnerContextNotepadEl = getRequiredElement<HTMLElement>(document, 'voice-learner-context-notepad');
  const voiceLearnerContextInlineStatusEl = document.getElementById('voice-lab-learner-context-status');
  const voiceLearnerContextInlineDatasetEl = document.getElementById('voice-lab-learner-context-dataset');
  const voiceLearnerContextInlineNotepadEl = document.getElementById('voice-lab-learner-context-notepad');
  const voiceCoachCopyEl = getRequiredElement<HTMLElement>(document, 'voice-coach-copy');
  const voiceGraphStatusEl = getRequiredElement<HTMLElement>(document, 'voice-graph-status');
  const voiceLiveCueEl = getRequiredElement<HTMLElement>(document, 'voice-live-cue');
  const voiceSessionSpineEl = getRequiredElement<HTMLElement>(document, 'voice-session-spine');
  // Voice-copy front door (P0.1a) — OPTIONAL handles so boot never throws if the section is absent.
  const voiceFrontDoorEl = document.getElementById('voice-front-door') as HTMLElement | null;
  const voiceFrontDoorInputEl = document.getElementById('voice-front-door-input') as HTMLInputElement | null;
  const voiceFrontDoorSkipEl = document.getElementById('voice-front-door-skip') as HTMLButtonElement | null;
  // Redesign-added nodes (session spine hint, Review-stage panel, XY-map a11y target).
  // All OPTIONAL via getElementById so boot never throws if template/logic land out of order.
  const voiceSpineHintEl = document.getElementById('voice-spine-hint') as HTMLElement | null;
  const voiceReviewPanelEl = document.getElementById('voice-review-panel') as HTMLElement | null;
  const voiceReviewSummaryEl = document.getElementById('voice-review-summary') as HTMLElement | null;
  const voiceReviewFocusEl = document.getElementById('voice-review-focus') as HTMLElement | null;
  const voiceReviewListEl = document.getElementById('voice-review-list') as HTMLElement | null;
  const voiceReviewDueEl = document.getElementById('voice-review-due') as HTMLElement | null;
  const voiceGraphShellEl = document.getElementById('voice-graph-shell') as HTMLElement | null;
  // Raw ws:// stream chip removed from the cockpit toolbar surface — OPTIONAL so boot
  // never throws when the template node is absent. render-dom null-guards it.
  const voiceStreamUrlEl = document.getElementById('voice-stream-url') as HTMLElement | null;
  const voiceDrillCopyEl = getRequiredElement<HTMLElement>(document, 'voice-drill-copy');
  const voiceDrillListEl = getRequiredElement<HTMLElement>(document, 'voice-drill-list');
  const voiceCueSheetCopyEl = getRequiredElement<HTMLElement>(document, 'voice-cue-sheet-copy');
  const voiceCueSheetMetaEl = getRequiredElement<HTMLElement>(document, 'voice-cue-sheet-meta');
  const voiceCueSheetLineEl = getRequiredElement<HTMLElement>(document, 'voice-cue-sheet-line');
  const voiceCueSheetTokensEl = getRequiredElement<HTMLElement>(document, 'voice-cue-sheet-tokens');
  const voicePhraseComparisonCopyEl = getRequiredElement<HTMLElement>(document, 'voice-phrase-comparison-copy');
  const voicePhraseQuickFeedbackEl = getRequiredElement<HTMLElement>(document, 'voice-phrase-quick-feedback');
  const voicePhraseCheckpointsEl = getRequiredElement<HTMLElement>(document, 'voice-phrase-checkpoints');
  const voiceInputDeviceSelect = getRequiredElement<HTMLSelectElement>(document, 'voice-input-device');
  const voiceInputSelectedEl = getRequiredElement<HTMLElement>(document, 'voice-input-selected');
  const voiceInputLevelEl = getRequiredElement<HTMLElement>(document, 'voice-input-level');
  const voiceInputSignalEl = getRequiredElement<HTMLElement>(document, 'voice-input-signal');
  const voiceInputReliabilityEl = getRequiredElement<HTMLElement>(document, 'voice-input-reliability');
  const voiceInputCopyEl = getRequiredElement<HTMLElement>(document, 'voice-input-copy');
  const voiceInputRuntimeStatusEl = getRequiredElement<HTMLElement>(document, 'voice-input-runtime-status');
  const voiceInputRuntimeProviderEl = getRequiredElement<HTMLElement>(document, 'voice-input-runtime-provider');
  const voiceInputRuntimeLatencyEl = getRequiredElement<HTMLElement>(document, 'voice-input-runtime-latency');
  const voiceInputRuntimeCountsEl = getRequiredElement<HTMLElement>(document, 'voice-input-runtime-counts');
  const voiceInputRuntimePillsEl = getRequiredElement<HTMLElement>(document, 'voice-input-runtime-pills');
  const voiceInputRuntimeCopyEl = getRequiredElement<HTMLElement>(document, 'voice-input-runtime-copy');
  const voiceForecastPhraseInput = getRequiredElement<HTMLInputElement>(document, 'voice-forecast-phrase');
  const voiceForecastGenerateBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-forecast-generate');
  const voiceSelfReportEffortSelect = getRequiredElement<HTMLSelectElement>(document, 'voice-self-report-effort');
  const voiceSelfReportStrainSelect = getRequiredElement<HTMLSelectElement>(document, 'voice-self-report-strain');
  const voiceSelfReportFatigueSelect = getRequiredElement<HTMLSelectElement>(document, 'voice-self-report-fatigue');
  const voiceSelfReportDifficultySelect = getRequiredElement<HTMLSelectElement>(document, 'voice-self-report-difficulty');
  const voiceSelfReportConfidenceSelect = getRequiredElement<HTMLSelectElement>(document, 'voice-self-report-confidence');
  const voiceSelfReportCopyEl = getRequiredElement<HTMLElement>(document, 'voice-self-report-copy');
  const voiceTargetProfileCopyEl = getRequiredElement<HTMLElement>(document, 'voice-target-profile-copy');
  const voiceForecastCopyEl = getRequiredElement<HTMLElement>(document, 'voice-forecast-copy');
  const voiceStageSessionEl = getRequiredElement<HTMLElement>(document, 'voice-stage-session');
  const voiceStageTargetEl = getRequiredElement<HTMLElement>(document, 'voice-stage-target');
  const voiceStageReferenceEl = getRequiredElement<HTMLElement>(document, 'voice-stage-reference');
  const voiceStageTargetVoiceEl = getRequiredElement<HTMLElement>(document, 'voice-stage-target-voice');
  const voiceStageForecastEl = getRequiredElement<HTMLElement>(document, 'voice-stage-forecast');
  const voiceStageDrillEl = getRequiredElement<HTMLElement>(document, 'voice-stage-drill');
  const voiceStageMatchEl = getRequiredElement<HTMLElement>(document, 'voice-stage-match');
  const voiceStageLaneEl = getRequiredElement<HTMLElement>(document, 'voice-stage-lane');
  const voiceStageContourEl = getRequiredElement<HTMLElement>(document, 'voice-stage-contour');
  const voiceStageZoneEl = getRequiredElement<HTMLElement>(document, 'voice-stage-zone');
  const voiceGraphDotEl = getRequiredElement<HTMLElement>(document, 'voice-graph-dot');
  const voiceReferenceDotEl = getRequiredElement<HTMLElement>(document, 'voice-reference-dot');
  const voiceReferencePathEl = getRequiredSelector<SVGSVGElement>(document, '#voice-reference-path');
  const voiceReferencePolylineEl = getRequiredSelector<SVGPolylineElement>(document, '#voice-reference-polyline');
  const voiceForecastPathEl = getRequiredSelector<SVGSVGElement>(document, '#voice-forecast-path');
  const voiceForecastCorridorEl = getRequiredSelector<SVGPolylineElement>(document, '#voice-forecast-corridor');
  const voiceForecastPolylineEl = getRequiredSelector<SVGPolylineElement>(document, '#voice-forecast-polyline');
  const voiceLivePathEl = getRequiredSelector<SVGSVGElement>(document, '#voice-live-path');
  const voiceLivePolylineEl = getRequiredSelector<SVGPolylineElement>(document, '#voice-live-polyline');
  const voiceToggleLivePathBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-toggle-live-path');
  const voiceToggleForecastPathBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-toggle-forecast-path');
  const voiceToggleReferencePathBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-toggle-reference-path');
  const voiceStartSessionBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-start-session');
  const voiceEndSessionBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-end-session');
  const voiceReferenceInput = getRequiredElement<HTMLInputElement>(document, 'voice-reference-input');
  const voiceReferencePlayerEl = getRequiredElement<HTMLAudioElement>(document, 'voice-reference-player');
  const voiceReferenceMimicMetaEl = getRequiredElement<HTMLElement>(document, 'voice-reference-mimic-meta');
  const voiceReferencePlaybackCopyEl = getRequiredElement<HTMLElement>(document, 'voice-reference-playback-copy');
  const voiceScriptPadLabelEl = getRequiredElement<HTMLElement>(document, 'voice-script-pad-label');
  const voiceActiveLineTextEl = getRequiredElement<HTMLElement>(document, 'voice-active-line-text');
  const voiceActiveLinePerformanceEl = getRequiredElement<HTMLElement>(document, 'voice-active-line-performance');
  const voiceActiveLineMetaEl = getRequiredElement<HTMLElement>(document, 'voice-active-line-meta');
  const voiceActiveLineCuesEl = getRequiredElement<HTMLElement>(document, 'voice-active-line-cues');
  const voiceLessonBoardNoteEl = getRequiredElement<HTMLElement>(document, 'voice-lesson-board-note');
  const voiceLessonActionsEl = getRequiredElement<HTMLElement>(document, 'voice-lesson-actions');
  const voiceLineActionsEl = getRequiredElement<HTMLElement>(document, 'voice-line-actions');
  const voiceDeepTutorStartBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-deeptutor-start');
  const voiceDeepTutorNextBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-deeptutor-next');
  const voiceLineRegenerateBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-line-regenerate');
  const voiceLineEasierBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-line-easier');
  const voiceLineHarderBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-line-harder');
  const voiceLineNextBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-line-next');
  const voiceLinePinBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-line-pin');
  const voiceActiveDrillTitleEl = getRequiredElement<HTMLElement>(document, 'voice-active-drill-title');
  const voiceActiveDrillCopyEl = getRequiredElement<HTMLElement>(document, 'voice-active-drill-copy');
  const voiceActiveDrillStateEl = getRequiredElement<HTMLElement>(document, 'voice-active-drill-state');
  const voiceCoachThreadEl = getRequiredElement<HTMLElement>(document, 'voice-coach-thread');
  // Spoken-only coach mode: these two are absent from current templates and
  // bind null; legacy embeddings that still carry them keep working.
  const voiceCoachQuestionInput = document.getElementById('voice-coach-question') as HTMLInputElement | null;
  const voiceCoachLiveToggleBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-coach-live-toggle');
  const voiceCoachVoiceToggleBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-coach-voice-toggle');
  const voiceCoachSendBtn = document.getElementById('voice-coach-send') as HTMLButtonElement | null;
  const voiceCoachSpeechToggleBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-coach-speech-toggle');
  const voiceCoachProviderToggleBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-coach-provider-toggle');
  const voiceCoachInputProviderToggleBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-coach-input-provider-toggle');
  const voiceConditioningUseProfileCheckbox = getRequiredElement<HTMLInputElement>(document, 'voice-conditioning-use-profile-style');
  const voiceConditioningStyleInput = getRequiredElement<HTMLInputElement>(document, 'voice-conditioning-style');
  const voiceConditioningPromptTextInput = getRequiredElement<HTMLInputElement>(document, 'voice-conditioning-prompt-text');
  const voiceConditioningPromptFileInput = getRequiredElement<HTMLInputElement>(document, 'voice-conditioning-prompt-file');
  const voiceConditioningReferenceFileInput = getRequiredElement<HTMLInputElement>(document, 'voice-conditioning-reference-file');
  const voiceConditioningSaveBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-conditioning-save');
  const voiceConditioningPromptUploadBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-conditioning-prompt-upload');
  const voiceConditioningReferenceUploadBtn = getRequiredElement<HTMLButtonElement>(document, 'voice-conditioning-reference-upload');
  const voiceConditioningStatusEl = getRequiredElement<HTMLElement>(document, 'voice-conditioning-status');
  const voiceVadRmsThresholdInput = getRequiredElement<HTMLInputElement>(document, 'voice-vad-rms-threshold');
  const voiceVadSilenceHoldMsInput = getRequiredElement<HTMLInputElement>(document, 'voice-vad-silence-hold-ms');
  const voiceVadNoSpeechTimeoutMsInput = getRequiredElement<HTMLInputElement>(document, 'voice-vad-no-speech-timeout-ms');
  const voiceVadMinSpeechMsInput = getRequiredElement<HTMLInputElement>(document, 'voice-vad-min-speech-ms');
  const voiceAudioPreferWorkletCheckbox = getRequiredElement<HTMLInputElement>(document, 'voice-audio-prefer-worklet');

  return {
    root: {
      voicePanel,
      voiceLabPanel,
      voiceStagePanel,
      voiceTargetPresetSelect,
      voiceReferencePlayerEl,
      voiceCoachQuestionInput,
      voiceConditioningPromptTextInput,
      voiceConditioningPromptFileInput,
      voiceConditioningReferenceFileInput,
      voiceFrontDoorEl,
      voiceFrontDoorInputEl,
      voiceFrontDoorSkipEl,
    },
    renderSummaryElements: {
      voiceSidebarPresetEl,
      voiceServiceHealthEl,
      voiceSessionStatusEl,
      voiceStudentMasteryEl,
      voiceStudentReviewCountEl,
      voiceKnowledgeStatusEl,
      voiceReferenceSummaryEl,
      voiceTargetProfileSummaryEl,
      voiceCurrentDrillEl,
      voiceTargetProfileCopyEl,
      voiceDrillCopyEl,
      voiceSummaryOverviewEl,
      voiceStudentConceptsEl,
      voiceStudentFocusEl,
      voiceLearnerContextStatusEl,
      voiceLearnerContextDatasetEl,
      voiceLearnerContextNotepadEl,
      voiceLearnerContextInlineStatusEl,
      voiceLearnerContextInlineDatasetEl,
      voiceLearnerContextInlineNotepadEl,
      voiceCoachCopyEl,
      voiceCueSheetCopyEl,
      voicePhraseComparisonCopyEl,
      voiceForecastCopyEl,
      voiceInputSelectedEl,
      voiceInputLevelEl,
      voiceInputSignalEl,
      voiceInputReliabilityEl,
      voiceInputCopyEl,
      voiceInputRuntimeStatusEl,
      voiceInputRuntimeProviderEl,
      voiceInputRuntimeLatencyEl,
      voiceInputRuntimeCountsEl,
      voiceInputRuntimeCopyEl,
      voiceInputRuntimePillsEl,
      voiceGraphStatusEl,
      voiceLiveCueEl,
      voiceSessionSpineEl,
      voiceStreamUrlEl,
      voiceStageSessionEl,
      voiceStageTargetEl,
      voiceStageReferenceEl,
      voiceStageTargetVoiceEl,
      voiceStageForecastEl,
      voiceStageDrillEl,
      voiceStageMatchEl,
      voiceStageLaneEl,
      voiceStageContourEl,
      voiceStageZoneEl,
      voiceReferencePlaybackCopyEl,
      voiceReferencePlayerEl,
      voiceReferenceMimicMetaEl,
      voiceActiveDrillTitleEl,
      voiceActiveDrillCopyEl,
      voiceActiveDrillStateEl,
      voiceLabPanelEl: voiceLabPanel,
      voiceFrontDoorEl,
      voiceFrontDoorInputEl,
      voiceFrontDoorSkipEl,
      voiceSpineHintEl,
      voiceReviewPanelEl,
      voiceReviewSummaryEl,
      voiceReviewFocusEl,
      voiceReviewListEl,
      voiceReviewDueEl,
      voiceGraphShellEl,
      memoryStatsEl,
      stageStatusEl,
    },
    renderControlsElements: {
      voiceTargetPresetSelect,
      voiceCustomPresetNameInput,
      voiceCustomPresetBasePresetSelect,
      voiceCustomPresetPitchFloorInput,
      voiceCustomPresetPitchCeilingInput,
      voiceCustomPresetResonanceFloorInput,
      voiceCustomPresetResonanceCeilingInput,
      voiceCustomPresetWeightFloorInput,
      voiceCustomPresetWeightCeilingInput,
      voiceCustomPresetStylePromptInput,
      voiceCustomPresetNotesInput,
      voiceSaveReferencePresetBtn,
      voiceRemoveReferenceBtn,
      voiceSeedCustomPresetBtn,
      voiceSaveHandmadePresetBtn,
      voiceConditioningUseProfileCheckbox,
      voiceConditioningStyleInput,
      voiceConditioningPromptTextInput,
      voiceConditioningStatusEl,
      voiceForecastPhraseInput,
      voiceForecastGenerateBtn,
      voiceSelfReportEffortSelect,
      voiceSelfReportStrainSelect,
      voiceSelfReportFatigueSelect,
      voiceSelfReportDifficultySelect,
      voiceSelfReportConfidenceSelect,
      voiceSelfReportCopyEl,
      voiceStartSessionBtn,
      voiceEndSessionBtn,
      voiceLineRegenerateBtn,
      voiceLineEasierBtn,
      voiceLineHarderBtn,
      voiceLineNextBtn,
      voiceLinePinBtn,
      voiceReferenceInput,
      voiceDeepTutorStartBtn,
      voiceDeepTutorNextBtn,
      voiceAdvancedToggleBtn,
      voiceAdvancedContentEl,
      voiceLabPanel,
      voiceCoachSendBtn,
      voiceCoachLiveToggleBtn,
      voiceCoachVoiceToggleBtn,
      voiceCoachQuestionInput,
      voiceCoachSpeechToggleBtn,
      voiceCoachProviderToggleBtn,
      voiceCoachInputProviderToggleBtn,
      voiceConditioningSaveBtn,
      voiceConditioningPromptUploadBtn,
      voiceConditioningReferenceUploadBtn,
      voiceInputDeviceSelect,
    },
    renderOrchestrationElements: {
      voiceInputDeviceSelect,
      voiceToggleLivePathBtn,
      voiceToggleForecastPathBtn,
      voiceToggleReferencePathBtn,
      voiceRecommendedDrillsEl,
      voiceDrillListEl,
      voiceCueSheetMetaEl,
      voiceCueSheetLineEl,
      voiceCueSheetTokensEl,
      voicePhraseQuickFeedbackEl,
      voicePhraseCheckpointsEl,
      voiceScriptPadLabelEl,
      voiceActiveLineTextEl,
      voiceActiveLinePerformanceEl,
      voiceActiveLineMetaEl,
      voiceActiveLineCuesEl,
      voiceLessonBoardNoteEl,
      voiceLessonActionsEl,
      voiceLineActionsEl,
      voiceDeepTutorStartBtn,
      voiceDeepTutorNextBtn,
      voiceLinePinBtn,
      voiceCoachThreadEl,
      voiceReferencePathEl,
      voiceReferencePolylineEl,
      voiceGraphDotEl,
      voiceReferenceDotEl,
      voiceCustomPresetListEl,
      voiceForecastPathEl,
      voiceForecastPolylineEl,
      voiceForecastCorridorEl,
      voiceLivePathEl,
      voiceLivePolylineEl,
    },
    bootstrapRefs: {
      voiceAdvancedToggleBtn,
      voiceTargetPresetSelect,
      voiceInputDeviceSelect,
      voiceConditioningUseProfileCheckbox,
      voiceConditioningStyleInput,
      voiceConditioningPromptTextInput,
      voiceForecastPhraseInput,
      voiceForecastGenerateBtn,
      voiceSelfReportEffortSelect,
      voiceSelfReportStrainSelect,
      voiceSelfReportFatigueSelect,
      voiceSelfReportDifficultySelect,
      voiceSelfReportConfidenceSelect,
      voiceToggleLivePathBtn,
      voiceToggleForecastPathBtn,
      voiceToggleReferencePathBtn,
      voiceStartSessionBtn,
      voiceEndSessionBtn,
      voiceReferenceInput,
      voiceReferencePlayerEl,
      voiceDeepTutorStartBtn,
      voiceDeepTutorNextBtn,
      voiceLineRegenerateBtn,
      voiceLineEasierBtn,
      voiceLineHarderBtn,
      voiceLineNextBtn,
      voiceLinePinBtn,
      voiceCoachQuestionInput,
      voiceCoachLiveToggleBtn,
      voiceCoachVoiceToggleBtn,
      voiceCoachSendBtn,
      voiceCoachSpeechToggleBtn,
      voiceCoachProviderToggleBtn,
      voiceCoachInputProviderToggleBtn,
      voiceConditioningPromptFileInput,
      voiceConditioningReferenceFileInput,
      voiceConditioningSaveBtn,
      voiceConditioningPromptUploadBtn,
      voiceConditioningReferenceUploadBtn,
      voiceCoachQuestionButtons: Array.from(document.querySelectorAll<HTMLElement>('[data-voice-coach-question]')),
      voiceVadRmsThresholdInput,
      voiceVadSilenceHoldMsInput,
      voiceVadNoSpeechTimeoutMsInput,
      voiceVadMinSpeechMsInput,
      voiceAudioPreferWorkletCheckbox,
      voiceCustomPresetNameInput,
      voiceCustomPresetBasePresetSelect,
      voiceCustomPresetPitchFloorInput,
      voiceCustomPresetPitchCeilingInput,
      voiceCustomPresetResonanceFloorInput,
      voiceCustomPresetResonanceCeilingInput,
      voiceCustomPresetWeightFloorInput,
      voiceCustomPresetWeightCeilingInput,
      voiceCustomPresetStylePromptInput,
      voiceCustomPresetNotesInput,
      voiceSaveReferencePresetBtn,
      voiceRemoveReferenceBtn,
      voiceSeedCustomPresetBtn,
      voiceSaveHandmadePresetBtn,
      voiceCustomPresetListEl,
    },
  };
}
