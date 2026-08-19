'use strict';

// Banned-vocabulary guard (PRACTICE-PHILOSOPHY de-gamification rulings, live).
// Both directions: banned forms are replaced with calm alternatives; legitimate
// voice-work uses of the same words survive byte-identical. Prediction: pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  sanitizeBannedVocabulary,
  sanitizeCoachReply,
  sanitizeRepPressure,
  resolveCoreLoopRepairReply,
  boundSpokenReply,
  cueWithLine,
  SAFE_FALLBACK,
  LOW_EFFORT_CUE,
  GENERIC_ACTIONABLE_CUE,
  SESSION_CONTROL_PATTERNS,
} = require('./sanitizer');

function cleanText(input) {
  return sanitizeBannedVocabulary(input).text;
}

test('banned terms are replaced with calm alternatives', () => {
  assert.equal(cleanText("You're on a 5-day streak."), "You're on a 5-day run.");
  assert.equal(cleanText('Two streaks in a row.'), 'Two runs in a row.');
  assert.equal(cleanText('Nice combo.'), 'Nice sequence.');
  assert.equal(cleanText('You gained XP today.'), 'You gained progress today.');
  assert.equal(cleanText('You earned a badge.'), 'You earned a milestone.');
  assert.equal(cleanText('Three badges so far.'), 'Three milestones so far.');
  assert.equal(cleanText('You unlocked a new drill.'), 'You opened up a new drill.');
  assert.equal(cleanText('This unlocks the next drill.'), 'This opens up the next drill.');
  assert.equal(cleanText('Your quest continues.'), 'Your practice goal continues.');
  assert.equal(cleanText('Time to level up.'), 'Time to move forward.');
  assert.equal(cleanText('You leveled up today.'), 'You moved forward today.');
  assert.equal(cleanText("You've levelled up."), "You've moved forward.");
  assert.equal(cleanText('You reached level 3.'), 'You reached the next stage.');
  assert.equal(cleanText('You earned 50 points.'), 'You made real progress.');
  assert.equal(cleanText("You'll earn points for this."), "You'll make real progress for this.");
  assert.equal(cleanText("You're racking up points."), "You're making real progress.");
  assert.equal(cleanText('A new high score.'), 'A best take yet.');
  // These two rules swallow the leading "You", so the PURE function yields a
  // lowercase start; the live path capitalizes in sanitizeCoachReply Step 7
  // (and mid-sentence — "honestly, you crushed it" — lowercase is correct).
  assert.equal(cleanText('You crushed it.'), 'that one really landed.');
  assert.equal(cleanText("You're crushing it."), 'this is really landing.');
});

test('hype punctuation collapses: "great job!!" family loses the double bang', () => {
  assert.equal(cleanText('Great job!!'), 'Great job.');
  assert.equal(cleanText('Awesome!!!'), 'Awesome.');
  // A single calm exclamation mark survives.
  assert.equal(cleanText('Nice work!'), 'Nice work!');
});

test('legitimate voice-work uses SURVIVE (conservative word boundaries)', () => {
  const survivors = [
    'Keep the volume level steady through the phrase.',
    'Set the volume level 2 notches lower.',
    'Your score confidence was low on that take.',
    'Two points of focus for today.',
    'Any questions before the next line?',
    'Hold a level tone through the ending.',
  ];
  for (const line of survivors) {
    assert.equal(cleanText(line), line, `should survive untouched: ${line}`);
  }
});

test('sanitizeCoachReply applies the guard on the live path and reports witness hits', () => {
  const witness = {};
  const out = sanitizeCoachReply(
    "Great job!! You're on a streak — you earned 20 points and unlocked a badge.",
    { styleTarget: 'soft-feminine' },
    { witness },
  );
  assert.ok(!/!!/.test(out));
  assert.ok(!/\bstreak\b/i.test(out));
  assert.ok(!/\bpoints\b/i.test(out));
  assert.ok(!/\bunlocked\b/i.test(out));
  assert.ok(!/\bbadge\b/i.test(out));
  assert.ok(Array.isArray(witness.vocabHits) && witness.vocabHits.length >= 4);
  // A clean reply passes through with zero hits. 2026-07-27: "clean" now has to
  // mean clean under the cue-vocabulary law too — the previous fixture ("Keep
  // the vowels bright and the ending lifted.") carried a banned quality word,
  // so it was no longer a valid control for the gamification guard.
  const cleanWitness = {};
  const clean = sanitizeCoachReply(
    'Keep the tongue high and the lip corners drawn back through the ending.',
    { styleTarget: 'soft-feminine' },
    { witness: cleanWitness },
  );
  assert.equal(clean, 'Keep the tongue high and the lip corners drawn back through the ending.');
  assert.deepEqual(cleanWitness.vocabHits, []);
});

test('rep-pressure language is replaced with an optional closure and categorical witnesses', () => {
  const pressureForms = [
    'Try one more for me.',
    'Just one more pass.',
    'One more?',
    'Do it one more time.',
    "Let's hear one more.",
    'I want one more take.',
  ];
  for (const line of pressureForms) {
    const pure = sanitizeRepPressure(line);
    assert.match(pure.text, /take another if you like/i, line);
    assert.doesNotMatch(pure.text, /\b(?:just\s+)?one more\b/i, line);
    assert.ok(pure.hits.length >= 1, line);
    assert.ok(pure.hits.every((hit) => /^[a-z_]+$/.test(hit)), line);
  }

  const witness = {};
  const live = sanitizeCoachReply('That was cleaner. Try one more for me.', {}, { witness });
  assert.equal(live, 'That was cleaner. Take another if you like.');
  assert.deepEqual(witness.repPressureHits, ['imperative_one_more']);
  assert.ok(!JSON.stringify(witness).includes('Try one more for me'));

  const clean = sanitizeRepPressure('That was clear. Take another if you like.');
  assert.equal(clean.text, 'That was clear. Take another if you like.');
  assert.deepEqual(clean.hits, []);
});

test('session-control advice is replaced before tutor speech', () => {
  const witness = {};
  const reply = sanitizeCoachReply(
    "That was clear. That's enough for today — come back later.",
    {},
    { witness },
  );
  assert.equal(reply, 'That was clear. Let the jaw hang loose and start the next sound softly, keeping it level all the way through.');
  assert.equal(witness.sessionControlHits.length, 1);
  assert.doesNotMatch(reply, /\b(?:enough for today|come back|break|rest)\b/i);
});

test('forced warm-up and messaging framing are replaced before tutor speech', () => {
  for (const modelReply of [
    'Start with a quick warm-up before the lesson.',
    "Let's begin with lip trills before the lesson.",
    'Message me back with your response.',
    'Type your reply in the chat.',
    'Send me your answer in the box.',
  ]) {
    const witness = {};
    const reply = sanitizeCoachReply(modelReply, {}, { witness });
    assert.equal(reply, 'Let the jaw hang loose and start the next sound softly, keeping it level all the way through.');
    assert.ok(witness.sessionControlHits.length >= 1);
    assert.doesNotMatch(reply, /\b(?:warm[\s-]?up|message me|type your reply|chat)\b/i);
  }
});

test('coach-owned closing paraphrases are replaced before tutor speech', () => {
  for (const modelReply of [
    "Let's call it a day.",
    "We'll close with one easy line.",
    "Let's pick this up tomorrow.",
    "We're done for today.",
  ]) {
    const witness = {};
    const reply = sanitizeCoachReply(modelReply, {}, { witness });
    assert.equal(reply, 'Let the jaw hang loose and start the next sound softly, keeping it level all the way through.');
    assert.ok(witness.sessionControlHits.length >= 1, modelReply);
  }
});

test('expected coaching turns cannot collapse into reassurance padding', () => {
  const signal = {
    policy: { coachingAction: 'gentle', shouldCorrect: true },
    personalization: {
      dueReviewFocus: 'intonation variety',
      learnerMemoFields: { displayName: 'Robin' },
    },
  };
  const witness = {};
  const reply = sanitizeCoachReply(
    "I'm so glad you're here, Robin. Let's just take it slow today.",
    signal,
    { witness },
  );
  // 2026-07-26: the acknowledgment is NAME-FREE by law. The learner's name is
  // still present in learnerMemoFields above (the UI reads it) and is still
  // never spoken — that is the point of this assertion.
  assert.equal(reply, 'I hear you. Give one word in the practice sentence a clear pitch change up or down — that is the melody — letting the lips and jaw finish the word.');
  assert.doesNotMatch(reply, /Robin/);
  assert.equal(witness.coreLoopRepairCause, 'missing_actionable_cue');
  assert.doesNotMatch(reply, /\btake it slow today\b/i);

  assert.equal(
    resolveCoreLoopRepairReply('Keep the intonation moving on the displayed line.', signal),
    null,
  );
});

test('breather and converse turns are not forced back into a voice cue', () => {
  const reply = 'I hear you. That sounds like a lot to carry.';
  for (const coachingAction of ['breather', 'converse']) {
    assert.equal(
      sanitizeCoachReply(reply, { policy: { coachingAction, shouldCorrect: false } }),
      reply,
    );
  }
});

// ---------------------------------------------------------------------------
// 2026-07-26 breath-nag repair: canned cue wording.
//
// Every code-owned fallback used to name a STATE with no action in it ("gentle
// and unforced", "let one steady breath carry the line"), so a stripped or
// non-actionable model reply left the learner with nothing to do — and the
// due-review path injected a breath cue for an axis that measures closure.
// ---------------------------------------------------------------------------

function repairSignal(overrides = {}) {
  return {
    schema: 'transvoice.coaching_signal.v2',
    policy: { shouldCorrect: true, coachingAction: 'coach' },
    personalization: { preferencePolicy: { ids: [], maxSpokenWords: 45 }, ...overrides.personalization },
    ...overrides,
  };
}

// The repair path is the only way code-owned cue vocabulary reaches speech.
function cueFor(dueReviewFocus) {
  const repaired = resolveCoreLoopRepairReply('Okay.', repairSignal({
    personalization: { dueReviewFocus, preferencePolicy: { ids: [], maxSpokenWords: 45 } },
  }));
  assert.ok(repaired, `expected a repair for ${dueReviewFocus}`);
  return repaired.reply;
}

test('due-review cues for the closure axis speak CLOSURE, never breathing', () => {
  const expected = 'Start the first word with a tiny, gentle "uh" — the small catch just before a cough — then keep that clean contact.';
  // The renamed axis...
  assert.equal(cueFor('tone_clarity'), expected);
  assert.equal(cueFor('Tone clarity'), expected);
  assert.equal(cueFor('closure'), expected);
  // ...and the LEGACY labels already persisted in learner review queues, which
  // must keep matching so old rows do not fall through to the generic cue.
  assert.equal(cueFor('breath_flow'), expected);
  assert.equal(cueFor('Breath support'), expected);
  // The returned cue never tells the learner to breathe.
  assert.doesNotMatch(cueFor('breath_flow'), /breath/i);
});

test('the unknown-label cue is concrete, not a vague state', () => {
  const cue = cueFor('some unrecognized persisted label');
  assert.equal(cue, 'Say the practice sentence slowly, and let the lips and jaw finish each word before the next one begins.');
  // Names an action, an ARTICULATOR, AND a location in the sentence.
  assert.match(cue, /say|let|finish/i);
  assert.match(cue, /\b(?:lips?|jaw|tongue|mouth)\b/i);
  assert.match(cue, /sentence|word|end/i);
  assert.doesNotMatch(cue, /gentle, unforced/i);
  // Persisted learner text is never echoed back into speech.
  assert.doesNotMatch(cue, /unrecognized persisted label/i);
});

test('the other axis cues still resolve and stay actionable', () => {
  // 2026-07-26: each axis cue names an ARTICULATOR. 2026-07-28: the axis itself
  // is named in PLAIN WORDS — never the raw identifier ("pitch floor",
  // "resonance", "vocal weight", "intonation") — and each stays
  // DIRECTION-NEUTRAL: these cues are keyed off a persisted review-queue label,
  // so nothing downstream can make them direction-aware.
  assert.match(cueFor('intonation'), /pitch change/i);
  assert.match(cueFor('intonation'), /melody/i);
  assert.match(cueFor('intonation'), /\blips\b|\bjaw\b/i);
  assert.match(cueFor('pitch floor'), /how low your voice dips/i);
  assert.match(cueFor('pitch floor'), /\bjaw\b/i);
  assert.doesNotMatch(cueFor('pitch floor'), /pitch floor/i);
  assert.match(cueFor('resonance'), /\btongue\b/i);
  assert.doesNotMatch(cueFor('resonance'), /resonance/i);
  assert.match(cueFor('vocal weight'), /buzz/i);
  assert.match(cueFor('vocal weight'), /\bjaw\b|\bchest\b/i);
  assert.doesNotMatch(cueFor('vocal weight'), /vocal weight/i);
  assert.doesNotMatch(cueFor('pronunciation'), /displayed/i);
  assert.match(cueFor('pronunciation'), /\blips\b/i);
  // No axis cue may name a pitch DIRECTION: a rise is a feminizing device and a
  // drop a masculinizing one, and either gets deleted for the other learner.
  for (const label of ['intonation', 'pitch floor', 'resonance', 'vocal weight', 'pronunciation']) {
    assert.doesNotMatch(cueFor(label), /step up|step down|\brise\b|rising\b/i, label);
  }
});

test('every code-owned fallback names an action and clears the spoken clamp', () => {
  for (const [label, cue] of [
    ['SAFE_FALLBACK', SAFE_FALLBACK],
    ['LOW_EFFORT_CUE', LOW_EFFORT_CUE],
    ['generic repair cue', cueFor('some unrecognized persisted label')],
    ['closure cue', cueFor('tone_clarity')],
  ]) {
    // Clamp rules from boundSpokenReply: <= 2 sentences, <= 45 spoken words.
    const sentences = cue.split(/(?<=[.!?])\s+/).filter(Boolean);
    assert.ok(sentences.length <= 2, `${label}: ${sentences.length} sentences`);
    const words = cue.split(/\s+/).filter(Boolean);
    assert.ok(words.length <= 45, `${label}: ${words.length} words`);
    // boundSpokenReply must pass it through unchanged (no mid-sentence cut).
    assert.equal(boundSpokenReply(cue, 45), cue, `${label} survives the clamp`);
    // Names a physical action, not just a state.
    assert.match(cue, /\b(start|hold|let|say|keep|bring|lift|settle|add|close)\b/i, label);
    // No coach-owned session control, and no breath coaching.
    assert.doesNotMatch(cue, /\bbreath(e|ing)?\b/i, label);
    for (const pattern of SESSION_CONTROL_PATTERNS) {
      assert.doesNotMatch(cue, pattern, `${label} vs ${pattern}`);
    }
  }
});

// ---------------------------------------------------------------------------
// 2026-07-26: the coach NEVER speaks the learner's name.
// ---------------------------------------------------------------------------

test('the core-loop acknowledgment is always name-free, whatever name is stored', () => {
  const gentleSignal = (displayName) => ({
    policy: { coachingAction: 'gentle', shouldCorrect: true },
    personalization: {
      dueReviewFocus: 'intonation variety',
      learnerMemoFields: { displayName },
    },
  });
  // An ordinary name, a name with marks/punctuation, and an adversarial one all
  // produce the SAME bare acknowledgment — there is no name branch left.
  for (const name of ['Robin', 'Mara', "O'Brien-Smith", 'José María', 'take a break', '']) {
    const repaired = resolveCoreLoopRepairReply('I am so glad you are here.', gentleSignal(name));
    assert.ok(repaired, `expected a repair for ${JSON.stringify(name)}`);
    assert.ok(
      repaired.reply.startsWith('I hear you. '),
      `acknowledgment must be bare, got: ${repaired.reply}`,
    );
    if (name) assert.doesNotMatch(repaired.reply, new RegExp(name.split(/\s+/)[0], 'i'));
  }
  // Identical output regardless of the stored name.
  assert.equal(
    resolveCoreLoopRepairReply('I am so glad you are here.', gentleSignal('Robin')).reply,
    resolveCoreLoopRepairReply('I am so glad you are here.', gentleSignal('')).reply,
  );
});

test('every code-owned coaching fallback names an ARTICULATOR', () => {
  const ARTICULATOR = /\b(?:tongue|lips?|jaw|mouth|teeth|palate)\b/i;
  assert.match(SAFE_FALLBACK, ARTICULATOR);
  assert.match(LOW_EFFORT_CUE, ARTICULATOR);
  // ...and none of them smuggles back the imagery the register replaced.
  for (const cue of [SAFE_FALLBACK, LOW_EFFORT_CUE]) {
    assert.doesNotMatch(cue, /let the words out|carry the line|let it flow/i);
  }
});

// ---------------------------------------------------------------------------
// 2026-07-28 BEGINNER-LANGUAGE law. Two mechanisms, two test shapes:
// word-level rewrites (BANNED_VOCAB_RULES) keep the sentence; the axis-noun
// sentence law (BEGINNER_JARGON_RULES) drops it.
// ---------------------------------------------------------------------------

test('beginner jargon is rewritten word-level: displayed line, pitch floor, intonation, prosody', () => {
  assert.equal(cleanText('Say the displayed line slowly.'), 'Say the practice sentence slowly.');
  assert.equal(cleanText('Take the display line again.'), 'Take the practice sentence again.');
  assert.equal(cleanText('Keep the pitch floor where the hum put it.'), 'Keep the low end of your pitch where the hum put it.');
  assert.equal(cleanText('Pitch floor first, then the words.'), 'Low end of your pitch first, then the words.');
  assert.equal(cleanText('Keep the intonation alive.'), 'Keep the melody alive.');
  assert.equal(cleanText('Intonation carries the question.'), 'Melody carries the question.');
  assert.equal(cleanText('Her prosody was lovely.'), 'Her melody was lovely.');
  // Legitimate lookalikes survive: "display" alone, "pitch" alone, "melody".
  assert.equal(cleanText('Keep the pitch steady.'), 'Keep the pitch steady.');
  assert.equal(cleanText('Say the line again.'), 'Say the line again.');
});

test('beginner-language sentence law drops raw axis nouns from spoken output', () => {
  const signal = { policy: { coachingAction: 'coach', shouldCorrect: true, avoidTopics: [] } };
  // Jargon sentence dropped; the actionable sentence survives untouched.
  const kept = sanitizeCoachReply(
    'Your resonance sat back toward the throat. Say it again with the tongue forward behind your top teeth.',
    signal,
  );
  assert.doesNotMatch(kept, /resonance/i);
  assert.match(kept, /tongue forward/i);
  // "vocal weight" is banned the same way.
  const weight = sanitizeCoachReply(
    'Keep the vocal weight where it is. Let the jaw hang loose and start each word softly.',
    signal,
  );
  assert.doesNotMatch(weight, /vocal weight/i);
  assert.match(weight, /jaw/i);
  // A reply that is ONLY a jargon sentence is not left empty: the code-owned
  // plain cue substitutes.
  const only = sanitizeCoachReply('Let the resonance move forward.', signal);
  assert.doesNotMatch(only, /resonance/i);
  assert.ok(only.trim().length > 0);
  // Witness codes land like the other sentence laws.
  const witness = {};
  sanitizeCoachReply('Your resonance sat back. Say it again with a loose jaw.', signal, { witness });
  assert.deepEqual(witness.beginnerJargonHits, ['jargon_axis_resonance']);
});

test('placement hole is closed: modifier + placement and placement + state verb fire', () => {
  const { sanitizeCueVocabulary } = require('./sanitizer');
  const fires = [
    'Copy one short phrase at a time, matching the balanced placement.',
    'Keep the neutral placement through the words.',
    'The placement stays put from first word to last.',
    'Find the same placement your voice used before.',
  ];
  for (const text of fires) {
    const result = sanitizeCueVocabulary(text);
    assert.deepEqual(result.hits, ['placement_fiction'], `expected placement_fiction: ${text}`);
  }
  // Legitimate uses survive: placing a hand or an object, not the sound.
  const safe = sanitizeCueVocabulary('Place a hand on your chest and feel the buzz.');
  assert.deepEqual(safe.hits, []);
});

// ---------------------------------------------------------------------------
// 2026-07-28 META-QUESTION RESPONDER + cueWithLine. The beginner asks what the
// practice sentence IS and the coach answers, deterministically, on any turn
// classification — and every canned cue names the actual sentence.
// ---------------------------------------------------------------------------

test('meta-question responder: line questions get the actual words, verbatim, through the full pipeline', () => {
  const signal = {
    policy: { coachingAction: 'coach', shouldCorrect: true, avoidTopics: [] },
    practiceLine: 'Good morning, how are you today?',
    userUtterance: 'what is the practice sentence?',
  };
  const witness = {};
  const reply = sanitizeCoachReply('Any model text at all.', signal, { witness });
  assert.equal(reply, 'Say these words with me: "Good morning, how are you today".');
  assert.equal(witness.practiceLineCause, 'practice_line_question');
  // Core-loop repair must NOT destroy the answer (the round-3 bug).
  assert.equal(witness.coreLoopRepairCause, undefined);

  for (const question of [
    "what's the sentence",
    'what do I say',
    'what should I say?',
    'what am I supposed to say',
    'repeat the sentence',
    'tell me the sentence',
    'read it to me',
    'can you say it',
    'can you repeat the sentence',
  ]) {
    const out = sanitizeCoachReply('model text', { ...signal, userUtterance: question });
    assert.equal(out, 'Say these words with me: "Good morning, how are you today".', question);
  }

  // Answered, not coached, on converse AND breather turns too.
  for (const coachingAction of ['converse', 'breather']) {
    const out = sanitizeCoachReply('model text', {
      ...signal,
      policy: { coachingAction, shouldCorrect: false, avoidTopics: [] },
    });
    assert.equal(out, 'Say these words with me: "Good morning, how are you today".', coachingAction);
  }

  // No practice line -> no interception, ordinary pipeline behavior.
  const noLine = sanitizeCoachReply('I hear you.', {
    policy: { coachingAction: 'converse', shouldCorrect: false, avoidTopics: [] },
    userUtterance: 'what is the practice sentence?',
  });
  assert.equal(noLine, 'I hear you.');

  // A take-bearing turn asking the same question is still answered (this was
  // the classification trap: hasUsableTake gates converse OFF on question-form
  // drill lines).
  const onTake = sanitizeCoachReply('model text', {
    ...signal,
    takeQuality: { usable: true },
    coachMove: { intent: 'single_actionable_cue' },
  });
  assert.equal(onTake, 'Say these words with me: "Good morning, how are you today".');
});

test('meta-question responder: "say that again" re-speaks the last coach message', () => {
  const signal = {
    policy: { coachingAction: 'coach', shouldCorrect: true, avoidTopics: [] },
    userUtterance: 'say that again',
    lastCoachMessage: 'Let your shoulders drop and start each word softly.',
  };
  const witness = {};
  const reply = sanitizeCoachReply('model text', signal, { witness });
  assert.equal(reply, 'Let your shoulders drop and start each word softly.');
  assert.equal(witness.practiceLineCause, 'repeat_tutor');
  // Without a stored message there is nothing to repeat -> no interception.
  const noMessage = sanitizeCoachReply('I hear you.', {
    policy: { coachingAction: 'converse', shouldCorrect: false, avoidTopics: [] },
    userUtterance: 'say that again',
  });
  assert.equal(noMessage, 'I hear you.');
});

test('cueWithLine: canned cues name the actual sentence; static exports stay the no-line case', () => {
  assert.equal(
    cueWithLine(GENERIC_ACTIONABLE_CUE, { practiceLine: 'how was your day' }),
    'Say the practice sentence slowly, and let the lips and jaw finish each word before the next one begins: "how was your day".',
  );
  assert.equal(cueWithLine(GENERIC_ACTIONABLE_CUE, {}), GENERIC_ACTIONABLE_CUE);
  assert.equal(cueWithLine(SAFE_FALLBACK, { practiceLine: 'need a little magic' }),
    'Say the practice sentence with a loose jaw and easy lips, letting every word land as clearly as the first: "need a little magic".');
  // The quote is capped so the form stays inside the spoken clamp.
  const long = cueWithLine(GENERIC_ACTIONABLE_CUE, { practiceLine: `  ${'word '.repeat(30)}` });
  assert.ok(long.includes('…'), 'over-long lines are truncated');
  assert.ok(long.split(/\s+/).length <= 45, `templated cue inside the clamp: ${long.split(/\s+/).length} words`);

  // End to end: the core-loop repair fallback carries the real words.
  const witness = {};
  const reply = sanitizeCoachReply('Okay.', {
    policy: { coachingAction: 'coach', shouldCorrect: true, avoidTopics: [] },
    practiceLine: 'how was your day',
  }, { witness });
  assert.equal(reply, 'Say the practice sentence slowly, and let the lips and jaw finish each word before the next one begins: "how was your day".');
  assert.equal(witness.coreLoopRepairCause, 'missing_actionable_cue');
});
