'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRendererSystemPrompt } = require('./coaching/renderer-client');
const {
  buildVoiceTutorPracticeModeLines,
  buildVoiceTutorRuntimePolicyLines,
  buildVoiceTutorScenarioPolicyLines,
} = require('./voice-tutor-runtime-policy');

const FORCED_WARMUP = /\bwarm[\s-]?up(?:s|ing)?\b/i;
const COACH_OWNS_END = /\b(?:take|have) (?:a )?(?:break|rest)\b|\b(?:let'?s|we should|you should) (?:stop|pause|end)\b|\bcome back later\b/i;
const MESSAGING_INVITATION = /\b(?:text|message|chat) (?:me|back|with me|your reply|your response)\b|\b(?:type|write) (?:your|a) (?:reply|response|message)\b/i;

test('all legacy runtime policy modes remain spoken, core-loop, and learner-owned', () => {
  const surfaces = [
    ...['active_drill', 'conversation_practice', 'reflection', 'lesson_plan', 'safety_reset']
      .map((practiceMode) => buildVoiceTutorPracticeModeLines(practiceMode).join('\n')),
    buildVoiceTutorRuntimePolicyLines({ practiceMode: 'conversation_practice' }).join('\n'),
    buildVoiceTutorScenarioPolicyLines({
      practiceMode: 'conversation_practice',
      expected: { conversationNoCorrection: true },
    }).join('\n'),
  ];
  for (const surface of surfaces) {
    assert.doesNotMatch(surface, FORCED_WARMUP);
    assert.doesNotMatch(surface, COACH_OWNS_END);
    assert.doesNotMatch(surface, MESSAGING_INVITATION);
  }
});

test('authoritative renderer states the immutable spoken-Coach contract', () => {
  const prompt = buildRendererSystemPrompt(false);
  assert.match(prompt, /live vocal-practice lesson/i);
  assert.match(prompt, /not a text chat or messaging exchange/i);
  assert.match(prompt, /learner alone controls session Start\/Stop/i);
  assert.match(prompt, /Never recommend stopping, ending for today, resting, taking a break, or coming back later/i);
  assert.match(prompt, /Never ask the learner to type, text, send a message, read a thread, or use a chat control/i);
  assert.doesNotMatch(prompt, FORCED_WARMUP);
});

// 2026-07-26 product laws: HOMEWORK (all practice happens now, in session) and
// EQUIPMENT (no instruction may require an object). Both are enforced
// deterministically in coaching/sanitizer.js; these lines are the model-side
// half, and this test is what stops them being softened back into "avoid"
// wording or dropped in a future prompt edit.
test('renderer states the homework and equipment product laws', () => {
  const prompt = buildRendererSystemPrompt(false);
  assert.match(prompt, /Never assign practice for later/i);
  assert.match(prompt, /All practice happens NOW, in this session/i);
  assert.match(prompt, /Never require any object, prop, or equipment/i);
  assert.match(prompt, /doable right now with only the learner's voice and their own body/i);
  // The no-object law must name the WHOLE body, not just the mouth — otherwise
  // it silently re-narrows the register the rubric above just widened.
  assert.match(prompt, /shoulders, neck, chest, posture, and their own hands/i);
});

// 2026-07-26 owner refinement: "it's probably not mouth clues, either but think
// about body posture, or just physical way for us to get closer to our goal."
// The rubric's inventory is PHYSICAL, not articulator-only. This test pins the
// whole-body register so a future edit cannot silently narrow it back to the
// mouth — and pins that the learner's own body stays legal under the no-object
// law, which is the distinction that makes the register usable at all.
test('renderer rubric offers the WHOLE-BODY physical inventory, not mouth-only', () => {
  const prompt = buildRendererSystemPrompt(false);
  assert.match(prompt, /PHYSICAL ACTION of a named BODY PART/i);
  // Articulators survive the widening.
  for (const articulator of [/\btongue\b/i, /\blips\b/i, /\bjaw\b/i, /soft palate/i]) {
    assert.match(prompt, articulator);
  }
  // Body and posture are named as equally usable.
  for (const bodyPart of [/\bshoulders\b/i, /\bneck\b/i, /\bchin\b/i, /\bchest\b/i, /\bspine\b/i]) {
    assert.match(prompt, bodyPart);
  }
  // The corpus's strongest body register is explicitly licensed.
  assert.match(prompt, /Relax, soften, loosen, release, drop, lengthen, widen/i);
  assert.match(prompt, /shoulders \(soft, dropped, away from the ears\)/i);
  // At least one worked example at body level, and the own-body allowance.
  assert.match(prompt, /Let your shoulders drop away from your ears/i);
  // 2026-07-27 cue-vocabulary law: the own-body allowance is unchanged in
  // substance (the learner's hands are still explicitly welcome) but is now
  // scoped to what a felt buzz may CLAIM — weight, never resonance.
  assert.match(prompt, /palm flat on the breastbone/i);
  assert.match(prompt, /felt buzz reports vocal WEIGHT, never resonance/i);
  // The widened register must not have smuggled in an object.
  assert.doesNotMatch(prompt, /\b(straws?|pencils?|spoons?|candles?|tissues?|mirrors?|balloons?|kazoos?|cup of)\b/i);
});
