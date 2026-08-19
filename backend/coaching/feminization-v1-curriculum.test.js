'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LESSONS,
  beginnerLessonCard,
  lessonForPhase,
  validateLessonProbeRegistry,
} = require('./feminization-v1-curriculum');

test('every curriculum lesson references only registered controlled probes', () => {
  for (const lesson of Object.values(LESSONS)) {
    const verdict = validateLessonProbeRegistry(lesson);
    assert.equal(verdict.valid, true, `${lesson.phase}: ${verdict.unknownProbeIds.join(', ')}`);
  }
});

test('default beginner card exposes one focus but hides raw acoustic dimensions', () => {
  const card = beginnerLessonCard('resonance_foundation');
  assert.equal(card.oneFocus, 'resonance');
  assert.equal(card.technicalDetailsAvailable, true);
  const serialized = JSON.stringify(card);
  assert.equal(serialized.includes('resonance.global_scale'), false);
  assert.equal(serialized.includes('formant'), false);
  assert.equal(serialized.includes('F2'), false);
});

test('pitch foundation explicitly avoids universal-number framing', () => {
  const lesson = lessonForPhase('pitch_foundation');
  assert.match(lesson.beginnerGoal, /do not chase a universal number/i);
  assert.deepEqual(lesson.primaryDimensions, ['pitch.register']);
});

test('resonance foundation keeps pitch and effort protected', () => {
  const lesson = lessonForPhase('resonance_foundation');
  assert.ok(lesson.primaryDimensions.includes('resonance.global_scale'));
  assert.ok(lesson.protectedDimensions.includes('pitch.register'));
  assert.ok(lesson.protectedDimensions.includes('safety.effort'));
  assert.equal(lesson.feedbackMode, 'controlled_probe_post_take');
});

test('prosody is later than integration and transfer uses delayed retention feedback', () => {
  assert.equal(LESSONS.integration.skill, 'integration');
  assert.equal(LESSONS.prosody.skill, 'prosody');
  assert.equal(LESSONS.transfer.feedbackMode, 'delayed_summary_and_retention');
  assert.ok(LESSONS.transfer.advancementEvidence.includes('later_session_retention'));
});

test('quality/weight metrics are absent from beginner lesson primary dimensions', () => {
  const dimensions = Object.values(LESSONS).flatMap((lesson) => lesson.primaryDimensions);
  assert.equal(dimensions.some((dimension) => dimension.startsWith('phonation.')), false);
  assert.equal(dimensions.some((dimension) => dimension.includes('weight')), false);
  assert.equal(dimensions.some((dimension) => dimension.includes('breathiness')), false);
});
