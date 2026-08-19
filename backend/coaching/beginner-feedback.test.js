'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { beginnerFeedback, containsInternalJargon } = require('./beginner-feedback');

test('capture failures explain the recording problem instead of judging performance', () => {
  const feedback = beginnerFeedback({
    measurementUsable: false,
    measurementReasons: ['sustained_clipping'],
  });
  assert.equal(feedback.state, 'could_not_measure');
  assert.match(feedback.message, /recording was too loud/i);
  assert.equal(/failed|bad voice|wrong voice/i.test(feedback.message), false);
});

test('verified progress asks for a no-feedback repetition', () => {
  const feedback = beginnerFeedback({ verification: { result: 'worked_verified' } });
  assert.equal(feedback.state, 'verified_progress');
  assert.equal(feedback.nextAction, 'no_feedback_repeat');
  assert.match(feedback.message, /without relying on the display/i);
});

test('mixed movement is described without exposing the internal confounded label', () => {
  const feedback = beginnerFeedback({ verification: { result: 'confounded' } });
  assert.equal(feedback.state, 'change_was_mixed');
  // Lens-4 register fix: "protected feature" is internal vocabulary — the
  // copy now speaks "something you were keeping steady".
  assert.match(feedback.message, /something you were keeping steady moved/i);
  assert.equal(containsInternalJargon(feedback), false);
});

test('high effort reduces difficulty rather than rewarding the acoustic gain', () => {
  const feedback = beginnerFeedback({ verification: { result: 'cost_too_high' } });
  assert.equal(feedback.state, 'change_too_effortful');
  assert.equal(feedback.nextAction, 'reduce_target_step');
  assert.match(feedback.message, /cost more effort/i);
});

test('wrong-way copy speaks exercises, not approved cues', () => {
  const feedback = beginnerFeedback({ verification: { result: 'moved_wrong_way' } });
  assert.equal(feedback.state, 'cue_not_helping_yet');
  // Lens-4 register pin: "approved cue" is internal vocabulary.
  assert.match(feedback.message, /Try a different exercise rather than pushing harder/i);
  assert.doesNotMatch(feedback.message, /approved cue/i);
  assert.equal(containsInternalJargon(feedback), false);
});

test('pain produces an exercise stop, not an acoustic coaching suggestion', () => {
  const feedback = beginnerFeedback({ safety: { state: 'stop', reason: 'reported_pain' } });
  assert.equal(feedback.state, 'safety_stop');
  assert.equal(feedback.nextAction, 'end_exercise_block');
  assert.match(feedback.message, /should not hurt/i);
});

test('no reliable correction keeps the user on the current lesson without inventing a metric target', () => {
  const feedback = beginnerFeedback({
    decision: { status: 'no_reliable_gap' },
  });
  assert.equal(feedback.state, 'no_actionable_correction');
  // Lens-4 register pin: no "evidence" vocabulary in learner copy.
  assert.match(feedback.message, /could not tell enough from that take/i);
  assert.doesNotMatch(feedback.message, /evidence/i);
  assert.equal(feedback.nextAction, 'continue_current_lesson');
  assert.equal(/hz|f1|f2|f3|femininity score/i.test(feedback.message), false);
});
