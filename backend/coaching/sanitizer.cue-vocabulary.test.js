'use strict';

// 2026-07-27 — the three CUE-VOCABULARY product laws, in the shape the shipped
// homework/equipment laws established:
//   PRODUCT LAW 3  banned cue lexicon      (spec §2, atlas §0-§1)
//   PRODUCT LAW 4  contraindicated practice (spec §5, atlas §5)
//   PRODUCT LAW 5  cue shape                (spec §1/§6)
//
// Owner-directed, verbatim intent: "tell the user to know what a sensation is
// meant to feel like or how the body is meant to be placed instead of telling
// the user to just use a 'brighter' voice as that tells us nothing".
//
// Every law gets three things, because any one alone is decoration:
//   FIRES      — the violation is caught, with the right witness code.
//   PASSES     — the compliant form is untouched (a law that eats good cues is
//                worse than no law).
//   KILL-TEST  — the law is proven to be load-bearing on the LIVE path, and the
//                exact strings this audit rewrote are proven to be detected, so
//                the law cannot silently stop matching.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeCoachReply,
  sanitizeCueVocabulary,
  sanitizeContraindicated,
  sanitizeCueShape,
  resolveCoreLoopRepairReply,
  CUE_VOCABULARY_RULES,
  CONTRAINDICATED_RULES,
  CUE_SHAPE_RULES,
  CUE_BODY_REFERENT_PATTERN,
  VOICE_QUALITY_PATTERN,
  ACTIONABLE_VOICE_PATTERN,
  BODY_PART_TERMS,
  VOICE_QUALITY_TERMS,
  SAFE_FALLBACK,
  LOW_EFFORT_CUE,
  GENERIC_ACTIONABLE_CUE,
} = require('./sanitizer');

const COACH_SIGNAL = {
  styleTarget: 'cute-feminine',
  policy: { shouldCorrect: true, coachingAction: 'coach', avoidTopics: [], safetyState: 'normal' },
  takeQuality: { usable: true },
  personalization: {},
};

const codes = (result) => result.hits;
const only = (result) => result.hits[0] || null;

// ---------------------------------------------------------------------------
// PRODUCT LAW 3 — BANNED CUE LEXICON
// ---------------------------------------------------------------------------

test('law 3 FIRES: every banned-lexicon class from spec §2 is caught', () => {
  const cases = [
    ['Use a brighter voice on the ending.', 'quality_bright'],
    ['Let it settle a little darker through the middle.', 'quality_dark'],
    ['Let the brightness carry the phrase.', 'quality_noun'],
    ['Find a forward placement and hold it there.', 'placement_fiction'],
    ['Send the sound into the mask.', 'placement_mask'],
    ['Let it resonate in your cheekbones.', 'placement_resonate_in'],
    ['Lift into your head voice for the last word.', 'register_folklore'],
    ['Keep an open throat as you say the line.', 'throat_folklore'],
    ['Speak from the diaphragm on this line.', 'breath_folklore'],
    ['Use more support on the ending.', 'undefined_support'],
    ['Do the small dog, big dog exercise.', 'community_shorthand'],
    ['Feel your cricothyroid tilt as the pitch rises.', 'muscle_introspection'],
    ['Feel the buzz in your cheekbones as the resonance improves.', 'invalid_resonance_buzz'],
    ['Let the resonance move forward.', 'sound_travels'],
    ['Aim for a lighter voice through the phrase.', 'quality_before_sound'],
    ['The tone stays fuller than the target.', 'quality_after_sound'],
    ['Keep it warmer through the middle.', 'quality_pronoun'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(only(sanitizeCueVocabulary(text)), expected, `verdict for: ${text}`);
  }
  // Every rule in the table is exercised by the cases above — a rule nothing
  // covers is a rule nobody notices breaking.
  const covered = new Set(cases.map(([, code]) => code));
  const uncovered = CUE_VOCABULARY_RULES.map((r) => r.code).filter((c) => !covered.has(c));
  assert.deepEqual(uncovered, [], `banned-lexicon rules with no test case: ${uncovered.join(', ')}`);
});

test('law 3 PASSES: body-and-sensation instruction is untouched', () => {
  const compliant = [
    'Press the sides of your tongue against the inside of your upper back teeth and keep that band of contact through the whole sentence.',
    'Draw your lip corners straight back so your lips are flat against your teeth.',
    'Slide the tone up in one unbroken line without letting it get louder.',
    'Find the fastest, coolest air on the ridge just behind your top teeth.',
    'Teeth a fingertip apart; slide your lower jaw slowly left, then right.',
    'Two fingers in the soft triangle under your chin — it should stay soft while you speak.',
    'Nod your chin down about a centimetre at the joint just under your skull, keeping your neck long.',
    'Stop if your throat burns or aches.',
  ];
  for (const text of compliant) {
    const result = sanitizeCueVocabulary(text);
    assert.deepEqual(codes(result), [], `wrongly caught: ${text}`);
    assert.equal(result.text, text);
  }
});

// THE ASYMMETRY THIS AUDIT EXISTS TO PROTECT. Felt vibration is a VALID weight
// signal (sternal accelerometry; valid below ~300 Hz, i.e. the whole target
// range) and an INVALID resonance signal (damping the paranasal sinuses does
// not change voice quality). Getting this backwards deletes the single best
// weight check the learner has, so it is asserted in BOTH directions.
test('law 3 ASYMMETRY: chest buzz is legal for WEIGHT, illegal for RESONANCE', () => {
  const legalWeight = [
    'Palm flat on your breastbone. The buzz should arrive the moment voice starts and stop the moment it ends.',
    'Make that buzz weaker without getting quieter.',
    'Put a hand on your chest and feel the buzz while you say it.',
    'If the buzz turns hard and rattly, you are pushing air — ease off.',
  ];
  for (const text of legalWeight) {
    assert.deepEqual(codes(sanitizeCueVocabulary(text)), [], `weight check wrongly caught: ${text}`);
  }
  const illegalResonance = [
    'Feel the buzz in your cheekbones as the resonance improves.',
    'You should feel it vibrating in your face when the resonance is right.',
    'Notice the buzz behind your nose — that is the resonance moving.',
    'Palm on your breastbone: that buzz tells you where your resonance is.',
  ];
  for (const text of illegalResonance) {
    assert.ok(codes(sanitizeCueVocabulary(text)).length > 0, `invalid resonance check missed: ${text}`);
  }
});

// The atlas is explicit that the intrinsic laryngeal muscles carry almost no
// proprioceptors (no muscle spindles at all were found in cricothyroid), and
// that chasing the sensation is the documented muscle-tension-dysphonia
// pathway. So naming one is banned outright, in either grammatical direction.
test('law 3: no instruction may ask the learner to feel an intrinsic laryngeal muscle', () => {
  for (const text of [
    'Feel your cricothyroid tilt as the pitch rises.',
    'Tilt the cricothyroid to get the top of the range.',
    'Notice your vocal folds tightening as you go up.',
    'Feel the thyroarytenoid engage on the low notes.',
  ]) {
    assert.ok(codes(sanitizeCueVocabulary(text)).length > 0, `muscle introspection missed: ${text}`);
  }
  // ...while the GROSS landmark check survives: the whole cartilage, moving.
  assert.deepEqual(
    codes(sanitizeCueVocabulary('Fingertip on the lump at the front of your throat. Swallow — feel it climb.')),
    [],
  );
});

// ---------------------------------------------------------------------------
// PRODUCT LAW 4 — CONTRAINDICATED PRACTICES
// ---------------------------------------------------------------------------

test('law 4 FIRES: all six contraindicated practices are caught', () => {
  const cases = [
    ['Flip into falsetto to find the top of your range.', 'falsetto_pitch_work'],
    ['Try a whisper siren from low to high.', 'whisper_practice'],
    ['Do a swallow-and-hold, then speak from there.', 'swallow_hold_or_max_raise'],
    ['Push the larynx up as high as possible and hold it.', 'swallow_hold_or_max_raise'],
    ['Add a little breath so the voice sounds lighter.', 'deliberate_breathiness'],
    ['Just raise your pitch and the rest follows.', 'pitch_only_strategy'],
    ['Hold a yawn-sigh posture while you speak.', 'yawn_sigh_as_posture'],
  ];
  for (const [text, expected] of cases) {
    assert.equal(only(sanitizeContraindicated(text)), expected, `verdict for: ${text}`);
  }
  const covered = new Set(cases.map(([, code]) => code));
  const uncovered = CONTRAINDICATED_RULES.map((r) => r.code).filter((c) => !covered.has(c));
  assert.deepEqual(uncovered, [], `contraindicated rules with no test case: ${uncovered.join(', ')}`);
});

// Each rule is a PROPOSAL frame, not a bare word, so the coach keeps the
// ability to WARN about the same practice — which the atlas §7 exercise bank
// actually requires it to do ("Keep it voiced, never whispered").
test('law 4 PASSES: warning about a practice, and the legal release use, survive', () => {
  for (const text of [
    'Keep it voiced, never whispered.',
    'Begin a yawn, let a sigh fall out, and let the throat release.',
    'Pinch your nostrils shut mid-vowel.',
    'Start a yawn with your mouth closed — the back roof of your mouth lifts.',
    'Pant lightly and quickly — feel the voice box ride up under your fingers.',
  ]) {
    const result = sanitizeContraindicated(text);
    assert.deepEqual(codes(result), [], `wrongly caught: ${text}`);
    assert.equal(result.text, text);
  }
});

// ---------------------------------------------------------------------------
// PRODUCT LAW 5 — CUE SHAPE
// ---------------------------------------------------------------------------

test('law 5 FIRES: an instruction about the sound with no body referent', () => {
  for (const text of [
    'Try to make the voice sound more feminine on that line.',
    'Keep the vowels smaller and more forward.',
    'Let the tone be sweeter at the end.',
    'Give the phrase a softer quality overall.',
  ]) {
    assert.equal(only(sanitizeCueShape(text)), 'cue_without_body_referent', `verdict for: ${text}`);
  }
});

test('law 5 PASSES: body part, imitation movement, or checkable sensation', () => {
  const byBodyPart = 'Draw your lip corners straight back so the lips lie flat on your teeth through the vowel.';
  const byMovement = 'Slide the tone up in one unbroken line without letting it get louder.';
  const bySensation = 'Make that buzz weaker without getting quieter.';
  for (const text of [byBodyPart, byMovement, bySensation]) {
    assert.deepEqual(codes(sanitizeCueShape(text)), [], `wrongly caught: ${text}`);
  }
  // The three vocabularies are genuinely distinct: the movement and sensation
  // cues name NO body part, which is exactly why a body-parts-only rule would
  // have destroyed them (spec §1 admits "an imitation task the body can just
  // perform" as an action).
  const bodyOnly = new RegExp(`\\b(?:${BODY_PART_TERMS.join('|').replace(/ /g, '\\s+')})\\b`, 'i');
  assert.equal(bodyOnly.test(byMovement), false);
  assert.equal(bodyOnly.test(bySensation), false);
});

test('law 5 is OUT OF SCOPE for non-instructions and for the app’s own surface', () => {
  for (const text of [
    'I hear you.',
    'That landed well.',
    'Nod your chin down a centimetre.',
    'Give me the line whenever you like.',
    'Summarize what changed and pick one focus for the next line.',
    // Operational speech: the mic/graph/capture are surfaces the learner
    // already has open, so these owe no body referent.
    'Try that once more a little closer to the mic with a clear, steady voice.',
    'The recording came in too loud. Move slightly back from the mic when you’re ready.',
  ]) {
    assert.deepEqual(codes(sanitizeCueShape(text)), [], `wrongly caught: ${text}`);
  }
});

// The whole point of spec §6's "make it structural": a blocklist only knows the
// metaphors someone already wrote down. Invented ones must still be rejected.
test('law 5 catches metaphors no blocklist has ever seen', () => {
  for (const text of [
    'Try to give the voice more sparkle on that word.',
    'Let the tone bloom a little on the ending.',
    'Keep the resonance velvety through the phrase.',
    'Make the sound more silvery as you go up.',
  ]) {
    assert.equal(only(sanitizeCueShape(text)), 'cue_without_body_referent', `invented metaphor missed: ${text}`);
    // ...and none of them is on any banned list, which is the point.
    assert.deepEqual(codes(sanitizeCueVocabulary(text)), [], `should not need the lexicon list: ${text}`);
  }
});

// ---------------------------------------------------------------------------
// KILL-TESTS — the laws are load-bearing on the LIVE path
// ---------------------------------------------------------------------------

test('kill-test: the laws run inside sanitizeCoachReply and report witnesses', () => {
  const witness = {};
  const out = sanitizeCoachReply(
    'Use a brighter voice with more forward placement. Press the sides of your tongue against your upper back teeth.',
    COACH_SIGNAL,
    { witness },
  );
  assert.doesNotMatch(out, /bright/i);
  assert.doesNotMatch(out, /forward placement/i);
  assert.match(out, /tongue/i, 'the compliant sentence must survive');
  assert.ok(Array.isArray(witness.cueVocabularyHits) && witness.cueVocabularyHits.length >= 1);
  assert.ok(Array.isArray(witness.contraindicatedHits));
  assert.ok(Array.isArray(witness.cueShapeHits));

  const contraWitness = {};
  const contraOut = sanitizeCoachReply(
    'Try a whisper siren first. Draw your lip corners straight back, flat against your teeth.',
    COACH_SIGNAL,
    { witness: contraWitness },
  );
  assert.doesNotMatch(contraOut, /whisper/i);
  assert.deepEqual(contraWitness.contraindicatedHits, ['whisper_practice']);

  const shapeWitness = {};
  sanitizeCoachReply('Try to make the voice sound sweeter there.', COACH_SIGNAL, { witness: shapeWitness });
  assert.deepEqual(shapeWitness.cueShapeHits, ['cue_without_body_referent']);
});

test('kill-test: a stripped turn is never left without an action', () => {
  // Everything the model said was illegal, so the learner must still be handed
  // one code-owned body action rather than an empty turn.
  const out = sanitizeCoachReply('Use a brighter voice and add support.', COACH_SIGNAL);
  assert.ok(out.trim().length > 0);
  assert.ok(CUE_BODY_REFERENT_PATTERN.test(out), `replacement names no body referent: ${out}`);
  assert.deepEqual(codes(sanitizeCueVocabulary(out)), []);
});

// A law whose own remedy breaks the law is a loop with a nice comment on it.
test('kill-test: every code-owned replacement string obeys all three laws', () => {
  // cueForDueReview is not exported, so reach every branch of it through the
  // exported repair that selects it — which is also the path a learner is
  // actually served from.
  const dueCue = (focus) => resolveCoreLoopRepairReply('Okay.', {
    ...COACH_SIGNAL,
    personalization: { dueReviewFocus: focus },
  }).reply;
  const owned = [SAFE_FALLBACK, LOW_EFFORT_CUE, GENERIC_ACTIONABLE_CUE];
  for (const focus of ['intonation', 'pitch floor', 'resonance', 'tone_clarity', 'closure', 'breath', 'weight', 'pronunciation', 'an-unknown-label']) {
    owned.push(dueCue(focus));
  }
  assert.equal(new Set(owned).size >= 8, true, 'the due-review branches must be distinct');
  for (const text of owned) {
    assert.ok(text && text.trim().length > 0, 'code-owned string is empty');
    assert.deepEqual(codes(sanitizeCueVocabulary(text)), [], `banned lexicon in code-owned string: ${text}`);
    assert.deepEqual(codes(sanitizeContraindicated(text)), [], `contraindicated practice in code-owned string: ${text}`);
    assert.deepEqual(codes(sanitizeCueShape(text)), [], `cue-shape violation in code-owned string: ${text}`);
  }
});

// 2026-07-27, from the failure-points dossier (74 stage-mapped failure points,
// ~3,961 r/transvoice posts): four beginner failure modes — cringe-abort,
// hormone-expectation, literal-imitation, impersonation-only — are EMOTIONAL /
// IDENTITY objections with no physical answer. The dossier is explicit that
// they must be answered as the objection they are, so the cue-shape law must
// not force a body cue onto them. It does not, and that is structural rather
// than lucky: the comfort register speaks in `pressure`, `effort` and
// `tension`, which are SENSATION_TERMS, and its other sentences carry no
// instruction verb at all.
// SPEC §3a, pinned case by case. Each bullet the spec names gets a realistic
// objection-answering reply with ZERO body referents; every one must pass.
test('spec §3a: the five non-technique blocks are answerable with no body referent', () => {
  const blocks = [
    ['identity objection', 'It costs effort now because it is new. That does not make it less yours.'],
    ['voice dies around people who knew you before', 'Your body is clearly capable — it did this a minute ago. What changed is who is in the room, not your anatomy.'],
    ['flawless as a character, unavailable as yourself', 'You already have the whole range. The hard part is not the anatomy, it is doing it as you rather than as a bit.'],
    ['fear of sounding ridiculous mid-attempt', 'Nothing is being graded. Ask for something so small it cannot be embarrassing.'],
    ['expecting hormones to have done it', 'This part is learned rather than given, and that is genuinely good news: it is the part you can change.'],
  ];
  for (const [block, text] of blocks) {
    assert.deepEqual(codes(sanitizeCueShape(text)), [], `§3a "${block}" wrongly caught: ${text}`);
    assert.deepEqual(codes(sanitizeCueVocabulary(text)), [], `§3a "${block}" wrongly caught: ${text}`);
    assert.deepEqual(codes(sanitizeContraindicated(text)), [], `§3a "${block}" wrongly caught: ${text}`);
  }
  // ...while the rule keeps its teeth on an actual instruction in the same turn.
  assert.equal(only(sanitizeCueShape('Now make the voice sound a little sweeter.')), 'cue_without_body_referent');
});

// Spec §3 check 9 (added 2026-07-27): the half-volume test. Legal for PITCH,
// never for resonance — pedagogy, not measurement.
test('spec §3 check 9: the half-volume pitch test survives all three laws', () => {
  for (const text of [
    'Now the same last word at half the volume — height that survives quiet was real.',
    'Say it again at half the volume in the same breath. If the height holds, it came from the voice box.',
    'If the pitch collapses when you go quiet, it was air pressure doing the work.',
  ]) {
    assert.deepEqual(codes(sanitizeCueVocabulary(text)), [], `half-volume test wrongly caught: ${text}`);
    assert.deepEqual(codes(sanitizeContraindicated(text)), [], `half-volume test wrongly caught: ${text}`);
    assert.deepEqual(codes(sanitizeCueShape(text)), [], `half-volume test wrongly caught: ${text}`);
  }
  // It must NOT be readable as the banned pitch-only strategy: that rule needs a
  // sufficiency claim ("just raise your pitch"), which none of these makes.
  assert.equal(only(sanitizeContraindicated('Just raise your pitch and the rest follows.')), 'pitch_only_strategy');
});

test('law 5 does not force a body cue onto an emotional or identity reply', () => {
  for (const text of [
    'That feeling is real, and it does not mean the voice is not yours.',
    'Nobody is being graded right now, so make it small enough that it cannot be embarrassing.',
    'This part of the voice is learned rather than given.',
    'Take the pressure off the sound entirely for a moment.',
    'Do the impression, then keep it going one sentence past the joke into your own words.',
    'It costs effort now because it is new, not because it is not you.',
    'Your voice is still yours on the turns that take work.',
  ]) {
    assert.deepEqual(codes(sanitizeCueShape(text)), [], `emotional reply wrongly caught: ${text}`);
    assert.deepEqual(codes(sanitizeCueVocabulary(text)), [], `emotional reply wrongly caught: ${text}`);
  }
});

// The dossier's `folklore-cues` principle names TEMPERATURE (the cool, fast
// airstream) as a checkable anchor. It passes spec §3's validity test because
// it IS signal 2 — the sensation is caused by the variable being trained.
test('the airstream-temperature check is a legal body referent', () => {
  for (const text of [
    'Find the fastest, coolest air on the ridge just behind your top teeth.',
    'Judge it by the contact and by where the air feels coolest, not by what it sounds like to you.',
    'Notice the temperature of the airstream as the tongue moves forward.',
  ]) {
    assert.ok(CUE_BODY_REFERENT_PATTERN.test(text), `temperature check not recognised: ${text}`);
    assert.deepEqual(codes(sanitizeCueShape(text)), []);
    assert.deepEqual(codes(sanitizeCueVocabulary(text)), []);
  }
});

// Guards against the vocabulary silently decoupling: the cue-shape law and the
// pre-existing actionability test must keep sharing ONE body-part list.
test('kill-test: the body vocabulary has exactly one definition', () => {
  for (const term of BODY_PART_TERMS) {
    assert.ok(ACTIONABLE_VOICE_PATTERN.test(term), `${term} missing from ACTIONABLE_VOICE_PATTERN`);
    assert.ok(CUE_BODY_REFERENT_PATTERN.test(term), `${term} missing from CUE_BODY_REFERENT_PATTERN`);
  }
  for (const term of VOICE_QUALITY_TERMS) {
    assert.ok(VOICE_QUALITY_PATTERN.test(term), `${term} missing from VOICE_QUALITY_PATTERN`);
    assert.ok(ACTIONABLE_VOICE_PATTERN.test(term), `${term} missing from ACTIONABLE_VOICE_PATTERN`);
    // A sound quality is NEVER a body referent — that is the whole distinction
    // the cue-shape law rests on.
    assert.equal(CUE_BODY_REFERENT_PATTERN.test(term), false, `${term} must not count as a body referent`);
  }
  assert.equal(CUE_SHAPE_RULES.length, 1);
});

// The 2026-07-26 register work is unweakened: every term the old hand-written
// ACTIONABLE_VOICE_PATTERN carried is still matched by the rebuilt one.
test('kill-test: the rebuilt actionability pattern is a superset of the old list', () => {
  const OLD_TERMS = [
    'voice', 'sound', 'tone', 'pitch', 'resonance', 'vowel', 'vowels', 'weight', 'onset',
    'phonation', 'intonation', 'prosody', 'articulation', 'breath', 'closure', 'larynx',
    'throat', 'hum', 'trill', 'line', 'phrase', 'word', 'ending', 'range', 'rate', 'tongue',
    'lip', 'lips', 'jaw', 'mouth', 'palate', 'teeth', 'shoulder', 'shoulders', 'neck', 'chin',
    'chest', 'head', 'body', 'posture', 'hand', 'hands', 'palm', 'palms', 'rib', 'ribs',
    'spine', 'ear', 'ears', 'sternum', 'knee', 'knees',
  ];
  const missing = OLD_TERMS.filter((t) => !ACTIONABLE_VOICE_PATTERN.test(t));
  assert.deepEqual(missing, [], `the rebuild dropped: ${missing.join(', ')}`);
});

// The existing laws must be exactly as strong as they were.
test('kill-test: the homework, equipment and gendered-noun laws are unweakened', () => {
  assert.equal(sanitizeCoachReply('Practise this at home every day.', COACH_SIGNAL), GENERIC_ACTIONABLE_CUE);
  assert.doesNotMatch(sanitizeCoachReply('Grab a straw and phonate through it.', COACH_SIGNAL), /straw/i);
  assert.doesNotMatch(
    sanitizeCoachReply('Press the sides of your tongue up for a more feminine sound.', COACH_SIGNAL),
    /\bfeminine\b/i,
  );
});
