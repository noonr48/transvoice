'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ATTEMPT_SEQUENCE_SCHEMA,
  createAttemptSequence,
  recordFinalizedAttempt,
  nextEligibleOrdinalAfter,
} = require('./session-attempt-sequence');
const {
  createPendingMotorTrial,
  settlePendingMotorTrial,
} = require('./motor-trial');
const { decideTargetCoaching } = require('./target-coaching-engine');
const { emptyMotorMap } = require('./motor-map');

function obs(dimension, value, low, high, extra = {}) {
  return {
    metricId: dimension,
    metricDefinitionVersion: 'v1',
    dimension,
    value,
    unit: extra.unit || 'score',
    attemptArtifactId: extra.attempt || 'attempt-before',
    taskId: 'task-1',
    takeKind: 'phrase',
    analysisProfile: 'standard',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: { low, high, scale: 0.1, source: 'reference', targetKey: 'target-1', confidence: 0.95 },
    persistenceCount: 2,
    importance: 0.7,
    controllability: 0.8,
    metadata: {},
    flags: [],
  };
}

function beforeBundle() {
  return [
    obs('resonance.global_scale', 0.2, 0.4, 0.6),
    obs('pitch.register', 200, 185, 220, { unit: 'Hz', metadata: { targetScaleUnit: 'semitone' } }),
    obs('phonation.pressedness', 0.2, 0, 0.5),
  ];
}

function afterBundle(attemptId, value = 0.36) {
  return beforeBundle().map((o) => ({
    ...o,
    attemptArtifactId: attemptId,
    value: o.dimension === 'resonance.global_scale' ? value : o.value,
  }));
}

function buildTrial(sequence, baselineOrdinal) {
  const before = beforeBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const created = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    issuedAt: 2000,
    attemptSequence: sequence,
    baselineAttemptOrdinal: baselineOrdinal,
  });
  return { before, decision, created };
}

test('R1-003: ordinals are monotonic; eligibility recorded with a deterministic reason', () => {
  let seq = createAttemptSequence();
  assert.equal(seq.schema, ATTEMPT_SEQUENCE_SCHEMA);
  let rec;
  rec = recordFinalizedAttempt(seq, { attemptArtifactId: 'a1', eligible: true });
  assert.equal(rec.ordinal, 1);
  rec = recordFinalizedAttempt(seq, { attemptArtifactId: 'a2', eligible: false, ineligibleReason: 'capture_unusable' });
  assert.equal(rec.ordinal, 2);
  rec = recordFinalizedAttempt(seq, { attemptArtifactId: 'a3', eligible: true });
  assert.equal(rec.ordinal, 3);
  // next eligible after 1 is 3 (2 was ineligible — skipping it is lawful)
  assert.equal(nextEligibleOrdinalAfter(seq, 1), 3);
  // none after 3 yet
  assert.equal(nextEligibleOrdinalAfter(seq, 3), null);
});

test('R1-003: ineligible without a reason fails closed (eligible-by-default is forbidden)', () => {
  let seq = createAttemptSequence();
  assert.throws(
    () => recordFinalizedAttempt(seq, { attemptArtifactId: 'a1', eligible: false }),
    /ineligibleReason/,
  );
});

test('R1-003: a bound trial binds its baseline ordinal and sequence flag at creation', () => {
  let seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true }); // ordinal 1
  recordFinalizedAttempt(seq, { attemptArtifactId: 'skipped-capture', eligible: false, ineligibleReason: 'capture_unusable' }); // ordinal 2
  recordFinalizedAttempt(seq, { attemptArtifactId: 'next-eligible', eligible: true }); // ordinal 3
  const { created } = buildTrial(seq, 1);
  assert.equal(created.status, 'created');
  assert.equal(created.trial.baselineAttemptOrdinal, 1);
  assert.equal(created.trial.attemptSequenceBound, true);
  // Expected-next is verified at SETTLE time against the live snapshot
  // (creation cannot know which attempts finalize later):
  assert.equal(nextEligibleOrdinalAfter(seq, 1), 3);
});

test('R1-003: settlement on the exact next eligible ordinal succeeds', () => {
  let seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true }); // 1
  const { created } = buildTrial(seq, 1);
  const trial = created.trial;
  recordFinalizedAttempt(seq, { attemptArtifactId: 'attempt-after', eligible: true }); // 2 = expected
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: afterBundle('attempt-after'),
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 3000,
    afterAttemptOrdinal: 2,
    attemptSequence: seq, // settle-time snapshot
  });
  assert.equal(result.status, 'settled');
  assert.equal(result.result, 'worked_verified');
});

test('R1-003 kill: an ELIGIBLE intervening attempt terminally invalidates (no cherry-picking)', () => {
  let seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true }); // 1
  const { created } = buildTrial(seq, 1);
  const trial = created.trial; // expects ordinal 2
  // The learner takes TWO eligible attempts; the caller tries to settle with the second
  recordFinalizedAttempt(seq, { attemptArtifactId: 'intervening', eligible: true }); // 2 = expected
  recordFinalizedAttempt(seq, { attemptArtifactId: 'later-nicer', eligible: true }); // 3 — cherry-pick target
  const result = settlePendingMotorTrial({
    trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'later-nicer',
    afterObservations: afterBundle('later-nicer'),
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 3000,
    afterAttemptOrdinal: 3,
    attemptSequence: seq, // settle-time snapshot: ordinal 2 was eligible+intervening
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'intervening_eligible_attempt_skipped');
  assert.equal(result.motorMapUpdated, false);
});

test('R1-003 kill: a stale (already-consumed/before-baseline) ordinal fails as not-next', () => {
  let seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true }); // 1
  const { created } = buildTrial(seq, 1);
  const result = settlePendingMotorTrial({
    trial: created.trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'baseline',
    afterObservations: afterBundle('baseline'),
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 3000,
    afterAttemptOrdinal: 1, // the baseline itself — stale
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'attempt_not_next');
});

test('R1-003 fail-closed: a bound trial settled without its sequence snapshot fails closed', () => {
  let seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true }); // 1
  const { created } = buildTrial(seq, 1);
  const result = settlePendingMotorTrial({
    trial: created.trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: afterBundle('attempt-after'),
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 3000,
    afterAttemptOrdinal: 2,
    // no attemptSequence snapshot — intervening eligibility unknown
  });
  assert.equal(result.status, 'invalidated');
  assert.equal(result.result, 'attempt_sequence_required');
});

test('R1-003 backward compat: unbound trials (no sequence at creation) settle as before', () => {
  const before = beforeBundle();
  const decision = decideTargetCoaching({ observations: before, stage: 'phrase' });
  const created = createPendingMotorTrial({
    decision,
    beforeObservations: before,
    sessionId: 'session-1',
    stage: 'phrase',
    selfReport: { effort: 2 },
    issuedAt: 2000,
  });
  assert.equal(created.trial.attemptSequenceBound, false); // legacy: unbound
  assert.equal(created.trial.baselineAttemptOrdinal, null); // legacy: no ordinal
  const result = settlePendingMotorTrial({
    trial: created.trial,
    sessionId: 'session-1',
    stage: 'phrase',
    afterAttemptArtifactId: 'attempt-after',
    afterObservations: afterBundle('attempt-after'),
    selfReport: { effort: 2 },
    motorMap: emptyMotorMap(),
    settledAt: 3000,
    // no ordinal needed — legacy research path unchanged
  });
  assert.equal(result.status, 'settled');
  assert.equal(result.result, 'worked_verified');
});

test('R1-003: ordinal binding survives session-state normalization', () => {
  const { normalizeTargetMetricSessionState } = require('./target-metric-session-state');
  let seq = createAttemptSequence();
  recordFinalizedAttempt(seq, { attemptArtifactId: 'baseline', eligible: true }); // 1
  const { created } = buildTrial(seq, 1);
  const normalized = normalizeTargetMetricSessionState({ pendingTrial: created.trial });
  const restored = normalized.pendingTrial;
  assert.ok(restored);
  assert.equal(restored.baselineAttemptOrdinal, 1);
  assert.equal(restored.attemptSequenceBound, true);
});
