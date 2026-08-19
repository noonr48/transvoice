'use strict';

const CUE_ALPHA_QUALIFICATION_SCHEMA = 'transvoice.cue_alpha_qualification.v1';
const ALLOWED_CUE_IDS = Object.freeze(['pitch.register.small-glide-up.v1']);
const REQUIRED_PROTECTED_METRICS = Object.freeze(['safety.effort','phonation.pressedness','intensity.level']);
const FORBIDDEN_TEXT = Object.freeze([/\bforce\b/i,/\bsqueeze\b/i,/\bpush(?:ing)?\b/i,/\bstrain\b.*\bthrough\b/i,/\bhold\s+(?:the\s+)?larynx\b/i,/\braise\s+(?:the\s+)?larynx\b/i,/\blower\s+(?:the\s+)?larynx\b/i,/\bwhisper\b/i]);

function qualifyPitchAlphaCue(cue) {
  const reasons = [];
  if (!cue || typeof cue !== 'object' || Array.isArray(cue)) reasons.push('cue_required');
  else {
    if (!ALLOWED_CUE_IDS.includes(cue.cueId)) reasons.push('cue_not_in_alpha_allowlist');
    if (!Array.isArray(cue.dimensionPatterns) || !cue.dimensionPatterns.includes('pitch.register')) reasons.push('pitch_register_scope_required');
    if (!Array.isArray(cue.directions) || !cue.directions.includes('below')) reasons.push('upward_correction_direction_required');
    if (cue?.safety?.stopOnPain !== true) reasons.push('pain_stop_required');
    if (cue?.safety?.stopOnIncreasingStrain !== true) reasons.push('strain_stop_required');
    if (cue?.safety?.neverForce !== true) reasons.push('never_force_guard_required');
    for (const metric of REQUIRED_PROTECTED_METRICS) if (!Array.isArray(cue.protectedMetrics) || !cue.protectedMetrics.includes(metric)) reasons.push(`protected_metric_required:${metric}`);
    const text = [cue.instruction,cue.rationale,cue.successText].filter((v)=>typeof v === 'string').join(' ');
    for (const pattern of FORBIDDEN_TEXT) if (pattern.test(text)) reasons.push(`forbidden_wording:${pattern.source}`);
    if (!/\bsmall\b/i.test(cue.instruction || '')) reasons.push('bounded_step_language_required');
    if (!/\beasy\b|\bcomfortable\b/i.test(cue.instruction || '')) reasons.push('comfort_language_required');
  }
  const qualified = reasons.length === 0;
  return Object.freeze({schema:CUE_ALPHA_QUALIFICATION_SCHEMA,cueId:typeof cue?.cueId === 'string'?cue.cueId:null,track:'pitch_nonclinical_alpha',qualified,status:qualified?'alpha_qualified_nonclinical':'research_only',reasons:Object.freeze(reasons),claimsClinicalApproval:false,requiresSpecialistCredential:false,requiresDemonstrationRecording:false});
}

module.exports = { ALLOWED_CUE_IDS, CUE_ALPHA_QUALIFICATION_SCHEMA, FORBIDDEN_TEXT, REQUIRED_PROTECTED_METRICS, qualifyPitchAlphaCue };
