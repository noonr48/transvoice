'use strict';

const { SERVABLE_CUE_REVIEW_STATUSES } = require('./feminization-v1-controller');

const CUE_SERVED_EVENT_SCHEMA = 'transvoice.cue_served_event.v1';

// Trial binding seam: createPendingMotorTrial (motor-trial.js) accepts a
// cueServeEvent and refuses creation when it is missing or ineligible under
// requireCueServeEvent: true. The runtime wiring (P2 slice integration) is
// the caller that supplies both; this module itself performs no IO.

// Named acknowledgement window: the learner must confirm they received the cue
// within this window of the serve, and the exact-next eligible attempt must
// follow within the same window, or the serve can no longer earn credit.
const SERVE_ACKNOWLEDGEMENT_WINDOW_MS = 10 * 60 * 1000;

function textOrNull(value, maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function finiteOrNull(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Cue-served lifecycle (plan §13 / §6.6): a pending motor trial can earn
 * causal credit only when the reviewed cue was ACTUALLY served to the learner
 * and the delivery was acknowledged, within a bounded window. This module
 * records that evidence as its own event stream — the runtime wiring stores
 * the event id on the pending trial at creation time.
 *
 * Laws enforced here:
 * - No active unreviewed cue: serves of anything outside the approved review
 *   statuses are refused before an event exists.
 * - Shadow never learns: shadow mode cannot produce a served event at all.
 * - Unknown is not zero: an acknowledgement with no timestamp never becomes
 *   eligible; a missing acknowledgement never does either.
 */
function recordCueServed({
  cue = null,
  sessionId = null,
  servedAt = null,
  mode = 'active',
} = {}) {
  if (!cue || typeof cue !== 'object' || Array.isArray(cue)) {
    return { status: 'not_recorded', reason: 'cue_required', event: null };
  }
  if (mode !== 'active') {
    // Shadow and any unknown mode fail closed: only an explicitly active serve
    // can exist, so a shadow decision can never earn causal credit.
    return { status: 'not_recorded', reason: 'shadow_mode_cannot_serve', event: null };
  }
  const cueId = textOrNull(cue.cueId, 200);
  const reviewStatus = textOrNull(cue.reviewStatus, 120);
  if (!cueId) {
    return { status: 'not_recorded', reason: 'cue_required', event: null };
  }
  if (!SERVABLE_CUE_REVIEW_STATUSES.includes(reviewStatus)) {
    return { status: 'not_recorded', reason: 'cue_review_status_not_servable', event: null };
  }
  const resolvedSessionId = textOrNull(sessionId, 200);
  if (!resolvedSessionId) {
    return { status: 'not_recorded', reason: 'session_id_required', event: null };
  }
  const resolvedServedAt = finiteOrNull(servedAt);
  if (resolvedServedAt == null) {
    return { status: 'not_recorded', reason: 'served_at_required', event: null };
  }
  return {
    status: 'recorded',
    reason: null,
    event: {
      schema: CUE_SERVED_EVENT_SCHEMA,
      cueId,
      cueReviewStatus: reviewStatus,
      sessionId: resolvedSessionId,
      servedAt: resolvedServedAt,
      acknowledged: false,
      acknowledgedAt: null,
      acknowledgementWindowMs: SERVE_ACKNOWLEDGEMENT_WINDOW_MS,
    },
  };
}

function acknowledgeCueServe({ event = null, acknowledgedAt = null } = {}) {
  if (!event || event.schema !== CUE_SERVED_EVENT_SCHEMA || event.acknowledged === true) {
    return { status: 'not_acknowledged', reason: 'serve_event_required', event };
  }
  const resolvedAt = finiteOrNull(acknowledgedAt);
  if (resolvedAt == null || resolvedAt < event.servedAt) {
    return { status: 'not_acknowledged', reason: 'acknowledged_at_invalid', event };
  }
  return {
    status: 'acknowledged',
    reason: null,
    event: { ...event, acknowledged: true, acknowledgedAt: resolvedAt },
  };
}

function cueServeEligibility({ event = null, at = null } = {}) {
  if (!event || event.schema !== CUE_SERVED_EVENT_SCHEMA) {
    return { eligible: false, reason: 'serve_event_required' };
  }
  // Re-check the carried review status: a forged or stale event must not
  // bypass the no-unreviewed-cue law at eligibility time.
  if (!SERVABLE_CUE_REVIEW_STATUSES.includes(event.cueReviewStatus)) {
    return { eligible: false, reason: 'cue_review_status_not_servable' };
  }
  if (event.acknowledged !== true || finiteOrNull(event.acknowledgedAt) == null) {
    return { eligible: false, reason: 'serve_not_acknowledged' };
  }
  // Forged events: acknowledgement cannot precede the serve itself. The
  // acknowledge path enforces ordering, but eligibility must not trust the
  // event's history — re-verify here.
  if (event.acknowledgedAt < event.servedAt) {
    return { eligible: false, reason: 'acknowledgement_time_invalid' };
  }
  const atMs = finiteOrNull(at);
  if (atMs == null) {
    return { eligible: false, reason: 'eligibility_time_required' };
  }
  // Exact-next causality: only a take AT OR AFTER the acknowledgement can
  // earn credit for this serve. A take between serve and acknowledgement is
  // not a response to the cue.
  if (atMs < event.acknowledgedAt) {
    return { eligible: false, reason: 'serve_not_yet_acknowledged_at_take' };
  }
  if (atMs - event.servedAt > SERVE_ACKNOWLEDGEMENT_WINDOW_MS) {
    return { eligible: false, reason: 'serve_expired' };
  }
  return { eligible: true, reason: null };
}

module.exports = {
  CUE_SERVED_EVENT_SCHEMA,
  SERVE_ACKNOWLEDGEMENT_WINDOW_MS,
  acknowledgeCueServe,
  cueServeEligibility,
  recordCueServed,
};
