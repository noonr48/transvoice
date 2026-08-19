/**
 * Self-practice menu (2026-07-29).
 *
 * The mode exists so a learner can practise in two free minutes without talking
 * to the tutor. These tests pin the properties that make that true: nothing
 * needs a prop, nothing needs session state, nothing has words in it, and —
 * after the owner's ruling — NOTHING NEEDS TO BE LOUD unless the learner
 * explicitly asks for it.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  listSelfPracticeDrills, isQuietCapable, isOfferable, SELF_PRACTICE_KINDS,
} = require('./self-practice');
const { getVoiceDrillPack, listVoiceDrillPresetKeys } = require('../voice-drills');
const { PRESET_PROFILES } = require('../voice-cue-sheet');

const PRESET = 'everyday-feminine';

// DERIVED, not hand-listed (2026-07-30). This was a literal seven-id array, and
// when `androgynous` and `gender-neutral` were removed it went wrong in TWO ways
// at once: the census test below failed loudly, while the three prop/volume sweep
// tests kept PASSING because `listSelfPracticeDrills` returns [] for an unknown
// preset — so their inner loops simply ran zero times for those two ids and the
// sweep silently shrank.
//
// DERIVED FROM THE PRESET REGISTRY, NOT THE DRILL REGISTRY — this distinction is
// the whole point. The first repair of this line used
// `listVoiceDrillPresetKeys()`, which is where menus COME FROM, and that rebuilt
// the same silent-coverage hole one level up: a preset that exists in
// PRESET_PROFILES but has no drill pack authored would be absent from the derived
// list, so every sweep below would skip it and the learner would open an EMPTY
// self-practice menu with all 13 tests green. MEASURED: adding a 6th preset to
// PRESET_PROFILES with no pack gave `listSelfPracticeDrills(...).length === 0` and
// still 13/13 pass. Deriving from PRESET_PROFILES instead makes that preset trip
// `assert.ok(menu.length > 0)` in the census below, which is where it belongs.
const PRESETS = Object.keys(PRESET_PROFILES);

test('every preset offers a self-practice menu, and every entry is a pure sound', () => {
  // A derived-and-empty list would make this census vacuously true, so the
  // registry itself is checked before it is trusted.
  assert.ok(PRESETS.length > 0, 'the preset registry reported no presets at all');
  // The two registries must agree. Named explicitly so the failure says WHICH
  // preset has no drill pack, rather than only "offered nothing" — a preset can
  // be added to PRESET_PROFILES and to the DSP canon without anyone authoring its
  // drills, and that ships an empty self-practice menu to a real learner.
  assert.deepEqual(
    [...PRESETS].sort(), [...listVoiceDrillPresetKeys()].sort(),
    'the preset registry and the drill registry disagree — some preset has no drill pack',
  );
  for (const presetKey of PRESETS) {
    const menu = listSelfPracticeDrills({ presetKey, allowLoud: true });
    assert.ok(menu.length > 0, `${presetKey} offered nothing`);
    for (const entry of menu) {
      assert.ok(SELF_PRACTICE_KINDS.has(entry.kind), `${presetKey}/${entry.id} is not a pure sound`);
    }
  }
});

// --- THE LOUDNESS RULING --------------------------------------------------
// Owner, 2026-07-29: "just make sure the practices don't need to be too loud",
// after objecting that a siren "breaks that boundary" because "one of the most
// difficult things a person has to face is dealing with loud vocalisations.
// they are shy and uncomfortable of their own voice."

test('THE DEFAULT NEEDS NO VOLUME — nothing loud is handed to the learner', () => {
  const quiet = listSelfPracticeDrills({ presetKey: PRESET });
  const loud = listSelfPracticeDrills({ presetKey: PRESET, allowLoud: true });

  assert.ok(quiet.length > 0, 'the quiet default must still offer something');
  assert.ok(quiet.length < loud.length, 'the default should offer strictly less than opting into loud');
  for (const entry of quiet) {
    assert.equal(entry.quietCapable, true, `${entry.id} has no quiet way to do it`);
  }
});

test('the loudest work is opt-in ONLY, and strictly so', () => {
  // brrr and small-voice/big-voice are real work, but they are not what a shy
  // learner should meet when they open a two-minute practice list.
  const loudKinds = ['trill', 'resonance_play'];
  const quiet = listSelfPracticeDrills({ presetKey: PRESET });
  for (const kind of loudKinds) {
    assert.equal(quiet.some((d) => d.kind === kind), false, `${kind} appeared without opting in`);
  }
  const loud = listSelfPracticeDrills({ presetKey: PRESET, allowLoud: true });
  for (const kind of loudKinds) {
    assert.equal(loud.some((d) => d.kind === kind), true, `${kind} vanished entirely`);
  }
  // Only a literal `true` opts in. Anything else stays quiet — a confused
  // caller must never be the reason someone is handed a lip trill.
  for (const sloppy of [undefined, null, '', 'true', 'yes', 1, {}, []]) {
    assert.deepEqual(
      listSelfPracticeDrills({ presetKey: PRESET, allowLoud: sloppy }), quiet,
      `allowLoud=${JSON.stringify(sloppy)} unlocked full-voice work`,
    );
  }
});

test('NO DEFAULT COPY ASKS FOR VOLUME — every preset, every field', () => {
  // THE RULING'S REAL GUARD. An earlier version of this test checked one cue on
  // ONE preset, and a reviewer reproduced the exact defect it was meant to stop:
  // dropping quietCueIndex from the other six presets left them emitting "come
  // down until it is FULL again" as the default siren cue, with all 12 tests
  // green. The prop-word sweep in this file already loops every preset; the
  // property the owner actually asked about was the one not swept.
  const volume = /\b(loud(er|ly|ness)?|volume|project(ion|ed)?|full|big(ger|gest)?|belt|shout|boom|carry)\b/i;
  for (const presetKey of PRESETS) {
    for (const entry of listSelfPracticeDrills({ presetKey })) {
      for (const field of ['title', 'focus', 'phrase', 'cue']) {
        const value = entry[field];
        if (typeof value !== 'string') continue;
        assert.equal(
          volume.test(value), false,
          `${presetKey}/${entry.id} ${field} asks for volume: "${value}"`,
        );
      }
    }
  }
});

test('a drill whose primary cue DEMANDS volume serves its quiet alternative instead', () => {
  // quietCueIndex marks "cues[0] asks for loudness". Wherever it is set, the
  // default must not be cues[0] — checked on every preset, not just one.
  const pack = getVoiceDrillPack(PRESET);
  const marked = pack.filter((d) => Number.isInteger(d.quietCueIndex));
  assert.ok(marked.length > 0, 'fixture check: some drill should mark a loud primary cue');

  for (const presetKey of PRESETS) {
    const quiet = listSelfPracticeDrills({ presetKey });
    const loud = listSelfPracticeDrills({ presetKey, allowLoud: true });
    for (const drill of getVoiceDrillPack(presetKey)) {
      if (!Number.isInteger(drill.quietCueIndex)) continue;
      const quietEntry = quiet.find((d) => d.id === drill.id);
      const loudEntry = loud.find((d) => d.id === drill.id);
      if (!quietEntry) continue;
      assert.notEqual(
        quietEntry.cue, drill.cues[0],
        `${presetKey}/${drill.id} served its loud primary cue by default`,
      );
      assert.equal(quietEntry.cue, drill.cues[drill.quietCueIndex]);
      assert.equal(loudEntry.cue, drill.cues[0], `${presetKey}/${drill.id} ignored the opt-in`);
    }
  }
});

// --- the standing guarantees ----------------------------------------------

test('THE ZERO-PROP GUARANTEE is enforced, not assumed', () => {
  // Every real vocalise carries needsNothing:true, so looping the pack and
  // asserting it proves NOTHING about the filter — that version of this test
  // passed against a module that ignored its arguments. The only way to prove
  // the flag is read is to present a drill that lacks it.
  const withoutGuarantee = {
    id: 'fixture-prop-drill',
    kind: 'sustained',
    tier: 'both',
    title: 'Straw hold',
    focus: 'fixture',
    phrase: 'ssss through a straw',
    cues: ['Find a drinking straw.'],
    tags: ['vocalise'],
    // needsNothing deliberately ABSENT
  };
  assert.equal(isOfferable(withoutGuarantee, true), false, 'a drill without the guarantee was offered');
  assert.equal(isOfferable({ ...withoutGuarantee, needsNothing: false }, true), false);
  assert.equal(isOfferable({ ...withoutGuarantee, needsNothing: 'yes' }, true), false, 'truthy is not true');
  assert.equal(isOfferable({ ...withoutGuarantee, needsNothing: true }, true), true);
});

test('no drill the menu can emit asks for equipment in its own words', () => {
  // A machine-checkable flag that lies is worse than no flag. This reads the
  // actual strings a learner sees, across every preset and both volumes.
  const props = /\b(straw|mirror|phone|recorder|candle|cork|bottle|glass|app|timer|headphones)\b/i;
  for (const presetKey of PRESETS) {
    for (const allowLoud of [true, false]) {
      for (const entry of listSelfPracticeDrills({ presetKey, allowLoud })) {
        for (const field of ['title', 'focus', 'phrase', 'cue']) {
          const value = entry[field];
          if (typeof value !== 'string') continue;
          assert.equal(props.test(value), false, `${entry.id} ${field} asks for a prop: "${value}"`);
        }
      }
    }
  }
});

// RE-POINTED 2026-07-30 — was 'the NEUTRAL register is served to a neutral
// preset — the wrong-lane guard'.
//
// DELETED — the copy-divergence assertion:
//   assert.notEqual(feminineSiren.phrase, neutralSiren.phrase,
//     'the two registers returned identical copy — the preset is not being read')
// It compared `everyday-feminine`'s siren against `gender-neutral`'s and proved
// the two REGISTERS differed in the words the learner reads.
//
// WHY IT CANNOT BE RE-POINTED. Measured across the five surviving presets, every
// learner-visible field of every self-practice entry is now byte-IDENTICAL —
// title, focus, phrase, cue and difficulty all match for all five, for both
// volume settings. The neutral packs were the only ones carrying a distinct
// vocalise register, so with them gone there is no preset pair left whose copy
// differs, and any `notEqual` on copy would simply be a false assertion. It is
// left deleted rather than softened to something that cannot fail.
//   (Worth knowing downstream: the self-practice menu is therefore effectively
//   preset-independent apart from drill ids. That is a product observation, not a
//   test failure, and no source was changed for it here.)
//
// WHAT SURVIVES, AND WHY IT STILL EARNS ITS PLACE. The defect class this test was
// written for is "a module returning one hard-coded list for every preset" — and
// that IS still detectable, because drill ids are synthesised per preset
// (cute-vocalise-siren / soft-vocalise-siren / ...). The id check is kept and
// widened from one pair to every preset, which is a stronger guard than the
// original: an implementation that ignored presetKey would return one id set for
// all five and fail here. Verified to fail under a mutation that stops reading
// presetKey.
test('each preset is served its OWN drills — the wrong-lane guard', () => {
  const idsByPreset = new Map(
    PRESETS.map((presetKey) => [
      presetKey,
      listSelfPracticeDrills({ presetKey, allowLoud: true }).map((d) => d.id).sort(),
    ]),
  );

  for (const [presetKey, ids] of idsByPreset) {
    assert.ok(ids.length > 0, `${presetKey} offered no drills to check`);
  }

  // No two presets may share an id set: that is what "one hard-coded list for
  // everyone" looks like from the outside.
  const seen = new Map();
  for (const [presetKey, ids] of idsByPreset) {
    const signature = ids.join('|');
    assert.equal(
      seen.has(signature), false,
      `${presetKey} and ${seen.get(signature)} returned the SAME drill ids — the preset is not being read`,
    );
    seen.set(signature, presetKey);
  }
  assert.equal(seen.size, PRESETS.length, 'expected one distinct drill-id set per preset');

  // And the ids a preset serves must be its own pack's, not another preset's.
  for (const [presetKey, ids] of idsByPreset) {
    const ownIds = new Set(getVoiceDrillPack(presetKey).map((d) => d.id));
    for (const id of ids) {
      assert.ok(ownIds.has(id), `${presetKey} was served "${id}", which is not in its own drill pack`);
    }
  }
});

test('NOTHING WITH WORDS IN IT is offered — the tutor owns those rungs', () => {
  const pack = getVoiceDrillPack(PRESET);
  const phraseDrills = pack.filter((d) => !SELF_PRACTICE_KINDS.has(d.kind));
  assert.ok(phraseDrills.length > 0, 'fixture check: the pack should contain phrase drills');

  const offered = new Set(listSelfPracticeDrills({ presetKey: PRESET, allowLoud: true }).map((d) => d.id));
  for (const drill of phraseDrills) {
    assert.equal(offered.has(drill.id), false, `${drill.id} is a word drill and must not be in self-practice`);
  }
});

test('isQuietCapable vetoes on the private tag INDEPENDENTLY of tier', () => {
  // Two separate vetoes on purpose: a drill can be excluded from quiet practice
  // without changing the tier it was authored with.
  assert.equal(isQuietCapable({ tier: 'both', tags: ['private'] }), false);
  assert.equal(isQuietCapable({ tier: 'full', tags: [] }), false);
  assert.equal(isQuietCapable({ tier: 'both', tags: [] }), true);
  assert.equal(isQuietCapable({ tier: 'quiet', tags: [] }), true);
  assert.equal(isQuietCapable({}), false, 'an untiered drill must not be assumed quiet');
});

test('an entry carries the sound and exactly ONE cue', () => {
  // A two-minute reminder that opens with three paragraphs is not a reminder.
  for (const entry of listSelfPracticeDrills({ presetKey: PRESET, allowLoud: true })) {
    assert.ok(entry.title, `${entry.id} has no title`);
    assert.ok(entry.phrase, `${entry.id} has no sound to make`);
    assert.ok(entry.cue, `${entry.id} has no cue`);
    assert.equal(typeof entry.cue, 'string', `${entry.id} cue is not a single string`);
  }
});

test('NO SESSION STATE IS REQUIRED — asserted STRUCTURALLY, not by calling it', () => {
  // The earlier version of this test was `assert.ok(menu.length > 0)` — the same
  // assertion already made above, and it survived an argument-ignoring stub.
  // Statelessness is a property of the DEPENDENCY GRAPH, so read that instead:
  // the module may import the leaf drill data and nothing else, and that leaf
  // must itself import nothing. Anything else (a session store, a runtime, a
  // progression) and the mode has stopped being openable in two free minutes.
  const requires = (file) => [...fs.readFileSync(path.join(__dirname, file), 'utf8')
    .matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);

  assert.deepEqual(
    requires('self-practice.js'), ['../voice-drills'],
    'self-practice grew a dependency beyond the leaf drill data',
  );
  assert.deepEqual(
    requires('../voice-drills.js'), [],
    'the drill data is no longer a leaf — statelessness can no longer be claimed',
  );
});

test('an unknown or missing preset yields an empty menu, never a crash', () => {
  assert.deepEqual(listSelfPracticeDrills({ presetKey: 'not-a-preset' }), []);
  assert.deepEqual(listSelfPracticeDrills({}), []);
  assert.deepEqual(listSelfPracticeDrills(), []);
});
