'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  VOICE_SELF_REPORT_SCHEMA,
  SCALE,
  MIN,
  MAX,
  REDUCE_DIFFICULTY_THRESHOLD,
  COMFORT_EFFORT_BOUND,
  normalizeSelfReport,
  parseFivePoint,
} = require('./voice-self-report');

test('R1-001: canonical scale is five-point 1-5, matching the Python producer', () => {
  assert.equal(SCALE, 'five_point');
  assert.equal(MIN, 1);
  assert.equal(MAX, 5);
  assert.equal(VOICE_SELF_REPORT_SCHEMA, 'transvoice.voice_self_report.v1');
});

test('R1-001: strict numeric parsing — coercion shapes are missing, never measurements', () => {
  // Valid
  assert.equal(parseFivePoint(1), 1);
  assert.equal(parseFivePoint(3), 3);
  assert.equal(parseFivePoint(5), 5);
  assert.equal(parseFivePoint(3.0), 3); // whole floats fine
  // Missing for ALL junk shapes (the review's Number() coercion class):
  assert.equal(parseFivePoint(true), null);      // was coerced to 1
  assert.equal(parseFivePoint(false), null);     // was coerced to 0
  assert.equal(parseFivePoint([]), null);        // was coerced to 0
  assert.equal(parseFivePoint([3]), null);       // was coerced to 3
  assert.equal(parseFivePoint('3'), null);       // numeric string
  assert.equal(parseFivePoint('  '), null);      // blank string -> 0
  assert.equal(parseFivePoint(''), null);
  assert.equal(parseFivePoint(Number.NaN), null);
  assert.equal(parseFivePoint(Number.POSITIVE_INFINITY), null);
  assert.equal(parseFivePoint(null), null);
  assert.equal(parseFivePoint(undefined), null);
  // Out-of-range numbers on the five-point scale:
  assert.equal(parseFivePoint(0), null);
  assert.equal(parseFivePoint(6), null);
  assert.equal(parseFivePoint(10), null); // the old 0-10 top is invalid now
  assert.equal(parseFivePoint(-1), null);
});

test('R1-001: normalizeSelfReport strict-parses every numeric field', () => {
  const normalized = normalizeSelfReport({
    pain: true,
    effort: 3,
    strain: 2,
    fatigue: '4',       // string — must become null, not 4
    discomfort: [],     // array — must become null, not 0
    throatPain: 'yes',  // non-boolean — must become false
  });
  assert.equal(normalized.schema, VOICE_SELF_REPORT_SCHEMA);
  assert.equal(normalized.pain, true);
  assert.equal(normalized.throatPain, false); // strict boolean
  assert.equal(normalized.effort, 3);
  assert.equal(normalized.strain, 2);
  assert.equal(normalized.fatigue, null);
  assert.equal(normalized.discomfort, null);
});

test('R1-001: thresholds live on the 1-5 scale (old 0-10 values are gone)', () => {
  assert.equal(REDUCE_DIFFICULTY_THRESHOLD, 4);  // was 6 on 0-10
  assert.equal(COMFORT_EFFORT_BOUND, 3);          // was 5 on 0-10
  // A typed 1-5 effort of 5 (max) MUST trigger reduce-difficulty now:
  assert.ok(5 >= REDUCE_DIFFICULTY_THRESHOLD);
  // A typed 1-5 effort of 3 (mid) must NOT:
  assert.ok(3 < REDUCE_DIFFICULTY_THRESHOLD);
});

test('R1-001: unknown keys pass through (forward compat), malformed input yields empty contract', () => {
  const withExtra = normalizeSelfReport({ effort: 2, mood: 'good' });
  assert.equal(withExtra.extra.mood, 'good');
  assert.deepEqual(normalizeSelfReport(null).extra, {});
  assert.deepEqual(normalizeSelfReport('junk').extra, {});
  assert.deepEqual(normalizeSelfReport(42).extra, {});
});
