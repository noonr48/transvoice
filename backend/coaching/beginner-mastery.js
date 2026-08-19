'use strict';

const BEGINNER_MASTERY_SCHEMA = 'transvoice.beginner_mastery.v1';

const SKILLS = Object.freeze([
  'pitch',
  'resonance',
  'integration',
  'prosody',
  'transfer',
]);

const MASTERY_STEPS = Object.freeze([
  'awareness',
  'elicitation',
  'repeatability',
  'stability',
  'integration',
  'transfer',
  'retention',
]);

const STEP_STATES = Object.freeze([
  'not_observed',
  'observed',
  'verified',
]);

const PHASE_ORDER = Object.freeze([
  'calibration',
  'awareness',
  'pitch_foundation',
  'pitch_repeatability',
  'resonance_foundation',
  'integration',
  'transfer',
  // R1-004 (GPT-Pro finding 2.4): the first release ends at short-phrase
  // transfer; prosody is a LATER extension. Prosody previously sat between
  // integration and transfer, making transfer unreachable without traversing
  // prosody — contradicting the master plan's first-release boundary.
  'prosody',
]);

function textOrNull(value, maxLength = 160) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function finiteNonNegativeInt(value, cap = 100000) {
  if (value == null || value === '') return 0;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return 0;
  return Math.min(cap, Math.floor(number));
}

function emptyStepState() {
  return {
    state: 'not_observed',
    validAttempts: 0,
    verifiedAttempts: 0,
    noFeedbackVerifiedAttempts: 0,
    lastAttemptArtifactId: null,
  };
}

function emptySkillState() {
  const steps = {};
  for (const step of MASTERY_STEPS) steps[step] = emptyStepState();
  return { steps };
}

function createBeginnerMasteryState({ curriculumPhase = 'calibration' } = {}) {
  const skills = {};
  for (const skill of SKILLS) skills[skill] = emptySkillState();
  return {
    schema: BEGINNER_MASTERY_SCHEMA,
    curriculumPhase: PHASE_ORDER.includes(curriculumPhase) ? curriculumPhase : 'calibration',
    skills,
    lastTransition: null,
  };
}

function normalizeStepState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const state = STEP_STATES.includes(source.state) ? source.state : 'not_observed';
  return {
    state,
    validAttempts: finiteNonNegativeInt(source.validAttempts),
    verifiedAttempts: finiteNonNegativeInt(source.verifiedAttempts),
    noFeedbackVerifiedAttempts: finiteNonNegativeInt(source.noFeedbackVerifiedAttempts),
    lastAttemptArtifactId: textOrNull(source.lastAttemptArtifactId, 200),
  };
}

function normalizeBeginnerMasteryState(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const normalized = createBeginnerMasteryState({ curriculumPhase: source.curriculumPhase });
  for (const skill of SKILLS) {
    for (const step of MASTERY_STEPS) {
      normalized.skills[skill].steps[step] = normalizeStepState(source.skills?.[skill]?.steps?.[step]);
    }
  }
  const transition = source.lastTransition && typeof source.lastTransition === 'object'
    ? source.lastTransition
    : null;
  normalized.lastTransition = transition ? {
    from: PHASE_ORDER.includes(transition.from) ? transition.from : null,
    to: PHASE_ORDER.includes(transition.to) ? transition.to : null,
    reason: textOrNull(transition.reason, 240),
    evidenceId: textOrNull(transition.evidenceId, 200),
  } : null;
  return normalized;
}

function skillAndStepValid(skill, step) {
  return SKILLS.includes(skill) && MASTERY_STEPS.includes(step);
}

/**
 * Record evidence without inventing a mastery threshold. This function never
 * changes curriculumPhase. Phase promotion requires a separate explicit policy
 * decision so detector tuning cannot silently become pedagogy.
 */
function recordMasteryEvidence(state, {
  skill,
  step,
  attemptArtifactId = null,
  valid = false,
  result = null,
  noFeedback = false,
} = {}) {
  const normalized = normalizeBeginnerMasteryState(state);
  if (!skillAndStepValid(skill, step) || valid !== true) return normalized;

  const current = normalized.skills[skill].steps[step];
  current.validAttempts += 1;
  current.lastAttemptArtifactId = textOrNull(attemptArtifactId, 200);
  if (current.state === 'not_observed') current.state = 'observed';

  if (result === 'worked_verified') {
    current.verifiedAttempts += 1;
    current.state = 'verified';
    if (noFeedback === true) current.noFeedbackVerifiedAttempts += 1;
  }
  return normalized;
}

function phaseIndex(phase) {
  return PHASE_ORDER.indexOf(phase);
}

/**
 * A phase transition is accepted only when an external, named curriculum
 * policy explicitly authorizes it. No attempt counts or acoustic values here
 * are treated as universal advancement thresholds.
 */
function applyCurriculumTransition(state, nextPhase, {
  allowed = false,
  reason = null,
  evidenceId = null,
} = {}) {
  const normalized = normalizeBeginnerMasteryState(state);
  if (!PHASE_ORDER.includes(nextPhase)) {
    return { state: normalized, changed: false, reason: 'unknown_phase' };
  }
  if (allowed !== true) {
    return { state: normalized, changed: false, reason: 'explicit_policy_authorization_required' };
  }
  const currentIndex = phaseIndex(normalized.curriculumPhase);
  const nextIndex = phaseIndex(nextPhase);
  if (nextIndex !== currentIndex + 1) {
    return { state: normalized, changed: false, reason: 'transition_must_be_sequential' };
  }

  const from = normalized.curriculumPhase;
  normalized.curriculumPhase = nextPhase;
  normalized.lastTransition = {
    from,
    to: nextPhase,
    reason: textOrNull(reason, 240),
    evidenceId: textOrNull(evidenceId, 200),
  };
  return { state: normalized, changed: true, reason: null };
}

function masterySummary(state) {
  const normalized = normalizeBeginnerMasteryState(state);
  const skills = {};
  for (const skill of SKILLS) {
    skills[skill] = {};
    for (const step of MASTERY_STEPS) {
      skills[skill][step] = normalized.skills[skill].steps[step].state;
    }
  }
  return {
    schema: BEGINNER_MASTERY_SCHEMA,
    curriculumPhase: normalized.curriculumPhase,
    skills,
  };
}

module.exports = {
  BEGINNER_MASTERY_SCHEMA,
  MASTERY_STEPS,
  PHASE_ORDER,
  SKILLS,
  STEP_STATES,
  applyCurriculumTransition,
  createBeginnerMasteryState,
  masterySummary,
  normalizeBeginnerMasteryState,
  recordMasteryEvidence,
};
