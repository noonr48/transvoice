'use strict';

const { getCue } = require('./cue-library-v3');
const { qualifyPitchAlphaCue } = require('./cue-alpha-qualification');

const CUE_ALPHA_AUTHORITY_SCHEMA = 'transvoice.cue_alpha_authority.v1';
const PITCH_ALPHA_CUE_ID = 'pitch.register.small-glide-up.v1';
const PITCH_ALPHA_DOSE = Object.freeze({
  maxRepetitionsPerSet: 6,
  maxSetsPerSession: 2,
  restSecondsBetweenSets: 30,
  stopOnIncreasingEffort: true,
});

function buildPitchAlphaAuthorityDecision(cue, { mode = 'shadow' } = {}) {
  const qualification = qualifyPitchAlphaCue(cue);
  const allowedModes = qualification.qualified ? ['shadow'] : [];
  const authorized = qualification.qualified && allowedModes.includes(mode);
  return Object.freeze({
    schema: CUE_ALPHA_AUTHORITY_SCHEMA,
    track: 'pitch_nonclinical_alpha',
    cueId: qualification.cueId,
    cueContentDigest: qualification.contentDigest,
    qualificationPolicyVersion: qualification.policyVersion,
    qualificationStatus: qualification.status,
    authorized,
    requestedMode: mode,
    allowedModes: Object.freeze(allowedModes),
    reasons: qualification.reasons,
    clinicalApprovalClaimed: false,
    specialistCredentialRequired: false,
    dose: PITCH_ALPHA_DOSE,
  });
}

function resolvePitchAlphaCueForShadow(dimension, direction, stage) {
  if (dimension !== 'pitch.register' || direction !== 'below') return null;
  const cue = getCue(PITCH_ALPHA_CUE_ID);
  if (!cue || typeof cue !== 'object') return null;
  if (Array.isArray(cue.stages) && !cue.stages.includes(stage)) return null;

  const authorityDecision = buildPitchAlphaAuthorityDecision(cue, { mode: 'shadow' });
  if (!authorityDecision.authorized) return null;

  // The v1 controller still checks the historical generic reviewStatus field.
  // This compatibility value is synthesized only inside the hard-shadow
  // adapter; the source cue remains non-clinical and unchanged. Active mode has
  // no default resolver and therefore receives no authority from this shim.
  return Object.freeze({
    ...cue,
    reviewStatus: 'approved_internal',
    authorityDecision,
  });
}

module.exports = {
  CUE_ALPHA_AUTHORITY_SCHEMA,
  PITCH_ALPHA_CUE_ID,
  PITCH_ALPHA_DOSE,
  buildPitchAlphaAuthorityDecision,
  resolvePitchAlphaCueForShadow,
};
