'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCue } = require('./cue-library-v3');
const { qualifyPitchAlphaCue } = require('./cue-alpha-qualification');

function clone(value) { return JSON.parse(JSON.stringify(value)); }

test('primary pitch cue qualifies without inventing clinical approval', () => {
  const result = qualifyPitchAlphaCue(getCue('pitch.register.small-glide-up.v1'));
  assert.equal(result.qualified, true);
  assert.equal(result.status, 'alpha_qualified_nonclinical');
  assert.equal(result.claimsClinicalApproval, false);
  assert.equal(result.requiresSpecialistCredential, false);
  assert.equal(result.requiresDemonstrationRecording, false);
});

test('non-pitch cues cannot enter the pitch alpha by status spoofing', () => {
  const result = qualifyPitchAlphaCue(getCue('resonance.front-vowel.ee-anchor.v1'));
  assert.equal(result.qualified, false);
  assert.ok(result.reasons.includes('cue_not_in_alpha_allowlist'));
});

test('missing universal safety guards fails closed', () => {
  const cue = clone(getCue('pitch.register.small-glide-up.v1'));
  cue.safety.stopOnPain = false;
  const result = qualifyPitchAlphaCue(cue);
  assert.equal(result.qualified, false);
  assert.ok(result.reasons.includes('pain_stop_required'));
});

test('missing protected evidence fails closed', () => {
  const cue = clone(getCue('pitch.register.small-glide-up.v1'));
  cue.protectedMetrics = ['safety.effort'];
  const result = qualifyPitchAlphaCue(cue);
  assert.equal(result.qualified, false);
  assert.ok(result.reasons.some((reason) => reason.startsWith('protected_metric_required:')));
});

test('forcing or anatomical manipulation language cannot qualify', () => {
  const cue = clone(getCue('pitch.register.small-glide-up.v1'));
  cue.instruction = 'Raise the larynx and force the note upward.';
  const result = qualifyPitchAlphaCue(cue);
  assert.equal(result.qualified, false);
  assert.ok(result.reasons.some((reason) => reason.startsWith('forbidden_wording:')));
});

test('an unbounded step cannot qualify', () => {
  const cue = clone(getCue('pitch.register.small-glide-up.v1'));
  cue.instruction = 'Start on an easy hum and glide upward into the first word.';
  const result = qualifyPitchAlphaCue(cue);
  assert.equal(result.qualified, false);
  assert.ok(result.reasons.includes('bounded_step_language_required'));
});
