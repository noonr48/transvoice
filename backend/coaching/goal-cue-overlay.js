'use strict';

/**
 * TV-FEM-P5-001 — goal-specific cue overlay (master plan §6.5).
 *
 * Stores whether a reviewed cue is especially relevant/useful for the
 * CURRENT goal profile (e.g. long-range style preference). Completely
 * separate storage from the learner-general motor response: changing the
 * reference voice / goal clears or rewrites ONLY this overlay — the
 * learner-general response is untouched by construction (no shared state).
 *
 * Laws:
 * - Relevance is bounded [0, 2]; neutral default 1.
 * - Malformed goal/cue ids or non-number relevance change NOTHING (fail
 *   closed to no overlay change, never a guessed value).
 * - All operations immutable: set/clear return new overlays.
 */

const GOAL_CUE_OVERLAY_SCHEMA = 'transvoice.goal_cue_overlay.v1';
const MIN_RELEVANCE = 0;
const MAX_RELEVANCE = 2;
const NEUTRAL_RELEVANCE = 1;

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function baseByGoal(overlay) {
  return overlay && typeof overlay === 'object' && !Array.isArray(overlay)
    && overlay.byGoal && typeof overlay.byGoal === 'object' && !Array.isArray(overlay.byGoal)
    ? overlay.byGoal
    : {};
}

function emptyGoalCueOverlay() {
  return { schema: GOAL_CUE_OVERLAY_SCHEMA, byGoal: {} };
}

/**
 * Set one cue's relevance for one goal profile. Returns a NEW overlay; the
 * input overlay is never mutated. Malformed input returns the input
 * unchanged (nothing lands — fail closed).
 */
function setGoalCueRelevance(overlay, { goalProfileId, cueId, relevance } = {}) {
  const goal = textOrNull(goalProfileId, 200);
  const cue = textOrNull(cueId, 200);
  const value = typeof relevance === 'number' && Number.isFinite(relevance)
    ? Math.min(MAX_RELEVANCE, Math.max(MIN_RELEVANCE, relevance))
    : null;
  if (!goal || !cue || value == null) return overlay;
  const byGoal = baseByGoal(overlay);
  return {
    schema: GOAL_CUE_OVERLAY_SCHEMA,
    byGoal: {
      ...byGoal,
      [goal]: { ...(byGoal[goal] || {}), [cue]: value },
    },
  };
}

/**
 * Read one cue's relevance for one goal. Neutral 1 when unset or when the
 * overlay is malformed — never invented beyond the neutral default.
 */
function getGoalCueRelevance(overlay, goalProfileId, cueId) {
  const goal = textOrNull(goalProfileId, 200);
  const cue = textOrNull(cueId, 200);
  if (!goal || !cue) return NEUTRAL_RELEVANCE;
  const value = baseByGoal(overlay)[goal]?.[cue];
  if (typeof value === 'number' && Number.isFinite(value)) {
    // Clamp on READ too (review cycle-1 minor 1): a forged or foreign
    // overlay must never read back out-of-band relevance, even though the
    // producer path already clamps.
    return Math.min(MAX_RELEVANCE, Math.max(MIN_RELEVANCE, value));
  }
  return NEUTRAL_RELEVANCE;
}

/**
 * Clear ALL overlay entries for one goal profile (a reference/goal change
 * rewrites only this goal's overlay). Other goals are preserved. Returns a
 * new overlay; input never mutated.
 */
function clearGoalOverlay(overlay, goalProfileId) {
  const goal = textOrNull(goalProfileId, 200);
  if (!goal) return overlay;
  const byGoal = baseByGoal(overlay);
  if (!Object.prototype.hasOwnProperty.call(byGoal, goal)) return overlay;
  const next = { ...byGoal };
  delete next[goal];
  return { schema: GOAL_CUE_OVERLAY_SCHEMA, byGoal: next };
}

module.exports = {
  GOAL_CUE_OVERLAY_SCHEMA,
  MAX_RELEVANCE,
  MIN_RELEVANCE,
  NEUTRAL_RELEVANCE,
  clearGoalOverlay,
  emptyGoalCueOverlay,
  getGoalCueRelevance,
  setGoalCueRelevance,
};
