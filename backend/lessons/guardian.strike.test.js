'use strict';

// hasRecentStrainStrike — the shared second-strike window rule exported by the
// guardian (the ONE place the windowing lives). safety-gates' warn tier keys on
// it. Prediction: threshold sits exactly at EASE_STRAIN_COUNT (2).

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  StrainGuardian,
  hasRecentStrainStrike,
  GUARDIAN_CONSTANTS,
} = require('./guardian');

test('strike rule: recentFlags >= EASE_STRAIN_COUNT (2), fail-closed on junk', () => {
  assert.equal(hasRecentStrainStrike(null), false);
  assert.equal(hasRecentStrainStrike(undefined), false);
  assert.equal(hasRecentStrainStrike({}), false);
  assert.equal(hasRecentStrainStrike({ recentFlags: 0 }), false);
  assert.equal(hasRecentStrainStrike({ recentFlags: 1 }), false);
  assert.equal(hasRecentStrainStrike({ recentFlags: 2 }), true);
  assert.equal(hasRecentStrainStrike({ recentFlags: 3 }), true);
  assert.equal(hasRecentStrainStrike({ recentFlags: 'x' }), false);
  assert.equal(GUARDIAN_CONSTANTS.EASE_STRAIN_COUNT, 2);
});

test('consistency with the accumulator: two strained takes in-window => strike', () => {
  const g = new StrainGuardian({ now: () => 0 });
  const strained = { metrics: { advanced: { quality: { strainRisk: 0.6 } } } };
  const clean = { metrics: { advanced: { quality: { strainRisk: 0.1 } } } };
  let decision = g.recordTake(strained);
  assert.equal(hasRecentStrainStrike(decision.strainWatch), false, 'one strained take is not a strike');
  decision = g.recordTake(clean);
  assert.equal(hasRecentStrainStrike(decision.strainWatch), false);
  decision = g.recordTake(strained);
  assert.equal(hasRecentStrainStrike(decision.strainWatch), true, '2 of last 4 takes strained -> strike');
});
