'use strict';

const CONTROLLED_PROBE_SCHEMA = 'transvoice.controlled_probe.v1';
const PROBE_CONTEXT_SCHEMA = 'transvoice.probe_context.v1';
const TARGET_EVIDENCE_KINDS = new Set([
  'same_probe_clipwide',
]);

function freezeProbe(value) {
  return Object.freeze({
    ...value,
    supports: Object.freeze({ ...(value.supports || {}) }),
    tags: Object.freeze([...(value.tags || [])]),
  });
}

const PROBES = Object.freeze({
  'vowel.ee.steady.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'vowel.ee.steady.v1',
    kind: 'sustained_vowel',
    stage: 'sound',
    canonicalVowel: 'i',
    displayToken: 'ee',
    prompt: 'Hold a comfortable “ee” on one steady, easy note.',
    supports: { formants: true, pitchSteadiness: true, voiceQuality: true },
    tags: ['controlled-probe', 'vowel', 'ee'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'vowel.eh.steady.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'vowel.eh.steady.v1',
    kind: 'sustained_vowel',
    stage: 'sound',
    canonicalVowel: 'e_or_epsilon',
    displayToken: 'eh',
    prompt: 'Hold a comfortable “eh” on one steady, easy note.',
    supports: { formants: true, pitchSteadiness: true, voiceQuality: true },
    tags: ['controlled-probe', 'vowel', 'eh'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'vowel.ah.steady.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'vowel.ah.steady.v1',
    kind: 'sustained_vowel',
    stage: 'sound',
    canonicalVowel: 'a_open',
    displayToken: 'ah',
    prompt: 'Hold a comfortable “ah” on one steady, easy note.',
    supports: { formants: true, pitchSteadiness: true, voiceQuality: true },
    tags: ['controlled-probe', 'vowel', 'ah'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'vowel.oh.steady.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'vowel.oh.steady.v1',
    kind: 'sustained_vowel',
    stage: 'sound',
    canonicalVowel: 'o',
    displayToken: 'oh',
    prompt: 'Hold a comfortable “oh” on one steady, easy note.',
    supports: { formants: true, pitchSteadiness: true, voiceQuality: true },
    tags: ['controlled-probe', 'vowel', 'oh'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'vowel.oo.steady.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'vowel.oo.steady.v1',
    kind: 'sustained_vowel',
    stage: 'sound',
    canonicalVowel: 'u',
    displayToken: 'oo',
    prompt: 'Hold a comfortable “oo” on one steady, easy note.',
    supports: { formants: true, pitchSteadiness: true, voiceQuality: true },
    tags: ['controlled-probe', 'vowel', 'oo'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'transfer.mmm-ee.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'transfer.mmm-ee.v1',
    kind: 'hum_sovt',
    stage: 'sound',
    canonicalVowel: 'i',
    displayToken: 'mmm→ee',
    prompt: 'Start with an easy “mmm”, then open into “ee” without forcing the note.',
    supports: { formants: false, pitchSteadiness: true, voiceQuality: true, transfer: true },
    tags: ['controlled-probe', 'transfer', 'mmm', 'ee'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'transfer.vvv-ee.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'transfer.vvv-ee.v1',
    kind: 'sustained',
    stage: 'sound',
    canonicalVowel: 'i',
    displayToken: 'vvv→ee',
    prompt: 'Start with a light “vvv”, then open into “ee” while keeping the effort easy.',
    supports: { formants: false, pitchSteadiness: true, voiceQuality: true, transfer: true },
    tags: ['controlled-probe', 'transfer', 'vvv', 'ee'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'pitch.comfortable-glide.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'pitch.comfortable-glide.v1',
    kind: 'siren',
    stage: 'sound',
    canonicalVowel: null,
    displayToken: 'comfortable glide',
    prompt: 'Make one small comfortable glide up and back down; do not push for the top.',
    supports: { formants: false, pitchRange: true, glideSmoothness: true },
    tags: ['controlled-probe', 'pitch', 'glide'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'prosody.statement.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'prosody.statement.v1',
    kind: 'phrase',
    stage: 'phrase',
    canonicalVowel: null,
    displayToken: 'statement',
    prompt: 'Say the displayed sentence once as an ordinary statement.',
    supports: { formants: false, phraseProsody: true },
    tags: ['controlled-probe', 'prosody', 'statement'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'prosody.question.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'prosody.question.v1',
    kind: 'phrase',
    stage: 'phrase',
    canonicalVowel: null,
    displayToken: 'question',
    prompt: 'Say the displayed sentence once as a natural question.',
    supports: { formants: false, phraseProsody: true },
    tags: ['controlled-probe', 'prosody', 'question'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'prosody.contrastive-emphasis.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'prosody.contrastive-emphasis.v1',
    kind: 'phrase',
    stage: 'phrase',
    canonicalVowel: null,
    displayToken: 'contrastive emphasis',
    prompt: 'Say the displayed sentence once, putting the emphasis on the marked word.',
    supports: { formants: false, phraseProsody: true, emphasis: true },
    tags: ['controlled-probe', 'prosody', 'emphasis'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
  'phrase.matched-reference.v1': freezeProbe({
    schema: CONTROLLED_PROBE_SCHEMA,
    probeId: 'phrase.matched-reference.v1',
    kind: 'phrase',
    stage: 'phrase',
    canonicalVowel: null,
    displayToken: 'matched phrase',
    prompt: 'Say the exact displayed phrase once in your normal practice voice.',
    supports: { formants: false, phraseProsody: true, matchedText: true },
    tags: ['controlled-probe', 'phrase', 'matched-text'],
    reviewStatus: 'clinical-review-required',
    researchOnly: true,
  }),
});

function textOrNull(value, maxLength = 200) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, maxLength) : null;
}

function getControlledProbe(probeId) {
  const id = textOrNull(probeId, 120);
  return id && PROBES[id] ? PROBES[id] : null;
}

function listControlledProbes() {
  return Object.values(PROBES);
}

function readProbeContext(repContext) {
  const candidates = [
    repContext?.metadata?.targetMetricProbe,
    repContext?.drill?.metadata?.targetMetricProbe,
    repContext?.activeLine?.metadata?.targetMetricProbe,
  ];
  const raw = candidates.find((value) => value && typeof value === 'object' && !Array.isArray(value));
  if (!raw) return null;
  const probeId = textOrNull(raw.probeId, 120);
  const targetProbeId = textOrNull(raw.targetProbeId, 120);
  const comparisonContextKey = textOrNull(raw.comparisonContextKey, 200);
  const targetComparisonContextKey = textOrNull(raw.targetComparisonContextKey, 200);
  const targetEvidenceKind = textOrNull(raw.targetEvidenceKind, 80);
  return {
    schema: PROBE_CONTEXT_SCHEMA,
    probeId,
    targetProbeId,
    comparisonContextKey,
    targetComparisonContextKey,
    targetEvidenceKind,
  };
}

/**
 * Return only comparability that is POSITIVELY proven by the rep context.
 * A learner performing /ee/ is insufficient: the target evidence must itself
 * be a clip-wide measurement of the SAME controlled probe, and both sides must
 * carry the same explicit comparison context key.
 */
function resolveProbeContextComparability(repContext) {
  const context = readProbeContext(repContext);
  const probe = getControlledProbe(context?.probeId);
  const targetProbe = getControlledProbe(context?.targetProbeId);
  const sameProbe = Boolean(probe && targetProbe && probe.probeId === targetProbe.probeId);
  const sameContext = Boolean(
    context?.comparisonContextKey
    && context?.targetComparisonContextKey
    && context.comparisonContextKey === context.targetComparisonContextKey
  );
  const targetEvidenceVerified = TARGET_EVIDENCE_KINDS.has(context?.targetEvidenceKind);
  const formants = Boolean(
    sameProbe
    && sameContext
    && targetEvidenceVerified
    && probe.supports.formants === true
  );
  const phraseProsody = Boolean(
    sameProbe
    && sameContext
    && targetEvidenceVerified
    && probe.supports.phraseProsody === true
  );
  return {
    formants,
    phraseProsody,
    verified: formants || phraseProsody,
    source: formants || phraseProsody ? 'controlled_probe_pair' : null,
    probeId: probe?.probeId || null,
    comparisonContextKey: sameContext ? context.comparisonContextKey : null,
    targetEvidenceKind: targetEvidenceVerified ? context.targetEvidenceKind : null,
    reason: !probe
      ? 'unknown_or_missing_probe'
      : !targetProbe
        ? 'unknown_or_missing_target_probe'
        : !sameProbe
          ? 'probe_mismatch'
          : !sameContext
            ? 'comparison_context_mismatch'
            : !targetEvidenceVerified
              ? 'target_evidence_not_probe_conditioned'
              : 'metric_not_supported_by_probe',
  };
}

function buildProbeContextMetadata(probeId, {
  comparisonContextKey,
  targetProbeId = null,
  targetComparisonContextKey = null,
  targetEvidenceKind = null,
} = {}) {
  const probe = getControlledProbe(probeId);
  if (!probe) return null;
  return {
    targetMetricProbe: {
      schema: PROBE_CONTEXT_SCHEMA,
      probeId: probe.probeId,
      comparisonContextKey: textOrNull(comparisonContextKey, 200),
      targetProbeId: textOrNull(targetProbeId, 120),
      targetComparisonContextKey: textOrNull(targetComparisonContextKey, 200),
      targetEvidenceKind: textOrNull(targetEvidenceKind, 80),
    },
  };
}

module.exports = {
  CONTROLLED_PROBE_SCHEMA,
  PROBE_CONTEXT_SCHEMA,
  PROBES,
  TARGET_EVIDENCE_KINDS,
  buildProbeContextMetadata,
  getControlledProbe,
  listControlledProbes,
  readProbeContext,
  resolveProbeContextComparability,
};
