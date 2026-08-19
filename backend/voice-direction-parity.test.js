'use strict';

// Direction-parity coverage for the cue-sheet / runtime-policy preset registries
// and the /coach retirement redirect. Preset ids mirror the DSP canon in
// services/voice-trainer/src/services/audio_analysis.py TARGET_PROFILES.
//
// 2026-07-26 MTF-ONLY: the masculine preset is retired. This file is RE-POINTED,
// not deleted — its job is to prove a cue never pushes a learner the wrong way,
// and that guard still protects the surviving feminine path.
//
// 2026-07-30 MTF-ONLY, ROUND 2: `androgynous` and `gender-neutral` were removed
// too, so there is no second direction left and the feminizing-vs-neutral parity
// axis is GONE. What replaces it:
//   - the direction-COMPARISON tests are deleted (a neutral cue sheet, a neutral
//     policy line, and a neutral register no longer exist to compare against);
//   - the CENSUS tests survive, but they no longer restate a hand-copied id list
//     — they read the analyzer canon, so they now catch registry drift in either
//     direction instead of only failing when someone edits this file;
//   - the FALLBACK-EQUIVALENCE tests survive and were WIDENED to cover the two
//     removed neutral ids. They are the load-bearing guard now: a removed preset
//     must be handled byte-for-byte as any other unrecognised string.
// Every deletion is annotated at its site with what it used to prove.

const assert = require('node:assert/strict');
const test = require('node:test');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

const {
  buildVoiceCueSheet,
  normalizeTargetPreset,
  getCueLane,
  PRESET_PROFILES,
} = require('./voice-cue-sheet');
const policy = require('./voice-tutor-runtime-policy');
const serverApi = require('../server');

// THE SOURCE OF TRUTH IS THE ANALYZER, NOT THIS FILE. `TARGET_PROFILES` in
// services/voice-trainer/src/services/audio_analysis.py decides which presets
// exist; five JS registries hand-copy that list and NOTHING keeps them in sync.
// This file used to hardcode the seven ids, which meant the census tests below
// were really only asserting "this file agrees with itself" — so the 2026-07-30
// removal broke them for the wrong reason and a JS/DSP desync would not have
// broken them at all. Reading the canon makes the same assertions REAL: they now
// fail when any registry drifts from the analyzer in either direction. (Same
// read-don't-copy principle as voice-student-preset-dsp-parity.test.js and
// frontend/src/voice/preset-parity.test.ts.)
function readDspCanon() {
  const source = readFileSync(
    resolve(__dirname, '../services/voice-trainer/src/services/audio_analysis.py'),
    'utf8',
  );
  // The dataclass default is READ, never assumed: no profile currently passes an
  // explicit `direction=`, so they all inherit it. Hardcoding the wrong default
  // here would silently mis-label every preset and make the direction census
  // pass for the wrong reason.
  const defaultDirection = source.match(/^\s{4}direction:\s*str\s*=\s*"([a-z-]+)"/m);
  assert.ok(defaultDirection, 'could not read the VoiceTargetProfile direction default');

  const block = source.match(/TARGET_PROFILES:[^=]*=\s*\{([\s\S]*?)\n\}/);
  assert.ok(block, 'could not locate TARGET_PROFILES in audio_analysis.py');

  const canon = {};
  const entry = /^\s{4}"([a-z0-9-]+)":\s*VoiceTargetProfile\(([\s\S]*?)^\s{4}\),/gm;
  for (const [, id, body] of block[1].matchAll(entry)) {
    const explicit = body.match(/\bdirection\s*=\s*"([a-z-]+)"/);
    canon[id] = explicit ? explicit[1] : defaultDirection[1];
  }
  // A silently-empty parse would make every census below VACUOUSLY true, which is
  // worse than the hand-copy it replaces, so it fails loudly instead.
  assert.ok(Object.keys(canon).length > 0, 'parsed TARGET_PROFILES but found no profiles');
  // ...and a PARTIALLY-silent parse is the subtler version of the same failure.
  // The `entry` regex requires the multi-line `\n    ),` terminator every current
  // profile uses, so a profile written on ONE line would be skipped without a
  // word — and because the JS registries are hand-copies of this file, a
  // Python-only addition in that style would then satisfy the set-equality census
  // below instead of breaking it. Counting the entries with an INDEPENDENT, much
  // looser pattern and demanding the two agree closes that: the parse must
  // account for every profile the block declares, whatever its formatting.
  const declared = [...block[1].matchAll(/^\s{4}"([a-z0-9-]+)":\s*VoiceTargetProfile\(/gm)].map((m) => m[1]);
  assert.deepEqual(
    Object.keys(canon).sort(), [...declared].sort(),
    'readDspCanon silently skipped a TARGET_PROFILES entry — its regex does not match that profile\'s formatting',
  );
  return canon;
}

const DSP_CANON = readDspCanon();
const CANONICAL_PRESETS = Object.keys(DSP_CANON);
// Derived, so retiring a direction narrows this automatically instead of leaving
// a test that still accepts a direction no preset can produce.
const CANONICAL_DIRECTIONS = [...new Set(Object.values(DSP_CANON))].sort();

// Retired with the masculinizing direction (2026-07-26).
const RETIRED_MASC_PRESETS = ['masculine', 'masc-deep', 'masc-natural', 'masc-warm', 'masc-bright'];
// Retired with the neutral direction (2026-07-30, MTF-only).
const RETIRED_NEUTRAL_PRESETS = ['androgynous', 'gender-neutral'];
// A removed preset is a removed preset, whichever direction it left with: every
// live surface must treat it as an UNKNOWN preset, never as an alias of a live
// one. Both retirements are swept together so the next one inherits the guard.
const RETIRED_PRESETS = [...RETIRED_MASC_PRESETS, ...RETIRED_NEUTRAL_PRESETS];

// Frozen by consumers outside this module: practice-cards maps these to the
// numeric 0-3 emphasis and focus-line maps them to CSS classes.
const EMPHASIS_ENUM = new Set(['lift-ending', 'light-start', 'keep-bright', 'steady']);

test('normalizeTargetPreset accepts every canonical preset id and falls back on unknowns', () => {
  for (const preset of CANONICAL_PRESETS) {
    assert.equal(normalizeTargetPreset(preset), preset);
  }
  assert.equal(normalizeTargetPreset('mystery-voice'), 'cute-feminine');
  assert.equal(normalizeTargetPreset(''), 'cute-feminine');
  assert.equal(normalizeTargetPreset(undefined), 'cute-feminine');
  // 2026-07-30 WIDENED to the removed neutral ids. A removed preset is not a
  // lane, it is an unrecognised string — pinned by EQUIVALENCE to the unknown
  // case rather than against the literal 'cute-feminine', so it cannot start
  // passing for the wrong reason if the fallback target is ever changed.
  for (const preset of RETIRED_PRESETS) {
    assert.equal(
      normalizeTargetPreset(preset), normalizeTargetPreset('mystery-voice'),
      `${preset} must normalize exactly like an unrecognised preset`,
    );
  }
});

test('the retired presets are GONE from every preset registry', () => {
  for (const preset of RETIRED_PRESETS) {
    assert.equal(PRESET_PROFILES[preset], undefined, `${preset} still in PRESET_PROFILES`);
    assert.equal(policy.STYLE_TARGETS[preset], undefined, `${preset} still in STYLE_TARGETS`);
  }
  // No surviving profile claims a retired direction. 'neutral' joined 'masculine'
  // on 2026-07-30: leaving a profile with either would resurrect a lane whose
  // comparison tests have been deleted, i.e. an unguarded direction.
  for (const [preset, profile] of Object.entries(PRESET_PROFILES)) {
    for (const retired of ['masculine', 'neutral']) {
      assert.notEqual(profile.direction, retired, `${preset} still direction ${retired}`);
    }
  }
  assert.equal(Object.values(policy.STYLE_TARGETS).some((s) => /masculine/i.test(s)), false);
  // The DSP canon is the thing that decides, so assert the retirement there too —
  // a JS-only removal would leave the analyzer still offering the preset.
  for (const preset of RETIRED_PRESETS) {
    assert.equal(DSP_CANON[preset], undefined, `${preset} still in the analyzer's TARGET_PROFILES`);
  }
  assert.equal(CANONICAL_DIRECTIONS.includes('neutral'), false, 'a DSP profile still claims neutral');
});

test('every cue-sheet preset profile has the required shape and a known direction', () => {
  assert.deepEqual(Object.keys(PRESET_PROFILES).sort(), [...CANONICAL_PRESETS].sort());
  for (const [preset, profile] of Object.entries(PRESET_PROFILES)) {
    assert.equal(typeof profile.defaultIntent, 'string', `${preset} defaultIntent`);
    assert.ok(profile.defaultIntent.trim().length > 0, `${preset} defaultIntent non-empty`);
    assert.equal(typeof profile.defaultMask, 'string', `${preset} defaultMask`);
    assert.ok(profile.defaultMask.trim().length > 0, `${preset} defaultMask non-empty`);
    assert.ok(Array.isArray(profile.baseTeachingFocus) && profile.baseTeachingFocus.length > 0, `${preset} baseTeachingFocus`);
    assert.ok(profile.baseTeachingFocus.every((item) => typeof item === 'string' && item.trim()), `${preset} focus items`);
    // Derived from the analyzer canon, so a retired direction is rejected here
    // automatically. Was the literal ['feminine', 'neutral'] until 2026-07-30.
    assert.ok(CANONICAL_DIRECTIONS.includes(profile.direction), `${preset} direction`);
  }
  // A retired preset has no profile and gets NO special-casing: it lands in the
  // unknown-preset lane exactly as any other unrecognised string does. WIDENED
  // 2026-07-30 to the removed neutral ids (RETIRED_PRESETS now carries both
  // retirements), which is what replaced the deleted assertions below.
  for (const preset of [...RETIRED_PRESETS, 'ftm']) {
    assert.equal(
      getCueLane(preset), getCueLane('mystery-voice'),
      `${preset} must take the same cue lane as an unrecognised preset`,
    );
  }
  // A genuinely unknown preset keeps the historical feminizing default.
  assert.equal(getCueLane('mystery-voice'), 'feminine');
  // DELETED 2026-07-30: `getCueLane('androgynous') === 'neutral'` and the same
  // for 'gender-neutral'. They proved the two neutral presets drew their cue
  // vocabulary from the NEUTRAL lane rather than the feminine one. Both presets
  // were removed from every registry on 2026-07-30 (MTF-only), so getCueLane can
  // no longer return 'neutral' for anything and the correct behaviour for those
  // ids is the unknown-preset lane — asserted by the equivalence loop above.
  assert.equal(getCueLane('soft-feminine'), 'soft-feminine');
  assert.equal(getCueLane('cute-feminine'), 'feminine');
  // No live preset resolves to a lane whose direction-comparison tests are gone.
  for (const preset of CANONICAL_PRESETS) {
    assert.notEqual(getCueLane(preset), 'neutral', `${preset} still draws the neutral cue lane`);
  }
});

test('every preset builds a cue sheet whose emphasis values stay inside the frozen 0-3 enum', () => {
  const phrases = ['that sounds good to me', 'could you say that again?', 'wait, that is so cute!'];
  for (const preset of CANONICAL_PRESETS) {
    for (const phrase of phrases) {
      const sheet = buildVoiceCueSheet({ phrase, targetPreset: preset });
      assert.ok(sheet, `${preset} sheet for "${phrase}"`);
      assert.equal(sheet.targetPreset, preset);
      for (const token of sheet.tokens) {
        assert.ok(EMPHASIS_ENUM.has(token.emphasis), `${preset} emphasis "${token.emphasis}"`);
      }
    }
  }
});

// DELETED 2026-07-30 — test 'neutral cue sheets carry balanced language, not
// feminine sound cues'.
//
// WHAT IT PROVED. Built a cue sheet for `androgynous` with a resonance focus and
// asserted the NEUTRAL cue lane: teachingFocus carried 'balanced-center' and
// 'steady-weight' but NOT 'bright-vowels' or 'forward-placement'; no token's
// placementFeel/mouthShape/lipAction/note/cue contained any current feminine
// marker (/tongue sides on the upper molars|lip corners back|small smile spread|
// corners up|byack|kyooht/); and at least one token carried centered/even/
// balanced/mid guidance. It was the surviving half of the wrong-direction guard,
// re-pointed here from the masculine lane on 2026-07-26.
//
// WHY IT IS GONE. `androgynous` and `gender-neutral` were removed from every
// registry on 2026-07-30 (MTF-only), so `getCueLane` can never return 'neutral'
// and there is no non-feminine cue sheet left to hold to a non-feminine
// vocabulary. It is NOT re-pointed to a feminine preset: a feminine sheet is
// SUPPOSED to carry the feminine markers this test forbade, so any such version
// would have to drop the negative assertions that were the entire point. The
// residual property — that those two ids get the unknown-preset lane, not a lane
// of their own — is asserted in the census test above and in
// voice-retired-target-sweep.test.js.

test('soft-feminine sheets stay direction-appropriate while feminine output is unchanged', () => {
  // 2026-07-30: the `androgynous` half of this test was DELETED. It asserted the
  // neutral sheet carried 'balanced-center' and not 'bright-vowels'; the preset no
  // longer exists, so it now resolves to the feminine fallback and the assertion
  // is not merely failing but meaningless. The soft-feminine half below is the
  // surviving lane distinction — soft-feminine is a real, still-live lane that is
  // feminine WITHOUT being bright — plus the verbatim feminine regression pin.
  const soft = buildVoiceCueSheet({ phrase: 'how was your day', targetPreset: 'soft-feminine', focus: 'Soft, natural resonance' });
  assert.ok(soft.teachingFocus.includes('natural-resonance'));
  assert.ok(!soft.teachingFocus.includes('bright-vowels'));

  // Feminine regression pin (same assertions as the legacy plain-assert test).
  const feminine = buildVoiceCueSheet({ phrase: 'Could you say that again?', targetPreset: 'cute-feminine', focus: 'Playful intonation' });
  assert.equal(feminine.phraseIntent, 'curious check-in');
  assert.ok(feminine.cueLine.includes('uh-GEHN~'));
  assert.equal(feminine.tokens[0].airflowCue, 'tiny gasp start');
  assert.equal(feminine.tokens[2].placementFeel, 'tongue sides on the upper molars');
});

test('runtime policy covers the same canonical presets with direction-aware lines', () => {
  assert.deepEqual(Object.keys(policy.STYLE_TARGETS).sort(), [...CANONICAL_PRESETS].sort());
  for (const preset of CANONICAL_PRESETS) {
    assert.equal(policy.normalizeVoiceTutorTargetPreset(preset), preset);
    assert.ok(policy.getVoiceTutorStyleTarget(preset).startsWith(`${preset}:`));
  }
  assert.equal(policy.normalizeVoiceTutorTargetPreset('mystery-voice'), 'cute-feminine');
  // A retired preset is CORRUPT INPUT, not a lane. It gets no special handling
  // here — it normalizes exactly as any other unrecognised string does.
  for (const preset of RETIRED_PRESETS) {
    assert.equal(
      policy.normalizeVoiceTutorTargetPreset(preset),
      policy.normalizeVoiceTutorTargetPreset('mystery-voice'),
      `${preset} must be handled exactly like an unrecognised preset`,
    );
    assert.equal(
      policy.getVoiceTutorTargetDirection(preset),
      policy.getVoiceTutorTargetDirection('mystery-voice'),
      `${preset} direction must match an unrecognised preset`,
    );
  }
  // DELETED 2026-07-30: `getVoiceTutorTargetDirection('androgynous') === 'neutral'`
  // and the same for 'gender-neutral'. Both ids were removed from STYLE_TARGETS
  // and PRESET_DIRECTIONS, so they now take the unrecognised-preset path asserted
  // by the equivalence loop above. Replaced by a derived census, which is
  // strictly stronger than the two literals: EVERY live preset's direction must
  // be one the analyzer canon actually produces.
  assert.equal(policy.getVoiceTutorTargetDirection('soft-feminine'), 'feminine');
  for (const preset of CANONICAL_PRESETS) {
    assert.ok(
      CANONICAL_DIRECTIONS.includes(policy.getVoiceTutorTargetDirection(preset)),
      `${preset} direction "${policy.getVoiceTutorTargetDirection(preset)}" is not in the DSP canon`,
    );
    assert.equal(policy.getVoiceTutorTargetDirection(preset), DSP_CANON[preset], `${preset} direction parity`);
  }

  const feminineLines = policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: 'cute-feminine' });

  // Feminine wording preserved verbatim.
  assert.ok(feminineLines.some((line) => line.includes('female-affirming')));
  assert.ok(feminineLines.some((line) => line.includes('Pitch-stable dark/large rule')));
  assert.ok(feminineLines.some((line) => line.includes('"lighter voice weight"')));

  // DELETED 2026-07-30 — the neutral-policy-lines block. It built lines for
  // `gender-neutral` and proved they held the middle: they carried 'any gendered
  // baseline' and 'balanced centre', and carried NONE of the feminizing markers
  // ['female-affirming', 'dark/large', '"lighter voice weight"', 'Australian-bright',
  // 'brighter resonance']. That was the surviving half of the wrong-direction
  // guard. The preset is gone from STYLE_TARGETS and PRESET_DIRECTIONS, no policy
  // line emits either neutral phrase any more, and a feminine target is SUPPOSED
  // to carry every marker the block forbade — so there is nothing left to assert
  // and no honest re-point. What survives is the equivalence loop above (a
  // removed id gets the unrecognised-preset lines, byte for byte).

  // And no surviving policy line offers masculinizing guidance to anyone.
  // NOTE the \b: "female-affirming" contains "male-affirming" as a substring.
  const everyLine = CANONICAL_PRESETS.flatMap((p) => policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: p }));
  for (const marker of [/\bmale-affirming\b/, /let the weight settle/, /fuller resonance/]) {
    assert.equal(everyLine.some((line) => marker.test(line)), false, `no preset emits ${marker}`);
  }
});

// RE-POINTED 2026-07-26 (was: a blank-style masculine custom fallback), and again
// 2026-07-30 (was: a blank-style NEUTRAL custom fallback).
//
// DELETED 2026-07-30 — the two direction assertions this test used to carry:
//   assert.doesNotMatch(text, /small, sweet|female-affirming|lighter voice weight|brighter resonance/i)
//   assert.match(text, /any gendered baseline|balanced centre/i)
// They proved a custom style note saved against a NEUTRAL target reached the
// prompt WITHOUT dragging the feminizing wording in with it, and that the neutral
// policy lines were the ones that shipped. `gender-neutral` was removed on
// 2026-07-30, so the target now legitimately resolves to the feminine fallback and
// the feminizing wording is CORRECT output — asserting its absence would be
// asserting a bug.
//
// WHAT SURVIVES, AND WHY IT IS NOT A TRIVIAL PASS. The custom-note passthrough is
// the real contract here, and this is the ONLY test in the repo that pins it
// (grep: 'Custom style note' — one hit). It is kept and STRENGTHENED into the
// fallback-equivalence form, which is the property that actually matters now: a
// learner whose stored target was removed must get the same prompt as any other
// unrecognised target, WITH their saved bands still attached rather than silently
// dropped. Both halves fail if the style note stops riding through.
test('a custom style note rides through a fallback target, removed presets included', () => {
  const stylePrompt = 'Follow the exact saved pitch, resonance, and weight bands for this custom target; keep the sound comfortable and unforced.';
  const noteLine = /Custom style note: Follow the exact saved pitch, resonance, and weight bands/;

  const unknownText = policy.buildVoiceTutorRuntimePolicyLines({
    targetPreset: 'mystery-voice',
    stylePrompt,
  }).join('\n');
  assert.match(unknownText, noteLine);

  // A live preset carries it too, so the passthrough is not an artefact of the
  // fallback path.
  assert.match(
    policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: 'soft-feminine', stylePrompt }).join('\n'),
    noteLine,
  );

  // The removed ids are handled as exactly that unrecognised target — compared as
  // whole line arrays, so a partial divergence cannot hide behind a regex.
  for (const preset of RETIRED_PRESETS) {
    const lines = policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: preset, stylePrompt });
    assert.match(lines.join('\n'), noteLine, `${preset} dropped the learner's saved style note`);
    assert.deepEqual(
      lines,
      policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: 'mystery-voice', stylePrompt }),
      `${preset} with a custom style note differs from an unrecognised preset's lines`,
    );
  }
});

// ── MTF-only: no FTM rules ship, and a retired preset lands NEUTRAL ──────────

// FINDING 1 (2026-07-27): the coach system prompt carried an unconditional
// "Masculinizing (FTM) learners: FORBIDDEN cues = ... brighten, lighter weight,
// forward resonance" bullet that shipped on EVERY turn and contradicted the
// feminizing bullet directly above it. This pins the whole built prompt.
test('the built coach system prompt ships no masculinizing/FTM rules', () => {
  const { buildRendererSystemPrompt } = require('./coaching/renderer-client');
  for (const hasAudio of [false, true]) {
    const prompt = buildRendererSystemPrompt(hasAudio);
    const hits = prompt.match(/masculin|ftm/gi) || [];
    assert.deepEqual(hits, [], `hasAudio=${hasAudio} prompt still names ${hits.join(', ')}`);
    // The surviving direction rule is still present and still hard.
    assert.match(prompt, /DIRECTION CONSTRAINT \(HARD\)/);
    assert.match(prompt, /Feminizing learners: FORBIDDEN cues/);
    // The contradictory guidance is gone: nothing tells the coach to deepen.
    assert.doesNotMatch(prompt, /USE = chest resonance/);
  }
});

// RE-POINTED 2026-07-27 (SCOPE RULING: there is no female-to-male route and
// never was). An earlier round shipped a compatibility shim that resolved a
// retired masc id to the NEUTRAL lane so four stored sessions could keep
// practising. Those rows have been deleted and the owner ruled the value is
// CORRUPT INPUT, not a legacy lane — so the shim is gone and the property to
// pin flipped: a retired id must get NO special handling anywhere. The
// falsifiable form of that is EQUIVALENCE — every live surface must treat it
// byte-for-byte as it treats any other unrecognised string.
// 2026-07-30: RETIRED_PRESETS now carries BOTH retirements (masculinizing 07-26,
// neutral 07-30), so this sweep covers the two removed neutral ids as well —
// renamed off "masculinizing" to stop reading as narrower than it is.
test('a retired preset gets NO special handling on any live surface', () => {
  const { getVoiceDrillPack } = require('./voice-drills');
  const UNKNOWN = 'mystery-voice';
  for (const preset of [...RETIRED_PRESETS, 'ftm']) {
    // Surface 1 — runtime policy lines.
    assert.deepEqual(
      policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: preset }),
      policy.buildVoiceTutorRuntimePolicyLines({ targetPreset: UNKNOWN }),
      `${preset} policy lines differ from an unrecognised preset's`,
    );

    // Surface 2 — cue sheet. Compare the whole sheet, minus the echoed id.
    const retiredSheet = buildVoiceCueSheet({ phrase: 'that sounds good to me', targetPreset: preset });
    const unknownSheet = buildVoiceCueSheet({ phrase: 'that sounds good to me', targetPreset: UNKNOWN });
    assert.equal(normalizeTargetPreset(preset), normalizeTargetPreset(UNKNOWN), `${preset} normalizeTargetPreset`);
    assert.deepEqual(retiredSheet, unknownSheet, `${preset} cue sheet differs from an unrecognised preset's`);

    // Surface 3 — drill pack.
    assert.deepEqual(
      getVoiceDrillPack(preset), getVoiceDrillPack(UNKNOWN),
      `${preset} drill pack differs from an unrecognised preset's`,
    );
  }
});

// RE-POINTED 2026-07-27. Was: "both prompt sites fail closed to 'unknown'" —
// that was part of the same shim. The prompt LABEL sites now echo whatever the
// stored preset is, exactly as they do for any unrecognised value; a
// masculinizing target is rejected at the ANALYZER boundary
// (`normalize_target_preset` raises -> HTTP 400), which is the fail-closed path
// the scope ruling names as the correct and only response. What still must hold
// is that no BUILT COACH PROMPT teaches the retired direction — pinned here and
// by 'the built coach system prompt ships no masculinizing/FTM rules' above.
test('a retired preset gets no special prompt handling, and no prompt teaches the retired direction', () => {
  const { buildDeepTutorVoiceGuideRecords } = require('./deeptutor-voice-adapter');
  const { buildPlanningPrompt } = require('./lessons/lesson-planner');
  const UNKNOWN = 'mystery-voice';
  const goalFor = (targetPreset) => buildDeepTutorVoiceGuideRecords({ session: {}, voiceState: { targetPreset } })
    .find((record) => record.type === 'voice-goal');

  for (const preset of [...RETIRED_PRESETS, 'ftm']) {
    // Same shape as an unrecognised preset: the label is echoed, not rewritten,
    // and no branch exists to give a retired id its own treatment.
    const goal = goalFor(preset);
    assert.ok(goal, 'voice-goal record present');
    assert.equal(
      goal.output.replace(preset, UNKNOWN), goalFor(UNKNOWN).output,
      `${preset} takes a different path than an unrecognised preset in the Fable prompt`,
    );
    const plan = buildPlanningPrompt({ targetPreset: preset }, null, null);
    assert.equal(
      plan.replace(preset, UNKNOWN), buildPlanningPrompt({ targetPreset: UNKNOWN }, null, null),
      `${preset} takes a different path than an unrecognised preset in the planning prompt`,
    );
    // No masculinizing GUIDANCE is generated for it — only the echoed label may
    // contain the string, and nothing may teach a deepening cue.
    for (const text of [goal.output.replace(preset, UNKNOWN), plan.replace(preset, UNKNOWN)]) {
      assert.doesNotMatch(text, /masculin|\bftm\b/i, `${preset} generated masculinizing prompt content`);
      assert.doesNotMatch(text, /let the weight settle|fuller resonance|chest resonance/i);
    }
  }
  // A live preset is unaffected at both sites.
  assert.match(goalFor('soft-feminine').output, /^Target preset: soft-feminine$/m);
  assert.match(buildPlanningPrompt({ targetPreset: 'soft-feminine' }, null, null), /^- Target preset: soft-feminine$/m);
});

// ── /coach retirement ────────────────────────────────────────────────────────

function fakeApp() {
  const routes = [];
  const app = { routes };
  for (const method of ['get', 'post', 'put', 'patch', 'delete', 'all', 'use']) {
    app[method] = (route, ...handlers) => { routes.push({ method, route, handlers }); return app; };
  }
  app.dispatch = async (method, route, req, res) => {
    const entry = routes.find((item) => item.method === method && item.route === route);
    assert.ok(entry, `${method} ${route} registered`);
    let index = 0;
    const next = async (error) => {
      if (error) throw error;
      const handler = entry.handlers[index++];
      if (handler) return handler(req, res, next);
    };
    return next();
  };
  return app;
}

function fakeResponse() {
  return {
    statusCode: 200,
    headers: {},
    body: undefined,
    redirectedTo: null,
    redirectStatus: null,
    status(code) { this.statusCode = code; return this; },
    setHeader(name, value) { this.headers[name.toLowerCase()] = value; },
    set(name, value) { this.headers[name.toLowerCase()] = value; return this; },
    type(value) { this.headers['content-type'] = value; return this; },
    json(value) { this.body = value; return this; },
    send(value) { this.body = value; return this; },
    redirect(status, url) { this.redirectStatus = status; this.redirectedTo = url; return this; },
    end() {},
  };
}

function registrarOptions(overrides = {}) {
  return {
    env: {},
    debugImpl: { log() {}, getEvents() { return []; }, getSummary() { return {}; }, clearEvents() {}, tailLines() { return []; }, grepLines() { return []; } },
    fetchImpl: async () => { throw new Error('unused fetch'); },
    uploadMiddleware(_req, _res, next) { next(); },
    referenceHandler() {},
    assetGetters: { getCoachHtml: () => '<html>legacy coach</html>', getCoachJs: () => 'js', getPhoneticDict: () => 'dict' },
    fsImpl: { readFile(_file, _enc, cb) { cb(null, '<html><body>app</body></html>'); } },
    pathImpl: { join: (...parts) => parts.join('/') },
    distDir: '/fake-dist',
    ...overrides,
  };
}

test('/coach 302-redirects to /app?mode=coach and carries query params across', async () => {
  const app = fakeApp();
  serverApi.registerCoachRoutes(app, registrarOptions());

  const plain = fakeResponse();
  await app.dispatch('get', '/coach', { query: {} }, plain);
  assert.equal(plain.redirectStatus, 302);
  assert.equal(plain.redirectedTo, '/app?mode=coach');

  const withQuery = fakeResponse();
  await app.dispatch('get', '/coach', { query: { sessionId: 'abc-123', mode: 'ignored' } }, withQuery);
  assert.equal(withQuery.redirectStatus, 302);
  assert.equal(withQuery.redirectedTo, '/app?mode=coach&sessionId=abc-123');
});

test('/coach-legacy still serves the prior coach page with no-store headers', async () => {
  const app = fakeApp();
  serverApi.registerCoachRoutes(app, registrarOptions());
  const res = fakeResponse();
  await app.dispatch('get', '/coach-legacy', {}, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, '<html>legacy coach</html>');
  assert.ok(String(res.headers['cache-control']).includes('no-store'));

  // Asset-unavailable behavior moved with the page: generic no-store 503.
  const failingGetters = {
    getCoachHtml: () => { const error = new Error('SECRET_ASSET_PATH'); error.code = 'COACH_ASSET_UNAVAILABLE'; throw error; },
    getCoachJs: () => 'js',
    getPhoneticDict: () => 'dict',
  };
  const failing = fakeApp();
  serverApi.registerCoachRoutes(failing, registrarOptions({ assetGetters: failingGetters }));
  const unavailable = fakeResponse();
  await failing.dispatch('get', '/coach-legacy', {}, unavailable);
  assert.equal(unavailable.statusCode, 503);
  assert.equal(unavailable.body, 'Required coach asset is unavailable.');
  assert.equal(String(unavailable.body).includes('SECRET_ASSET_PATH'), false);
});
