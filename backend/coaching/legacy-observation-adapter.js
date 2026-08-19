'use strict';

const {
  resolveMetricContract,
  resolveTakeEvidenceFreshness,
  resolveTakeKind,
  withTakeEvidenceAbsent,
} = require('./signal-builder');
const { resolveVoiceMeasurementUsability } = require('../voice-measurement-validity');

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function fraction(value) {
  const number = finiteOrNull(value);
  if (number == null) return null;
  return Math.abs(number) > 1 ? number / 100 : number;
}
function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || '').trim())
    .filter(Boolean))];
}
function isReferenceSource(source) {
  return source === 'reference' || source === 'custom-reference';
}
function referenceTargetConfidence(voiceState = {}) {
  const verdict = String(voiceState.referenceAnalysis?.quality?.verdict || '').trim().toLowerCase();
  if (verdict === 'good') return 0.9;
  if (verdict === 'usable') return 0.7;
  if (verdict === 'reject') return 0;
  return 0.6;
}
function cappedConfidence(confidence, extractorCap, segmentation = null) {
  return {
    ...confidence,
    extractor: Math.min(confidence.extractor ?? 1, extractorCap),
    ...(segmentation == null ? {} : { segmentation }),
  };
}
function commonConfidence(usability, targetConfidence) {
  return {
    overall: fraction(usability.scoreConfidence),
    signal: fraction(usability.captureReliability),
    extractor: fraction(usability.confidentFramePct),
    target: targetConfidence,
  };
}
function buildCanonicalMetricContext(voiceState = {}, {
  turnWindowStartedAt = undefined,
  repContext = null,
  practiceMode = 'active_drill',
} = {}) {
  const freshness = resolveTakeEvidenceFreshness(voiceState, { turnWindowStartedAt });
  const gatedVoiceState = freshness.fresh ? voiceState : withTakeEvidenceAbsent(voiceState);
  const contract = resolveMetricContract(gatedVoiceState);
  const summary = contract.summary || {};
  const advanced = contract.advanced || {};
  const usability = resolveVoiceMeasurementUsability(summary);
  const resolvedRepContext = repContext
    || gatedVoiceState.lastAttemptArtifact?.repContext
    || gatedVoiceState.repContext
    || null;
  const takeKind = resolveTakeKind(resolvedRepContext, practiceMode);
  const attemptArtifactId = gatedVoiceState.lastAttemptArtifact?.attemptArtifactId || null;
  const taskId = resolvedRepContext?.promptId
    || resolvedRepContext?.drillId
    || resolvedRepContext?.activeLine?.id
    || gatedVoiceState.activeLine?.id
    || null;
  return {
    voiceState: gatedVoiceState,
    freshness,
    contract,
    summary,
    advanced,
    usability,
    repContext: resolvedRepContext,
    takeKind: takeKind?.kind || null,
    takeKindSource: takeKind?.source || null,
    attemptArtifactId,
    taskId,
    analysisProfile: advanced.analysisProfile || null,
  };
}
function canonicalInvalidationFlags(context) {
  const flags = [...(context.usability.reasons || [])];
  if (!context.freshness.fresh) flags.push('stale_take');
  if (context.contract.measurementAvailable === false) flags.push('measurement_unavailable');
  if (!context.contract.hasTargetContract
    || context.contract.targetValidationFailures?.length
    || context.contract.targetIdentityFailures?.length) {
    flags.push('target_not_comparable');
  }
  const reliabilityEvidence = [
    context.usability.scoreConfidence,
    context.usability.captureReliability,
    context.usability.confidentFramePct,
  ].some((value) => finiteOrNull(value) != null);
  if (!reliabilityEvidence) flags.push('missing_measurement_confidence');
  return uniqueStrings(flags);
}
function timbreComparable(context) {
  const source = context.contract.target.source;
  if (!isReferenceSource(source)) return true;
  const takeVersion = typeof context.summary.analysisVersion === 'string'
    ? context.summary.analysisVersion.trim()
    : '';
  const targetVersion = typeof context.contract.target.analysisVersion === 'string'
    ? context.contract.target.analysisVersion.trim()
    : '';
  return Boolean(takeVersion && targetVersion && takeVersion === targetVersion);
}
function provenance(context, contextKind = null) {
  return {
    attemptArtifactId: context.attemptArtifactId,
    taskId: context.taskId,
    takeKind: context.takeKind,
    analysisProfile: context.analysisProfile,
    contextKind,
    metricDefinitionVersion: context.summary.analysisVersion || 'unknown',
  };
}
function targetRegion(context, targetConfidence, values = {}) {
  return {
    ...values,
    source: context.contract.target.source,
    targetKey: context.contract.target.targetKey,
    analysisVersion: context.contract.target.analysisVersion,
    confidence: targetConfidence,
  };
}
function pushOneSided(observations, context, {
  metricId,
  dimension,
  value,
  low = null,
  high = null,
  scale,
  unit = 'unitless',
  confidence,
  flags,
  targetConfidence,
  persistenceByDimension,
  importance,
  controllability,
  contextKind = null,
  metadata = {},
}) {
  if (finiteOrNull(value) == null) return;
  if (finiteOrNull(low) == null && finiteOrNull(high) == null) return;
  observations.push({
    metricId,
    dimension,
    value: Number(value),
    unit,
    confidence,
    target: targetRegion(context, targetConfidence, {
      low: finiteOrNull(low),
      high: finiteOrNull(high),
      scale,
    }),
    flags,
    persistenceCount: persistenceByDimension[dimension] || 1,
    importance,
    controllability,
    ...provenance(context, contextKind),
    metadata,
  });
}

function legacyObservationsFromVoiceState(voiceState = {}, {
  persistenceByDimension = {},
  targetConfidence = null,
  turnWindowStartedAt = undefined,
  repContext = null,
  practiceMode = 'active_drill',
  contextComparability = {},
  returnContext = false,
} = {}) {
  const context = buildCanonicalMetricContext(voiceState, {
    turnWindowStartedAt,
    repContext,
    practiceMode,
  });
  const { contract, summary, advanced } = context;
  const target = contract.target || {};
  const source = target.source;
  const reference = isReferenceSource(source);
  const resolvedTargetConfidence = targetConfidence == null
    ? (reference ? referenceTargetConfidence(voiceState) : 0.85)
    : targetConfidence;
  const confidence = commonConfidence(context.usability, resolvedTargetConfidence);
  const pitchDetectorEvidence = {
    detectorFamily: 'yin',
    pitchValidFrameCount: finiteOrNull(advanced.pitchValidFrameCount),
    voicedFramePct: finiteOrNull(advanced.voicedFramePct),
    confidentFramePct: finiteOrNull(advanced.confidentFramePct),
    scoreConfidence: finiteOrNull(advanced.scoreConfidence),
    captureReliability: finiteOrNull(advanced.captureReliability),
    hitPitchCeiling: advanced.hitPitchCeiling === true,
  };
  const rawFormantEvidence = advanced.formantLite && typeof advanced.formantLite === 'object'
    ? advanced.formantLite
    : {};
  const formantEvidence = {
    analysisWindowCount: finiteOrNull(rawFormantEvidence.analysisWindowCount),
    validWindowCount: finiteOrNull(rawFormantEvidence.validWindowCount),
    validWindowPct: finiteOrNull(rawFormantEvidence.validWindowPct),
    f2IqrHz: finiteOrNull(rawFormantEvidence.f2IqrHz),
    f2MadHz: finiteOrNull(rawFormantEvidence.f2MadHz),
    medianWindowPitchHz: finiteOrNull(rawFormantEvidence.medianWindowPitchHz),
    maxWindowPitchHz: finiteOrNull(rawFormantEvidence.maxWindowPitchHz),
    validationStatus: typeof rawFormantEvidence.validationStatus === 'string'
      ? rawFormantEvidence.validationStatus.trim() || null
      : null,
    validationId: typeof rawFormantEvidence.validationId === 'string'
      ? rawFormantEvidence.validationId.trim() || null
      : null,
    authorityEligible: rawFormantEvidence.authorityEligible === true,
  };
  const baseFlags = canonicalInvalidationFlags(context);
  const takeAnalysisVersion = summary.analysisVersion || null;
  const targetAnalysisVersion = target.analysisVersion || null;
  const calibrationComparable = timbreComparable(context);
  const timbreFlags = calibrationComparable
    ? baseFlags
    : uniqueStrings([...baseFlags, 'analysis_version_mismatch']);
  const formantContextComparable = contextComparability.formants === true
    && contextComparability.verified === true;
  const formantContextKind = formantContextComparable
    ? 'controlled_probe_formant'
    : 'clip_wide_formant';
  const formantContextMetadata = formantContextComparable
    ? {
      controlledProbeId: contextComparability.probeId || null,
      comparisonContextKey: contextComparability.comparisonContextKey || null,
      targetEvidenceKind: contextComparability.targetEvidenceKind || null,
      contextComparabilitySource: contextComparability.source || null,
    }
    : {};
  const formantFlags = uniqueStrings([
    ...timbreFlags,
    ...(context.analysisProfile === 'no_formants' ? ['analysis_profile_no_formants'] : []),
    ...(formantContextComparable ? [] : ['context_not_comparable']),
  ]);
  const observations = [];

  // Stale evidence is represented in canonicalContext, not converted into
  // measurements. This ensures v3 follows the same stale-take law as buildSignal.
  if (!context.freshness.fresh) {
    return returnContext ? { observations, canonicalContext: context } : observations;
  }

  const pitch = finiteOrNull(advanced.medianPitchHz) ?? finiteOrNull(contract.values.meanPitchHz);
  if (pitch != null && target.pitchFloorHz != null && target.pitchCeilingHz != null) {
    observations.push({
      metricId: 'pitch.median_hz',
      dimension: 'pitch.register',
      value: pitch,
      unit: 'Hz',
      confidence,
      target: targetRegion(context, resolvedTargetConfidence, {
        low: target.pitchFloorHz,
        high: target.pitchCeilingHz,
        scale: 1,
      }),
      flags: baseFlags,
      persistenceCount: persistenceByDimension['pitch.register'] || 1,
      importance: 0.65,
      controllability: 0.8,
      ...provenance(context, 'utterance'),
      metadata: {
        targetScaleUnit: 'semitone',
        legacyAdapter: true,
        ...pitchDetectorEvidence,
        takeAnalysisVersion,
        targetAnalysisVersion,
      },
    });
  }

  const resonance = finiteOrNull(contract.values.resonanceMean);
  if (resonance != null && target.resonanceFloor != null && target.resonanceCeiling != null) {
    observations.push({
      metricId: 'legacy.resonance_mean',
      dimension: 'resonance.legacy_proxy',
      value: resonance,
      unit: 'score_0_1',
      confidence: cappedConfidence(confidence, 0.72),
      target: targetRegion(context, resolvedTargetConfidence, {
        low: target.resonanceFloor,
        high: target.resonanceCeiling,
        scale: 0.14,
      }),
      flags: timbreFlags,
      persistenceCount: persistenceByDimension['resonance.legacy_proxy'] || 1,
      importance: 0.45,
      controllability: 0.55,
      ...provenance(context, 'utterance'),
      metadata: {
        legacyAdapter: true,
        proxy: true,
        calibrationComparable,
        interpretation: 'acoustic resonance proxy; not anatomical position',
      },
    });
  }

  const weight = finiteOrNull(contract.values.weightMean);
  if (weight != null && target.weightFloor != null && target.weightCeiling != null) {
    observations.push({
      metricId: 'legacy.weight_mean',
      dimension: 'phonation.legacy_weight_proxy',
      value: weight,
      unit: 'score_0_1',
      confidence: cappedConfidence(confidence, 0.68),
      target: targetRegion(context, resolvedTargetConfidence, {
        low: target.weightFloor,
        high: target.weightCeiling,
        scale: 0.14,
      }),
      flags: timbreFlags,
      persistenceCount: persistenceByDimension['phonation.legacy_weight_proxy'] || 1,
      importance: 0.45,
      controllability: 0.55,
      ...provenance(context, 'utterance'),
      metadata: {
        legacyAdapter: true,
        proxy: true,
        calibrationComparable,
        interpretation: 'source-weight proxy; not a direct fold-configuration measurement',
      },
    });
  }

  const rawTarget = summary.target || voiceState.lastAttemptArtifact?.target || {};
  const f2 = finiteOrNull(advanced.formantLite?.f2MedianHz);
  const referenceF2 = finiteOrNull(rawTarget.referenceF2MedianHz)
    ?? finiteOrNull(context.voiceState.targetVoiceProfile?.metrics?.advanced?.formantLite?.f2MedianHz);
  if (f2 != null && referenceF2 != null && referenceF2 > 0) {
    const width = Math.max(80, referenceF2 * 0.08);
    observations.push({
      metricId: 'formant_lite.f2_median_hz',
      dimension: 'resonance.global_scale',
      value: f2,
      unit: 'Hz',
      confidence: cappedConfidence(confidence, 0.7, 0.62),
      target: targetRegion(context, Math.min(resolvedTargetConfidence, 0.75), {
        low: referenceF2 - width,
        high: referenceF2 + width,
        scale: width,
        referenceId: context.voiceState.referenceClipId || null,
      }),
      flags: formantFlags,
      persistenceCount: persistenceByDimension['resonance.global_scale'] || 1,
      importance: 0.62,
      controllability: 0.7,
      ...provenance(context, formantContextKind),
      metadata: {
        legacyAdapter: true,
        clipWide: true,
        needsVowelConditioning: true,
        calibrationComparable,
        contextComparable: formantContextComparable,
        detectorFamily: 'lpc_formant_lite_v4',
        formantEvidence,
        ...formantContextMetadata,
        interpretation: 'clip-wide F2 median; exploratory only unless speech context is comparable',
      },
    });
  }

  const advancedBands = context.voiceState.targetVoiceProfile?.advancedBands || null;
  if (advancedBands) {
    const pitchMeta = {
      targetScaleUnit: 'semitone',
      referenceDerivedBand: true,
      ...pitchDetectorEvidence,
      takeAnalysisVersion,
      targetAnalysisVersion,
    };
    pushOneSided(observations, context, {
      metricId: 'pitch.p10_hz', dimension: 'pitch.lower_edge', value: advanced.pitchP10Hz,
      low: advancedBands.pitchP10HzFloor, scale: 1, unit: 'Hz',
      confidence: cappedConfidence(confidence, 0.82), flags: baseFlags,
      targetConfidence: resolvedTargetConfidence, persistenceByDimension,
      importance: 0.55, controllability: 0.6, contextKind: 'utterance', metadata: pitchMeta,
    });
    pushOneSided(observations, context, {
      metricId: 'pitch.p90_hz', dimension: 'pitch.upper_edge', value: advanced.pitchP90Hz,
      high: advancedBands.pitchP90HzCeiling, scale: 1, unit: 'Hz',
      confidence: cappedConfidence(confidence, 0.82), flags: baseFlags,
      targetConfidence: resolvedTargetConfidence, persistenceByDimension,
      importance: 0.4, controllability: 0.55, contextKind: 'utterance', metadata: pitchMeta,
    });

    const connectedSpeech = ['phrase', 'spontaneous'].includes(context.takeKind);
    if (connectedSpeech) {
      pushOneSided(observations, context, {
        metricId: 'pitch.std_st', dimension: 'prosody.pitch_variability', value: advanced.pitchStdSt,
        high: advancedBands.pitchStdStCeiling, scale: 0.4, unit: 'semitone_std',
        confidence: cappedConfidence(confidence, 0.78), flags: baseFlags,
        targetConfidence: resolvedTargetConfidence, persistenceByDimension,
        importance: 0.45, controllability: 0.55, contextKind: 'connected_speech',
        metadata: { referenceDerivedBand: true, ...pitchDetectorEvidence, takeAnalysisVersion, targetAnalysisVersion },
      });
      pushOneSided(observations, context, {
        metricId: 'phrase.end_drop_hz', dimension: 'prosody.phrase_ending', value: advanced.phraseEndDropHz,
        high: advancedBands.phraseEndDropHzCeiling, scale: 6, unit: 'Hz',
        confidence: cappedConfidence(confidence, 0.8), flags: baseFlags,
        targetConfidence: resolvedTargetConfidence, persistenceByDimension,
        importance: 0.67, controllability: 0.72, contextKind: 'connected_speech',
        metadata: { referenceDerivedBand: true, phraseLevel: true, ...pitchDetectorEvidence, takeAnalysisVersion, targetAnalysisVersion },
      });
    }

    const formantBands = advancedBands.formantLite || {};
    pushOneSided(observations, context, {
      metricId: 'formant_lite.frontness_score', dimension: 'resonance.frontness_proxy',
      value: advanced.formantLite?.frontnessScore, low: formantBands.frontnessFloor, scale: 0.08,
      unit: 'score_0_1', confidence: cappedConfidence(confidence, 0.68, 0.62),
      flags: formantFlags, targetConfidence: resolvedTargetConfidence, persistenceByDimension,
      importance: 0.64, controllability: 0.68, contextKind: formantContextKind,
      metadata: {
        referenceDerivedBand: true,
        proxy: true,
        clipWide: true,
        needsVowelConditioning: true,
        calibrationComparable,
        contextComparable: formantContextComparable,
        detectorFamily: 'lpc_formant_lite_v4',
        formantEvidence,
        ...formantContextMetadata,
        interpretation: 'clip-wide formant frontness proxy; not a tongue-position measurement',
      },
    });

    const qualityBands = advancedBands.quality || {};
    const qualityFlags = context.takeKind === 'trill'
      ? uniqueStrings([...timbreFlags, 'context_not_comparable'])
      : timbreFlags;
    pushOneSided(observations, context, {
      metricId: 'quality.breathy_risk', dimension: 'phonation.breathiness',
      value: advanced.quality?.breathyRisk, high: qualityBands.breathyRiskCeiling, scale: 0.1,
      unit: 'risk_0_1', confidence: cappedConfidence(confidence, 0.65),
      flags: qualityFlags, targetConfidence: resolvedTargetConfidence, persistenceByDimension,
      importance: 0.68, controllability: 0.65, contextKind: 'voice_quality',
      metadata: { referenceDerivedBand: true, proxy: true, calibrationComparable },
    });
    pushOneSided(observations, context, {
      metricId: 'quality.strain_risk', dimension: 'phonation.pressedness',
      value: advanced.quality?.strainRisk, high: qualityBands.strainRiskCeiling, scale: 0.1,
      unit: 'risk_0_1', confidence: cappedConfidence(confidence, 0.65),
      flags: qualityFlags, targetConfidence: resolvedTargetConfidence, persistenceByDimension,
      importance: 0.82, controllability: 0.3, contextKind: 'voice_quality',
      metadata: { referenceDerivedBand: true, proxy: true, safetyRelevant: true, calibrationComparable },
    });
    pushOneSided(observations, context, {
      metricId: 'quality.cpps_like', dimension: 'phonation.periodicity',
      value: advanced.quality?.cppsLike, low: qualityBands.cppsLikeFloor, scale: 2.2,
      unit: 'dB_like', confidence: cappedConfidence(confidence, 0.62),
      flags: qualityFlags, targetConfidence: resolvedTargetConfidence, persistenceByDimension,
      importance: 0.35, controllability: 0.25, contextKind: 'voice_quality',
      metadata: { referenceDerivedBand: true, proxy: true, calibrationComparable },
    });
    pushOneSided(observations, context, {
      metricId: 'quality.harmonic_strength', dimension: 'phonation.harmonic_presence',
      value: advanced.quality?.harmonicStrength, low: qualityBands.harmonicStrengthFloor, scale: 3,
      unit: 'dB_like', confidence: cappedConfidence(confidence, 0.62),
      flags: qualityFlags, targetConfidence: resolvedTargetConfidence, persistenceByDimension,
      importance: 0.35, controllability: 0.25, contextKind: 'voice_quality',
      metadata: { referenceDerivedBand: true, proxy: true, calibrationComparable },
    });
    if (!['siren', 'trill', 'hum_sovt', 'ear_training', 'silent'].includes(context.takeKind)) {
      pushOneSided(observations, context, {
        metricId: 'stability.mean', dimension: 'production.stability',
        value: advanced.stabilityMean, low: advancedBands.stabilityFloor, scale: 0.1,
        unit: 'score_0_1', confidence: cappedConfidence(confidence, 0.7),
        flags: timbreFlags, targetConfidence: resolvedTargetConfidence, persistenceByDimension,
        importance: 0.42, controllability: 0.45, contextKind: 'connected_speech',
        metadata: { referenceDerivedBand: true, calibrationComparable },
      });
    }
  }

  return returnContext ? { observations, canonicalContext: context } : observations;
}

module.exports = {
  buildCanonicalMetricContext,
  legacyObservationsFromVoiceState,
  referenceTargetConfidence,
};
