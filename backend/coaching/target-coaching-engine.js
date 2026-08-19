'use strict';

const {
  DEFAULT_MIN_CONFIDENCE,
  comparisonIdentityKey,
  normalizeObservation,
  rankableObservations,
  semitonesBetween,
  targetDistance,
} = require('./metric-observations');
const { cuesForObservation } = require('./cue-library-v3');
const { cueEffectMultiplier } = require('./motor-map');

const COACH_DECISION_SCHEMA = 'transvoice.target_coach_decision.v2';
const TARGET_ENGINE_VERSION = 'target-metric-engine-v2';

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function normalizedFivePoint(value) {
  const number = finiteOrNull(value);
  if (number == null) return null;
  return number <= 5 ? number : number / 2;
}
function assessSelfReportedSafety(selfReport = {}) {
  const pain = selfReport.pain === true || selfReport.throatPain === true;
  const strain = normalizedFivePoint(selfReport.strain);
  const effort = normalizedFivePoint(selfReport.effort);
  const fatigue = normalizedFivePoint(selfReport.fatigue);
  const discomfort = normalizedFivePoint(selfReport.discomfort);
  if (pain || (strain != null && strain >= 4.5)) {
    return {
      state: 'stop',
      reason: pain ? 'reported_pain' : 'reported_high_strain',
      targetCoachingAllowed: false,
    };
  }
  if ((strain != null && strain >= 3.5)
    || (effort != null && effort >= 4.5)
    || (fatigue != null && fatigue >= 4.5)
    || (discomfort != null && discomfort >= 4.5)) {
    return {
      state: 'reset',
      reason: 'reported_high_effort_or_fatigue',
      targetCoachingAllowed: false,
    };
  }
  return { state: 'normal', reason: null, targetCoachingAllowed: true };
}
function cueRank(cue, observation, motorMap) {
  const learned = cueEffectMultiplier(motorMap, cue.cueId, observation.dimension);
  const exactDimension = cue.dimensionPatterns.includes(observation.dimension) ? 1.05 : 1;
  return observation.priority * learned * exactDimension;
}
function explanatoryReason(observation) {
  const direction = observation.direction === 'below' ? 'below' : 'above';
  return `${observation.dimension} is ${direction} the chosen target region on reliable evidence; work on this one dimension and hold the protected dimensions steady.`;
}
function compactEvidence(item) {
  return {
    metricId: item.metricId,
    dimension: item.dimension,
    direction: item.direction,
    distance: item.absoluteDistance,
    confidence: item.effectiveConfidence,
    priority: item.priority,
    comparisonKey: item.comparisonKey,
    targetKey: item.target?.targetKey || null,
    attemptArtifactId: item.attemptArtifactId || null,
    taskId: item.taskId || null,
    takeKind: item.takeKind || null,
  };
}

function decideTargetCoaching({
  observations = [],
  selfReport = {},
  stage = 'phrase',
  motorMap = null,
  minConfidence = DEFAULT_MIN_CONFIDENCE,
  requirePersistence = 1,
} = {}) {
  const safety = assessSelfReportedSafety(selfReport);
  if (!safety.targetCoachingAllowed) {
    return {
      schema: COACH_DECISION_SCHEMA,
      engineVersion: TARGET_ENGINE_VERSION,
      status: safety.state === 'stop' ? 'stop_for_safety' : 'reset_for_safety',
      focus: null,
      action: null,
      evidence: [],
      safety,
      llmMayRephrase: true,
      llmMayChangeDecision: false,
    };
  }

  const ranked = rankableObservations(observations, { minConfidence })
    .filter((observation) => observation.absoluteDistance > 0)
    .filter((observation) => observation.persistenceCount >= requirePersistence);
  const candidates = [];
  for (const observation of ranked) {
    for (const candidateCue of cuesForObservation(observation, { stage })) {
      candidates.push({
        observation,
        cue: candidateCue,
        rank: cueRank(candidateCue, observation, motorMap),
      });
    }
  }
  candidates.sort((left, right) => right.rank - left.rank);
  const chosen = candidates[0] || null;
  const evidence = ranked.slice(0, 3).map(compactEvidence);

  if (!chosen) {
    const first = ranked[0] || null;
    return {
      schema: COACH_DECISION_SCHEMA,
      engineVersion: TARGET_ENGINE_VERSION,
      status: ranked.length ? 'observe_no_safe_action' : 'no_reliable_gap',
      focus: first ? {
        metricId: first.metricId,
        dimension: first.dimension,
        direction: first.direction,
        confidence: first.effectiveConfidence,
        distance: first.absoluteDistance,
        comparisonKey: first.comparisonKey,
        targetKey: first.target?.targetKey || null,
        attemptArtifactId: first.attemptArtifactId || null,
        taskId: first.taskId || null,
        takeKind: first.takeKind || null,
      } : null,
      action: null,
      evidence,
      safety,
      llmMayRephrase: true,
      llmMayChangeDecision: false,
    };
  }

  const { observation, cue } = chosen;
  return {
    schema: COACH_DECISION_SCHEMA,
    engineVersion: TARGET_ENGINE_VERSION,
    status: 'coach',
    focus: {
      metricId: observation.metricId,
      dimension: observation.dimension,
      direction: observation.direction,
      confidence: observation.effectiveConfidence,
      distance: observation.absoluteDistance,
      comparisonKey: observation.comparisonKey,
      targetKey: observation.target?.targetKey || null,
      targetSource: observation.target.source,
      attemptArtifactId: observation.attemptArtifactId || null,
      taskId: observation.taskId || null,
      takeKind: observation.takeKind || null,
      analysisProfile: observation.analysisProfile || null,
      context: {
        phoneme: observation.phoneme,
        word: observation.word,
        contextKind: observation.contextKind,
      },
    },
    reason: explanatoryReason(observation),
    action: {
      cueId: cue.cueId,
      instruction: cue.instruction,
      rationale: cue.rationale,
      protectedMetrics: cue.protectedMetrics,
      protectedRules: cue.protectedRules || {},
      expectedEffects: cue.expectedEffects,
      successText: cue.successText,
      transfer: cue.transfer,
      reviewStatus: cue.reviewStatus,
    },
    evidence,
    safety,
    llmMayRephrase: true,
    llmMayChangeDecision: false,
  };
}

function directionOfChange(before, after, epsilon = 0.05) {
  const delta = before - after;
  if (delta > epsilon) return 'improved';
  if (delta < -epsilon) return 'worse';
  return 'unchanged';
}
function normalizedItems(observations) {
  return (Array.isArray(observations) ? observations : []).map(normalizeObservation);
}
function findByComparisonKey(observations, key) {
  if (!key) return null;
  return normalizedItems(observations).find((item) => item.comparisonKey === key) || null;
}
function findComparableByDimension(observations, dimension, reference = null) {
  const items = normalizedItems(observations).filter((item) => item.dimension === dimension);
  if (!items.length) return null;
  if (!reference) return items.length === 1 ? items[0] : null;
  const targetKey = reference.target?.targetKey || reference.targetKey || null;
  const taskId = reference.taskId || null;
  const takeKind = reference.takeKind || null;
  return items.find((item) => (
    (!targetKey || item.target?.targetKey === targetKey)
    && (!taskId || item.taskId === taskId)
    && (!takeKind || item.takeKind === takeKind)
  )) || (items.length === 1 ? items[0] : null);
}
function diagnoseFocusMismatch(decision, afterObservations) {
  const sameDimension = normalizedItems(afterObservations)
    .filter((item) => item.dimension === decision?.focus?.dimension);
  if (!sameDimension.length) return 'focus_observation_missing';
  const expectedTargetKey = decision?.focus?.targetKey || null;
  if (expectedTargetKey && sameDimension.some((item) => item.target?.targetKey !== expectedTargetKey)) {
    return 'target_changed';
  }
  const expectedTaskId = decision?.focus?.taskId || null;
  if (expectedTaskId && sameDimension.some((item) => item.taskId !== expectedTaskId)) {
    return 'task_changed';
  }
  const expectedTakeKind = decision?.focus?.takeKind || null;
  if (expectedTakeKind && sameDimension.some((item) => item.takeKind !== expectedTakeKind)) {
    return 'take_kind_changed';
  }
  return 'context_changed';
}

function evaluateProtectedMetrics(
  decision,
  beforeObservations,
  afterObservations,
  { effortBefore = null, effortAfter = null, epsilon = 0.05 } = {},
) {
  const protectedMetrics = Array.isArray(decision?.action?.protectedMetrics)
    ? decision.action.protectedMetrics
    : [];
  const protectedRules = decision?.action?.protectedRules || {};
  const regressions = [];
  const missingEvidence = [];
  const focusReference = {
    targetKey: decision?.focus?.targetKey || null,
    taskId: decision?.focus?.taskId || null,
    takeKind: decision?.focus?.takeKind || null,
  };

  for (const dimension of protectedMetrics) {
    if (dimension === 'safety.effort') {
      const before = finiteOrNull(effortBefore);
      const after = finiteOrNull(effortAfter);
      if (before == null || after == null) {
        missingEvidence.push({ dimension, reason: 'effort_not_reported' });
      } else if (after > before) {
        regressions.push({
          dimension,
          kind: 'effort_increase',
          delta: after - before,
          unit: 'self_report_scale',
          limit: 0,
        });
      }
      continue;
    }

    const beforeRaw = findComparableByDimension(beforeObservations, dimension, focusReference);
    if (!beforeRaw) {
      missingEvidence.push({ dimension, reason: 'protected_before_missing' });
      continue;
    }
    const afterRaw = findByComparisonKey(afterObservations, comparisonIdentityKey(beforeRaw));
    if (!afterRaw) {
      missingEvidence.push({ dimension, reason: 'protected_after_not_comparable' });
      continue;
    }
    const rule = protectedRules[dimension] || null;

    if (rule?.type === 'max_semitone_delta') {
      const delta = semitonesBetween(beforeRaw.value, afterRaw.value);
      const max = finiteOrNull(rule.max);
      if (delta == null || max == null) {
        missingEvidence.push({ dimension, reason: 'protected_rule_unmeasurable' });
      } else if (Math.abs(delta) > max) {
        regressions.push({
          dimension,
          kind: 'absolute_change',
          delta: Math.abs(delta),
          unit: 'semitone',
          limit: max,
        });
      }
      continue;
    }

    const before = targetDistance(beforeRaw);
    const after = targetDistance(afterRaw);
    if (!before || !after) {
      missingEvidence.push({ dimension, reason: 'protected_target_distance_unavailable' });
      continue;
    }
    const regression = after.absoluteDistance - before.absoluteDistance;
    if (regression > epsilon) {
      regressions.push({
        dimension,
        kind: 'target_regression',
        delta: regression,
        unit: 'normalized_target_distance',
        limit: epsilon,
      });
    }
  }

  return { regressions, missingEvidence };
}

function verifyCueEffect(
  decision,
  beforeObservations,
  afterObservations,
  { effortBefore = null, effortAfter = null, epsilon = 0.05 } = {},
) {
  if (!decision || decision.status !== 'coach' || !decision.focus?.dimension) {
    return { status: 'not_applicable' };
  }

  const beforeRaw = findByComparisonKey(beforeObservations, decision.focus.comparisonKey)
    || findComparableByDimension(beforeObservations, decision.focus.dimension, decision.focus);
  if (!beforeRaw) {
    return { status: 'insufficient_evidence', result: 'insufficient_focus_evidence' };
  }
  const expectedKey = comparisonIdentityKey(beforeRaw);
  const afterRaw = findByComparisonKey(afterObservations, expectedKey);
  if (!afterRaw) {
    return {
      status: 'invalidated',
      result: diagnoseFocusMismatch(decision, afterObservations),
      cueId: decision.action?.cueId || null,
      dimension: decision.focus.dimension,
    };
  }

  const before = targetDistance(beforeRaw);
  const after = targetDistance(afterRaw);
  if (!before || !after) {
    return { status: 'insufficient_evidence', result: 'insufficient_focus_evidence' };
  }
  const targetMovement = directionOfChange(before.absoluteDistance, after.absoluteDistance, epsilon);
  const protectedEvidence = evaluateProtectedMetrics(
    decision,
    beforeObservations,
    afterObservations,
    { effortBefore, effortAfter, epsilon },
  );
  const effortRegression = protectedEvidence.regressions.find((item) => item.dimension === 'safety.effort');

  let result = 'no_effect';
  if (targetMovement === 'worse') result = 'moved_wrong_way';
  else if (effortRegression) result = 'cost_too_high';
  else if (protectedEvidence.regressions.length > 0) result = 'confounded';
  else if (targetMovement === 'improved' && protectedEvidence.missingEvidence.length > 0) {
    result = 'movement_observed_partial';
  } else if (targetMovement === 'improved') {
    result = 'worked_verified';
  }

  return {
    status: 'verified',
    result,
    cueId: decision.action?.cueId || null,
    dimension: decision.focus.dimension,
    comparisonKey: expectedKey,
    beforeAttemptArtifactId: beforeRaw.attemptArtifactId || null,
    afterAttemptArtifactId: afterRaw.attemptArtifactId || null,
    targetMovement,
    targetGain: before.absoluteDistance - after.absoluteDistance,
    effortDelta: effortRegression?.delta ?? (
      finiteOrNull(effortBefore) != null && finiteOrNull(effortAfter) != null
        ? finiteOrNull(effortAfter) - finiteOrNull(effortBefore)
        : null
    ),
    protectedRegressions: protectedEvidence.regressions,
    missingProtectedEvidence: protectedEvidence.missingEvidence,
  };
}

module.exports = {
  COACH_DECISION_SCHEMA,
  TARGET_ENGINE_VERSION,
  assessSelfReportedSafety,
  decideTargetCoaching,
  evaluateProtectedMetrics,
  verifyCueEffect,
};
