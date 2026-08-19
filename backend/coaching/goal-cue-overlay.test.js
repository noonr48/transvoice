'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  GOAL_CUE_OVERLAY_SCHEMA,
  clearGoalOverlay,
  emptyGoalCueOverlay,
  getGoalCueRelevance,
  setGoalCueRelevance,
} = require('./goal-cue-overlay');
const { buildLearnerMotorResponse } = require('./learner-motor-response');
const { MOTOR_MAP_SCHEMA } = require('./motor-map');

function scopedMap() {
  return {
    schema: MOTOR_MAP_SCHEMA,
    byCue: {
      'c.v1': {
        attempts: 2, successes: 1, verifiedFailures: 1, confounded: 0, partialEvidence: 0,
        meanTargetGain: 0.3, meanVerifiedTargetGain: 0.5, verifiedGainObservations: 1,
        meanProtectedDrift: 0, protectedObservations: 2, missingProtectedEvidence: 0,
        meanEffortDelta: 0, effortObservations: 2,
        byDimension: {
          'pitch.register': {
            attempts: 2, successes: 1, verifiedFailures: 1,
            meanTargetGain: 0.3, meanVerifiedTargetGain: 0.5, verifiedGainObservations: 1,
          },
        },
      },
    },
  };
}

test('relevance defaults to neutral 1; set/get bounded and immutable', () => {
  const overlay = emptyGoalCueOverlay();
  assert.equal(overlay.schema, GOAL_CUE_OVERLAY_SCHEMA);
  assert.equal(getGoalCueRelevance(overlay, 'goal-1', 'c.v1'), 1); // neutral default
  const next = setGoalCueRelevance(overlay, { goalProfileId: 'goal-1', cueId: 'c.v1', relevance: 1.4 });
  assert.equal(getGoalCueRelevance(next, 'goal-1', 'c.v1'), 1.4);
  // Clamped to [0, 2]:
  assert.equal(getGoalCueRelevance(setGoalCueRelevance(next, { goalProfileId: 'g', cueId: 'c.v1', relevance: 99 }), 'g', 'c.v1'), 2);
  assert.equal(getGoalCueRelevance(setGoalCueRelevance(next, { goalProfileId: 'g', cueId: 'c.v1', relevance: -9 }), 'g', 'c.v1'), 0);
  // Original overlay untouched (immutability):
  assert.equal(getGoalCueRelevance(overlay, 'goal-1', 'c.v1'), 1);
});

test('clearing a goal overlay removes only that goal — other goals preserved', () => {
  let overlay = emptyGoalCueOverlay();
  overlay = setGoalCueRelevance(overlay, { goalProfileId: 'goal-1', cueId: 'c.v1', relevance: 1.3 });
  overlay = setGoalCueRelevance(overlay, { goalProfileId: 'goal-2', cueId: 'c.v1', relevance: 0.8 });
  const cleared = clearGoalOverlay(overlay, 'goal-1');
  assert.equal(getGoalCueRelevance(cleared, 'goal-1', 'c.v1'), 1); // back to neutral
  assert.equal(getGoalCueRelevance(cleared, 'goal-2', 'c.v1'), 0.8); // untouched
});

test('goal overlay is separate from the learner-general response — ops never cross', () => {
  const response = buildLearnerMotorResponse({ maps: [scopedMap()] });
  const snapshot = JSON.parse(JSON.stringify(response));
  // A reference/goal change: clear overlay + set new overlay…
  let overlay = setGoalCueRelevance(emptyGoalCueOverlay(), { goalProfileId: 'old-goal', cueId: 'c.v1', relevance: 1.5 });
  overlay = clearGoalOverlay(overlay, 'old-goal');
  overlay = setGoalCueRelevance(overlay, { goalProfileId: 'new-goal', cueId: 'c.v1', relevance: 0.9 });
  // …and the learner-general motor knowledge is untouched.
  assert.deepEqual(response, snapshot);
  assert.equal(getGoalCueRelevance(overlay, 'new-goal', 'c.v1'), 0.9);
});

test('malformed goal/cue ids are ignored; non-number relevance stays neutral', () => {
  let overlay = emptyGoalCueOverlay();
  overlay = setGoalCueRelevance(overlay, { goalProfileId: '', cueId: 'c.v1', relevance: 1.5 });
  overlay = setGoalCueRelevance(overlay, { goalProfileId: 'g', cueId: null, relevance: 1.5 });
  overlay = setGoalCueRelevance(overlay, { goalProfileId: 'g', cueId: 'c.v1', relevance: 'high' });
  overlay = setGoalCueRelevance(overlay, { goalProfileId: 'g', cueId: 'c.v1', relevance: Number.NaN });
  assert.deepEqual(overlay.byGoal, {}); // nothing landed — fail closed to no overlay
});

test('cycle-2 minor-1 kill: the READ clamp holds for forged out-of-band overlays', () => {
  // Counterfactual pin: deleting the clamp inside getGoalCueRelevance must
  // turn this red — the producer clamp alone cannot protect the read path.
  const forged = {
    schema: 'transvoice.goal_cue_overlay.v1',
    byGoal: {
      'g': { 'c.v1': 99, 'c.v2': -9 },
    },
  };
  assert.equal(getGoalCueRelevance(forged, 'g', 'c.v1'), 2);
  assert.equal(getGoalCueRelevance(forged, 'g', 'c.v2'), 0);
});
