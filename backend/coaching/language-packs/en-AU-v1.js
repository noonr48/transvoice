'use strict';

const { getControlledProbe, PROBES } = require('../controlled-probes');

const LANGUAGE_PACK_SCHEMA = 'transvoice.language_pack.v1';
const EN_AU_V1_PACK_ID = 'en-AU-feminization-foundations-v1';
const EN_AU_V1_PACK_VERSION = '1';

/**
 * en-AU v1 language pack — PROVISIONAL PHONETIC CONTENT.
 *
 * The IPA below is the best provisional notation for Australian English and
 * is deliberately NOT treated as final: the master plan requires phonetic/
 * specialist review before any vowel set is authoritative. Every entry ships
 * reviewStatus 'phonetic_review_required' and the pack's pendingQuestions
 * name exactly what must be confirmed. Until review grants approval, no
 * pack content may drive learner-facing formant coaching (the detector
 * release gate blocks that independently).
 */

function vowelEntry(probeId, { ipa, lexicalSet, acceptedVariants }) {
  const probe = getControlledProbe(probeId);
  return {
    probeId,
    canonicalVowel: probe.canonicalVowel,
    promptText: probe.prompt,
    ipa,
    lexicalSet,
    supportsFormants: probe.supports.formants === true,
    acceptedVariants: [...acceptedVariants],
    reviewStatus: 'phonetic_review_required',
    demoAsset: {
      assetId: `demo.${probeId}.${EN_AU_V1_PACK_ID}`,
      status: 'not_recorded',
      recordingContextRequired: true,
    },
  };
}

function enAuV1LanguagePack() {
  return {
    schema: LANGUAGE_PACK_SCHEMA,
    languagePackId: EN_AU_V1_PACK_ID,
    version: EN_AU_V1_PACK_VERSION,
    language: 'en',
    region: 'AU',
    vowelCoverage: [
      vowelEntry('vowel.ee.steady.v1', {
        ipa: '/iː/',
        lexicalSet: 'FLEECE',
        acceptedVariants: ['ee', 'ea', 'e'],
      }),
      vowelEntry('vowel.eh.steady.v1', {
        ipa: '/e/',
        lexicalSet: 'DRESS',
        acceptedVariants: ['eh', 'e'],
      }),
      vowelEntry('vowel.ah.steady.v1', {
        ipa: '/æ/',
        lexicalSet: 'TRAP/BATH',
        acceptedVariants: ['ah', 'a'],
      }),
      vowelEntry('vowel.oh.steady.v1', {
        ipa: '/oː/',
        lexicalSet: 'THOUGHT',
        acceptedVariants: ['oh', 'aw', 'or'],
      }),
      vowelEntry('vowel.oo.steady.v1', {
        ipa: '/uː/',
        lexicalSet: 'GOOSE',
        acceptedVariants: ['oo', 'ue', 'ew'],
      }),
    ],
    phoneticReview: {
      status: 'phonetic_review_required',
      reviewer: null,
      reviewedAt: null,
      pendingQuestions: [
        'Confirm TRAP/BATH notation for en-AU: Australian English lacks the trap-bath split, so both word classes are expected /æ/ — verify with a phonetician.',
        'Confirm DRESS notation /e/ vs /ɛ/ for en-AU speakers.',
        'Confirm THOUGHT realization /oː/ (vs /ɔː/) for the target en-AU variety.',
      ],
    },
    prosodyPrompts: {
      status: 'not_in_v1_pack',
      plannedFor: 'post-v1 curriculum phases (prosody/transfer)',
    },
  };
}

const PACKS = Object.freeze({
  [EN_AU_V1_PACK_ID]: enAuV1LanguagePack,
});

function getLanguagePack(languagePackId) {
  const factory = typeof languagePackId === 'string'
    && Object.prototype.hasOwnProperty.call(PACKS, languagePackId)
    ? PACKS[languagePackId]
    : null;
  return factory ? factory() : null;
}

function textOrNull(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text || null;
}

/**
 * Structural + registry-drift validation. A pack is valid only when every
 * vowel entry matches the live controlled-probe registry exactly (probe
 * exists, prompt text identical, canonical vowel identical) and every
 * formant-supporting probe the curriculum can reach is covered.
 */
function validateLanguagePack(pack) {
  const errors = [];
  if (!pack || typeof pack !== 'object' || pack.schema !== LANGUAGE_PACK_SCHEMA) {
    return { valid: false, errors: ['schema_mismatch'] };
  }
  if (!textOrNull(pack.languagePackId) || !textOrNull(pack.version)) {
    errors.push('pack_identity_missing');
  }
  const coverage = Array.isArray(pack.vowelCoverage) ? pack.vowelCoverage : [];
  if (!coverage.length) {
    errors.push('vowel_coverage_empty');
  }
  for (const entry of coverage) {
    const probe = getControlledProbe(entry?.probeId);
    if (!probe) {
      errors.push(`unknown probe: ${entry?.probeId}`);
      continue;
    }
    if (entry.promptText !== probe.prompt) {
      errors.push(`prompt drift for ${entry.probeId}`);
    }
    if (entry.canonicalVowel !== probe.canonicalVowel) {
      errors.push(`vowel identity drift for ${entry.probeId}`);
    }
    if (entry.reviewStatus !== 'phonetic_review_required') {
      errors.push(`review status must stay phonetic_review_required for ${entry.probeId}`);
    }
    if (!entry.demoAsset || entry.demoAsset.status !== 'not_recorded'
      || entry.demoAsset.recordingContextRequired !== true) {
      errors.push(`demo asset contract violated for ${entry.probeId}`);
    }
  }
  const covered = new Set(coverage.map((entry) => entry?.probeId));
  for (const probe of Object.values(PROBES)) {
    if (probe.supports.formants === true && !covered.has(probe.probeId)) {
      errors.push(`formant probe not covered: ${probe.probeId}`);
    }
  }
  return { valid: errors.length === 0, errors };
}

module.exports = {
  EN_AU_V1_PACK_ID,
  EN_AU_V1_PACK_VERSION,
  LANGUAGE_PACK_SCHEMA,
  enAuV1LanguagePack,
  getLanguagePack,
  validateLanguagePack,
};
