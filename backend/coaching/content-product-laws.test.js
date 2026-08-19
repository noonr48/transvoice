'use strict';

// 2026-07-26 — CONTENT-AUDIT REGRESSION SCAN for the two owner product laws.
//
// The sanitizer guards what the MODEL says. This guards what the CODE says: the
// deterministic coach-facing content inventory — drill packs, drill cues, lesson
// knowledge points, safety templates, due-review cues, coach-move cues, and every
// canned fallback. Those strings never pass through sanitizeCoachReply (the code
// owns them, so nothing sanitizes them), which means a law-violating string
// committed here would reach the learner unfiltered. This test is the only thing
// standing between that and production.
//
// The scan deliberately reuses the sanitizer's OWN exported HOMEWORK_RULES and
// EQUIPMENT_RULES rather than a second copy of the patterns. Two consequences,
// both wanted: the content contract can never drift from the runtime contract,
// and widening a law automatically re-audits all existing content.
//
// Two surfaces, because either alone has a hole:
//   BEHAVIOURAL — call the real builders across every preset/tier/intent, so
//                 content that is assembled at runtime is covered.
//   SOURCE      — scan prose string literals in the content modules, so a
//                 violating string in a branch no test happens to exercise is
//                 still caught the moment it is committed.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
  HOMEWORK_RULES,
  EQUIPMENT_RULES,
  SAFE_FALLBACK,
  LOW_EFFORT_CUE,
  GENERIC_ACTIONABLE_CUE,
} = require('./sanitizer');
const {
  QUIET_SCOPE_FALLBACK,
  SILENT_SCOPE_FALLBACK,
  buildPerTakeFallback,
  buildFallbackReply,
  buildCoachingSignal,
} = require('./index');
const { buildCoachMove } = require('./signal-builder');
const { getVoiceDrillPack } = require('../voice-drills');
const { buildVoiceCueSheet } = require('../voice-cue-sheet');
const { buildFallbackLesson } = require('../lessons/lesson-planner');
const { GUARDIAN_TEMPLATES } = require('../lessons/guardian');

// The runtime rules are deliberately tuned for a LIVE MODEL REPLY, where a word
// can be innocent in conversational context: "a little later in the line" is
// placement, "next time through" is the next rep, "on your own" can be
// in-session self-discovery. Authored CONTENT has no such context to protect —
// a code-owned string saying "tomorrow" is always a scheduled-for-later string,
// because there is no surrounding conversation to make it mean anything else.
//
// So the content bar is strictly higher than the runtime bar. MEASURED: with the
// runtime rules alone this scan caught NONE of the seven strings the 2026-07-26
// audit rewrote ("Pick Tomorrow's Sentence", "find the middle on your own",
// "pick one focus for next time", "mirror the target voice", "Play two of your
// recent takes", ...) — a regression test that cannot catch the regressions it
// was written for is decoration. These extra rules are what give it teeth.
const CONTENT_ONLY_RULES = [
  { code: 'content_away_place', pattern: /\b(?:on your own|by yourself|at home|in your own time)\b/i },
  { code: 'content_future_day', pattern: /\b(?:tomorrow|yesterday|next time|next session|next week|this week|later today|later tonight)\b/i },
  { code: 'content_cadence', pattern: /\b(?:each day|every day|daily|nightly|weekly)\b/i },
  // The VERB "to mirror" is legitimate English, but in authored copy "echo" and
  // "match" say the same thing with no object-shaped word for a learner to
  // misread as an instruction to go find a mirror.
  { code: 'content_mirror_word', pattern: /\bmirrors?\b/i },
  // The Coach surface has exactly two controls (preset selector, Start/End), so
  // copy must never ask the learner to operate playback.
  { code: 'content_playback', pattern: /\bplay\s+(?:two|both|back|your|the|a)\b[^'"`]{0,28}\btakes?\b|\btakes?\s+back to back\b/i },
  // Life-transfer framing ("carry this into the world") is practice that happens
  // somewhere else, later. See the SCANNED_MODULES note for why lessons/
  // real-sentence.js — the owner-designed modality this phrasing belongs to — is
  // held out of this scan rather than being caught by this rule.
  { code: 'content_life_transfer', pattern: /\b(?:out )?into the world\b|\bcarry (?:it|this|that|one|the sentence)\b[^'"`]{0,24}\bwith you\b/i },
];

const ALL_RULES = [...HOMEWORK_RULES, ...EQUIPMENT_RULES, ...CONTENT_ONLY_RULES];

/** The first law a string breaks, or null. */
function firstViolation(text) {
  const s = String(text || '');
  if (!s.trim()) return null;
  const rule = ALL_RULES.find((r) => r.pattern.test(s));
  return rule ? rule.code : null;
}

function assertLawful(text, where) {
  const code = firstViolation(text);
  assert.equal(code, null, `product-law violation [${code}] in ${where}: ${String(text).slice(0, 160)}`);
}

// IDENTIFIER fields, not copy. The law applies to what the learner can HEAR or
// READ; a slug is neither. This is the standing ruling for the drill ids
// (`playful-mirror-burst`, `straw_free_sovt`-style kind ids): an id may keep a
// word the copy may not, provided no user-visible text renders it. Kept as a
// DENY-list rather than an allow-list so a NEW copy field is scanned by default
// — the failure mode to avoid is a violating string hiding in a field this test
// never heard of.
const IDENTIFIER_KEYS = new Set([
  'id', 'ids', 'kind', 'kinds', 'tier', 'tags', 'difficulty', 'targetConcepts',
  'contraindications', 'axis', 'nextAction', 'intent', 'source', 'status',
  'preset', 'targetPreset', 'direction', 'lane', 'key', 'type', 'code',
  'teachingFocus', 'concepts', 'focusAxis',
]);

/** Every learner-facing string reachable in a nested content object. */
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

// ---------------------------------------------------------------------------
// BEHAVIOURAL SURFACE
// ---------------------------------------------------------------------------

const DRILL_PRESETS = [
  'cute-feminine', 'everyday-feminine', 'bright-playful', 'australian-bright-feminine',
  'masculine', 'androgynous', 'gender-neutral', 'soft-feminine', 'an-unknown-preset',
];

test('content law: every drill in every pack is homework-free and object-free', () => {
  for (const preset of DRILL_PRESETS) {
    const pack = getVoiceDrillPack(preset);
    assert.ok(pack.length > 0, `${preset} resolves to a pack`);
    for (const drill of pack) {
      for (const s of collectStrings(drill)) {
        assertLawful(s, `drill ${preset}/${drill.id}`);
      }
    }
  }
});

test('content law: every cue sheet is homework-free and object-free', () => {
  for (const preset of DRILL_PRESETS) {
    const sheet = buildVoiceCueSheet({ targetPreset: preset });
    for (const s of collectStrings(sheet)) {
      assertLawful(s, `cue sheet ${preset}`);
    }
  }
});

test('content law: every deterministic lesson plan is homework-free and object-free', () => {
  const voiceState = {
    lastSummary: { metrics: { advanced: {} } },
    targetVoiceProfile: {},
  };
  const plans = [
    ['full', buildFallbackLesson(voiceState, {}, null)],
    ['quiet', buildFallbackLesson(voiceState, {}, { tier: 'quiet' })],
    ['silent', buildFallbackLesson(voiceState, {}, { tier: 'silent' })],
  ];
  for (const [tier, plan] of plans) {
    assert.ok(plan.knowledgePoints.length > 0, `${tier} plan has points`);
    for (const s of collectStrings(plan)) {
      assertLawful(s, `lesson plan (${tier})`);
    }
  }
});

test('content law: every coach-move cue is homework-free and object-free', () => {
  const INTENTS = [
    'single_actionable_cue', 'acknowledge_win', 'reflection_summary', 'lesson_transition',
    'stop_and_reset', 'repair_capture', 'continue_conversation',
  ];
  const ISSUES = [
    null, 'voice_weight_heavy', 'voice_weight_light', 'resonance_slightly_back',
    'resonance_too_forward', 'phrase_ending_instability', 'pitch_falling_at_end',
    'breathy_quality', 'strain_risk', 'spectral_tilt_dark', 'pitch_floor_under_target',
    'pitch_above_target', 'pitch_unstable',
  ];
  for (const intent of INTENTS) {
    for (const primaryIssue of ISSUES) {
      const move = buildCoachMove({
        intent,
        issues: { primaryIssue },
        safety: {},
        mode: 'active_drill',
        voiceState: {},
      });
      for (const s of collectStrings(move)) {
        assertLawful(s, `coachMove ${intent}/${primaryIssue || 'none'}`);
      }
    }
  }
});

test('content law: every canned fallback and safety template is lawful', () => {
  const templates = {
    SAFE_FALLBACK,
    LOW_EFFORT_CUE,
    GENERIC_ACTIONABLE_CUE,
    QUIET_SCOPE_FALLBACK,
    SILENT_SCOPE_FALLBACK,
    guardianEase: GUARDIAN_TEMPLATES.ease,
    guardianClose: GUARDIAN_TEMPLATES.close,
    perTake: buildPerTakeFallback(buildCoachingSignal({})),
    fallbackReply: buildFallbackReply(buildCoachingSignal({})),
    fallbackSilent: buildFallbackReply(buildCoachingSignal({ sessionScope: { tier: 'silent' } })),
    fallbackStop: buildFallbackReply(buildCoachingSignal({ policy: { safetyState: 'stop' } })),
  };
  for (const [name, text] of Object.entries(templates)) {
    assertLawful(text, `template ${name}`);
  }
});

// 2026-07-26 phase C: the sentence-teardown isolation loop speaks its own retry
// cues and its own warm exit, with no model in the path. Scanned BEHAVIOURALLY as
// well as by source, so a cue added through the table (rather than as a literal the
// source scan happens to reach) is audited too.
test('content law: every sentence-teardown cue and the warm exit are lawful', () => {
  const { SECTION_CUES, SECTION_LOOP_CAP_EXIT, SECTION_LOOP_AXES } = require('./section-loop');
  let scanned = 0;
  for (const axis of SECTION_LOOP_AXES) {
    for (const cue of SECTION_CUES[axis]) {
      scanned += 1;
      assertLawful(cue.text, `section-loop cue ${axis}/${cue.id}`);
    }
  }
  assertLawful(SECTION_LOOP_CAP_EXIT, 'section-loop cap exit');
  assert.ok(scanned >= 9, `expected >= 3 cues on each of 3 axes, scanned ${scanned}`);
});

// ---------------------------------------------------------------------------
// SOURCE SURFACE
// ---------------------------------------------------------------------------

// Prose string literals only: comments are not literals (so the law-explaining
// comments in these files are correctly ignored), regex bodies are not literals,
// and anything under three words is an identifier/format fragment, not copy.
const STRING_LITERAL = /'((?:[^'\\\n]|\\.)*)'|"((?:[^"\\\n]|\\.)*)"|`((?:[^`\\$]|\\.)*)`/g;

// Two deliberate exclusions, both with a reason:
//
//   renderer-client.js — its job is to STATE the two laws to the model, so its
//     prose necessarily talks about practising at home and about objects. It has
//     its own law tests (voice-coach-product-law-prompt.test.js, and
//     renderer-client.scope.test.js which asserts the rendered prompt names no
//     prop at all).
//
//   lessons/real-sentence.js — the owner-designed "one real sentence a day"
//     modality (PRACTICE-PHILOSOPHY modality 2): the learner rehearses a sentence
//     WITH the tutor and later reports back on how saying it went. Its learner
//     lines ("You carried it out into the world", "Rough reps in the world still
//     count") DEBRIEF an event that already happened; they do not assign practice.
//     Whether that whole modality survives the homework law is a PRODUCT call for
//     the owner, not something a content scan should decide unilaterally — so it
//     is held out here explicitly rather than silently passing.
const SCANNED_MODULES = [
  'voice-drills.js',
  'voice-cue-sheet.js',
  'voice-phrase-context.js',
  'voice-cockpit-lines.js',
  'lessons/lesson-planner.js',
  'lessons/guardian.js',
  'lessons/practice-cards.js',
  'coaching/index.js',
  'coaching/signal-builder.js',
  // 2026-07-26 phase C: the sentence-teardown cue table + warm exit. Every string
  // in it is SPOKEN and code-owned, so it needs the content tier for exactly the
  // reason the drill packs do — nothing sanitizes what the code itself authors.
  'coaching/section-loop.js',
  'coaching/sanitizer.js',
  'coaching/policy-gates.js',
  'coaching/safety-gates.js',
];

test('content law: no prose string literal in the content modules breaks either law', () => {
  const backendRoot = path.resolve(__dirname, '..');
  let scannedFiles = 0;
  let scannedStrings = 0;
  const violations = [];

  for (const rel of SCANNED_MODULES) {
    const file = path.join(backendRoot, rel);
    if (!fs.existsSync(file)) continue;
    scannedFiles += 1;
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return; // comment line
      STRING_LITERAL.lastIndex = 0;
      let match;
      while ((match = STRING_LITERAL.exec(line)) !== null) {
        const literal = match[1] ?? match[2] ?? match[3] ?? '';
        if ((literal.match(/\S+/g) || []).length < 3) continue; // not prose
        scannedStrings += 1;
        const code = firstViolation(literal);
        if (code) violations.push(`${rel}:${index + 1} [${code}] ${literal.slice(0, 140)}`);
      }
    });
  }

  assert.ok(scannedFiles >= 10, `scanned ${scannedFiles} content modules`);
  assert.ok(scannedStrings >= 200, `scanned ${scannedStrings} prose literals`);
  assert.deepEqual(violations, [], `product-law violations in content source:\n${violations.join('\n')}`);
});

test('the scan itself has teeth: every string this audit rewrote is now detected', () => {
  // Guards against the scan silently passing because the rules stopped matching
  // or the literal extractor stopped finding anything. Each string below is the
  // VERBATIM pre-fix content the 2026-07-26 audit replaced; if any of them is
  // ever committed back into the content modules, this scan must fail.
  const rewrittenByThisAudit = [
    ['Feel both ends, then find the middle on your own — that middle is your lane.', 'content_away_place'],
    ['Summarize what changed and pick one focus for next time.', 'content_future_day'],
    ['Pick Tomorrow’s Sentence', 'content_future_day'],
    ['Choose one real sentence you would like to carry into the world next — somewhere it would feel natural to say it.', 'content_life_transfer'],
    ['Use a short expressive line to mirror the target voice quickly.', 'content_mirror_word'],
    ['Play two takes back to back and choose the one that feels closer.', 'content_playback'],
    ['warm mirror line', 'content_mirror_word'],
  ];
  for (const [text, expected] of rewrittenByThisAudit) {
    assert.equal(firstViolation(text), expected, `scan verdict for: ${text}`);
  }

  // Runtime-rule teeth.
  assert.equal(firstViolation('Practise this at home every day.'), 'practice_away');
  assert.equal(firstViolation('Grab a straw for this one.'), 'object_straw');

  // ...and the innocent forms neither bar may touch. These are the exact false
  // positives the law brief names, plus the "everyday speech" adjective that
  // three live drills use.
  assert.equal(firstViolation('Bring everyday speech forward.'), null);
  assert.equal(firstViolation('Lift the tongue a little later in the line.'), null);
  assert.equal(firstViolation('Keep the tone from watering down at the end.'), null);
  assert.equal(firstViolation('Cup your hand behind your ear and say the line again.'), null);

  // METAPHOR: the two bars deliberately DIVERGE here, and that is the ruling.
  // At runtime a simile with no acquisition verb is exempt, because "like a
  // glass bell" asks a speaking learner to fetch nothing. In authored CONTENT
  // the same phrase is still rejected, because the house register is
  // articulatory (tongue/lips/jaw) and an author always has a better option —
  // which is also what the existing prop-word template law already enforces.
  const { sanitizeEquipment, GENERIC_ACTIONABLE_CUE: cue } = require('./sanitizer');
  assert.deepEqual(sanitizeEquipment('Let the ending ring like a glass bell.', { replacement: cue }).hits, []);
  assert.equal(firstViolation('Let the ending ring like a glass bell.'), 'object_glass');
});

// The runtime's own code-owned spoken lines bypass sanitizeCoachReply (they are
// returned directly on wordless turns), so the content scan must cover them
// explicitly — reviewer-identified coverage gap, 2026-07-26.
test('runtime wordless spoken lines are lawful under the content tier', () => {
  const {
    WORDLESS_PRACTICE_LINES,
    WORDLESS_ANALYZED_LINES,
    VOICED_PRACTICE_LINES,
  } = require('../voice-standalone-runtime');
  const lines = [
    ...Object.values(WORDLESS_PRACTICE_LINES),
    ...WORDLESS_ANALYZED_LINES,
    // 2026-07-26 field repair: the kind-neutral lines reached when the analyzer
    // — not the drill state — is what proves the learner voiced something.
    ...VOICED_PRACTICE_LINES,
  ];
  assert.ok(lines.length >= 8, 'expected the wordless line inventory to load');
  for (const line of lines) {
    assert.equal(firstViolation(line), null, `unlawful wordless line: ${line}`);
  }
});
