'use strict';

const { buildBeginnerSessionCard } = require('./beginner-session-card');
const { beginnerFeedback } = require('./beginner-feedback');

const FOCUS_LABELS = Object.freeze({
  'pitch.register': 'Comfortable pitch',
  'pitch.lower_edge': 'Settled low notes',
  'resonance.global_scale': 'Brighter vowel sound',
  'resonance.frontness_proxy': 'Vowel brightness',
  'prosody.pitch_variability': 'Phrase melody',
  'prosody.phrase_ending': 'Phrase endings',
  'transfer.retention': 'Keeping the new sound',
});

const ACTION_FEEDBACK_STATES = Object.freeze({
  stop_for_safety: 'safety_stop',
  repair_capture: 'could_not_measure',
  reduce_difficulty: 'ease_reset',
  collect_calibration: 'ready_for_instruction',
  teach_awareness: 'ready_for_instruction',
  serve_exercise: 'ready_for_instruction',
  verify_attempt: 'checking_result',
  advance_phase: 'next_step_ready',
  end_block: 'no_actionable_correction',
});

function feedbackForAction(controllerTurn) {
  if (!controllerTurn || typeof controllerTurn !== 'object') return null;
  switch (controllerTurn.action) {
    case 'stop_for_safety':
      return beginnerFeedback({
        safety: { state: 'stop', reason: controllerTurn.safetyReason || null },
      });
    case 'repair_capture':
      return beginnerFeedback({
        measurementUsable: false,
        measurementReasons: Array.isArray(controllerTurn.captureReasons)
          ? controllerTurn.captureReasons
          : [],
      });
    case 'reduce_difficulty':
      return beginnerFeedback({ safety: { state: 'reset' } });
    case 'verify_attempt':
      return beginnerFeedback({ controllerAction: 'verify_attempt' });
    case 'advance_phase':
      return beginnerFeedback({ controllerAction: 'advance_phase' });
    case 'end_block':
      return beginnerFeedback({ decision: { status: 'no_reliable_gap' } });
    default:
      return null;
  }
}

function buildFemV1ShadowCard(controllerTurn) {
  if (!controllerTurn || typeof controllerTurn !== 'object') return null;
  const state = ACTION_FEEDBACK_STATES[controllerTurn.action] || null;
  if (!state) return null;
  const feedback = feedbackForAction(controllerTurn);
  return buildBeginnerSessionCard({
    phase: controllerTurn.phase,
    feedback: feedback || {
      schema: 'transvoice.beginner_feedback.v1',
      state,
      tone: state === 'safety_stop' ? 'stop' : 'neutral',
      message: null,
      nextAction: null,
    },
    focusLabel: controllerTurn.focus
      ? (FOCUS_LABELS[controllerTurn.focus.dimension] || null)
      : null,
    trySteps: [],
    hasApprovedDemo: false,
  });
}

module.exports = {
  ACTION_FEEDBACK_STATES,
  FOCUS_LABELS,
  buildFemV1ShadowCard,
  feedbackForAction,
};
