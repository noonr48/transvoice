'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LEARNER_MOTOR_RESPONSE_SCHEMA,
  MIGRATION_SOURCE_TARGET_SCOPED,
  buildLearnerMotorResponse,
  mergeLearnerMotorResponses,
  llmMemoMotorProjection,
} = require('./learner-motor-response');
const { MOTOR_MAP_SCHEMA } = require('./motor-map');

function targetScopedMap(cueId, { attempts = 3, successes = 1, verifiedFailures = 1, meanTargetGain = 0.4, dimension = 'pitch.register' } = {}) {
  return {
    schema: MOTOR_MAP_SCHEMA,
    byCue: {
      [cueId]: {
        attempts,
        successes,
        verifiedFailures,
        confounded: 0,
        partialEvidence: 0,
        meanTargetGain,
        meanVerifiedTargetGain: 0.5,
        verifiedGainObservations: successes,
        meanProtectedDrift: 0,
        protectedObservations: attempts,
        missingProtectedEvidence: 0,
        meanEffortDelta: 0,
        effortObservations: attempts,
        byDimension: {
          [dimension]: {
            attempts,
            successes,
            verifiedFailures,
            meanTargetGain,
            meanVerifiedTargetGain: 0.5,
            verifiedGainObservations: successes,
          },
        },
      },
    },
  };
}

test('learner-general entries are keyed by cue × skill × dimension; direction/context recorded only when supplied', () => {
  const response = buildLearnerMotorResponse({
    maps: [targetScopedMap('pitch.register.small-glide-up.v1')],
  });
  assert.equal(response.schema, LEARNER_MOTOR_RESPONSE_SCHEMA);
  const entry = response.byCue['pitch.register.small-glide-up.v1'].byDimension['pitch.register'];
  assert.ok(entry);
  assert.equal(response.byCue['pitch.register.small-glide-up.v1'].skill, 'pitch');
  // Unknown is not invented: direction and context stay null unless supplied.
  assert.equal(response.direction, null);
  assert.equal(response.context, null);
  assert.equal(entry.direction, null);
  // Stats copied verbatim — no synthesis.
  assert.equal(entry.stats.attempts, 3);
  assert.equal(entry.stats.successes, 1);
  assert.equal(entry.stats.meanTargetGain, 0.4);
});

test('reference change preserves the learner response — entries from both targets coexist', () => {
  const mapA = targetScopedMap('pitch.register.small-glide-up.v1');
  const responseBefore = buildLearnerMotorResponse({ maps: [mapA] });
  // The reference/target change event: a NEW target-scoped map appears and the
  // old target bucket would be replaced — the learner-general response is
  // rebuilt from the union and is untouched by any target/overlay operation.
  const mapB = targetScopedMap('resonance.front-vowel.ee-anchor.v1', { attempts: 2, successes: 2, dimension: 'resonance.global_scale' });
  const responseAfter = buildLearnerMotorResponse({ maps: [mapA, mapB] });
  const beforeEntry = responseBefore.byCue['pitch.register.small-glide-up.v1'].byDimension['pitch.register'];
  const afterEntry = responseAfter.byCue['pitch.register.small-glide-up.v1'].byDimension['pitch.register'];
  // Review note 1: FULL-entry deepEqual — direction/provenance mutation on a
  // preserved entry must fail this test, not just a stats change.
  assert.deepEqual(afterEntry, beforeEntry); // preserved byte-for-byte
  assert.ok(responseAfter.byCue['resonance.front-vowel.ee-anchor.v1']); // new target's cue merged in
  assert.equal(responseAfter.byCue['resonance.front-vowel.ee-anchor.v1'].skill, 'resonance');
});

test('migration carries provenance — no entry without a source record', () => {
  const response = buildLearnerMotorResponse({ maps: [targetScopedMap('c.v1')] });
  const entry = response.byCue['c.v1'].byDimension['pitch.register'];
  assert.ok(Array.isArray(entry.provenance) && entry.provenance.length >= 1);
  assert.equal(entry.provenance[0].source, MIGRATION_SOURCE_TARGET_SCOPED);
  assert.equal(entry.provenance[0].mapSchema, MOTOR_MAP_SCHEMA);
});

test('no invented confidence: empty sources stay empty; merged means are weighted arithmetic only', () => {
  const empty = buildLearnerMotorResponse({ maps: [] });
  assert.deepEqual(empty.byCue, {});
  assert.deepEqual(buildLearnerMotorResponse({ maps: [null, 'junk', { schema: 'nope' }] }).byCue, {});

  // 3 attempts @ mean 0.4 merged with 2 attempts @ mean 0.9 → weighted 0.6.
  const merged = buildLearnerMotorResponse({
    maps: [
      targetScopedMap('c.v1', { attempts: 3, meanTargetGain: 0.4 }),
      targetScopedMap('c.v1', { attempts: 2, meanTargetGain: 0.9 }),
    ],
  });
  const entry = merged.byCue['c.v1'].byDimension['pitch.register'];
  assert.equal(entry.stats.attempts, 5);
  assert.equal(entry.stats.meanTargetGain, (0.4 * 3 + 0.9 * 2) / 5);
  // Zero-verified cue stays zero — no synthetic success or gain.
  const zero = buildLearnerMotorResponse({
    maps: [targetScopedMap('z.v1', { attempts: 2, successes: 0, verifiedFailures: 2, meanVerifiedTargetGain: 0, verifiedGainObservations: 0 })],
  });
  const zeroEntry = zero.byCue['z.v1'].byDimension['pitch.register'];
  assert.equal(zeroEntry.stats.successes, 0);
  assert.equal(zeroEntry.stats.verifiedGainObservations, 0);
});

test('merge order-insensitivity: identical sources in any order yield identical responses', () => {
  const a = targetScopedMap('a.v1', { attempts: 3, meanTargetGain: 0.4 });
  const b = targetScopedMap('a.v1', { attempts: 2, meanTargetGain: 0.9 });
  // Per-source provenance now carries differing attempts figures (3 vs 2),
  // so the provenance SORT is genuinely exercised by both orders.
  const ab = buildLearnerMotorResponse({ maps: [a, b] });
  const ba = buildLearnerMotorResponse({ maps: [b, a] });
  assert.deepEqual(ab, ba);
  const entry = ab.byCue['a.v1'].byDimension['pitch.register'];
  assert.equal(entry.provenance.length, 2);
  assert.notDeepEqual(entry.provenance[0], entry.provenance[1]); // distinct sources
});

test('minor-3 kill: cue/dimension pairs containing spaces never merge stats', () => {
  const mapOne = targetScopedMap('a b', { dimension: 'c' });
  const mapTwo = targetScopedMap('a', { dimension: 'b c', attempts: 2, meanTargetGain: 0.9 });
  const response = buildLearnerMotorResponse({ maps: [mapOne, mapTwo] });
  const one = response.byCue['a b'].byDimension.c;
  const two = response.byCue['a'].byDimension['b c'];
  assert.ok(one && two);
  assert.equal(one.stats.attempts, 3); // untouched by the space-adjacent pair
  assert.equal(two.stats.attempts, 2); // NOT merged into 5
});

test('minor-2 kill: unregistered dimension heads carry null skill, never widened vocabulary', () => {
  const response = buildLearnerMotorResponse({ maps: [targetScopedMap('p.v1', { dimension: 'phonation.breathiness' })] });
  assert.equal(response.byCue['p.v1'].skill, null); // fail closed, not 'phonation'
});

test('llm memo projection excludes motor internals entirely (plan 16/15 boundary)', () => {
  assert.equal(llmMemoMotorProjection(), null);
  assert.equal(llmMemoMotorProjection({ byCue: { 'c.v1': { skill: 'pitch' } } }), null);
});

test('mergeLearnerMotorResponses composes two responses without invention', () => {
  const one = buildLearnerMotorResponse({ maps: [targetScopedMap('c.v1', { attempts: 3, meanTargetGain: 0.4 })] });
  const two = buildLearnerMotorResponse({ maps: [targetScopedMap('c.v1', { attempts: 2, meanTargetGain: 0.9 })] });
  const merged = mergeLearnerMotorResponses(one, two);
  const entry = merged.byCue['c.v1'].byDimension['pitch.register'];
  assert.equal(entry.stats.attempts, 5);
  assert.equal(entry.stats.meanTargetGain, (0.4 * 3 + 0.9 * 2) / 5);
  assert.equal(entry.provenance.length, 2); // both sources recorded
});
