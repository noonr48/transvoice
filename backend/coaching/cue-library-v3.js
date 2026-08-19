'use strict';

const CUE_LIBRARY_SCHEMA = 'transvoice.coaching_cue.v1';
const COMMON_SAFETY = Object.freeze({ stopOnPain: true, stopOnIncreasingStrain: true, neverForce: true });

function cue(definition) {
  return Object.freeze({ schema: CUE_LIBRARY_SCHEMA, reviewStatus: 'clinical-review-required', safety: COMMON_SAFETY, ...definition });
}

const CUES = Object.freeze([
  cue({
    cueId: 'pitch.register.small-glide-up.v1',
    dimensionPatterns: ['pitch.register'], directions: ['below'], stages: ['sound', 'word', 'phrase', 'reading', 'spontaneous'],
    instruction: 'Start on an easy hum at your normal note, glide only a small step upward, then open into the first word without getting louder.',
    rationale: 'Tests a small register change while loudness and effort stay steady.',
    expectedEffects: [{ dimension: 'pitch.register', direction: 'toward_target' }],
    protectedMetrics: ['safety.effort', 'phonation.pressedness', 'intensity.level'],
    successText: 'The register moved toward target while effort and loudness stayed steady.', transfer: ['word', 'phrase', 'same_sentence'],
  }),
  cue({
    cueId: 'pitch.register.small-glide-down.v1',
    dimensionPatterns: ['pitch.register'], directions: ['above'], stages: ['sound', 'word', 'phrase', 'reading', 'spontaneous'],
    instruction: 'Start on an easy hum at the note you are using, glide only a small step downward, then open into the first word without adding weight or volume.',
    rationale: 'Tests a smaller register setting instead of chasing a large movement.',
    expectedEffects: [{ dimension: 'pitch.register', direction: 'toward_target' }],
    protectedMetrics: ['safety.effort', 'phonation.pressedness', 'intensity.level'],
    successText: 'The register moved toward target without extra effort or heaviness.', transfer: ['word', 'phrase', 'same_sentence'],
  }),
  cue({
    cueId: 'resonance.front-vowel.ee-anchor.v1',
    dimensionPatterns: ['resonance.global_scale', 'resonance.vowel.frontness', 'resonance.frontness_proxy', 'resonance.legacy_proxy'], directions: ['below'], stages: ['sound', 'word', 'phrase'],
    instruction: 'Hold a comfortable “ee” on the same note you are already using. Keep the jaw easy and the lip spread small, then carry that vowel shape into “see me.”',
    rationale: 'Tests resonance movement while pitch is deliberately held steady.',
    expectedEffects: [{ dimension: 'resonance.global_scale', direction: 'toward_target' }, { dimension: 'resonance.frontness_proxy', direction: 'toward_target' }],
    protectedMetrics: ['pitch.register', 'safety.effort', 'phonation.pressedness'],
    protectedRules: { 'pitch.register': { type: 'max_semitone_delta', max: 1.0 } },
    successText: 'Resonance moved toward target while pitch stayed essentially unchanged.', transfer: ['see_me', 'short_phrase', 'same_sentence'],
  }),
  cue({
    cueId: 'resonance.round-vowel.oh-anchor.v1',
    dimensionPatterns: ['resonance.global_scale', 'resonance.vowel.frontness', 'resonance.legacy_proxy'], directions: ['above'], stages: ['sound', 'word', 'phrase'],
    instruction: 'Hold a comfortable “oh” on the same note you are already using. Let the lips round gently and keep the jaw easy, then carry that shape into a short “oh–no” phrase.',
    rationale: 'Tests a rounder resonance direction without forcing a large movement.',
    expectedEffects: [{ dimension: 'resonance.global_scale', direction: 'toward_target' }],
    protectedMetrics: ['pitch.register', 'safety.effort', 'phonation.pressedness'],
    protectedRules: { 'pitch.register': { type: 'max_semitone_delta', max: 1.0 } },
    successText: 'Resonance moved toward target without a pitch or effort jump.', transfer: ['oh_no', 'short_phrase', 'same_sentence'],
  }),
  cue({
    cueId: 'phonation.source-weight.vz-flow.v1',
    dimensionPatterns: ['phonation.source_weight', 'phonation.legacy_weight_proxy'], directions: ['above'], stages: ['sound', 'word', 'phrase'],
    instruction: 'Start with a light, easy “vvv” or “zzz”, then let it flow straight into the vowel at a normal speaking volume. Keep the sound clear rather than airy.',
    rationale: 'Tests a lighter source setting while checking that clarity and effort remain stable.',
    expectedEffects: [{ dimension: 'phonation.source_weight', direction: 'toward_target' }],
    protectedMetrics: ['phonation.breathiness', 'safety.effort', 'intensity.level'],
    successText: 'Source weight moved toward target without becoming airier or more effortful.', transfer: ['vowel', 'word', 'short_phrase'],
  }),
  cue({
    cueId: 'phonation.clarity.m-onset.v1',
    dimensionPatterns: ['phonation.breathiness'], directions: ['above'], stages: ['sound', 'word', 'phrase'],
    instruction: 'Begin with a gentle “mmm”, then open into the vowel without a hard attack. Keep the volume conversational and the sound clear.',
    rationale: 'Tests a clearer onset without increasing effort.',
    expectedEffects: [{ dimension: 'phonation.breathiness', direction: 'toward_target' }],
    protectedMetrics: ['phonation.pressedness', 'safety.effort'],
    successText: 'Clarity improved without a rise in pressedness or effort.', transfer: ['vowel', 'word', 'short_phrase'],
  }),
  cue({
    cueId: 'prosody.contour.hum-then-words.v1',
    dimensionPatterns: ['prosody.pitch_contour', 'prosody.phrase_ending'], directions: ['below', 'above'], stages: ['phrase', 'reading', 'spontaneous'],
    instruction: 'Hum the sentence melody first with no words. Then say the same sentence and copy only that melody; keep your average speaking note where it already is.',
    rationale: 'Separates pitch contour from register.',
    expectedEffects: [{ dimension: 'prosody.pitch_contour', direction: 'toward_target' }],
    protectedMetrics: ['pitch.register', 'safety.effort'],
    protectedRules: { 'pitch.register': { type: 'max_semitone_delta', max: 1.5 } },
    successText: 'The sentence melody moved toward target while average register stayed stable.', transfer: ['same_sentence', 'sentence_variation'],
  }),
  cue({
    cueId: 'articulation.vowel-isolate-transfer.v1',
    dimensionPatterns: ['articulation.vowel.i', 'articulation.vowel.e', 'resonance.vowel.frontness'], directions: ['below', 'above'], stages: ['sound', 'word', 'phrase'],
    instruction: 'Say the target vowel by itself, then put it in one word, then the same short phrase. Make the smallest mouth-shape change that moves the measurement.',
    rationale: 'Keeps a vowel-specific mismatch local instead of changing the whole voice.',
    expectedEffects: [{ dimension: 'articulation.vowel', direction: 'toward_target' }],
    protectedMetrics: ['pitch.register', 'safety.effort'],
    protectedRules: { 'pitch.register': { type: 'max_semitone_delta', max: 1.0 } },
    successText: 'The vowel moved toward its target without dragging the whole register with it.', transfer: ['isolated_vowel', 'word', 'short_phrase'],
  }),
  cue({
    cueId: 'transfer.same-sentence.v1',
    dimensionPatterns: ['transfer.retention'], directions: ['below'], stages: ['word', 'phrase', 'reading', 'spontaneous'],
    instruction: 'Keep the successful sound exactly as it was, but put it back into the full sentence. Do not add a new technique on this attempt.',
    rationale: 'Tests whether an already-elicited feature survives connected speech.',
    expectedEffects: [{ dimension: 'transfer.retention', direction: 'toward_target' }],
    protectedMetrics: ['safety.effort'], successText: 'The feature survived the sentence without extra effort.', transfer: ['same_sentence', 'sentence_variation', 'spontaneous'],
  }),
]);

function dimensionMatches(pattern, dimension) {
  if (pattern === dimension) return true;
  if (pattern.endsWith('.*')) return dimension.startsWith(pattern.slice(0, -1));
  return false;
}
function cuesForObservation(observation, { stage = 'phrase' } = {}) {
  if (!observation || !observation.dimension || !observation.direction) return [];
  return CUES.filter((candidate) => candidate.dimensionPatterns.some((pattern) => dimensionMatches(pattern, observation.dimension))
    && candidate.directions.includes(observation.direction) && candidate.stages.includes(stage));
}
function getCue(cueId) { return CUES.find((candidate) => candidate.cueId === cueId) || null; }

module.exports = { CUES, CUE_LIBRARY_SCHEMA, cuesForObservation, getCue };
