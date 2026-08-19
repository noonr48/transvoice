'use strict';

// STATUS (runbook-§10 checkpoint, minor M4b): UNWIRED. Nothing imports this
// module except its own test — the controller resolves curriculum phase from
// masteryState, not from these LESSONS. Scheduled for wiring-or-removal at
// P5 (motor split) review; do not treat as runtime-active. See
// FEMINIZATION_V1_RUNTIME_AUDIT.md and FEMINIZATION_V1_STATUS.md.

const { getControlledProbe } = require('./controlled-probes');
const { normalizeCurriculumPhase } = require('./feminization-v1-policy');

const FEMINIZATION_V1_CURRICULUM_SCHEMA = 'transvoice.feminization_v1_curriculum.v1';

function freezeLesson(value) {
  return Object.freeze({
    ...value,
    probeIds: Object.freeze([...(value.probeIds || [])]),
    primaryDimensions: Object.freeze([...(value.primaryDimensions || [])]),
    protectedDimensions: Object.freeze([...(value.protectedDimensions || [])]),
    advancementEvidence: Object.freeze([...(value.advancementEvidence || [])]),
  });
}

const LESSONS = Object.freeze({
  calibration: freezeLesson({
    phase: 'calibration',
    title: 'Set up a comfortable baseline',
    beginnerGoal: 'Give the app a few easy samples so it can learn what it can measure reliably today.',
    skill: 'baseline',
    probeIds: ['vowel.ee.steady.v1', 'vowel.ah.steady.v1', 'vowel.oo.steady.v1', 'pitch.comfortable-glide.v1'],
    primaryDimensions: [],
    protectedDimensions: ['safety.effort'],
    feedbackMode: 'capture_only',
    advancementEvidence: ['valid_baseline_samples', 'safety_normal'],
  }),
  awareness: freezeLesson({
    phase: 'awareness',
    title: 'Hear the parts of the voice separately',
    beginnerGoal: 'Learn the difference between pitch, resonance, and phrase melody before trying to control all of them.',
    skill: 'awareness',
    probeIds: [],
    primaryDimensions: [],
    protectedDimensions: ['safety.effort'],
    feedbackMode: 'listen_and_compare',
    advancementEvidence: ['explicit_awareness_check'],
  }),
  pitch_foundation: freezeLesson({
    phase: 'pitch_foundation',
    title: 'Find an easy higher pitch centre',
    beginnerGoal: 'Find a slightly higher speaking setup that feels easy enough to repeat; do not chase a universal number.',
    skill: 'pitch',
    probeIds: ['pitch.comfortable-glide.v1', 'transfer.mmm-ee.v1'],
    primaryDimensions: ['pitch.register'],
    protectedDimensions: ['safety.effort'],
    feedbackMode: 'guided_acquisition',
    advancementEvidence: ['worked_verified', 'effort_stable', 'no_feedback_check'],
  }),
  pitch_repeatability: freezeLesson({
    phase: 'pitch_repeatability',
    title: 'Make the pitch repeatable',
    beginnerGoal: 'Repeat the comfortable pitch region and reduce frequent drops back toward the old habit.',
    skill: 'pitch',
    probeIds: ['transfer.mmm-ee.v1'],
    primaryDimensions: ['pitch.register', 'pitch.lower_edge'],
    protectedDimensions: ['safety.effort'],
    feedbackMode: 'fading_feedback',
    advancementEvidence: ['repeatable_verified', 'short_phrase_stability', 'delayed_no_feedback_check'],
  }),
  resonance_foundation: freezeLesson({
    phase: 'resonance_foundation',
    title: 'Explore brighter resonance without moving the note',
    beginnerGoal: 'Change a controlled vowel while keeping pitch and effort steady so the app can tell which feature actually moved.',
    skill: 'resonance',
    probeIds: ['vowel.ee.steady.v1', 'vowel.ah.steady.v1', 'vowel.oo.steady.v1'],
    primaryDimensions: ['resonance.global_scale', 'resonance.frontness_proxy'],
    protectedDimensions: ['pitch.register', 'safety.effort'],
    feedbackMode: 'controlled_probe_post_take',
    advancementEvidence: ['verified_controlled_context', 'worked_verified', 'cross_vowel_transfer', 'no_feedback_check'],
  }),
  integration: freezeLesson({
    phase: 'integration',
    title: 'Combine pitch and resonance',
    beginnerGoal: 'Keep both trained features available together while changing only one thing at a time when something slips.',
    skill: 'integration',
    probeIds: ['transfer.mmm-ee.v1', 'vowel.ee.steady.v1'],
    primaryDimensions: ['pitch.register', 'pitch.lower_edge', 'resonance.global_scale', 'resonance.frontness_proxy'],
    protectedDimensions: ['safety.effort'],
    feedbackMode: 'one_focus_post_take',
    advancementEvidence: ['both_dimensions_repeatable', 'short_phrase_transfer', 'no_feedback_check'],
  }),
  prosody: freezeLesson({
    phase: 'prosody',
    title: 'Add natural phrase melody and emphasis',
    beginnerGoal: 'Practise controllable phrase movement without turning every sentence into the same exaggerated contour.',
    skill: 'prosody',
    probeIds: ['prosody.statement.v1', 'prosody.question.v1', 'prosody.contrastive-emphasis.v1'],
    primaryDimensions: ['prosody.pitch_variability', 'prosody.phrase_ending'],
    protectedDimensions: ['pitch.register', 'safety.effort'],
    feedbackMode: 'post_take_summary',
    advancementEvidence: ['pattern_control', 'core_voice_retained', 'no_feedback_check'],
  }),
  transfer: freezeLesson({
    phase: 'transfer',
    title: 'Carry the voice into connected speech',
    beginnerGoal: 'Use the trained voice in longer speech, then rely less on the display and more on your own internal cue.',
    skill: 'transfer',
    probeIds: ['phrase.matched-reference.v1'],
    primaryDimensions: ['pitch.register', 'pitch.lower_edge', 'prosody.pitch_variability', 'prosody.phrase_ending'],
    protectedDimensions: ['safety.effort'],
    feedbackMode: 'delayed_summary_and_retention',
    advancementEvidence: ['connected_speech_retention', 'later_session_retention', 'real_world_self_report'],
  }),
});

function lessonForPhase(phase) {
  const resolved = normalizeCurriculumPhase(phase);
  return LESSONS[resolved];
}

function validateLessonProbeRegistry(lesson) {
  const unknownProbeIds = lesson.probeIds.filter((probeId) => !getControlledProbe(probeId));
  return {
    valid: unknownProbeIds.length === 0,
    unknownProbeIds,
  };
}

function beginnerLessonCard(phase) {
  const lesson = lessonForPhase(phase);
  return {
    schema: FEMINIZATION_V1_CURRICULUM_SCHEMA,
    phase: lesson.phase,
    title: lesson.title,
    goal: lesson.beginnerGoal,
    oneFocus: lesson.skill,
    feedbackMode: lesson.feedbackMode,
    probeIds: [...lesson.probeIds],
    // Technical metric names are intentionally omitted from the default card.
    technicalDetailsAvailable: true,
  };
}

module.exports = {
  FEMINIZATION_V1_CURRICULUM_SCHEMA,
  LESSONS,
  beginnerLessonCard,
  lessonForPhase,
  validateLessonProbeRegistry,
};
