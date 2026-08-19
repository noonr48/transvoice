'use strict';

// 2026-07-26 — the two owner-directed product laws, enforced deterministically.
//
//   LAW 1 (HOMEWORK)  "the tutor never tells the user to go away to practice".
//                     All practice happens RIGHT NOW, in this session, step by
//                     step with the tutor.
//   LAW 2 (EQUIPMENT) the tutor "never tells the user to use a tool / requires
//                     an equipment". Every instruction must be performable this
//                     second with only the learner's voice and body.
//
// Both restate the 2026-07-19 zero-friction ruling as a runtime contract: the
// system prompt is best-effort, the sanitizer is the law. These are kill-tests —
// each violating phrasing must come out rewritten AND leave a witness, and each
// innocent phrasing must pass through byte-identical.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeHomework,
  sanitizeEquipment,
  sanitizeCoachReply,
  HOMEWORK_RULES,
  EQUIPMENT_RULES,
  GENERIC_ACTIONABLE_CUE,
} = require('./sanitizer');

const coachSignal = (overrides = {}) => ({
  mode: 'active_drill',
  policy: { coachingAction: 'coach', shouldCorrect: true, safetyState: 'ok' },
  capture: { reliability: 'good' },
  ...overrides,
});

// ---------------------------------------------------------------------------
// LAW 1 — HOMEWORK
// ---------------------------------------------------------------------------

test('LAW 1: away-from-session practice is rewritten out and witnessed', () => {
  const cases = [
    ['Nice work. Practise this at home for ten minutes.', 'practice_away'],
    ['Good. Work on it on your own before we meet again.', 'practice_away'],
    ['Try that one by yourself when you have a moment.', 'practice_away'],
    // Rules are matched in declaration order, so a phrase carrying BOTH a
    // practice verb and an away-window ("run through it between sessions")
    // witnesses as `practice_away`. This case has no practice verb, so it
    // exercises the away-window rule on its own.
    ['Between sessions, let the voice settle on its own.', 'away_from_session'],
    ['Run through it between sessions.', 'practice_away'],
    ['Do a few of these every day.', 'daily_routine'],
    ['Add this to your morning routine.', 'daily_routine'],
    ['Keep practising this daily.', 'daily_routine'],
    ['Keep practising this week.', 'keep_practicing_future'],
    ['We will pick this up next time.', 'defer_to_future'],
    ['Save that one for tomorrow.', 'defer_to_future'],
    ['Come back tomorrow and we will go again.', 'future_session'],
    ['Your homework is the forward hum.', 'homework_noun'],
  ];
  for (const [reply, expectedCode] of cases) {
    const result = sanitizeHomework(reply, { replacement: GENERIC_ACTIONABLE_CUE });
    assert.deepEqual(result.hits, [expectedCode], `law 1 witness for: ${reply}`);
    assert.notEqual(result.text, reply, `law 1 must rewrite: ${reply}`);
    assert.doesNotMatch(
      result.text,
      /\bat home\b|\bon your own\b|\bby yourself\b|\bevery ?day\b|\bdaily\b|\btomorrow\b|\bnext time\b|\bthis week\b|\bhome ?work\b|\bbetween sessions?\b/i,
      `law 1 residue in: ${result.text}`,
    );
  }
});

test('LAW 1: the offending sentence is DROPPED when the reply still carries a cue', () => {
  const result = sanitizeHomework(
    'Let the jaw hang loose on the first word. Keep practising this daily.',
    { replacement: GENERIC_ACTIONABLE_CUE },
  );
  assert.equal(result.text, 'Let the jaw hang loose on the first word.');
  assert.deepEqual(result.hits, ['daily_routine']);
});

test('LAW 1: the sentence is REWRITTEN to a now-action when nothing actionable survives', () => {
  const result = sanitizeHomework(
    'Nice work. Practise this at home for ten minutes.',
    { replacement: GENERIC_ACTIONABLE_CUE },
  );
  assert.equal(result.text, `Nice work. ${GENERIC_ACTIONABLE_CUE}`);
  assert.deepEqual(result.hits, ['practice_away']);
});

test('LAW 1: innocent in-session phrasing passes through byte-identical', () => {
  // Each of these reads as homework to a naive keyword filter and is NOT:
  //   "later in the line"  -> placement inside the phrase, not a future day.
  //   "next time through"  -> the next REP, in this session.
  //   "on your own" + no practice verb -> in-session self-discovery, which is
  //     the exact wording of the "Small voice, big voice" drill cue.
  const innocent = [
    'Lift the tongue a little later in the line.',
    'Let the jaw open a bit more later on in that phrase.',
    'Next time through, keep the lips spread the whole way.',
    'Feel both ends, then find the middle on your own — that middle is your lane.',
    'Say the line again now, with the tongue high and forward.',
    'That one landed. Keep exactly that mouth shape on the next line.',
  ];
  for (const reply of innocent) {
    const result = sanitizeHomework(reply, { replacement: GENERIC_ACTIONABLE_CUE });
    assert.equal(result.text, reply, `law 1 false positive: ${reply}`);
    assert.deepEqual(result.hits, [], `law 1 spurious witness: ${reply}`);
  }
});

// ---------------------------------------------------------------------------
// LAW 2 — EQUIPMENT
// ---------------------------------------------------------------------------

test('LAW 2: an instruction requiring an object is rewritten out and witnessed', () => {
  const cases = [
    ['Grab a straw and phonate through it.', 'object_straw'],
    ['Hold a spoon under your tongue for this one.', 'object_spoon'],
    ['Put a pencil between your teeth.', 'object_pen'],
    ['Take a sip from a cup of tea first.', 'object_cup'],
    ['Pour a glass of water and drink some.', 'object_glass'],
    ['Have some water before the next line.', 'object_water'],
    ['Set a metronome to sixty.', 'object_metronome'],
    ['Use a tuner to check that note.', 'object_tuner'],
    ['Play the note on a piano first.', 'object_instrument'],
    ['Watch your jaw in the mirror.', 'object_mirror'],
    ['Record yourself and listen back.', 'external_recorder'],
    ['Use a recording app for this one.', 'external_recorder'],
    ['Download an app that shows your pitch.', 'external_tool'],
    ['You will need a separate device for this.', 'external_tool'],
  ];
  for (const [reply, expectedCode] of cases) {
    const result = sanitizeEquipment(reply, { replacement: GENERIC_ACTIONABLE_CUE });
    assert.deepEqual(result.hits, [expectedCode], `law 2 witness for: ${reply}`);
    assert.notEqual(result.text, reply, `law 2 must rewrite: ${reply}`);
    assert.doesNotMatch(
      result.text,
      /\bstraws?\b|\bspoons?\b|\bpencils?\b|\bcups?\b|\bglass\b|\bwater\b|\bmetronomes?\b|\btuners?\b|\bpianos?\b|\bmirror\b|\brecording app\b/i,
      `law 2 residue in: ${result.text}`,
    );
  }
});

test('LAW 2: the offending sentence is DROPPED when the reply still carries a cue', () => {
  const result = sanitizeEquipment(
    'Take a sip of water first. Then say the line with a loose jaw.',
    { replacement: GENERIC_ACTIONABLE_CUE },
  );
  assert.equal(result.text, 'Then say the line with a loose jaw.');
  assert.deepEqual(result.hits, ['object_water']);
});

test('LAW 2: METAPHOR RULING — a simile with no acquisition verb is exempt', () => {
  // PINNED BEHAVIOUR. The equipment law exists to stop the learner being sent
  // to FETCH something; "like a glass bell" asks them to obtain nothing, so it
  // is not an equipment violation. Whether imagery is desirable at all is a
  // SEPARATE law with a separate owner: the `concrete-over-imagery` preference
  // in applyPreferenceContract strips it when the learner asked for that. Two
  // laws, one owner each — this rule must not quietly become an imagery filter.
  const exempt = [
    'Let the ending ring like a glass bell.',
    'Keep the tone clear, as if it were made of glass.',
    'Picture the sound sitting forward like a small bright cup of light.',
  ];
  for (const reply of exempt) {
    const result = sanitizeEquipment(reply, { replacement: GENERIC_ACTIONABLE_CUE });
    assert.equal(result.text, reply, `metaphor wrongly stripped: ${reply}`);
    assert.deepEqual(result.hits, [], `metaphor spurious witness: ${reply}`);
  }

  // ...but the exemption is narrow: an acquisition verb anywhere in the
  // sentence cancels it, so a real requirement cannot hide inside a simile.
  const notExempt = sanitizeEquipment('Hold a straw like a pen.', {
    replacement: GENERIC_ACTIONABLE_CUE,
  });
  assert.deepEqual(notExempt.hits, ['object_straw']);
  assert.equal(notExempt.text, GENERIC_ACTIONABLE_CUE);
});

test('LAW 2: innocent phrasing passes through byte-identical', () => {
  const innocent = [
    // 'watering'/'watery'/'glassy'/'cupboard' must not trip the word-boundary rules.
    'Keep the tone from watering down at the end.',
    'That came out a little watery — firm the closure up.',
    'The vowel went glassy on the last word.',
    // `cup` as a body action needs no object.
    'Cup your hand behind your ear and say the line again.',
    // `mirror` as a VERB is the drill vocabulary, not an object.
    'Mirror the target voice on the next line.',
    'Echo the shape you just heard, straight back.',
    // The TransVoice app IS the recorder — its own capture language must live.
    'The recording came in a little quiet.',
    'Move slightly back from the mic and say it again.',
    'I could not get a clear enough capture to assess.',
    // 'pen' inside other words.
    'Let the jaw open on the first word and happen slowly.',
  ];
  for (const reply of innocent) {
    const result = sanitizeEquipment(reply, { replacement: GENERIC_ACTIONABLE_CUE });
    assert.equal(result.text, reply, `law 2 false positive: ${reply}`);
    assert.deepEqual(result.hits, [], `law 2 spurious witness: ${reply}`);
  }
});

// ---------------------------------------------------------------------------
// BODY-AS-TOOL — the 2026-07-26 owner refinement.
//
// "it's probably not mouth clues, either but think about body posture, or just
// physical way for us to get closer to our goal." The practical register is the
// WHOLE BODY, and the learner's own body is explicitly NOT equipment: a hand on
// the chest needs nothing fetched, nothing owned, and nothing bought, so it
// cannot cost the learner the friction the equipment law exists to prevent.
// ---------------------------------------------------------------------------

const BODY_REGISTER_CUES = [
  // Posture, verb-led.
  'Let your shoulders drop away from your ears, then start the line with a loose jaw.',
  'Release the neck and roll the shoulders back once before the line.',
  'Stand tall and easy, then let the first word start softly.',
  'Soften the jaw and let the neck stay long through the whole line.',
  // Posture, VERBLESS — attested 19x in the training corpus, so the model will
  // emit it and it must not be treated as a violation.
  'Shoulders soft and away from your ears, neck loose, chin level.',
  // Body-as-tool: the learner's own hands.
  'Rest a hand on your chest and feel the buzz while you say it.',
  'Place a palm flat on your chest and notice where the sound sits.',
  'Cup your hand behind your ear and say the line again.',
  'Bring your fingers lightly to your throat and feel the ease there.',
  'Feel the buzz in your chest as the line lands.',
];

test('BODY-AS-TOOL: posture and own-hand cues pass BOTH laws untouched', () => {
  for (const cue of BODY_REGISTER_CUES) {
    const homework = sanitizeHomework(cue, { replacement: GENERIC_ACTIONABLE_CUE });
    const equipment = sanitizeEquipment(cue, { replacement: GENERIC_ACTIONABLE_CUE });
    assert.equal(homework.text, cue, `homework law touched a body cue: ${cue}`);
    assert.deepEqual(homework.hits, [], `homework witness on a body cue: ${cue}`);
    assert.equal(equipment.text, cue, `equipment law touched a body cue: ${cue}`);
    assert.deepEqual(equipment.hits, [], `equipment witness on a body cue: ${cue}`);
  }
});

test('BODY-AS-TOOL: real equipment still fails even when phrased around the body', () => {
  // The boundary the law actually draws: your own hand is free, the thing you
  // would have to go and GET is not — even when a body part is in the sentence.
  const cases = [
    ['Hold a straw between your lips and hum through it.', 'object_straw'],
    ['Put a pencil between your teeth and say the line.', 'object_pen'],
    ['Watch your shoulders in the mirror while you say it.', 'object_mirror'],
    ['Rest a glass of water against your chest first.', 'object_glass'],
    ['Balance a spoon on your tongue for this one.', 'object_spoon'],
  ];
  for (const [reply, expectedCode] of cases) {
    const result = sanitizeEquipment(reply, { replacement: GENERIC_ACTIONABLE_CUE });
    assert.deepEqual(result.hits, [expectedCode], `equipment witness for: ${reply}`);
    assert.notEqual(result.text, reply, `equipment law must rewrite: ${reply}`);
  }
});

test('BODY-AS-TOOL: body cues survive the whole pipeline as real, usable cues', () => {
  // THE GATE. Widening the cue vocabulary without widening the sanitizer's
  // actionable-cue test destroys the new register at runtime — that is a
  // documented, previously-shipped failure. MEASURED before the fix: 3 of these
  // 10 were replaced by the generic fallback with cause `missing_actionable_cue`
  // ("Shoulders soft and away from your ears...", "Place a hand on your chest
  // and feel the buzz...", "Feel the buzz in your chest..."). If this test
  // fails, ACTIONABLE_CUE_PATTERN / ACTIONABLE_VOICE_PATTERN lost a body term.
  for (const cue of BODY_REGISTER_CUES) {
    const witness = {};
    const out = sanitizeCoachReply(cue, coachSignal(), { witness });
    assert.equal(out, cue, `body cue destroyed by the pipeline: ${cue} -> ${out}`);
    assert.equal(witness.coreLoopRepairCause, undefined, `body cue judged non-actionable: ${cue}`);
  }
});

test('BODY-AS-TOOL: widening the register did NOT make state-without-action actionable', () => {
  // The counterweight. Admitting postural language must not re-open the hole the
  // articulatory rubric closed: a cue that only names a desired state is still
  // not a cue, and postural ADJECTIVES alone are still not an action.
  const notCues = [
    'Keep it gentle and steady.',
    'That was easy and nice.',
    'Nice and loose.',
    'Great, that felt better.',
  ];
  for (const reply of notCues) {
    const witness = {};
    const out = sanitizeCoachReply(reply, coachSignal(), { witness });
    assert.notEqual(out, reply, `state-without-action wrongly survived: ${reply}`);
    assert.equal(witness.coreLoopRepairCause, 'missing_actionable_cue', `expected repair for: ${reply}`);
  }
});

// ---------------------------------------------------------------------------
// Pipeline wiring: the laws must fire through the real entry point, and the
// witness must reach the runtime the same way the other categorical laws do.
// ---------------------------------------------------------------------------

test('both laws fire through sanitizeCoachReply and record the standard witness', () => {
  const witness = {};
  const out = sanitizeCoachReply(
    'That was better. Grab a straw and practise this at home every day.',
    coachSignal(),
    { witness },
  );
  assert.doesNotMatch(out, /\bstraw\b/i, `equipment residue: ${out}`);
  assert.doesNotMatch(out, /\bat home\b|\bevery ?day\b/i, `homework residue: ${out}`);
  assert.ok(witness.homeworkHits.length > 0 || witness.equipmentHits.length > 0);
  assert.ok(Array.isArray(witness.homeworkHits), 'homeworkHits is the array witness shape');
  assert.ok(Array.isArray(witness.equipmentHits), 'equipmentHits is the array witness shape');
});

test('a BREATHER turn drops the violation without inventing a technique cue', () => {
  const witness = {};
  const out = sanitizeCoachReply(
    'No rush at all. Practise this at home tomorrow.',
    coachSignal({ policy: { coachingAction: 'breather', shouldCorrect: false, safetyState: 'ok' } }),
    { witness },
  );
  assert.doesNotMatch(out, /\bat home\b|\btomorrow\b/i, `homework residue: ${out}`);
  assert.doesNotMatch(out, /tongue|jaw|lips/i, `breather turn invented coaching: ${out}`);
  assert.deepEqual(witness.homeworkHits, ['practice_away']);
});

test('an already-lawful coaching reply is untouched end to end', () => {
  const lawful = 'That landed. Keep the tongue high and forward through the last two words.';
  const witness = {};
  const out = sanitizeCoachReply(lawful, coachSignal(), { witness });
  assert.equal(out, lawful);
  assert.deepEqual(witness.homeworkHits, []);
  assert.deepEqual(witness.equipmentHits, []);
});

test('an overlapping violation is still enforced, witnessed by whichever law reaches it first', () => {
  // ORDERING, pinned. sanitizeSessionControl runs BEFORE these two laws, and it
  // replaces the WHOLE sentence it matches. So a sentence carrying both a
  // session-control phrase and a homework phrase ("we will pick this up next
  // time — your homework is the forward hum") is consumed by session control,
  // and homeworkHits stays empty for it. That is enforcement, not a miss: the
  // offending text is gone and a witness DID fire — just a different one. A
  // future reader debugging "why no homeworkHits?" should find this test, not
  // conclude the law is broken.
  const witness = {};
  const out = sanitizeCoachReply(
    'Good. We will pick this up next time — your homework is the forward hum.',
    coachSignal(),
    { witness },
  );
  assert.doesNotMatch(out, /\bhome ?work\b|\bnext time\b|\bpick this up\b/i, `residue: ${out}`);
  assert.equal(witness.sessionControlHits.length, 1, 'session control witnessed it');
  assert.deepEqual(witness.homeworkHits, [], 'the sentence never reached the homework law');
});

test('every law rule is a non-global, case-insensitive, named pattern', () => {
  // Non-global matters: applySentenceLaw uses .test() inside a .find(), and a
  // /g regex would carry lastIndex between sentences and skip real violations.
  for (const rule of [...HOMEWORK_RULES, ...EQUIPMENT_RULES]) {
    assert.ok(rule.code && typeof rule.code === 'string', 'rule has a witness code');
    assert.ok(rule.pattern instanceof RegExp, `${rule.code} has a pattern`);
    assert.equal(rule.pattern.global, false, `${rule.code} must not be /g`);
    assert.equal(rule.pattern.ignoreCase, true, `${rule.code} must be case-insensitive`);
  }
  const codes = [...HOMEWORK_RULES, ...EQUIPMENT_RULES].map((r) => r.code);
  assert.equal(new Set(codes).size, codes.length, 'witness codes are unique');
});
