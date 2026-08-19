'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  LANGUAGE_PACK_SCHEMA,
  EN_AU_V1_PACK_ID,
  EN_AU_V1_PACK_VERSION,
  enAuV1LanguagePack,
  getLanguagePack,
  validateLanguagePack,
} = require('./language-packs/en-AU-v1');
const { getControlledProbe, PROBES } = require('./controlled-probes');

test('the pack is versioned with its language_pack_id and schema', () => {
  const pack = enAuV1LanguagePack();
  assert.equal(pack.schema, LANGUAGE_PACK_SCHEMA);
  assert.equal(pack.languagePackId, EN_AU_V1_PACK_ID);
  assert.equal(EN_AU_V1_PACK_ID, 'en-AU-feminization-foundations-v1');
  assert.equal(pack.version, EN_AU_V1_PACK_VERSION);
  assert.equal(typeof getLanguagePack(EN_AU_V1_PACK_ID).languagePackId, 'string');
  assert.equal(getLanguagePack('no.such.pack'), null);
});

test('every vowel entry carries IPA, lexical set, and the EXACT probe prompt', () => {
  const pack = enAuV1LanguagePack();
  assert.ok(pack.vowelCoverage.length >= 5);
  for (const entry of pack.vowelCoverage) {
    assert.ok(entry.ipa && entry.ipa.startsWith('/') && entry.ipa.endsWith('/'), entry.probeId);
    assert.ok(entry.lexicalSet, entry.probeId);
    const probe = getControlledProbe(entry.probeId);
    assert.ok(probe, entry.probeId);
    assert.equal(entry.promptText, probe.prompt, 'prompt drift vs probe registry');
    assert.equal(entry.canonicalVowel, probe.canonicalVowel, 'vowel identity drift');
  }
  const ee = pack.vowelCoverage.find((e) => e.probeId === 'vowel.ee.steady.v1');
  assert.equal(ee.ipa, '/iː/');
  assert.equal(ee.canonicalVowel, 'i');
  assert.equal(ee.supportsFormants, true);
});

test('phonetic content is explicitly review-gated, never treated as final', () => {
  const pack = enAuV1LanguagePack();
  assert.equal(pack.phoneticReview.status, 'phonetic_review_required');
  assert.ok(Array.isArray(pack.phoneticReview.pendingQuestions));
  assert.ok(pack.phoneticReview.pendingQuestions.length >= 1);
  for (const entry of pack.vowelCoverage) {
    assert.equal(entry.reviewStatus, 'phonetic_review_required', entry.probeId);
  }
});

test('demo assets are honest slots: not_recorded, with a recording-context contract', () => {
  const pack = enAuV1LanguagePack();
  for (const entry of pack.vowelCoverage) {
    assert.ok(entry.demoAsset.assetId, entry.probeId);
    assert.equal(entry.demoAsset.status, 'not_recorded');
    assert.equal(entry.demoAsset.recordingContextRequired, true);
  }
});

test('accepted variants list display spellings only, never phonetic claims', () => {
  const pack = enAuV1LanguagePack();
  const ee = pack.vowelCoverage.find((e) => e.probeId === 'vowel.ee.steady.v1');
  assert.ok(Array.isArray(ee.acceptedVariants) && ee.acceptedVariants.length >= 1);
  assert.ok(ee.acceptedVariants.includes('ee'));
});

test('validation catches drift against the probe registry', () => {
  const good = validateLanguagePack(enAuV1LanguagePack());
  assert.equal(good.valid, true);
  assert.deepEqual(good.errors, []);

  const pack = enAuV1LanguagePack();
  const badProbe = {
    ...pack,
    vowelCoverage: [{ ...pack.vowelCoverage[0], probeId: 'vowel.zz.steady.v9' }],
  };
  const bad = validateLanguagePack(badProbe);
  assert.equal(bad.valid, false);
  assert.ok(bad.errors.some((e) => e.includes('vowel.zz.steady.v9')));

  const driftedPrompt = {
    ...pack,
    vowelCoverage: [{ ...pack.vowelCoverage[0], promptText: 'Say something else entirely.' }],
  };
  const drifted = validateLanguagePack(driftedPrompt);
  assert.equal(drifted.valid, false);
  assert.ok(drifted.errors.some((e) => e.includes('prompt')));
});

test('the pack covers every formant-supporting vowel probe the curriculum uses', () => {
  const pack = enAuV1LanguagePack();
  const formantProbes = Object.values(PROBES).filter(
    (probe) => probe.supports.formants === true,
  );
  const covered = new Set(pack.vowelCoverage.map((entry) => entry.probeId));
  for (const probe of formantProbes) {
    assert.ok(covered.has(probe.probeId), probe.probeId);
  }
});

test('prosody/phrase prompts are explicitly out of the v1 pack scope', () => {
  const pack = enAuV1LanguagePack();
  assert.equal(pack.prosodyPrompts.status, 'not_in_v1_pack');
  assert.ok(pack.prosodyPrompts.plannedFor);
});
