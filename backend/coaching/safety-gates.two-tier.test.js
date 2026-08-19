'use strict';

// Two-tier voice-safety triggers (2026-07-18 truth+safety wave).
//   stop tier: strainRisk >= 0.70 (contract) -> immediate 'stop', single take.
//   warn tier: >= 0.52 but < 0.70 -> fires as 'reset' ONLY on a second recent
//   strike (guardian window: strainWatch.recentFlags >= 2 of last 4 takes).
//   breathy >= 0.68 is warn-only, same second-strike gate.
// Capture checks are unchanged. Prediction: all assertions pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { assessSafetyState, collectAnalyzerSafetyReasons } = require('./safety-gates');

function vs({ strainRisk, breathyRisk, recentFlags, ceiling } = {}) {
  const state = {
    lastSummary: { metrics: { advanced: { quality: {} } } },
  };
  if (strainRisk != null) state.lastSummary.metrics.advanced.quality.strainRisk = strainRisk;
  if (breathyRisk != null) state.lastSummary.metrics.advanced.quality.breathyRisk = breathyRisk;
  if (recentFlags != null) state.strainWatch = { recentFlags, sessionMinutes: 5 };
  if (ceiling != null) {
    state.targetVoiceProfile = { advancedBands: { quality: { strainRiskCeiling: ceiling } } };
  }
  return state;
}

test('warn-tier strain on a SINGLE take does not interrupt (no second strike)', () => {
  const result = assessSafetyState(vs({ strainRisk: 0.6 }));
  assert.equal(result.state, 'normal');
  assert.deepEqual(result.reasons, []);
  assert.equal(result.witness.strain.tier, 'warn-suppressed');
  assert.equal(result.witness.strain.strikes, 0);
});

test('warn-tier strain WITH a second recent strike fires as reset (fatigue_or_strain)', () => {
  const result = assessSafetyState(vs({ strainRisk: 0.6, recentFlags: 2 }));
  assert.equal(result.state, 'fatigue_or_strain');
  assert.ok(result.reasons.some((r) => r.includes('acoustic strain risk 60%')));
  assert.equal(result.witness.strain.tier, 'warn-fired');
  assert.equal(result.witness.strain.strikes, 2);
  const reasons = collectAnalyzerSafetyReasons(vs({ strainRisk: 0.6, recentFlags: 2 }));
  assert.equal(reasons[0].severity, 'reset');
  assert.equal(reasons[0].kind, 'voice');
});

test('stop-tier strain stops IMMEDIATELY on a single take (safety first, no strikes needed)', () => {
  const result = assessSafetyState(vs({ strainRisk: 0.75 }));
  assert.equal(result.state, 'stop');
  assert.equal(result.witness.strain.tier, 'stop');
  const reasons = collectAnalyzerSafetyReasons(vs({ strainRisk: 0.75 }));
  assert.equal(reasons[0].severity, 'stop');
});

test('old-bug regression: mild strain (0.2, once a false trigger at 0.10) stays normal', () => {
  assert.equal(assessSafetyState(vs({ strainRisk: 0.2 })).state, 'normal');
  // ...even with prior strikes: 0.2 is below the warn threshold entirely.
  assert.equal(assessSafetyState(vs({ strainRisk: 0.2, recentFlags: 3 })).state, 'normal');
});

test('breathy is warn-only and second-strike gated', () => {
  // Single breathy take, even high: suppressed.
  const single = assessSafetyState(vs({ breathyRisk: 0.7 }));
  assert.equal(single.state, 'normal');
  assert.equal(single.witness.breathy.tier, 'warn-suppressed');
  // With a second strike: reset-tier voice reason.
  const struck = assessSafetyState(vs({ breathyRisk: 0.7, recentFlags: 2 }));
  assert.equal(struck.state, 'fatigue_or_strain');
  assert.equal(struck.witness.breathy.tier, 'warn-fired');
  // Below the 0.68 bar (the fixed 0.12 magic): nothing, strikes or not.
  assert.equal(assessSafetyState(vs({ breathyRisk: 0.5, recentFlags: 3 })).state, 'normal');
});

test('profile ceiling keeps DISTINCT warn/stop tiers (fire==stop collapse fixed)', () => {
  // ceiling 0.3 -> warn 0.40, stop 0.54.
  const warnOnly = assessSafetyState(vs({ strainRisk: 0.45, ceiling: 0.3, recentFlags: 2 }));
  assert.equal(warnOnly.state, 'fatigue_or_strain');
  assert.equal(warnOnly.witness.strain.source, 'profile-capped');
  const warnSuppressed = assessSafetyState(vs({ strainRisk: 0.45, ceiling: 0.3 }));
  assert.equal(warnSuppressed.state, 'normal');
  const stop = assessSafetyState(vs({ strainRisk: 0.6, ceiling: 0.3 }));
  assert.equal(stop.state, 'stop');
});

test('capture checks are unchanged and unaffected by strike state', () => {
  const bad = { voiceInputRuntime: { lastSnrDb: 5, lastOutcome: 'ok' }, strainWatch: { recentFlags: 0 } };
  assert.equal(assessSafetyState(bad).state, 'capture_only');
  const clean = { voiceInputRuntime: { lastSnrDb: null, lastOutcome: 'idle' } };
  assert.equal(assessSafetyState(clean).state, 'normal');
});
