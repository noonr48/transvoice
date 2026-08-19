'use strict';

const FEEDBACK_SCHEDULE_SCHEMA = 'transvoice.feedback_schedule.v1';
const MASTERY_REVIEW_SCHEMA = 'transvoice.mastery_review.v1';

/**
 * Named, versioned fading policy (plan §9.4 / §13). Not hidden constants:
 * the schedule below is the reviewable pedagogy itself.
 */
function defaultFeedbackPolicy() {
  return {
    schema: FEEDBACK_SCHEDULE_SCHEMA,
    policyId: 'fem-v1.feedback.basic-fade.v1',
    policyVersion: '1',
    fullGuideAttempts: 2, // attempts 1-2 in a block: full live guide
    postTakeOnlyAttempts: 1, // attempt 3: feedback only after the take
    hiddenGuideFromAttempt: 4, // attempt >= 4: guide hidden (the attempt is the test)
    noFeedbackVerifiedForNewPrompt: 1, // a verified hidden/no-feedback attempt earns a new prompt
    noFeedbackEvidenceForRetentionCheck: 2, // later sessions retention-check after this much evidence
    reviewWindowDays: 30, // mastered-without-review staleness window
  };
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

function resolvePolicy(policy) {
  return policy && typeof policy === 'object' && !Array.isArray(policy)
    && typeof policy.policyId === 'string' && policy.policyId.trim()
    ? policy
    : defaultFeedbackPolicy();
}

/**
 * The deterministic feedback-fading decision for one practice block.
 *
 * The goal is that the learner owns the voice, not that they steer a graph:
 * the schedule deliberately WITHDRAWS feedback as verified no-feedback
 * evidence accumulates. Guided success alone never fades the guide, and a
 * hidden-guide attempt is a test, not a reward.
 *
 * Fail-closed direction: unknown attempt counts produce the FULL guide —
 * an unknown can never skip a learner ahead.
 */
function nextFeedbackMode({
  attemptInBlock = null,
  learner = {},
  newSession = false,
  policy = null,
} = {}) {
  const resolved = resolvePolicy(policy);
  const noFeedbackVerified = nonNegativeInt(learner.noFeedbackVerified);
  const retentionVerified = learner.retentionVerified === true;
  const attempt = finiteOrNull(attemptInBlock);

  const base = {
    schema: resolved.schema,
    policyId: resolved.policyId,
    policyVersion: String(resolved.policyVersion || '1'),
    noFeedbackVerified,
    // Consistent with masteryReviewState: retention evidence without at least
    // one no-feedback verification is not established stability.
    stabilityAchieved: retentionVerified && noFeedbackVerified >= 1,
  };

  // A later session begins with a retention check before any guide returns —
  // but only when there is already no-feedback evidence worth re-testing.
  if (newSession
    && !retentionVerified
    && noFeedbackVerified >= resolved.noFeedbackEvidenceForRetentionCheck) {
    return { ...base, feedbackMode: 'retention_check' };
  }

  if (attempt == null || attempt < 1) {
    return { ...base, feedbackMode: 'full_guide', reason: 'attempt_count_unknown' };
  }
  if (attempt <= resolved.fullGuideAttempts) {
    return { ...base, feedbackMode: 'full_guide' };
  }
  if (attempt <= resolved.fullGuideAttempts + resolved.postTakeOnlyAttempts) {
    return { ...base, feedbackMode: 'post_take_only' };
  }
  if (noFeedbackVerified >= resolved.noFeedbackVerifiedForNewPrompt) {
    return { ...base, feedbackMode: 'new_prompt' };
  }
  return { ...base, feedbackMode: 'hidden_guide' };
}

/**
 * Mastery staleness (plan §6.4 / backlog TV-FEM-P1-003): a skill that was
 * demonstrated without feedback is never permanently "mastered" — it becomes
 * review_due after the policy window. Missing evidence is not established;
 * a missing timestamp cannot masquerade as fresh.
 */
function masteryReviewState({
  learner = {},
  now = null,
  policy = null,
} = {}) {
  const resolved = resolvePolicy(policy);
  const noFeedbackVerified = nonNegativeInt(learner.noFeedbackVerified);
  const base = {
    schema: MASTERY_REVIEW_SCHEMA,
    policyId: resolved.policyId,
    policyVersion: String(resolved.policyVersion || '1'),
    noFeedbackVerified,
  };

  if (noFeedbackVerified < 1 || learner.retentionVerified !== true) {
    return { ...base, reviewState: 'not_established' };
  }
  const lastVerifiedAt = finiteOrNull(learner.lastNoFeedbackVerifiedAt);
  const nowMs = finiteOrNull(now);
  if (lastVerifiedAt == null || nowMs == null) {
    // Unknown time is unknown — never silently fresh.
    return { ...base, reviewState: 'review_due', reason: 'last_verified_time_unknown' };
  }
  const windowMs = resolved.reviewWindowDays * 24 * 60 * 60 * 1000;
  const ageMs = nowMs - lastVerifiedAt;
  if (ageMs <= windowMs) {
    return { ...base, reviewState: 'current', ageDays: Math.floor(ageMs / 86400000) };
  }
  return {
    ...base,
    reviewState: 'review_due',
    ageDays: Math.floor(ageMs / 86400000),
    reviewWindowDays: resolved.reviewWindowDays,
  };
}

module.exports = {
  FEEDBACK_SCHEDULE_SCHEMA,
  MASTERY_REVIEW_SCHEMA,
  defaultFeedbackPolicy,
  masteryReviewState,
  nextFeedbackMode,
};
