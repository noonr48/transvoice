'use strict';

// Wave 2A: deterministic, LLM-free preference capture. Precision-first — the
// tests below weight NEGATIVE/false-positive cases heavily, because a captured
// preference becomes a HARD CONSTRAINT in the coach prompt.

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractDeterministicMemoryOps, normalizeTranscript, PREFERENCE_RULES } = require('./memory-extract');
const { validateMemoryOps, applyMemoryOps } = require('./memory-ops');

const valuesOf = (ops) => ops.map((o) => o.value);
const hasPref = (ops, idFragment) => ops.some((o) => o.value.toLowerCase().includes(idFragment));

test('captures the canonical imagery preference (and phrasings)', () => {
  for (const utterance of [
    'imagery and metaphors confuse me — give me concrete physical instructions instead',
    'honestly metaphors just confuse me',
    'can you give me concrete physical cues instead of imagery',
    "I don't get the visualizations, they don't help",
    'I prefer specific physical instructions',
  ]) {
    const ops = extractDeterministicMemoryOps(utterance);
    assert.ok(hasPref(ops, 'concrete physical cues'), `should fire for: ${utterance}`);
    assert.equal(ops[0].kind, 'preference');
    assert.equal(ops[0].preferenceId, 'concrete-over-imagery');
  }
});

test('each closed-list rule fires on a representative utterance', () => {
  const cases = [
    ['can you slow down a little?', 'slower coaching pace'],
    ['please stop correcting every little thing', 'fewer corrections'],
    ['could you be a bit more gentle with me today', 'gentle, patient'],
    ["just be blunt, don't sugarcoat it", 'direct, blunt'],
    ['keep it short please, that was too wordy', 'short, concise'],
  ];
  for (const [utterance, fragment] of cases) {
    const ops = extractDeterministicMemoryOps(utterance);
    assert.ok(hasPref(ops, fragment), `"${utterance}" should capture "${fragment}" — got ${JSON.stringify(valuesOf(ops))}`);
  }
});

test('PRECISION: positive/neutral mentions do NOT capture an anti-preference', () => {
  for (const utterance of [
    'that imagery really helped, the balloon image clicked',     // imagery PRAISED
    'I love when you use metaphors',                              // imagery PRAISED
    'can I imagine myself speaking to a crowd?',                  // "imagine", no negation
    'should I slow down my own speech at phrase ends?',           // own voice, not coaching pace
    'my pitch was going too fast there',                          // own voice rate (unless guard)
    'I corrected my posture like you said',                       // "corrected" but not a directive
    'I want to sound more feminine on the phone',                 // a goal, not a style preference
    'today was hard but good',                                    // generic chit-chat
    'what should I focus on?',                                    // a question
    '',                                                           // empty
  ]) {
    const ops = extractDeterministicMemoryOps(utterance);
    assert.equal(ops.length, 0, `should capture NOTHING for: "${utterance}" — got ${JSON.stringify(valuesOf(ops))}`);
  }
});

test('PRECISION 2: goals-vs-style, hedges, concrete-example requests do NOT capture (reviewer families)', () => {
  for (const utterance of [
    'I want to be more gentle and feminine in my everyday voice',   // self GOAL, not coach style
    'my goal this month is to be more direct and confident when I order coffee',
    'I want to be more direct in conversations with my coworkers',
    'be honest, was that any good?',                                 // hedge
    'to be honest I struggled today',                                // hedge
    'be honest with me, do I pass on the phone?',                    // hedge/question
    'can you give me a concrete sentence to practice',               // concrete EXAMPLE, not a cue-pref
    'give me a concrete example of a good sentence',
    'I need specific words with lots of forward resonance',
    'do I need to slow down?',                                       // asking, not directing
    'should we slow down?',
    'my tone was too harsh on that one',                             // own acoustic output ("harsh" is a voice term)
    'that vowel sounds too harsh',                                   // acoustic quality, not coach tone
    'this drill is too tough for me right now',                      // material difficulty
    'the words are too tough to pronounce',
    "I'm going too fast on my own speech",                           // own rate (i'm contraction)
    'my answer was too wordy',                                       // own output (brevity)
    'i keep it short usually',                                       // own habit
    'i am too wordy sometimes',
    'this drill is too fast for me',                                 // practice material pace
    'the audio is going too fast',
    'i need to stop correcting my own pitch',                        // self-correction
    'stop pointing out my flaws to myself',
  ]) {
    const ops = extractDeterministicMemoryOps(utterance);
    assert.equal(ops.length, 0, `should capture NOTHING for: "${utterance}" — got ${JSON.stringify(valuesOf(ops))}`);
  }
});

test('coach-DIRECTED tone requests still capture (recall preserved after the precision fix)', () => {
  assert.ok(hasPref(extractDeterministicMemoryOps('can you be more gentle with me today'), 'gentle'));
  assert.ok(hasPref(extractDeterministicMemoryOps('please be more direct with me'), 'direct'));
  assert.ok(hasPref(extractDeterministicMemoryOps("you're being too harsh"), 'gentle'));
  assert.ok(hasPref(extractDeterministicMemoryOps("you're too harsh on me"), 'gentle'));
  assert.ok(hasPref(extractDeterministicMemoryOps('go easy on me'), 'gentle'));
  assert.ok(hasPref(extractDeterministicMemoryOps('stop correcting me so much'), 'fewer corrections'));
  assert.ok(hasPref(extractDeterministicMemoryOps("don't over-explain please"), 'short, concise'));
  assert.ok(hasPref(extractDeterministicMemoryOps('you talk too much, keep it brief'), 'short, concise'));
  // recall fixes: a coach-pace request that merely mentions material still fires; plural "corrections" fires
  assert.ok(hasPref(extractDeterministicMemoryOps('can you slow down on this exercise'), 'slower coaching pace'));
  assert.ok(hasPref(extractDeterministicMemoryOps('you give too many corrections'), 'fewer corrections'));
  assert.ok(hasPref(extractDeterministicMemoryOps("just be blunt, don't sugarcoat it"), 'direct'));
  assert.ok(hasPref(extractDeterministicMemoryOps('give me concrete physical cues, not imagery'), 'concrete physical'));
});

test('the slower-pace unless-guard suppresses own-voice mentions but allows coach-directed ones', () => {
  assert.equal(extractDeterministicMemoryOps('my speech is too fast for me to control').length, 0);
  assert.ok(hasPref(extractDeterministicMemoryOps("you're going too fast, slow down"), 'slower coaching pace'));
});

test('caps at MAX_EXTRACT (<=2) and never repeats a rule', () => {
  // an utterance engineered to trip several rules
  const ops = extractDeterministicMemoryOps(
    "slow down and be gentle, also keep it short and stop correcting me, and skip the imagery",
  );
  assert.ok(ops.length <= 2, `cap not honored: ${JSON.stringify(valuesOf(ops))}`);
  assert.equal(new Set(valuesOf(ops)).size, ops.length, 'no duplicate values');
});

test('output shape is consumable by the existing validateMemoryOps + applyMemoryOps', () => {
  const ops = extractDeterministicMemoryOps('metaphors confuse me, give me concrete cues');
  assert.ok(ops.length >= 1);
  // validateMemoryOps takes a { remember: [...] } object and must accept our ops unchanged
  const validated = validateMemoryOps({ remember: ops });
  assert.equal(validated.valid, true);
  assert.equal(validated.ops.length, ops.length);
  assert.equal(validated.ops[0].kind, 'preference');
  assert.equal(validated.ops[0].preferenceId, ops[0].preferenceId);

  // applyMemoryOps routes a 'preference' op to addCoachPreference
  const captured = [];
  const fakeService = { addCoachPreference: (sid, pref) => captured.push({ sid, pref }) };
  const applied = applyMemoryOps(fakeService, 'stu-1', ops);
  assert.equal(applied, ops.length);
  assert.equal(captured[0].sid, 'stu-1');
  assert.equal(captured[0].pref.text, ops[0].value);
  assert.equal(captured[0].pref.id, ops[0].preferenceId);
});

test('idempotent canonical values: same utterance -> identical stable strings', () => {
  const a = extractDeterministicMemoryOps('please be more direct and blunt with me');
  const b = extractDeterministicMemoryOps('please be more direct and blunt with me');
  assert.deepEqual(valuesOf(a), valuesOf(b));
  // values are drawn from the closed rule set (no free text leaks through)
  const allowed = new Set(PREFERENCE_RULES.map((r) => r.value));
  for (const op of a) assert.ok(allowed.has(op.value), `value not in closed set: ${op.value}`);
});

test('normalizeTranscript folds curly apostrophes, collapses whitespace, bounds length', () => {
  assert.equal(normalizeTranscript('Don’t   SUGARCOAT\nit'), "don't sugarcoat it");
  assert.equal(normalizeTranscript(42), '');
  assert.equal(normalizeTranscript('a'.repeat(5000)).length, 600);
  // a curly-apostrophe "don't sugarcoat" still triggers direct-feedback after folding
  assert.ok(extractDeterministicMemoryOps('Don’t sugarcoat it, just tell me').some((o) => /direct/.test(o.value)));
});
