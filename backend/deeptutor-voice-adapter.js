const { createVoiceBackendPayload } = require('../shared/contracts/voice-backend-payload.cjs');
const {
  buildVoiceTutorCapturePolicyLines,
  buildVoiceTutorRuntimePolicyLines,
  normalizeVoiceTutorPracticeMode,
} = require('./voice-tutor-runtime-policy');
const { extractDeepTutorNotepadContext } = require('./notepad-state');
const { resolveAgentNotepadPolicy } = require('./notepad-policy');
const { resolveVoiceMeasurementUsability } = require('./voice-measurement-validity');
const { collectAnalyzerSafetyReasons } = require('./coaching/safety-gates');
const { resolveTakeKind } = require('./coaching/signal-builder');
const { canonicalizeDirection } = require('./voice-target-identity');
const {
  resolveBreathyThreshold,
  resolveStrainThresholds,
} = require('./coaching/safety-thresholds');

const DEFAULT_DEEPTUTOR_VOICE_MEMORY_PROJECT = process.env.DEEPTUTOR_VOICE_MEMORY_PROJECT || 'sloane-os-voice-tutor';
const DEEPTUTOR_VOICE_GGUF_ENABLED = parseEnvFlag(
  process.env.DEEPTUTOR_VOICE_GGUF_ENABLED ?? process.env.VOICE_TUTOR_GGUF_ENABLED,
  true,
);
const DEFAULT_DEEPTUTOR_VOICE_BACKEND_MODEL = (
  DEEPTUTOR_VOICE_GGUF_ENABLED
    ? (
      process.env.DEEPTUTOR_VOICE_MODEL
      || process.env.VOICE_TUTOR_GGUF_MODEL
      || process.env.VOICE_TUTOR_LLM_MODEL
      || 'voice-tutor-gemma4-r128-clean-s070-iq4nl-attnq8-last10-gguf'
    )
    : ''
).trim();

function parseEnvFlag(value, fallback = false) {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }
  const text = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(text)) {
    return true;
  }
  if (['0', 'false', 'no', 'off', 'disabled'].includes(text)) {
    return false;
  }
  return fallback;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function canReadDeepTutorVoiceGuideNotepad(session, options = {}) {
  const policy = resolveAgentNotepadPolicy(session, {
    runtimeMode: options.runtimeMode || 'deeptutor-voice-guide-records',
  });
  return policy.enabled === true
    && policy.promptMode !== 'hidden'
    && policy.uiVisible !== false;
}

function toNumberOrNull(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return null;
  }
  return Number.isFinite(Number(value)) ? Math.round(Number(value)) : null;
}

function formatPercent(value) {
  return Number.isFinite(value) ? `${Math.round(value * 100)}%` : 'unknown';
}

function toFiniteNumberOrNull(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return null;
  }
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isMeasurementUnusable(summaryMetrics) {
  return !resolveVoiceMeasurementUsability(summaryMetrics?.advanced || {}).usableForScoring;
}

function firstFiniteNumber(...values) {
  for (const value of values) {
    // null/undefined = "no value" -> skip, never treat as 0 (Number(null)===0 is
    // finite). Parity with normalizeMetric's null-guard so a missing snrDb fallback
    // can't masquerade as a real 0 dB reading.
    if (value === null || value === undefined) continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return numeric;
    }
  }
  return null;
}

function formatOptionalPercent(value) {
  const numeric = toFiniteNumberOrNull(value);
  return numeric != null ? `${Math.round(numeric * 100)}%` : null;
}

function formatOptionalHz(value, digits = 0) {
  const numeric = toFiniteNumberOrNull(value);
  return numeric != null ? `${numeric.toFixed(digits)} Hz` : null;
}

function formatOptionalSemitones(value, digits = 2) {
  const numeric = toFiniteNumberOrNull(value);
  return numeric != null ? `${numeric.toFixed(digits)} st` : null;
}

function formatOptionalDb(value, digits = 1) {
  const numeric = toFiniteNumberOrNull(value);
  return numeric != null ? `${numeric.toFixed(digits)} dB` : null;
}

function formatOptionalOffset(value, digits = 2) {
  const numeric = toFiniteNumberOrNull(value);
  return numeric != null ? numeric.toFixed(digits) : null;
}

function summarizeTimeline(timeline) {
  const frames = Array.isArray(timeline) ? timeline.filter((frame) => frame && typeof frame === 'object') : [];
  const voiced = frames.filter((frame) => frame.voiced && Number(frame.pitchHz) > 0);
  const confident = voiced.filter((frame) => Number(frame.confidence) >= 0.16);
  const pitchValues = voiced.map((frame) => Number(frame.pitchHz) || 0).filter((value) => value > 0);
  const startPitch = pitchValues.length > 0 ? Math.round(pitchValues[0]) : null;
  const endPitch = pitchValues.length > 0 ? Math.round(pitchValues[pitchValues.length - 1]) : null;
  let peakPitch = null;
  let floorPitch = null;
  if (pitchValues.length > 0) {
    let peakValue = pitchValues[0];
    let floorValue = pitchValues[0];
    for (let index = 1; index < pitchValues.length; index += 1) {
      const value = pitchValues[index];
      peakValue = Math.max(peakValue, value);
      floorValue = Math.min(floorValue, value);
    }
    peakPitch = Math.round(peakValue);
    floorPitch = Math.round(floorValue);
  }
  const meanConfidence = frames.length > 0
    ? Math.round((frames.reduce((total, frame) => total + (Number(frame.confidence) || 0), 0) / frames.length) * 100)
    : null;
  const graphTrajectory = startPitch != null && endPitch != null
    ? endPitch > startPitch + 6
      ? 'finishes rising'
      : endPitch < startPitch - 6
        ? 'finishes falling'
        : 'finishes flat'
    : 'unknown';

  return {
    sampleCount: frames.length,
    voicedPct: frames.length > 0 ? Math.round((voiced.length / frames.length) * 100) : null,
    confidentPct: voiced.length > 0 ? Math.round((confident.length / voiced.length) * 100) : null,
    meanConfidence,
    startPitch,
    endPitch,
    peakPitch,
    floorPitch,
    graphTrajectory,
  };
}

function uniqueStrings(values, limit = 8) {
  if (!Array.isArray(values)) return [];
  return Array.from(new Set(
    values
      .map((value) => normalizeText(value))
      .filter(Boolean),
  )).slice(0, limit);
}

function hasReliabilityFlag(advancedMetrics, flag) {
  return Array.isArray(advancedMetrics?.reliabilityFlags)
    && advancedMetrics.reliabilityFlags.includes(flag);
}

function buildAdvancedVoiceFocus(summaryMetrics = {}, targetVoiceProfile = {}, options = {}) {
  const advancedMetrics = summaryMetrics?.advanced || {};
  if (isMeasurementUnusable(summaryMetrics)) {
    return [];
  }
  const advancedBands = targetVoiceProfile?.advancedBands || {};
  const formantLite = advancedMetrics.formantLite || {};
  const quality = advancedMetrics.quality || {};
  const formantBands = advancedBands.formantLite || {};
  const qualityBands = advancedBands.quality || {};
  const focus = [];
  const pitchFloor = toFiniteNumberOrNull(advancedMetrics.pitchP10Hz);
  const targetPitchFloor = toFiniteNumberOrNull(advancedBands.pitchP10HzFloor);
  const phraseEndDrop = toFiniteNumberOrNull(advancedMetrics.phraseEndDropHz);
  const phraseEndCeiling = toFiniteNumberOrNull(advancedBands.phraseEndDropHzCeiling);
  const stabilityMean = toFiniteNumberOrNull(advancedMetrics.stabilityMean);
  const frontnessScore = toFiniteNumberOrNull(formantLite.frontnessScore);
  const frontnessFloor = toFiniteNumberOrNull(formantBands.frontnessFloor);
  const breathyRisk = toFiniteNumberOrNull(quality.breathyRisk);
  const strainRisk = toFiniteNumberOrNull(quality.strainRisk);
  const breathyThreshold = resolveBreathyThreshold(qualityBands);
  const strainThresholds = resolveStrainThresholds(qualityBands, {
    takeKind: options.takeKind,
  });
  const pitchNeedsLift = pitchFloor != null && targetPitchFloor != null && pitchFloor < targetPitchFloor - 4;

  if (pitchNeedsLift) {
    focus.push('keep the low-end pitch floor lifted between syllables');
  }
  if (phraseEndDrop != null && (
    (phraseEndCeiling != null && phraseEndDrop > phraseEndCeiling)
    || phraseEndDrop > 16
  )) {
    focus.push('hold the last word up instead of letting the ending drop');
  }
  if (stabilityMean != null && stabilityMean < 0.56) {
    focus.push('keep one steady target placement through the whole phrase');
  }
  if (frontnessScore != null && frontnessFloor != null && frontnessScore < frontnessFloor) {
    focus.push(pitchNeedsLift
      ? 'keep the mouth shape and resonance closer to the selected reference'
      : 'bring the mouth shape and resonance closer to the selected target');
  }
  if (breathyRisk != null && breathyRisk >= breathyThreshold.warn) {
    focus.push('close the tone cleanly at the start of each word so no air escapes ahead of the sound');
  }
  if (strainRisk != null && strainRisk >= strainThresholds.warn) {
    focus.push('keep the target shape without squeezing the throat or jaw');
  }
  if (hasReliabilityFlag(advancedMetrics, 'quiet_input')) {
    focus.push('give the system a slightly stronger input level');
  }
  if (hasReliabilityFlag(advancedMetrics, 'low_voiced_coverage')) {
    focus.push('settle the phrase into a voiced tone before chasing the target');
  }
  return uniqueStrings(focus, 4);
}

function describePrimaryMimicGap(summaryMetrics = {}, targetVoiceProfile = {}, options = {}) {
  const advancedMetrics = summaryMetrics?.advanced || {};
  if (isMeasurementUnusable(summaryMetrics)) {
    return 'record another clear take before comparing it with the selected target';
  }
  const advancedBands = targetVoiceProfile?.advancedBands || {};
  const formantLite = advancedMetrics.formantLite || {};
  const quality = advancedMetrics.quality || {};
  const formantBands = advancedBands.formantLite || {};
  const qualityBands = advancedBands.quality || {};
  const pitchFloor = toFiniteNumberOrNull(advancedMetrics.pitchP10Hz);
  const targetPitchFloor = toFiniteNumberOrNull(advancedBands.pitchP10HzFloor);
  const phraseEndDrop = toFiniteNumberOrNull(advancedMetrics.phraseEndDropHz);
  const phraseEndCeiling = toFiniteNumberOrNull(advancedBands.phraseEndDropHzCeiling);
  const stabilityMean = toFiniteNumberOrNull(advancedMetrics.stabilityMean);
  const contourSimilarity = toFiniteNumberOrNull(advancedMetrics.contourSimilarity);
  const frontnessScore = toFiniteNumberOrNull(formantLite.frontnessScore);
  const frontnessFloor = toFiniteNumberOrNull(formantBands.frontnessFloor);
  const breathyRisk = toFiniteNumberOrNull(quality.breathyRisk);
  const strainRisk = toFiniteNumberOrNull(quality.strainRisk);
  const breathyThreshold = resolveBreathyThreshold(qualityBands);
  const strainThresholds = resolveStrainThresholds(qualityBands, {
    takeKind: options.takeKind,
  });
  const pitchNeedsLift = pitchFloor != null && targetPitchFloor != null && pitchFloor < targetPitchFloor - 8;

  if (pitchNeedsLift) {
    return 'keep the low end lifted while you copy the reference trail';
  }
  if (phraseEndDrop != null && ((phraseEndCeiling != null && phraseEndDrop > phraseEndCeiling + 2) || phraseEndDrop > 18)) {
    return 'keep the ending suspended instead of letting it fall';
  }
  if (stabilityMean != null && stabilityMean < 0.52) {
    return 'hold one steady target shape while you mimic the target';
  }
  if (frontnessScore != null && frontnessFloor != null && frontnessScore < frontnessFloor - 0.06) {
    return 'bring the mouth shape and resonance closer to the selected reference';
  }
  if (breathyRisk != null && breathyRisk >= breathyThreshold.warn) {
    return 'close the tone cleanly at the start of each word so the sound arrives without air in front of it';
  }
  if (strainRisk != null && strainRisk >= strainThresholds.warn) {
    return 'keep the target shape without squeezing or pushing the throat';
  }
  if (contourSimilarity != null && contourSimilarity < 0.58) {
    return 'copy the reference phrase shape more closely';
  }
  return 'copy the reference trail more closely';
}

function buildCompactAdvancedAnalyzerLines(summary = {}, targetVoiceProfile = {}) {
  const advancedMetrics = summary?.metrics?.advanced || {};
  const advancedBands = targetVoiceProfile?.advancedBands || {};
  const formantLite = advancedMetrics.formantLite || {};
  const quality = advancedMetrics.quality || {};
  const formantBands = advancedBands.formantLite || {};
  const qualityBands = advancedBands.quality || {};
  const analysisVersions = Array.from(new Set(
    [
      normalizeText(summary?.analysisVersion),
      normalizeText(targetVoiceProfile?.analysisVersion),
    ].filter(Boolean),
  ));
  const lines = [];

  if (analysisVersions.length > 0) {
    lines.push(`Analysis version: ${analysisVersions.join(' | ')}`);
  }

  const measurementRejected = isMeasurementUnusable(summary?.metrics || {});
  if (measurementRejected) {
    const rejectionReasons = uniqueStrings(
      advancedMetrics.measurementRejectionReasons,
      6,
    ).map((reason) => reason.replace(/_/g, ' '));
    lines.push(
      `Measurement available: no${rejectionReasons.length > 0 ? ` | reasons ${rejectionReasons.join(' | ')}` : ''}`,
    );
  }

  const coverageParts = [
    formatOptionalPercent(advancedMetrics.voicedFramePct)
      ? `voiced ${formatOptionalPercent(advancedMetrics.voicedFramePct)}`
      : null,
    formatOptionalPercent(advancedMetrics.confidentFramePct)
      ? `confident ${formatOptionalPercent(advancedMetrics.confidentFramePct)}`
      : null,
    formatOptionalPercent(advancedMetrics.scoreConfidence)
      ? `score confidence ${formatOptionalPercent(advancedMetrics.scoreConfidence)}`
      : null,
    Array.isArray(advancedMetrics.reliabilityFlags) && advancedMetrics.reliabilityFlags.length > 0
      ? `flags ${advancedMetrics.reliabilityFlags.join(' | ')}`
      : null,
  ].filter(Boolean);
  if (coverageParts.length > 0) {
    lines.push(`Advanced take coverage: ${coverageParts.join(' | ')}`);
  }

  if (measurementRejected) {
    return lines;
  }

  const shapeParts = [
    formatOptionalHz(advancedMetrics.pitchP10Hz)
      ? `p10 ${formatOptionalHz(advancedMetrics.pitchP10Hz)}`
      : null,
    formatOptionalHz(advancedMetrics.pitchP90Hz)
      ? `p90 ${formatOptionalHz(advancedMetrics.pitchP90Hz)}`
      : null,
    formatOptionalHz(advancedMetrics.medianPitchHz)
      ? `median ${formatOptionalHz(advancedMetrics.medianPitchHz)}`
      : null,
    formatOptionalSemitones(advancedMetrics.pitchStdSt, 2)
      ? `spread ${formatOptionalSemitones(advancedMetrics.pitchStdSt, 2)}`
      : null,
    formatOptionalHz(advancedMetrics.phraseEndDropHz, 1)
      ? `end drop ${formatOptionalHz(advancedMetrics.phraseEndDropHz, 1)}`
      : null,
    formatOptionalSemitones(advancedMetrics.pitchDriftSt, 2)
      ? `drift ${formatOptionalSemitones(advancedMetrics.pitchDriftSt, 2)}`
      : null,
    formatOptionalHz(advancedMetrics.spectralCentroidMeanHz)
      ? `centroid ${formatOptionalHz(advancedMetrics.spectralCentroidMeanHz)}`
      : null,
    formatOptionalDb(advancedMetrics.spectralTiltMeanDbPerOct)
      ? `tilt ${formatOptionalDb(advancedMetrics.spectralTiltMeanDbPerOct)}/oct`
      : null,
    formatOptionalPercent(advancedMetrics.harmonicRatioMean)
      ? `harmonics ${formatOptionalPercent(advancedMetrics.harmonicRatioMean)}`
      : null,
    formatOptionalPercent(advancedMetrics.stabilityMean)
      ? `stability ${formatOptionalPercent(advancedMetrics.stabilityMean)}`
      : null,
    formatOptionalHz(formantLite.f1MedianHz)
      ? `f1 ${formatOptionalHz(formantLite.f1MedianHz)}`
      : null,
    formatOptionalHz(formantLite.f2MedianHz)
      ? `f2 ${formatOptionalHz(formantLite.f2MedianHz)}`
      : null,
    formatOptionalPercent(formantLite.frontnessScore)
      ? `frontness ${formatOptionalPercent(formantLite.frontnessScore)}`
      : null,
    formatOptionalOffset(formantLite.frontnessShift)
      ? `front shift ${formatOptionalOffset(formantLite.frontnessShift)}`
      : null,
    formatOptionalDb(quality.cppsLike, 2)
      ? `cpps-like ${formatOptionalDb(quality.cppsLike, 2)}`
      : null,
    formatOptionalDb(quality.harmonicStrength, 2)
      ? `harmonic-strength ${formatOptionalDb(quality.harmonicStrength, 2)}`
      : null,
    quality.jitterLocal != null
      ? `jitter ${(quality.jitterLocal * 100).toFixed(2)}%`
      : null,
    quality.shimmerLocal != null
      ? `shimmer ${(quality.shimmerLocal * 100).toFixed(1)}%`
      : null,
    formatOptionalPercent(quality.breathyRisk)
      ? `breathy risk ${formatOptionalPercent(quality.breathyRisk)}`
      : null,
    formatOptionalPercent(quality.strainRisk)
      ? `strain risk ${formatOptionalPercent(quality.strainRisk)}`
      : null,
  ].filter(Boolean);
  if (shapeParts.length > 0) {
    lines.push(`Advanced take shape: ${shapeParts.join(' | ')}`);
  }

  const bandParts = [
    formatOptionalHz(advancedBands.pitchP10HzFloor)
      ? `p10 floor ${formatOptionalHz(advancedBands.pitchP10HzFloor)}`
      : null,
    formatOptionalHz(advancedBands.pitchP90HzCeiling)
      ? `p90 ceiling ${formatOptionalHz(advancedBands.pitchP90HzCeiling)}`
      : null,
    formatOptionalSemitones(advancedBands.pitchStdStCeiling, 2)
      ? `spread ceiling ${formatOptionalSemitones(advancedBands.pitchStdStCeiling, 2)}`
      : null,
    formatOptionalHz(advancedBands.phraseEndDropHzCeiling, 1)
      ? `end-drop ceiling ${formatOptionalHz(advancedBands.phraseEndDropHzCeiling, 1)}`
      : null,
    formatOptionalHz(advancedBands.spectralCentroidFloorHz)
      ? `centroid floor ${formatOptionalHz(advancedBands.spectralCentroidFloorHz)}`
      : null,
    formatOptionalPercent(advancedBands.stabilityFloor)
      ? `stability floor ${formatOptionalPercent(advancedBands.stabilityFloor)}`
      : null,
    formatOptionalHz(formantBands.f2FloorHz)
      ? `f2 floor ${formatOptionalHz(formantBands.f2FloorHz)}`
      : null,
    formatOptionalPercent(formantBands.frontnessFloor)
      ? `frontness floor ${formatOptionalPercent(formantBands.frontnessFloor)}`
      : null,
    formatOptionalDb(qualityBands.cppsLikeFloor, 2)
      ? `cpps floor ${formatOptionalDb(qualityBands.cppsLikeFloor, 2)}`
      : null,
    formatOptionalDb(qualityBands.harmonicStrengthFloor, 2)
      ? `harmonic-strength floor ${formatOptionalDb(qualityBands.harmonicStrengthFloor, 2)}`
      : null,
    formatOptionalPercent(qualityBands.breathyRiskCeiling)
      ? `breathy ceiling ${formatOptionalPercent(qualityBands.breathyRiskCeiling)}`
      : null,
    formatOptionalPercent(qualityBands.strainRiskCeiling)
      ? `strain ceiling ${formatOptionalPercent(qualityBands.strainRiskCeiling)}`
      : null,
  ].filter(Boolean);
  if (bandParts.length > 0) {
    lines.push(`Target advanced bands: ${bandParts.join(' | ')}`);
  }

  return lines;
}

function normalizeKnowledgePoint(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const title = normalizeText(value.knowledge_title || value.title);
  const summary = normalizeText(value.knowledge_summary || value.summary);
  const difficulty = normalizeText(value.user_difficulty || value.difficulty);

  if (!title && !summary && !difficulty) {
    return null;
  }

  return {
    title: title || 'Voice coaching focus',
    summary,
    difficulty,
  };
}

function normalizeLessonBoard(value) {
  const focus = uniqueStrings(value?.focus || value?.teachingFocus, 6);
  return {
    title: normalizeText(value?.title),
    prompt: normalizeText(value?.prompt),
    performanceText: normalizeText(value?.performanceText),
    targetPreset: normalizeText(value?.targetPreset),
    stylePrompt: normalizeText(value?.stylePrompt),
    practiceMode: normalizeText(value?.practiceMode || value?.practice_mode)
      ? normalizeVoiceTutorPracticeMode(value?.practiceMode || value?.practice_mode)
      : '',
    focus,
    instruction: normalizeText(value?.instruction),
    difficultyNote: normalizeText(value?.difficultyNote),
    progressLabel: normalizeText(value?.progressLabel),
    latestNote: normalizeText(value?.latestNote),
    mimicDirective: normalizeMimicDirective(value?.mimicDirective),
  };
}

function normalizeCoachBrief(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const displayText = normalizeText(value.displayText);
  const spokenText = normalizeText(value.spokenText || displayText);
  const cueText = normalizeText(value.cueText);
  const correctionFocus = uniqueStrings(value.correctionFocus, 4);
  const listenFor = normalizeText(value.listenFor);
  const nextStep = normalizeText(value.nextStep);
  const immediateAction = normalizeText(value.immediateAction) === 'practice' ? 'practice' : 'coach';
  const targetPreset = normalizeText(value.targetPreset);
  const stylePrompt = normalizeText(value.stylePrompt);
  const practiceMode = normalizeText(value.practiceMode || value.practice_mode)
    ? normalizeVoiceTutorPracticeMode(value.practiceMode || value.practice_mode)
    : '';
  const quickActions = uniqueStrings(value.quickActions, 8);
  const repeatResponse = normalizeText(value.repeatResponse);
  const slowerResponse = normalizeText(value.slowerResponse);
  const whyResponse = normalizeText(value.whyResponse);
  const holdResponse = normalizeText(value.holdResponse);

  if (
    !displayText
    && !spokenText
    && !cueText
    && correctionFocus.length === 0
    && !listenFor
    && !nextStep
    && !repeatResponse
    && !slowerResponse
    && !whyResponse
    && !holdResponse
  ) {
    return null;
  }

  return {
    displayText: displayText || '',
    spokenText: spokenText || displayText || '',
    cueText: cueText || '',
    targetPreset,
    stylePrompt,
    practiceMode,
    correctionFocus,
    listenFor,
    nextStep,
    immediateAction,
    quickActions,
    repeatResponse,
    slowerResponse,
    whyResponse,
    holdResponse,
  };
}

function normalizeInputEvidence(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const status = normalizeText(value.status);
  const outcome = normalizeText(value.outcome);
  const transcript = normalizeText(value.transcript);
  const partialTranscript = normalizeText(value.partialTranscript);
  const transcriptSource = normalizeText(value.transcriptSource);
  const providerStyle = normalizeText(value.providerStyle);
  const liveEngine = normalizeText(value.liveEngine);
  const liveInterimMode = normalizeText(value.liveInterimMode);
  const liveVadStrategy = normalizeText(value.liveVadStrategy);
  const providerTarget = normalizeText(value.providerTarget);
  const providerModel = normalizeText(value.providerModel);
  const providerLanguage = normalizeText(value.providerLanguage);
  const providerEndpointing = normalizeText(value.providerEndpointing);
  const vadState = normalizeText(value.vadState);
  const analysisSummary = normalizeText(value.analysisSummary);
  const lastError = normalizeText(value.lastError);
  const speechDurationMs = toNumberOrNull(value.speechDurationMs);
  const captureDurationMs = toNumberOrNull(value.captureDurationMs);
  const audioProcessedMs = toNumberOrNull(value.audioProcessedMs);
  const roundTripMs = toNumberOrNull(value.roundTripMs);
  const lastProcessedAt = toNumberOrNull(value.lastProcessedAt);
  const lastEventAt = toNumberOrNull(value.lastEventAt);
  const lastBargeInAt = toNumberOrNull(value.lastBargeInAt);

  if (
    !status
    && !outcome
    && !transcript
    && !partialTranscript
    && !transcriptSource
    && !providerStyle
    && !liveEngine
    && !liveInterimMode
    && !liveVadStrategy
    && !providerTarget
    && !providerModel
    && !providerLanguage
    && !providerEndpointing
    && !vadState
    && !analysisSummary
    && !lastError
    && speechDurationMs == null
    && captureDurationMs == null
    && audioProcessedMs == null
    && roundTripMs == null
    && lastProcessedAt == null
    && lastEventAt == null
    && lastBargeInAt == null
  ) {
    return null;
  }

  return {
    status: status || 'idle',
    outcome: outcome || 'idle',
    transcript: transcript || null,
    partialTranscript: partialTranscript || null,
    transcriptSource: transcriptSource || null,
    providerStyle: providerStyle || null,
    liveEngine: liveEngine || null,
    liveInterimMode: liveInterimMode || null,
    liveVadStrategy: liveVadStrategy || null,
    providerTarget: providerTarget || null,
    providerModel: providerModel || null,
    providerLanguage: providerLanguage || null,
    providerEndpointing: providerEndpointing || null,
    vadState: vadState || null,
    analysisSummary: analysisSummary || null,
    speechDurationMs,
    captureDurationMs,
    audioProcessedMs,
    roundTripMs,
    lastProcessedAt,
    lastEventAt,
    lastBargeInAt,
    lastError: lastError || null,
  };
}

function buildVoiceInputEvidence(voiceState) {
  const runtime = voiceState?.voiceInputRuntime;
  if (!runtime || typeof runtime !== 'object' || Array.isArray(runtime)) {
    return null;
  }

  return normalizeInputEvidence({
    status: runtime.status,
    outcome: runtime.lastOutcome,
    transcript: runtime.lastTranscript,
    partialTranscript: runtime.lastPartialTranscript,
    transcriptSource: runtime.transcriptSource,
    providerStyle: runtime.providerStyle,
    liveEngine: runtime.liveEngine,
    liveInterimMode: runtime.liveInterimMode,
    liveVadStrategy: runtime.liveVadStrategy,
    providerTarget: runtime.providerTarget,
    providerModel: runtime.providerModel,
    providerLanguage: runtime.providerLanguage,
    providerEndpointing: runtime.providerEndpointing,
    vadState: runtime.lastVadState,
    analysisSummary: runtime.lastAnalysisSummary,
    speechDurationMs: runtime.lastSpeechDurationMs,
    captureDurationMs: runtime.lastCaptureDurationMs,
    audioProcessedMs: runtime.lastAudioProcessedMs,
    roundTripMs: runtime.lastRoundTripMs,
    lastProcessedAt: runtime.lastProcessedAt,
    lastEventAt: runtime.lastEventAt,
    lastBargeInAt: runtime.lastBargeInAt,
    lastError: runtime.lastError,
  });
}

function buildVoiceInputEvidenceLines(inputEvidence) {
  const evidence = normalizeInputEvidence(inputEvidence);
  if (!evidence) {
    return ['No recent spoken-input runtime evidence captured yet.'];
  }

  return [
    `Status: ${evidence.status || 'idle'}`,
    `Outcome: ${evidence.outcome || 'idle'}`,
    `Transcript: ${evidence.transcript || 'none'}`,
    `Partial transcript: ${evidence.partialTranscript || 'none'}`,
    `Transcript source: ${evidence.transcriptSource || 'none'}`,
    `Live engine: ${evidence.liveEngine || 'none'}`,
    `Provider style: ${evidence.providerStyle || 'none'}`,
    `Provider target: ${evidence.providerTarget || 'none'}`,
    `Provider model: ${evidence.providerModel || 'none'}`,
    `Provider language: ${evidence.providerLanguage || 'none'}`,
    `Provider endpointing: ${evidence.providerEndpointing || 'none'}`,
    `Interim mode: ${evidence.liveInterimMode || 'none'}`,
    `VAD strategy/state: ${evidence.liveVadStrategy || 'none'}${evidence.vadState ? ` / ${evidence.vadState}` : ''}`,
    `Analysis summary: ${evidence.analysisSummary || 'none'}`,
    `Speech duration: ${Number.isFinite(evidence.speechDurationMs) ? `${evidence.speechDurationMs} ms` : 'unknown'}`,
    `Capture duration: ${Number.isFinite(evidence.captureDurationMs) ? `${evidence.captureDurationMs} ms` : 'unknown'}`,
    `Audio processed: ${Number.isFinite(evidence.audioProcessedMs) ? `${evidence.audioProcessedMs} ms` : 'unknown'}`,
    `Round trip: ${Number.isFinite(evidence.roundTripMs) ? `${evidence.roundTripMs} ms` : 'unknown'}`,
    `Barge-in observed: ${evidence.lastBargeInAt ? 'yes' : 'no'}`,
    `Last input error: ${evidence.lastError || 'none'}`,
  ];
}

function normalizeMimicDirective(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const action = normalizeText(value.action);
  const normalizedAction = ['load', 'ready', 'mimic', 'repeat', 'hold'].includes(action) ? action : '';
  const targetKey = normalizeText(value.targetKey) || null;
  const statusLabel = normalizeText(value.statusLabel);
  const instruction = normalizeText(value.instruction);
  const rawSuggestedRepeats = value.suggestedRepeats;
  const suggestedRepeats = rawSuggestedRepeats === null || rawSuggestedRepeats === undefined
    || (typeof rawSuggestedRepeats === 'string' && normalizeText(rawSuggestedRepeats) === '')
    ? null
    : Number.isFinite(Number(rawSuggestedRepeats))
    ? Math.max(0, Math.round(Number(rawSuggestedRepeats)))
    : null;

  if (!normalizedAction && !targetKey && !statusLabel && !instruction && suggestedRepeats == null) {
    return null;
  }

  return {
    action: normalizedAction || 'ready',
    targetKey,
    statusLabel,
    instruction,
    suggestedRepeats,
  };
}

function normalizeMimicProgress(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const targetKey = normalizeText(value.targetKey) || null;
  const completedRepeats = Number.isFinite(Number(value.completedRepeats))
    ? Math.max(0, Math.round(Number(value.completedRepeats)))
    : 0;
  const targetRepeats = Number.isFinite(Number(value.targetRepeats))
    ? Math.max(0, Math.round(Number(value.targetRepeats)))
    : 0;
  const lastCompletedAt = toNumberOrNull(value.lastCompletedAt);

  if (!targetKey && completedRepeats <= 0 && targetRepeats <= 0 && lastCompletedAt == null) {
    return null;
  }

  return {
    targetKey,
    completedRepeats,
    targetRepeats,
    lastCompletedAt,
  };
}

function normalizeDeepTutorVoiceRuntimeDirective(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const directive = normalizeMimicDirective(value);
  const issuedAt = toNumberOrNull(value.issuedAt);
  if (!directive && issuedAt == null) {
    return null;
  }

  return {
    ...(directive || {
      action: 'ready',
      targetKey: null,
      statusLabel: '',
      instruction: '',
      suggestedRepeats: null,
    }),
    issuedAt,
  };
}

function applyRuntimeDirectiveToMimicDirective(mimicDirective, runtimeDirective) {
  const normalizedDirective = normalizeMimicDirective(mimicDirective);
  const normalizedRuntimeDirective = normalizeDeepTutorVoiceRuntimeDirective(runtimeDirective);
  if (!normalizedRuntimeDirective) {
    return normalizedDirective;
  }

  const currentTargetKey = normalizedDirective?.targetKey || null;
  if (
    normalizedRuntimeDirective.targetKey
    && currentTargetKey
    && normalizedRuntimeDirective.targetKey !== currentTargetKey
  ) {
    return normalizedDirective;
  }

  if (
    normalizedDirective?.action === 'load'
    && !currentTargetKey
    && normalizedRuntimeDirective.action !== 'load'
    && !normalizedRuntimeDirective.targetKey
  ) {
    return normalizedDirective;
  }

  return normalizeMimicDirective({
    ...normalizedDirective,
    ...normalizedRuntimeDirective,
    targetKey: normalizedRuntimeDirective.targetKey || currentTargetKey || null,
  });
}

function hasCompletedMimicRepeatSet(mimicDirective, mimicProgress) {
  const normalizedDirective = normalizeMimicDirective(mimicDirective);
  const normalizedProgress = normalizeMimicProgress(mimicProgress);
  if (!normalizedDirective || !normalizedProgress) {
    return false;
  }

  const directiveTargetKey = normalizedDirective.targetKey || null;
  const progressTargetKey = normalizedProgress.targetKey || null;
  if (!directiveTargetKey || !progressTargetKey || directiveTargetKey !== progressTargetKey) {
    return false;
  }

  const targetRepeats = Math.max(
    normalizedProgress.targetRepeats || 0,
    Number.isFinite(Number(normalizedDirective.suggestedRepeats))
      ? Math.max(0, Math.round(Number(normalizedDirective.suggestedRepeats)))
      : 0,
  );
  return targetRepeats > 0 && (normalizedProgress.completedRepeats || 0) >= targetRepeats;
}

function applyCompletedMimicProgressToDirective(mimicDirective, mimicProgress) {
  const normalizedDirective = normalizeMimicDirective(mimicDirective);
  if (!normalizedDirective) {
    return null;
  }

  if (
    !hasCompletedMimicRepeatSet(normalizedDirective, mimicProgress)
    || (normalizedDirective.action !== 'mimic' && normalizedDirective.action !== 'repeat')
  ) {
    return normalizedDirective;
  }

  return normalizeMimicDirective({
    ...normalizedDirective,
    action: 'hold',
    statusLabel: 'Set complete',
    instruction: 'Reference set complete. Return to the tutor conversation for the next coaching step.',
    suggestedRepeats: null,
  });
}

function buildDefaultDeepTutorVoiceState(overrides = {}) {
  return {
    enabled: false,
    status: 'idle',
    runtimeState: 'off',
    guideSessionId: null,
    guideSessionStatus: 'idle',
    memoryProject: DEFAULT_DEEPTUTOR_VOICE_MEMORY_PROJECT,
    backendModelId: DEFAULT_DEEPTUTOR_VOICE_BACKEND_MODEL || null,
    studentId: null,
    currentIndex: null,
    totalPoints: 0,
    knowledgePoints: [],
    currentKnowledge: null,
    lessonBoard: null,
    coachBrief: null,
    mimicProgress: null,
    runtimeDirective: null,
    practiceMode: 'active_drill',
    latestInputEvidence: null,
    lastTutorMessage: null,
    lastUserMessage: null,
    lastStartedAt: null,
    lastSyncedAt: null,
    lastError: null,
    ...overrides,
  };
}

function normalizeDeepTutorVoiceState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return buildDefaultDeepTutorVoiceState();
  }

  const normalized = buildDefaultDeepTutorVoiceState(value);
  normalized.enabled = Boolean(normalized.enabled);
  normalized.status = normalizeText(normalized.status) || 'idle';
  normalized.runtimeState = normalizeText(normalized.runtimeState) || 'off';
  normalized.guideSessionId = normalizeText(normalized.guideSessionId) || null;
  normalized.guideSessionStatus = normalizeText(normalized.guideSessionStatus) || normalized.status;
  normalized.memoryProject = normalizeText(normalized.memoryProject) || DEFAULT_DEEPTUTOR_VOICE_MEMORY_PROJECT;
  normalized.backendModelId = DEEPTUTOR_VOICE_GGUF_ENABLED
    ? normalizeText(normalized.backendModelId) || null
    : null;
  normalized.studentId = normalizeText(normalized.studentId) || null;
  normalized.currentIndex = Number.isFinite(Number(normalized.currentIndex))
    ? Math.max(0, Math.round(Number(normalized.currentIndex)))
    : null;
  normalized.totalPoints = Number.isFinite(Number(normalized.totalPoints))
    ? Math.max(0, Math.round(Number(normalized.totalPoints)))
    : 0;
  normalized.knowledgePoints = Array.isArray(normalized.knowledgePoints)
    ? normalized.knowledgePoints.map(normalizeKnowledgePoint).filter(Boolean).slice(0, 8)
    : [];
  normalized.currentKnowledge = normalizeKnowledgePoint(normalized.currentKnowledge);
  normalized.lessonBoard = normalized.lessonBoard ? normalizeLessonBoard(normalized.lessonBoard) : null;
  normalized.coachBrief = normalizeCoachBrief(normalized.coachBrief);
  normalized.mimicProgress = normalizeMimicProgress(normalized.mimicProgress);
  normalized.runtimeDirective = normalizeDeepTutorVoiceRuntimeDirective(normalized.runtimeDirective);
  normalized.practiceMode = normalizeVoiceTutorPracticeMode(
    value.practiceMode
      || value.practice_mode
      || normalized.lessonBoard?.practiceMode
      || normalized.coachBrief?.practiceMode
      || normalized.runtimeDirective?.practiceMode
      || normalized.practiceMode
      || 'active_drill',
  );
  normalized.latestInputEvidence = normalizeInputEvidence(normalized.latestInputEvidence);
  normalized.lastTutorMessage = normalizeText(normalized.lastTutorMessage) || null;
  normalized.lastUserMessage = normalizeText(normalized.lastUserMessage) || null;
  normalized.lastStartedAt = toNumberOrNull(normalized.lastStartedAt);
  normalized.lastSyncedAt = toNumberOrNull(normalized.lastSyncedAt);
  normalized.lastError = normalizeText(normalized.lastError) || null;
  return normalized;
}

function isDeepTutorVoiceGuideInProgress(deeptutorVoiceState) {
  const normalizedState = normalizeDeepTutorVoiceState(deeptutorVoiceState);
  if (!normalizedState.guideSessionId) {
    return false;
  }

  const status = normalizeText(normalizedState.guideSessionStatus || normalizedState.status).toLowerCase();
  return status !== 'completed' && status !== 'error';
}

function buildProgressLabel(currentIndex, totalPoints) {
  if (!Number.isFinite(currentIndex) || !Number.isFinite(totalPoints) || totalPoints <= 0) {
    return '';
  }
  return `${currentIndex + 1}/${totalPoints}`;
}

function buildDeepTutorVoiceMimicTargetKey({ session, voiceState, lessonBoard } = {}) {
  const referenceKey = normalizeText(voiceState?.referenceClipId || voiceState?.referenceClipName);
  if (!referenceKey) {
    return null;
  }

  const phrase = normalizeText(
    lessonBoard?.prompt
      || voiceState?.phraseComparison?.phrase
      || voiceState?.phraseForecast?.phrase
      || voiceState?.forecastPhrase
      || voiceState?.activeLine?.displayText,
  ).toLowerCase();

  return [
    normalizeText(session?.id) || 'voice-session',
    referenceKey,
    phrase || 'general',
  ].join('::');
}

function normalizeVoiceSelfReportSafetyScore(value) {
  if (value == null || value === '') {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.min(5, Math.max(1, Math.round(numeric)));
}

function resolveDeepTutorVoiceTakeKind(voiceState) {
  const repContext = voiceState?.lastAttemptArtifact?.repContext
    || voiceState?.lastAttemptArtifact?.summary?.repContext
    || voiceState?.repContext
    || null;
  return resolveTakeKind(repContext, voiceState?.practiceMode);
}

function collectDeepTutorVoiceAnalyzerSafetyReasons(voiceState) {
  const summary = voiceState?.lastSummary || voiceState?.lastAttemptArtifact?.summary || {};
  const advancedMetrics = summary?.metrics?.advanced || {};
  const reasons = [];

  if (isMeasurementUnusable(summary?.metrics || {})) {
    const rejectionReasons = uniqueStrings(
      advancedMetrics.measurementRejectionReasons,
      4,
    ).map((reason) => reason.replace(/_/g, ' '));
    reasons.push({
      label: `measurement unavailable${rejectionReasons.length > 0 ? ` (${rejectionReasons.join(', ')})` : ''}`,
      severity: 'reset',
      kind: 'capture',
    });
  }

  // DeepTutor/Fable must consume the same two-tier strain, vocalise leniency,
  // capture thresholds, and numeric-over-legacy-flag precedence as the live
  // coaching path. Keeping a private safety implementation here previously
  // made one ordinary take trigger a false lesson hold.
  const takeKind = resolveDeepTutorVoiceTakeKind(voiceState).kind;
  reasons.push(...collectAnalyzerSafetyReasons(voiceState, null, { takeKind }));

  const seen = new Set();
  return reasons.filter((reason) => {
    if (!reason?.label || seen.has(reason.label)) {
      return false;
    }
    seen.add(reason.label);
    return true;
  });
}

function getDeepTutorVoiceSelfReportSafetyState(voiceState) {
  const report = voiceState?.lastAttemptArtifact?.selfReport
    || voiceState?.lastAttemptArtifact?.self_report
    || null;
  const analyzerReasons = collectDeepTutorVoiceAnalyzerSafetyReasons(voiceState);
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    const active = analyzerReasons.length > 0;
    const severity = analyzerReasons.some((reason) => reason.severity === 'stop')
      ? 'stop'
      : active
        ? 'reset'
        : null;
    const captureOnly = active && analyzerReasons.every((reason) => reason.kind === 'capture');
    return {
      active,
      strain: null,
      fatigue: null,
      severity,
      summaryLine: 'Learner self-report: none',
      safetyFactorsLine: analyzerReasons.length > 0 ? `Safety factors: ${analyzerReasons.map((reason) => reason.label).join(' | ')}` : 'Safety factors: none',
      instruction: active
        ? severity === 'stop'
          ? 'Switch reference work to a very gentle hum or lip trill with no pushing.'
          : captureOnly
            ? 'Get one easy, clearly voiced capture before assessing the voice.'
            : 'Reduce reference-work effort and use one easy low-effort coordination.'
        : '',
    };
  }

  const strain = normalizeVoiceSelfReportSafetyScore(report.strain);
  const fatigue = normalizeVoiceSelfReportSafetyScore(report.fatigue);
  const reasons = [
    strain != null ? `strain ${strain}/5` : null,
    fatigue != null ? `fatigue ${fatigue}/5` : null,
  ].filter(Boolean);
  const active = (strain != null && strain >= 4) || (fatigue != null && fatigue >= 4);
  const analyzerActive = analyzerReasons.length > 0;
  const combinedActive = active || analyzerActive;
  const severity = !combinedActive
    ? null
    : (strain === 5 || fatigue === 5 || analyzerReasons.some((reason) => reason.severity === 'stop'))
      ? 'stop'
      : 'reset';
  const allReasons = [...reasons, ...analyzerReasons.map((reason) => reason.label)];
  const captureOnly = combinedActive && reasons.length === 0 && analyzerReasons.every((reason) => reason.kind === 'capture');
  return {
    active: combinedActive,
    strain,
    fatigue,
    severity,
    summaryLine: reasons.length > 0 ? `Learner self-report: ${reasons.join(' | ')}` : 'Learner self-report: no strain/fatigue rating',
    safetyFactorsLine: allReasons.length > 0 ? `Safety factors: ${allReasons.join(' | ')}` : 'Safety factors: none',
    instruction: severity === 'stop'
      ? 'Switch reference work to a very gentle hum or lip trill with no pushing.'
      : captureOnly
        ? 'Get one easy, clearly voiced capture before assessing the voice.'
      : 'Reduce reference-work effort and use one easy low-effort coordination.',
  };
}

function buildDeepTutorVoiceMimicDirective({ session, voiceState, currentKnowledge, lessonBoard } = {}) {
  const safetyState = getDeepTutorVoiceSelfReportSafetyState(voiceState);
  if (safetyState.active) {
    return normalizeMimicDirective({
      action: 'hold',
      targetKey: buildDeepTutorVoiceMimicTargetKey({ session, voiceState, lessonBoard }),
      statusLabel: safetyState.severity === 'stop' ? 'Safety stop' : 'Safety reset',
      instruction: `${safetyState.safetyFactorsLine || safetyState.summaryLine}. ${safetyState.instruction}`,
      suggestedRepeats: null,
    });
  }

  const hasReference = Boolean(normalizeText(voiceState?.referenceClipId || voiceState?.referenceClipName));
  if (!hasReference) {
    return normalizeMimicDirective({
      action: 'load',
      targetKey: null,
      statusLabel: 'No target',
      instruction: 'Load a mimic target to compare your live shape against the reference trail.',
      suggestedRepeats: null,
    });
  }

  const activeLine = voiceState?.activeLine || {};
  const cueSheet = activeLine?.cueSheet || {};
  const summaryMetrics = voiceState?.lastSummary?.metrics || {};
  const targetVoiceProfile = voiceState?.targetVoiceProfile || {};
  const advancedMetrics = summaryMetrics?.advanced || {};
  const advancedBands = targetVoiceProfile?.advancedBands || {};
  const phraseComparison = voiceState?.phraseComparison || {};
  const referenceMode = normalizeText(activeLine?.referenceMode);
  const directiveText = [
    currentKnowledge?.title,
    currentKnowledge?.summary,
    lessonBoard?.instruction,
    lessonBoard?.latestNote,
    activeLine?.intent,
    cueSheet?.phraseIntent,
    referenceMode,
    ...(Array.isArray(activeLine?.teachingFocus) ? activeLine.teachingFocus : []),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  const tutorWantsMimic = referenceMode === 'reference-informed'
    || /\b(reference|mimic|shadow|echo|copy|mirror|trail|match)\b/.test(directiveText);
  const pathMatch = toFiniteNumberOrNull(phraseComparison.pathMatchScore);
  const laneMatch = toFiniteNumberOrNull(phraseComparison.laneMatchScore);
  const contourMatch = toFiniteNumberOrNull(phraseComparison.contourMatchScore);
  const targetHitPct = toFiniteNumberOrNull(summaryMetrics.targetHitPct);
  const similarityScore = toFiniteNumberOrNull(summaryMetrics.similarityScore);
  const metricSimilarity = toFiniteNumberOrNull(advancedMetrics.metricSimilarity);
  const contourSimilarity = toFiniteNumberOrNull(advancedMetrics.contourSimilarity);
  const pitchFloor = toFiniteNumberOrNull(advancedMetrics.pitchP10Hz);
  const targetPitchFloor = toFiniteNumberOrNull(advancedBands.pitchP10HzFloor);
  const phraseEndDrop = toFiniteNumberOrNull(advancedMetrics.phraseEndDropHz);
  const phraseEndDropCeiling = toFiniteNumberOrNull(advancedBands.phraseEndDropHzCeiling);
  const stabilityMean = toFiniteNumberOrNull(advancedMetrics.stabilityMean);
  const hasSummary = Boolean(voiceState?.lastSummary);
  const targetKey = buildDeepTutorVoiceMimicTargetKey({ session, voiceState, lessonBoard });
  const takeKind = resolveDeepTutorVoiceTakeKind(voiceState).kind;
  const primaryGap = describePrimaryMimicGap(summaryMetrics, targetVoiceProfile, { takeKind });
  const severeMismatch = (
    (pathMatch != null && pathMatch < 0.48)
    || (targetHitPct != null && targetHitPct < 0.42)
    || (similarityScore != null && similarityScore < 0.52)
    || (metricSimilarity != null && metricSimilarity < 0.48)
    || (contourSimilarity != null && contourSimilarity < 0.44)
    || (pitchFloor != null && targetPitchFloor != null && pitchFloor < targetPitchFloor - 12)
    || (phraseEndDrop != null && ((phraseEndDropCeiling != null && phraseEndDrop > phraseEndDropCeiling + 4) || phraseEndDrop > 20))
    || (stabilityMean != null && stabilityMean < 0.46)
  );
  const mimicMismatch = (
    (pathMatch != null && pathMatch < 0.62)
    || (targetHitPct != null && targetHitPct < 0.5)
    || (similarityScore != null && similarityScore < 0.6)
    || (metricSimilarity != null && metricSimilarity < 0.58)
    || (contourSimilarity != null && contourSimilarity < 0.54)
    || (pitchFloor != null && targetPitchFloor != null && pitchFloor < targetPitchFloor - 6)
    || (phraseEndDrop != null && ((phraseEndDropCeiling != null && phraseEndDrop > phraseEndDropCeiling + 1) || phraseEndDrop > 16))
    || (stabilityMean != null && stabilityMean < 0.56)
  );
  const repeatMismatch = (
    (pathMatch != null && pathMatch < 0.78)
    || (laneMatch != null && laneMatch < 0.72)
    || (contourMatch != null && contourMatch < 0.7)
    || (targetHitPct != null && targetHitPct < 0.66)
    || (similarityScore != null && similarityScore < 0.72)
    || (metricSimilarity != null && metricSimilarity < 0.72)
    || (contourSimilarity != null && contourSimilarity < 0.7)
    || (phraseEndDrop != null && phraseEndDropCeiling != null && phraseEndDrop > phraseEndDropCeiling)
    || (stabilityMean != null && stabilityMean < 0.64)
  );
  const hasComparisonWitness = [
    pathMatch,
    laneMatch,
    contourMatch,
    targetHitPct,
    similarityScore,
    metricSimilarity,
    contourSimilarity,
  ].some((value) => value != null)
    || (pitchFloor != null && targetPitchFloor != null)
    || (phraseEndDrop != null && phraseEndDropCeiling != null);

  if (!hasSummary) {
    return normalizeMimicDirective({
      action: tutorWantsMimic ? 'mimic' : 'ready',
      targetKey,
      statusLabel: tutorWantsMimic ? 'Tutor says mimic' : 'Target ready',
      instruction: tutorWantsMimic
        ? 'Tutor is pointing you at the reference target first. Replay it and copy the trail before moving on.'
        : 'Reference target is ready. Stay in spoken coaching until the tutor asks for a mimic pass.',
      suggestedRepeats: tutorWantsMimic ? 2 : null,
    });
  }

  if (!hasComparisonWitness) {
    return normalizeMimicDirective({
      action: 'ready',
      targetKey,
      statusLabel: 'No comparison yet',
      instruction: 'Record one clearly voiced mimic pass before judging the reference match.',
      suggestedRepeats: null,
    });
  }

  if (severeMismatch || mimicMismatch) {
    const repeats = severeMismatch ? 3 : 2;
    return normalizeMimicDirective({
      action: 'mimic',
      targetKey,
      statusLabel: 'Mimic now',
      instruction: `Replay the target and copy the reference trail for ${repeats} pass${repeats === 1 ? '' : 'es'}; ${primaryGap} before asking the tutor to advance.`,
      suggestedRepeats: repeats,
    });
  }

  if (repeatMismatch) {
    return normalizeMimicDirective({
      action: 'repeat',
      targetKey,
      statusLabel: 'One more pass',
      instruction: `Do one more mimic pass to tighten the trail match and ${primaryGap}, then return to the tutor conversation.`,
      suggestedRepeats: 1,
    });
  }

  return normalizeMimicDirective({
    action: tutorWantsMimic ? 'hold' : 'ready',
    targetKey,
    statusLabel: tutorWantsMimic ? 'Target aligned' : 'Target ready',
    instruction: tutorWantsMimic
      ? 'Reference match is holding. Stay on tutor-led coaching unless the coach calls for another mimic pass.'
      : 'Reference target is ready. Stay in spoken coaching until the tutor asks for a mimic pass.',
    suggestedRepeats: null,
  });
}

function buildDeepTutorVoiceLessonBoard({ session, voiceState, guideSession, deeptutorVoiceState } = {}) {
  const normalizedState = normalizeDeepTutorVoiceState(deeptutorVoiceState);
  const knowledgePoints = Array.isArray(guideSession?.knowledge_points)
    ? guideSession.knowledge_points.map(normalizeKnowledgePoint).filter(Boolean)
    : normalizedState.knowledgePoints;
  const totalPoints = knowledgePoints.length || normalizedState.totalPoints || 0;
  const guideIndex = Number(guideSession?.current_index);
  const currentIndex = Number.isFinite(guideIndex)
    ? Math.max(0, Math.min(Math.round(guideIndex), Math.max(totalPoints - 1, 0)))
    : normalizedState.currentIndex;
  const currentKnowledge = normalizeKnowledgePoint(
    Number.isFinite(currentIndex) && knowledgePoints[currentIndex]
      ? knowledgePoints[currentIndex]
      : guideSession?.current_knowledge || normalizedState.currentKnowledge,
  );
  const activeLine = voiceState?.activeLine || {};
  const cueSheet = activeLine?.cueSheet || {};
  const focus = uniqueStrings(activeLine?.teachingFocus || cueSheet?.teachingFocus, 6);
  const prompt = normalizeText(activeLine?.displayText || voiceState?.phraseForecast?.phrase || voiceState?.forecastPhrase);
  const performanceText = normalizeText(activeLine?.performanceText || cueSheet?.styledCueLine || cueSheet?.cueLine);
  const instruction = normalizeText(currentKnowledge?.summary || normalizedState.lastTutorMessage);
  const difficultyNote = normalizeText(currentKnowledge?.difficulty);
  const lessonBoardBase = {
    title: normalizeText(currentKnowledge?.title || prompt || 'Voice coaching'),
    prompt,
    performanceText,
    focus,
    instruction,
    difficultyNote,
    progressLabel: buildProgressLabel(currentIndex, totalPoints),
    latestNote: normalizeText(normalizedState.lastTutorMessage),
  };
  const mimicDirective = applyRuntimeDirectiveToMimicDirective(
    buildDeepTutorVoiceMimicDirective({
      session,
      voiceState,
      currentKnowledge,
      lessonBoard: lessonBoardBase,
    }),
    normalizedState.runtimeDirective,
  );
  const completionAwareDirective = applyCompletedMimicProgressToDirective(
    mimicDirective,
    normalizedState.mimicProgress,
  );

  return normalizeLessonBoard({
    ...lessonBoardBase,
    mimicDirective: completionAwareDirective,
  });
}

function joinSentenceParts(parts) {
  return parts
    .map((part) => normalizeText(part))
    .filter(Boolean)
    .join(' ');
}

function ensureSentence(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return '';
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
}

function buildDeepTutorVoiceCoachBrief({ voiceState, deeptutorVoiceState, guideSession } = {}) {
  const normalizedState = normalizeDeepTutorVoiceState(deeptutorVoiceState);
  const lessonBoard = normalizedState.lessonBoard || buildDeepTutorVoiceLessonBoard({
    voiceState,
    guideSession,
    deeptutorVoiceState: normalizedState,
  });
  const activeLine = voiceState?.activeLine || {};
  const cueSheet = activeLine?.cueSheet || {};
  const summary = voiceState?.lastSummary || {};
  const summaryMetrics = summary?.metrics || {};
  const measurementRejected = isMeasurementUnusable(summaryMetrics);
  const targetVoiceProfile = voiceState?.targetVoiceProfile || {};
  const issues = !measurementRejected && Array.isArray(summary?.issues) ? summary.issues.filter(Boolean) : [];
  const nextDrills = !measurementRejected && Array.isArray(summary?.nextDrills) ? summary.nextDrills.filter(Boolean) : [];
  const phraseComparison = voiceState?.phraseComparison || {};
  const quickFeedback = !measurementRejected && Array.isArray(phraseComparison?.quickFeedback)
    ? phraseComparison.quickFeedback.filter(Boolean)
    : [];
  const takeKind = resolveDeepTutorVoiceTakeKind(voiceState).kind;
  const advancedFocus = buildAdvancedVoiceFocus(summaryMetrics, targetVoiceProfile, { takeKind });
  const correctionFocus = uniqueStrings([
    ...(Array.isArray(lessonBoard?.focus) ? lessonBoard.focus : []),
    ...(Array.isArray(activeLine?.teachingFocus) ? activeLine.teachingFocus : []),
    ...advancedFocus,
    ...issues,
    ...quickFeedback,
  ], 4);
  const displayText = normalizeText(activeLine?.displayText || lessonBoard?.prompt);
  const spokenText = displayText;
  const cueText = normalizeText(activeLine?.performanceText || cueSheet?.styledCueLine || cueSheet?.cueLine || lessonBoard?.performanceText);
  const listenFor = normalizeText(
    quickFeedback[0]
      || advancedFocus[0]
      || issues[0]
      || lessonBoard?.instruction
      || normalizedState.currentKnowledge?.summary
      || activeLine?.intent
      || cueSheet?.phraseIntent
  );
  const nextStep = normalizeText(
    lessonBoard?.mimicDirective?.instruction
      || lessonBoard?.latestNote
      || nextDrills[0]
      || lessonBoard?.instruction
      || normalizedState.lastTutorMessage
  );
  const immediateAction = lessonBoard?.mimicDirective && ['mimic', 'repeat'].includes(lessonBoard.mimicDirective.action)
    ? 'practice'
    : 'coach';
  const repeatResponse = joinSentenceParts([
    displayText ? `Again: say "${displayText}"` : '',
    cueText && cueText !== displayText ? `Cue it as "${cueText}"` : '',
    correctionFocus[0] ? `Focus on ${correctionFocus[0]}` : listenFor ? `Listen for ${listenFor}` : '',
  ]);
  const slowerResponse = joinSentenceParts([
    displayText ? `Slower pass: "${displayText}"` : '',
    cueText && cueText !== displayText ? `Shape it as "${cueText}"` : '',
    correctionFocus[0] ? `Stretch the phrase and keep ${correctionFocus[0]}` : listenFor ? `Stretch the phrase and listen for ${listenFor}` : '',
  ]);
  const whyResponse = joinSentenceParts([
    displayText ? `We are on "${displayText}"` : 'We are on this step',
    lessonBoard?.instruction ? `because ${ensureSentence(lessonBoard.instruction).replace(/[.!?]$/, '')}` : '',
    listenFor ? `Listen for ${listenFor}` : '',
    nextStep ? `Next: ${ensureSentence(nextStep).replace(/[.!?]$/, '')}` : '',
  ]);
  const holdResponse = joinSentenceParts([
    'Stay on this step',
    nextStep ? ensureSentence(nextStep).replace(/[.!?]$/, '') : correctionFocus[0] ? `and keep ${correctionFocus[0]}` : '',
  ]);

  return normalizeCoachBrief({
    displayText,
    spokenText,
    cueText,
    correctionFocus,
    listenFor,
    nextStep,
    immediateAction,
    quickActions: [
      'repeat',
      'repeat-slower',
      'why',
      ...(lessonBoard?.mimicDirective ? ['hold'] : []),
      'advance',
      immediateAction === 'practice' ? 'practice-ready' : 'practice-stop',
    ],
    repeatResponse,
    slowerResponse,
    whyResponse,
    holdResponse,
  });
}

function buildDeepTutorVoiceGuideRecords({ session, voiceState, studentModel, deeptutorVoiceState } = {}) {
  const normalizedState = normalizeDeepTutorVoiceState(deeptutorVoiceState);
  const activeLine = voiceState?.activeLine || {};
  const cueSheet = activeLine?.cueSheet || {};
  const summary = voiceState?.lastSummary || {};
  const metrics = summary?.metrics || {};
  const measurementRejected = isMeasurementUnusable(metrics);
  const targetVoiceProfile = voiceState?.targetVoiceProfile || {};
  const summaryTarget = summary?.target && typeof summary.target === 'object'
    ? summary.target
    : {};
  const targetPitchFloor = firstFiniteNumber(summaryTarget.pitchFloorHz, targetVoiceProfile.pitchFloorHz);
  const targetPitchCeiling = firstFiniteNumber(summaryTarget.pitchCeilingHz, targetVoiceProfile.pitchCeilingHz);
  const targetResonanceFloor = firstFiniteNumber(summaryTarget.resonanceFloor, targetVoiceProfile.resonanceFloor);
  const targetResonanceCeiling = firstFiniteNumber(summaryTarget.resonanceCeiling, targetVoiceProfile.resonanceCeiling);
  const targetWeightFloor = firstFiniteNumber(summaryTarget.weightFloor, targetVoiceProfile.weightFloor);
  const targetWeightCeiling = firstFiniteNumber(summaryTarget.weightCeiling, targetVoiceProfile.weightCeiling);
  const advancedBands = targetVoiceProfile?.advancedBands || {};
  const phraseComparison = voiceState?.phraseComparison || {};
  const timeline = summarizeTimeline(voiceState?.lastTakeTimeline);
  const thread = Array.isArray(voiceState?.coachThread) ? voiceState.coachThread.slice(-6) : [];
  const reviewQueue = Array.isArray(studentModel?.reviewQueue) ? studentModel.reviewQueue : [];
  const memoryContext = normalizeText(session?.memoryContext);
  const notepadContext = canReadDeepTutorVoiceGuideNotepad(session)
    ? extractDeepTutorNotepadContext(session?.notepad, {
      mainTask: session?.mainTask,
    })
    : '';
  const lessonBoard = normalizedState.lessonBoard || buildDeepTutorVoiceLessonBoard({
    session,
    voiceState,
    deeptutorVoiceState: normalizedState,
  });
  const mimicDirective = lessonBoard?.mimicDirective || null;
  const mimicProgress = normalizedState.mimicProgress || null;
  const runtimeDirective = normalizedState.runtimeDirective || null;
  const latestInputEvidence = normalizedState.latestInputEvidence || buildVoiceInputEvidence(voiceState);
  const repeatSetComplete = hasCompletedMimicRepeatSet(mimicDirective, mimicProgress);
  const compactAdvancedAnalyzerLines = buildCompactAdvancedAnalyzerLines(summary, targetVoiceProfile);

  const records = [
    {
      type: 'voice-policy',
      title: 'Runtime coaching policy',
      user_query: 'What hard policy should shape the live voice tutor response?',
      output: [
        ...buildVoiceTutorRuntimePolicyLines({
          targetPreset: voiceState?.targetPreset || 'cute-feminine',
          stylePrompt: voiceState?.targetVoiceProfile?.stylePrompt || '',
          practiceMode: voiceState?.practiceMode
            || normalizedState.practiceMode
            || lessonBoard?.practiceMode
            || runtimeDirective?.practiceMode
            || 'active_drill',
          includeHeader: false,
        }),
        ...buildVoiceTutorCapturePolicyLines({ includeHeader: false }),
      ].join('\n'),
    },
    {
      type: 'voice-goal',
      title: 'Voice target profile',
      user_query: 'What voice target and practice context is the student aiming for?',
      output: [
        `Session: ${normalizeText(session?.name) || 'Voice session'}`,
        `Target preset: ${normalizeText(voiceState?.targetPreset) || 'cute-feminine'}`,
        `Target source: ${normalizeText(summaryTarget.source || voiceState?.targetSource) || 'unknown'}`,
        `Target profile ID: ${normalizeText(summaryTarget.targetProfileId || targetVoiceProfile.profileId) || 'none'}`,
        // 2026-07-26 MTF-ONLY: canonicalize before this reaches the model. This
        // line is RAW STORED STATE going straight into a Fable prompt, so a
        // retired `direction: 'masculine'` session would otherwise still tell the
        // coach to aim masculinizing. canonicalizeDirection yields '' for a
        // retired value, which falls through to 'unknown' — the same fail-closed
        // "no direction claimed" state the renderer's omitted Direction line uses.
        `Target direction: ${canonicalizeDirection(summaryTarget.direction) || 'unknown'}`,
        `Target pitch band: ${targetPitchFloor != null && targetPitchCeiling != null ? `${targetPitchFloor.toFixed(1)}–${targetPitchCeiling.toFixed(1)} Hz` : 'unknown'}`,
        `Target resonance band: ${targetResonanceFloor != null && targetResonanceCeiling != null ? `${Math.round(targetResonanceFloor * 100)}–${Math.round(targetResonanceCeiling * 100)}%` : 'unknown'}`,
        `Target weight band: ${targetWeightFloor != null && targetWeightCeiling != null ? `${Math.round(targetWeightFloor * 100)}–${Math.round(targetWeightCeiling * 100)}%` : 'unknown'}`,
        `Reference clip: ${normalizeText(voiceState?.referenceClipName) || 'none'}`,
        `Memory project: ${normalizeText(normalizedState.memoryProject) || DEFAULT_DEEPTUTOR_VOICE_MEMORY_PROJECT}`,
        `Student voice profile ID: ${normalizeText(studentModel?.studentId || normalizedState.studentId) || 'none'}`,
        `Session summary: ${normalizeText(session?.summary) || 'none'}`,
      ].join('\n'),
    },
    {
      type: 'voice-phrase',
      title: 'Active phrase and pronunciation',
      user_query: 'What phrase should the student say, and what sound-accuracy cues matter most?',
      output: [
        `Prompt phrase: ${normalizeText(activeLine?.displayText || voiceState?.phraseForecast?.phrase || voiceState?.forecastPhrase) || 'none'}`,
        `Performance spelling: ${normalizeText(activeLine?.performanceText || cueSheet?.styledCueLine || cueSheet?.cueLine) || 'none'}`,
        `Phrase intent: ${normalizeText(activeLine?.intent || cueSheet?.phraseIntent) || 'none'}`,
        `Teaching focus: ${uniqueStrings(activeLine?.teachingFocus || cueSheet?.teachingFocus, 6).join(' | ') || 'none'}`,
        `Forecast summary: ${normalizeText(voiceState?.phraseForecast?.summary) || 'none'}`,
      ].join('\n'),
    },
    {
      type: 'voice-analysis',
      title: 'Recent analyzer evidence',
      user_query: 'What did the latest voice analysis show about the student performance?',
      output: [
        `Duration: ${Number.isFinite(summary?.durationMs) ? `${(summary.durationMs / 1000).toFixed(1)}s` : 'unknown'}`,
        `Mean pitch: ${!measurementRejected && Number.isFinite(metrics.meanPitchHz) ? `${Math.round(metrics.meanPitchHz)} Hz` : measurementRejected ? 'unavailable' : 'unknown'}`,
        `Pitch range: ${!measurementRejected && Number.isFinite(metrics.pitchRangeSt) ? `${metrics.pitchRangeSt.toFixed(1)} st` : measurementRejected ? 'unavailable' : 'unknown'}`,
        `Target hit: ${measurementRejected ? 'unavailable' : formatPercent(metrics.targetHitPct)}`,
        `Resonance: ${measurementRejected ? 'unavailable' : formatPercent(metrics.resonanceMean)}`,
        `Weight: ${measurementRejected ? 'unavailable' : formatPercent(metrics.weightMean)}`,
        `Similarity: ${measurementRejected ? 'unavailable' : formatPercent(metrics.similarityScore)}`,
        ...compactAdvancedAnalyzerLines,
        `Detected issues: ${measurementRejected ? 'suppressed because the take was not measurable' : Array.isArray(summary?.issues) && summary.issues.length > 0 ? summary.issues.join(' | ') : 'none'}`,
        `Suggested drills: ${measurementRejected ? 'measure again before choosing a drill' : Array.isArray(summary?.nextDrills) && summary.nextDrills.length > 0 ? summary.nextDrills.join(' | ') : 'none'}`,
        `Phrase path match: ${measurementRejected ? 'unavailable' : formatPercent(phraseComparison.pathMatchScore)}`,
      ].join('\n'),
    },
    {
      type: 'voice-live-map',
      title: 'Live XY graph evidence',
      user_query: 'How did the live XY voice graph behave during the latest take?',
      output: measurementRejected
        ? [
          'Graph evidence: unavailable because the acoustic measurement was rejected.',
          `Rejection reasons: ${uniqueStrings(metrics?.advanced?.measurementRejectionReasons, 8).join(' | ') || 'measurement unavailable'}`,
        ].join('\n')
        : [
          `Graph frames: ${timeline.sampleCount || 0}`,
          `Voiced coverage: ${Number.isFinite(timeline.voicedPct) ? `${timeline.voicedPct}%` : 'unknown'}`,
          `Confident voiced coverage: ${Number.isFinite(timeline.confidentPct) ? `${timeline.confidentPct}%` : 'unknown'}`,
          `Mean confidence: ${Number.isFinite(timeline.meanConfidence) ? `${timeline.meanConfidence}%` : 'unknown'}`,
          `Pitch start/end: ${timeline.startPitch != null && timeline.endPitch != null ? `${timeline.startPitch} Hz -> ${timeline.endPitch} Hz` : 'unknown'}`,
          `Pitch floor/peak: ${timeline.floorPitch != null && timeline.peakPitch != null ? `${timeline.floorPitch} Hz -> ${timeline.peakPitch} Hz` : 'unknown'}`,
          `Trajectory: ${timeline.graphTrajectory}`,
        ].join('\n'),
    },
    {
      type: 'voice-input',
      title: 'Latest spoken input runtime',
      user_query: 'What happened on the latest spoken backend input turn, including transcript, VAD, and live runtime evidence?',
      output: buildVoiceInputEvidenceLines(latestInputEvidence).join('\n'),
    },
    {
      type: 'voice-mimic',
      title: 'Reference mimic workflow',
      user_query: 'What reference-mimic state should currently shape the lesson flow?',
      output: [
        `Directive action: ${normalizeText(mimicDirective?.action) || 'none'}`,
        `Directive status: ${normalizeText(mimicDirective?.statusLabel) || 'none'}`,
        `Directive instruction: ${normalizeText(mimicDirective?.instruction) || 'none'}`,
        `Directive repeats: ${Number.isFinite(Number(mimicDirective?.suggestedRepeats)) ? Math.max(0, Math.round(Number(mimicDirective.suggestedRepeats))) : 0}`,
        `Directive target key: ${normalizeText(mimicDirective?.targetKey) || 'none'}`,
        `Target pitch floor: ${Number.isFinite(advancedBands.pitchP10HzFloor) ? `${Math.round(advancedBands.pitchP10HzFloor)} Hz` : 'unknown'}`,
        `Target ending ceiling: ${Number.isFinite(advancedBands.phraseEndDropHzCeiling) ? `${advancedBands.phraseEndDropHzCeiling.toFixed(1)} Hz` : 'unknown'}`,
        `Completed repeats: ${Number.isFinite(Number(mimicProgress?.completedRepeats)) ? Math.max(0, Math.round(Number(mimicProgress.completedRepeats))) : 0}`,
        `Target repeats: ${Number.isFinite(Number(mimicProgress?.targetRepeats)) ? Math.max(0, Math.round(Number(mimicProgress.targetRepeats))) : 0}`,
        `Repeat completion: ${mimicProgress?.targetRepeats ? `${Math.min(mimicProgress.completedRepeats || 0, mimicProgress.targetRepeats)}/${mimicProgress.targetRepeats}` : 'none'}`,
        `Repeat set complete: ${repeatSetComplete ? 'yes' : 'no'}`,
        `Tutor override action: ${normalizeText(runtimeDirective?.action) || 'none'}`,
        `Tutor override instruction: ${normalizeText(runtimeDirective?.instruction) || 'none'}`,
      ].join('\n'),
    },
    {
      type: 'voice-progression',
      title: 'Student progression profile',
      user_query: 'What recurring strengths, weaknesses, or review priorities should shape the lesson?',
      output: [
        `Mastery level: ${normalizeText(studentModel?.masteryLevel) || 'beginner'}`,
        `Concepts practiced: ${Number.isFinite(Number(studentModel?.conceptsPracticed)) ? Math.round(Number(studentModel.conceptsPracticed)) : 0}`,
        `Review queue: ${reviewQueue.length > 0 ? reviewQueue.map((item) => `${item.name} (${Math.round((item.urgency || 0) * 100)}%)`).join(' | ') : 'none'}`,
        `Struggles: ${Array.isArray(studentModel?.struggles) && studentModel.struggles.length > 0 ? studentModel.struggles.join(' | ') : 'none'}`,
        `Preferred style: ${normalizeText(studentModel?.preferredStyle) || 'unknown'}`,
        `Learning pace: ${normalizeText(studentModel?.learningPace) || 'unknown'}`,
      ].join('\n'),
    },
    {
      type: 'voice-thread',
      title: 'Recent coaching thread',
      user_query: 'What has already been said in the current coaching thread?',
      output: thread.length > 0
        ? thread.map((entry) => `${entry.role === 'user' ? 'Student' : 'Coach'}: ${normalizeText(entry.content)}`).join('\n')
        : 'No prior coaching thread yet.',
    },
    {
      type: 'voice-memory',
      title: 'Long-term voice memory',
      user_query: 'What durable voice goals, recurring issues, and prior progress should shape this lesson?',
      output: memoryContext || 'No stored DeepTutor voice memory retrieved yet.',
    },
    {
      type: 'voice-notepad',
      title: 'Current voice notepad handoff',
      user_query: 'What active task state has the SLOANE notepad preserved for the current voice lesson?',
      output: notepadContext || 'No current voice notepad handoff has been written yet.',
    },
  ];

  return records.filter((record) => normalizeText(record.output));
}

function buildDeepTutorVoiceRuntimePayload({ session, voiceState, studentModel, deeptutorVoiceState, guideSession } = {}) {
  const baseState = normalizeDeepTutorVoiceState(deeptutorVoiceState);
  const knowledgePoints = Array.isArray(guideSession?.knowledge_points)
    ? guideSession.knowledge_points.map(normalizeKnowledgePoint).filter(Boolean)
    : baseState.knowledgePoints;
  const totalPoints = knowledgePoints.length || baseState.totalPoints || 0;
  const guideIndex = Number(guideSession?.current_index);
  const currentIndex = Number.isFinite(guideIndex)
    ? Math.max(0, Math.min(Math.round(guideIndex), Math.max(totalPoints - 1, 0)))
    : baseState.currentIndex;
  const currentKnowledge = normalizeKnowledgePoint(
    Number.isFinite(currentIndex) && knowledgePoints[currentIndex]
      ? knowledgePoints[currentIndex]
      : guideSession?.current_knowledge || baseState.currentKnowledge,
  );

  const nextState = normalizeDeepTutorVoiceState({
    ...baseState,
    guideSessionId: normalizeText(guideSession?.session_id) || baseState.guideSessionId,
    guideSessionStatus: normalizeText(guideSession?.status) || baseState.guideSessionStatus,
    status: normalizeText(guideSession?.status) || baseState.status,
    currentIndex,
    totalPoints,
    knowledgePoints,
    currentKnowledge,
  });

  const lessonBoard = buildDeepTutorVoiceLessonBoard({
    session,
    voiceState,
    guideSession,
    deeptutorVoiceState: nextState,
  });
  const coachBrief = buildDeepTutorVoiceCoachBrief({
    voiceState,
    deeptutorVoiceState: {
      ...nextState,
      lessonBoard,
    },
    guideSession,
  });
  const latestInputEvidence = buildVoiceInputEvidence(voiceState) || baseState.latestInputEvidence || null;

  return createVoiceBackendPayload({
    voiceState: voiceState || null,
    studentModel: studentModel || null,
    deeptutorVoiceState: {
      ...nextState,
      lessonBoard,
      coachBrief,
      latestInputEvidence,
    },
  }, {
    sessionId: session?.id || null,
    agentId: session?.agentId || null,
    summary: session?.summary || null,
  });
}

module.exports = {
  DEFAULT_DEEPTUTOR_VOICE_MEMORY_PROJECT,
  DEFAULT_DEEPTUTOR_VOICE_BACKEND_MODEL,
  DEEPTUTOR_VOICE_GGUF_ENABLED,
  applyCompletedMimicProgressToDirective,
  applyRuntimeDirectiveToMimicDirective,
  buildDefaultDeepTutorVoiceState,
  buildDeepTutorVoiceGuideRecords,
  buildDeepTutorVoiceCoachBrief,
  buildDeepTutorVoiceLessonBoard,
  buildDeepTutorVoiceRuntimePayload,
  hasCompletedMimicRepeatSet,
  isDeepTutorVoiceGuideInProgress,
  normalizeCoachBrief,
  normalizeDeepTutorVoiceRuntimeDirective,
  normalizeDeepTutorVoiceState,
};
