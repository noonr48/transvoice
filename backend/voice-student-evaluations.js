const { resolveVoiceMeasurementUsability } = require('./voice-measurement-validity');

function isFiniteScore(value) {
  if (value == null || (typeof value === 'string' && !value.trim())) {
    return false;
  }
  return Number.isFinite(Number(value));
}

function toScore(value) {
  return isFiniteScore(value) ? Number(value) : null;
}

function clampUnitScore(value, fallback) {
  if (!isFiniteScore(value)) {
    return fallback;
  }
  return Math.min(1, Math.max(0, Number(value)));
}

function normalizeCheckpoints(checkpoints) {
  return Array.isArray(checkpoints)
    ? checkpoints
        .map((checkpoint) => {
          if (!checkpoint || typeof checkpoint !== 'object' || Array.isArray(checkpoint)) {
            return null;
          }
          return {
            label: typeof checkpoint.label === 'string' && checkpoint.label.trim() ? checkpoint.label.trim() : null,
            summary: typeof checkpoint.summary === 'string' && checkpoint.summary.trim() ? checkpoint.summary.trim() : null,
            pathMatchScore: toScore(checkpoint.pathMatchScore),
            laneMatchScore: toScore(checkpoint.laneMatchScore),
            contourMatchScore: toScore(checkpoint.contourMatchScore),
            corridorHoldScore: toScore(checkpoint.corridorHoldScore),
          };
        })
        .filter(Boolean)
    : [];
}

function getWeakestCheckpoint(checkpoints, key, predicate) {
  return normalizeCheckpoints(checkpoints)
    .filter((checkpoint) => predicate(checkpoint))
    .sort((left, right) => {
      const leftScore = toScore(left?.[key]);
      const rightScore = toScore(right?.[key]);
      if (leftScore === null && rightScore === null) return 0;
      if (leftScore === null) return 1;
      if (rightScore === null) return -1;
      return leftScore - rightScore;
    })[0] || null;
}

function formatCheckpointReference(checkpoint, fallback = 'this part of the phrase') {
  const label = typeof checkpoint?.label === 'string' && checkpoint.label.trim() ? checkpoint.label.trim() : '';
  if (!label) {
    return fallback;
  }
  return label.toLowerCase() === 'whole phrase' ? 'the whole phrase' : label;
}

function buildVoicePhraseCouplingSignals(phraseComparison, thresholds = {}) {
  const pathMatchScore = toScore(phraseComparison?.pathMatchScore);
  const laneMatchScore = toScore(phraseComparison?.laneMatchScore);
  const contourMatchScore = toScore(phraseComparison?.contourMatchScore);
  const corridorHoldScore = toScore(phraseComparison?.corridorHoldScore);
  const targetZoneScore = toScore(phraseComparison?.targetZoneScore);
  const minPhraseMatchScore = clampUnitScore(thresholds.minPhraseMatchScore, 0.58);
  const minTargetHitPct = clampUnitScore(thresholds.minTargetHitPct, 0.42);
  const contourFloor = Math.max(0.42, minPhraseMatchScore - 0.10);
  const laneFloor = Math.max(0.46, minPhraseMatchScore - 0.08);

  const flattenCheckpoint = getWeakestCheckpoint(
    phraseComparison?.checkpoints,
    'contourMatchScore',
    (checkpoint) => {
      const summary = String(checkpoint.summary || '').toLowerCase();
      return summary.includes('flatten')
        || (isFiniteScore(checkpoint.laneMatchScore)
          && isFiniteScore(checkpoint.contourMatchScore)
          && Number(checkpoint.laneMatchScore) >= Number(checkpoint.contourMatchScore) + 0.08);
    }
  );

  const laneDriftCheckpoint = getWeakestCheckpoint(
    phraseComparison?.checkpoints,
    'laneMatchScore',
    (checkpoint) => {
      const summary = String(checkpoint.summary || '').toLowerCase();
      return summary.includes('outside the target lane')
        || summary.includes('outside the phrase tunnel')
        || (isFiniteScore(checkpoint.contourMatchScore)
          && isFiniteScore(checkpoint.laneMatchScore)
          && Number(checkpoint.contourMatchScore) >= Number(checkpoint.laneMatchScore) + 0.08);
    }
  );

  const intonationReinforce = Boolean(
    isFiniteScore(contourMatchScore)
      && contourMatchScore < contourFloor
      && isFiniteScore(laneMatchScore)
      && laneMatchScore >= contourMatchScore + 0.10
      && (!isFiniteScore(pathMatchScore) || pathMatchScore < minPhraseMatchScore + 0.06)
  );

  const referenceReinforce = Boolean(
    isFiniteScore(laneMatchScore)
      && isFiniteScore(contourMatchScore)
      && contourMatchScore >= laneMatchScore + 0.16
      && (
        laneMatchScore < laneFloor
        || !isFiniteScore(pathMatchScore)
        || pathMatchScore < minPhraseMatchScore + 0.04
      )
      && (
        !isFiniteScore(corridorHoldScore)
        || corridorHoldScore < 0.72
        || (isFiniteScore(targetZoneScore) && targetZoneScore < Math.max(0.55, minTargetHitPct + 0.08))
      )
  );

  return {
    intonation: intonationReinforce
      ? {
          reinforce: true,
          checkpointLabel: formatCheckpointReference(flattenCheckpoint),
          message: `Phrase contour still flattens around ${formatCheckpointReference(flattenCheckpoint)}, so the line needs more lift and playful motion.`,
        }
      : null,
    reference: referenceReinforce
      ? {
          reinforce: true,
          checkpointLabel: formatCheckpointReference(laneDriftCheckpoint),
          message: `Phrase placement still drifts outside the target lane around ${formatCheckpointReference(laneDriftCheckpoint)}, so the mimicry still sits off the reference placement.`,
        }
      : null,
  };
}

function getConceptName(concepts, conceptId) {
  return concepts?.[conceptId] || conceptId;
}

function isReliablePhraseEvidence(phraseComparison) {
  const analysisQuality = phraseComparison?.analysisQuality;
  if (!analysisQuality || typeof analysisQuality !== 'object') {
    return true;
  }
  if (analysisQuality.reliable === false) {
    return false;
  }
  const scoreConfidence = toScore(analysisQuality.scoreConfidence);
  if (scoreConfidence !== null && scoreConfidence < 0.58) {
    return false;
  }
  return true;
}

function hasAdvancedReliabilityFlag(advancedMetrics, flag) {
  return Array.isArray(advancedMetrics?.reliabilityFlags)
    && advancedMetrics.reliabilityFlags.includes(flag);
}

function buildVoiceStudentModelEvaluations({ summary, voiceState, thresholds, concepts }) {
  const metrics = summary?.metrics || {};
  const advancedMetrics = metrics?.advanced || {};
  if (!resolveVoiceMeasurementUsability(advancedMetrics).usableForScoring) {
    return [];
  }
  const phraseComparison = voiceState?.phraseComparison || null;
  const target = summary?.target && typeof summary.target === 'object' ? summary.target : {};
  const targetProfile = voiceState?.targetVoiceProfile && typeof voiceState.targetVoiceProfile === 'object'
    ? voiceState.targetVoiceProfile
    : {};
  const normalizedThresholds = {
    minPitchHz: isFiniteScore(target.pitchFloorHz)
      ? Number(target.pitchFloorHz)
      : isFiniteScore(targetProfile.pitchFloorHz)
        ? Number(targetProfile.pitchFloorHz)
        : isFiniteScore(thresholds?.minPitchHz) ? Number(thresholds.minPitchHz) : 195,
    maxPitchHz: isFiniteScore(target.pitchCeilingHz)
      ? Number(target.pitchCeilingHz)
      : isFiniteScore(targetProfile.pitchCeilingHz)
        ? Number(targetProfile.pitchCeilingHz)
        : Number.POSITIVE_INFINITY,
    minTargetHitPct: clampUnitScore(target.minTargetHitPct, clampUnitScore(thresholds?.minTargetHitPct, 0.42)),
    // v4 recalibration (2026-07-26, analyzer `voice-metrics-v4-formants`): this
    // default is the last-resort twin of VOICE_STUDENT_MODEL_PRESETS' fallback —
    // it fires only when NO thresholds object is supplied at all, and the caller's
    // own preset fallback is 'cute-feminine' (voice-session-state.js). It was 0.58,
    // a stale copy of the analyzer table; the authority is
    // audio_analysis.TARGET_PROFILES['cute-feminine'].min_resonance_mean = 0.32.
    // Derivation and the measured v4 values are documented at the preset table.
    minResonanceMean: clampUnitScore(thresholds?.minResonanceMean, 0.32),
    maxWeightMean: clampUnitScore(thresholds?.maxWeightMean, 0.6),
    minPitchRangeSt: isFiniteScore(target.minPitchRangeSt)
      ? Number(target.minPitchRangeSt)
      : isFiniteScore(thresholds?.minPitchRangeSt) ? Number(thresholds.minPitchRangeSt) : 2.8,
    minSimilarityScore: clampUnitScore(
      target.minSimilarityScore,
      clampUnitScore(thresholds?.minSimilarityScore, 0.58),
    ),
    minPhraseMatchScore: clampUnitScore(thresholds?.minPhraseMatchScore, 0.56),
  };
  // 2026-07-26 MTF-ONLY: 'masculine' is retired and is NOT a recognised
  // direction here — the whitelist below simply does not contain it, so a
  // masculinizing value falls through like any other unrecognised one.
  // 2026-07-27: the preset read here must be the SAME one that selected
  // `thresholds` (voice-session-state's `summary?.targetPreset ||
  // voiceState?.targetPreset`). Reading only the summary meant a summary with no
  // targetPreset paired a NEUTRAL preset's thresholds with a 'feminine'
  // direction, which then expanded maxWeightMean as a one-sided ceiling instead
  // of the DSP's centred band — an incoherence that only got sharper once the
  // neutral rows started carrying the raw DSP centre.
  // An explicit direction already on the target is honoured, including a
  // historical 'neutral' from a stored artifact. The preset-derived fallback that
  // used to map ['androgynous','gender-neutral'] -> 'neutral' is gone: those
  // presets were retired 2026-07-30, so a preset can no longer imply 'neutral'
  // and every one of them lands on the same 'feminine' default an unrecognised
  // preset gets — which is the equivalence the retired-target sweep enforces.
  const direction = ['feminine', 'neutral'].includes(target.direction)
    ? target.direction
    : 'feminine';
  let resonanceFloor = isFiniteScore(target.resonanceFloor)
    ? Number(target.resonanceFloor)
    : isFiniteScore(targetProfile.resonanceFloor) ? Number(targetProfile.resonanceFloor) : null;
  let resonanceCeiling = isFiniteScore(target.resonanceCeiling)
    ? Number(target.resonanceCeiling)
    : isFiniteScore(targetProfile.resonanceCeiling) ? Number(targetProfile.resonanceCeiling) : null;
  let weightFloor = isFiniteScore(target.weightFloor)
    ? Number(target.weightFloor)
    : isFiniteScore(targetProfile.weightFloor) ? Number(targetProfile.weightFloor) : null;
  let weightCeiling = isFiniteScore(target.weightCeiling)
    ? Number(target.weightCeiling)
    : isFiniteScore(targetProfile.weightCeiling) ? Number(targetProfile.weightCeiling) : null;
  // BAND-RELATIVE FIRST, threshold fallback second. When the analyzer supplied the
  // take's own bands (`summary.target.resonanceFloor/Ceiling`, which
  // audio_analysis._build_attempt_target emits on EVERY resolvable preset, and
  // which a v4 self-heal refreshes for reference targets), those win and nothing
  // below runs — that path is self-normalizing and needed no v4 change. The
  // branches below are the degraded twin of `_target_timbre_bands` for summaries
  // that arrive without bands; see the v4 derivation at VOICE_STUDENT_MODEL_PRESETS.
  if (resonanceFloor === null || resonanceCeiling === null) {
    const threshold = normalizedThresholds.minResonanceMean;
    if (direction === 'neutral') [resonanceFloor, resonanceCeiling] = [Math.max(0, threshold - 0.14), Math.min(1, threshold + 0.14)];
    else [resonanceFloor, resonanceCeiling] = [threshold, 1];
  }
  if (weightFloor === null || weightCeiling === null) {
    const threshold = normalizedThresholds.maxWeightMean;
    if (direction === 'neutral') [weightFloor, weightCeiling] = [Math.max(0, threshold - 0.14), Math.min(1, threshold + 0.14)];
    else [weightFloor, weightCeiling] = [0, threshold];
  }
  const reliablePhraseEvidence = isReliablePhraseEvidence(phraseComparison);
  const phraseCoupling = reliablePhraseEvidence
    ? buildVoicePhraseCouplingSignals(phraseComparison, normalizedThresholds)
    : { intonation: null, reference: null };
  const evaluations = [];

  if (Number.isFinite(metrics.meanPitchHz)) {
    evaluations.push({
      conceptId: 'voice_pitch_center',
      conceptName: getConceptName(concepts, 'voice_pitch_center'),
      correct: metrics.meanPitchHz >= normalizedThresholds.minPitchHz
        && metrics.meanPitchHz <= normalizedThresholds.maxPitchHz,
      misconception: `Pitch center averaged ${Math.round(metrics.meanPitchHz)} Hz, outside the ${Math.round(normalizedThresholds.minPitchHz)}–${Number.isFinite(normalizedThresholds.maxPitchHz) ? Math.round(normalizedThresholds.maxPitchHz) : 'open'} Hz target band.`,
    });
  }

  const reliableAdvancedEvidence = !hasAdvancedReliabilityFlag(advancedMetrics, 'low_score_confidence')
    && !hasAdvancedReliabilityFlag(advancedMetrics, 'low_voiced_coverage');
  if (reliableAdvancedEvidence && Number.isFinite(advancedMetrics.pitchP10Hz)) {
    const targetPitchFloor = normalizedThresholds.minPitchHz - 6;
    evaluations.push({
      conceptId: 'voice_pitch_floor_control',
      conceptName: getConceptName(concepts, 'voice_pitch_floor_control'),
      correct: advancedMetrics.pitchP10Hz >= targetPitchFloor,
      misconception: `The lower pitch floor dipped to ${Math.round(advancedMetrics.pitchP10Hz)} Hz, so the phrase still drops underneath the target floor between syllables.`,
    });
  }

  if (Number.isFinite(metrics.targetHitPct)) {
    evaluations.push({
      conceptId: 'voice_target_zone_accuracy',
      conceptName: getConceptName(concepts, 'voice_target_zone_accuracy'),
      correct: metrics.targetHitPct >= normalizedThresholds.minTargetHitPct,
      misconception: `Only ${Math.round(metrics.targetHitPct * 100)}% of the take landed in the target zone.`,
    });
  }

  if (Number.isFinite(metrics.resonanceMean)) {
    evaluations.push({
      conceptId: 'voice_resonance_brightness',
      conceptName: 'Target resonance placement',
      correct: metrics.resonanceMean >= resonanceFloor && metrics.resonanceMean <= resonanceCeiling,
      misconception: `Resonance averaged ${(metrics.resonanceMean * 100).toFixed(0)}%, outside the ${(resonanceFloor * 100).toFixed(0)}–${(resonanceCeiling * 100).toFixed(0)}% target band.`,
    });
  }

  if (Number.isFinite(metrics.weightMean)) {
    evaluations.push({
      conceptId: 'voice_light_vocal_weight',
      conceptName: 'Target vocal weight',
      correct: metrics.weightMean >= weightFloor && metrics.weightMean <= weightCeiling,
      misconception: `Vocal weight averaged ${(metrics.weightMean * 100).toFixed(0)}%, outside the ${(weightFloor * 100).toFixed(0)}–${(weightCeiling * 100).toFixed(0)}% target band.`,
    });
  }

  const intonationMargin = Number.isFinite(metrics.pitchRangeSt)
    ? metrics.pitchRangeSt - normalizedThresholds.minPitchRangeSt
    : null;
  const reinforceIntonation = Boolean(phraseCoupling.intonation?.reinforce)
    && (intonationMargin === null || intonationMargin < 0.3);
  if (Number.isFinite(metrics.pitchRangeSt) || reinforceIntonation) {
    const intonationCorrect = Number.isFinite(metrics.pitchRangeSt)
      ? metrics.pitchRangeSt >= normalizedThresholds.minPitchRangeSt && !reinforceIntonation
      : !reinforceIntonation;
    const misconceptionParts = [];
    if (Number.isFinite(metrics.pitchRangeSt) && metrics.pitchRangeSt < normalizedThresholds.minPitchRangeSt) {
      misconceptionParts.push(`Pitch range covered only ${metrics.pitchRangeSt.toFixed(1)} semitones, so the line still needs more deliberate melodic movement.`);
    }
    if (reinforceIntonation && phraseCoupling.intonation?.message) {
      misconceptionParts.push(phraseCoupling.intonation.message);
    }
    evaluations.push({
      conceptId: 'voice_playful_intonation',
      conceptName: 'Intonation range',
      correct: intonationCorrect,
      misconception: misconceptionParts.join(' ')
        || phraseCoupling.intonation?.message
        || `Pitch range covered only ${Number(metrics.pitchRangeSt || 0).toFixed(1)} semitones, so the line still needs more deliberate melodic movement.`,
    });
  }

  if (reliableAdvancedEvidence && Number.isFinite(advancedMetrics.phraseEndDropHz)) {
    evaluations.push({
      conceptId: 'voice_phrase_endings',
      conceptName: getConceptName(concepts, 'voice_phrase_endings'),
      correct: advancedMetrics.phraseEndDropHz <= 16,
      misconception: `Phrase endings dropped by ${advancedMetrics.phraseEndDropHz.toFixed(1)} Hz, so the final word is still falling out of the target space.`,
    });
  }

  if (reliableAdvancedEvidence && Number.isFinite(advancedMetrics.stabilityMean)) {
    evaluations.push({
      conceptId: 'voice_stability_control',
      conceptName: getConceptName(concepts, 'voice_stability_control'),
      correct: advancedMetrics.stabilityMean >= 0.58,
      misconception: `Placement stability averaged ${Math.round(advancedMetrics.stabilityMean * 100)}%, so the sound still wobbles between shapes instead of holding one target placement.`,
    });
  }

  if (reliablePhraseEvidence && Number.isFinite(phraseComparison?.pathMatchScore)) {
    evaluations.push({
      conceptId: 'voice_phrase_shape_matching',
      conceptName: getConceptName(concepts, 'voice_phrase_shape_matching'),
      correct: phraseComparison.pathMatchScore >= normalizedThresholds.minPhraseMatchScore,
      misconception: phraseComparison.summary
        || `Phrase matching scored ${Math.round(phraseComparison.pathMatchScore * 100)}%, so the shadowed contour still needs closer alignment.`,
    });
  }

  const hasReferenceProfile = Boolean(
    voiceState?.targetVoiceProfile
    || Number.isFinite(metrics.similarityScore),
  );
  const referenceMargin = Number.isFinite(metrics.similarityScore)
    ? metrics.similarityScore - normalizedThresholds.minSimilarityScore
    : null;
  const reinforceReference = hasReferenceProfile
    && Boolean(phraseCoupling.reference?.reinforce)
    && (referenceMargin === null || referenceMargin < 0.05);
  if (hasReferenceProfile && (Number.isFinite(metrics.similarityScore) || reinforceReference)) {
    const referenceCorrect = Number.isFinite(metrics.similarityScore)
      ? metrics.similarityScore >= normalizedThresholds.minSimilarityScore && !reinforceReference
      : !reinforceReference;
    const misconceptionParts = [];
    if (Number.isFinite(metrics.similarityScore) && metrics.similarityScore < normalizedThresholds.minSimilarityScore) {
      misconceptionParts.push(`Reference similarity scored ${Math.round(metrics.similarityScore * 100)}%, so the mimicry pass still needs closer matching.`);
    }
    if (reinforceReference && phraseCoupling.reference?.message) {
      misconceptionParts.push(phraseCoupling.reference.message);
    }
    evaluations.push({
      conceptId: 'voice_reference_matching',
      conceptName: getConceptName(concepts, 'voice_reference_matching'),
      correct: referenceCorrect,
      misconception: misconceptionParts.join(' ')
        || phraseCoupling.reference?.message
        || `Reference similarity scored ${Math.round(Number(metrics.similarityScore || 0) * 100)}%, so the mimicry pass still needs closer matching.`,
    });
  }

  const targetAdvancedBands = voiceState?.targetVoiceProfile?.advancedBands || {};
  const currentFormant = advancedMetrics.formantLite || null;
  const targetFormant = targetAdvancedBands.formantLite || null;
  if (
    reliableAdvancedEvidence
    && currentFormant
    && Number.isFinite(currentFormant.frontnessScore)
    && targetFormant
    && Number.isFinite(targetFormant.frontnessFloor)
  ) {
    evaluations.push({
      conceptId: 'voice_reference_frontness',
      conceptName: getConceptName(concepts, 'voice_reference_frontness'),
      correct: currentFormant.frontnessScore >= targetFormant.frontnessFloor,
      misconception: `Front resonance stayed too far back at ${Math.round(currentFormant.frontnessScore * 100)}%, below the target floor for the reference voice shape.`,
    });
  }

  const currentQuality = advancedMetrics.quality || null;
  const targetQuality = targetAdvancedBands.quality || null;
  if (
    reliableAdvancedEvidence
    && currentQuality
    && targetQuality
    && (
      Number.isFinite(currentQuality.breathyRisk)
      || Number.isFinite(currentQuality.strainRisk)
    )
  ) {
    const breathyCeiling = Number.isFinite(targetQuality.breathyRiskCeiling) ? targetQuality.breathyRiskCeiling : 0.55;
    const strainCeiling = Number.isFinite(targetQuality.strainRiskCeiling) ? targetQuality.strainRiskCeiling : 0.50;
    // Absence is not zero: an unmeasured risk must neither fail the concept nor
    // surface a fabricated "0%" to the learner. Evaluate only measured values.
    const breathyRisk = Number.isFinite(currentQuality.breathyRisk) ? currentQuality.breathyRisk : null;
    const strainRisk = Number.isFinite(currentQuality.strainRisk) ? currentQuality.strainRisk : null;
    if (breathyRisk != null || strainRisk != null) {
      const parts = [];
      if (breathyRisk != null) parts.push(`breathy risk is ${Math.round(breathyRisk * 100)}%`);
      if (strainRisk != null) parts.push(`strain risk is ${Math.round(strainRisk * 100)}%`);
      evaluations.push({
        conceptId: 'voice_easy_phonation',
        conceptName: getConceptName(concepts, 'voice_easy_phonation'),
        correct: (breathyRisk == null || breathyRisk <= breathyCeiling)
          && (strainRisk == null || strainRisk <= strainCeiling),
        misconception: `Voice quality is drifting away from the easy target tone: ${parts.join(' and ')}.`,
      });
    }
  }

  return evaluations;
}

module.exports = {
  buildVoicePhraseCouplingSignals,
  buildVoiceStudentModelEvaluations,
};
