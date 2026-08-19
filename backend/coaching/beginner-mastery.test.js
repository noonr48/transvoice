'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  applyCurriculumTransition,
  createBeginnerMasteryState,
  masterySummary,
  normalizeBeginnerMasteryState,
  recordMasteryEvidence,
} = require('./beginner-mastery');

test('new beginners start in calibration with no implied mastery', () => {
  const state = createBeginnerMasteryState();
  assert.equal(state.curriculumPhase, 'calibration');
  assert.equal(state.skills.pitch.steps.elicitation.state, 'not_observed');
  assert.equal(state.skills.resonance.steps.retention.state, 'not_observed');
});

test('valid evidence can mark a skill step without auto-advancing curriculum', () => {
  const start = createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' });
  const next = recordMasteryEvidence(start, {
    skill: 'pitch',
    step: 'elicitation',
    attemptArtifactId: 'attempt-1',
    valid: true,
    result: 'worked_verified',
  });
  assert.equal(next.skills.pitch.steps.elicitation.state, 'verified');
  assert.equal(next.skills.pitch.steps.elicitation.verifiedAttempts, 1);
  assert.equal(next.curriculumPhase, 'pitch_foundation');
});

test('no-feedback verification is recorded separately from guided success', () => {
  let state = createBeginnerMasteryState({ curriculumPhase: 'pitch_repeatability' });
  state = recordMasteryEvidence(state, {
    skill: 'pitch',
    step: 'retention',
    attemptArtifactId: 'attempt-guided',
    valid: true,
    result: 'worked_verified',
    noFeedback: false,
  });
  state = recordMasteryEvidence(state, {
    skill: 'pitch',
    step: 'retention',
    attemptArtifactId: 'attempt-hidden',
    valid: true,
    result: 'worked_verified',
    noFeedback: true,
  });
  assert.equal(state.skills.pitch.steps.retention.verifiedAttempts, 2);
  assert.equal(state.skills.pitch.steps.retention.noFeedbackVerifiedAttempts, 1);
});

test('partial or confounded movement never becomes verified mastery', () => {
  let state = createBeginnerMasteryState({ curriculumPhase: 'resonance_foundation' });
  state = recordMasteryEvidence(state, {
    skill: 'resonance',
    step: 'elicitation',
    valid: true,
    result: 'movement_observed_partial',
  });
  state = recordMasteryEvidence(state, {
    skill: 'resonance',
    step: 'elicitation',
    valid: true,
    result: 'confounded',
  });
  assert.equal(state.skills.resonance.steps.elicitation.state, 'observed');
  assert.equal(state.skills.resonance.steps.elicitation.verifiedAttempts, 0);
});

test('curriculum never advances from attempt counts without explicit policy authorization', () => {
  let state = createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' });
  for (let index = 0; index < 20; index += 1) {
    state = recordMasteryEvidence(state, {
      skill: 'pitch',
      step: 'elicitation',
      valid: true,
      result: 'worked_verified',
    });
  }
  const blocked = applyCurriculumTransition(state, 'pitch_repeatability');
  assert.equal(blocked.changed, false);
  assert.equal(blocked.reason, 'explicit_policy_authorization_required');
  assert.equal(blocked.state.curriculumPhase, 'pitch_foundation');
});

test('authorized transitions must still be sequential', () => {
  const state = createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' });
  const skipped = applyCurriculumTransition(state, 'resonance_foundation', {
    allowed: true,
    reason: 'test',
  });
  assert.equal(skipped.changed, false);
  assert.equal(skipped.reason, 'transition_must_be_sequential');

  const next = applyCurriculumTransition(state, 'pitch_repeatability', {
    allowed: true,
    reason: 'reviewed curriculum policy accepted retained pitch evidence',
    evidenceId: 'policy-evidence-1',
  });
  assert.equal(next.changed, true);
  assert.equal(next.state.curriculumPhase, 'pitch_repeatability');
  assert.equal(next.state.lastTransition.from, 'pitch_foundation');
});

test('normalization fails corrupt counters and unknown states toward safe defaults', () => {
  const state = normalizeBeginnerMasteryState({
    curriculumPhase: 'unknown',
    skills: {
      pitch: {
        steps: {
          elicitation: {
            state: 'super-mastered',
            validAttempts: -9,
            verifiedAttempts: 'nan',
          },
        },
      },
    },
  });
  assert.equal(state.curriculumPhase, 'calibration');
  assert.equal(state.skills.pitch.steps.elicitation.state, 'not_observed');
  assert.equal(state.skills.pitch.steps.elicitation.validAttempts, 0);
  assert.equal(state.skills.pitch.steps.elicitation.verifiedAttempts, 0);
});

test('summary contains mastery states but no attempt identifiers or counts', () => {
  let state = createBeginnerMasteryState({ curriculumPhase: 'pitch_foundation' });
  state = recordMasteryEvidence(state, {
    skill: 'pitch',
    step: 'elicitation',
    attemptArtifactId: 'private-attempt-id',
    valid: true,
    result: 'worked_verified',
  });
  const summary = masterySummary(state);
  const serialized = JSON.stringify(summary);
  assert.equal(summary.skills.pitch.elicitation, 'verified');
  assert.equal(serialized.includes('private-attempt-id'), false);
  assert.equal(serialized.includes('verifiedAttempts'), false);
});
