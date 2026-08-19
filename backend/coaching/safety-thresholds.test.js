'use strict';

// safety-thresholds — the canonical module must reproduce the adapter's exact
// semantics: threshold = ceiling != null ? min(fallback, clamp01(ceiling)+offset)
// : fallback. Contract (no profile): strain warn 0.52 / stop 0.70; breathy 0.68.
// Prediction (written before first run): every assertion below passes.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getVoiceSafetyThreshold,
  normalizeVoiceSafetyMetric,
  resolveStrainThresholds,
  resolveBreathyThreshold,
  BREATHY_WARN_FLOOR,
  VOICE_SAFETY_THRESHOLDS,
} = require('./safety-thresholds');

test('contract values with no profile (the fixed no-profile bug: was 0.10/0.24/0.12)', () => {
  const strain = resolveStrainThresholds({});
  assert.equal(strain.warn, 0.52);
  assert.equal(strain.stop, 0.7);
  assert.equal(strain.source, 'contract');
  const breathy = resolveBreathyThreshold({});
  assert.equal(breathy.warn, 0.68);
  assert.equal(breathy.source, 'contract');
  // Also with bands entirely absent
  assert.equal(resolveStrainThresholds(undefined).warn, 0.52);
  assert.equal(resolveBreathyThreshold(null).warn, 0.68);
});

test('profile ceiling TIGHTENS thresholds (offset semantics, not raw ceiling)', () => {
  const strain = resolveStrainThresholds({ strainRiskCeiling: 0.3 });
  // min(0.52, 0.3+0.10) = 0.40 ; min(0.70, 0.3+0.24) = 0.54
  assert.equal(strain.warn, 0.4);
  assert.equal(strain.stop, 0.54);
  assert.equal(strain.source, 'profile-capped');
  const breathy = resolveBreathyThreshold({ breathyRiskCeiling: 0.4 });
  assert.equal(breathy.warn, 0.52); // min(0.68, 0.4+0.12)
});

test('a ceiling can never LOOSEN past the contract fallback', () => {
  const strain = resolveStrainThresholds({ strainRiskCeiling: 0.9 });
  assert.equal(strain.warn, 0.52); // min(0.52, 1.0)
  assert.equal(strain.stop, 0.7); // min(0.70, 1.14)
});

test('a hysteresis band always exists: warn < stop for every ceiling (fire==stop fixed)', () => {
  for (const ceiling of [0, 0.1, 0.28, 0.3, 0.42, 0.5, 0.7, 0.9, 1]) {
    const { warn, stop } = resolveStrainThresholds({ strainRiskCeiling: ceiling });
    assert.ok(warn < stop, `ceiling ${ceiling}: warn ${warn} must be < stop ${stop}`);
  }
  const noProfile = resolveStrainThresholds({});
  assert.ok(noProfile.warn < noProfile.stop);
});

test('ceiling normalization mirrors the adapter (clamp to [0,1]; ""/null/NaN -> fallback)', () => {
  assert.equal(normalizeVoiceSafetyMetric(null), null);
  assert.equal(normalizeVoiceSafetyMetric(''), null);
  assert.equal(normalizeVoiceSafetyMetric('nope'), null);
  assert.equal(normalizeVoiceSafetyMetric(2), 1);
  assert.equal(normalizeVoiceSafetyMetric(-1), 0);
  // Out-of-range ceiling clamps first: clamp(2)=1 -> warn min(0.52, 1.1)=0.52
  assert.equal(getVoiceSafetyThreshold(2, 0.1, 0.52), 0.52);
  // Unparseable ceiling -> pure fallback
  assert.equal(getVoiceSafetyThreshold('x', 0.1, 0.52), 0.52);
  assert.equal(getVoiceSafetyThreshold(null, 0.24, 0.7), 0.7);
});

test('named constants match the adapter call sites verbatim', () => {
  assert.deepEqual(VOICE_SAFETY_THRESHOLDS.strain.warn, { offset: 0.1, fallback: 0.52 });
  assert.deepEqual(VOICE_SAFETY_THRESHOLDS.strain.stop, { offset: 0.24, fallback: 0.7 });
  assert.deepEqual(VOICE_SAFETY_THRESHOLDS.breathy.warn, { offset: 0.12, fallback: 0.68 });
});

// ---------------------------------------------------------------------------
// 2026-07-26 breath-nag repair: the breathy warn FLOOR.
// ---------------------------------------------------------------------------

test('breathy warn has an absolute floor of 0.45 no matter how tight the profile', () => {
  // The live defect: a clean reference clip gave a very low breathyRiskCeiling,
  // so ceiling+0.12 resolved to breathy_warn = 0.22 in the coach_gates witness
  // and the breathy issue fired on nearly every take.
  const tight = resolveBreathyThreshold({ breathyRiskCeiling: 0.1 });
  assert.equal(tight.warn, BREATHY_WARN_FLOOR);
  assert.equal(tight.warn, 0.45);
  assert.equal(tight.floored, true);
  // The exact live observation (ceiling 0.10 -> 0.22) can no longer occur.
  assert.ok(tight.warn > 0.22);
  // Source reporting is unchanged — the profile still capped, the floor caught it.
  assert.equal(tight.source, 'profile-capped');
});

test('the floor never RAISES a threshold that already clears it', () => {
  // ceiling 0.4 -> min(0.68, 0.52) = 0.52, already above the floor: untouched.
  const mid = resolveBreathyThreshold({ breathyRiskCeiling: 0.4 });
  assert.equal(mid.warn, 0.52);
  assert.equal(mid.floored, false);
  // No profile at all keeps the 0.68 contract fallback exactly.
  const contract = resolveBreathyThreshold({});
  assert.equal(contract.warn, 0.68);
  assert.equal(contract.floored, false);
  assert.equal(resolveBreathyThreshold(null).warn, 0.68);
});

test('the floor is breathy-only: strain tiers are untouched owner safety law', () => {
  // A ceiling of 0.1 would resolve strain warn to 0.20 and stop to 0.34 — both
  // far below the breathy floor, and both must stay exactly where they are.
  const strain = resolveStrainThresholds({ strainRiskCeiling: 0.1 });
  assert.equal(Number(strain.warn.toFixed(10)), 0.2);
  assert.equal(Number(strain.stop.toFixed(10)), 0.34);
  assert.equal(strain.warn < BREATHY_WARN_FLOOR, true);
  assert.equal(strain.stop < BREATHY_WARN_FLOOR, true);
});
