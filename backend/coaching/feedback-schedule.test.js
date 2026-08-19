'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FEEDBACK_SCHEDULE_SCHEMA,
  MASTERY_REVIEW_SCHEMA,
  defaultFeedbackPolicy,
  nextFeedbackMode,
  masteryReviewState,
} = require('./feedback-schedule');

function learner({ noFeedbackVerified = 0, retentionVerified = false, lastNoFeedbackVerifiedAt = null } = {}) {
  return { noFeedbackVerified, retentionVerified, lastNoFeedbackVerifiedAt };
}

test('fresh guided attempts get the full guide, then post-take only, then hidden guide', () => {
  const policy = defaultFeedbackPolicy();
  assert.equal(nextFeedbackMode({ attemptInBlock: 1, learner: learner(), policy }).feedbackMode, 'full_guide');
  assert.equal(nextFeedbackMode({ attemptInBlock: 2, learner: learner(), policy }).feedbackMode, 'full_guide');
  assert.equal(nextFeedbackMode({ attemptInBlock: 3, learner: learner(), policy }).feedbackMode, 'post_take_only');
  assert.equal(nextFeedbackMode({ attemptInBlock: 4, learner: learner(), policy }).feedbackMode, 'hidden_guide');
  assert.equal(nextFeedbackMode({ attemptInBlock: 9, learner: learner(), policy }).feedbackMode, 'hidden_guide');
});

test('every schedule decision carries the versioned policy id and schema', () => {
  const result = nextFeedbackMode({ attemptInBlock: 1, learner: learner(), policy: defaultFeedbackPolicy() });
  assert.equal(result.schema, FEEDBACK_SCHEDULE_SCHEMA);
  assert.equal(result.policyId, 'fem-v1.feedback.basic-fade.v1');
  assert.equal(result.policyVersion, '1');
});

test('a new prompt is offered after a verified hidden-guide attempt', () => {
  const result = nextFeedbackMode({
    attemptInBlock: 5,
    learner: learner({ noFeedbackVerified: 1 }),
    policy: defaultFeedbackPolicy(),
  });
  assert.equal(result.feedbackMode, 'new_prompt');
});

test('later sessions get a retention check before any guide is shown', () => {
  const result = nextFeedbackMode({
    attemptInBlock: 1,
    newSession: true,
    learner: learner({ noFeedbackVerified: 2, retentionVerified: false }),
    policy: defaultFeedbackPolicy(),
  });
  assert.equal(result.feedbackMode, 'retention_check');
});

test('stability requires no-feedback evidence: guided success alone never fades the guide', () => {
  const result = nextFeedbackMode({
    attemptInBlock: 4,
    learner: learner({ noFeedbackVerified: 0 }),
    policy: defaultFeedbackPolicy(),
  });
  assert.equal(result.feedbackMode, 'hidden_guide'); // hidden guide is a TEST, not a reward
  assert.equal(result.stabilityAchieved, false);
});

test('unknown attempt counts fail closed to the full guide (never skip ahead)', () => {
  const policy = defaultFeedbackPolicy();
  const none = nextFeedbackMode({ learner: learner(), policy });
  assert.equal(none.feedbackMode, 'full_guide');
  const garbage = nextFeedbackMode({ attemptInBlock: 'later', learner: learner(), policy });
  assert.equal(garbage.feedbackMode, 'full_guide');
});

test('retention verified in a later session completes the stable-mastery evidence path', () => {
  const result = nextFeedbackMode({
    attemptInBlock: 1,
    newSession: true,
    learner: learner({ noFeedbackVerified: 2, retentionVerified: true }),
    policy: defaultFeedbackPolicy(),
  });
  assert.equal(result.feedbackMode, 'full_guide'); // guide may return; retention already proven
  assert.equal(result.stabilityAchieved, true);
});

test('review_due: mastered skill goes stale after the policy window, never silently stays mastered', () => {
  const policy = defaultFeedbackPolicy();
  const now = 1755400000000;
  const fresh = masteryReviewState({
    learner: learner({ noFeedbackVerified: 2, retentionVerified: true, lastNoFeedbackVerifiedAt: now - 86400000 }),
    now,
    policy,
  });
  assert.equal(fresh.schema, MASTERY_REVIEW_SCHEMA);
  assert.equal(fresh.reviewState, 'current');

  const stale = masteryReviewState({
    learner: learner({ noFeedbackVerified: 2, retentionVerified: true, lastNoFeedbackVerifiedAt: now - 45 * 86400000 }),
    now,
    policy,
  });
  assert.equal(stale.reviewState, 'review_due');

  const never = masteryReviewState({ learner: learner(), now, policy });
  assert.equal(never.reviewState, 'not_established'); // no evidence, never "mastered"
});

test('unknown last-verified time cannot become fresh (unknown is not zero)', () => {
  const stale = masteryReviewState({
    learner: learner({ noFeedbackVerified: 2, retentionVerified: true, lastNoFeedbackVerifiedAt: null }),
    now: 1755400000000,
    policy: defaultFeedbackPolicy(),
  });
  assert.equal(stale.reviewState, 'review_due');
});

test('contradictory shape: retention claim without no-feedback evidence is not stability', () => {
  const shape = learner({ noFeedbackVerified: 0, retentionVerified: true });
  const schedule = nextFeedbackMode({
    attemptInBlock: 4,
    learner: shape,
    policy: defaultFeedbackPolicy(),
  });
  assert.equal(schedule.stabilityAchieved, false);
  assert.equal(schedule.feedbackMode, 'hidden_guide');
  const review = masteryReviewState({
    learner: shape,
    now: 1755400000000,
    policy: defaultFeedbackPolicy(),
  });
  assert.equal(review.reviewState, 'not_established');
});
