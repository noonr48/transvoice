'use strict';

// DSP scoring parity — the JS student-model thresholds must stay in a KNOWN
// relationship to the analyzer's own target profiles.
//
// WHY THIS EXISTS. `VOICE_STUDENT_MODEL_PRESETS` (backend/voice-session-state.js)
// is a hand-maintained mirror of `TARGET_PROFILES`
// (services/voice-trainer/src/services/audio_analysis.py). Nothing enforced the
// relationship, and that produced three scoring defects found only by accident:
//   - androgynous / gender-neutral were ABSENT, so neutral learners fell through
//     to cute-feminine's ~195 Hz floor;
//   - soft-feminine was ABSENT, so it inherited that same floor when its own DSP
//     profile asks for 175;
//   - the neutral weight band was offset rather than widened, so a learner
//     sitting exactly on the DSP target scored INCORRECT.
// It is the same mirror-drift class that let the UI keep offering a preset the
// DSP had already dropped (see frontend/src/voice/preset-parity.test.ts, which
// applies the same read-don't-copy principle to the preset id LIST).
//
// WHAT IT ASSERTS. Not equality — the JS rows carry a DELIBERATE leniency offset
// so a learner is not failed for sitting exactly on the analyzer's floor. It
// asserts each row stays inside the offset band the source itself documents:
//   minPitchHz    = pitch_floor_hz + 7 .. +14
//   maxWeightMean = max_weight_mean + 0.16 .. +0.20   (FEMININE rows)
//   maxWeightMean = max_weight_mean exactly           (NEUTRAL rows)
// The neutral exception is load-bearing and documented at the table: for a
// neutral target `maxWeightMean` is consumed as a band CENTRE, not a ceiling, so
// adding the family offset SHIFTS the band instead of widening it.
//
// BOTH SIDES ARE PARSED FROM SOURCE. Reading the JS table via require() would
// need an export that does not exist, and copying either list into this file
// would recreate the very drift the test exists to catch.

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const PITCH_OFFSET_MIN = 7;
const PITCH_OFFSET_MAX = 14;
const WEIGHT_OFFSET_MIN = 0.16;
const WEIGHT_OFFSET_MAX = 0.20;
// Removed 2026-07-30: `const NEUTRAL_PRESETS = new Set(['androgynous', 'gender-neutral'])`
// and the branch that read it. Those presets were retired with the MTF-only
// narrowing, so the ids can no longer appear in the parsed DSP table and the
// branch was unreachable — an `if` that can never be true reads as live coverage
// of a rule nothing enforces. The weight-offset rule below now applies to every
// row, which is what "every live preset is feminine" actually means.

function readDspProfiles() {
  const source = readFileSync(
    resolve(__dirname, '../services/voice-trainer/src/services/audio_analysis.py'),
    'utf8',
  );
  const block = source.match(/TARGET_PROFILES:[^=]*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'could not locate TARGET_PROFILES in audio_analysis.py');

  const profiles = {};
  const entry = /^\s{4}"([a-z0-9-]+)":\s*VoiceTargetProfile\(([\s\S]*?)^\s{4}\),/gm;
  for (const match of block[1].matchAll(entry)) {
    const [, id, body] = match;
    const floor = body.match(/pitch_floor_hz\s*=\s*([\d.]+)/);
    const weight = body.match(/max_weight_mean\s*=\s*([\d.]+)/);
    profiles[id] = {
      pitchFloorHz: floor ? Number(floor[1]) : null,
      maxWeightMean: weight ? Number(weight[1]) : null,
    };
  }
  // A silently-empty parse would pass every assertion below and be WORSE than
  // the hand-copy it replaces, so it fails loudly instead.
  assert.ok(Object.keys(profiles).length > 0, 'parsed TARGET_PROFILES but found no profiles');
  return profiles;
}

function readJsPresetTargets() {
  const source = readFileSync(resolve(__dirname, 'voice-session-state.js'), 'utf8');
  const block = source.match(/VOICE_STUDENT_MODEL_PRESETS\s*=\s*\{([\s\S]*?)\n {2}\};/);
  assert.ok(block, 'could not locate VOICE_STUDENT_MODEL_PRESETS in voice-session-state.js');

  const rows = {};
  // Keys appear BOTH quoted and bare: hyphenated ids must be quoted
  // ('gender-neutral'), a bare identifier need not be (androgynous). An
  // earlier version of this regex required the quotes and silently missed the
  // bare row — the failure mode this file exists to prevent, so it is pinned in
  // the "every live DSP preset has a student-model row" case above.
  const entry = /(?:'([a-z0-9-]+)'|([A-Za-z_$][\w$]*))\s*:\s*\{([\s\S]*?)\n\s{4}\},/g;
  for (const match of block[1].matchAll(entry)) {
    const [, quotedId, bareId, body] = match;
    const id = quotedId || bareId;
    const pitch = body.match(/minPitchHz:\s*([\d.]+)/);
    const weight = body.match(/maxWeightMean:\s*([\d.]+)/);
    rows[id] = {
      minPitchHz: pitch ? Number(pitch[1]) : null,
      maxWeightMean: weight ? Number(weight[1]) : null,
    };
  }
  assert.ok(Object.keys(rows).length > 0, 'parsed VOICE_STUDENT_MODEL_PRESETS but found no rows');
  return rows;
}

test('DSP scoring parity', async (t) => {
  const dsp = readDspProfiles();
  const js = readJsPresetTargets();

  await t.test('every live DSP preset has a student-model row', () => {
    // The absence of a row is the defect that hit neutral AND soft-feminine:
    // the lookup falls back to cute-feminine, silently scoring the learner
    // against a target that is not theirs.
    const missing = Object.keys(dsp).filter((id) => !js[id]);
    assert.deepEqual(missing, [], `presets missing from VOICE_STUDENT_MODEL_PRESETS: ${missing.join(', ')}`);
  });

  await t.test('no student-model row survives for a preset the DSP dropped', () => {
    const orphans = Object.keys(js).filter((id) => !dsp[id]);
    assert.deepEqual(orphans, [], `student-model rows with no DSP profile: ${orphans.join(', ')}`);
  });

  await t.test('minPitchHz sits in the documented +7..+14 leniency band', () => {
    for (const [id, profile] of Object.entries(dsp)) {
      if (profile.pitchFloorHz === null || !js[id] || js[id].minPitchHz === null) continue;
      const offset = js[id].minPitchHz - profile.pitchFloorHz;
      assert.ok(
        offset >= PITCH_OFFSET_MIN && offset <= PITCH_OFFSET_MAX,
        `${id}: minPitchHz ${js[id].minPitchHz} is DSP floor ${profile.pitchFloorHz} ${offset >= 0 ? '+' : ''}${offset}, outside the documented +${PITCH_OFFSET_MIN}..+${PITCH_OFFSET_MAX} band`,
      );
    }
  });

  await t.test('maxWeightMean: every row carries the documented leniency offset', () => {
    let checked = 0;
    for (const [id, profile] of Object.entries(dsp)) {
      if (profile.maxWeightMean === null || !js[id] || js[id].maxWeightMean === null) continue;
      const offset = Number((js[id].maxWeightMean - profile.maxWeightMean).toFixed(4));
      assert.ok(
        offset >= WEIGHT_OFFSET_MIN - 1e-9 && offset <= WEIGHT_OFFSET_MAX + 1e-9,
        `${id}: maxWeightMean ${js[id].maxWeightMean} is DSP ${profile.maxWeightMean} +${offset}, outside the documented +${WEIGHT_OFFSET_MIN}..+${WEIGHT_OFFSET_MAX} band`,
      );
      checked += 1;
    }
    // A loop over an empty or unparsed table asserts nothing. Say so out loud.
    assert.ok(checked >= 5, `expected at least 5 comparable rows, checked ${checked}`);
  });

  await t.test('no retired masculinizing preset appears on either side', () => {
    const retired = [...Object.keys(dsp), ...Object.keys(js)].filter((id) => /^(?:masc|ftm)/i.test(id));
    assert.deepEqual(retired, [], `retired target ids present: ${retired.join(', ')}`);
  });
});
