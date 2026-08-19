'use strict';

// 2026-07-19 zero-friction wave: LENIENT VOCALISE STRAIN.
// Mechanism (decided): a RAISED WARN BAR for vocalise take kinds
// (sustained/hum_sovt/siren) — the analyzer's HNR term reads clean sustained
// phonation as strain, and that false elevation lands in the warn band.
// The STOP tier is NEVER adjusted (hard-stop intact for genuinely extreme
// values), and warn < stop always survives (no hysteresis collapse).
// Tests run BOTH directions: leniency where owed, unchanged strictness where not.
// Prediction: all assertions pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveStrainThresholds,
  isVocaliseTakeKind,
  VOCALISE_TAKE_KINDS,
} = require('./safety-thresholds');
const { assessSafetyState } = require('./safety-gates');
const { detectIssues } = require('./signal-builder');

function vs({ strainRisk, recentFlags, ceiling } = {}) {
  const state = { lastSummary: { metrics: { advanced: { quality: {} } } } };
  if (strainRisk != null) state.lastSummary.metrics.advanced.quality.strainRisk = strainRisk;
  if (recentFlags != null) state.strainWatch = { recentFlags, sessionMinutes: 5 };
  if (ceiling != null) {
    state.targetVoiceProfile = { advancedBands: { quality: { strainRiskCeiling: ceiling } } };
  }
  return state;
}

test('thresholds: vocalise kinds lift WARN only; stop identical; interpretation named', () => {
  const standard = resolveStrainThresholds({});
  const lenient = resolveStrainThresholds({}, { takeKind: 'siren' });
  assert.equal(standard.warn, 0.52);
  assert.equal(standard.stop, 0.7);
  assert.equal(standard.interpretation, 'standard');
  assert.equal(lenient.warn, 0.62);           // 0.52 + 0.10 lift
  assert.equal(lenient.stop, 0.7);            // hard-stop untouched
  assert.equal(lenient.interpretation, 'vocalise-lenient');
  // all three vocalise kinds get it; phrase does not
  for (const kind of VOCALISE_TAKE_KINDS) {
    assert.equal(resolveStrainThresholds({}, { takeKind: kind }).interpretation, 'vocalise-lenient');
    assert.ok(isVocaliseTakeKind(kind));
  }
  assert.equal(resolveStrainThresholds({}, { takeKind: 'phrase' }).interpretation, 'standard');
  assert.ok(!isVocaliseTakeKind('phrase'));
});

test('thresholds: warn < stop for every profile ceiling (no hysteresis collapse)', () => {
  for (let c = 0.05; c <= 1.0; c += 0.05) {
    const t = resolveStrainThresholds({ strainRiskCeiling: c }, { takeKind: 'sustained' });
    assert.ok(t.warn < t.stop, `collapse at ceiling ${c.toFixed(2)}: warn ${t.warn} stop ${t.stop}`);
    // and the lenient warn never drops below the standard warn
    const base = resolveStrainThresholds({ strainRiskCeiling: c });
    assert.ok(t.warn >= base.warn);
    assert.equal(t.stop, base.stop, 'stop must be identical with and without leniency');
  }
});

test('gate LENIENT direction: 0.60 strain + second strike interrupts a phrase, NOT a siren', () => {
  const phrase = assessSafetyState(vs({ strainRisk: 0.6, recentFlags: 2 }), { takeKind: 'phrase' });
  assert.equal(phrase.state, 'fatigue_or_strain');
  assert.equal(phrase.witness.strain.interpretation, 'standard');

  const siren = assessSafetyState(vs({ strainRisk: 0.6, recentFlags: 2 }), { takeKind: 'siren' });
  assert.equal(siren.state, 'normal'); // 0.60 < lenient warn 0.62
  assert.equal(siren.witness.strain.interpretation, 'vocalise-lenient');
  assert.equal(siren.witness.strain.takeKind, 'siren');
  assert.equal(siren.witness.strain.warn, 0.62);
});

test('gate STRICT direction: the lenient bar still catches higher warn-band strain on a vocalise', () => {
  const struck = assessSafetyState(vs({ strainRisk: 0.65, recentFlags: 2 }), { takeKind: 'hum_sovt' });
  assert.equal(struck.state, 'fatigue_or_strain');
  assert.equal(struck.witness.strain.tier, 'warn-fired');
  // and without the second strike the warn tier still suppresses (two-tier intact)
  const single = assessSafetyState(vs({ strainRisk: 0.65 }), { takeKind: 'hum_sovt' });
  assert.equal(single.state, 'normal');
  assert.equal(single.witness.strain.tier, 'warn-suppressed');
});

test('HARD-STOP intact: extreme strain stops a vocalise take immediately, strikes or not', () => {
  const stop = assessSafetyState(vs({ strainRisk: 0.75 }), { takeKind: 'siren' });
  assert.equal(stop.state, 'stop');
  assert.equal(stop.witness.strain.tier, 'stop');
  // exactly at the stop bar too
  assert.equal(assessSafetyState(vs({ strainRisk: 0.7 }), { takeKind: 'sustained' }).state, 'stop');
});

test('no-takeKind callers keep the exact standard behavior (back-compat)', () => {
  const legacy = assessSafetyState(vs({ strainRisk: 0.6, recentFlags: 2 }));
  assert.equal(legacy.state, 'fatigue_or_strain');
  assert.equal(legacy.witness.strain.interpretation, 'standard');
  assert.equal(legacy.witness.strain.takeKind, null);
});

test('issue path matches the gate: no strain nag at 0.60 on a sustained take, nag on a phrase', () => {
  const phraseIssues = detectIssues(vs({ strainRisk: 0.6 }), 'active_drill');
  assert.equal(phraseIssues.primaryIssue, 'strain_risk');
  const sustainedIssues = detectIssues(vs({ strainRisk: 0.6 }), 'active_drill', { takeKind: 'sustained' });
  assert.notEqual(sustainedIssues.primaryIssue, 'strain_risk');
  // strict direction: a sustained take ABOVE the lenient bar still gets the issue
  const hot = detectIssues(vs({ strainRisk: 0.66 }), 'active_drill', { takeKind: 'sustained' });
  assert.equal(hot.primaryIssue, 'strain_risk');
});
