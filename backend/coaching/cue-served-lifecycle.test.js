'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CUE_SERVED_EVENT_SCHEMA,
  SERVE_ACKNOWLEDGEMENT_WINDOW_MS,
  cueServeEligibility,
  recordCueServed,
  acknowledgeCueServe,
} = require('./cue-served-lifecycle');

const now = 1755400000000;

function servableCue() {
  return { cueId: 'pitch.register.small-glide-up.v1', reviewStatus: 'approved_internal' };
}

test('recording a serve creates a versioned event; acknowledgement is a separate step', () => {
  const served = recordCueServed({
    cue: servableCue(),
    sessionId: 's-1',
    servedAt: now,
  });
  assert.equal(served.status, 'recorded');
  assert.equal(served.event.schema, CUE_SERVED_EVENT_SCHEMA);
  assert.equal(served.event.cueId, 'pitch.register.small-glide-up.v1');
  assert.equal(served.event.acknowledged, false);

  const ack = acknowledgeCueServe({ event: served.event, acknowledgedAt: now + 1500 });
  assert.equal(ack.event.acknowledged, true);
  assert.equal(ack.event.acknowledgedAt, now + 1500);
});

test('an unacknowledged serve can never make a trial creditable (exact-next causality)', () => {
  const served = recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now });
  const eligibility = cueServeEligibility({ event: served.event, at: now + 1000 });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'serve_not_acknowledged');
});

test('acknowledged serve inside the window is eligible; expired acknowledgement is not', () => {
  const served = recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now });
  const ack = acknowledgeCueServe({ event: served.event, acknowledgedAt: now + 1000 });
  const inside = cueServeEligibility({ event: ack.event, at: now + 60_000 });
  assert.equal(inside.eligible, true);

  const outside = cueServeEligibility({ event: ack.event, at: now + SERVE_ACKNOWLEDGEMENT_WINDOW_MS + 1 });
  assert.equal(outside.eligible, false);
  assert.equal(outside.reason, 'serve_expired');
});

test('no active unreviewed cue: a clinical-review-required cue cannot even be served', () => {
  const refused = recordCueServed({
    cue: { cueId: 'pitch.register.small-glide-up.v1', reviewStatus: 'clinical-review-required' },
    sessionId: 's-1',
    servedAt: now,
  });
  assert.equal(refused.status, 'not_recorded');
  assert.equal(refused.reason, 'cue_review_status_not_servable');
  assert.equal(refused.event, null);
});

test('shadow never learns: a shadow-mode serve is refused outright', () => {
  const refused = recordCueServe_forShadow();
  function recordCueServe_forShadow() {
    return recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now, mode: 'shadow' });
  }
  assert.equal(refused.status, 'not_recorded');
  assert.equal(refused.reason, 'shadow_mode_cannot_serve');
});

test('malformed inputs fail closed, never invent a served event', () => {
  const noCue = recordCueServed({ sessionId: 's-1', servedAt: now });
  assert.equal(noCue.status, 'not_recorded');
  assert.equal(noCue.reason, 'cue_required');

  const noSession = recordCueServed({ cue: servableCue(), servedAt: now });
  assert.equal(noSession.status, 'not_recorded');
  assert.equal(noSession.reason, 'session_id_required');

  const garbage = recordCueServed({ cue: 'not-an-object', sessionId: 's-1', servedAt: now });
  assert.equal(garbage.status, 'not_recorded');
});

test('unknown acknowledgement time is never eligible (unknown is not zero)', () => {
  const served = recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now });
  const forged = { ...served.event, acknowledged: true, acknowledgedAt: null };
  const eligibility = cueServeEligibility({ event: forged, at: now + 1000 });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'serve_not_acknowledged');
});

test('double acknowledgement is refused (acknowledgement is single-shot)', () => {
  const served = recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now });
  const first = acknowledgeCueServe({ event: served.event, acknowledgedAt: now + 1000 });
  assert.equal(first.status, 'acknowledged');
  const second = acknowledgeCueServe({ event: first.event, acknowledgedAt: now + 2000 });
  assert.equal(second.status, 'not_acknowledged');
});

test('a take before the acknowledgement cannot earn credit (exact-next order)', () => {
  const served = recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now });
  const ack = acknowledgeCueServe({ event: served.event, acknowledgedAt: now + 5000 });
  const early = cueServeEligibility({ event: ack.event, at: now + 3000 });
  assert.equal(early.eligible, false);
  assert.equal(early.reason, 'serve_not_yet_acknowledged_at_take');
  const onTime = cueServeEligibility({ event: ack.event, at: now + 5000 });
  assert.equal(onTime.eligible, true);
});

test('a forged event with a non-servable review status fails eligibility', () => {
  const served = recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now });
  const forged = {
    ...served.event,
    acknowledged: true,
    acknowledgedAt: now + 1000,
    cueReviewStatus: 'clinical-review-required',
  };
  const eligibility = cueServeEligibility({ event: forged, at: now + 2000 });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'cue_review_status_not_servable');
});

test('a forged time-inverted event (acknowledged before served) fails eligibility', () => {
  const served = recordCueServed({ cue: servableCue(), sessionId: 's-1', servedAt: now });
  const inverted = {
    ...served.event,
    acknowledged: true,
    acknowledgedAt: now - 500, // before the serve itself
  };
  const eligibility = cueServeEligibility({ event: inverted, at: now + 1000 });
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'acknowledgement_time_invalid');
});
