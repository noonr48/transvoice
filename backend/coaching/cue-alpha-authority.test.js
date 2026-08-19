'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getCue } = require('./cue-library-v3');
const {
  PITCH_ALPHA_DOSE,
  buildPitchAlphaAuthorityDecision,
  resolvePitchAlphaCueForShadow,
} = require('./cue-alpha-authority');

test('qualified pitch cue receives shadow-only nonclinical authority', () => {
  const cue = getCue('pitch.register.small-glide-up.v1');
  const decision = buildPitchAlphaAuthorityDecision(cue, { mode: 'shadow' });
  assert.equal(decision.authorized, true);
  assert.deepEqual(decision.allowedModes, ['shadow']);
  assert.equal(decision.clinicalApprovalClaimed, false);
  assert.equal(decision.specialistCredentialRequired, false);
  assert.deepEqual(decision.dose, PITCH_ALPHA_DOSE);
  assert.match(decision.cueContentDigest, /^[0-9a-f]{64}$/);
});

test('the same qualification never authorizes active mode', () => {
  const cue = getCue('pitch.register.small-glide-up.v1');
  const decision = buildPitchAlphaAuthorityDecision(cue, { mode: 'active' });
  assert.equal(decision.authorized, false);
  assert.deepEqual(decision.allowedModes, ['shadow']);
});

test('shadow resolver is exact-scope and cannot authorize other dimensions or directions', () => {
  assert.equal(resolvePitchAlphaCueForShadow('resonance.f2', 'below', 'phrase'), null);
  assert.equal(resolvePitchAlphaCueForShadow('pitch.register', 'above', 'phrase'), null);
});

test('shadow resolver returns authority metadata but never mutates the source cue', () => {
  const source = getCue('pitch.register.small-glide-up.v1');
  const resolved = resolvePitchAlphaCueForShadow('pitch.register', 'below', 'phrase');
  assert.ok(resolved);
  assert.equal(resolved.cueId, source.cueId);
  assert.equal(resolved.authorityDecision.authorized, true);
  assert.equal(resolved.reviewStatus, 'approved_internal');
  assert.equal(source.reviewStatus, 'clinical-review-required');
});
