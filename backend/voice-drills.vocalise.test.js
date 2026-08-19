'use strict';

// Flow-lane vocalise drill contract (zero-prop drill data).
// Verifies: pack shape mirrors the standard drill fields, ALL 8 presets carry
// all five vocalise kinds, the flow-lane contract fields (kind / tier /
// needsNothing) are present and well-formed, trills are private full-voice
// work, sirens carry a quiet-tier small version, and NO drill string anywhere
// (legacy included) uses the banned words (straw / whisper / score / streak).

const test = require('node:test');
const assert = require('node:assert/strict');

const { getVoiceDrillPack, getVoiceDrillById } = require('./voice-drills');

const ALL_PRESETS = [
  'cute-feminine',
  'everyday-feminine',
  'bright-playful',
  'australian-bright-feminine',
  'androgynous',
  'gender-neutral',
  'soft-feminine',
];

const VOCALISE_KINDS = ['siren', 'hum_sovt', 'sustained', 'resonance_play', 'trill'];
const VALID_TIERS = ['full', 'quiet', 'both'];
const BANNED_WORDS = /straw|whisper|score|streak/i;

function collectDrillStrings(drill) {
  return [
    drill.id,
    drill.title,
    drill.focus,
    drill.phrase,
    drill.description,
    drill.successCriteria,
    ...(Array.isArray(drill.cues) ? drill.cues : []),
    ...(Array.isArray(drill.tags) ? drill.tags : []),
  ].filter((value) => typeof value === 'string');
}

test('vocalise drill packs (flow-lane contract)', async (t) => {
  await t.test('all 8 presets carry all five vocalise kinds', () => {
    for (const preset of ALL_PRESETS) {
      const pack = getVoiceDrillPack(preset);
      const vocalises = pack.filter((drill) => VOCALISE_KINDS.includes(drill.kind));
      const kinds = vocalises.map((drill) => drill.kind).sort();
      assert.deepEqual(
        kinds,
        [...VOCALISE_KINDS].sort(),
        `preset "${preset}" is missing vocalise kinds (got: ${kinds.join(', ')})`,
      );
    }
  });

  await t.test('vocalise entries mirror the standard drill shape', () => {
    for (const preset of ALL_PRESETS) {
      for (const drill of getVoiceDrillPack(preset)) {
        if (!VOCALISE_KINDS.includes(drill.kind)) continue;
        assert.ok(drill.id && typeof drill.id === 'string', `${preset}: vocalise missing id`);
        assert.ok(drill.title, `${drill.id}: missing title`);
        assert.ok(drill.focus, `${drill.id}: missing focus`);
        assert.ok(drill.phrase, `${drill.id}: missing phrase`);
        assert.ok(drill.description, `${drill.id}: missing description`);
        assert.ok(Array.isArray(drill.cues) && drill.cues.length >= 3, `${drill.id}: needs >= 3 cues`);
        assert.ok(Array.isArray(drill.tags) && drill.tags.includes('vocalise'), `${drill.id}: needs vocalise tag`);
        assert.ok(drill.successCriteria, `${drill.id}: missing successCriteria`);
        assert.ok(Array.isArray(drill.contraindications), `${drill.id}: contraindications must be an array`);
        assert.ok(['easy', 'medium', 'hard'].includes(drill.difficulty), `${drill.id}: bad difficulty`);
      }
    }
  });

  await t.test('kind + tier + needsNothing contract fields present and valid', () => {
    for (const preset of ALL_PRESETS) {
      for (const drill of getVoiceDrillPack(preset)) {
        if (!VOCALISE_KINDS.includes(drill.kind)) continue;
        assert.ok(VOCALISE_KINDS.includes(drill.kind), `${drill.id}: bad kind "${drill.kind}"`);
        assert.ok(VALID_TIERS.includes(drill.tier), `${drill.id}: bad tier "${drill.tier}"`);
        assert.equal(drill.needsNothing, true, `${drill.id}: needsNothing must be true`);
      }
    }
  });

  await t.test('trills are private, full-voice tier only', () => {
    for (const preset of ALL_PRESETS) {
      const trills = getVoiceDrillPack(preset).filter((drill) => drill.kind === 'trill');
      assert.equal(trills.length, 1, `${preset}: expected exactly one trill`);
      assert.equal(trills[0].tier, 'full', `${trills[0].id}: trill must be full-voice tier`);
      assert.ok(trills[0].tags.includes('private'), `${trills[0].id}: trill must carry the private tag`);
    }
  });

  await t.test('sirens are quiet-capable (tier both) and carry the small three-step version', () => {
    for (const preset of ALL_PRESETS) {
      const sirens = getVoiceDrillPack(preset).filter((drill) => drill.kind === 'siren');
      assert.equal(sirens.length, 1, `${preset}: expected exactly one siren`);
      assert.equal(sirens[0].tier, 'both', `${sirens[0].id}: siren must be tier both`);
      assert.ok(
        sirens[0].cues.some((cue) => /three small steps/i.test(cue)),
        `${sirens[0].id}: siren needs its quiet three-step version cue`,
      );
    }
  });

  await t.test('every quiet-capable kind exists per preset (hum + sustained tier both)', () => {
    for (const preset of ALL_PRESETS) {
      const pack = getVoiceDrillPack(preset);
      for (const kind of ['hum_sovt', 'sustained']) {
        const drill = pack.find((entry) => entry.kind === kind);
        assert.ok(drill, `${preset}: missing ${kind}`);
        assert.equal(drill.tier, 'both', `${drill.id}: ${kind} should be tier both`);
      }
    }
  });

  await t.test('no banned words (straw/whisper/score/streak) in ANY drill string, legacy included', () => {
    for (const preset of ALL_PRESETS) {
      for (const drill of getVoiceDrillPack(preset)) {
        for (const text of collectDrillStrings(drill)) {
          assert.ok(
            !BANNED_WORDS.test(text),
            `banned word in ${preset}/${drill.id}: "${text}"`,
          );
        }
      }
    }
  });

  await t.test('vocalise ids resolve through getVoiceDrillById', () => {
    // RE-POINTED 2026-07-26: the masc-* vocalise lane retired with the
    // masculinizing direction. RE-POINTED again 2026-07-30: the andro-* lane is
    // retiring too, so this uses soft-feminine. The assertion is about id
    // RESOLUTION, not about any lane's sound, so any live preset + one of its own
    // vocalise ids proves it.
    const drill = getVoiceDrillById('soft-feminine', 'soft-vocalise-siren');
    assert.ok(drill, 'soft-vocalise-siren should resolve');
    assert.equal(drill.kind, 'siren');
    assert.equal(drill.needsNothing, true);
  });
});
