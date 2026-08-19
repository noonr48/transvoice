'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BEGINNER_SESSION_CARD_SCHEMA,
  buildBeginnerSessionCard,
} = require('./beginner-session-card');
const { containsInternalJargon } = require('./beginner-feedback');

function baseOverrides(overrides = {}) {
  return {
    phase: 'pitch_foundation',
    feedback: {
      schema: 'transvoice.beginner_feedback.v1',
      state: 'ready_for_instruction',
      tone: 'neutral',
      message: null,
      nextAction: 'use_current_approved_cue',
    },
    focusLabel: 'Comfortable pitch',
    trySteps: [
      'Start with an easy "mm."',
      'Glide a small step upward.',
      'Open into "mee" without getting louder.',
    ],
    hasApprovedDemo: true,
    ...overrides,
  };
}

test('the card speaks the five-part beginner shape with ONE focus', () => {
  const card = buildBeginnerSessionCard(baseOverrides());
  assert.equal(card.schema, BEGINNER_SESSION_CARD_SCHEMA);
  assert.equal(card.focus.label, 'Comfortable pitch');
  assert.deepEqual(card.try.steps.slice(0, 2), ['Start with an easy "mm."', 'Glide a small step upward.']);
  assert.ok(card.result.message.length > 0);
  assert.ok(card.next.message.length > 0);
  assert.equal(Array.isArray(card.focus.otherFocusMentioned), true);
  assert.equal(card.focus.otherFocusMentioned.length, 0);
});

test('no internal vocabulary leaks into the default card view', () => {
  const states = [
    ['could_not_measure', 'There was too much background sound for a reliable measurement. Try again somewhere a little quieter.'],
    ['no_reliable_change', 'Those attempts were acoustically very similar. Try a different approved cue instead of forcing a bigger change.'],
    ['movement_needs_confirmation', 'The main sound changed in the intended direction. Repeat the same experiment once more.'],
    ['verified_progress', 'That change moved in the intended direction while the protected parts stayed steady. Repeat it once without relying on the display.'],
    ['safety_stop', 'Stop this exercise. Voice training should not hurt. Do not continue this exercise while pain or severe strain is present.'],
  ];
  for (const [state, message] of states) {
    const card = buildBeginnerSessionCard(baseOverrides({
      feedback: { schema: 'transvoice.beginner_feedback.v1', state, tone: 'neutral', message, nextAction: 'x' },
    }));
    assert.equal(card.result.state, state);
    assert.equal(containsInternalJargon(card), false, state);
    assert.equal(containsInternalJargon(card.result.message), false, state);
  }
});

test('technical detail is opt-in and absent from the default view', () => {
  const card = buildBeginnerSessionCard(baseOverrides());
  assert.equal(card.technicalDetails, null);
  const withDetail = buildBeginnerSessionCard(baseOverrides(), { includeTechnicalDetails: true });
  assert.ok(withDetail.technicalDetails);
  assert.equal(withDetail.technicalDetails.phase, 'pitch_foundation');
  assert.equal(containsInternalJargon(card), false);
});

test('safety stop dominates: the whole card becomes the stop card', () => {
  const card = buildBeginnerSessionCard(baseOverrides({
    feedback: {
      schema: 'transvoice.beginner_feedback.v1',
      state: 'safety_stop',
      tone: 'stop',
      message: 'Stop this exercise. Voice training should not hurt. Do not continue this exercise while pain or severe strain is present.',
      nextAction: 'end_exercise_block',
    },
  }));
  assert.equal(card.result.state, 'safety_stop');
  assert.equal(card.focus.label, null);
  assert.deepEqual(card.try.steps, []);
  assert.ok(/hurt/.test(card.result.message));
});

test('capture failure is neutral and never blames the learner', () => {
  const card = buildBeginnerSessionCard(baseOverrides({
    feedback: {
      schema: 'transvoice.beginner_feedback.v1',
      state: 'could_not_measure',
      tone: 'neutral',
      message: 'That recording was too loud for a reliable measurement. Move a little farther from the microphone and try once more.',
      nextAction: 'repeat_same_prompt',
    },
  }));
  assert.equal(card.result.state, 'could_not_measure');
  assert.ok(/microphone|quieter|once more/.test(card.result.message));
  assert.ok(!/fail|wrong|bad /.test(card.result.message));
});

test('unknown feedback state fails closed to a neutral continue message', () => {
  const card = buildBeginnerSessionCard(baseOverrides({
    feedback: { schema: 'transvoice.beginner_feedback.v1', state: 'mystery_state', tone: 'neutral', message: null, nextAction: 'x' },
  }));
  assert.equal(card.result.state, 'no_reliable_change');
  assert.ok(card.result.message.length > 0);
});

test('calibration phase card asks for samples, never a correction', () => {
  const card = buildBeginnerSessionCard(baseOverrides({
    phase: 'calibration',
    focusLabel: null,
    trySteps: ['Say a few easy sentences', 'Hold a comfortable "ee"', 'Glide gently up and down'],
  }));
  assert.equal(card.focus.label, null);
  assert.ok(/listen|sample|easy|comfortable/i.test(card.result.message));
  assert.equal(containsInternalJargon(card), false);
});

test('adversarial smuggle: jargon in focusLabel is dropped, not shipped', () => {
  const card = buildBeginnerSessionCard(baseOverrides({ focusLabel: 'pitch.register' }));
  assert.equal(card.focus.label, null);
  const card2 = buildBeginnerSessionCard(baseOverrides({ focusLabel: 'Femininity score' }));
  assert.equal(card2.focus.label, null);
  // F2 gap (cycle-2 review): raw formant labels are hidden vocabulary too.
  const card3 = buildBeginnerSessionCard(baseOverrides({ focusLabel: 'F2 resonance' }));
  assert.equal(card3.focus.label, null);
});

test('adversarial smuggle: jargon in try steps is dropped step-by-step', () => {
  const card = buildBeginnerSessionCard(baseOverrides({
    trySteps: [
      'Start with an easy "mm."',
      'Keep F1 steady at 0.87 confidence.',
      'Keep F1 steady.',
      'Open into "mee" without getting louder.',
    ],
  }));
  // Both F1 steps die: the first via 'confidence', the second via the raw
  // 'f1' token itself (no confidence word to save the audit).
  assert.deepEqual(card.try.steps, [
    'Start with an easy "mm."',
    'Open into "mee" without getting louder.',
  ]);
});

test('adversarial smuggle: whole-view backstop neutralizes anything left', () => {
  // A feedback message that smuggles an internal action name is replaced by
  // the neutral fallback via the default-view backstop.
  const card = buildBeginnerSessionCard(baseOverrides({
    feedback: {
      schema: 'transvoice.beginner_feedback.v1',
      state: 'no_reliable_change',
      tone: 'neutral',
      message: 'The engine chose end_block for your take.',
      nextAction: 'x',
    },
  }));
  assert.ok(!/end_block/.test(card.result.message));
});

test('UX lens F1: fading modes carry a WHY message so withdrawal never reads as the app going cold', () => {
  for (const mode of ['hidden_guide', 'new_prompt', 'retention_check']) {
    const card = buildBeginnerSessionCard(baseOverrides({ feedbackMode: mode }));
    assert.equal(card.feedback.mode, mode);
    assert.ok(card.feedback.whyMessage.length > 20, mode);
    assert.equal(containsInternalJargon(card.feedback.whyMessage), false, mode);
  }
  // Absent mode -> null field (never an invented explanation).
  const plain = buildBeginnerSessionCard(baseOverrides());
  assert.equal(plain.feedback, null);
  // Unknown mode string -> null (fail closed, no guessed copy).
  const garbage = buildBeginnerSessionCard(baseOverrides({ feedbackMode: 'vibes' }));
  assert.equal(garbage.feedback, null);
});

test('UX lens F2: RECORD is an explicit card affordance — and never offered on a safety stop', () => {
  const card = buildBeginnerSessionCard(baseOverrides());
  assert.equal(card.record.affordance, 'button');
  assert.equal(card.record.label, 'Record');
  const stop = buildBeginnerSessionCard(baseOverrides({
    feedback: {
      schema: 'transvoice.beginner_feedback.v1',
      state: 'safety_stop',
      tone: 'stop',
      message: 'Stop this exercise. Voice training should not hurt. Rest your voice and do not continue while pain is present.',
      nextAction: 'end_exercise_block',
    },
  }));
  assert.equal(stop.record, null); // rest means rest — no record-one-more
});

test('UX lens F3: gender-vocabulary prose is dropped by the audit', () => {
  const card = buildBeginnerSessionCard(baseOverrides({
    focusLabel: '60% feminine voice',
  }));
  assert.equal(card.focus.label, null);
  const card2 = buildBeginnerSessionCard(baseOverrides({
    trySteps: ['Sound more female on this take.'],
  }));
  assert.deepEqual(card2.try.steps, []);
});
