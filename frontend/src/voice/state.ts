import * as deepTutorInteractionContract from './deeptutor-interaction-contract';
import * as voiceBackendPayloadContract from './voice-backend-payload-contract';
import type {
  DeepTutorVoiceCoachBrief,
  DeepTutorVoiceInputEvidence,
  DeepTutorVoiceKnowledgePoint,
  DeepTutorVoiceLessonBoard,
  DeepTutorVoiceLessonMode,
  DeepTutorVoiceMimicDirective,
  DeepTutorVoiceMimicProgress,
  DeepTutorVoicePracticeIntent,
  DeepTutorVoiceRuntimeOwner,
  DeepTutorVoiceSharedInteractionState,
  DeepTutorVoiceState,
  VoiceAdvancedPanelState,
  VoiceAttemptArtifact,
  VoiceAttemptAdvancedMetrics,
  VoiceAttemptFormantLiteMetrics,
  VoiceAttemptMetrics,
  VoiceAttemptQualityMetrics,
  VoiceAttemptSummary,
  VoiceAttemptTarget,
  VoiceAudioInputDevice,
  VoiceBackendPayload,
  VoiceCoachBackendLiveStatus,
  VoiceCoachInputCapabilities,
  VoiceCoachInputProvider,
  VoiceCoachMessage,
  VoiceCoachMessageChannel,
  VoiceCoachSpeechProvider,
  VoiceCoachVoiceState,
  VoiceConditioningState,
  VoiceCustomTargetPreset,
  VoiceCustomTargetPresetDraft,
  VoiceCueSheet,
  VoiceCueSheetToken,
  VoiceDrill,
  VoiceDrillState,
  VoiceInputRecoveryState,
  VoiceInputRuntimeOutcome,
  VoiceInputRuntimeState,
  VoiceInputRuntimeStatus,
  VoiceLearnerContextNotepadHandoff,
  VoiceLearnerContextState,
  VoiceFrameAdvancedMetrics,
  VoiceLiveFrame,
  VoicePhraseAnalysisQuality,
  VoicePhraseCheckpoint,
  VoicePhraseComparison,
  VoicePhraseForecast,
  VoicePracticeLine,
  VoiceReferenceAnalysis,
  VoiceRepContext,
  VoiceSelfReport,
  VoiceStudentModelReviewItem,
  VoiceStudentModelState,
  VoiceStrainWatch,
  VoiceTargetAdvancedBands,
  VoiceTargetFormantLiteBands,
  VoiceTargetProfile,
  VoiceTargetSource,
  VoiceTargetQualityBands,
  VoiceUiState,
} from './contracts';

export type {
  DeepTutorVoiceLessonMode,
  DeepTutorVoicePracticeIntent,
  DeepTutorVoiceRuntimeOwner,
  DeepTutorVoiceSharedInteractionState,
  DeepTutorVoiceState,
  VoiceAdvancedPanelState,
  VoiceAttemptArtifact,
  VoiceAttemptAdvancedMetrics,
  VoiceAttemptFormantLiteMetrics,
  VoiceAttemptMetrics,
  VoiceAttemptQualityMetrics,
  VoiceAttemptSummary,
  VoiceAttemptTarget,
  VoiceBackendPayload,
  VoiceCoachMessage,
  VoiceCoachMessageChannel,
  VoiceCoachVoiceState,
  VoiceConditioningState,
  VoiceCustomTargetPreset,
  VoiceCustomTargetPresetDraft,
  VoiceCueSheet,
  VoiceCueSheetToken,
  VoiceDrill,
  VoiceDrillState,
  VoiceInputRecoveryState,
  VoiceInputRuntimeState,
  VoiceLearnerContextState,
  VoiceFrameAdvancedMetrics,
  VoiceLiveFrame,
  VoicePhraseCheckpoint,
  VoicePhraseComparison,
  VoicePhraseForecast,
  VoicePracticeLine,
  VoiceReferenceAnalysis,
  VoiceRepContext,
  VoiceSelfReport,
  VoiceStudentModelState,
  VoiceStrainWatch,
  VoiceTargetAdvancedBands,
  VoiceTargetFormantLiteBands,
  VoiceTargetQualityBands,
  VoiceTargetSource,
  VoiceUiState,
} from './contracts';

export function getVoiceBackendPayloadSlices(
  payload: VoiceBackendPayload | Record<string, unknown> | null | undefined,
): {
  voiceState: Partial<VoiceUiState> | null;
  studentModel: Partial<VoiceStudentModelState> | null;
  learnerContext: Partial<VoiceLearnerContextState> | null;
  deeptutorVoiceState: Partial<DeepTutorVoiceState> | null;
} {
  const slices = voiceBackendPayloadContract.getVoiceBackendPayloadSlices(payload);
  return {
    voiceState: slices.voiceState as Partial<VoiceUiState> | null,
    studentModel: slices.studentModel as Partial<VoiceStudentModelState> | null,
    learnerContext: slices.learnerContext as Partial<VoiceLearnerContextState> | null,
    deeptutorVoiceState: slices.deeptutorVoiceState as Partial<DeepTutorVoiceState> | null,
  };
}

export function hasVoiceBackendPayload(payload: unknown): payload is VoiceBackendPayload {
  return voiceBackendPayloadContract.hasVoiceBackendPayload(payload);
}

export function createVoiceBackendPayload<T extends Record<string, unknown>>(
  payload?: VoiceBackendPayload | null,
  extras?: T | null,
): VoiceBackendPayload & T {
  return voiceBackendPayloadContract.createVoiceBackendPayload(payload, extras) as VoiceBackendPayload & T;
}

export function createVoiceBackendErrorPayload<T extends Record<string, unknown>>(
  payload: VoiceBackendPayload | null | undefined,
  error: string | null | undefined,
  extras?: T | null,
): VoiceBackendPayload & T & { error?: string } {
  return voiceBackendPayloadContract.createVoiceBackendErrorPayload(payload, error, extras) as VoiceBackendPayload & T & {
    error?: string;
  };
}

type VoiceInteractionOwner =
  | 'idle'
  | 'coach-speaking'
  | 'coach-listening'
  | 'coach-processing'
  | 'practice-arming'
  | 'practice-armed'
  | 'practice-live'
  | 'practice-processing';

export function createDefaultVoiceCustomTargetPresetDraft(
  overrides: Partial<VoiceCustomTargetPresetDraft> = {},
): VoiceCustomTargetPresetDraft {
  return {
    presetId: null,
    name: '',
    basePreset: 'cute-feminine',
    pitchFloorHz: '',
    pitchCeilingHz: '',
    resonanceFloor: '',
    resonanceCeiling: '',
    weightFloor: '',
    weightCeiling: '',
    stylePrompt: '',
    notesText: '',
    ...overrides,
  };
}

export function normalizeVoiceTargetSource(value: unknown): VoiceTargetSource {
  return value === 'reference'
    || value === 'custom-reference'
    || value === 'custom-handmade'
    ? value
    : 'built-in';
}

export function createDefaultVoiceUiState(overrides: Partial<VoiceUiState> = {}): VoiceUiState {
  const defaults: VoiceUiState = {
    status: 'idle',
    targetPreset: 'cute-feminine',
    targetSource: 'built-in',
    selectedCustomPresetId: null,
    selectedCustomPresetName: null,
    voiceSessionId: null,
    lessonId: null,
    referenceClipId: null,
    referenceClipName: null,
    streamUrl: null,
    frontDoorDismissed: false,
    serviceStatus: 'unknown',
    sessionStartedAt: null,
    endedAt: null,
    lastSummary: null,
    lastAttemptArtifact: null,
    strainWatch: null,
    repContext: null,
    attemptArtifacts: [],
    studentModelAttemptIds: [],
    selfReportDraft: createDefaultVoiceSelfReport(),
    phraseComparison: null,
    lastTakeTimeline: null,
    lastCoachMessage: null,
    lastCoachGeneratedAt: null,
    lastError: null,
    referenceAnalysis: null,
    targetVoiceProfile: null,
    phraseForecast: null,
    forecastPhrase: null,
    activeLine: null,
    lineQueue: [],
    lineDifficultyPreference: 'adaptive',
    coachThread: [],
    coachVoice: {
      speechEnabled: true,
      continuousEnabled: false,
      // Voice Tutor is target-voice-first. VoxCPM works in the Android WebView
      // and preserves the learner's selected reference; browser TTS is only a
      // runtime fallback on hosts that actually expose speechSynthesis.
      speechProvider: 'voxcpm',
      inputProvider: 'backend',
      activeReferenceClipId: null,
      activeReferenceClipName: null,
    },
    voiceInputRuntime: {
      status: 'idle',
      lastOutcome: 'idle',
      requestedProvider: 'browser',
      effectiveProvider: null,
      captureProvider: null,
      providerStyle: null,
      transcriptSource: null,
      lastTranscript: null,
      lastTranscriptConfidence: null,
      lastCaptureStartedAt: null,
      lastSpeechDetectedAt: null,
      lastCapturedAt: null,
      lastProcessedAt: null,
      lastCaptureDurationMs: null,
      lastRoundTripMs: null,
      successfulTurns: 0,
      noSpeechTurns: 0,
      errorCount: 0,
      consecutiveNoSpeechTurns: 0,
      consecutiveErrorTurns: 0,
      liveSessionId: null,
      lastSegmentId: null,
      liveEngine: null,
      liveInterimMode: null,
      liveVadStrategy: null,
      providerTarget: null,
      providerModel: null,
      providerLanguage: null,
      providerEndpointing: null,
      lastPartialTranscript: null,
      lastPartialTranscriptAt: null,
      lastVadState: null,
      lastBargeInAt: null,
      lastAnalysisSummary: null,
      lastAnalysisDurationMs: null,
      lastAverageLevelDb: null,
      lastPeakLevelDb: null,
      lastNoiseFloorDb: null,
      lastSnrDb: null,
      lastClippingPct: null,
      lastCaptureReliability: null,
      lastReliabilityFlags: [],
      lastSpeechDurationMs: null,
      lastAudioProcessedMs: null,
      lastError: null,
      lastEventAt: null,
    },
    voiceConditioning: {
      useTargetProfileStyle: true,
      styleInstruction: '',
      promptText: '',
      promptAudioName: null,
      promptLatentsReady: false,
      referenceAudioName: null,
      referenceLatentsReady: false,
      updatedAt: null,
    },
    advancedPanel: {
      open: false,
      vadRmsThreshold: 0.018,
      vadSilenceHoldMs: 4500,
      vadNoSpeechTimeoutMs: 12000,
      vadMinSpeechMs: 350,
      audioPreferWorklet: true,
    },
    deeptutorVoiceState: null,
    customTargetPresets: [],
    customTargetPresetDraft: createDefaultVoiceCustomTargetPresetDraft(),
  };

  return {
    ...defaults,
    ...overrides,
    advancedPanel: {
      ...defaults.advancedPanel,
      ...(overrides.advancedPanel || {}),
    },
    customTargetPresetDraft: createDefaultVoiceCustomTargetPresetDraft(
      overrides.customTargetPresetDraft || {},
    ),
  };
}

export function normalizeVoicePracticeLine(value: Partial<VoicePracticeLine> | null | undefined): VoicePracticeLine | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const displayText = typeof value.displayText === 'string' ? value.displayText.trim() : '';
  if (!displayText) {
    return null;
  }

  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `voice-line-${Date.now()}`,
    displayText,
    performanceText: typeof value.performanceText === 'string' && value.performanceText.trim()
      ? value.performanceText.trim()
      : displayText,
    intent: typeof value.intent === 'string' && value.intent.trim() ? value.intent.trim() : null,
    difficulty: value.difficulty === 'easy' || value.difficulty === 'hard' ? value.difficulty : 'medium',
    targetPreset: typeof value.targetPreset === 'string' && value.targetPreset.trim() ? value.targetPreset.trim() : null,
    teachingFocus: Array.isArray(value.teachingFocus)
      ? value.teachingFocus.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
      : [],
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : null,
    referenceMode: typeof value.referenceMode === 'string' && value.referenceMode.trim() ? value.referenceMode.trim() : null,
    cueSheet: normalizeVoiceCueSheet(value.cueSheet),
    pinned: Boolean(value.pinned),
  };
}

function normalizeVoiceCoachMessage(value: Partial<VoiceCoachMessage> | null | undefined): VoiceCoachMessage | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const content = typeof value.content === 'string' ? value.content.trim() : '';
  if (!content) {
    return null;
  }
  const kind = typeof value.kind === 'string' && value.kind.trim() ? value.kind.trim() : 'note';
  const channel = value.channel === 'legacy'
    || value.channel === 'runtime'
    || value.channel === 'deeptutor'
    || value.channel === 'shortcut'
    || value.channel === 'coach'
    ? value.channel
    : resolveVoiceCoachMessageChannel(kind);
  return {
    id: typeof value.id === 'string' && value.id.trim() ? value.id.trim() : `voice-msg-${Date.now()}`,
    role: value.role === 'user' ? 'user' : 'coach',
    channel,
    kind,
    content,
    createdAt: Number.isFinite(Number(value.createdAt)) ? Math.round(Number(value.createdAt)) : Date.now(),
  };
}

export function resolveVoiceCoachMessageChannel(kind: string | null | undefined): VoiceCoachMessageChannel {
  const normalizedKind = typeof kind === 'string' ? kind.trim() : '';
  if (!normalizedKind || normalizedKind === 'note' || normalizedKind === 'follow-up-question') {
    return 'coach';
  }
  if (normalizedKind === 'legacy-answer' || normalizedKind === 'legacy-take-feedback') {
    return 'legacy';
  }
  if (normalizedKind.startsWith('runtime-')) {
    return 'runtime';
  }
  if (normalizedKind.startsWith('deeptutor-')) {
    return 'deeptutor';
  }
  if (normalizedKind.startsWith('brief-') || normalizedKind === 'brief-action-question') {
    return 'shortcut';
  }
  return 'coach';
}

export function getLatestVoiceCoachThreadMessage(
  coachThread: VoiceCoachMessage[] | null | undefined,
  role: VoiceCoachMessage['role'] = 'coach',
): VoiceCoachMessage | null {
  const thread = Array.isArray(coachThread) ? coachThread : [];
  for (let index = thread.length - 1; index >= 0; index -= 1) {
    const message = normalizeVoiceCoachMessage(thread[index]);
    if (message && message.role === role) {
      return message;
    }
  }
  return null;
}

function normalizeVoiceCoachVoiceState(value: Partial<VoiceCoachVoiceState> | null | undefined): VoiceCoachVoiceState {
  return {
    speechEnabled: value?.speechEnabled !== false,
    continuousEnabled: Boolean(value?.continuousEnabled),
    speechProvider: value?.speechProvider === 'browser' ? 'browser' : 'voxcpm',
    inputProvider: value?.inputProvider === 'browser' ? 'browser' : 'backend',
    activeReferenceClipId: typeof value?.activeReferenceClipId === 'string' && value.activeReferenceClipId.trim()
      ? value.activeReferenceClipId.trim()
      : null,
    activeReferenceClipName: typeof value?.activeReferenceClipName === 'string' && value.activeReferenceClipName.trim()
      ? value.activeReferenceClipName.trim()
      : null,
  };
}

export function normalizeVoiceConditioningState(value: Partial<VoiceConditioningState> | null | undefined): VoiceConditioningState {
  return {
    useTargetProfileStyle: value?.useTargetProfileStyle !== false,
    styleInstruction: typeof value?.styleInstruction === 'string' ? value.styleInstruction.trim().slice(0, 200) : '',
    promptText: typeof value?.promptText === 'string' ? value.promptText.trim().slice(0, 500) : '',
    promptAudioName: typeof value?.promptAudioName === 'string' && value.promptAudioName.trim()
      ? value.promptAudioName.trim().slice(0, 120)
      : null,
    promptLatentsReady: Boolean(value?.promptLatentsReady),
    referenceAudioName: typeof value?.referenceAudioName === 'string' && value.referenceAudioName.trim()
      ? value.referenceAudioName.trim().slice(0, 120)
      : null,
    referenceLatentsReady: Boolean(value?.referenceLatentsReady),
    updatedAt: Number.isFinite(Number(value?.updatedAt)) ? Math.round(Number(value?.updatedAt)) : null,
  };
}

function normalizeVoiceSelfReportScale(value: unknown): number | null {
  if (value === null || value === undefined || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  const rounded = Math.round(numeric);
  return rounded >= 1 && rounded <= 5 ? rounded : null;
}

function normalizeVoiceSelfReportMetadata(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .map(([key, entry]) => [key.trim().slice(0, 80), entry] as const)
    .filter(([key, entry]) => key && entry !== undefined);
  return entries.length > 0 ? Object.fromEntries(entries.slice(0, 12)) : null;
}

export function normalizeVoiceSelfReport(value: Partial<VoiceSelfReport> | null | undefined): VoiceSelfReport | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const normalized: VoiceSelfReport = {
    perceivedDifficulty: normalizeVoiceSelfReportScale(value.perceivedDifficulty),
    effort: normalizeVoiceSelfReportScale(value.effort),
    confidence: normalizeVoiceSelfReportScale(value.confidence),
    strain: normalizeVoiceSelfReportScale(value.strain),
    fatigue: normalizeVoiceSelfReportScale(value.fatigue),
    notes: typeof value.notes === 'string' && value.notes.trim() ? value.notes.trim().slice(0, 240) : null,
    tags: normalizeVoiceStringList(value.tags, 8, 80),
    metadata: normalizeVoiceSelfReportMetadata(value.metadata),
  };
  return Object.entries(normalized).some(([key, entry]) => {
    if (key === 'tags') {
      return Array.isArray(entry) && entry.length > 0;
    }
    return entry !== null && entry !== undefined && entry !== '';
  }) ? normalized : null;
}

export function createDefaultVoiceSelfReport(
  overrides: Partial<VoiceSelfReport> = {},
): VoiceSelfReport {
  return {
    perceivedDifficulty: null,
    effort: null,
    confidence: null,
    strain: null,
    fatigue: null,
    notes: null,
    tags: [],
    metadata: null,
    ...(normalizeVoiceSelfReport(overrides) || {}),
  };
}

function normalizeVoiceAdvancedPanelState(value: Partial<VoiceAdvancedPanelState> | null | undefined): VoiceAdvancedPanelState {
  const defaults = createDefaultVoiceUiState().advancedPanel;
  const merged = {
    ...defaults,
    ...(value || {}),
  };

  const vadRmsThresholdRaw = Number(merged.vadRmsThreshold);
  const vadRmsThreshold = Number.isFinite(vadRmsThresholdRaw)
    ? Number(Math.max(0.003, Math.min(0.08, vadRmsThresholdRaw)).toFixed(4))
    : defaults.vadRmsThreshold;

  // The fallback boundary is an accessibility invariant shared with the live
  // Smart Turn lane; stale persisted UI settings may not lengthen/shorten it.
  const vadSilenceHoldMs = 4500;

  const vadNoSpeechTimeoutMsRaw = Number(merged.vadNoSpeechTimeoutMs);
  const vadNoSpeechTimeoutMs = Number.isFinite(vadNoSpeechTimeoutMsRaw)
    ? Math.max(2000, Math.min(20000, Math.round(vadNoSpeechTimeoutMsRaw)))
    : defaults.vadNoSpeechTimeoutMs;

  const vadMinSpeechMsRaw = Number(merged.vadMinSpeechMs);
  const vadMinSpeechMs = Number.isFinite(vadMinSpeechMsRaw)
    ? Math.max(150, Math.min(2000, Math.round(vadMinSpeechMsRaw)))
    : defaults.vadMinSpeechMs;

  return {
    open: Boolean(merged.open),
    vadRmsThreshold,
    vadSilenceHoldMs,
    vadNoSpeechTimeoutMs,
    vadMinSpeechMs,
    audioPreferWorklet: merged.audioPreferWorklet !== false,
  };
}

function normalizeDeepTutorVoiceKnowledgePoint(value: Partial<DeepTutorVoiceKnowledgePoint> | null | undefined): DeepTutorVoiceKnowledgePoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const title = typeof value.title === 'string' ? value.title.trim() : '';
  const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
  const difficulty = typeof value.difficulty === 'string' ? value.difficulty.trim() : '';
  if (!title && !summary && !difficulty) {
    return null;
  }

  return {
    title: title || 'Voice coaching focus',
    summary,
    difficulty,
  };
}

function createDefaultDeepTutorVoiceLessonBoard(overrides: Partial<DeepTutorVoiceLessonBoard> = {}): DeepTutorVoiceLessonBoard {
  return {
    title: '',
    prompt: '',
    performanceText: '',
    focus: [],
    instruction: '',
    difficultyNote: '',
    progressLabel: '',
    latestNote: '',
    mimicDirective: null,
    ...overrides,
  };
}

export function normalizeDeepTutorVoiceCoachBrief(
  value: Partial<DeepTutorVoiceCoachBrief> | null | undefined,
): DeepTutorVoiceCoachBrief | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const displayText = typeof value.displayText === 'string' ? value.displayText.trim() : '';
  const spokenText = typeof value.spokenText === 'string' && value.spokenText.trim()
    ? value.spokenText.trim()
    : displayText;
  const cueText = typeof value.cueText === 'string' ? value.cueText.trim() : '';
  const correctionFocus = Array.isArray(value.correctionFocus)
    ? value.correctionFocus.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const listenFor = typeof value.listenFor === 'string' ? value.listenFor.trim() : '';
  const nextStep = typeof value.nextStep === 'string' ? value.nextStep.trim() : '';
  const immediateAction: DeepTutorVoiceCoachBrief['immediateAction'] = value.immediateAction === 'practice' ? 'practice' : 'coach';
  const quickActions = Array.isArray(value.quickActions)
    ? value.quickActions.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const repeatResponse = typeof value.repeatResponse === 'string' ? value.repeatResponse.trim() : '';
  const slowerResponse = typeof value.slowerResponse === 'string' ? value.slowerResponse.trim() : '';
  const whyResponse = typeof value.whyResponse === 'string' ? value.whyResponse.trim() : '';
  const holdResponse = typeof value.holdResponse === 'string' ? value.holdResponse.trim() : '';

  return displayText
    || spokenText
    || cueText
    || correctionFocus.length > 0
    || listenFor
    || nextStep
    || value.immediateAction === 'practice'
    || quickActions.length > 0
    || repeatResponse
    || slowerResponse
    || whyResponse
    || holdResponse
    ? {
        displayText,
        spokenText,
        cueText,
        correctionFocus,
        listenFor,
        nextStep,
        immediateAction,
        quickActions,
        repeatResponse,
        slowerResponse,
        whyResponse,
        holdResponse,
      }
    : null;
}

function normalizeDeepTutorVoiceMimicDirective(
  value: Partial<DeepTutorVoiceMimicDirective> | null | undefined,
): DeepTutorVoiceMimicDirective | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const action = typeof value.action === 'string' ? value.action.trim() : '';
  const normalizedAction: DeepTutorVoiceMimicDirective['action'] = ['load', 'ready', 'mimic', 'repeat', 'hold'].includes(action)
    ? action as DeepTutorVoiceMimicDirective['action']
    : 'ready';
  const targetKey = typeof value.targetKey === 'string' && value.targetKey.trim() ? value.targetKey.trim() : null;
  const statusLabel = typeof value.statusLabel === 'string' ? value.statusLabel.trim() : '';
  const instruction = typeof value.instruction === 'string' ? value.instruction.trim() : '';
  const rawSuggestedRepeats: unknown = value.suggestedRepeats;
  const suggestedRepeats = rawSuggestedRepeats === null || rawSuggestedRepeats === undefined
    || (typeof rawSuggestedRepeats === 'string' && !rawSuggestedRepeats.trim())
    ? null
    : Number.isFinite(Number(rawSuggestedRepeats))
    ? Math.max(0, Math.round(Number(rawSuggestedRepeats)))
    : null;

  return statusLabel || instruction || suggestedRepeats !== null || action
    ? {
        action: normalizedAction,
        targetKey,
        statusLabel,
        instruction,
        suggestedRepeats,
      }
    : null;
}

function normalizeDeepTutorVoiceMimicProgress(
  value: Partial<DeepTutorVoiceMimicProgress> | null | undefined,
): DeepTutorVoiceMimicProgress | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const targetKey = typeof value.targetKey === 'string' && value.targetKey.trim() ? value.targetKey.trim() : null;
  const completedRepeats = Number.isFinite(Number(value.completedRepeats))
    ? Math.max(0, Math.round(Number(value.completedRepeats)))
    : 0;
  const targetRepeats = Number.isFinite(Number(value.targetRepeats))
    ? Math.max(0, Math.round(Number(value.targetRepeats)))
    : 0;
  const lastCompletedAt = Number.isFinite(Number(value.lastCompletedAt)) ? Math.round(Number(value.lastCompletedAt)) : null;

  return targetKey || completedRepeats > 0 || targetRepeats > 0 || lastCompletedAt !== null
    ? {
        targetKey,
        completedRepeats,
        targetRepeats,
        lastCompletedAt,
      }
    : null;
}

function normalizeDeepTutorVoiceInputEvidence(
  value: Partial<DeepTutorVoiceInputEvidence> | null | undefined,
): DeepTutorVoiceInputEvidence | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const status = typeof value.status === 'string' && value.status.trim() ? value.status.trim() : 'idle';
  const outcome = typeof value.outcome === 'string' && value.outcome.trim() ? value.outcome.trim() : 'idle';
  const transcript = typeof value.transcript === 'string' && value.transcript.trim() ? value.transcript.trim().slice(0, 240) : null;
  const partialTranscript = typeof value.partialTranscript === 'string' && value.partialTranscript.trim() ? value.partialTranscript.trim().slice(0, 240) : null;
  const transcriptSource = typeof value.transcriptSource === 'string' && value.transcriptSource.trim() ? value.transcriptSource.trim().slice(0, 80) : null;
  const providerStyle = typeof value.providerStyle === 'string' && value.providerStyle.trim() ? value.providerStyle.trim().slice(0, 80) : null;
  const liveEngine = typeof value.liveEngine === 'string' && value.liveEngine.trim() ? value.liveEngine.trim().slice(0, 120) : null;
  const liveInterimMode = typeof value.liveInterimMode === 'string' && value.liveInterimMode.trim() ? value.liveInterimMode.trim().slice(0, 40) : null;
  const liveVadStrategy = typeof value.liveVadStrategy === 'string' && value.liveVadStrategy.trim() ? value.liveVadStrategy.trim().slice(0, 40) : null;
  const providerTarget = typeof value.providerTarget === 'string' && value.providerTarget.trim() ? value.providerTarget.trim().slice(0, 160) : null;
  const providerModel = typeof value.providerModel === 'string' && value.providerModel.trim() ? value.providerModel.trim().slice(0, 120) : null;
  const providerLanguage = typeof value.providerLanguage === 'string' && value.providerLanguage.trim() ? value.providerLanguage.trim().slice(0, 40) : null;
  const providerEndpointing = typeof value.providerEndpointing === 'string' && value.providerEndpointing.trim() ? value.providerEndpointing.trim().slice(0, 160) : null;
  const vadState = typeof value.vadState === 'string' && value.vadState.trim() ? value.vadState.trim().slice(0, 40) : null;
  const analysisSummary = typeof value.analysisSummary === 'string' && value.analysisSummary.trim() ? value.analysisSummary.trim().slice(0, 240) : null;
  const speechDurationMs = normalizeVoiceCount(value.speechDurationMs);
  const captureDurationMs = normalizeVoiceCount(value.captureDurationMs);
  const audioProcessedMs = normalizeVoiceCount(value.audioProcessedMs);
  const roundTripMs = normalizeVoiceCount(value.roundTripMs);
  const lastProcessedAt = normalizeVoiceCount(value.lastProcessedAt);
  const lastEventAt = normalizeVoiceCount(value.lastEventAt);
  const lastBargeInAt = normalizeVoiceCount(value.lastBargeInAt);
  const lastError = typeof value.lastError === 'string' && value.lastError.trim() ? value.lastError.trim().slice(0, 200) : null;

  return (
    status !== 'idle'
    || outcome !== 'idle'
    || transcript
    || partialTranscript
    || transcriptSource
    || providerStyle
    || liveEngine
    || liveInterimMode
    || liveVadStrategy
    || providerTarget
    || providerModel
    || providerLanguage
    || providerEndpointing
    || vadState
    || analysisSummary
    || speechDurationMs !== null
    || captureDurationMs !== null
    || audioProcessedMs !== null
    || roundTripMs !== null
    || lastProcessedAt !== null
    || lastEventAt !== null
    || lastBargeInAt !== null
    || lastError
  )
    ? {
        status,
        outcome,
        transcript,
        partialTranscript,
        transcriptSource,
        providerStyle,
        liveEngine,
        liveInterimMode,
        liveVadStrategy,
        providerTarget,
        providerModel,
        providerLanguage,
        providerEndpointing,
        vadState,
        analysisSummary,
        speechDurationMs,
        captureDurationMs,
        audioProcessedMs,
        roundTripMs,
        lastProcessedAt,
        lastEventAt,
        lastBargeInAt,
        lastError,
      }
    : null;
}

function normalizeDeepTutorVoiceLessonBoard(value: Partial<DeepTutorVoiceLessonBoard> | null | undefined): DeepTutorVoiceLessonBoard | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const normalized = createDefaultDeepTutorVoiceLessonBoard(value);
  normalized.title = typeof normalized.title === 'string' ? normalized.title.trim() : '';
  normalized.prompt = typeof normalized.prompt === 'string' ? normalized.prompt.trim() : '';
  normalized.performanceText = typeof normalized.performanceText === 'string' ? normalized.performanceText.trim() : '';
  normalized.focus = Array.isArray(normalized.focus)
    ? normalized.focus.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  normalized.instruction = typeof normalized.instruction === 'string' ? normalized.instruction.trim() : '';
  normalized.difficultyNote = typeof normalized.difficultyNote === 'string' ? normalized.difficultyNote.trim() : '';
  normalized.progressLabel = typeof normalized.progressLabel === 'string' ? normalized.progressLabel.trim() : '';
  normalized.latestNote = typeof normalized.latestNote === 'string' ? normalized.latestNote.trim() : '';
  normalized.mimicDirective = normalizeDeepTutorVoiceMimicDirective(normalized.mimicDirective);

  return normalized.title
    || normalized.prompt
    || normalized.performanceText
    || normalized.focus.length > 0
    || normalized.instruction
    || normalized.difficultyNote
    || normalized.progressLabel
    || normalized.latestNote
    || normalized.mimicDirective
    ? normalized
    : null;
}

function createDefaultDeepTutorVoiceState(overrides: Partial<DeepTutorVoiceState> = {}): DeepTutorVoiceState {
  return {
    enabled: false,
    status: 'idle',
    runtimeState: 'off',
    guideSessionId: null,
    guideSessionStatus: 'idle',
    memoryProject: null,
    studentId: null,
    currentIndex: null,
    totalPoints: 0,
    knowledgePoints: [],
    currentKnowledge: null,
    lessonBoard: null,
    coachBrief: null,
    mimicProgress: null,
    latestInputEvidence: null,
    lastTutorMessage: null,
    lastUserMessage: null,
    lastStartedAt: null,
    lastSyncedAt: null,
    lastError: null,
    ...overrides,
  };
}

export function normalizeDeepTutorVoiceState(value: Partial<DeepTutorVoiceState> | null | undefined): DeepTutorVoiceState {
  const normalized = createDefaultDeepTutorVoiceState(value || {});
  normalized.status = typeof normalized.status === 'string' && normalized.status.trim() ? normalized.status.trim() : 'idle';
  normalized.runtimeState = typeof normalized.runtimeState === 'string' && normalized.runtimeState.trim() ? normalized.runtimeState.trim() : 'off';
  normalized.guideSessionId = typeof normalized.guideSessionId === 'string' && normalized.guideSessionId.trim() ? normalized.guideSessionId.trim() : null;
  normalized.guideSessionStatus = typeof normalized.guideSessionStatus === 'string' && normalized.guideSessionStatus.trim()
    ? normalized.guideSessionStatus.trim()
    : normalized.status;
  normalized.memoryProject = typeof normalized.memoryProject === 'string' && normalized.memoryProject.trim()
    ? normalized.memoryProject.trim()
    : null;
  normalized.studentId = typeof normalized.studentId === 'string' && normalized.studentId.trim() ? normalized.studentId.trim() : null;
  normalized.currentIndex = Number.isFinite(Number(normalized.currentIndex)) ? Math.round(Number(normalized.currentIndex)) : null;
  normalized.totalPoints = Number.isFinite(Number(normalized.totalPoints)) ? Math.max(0, Math.round(Number(normalized.totalPoints))) : 0;
  normalized.knowledgePoints = Array.isArray(normalized.knowledgePoints)
    ? normalized.knowledgePoints
        .map((item) => normalizeDeepTutorVoiceKnowledgePoint(item))
        .filter(Boolean) as DeepTutorVoiceKnowledgePoint[]
    : [];
  normalized.currentKnowledge = normalizeDeepTutorVoiceKnowledgePoint(normalized.currentKnowledge);
  normalized.lessonBoard = normalizeDeepTutorVoiceLessonBoard(normalized.lessonBoard);
  normalized.coachBrief = normalizeDeepTutorVoiceCoachBrief(normalized.coachBrief);
  normalized.mimicProgress = normalizeDeepTutorVoiceMimicProgress(normalized.mimicProgress);
  normalized.latestInputEvidence = normalizeDeepTutorVoiceInputEvidence(normalized.latestInputEvidence);
  normalized.lastTutorMessage = typeof normalized.lastTutorMessage === 'string' && normalized.lastTutorMessage.trim()
    ? normalized.lastTutorMessage.trim()
    : null;
  normalized.lastUserMessage = typeof normalized.lastUserMessage === 'string' && normalized.lastUserMessage.trim()
    ? normalized.lastUserMessage.trim()
    : null;
  normalized.lastStartedAt = Number.isFinite(Number(normalized.lastStartedAt)) ? Math.round(Number(normalized.lastStartedAt)) : null;
  normalized.lastSyncedAt = Number.isFinite(Number(normalized.lastSyncedAt)) ? Math.round(Number(normalized.lastSyncedAt)) : null;
  normalized.lastError = typeof normalized.lastError === 'string' && normalized.lastError.trim()
    ? normalized.lastError.trim()
    : null;
  return normalized;
}

export function isDeepTutorVoiceGuideInProgress(
  value: Partial<DeepTutorVoiceState> | null | undefined,
): boolean {
  const normalized = normalizeDeepTutorVoiceState(value);
  if (!normalized.guideSessionId) {
    return false;
  }

  const status = (normalized.guideSessionStatus || normalized.status || '').trim().toLowerCase();
  return status !== 'completed' && status !== 'error';
}

export function getDeepTutorVoiceLessonMode(
  value: Partial<DeepTutorVoiceState> | null | undefined,
): DeepTutorVoiceLessonMode {
  return deepTutorInteractionContract.getDeepTutorVoiceLessonMode(value, {
    normalizeDeepTutorVoiceState,
    isDeepTutorVoiceGuideInProgress,
  }) as DeepTutorVoiceLessonMode;
}

export function resolveDeepTutorVoiceRuntimeOwner(
  value: Partial<DeepTutorVoiceState> | null | undefined,
): DeepTutorVoiceRuntimeOwner {
  return deepTutorInteractionContract.resolveDeepTutorVoiceRuntimeOwner(value, {
    normalizeDeepTutorVoiceState,
    isDeepTutorVoiceGuideInProgress,
  }) as DeepTutorVoiceRuntimeOwner;
}

export function resolveDeepTutorVoicePracticeIntent(
  value: Partial<DeepTutorVoiceState> | null | undefined,
  options: {
    referenceMimicAction?: string | null;
  } = {},
): DeepTutorVoicePracticeIntent {
  return deepTutorInteractionContract.resolveDeepTutorVoicePracticeIntent(value, {
    normalizeDeepTutorVoiceState,
    isDeepTutorVoiceGuideInProgress,
    referenceMimicAction: options.referenceMimicAction ?? null,
  }) as DeepTutorVoicePracticeIntent;
}

export function createDeepTutorVoiceSharedInteractionState(
  value: Partial<DeepTutorVoiceState> | null | undefined,
  options: {
    referenceMimicAction?: string | null;
  } = {},
): DeepTutorVoiceSharedInteractionState {
  return deepTutorInteractionContract.createDeepTutorVoiceSharedInteractionState(value, {
    normalizeDeepTutorVoiceState,
    isDeepTutorVoiceGuideInProgress,
    referenceMimicAction: options.referenceMimicAction ?? null,
  }) as DeepTutorVoiceSharedInteractionState;
}

function normalizeVoiceFrame(value: Partial<VoiceLiveFrame> | null | undefined): VoiceLiveFrame | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  return {
    t: Math.max(0, Number(value.t) || 0),
    voiced: Boolean(value.voiced),
    pitchHz: Number(value.pitchHz) || 0,
    pitchScore: Number(value.pitchScore) || 0,
    resonanceScore: Number(value.resonanceScore) || 0,
    weightScore: Number(value.weightScore) || 0,
    confidence: Number(value.confidence) || 0,
    loudnessDb: Number(value.loudnessDb) || 0,
    advanced: normalizeVoiceFrameAdvancedMetrics(value.advanced),
    analysisVersion: typeof value.analysisVersion === 'string' && value.analysisVersion.trim()
      ? value.analysisVersion.trim().slice(0, 80)
      : null,
  };
}

function normalizeVoiceFiniteNumber(value: unknown, digits = 3): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Number(numeric.toFixed(digits))
    : null;
}

function normalizeVoiceDbNumber(value: unknown): number | null {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Number(numeric.toFixed(2))
    : null;
}

function normalizeVoiceCount(value: unknown): number | null {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : null;
}

function normalizeVoiceUnitMetric(value: unknown): number | null {
  const numeric = normalizeVoiceFiniteNumber(value, 5);
  return numeric == null ? null : clampVoiceMetric(numeric, 0, 1);
}

function normalizeVoiceStringList(value: unknown, maxItems = 6, maxLength = 120): string[] {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean).slice(0, maxItems).map((item) => item.slice(0, maxLength))
    : [];
}

function normalizeVoiceFrameAdvancedMetrics(
  value: Partial<VoiceFrameAdvancedMetrics> | null | undefined,
): VoiceFrameAdvancedMetrics | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceFrameAdvancedMetrics = {
    pitchConfidence: normalizeVoiceConfidence(value.pitchConfidence),
    voicedProbability: normalizeVoiceConfidence(value.voicedProbability),
    rms: normalizeVoiceFiniteNumber(value.rms, 5),
    spectralCentroidHz: normalizeVoiceFiniteNumber(value.spectralCentroidHz, 2),
    spectralBandwidthHz: normalizeVoiceFiniteNumber(value.spectralBandwidthHz, 2),
    spectralFlux: normalizeVoiceFiniteNumber(value.spectralFlux, 4),
    spectralTiltDbPerOct: normalizeVoiceFiniteNumber(value.spectralTiltDbPerOct, 3),
    harmonicRatio: normalizeVoiceConfidence(value.harmonicRatio),
    harmonicNoiseRatioDb: normalizeVoiceDbNumber(value.harmonicNoiseRatioDb),
    clippingPct: normalizeVoiceConfidence(value.clippingPct),
    pitchSlopeStPerSec: normalizeVoiceFiniteNumber(value.pitchSlopeStPerSec, 3),
    stabilityScore: normalizeVoiceConfidence(value.stabilityScore),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

export function normalizeVoiceAttemptAdvancedMetrics(
  value: Partial<VoiceAttemptAdvancedMetrics> | null | undefined,
): VoiceAttemptAdvancedMetrics | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceAttemptAdvancedMetrics = {
    sampleCount: normalizeVoiceCount(value.sampleCount),
    voicedFramePct: normalizeVoiceConfidence(value.voicedFramePct),
    confidentFramePct: normalizeVoiceConfidence(value.confidentFramePct),
    scoreConfidence: normalizeVoiceConfidence(value.scoreConfidence),
    measurementAvailable: value.measurementAvailable === true
      ? true
      : value.measurementAvailable === false ? false : null,
    measurementRejectionReasons: normalizeVoiceStringList([
      ...(Array.isArray(value.measurementRejectionReasons) ? value.measurementRejectionReasons : []),
      ...(Array.isArray(value.rejectionReasons) ? value.rejectionReasons : []),
    ], 8, 80),
    pitchValidFrameCount: normalizeVoiceCount(value.pitchValidFrameCount),
    hnrValidFrameCount: normalizeVoiceCount(value.hnrValidFrameCount),
    hnrVoicedCoveragePct: normalizeVoiceConfidence(value.hnrVoicedCoveragePct),
    captureReliability: normalizeVoiceConfidence(value.captureReliability),
    noiseFloorDb: normalizeVoiceDbNumber(value.noiseFloorDb),
    snrDb: normalizeVoiceDbNumber(value.snrDb),
    clippingPct: normalizeVoiceConfidence(value.clippingPct),
    meanLoudnessDb: normalizeVoiceDbNumber(value.meanLoudnessDb),
    peakLoudnessDb: normalizeVoiceDbNumber(value.peakLoudnessDb),
    loudnessRangeDb: normalizeVoiceDbNumber(value.loudnessRangeDb),
    medianPitchHz: normalizeVoiceFiniteNumber(value.medianPitchHz, 2),
    pitchP10Hz: normalizeVoiceFiniteNumber(value.pitchP10Hz, 2),
    pitchP90Hz: normalizeVoiceFiniteNumber(value.pitchP90Hz, 2),
    pitchStdSt: normalizeVoiceFiniteNumber(value.pitchStdSt, 3),
    phraseStartPitchHz: normalizeVoiceFiniteNumber(value.phraseStartPitchHz, 2),
    phraseEndPitchHz: normalizeVoiceFiniteNumber(value.phraseEndPitchHz, 2),
    phraseEndDropHz: normalizeVoiceFiniteNumber(value.phraseEndDropHz, 2),
    pitchDriftSt: normalizeVoiceFiniteNumber(value.pitchDriftSt, 3),
    // Phase 1.2: derived coaching metrics
    pitchTargetOccupancyPct: normalizeVoiceFiniteNumber(value.pitchTargetOccupancyPct, 1),
    phraseFinalDropSemitones: normalizeVoiceFiniteNumber(value.phraseFinalDropSemitones, 2),
    spectralCentroidMeanHz: normalizeVoiceFiniteNumber(value.spectralCentroidMeanHz, 2),
    spectralTiltMeanDbPerOct: normalizeVoiceFiniteNumber(value.spectralTiltMeanDbPerOct, 3),
    harmonicRatioMean: normalizeVoiceConfidence(value.harmonicRatioMean),
    stabilityMean: normalizeVoiceConfidence(value.stabilityMean),
    metricSimilarity: normalizeVoiceConfidence(value.metricSimilarity),
    contourSimilarity: normalizeVoiceConfidence(value.contourSimilarity),
    glideSmoothness: normalizeVoiceConfidence(value.glideSmoothness),
    f2RangeHz: normalizeVoiceFiniteNumber(value.f2RangeHz, 2),
    trillRateHz: normalizeVoiceFiniteNumber(value.trillRateHz, 2),
    trillDetected: value.trillDetected === true
      ? true
      : value.trillDetected === false ? false : null,
    trillDurationMs: normalizeVoiceCount(value.trillDurationMs),
    hitPitchCeiling: value.hitPitchCeiling === true
      ? true
      : value.hitPitchCeiling === false ? false : null,
    analysisProfile: typeof value.analysisProfile === 'string' && value.analysisProfile.trim()
      ? value.analysisProfile.trim().slice(0, 80)
      : null,
    formantLite: normalizeVoiceAttemptFormantLiteMetrics(value.formantLite),
    quality: normalizeVoiceAttemptQualityMetrics(value.quality),
    reliabilityFlags: normalizeVoiceStringList(value.reliabilityFlags, 6, 80),
  };
  return Object.entries(normalized).some(([key, entry]) => (
    key === 'reliabilityFlags' || key === 'measurementRejectionReasons'
      ? (entry as string[]).length > 0
      : entry != null
  ))
    ? normalized
    : null;
}

export function normalizeVoiceAttemptTarget(
  value: Partial<VoiceAttemptTarget> | null | undefined,
): VoiceAttemptTarget | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const text = (input: unknown, max: number): string | null => (
    typeof input === 'string' && input.trim() ? input.trim().slice(0, max) : null
  );
  const direction = ['feminine', 'masculine', 'neutral'].includes(String(value.direction || ''))
    ? value.direction as VoiceAttemptTarget['direction']
    : null;
  const placement = ['below', 'in_band', 'above'].includes(String(value.pitchPlacement || ''))
    ? value.pitchPlacement as VoiceAttemptTarget['pitchPlacement']
    : null;
  const normalized: VoiceAttemptTarget = {
    source: text(value.source, 80),
    targetPreset: text(value.targetPreset, 80),
    targetProfileId: text(value.targetProfileId, 160),
    direction,
    pitchFloorHz: normalizeVoiceFiniteNumber(value.pitchFloorHz, 2),
    pitchCeilingHz: normalizeVoiceFiniteNumber(value.pitchCeilingHz, 2),
    resonanceFloor: normalizeVoiceConfidence(value.resonanceFloor),
    resonanceCeiling: normalizeVoiceConfidence(value.resonanceCeiling),
    weightFloor: normalizeVoiceConfidence(value.weightFloor),
    weightCeiling: normalizeVoiceConfidence(value.weightCeiling),
    minTargetHitPct: normalizeVoiceConfidence(value.minTargetHitPct),
    minSimilarityScore: normalizeVoiceConfidence(value.minSimilarityScore),
    minResonance: normalizeVoiceConfidence(value.minResonance),
    maxWeight: normalizeVoiceConfidence(value.maxWeight),
    minPitchRangeSt: normalizeVoiceFiniteNumber(value.minPitchRangeSt, 2),
    f2FloorHz: normalizeVoiceFiniteNumber(value.f2FloorHz, 2),
    referenceMeanPitchHz: normalizeVoiceFiniteNumber(value.referenceMeanPitchHz, 2),
    referenceResonanceMean: normalizeVoiceConfidence(value.referenceResonanceMean),
    referenceWeightMean: normalizeVoiceConfidence(value.referenceWeightMean),
    referenceF2MedianHz: normalizeVoiceFiniteNumber(value.referenceF2MedianHz, 2),
    pitchPlacement: placement,
    pitchGapHz: normalizeVoiceFiniteNumber(value.pitchGapHz, 2),
    resonanceGap: normalizeVoiceFiniteNumber(value.resonanceGap, 3),
    weightGap: normalizeVoiceFiniteNumber(value.weightGap, 3),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

export function normalizeVoiceAttemptFormantLiteMetrics(
  value: Partial<VoiceAttemptFormantLiteMetrics> | null | undefined,
): VoiceAttemptFormantLiteMetrics | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceAttemptFormantLiteMetrics = {
    f1MedianHz: normalizeVoiceFiniteNumber(value.f1MedianHz, 2),
    f2MedianHz: normalizeVoiceFiniteNumber(value.f2MedianHz, 2),
    frontnessScore: normalizeVoiceConfidence(value.frontnessScore),
    frontnessShift: normalizeVoiceFiniteNumber(value.frontnessShift, 3),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

export function normalizeVoiceAttemptQualityMetrics(
  value: Partial<VoiceAttemptQualityMetrics> | null | undefined,
): VoiceAttemptQualityMetrics | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceAttemptQualityMetrics = {
    cppsLike: normalizeVoiceFiniteNumber(value.cppsLike, 2),
    harmonicStrength: normalizeVoiceFiniteNumber(value.harmonicStrength, 2),
    breathyRisk: normalizeVoiceConfidence(value.breathyRisk),
    strainRisk: normalizeVoiceConfidence(value.strainRisk),
    jitterLocal: normalizeVoiceFiniteNumber(value.jitterLocal, 5),
    jitterRap: normalizeVoiceFiniteNumber(value.jitterRap, 5),
    jitterPpq5: normalizeVoiceFiniteNumber(value.jitterPpq5, 5),
    shimmerLocal: normalizeVoiceFiniteNumber(value.shimmerLocal, 5),
    shimmerApq3: normalizeVoiceFiniteNumber(value.shimmerApq3, 5),
    shimmerApq5: normalizeVoiceFiniteNumber(value.shimmerApq5, 5),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

export function normalizeVoiceAttemptMetrics(value: Partial<VoiceAttemptMetrics> | null | undefined): VoiceAttemptMetrics | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceAttemptMetrics = {
    meanPitchHz: normalizeVoiceFiniteNumber(value.meanPitchHz, 2),
    pitchRangeSt: normalizeVoiceFiniteNumber(value.pitchRangeSt, 2),
    resonanceMean: normalizeVoiceConfidence(value.resonanceMean),
    weightMean: normalizeVoiceConfidence(value.weightMean),
    targetHitPct: normalizeVoiceConfidence(value.targetHitPct),
    similarityScore: normalizeVoiceConfidence(value.similarityScore),
    advanced: normalizeVoiceAttemptAdvancedMetrics(value.advanced),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

/**
 * Legacy summaries predate the explicit quality witness, so entirely absent
 * quality fields remain usable. Once the analyzer supplies quality evidence,
 * use the same scoring floors as the gateway: a take the capture policy asks
 * the learner to repeat cannot become a graph dot, best score, or drill cue.
 */
export function isVoiceAttemptMeasurementUsable(
  value: Partial<VoiceAttemptMetrics> | null | undefined,
): boolean {
  if (!value || value.advanced?.measurementAvailable === false) {
    return false;
  }
  const advanced = value.advanced;
  if (!advanced) {
    return true;
  }
  const finite = (candidate: unknown): number | null => {
    if (candidate == null || candidate === '') return null;
    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? numeric : null;
  };
  const reliabilityFlags = Array.isArray(advanced.reliabilityFlags)
    ? advanced.reliabilityFlags.map((flag) => String(flag || '').trim())
    : [];
  const measurementRejectionReasons = [
    ...(Array.isArray(advanced.measurementRejectionReasons)
      ? advanced.measurementRejectionReasons : []),
    ...(Array.isArray(advanced.rejectionReasons) ? advanced.rejectionReasons : []),
  ].map((reason) => String(reason || '').trim());
  const scoreConfidence = finite(advanced.scoreConfidence);
  const voicedFramePct = finite(advanced.voicedFramePct);
  const confidentFramePct = finite(advanced.confidentFramePct);
  const captureReliability = finite(advanced.captureReliability);
  const pitchValidFrameCount = finite(advanced.pitchValidFrameCount);
  const snrDb = finite(advanced.snrDb);
  const clippingPct = finite(advanced.clippingPct);
  const lowVoicedEvidence = voicedFramePct != null
    && voicedFramePct < 0.45
    && !(pitchValidFrameCount != null && pitchValidFrameCount >= 20);
  return !reliabilityFlags.includes('no_voiced_frames')
    && !measurementRejectionReasons.includes('no_voiced_frames')
    && !measurementRejectionReasons.includes('low_snr')
    && !measurementRejectionReasons.includes('sustained_clipping')
    && !(scoreConfidence != null && scoreConfidence < 0.48)
    && !lowVoicedEvidence
    && !(confidentFramePct != null && confidentFramePct < 0.5)
    && !(captureReliability != null && captureReliability < 0.5)
    && !(snrDb != null && snrDb < 12)
    && !(clippingPct != null && clippingPct >= 0.02)
    && !(scoreConfidence == null && reliabilityFlags.includes('low_score_confidence'))
    && !(voicedFramePct == null && reliabilityFlags.includes('low_voiced_coverage'))
    && !(confidentFramePct == null && reliabilityFlags.includes('low_confidence'))
    && !(captureReliability == null && reliabilityFlags.includes('low_capture_reliability'));
}

function mergeVoiceAttemptMetrics(
  current: Partial<VoiceAttemptMetrics> | null | undefined,
  incoming: Partial<VoiceAttemptMetrics> | null | undefined,
): VoiceAttemptMetrics | null {
  const normalizedCurrent = normalizeVoiceAttemptMetrics(current);
  const normalizedIncoming = normalizeVoiceAttemptMetrics(incoming);
  if (!normalizedCurrent) {
    return normalizedIncoming;
  }
  if (!normalizedIncoming) {
    return normalizedCurrent;
  }

  return normalizeVoiceAttemptMetrics({
    ...normalizedCurrent,
    ...normalizedIncoming,
    advanced: normalizeVoiceAttemptAdvancedMetrics({
      ...(normalizedCurrent.advanced || {}),
      ...(normalizedIncoming.advanced || {}),
    }),
  });
}

export function normalizeVoiceAttemptSummary(value: Partial<VoiceAttemptSummary> | null | undefined): VoiceAttemptSummary | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const metrics = normalizeVoiceAttemptMetrics(value.metrics);
  const issues = normalizeVoiceStringList(value.issues, 6, 200);
  const nextDrills = normalizeVoiceStringList(value.nextDrills, 6, 200);
  const transcript = typeof value.transcript === 'string' && value.transcript.trim() ? value.transcript.trim().slice(0, 400) : null;
  const targetPreset = typeof value.targetPreset === 'string' && value.targetPreset.trim() ? value.targetPreset.trim().slice(0, 80) : null;
  const target = normalizeVoiceAttemptTarget(value.target);
  const voiceSessionId = typeof value.voiceSessionId === 'string' && value.voiceSessionId.trim() ? value.voiceSessionId.trim().slice(0, 120) : null;
  const durationMs = Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.round(Number(value.durationMs))) : null;
  const analysisVersion = typeof value.analysisVersion === 'string' && value.analysisVersion.trim()
    ? value.analysisVersion.trim().slice(0, 80)
    : null;
  if (!metrics && !issues.length && !nextDrills.length && !transcript && !targetPreset && !target && !voiceSessionId && durationMs == null && !analysisVersion) {
    return null;
  }
  return {
    voiceSessionId,
    durationMs,
    transcript,
    targetPreset,
    target,
    metrics,
    issues,
    nextDrills,
    analysisVersion,
  };
}

export function normalizeVoiceTargetAdvancedBands(
  value: Partial<VoiceTargetAdvancedBands> | null | undefined,
): VoiceTargetAdvancedBands | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceTargetAdvancedBands = {
    pitchP10HzFloor: normalizeVoiceFiniteNumber(value.pitchP10HzFloor, 2),
    pitchP90HzCeiling: normalizeVoiceFiniteNumber(value.pitchP90HzCeiling, 2),
    pitchStdStCeiling: normalizeVoiceFiniteNumber(value.pitchStdStCeiling, 3),
    phraseEndDropHzCeiling: normalizeVoiceFiniteNumber(value.phraseEndDropHzCeiling, 2),
    spectralCentroidFloorHz: normalizeVoiceFiniteNumber(value.spectralCentroidFloorHz, 2),
    spectralTiltFloorDbPerOct: normalizeVoiceFiniteNumber(value.spectralTiltFloorDbPerOct, 3),
    harmonicRatioFloor: normalizeVoiceConfidence(value.harmonicRatioFloor),
    stabilityFloor: normalizeVoiceConfidence(value.stabilityFloor),
    voicedFramePctFloor: normalizeVoiceConfidence(value.voicedFramePctFloor),
    formantLite: normalizeVoiceTargetFormantLiteBands(value.formantLite),
    quality: normalizeVoiceTargetQualityBands(value.quality),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

export function normalizeVoiceTargetFormantLiteBands(
  value: Partial<VoiceTargetFormantLiteBands> | null | undefined,
): VoiceTargetFormantLiteBands | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceTargetFormantLiteBands = {
    f2FloorHz: normalizeVoiceFiniteNumber(value.f2FloorHz, 2),
    frontnessFloor: normalizeVoiceConfidence(value.frontnessFloor),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

export function normalizeVoiceTargetQualityBands(
  value: Partial<VoiceTargetQualityBands> | null | undefined,
): VoiceTargetQualityBands | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const normalized: VoiceTargetQualityBands = {
    cppsLikeFloor: normalizeVoiceFiniteNumber(value.cppsLikeFloor, 2),
    harmonicStrengthFloor: normalizeVoiceFiniteNumber(value.harmonicStrengthFloor, 2),
    breathyRiskCeiling: normalizeVoiceConfidence(value.breathyRiskCeiling),
    strainRiskCeiling: normalizeVoiceConfidence(value.strainRiskCeiling),
  };
  return Object.values(normalized).some((entry) => entry != null) ? normalized : null;
}

export function normalizeVoiceTargetProfile(value: Partial<VoiceTargetProfile> | null | undefined): VoiceTargetProfile | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const sourceFilename = typeof value.sourceFilename === 'string' && value.sourceFilename.trim() ? value.sourceFilename.trim().slice(0, 200) : null;
  const notes = normalizeVoiceStringList(value.notes, 6, 240);
  const profileId = typeof value.profileId === 'string' && value.profileId.trim() ? value.profileId.trim().slice(0, 120) : null;
  const clipId = typeof value.clipId === 'string' && value.clipId.trim() ? value.clipId.trim().slice(0, 120) : null;
  const targetPreset = typeof value.targetPreset === 'string' && value.targetPreset.trim() ? value.targetPreset.trim().slice(0, 80) : null;
  const stylePrompt = typeof value.stylePrompt === 'string' && value.stylePrompt.trim() ? value.stylePrompt.trim().slice(0, 240) : null;
  const analysisVersion = typeof value.analysisVersion === 'string' && value.analysisVersion.trim()
    ? value.analysisVersion.trim().slice(0, 80)
    : null;
  const normalized: VoiceTargetProfile = {
    profileId,
    clipId,
    sourceFilename,
    durationMs: Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.round(Number(value.durationMs))) : null,
    targetPreset,
    metrics: normalizeVoiceAttemptMetrics(value.metrics),
    pitchFloorHz: normalizeVoiceFiniteNumber(value.pitchFloorHz, 2),
    pitchCeilingHz: normalizeVoiceFiniteNumber(value.pitchCeilingHz, 2),
    resonanceFloor: normalizeVoiceConfidence(value.resonanceFloor),
    resonanceCeiling: normalizeVoiceConfidence(value.resonanceCeiling),
    weightFloor: normalizeVoiceConfidence(value.weightFloor),
    weightCeiling: normalizeVoiceConfidence(value.weightCeiling),
    stylePrompt,
    notes,
    advancedBands: normalizeVoiceTargetAdvancedBands(value.advancedBands),
    analysisVersion,
  };
  return Object.entries(normalized).some(([key, entry]) => key === 'notes' ? (entry as string[]).length > 0 : entry != null)
    ? normalized
    : null;
}

export function normalizeVoiceReferenceAnalysis(value: Partial<VoiceReferenceAnalysis> | null | undefined): VoiceReferenceAnalysis | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const clipId = typeof value.clipId === 'string' && value.clipId.trim() ? value.clipId.trim().slice(0, 120) : null;
  const filename = typeof value.filename === 'string' && value.filename.trim() ? value.filename.trim().slice(0, 200) : null;
  const timeline = Array.isArray(value.timeline)
    ? value.timeline.map((frame) => normalizeVoiceFrame(frame)).filter(Boolean) as VoiceLiveFrame[]
    : [];
  const metrics = normalizeVoiceAttemptMetrics(value.metrics);
  const analysisVersion = typeof value.analysisVersion === 'string' && value.analysisVersion.trim()
    ? value.analysisVersion.trim().slice(0, 80)
    : null;
  if (!clipId && !filename && !metrics && timeline.length === 0 && !analysisVersion) {
    return null;
  }
  return {
    clipId,
    filename,
    durationMs: Number.isFinite(Number(value.durationMs)) ? Math.max(0, Math.round(Number(value.durationMs))) : null,
    metrics,
    timeline,
    analysisVersion,
  };
}

export function normalizeVoiceCustomTargetPreset(
  value: Partial<VoiceCustomTargetPreset> | null | undefined,
): VoiceCustomTargetPreset | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const id = typeof value.id === 'string' && value.id.trim()
    ? value.id.trim().slice(0, 120)
    : '';
  const name = typeof value.name === 'string' && value.name.trim()
    ? value.name.trim().slice(0, 120)
    : '';
  if (!id || !name) {
    return null;
  }

  return {
    id,
    name,
    kind: value.kind === 'handmade' ? 'handmade' : 'reference',
    basePreset: typeof value.basePreset === 'string' && value.basePreset.trim()
      ? value.basePreset.trim().slice(0, 80)
      : 'cute-feminine',
    createdAt: Number.isFinite(Number(value.createdAt)) ? Math.max(0, Math.round(Number(value.createdAt))) : null,
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Math.max(0, Math.round(Number(value.updatedAt))) : null,
    archived: value.archived === true,
    archivedAt: Number.isFinite(Number(value.archivedAt)) ? Math.max(0, Math.round(Number(value.archivedAt))) : null,
    targetVoiceProfile: normalizeVoiceTargetProfile(value.targetVoiceProfile),
    referenceClipId: typeof value.referenceClipId === 'string' && value.referenceClipId.trim()
      ? value.referenceClipId.trim().slice(0, 120)
      : null,
    referenceClipName: typeof value.referenceClipName === 'string' && value.referenceClipName.trim()
      ? value.referenceClipName.trim().slice(0, 200)
      : null,
    referenceAnalysis: normalizeVoiceReferenceAnalysis(value.referenceAnalysis),
    sourceLabel: typeof value.sourceLabel === 'string' && value.sourceLabel.trim()
      ? value.sourceLabel.trim().slice(0, 120)
      : null,
    notes: normalizeVoiceStringList(value.notes, 6, 200),
  };
}

export function normalizeVoiceCustomTargetPresetDraft(
  value: Partial<VoiceCustomTargetPresetDraft> | null | undefined,
): VoiceCustomTargetPresetDraft {
  const normalized = createDefaultVoiceCustomTargetPresetDraft(value || {});
  normalized.presetId = typeof normalized.presetId === 'string' && normalized.presetId.trim()
    ? normalized.presetId.trim().slice(0, 120)
    : null;
  normalized.name = typeof normalized.name === 'string'
    ? normalized.name.trim().slice(0, 120)
    : '';
  normalized.basePreset = typeof normalized.basePreset === 'string' && normalized.basePreset.trim()
    ? normalized.basePreset.trim().slice(0, 80)
    : 'cute-feminine';
  normalized.pitchFloorHz = typeof normalized.pitchFloorHz === 'string'
    ? normalized.pitchFloorHz.trim().slice(0, 20)
    : '';
  normalized.pitchCeilingHz = typeof normalized.pitchCeilingHz === 'string'
    ? normalized.pitchCeilingHz.trim().slice(0, 20)
    : '';
  normalized.resonanceFloor = typeof normalized.resonanceFloor === 'string'
    ? normalized.resonanceFloor.trim().slice(0, 20)
    : '';
  normalized.resonanceCeiling = typeof normalized.resonanceCeiling === 'string'
    ? normalized.resonanceCeiling.trim().slice(0, 20)
    : '';
  normalized.weightFloor = typeof normalized.weightFloor === 'string'
    ? normalized.weightFloor.trim().slice(0, 20)
    : '';
  normalized.weightCeiling = typeof normalized.weightCeiling === 'string'
    ? normalized.weightCeiling.trim().slice(0, 20)
    : '';
  normalized.stylePrompt = typeof normalized.stylePrompt === 'string'
    ? normalized.stylePrompt.trim().slice(0, 240)
    : '';
  normalized.notesText = typeof normalized.notesText === 'string'
    ? normalized.notesText.trim().slice(0, 600)
    : '';
  return normalized;
}

export function buildVoiceCustomTargetPresetDraftFromPreset(
  preset: VoiceCustomTargetPreset | null | undefined,
): VoiceCustomTargetPresetDraft {
  if (!preset) {
    return createDefaultVoiceCustomTargetPresetDraft();
  }

  return normalizeVoiceCustomTargetPresetDraft({
    presetId: preset.id,
    name: preset.name,
    basePreset: preset.basePreset || preset.targetVoiceProfile?.targetPreset || 'cute-feminine',
    pitchFloorHz: preset.targetVoiceProfile?.pitchFloorHz != null
      ? String(preset.targetVoiceProfile.pitchFloorHz)
      : '',
    pitchCeilingHz: preset.targetVoiceProfile?.pitchCeilingHz != null
      ? String(preset.targetVoiceProfile.pitchCeilingHz)
      : '',
    resonanceFloor: preset.targetVoiceProfile?.resonanceFloor != null
      ? String(preset.targetVoiceProfile.resonanceFloor)
      : '',
    resonanceCeiling: preset.targetVoiceProfile?.resonanceCeiling != null
      ? String(preset.targetVoiceProfile.resonanceCeiling)
      : '',
    weightFloor: preset.targetVoiceProfile?.weightFloor != null
      ? String(preset.targetVoiceProfile.weightFloor)
      : '',
    weightCeiling: preset.targetVoiceProfile?.weightCeiling != null
      ? String(preset.targetVoiceProfile.weightCeiling)
      : '',
    stylePrompt: preset.targetVoiceProfile?.stylePrompt || '',
    notesText: Array.isArray(preset.notes) ? preset.notes.join('\n') : '',
  });
}

export function buildVoiceCustomTargetPresetDraftFromVoiceState(
  voiceUiState: Partial<VoiceUiState> | null | undefined,
): VoiceCustomTargetPresetDraft {
  const currentState = createDefaultVoiceUiState(voiceUiState || {});
  return normalizeVoiceCustomTargetPresetDraft({
    presetId: currentState.targetSource === 'custom-handmade'
      ? currentState.selectedCustomPresetId
      : null,
    name: currentState.selectedCustomPresetName || '',
    basePreset: currentState.targetPreset || 'cute-feminine',
    pitchFloorHz: currentState.targetVoiceProfile?.pitchFloorHz != null
      ? String(currentState.targetVoiceProfile.pitchFloorHz)
      : '',
    pitchCeilingHz: currentState.targetVoiceProfile?.pitchCeilingHz != null
      ? String(currentState.targetVoiceProfile.pitchCeilingHz)
      : '',
    resonanceFloor: currentState.targetVoiceProfile?.resonanceFloor != null
      ? String(currentState.targetVoiceProfile.resonanceFloor)
      : '',
    resonanceCeiling: currentState.targetVoiceProfile?.resonanceCeiling != null
      ? String(currentState.targetVoiceProfile.resonanceCeiling)
      : '',
    weightFloor: currentState.targetVoiceProfile?.weightFloor != null
      ? String(currentState.targetVoiceProfile.weightFloor)
      : '',
    weightCeiling: currentState.targetVoiceProfile?.weightCeiling != null
      ? String(currentState.targetVoiceProfile.weightCeiling)
      : '',
    stylePrompt: currentState.targetVoiceProfile?.stylePrompt || '',
    notesText: Array.isArray(currentState.targetVoiceProfile?.notes)
      ? currentState.targetVoiceProfile.notes.join('\n')
      : '',
  });
}

function normalizeVoicePhraseCheckpoint(value: Partial<VoicePhraseCheckpoint> | null | undefined): VoicePhraseCheckpoint | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const label = typeof value.label === 'string' && value.label.trim() ? value.label.trim() : null;
  const summary = typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim() : null;
  const pathMatchScore = normalizeVoiceUnitMetric(value.pathMatchScore);
  const laneMatchScore = normalizeVoiceUnitMetric(value.laneMatchScore);
  const contourMatchScore = normalizeVoiceUnitMetric(value.contourMatchScore);
  const corridorHoldScore = normalizeVoiceUnitMetric(value.corridorHoldScore);
  const startProgress = normalizeVoiceUnitMetric(value.startProgress);
  const endProgress = normalizeVoiceUnitMetric(value.endProgress);
  const detailPills = normalizeVoiceStringList(value.detailPills, 4, 80);

  if (
    !label
    && !summary
    && detailPills.length === 0
    && pathMatchScore === null
    && laneMatchScore === null
    && contourMatchScore === null
    && corridorHoldScore === null
  ) {
    return null;
  }

  return {
    label,
    summary,
    pathMatchScore,
    laneMatchScore,
    contourMatchScore,
    corridorHoldScore,
    startProgress,
    endProgress,
    detailPills,
  };
}

function normalizeVoicePhraseAnalysisQuality(value: Partial<VoicePhraseAnalysisQuality> | null | undefined): VoicePhraseAnalysisQuality | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const sampleCount = normalizeVoiceCount(value.sampleCount);
  const voicedFramePct = normalizeVoiceUnitMetric(value.voicedFramePct);
  const confidentFramePct = normalizeVoiceUnitMetric(value.confidentFramePct);
  const meanConfidence = normalizeVoiceUnitMetric(value.meanConfidence);
  const meanLoudnessDb = normalizeVoiceDbNumber(value.meanLoudnessDb);
  const scoreConfidence = normalizeVoiceUnitMetric(value.scoreConfidence);
  const reliable = typeof value.reliable === 'boolean' ? value.reliable : null;
  const issues = Array.isArray(value.issues)
    ? value.issues.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];

  if (
    sampleCount === null
    && voicedFramePct === null
    && confidentFramePct === null
    && meanConfidence === null
    && meanLoudnessDb === null
    && scoreConfidence === null
    && reliable === null
    && issues.length === 0
  ) {
    return null;
  }

  return {
    sampleCount,
    voicedFramePct,
    confidentFramePct,
    meanConfidence,
    meanLoudnessDb,
    scoreConfidence,
    reliable,
    issues,
  };
}

function normalizeVoicePhraseComparison(value: Partial<VoicePhraseComparison> | null | undefined): VoicePhraseComparison | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const phrase = typeof value.phrase === 'string' && value.phrase.trim() ? value.phrase.trim() : null;
  const lessonId = typeof value.lessonId === 'string' && value.lessonId.trim() ? value.lessonId.trim() : null;
  const forecastPhrase = typeof value.forecastPhrase === 'string' && value.forecastPhrase.trim()
    ? value.forecastPhrase.trim()
    : null;
  const summary = typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim() : null;
  const pathMatchScore = normalizeVoiceUnitMetric(value.pathMatchScore);
  const laneMatchScore = normalizeVoiceUnitMetric(value.laneMatchScore);
  const contourMatchScore = normalizeVoiceUnitMetric(value.contourMatchScore);
  const corridorHoldScore = normalizeVoiceUnitMetric(value.corridorHoldScore);
  const targetZoneScore = normalizeVoiceUnitMetric(value.targetZoneScore);
  const quickFeedback = Array.isArray(value.quickFeedback)
    ? value.quickFeedback.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 4)
    : [];
  const checkpoints = Array.isArray(value.checkpoints)
    ? value.checkpoints
        .map((checkpoint) => normalizeVoicePhraseCheckpoint(checkpoint))
        .filter(Boolean) as VoicePhraseCheckpoint[]
    : [];
  const analysisQuality = normalizeVoicePhraseAnalysisQuality(value.analysisQuality);

  if (!phrase && !summary && pathMatchScore === null && laneMatchScore === null && contourMatchScore === null && corridorHoldScore === null && targetZoneScore === null && quickFeedback.length === 0 && checkpoints.length === 0 && !analysisQuality) {
    return null;
  }

  return {
    phrase,
    lessonId,
    forecastPhrase,
    summary,
    pathMatchScore,
    laneMatchScore,
    contourMatchScore,
    corridorHoldScore,
    targetZoneScore,
    quickFeedback,
    checkpoints,
    analysisQuality,
  };
}

export function buildVoicePhraseComparisonKey({
  lessonId = null,
  phrase = null,
}: {
  lessonId?: string | null;
  phrase?: string | null;
} = {}): string | null {
  const normalizedLessonId = typeof lessonId === 'string' && lessonId.trim() ? lessonId.trim() : '';
  const normalizedPhrase = normalizeVoicePhraseTextForMatch(phrase);
  if (!normalizedLessonId && !normalizedPhrase) {
    return null;
  }
  return `${normalizedLessonId}::${normalizedPhrase}`;
}

function normalizeVoiceCueSheetToken(value: Partial<VoiceCueSheetToken> | null | undefined): VoiceCueSheetToken | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const text = typeof value.text === 'string' && value.text.trim() ? value.text.trim() : '';
  if (!text) {
    return null;
  }

  const cue = typeof value.cue === 'string' && value.cue.trim() ? value.cue.trim() : null;
  const styledCue = typeof value.styledCue === 'string' && value.styledCue.trim() ? value.styledCue.trim() : cue;
  const emphasis = typeof value.emphasis === 'string' && value.emphasis.trim() ? value.emphasis.trim() : null;
  const conceptTags = Array.isArray(value.conceptTags)
    ? value.conceptTags.map((tag) => String(tag || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const mouthShape = typeof value.mouthShape === 'string' && value.mouthShape.trim() ? value.mouthShape.trim() : null;
  const jawAction = typeof value.jawAction === 'string' && value.jawAction.trim() ? value.jawAction.trim() : null;
  const lipAction = typeof value.lipAction === 'string' && value.lipAction.trim() ? value.lipAction.trim() : null;
  const tongueAction = typeof value.tongueAction === 'string' && value.tongueAction.trim() ? value.tongueAction.trim() : null;
  const airflowCue = typeof value.airflowCue === 'string' && value.airflowCue.trim() ? value.airflowCue.trim() : null;
  const placementFeel = typeof value.placementFeel === 'string' && value.placementFeel.trim() ? value.placementFeel.trim() : null;
  const expressionCue = typeof value.expressionCue === 'string' && value.expressionCue.trim() ? value.expressionCue.trim() : null;
  const avoidCue = typeof value.avoidCue === 'string' && value.avoidCue.trim() ? value.avoidCue.trim() : null;
  const note = typeof value.note === 'string' && value.note.trim() ? value.note.trim() : null;
  const startProgress = Number.isFinite(Number(value.startProgress))
    ? clampVoiceMetric(Number(value.startProgress), 0, 1)
    : null;
  const endProgress = Number.isFinite(Number(value.endProgress))
    ? clampVoiceMetric(Number(value.endProgress), 0, 1)
    : null;

  return {
    text,
    cue,
    styledCue,
    emphasis,
    conceptTags,
    mouthShape,
    jawAction,
    lipAction,
    tongueAction,
    airflowCue,
    placementFeel,
    expressionCue,
    avoidCue,
    note,
    startProgress,
    endProgress,
  };
}

function normalizeVoiceCueSheet(value: Partial<VoiceCueSheet> | null | undefined): VoiceCueSheet | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const phrase = typeof value.phrase === 'string' && value.phrase.trim() ? value.phrase.trim() : null;
  const phraseIntent = typeof value.phraseIntent === 'string' && value.phraseIntent.trim() ? value.phraseIntent.trim() : null;
  const expressionMask = typeof value.expressionMask === 'string' && value.expressionMask.trim() ? value.expressionMask.trim() : null;
  const cueLine = typeof value.cueLine === 'string' && value.cueLine.trim() ? value.cueLine.trim() : null;
  const styledCueLine = typeof value.styledCueLine === 'string' && value.styledCueLine.trim() ? value.styledCueLine.trim() : cueLine;
  const targetPreset = typeof value.targetPreset === 'string' && value.targetPreset.trim() ? value.targetPreset.trim() : null;
  const teachingFocus = Array.isArray(value.teachingFocus)
    ? value.teachingFocus.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 8)
    : [];
  const tokens = Array.isArray(value.tokens)
    ? value.tokens
        .map((token) => normalizeVoiceCueSheetToken(token))
        .filter(Boolean) as VoiceCueSheetToken[]
    : [];

  if (!phrase && !phraseIntent && !expressionMask && !cueLine && tokens.length === 0) {
    return null;
  }

  return {
    phrase,
    targetPreset,
    phraseIntent,
    expressionMask,
    teachingFocus,
    cueLine,
    styledCueLine,
    tokens,
  };
}

function normalizeVoicePhraseForecast(value: Partial<VoicePhraseForecast> | null | undefined): VoicePhraseForecast | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const profileId = typeof value.profileId === 'string' && value.profileId.trim() ? value.profileId.trim().slice(0, 120) : null;
  const clipId = typeof value.clipId === 'string' && value.clipId.trim() ? value.clipId.trim().slice(0, 120) : null;
  const phrase = typeof value.phrase === 'string' && value.phrase.trim() ? value.phrase.trim() : null;
  const targetPreset = typeof value.targetPreset === 'string' && value.targetPreset.trim() ? value.targetPreset.trim().slice(0, 80) : null;
  const summary = typeof value.summary === 'string' && value.summary.trim() ? value.summary.trim() : null;
  const notes = Array.isArray(value.notes)
    ? value.notes.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 6)
    : [];
  const timeline = Array.isArray(value.timeline)
    ? value.timeline
        .map((frame) => normalizeVoiceFrame(frame))
        .filter(Boolean) as VoiceLiveFrame[]
    : [];
  const estimatedDurationMs = Number.isFinite(Number(value.estimatedDurationMs))
    ? Math.max(0, Math.round(Number(value.estimatedDurationMs)))
    : null;
  const metrics = normalizeVoiceAttemptMetrics(value.metrics);
  const cueSheet = normalizeVoiceCueSheet(value.cueSheet);
  const analysisVersion = typeof value.analysisVersion === 'string' && value.analysisVersion.trim()
    ? value.analysisVersion.trim().slice(0, 80)
    : null;

  if (
    !profileId
    && !clipId
    && !phrase
    && !targetPreset
    && estimatedDurationMs == null
    && !metrics
    && timeline.length === 0
    && !summary
    && notes.length === 0
    && !cueSheet
    && !analysisVersion
  ) {
    return null;
  }

  return {
    profileId,
    clipId,
    phrase,
    targetPreset,
    estimatedDurationMs,
    metrics,
    timeline,
    summary,
    notes,
    cueSheet,
    analysisVersion,
  };
}

function normalizeVoiceInputRuntimeStatus(value: string | null | undefined): VoiceInputRuntimeStatus {
  return value === 'waiting' || value === 'listening' || value === 'processing' || value === 'error'
    ? value
    : 'idle';
}

function normalizeVoiceInputRuntimeOutcome(value: string | null | undefined): VoiceInputRuntimeOutcome {
  return value === 'completed' || value === 'no-speech' || value === 'error'
    ? value
    : 'idle';
}

function normalizeVoiceInputRuntimeProvider(value: string | null | undefined): VoiceCoachInputProvider | null {
  return value === 'backend' || value === 'browser'
    ? value
    : null;
}

function normalizeVoiceInputRuntimeText(value: string | null | undefined, maxLength = 160): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeVoiceInputRuntimeCount(value: number | null | undefined): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.round(numeric)
    : 0;
}

function normalizeVoiceInputRuntimeTimestamp(value: number | null | undefined): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0
    ? Math.round(numeric)
    : null;
}

function normalizeVoiceInputRuntimeDuration(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric >= 0
    ? Math.round(numeric)
    : null;
}

function normalizeVoiceConfidence(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Math.max(0, Math.min(1, numeric))
    : null;
}

function normalizeVoiceInputRuntimeNumber(value: number | null | undefined): number | null {
  if (value == null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? Number(numeric.toFixed(3))
    : null;
}

function normalizeVoiceInputRuntimeVadState(value: string | null | undefined): VoiceInputRuntimeState['lastVadState'] {
  return value === 'idle' || value === 'waiting' || value === 'speech' || value === 'processing'
    ? value
    : null;
}

export function normalizeVoiceInputRuntimeState(value: Partial<VoiceInputRuntimeState> | null | undefined): VoiceInputRuntimeState {
  const normalized = createDefaultVoiceUiState().voiceInputRuntime;
  const merged = {
    ...normalized,
    ...(value || {}),
  };
  return {
    status: normalizeVoiceInputRuntimeStatus(merged.status),
    lastOutcome: normalizeVoiceInputRuntimeOutcome(merged.lastOutcome),
    requestedProvider: merged.requestedProvider === 'backend' ? 'backend' : 'browser',
    effectiveProvider: normalizeVoiceInputRuntimeProvider(merged.effectiveProvider),
    captureProvider: normalizeVoiceInputRuntimeProvider(merged.captureProvider),
    providerStyle: normalizeVoiceInputRuntimeText(merged.providerStyle, 80),
    transcriptSource: normalizeVoiceInputRuntimeText(merged.transcriptSource, 80),
    lastTranscript: normalizeVoiceInputRuntimeText(merged.lastTranscript, 240),
    lastTranscriptConfidence: normalizeVoiceConfidence(merged.lastTranscriptConfidence),
    lastCaptureStartedAt: normalizeVoiceInputRuntimeTimestamp(merged.lastCaptureStartedAt),
    lastSpeechDetectedAt: normalizeVoiceInputRuntimeTimestamp(merged.lastSpeechDetectedAt),
    lastCapturedAt: normalizeVoiceInputRuntimeTimestamp(merged.lastCapturedAt),
    lastProcessedAt: normalizeVoiceInputRuntimeTimestamp(merged.lastProcessedAt),
    lastCaptureDurationMs: normalizeVoiceInputRuntimeDuration(merged.lastCaptureDurationMs),
    lastRoundTripMs: normalizeVoiceInputRuntimeDuration(merged.lastRoundTripMs),
    successfulTurns: normalizeVoiceInputRuntimeCount(merged.successfulTurns),
    noSpeechTurns: normalizeVoiceInputRuntimeCount(merged.noSpeechTurns),
    errorCount: normalizeVoiceInputRuntimeCount(merged.errorCount),
    consecutiveNoSpeechTurns: normalizeVoiceInputRuntimeCount(merged.consecutiveNoSpeechTurns),
    consecutiveErrorTurns: normalizeVoiceInputRuntimeCount(merged.consecutiveErrorTurns),
    liveSessionId: normalizeVoiceInputRuntimeText(merged.liveSessionId, 120),
    lastSegmentId: normalizeVoiceInputRuntimeText(merged.lastSegmentId, 120),
    liveEngine: normalizeVoiceInputRuntimeText(merged.liveEngine, 120),
    liveInterimMode: normalizeVoiceInputRuntimeText(merged.liveInterimMode, 40),
    liveVadStrategy: normalizeVoiceInputRuntimeText(merged.liveVadStrategy, 40),
    providerTarget: normalizeVoiceInputRuntimeText(merged.providerTarget, 160),
    providerModel: normalizeVoiceInputRuntimeText(merged.providerModel, 120),
    providerLanguage: normalizeVoiceInputRuntimeText(merged.providerLanguage, 40),
    providerEndpointing: normalizeVoiceInputRuntimeText(merged.providerEndpointing, 160),
    lastPartialTranscript: normalizeVoiceInputRuntimeText(merged.lastPartialTranscript, 240),
    lastPartialTranscriptAt: normalizeVoiceInputRuntimeTimestamp(merged.lastPartialTranscriptAt),
    lastVadState: normalizeVoiceInputRuntimeVadState(merged.lastVadState),
    lastBargeInAt: normalizeVoiceInputRuntimeTimestamp(merged.lastBargeInAt),
    lastAnalysisSummary: normalizeVoiceInputRuntimeText(merged.lastAnalysisSummary, 240),
    lastAnalysisDurationMs: normalizeVoiceInputRuntimeDuration(merged.lastAnalysisDurationMs),
    lastAverageLevelDb: normalizeVoiceInputRuntimeNumber(merged.lastAverageLevelDb),
    lastPeakLevelDb: normalizeVoiceInputRuntimeNumber(merged.lastPeakLevelDb),
    lastNoiseFloorDb: normalizeVoiceInputRuntimeNumber(merged.lastNoiseFloorDb),
    lastSnrDb: normalizeVoiceInputRuntimeNumber(merged.lastSnrDb),
    lastClippingPct: normalizeVoiceConfidence(merged.lastClippingPct),
    lastCaptureReliability: normalizeVoiceConfidence(merged.lastCaptureReliability),
    lastReliabilityFlags: normalizeVoiceStringList(merged.lastReliabilityFlags, 6, 80),
    lastSpeechDurationMs: normalizeVoiceInputRuntimeDuration(merged.lastSpeechDurationMs),
    lastAudioProcessedMs: normalizeVoiceInputRuntimeDuration(merged.lastAudioProcessedMs),
    lastError: normalizeVoiceInputRuntimeText(merged.lastError, 200),
    lastEventAt: normalizeVoiceInputRuntimeTimestamp(merged.lastEventAt),
  };
}

export function normalizeVoiceUiState(value: Partial<VoiceUiState> | null | undefined): VoiceUiState {
  const normalized = createDefaultVoiceUiState(value || {});
  normalized.targetSource = normalizeVoiceTargetSource(normalized.targetSource);
  normalized.selectedCustomPresetId = typeof normalized.selectedCustomPresetId === 'string' && normalized.selectedCustomPresetId.trim()
    ? normalized.selectedCustomPresetId.trim().slice(0, 120)
    : null;
  normalized.selectedCustomPresetName = typeof normalized.selectedCustomPresetName === 'string' && normalized.selectedCustomPresetName.trim()
    ? normalized.selectedCustomPresetName.trim().slice(0, 120)
    : null;
  normalized.lastTakeTimeline = Array.isArray(normalized.lastTakeTimeline)
    ? normalized.lastTakeTimeline
        .map((frame) => normalizeVoiceFrame(frame))
        .filter(Boolean) as VoiceLiveFrame[]
      : null;
  normalized.lastSummary = normalizeVoiceAttemptSummary(normalized.lastSummary);
  normalized.strainWatch = normalizeVoiceStrainWatch(normalized.strainWatch);
  normalized.repContext = normalizeVoiceRepContext(normalized.repContext);
  normalized.referenceAnalysis = normalizeVoiceReferenceAnalysis(normalized.referenceAnalysis);
  normalized.targetVoiceProfile = normalizeVoiceTargetProfile(normalized.targetVoiceProfile);
  normalized.phraseForecast = normalizeVoicePhraseForecast(normalized.phraseForecast);
  normalized.phraseComparison = normalizeVoicePhraseComparison(normalized.phraseComparison);
  normalized.activeLine = normalizeVoicePracticeLine(normalized.activeLine);
  normalized.lineQueue = Array.isArray(normalized.lineQueue)
    ? normalized.lineQueue
        .map((line) => normalizeVoicePracticeLine(line))
        .filter(Boolean) as VoicePracticeLine[]
    : [];
  normalized.lineDifficultyPreference = ['adaptive', 'easy', 'medium', 'hard'].includes(normalized.lineDifficultyPreference)
    ? normalized.lineDifficultyPreference
    : 'adaptive';
  normalized.coachThread = Array.isArray(normalized.coachThread)
    ? normalized.coachThread
        .map((message) => normalizeVoiceCoachMessage(message))
        .filter(Boolean) as VoiceCoachMessage[]
    : [];
  normalized.coachVoice = normalizeVoiceCoachVoiceState(normalized.coachVoice);
  normalized.voiceInputRuntime = normalizeVoiceInputRuntimeState(normalized.voiceInputRuntime);
  normalized.voiceConditioning = normalizeVoiceConditioningState(normalized.voiceConditioning);
  normalized.selfReportDraft = createDefaultVoiceSelfReport(normalized.selfReportDraft);
  normalized.advancedPanel = normalizeVoiceAdvancedPanelState(normalized.advancedPanel);
  normalized.deeptutorVoiceState = normalizeDeepTutorVoiceState(normalized.deeptutorVoiceState);
  normalized.customTargetPresets = Array.isArray(normalized.customTargetPresets)
    ? normalized.customTargetPresets
        .map((preset) => normalizeVoiceCustomTargetPreset(preset))
        .filter(Boolean) as VoiceCustomTargetPreset[]
    : [];
  normalized.customTargetPresetDraft = normalizeVoiceCustomTargetPresetDraft(
    normalized.customTargetPresetDraft,
  );
  return normalized;
}

function normalizeVoiceStrainWatch(
  value: Partial<VoiceStrainWatch> | null | undefined,
): VoiceStrainWatch | null {
  if (!value || typeof value !== 'object') {
    return null;
  }
  const count = (candidate: unknown): number => {
    const numeric = Number(candidate);
    return Number.isFinite(numeric) ? Math.max(0, Math.round(numeric)) : 0;
  };
  const minutes = Number(value.sessionMinutes);
  return {
    recentFlags: count(value.recentFlags),
    sessionMinutes: value.sessionMinutes != null && Number.isFinite(minutes)
      ? Math.max(0, minutes)
      : null,
    takeCount: count(value.takeCount),
    strainedTotal: count(value.strainedTotal),
  };
}

function normalizeVoiceRepContext(
  value: Partial<VoiceRepContext> | null | undefined,
): VoiceRepContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const text = (candidate: unknown, maxLength = 160): string | null => (
    typeof candidate === 'string' && candidate.trim()
      ? candidate.trim().slice(0, maxLength)
      : null
  );
  const drillValue = value.drill && typeof value.drill === 'object' && !Array.isArray(value.drill)
    ? value.drill
    : null;
  const drill = drillValue ? {
    id: text(drillValue.id),
    kind: text(drillValue.kind, 80),
    tags: normalizeVoiceStringList(drillValue.tags, 8, 80),
  } : null;
  const normalized: VoiceRepContext = {
    targetPreset: text(value.targetPreset, 80),
    targetSource: value.targetSource == null ? null : normalizeVoiceTargetSource(value.targetSource),
    lessonId: text(value.lessonId),
    activeLine: normalizeVoicePracticeLine(value.activeLine),
    referenceClipId: text(value.referenceClipId),
    referenceClipName: text(value.referenceClipName, 200),
    forecastPhrase: text(value.forecastPhrase, 400),
    targetProfileId: text(value.targetProfileId),
    targetProfileSource: text(value.targetProfileSource, 240),
    kind: text(value.kind, 80),
    drillId: text(value.drillId),
    tags: normalizeVoiceStringList(value.tags, 8, 80),
    drill,
  };
  return Object.entries(normalized).some(([key, entry]) => (
    key === 'tags'
      ? Array.isArray(entry) && entry.length > 0
      : entry !== null && entry !== undefined
  )) ? normalized : null;
}

function normalizeVoiceDrill(value: Partial<VoiceDrill> | null | undefined): VoiceDrill | null {
  const id = typeof value?.id === 'string' ? value.id.trim() : '';
  if (!id) return null;
  return {
    id,
    kind: typeof value?.kind === 'string' && value.kind.trim()
      ? value.kind.trim().slice(0, 80)
      : null,
    title: typeof value?.title === 'string' && value.title.trim() ? value.title.trim() : id,
    focus: typeof value?.focus === 'string' ? value.focus.trim() : '',
    phrase: typeof value?.phrase === 'string' ? value.phrase.trim() : '',
    description: typeof value?.description === 'string' ? value.description.trim() : '',
    cues: Array.isArray(value?.cues) ? value.cues.map((cue) => String(cue)).filter(Boolean) : [],
    tags: Array.isArray(value?.tags) ? value.tags.map((tag) => String(tag)).filter(Boolean) : [],
    cueSheet: normalizeVoiceCueSheet(value?.cueSheet),
  };
}

export function createDefaultVoiceDrillState(overrides: Partial<VoiceDrillState> = {}): VoiceDrillState {
  return {
    targetPreset: 'cute-feminine',
    drills: [],
    selectedLessonId: null,
    selectedDrill: null,
    recommendedIds: [],
    ...overrides,
  };
}

export function normalizeVoiceDrillState(value: Partial<VoiceDrillState> | null | undefined): VoiceDrillState {
  const normalized = createDefaultVoiceDrillState(value || {});
  normalized.drills = Array.isArray(normalized.drills)
    ? normalized.drills
        .map((drill) => normalizeVoiceDrill(drill))
        .filter(Boolean) as VoiceDrill[]
    : [];
  normalized.selectedDrill = normalizeVoiceDrill(normalized.selectedDrill);
  normalized.selectedLessonId = typeof normalized.selectedLessonId === 'string' && normalized.selectedLessonId.trim()
    ? normalized.selectedLessonId.trim()
    : normalized.selectedDrill?.id || null;
  if (!normalized.selectedDrill && normalized.selectedLessonId) {
    normalized.selectedDrill = normalized.drills.find((drill) => drill.id === normalized.selectedLessonId) || null;
  }
  normalized.recommendedIds = Array.isArray(normalized.recommendedIds)
    ? normalized.recommendedIds.map((value) => String(value)).filter(Boolean)
    : [];
  return normalized;
}

export function createDefaultVoiceStudentModelState(overrides: Partial<VoiceStudentModelState> = {}): VoiceStudentModelState {
  return {
    available: false,
    enabled: false,
    studentId: null,
    masteryLevel: null,
    conceptsPracticed: 0,
    conceptIds: [],
    reviewQueueSize: 0,
    reviewQueue: [],
    struggles: [],
    learningPace: null,
    preferredStyle: null,
    reviewPrompt: null,
    learnerContext: null,
    error: null,
    ...overrides,
  };
}

function normalizeVoiceLearnerContextNotepadHandoff(
  value: Partial<VoiceLearnerContextNotepadHandoff> | null | undefined,
): VoiceLearnerContextNotepadHandoff | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  const content = typeof value.content === 'string' ? value.content.trim() : '';
  const items = Array.isArray(value.items)
    ? value.items.map((item) => String(item).trim()).filter(Boolean).slice(0, 8)
    : [];
  return {
    content,
    items,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : null,
    sessionId: typeof value.sessionId === 'string' && value.sessionId.trim() ? value.sessionId.trim() : null,
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Math.round(Number(value.updatedAt)) : null,
  };
}

function normalizeVoiceTargetBinding(value: unknown): VoiceLearnerContextState['targetBinding'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const text = (key: string): string | null => (
    typeof source[key] === 'string' && String(source[key]).trim()
      ? String(source[key]).trim()
      : null
  );
  return {
    presetId: text('presetId'),
    presetName: text('presetName'),
    referenceClipId: text('referenceClipId'),
    targetPreset: text('targetPreset'),
    targetSource: text('targetSource'),
    targetKey: text('targetKey'),
    targetProfileId: text('targetProfileId'),
    analysisVersion: text('analysisVersion'),
    updatedAt: Number.isFinite(Number(source.updatedAt)) ? Math.round(Number(source.updatedAt)) : null,
  };
}

export function normalizeVoiceLearnerContextState(
  value: Partial<VoiceLearnerContextState> | null | undefined,
): VoiceLearnerContextState | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return {
    available: value.available === true,
    source: typeof value.source === 'string' && value.source.trim() ? value.source.trim() : null,
    schemaVersion: typeof value.schemaVersion === 'string' && value.schemaVersion.trim() ? value.schemaVersion.trim() : null,
    query: typeof value.query === 'string' && value.query.trim() ? value.query.trim() : null,
    updatedAt: Number.isFinite(Number(value.updatedAt)) ? Math.round(Number(value.updatedAt)) : null,
    targetPreset: typeof value.targetPreset === 'string' && value.targetPreset.trim() ? value.targetPreset.trim() : null,
    targetBinding: normalizeVoiceTargetBinding(value.targetBinding),
    coachPreferences: Array.isArray(value.coachPreferences)
      ? value.coachPreferences
          .map((preference) => ({
            id: typeof preference?.id === 'string' ? preference.id.trim() : '',
            text: typeof preference?.text === 'string' ? preference.text.trim() : '',
            date: typeof preference?.date === 'string' && preference.date.trim() ? preference.date.trim() : null,
            source: typeof preference?.source === 'string' && preference.source.trim() ? preference.source.trim() : null,
          }))
          .filter((preference) => Boolean(preference.id && preference.text))
      : [],
    recentAttemptCount: Number.isFinite(Number(value.recentAttemptCount))
      ? Math.max(0, Math.round(Number(value.recentAttemptCount)))
      : 0,
    notepadHandoff: normalizeVoiceLearnerContextNotepadHandoff(value.notepadHandoff),
    consentStatus: typeof value.consentStatus === 'string' && value.consentStatus.trim() ? value.consentStatus.trim() : null,
    eligibilityStatus: typeof value.eligibilityStatus === 'string' && value.eligibilityStatus.trim() ? value.eligibilityStatus.trim() : null,
    exclusions: Array.isArray(value.exclusions)
      ? value.exclusions.map((item) => String(item).trim()).filter(Boolean)
      : [],
    exportEligible: value.exportEligible === true,
    storageHealth: value.storageHealth && typeof value.storageHealth === 'object' && !Array.isArray(value.storageHealth)
      ? { ...value.storageHealth }
      : null,
    error: typeof value.error === 'string' && value.error.trim() ? value.error.trim() : null,
  };
}

export function normalizeVoiceStudentModelState(value: Partial<VoiceStudentModelState> | null | undefined): VoiceStudentModelState {
  const normalized = createDefaultVoiceStudentModelState(value || {});
  normalized.reviewQueue = Array.isArray(normalized.reviewQueue)
    ? normalized.reviewQueue
        .map((item) => ({
          conceptId: String(item?.conceptId || '').trim(),
          name: String(item?.name || '').trim(),
          urgency: Number(item?.urgency || 0),
        }))
        .filter((item) => item.conceptId.length > 0)
    : [];
  normalized.conceptIds = Array.isArray(normalized.conceptIds)
    ? normalized.conceptIds.map((value) => String(value)).filter(Boolean)
    : [];
  normalized.struggles = Array.isArray(normalized.struggles)
    ? normalized.struggles.map((value) => String(value)).filter(Boolean)
    : [];
  normalized.learnerContext = normalizeVoiceLearnerContextState(normalized.learnerContext);
  return normalized;
}

export function clampVoiceMetric(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function normalizeVoicePhraseTextForMatch(value: string | null | undefined): string {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9']+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getRenderableVoicePhraseComparison({
  phraseComparison,
  lessonId = null,
  activePhrase = null,
}: {
  phraseComparison: Partial<VoicePhraseComparison> | null | undefined;
  lessonId?: string | null;
  activePhrase?: string | null;
}): VoicePhraseComparison | null {
  const comparison = normalizeVoicePhraseComparison(phraseComparison);
  if (!comparison) {
    return null;
  }
  const activeKey = buildVoicePhraseComparisonKey({
    lessonId,
    phrase: activePhrase,
  });
  const comparisonKey = buildVoicePhraseComparisonKey({
    lessonId: comparison.lessonId || null,
    phrase: comparison.forecastPhrase || comparison.phrase,
  });
  if (activeKey && comparisonKey && activeKey !== comparisonKey) {
    return null;
  }
  return comparison;
}

export function normalizeVoiceReferenceClipId(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function mergeVoiceReferenceAnalysis({
  nextReferenceClipId = null,
  currentReferenceAnalysis = null,
  incomingReferenceAnalysis = null,
  currentReferenceClipId = null,
}: {
  nextReferenceClipId?: string | null;
  currentReferenceAnalysis?: Partial<VoiceReferenceAnalysis> | null;
  incomingReferenceAnalysis?: Partial<VoiceReferenceAnalysis> | null;
  currentReferenceClipId?: string | null;
} = {}): VoiceReferenceAnalysis | null {
  const normalizedNextClipId = normalizeVoiceReferenceClipId(nextReferenceClipId);
  if (!normalizedNextClipId) {
    return null;
  }

  const normalizedCurrent = currentReferenceAnalysis && typeof currentReferenceAnalysis === 'object'
    ? normalizeVoiceReferenceAnalysis({
        ...currentReferenceAnalysis,
        clipId: normalizeVoiceReferenceClipId(currentReferenceAnalysis?.clipId) || normalizeVoiceReferenceClipId(currentReferenceClipId),
      })
    : null;
  const normalizedIncoming = incomingReferenceAnalysis && typeof incomingReferenceAnalysis === 'object'
    ? normalizeVoiceReferenceAnalysis({
        ...incomingReferenceAnalysis,
        clipId: normalizeVoiceReferenceClipId(incomingReferenceAnalysis?.clipId) || normalizedNextClipId,
      })
    : null;
  const currentClipId = normalizeVoiceReferenceClipId(normalizedCurrent?.clipId);
  const incomingClipId = normalizeVoiceReferenceClipId(normalizedIncoming?.clipId);

  if (incomingClipId === normalizedNextClipId && currentClipId === normalizedNextClipId) {
    return normalizeVoiceReferenceAnalysis({
      clipId: normalizedNextClipId,
      filename: normalizedIncoming?.filename ?? normalizedCurrent?.filename ?? null,
      durationMs: normalizedIncoming?.durationMs ?? normalizedCurrent?.durationMs ?? null,
      metrics: mergeVoiceAttemptMetrics(normalizedCurrent?.metrics, normalizedIncoming?.metrics),
      timeline: Array.isArray(normalizedIncoming?.timeline) && normalizedIncoming.timeline.length > 0
        ? normalizedIncoming.timeline
        : (normalizedCurrent?.timeline || []),
      analysisVersion: normalizedIncoming?.analysisVersion ?? normalizedCurrent?.analysisVersion ?? null,
    });
  }

  if (incomingClipId === normalizedNextClipId) {
    return normalizedIncoming;
  }

  if (currentClipId === normalizedNextClipId) {
    return normalizedCurrent;
  }

  return null;
}

export function getPersistedVoiceReferenceAnalysis({
  nextReferenceClipId = null,
  currentReferenceAnalysis = null,
  currentReferenceClipId = null,
}: {
  nextReferenceClipId?: string | null;
  currentReferenceAnalysis?: VoiceReferenceAnalysis | null;
  currentReferenceClipId?: string | null;
} = {}): VoiceReferenceAnalysis | null {
  return mergeVoiceReferenceAnalysis({
    nextReferenceClipId,
    currentReferenceAnalysis,
    currentReferenceClipId,
  });
}
