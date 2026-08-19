import {
  getDeepTutorVoiceLessonMode,
  getLatestVoiceCoachThreadMessage,
  getRenderableVoicePhraseComparison as resolveRenderableVoicePhraseComparison,
  normalizeDeepTutorVoiceState,
  normalizeVoiceInputRuntimeState,
  normalizeVoiceSelfReport,
  isVoiceAttemptMeasurementUsable,
  resolveDeepTutorVoiceRuntimeOwner,
  normalizeVoicePhraseTextForMatch,
  normalizeVoicePracticeLine,
  resolveVoiceCoachMessageChannel,
  type DeepTutorVoiceState,
  type VoiceCoachMessage,
  type VoiceCoachMessageChannel,
  type VoiceInputRecoveryState,
  type VoiceInputRuntimeState,
  type VoiceCueSheet,
  type VoiceDrill,
  type VoiceDrillState,
  type VoicePhraseComparison,
  type VoicePracticeLine,
  type VoiceSelfReport,
  type VoiceStudentModelState,
  type VoiceUiState,
} from './state';
import { isVoiceCoachInputProviderSwitchAllowed } from './coach-input-provider';
import type { VoicePracticeTransportStatus } from './practice-transport';
import type { VoiceLearnerBaseline } from './contracts';
import { deriveSessionStage, type VoiceSessionStage } from './session-reentry';
import {
  getVoiceComparisonScoreText,
  getVoiceCueSheetCheckpointForToken,
  getVoicePhraseCheckpointTone,
  isVoiceComparisonMatchCueSheet,
} from './render';

export type VoiceViewModelContext = {
  voiceUiState: VoiceUiState;
  voiceDrillState: VoiceDrillState;
  voiceStudentModelState: VoiceStudentModelState;
  voiceDrillStatus: 'idle' | 'loading' | 'error';
  voiceDrillError: string | null;
  voiceForecastStatus: 'idle' | 'loading' | 'error';
  voiceForecastError: string | null;
  voiceCoachTaskStatus: 'idle' | 'running' | 'error';
  voiceCoachTaskError: string | null;
};

type VoiceLineMeta = { label: string; value: string };
type VoiceSpeechRecognitionStatus = 'idle' | 'waiting' | 'listening' | 'processing' | 'error' | 'unsupported';
type VoiceDeepTutorLessonStatus = 'idle' | 'loading' | 'error';
type VoiceCoachTaskStatus = 'idle' | 'running' | 'error';
type VoiceCoachQuestionStatus = 'idle' | 'sending' | 'error';

export type VoiceCoachPanelCopyContext = {
  latestCoachMessage: VoiceCoachMessage | null;
  latestCoachCopy: string;
  latestCoachLabel: string;
  voiceCoachQuestionStatus: VoiceCoachQuestionStatus;
  voiceCoachQuestionError: string | null;
  voiceSpeechRecognitionStatus: VoiceSpeechRecognitionStatus;
  voiceSpeechRecognitionError: string | null;
  voiceDeepTutorLessonStatus: VoiceDeepTutorLessonStatus;
  voiceDeepTutorLessonError: string | null;
  requestedInputProvider: 'browser' | 'backend';
  inputProviderFallbackActive: boolean;
  backendLivePathLabel: string | null;
  inputRecovery: VoiceInputRecoveryState;
  inputProviderFallbackReason: string | null;
  inputCapabilityCopy: string | null;
  speechEnabled: boolean;
  voxcpmFallbackReason: string | null;
  continuousEnabled: boolean;
  handsFreeVoiceInputSupported: boolean;
  ownerCopy: string | null;
  isSpeaking?: boolean;
  referenceClipId?: string | null;
  referenceClipName?: string | null;
};

export type VoiceCoachControlsContext = {
  currentSessionId: string | null;
  isConnected: boolean;
  handsFreeEnabled: boolean;
  voiceCoachInputAvailable: boolean;
  handsFreeVoiceInputSupported: boolean;
  inputRecovery: VoiceInputRecoveryState;
  voiceSpeechRecognitionStatus: VoiceSpeechRecognitionStatus;
  canUseVoiceAsk: boolean;
  interactionOwner: string;
  deeptutorGuideActive: boolean;
  speechEnabled: boolean;
  voiceCoachSpeechOutputAvailable: boolean;
  requestedSpeechProvider: 'browser' | 'voxcpm';
  speechProviderFallbackActive: boolean;
  voiceCoachVoxCpmError: string | null;
  requestedInputProvider: 'browser' | 'backend';
  inputProviderFallbackActive: boolean;
  voiceCoachInputBackendError: string | null;
  browserSpeechRecognitionSupported: boolean;
  backendInputBaseTitle: string;
  inputProviderHint: string | null;
};

export type VoiceCoachControlsViewModel = {
  handsFreeToggle: {
    text: string;
    disabled: boolean;
    title: string;
  };
  voiceAskToggle: {
    text: string;
    disabled: boolean;
  };
  questionPlaceholder: string;
  speechToggle: {
    text: string;
    disabled: boolean;
  };
  speechProviderToggle: {
    text: string;
    disabled: boolean;
    title: string;
  };
  inputProviderToggle: {
    text: string;
    disabled: boolean;
    title: string;
  };
};

type VoiceCoachInputCapabilitiesSnapshot = {
  liveCapture?: boolean | null;
  finalTranscript?: boolean | null;
  interimTranscript?: boolean | null;
  vad?: boolean | null;
  bargeInCancel?: boolean | null;
};

type VoiceCoachBackendLiveStatusSnapshot = {
  requestedMode?: string | null;
  requestedWsUrlConfigured?: boolean | null;
  requestedProviderTarget?: string | null;
  requestedModel?: string | null;
  requestedLanguage?: string | null;
  actualMode?: string | null;
  actualEngine?: string | null;
  actualInterimMode?: string | null;
  actualVadStrategy?: string | null;
  actualProviderTarget?: string | null;
  actualProviderModel?: string | null;
  actualProviderLanguage?: string | null;
  actualProviderEndpointing?: string | null;
  fallbackReason?: string | null;
  verified?: boolean | null;
};

export type VoiceCoachSupportContext = {
  currentSessionId: string | null;
  isConnected: boolean;
  requestedSpeechProvider: 'browser' | 'voxcpm';
  speechProviderFallbackActive: boolean;
  voiceCoachVoxCpmError: string | null;
  voiceCoachVoxCpmEnabled: boolean;
  requestedInputProvider: 'browser' | 'backend';
  inputProviderFallbackActive: boolean;
  voiceCoachInputBackendError: string | null;
  voiceCoachInputBackendEnabled: boolean;
  canUseBackendVoiceCoachCapture: boolean;
  browserSpeechRecognitionSupported: boolean;
  backendInputCapabilities: VoiceCoachInputCapabilitiesSnapshot | null;
  effectiveInputCapabilities: VoiceCoachInputCapabilitiesSnapshot | null;
  backendLiveStatus: VoiceCoachBackendLiveStatusSnapshot | null;
};

export type VoiceCoachSupportViewModel = {
  backendLivePathLabel: string | null;
  inputCapabilityCopy: string | null;
  inputProviderFallbackReason: string | null;
  voxcpmFallbackReason: string | null;
  backendInputBaseTitle: string;
};

export type VoiceInputRuntimeViewModel = {
  statusText: string;
  providerText: string;
  latencyText: string;
  countsText: string;
  copyText: string;
  pills: string[];
  evidenceSummary: string | null;
};

export type VoiceReferenceMimicState = {
  action: 'load' | 'ready' | 'mimic' | 'repeat' | 'hold';
  statusLabel: string;
  instruction: string;
  suggestedRepeats: number | null;
  metrics: string[];
};

export type VoiceReferenceMimicProgressState = {
  completedRepeats: number;
  targetRepeats: number;
  remainingRepeats: number;
  progressLabel: string;
};

export type VoiceActiveDrillStateContext = {
  voiceUiState: VoiceUiState;
  inputRecovery: VoiceInputRecoveryState;
  voiceDeepTutorLessonStatus: VoiceDeepTutorLessonStatus;
  voiceCoachTaskStatus: VoiceCoachTaskStatus;
  voiceTakeProcessing: boolean;
  voiceTakeActive: boolean;
  voiceTransportStatus: VoicePracticeTransportStatus;
  voiceSessionArmed: boolean;
};

export type VoiceActiveDrillCopyContext = {
  voiceUiState: VoiceUiState;
  inputRecovery: VoiceInputRecoveryState;
  inputRuntime: VoiceInputRuntimeState;
  voiceSpeechRecognitionStatus: VoiceSpeechRecognitionStatus;
  voiceSessionArmed: boolean;
  voiceTransportStatus: VoicePracticeTransportStatus;
  backendLivePathLabel: string | null;
  referenceMimicState: VoiceReferenceMimicState;
  referenceMimicProgress: VoiceReferenceMimicProgressState | null;
};

export type VoiceScriptPadViewModel = {
  labelText: string;
  lineText: string;
  performanceText: string;
  metaPills: string[];
  cuePills: string[];
  lessonNote: string;
  showLessonNote: boolean;
  showLessonActions: boolean;
  showLineActions: boolean;
};

export type VoiceCoachThreadBubbleViewModel = {
  role: 'coach' | 'user';
  label: string;
  content: string;
};

export type VoiceCoachThreadViewModel = {
  emptyCopy: string | null;
  bubbles: VoiceCoachThreadBubbleViewModel[];
  pendingBubble: VoiceCoachThreadBubbleViewModel | null;
};

export type VoiceReferenceViewModel = {
  summaryText: string;
  playbackCopyText: string;
  showPlayer: boolean;
  mimicPills: string[];
};

export type VoiceReviewListItemViewModel = {
  timeText: string;
  durationText: string;
  metricText: string;
  /** Attempt id for the per-row Listen replay; null when the take kept no id. */
  attemptId: string | null;
  /** False when the take explicitly retained no audio (includesRawAudio === false). */
  hasAudio: boolean;
};

export type VoiceStageViewModel = {
  sessionStage: VoiceSessionStage;
  /** True once a reference clip is loaded — drives the front-door takeover rule. */
  hasReference: boolean;
  /** Durable preset-fallback dismissal flag; ORed into the front-door rule. */
  frontDoorDismissed: boolean;
  /** Per-stage 'do this next' guidance shown under the session spine. */
  spineHintText: string;
  /** Review-stage headline derived from this session's takes. */
  reviewSummaryText: string;
  /** Review-stage focus line derived from lastSummary issues/nextDrills. */
  reviewFocusText: string;
  /** Per-take rows for the Review panel, oldest→newest. */
  reviewListItems: VoiceReviewListItemViewModel[];
  /** Live a11y description of the XY map. */
  graphAriaLabel: string;
  graphStatusText: string;
  liveCueText: string;
  streamUrlText: string;
  sessionText: string;
  targetText: string;
  referenceText: string;
  targetVoiceText: string;
  forecastText: string;
  drillText: string;
  matchText: string;
  laneText: string;
  contourText: string;
  zoneText: string;
  shellMemoryStatsText: string;
  shellStageStatusText: string;
};

export type VoiceSidebarSummaryViewModel = {
  sidebarPresetText: string;
  serviceHealthText: string;
  sessionStatusText: string;
  studentMasteryText: string;
  studentReviewCountText: string;
  knowledgeStatusText: string;
  referenceSummaryText: string;
  targetProfileSummaryText: string;
  currentDrillText: string;
  targetProfileCopyText: string;
  drillCopyText: string;
  summaryOverviewText: string;
  studentConceptsText: string;
  studentFocusText: string;
  learnerContextStatusText: string;
  learnerContextDatasetText: string;
  learnerContextNotepadText: string;
  activeDrillTitleText: string;
  /**
   * Surfacing wave: calm due-for-review line for the VISIBLE Review panel.
   * Null when nothing is due (the line stays hidden). The hidden-sidebar
   * "Due now" rendering is untouched.
   */
  reviewDueText: string | null;
};

export type VoicePanelControlsContext = {
  voiceUiState: VoiceUiState;
  voiceConditioning: {
    useTargetProfileStyle: boolean;
    styleInstruction: string;
    promptText: string;
  };
  voiceConditioningStatusText: string;
  voicePracticeTargetLocked: boolean;
  currentSessionId: string | null;
  isConnected: boolean;
  voiceForecastStatus: 'idle' | 'loading' | 'error';
  voiceSessionArmed: boolean;
  voiceTakeProcessing: boolean;
  voiceTakeActive: boolean;
  voiceTransportStatus: VoicePracticeTransportStatus;
  deepTutorOwnsLineSelection: boolean;
  activeLine: VoicePracticeLine | null;
  voiceDeepTutorLessonStatus: VoiceDeepTutorLessonStatus;
  shouldRebuildDeepTutorVoiceLesson: boolean;
  deepTutorVoiceRoutesEnabled?: boolean;
  voiceCoachQuestionStatus: VoiceCoachQuestionStatus;
  voiceAudioInputDevicesCount: number;
  conditioningPromptFileSelected: boolean;
  conditioningPromptTextPresent: boolean;
  conditioningReferenceFileSelected: boolean;
};

export type VoicePanelControlsViewModel = {
  targetPresetValue: string;
  targetPresetDisabled: boolean;
  customPresetNameValue: string;
  customPresetBasePresetValue: string;
  customPresetPitchFloorValue: string;
  customPresetPitchCeilingValue: string;
  customPresetResonanceFloorValue: string;
  customPresetResonanceCeilingValue: string;
  customPresetWeightFloorValue: string;
  customPresetWeightCeilingValue: string;
  customPresetStylePromptValue: string;
  customPresetNotesValue: string;
  customPresetWorkspaceDisabled: boolean;
  saveReferencePresetDisabled: boolean;
  removeReferenceDisabled: boolean;
  seedCustomPresetDisabled: boolean;
  saveHandmadePresetDisabled: boolean;
  saveHandmadePresetText: string;
  conditioningUseProfileChecked: boolean;
  conditioningStyleValue: string;
  conditioningPromptValue: string;
  conditioningStatusText: string;
  forecastPhraseValue: string;
  forecastPhraseDisabled: boolean;
  forecastGenerateText: string;
  forecastGenerateDisabled: boolean;
  startSessionText: string;
  startSessionDisabled: boolean;
  endSessionText: string;
  endSessionDisabled: boolean;
  lineRegenerateDisabled: boolean;
  lineEasierDisabled: boolean;
  lineHarderDisabled: boolean;
  lineNextDisabled: boolean;
  linePinDisabled: boolean;
  referenceInputDisabled: boolean;
  deepTutorStartDisabled: boolean;
  deepTutorNextDisabled: boolean;
  deepTutorStartTitle: string;
  deepTutorNextTitle: string;
  advancedToggleText: string;
  advancedExpanded: boolean;
  showAdvancedContent: boolean;
  useAdvancedLabPanelClass: boolean;
  coachSendDisabled: boolean;
  conditioningSaveDisabled: boolean;
  conditioningPromptUploadDisabled: boolean;
  conditioningReferenceUploadDisabled: boolean;
  inputDeviceDisabled: boolean;
  selfReportEffortValue: string;
  selfReportStrainValue: string;
  selfReportFatigueValue: string;
  selfReportDifficultyValue: string;
  selfReportConfidenceValue: string;
  selfReportDisabled: boolean;
  selfReportCopyText: string;
};

type VoiceAudioInputDeviceSnapshot = {
  deviceId: string;
  label: string;
  isDefault?: boolean | null;
};

export type VoiceInputPanelViewModel = {
  selectedText: string;
  levelText: string;
  signalText: string;
  reliabilityText: string;
  copyText: string;
};

export function getVoiceSummaryText(voiceUiState: VoiceUiState): string {
  if (
    voiceUiState.lastSummary?.metrics
    && !isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary.metrics)
  ) {
    return 'No reliable voice measurement was available for this take. Check the input and try again.';
  }
  if (Array.isArray(voiceUiState.lastSummary?.issues) && voiceUiState.lastSummary.issues.length > 0) {
    return voiceUiState.lastSummary.issues[0];
  }
  // Phase 1.4: prefer the new target-fit label when target occupancy is available.
  const fitText = getVoiceTargetFitText(voiceUiState);
  if (fitText) {
    return fitText;
  }
  const targetHitPct = voiceUiState.lastSummary?.metrics?.targetHitPct;
  if (typeof targetHitPct === 'number') {
    return `Target fit: ${(targetHitPct * 100).toFixed(0)}% in zone.`;
  }
  if (voiceUiState.referenceAnalysis?.filename) {
    return `Reference analyzed: ${voiceUiState.referenceAnalysis.filename}. Start a take to compare against it.`;
  }
  return 'Start a practice take to generate instant graph feedback and post-take notes.';
}

/**
 * Phase 1.4: a single human-friendly line summarizing how the last take
 * landed in the target band. Uses pitchTargetOccupancyPct when available,
 * otherwise falls back to the legacy targetHitPct × band floor rule.
 *
 * Always uses the word "fit" — never "feminine score" or "passing" — to
 * keep the language about the *target band*, not about gender identity.
 */
export function getVoiceTargetFitText(voiceUiState: VoiceUiState): string {
  if (!isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary?.metrics)) return '';
  const advanced = voiceUiState.lastSummary?.metrics?.advanced;
  const occupancy = advanced?.pitchTargetOccupancyPct;
  if (typeof occupancy === 'number' && Number.isFinite(occupancy)) {
    if (occupancy >= 80) return `Target fit: strong — pitch in zone ${occupancy.toFixed(0)}% of the take.`;
    if (occupancy >= 55) return `Target fit: mixed — pitch in zone ${occupancy.toFixed(0)}% of the take.`;
    return `Target fit: drifting — pitch in zone only ${occupancy.toFixed(0)}% of the take.`;
  }
  return '';
}

export function getVoiceTtsCloneStatus(
  referenceClipId: string | null | undefined,
  referenceClipName: string | null | undefined,
): string | null {
  if (!referenceClipId) return null;
  const name = referenceClipName || 'reference';
  return `Speaking as: ${name}`;
}

/**
 * Phase 1.4: a single human-friendly line summarizing the phrase-final drop
 * against the target ceiling. Negative = dropping, near zero = stable.
 */
export function getVoicePhraseFinalDropText(voiceUiState: VoiceUiState): string {
  if (!isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary?.metrics)) return '';
  const advanced = voiceUiState.lastSummary?.metrics?.advanced;
  const dropSt = advanced?.phraseFinalDropSemitones;
  if (typeof dropSt !== 'number' || !Number.isFinite(dropSt)) return '';
  // Praat convention: a falling ending is "negative" in semitones.
  // We treat anything below -1.5 st as a meaningful drop.
  if (dropSt <= -3) return `Phrase ending dropped about ${Math.abs(dropSt).toFixed(1)} semitones — keep it lifted.`;
  if (dropSt <= -1.5) return `Phrase ending dropped a little (${Math.abs(dropSt).toFixed(1)} st).`;
  if (dropSt >= 0.5) return `Phrase ending lifted nicely.`;
  return 'Phrase ending stayed stable.';
}

/**
 * Phase 1.4: "vs your baseline" line, only when a baseline snapshot exists.
 * Returns "" if no baseline is present yet.
 */
export function getVoiceBaselineDeltaText(
  voiceUiState: VoiceUiState,
  baseline: VoiceLearnerBaseline | null | undefined,
): string {
  if (!baseline) return '';
  if (!isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary?.metrics)) return '';
  const advanced = voiceUiState.lastSummary?.metrics?.advanced;
  const lastPitchHz = voiceUiState.lastSummary?.metrics?.meanPitchHz;
  if (typeof lastPitchHz !== 'number' || !Number.isFinite(lastPitchHz)) return '';
  if (typeof baseline.meanPitchHz !== 'number' || !Number.isFinite(baseline.meanPitchHz)) return '';
  const deltaHz = lastPitchHz - baseline.meanPitchHz;
  if (Math.abs(deltaHz) < 1) return 'Pitch is right at your baseline.';
  const direction = deltaHz > 0 ? 'up' : 'down';
  return `Pitch is ${Math.abs(deltaHz).toFixed(0)} Hz ${direction} vs your baseline.`;
}

/**
 * Phase 1.4: label a discrete TargetFit pitch status for display.
 * pitch.status ∈ 'below' | 'in_band' | 'above' | 'unstable' | 'uncertain'
 */
export function getPitchFitStatusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'in_band': return 'in band';
    case 'below': return 'below band';
    case 'above': return 'above band';
    case 'unstable': return 'unstable';
    case 'uncertain': return 'measuring…';
    default: return 'measuring…';
  }
}

export function getSelectedVoiceDrill(voiceDrillState: VoiceDrillState): VoiceDrill | null {
  if (voiceDrillState.selectedDrill) {
    return voiceDrillState.selectedDrill;
  }
  if (!voiceDrillState.selectedLessonId) {
    return null;
  }
  return voiceDrillState.drills.find((drill) => drill.id === voiceDrillState.selectedLessonId) || null;
}

export function getRecommendedVoiceDrills(voiceDrillState: VoiceDrillState): VoiceDrill[] {
  const drillsById = new Map(voiceDrillState.drills.map((drill) => [drill.id, drill]));
  const recommended: VoiceDrill[] = [];

  for (const drillId of voiceDrillState.recommendedIds) {
    const drill = drillsById.get(drillId);
    if (drill && !recommended.some((entry) => entry.id === drill.id)) {
      recommended.push(drill);
    }
  }

  if (recommended.length === 0) {
    return voiceDrillState.drills.slice(0, 3);
  }

  return recommended.slice(0, 3);
}

export function getVoiceActiveLine(voiceUiState: VoiceUiState): VoicePracticeLine | null {
  return normalizeVoicePracticeLine(voiceUiState.activeLine);
}

export function isVoicePracticeTargetLocked(voiceUiState: VoiceUiState): boolean {
  return typeof voiceUiState.voiceSessionId === 'string' && voiceUiState.voiceSessionId.trim().length > 0;
}

export function getCurrentVoiceCueSheet({
  voiceUiState,
  voiceDrillState,
}: Pick<VoiceViewModelContext, 'voiceUiState' | 'voiceDrillState'>): VoiceCueSheet | null {
  const activeLine = getVoiceActiveLine(voiceUiState);
  if (activeLine?.cueSheet) {
    return activeLine.cueSheet;
  }

  const selectedDrill = getSelectedVoiceDrill(voiceDrillState);
  const drillSheet = selectedDrill?.cueSheet || null;
  const forecastSheet = voiceUiState.phraseForecast?.cueSheet || null;

  if (forecastSheet) {
    const forecastPhrase = normalizeVoicePhraseTextForMatch(
      forecastSheet.phrase || voiceUiState.phraseForecast?.phrase,
    );
    const drillPhrase = normalizeVoicePhraseTextForMatch(drillSheet?.phrase || selectedDrill?.phrase);
    if (!drillSheet || !drillPhrase || forecastPhrase !== drillPhrase) {
      return forecastSheet;
    }
  }

  return drillSheet || forecastSheet || null;
}

export function getRenderableVoicePhraseComparison({
  voiceUiState,
  voiceDrillState,
}: Pick<VoiceViewModelContext, 'voiceUiState' | 'voiceDrillState'>): VoicePhraseComparison | null {
  if (
    voiceUiState.lastSummary?.metrics
    && !isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary.metrics)
  ) {
    return null;
  }
  const cueSheet = getCurrentVoiceCueSheet({ voiceUiState, voiceDrillState });
  return resolveRenderableVoicePhraseComparison({
    phraseComparison: voiceUiState.phraseComparison,
    lessonId: voiceUiState.lessonId,
    activePhrase: cueSheet?.phrase || voiceUiState.forecastPhrase || voiceUiState.phraseForecast?.phrase || null,
  });
}

export function getVoiceCoachCopy(context: VoiceViewModelContext): string {
  const deeptutorVoiceState = normalizeDeepTutorVoiceState(context.voiceUiState.deeptutorVoiceState);
  const latestCoachThreadMessage = getLatestVoiceCoachThreadMessage(context.voiceUiState.coachThread, 'coach');
  if (deeptutorVoiceState.lastError) {
    return `DeepTutor paused: ${deeptutorVoiceState.lastError}`;
  }
  if (latestCoachThreadMessage?.content) {
    return latestCoachThreadMessage.content;
  }
  if (context.voiceUiState.lastCoachMessage) {
    return context.voiceUiState.lastCoachMessage;
  }
  if (deeptutorVoiceState.lastTutorMessage) {
    return deeptutorVoiceState.lastTutorMessage;
  }
  if (context.voiceCoachTaskStatus === 'running') {
    return 'Coach is reading the take and building your next two drills...';
  }
  if (context.voiceCoachTaskStatus === 'error') {
    return context.voiceCoachTaskError
      ? `Coach generation failed: ${context.voiceCoachTaskError}`
      : 'Coach generation failed. End another take to retry.';
  }
  const summary = context.voiceUiState.lastSummary;
  if (!summary) {
    if (context.voiceStudentModelState.reviewQueue.length > 0) {
      return `Review queue ready: ${context.voiceStudentModelState.reviewQueue.slice(0, 2).map((item) => item.name).join(' • ')}.`;
    }
    return 'Once a take ends, this panel will translate the metrics into drills, phrasing notes, and progress cues.';
  }

  const drills = isVoiceAttemptMeasurementUsable(summary.metrics) && Array.isArray(summary.nextDrills)
    ? summary.nextDrills.filter(Boolean)
    : [];
  const drillText = drills.length > 0 ? ` Next: ${drills.slice(0, 2).join(' • ')}.` : '';
  const reviewText = context.voiceStudentModelState.reviewQueue.length > 0
    ? ` Review due: ${context.voiceStudentModelState.reviewQueue.slice(0, 2).map((item) => item.name).join(' • ')}.`
    : '';
  return `${getVoiceSummaryText(context.voiceUiState)}${drillText}${reviewText}`;
}

export function getVoiceCoachPanelCopy(context: VoiceCoachPanelCopyContext): string {
  const labeledCoachCopy = context.latestCoachMessage && context.latestCoachCopy === context.latestCoachMessage.content
    ? `${context.latestCoachLabel}: ${context.latestCoachCopy}`
    : context.latestCoachCopy;

  if (context.voiceCoachQuestionStatus === 'error' && context.voiceCoachQuestionError) {
    return `Coach question failed: ${context.voiceCoachQuestionError}`;
  }
  if (context.voiceSpeechRecognitionStatus === 'error' && context.voiceSpeechRecognitionError) {
    return `Voice input failed: ${context.voiceSpeechRecognitionError}`;
  }
  if (context.voiceSpeechRecognitionStatus === 'waiting') {
    return context.requestedInputProvider === 'backend' && !context.inputProviderFallbackActive
      ? `${context.backendLivePathLabel ? `${context.backendLivePathLabel} is armed.` : 'Backend input is armed.'} Start speaking when ready; the turn will submit after local silence is detected.`
      : 'Listening... start speaking when you are ready.';
  }
  if (context.voiceSpeechRecognitionStatus === 'listening') {
    if (context.requestedInputProvider === 'backend' && context.inputProviderFallbackActive) {
      return 'Listening with browser fallback. Speak naturally and the captured turn will still route through the backend input contract when you stop.';
    }
    if (context.requestedInputProvider === 'backend' && !context.inputProviderFallbackActive) {
      return `Speech detected on ${context.backendLivePathLabel || 'backend live input'}. Keep talking; the backend turn will submit when you stop.`;
    }
    return 'Listening... speak naturally and the coach question will send when you stop.';
  }
  if (context.voiceSpeechRecognitionStatus === 'processing') {
    return 'Voice input captured. Normalizing the spoken turn through the backend runtime...';
  }
  if (context.voiceDeepTutorLessonStatus === 'error' && context.voiceDeepTutorLessonError) {
    return `DeepTutor sync failed: ${context.voiceDeepTutorLessonError}`;
  }
  if (context.inputRecovery.coachCopy) {
    return context.inputRecovery.coachCopy;
  }
  if (context.inputProviderFallbackReason) {
    return context.inputProviderFallbackReason;
  }
  if (context.inputCapabilityCopy) {
    return context.inputCapabilityCopy;
  }
  if (context.speechEnabled && context.voxcpmFallbackReason) {
    return context.voxcpmFallbackReason;
  }
  if (context.continuousEnabled) {
    return context.handsFreeVoiceInputSupported
      ? 'Hands-free coach is armed. When the coach finishes speaking, the mic will open for your next spoken reply.'
      : 'Hands-free stays off for this input path until automatic turn-boundary capture is available. Use single-turn capture for now.';
  }
  if (context.ownerCopy) {
    return context.ownerCopy;
  }
  const ttsCloneStatus = getVoiceTtsCloneStatus(context.referenceClipId, context.referenceClipName);
  if (ttsCloneStatus && context.isSpeaking) {
    return `${ttsCloneStatus} · ${labeledCoachCopy}`;
  }
  return labeledCoachCopy;
}

export function getVoiceInputRuntimePills(
  inputRuntime: VoiceInputRuntimeState,
  options: {
    sourceLabel?: string | null;
    timeLabel?: string | null;
    runtimePill?: string | null;
  } = {},
): string[] {
  const pills: string[] = [];
  if (options.sourceLabel) {
    pills.push(options.sourceLabel);
  }
  if (inputRuntime.lastTranscriptConfidence != null) {
    pills.push(`${Math.round(inputRuntime.lastTranscriptConfidence * 100)}% conf`);
  }
  if (inputRuntime.liveInterimMode) {
    pills.push(`${inputRuntime.liveInterimMode} interim`);
  }
  if (inputRuntime.liveVadStrategy) {
    pills.push(`${inputRuntime.liveVadStrategy} vad`);
  }
  if (inputRuntime.providerModel) {
    pills.push(inputRuntime.providerModel);
  }
  if (inputRuntime.providerEndpointing) {
    pills.push('endpointing');
  }
  if (inputRuntime.lastVadState && inputRuntime.lastVadState !== 'idle') {
    pills.push(`vad ${inputRuntime.lastVadState}`);
  }
  if (inputRuntime.lastSpeechDurationMs != null) {
    pills.push(`${Math.round(inputRuntime.lastSpeechDurationMs)} ms speech`);
  }
  if (inputRuntime.lastAudioProcessedMs != null) {
    pills.push(`${Math.round(inputRuntime.lastAudioProcessedMs)} ms audio`);
  }
  if (inputRuntime.lastBargeInAt) {
    pills.push('barge-in');
  }
  if (inputRuntime.consecutiveNoSpeechTurns >= 2) {
    pills.push(`${inputRuntime.consecutiveNoSpeechTurns}x no speech`);
  }
  if (inputRuntime.consecutiveErrorTurns >= 2) {
    pills.push(`${inputRuntime.consecutiveErrorTurns}x error`);
  }
  if (inputRuntime.effectiveProvider && inputRuntime.effectiveProvider !== inputRuntime.requestedProvider) {
    pills.push('fallback active');
  }
  if (options.runtimePill) {
    pills.push(options.runtimePill);
  }
  if (options.timeLabel) {
    pills.push(options.timeLabel);
  }
  return pills.slice(0, 4);
}

function getVoiceCoachSpeechProviderLabel(provider: 'browser' | 'voxcpm'): string {
  return provider === 'voxcpm' ? 'VoxCPM' : 'Browser';
}

function getVoiceCoachInputProviderLabel(provider: 'browser' | 'backend'): string {
  return provider === 'backend' ? 'Backend' : 'Browser';
}

export function getVoiceCoachControlsViewModel(context: VoiceCoachControlsContext): VoiceCoachControlsViewModel {
  const inputProviderSwitchAllowed = isVoiceCoachInputProviderSwitchAllowed({
    requestedProvider: context.requestedInputProvider,
    browserSpeechRecognitionSupported: context.browserSpeechRecognitionSupported,
  });
  const handsFreeOperational = context.voiceCoachInputAvailable
    && context.handsFreeVoiceInputSupported;

  return {
    handsFreeToggle: {
      text: handsFreeOperational
        ? `Hands-Free: ${context.handsFreeEnabled ? 'On' : 'Off'}`
        : 'Hands-Free: Unavailable',
      disabled: !context.currentSessionId
        || !context.isConnected
        || !handsFreeOperational,
      title: context.inputRecovery.shouldDisableContinuous && context.inputRecovery.disableReason
        ? context.inputRecovery.disableReason
        : !context.handsFreeVoiceInputSupported
          ? 'Hands-free needs an input path that can end turns automatically.'
          : '',
    },
    voiceAskToggle: {
      text: context.voiceSpeechRecognitionStatus === 'waiting' || context.voiceSpeechRecognitionStatus === 'listening'
        ? 'Stop Listening'
        : context.voiceSpeechRecognitionStatus === 'processing'
          ? 'Sending Voice...'
          : context.interactionOwner === 'practice-armed'
            ? 'Talk to Coach (Cancel take)'
            : context.handsFreeEnabled && handsFreeOperational
              ? 'Talk Once'
              : context.voiceCoachInputAvailable
                ? 'Talk to Coach'
                : 'Voice Ask Unavailable',
      disabled: !context.canUseVoiceAsk
        && context.voiceSpeechRecognitionStatus !== 'waiting'
        && context.voiceSpeechRecognitionStatus !== 'listening'
        && context.voiceSpeechRecognitionStatus !== 'processing',
    },
    questionPlaceholder: context.deeptutorGuideActive
      ? 'Ask the coach to slow down, repeat, explain, or decide what you should work on next...'
      : 'Reply or ask the coach — press Enter',
    speechToggle: {
      text: `Speak: ${context.speechEnabled ? 'On' : 'Off'}`,
      disabled: !context.voiceCoachSpeechOutputAvailable,
    },
    speechProviderToggle: {
      text: context.requestedSpeechProvider === 'voxcpm' && context.speechProviderFallbackActive
        ? context.voiceCoachVoxCpmError
          ? 'Voice: VoxCPM (offline)'
          : 'Voice: VoxCPM (fallback)'
        : `Voice: ${getVoiceCoachSpeechProviderLabel(context.requestedSpeechProvider)}`,
      disabled: !context.currentSessionId || !context.isConnected,
      title: context.requestedSpeechProvider === 'voxcpm' && context.voiceCoachVoxCpmError
        ? context.voiceCoachVoxCpmError
        : '',
    },
    inputProviderToggle: {
      text: context.requestedInputProvider === 'backend' && context.inputProviderFallbackActive
        ? context.voiceCoachInputBackendError
          ? 'Input: Backend (offline)'
          : 'Input: Backend (fallback)'
        : context.requestedInputProvider === 'browser' && !context.browserSpeechRecognitionSupported
          ? 'Input: Browser (unsupported)'
          : `Input: ${getVoiceCoachInputProviderLabel(context.requestedInputProvider)}`,
      disabled: !context.currentSessionId || !context.isConnected || !inputProviderSwitchAllowed,
      title: [context.backendInputBaseTitle, context.inputProviderHint]
        .filter(Boolean)
        .join(' ')
        .trim(),
    },
  };
}

export function formatVoiceCoachBackendLiveLabel(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) {
    return null;
  }
  switch (trimmed) {
    case 'buffered':
    case 'buffered-retranscribe':
    case 'auto-buffered':
      return 'buffered live';
    case 'custom-local':
    case 'custom-local-pipeline':
    case 'auto-custom-live':
      return 'custom local live';
    case 'websocket-json':
    case 'provider-websocket':
    case 'auto-live':
      return 'provider live';
    default:
      return trimmed.replace(/[-_]+/g, ' ');
  }
}

export function getVoiceCoachBackendLivePathLabel(
  status: VoiceCoachBackendLiveStatusSnapshot | null | undefined,
): string | null {
  if (!status) {
    return null;
  }
  return formatVoiceCoachBackendLiveLabel(status.actualEngine)
    || formatVoiceCoachBackendLiveLabel(status.actualMode)
    || formatVoiceCoachBackendLiveLabel(status.requestedMode)
    || null;
}

export function getVoiceCoachBackendLiveResolutionSummary(
  status: VoiceCoachBackendLiveStatusSnapshot | null | undefined,
): string | null {
  if (!status) {
    return null;
  }

  const actualParts = [
    formatVoiceCoachBackendLiveLabel(status.actualEngine),
    status.actualInterimMode ? `${formatVoiceCoachBackendLiveLabel(status.actualInterimMode)} interim` : null,
    status.actualVadStrategy ? `${formatVoiceCoachBackendLiveLabel(status.actualVadStrategy)} VAD` : null,
    status.actualProviderModel ? `model ${status.actualProviderModel}` : null,
    status.actualProviderLanguage || null,
    status.actualProviderTarget || null,
    status.actualProviderEndpointing || null,
  ].filter(Boolean);
  const requestedMode = formatVoiceCoachBackendLiveLabel(status.requestedMode);

  if (!status.requestedMode && actualParts.length === 0) {
    return null;
  }
  if (!status.verified) {
    if (status.requestedMode === 'websocket-json') {
      return status.requestedWsUrlConfigured
        ? `Provider live mode is configured${status.requestedProviderTarget ? ` • ${status.requestedProviderTarget}` : ''}${status.requestedModel ? ` • model ${status.requestedModel}` : ''}${status.requestedLanguage ? ` • ${status.requestedLanguage}` : ''}, but not verified yet; buffered mode remains the safe runtime fallback`
        : 'Provider live mode is configured without a websocket URL, so backend input will stay on buffered mode';
    }
    return actualParts.length > 0
      ? `Backend live runtime: ${actualParts.join(' • ')}`
      : null;
  }
  if (requestedMode && status.actualMode && status.requestedMode !== status.actualMode) {
    return `${requestedMode} was requested, but backend input resolved to ${actualParts.join(' • ') || formatVoiceCoachBackendLiveLabel(status.actualMode)}${status.fallbackReason ? ` (${status.fallbackReason})` : ''}`;
  }
  if (actualParts.length > 0) {
    return `Backend live runtime: ${actualParts.join(' • ')}${status.fallbackReason ? ` (${status.fallbackReason})` : ''}`;
  }
  return requestedMode ? `Backend live runtime requested: ${requestedMode}` : null;
}

export function getVoiceCoachInputCapabilitySummary(
  capabilities: VoiceCoachInputCapabilitiesSnapshot | null | undefined,
  liveStatus: VoiceCoachBackendLiveStatusSnapshot | null | undefined = null,
): string {
  if (!capabilities) {
    return 'No live input provider ready.';
  }

  const parts: string[] = [];
  if (capabilities.liveCapture) parts.push('live capture');
  if (capabilities.interimTranscript) parts.push('interim transcript');
  if (capabilities.finalTranscript) parts.push('final transcript');
  if (capabilities.vad) parts.push('VAD');
  if (capabilities.bargeInCancel) parts.push('barge-in cancel');
  const capabilitySummary = parts.length > 0 ? parts.join(', ') : 'No capabilities reported.';
  const liveSummary = getVoiceCoachBackendLiveResolutionSummary(liveStatus);
  return liveSummary ? `${capabilitySummary}. ${liveSummary}` : capabilitySummary;
}

export function getVoiceCoachSupportViewModel(context: VoiceCoachSupportContext): VoiceCoachSupportViewModel {
  const backendLivePathLabel = getVoiceCoachBackendLivePathLabel(context.backendLiveStatus);
  const inputCapabilityCopy = context.requestedInputProvider === 'backend'
    ? `Input runtime: ${getVoiceCoachInputCapabilitySummary(context.backendInputCapabilities, context.backendLiveStatus)}.`
    : context.effectiveInputCapabilities
      ? `Input runtime: ${getVoiceCoachInputCapabilitySummary(context.effectiveInputCapabilities)}.`
      : null;
  const voxcpmFallbackReason = context.requestedSpeechProvider === 'voxcpm' && context.speechProviderFallbackActive
    ? context.voiceCoachVoxCpmError
      ? `VoxCPM is selected for tutor speech, but it is currently unavailable (${context.voiceCoachVoxCpmError}). Browser speech is handling playback.`
      : !context.currentSessionId || !context.isConnected
        ? 'VoxCPM is selected for tutor speech. Browser speech is handling playback until the session is connected.'
        : !context.voiceCoachVoxCpmEnabled
          ? 'VoxCPM is selected for tutor speech, but the backend provider is disabled. Browser speech is handling playback.'
          : 'VoxCPM is selected for tutor speech. Browser speech is handling playback while the backend provider is unavailable.'
    : null;
  const inputProviderFallbackReason = context.requestedInputProvider === 'backend' && context.inputProviderFallbackActive
    ? context.voiceCoachInputBackendError
      ? `Backend input is selected, but it is currently unavailable (${context.voiceCoachInputBackendError}). Browser speech recognition is capturing the turn.`
      : !context.currentSessionId || !context.isConnected
        ? 'Backend input is selected. Browser speech recognition is capturing turns until the session is connected.'
        : !context.voiceCoachInputBackendEnabled
          ? 'Backend input is selected, but the server-side ASR provider is disabled. Browser speech recognition is capturing turns.'
          : !context.canUseBackendVoiceCoachCapture
            ? 'Backend input is selected, but this browser cannot record audio for the server ASR path. Browser speech recognition is capturing turns instead.'
            : 'Backend input is selected. Browser speech recognition is handling this turn while the runtime input provider is unavailable.'
    : null;
  const backendLiveResolutionCopy = getVoiceCoachBackendLiveResolutionSummary(context.backendLiveStatus);
  const backendInputBaseTitle = context.requestedInputProvider === 'backend'
    ? context.voiceCoachInputBackendError
      || (!context.canUseBackendVoiceCoachCapture
        ? 'This browser cannot record audio for backend ASR capture.'
        : backendLiveResolutionCopy || '')
    : !context.browserSpeechRecognitionSupported
      ? 'Browser speech recognition is unavailable in this browser. Switch to backend input to keep voice asking available.'
      : '';

  return {
    backendLivePathLabel,
    inputCapabilityCopy,
    inputProviderFallbackReason,
    voxcpmFallbackReason,
    backendInputBaseTitle,
  };
}

export function getVoiceInputRuntimeStatusLabel(status: VoiceInputRuntimeState['status']): string {
  switch (status) {
    case 'waiting':
      return 'Waiting';
    case 'listening':
      return 'Listening';
    case 'processing':
      return 'Processing';
    case 'error':
      return 'Error';
    default:
      return 'Idle';
  }
}

export function getVoiceInputRuntimeSourceLabel(source: string | null): string | null {
  switch (source) {
    case 'backend-asr':
      return 'backend ASR';
    case 'backend-live-asr':
      return 'buffered live ASR';
    case 'backend-live-custom':
      return 'custom live ASR';
    case 'backend-live-provider':
      return 'provider live ASR';
    case 'backend-live-partial':
      return 'buffered live partial';
    case 'browser-fallback':
      return 'browser fallback';
    case 'browser-speech-recognition':
      return 'browser ASR';
    default:
      return source ? source.replace(/[-_]+/g, ' ') : null;
  }
}

export function formatVoiceInputRuntimeTime(value: number | null): string | null {
  if (!value) {
    return null;
  }
  return new Date(value).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function getVoiceInputRuntimeProviderMeta(runtime: VoiceInputRuntimeState): string | null {
  const parts = [
    runtime.providerModel ? `model ${runtime.providerModel}` : null,
    runtime.providerLanguage ? runtime.providerLanguage : null,
    runtime.providerTarget ? runtime.providerTarget : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' • ') : null;
}

export function getVoiceInputRuntimeProviderText(runtime: VoiceInputRuntimeState): string {
  const requested = getVoiceCoachInputProviderLabel(runtime.requestedProvider);
  const effective = runtime.effectiveProvider
    ? getVoiceCoachInputProviderLabel(runtime.effectiveProvider)
    : requested;
  const styleParts = [...new Set(
    [runtime.providerStyle, runtime.liveEngine].flatMap((value) => {
      const formatted = formatVoiceCoachBackendLiveLabel(value);
      return formatted ? [formatted] : [];
    }),
  )];
  const style = styleParts.length > 0 ? ` • ${styleParts.join(' • ')}` : '';
  if (runtime.effectiveProvider && runtime.effectiveProvider !== runtime.requestedProvider) {
    return `${requested} -> ${effective}${style}`;
  }
  return `${effective}${style}`;
}

export function getVoiceInputRuntimeLatencyText(runtime: VoiceInputRuntimeState): string {
  const parts: string[] = [];
  if (runtime.lastCaptureDurationMs != null) {
    parts.push(`cap ${runtime.lastCaptureDurationMs}ms`);
  }
  if (runtime.lastAudioProcessedMs != null) {
    parts.push(`audio ${runtime.lastAudioProcessedMs}ms`);
  }
  if (runtime.lastRoundTripMs != null) {
    parts.push(`rt ${runtime.lastRoundTripMs}ms`);
  }
  return parts.length > 0 ? parts.join(' • ') : '--';
}

function trimVoiceInputRuntimeText(value: string | null | undefined, maxLength = 72): string | null {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) {
    return null;
  }
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1).trimEnd()}…`;
}

export function getVoiceInputRuntimeEvidenceSummary(
  runtime: VoiceInputRuntimeState,
  options: {
    backendLivePathLabel?: string | null;
  } = {},
): string | null {
  const sourceLabel = getVoiceInputRuntimeSourceLabel(runtime.transcriptSource)
    || formatVoiceCoachBackendLiveLabel(runtime.liveEngine)
    || options.backendLivePathLabel
    || null;
  const speechDuration = runtime.lastSpeechDurationMs != null
    ? `${Math.round(runtime.lastSpeechDurationMs)} ms speech`
    : null;
  if (runtime.lastPartialTranscript && (runtime.status === 'waiting' || runtime.status === 'listening' || runtime.status === 'processing')) {
    const partial = trimVoiceInputRuntimeText(runtime.lastPartialTranscript, 64);
    return partial
      ? `Heard so far: "${partial}"${sourceLabel ? ` • ${sourceLabel}` : ''}${speechDuration ? ` • ${speechDuration}` : ''}.`
      : null;
  }
  if (runtime.lastTranscript) {
    const transcript = trimVoiceInputRuntimeText(runtime.lastTranscript);
    return transcript
      ? `Last spoken turn: "${transcript}"${sourceLabel ? ` • ${sourceLabel}` : ''}${speechDuration ? ` • ${speechDuration}` : ''}.`
      : null;
  }
  if (runtime.lastAnalysisSummary) {
    return `Input evidence: ${runtime.lastAnalysisSummary}.`;
  }
  if (runtime.status === 'error' && runtime.lastError) {
    return `Spoken input failed${sourceLabel ? ` on ${sourceLabel}` : ''}.`;
  }
  if ((runtime.lastOutcome === 'no-speech' || runtime.noSpeechTurns > 0) && runtime.lastProcessedAt) {
    return `Last spoken turn ended with no speech${sourceLabel ? ` on ${sourceLabel}` : ''}.`;
  }
  if (runtime.liveSessionId && runtime.status !== 'idle') {
    return `${sourceLabel || 'Backend live input'} is armed for the next spoken turn.`;
  }
  return null;
}

export function getVoiceInputRuntimeCopy(runtime: VoiceInputRuntimeState): string {
  const sourceLabel = getVoiceInputRuntimeSourceLabel(runtime.transcriptSource);
  const processedAt = formatVoiceInputRuntimeTime(runtime.lastProcessedAt || runtime.lastEventAt);
  const providerMeta = getVoiceInputRuntimeProviderMeta(runtime);
  if (runtime.status === 'error' && runtime.lastError) {
    return runtime.lastError;
  }
  if (runtime.lastPartialTranscript && (runtime.status === 'waiting' || runtime.status === 'listening' || runtime.status === 'processing')) {
    const partial = trimVoiceInputRuntimeText(runtime.lastPartialTranscript, 96);
    if (partial) {
      return `${sourceLabel ? `${sourceLabel} • ` : ''}${partial}${providerMeta ? ` • ${providerMeta}` : ''}${processedAt ? ` • ${processedAt}` : ''}`;
    }
  }
  if (runtime.lastTranscript) {
    const transcript = trimVoiceInputRuntimeText(runtime.lastTranscript, 96);
    if (transcript) {
      return `${sourceLabel ? `${sourceLabel} • ` : ''}${transcript}${providerMeta ? ` • ${providerMeta}` : ''}${processedAt ? ` • ${processedAt}` : ''}`;
    }
  }
  if (runtime.lastAnalysisSummary) {
    return `${runtime.lastAnalysisSummary}${providerMeta ? ` • ${providerMeta}` : ''}${processedAt ? ` • ${processedAt}` : ''}`;
  }
  if (runtime.noSpeechTurns > 0 && runtime.lastProcessedAt) {
    return `Last turn ended with no speech${sourceLabel ? ` • ${sourceLabel}` : ''}${providerMeta ? ` • ${providerMeta}` : ''}${processedAt ? ` • ${processedAt}` : ''}.`;
  }
  if (runtime.liveSessionId && runtime.status !== 'idle') {
    return `${sourceLabel || 'Backend live input'} is armed and waiting for the next spoken turn${providerMeta ? ` • ${providerMeta}` : ''}.`;
  }
  return 'No spoken coach turn has been recorded through the runtime yet.';
}

export function getVoiceInputRuntimeViewModel(
  runtime: VoiceInputRuntimeState,
  options: {
    backendLivePathLabel?: string | null;
    runtimePill?: string | null;
  } = {},
): VoiceInputRuntimeViewModel {
  const sourceLabel = getVoiceInputRuntimeSourceLabel(runtime.transcriptSource);
  const timeLabel = formatVoiceInputRuntimeTime(runtime.lastEventAt || runtime.lastProcessedAt);
  return {
    statusText: getVoiceInputRuntimeStatusLabel(runtime.status),
    providerText: getVoiceInputRuntimeProviderText(runtime),
    latencyText: getVoiceInputRuntimeLatencyText(runtime),
    countsText: `${runtime.successfulTurns} ok • ${runtime.noSpeechTurns} no speech${runtime.errorCount > 0 ? ` • ${runtime.errorCount} err` : ''}`,
    copyText: getVoiceInputRuntimeCopy(runtime),
    evidenceSummary: getVoiceInputRuntimeEvidenceSummary(runtime, {
      backendLivePathLabel: options.backendLivePathLabel,
    }),
    pills: getVoiceInputRuntimePills(runtime, {
      sourceLabel,
      timeLabel,
      runtimePill: options.runtimePill,
    }),
  };
}

export function getVoiceReferenceMimicState(context: {
  voiceUiState: VoiceUiState;
  comparison: VoicePhraseComparison | null;
}): VoiceReferenceMimicState {
  const { voiceUiState, comparison } = context;
  const referenceLoaded = Boolean(voiceUiState.referenceClipName);
  if (!referenceLoaded) {
    return {
      action: 'load',
      statusLabel: 'No target',
      instruction: 'Load a mimic target to compare your live shape against the reference trail.',
      suggestedRepeats: null,
      metrics: [],
    };
  }

  const deeptutorVoiceState = normalizeDeepTutorVoiceState(voiceUiState.deeptutorVoiceState);
  const lessonBoard = deeptutorVoiceState.lessonBoard;
  const measurementRejected = Boolean(voiceUiState.lastSummary?.metrics)
    && !isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary?.metrics);
  const targetHitPct = measurementRejected ? null : voiceUiState.lastSummary?.metrics?.targetHitPct ?? null;
  const pathMatch = measurementRejected ? null : comparison?.pathMatchScore ?? null;
  const laneMatch = measurementRejected ? null : comparison?.laneMatchScore ?? null;
  const contourMatch = measurementRejected ? null : comparison?.contourMatchScore ?? null;
  const metrics = [
    Number.isFinite(pathMatch) ? `Path ${Math.round(pathMatch! * 100)}%` : null,
    Number.isFinite(laneMatch) ? `Lane ${Math.round(laneMatch! * 100)}%` : null,
    Number.isFinite(contourMatch) ? `Contour ${Math.round(contourMatch! * 100)}%` : null,
    Number.isFinite(targetHitPct) ? `Zone ${Math.round(targetHitPct! * 100)}%` : null,
  ].filter(Boolean) as string[];
  const hasComparisonWitness = [pathMatch, laneMatch, contourMatch, targetHitPct]
    .some((value) => typeof value === 'number' && Number.isFinite(value));
  if (measurementRejected) {
    return {
      action: 'repeat',
      statusLabel: 'Measure again',
      instruction: 'That take did not contain enough reliable voiced audio to compare. Check the input and record another pass.',
      suggestedRepeats: 1,
      metrics: [],
    };
  }
  if (voiceUiState.lastSummary && !hasComparisonWitness) {
    return {
      action: 'ready',
      statusLabel: 'No comparison',
      instruction: 'Record a mimic pass before treating the reference as matched.',
      suggestedRepeats: null,
      metrics: [],
    };
  }
  const structuredDirective = lessonBoard?.mimicDirective;
  if (structuredDirective) {
    return {
      action: structuredDirective.action,
      statusLabel: structuredDirective.statusLabel || 'Reference target',
      instruction: structuredDirective.instruction || 'Follow the current reference instruction before asking the tutor to advance.',
      suggestedRepeats: structuredDirective.suggestedRepeats,
      metrics,
    };
  }

  const tutorDirective = [
    lessonBoard?.instruction,
    lessonBoard?.latestNote,
    deeptutorVoiceState.lastTutorMessage,
    deeptutorVoiceState.currentKnowledge?.summary,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tutorWantsMimic = /\bmimic\b|\breference\b|\btrail\b|\bcopy\b|\bshadow\b|\bmatch\b/.test(tutorDirective);

  if (!voiceUiState.lastSummary) {
    return {
      action: tutorWantsMimic ? 'mimic' : 'ready',
      statusLabel: tutorWantsMimic ? 'Tutor says mimic' : 'Target ready',
      instruction: tutorWantsMimic
        ? 'Tutor is pointing you at the reference target first. Replay it and copy the trail before moving on.'
        : 'Reference target is ready. Stay in spoken coaching until the tutor asks for a mimic pass.',
      suggestedRepeats: tutorWantsMimic ? 2 : null,
      metrics,
    };
  }

  if (
    tutorWantsMimic
    || (Number.isFinite(pathMatch) && pathMatch! < 0.62)
    || (Number.isFinite(targetHitPct) && targetHitPct! < 0.5)
  ) {
    const repeats = Number.isFinite(pathMatch) && pathMatch! < 0.48 ? 3 : 2;
    return {
      action: 'mimic',
      statusLabel: 'Mimic now',
      instruction: `Replay the target and copy the reference trail for ${repeats} passes before asking the tutor to advance.`,
      suggestedRepeats: repeats,
      metrics,
    };
  }

  if (
    (Number.isFinite(pathMatch) && pathMatch! < 0.78)
    || (Number.isFinite(targetHitPct) && targetHitPct! < 0.66)
  ) {
    return {
      action: 'repeat',
      statusLabel: 'One more pass',
      instruction: 'Do one more mimic pass to tighten the trail match, then return to the tutor conversation.',
      suggestedRepeats: 1,
      metrics,
    };
  }

  return {
    action: 'hold',
    statusLabel: 'Target aligned',
    instruction: 'Reference match is holding. Stay on tutor-led coaching unless the coach calls for another mimic pass.',
    suggestedRepeats: null,
    metrics,
  };
}

export function getVoiceReferenceMimicProgressState(
  deeptutorVoiceStateValue: Partial<DeepTutorVoiceState> | null | undefined,
  referenceMimicState: VoiceReferenceMimicState,
): VoiceReferenceMimicProgressState | null {
  const deeptutorVoiceState = normalizeDeepTutorVoiceState(deeptutorVoiceStateValue);
  const targetKey = deeptutorVoiceState.lessonBoard?.mimicDirective?.targetKey || null;
  if (!targetKey) {
    return null;
  }

  const existing = deeptutorVoiceState.mimicProgress?.targetKey === targetKey
    ? deeptutorVoiceState.mimicProgress
    : null;
  const suggestedRepeats = Math.max(referenceMimicState.suggestedRepeats || existing?.targetRepeats || 1, 1);
  const shouldShow = Boolean(
    existing
    || referenceMimicState.action === 'mimic'
    || referenceMimicState.action === 'repeat',
  );
  if (!shouldShow) {
    return null;
  }

  const targetRepeats = Math.max(existing?.targetRepeats || 0, suggestedRepeats);
  const completedRepeats = Math.min(existing?.completedRepeats || 0, targetRepeats);
  const remainingRepeats = Math.max(targetRepeats - completedRepeats, 0);
  return {
    completedRepeats,
    targetRepeats,
    remainingRepeats,
    progressLabel: remainingRepeats > 0
      ? `${completedRepeats}/${targetRepeats} passes`
      : `Set complete ${completedRepeats}/${targetRepeats}`,
  };
}

export function getVoiceActiveDrillStateLabel(context: VoiceActiveDrillStateContext): string {
  const deeptutorVoiceState = normalizeDeepTutorVoiceState(context.voiceUiState.deeptutorVoiceState);
  const lessonMode = getDeepTutorVoiceLessonMode(deeptutorVoiceState);
  const runtimeOwner = resolveDeepTutorVoiceRuntimeOwner(deeptutorVoiceState);
  if (context.voiceDeepTutorLessonStatus === 'loading') {
    return 'Tutor syncing';
  }
  if (runtimeOwner === 'listening') {
    return lessonMode === 'active' ? 'Realtime coach listening' : 'Tutor listening';
  }
  if (runtimeOwner === 'evaluating') {
    return 'DeepTutor reviewing';
  }
  if (runtimeOwner === 'warming') {
    return 'DeepTutor warming';
  }
  if (runtimeOwner === 'planning') {
    return 'DeepTutor planning';
  }
  if (runtimeOwner === 'paused') {
    return 'Tutor paused';
  }
  if (context.voiceCoachTaskStatus === 'running') {
    return 'Coach reviewing';
  }
  if (context.voiceTakeProcessing) {
    return 'Scoring';
  }
  if (context.voiceTakeActive) {
    return 'Recording';
  }
  if (context.voiceTransportStatus === 'streaming') {
    return 'Armed';
  }
  if (context.voiceTransportStatus === 'connecting' || context.voiceTransportStatus === 'requesting-mic') {
    return 'Arming';
  }
  if (context.inputRecovery.statusLabel) {
    return context.inputRecovery.statusLabel;
  }
  if (context.voiceUiState.status === 'ended' && context.voiceUiState.lastSummary) {
    return 'Reviewed';
  }
  if (context.voiceUiState.voiceSessionId || context.voiceSessionArmed) {
    return 'Ready';
  }
  return 'Standby';
}

export function getVoiceActiveDrillCopyText(context: VoiceActiveDrillCopyContext): string {
  const deeptutorLessonBoard = normalizeDeepTutorVoiceState(context.voiceUiState.deeptutorVoiceState).lessonBoard;
  const activeLine = getVoiceActiveLine(context.voiceUiState);

  if (context.referenceMimicState.action === 'mimic' || context.referenceMimicState.action === 'repeat') {
    if (context.voiceSessionArmed || context.voiceTransportStatus === 'streaming') {
      return 'Practice is armed. Hold to record your next pass, then review the result.';
    }
    return `${context.referenceMimicState.instruction}${context.referenceMimicProgress
      ? ` ${context.referenceMimicProgress.remainingRepeats > 0 ? `${context.referenceMimicProgress.remainingRepeats === 1 ? '1 more pass' : `${context.referenceMimicProgress.remainingRepeats} more passes`} to log.` : ' Mimic set logged — ask for another line when ready.'}`
      : ''}`;
  }

  if (context.inputRecovery.activeDrillCopy) {
    return context.inputRecovery.activeDrillCopy;
  }

  const baseCopy = context.voiceSpeechRecognitionStatus === 'waiting' || context.voiceSpeechRecognitionStatus === 'listening'
    ? 'Coach is listening in the background. Ask for help, then jump back into practice.'
    : deeptutorLessonBoard?.instruction
      || deeptutorLessonBoard?.latestNote
      || (activeLine?.displayText
        ? `Say "${activeLine.displayText}" with the sound spelling underneath, then finish a pass for a simple next step.`
        : 'Focus on one line at a time: speak, review, adjust, repeat.');
  const evidenceCopy = getVoiceInputRuntimeEvidenceSummary(context.inputRuntime, {
    backendLivePathLabel: context.backendLivePathLabel,
  });
  return evidenceCopy ? `${baseCopy} ${evidenceCopy}` : baseCopy;
}

export function getVoiceScriptPadViewModel({
  voiceUiState,
  voiceDrillState,
}: Pick<VoiceViewModelContext, 'voiceUiState' | 'voiceDrillState'>): VoiceScriptPadViewModel {
  const deeptutorVoiceState = normalizeDeepTutorVoiceState(voiceUiState.deeptutorVoiceState);
  const lessonBoard = deeptutorVoiceState.lessonBoard;
  const deeptutorLessonMode = getDeepTutorVoiceLessonMode(deeptutorVoiceState);
  const deeptutorGuideActive = deeptutorLessonMode === 'active';
  const hasLessonBoardContext = deeptutorLessonMode !== 'none';
  const activeLine = getVoiceActiveLine(voiceUiState);
  const cueSheet = getCurrentVoiceCueSheet({ voiceUiState, voiceDrillState });
  const meta = getVoiceActiveLineMeta(voiceUiState);
  const cueChips = getVoicePrimaryCueChips({ voiceUiState, voiceDrillState });

  const lessonMeta = hasLessonBoardContext
    ? [
        lessonBoard?.title ? { label: 'Lesson', value: lessonBoard.title } : null,
        lessonBoard?.progressLabel ? { label: 'Progress', value: lessonBoard.progressLabel } : null,
        lessonBoard?.difficultyNote ? { label: 'Difficulty', value: lessonBoard.difficultyNote } : null,
        deeptutorVoiceState.currentKnowledge?.difficulty ? { label: 'Knowledge', value: deeptutorVoiceState.currentKnowledge.difficulty } : null,
      ].filter(Boolean) as VoiceLineMeta[]
    : meta;
  const lessonNote = lessonBoard?.latestNote
    || deeptutorVoiceState.lastTutorMessage
    || lessonBoard?.instruction
    || deeptutorVoiceState.currentKnowledge?.summary
    || '';

  return {
    labelText: deeptutorGuideActive
      ? 'Guided line'
      : hasLessonBoardContext
        ? 'Last guided line'
        : 'Practice line',
    lineText: lessonBoard?.prompt
      || activeLine?.displayText
      || cueSheet?.phrase
      || 'Waiting for your first line...',
    performanceText: lessonBoard?.performanceText
      || activeLine?.performanceText
      || cueSheet?.styledCueLine
      || cueSheet?.cueLine
      || 'Load a line to see how the target delivery should sound.',
    metaPills: lessonMeta.length === 0
      ? [`Difficulty: ${voiceUiState.lineDifficultyPreference}`]
      : lessonMeta.map((item) => `${item.label}: ${item.value}`),
    cuePills: cueChips.length === 0 ? ['Waiting for cue focus…'] : cueChips,
    lessonNote,
    showLessonNote: Boolean(lessonNote),
    showLessonActions: hasLessonBoardContext || voiceUiState.advancedPanel.open,
    showLineActions: !deeptutorGuideActive,
  };
}

export function getVoiceCoachChannelLabel(channel: VoiceCoachMessageChannel | null | undefined): string {
  if (channel === 'runtime') {
    return 'Realtime Coach';
  }
  if (channel === 'shortcut') {
    return 'Coach Shortcut';
  }
  if (channel === 'deeptutor') {
    return 'DeepTutor';
  }
  return 'Coach';
}

export function getVoiceCoachMessageLabel(
  message: VoiceCoachMessage | null,
  options: { hasActiveGuideSession: boolean },
): string {
  if (!message) {
    return options.hasActiveGuideSession ? 'DeepTutor' : 'Coach';
  }
  if (message.role === 'user') {
    return 'You';
  }
  return getVoiceCoachChannelLabel(message.channel || resolveVoiceCoachMessageChannel(message.kind));
}

export function getVoiceCoachThreadViewModel(context: {
  coachThread: VoiceCoachMessage[] | null | undefined;
  voiceCoachTaskStatus: VoiceCoachTaskStatus;
  voiceCoachQuestionStatus: VoiceCoachQuestionStatus;
  pendingCoachChannel: VoiceCoachMessageChannel | null;
  hasActiveGuideSession: boolean;
  emptyCopy: string;
}): VoiceCoachThreadViewModel {
  const bubbles = (Array.isArray(context.coachThread) ? context.coachThread : []).map((message) => ({
    role: (message.role === 'user' ? 'user' : 'coach') as 'coach' | 'user',
    label: getVoiceCoachMessageLabel(message, { hasActiveGuideSession: context.hasActiveGuideSession }),
    content: message.content,
  }));

  const pendingBubble = context.voiceCoachTaskStatus === 'running' || context.voiceCoachQuestionStatus === 'sending'
    ? {
        role: 'coach' as const,
        label: context.pendingCoachChannel
          ? getVoiceCoachChannelLabel(context.pendingCoachChannel)
          : (context.hasActiveGuideSession ? 'DeepTutor' : 'Coach'),
        content: context.voiceCoachTaskStatus === 'running'
          ? 'Reading the take and building the next note...'
          : 'Thinking through your follow-up...',
      }
    : null;

  return {
    emptyCopy: bubbles.length === 0 ? context.emptyCopy : null,
    bubbles,
    pendingBubble,
  };
}

export function getVoiceReferenceViewModel(context: {
  voiceUiState: VoiceUiState;
  referenceMimicState: VoiceReferenceMimicState;
  referenceMimicProgress: VoiceReferenceMimicProgressState | null;
  referenceHydrationFailed: boolean;
  referenceHydrationError: string | null;
  referenceHydrationInFlight: boolean;
  hasPlayableReference: boolean;
  hasReferencePath: boolean;
  referencePlayerPaused: boolean;
}): VoiceReferenceViewModel {
  const summaryText = context.voiceUiState.referenceClipName
    ? `${context.voiceUiState.referenceClipName}${context.voiceUiState.referenceAnalysis?.durationMs ? ` • ${(context.voiceUiState.referenceAnalysis.durationMs / 1000).toFixed(1)}s` : ''}`
    : 'Drop in a target clip to compare your resonance and pitch path.';
  const playbackCopyText = context.voiceUiState.referenceClipName
    ? context.referenceHydrationFailed && !context.hasReferencePath
      ? `${context.referenceMimicState.instruction} Playback is restored, but the saved reference path could not be reloaded${context.referenceHydrationError ? ` (${context.referenceHydrationError})` : '.'}`
      : context.referenceHydrationInFlight && !context.hasReferencePath
        ? `${context.referenceMimicState.instruction} Restoring the saved reference path and metrics…`
        : context.hasPlayableReference
          ? context.referencePlayerPaused
            ? `${context.referenceMimicState.instruction} Press play to hear the mimic target and sweep the ghost dot through the reference trajectory.`
            : `Mimic target playing. Ghost dot following the reference path in real time. ${context.referenceMimicState.instruction}`
          : `${context.referenceMimicState.instruction} Restoring saved reference playback…`
    : context.referenceMimicState.instruction;

  return {
    summaryText,
    playbackCopyText,
    showPlayer: context.hasPlayableReference,
    mimicPills: [
      context.referenceMimicState.statusLabel,
      context.referenceMimicState.suggestedRepeats
        ? `${context.referenceMimicState.suggestedRepeats} repeat${context.referenceMimicState.suggestedRepeats === 1 ? '' : 's'}`
        : null,
      context.referenceMimicProgress?.progressLabel || null,
      ...context.referenceMimicState.metrics.slice(0, 4),
    ].filter(Boolean) as string[],
  };
}

function getVoiceCustomPresetDraftLibraryEntry(voiceUiState: VoiceUiState) {
  if (!voiceUiState.customTargetPresetDraft.presetId) {
    return null;
  }
  return voiceUiState.customTargetPresets.find((preset) => preset.id === voiceUiState.customTargetPresetDraft.presetId) || null;
}

function hasVoiceCustomPresetDraftWorkspaceContent(voiceUiState: VoiceUiState): boolean {
  const draft = voiceUiState.customTargetPresetDraft;
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

function getVoiceTargetSourceLabel(voiceUiState: VoiceUiState): string {
  switch (voiceUiState.targetSource) {
    case 'reference':
      return 'temporary reference';
    case 'custom-reference':
      return 'saved custom reference';
    case 'custom-handmade':
      return 'handmade custom target';
    default:
      return 'built-in preset';
  }
}

function getVoiceTargetDisplayName(voiceUiState: VoiceUiState): string {
  return voiceUiState.selectedCustomPresetName
    || voiceUiState.targetVoiceProfile?.sourceFilename
    || voiceUiState.targetPreset
    || 'cute-feminine';
}

function formatVoiceSelfReportSelectValue(value: number | null | undefined): string {
  return value != null && Number.isFinite(Number(value))
    ? String(Math.round(Number(value)))
    : '';
}

function formatVoiceSelfReportParts(report: VoiceSelfReport | null): string[] {
  if (!report) {
    return [];
  }
  return [
    report.effort != null && Number.isFinite(Number(report.effort)) ? `effort ${Math.round(Number(report.effort))}/5` : null,
    report.strain != null && Number.isFinite(Number(report.strain)) ? `strain ${Math.round(Number(report.strain))}/5` : null,
    report.fatigue != null && Number.isFinite(Number(report.fatigue)) ? `fatigue ${Math.round(Number(report.fatigue))}/5` : null,
    report.perceivedDifficulty != null && Number.isFinite(Number(report.perceivedDifficulty)) ? `difficulty ${Math.round(Number(report.perceivedDifficulty))}/5` : null,
    report.confidence != null && Number.isFinite(Number(report.confidence)) ? `confidence ${Math.round(Number(report.confidence))}/5` : null,
  ].filter(Boolean) as string[];
}

function normalizeVoiceSafetyMetric(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : null;
}

function getVoiceSafetyThreshold(ceiling: unknown, offset: number, fallback: number): number {
  const normalizedCeiling = normalizeVoiceSafetyMetric(ceiling);
  return normalizedCeiling != null
    ? Math.min(fallback, normalizedCeiling + offset)
    : fallback;
}

const VOICE_VOCALISE_KINDS = new Set(['sustained', 'hum_sovt', 'siren']);

function getVoiceRuntimeTakeKind(voiceUiState: VoiceUiState): string {
  const contexts = [
    voiceUiState.repContext,
    voiceUiState.lastAttemptArtifact?.repContext,
  ];
  for (const context of contexts) {
    const directKind = String(context?.drill?.kind || context?.kind || '').trim().toLowerCase();
    if (directKind) return directKind;
    const tags = Array.isArray(context?.drill?.tags) ? context.drill.tags : context?.tags;
    const taggedKind = Array.isArray(tags)
      ? tags.map((tag) => String(tag || '').trim().toLowerCase()).find((tag) => VOICE_VOCALISE_KINDS.has(tag))
      : null;
    if (taggedKind) return taggedKind;
    const drillId = String(context?.drill?.id || context?.drillId || '').trim().toLowerCase();
    const inferred = [...VOICE_VOCALISE_KINDS].find((kind) => drillId.includes(kind.replace('_', '-')) || drillId.includes(kind));
    if (inferred) return inferred;
  }
  const lessonId = String(voiceUiState.lessonId || '').trim().toLowerCase();
  return [...VOICE_VOCALISE_KINDS].find((kind) => lessonId.includes(kind.replace('_', '-')) || lessonId.includes(kind))
    || 'phrase';
}

function hasVoiceRuntimeSafetyHold(voiceUiState: VoiceUiState): boolean {
  const lastReport = normalizeVoiceSelfReport(voiceUiState.lastAttemptArtifact?.selfReport);
  if (lastReport && (Number(lastReport.strain) >= 4 || Number(lastReport.fatigue) >= 4)) {
    return true;
  }

  const summary = voiceUiState.lastSummary || voiceUiState.lastAttemptArtifact?.summary || null;
  const advancedMetrics = summary?.metrics?.advanced || null;
  const quality = advancedMetrics?.quality || null;
  const qualityBands = voiceUiState.targetVoiceProfile?.advancedBands?.quality || null;
  const phraseQuality = voiceUiState.phraseComparison?.analysisQuality || null;
  const inputRuntime = normalizeVoiceInputRuntimeState(voiceUiState.voiceInputRuntime);
  const strainRisk = normalizeVoiceSafetyMetric(quality?.strainRisk);
  const breathyRisk = normalizeVoiceSafetyMetric(quality?.breathyRisk);
  const captureReliability = normalizeVoiceSafetyMetric(
    advancedMetrics?.captureReliability ?? inputRuntime.lastCaptureReliability,
  );
  const snrValue = advancedMetrics?.snrDb ?? inputRuntime.lastSnrDb;
  const snrDb = snrValue != null && Number.isFinite(Number(snrValue))
    ? Number(snrValue)
    : null;
  const clippingPct = normalizeVoiceSafetyMetric(
    advancedMetrics?.clippingPct ?? inputRuntime.lastClippingPct,
  );
  const phraseScoreConfidence = normalizeVoiceSafetyMetric(phraseQuality?.scoreConfidence);
  const inputConfidence = normalizeVoiceSafetyMetric(inputRuntime.lastTranscriptConfidence);
  const secondStrike = Number(voiceUiState.strainWatch?.recentFlags || 0) >= 2;
  const strainWarn = getVoiceSafetyThreshold(qualityBands?.strainRiskCeiling, 0.1, 0.52);
  const strainStop = getVoiceSafetyThreshold(qualityBands?.strainRiskCeiling, 0.24, 0.7);
  const takeKind = getVoiceRuntimeTakeKind(voiceUiState);
  const vocaliseWarn = Math.max(strainWarn, Math.min(strainStop - 0.02, strainWarn + 0.1));
  const resolvedStrainWarn = VOICE_VOCALISE_KINDS.has(takeKind) ? vocaliseWarn : strainWarn;
  // Floored in lockstep with backend safety-thresholds.js BREATHY_WARN_FLOOR:
  // a tight profile ceiling must not drop the UI's breathy bar below the
  // estimator's noise floor while the coach holds at 0.45.
  const breathyWarn = Math.max(0.45, getVoiceSafetyThreshold(qualityBands?.breathyRiskCeiling, 0.12, 0.68));

  return Boolean(
    (summary?.metrics && !isVoiceAttemptMeasurementUsable(summary.metrics))
    || (strainRisk != null && strainRisk >= strainStop)
    || (secondStrike && strainRisk != null && strainRisk >= resolvedStrainWarn)
    || (secondStrike && breathyRisk != null && breathyRisk >= breathyWarn)
    || (snrDb != null && snrDb < 12)
    // Sustained clipping only (2026-07-19) — mirrors safety-gates.js: 0.1% fired
    // on a single hot plosive; 2% is a genuinely hot consumer mic, 2.5x under
    // the reference clone-gate's 5% reject bar.
    || (clippingPct != null && clippingPct >= 0.02)
    || (captureReliability != null && captureReliability < 0.5)
    || phraseQuality?.reliable === false
    || (phraseScoreConfidence != null && phraseScoreConfidence < 0.45)
    || (inputConfidence != null && inputConfidence < 0.4)
    || inputRuntime.lastOutcome === 'no-speech'
    || inputRuntime.lastOutcome === 'error'
    || inputRuntime.consecutiveNoSpeechTurns >= 2
    || inputRuntime.consecutiveErrorTurns >= 1
    || Boolean(inputRuntime.lastError)
  );
}

function getVoiceSelfReportCopyText(voiceUiState: VoiceUiState): string {
  const draftReport = normalizeVoiceSelfReport(voiceUiState.selfReportDraft);
  const draftParts = formatVoiceSelfReportParts(draftReport);
  if (draftParts.length > 0) {
    return `Will log with the next completed take: ${draftParts.join(' • ')}.`;
  }

  const lastReport = normalizeVoiceSelfReport(voiceUiState.lastAttemptArtifact?.selfReport);
  const lastParts = formatVoiceSelfReportParts(lastReport);
  if (lastParts.length > 0) {
    return `Last logged take report: ${lastParts.join(' • ')}.`;
  }

  return 'Optional. Set ratings for the next completed take; blank fields are not logged.';
}

/** Per-stage 'do this next' guidance shown under the session spine. */
function getVoiceSpineHintText(stage: VoiceSessionStage): string {
  switch (stage) {
    case 'warmup':
      return 'Upload the voice you want to move toward.';
    case 'target':
      return 'Load a reference clip, then arm practice.';
    case 'practice':
      return 'Read the line; arm practice and speak.';
    case 'review':
      return 'Review your takes, then start the next line.';
    default:
      return 'Upload the voice you want to move toward.';
  }
}

function formatVoicePercentValue(value: number | null | undefined): string | null {
  return value != null && Number.isFinite(Number(value))
    ? `${Math.round(Number(value) * 100)}%`
    : null;
}

/** Max targetHitPct across this session's takes (+ lastSummary), as a fraction. */
function getVoiceBestTargetHitPct(voiceUiState: VoiceUiState): number | null {
  const candidates: number[] = [];
  const lastSummaryHit = voiceUiState.lastSummary?.metrics?.targetHitPct;
  if (
    isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary?.metrics)
    && lastSummaryHit != null
    && Number.isFinite(Number(lastSummaryHit))
  ) {
    candidates.push(Number(lastSummaryHit));
  }
  for (const artifact of voiceUiState.attemptArtifacts ?? []) {
    const metrics = artifact.summary?.metrics ?? artifact.metrics ?? null;
    const hit = metrics?.targetHitPct;
    if (isVoiceAttemptMeasurementUsable(metrics) && hit != null && Number.isFinite(Number(hit))) {
      candidates.push(Number(hit));
    }
  }
  return candidates.length > 0 ? Math.max(...candidates) : null;
}

/** Headline for the Review panel: 'N take(s) this session • best target hit X%'. */
function getVoiceReviewSummaryText(voiceUiState: VoiceUiState): string {
  const takeCount = voiceUiState.attemptArtifacts?.length ?? 0;
  if (takeCount === 0) {
    return 'No takes this session yet.';
  }
  const takesLabel = `${takeCount} ${takeCount === 1 ? 'take' : 'takes'} this session`;
  const bestHit = formatVoicePercentValue(getVoiceBestTargetHitPct(voiceUiState));
  return bestHit ? `${takesLabel} • best target hit ${bestHit}` : takesLabel;
}

/** Focus line for the Review panel from lastSummary issues/nextDrills. */
function getVoiceReviewFocusText(voiceUiState: VoiceUiState): string {
  if (
    voiceUiState.lastSummary?.metrics
    && !isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary.metrics)
  ) {
    return 'Measurement unavailable — record another clear take.';
  }
  const issue = (voiceUiState.lastSummary?.issues ?? []).map((entry) => String(entry || '').trim()).find(Boolean);
  const nextDrill = isVoiceAttemptMeasurementUsable(voiceUiState.lastSummary?.metrics)
    ? (voiceUiState.lastSummary?.nextDrills ?? []).map((entry) => String(entry || '').trim()).find(Boolean)
    : null;
  const parts: string[] = [];
  if (issue) parts.push(`Focus: ${issue}`);
  if (nextDrill) parts.push(`Next: ${nextDrill}`);
  return parts.length > 0 ? parts.join(' • ') : 'Keep practicing to build a focus summary.';
}

function formatVoiceClockTime(value: number | string | null | undefined): string {
  const ms = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) {
    return '--:--';
  }
  const date = new Date(Number(ms));
  if (Number.isNaN(date.getTime())) {
    return '--:--';
  }
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

function formatVoiceDurationSeconds(durationMs: number | null | undefined): string {
  if (!Number.isFinite(Number(durationMs)) || Number(durationMs) <= 0) {
    return '--';
  }
  return `${Math.max(1, Math.round(Number(durationMs) / 1000))}s`;
}

/** Per-take rows for the Review panel (oldest→newest), all from existing artifacts. */
function getVoiceReviewListItems(voiceUiState: VoiceUiState): VoiceReviewListItemViewModel[] {
  return (voiceUiState.attemptArtifacts ?? []).map((artifact) => {
    const metrics = artifact.summary?.metrics ?? artifact.metrics ?? null;
    const measurementUsable = isVoiceAttemptMeasurementUsable(metrics);
    const hitText = formatVoicePercentValue(metrics?.targetHitPct);
    const simText = formatVoicePercentValue(metrics?.similarityScore);
    const metricParts: string[] = [];
    if (measurementUsable && hitText) metricParts.push(`hit ${hitText}`);
    if (measurementUsable && simText) metricParts.push(`sim ${simText}`);
    // Surfacing wave: thread the attempt id through so the row can offer a quiet
    // Listen (the same replay machinery openReplay uses). clientAttemptId is the
    // id the replay/audio route already keys on (lesson/controller.ts).
    const attemptId = (typeof artifact.clientAttemptId === 'string' && artifact.clientAttemptId.trim())
      ? artifact.clientAttemptId.trim()
      : (typeof artifact.attemptId === 'string' && artifact.attemptId.trim())
        ? artifact.attemptId.trim()
        : null;
    return {
      timeText: formatVoiceClockTime(artifact.createdAt),
      durationText: formatVoiceDurationSeconds(artifact.durationMs),
      metricText: measurementUsable
        ? (metricParts.length > 0 ? metricParts.join(' • ') : 'no score')
        : 'measurement unavailable',
      attemptId,
      hasAudio: artifact.includesRawAudio !== false,
    };
  });
}

/** Live a11y description of the XY map from the latest take metrics. */
function getVoiceGraphAriaLabel(voiceUiState: VoiceUiState): string {
  const metrics = voiceUiState.lastSummary?.metrics ?? null;
  const base = 'Voice trainer XY map: pitch on the vertical axis, resonance on the horizontal axis.';
  if (!metrics) {
    return base;
  }
  if (!isVoiceAttemptMeasurementUsable(metrics)) {
    return `${base} The latest take was not measurable.`;
  }
  const parts: string[] = [];
  if (metrics.meanPitchHz != null && Number.isFinite(Number(metrics.meanPitchHz))) {
    parts.push(`mean pitch ${Math.round(Number(metrics.meanPitchHz))} hertz`);
  }
  if (metrics.resonanceMean != null && Number.isFinite(Number(metrics.resonanceMean))) {
    parts.push(`resonance ${Number(metrics.resonanceMean).toFixed(2)}`);
  }
  const hit = formatVoicePercentValue(metrics.targetHitPct);
  if (hit) {
    parts.push(`${hit} in the target zone`);
  }
  return parts.length > 0 ? `${base} Latest take: ${parts.join(', ')}.` : base;
}

export function getVoiceStageViewModel(context: {
  voiceUiState: VoiceUiState;
  selectedDrill: VoiceDrill | null;
  comparison: VoicePhraseComparison | null;
  liveVoiceSessionId: string;
  lastSummarySessionId: string;
  streamUrl: string | null;
  liveSession: boolean;
  voiceTakeActive: boolean;
  voiceSessionArmed: boolean;
  voiceTakeProcessing: boolean;
  voiceTransportStatus: VoicePracticeTransportStatus;
}): VoiceStageViewModel {
  const latestCoachCue = getLatestVoiceCoachThreadMessage(context.voiceUiState.coachThread, 'coach');
  const sessionStage = deriveSessionStage({
    voiceSessionId: context.voiceUiState.voiceSessionId,
    targetSource: context.voiceUiState.targetSource,
    referenceClipId: context.voiceUiState.referenceClipId,
    attemptCount: context.voiceUiState.attemptArtifacts?.length ?? 0,
    hasLastSummary: Boolean(context.voiceUiState.lastSummary),
    transportStatus: context.voiceTransportStatus,
    sessionArmed: context.voiceSessionArmed,
    takeActive: context.voiceTakeActive,
  });
  return {
    sessionStage,
    hasReference: Boolean(context.voiceUiState.referenceClipId),
    frontDoorDismissed: Boolean(
      (context.voiceUiState as { frontDoorDismissed?: boolean }).frontDoorDismissed,
    ),
    spineHintText: getVoiceSpineHintText(sessionStage),
    reviewSummaryText: getVoiceReviewSummaryText(context.voiceUiState),
    reviewFocusText: getVoiceReviewFocusText(context.voiceUiState),
    reviewListItems: getVoiceReviewListItems(context.voiceUiState),
    graphAriaLabel: getVoiceGraphAriaLabel(context.voiceUiState),
    graphStatusText: context.voiceTakeProcessing
      ? 'Scoring the latest take'
      : context.voiceTakeActive
        ? `Live take streaming ${context.liveVoiceSessionId.slice(0, 8)}`
      : context.voiceTransportStatus === 'streaming'
        ? `Mic path armed ${context.liveVoiceSessionId.slice(0, 8)}`
      : context.voiceTransportStatus === 'requesting-mic'
        ? 'Requesting microphone access'
        : context.voiceTransportStatus === 'connecting'
          ? 'Connecting audio stream'
          : context.voiceTransportStatus === 'error'
            ? 'Stream interrupted — restart practice'
            : context.liveSession
              ? `Tutor ready ${context.liveVoiceSessionId.slice(0, 8)}`
              : context.voiceUiState.serviceStatus === 'online'
                ? 'Ready for a take'
                : 'Waiting for tutor',
    // P0.1c live cue: ONE calm coaching line (the coach's latest guidance, or a gentle
    // idle prompt) — distinct from the transport status above.
    liveCueText: latestCoachCue?.content?.trim() || 'Ready when you are — start a take to get live coaching.',
    streamUrlText: context.streamUrl || 'No stream yet',
    sessionText: context.voiceTakeActive
      ? `Take live • ${context.liveVoiceSessionId.slice(0, 8)}`
      : context.voiceSessionArmed
        ? `Armed • ${context.liveVoiceSessionId.slice(0, 8)}`
        : context.lastSummarySessionId
          ? `Last take • ${context.lastSummarySessionId.slice(0, 8)}`
          : 'No live take',
    targetText: `${getVoiceTargetDisplayName(context.voiceUiState)} • ${getVoiceTargetSourceLabel(context.voiceUiState)}`,
    referenceText: context.voiceUiState.referenceClipName
      || (context.voiceUiState.targetSource === 'custom-handmade' ? 'handmade target only' : 'none loaded'),
    targetVoiceText: context.voiceUiState.selectedCustomPresetName
      || context.voiceUiState.targetVoiceProfile?.sourceFilename
      || 'not derived yet',
    forecastText: context.voiceUiState.phraseForecast?.phrase || 'no phrase map',
    drillText: context.selectedDrill?.title || 'none selected',
    matchText: getVoiceComparisonScoreText(context.comparison?.pathMatchScore),
    laneText: getVoiceComparisonScoreText(context.comparison?.laneMatchScore),
    contourText: getVoiceComparisonScoreText(context.comparison?.contourMatchScore),
    zoneText: getVoiceComparisonScoreText(context.comparison?.targetZoneScore),
    shellMemoryStatsText: context.liveSession
      ? 'voice session live'
      : context.voiceUiState.serviceStatus === 'online'
        ? 'voice trainer ready'
        : 'voice trainer offline',
    shellStageStatusText: context.liveSession ? 'VOICE LIVE' : 'VOICE MAP',
  };
}

export function getVoiceSidebarSummaryViewModel(context: VoiceViewModelContext & {
  voiceKnowledgeStatusText: string;
  voiceTakeActive: boolean;
  voiceSessionArmed: boolean;
  liveVoiceSessionId: string;
}): VoiceSidebarSummaryViewModel {
  const targetProfileText = getVoiceTargetProfileText(context.voiceUiState);
  const selectedDrill = getSelectedVoiceDrill(context.voiceDrillState);
  const deeptutorLessonBoard = normalizeDeepTutorVoiceState(context.voiceUiState.deeptutorVoiceState).lessonBoard;
  const activeLine = getVoiceActiveLine(context.voiceUiState);
  return {
    sidebarPresetText: `${getVoiceTargetDisplayName(context.voiceUiState)} • ${getVoiceTargetSourceLabel(context.voiceUiState)}`,
    serviceHealthText: context.voiceUiState.lastError
      ? `Error: ${context.voiceUiState.lastError}`
      : context.voiceUiState.serviceStatus === 'online'
        ? 'Online'
        : context.voiceUiState.serviceStatus === 'offline'
          ? 'Offline'
          : 'Checking trainer…',
    sessionStatusText: context.voiceTakeActive
      ? `Take live • ${context.liveVoiceSessionId.slice(0, 8)}`
      : context.voiceSessionArmed
        ? `Armed • ${context.liveVoiceSessionId.slice(0, 8)}`
        : context.voiceUiState.status === 'ended'
          ? 'Ended'
          : 'Idle',
    studentMasteryText: context.voiceStudentModelState.error
      ? 'OFFLINE'
      : (context.voiceStudentModelState.masteryLevel || (context.voiceStudentModelState.available ? 'beginner' : 'standby')).toUpperCase(),
    studentReviewCountText: context.voiceStudentModelState.error
      ? '--'
      : context.voiceStudentModelState.available
        ? `${context.voiceStudentModelState.reviewQueueSize} due`
        : 'standby',
    knowledgeStatusText: context.voiceKnowledgeStatusText,
    referenceSummaryText: context.voiceUiState.referenceClipName
      ? `${context.voiceUiState.referenceClipName}${context.voiceUiState.referenceAnalysis?.durationMs ? ` • ${(context.voiceUiState.referenceAnalysis.durationMs / 1000).toFixed(1)}s` : ''}`
      : context.voiceUiState.targetSource === 'custom-handmade'
        ? 'Handmade target active. No reference clip is attached.'
        : 'Drop in a target clip to compare your resonance and pitch path.',
    targetProfileSummaryText: targetProfileText,
    currentDrillText: getVoiceCurrentDrillText(context),
    targetProfileCopyText: targetProfileText,
    drillCopyText: getVoiceDrillCopyText(context),
    summaryOverviewText: getVoiceSummaryText(context.voiceUiState),
    studentConceptsText: getVoiceStudentConceptText(context.voiceStudentModelState),
    studentFocusText: getVoiceStudentFocusText(context.voiceStudentModelState),
    learnerContextStatusText: getVoiceLearnerContextStatusText(context.voiceStudentModelState),
    learnerContextDatasetText: getVoiceLearnerContextDatasetText(context.voiceStudentModelState),
    learnerContextNotepadText: getVoiceLearnerContextNotepadText(context.voiceStudentModelState),
    activeDrillTitleText: deeptutorLessonBoard?.title
      || activeLine?.intent
      || selectedDrill?.title
      || 'Practice cockpit',
    reviewDueText: getVoiceReviewDueText(context.voiceStudentModelState),
  };
}

/**
 * Surfacing wave: the visible Review-panel due line. Pencil tone, never
 * pressure — present only when at least one focus is genuinely due.
 */
export function getVoiceReviewDueText(voiceStudentModelState: VoiceStudentModelState): string | null {
  if (voiceStudentModelState.error || !voiceStudentModelState.available) {
    return null;
  }
  const dueCount = voiceStudentModelState.reviewQueue.length > 0
    ? voiceStudentModelState.reviewQueue.length
    : voiceStudentModelState.reviewQueueSize;
  if (!Number.isFinite(dueCount) || dueCount <= 0) {
    return null;
  }
  const names = voiceStudentModelState.reviewQueue
    .slice(0, 2)
    .map((item) => String(item?.name || '').trim())
    .filter(Boolean);
  const nameSuffix = names.length > 0 ? ` — ${names.join(' • ')}` : '';
  return dueCount === 1
    ? `1 focus due for review today${nameSuffix}`
    : `${dueCount} focuses due for review today${nameSuffix}`;
}

export function getVoicePanelControlsViewModel(context: VoicePanelControlsContext): VoicePanelControlsViewModel {
  const customPresetDraft = context.voiceUiState.customTargetPresetDraft;
  const draftLibraryEntry = getVoiceCustomPresetDraftLibraryEntry(context.voiceUiState);
  const customPresetWorkspaceDisabled = context.voicePracticeTargetLocked;
  const runtimeSafetyHold = hasVoiceRuntimeSafetyHold(context.voiceUiState);
  const deepTutorRoutesUnavailable = context.deepTutorVoiceRoutesEnabled === false;
  return {
    targetPresetValue: context.voiceUiState.targetPreset || 'cute-feminine',
    targetPresetDisabled: context.voicePracticeTargetLocked,
    customPresetNameValue: customPresetDraft.name,
    customPresetBasePresetValue: customPresetDraft.basePreset || context.voiceUiState.targetPreset || 'cute-feminine',
    customPresetPitchFloorValue: customPresetDraft.pitchFloorHz,
    customPresetPitchCeilingValue: customPresetDraft.pitchCeilingHz,
    customPresetResonanceFloorValue: customPresetDraft.resonanceFloor,
    customPresetResonanceCeilingValue: customPresetDraft.resonanceCeiling,
    customPresetWeightFloorValue: customPresetDraft.weightFloor,
    customPresetWeightCeilingValue: customPresetDraft.weightCeiling,
    customPresetStylePromptValue: customPresetDraft.stylePrompt,
    customPresetNotesValue: customPresetDraft.notesText,
    customPresetWorkspaceDisabled,
    saveReferencePresetDisabled: customPresetWorkspaceDisabled
      || context.voiceUiState.serviceStatus === 'offline'
      || !context.voiceUiState.referenceClipId,
    removeReferenceDisabled: customPresetWorkspaceDisabled
      || !context.voiceUiState.referenceClipId,
    seedCustomPresetDisabled: customPresetWorkspaceDisabled
      || (
        !hasVoiceCustomPresetDraftWorkspaceContent(context.voiceUiState)
        && !(context.voiceUiState.targetVoiceProfile || context.voiceUiState.referenceClipId)
      ),
    saveHandmadePresetDisabled: customPresetWorkspaceDisabled
      || context.voiceUiState.serviceStatus === 'offline'
      || !customPresetDraft.name.trim(),
    saveHandmadePresetText: draftLibraryEntry?.kind === 'handmade' ? 'Update Handmade Preset' : 'Save Handmade Preset',
    conditioningUseProfileChecked: context.voiceConditioning.useTargetProfileStyle,
    conditioningStyleValue: context.voiceConditioning.styleInstruction,
    conditioningPromptValue: context.voiceConditioning.promptText,
    conditioningStatusText: context.voiceConditioningStatusText,
    forecastPhraseValue: context.voiceUiState.forecastPhrase || '',
    forecastPhraseDisabled: context.voicePracticeTargetLocked,
    forecastGenerateText: context.voiceForecastStatus === 'loading' ? 'Projecting...' : 'Project Phrase Map',
    forecastGenerateDisabled: !context.currentSessionId
      || !context.isConnected
      || context.voicePracticeTargetLocked
      || context.voiceForecastStatus === 'loading'
      || !(context.voiceUiState.referenceClipId || context.voiceUiState.targetVoiceProfile),
    startSessionText: context.voiceSessionArmed ? 'Cancel take' : 'Start take',
    startSessionDisabled: !context.currentSessionId
      || context.voiceUiState.serviceStatus === 'offline'
      || context.voiceTakeProcessing
      || context.voiceTakeActive
      || context.voiceTransportStatus === 'requesting-mic'
      || context.voiceTransportStatus === 'connecting',
    endSessionText: context.voiceTakeProcessing
      ? 'Scoring Take...'
      : context.voiceTakeActive
        ? 'Release to Finish'
        : 'Hold to Practice',
    endSessionDisabled: !context.voiceSessionArmed || context.voiceTakeProcessing || context.voiceTransportStatus !== 'streaming',
    lineRegenerateDisabled: !context.currentSessionId || !context.isConnected || context.voicePracticeTargetLocked || context.deepTutorOwnsLineSelection,
    lineEasierDisabled: !context.currentSessionId || !context.isConnected || context.voicePracticeTargetLocked || context.deepTutorOwnsLineSelection,
    lineHarderDisabled: !context.currentSessionId || !context.isConnected || context.voicePracticeTargetLocked || context.deepTutorOwnsLineSelection || runtimeSafetyHold,
    lineNextDisabled: !context.currentSessionId || !context.isConnected || context.voicePracticeTargetLocked || context.deepTutorOwnsLineSelection,
    linePinDisabled: !context.currentSessionId || !context.isConnected || context.voicePracticeTargetLocked || context.deepTutorOwnsLineSelection || !context.activeLine,
    referenceInputDisabled: context.voicePracticeTargetLocked,
    deepTutorStartDisabled: deepTutorRoutesUnavailable
      || !context.currentSessionId
      || !context.isConnected
      || context.voiceDeepTutorLessonStatus === 'loading',
    deepTutorNextDisabled: !context.currentSessionId
      || !context.isConnected
      || deepTutorRoutesUnavailable
      || context.voiceDeepTutorLessonStatus === 'loading'
      || !context.deepTutorOwnsLineSelection
      || runtimeSafetyHold,
    deepTutorStartTitle: deepTutorRoutesUnavailable
      ? 'Guided Coach is disabled in standalone voice runtime mode.'
      : '',
    deepTutorNextTitle: context.shouldRebuildDeepTutorVoiceLesson
      ? 'Start a new guided lesson first.'
      : deepTutorRoutesUnavailable
        ? 'Guided Coach is disabled in standalone voice runtime mode.'
        : runtimeSafetyHold
          ? 'Reset before advancing after strain, fatigue, unstable analysis, or unreliable capture.'
          : '',
    advancedToggleText: context.voiceUiState.advancedPanel.open ? 'Hide Details' : 'Details',
    advancedExpanded: Boolean(context.voiceUiState.advancedPanel.open),
    showAdvancedContent: Boolean(context.voiceUiState.advancedPanel.open),
    useAdvancedLabPanelClass: Boolean(context.voiceUiState.advancedPanel.open),
    coachSendDisabled: !context.currentSessionId || !context.isConnected || context.voiceCoachQuestionStatus === 'sending',
    conditioningSaveDisabled: !context.currentSessionId || !context.isConnected,
    conditioningPromptUploadDisabled: !context.currentSessionId
      || !context.isConnected
      || !context.conditioningPromptFileSelected
      || !context.conditioningPromptTextPresent,
    conditioningReferenceUploadDisabled: !context.currentSessionId
      || !context.isConnected
      || !context.conditioningReferenceFileSelected,
    inputDeviceDisabled: context.voiceAudioInputDevicesCount === 0
      || context.voiceTransportStatus === 'requesting-mic'
      || context.voiceTransportStatus === 'connecting'
      || context.voiceSessionArmed,
    selfReportEffortValue: formatVoiceSelfReportSelectValue(context.voiceUiState.selfReportDraft.effort),
    selfReportStrainValue: formatVoiceSelfReportSelectValue(context.voiceUiState.selfReportDraft.strain),
    selfReportFatigueValue: formatVoiceSelfReportSelectValue(context.voiceUiState.selfReportDraft.fatigue),
    selfReportDifficultyValue: formatVoiceSelfReportSelectValue(context.voiceUiState.selfReportDraft.perceivedDifficulty),
    selfReportConfidenceValue: formatVoiceSelfReportSelectValue(context.voiceUiState.selfReportDraft.confidence),
    selfReportDisabled: context.voiceTakeProcessing,
    selfReportCopyText: getVoiceSelfReportCopyText(context.voiceUiState),
  };
}

function formatVoiceDb(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${value.toFixed(1)} dB`
    : '--';
}

function formatVoiceSignalPercent(value: number | null | undefined, suffix = ''): string {
  return typeof value === 'number' && Number.isFinite(value)
    ? `${Math.round(value * 100)}%${suffix}`
    : '--';
}

function getSelectedVoiceAudioInput(
  devices: VoiceAudioInputDeviceSnapshot[],
  selectedDeviceId: string | null,
): VoiceAudioInputDeviceSnapshot | null {
  return devices.find((device) => device.deviceId === (selectedDeviceId || 'default')) || null;
}

export function getVoiceInputPanelViewModel(context: {
  comparison: VoicePhraseComparison | null;
  voiceTransportStatus: VoicePracticeTransportStatus;
  voiceResolvedInputLabel: string | null;
  voiceAudioInputDevices: VoiceAudioInputDeviceSnapshot[];
  selectedInputDeviceId: string | null;
  voiceTakeProcessing: boolean;
  voiceTakeActive: boolean;
  voiceSessionArmed: boolean;
  voiceAudioInputStatus: 'idle' | 'loading' | 'ready' | 'error';
  voiceAudioInputError: string | null;
  voiceAudioInputNotice: string | null;
  liveLoudnessDb: number | null;
  liveConfidence: number | null;
}): VoiceInputPanelViewModel {
  const selectedDevice = getSelectedVoiceAudioInput(context.voiceAudioInputDevices, context.selectedInputDeviceId);
  const selectedText = context.voiceTransportStatus === 'streaming' || context.voiceTransportStatus === 'connecting'
    ? context.voiceResolvedInputLabel || selectedDevice?.label || 'System default input'
    : selectedDevice?.label || context.voiceResolvedInputLabel || 'System default input';

  const quality = context.comparison?.analysisQuality;
  const reliabilityText = !quality
    ? context.voiceTakeProcessing
      ? 'scoring take…'
      : context.voiceTakeActive
        ? 'capturing live…'
        : context.voiceSessionArmed ? 'armed for next take' : 'no scored take'
    : quality.reliable === false
      ? (formatVoiceSignalPercent(quality.scoreConfidence) === '--'
          ? 'provisional'
          : `${formatVoiceSignalPercent(quality.scoreConfidence)} provisional`)
      : quality.reliable === true
        ? (formatVoiceSignalPercent(quality.scoreConfidence) === '--'
            ? 'trusted'
            : `${formatVoiceSignalPercent(quality.scoreConfidence)} trusted`)
        : formatVoiceSignalPercent(quality.scoreConfidence);

  let copyText: string;
  if (context.voiceAudioInputStatus === 'loading') {
    copyText = 'Scanning browser-visible audio inputs…';
  } else if (context.voiceAudioInputError) {
    copyText = `Input scan failed: ${context.voiceAudioInputError}`;
  } else if (context.voiceAudioInputNotice) {
    copyText = context.voiceAudioInputNotice;
  } else {
    const activeLabel = context.voiceResolvedInputLabel || selectedDevice?.label || 'System default input';
    const labelsHidden = context.voiceAudioInputDevices.length > 0 && context.voiceAudioInputDevices.every((device, index) => {
      if (device.deviceId === 'default') {
        return index === 0 && device.label === 'System default input';
      }
      return /^Audio input \d+$/.test(device.label);
    });

    if (labelsHidden) {
      copyText = 'Grant mic access once to reveal the exact browser-visible device labels, like your MOTU M4 if the browser exposes it.';
    } else if (context.voiceTakeActive) {
      const qualityIssue = context.comparison?.analysisQuality?.issues?.[0];
      copyText = qualityIssue
        ? `Live take is using ${activeLabel}. ${qualityIssue}`
        : `Live take is using ${activeLabel}.`;
    } else if (context.voiceSessionArmed) {
      copyText = `${activeLabel} is warm and ready. Hold the practice control to mark the next take without reopening the mic path.`;
    } else if (selectedDevice) {
      copyText = `${selectedDevice.label} is armed for the next take. The browser will show the exact active source label here once capture starts.`;
    } else {
      copyText = 'Select the browser-visible input you want the trainer to use for the next take.';
    }
  }

  return {
    selectedText,
    levelText: context.liveLoudnessDb != null
      ? formatVoiceDb(context.liveLoudnessDb)
      : formatVoiceDb(context.comparison?.analysisQuality?.meanLoudnessDb),
    signalText: context.liveConfidence != null
      ? formatVoiceSignalPercent(context.liveConfidence, ' live')
      : formatVoiceSignalPercent(context.comparison?.analysisQuality?.meanConfidence, ' avg'),
    reliabilityText,
    copyText,
  };
}

export function getVoiceTargetProfileText(voiceUiState: VoiceUiState): string {
  const profile = voiceUiState.targetVoiceProfile;
  if (!profile) {
    return voiceUiState.referenceClipName
      ? 'Reference loaded. The trainer is ready to derive a reusable target voice profile from it.'
      : 'Load a longer target clip to derive a reusable target voice profile and phrase map.';
  }

  const note = Array.isArray(profile.notes) && profile.notes.length > 0 ? ` ${profile.notes[0]}` : '';
  const stylePrompt = profile.stylePrompt ? `${profile.stylePrompt}.` : 'Target voice ready.';
  return `${profile.sourceFilename || 'Target voice'} • ${stylePrompt}${note}`;
}

export function getVoiceForecastText({
  voiceUiState,
  voiceForecastStatus,
  voiceForecastError,
}: Pick<VoiceViewModelContext, 'voiceUiState' | 'voiceForecastStatus' | 'voiceForecastError'>): string {
  if (voiceForecastStatus === 'loading') {
    return 'Projecting the phrase onto the graph using the derived target voice profile...';
  }
  if (voiceForecastStatus === 'error') {
    return voiceForecastError
      ? `Projection failed: ${voiceForecastError}`
      : 'Projection failed. Try a shorter phrase or re-load the reference.';
  }

  const forecast = voiceUiState.phraseForecast;
  if (forecast?.summary) {
    const note = Array.isArray(forecast.notes) && forecast.notes.length > 0 ? ` ${forecast.notes[0]}` : '';
    return `${forecast.summary}.${note}`;
  }

  return voiceUiState.targetVoiceProfile
    ? 'Type a phrase and project how this target voice should move across the XY map.'
    : 'Load a target reference first, then project a phrase map for shadowing.';
}

export function getVoiceCurrentDrillText(context: VoiceViewModelContext): string {
  const deeptutorVoiceState = normalizeDeepTutorVoiceState(context.voiceUiState.deeptutorVoiceState);
  const lessonBoard = deeptutorVoiceState.lessonBoard;
  if (lessonBoard?.title || lessonBoard?.prompt) {
    const prompt = lessonBoard.prompt ? ` Phrase: "${lessonBoard.prompt}".` : '';
    return `${lessonBoard.title || 'DeepTutor lesson'}${prompt}`;
  }

  if (context.voiceDrillStatus === 'loading') {
    return 'Refreshing the guided drill pack for this preset...';
  }
  if (context.voiceDrillStatus === 'error') {
    return context.voiceDrillError || 'Guided drills are temporarily unavailable.';
  }

  const selectedDrill = getSelectedVoiceDrill(context.voiceDrillState);
  if (!selectedDrill) {
    return 'Pick a guided drill to load a phrase, focus cue, and recommended practice target.';
  }

  return `${selectedDrill.title} • ${selectedDrill.focus}. Phrase: "${selectedDrill.phrase}".`;
}

export function getVoiceDrillCopyText(context: VoiceViewModelContext): string {
  if (context.voiceDrillStatus === 'loading') {
    return 'Refreshing guided drills for this preset and your latest weak spots...';
  }
  if (context.voiceDrillStatus === 'error') {
    return context.voiceDrillError
      ? `Guided drills failed to load: ${context.voiceDrillError}`
      : 'Guided drills failed to load.';
  }

  const selectedDrill = getSelectedVoiceDrill(context.voiceDrillState);
  const recommended = getRecommendedVoiceDrills(context.voiceDrillState);
  if (selectedDrill) {
    const cue = selectedDrill.cues[0] ? ` ${selectedDrill.cues[0]}` : '';
    return `${selectedDrill.description || 'Current guided drill loaded.'}${cue ? ` ${cue}` : ''}`;
  }
  if (recommended.length > 0) {
    return `Recommended first: ${recommended.map((drill) => drill.title).join(' • ')}.`;
  }
  return 'Curated drills load per preset, then adapt to your latest take, review queue, and reference work.';
}

export function getVoiceActiveLineMeta(voiceUiState: VoiceUiState): VoiceLineMeta[] {
  const activeLine = getVoiceActiveLine(voiceUiState);
  if (!activeLine) {
    return [];
  }

  return [
    activeLine.intent ? { label: 'Intent', value: activeLine.intent } : null,
    activeLine.difficulty ? { label: 'Difficulty', value: activeLine.difficulty } : null,
    activeLine.source ? { label: 'Source', value: activeLine.source.replace(/-/g, ' ') } : null,
    activeLine.referenceMode ? { label: 'Mode', value: activeLine.referenceMode.replace(/-/g, ' ') } : null,
  ].filter(Boolean) as VoiceLineMeta[];
}

export function getVoicePrimaryCueChips({
  voiceUiState,
  voiceDrillState,
}: Pick<VoiceViewModelContext, 'voiceUiState' | 'voiceDrillState'>): string[] {
  const deeptutorVoiceState = normalizeDeepTutorVoiceState(voiceUiState.deeptutorVoiceState);
  const lessonBoardFocus = Array.isArray(deeptutorVoiceState.lessonBoard?.focus)
    ? deeptutorVoiceState.lessonBoard.focus
    : [];
  const activeLine = getVoiceActiveLine(voiceUiState);
  const cueSheet = getCurrentVoiceCueSheet({ voiceUiState, voiceDrillState });
  const chips = [
    ...lessonBoardFocus,
    ...(Array.isArray(activeLine?.teachingFocus) ? activeLine.teachingFocus : []),
    ...(Array.isArray(cueSheet?.teachingFocus) ? cueSheet.teachingFocus : []),
  ]
    .map((item) => item.replace(/-/g, ' '))
    .filter(Boolean);

  return [...new Set(chips)].slice(0, 4);
}

export function getVoiceCueSheetCopyText(context: VoiceViewModelContext): string {
  const cueSheet = getCurrentVoiceCueSheet(context);
  const comparison = getRenderableVoicePhraseComparison(context);
  const comparisonMatchesCueSheet = isVoiceComparisonMatchCueSheet({
    cueSheet,
    comparison,
    normalizePhraseText: normalizeVoicePhraseTextForMatch,
  });

  if (!cueSheet) {
    return getSelectedVoiceDrill(context.voiceDrillState)
      ? 'The drill phrase is loaded. Tutor notes will appear here once the coached phrase sheet is ready.'
      : 'Select a drill or project a phrase map to get mouth-shape, airflow, placement, and expression notes under the words.';
  }

  if (comparisonMatchesCueSheet) {
    const weakTokens = cueSheet.tokens?.filter((token) => {
      const checkpoint = getVoiceCueSheetCheckpointForToken(token, comparison);
      return getVoicePhraseCheckpointTone(checkpoint?.pathMatchScore) === 'weak';
    }) || [];

    return weakTokens.length > 0
      ? 'Pink words are where the phrase drifted most. Copy the mouth action, placement feel, and acting cue before the next take.'
      : 'Use the cue line like sheet music: keep the strong words steady and repeat the same mouth actions on the next take.';
  }

  return `Read the cue line, copy the mouth actions below the words, and act the phrase as: ${cueSheet.expressionMask || 'light, bright, hopeful'}.`;
}

export function getVoicePhraseComparisonText({
  voiceUiState,
  voiceDrillState,
}: Pick<VoiceViewModelContext, 'voiceUiState' | 'voiceDrillState'>): string {
  const comparison = getRenderableVoicePhraseComparison({ voiceUiState, voiceDrillState });
  if (comparison?.summary) {
    const breakdown = [
      typeof comparison.laneMatchScore === 'number'
        ? `lane ${Math.round(comparison.laneMatchScore * 100)}%`
        : null,
      typeof comparison.contourMatchScore === 'number'
        ? `contour ${Math.round(comparison.contourMatchScore * 100)}%`
        : null,
      typeof comparison.corridorHoldScore === 'number'
        ? `tunnel ${Math.round(comparison.corridorHoldScore * 100)}%`
        : null,
    ].filter(Boolean);
    return breakdown.length > 0
      ? `${comparison.summary} ${breakdown.join(' • ')}.`
      : comparison.summary;
  }

  if (voiceUiState.phraseForecast?.timeline?.length) {
    return 'End a take to compare your live path against the selected drill / phrase map.';
  }
  return 'Select a drill or project a phrase map to score phrase-shape matching after a take.';
}

export function getVoiceStudentConceptText(voiceStudentModelState: VoiceStudentModelState): string {
  if (voiceStudentModelState.error) {
    return voiceStudentModelState.error;
  }

  if (voiceStudentModelState.conceptsPracticed > 0) {
    const profileBits = [
      voiceStudentModelState.learningPace ? `pace: ${voiceStudentModelState.learningPace}` : null,
      voiceStudentModelState.preferredStyle ? `style: ${voiceStudentModelState.preferredStyle}` : null,
    ].filter(Boolean);
    return `${voiceStudentModelState.conceptsPracticed} tracked skill${voiceStudentModelState.conceptsPracticed !== 1 ? 's' : ''}${profileBits.length > 0 ? ` • ${profileBits.join(' • ')}` : ''}`;
  }

  if (voiceStudentModelState.learnerContext?.available) {
    const learnerContext = voiceStudentModelState.learnerContext;
    const profileBits = [
      learnerContext.targetPreset ? `target: ${learnerContext.targetPreset}` : null,
      learnerContext.recentAttemptCount > 0 ? `${learnerContext.recentAttemptCount} recent take${learnerContext.recentAttemptCount !== 1 ? 's' : ''}` : null,
      learnerContext.exportEligible ? 'export eligible' : null,
    ].filter(Boolean);
    return `Learner context ready${profileBits.length > 0 ? ` • ${profileBits.join(' • ')}` : ''}.`;
  }

  return 'No voice skills tracked yet. End a scored take to start building your review map.';
}

export function getVoiceStudentFocusText(voiceStudentModelState: VoiceStudentModelState): string {
  if (voiceStudentModelState.error) {
    return 'Voice mastery tracking is offline until the student-model bridge comes back.';
  }
  if (voiceStudentModelState.reviewQueue.length > 0) {
    return `Due now: ${voiceStudentModelState.reviewQueue.slice(0, 2).map((item) => item.name).join(' • ')}`;
  }
  if (voiceStudentModelState.struggles.length > 0) {
    return voiceStudentModelState.struggles.slice(0, 2).join(' • ');
  }
  if (voiceStudentModelState.reviewPrompt) {
    return voiceStudentModelState.reviewPrompt
      .replace(/\[[^\]]+\]/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
  }
  if (voiceStudentModelState.learnerContext?.notepadHandoff) {
    const handoff = voiceStudentModelState.learnerContext.notepadHandoff;
    const content = handoff.content.trim();
    const items = handoff.items.slice(0, 2).join(' • ');
    if (content || items) {
      return `Planner note: ${content || items}`.slice(0, 200);
    }
  }
  if (voiceStudentModelState.learnerContext?.available) {
    return voiceStudentModelState.learnerContext.exportEligible
      ? 'Learner context is ready for reviewed export; keep using clean captures and explicit consent.'
      : 'Learner context is active; dataset export stays blocked until consent, eligibility, and exclusions are clean.';
  }
  return 'Keep ending takes to let the mastery model surface weak spots and spaced-review drills.';
}

export function getVoiceLearnerContextStatusText(voiceStudentModelState: VoiceStudentModelState): string {
  const learnerContext = voiceStudentModelState.learnerContext;
  if (!learnerContext) {
    return 'No local learner context loaded yet.';
  }
  if (learnerContext.error) {
    return `Learner context offline: ${learnerContext.error}`;
  }
  const parts = [
    learnerContext.source || 'local context',
    learnerContext.targetPreset ? `target ${learnerContext.targetPreset}` : null,
    `${learnerContext.recentAttemptCount} recent take${learnerContext.recentAttemptCount === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return parts.join(' • ');
}

export function getVoiceLearnerContextDatasetText(voiceStudentModelState: VoiceStudentModelState): string {
  const learnerContext = voiceStudentModelState.learnerContext;
  if (!learnerContext?.available) {
    return 'Dataset export blocked until learner context is available.';
  }
  if (learnerContext.exportEligible) {
    return 'Dataset export ready: consent granted, eligible, no exclusions.';
  }
  const blockers = [
    `consent ${learnerContext.consentStatus || 'unknown'}`,
    `eligibility ${learnerContext.eligibilityStatus || 'unknown'}`,
    learnerContext.exclusions.length > 0
      ? `${learnerContext.exclusions.length} exclusion${learnerContext.exclusions.length === 1 ? '' : 's'}`
      : null,
  ].filter(Boolean);
  return `Dataset export blocked: ${blockers.join(' • ')}.`;
}

export function getVoiceLearnerContextNotepadText(voiceStudentModelState: VoiceStudentModelState): string {
  const handoff = voiceStudentModelState.learnerContext?.notepadHandoff;
  if (!handoff) {
    return 'No planner handoff yet.';
  }
  const content = handoff.content.trim();
  const items = handoff.items.slice(0, 2).join(' • ');
  if (!content && !items) {
    return 'Planner handoff is empty.';
  }
  return `Planner handoff: ${content || items}`.slice(0, 220);
}
