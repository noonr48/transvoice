'use strict';

/**
 * Canonical coaching barrel.
 *
 * The historical implementation remains byte-preserved in index-legacy.js so
 * the migration is reviewable and reversible. The public coachingTurn adapter
 * replaces its duplicate FEM decision with the shared FEM runtime result. This
 * makes evaluateTargetMetricRuntime/resolveFemV1ShadowRuntime the single
 * exposed FEM semantic authority while active FEM remains unavailable.
 */

const legacy = require('./index-legacy');
const {
  normalizeFemV1RuntimeMode,
  resolveFemV1ShadowRuntime,
  resolveTargetMetricStage,
} = require('./target-metric-runtime');
const { buildFemV1ShadowCard } = require('./fem-v1-shadow-card');

function nestedFemWitness(existingWitness, femRuntime) {
  if (!existingWitness || typeof existingWitness !== 'object' || Array.isArray(existingWitness)) {
    return existingWitness || null;
  }
  return {
    ...existingWitness,
    fem_v1: femRuntime?.witness || null,
  };
}

async function coachingTurn(options = {}) {
  const requestedFemV1Mode = options.femV1ControllerMode || 'shadow';

  // The legacy implementation still contains the pre-orchestrator direct FEM
  // calculation. Keep that compatibility code reachable in index-legacy.js,
  // but suppress it on the canonical path so there is one actual FEM controller
  // computation per public coaching turn. The caller's requested mode is used
  // only by the shared runtime below.
  const result = await legacy.coachingTurn({
    ...options,
    femV1ControllerMode: 'off',
  });
  const femV1Mode = normalizeFemV1RuntimeMode(requestedFemV1Mode);

  // Preserve a genuine OFF state. Every other requested value, including the
  // old 'active' spelling, is constrained by normalizeFemV1RuntimeMode to hard
  // shadow until the active release gates are explicitly implemented.
  const femRuntime = femV1Mode === 'off'
    ? null
    : resolveFemV1ShadowRuntime({
      voiceState: options.voiceState || {},
      signal: result.signal || null,
      bridge: result.targetMetricBridge || null,
      stage: resolveTargetMetricStage(options.repContext, result.signal),
      motorMap: options.targetMotorMap || null,
      masteryState: options.masteryState || options.voiceState?.beginnerMastery || null,
    });
  const controllerTurn = femRuntime?.controllerTurn || null;

  return {
    ...result,
    // Compatibility field, now sourced from the shared orchestrator rather
    // than an independent second controller invocation.
    femV1ControllerTurn: controllerTurn,
    femV1BeginnerCard: controllerTurn ? buildFemV1ShadowCard(controllerTurn) : null,
    femV1RuntimeTurn: femRuntime,
    femV1NextShadowState: femRuntime?.nextShadowState || null,
    targetMetricShadowWitness: nestedFemWitness(result.targetMetricShadowWitness, femRuntime),
  };
}

module.exports = {
  ...legacy,
  coachingTurn,
};
