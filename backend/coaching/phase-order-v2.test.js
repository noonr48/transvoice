'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PHASE_ORDER } = require('./beginner-mastery');
const { CURRICULUM_PHASES } = require('./feminization-v1-policy');

test('R1-004: phase order puts transfer BEFORE prosody (first-release boundary)', () => {
  const transferIdx = PHASE_ORDER.indexOf('transfer');
  const prosodyIdx = PHASE_ORDER.indexOf('prosody');
  assert.ok(transferIdx > 0, 'transfer exists in PHASE_ORDER');
  assert.ok(prosodyIdx > 0, 'prosody exists in PHASE_ORDER');
  assert.ok(
    transferIdx < prosodyIdx,
    `transfer (idx ${transferIdx}) must precede prosody (idx ${prosodyIdx}) — the first release ends at short-phrase transfer; prosody is a later extension`,
  );
});

test('R1-004: a learner can traverse calibration→transfer without entering prosody', () => {
  // Sequential transitions only; walk the full path to transfer
  let current = 'calibration';
  const visited = [current];
  while (current !== 'transfer') {
    const nextIdx = PHASE_ORDER.indexOf(current) + 1;
    assert.ok(nextIdx < PHASE_ORDER.length, `ran out of phases before reaching transfer from ${current}`);
    current = PHASE_ORDER[nextIdx];
    visited.push(current);
    assert.ok(
      current !== 'prosody',
      `cannot reach transfer without traversing prosody — path was ${visited.join(' -> ')}`,
    );
  }
});

test('R1-004: CURRICULUM_PHASES order matches PHASE_ORDER (no divergence)', () => {
  assert.deepEqual(CURRICULUM_PHASES, PHASE_ORDER);
});

test('R1-004: sequential transition calibration→...→transfer is valid without prosody', () => {
  const { applyCurriculumTransition, createBeginnerMasteryState } = require('./beginner-mastery');
  let state = createBeginnerMasteryState({ curriculumPhase: 'calibration' });
  for (const next of ['awareness', 'pitch_foundation', 'pitch_repeatability', 'resonance_foundation', 'integration', 'transfer']) {
    const result = applyCurriculumTransition(state, next, { allowed: true, reason: 'test' });
    assert.equal(result.changed, true, `transition to ${next} must work`);
    state = result.state;
  }
  assert.equal(state.curriculumPhase, 'transfer');
});
