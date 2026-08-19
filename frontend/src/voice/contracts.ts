export type VoiceFrameAdvancedMetrics = {
  pitchConfidence?: number | null;
  voicedProbability?: number | null;
  rms?: number | null;
  spectralCentroidHz?: number | null;
  spectralBandwidthHz?: number | null;
  spectralFlux?: number | null;
  spectralTiltDbPerOct?: number | null;
  harmonicRatio?: number | null;
  harmonicNoiseRatioDb?: number | null;
  clippingPct?: number | null;
  pitchSlopeStPerSec?: number | null;
  stabilityScore?: number | null;
};

export type VoiceAttemptFormantLiteMetrics = {
  f1MedianHz?: number | null;
  f2MedianHz?: number | null;
  frontnessScore?: number | null;
  frontnessShift?: number | null;
};

export type VoiceAttemptQualityMetrics = {
  cppsLike?: number | null;
  harmonicStrength?: number | null;
  breathyRisk?: number | null;
  strainRisk?: number | null;
  jitterLocal?: number | null;
  jitterRap?: number | null;
  jitterPpq5?: number | null;
  shimmerLocal?: number | null;
  shimmerApq3?: number | null;
  shimmerApq5?: number | null;
};

export type VoiceAttemptAdvancedMetrics = {
  sampleCount?: number | null;
  voicedFramePct?: number | null;
  confidentFramePct?: number | null;
  scoreConfidence?: number | null;
  measurementAvailable?: boolean | null;
  measurementRejectionReasons?: string[];
  /** Legacy alias accepted during state re-entry; normalized into the canonical field. */
  rejectionReasons?: string[];
  pitchValidFrameCount?: number | null;
  hnrValidFrameCount?: number | null;
  hnrVoicedCoveragePct?: number | null;
  captureReliability?: number | null;
  noiseFloorDb?: number | null;
  snrDb?: number | null;
  clippingPct?: number | null;
  meanLoudnessDb?: number | null;
  peakLoudnessDb?: number | null;
  loudnessRangeDb?: number | null;
  medianPitchHz?: number | null;
  pitchP10Hz?: number | null;
  pitchP90Hz?: number | null;
  pitchStdSt?: number | null;
  phraseStartPitchHz?: number | null;
  phraseEndPitchHz?: number | null;
  phraseEndDropHz?: number | null;
  pitchDriftSt?: number | null;
  // Phase 1.2: derived coaching metrics
  pitchTargetOccupancyPct?: number | null;
  phraseFinalDropSemitones?: number | null;
  spectralCentroidMeanHz?: number | null;
  spectralTiltMeanDbPerOct?: number | null;
  harmonicRatioMean?: number | null;
  stabilityMean?: number | null;
  metricSimilarity?: number | null;
  contourSimilarity?: number | null;
  glideSmoothness?: number | null;
  f2RangeHz?: number | null;
  trillRateHz?: number | null;
  trillDetected?: boolean | null;
  trillDurationMs?: number | null;
  hitPitchCeiling?: boolean | null;
  analysisProfile?: string | null;
  formantLite?: VoiceAttemptFormantLiteMetrics | null;
  quality?: VoiceAttemptQualityMetrics | null;
  reliabilityFlags?: string[];
};

export type VoiceTargetFormantLiteBands = {
  f2FloorHz?: number | null;
  frontnessFloor?: number | null;
};

export type VoiceTargetQualityBands = {
  cppsLikeFloor?: number | null;
  harmonicStrengthFloor?: number | null;
  breathyRiskCeiling?: number | null;
  strainRiskCeiling?: number | null;
};

export type VoiceTargetAdvancedBands = {
  pitchP10HzFloor?: number | null;
  pitchP90HzCeiling?: number | null;
  pitchStdStCeiling?: number | null;
  phraseEndDropHzCeiling?: number | null;
  spectralCentroidFloorHz?: number | null;
  spectralTiltFloorDbPerOct?: number | null;
  harmonicRatioFloor?: number | null;
  stabilityFloor?: number | null;
  voicedFramePctFloor?: number | null;
  formantLite?: VoiceTargetFormantLiteBands | null;
  quality?: VoiceTargetQualityBands | null;
};

export type VoiceAttemptMetrics = {
  meanPitchHz?: number | null;
  pitchRangeSt?: number | null;
  resonanceMean?: number | null;
  weightMean?: number | null;
  targetHitPct?: number | null;
  similarityScore?: number | null;
  advanced?: VoiceAttemptAdvancedMetrics | null;
};

export type VoiceAttemptTarget = {
  source?: VoiceTargetSource | string | null;
  targetPreset?: string | null;
  targetProfileId?: string | null;
  direction?: 'feminine' | 'masculine' | 'neutral' | null;
  pitchFloorHz?: number | null;
  pitchCeilingHz?: number | null;
  resonanceFloor?: number | null;
  resonanceCeiling?: number | null;
  weightFloor?: number | null;
  weightCeiling?: number | null;
  minTargetHitPct?: number | null;
  minSimilarityScore?: number | null;
  minResonance?: number | null;
  maxWeight?: number | null;
  minPitchRangeSt?: number | null;
  f2FloorHz?: number | null;
  referenceMeanPitchHz?: number | null;
  referenceResonanceMean?: number | null;
  referenceWeightMean?: number | null;
  referenceF2MedianHz?: number | null;
  pitchPlacement?: 'below' | 'in_band' | 'above' | null;
  pitchGapHz?: number | null;
  resonanceGap?: number | null;
  weightGap?: number | null;
};

export type VoiceAttemptSummary = {
  voiceSessionId?: string | null;
  durationMs?: number | null;
  transcript?: string | null;
  targetPreset?: string | null;
  target?: VoiceAttemptTarget | null;
  metrics?: VoiceAttemptMetrics | null;
  issues?: string[];
  nextDrills?: string[];
  analysisVersion?: string | null;
};

export type VoiceReferenceAnalysis = {
  clipId?: string | null;
  filename?: string | null;
  durationMs?: number | null;
  metrics?: VoiceAttemptMetrics | null;
  timeline?: VoiceLiveFrame[];
  analysisVersion?: string | null;
};

export type VoiceTargetProfile = {
  profileId?: string | null;
  clipId?: string | null;
  sourceFilename?: string | null;
  durationMs?: number | null;
  targetPreset?: string | null;
  metrics?: VoiceAttemptMetrics | null;
  pitchFloorHz?: number | null;
  pitchCeilingHz?: number | null;
  resonanceFloor?: number | null;
  resonanceCeiling?: number | null;
  weightFloor?: number | null;
  weightCeiling?: number | null;
  stylePrompt?: string | null;
  notes?: string[];
  advancedBands?: VoiceTargetAdvancedBands | null;
  analysisVersion?: string | null;
};

export type VoiceTargetSource =
  | 'built-in'
  | 'reference'
  | 'custom-reference'
  | 'custom-handmade';

export type VoiceCustomTargetPresetKind = 'reference' | 'handmade';

export type VoiceCustomTargetPreset = {
  id: string;
  name: string;
  kind: VoiceCustomTargetPresetKind;
  basePreset: string;
  createdAt: number | null;
  updatedAt: number | null;
  archived: boolean;
  archivedAt: number | null;
  targetVoiceProfile: VoiceTargetProfile | null;
  referenceClipId: string | null;
  referenceClipName: string | null;
  referenceAnalysis: VoiceReferenceAnalysis | null;
  sourceLabel?: string | null;
  notes?: string[];
};

export type VoiceCustomTargetPresetDraft = {
  presetId: string | null;
  name: string;
  basePreset: string;
  pitchFloorHz: string;
  pitchCeilingHz: string;
  resonanceFloor: string;
  resonanceCeiling: string;
  weightFloor: string;
  weightCeiling: string;
  stylePrompt: string;
  notesText: string;
};

export type VoiceCueSheetToken = {
  text: string;
  cue: string | null;
  styledCue?: string | null;
  emphasis?: string | null;
  conceptTags?: string[];
  mouthShape?: string | null;
  jawAction?: string | null;
  lipAction?: string | null;
  tongueAction?: string | null;
  airflowCue?: string | null;
  placementFeel?: string | null;
  expressionCue?: string | null;
  avoidCue?: string | null;
  note?: string | null;
  startProgress?: number | null;
  endProgress?: number | null;
};

export type VoiceCueSheet = {
  phrase?: string | null;
  targetPreset?: string | null;
  phraseIntent?: string | null;
  expressionMask?: string | null;
  teachingFocus?: string[];
  cueLine?: string | null;
  styledCueLine?: string | null;
  tokens?: VoiceCueSheetToken[];
};

export type VoicePhraseForecast = {
  profileId?: string | null;
  clipId?: string | null;
  phrase?: string | null;
  targetPreset?: string | null;
  estimatedDurationMs?: number | null;
  metrics?: VoiceAttemptMetrics | null;
  timeline?: VoiceLiveFrame[];
  summary?: string | null;
  notes?: string[];
  cueSheet?: VoiceCueSheet | null;
  analysisVersion?: string | null;
};

export type VoiceDrill = {
  id: string;
  kind?: string | null;
  title: string;
  focus: string;
  phrase: string;
  description: string;
  cues: string[];
  tags: string[];
  cueSheet?: VoiceCueSheet | null;
};

export type VoiceDrillState = {
  targetPreset: string;
  drills: VoiceDrill[];
  selectedLessonId: string | null;
  selectedDrill: VoiceDrill | null;
  recommendedIds: string[];
};

export type VoicePhraseCheckpoint = {
  label: string | null;
  summary: string | null;
  pathMatchScore: number | null;
  laneMatchScore: number | null;
  contourMatchScore: number | null;
  corridorHoldScore: number | null;
  startProgress: number | null;
  endProgress: number | null;
  detailPills?: string[];
};

export type VoicePhraseAnalysisQuality = {
  sampleCount: number | null;
  voicedFramePct: number | null;
  confidentFramePct: number | null;
  meanConfidence: number | null;
  meanLoudnessDb: number | null;
  scoreConfidence: number | null;
  reliable: boolean | null;
  issues: string[];
};

export type VoicePhraseComparison = {
  phrase: string | null;
  lessonId?: string | null;
  forecastPhrase?: string | null;
  pathMatchScore: number | null;
  laneMatchScore?: number | null;
  contourMatchScore?: number | null;
  corridorHoldScore?: number | null;
  targetZoneScore: number | null;
  quickFeedback?: string[];
  checkpoints?: VoicePhraseCheckpoint[];
  analysisQuality?: VoicePhraseAnalysisQuality | null;
  summary: string | null;
};

export type VoiceAudioInputDevice = {
  deviceId: string;
  label: string;
  groupId: string | null;
  isDefault: boolean;
};

export type VoiceOverlayVisibility = {
  live: boolean;
  forecast: boolean;
  reference: boolean;
};

export type VoiceStudentModelReviewItem = {
  conceptId: string;
  name: string;
  urgency: number;
};

export type VoiceLearnerContextNotepadHandoff = {
  content: string;
  items: string[];
  source: string | null;
  sessionId: string | null;
  updatedAt: number | null;
};

export type VoiceCoachPreference = {
  id: string;
  text: string;
  date: string | null;
  source: string | null;
};

export type VoiceTargetBinding = {
  presetId: string | null;
  presetName: string | null;
  referenceClipId: string | null;
  targetPreset: string | null;
  targetSource: string | null;
  targetKey: string | null;
  targetProfileId: string | null;
  analysisVersion: string | null;
  updatedAt: number | null;
};

export type VoiceLearnerContextState = {
  available: boolean;
  source: string | null;
  schemaVersion: string | null;
  query: string | null;
  updatedAt: number | null;
  targetPreset: string | null;
  targetBinding: VoiceTargetBinding | null;
  coachPreferences: VoiceCoachPreference[];
  recentAttemptCount: number;
  notepadHandoff: VoiceLearnerContextNotepadHandoff | null;
  consentStatus: string | null;
  eligibilityStatus: string | null;
  exclusions: string[];
  exportEligible: boolean;
  storageHealth: Record<string, unknown> | null;
  error: string | null;
};

export type VoiceStudentModelState = {
  available: boolean;
  enabled: boolean;
  studentId: string | null;
  masteryLevel: string | null;
  conceptsPracticed: number;
  conceptIds: string[];
  reviewQueueSize: number;
  reviewQueue: VoiceStudentModelReviewItem[];
  struggles: string[];
  learningPace: string | null;
  preferredStyle: string | null;
  reviewPrompt: string | null;
  learnerContext: VoiceLearnerContextState | null;
  error: string | null;
};

export type DeepTutorVoiceKnowledgePoint = {
  title: string;
  summary: string;
  difficulty: string;
};

export type DeepTutorVoiceMimicDirective = {
  action: 'load' | 'ready' | 'mimic' | 'repeat' | 'hold';
  targetKey: string | null;
  statusLabel: string;
  instruction: string;
  suggestedRepeats: number | null;
};

export type DeepTutorVoiceMimicProgress = {
  targetKey: string | null;
  completedRepeats: number;
  targetRepeats: number;
  lastCompletedAt: number | null;
};

export type DeepTutorVoiceLessonBoard = {
  title: string;
  prompt: string;
  performanceText: string;
  focus: string[];
  instruction: string;
  difficultyNote: string;
  progressLabel: string;
  latestNote: string;
  mimicDirective: DeepTutorVoiceMimicDirective | null;
};

export type DeepTutorVoiceCoachBrief = {
  displayText: string;
  spokenText: string;
  cueText: string;
  correctionFocus: string[];
  listenFor: string;
  nextStep: string;
  immediateAction: 'practice' | 'coach';
  quickActions: string[];
  repeatResponse: string;
  slowerResponse: string;
  whyResponse: string;
  holdResponse: string;
};

export type DeepTutorVoiceInputEvidence = {
  status: string;
  outcome: string;
  transcript: string | null;
  partialTranscript: string | null;
  transcriptSource: string | null;
  providerStyle: string | null;
  liveEngine: string | null;
  liveInterimMode: string | null;
  liveVadStrategy: string | null;
  providerTarget: string | null;
  providerModel: string | null;
  providerLanguage: string | null;
  providerEndpointing: string | null;
  vadState: string | null;
  analysisSummary: string | null;
  speechDurationMs: number | null;
  captureDurationMs: number | null;
  audioProcessedMs: number | null;
  roundTripMs: number | null;
  lastProcessedAt: number | null;
  lastEventAt: number | null;
  lastBargeInAt: number | null;
  lastError: string | null;
};

export type DeepTutorVoiceState = {
  enabled: boolean;
  status: string;
  runtimeState: string;
  guideSessionId: string | null;
  guideSessionStatus: string;
  memoryProject: string | null;
  studentId: string | null;
  currentIndex: number | null;
  totalPoints: number;
  knowledgePoints: DeepTutorVoiceKnowledgePoint[];
  currentKnowledge: DeepTutorVoiceKnowledgePoint | null;
  lessonBoard: DeepTutorVoiceLessonBoard | null;
  coachBrief: DeepTutorVoiceCoachBrief | null;
  mimicProgress: DeepTutorVoiceMimicProgress | null;
  latestInputEvidence: DeepTutorVoiceInputEvidence | null;
  lastTutorMessage: string | null;
  lastUserMessage: string | null;
  lastStartedAt: number | null;
  lastSyncedAt: number | null;
  lastError: string | null;
};

export type DeepTutorVoiceLessonMode = 'none' | 'history' | 'active';

export type DeepTutorVoiceRuntimeOwner =
  | 'off'
  | 'warming'
  | 'listening'
  | 'planning'
  | 'evaluating'
  | 'paused';

export type DeepTutorVoicePracticeIntent = 'coach' | 'practice';

export type DeepTutorVoiceSharedInteractionState = {
  lessonMode: DeepTutorVoiceLessonMode;
  guideStatus: string;
  runtimeOwner: DeepTutorVoiceRuntimeOwner;
  practiceIntent: DeepTutorVoicePracticeIntent;
  hasActiveGuideSession: boolean;
  hasHistoricalLessonState: boolean;
  ownsGuidedLineChanges: boolean;
  ownsPhraseMapChanges: boolean;
  acceptsRealtimeCoachTurns: boolean;
};

export type VoiceLiveFrame = {
  t: number;
  voiced: boolean;
  pitchHz: number;
  pitchScore: number;
  resonanceScore: number;
  weightScore: number;
  confidence: number;
  loudnessDb: number;
  advanced?: VoiceFrameAdvancedMetrics | null;
  analysisVersion?: string | null;
};

export type VoiceCoachMessageChannel = 'coach' | 'legacy' | 'runtime' | 'deeptutor' | 'shortcut';

/**
 * Word-emphasis channel — the one word the TTS gateway should lean on.
 *
 * VoxCPM has no prosody API, so the gateway shapes the target text into a short
 * comma-delimited clause around this word (punctuation is the only emphasis
 * signal that survives its text normalizer). Carried per-utterance because it
 * describes THIS demo, not app state.
 */
export type VoiceSpeechEmphasis = {
  word: string;
  /** Practice-card token index. Traceability only — NOT the selector. */
  tokenIndex: number;
  /**
   * Which whole-word occurrence of `word` inside the text being spoken. This is
   * the authoritative selector: the utterance is not always the bare phrase
   * (the eyes-free demo prefixes "New line: "), so a card token index can land
   * on the wrong word entirely. Counted by resolveSpokenLineEmphasis against the
   * exact string sent as targetText.
   */
  occurrence: number;
};

export type VoiceCoachMessage = {
  id: string;
  role: 'coach' | 'user';
  channel: VoiceCoachMessageChannel;
  kind: string;
  content: string;
  createdAt: number;
  /**
   * Line-demo utterances ONLY (hear-line / eyes-free). Coach free-speech replies
   * leave this absent — their prosody hint stays the LLM's job, and the speech
   * controller additionally gates on message.kind so a stray value cannot leak
   * emphasis shaping into a conversational reply.
   */
  emphasis?: VoiceSpeechEmphasis | null;
};

export type VoiceCoachSpeechProvider = 'browser' | 'voxcpm';

export type VoiceCoachInputProvider = 'browser' | 'backend';

export type VoiceCoachInputCapabilities = {
  normalizedTurnContract: boolean;
  liveCapture: boolean;
  recordedCapture?: boolean;
  automaticTurnBoundary?: boolean;
  finalTranscript: boolean;
  interimTranscript: boolean;
  vad: boolean;
  bargeInCancel: boolean;
};

export type VoiceCoachBackendLiveStatus = {
  requestedMode: string | null;
  requestedVadStrategy: string | null;
  requestedWsProtocol: string | null;
  requestedWsUrlConfigured: boolean;
  requestedProviderTarget: string | null;
  requestedModel: string | null;
  requestedLanguage: string | null;
  requestedEndpointing: string | null;
  actualMode: string | null;
  actualEngine: string | null;
  actualInterimMode: string | null;
  actualVadStrategy: string | null;
  actualProviderTarget: string | null;
  actualProviderModel: string | null;
  actualProviderLanguage: string | null;
  actualProviderEndpointing: string | null;
  fallbackReason: string | null;
  verified: boolean;
  available: boolean | null;
  lastError: string | null;
  lastErrorBucket: string | null;
  lastCheckedAt: number | null;
};

export type VoiceInputRuntimeStatus = 'idle' | 'waiting' | 'listening' | 'processing' | 'error';

export type VoiceInputRuntimeOutcome = 'idle' | 'completed' | 'no-speech' | 'error';

export type VoiceInputRuntimeState = {
  status: VoiceInputRuntimeStatus;
  lastOutcome: VoiceInputRuntimeOutcome;
  requestedProvider: VoiceCoachInputProvider;
  effectiveProvider: VoiceCoachInputProvider | null;
  captureProvider: VoiceCoachInputProvider | null;
  providerStyle: string | null;
  transcriptSource: string | null;
  lastTranscript: string | null;
  lastTranscriptConfidence: number | null;
  lastCaptureStartedAt: number | null;
  lastSpeechDetectedAt: number | null;
  lastCapturedAt: number | null;
  lastProcessedAt: number | null;
  lastCaptureDurationMs: number | null;
  lastRoundTripMs: number | null;
  successfulTurns: number;
  noSpeechTurns: number;
  errorCount: number;
  consecutiveNoSpeechTurns: number;
  consecutiveErrorTurns: number;
  liveSessionId: string | null;
  lastSegmentId: string | null;
  liveEngine: string | null;
  liveInterimMode: string | null;
  liveVadStrategy: string | null;
  providerTarget: string | null;
  providerModel: string | null;
  providerLanguage: string | null;
  providerEndpointing: string | null;
  lastPartialTranscript: string | null;
  lastPartialTranscriptAt: number | null;
  lastVadState: 'idle' | 'waiting' | 'speech' | 'processing' | null;
  lastBargeInAt: number | null;
  lastAnalysisSummary: string | null;
  lastAnalysisDurationMs: number | null;
  lastAverageLevelDb: number | null;
  lastPeakLevelDb: number | null;
  lastNoiseFloorDb: number | null;
  lastSnrDb: number | null;
  lastClippingPct: number | null;
  lastCaptureReliability: number | null;
  lastReliabilityFlags: string[];
  lastSpeechDurationMs: number | null;
  lastAudioProcessedMs: number | null;
  lastError: string | null;
  lastEventAt: number | null;
};

export type VoiceInputRecoveryState = {
  level: 'ok' | 'warning' | 'critical';
  statusLabel: string | null;
  coachCopy: string | null;
  activeDrillCopy: string | null;
  providerHint: string | null;
  runtimePill: string | null;
  suggestedInputProvider: VoiceCoachInputProvider | null;
  shouldDisableContinuous: boolean;
  disableReason: string | null;
};

export type VoiceCoachVoiceState = {
  speechEnabled: boolean;
  continuousEnabled: boolean;
  speechProvider: VoiceCoachSpeechProvider;
  inputProvider: VoiceCoachInputProvider;
  activeReferenceClipId: string | null;
  activeReferenceClipName: string | null;
};

export type VoiceConditioningState = {
  useTargetProfileStyle: boolean;
  styleInstruction: string;
  promptText: string;
  promptAudioName: string | null;
  promptLatentsReady: boolean;
  referenceAudioName: string | null;
  referenceLatentsReady: boolean;
  updatedAt: number | null;
};

export type VoiceAdvancedPanelState = {
  open: boolean;
  vadRmsThreshold: number;
  vadSilenceHoldMs: number;
  vadNoSpeechTimeoutMs: number;
  vadMinSpeechMs: number;
  audioPreferWorklet: boolean;
};

export type VoiceUiState = {
  status: string;
  targetPreset: string;
  targetSource: VoiceTargetSource;
  selectedCustomPresetId: string | null;
  selectedCustomPresetName: string | null;
  voiceSessionId: string | null;
  lessonId: string | null;
  referenceClipId: string | null;
  referenceClipName: string | null;
  streamUrl: string | null;
  /**
   * Durable "I chose a preset instead of uploading a target" flag. The front-door
   * takeover (render-dom.ts) re-derives visibility from sessionStage every frame, so a
   * one-shot imperative hide would snap back; this flag hides it for good across renders.
   * Optional so existing VoiceUiState literals/tests don't need updating.
   */
  frontDoorDismissed?: boolean;
  serviceStatus: 'unknown' | 'online' | 'offline' | 'error';
  sessionStartedAt: number | null;
  endedAt: number | null;
  lastSummary: VoiceAttemptSummary | null;
  lastAttemptArtifact: VoiceAttemptArtifact | null;
  /** Guardian window mirrored by the backend after every finalized usable take. */
  strainWatch: VoiceStrainWatch | null;
  /** Backend coaching context; optional on legacy/local-only state. */
  repContext?: VoiceRepContext | null;
  attemptArtifacts: VoiceAttemptArtifact[];
  studentModelAttemptIds: string[];
  selfReportDraft: VoiceSelfReport;
  phraseComparison: VoicePhraseComparison | null;
  lastTakeTimeline: VoiceLiveFrame[] | null;
  lastCoachMessage: string | null;
  lastCoachGeneratedAt: number | null;
  lastError: string | null;
  referenceAnalysis: VoiceReferenceAnalysis | null;
  targetVoiceProfile: VoiceTargetProfile | null;
  phraseForecast: VoicePhraseForecast | null;
  forecastPhrase: string | null;
  activeLine: VoicePracticeLine | null;
  lineQueue: VoicePracticeLine[];
  lineDifficultyPreference: 'adaptive' | 'easy' | 'medium' | 'hard';
  coachThread: VoiceCoachMessage[];
  coachVoice: VoiceCoachVoiceState;
  voiceInputRuntime: VoiceInputRuntimeState;
  voiceConditioning: VoiceConditioningState;
  advancedPanel: VoiceAdvancedPanelState;
  deeptutorVoiceState: DeepTutorVoiceState | null;
  customTargetPresets: VoiceCustomTargetPreset[];
  customTargetPresetDraft: VoiceCustomTargetPresetDraft;
};

export type VoicePracticeLine = {
  id: string;
  displayText: string;
  performanceText: string;
  intent: string | null;
  difficulty: 'easy' | 'medium' | 'hard';
  targetPreset: string | null;
  teachingFocus: string[];
  source: string | null;
  referenceMode: string | null;
  cueSheet: VoiceCueSheet | null;
  pinned: boolean;
};

export type VoiceRepContext = {
  targetPreset: string | null;
  targetSource: VoiceTargetSource | null;
  lessonId: string | null;
  activeLine: VoicePracticeLine | null;
  referenceClipId: string | null;
  referenceClipName: string | null;
  forecastPhrase: string | null;
  targetProfileId?: string | null;
  targetProfileSource?: string | null;
  kind?: string | null;
  drillId?: string | null;
  tags?: string[];
  drill?: {
    id?: string | null;
    kind?: string | null;
    tags?: string[];
  } | null;
};

export type VoiceStrainWatch = {
  recentFlags: number;
  sessionMinutes: number | null;
  takeCount: number;
  strainedTotal: number;
};

export type VoiceSelfReport = {
  perceivedDifficulty?: number | null;
  effort?: number | null;
  confidence?: number | null;
  strain?: number | null;
  fatigue?: number | null;
  notes?: string | null;
  tags?: string[];
  metadata?: Record<string, unknown> | null;
};

export type VoiceAttemptArtifact = {
  attemptId?: string | null;
  attemptArtifactId?: string | null;
  clientAttemptId?: string | null;
  voiceSessionId?: string | null;
  sloaneSessionId?: string | null;
  lessonId?: string | null;
  targetPreset?: string | null;
  referenceClipId?: string | null;
  reason?: string | null;
  status?: string | null;
  createdAt?: number | string | null;
  endedAt?: number | string | null;
  finalizedAt?: number | string | null;
  durationMs?: number | null;
  frameCount?: number | null;
  timelineFrameCount?: number | null;
  timelineSampledFrameCount?: number | null;
  timelineCompression?: string | null;
  timeline?: VoiceLiveFrame[] | null;
  summary?: VoiceAttemptSummary | null;
  metrics?: VoiceAttemptMetrics | null;
  reliabilityFlags?: string[];
  issues?: string[];
  nextDrills?: string[];
  transcript?: string | null;
  repContext?: VoiceRepContext | null;
  selfReport?: VoiceSelfReport | null;
  phraseComparison?: VoicePhraseComparison | null;
  includesRawAudio?: boolean | null;
  analysisVersion?: string | null;
};

// Phase 1.4: baseline snapshot for one targetPreset. Frozen after the first
// 3 takes for that preset; never overwritten.
export type VoiceLearnerBaseline = {
  targetPreset?: string | null;
  capturedAt?: number | null;
  attemptCount?: number | null;
  source?: string | null;
  meanPitchHz?: number | null;
  pitchRangeSt?: number | null;
  pitchP10Hz?: number | null;
  pitchP90Hz?: number | null;
  pitchStdSt?: number | null;
  resonanceMean?: number | null;
  weightMean?: number | null;
  targetHitPct?: number | null;
  pitchTargetOccupancyPct?: number | null;
  phraseFinalDropSemitones?: number | null;
  harmonicRatioMean?: number | null;
  spectralCentroidMeanHz?: number | null;
  cppsLike?: number | null;
  harmonicStrength?: number | null;
  breathyRisk?: number | null;
  strainRisk?: number | null;
  formantF2MedianHz?: number | null;
  frontnessScore?: number | null;
  sampleArtifactIds?: string[];
  frozen?: boolean | null;
};

export type VoiceBackendPayload = {
  voiceState?: Partial<VoiceUiState> | null;
  studentModel?: Partial<VoiceStudentModelState> | null;
  learnerContext?: Partial<VoiceLearnerContextState> | null;
  deeptutorVoiceState?: Partial<DeepTutorVoiceState> | null;
  turnId?: string | null;
};
