'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_MOTOR_MAP_CUES,
  MOTOR_MAP_SCHEMA,
  cueEffectMultiplier,
  normalizeMotorMap,
} = require('./motor-map');

test('invalid or unknown-schema persisted maps fail to an empty v2 map', () => {
  assert.deepEqual(normalizeMotorMap(null), { schema: MOTOR_MAP_SCHEMA, byCue: {} });
  assert.deepEqual(normalizeMotorMap({ schema: 'unknown', byCue: { x: { attempts: 99 } } }), {
    schema: MOTOR_MAP_SCHEMA,
    byCue: {},
  });
});

test('persisted counts and means are finite, bounded, and internally consistent', () => {
  const map = normalizeMotorMap({
    schema: MOTOR_MAP_SCHEMA,
    byCue: {
      'cue-1': {
        attempts: 2,
        successes: 999,
        verifiedFailures: -3,
        confounded: 999,
        partialEvidence: Infinity,
        meanTargetGain: Infinity,
        meanVerifiedTargetGain: 100000,
        verifiedGainObservations: 99,
        meanProtectedDrift: -4,
        protectedObservations: 999999999,
        missingProtectedEvidence: -20,
        meanEffortDelta: -999,
        effortObservations: 99,
        byDimension: {
          'pitch.register': {
            attempts: 1,
            successes: 80,
            verifiedFailures: 80,
            meanTargetGain: -9999,
            meanVerifiedTargetGain: 9999,
            verifiedGainObservations: 80,
          },
        },
      },
    },
  });
  const cue = map.byCue['cue-1'];
  assert.equal(cue.attempts, 2);
  assert.equal(cue.successes, 2);
  assert.equal(cue.verifiedFailures, 0);
  assert.equal(cue.confounded, 2);
  assert.equal(cue.partialEvidence, 0);
  assert.equal(cue.meanTargetGain, 0);
  assert.equal(cue.meanVerifiedTargetGain, 100);
  assert.equal(cue.verifiedGainObservations, 2);
  assert.equal(cue.meanProtectedDrift, 0);
  assert.equal(cue.meanEffortDelta, -10);
  assert.equal(cue.effortObservations, 2);
  assert.equal(cue.byDimension['pitch.register'].successes, 1);
  assert.equal(cue.byDimension['pitch.register'].verifiedFailures, 1);
  assert.equal(cue.byDimension['pitch.register'].meanTargetGain, -100);
  assert.equal(cue.byDimension['pitch.register'].meanVerifiedTargetGain, 100);
});

test('persisted map cue cardinality is bounded', () => {
  const byCue = {};
  for (let index = 0; index < MAX_MOTOR_MAP_CUES + 20; index += 1) {
    byCue[`cue-${String(index).padStart(3, '0')}`] = { attempts: 1, successes: 1 };
  }
  const map = normalizeMotorMap({ schema: MOTOR_MAP_SCHEMA, byCue });
  assert.equal(Object.keys(map.byCue).length, MAX_MOTOR_MAP_CUES);
});

test('ranking reads the normalized persisted representation rather than arbitrary raw values', () => {
  const corrupt = {
    schema: MOTOR_MAP_SCHEMA,
    byCue: {
      'cue-1': {
        attempts: 1,
        successes: 999999,
        verifiedFailures: -999,
        meanVerifiedTargetGain: Infinity,
        verifiedGainObservations: 999,
        byDimension: {},
      },
    },
  };
  const multiplier = cueEffectMultiplier(corrupt, 'cue-1', 'pitch.register');
  assert.ok(Number.isFinite(multiplier));
  assert.ok(multiplier >= 0.35 && multiplier <= 1.65);
});
