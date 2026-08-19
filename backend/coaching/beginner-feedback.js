'use strict';

const BEGINNER_FEEDBACK_SCHEMA = 'transvoice.beginner_feedback.v1';

const INTERNAL_TERMS = Object.freeze([
  'worked_verified',
  'movement_observed_partial',
  'confounded',
  'moved_wrong_way',
  'no_effect',
  'target_metric',
  'comparisonkey',
  // Plan 14.4 hide-list additions (review cycle 2026-08-17): the default
  // beginner view must not expose raw formants, confidence decimals, gender
  // vocabulary, internal schema/phase/action names, metric identifiers, or
  // target-distance language.
  'formant',
  'f1',
  'f2',
  'f3',
  'confidence',
  'femininity',
  'masculinity',
  'feminine',
  'masculine',
  'female',
  'male',
  'woman',
  'girl',
  'guy',
  'gender',
  'passing',
  'transvoice.',
  'pitch.register',
  'resonance.global_scale',
  'prosody.',
  'end_block',
  'serve_exercise',
  'advance_phase',
  'stop_for_safety',
  'repair_capture',
  'pitch_foundation',
  'pitch_repeatability',
  'resonance_foundation',
  'targetdistance',
  'target distance',
  'target_metricv3',
  'targetmetricv3',
]);

function captureMessage(reasons = []) {
  const values = new Set((Array.isArray(reasons) ? reasons : []).map((item) => String(item || '')));
  if (values.has('sustained_clipping')) {
    return 'That recording was too loud for a reliable measurement. Move a little farther from the microphone and try once more.';
  }
  if (values.has('low_snr')) {
    return 'There was too much background sound for a reliable measurement. Try again somewhere a little quieter.';
  }
  if (values.has('low_voiced_coverage') || values.has('no_voiced_frames')) {
    return 'I did not get enough clear voiced sound to measure that attempt. Repeat the same prompt once more.';
  }
  return 'I could not measure that attempt reliably enough to coach from it. Repeat the same prompt once more.';
}

/**
 * R1-005 — reason-specific safety-stop copy. The generic pain line was the
 * only stop message; severe breathlessness, voice loss, restriction
 * conflicts and the rest each need their own honest, non-diagnostic copy
 * ("voice training should not hurt" is wrong copy for breathlessness).
 * Keyed by the controller's typed safetyReason.
 */
const SAFETY_STOP_MESSAGES = Object.freeze({
  pain: 'Stop this exercise. Voice training should not hurt. Rest your voice and do not continue while pain is present.',
  throat_pain: 'Stop this exercise. Voice training should not hurt. Rest your voice and do not continue while throat pain is present.',
  severe_breathlessness: 'Stop and rest for now. Severe breathlessness during voice practice is a signal to stop — sit comfortably, breathe easily, and do not continue this session.',
  severe_dizziness: 'Stop and rest for now. Severe dizziness during voice practice is a signal to stop. Sit down and do not continue this session.',
  voice_loss: 'Stop for today. Losing your voice during practice means it needs rest, not more exercise. If it does not come back soon, seek professional care.',
  sudden_voice_loss: 'Stop for today. Suddenly losing your voice is a signal to stop and rest. If it does not come back soon, seek professional care.',
  restriction_conflict: 'Stop for now. Practising against a clinician\u2019s guidance or a known restriction is not safe. Follow the guidance you have been given.',
  recent_laryngeal_surgery: 'Stop for now. After recent laryngeal surgery, voice practice needs clinical sign-off before it resumes. Follow your surgical team\u2019s guidance.',
  explicit_stop: 'Okay — stopping here. You can pick this up again whenever you like.',
});

const DEFAULT_SAFETY_STOP_MESSAGE = SAFETY_STOP_MESSAGES.pain;

function beginnerFeedback({
  safety = null,
  measurementUsable = true,
  measurementReasons = [],
  decision = null,
  verification = null,
  controllerAction = null,
} = {}) {
  // R1-005 (GPT-Pro §6): controller actions are NOT acoustic outcomes.
  // verify_attempt only means a pending trial must be resolved — it must
  // never render as movement; advance_phase may rest on older evidence — it
  // must never render as this-attempt verification.
  if (controllerAction === 'verify_attempt') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'checking_result',
      tone: 'neutral',
      message: 'Checking that take against the last one now.',
      nextAction: 'await_result',
      safetyReason: null,
    };
  }
  if (controllerAction === 'advance_phase') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'next_step_ready',
      tone: 'positive',
      message: 'You have made real progress — the next practice step is ready.',
      nextAction: 'begin_next_step',
      safetyReason: null,
    };
  }
  if (safety?.state === 'stop') {
    const safetyReason = typeof safety.reason === 'string' && safety.reason.trim()
      ? safety.reason.trim()
      : null;
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'safety_stop',
      tone: 'stop',
      safetyReason,
      message: SAFETY_STOP_MESSAGES[safetyReason] || DEFAULT_SAFETY_STOP_MESSAGE,
      nextAction: 'end_exercise_block',
    };
  }
  if (safety?.state === 'reset') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'ease_reset',
      tone: 'caution',
      message: 'That is becoming too effortful. Make the next attempt easier, shorter, or return to a comfortable reset sound.',
      nextAction: 'reduce_difficulty',
    };
  }
  if (measurementUsable !== true) {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'could_not_measure',
      tone: 'neutral',
      message: captureMessage(measurementReasons),
      nextAction: 'repeat_same_prompt',
    };
  }

  const result = verification?.result || null;
  if (result === 'worked_verified') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'verified_progress',
      tone: 'positive',
      message: 'That change moved the way you wanted, everything you were keeping steady stayed steady, and it stayed easy. Repeat it once without relying on the display.',
      nextAction: 'no_feedback_repeat',
    };
  }
  if (result === 'movement_observed_partial') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'movement_needs_confirmation',
      tone: 'neutral',
      message: 'The main sound changed in the direction you wanted, but I could not check everything that was meant to stay steady. Repeat the same experiment once more.',
      nextAction: 'repeat_same_experiment',
    };
  }
  if (result === 'confounded') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'change_was_mixed',
      tone: 'neutral',
      message: 'One thing changed, but something you were keeping steady moved too. Try the same exercise again while keeping everything else steady.',
      nextAction: 'repeat_with_protected_focus',
    };
  }
  if (result === 'cost_too_high') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'change_too_effortful',
      tone: 'caution',
      message: 'The sound moved, but it cost more effort than we want. Make the target smaller and keep the next attempt easy.',
      nextAction: 'reduce_target_step',
    };
  }
  if (result === 'moved_wrong_way') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'cue_not_helping_yet',
      tone: 'neutral',
      message: 'That cue moved the sound away from today’s practice direction. Try a different exercise rather than pushing harder.',
      nextAction: 'try_alternate_cue',
    };
  }
  if (result === 'no_effect') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'no_reliable_change',
      tone: 'neutral',
      message: 'Those takes sounded very similar. Try a different exercise instead of pushing for a bigger change.',
      nextAction: 'try_alternate_cue',
    };
  }

  if (decision?.status === 'no_reliable_gap' || decision?.status === 'observe_no_safe_action') {
    return {
      schema: BEGINNER_FEEDBACK_SCHEMA,
      state: 'no_actionable_correction',
      tone: 'neutral',
      message: 'I could not tell enough from that take. Keep the same lesson focus and try again normally.',
      nextAction: 'continue_current_lesson',
    };
  }

  return {
    schema: BEGINNER_FEEDBACK_SCHEMA,
    state: 'ready_for_instruction',
    tone: 'neutral',
    message: null,
    nextAction: 'use_current_approved_cue',
  };
}

function containsInternalJargon(feedback) {
  // Audit LEARNER-VISIBLE PROSE. Accepts a string directly (audited as-is)
  // or an object: then the object's own `schema` self-descriptor is metadata
  // the UI never renders and is excluded — the term list still catches
  // `transvoice.*` schema ids leaking into actual copy.
  if (typeof feedback === 'string') {
    const text = feedback.toLowerCase();
    return INTERNAL_TERMS.some((term) => text.includes(term));
  }
  const { schema: _selfDescriptor, ...prose } = feedback && typeof feedback === 'object' ? feedback : {};
  const text = JSON.stringify(prose || {}).toLowerCase();
  return INTERNAL_TERMS.some((term) => text.includes(term));
}

module.exports = {
  BEGINNER_FEEDBACK_SCHEMA,
  DEFAULT_SAFETY_STOP_MESSAGE,
  INTERNAL_TERMS,
  SAFETY_STOP_MESSAGES,
  beginnerFeedback,
  containsInternalJargon,
};
