'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  FEM_V1_REPLAY_REPORT_SCHEMA,
  evaluateFemV1Replay,
} = require('./fem-v1-replay-evaluator');

function row(overrides = {}) {
  return {
    rowId: 'r1',
    phase: 'pitch_foundation',
    legacyFocus: 'pitch_floor',
    v1Focus: 'pitch.register',
    v1Action: 'serve_exercise',
    v1Reason: null,
    eligibilityRejected: [],
    settlement: null,
    retention: null,
    ...overrides,
  };
}

test('legacy vs v1 focus: agreement and disagreement counted and named', () => {
  const report = evaluateFemV1Replay([
    row({ rowId: 'a', legacyFocus: 'pitch_floor', v1Focus: 'pitch.register' }),
    row({ rowId: 'b', legacyFocus: 'pitch_floor', v1Focus: 'pitch.register' }),
    // legacyFocus maps conceptually to resonance_forward; v1 says pitch
    row({ rowId: 'c', legacyFocus: 'resonance_forward', v1Focus: 'pitch.register' }),
  ]);
  assert.equal(report.schema, FEM_V1_REPLAY_REPORT_SCHEMA);
  assert.equal(report.legacyVsV1Focus.total, 3);
  assert.equal(report.legacyVsV1Focus.agreement, 2);
  assert.equal(report.legacyVsV1Focus.disagreement, 1);
  assert.deepEqual(report.legacyVsV1Focus.disagreementRowIds, ['c']);
});

test('phase policy violations: legacy focus that v1 policy rejects for the phase', () => {
  const report = evaluateFemV1Replay([
    // breathiness as legacy focus in pitch_foundation: research-only — violation
    row({ rowId: 'v1', legacyFocus: 'tone_clarity', v1Focus: 'pitch.register' }),
    // pitch focus in pitch phase — no violation
    row({ rowId: 'ok', legacyFocus: 'pitch_floor', v1Focus: 'pitch.register' }),
  ]);
  assert.equal(report.phasePolicyViolations.count, 1);
  assert.deepEqual(report.phasePolicyViolations.rowIds, ['v1']);
  assert.equal(report.phasePolicyViolations.details[0].dimension, 'phonation.breathiness');
});

test('phase policy violations: a v1-served focus outside its phase would be flagged', () => {
  // Defense-in-depth: the controller cannot serve an ineligible focus by
  // construction, but the evaluator must still flag it if retained data
  // ever contains one (e.g. forged rows or future wiring bugs).
  const report = evaluateFemV1Replay([
    row({ rowId: 'x', phase: 'pitch_foundation', legacyFocus: null, v1Focus: 'resonance.global_scale', v1Action: 'serve_exercise' }),
  ]);
  assert.equal(report.phasePolicyViolations.count, 1);
  assert.equal(report.phasePolicyViolations.details[0].source, 'v1');
});

test('rejection reasons are aggregated with counts', () => {
  const report = evaluateFemV1Replay([
    row({ rowId: 'a', eligibilityRejected: [{ dimension: 'phonation.breathiness', reason: 'metric_not_beginner_coaching_authority' }] }),
    row({ rowId: 'b', eligibilityRejected: [
      { dimension: 'phonation.breathiness', reason: 'metric_not_beginner_coaching_authority' },
      { dimension: 'prosody.phrase_ending', reason: 'metric_not_unlocked_for_phase' },
    ] }),
  ]);
  assert.equal(report.rejectionReasons['metric_not_beginner_coaching_authority'], 2);
  assert.equal(report.rejectionReasons['metric_not_unlocked_for_phase'], 1);
});

test('confound rate: confounded over settled; no settlements is unknown, not zero', () => {
  const withSettles = evaluateFemV1Replay([
    row({ settlement: { result: 'worked_verified' } }),
    row({ settlement: { result: 'confounded' } }),
    row({ settlement: { result: 'worked_verified' } }),
    row({ settlement: { result: 'worked_verified' } }),
  ]);
  assert.equal(withSettles.confoundRate, 0.25);

  const none = evaluateFemV1Replay([row(), row()]);
  assert.equal(none.confoundRate, null); // unknown, never zero
});

test('retention rate: retained over checks; none is unknown', () => {
  const withRetention = evaluateFemV1Replay([
    row({ retention: { retained: true } }),
    row({ retention: { retained: false } }),
    row({ retention: { retained: true } }),
  ]);
  assert.equal(withRetention.retentionRate, 2 / 3);
  assert.equal(evaluateFemV1Replay([row()]).retentionRate, null);
});

test('effort change: mean delta over settlements with both efforts; missing effort excluded, counted', () => {
  const report = evaluateFemV1Replay([
    row({ settlement: { result: 'worked_verified', effortBefore: 2, effortAfter: 2 } }),
    row({ settlement: { result: 'confounded', effortBefore: 2, effortAfter: 5 } }),
    // missing effort evidence: excluded from the mean, never treated as zero
    row({ settlement: { result: 'worked_verified', effortBefore: null, effortAfter: 2 } }),
  ]);
  assert.equal(report.effortChange.meanDelta, 1.5);
  assert.equal(report.effortChange.settlementsMeasured, 2);
  assert.equal(report.effortChange.settlementsMissingEffort, 1);
  assert.equal(report.effortChange.effortIncreasedRate, 0.5);
  assert.equal(evaluateFemV1Replay([row()]).effortChange.meanDelta, null);
});

test('no-evidence rate and focus distribution per 17.4', () => {
  const report = evaluateFemV1Replay([
    row({ rowId: 'a', v1Action: 'end_block', v1Reason: 'no_eligible_observation_for_phase', v1Focus: null }),
    row({ rowId: 'b', v1Focus: 'pitch.register' }),
    row({ rowId: 'c', v1Focus: 'pitch.register' }),
    row({ rowId: 'd', v1Focus: 'resonance.global_scale' }),
  ]);
  assert.equal(report.noEvidenceRate, 0.25);
  assert.equal(report.focusDistribution['pitch.register'], 2);
  assert.equal(report.focusDistribution['resonance.global_scale'], 1);
});

test('malformed rows fail closed: skipped and counted, never crash', () => {
  const report = evaluateFemV1Replay([
    null,
    'not-a-row',
    42,
    row({ rowId: 'good' }),
    { phase: 'pitch_foundation' }, // missing everything else — still a row-shaped object with defaults
  ]);
  assert.equal(report.rowsTotal, 5);
  assert.equal(report.rowsSkipped, 3);
  assert.equal(report.rowsEvaluated, 2);
  assert.deepEqual(report.skippedReasons, ['row_not_object', 'row_not_object', 'row_not_object']);
});

test('F1 kill: coerced junk effort values are MISSING, never fabricated measurements', () => {
  const junk = (effort) => row({ settlement: { result: 'worked_verified', effortBefore: effort, effortAfter: effort } });
  const report = evaluateFemV1Replay([
    junk([]),      // would coerce to 0
    junk('  '),    // would coerce to 0
    junk(false),   // would coerce to 0
    junk(true),    // would coerce to 1
    junk('2'),     // string number — strict: missing (adapter must send numbers)
    junk([7]),     // would coerce to 7
  ]);
  assert.equal(report.effortChange.settlementsMeasured, 0);
  assert.equal(report.effortChange.settlementsMissingEffort, 6);
  assert.equal(report.effortChange.meanDelta, null); // unknown, never zero
  assert.equal(report.effortChange.effortIncreasedRate, null);
  // Real numbers still measure:
  const real = evaluateFemV1Replay([
    row({ settlement: { result: 'worked_verified', effortBefore: 2, effortAfter: 3 } }),
  ]);
  assert.equal(real.effortChange.settlementsMeasured, 1);
  assert.equal(real.effortChange.meanDelta, 1);
});

test('F2 kill: unknown row phase is excluded from violation judging, never defaulted', () => {
  // A breathiness legacy focus in a GARBLED phase must NOT be judged against
  // pitch_foundation (the normalize default) — that would fabricate a
  // violation; a pitch focus must not be masked either.
  const report = evaluateFemV1Replay([
    row({ rowId: 'garbled', phase: 'pitch_foundatoin', legacyFocus: 'tone_clarity' }),
  ]);
  assert.equal(report.rowsPhaseUnknown, 1);
  assert.equal(report.phasePolicyViolations.count, 0); // excluded, not defaulted
  // Phase-independent aggregates still count the row:
  assert.equal(report.rowsEvaluated, 1);
  assert.equal(report.legacyVsV1Focus.total, 1);
});

test('empty input yields a valid empty report with nulls, not zeros', () => {
  const report = evaluateFemV1Replay([]);
  assert.equal(report.rowsTotal, 0);
  assert.equal(report.confoundRate, null);
  assert.equal(report.retentionRate, null);
  assert.equal(report.noEvidenceRate, null);
  assert.equal(report.effortChange.meanDelta, null);
  assert.deepEqual(report.focusDistribution, {});
  assert.equal(report.rowsPhaseUnknown, 0);
});
