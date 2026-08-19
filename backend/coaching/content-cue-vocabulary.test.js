'use strict';

// 2026-07-27 — CONTENT-AUDIT REGRESSION SCAN for the three cue-vocabulary laws.
//
// Sibling of content-product-laws.test.js and deliberately the same shape. The
// sanitizer guards what the MODEL says; this guards what the CODE says. Drill
// packs, cue sheets, practice-card focus statements, cockpit lines and lesson
// knowledge points never pass through sanitizeCoachReply — the code owns them,
// so nothing sanitizes them — which means a metaphor committed here reaches the
// learner unfiltered.
//
// It reuses the sanitizer's OWN exported rule tables rather than a second copy,
// so the content contract can never drift from the runtime contract and
// widening a law automatically re-audits all existing content.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { CUE_VOCABULARY_RULES, CONTRAINDICATED_RULES } = require('./sanitizer');
const { getVoiceDrillPack } = require('../voice-drills');
const { buildVoiceCueSheet } = require('../voice-cue-sheet');
const { buildFallbackLesson } = require('../lessons/lesson-planner');
const { buildFocus } = require('../lessons/practice-cards');

const ALL_RULES = [...CUE_VOCABULARY_RULES, ...CONTRAINDICATED_RULES];

/** The first law a string breaks, or null. */
function firstViolation(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  const rule = ALL_RULES.find((r) => r.pattern.test(s));
  return rule ? rule.code : null;
}

function assertLawful(text, where) {
  const code = firstViolation(text);
  assert.equal(code, null, `cue-vocabulary violation [${code}] in ${where}: ${String(text).slice(0, 160)}`);
}

// IDENTIFIER fields, not copy — the standing ruling from content-product-laws
// and from cue-vocabulary-spec §6: "internal metric/axis identifiers are
// exempt; the words must not reach the learner". A DENY-list, not an
// allow-list, so a NEW copy field is scanned by default.
//
// `teachingFocus` and `tags` carry `bright-vowels` / `forward-placement`; those
// are lookup keys consumed by cue-sheet and cockpit code and are never rendered.
// `emphasis` carries `keep-bright`, which crosses to the frontend as a CSS class
// name (frontend/src/voice/render/focus-line.ts maps it to `voice-fl-bright`),
// so renaming it would break a surface this audit does not own.
const IDENTIFIER_KEYS = new Set([
  'id', 'ids', 'kind', 'kinds', 'tier', 'tags', 'difficulty', 'targetConcepts',
  'contraindications', 'axis', 'nextAction', 'source', 'status', 'preset',
  'targetPreset', 'direction', 'lane', 'key', 'type', 'code', 'teachingFocus',
  'concepts', 'focusAxis', 'emphasis', 'conceptTags', 'sessionFocus',
]);

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === 'object') {
    for (const [key, v] of Object.entries(value)) {
      if (IDENTIFIER_KEYS.has(key)) continue;
      collectStrings(v, out);
    }
  }
  return out;
}

const DRILL_PRESETS = [
  'cute-feminine', 'everyday-feminine', 'bright-playful', 'australian-bright-feminine',
  'androgynous', 'gender-neutral', 'soft-feminine', 'an-unknown-preset',
];

// ---------------------------------------------------------------------------
// BEHAVIOURAL SURFACE
// ---------------------------------------------------------------------------

test('cue-vocabulary: every drill in every pack speaks in the body register', () => {
  let scanned = 0;
  for (const preset of DRILL_PRESETS) {
    const pack = getVoiceDrillPack(preset);
    assert.ok(pack.length > 0, `${preset} resolves to a pack`);
    for (const drill of pack) {
      for (const s of collectStrings(drill)) {
        scanned += 1;
        assertLawful(s, `drill ${preset}/${drill.id}`);
      }
    }
  }
  assert.ok(scanned >= 200, `expected a real inventory, scanned ${scanned} drill strings`);
});

test('cue-vocabulary: every rendered cue-sheet token speaks in the body register', () => {
  const PHRASES = [
    'Could you say that again?',
    'hey, i am really happy you are here',
    'that is actually so cute',
    'i reckon that sounds pretty good',
    'let me know what you think',
    'thanks, i appreciate it',
    'how was your day',
  ];
  let scanned = 0;
  for (const preset of DRILL_PRESETS) {
    for (const phrase of PHRASES) {
      const sheet = buildVoiceCueSheet({ phrase, targetPreset: preset, focus: 'Playful intonation' });
      if (!sheet) continue;
      for (const s of collectStrings(sheet)) {
        scanned += 1;
        assertLawful(s, `cue sheet ${preset} / "${phrase}"`);
      }
    }
  }
  assert.ok(scanned >= 300, `expected a real inventory, scanned ${scanned} cue-sheet strings`);
});

test('cue-vocabulary: every deterministic lesson plan speaks in the body register', () => {
  const voiceState = { lastSummary: { metrics: { advanced: {} } }, targetVoiceProfile: {} };
  for (const [tier, scope] of [['full', null], ['quiet', { tier: 'quiet' }], ['silent', { tier: 'silent' }]]) {
    const plan = buildFallbackLesson(voiceState, {}, scope);
    assert.ok(plan.knowledgePoints.length > 0, `${tier} plan has points`);
    for (const s of collectStrings(plan)) assertLawful(s, `lesson plan (${tier})`);
  }
});

test('cue-vocabulary: every practice-card focus statement speaks in the body register', () => {
  for (const targetPreset of DRILL_PRESETS) {
    for (const axis of ['pitch', 'resonance', 'weight', 'prosody']) {
      const focus = buildFocus({ axis, targetPreset });
      assertLawful(focus.statement, `card focus ${targetPreset}/${axis}`);
    }
  }
});

// ---------------------------------------------------------------------------
// SOURCE SURFACE
// ---------------------------------------------------------------------------

const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;

// coaching/renderer-client.js is held out for the SAME documented reason
// content-product-laws.test.js holds it out: its job is to STATE the laws to
// the model, so its prose necessarily NAMES the banned terms in order to
// forbid them ("FORBIDDEN cues = ... darker vowels", 'Bad: ... "think bright"',
// "A felt buzz reports vocal WEIGHT, never resonance"). That is the same ruling
// that keeps the gendered nouns inside GENDER_LABEL_PATTERNS: a blocklist must
// contain the words it blocks. Its rendered prompt has its own tests
// (voice-coach-product-law-prompt.test.js, renderer-client.scope.test.js), and
// nothing it emits reaches the learner — the model's reply does, and that reply
// crosses all three laws in sanitizeCoachReply.
const SCANNED_MODULES = [
  'voice-drills.js',
  'voice-cue-sheet.js',
  'voice-cockpit-lines.js',
  'lessons/lesson-planner.js',
  'lessons/practice-cards.js',
  'coaching/sanitizer.js',
];

// Identifier literals: preset keys, drill ids, focus tags and emphasis labels.
// These are the `bright-playful` / `bright-vowels` / `aus-bright-*` family —
// machine keys shared with the DSP target profiles, the rotation store and the
// frontend CSS map. Renaming any of them is a cross-service migration, not a
// copy fix, and spec §6 exempts identifiers explicitly.
const IDENTIFIER_LITERAL = /^[a-z0-9]+(?:[-_][a-z0-9]+)+$/;

test('cue-vocabulary: no prose string literal in the content modules breaks a law', () => {
  const backendRoot = path.resolve(__dirname, '..');
  let scannedFiles = 0;
  let scannedStrings = 0;
  const violations = [];

  for (const rel of SCANNED_MODULES) {
    const file = path.join(backendRoot, rel);
    assert.ok(fs.existsSync(file), `${rel} exists`);
    scannedFiles += 1;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return; // comment line
      STRING_LITERAL.lastIndex = 0;
      let match;
      while ((match = STRING_LITERAL.exec(line)) !== null) {
        const literal = match[1] ?? match[2] ?? match[3] ?? '';
        if (!literal.trim()) continue;
        if (IDENTIFIER_LITERAL.test(literal)) continue;
        scannedStrings += 1;
        const code = firstViolation(literal);
        if (code) violations.push(`${rel}:${index + 1} [${code}] ${literal.slice(0, 140)}`);
      }
    });
  }

  assert.equal(scannedFiles, SCANNED_MODULES.length);
  assert.ok(scannedStrings >= 300, `scanned ${scannedStrings} literals`);
  assert.deepEqual(violations, [], `cue-vocabulary violations in content source:\n${violations.join('\n')}`);
});

// ---------------------------------------------------------------------------
// TEETH — the scan must catch the strings this audit actually rewrote
// ---------------------------------------------------------------------------

test('the scan has teeth: every string this audit rewrote is detected', () => {
  // VERBATIM pre-fix content. If any of these is ever committed back into a
  // content module, the source scan above must fail.
  const rewritten = [
    ['Bright reset', 'quality_bright'],
    ['Reset into a cute, forward placement before longer phrases.', 'placement_fiction'],
    ['Balanced feminine brightness', 'quality_noun'],
    ['Keep one feature stable: smaller brighter vowels.', 'quality_bright'],
    ['Stop if brightness turns into squeeze.', 'quality_noun'],
    ['Lift into a higher, lighter feminine voice without forcing brightness.', 'quality_noun'],
    ['Reduce chest pressure so the voice lands lighter at the start of speech.', 'quality_after_sound'],
    ['Voice stays light and in-band without strain or sharpness.', 'quality_after_sound'],
    ['Find a balanced tone that is neither bright-and-light nor dark-and-heavy.', 'quality_bright'],
    ['Today: keep the brightness forward', 'quality_noun'],
    ['Today: keep the voice light and easy', 'quality_after_sound'],
    ['keep the buzz forward in the face', 'invalid_resonance_buzz'],
    ['do not push it bright', 'quality_bright'],
    ['keep it gentle, lightness over brightness', 'quality_noun'],
    ['keep it centered, neither bright nor dark', 'quality_bright'],
    ['light, bright, hopeful', 'quality_bright'],
    ['Brightness, lightness, and where the ending lands.', 'quality_noun'],
    ['A brighter voice lives forward — behind the nose and teeth — while a darker one sits back in the throat.', 'quality_bright'],
    ['A settled, supported sound without pressing.', 'undefined_support'],
    ['More forward placement without strain.', 'placement_fiction'],
    ['Darker, Grounded Resonance', 'quality_dark'],
    ['feel the sound move forward', 'sound_travels'],
  ];
  for (const [text, expected] of rewritten) {
    assert.equal(firstViolation(text), expected, `scan verdict for: ${text}`);
  }
});

// HONEST SEPARATION. These three cue-sheet / lesson-planner strings were also
// rewritten by this audit, on JUDGEMENT rather than by rule: each used a felt
// buzz at the teeth or the nose as a resonance signal, which spec §2 forbids
// ("judge resonance by felt vibration anywhere"). The deterministic rule does
// NOT catch them, and that is deliberate — the atlas's measured finding is
// about BONE-CONDUCTED facial/sinus/chest vibration, and it explicitly blesses
// a felt buzz at the nose for NASALITY (signal 6), at the palm and during /m/
// for WEIGHT (signals 3 and 7). A rule broad enough to catch these also
// destroys those, which was measured on the live drill cue table.
//
// So this is asserted as a KNOWN LIMIT, not hidden: the copy is fixed, the rule
// deliberately stops short of it, and if the rule is ever widened to cover them
// this test fails and forces the trade-off to be re-argued.
test('known limit: felt-buzz-at-the-teeth copy was fixed by judgement, not by rule', () => {
  for (const text of [
    'buzz behind upper teeth',
    'keep it smiling and buzzing near the teeth',
    'A buzzing feeling just behind the upper teeth or nose.',
  ]) {
    assert.equal(
      firstViolation(text),
      null,
      `if this now fires, re-check that the atlas's VALID nose/palm/lip buzz checks still pass: ${text}`,
    );
  }
  // ...and the valid checks the narrower rule exists to protect.
  for (const text of [
    'Fingertip on the side of your nose — you should not feel a buzz on this vowel.',
    'Cup your palm over your open mouth and speak. Strong buzz in the palm means air going out the mouth.',
    'Palm flat on the breastbone. Make the buzz weaker without getting quieter.',
  ]) {
    assert.equal(firstViolation(text), null, `valid felt-buzz check wrongly caught: ${text}`);
  }
  // The bone-conduction core still has teeth, in both word orders.
  assert.equal(firstViolation('Feel the buzz in your cheekbones as the resonance improves.'), 'invalid_resonance_buzz');
  assert.equal(firstViolation('Your cheeks should be buzzing on that vowel.'), 'invalid_resonance_buzz');
  assert.equal(firstViolation('Palm on your breastbone: that buzz tells you where your resonance is.'), 'invalid_resonance_buzz');
});

test('the scan does not false-fire on the copy that replaced it', () => {
  // The replacements, verbatim. A content law that rejects its own remedy is
  // not a law, it is a loop.
  for (const text of [
    'Tongue brace reset',
    'Set the tongue body high and the lip corners back before longer phrases.',
    'Everyday tongue-side resonance',
    'Keep one thing stable: the sides of your tongue on your upper back teeth.',
    'Stop if your throat starts to squeeze or ache.',
    'Slide the tone up in one unbroken line without letting it get louder.',
    'Palm flat on your breastbone: make the buzz weaker without getting quieter.',
    'Today: tongue sides on the upper back teeth',
    'Today: make the buzz under your palm weaker, not quieter',
    'tongue sides on the upper molars',
    'coolest air on the ridge behind the top teeth',
    'lip corners back, tongue sides on the upper molars',
    'Find a middle setting: tongue mid, lips unspread, jaw even.',
    'Pitch sits in the target band and the buzz under your palm stays weak; no strain.',
  ]) {
    assertLawful(text, 'replacement copy');
  }
});
