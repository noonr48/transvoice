'use strict';

const {
  MOTOR_MAP_SCHEMA,
  normalizeMotorMap,
} = require('./motor-map');

/**
 * TV-FEM-P5-001 - learner-general motor response (master plan 6.5).
 *
 * Splits motor knowledge into:
 *   1. LEARNER-GENERAL motor response - which reviewed cues tend to help
 *      THIS learner (cue x skill x dimension), migrated from target-scoped
 *      motor maps with provenance. Changing a reference voice / target must
 *      never erase it.
 *   2. GOAL-SPECIFIC cue overlay - separate module (goal-cue-overlay.js).
 *
 * Laws enforced here:
 * - No invented confidence: stats are weighted arithmetic over source
 *   records only; zero-verified cues stay zero (no synthetic successes).
 * - Migration provenance: every entry records its source (target-scoped
 *   map schema plus the attempts figure that source contributed); nothing
 *   appears without a source record.
 * - Unknown is not invented: direction/context stay null unless a caller
 *   explicitly supplies them later (v1 migration does not).
 * - Deterministic: merge is order-insensitive; provenance sorted stably.
 * - LLM boundary (plan 16): motor internals NEVER enter the learner memo -
 *   llmMemoMotorProjection() makes that exclusion explicit and testable.
 */

const LEARNER_MOTOR_RESPONSE_SCHEMA = 'transvoice.learner_motor_response.v1';
const MIGRATION_SOURCE_TARGET_SCOPED = 'target_scoped_motor_map';

// Skill vocabulary aligned with beginner-mastery SKILLS. Review cycle-1
// minor 2: unregistered dimension heads (e.g. 'phonation') fail closed to
// null skill - the vocabulary is never silently widened.
const SKILLS = Object.freeze(['pitch', 'resonance', 'integration', 'prosody', 'transfer']);

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function nonNegativeInt(value) {
  const number = finiteOrNull(value);
  if (number == null || number < 0) return 0;
  return Math.floor(number);
}

function skillForDimension(dimension) {
  const dim = textOrNull(dimension, 120);
  if (!dim) return null;
  const head = dim.split('.')[0];
  return SKILLS.includes(head) ? head : null;
}

function emptyDimensionAccumulator() {
  return {
    attempts: 0,
    successes: 0,
    verifiedFailures: 0,
    targetGainWeighted: 0,
    verifiedGainWeighted: 0,
    verifiedGainObservations: 0,
    provenance: [],
  };
}

function absorbDimensionState(accumulator, dimensionState, provenanceEntry) {
  const attempts = nonNegativeInt(dimensionState.attempts);
  const verifiedGainObservations = nonNegativeInt(dimensionState.verifiedGainObservations);
  accumulator.attempts += attempts;
  accumulator.successes += nonNegativeInt(dimensionState.successes);
  accumulator.verifiedFailures += nonNegativeInt(dimensionState.verifiedFailures);
  accumulator.verifiedGainObservations += verifiedGainObservations;
  accumulator.targetGainWeighted += (finiteOrNull(dimensionState.meanTargetGain) || 0) * attempts;
  accumulator.verifiedGainWeighted
    += (finiteOrNull(dimensionState.meanVerifiedTargetGain) || 0) * verifiedGainObservations;
  if (provenanceEntry) accumulator.provenance.push(provenanceEntry);
}

function absorbMap(accumulators, map) {
  const normalized = normalizeMotorMap(map);
  for (const [cueId, cueState] of Object.entries(normalized.byCue || {})) {
    const cue = textOrNull(cueId, 200);
    if (!cue) continue;
    const dimensions = cueState.byDimension && typeof cueState.byDimension === 'object'
      && !Array.isArray(cueState.byDimension)
      ? cueState.byDimension
      : {};
    for (const [dimension, dimensionState] of Object.entries(dimensions)) {
      const dim = textOrNull(dimension, 120);
      if (!dim) continue;
      // Collision-free composite key (review cycle-1 minor 3): cue/dimension
      // pairs containing spaces must never silently merge stats.
      const key = JSON.stringify([cue, dim]);
      if (!accumulators.has(key)) accumulators.set(key, { cue, dimension: dim, ...emptyDimensionAccumulator() });
      // Per-source provenance (review note 2): records what THIS source
      // contributed, so distinct sources yield distinct, sortable entries -
      // merge order-insensitivity is exercised by the sort, not assumed.
      absorbDimensionState(accumulators.get(key), dimensionState, {
        source: MIGRATION_SOURCE_TARGET_SCOPED,
        mapSchema: MOTOR_MAP_SCHEMA,
        attempts: nonNegativeInt(dimensionState.attempts),
      });
    }
  }
}

function absorbResponse(accumulators, response) {
  if (!response || response.schema !== LEARNER_MOTOR_RESPONSE_SCHEMA) return;
  for (const [cueId, cueEntry] of Object.entries(response.byCue || {})) {
    const cue = textOrNull(cueId, 200);
    if (!cue || !cueEntry || typeof cueEntry !== 'object') continue;
    for (const [dimension, entry] of Object.entries(cueEntry.byDimension || {})) {
      const dim = textOrNull(dimension, 120);
      if (!dim || !entry || typeof entry !== 'object') continue;
      const key = JSON.stringify([cue, dim]);
      if (!accumulators.has(key)) accumulators.set(key, { cue, dimension: dim, ...emptyDimensionAccumulator() });
      const stats = entry.stats || {};
      absorbDimensionState(accumulators.get(key), stats, null);
      if (Array.isArray(entry.provenance)) {
        for (const provenance of entry.provenance) {
          accumulators.get(key).provenance.push(provenance);
        }
      }
    }
  }
}

function finalizeDimension(accumulator) {
  const provenance = [...accumulator.provenance]
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  // Round recorded means to 1e-9 (codebase convention): weighted arithmetic
  // over finite sources can still leave float residue (0.4*3/3 !== 0.4),
  // which would make byte-equality comparisons between merged orders flaky.
  return {
    stats: {
      attempts: accumulator.attempts,
      successes: accumulator.successes,
      verifiedFailures: accumulator.verifiedFailures,
      verifiedGainObservations: accumulator.verifiedGainObservations,
      meanTargetGain: accumulator.attempts
        ? Math.round((accumulator.targetGainWeighted / accumulator.attempts) * 1e9) / 1e9
        : 0,
      meanVerifiedTargetGain: accumulator.verifiedGainObservations
        ? Math.round((accumulator.verifiedGainWeighted / accumulator.verifiedGainObservations) * 1e9) / 1e9
        : 0,
    },
    // Unknown is not invented: direction stays null until a caller supplies it.
    direction: null,
    provenance,
  };
}

function finalizeResponse(accumulators) {
  const byCue = {};
  for (const accumulator of accumulators.values()) {
    if (!accumulator.attempts) continue; // nothing absorbed - no invented entries
    const skill = skillForDimension(accumulator.dimension);
    if (!byCue[accumulator.cue]) {
      byCue[accumulator.cue] = { skill, byDimension: {} };
    }
    byCue[accumulator.cue].byDimension[accumulator.dimension] = finalizeDimension(accumulator);
    if (byCue[accumulator.cue].skill == null && skill != null) {
      byCue[accumulator.cue].skill = skill;
    }
  }
  return {
    schema: LEARNER_MOTOR_RESPONSE_SCHEMA,
    // Context/direction are learner-session facts, not migration facts.
    direction: null,
    context: null,
    byCue,
  };
}

/**
 * Build the learner-general motor response from one or more target-scoped
 * motor maps (the legacy storage). Invalid/unknown-schema maps contribute
 * nothing (normalizeMotorMap fails closed to empty). Merge is weighted
 * arithmetic only - no synthesized confidence.
 */
function buildLearnerMotorResponse({ maps = [] } = {}) {
  const accumulators = new Map();
  for (const map of Array.isArray(maps) ? maps : []) {
    absorbMap(accumulators, map);
  }
  return finalizeResponse(accumulators);
}

/**
 * Compose two learner-general responses (e.g. persisted + newly migrated).
 * Same arithmetic; provenance from both sources is preserved.
 */
function mergeLearnerMotorResponses(one, two) {
  const accumulators = new Map();
  absorbResponse(accumulators, one);
  absorbResponse(accumulators, two);
  return finalizeResponse(accumulators);
}

/**
 * Plan 16 boundary: raw motor statistics, attempt ids, cue probabilities
 * NEVER enter the LLM learner memo. This projection is deliberately null so
 * the exclusion is an explicit, testable contract instead of an omission.
 */
function llmMemoMotorProjection() {
  return null;
}

module.exports = {
  LEARNER_MOTOR_RESPONSE_SCHEMA,
  MIGRATION_SOURCE_TARGET_SCOPED,
  buildLearnerMotorResponse,
  llmMemoMotorProjection,
  mergeLearnerMotorResponses,
};
