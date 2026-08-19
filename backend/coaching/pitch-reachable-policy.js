'use strict';

const { REACHABLE_TARGET_POLICY_SCHEMA } = require('./training-target');

const PITCH_REACHABLE_POLICY_SCHEMA = 'transvoice.pitch_reachable_policy.v1';

const PITCH_REACHABLE_POLICY_ID = 'fem-v1.pitch.step.comfort-first.v1';
const PITCH_REACHABLE_POLICY_VERSION = '1';

/**
 * Named, versioned policy config (backlog TV-FEM-P2-002). The step a beginner
 * is asked for is bounded BOTH by what this learner demonstrably did
 * comfortably AND by the configured cap — whichever is smaller. There is no
 * default step: without calibration evidence the policy is refused and
 * targets stay aspirational_only.
 */
function defaultPitchStepPolicyConfig() {
  return {
    schema: PITCH_REACHABLE_POLICY_SCHEMA,
    policyId: PITCH_REACHABLE_POLICY_ID,
    policyVersion: PITCH_REACHABLE_POLICY_VERSION,
    maxSemitones: 2.0,
    // Salience floor: baseline jitter between takes (fractions of a semitone)
    // is NOT a demonstrated glide. A step policy may only be built on a real,
    // audible movement the learner performed comfortably.
    minDemonstratedSemitones: 0.5,
    // A single verified movement is one lucky attempt, not a demonstrated
    // ability (plan 6.4). At least two salient verified upward movements are
    // required, and the step is built on their MEDIAN (robust to one artifact).
    minVerifiedUpwardMovements: 2,
    // A baseline spread wider than one octave across comfortable takes means
    // capture garbage or octave errors, not a usable calibration.
    maxBaselineSpreadSemitones: 12,
    minMedianTrackerConfidence: 0.6,
  };
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function configOrDefault(config) {
  const base = defaultPitchStepPolicyConfig();
  if (!config || typeof config !== 'object' || Array.isArray(config)) return base;
  const maxSemitones = finiteOrNull(config.maxSemitones);
  const minDemonstratedSemitones = finiteOrNull(config.minDemonstratedSemitones);
  const minVerifiedUpwardMovements = finiteOrNull(config.minVerifiedUpwardMovements);
  const maxBaselineSpreadSemitones = finiteOrNull(config.maxBaselineSpreadSemitones);
  const minMedianTrackerConfidence = finiteOrNull(config.minMedianTrackerConfidence);
  return {
    ...base,
    ...(maxSemitones != null && maxSemitones > 0 ? { maxSemitones } : {}),
    ...(minDemonstratedSemitones != null && minDemonstratedSemitones > 0
      ? { minDemonstratedSemitones }
      : {}),
    ...(minVerifiedUpwardMovements != null && minVerifiedUpwardMovements > 0
      ? { minVerifiedUpwardMovements: Math.floor(minVerifiedUpwardMovements) }
      : {}),
    ...(maxBaselineSpreadSemitones != null && maxBaselineSpreadSemitones > 0
      ? { maxBaselineSpreadSemitones }
      : {}),
    ...(minMedianTrackerConfidence != null ? { minMedianTrackerConfidence } : {}),
  };
}

function refused(reason) {
  return { status: 'refused', reason, policy: null, basis: null };
}

/**
 * Resolve the pitch reachable-step policy from CALIBRATION EVIDENCE.
 *
 * Refusal laws (fail closed, every one):
 * - calibration_evidence_required: no valid calibration record -> no policy,
 *   so deriveReachableTrainingTarget stays aspirational_only (no default step).
 * - demonstrated_comfort_required: the learner has no verified comfortable
 *   upward movement -> there is nothing demonstrated to build a step on.
 * - tracker_uncertainty_too_high: elevated octave-error risk or median tracker
 *   confidence below the configured floor -> measurement cannot bound a step.
 *
 * When resolved, the step cap is min(demonstrated comfort, config cap).
 */
function resolvePitchStepPolicy({ calibration = null, config = null } = {}) {
  const resolvedConfig = configOrDefault(config);

  if (!calibration || typeof calibration !== 'object' || Array.isArray(calibration)) {
    return refused('calibration_evidence_required');
  }
  if (calibration.status !== 'valid' || !Array.isArray(calibration.comfortableMovement)) {
    return refused('calibration_evidence_required');
  }

  const baselineSpread = finiteOrNull(calibration.baseline?.spreadSemitones);
  if (baselineSpread != null && baselineSpread > resolvedConfig.maxBaselineSpreadSemitones) {
    return refused('baseline_spread_too_wide');
  }

  const verifiedUpwardCount = finiteOrNull(
    calibration.comfortableMovementSummary.verifiedUpwardCount,
  );
  // Salience filtering is POLICY, not record-keeping: the calibration record
  // keeps every movement; only salient (>= floor) VERIFIED upward glides may
  // form the demonstrated-comfort basis. Baseline jitter between takes is
  // recorded but never counts as a demonstrated glide.
  const salientVerifiedUpward = calibration.comfortableMovement.filter((movement) => (
    movement
    && movement.effortVerified === true
    && finiteOrNull(movement.deltaSemitones) != null
    && movement.deltaSemitones >= resolvedConfig.minDemonstratedSemitones
  ));
  if (salientVerifiedUpward.length < resolvedConfig.minVerifiedUpwardMovements) {
    // Fewer than the required salient verified movements: jitter and single
    // lucky attempts are not demonstrated comfort.
    return refused('demonstrated_comfort_required');
  }
  const salientDeltas = salientVerifiedUpward
    .map((movement) => movement.deltaSemitones)
    .sort((a, b) => a - b);
  const salientMid = Math.floor(salientDeltas.length / 2);
  const demonstratedComfortSemitones = Math.round((salientDeltas.length % 2
    ? salientDeltas[salientMid]
    : (salientDeltas[salientMid - 1] + salientDeltas[salientMid]) / 2) * 1e6) / 1e6;
  if (demonstratedComfortSemitones < resolvedConfig.minDemonstratedSemitones) {
    return refused('demonstrated_comfort_required');
  }

  const medianConfidence = finiteOrNull(calibration.tracker?.medianConfidence);
  if (calibration.tracker?.octaveErrorRisk === 'elevated'
    || medianConfidence == null
    || medianConfidence < resolvedConfig.minMedianTrackerConfidence) {
    return refused('tracker_uncertainty_too_high');
  }

  const max = Math.min(demonstratedComfortSemitones, resolvedConfig.maxSemitones);
  if (!(max > 0)) {
    return refused('demonstrated_comfort_required');
  }

  return {
    status: 'ready',
    reason: null,
    schema: PITCH_REACHABLE_POLICY_SCHEMA,
    policy: {
      schema: REACHABLE_TARGET_POLICY_SCHEMA,
      policyId: resolvedConfig.policyId,
      policyVersion: String(resolvedConfig.policyVersion),
      type: 'max_semitone_delta',
      max: Math.round(max * 1e6) / 1e6,
    },
    basis: {
      demonstratedComfortSemitones,
      demonstratedComfortBasis: 'median_salient_verified_upward',
      salientVerifiedUpwardCount: salientVerifiedUpward.length,
      allVerifiedUpwardCount: verifiedUpwardCount,
      baselineSpreadSemitones: baselineSpread,
      configMaxSemitones: resolvedConfig.maxSemitones,
      medianTrackerConfidence: medianConfidence,
      octaveErrorRisk: calibration.tracker?.octaveErrorRisk ?? null,
      calibrationUsableTakeCount: calibration.usableTakeCount ?? null,
    },
  };
}

module.exports = {
  PITCH_REACHABLE_POLICY_ID,
  PITCH_REACHABLE_POLICY_SCHEMA,
  PITCH_REACHABLE_POLICY_VERSION,
  defaultPitchStepPolicyConfig,
  resolvePitchStepPolicy,
};
