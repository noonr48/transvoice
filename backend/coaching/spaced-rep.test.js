'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DAY_MS, masteryStep, masteryLevelFor, sm2Step, SM2_DEFAULT_EASE, roundHalfUp,
} = require('./spaced-rep');

test('EWMA mastery (ported from structured.py mastery_step/level)', async (t) => {
  await t.test('first observation SEEDS ewma (no decay toward 0)', () => {
    const m = masteryStep({ attempts: 0, successes: 0, ewma: 0 }, true);
    assert.equal(m.ewma, 1);
    assert.equal(m.attempts, 1);
    assert.equal(m.successes, 1);
    assert.equal(m.level, 'novice'); // attempts < 3
  });

  await t.test('subsequent updates apply alpha=0.3 EWMA', () => {
    let m = masteryStep({ attempts: 0 }, true);                 // ewma 1, att 1
    m = masteryStep(m, false);                                  // 0.3*0 + 0.7*1 = 0.7
    assert.ok(Math.abs(m.ewma - 0.7) < 1e-9);
    m = masteryStep(m, true);                                   // 0.3*1 + 0.7*0.7 = 0.79
    assert.ok(Math.abs(m.ewma - 0.79) < 1e-9);
    assert.equal(m.attempts, 3);
    assert.equal(m.successes, 2);
    assert.equal(m.level, 'proficient');                        // att>=3, ewma 0.79 in [0.65,0.85)
  });

  await t.test('mastery bands', () => {
    assert.equal(masteryLevelFor(2, 0.99), 'novice');           // below min attempts
    assert.equal(masteryLevelFor(3, 0.90), 'mastered');
    assert.equal(masteryLevelFor(5, 0.70), 'proficient');
    assert.equal(masteryLevelFor(5, 0.50), 'developing');
    assert.equal(masteryLevelFor(5, 0.20), 'novice');
  });
});

test('SM-2 spaced repetition (ported from structured.py sm2_step)', async (t) => {
  const now = 1_700_000_000_000;

  await t.test('first pass (grade 4): interval 1, ease unchanged, due +1 day', () => {
    const r = sm2Step({}, 4, now);                              // defaults: ease 2.5, reps 0
    assert.equal(r.intervalDays, 1);
    assert.ok(Math.abs(r.ease - 2.5) < 1e-9);                   // 2.5 + (0.1 - 1*0.1) = 2.5
    assert.equal(r.reps, 1);
    assert.equal(r.lapses, 0);
    assert.equal(r.dueAt, now + 1 * DAY_MS);
  });

  await t.test('second pass: interval 6; third: round_half_up(interval*ease)', () => {
    const r2 = sm2Step({ ease: 2.5, intervalDays: 1, reps: 1 }, 4, now);
    assert.equal(r2.intervalDays, 6);
    assert.equal(r2.reps, 2);
    const r3 = sm2Step({ ease: 2.5, intervalDays: 6, reps: 2 }, 4, now);
    assert.equal(r3.intervalDays, 15);                          // round(6 * 2.5)
    assert.equal(r3.dueAt, now + 15 * DAY_MS);
  });

  await t.test('grade 5 raises ease by 0.1; lapse (q<3) resets reps, +1 lapse, interval 1', () => {
    const perfect = sm2Step({ ease: 2.5, intervalDays: 6, reps: 2 }, 5, now);
    assert.ok(Math.abs(perfect.ease - 2.6) < 1e-9);
    const lapse = sm2Step({ ease: 2.5, intervalDays: 15, reps: 3, lapses: 0 }, 1, now);
    assert.equal(lapse.reps, 0);
    assert.equal(lapse.lapses, 1);
    assert.equal(lapse.intervalDays, 1);
    assert.ok(Math.abs(lapse.ease - 1.96) < 1e-9);              // 2.5 + (0.1 - 4*(0.08+0.08))
  });

  await t.test('non-numeric grade → conservative lapse, never NaN', () => {
    for (const bad of [NaN, undefined, 'oops', null]) {
      const r = sm2Step({ ease: 2.5, intervalDays: 15, reps: 3, lapses: 0 }, bad, now);
      assert.ok(Number.isFinite(r.ease), `ease finite for grade=${String(bad)}`);
      assert.ok(Number.isFinite(r.intervalDays), `interval finite for grade=${String(bad)}`);
      assert.equal(r.reps, 0);       // treated as lapse
      assert.equal(r.lapses, 1);
      assert.equal(r.intervalDays, 1);
    }
  });

  await t.test('ease never drops below the 1.3 floor', () => {
    let r = { ease: 1.4, intervalDays: 1, reps: 0, lapses: 0 };
    for (let i = 0; i < 5; i += 1) r = sm2Step(r, 0, now);      // repeated total failures
    assert.ok(r.ease >= 1.3 - 1e-9);
    assert.equal(r.ease, 1.3);
  });

  await t.test('roundHalfUp is half-up, not banker rounding', () => {
    assert.equal(roundHalfUp(14.5), 15);
    assert.equal(roundHalfUp(2.5), 3);
    assert.equal(roundHalfUp(2.4), 2);
  });
});
