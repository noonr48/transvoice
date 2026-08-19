'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildProbeContextMetadata,
  getControlledProbe,
  listControlledProbes,
  resolveProbeContextComparability,
} = require('./controlled-probes');

function repContext(probeId, overrides = {}) {
  return {
    kind: getControlledProbe(probeId)?.kind || null,
    metadata: buildProbeContextMetadata(probeId, {
      comparisonContextKey: 'probe-context-1',
      targetProbeId: probeId,
      targetComparisonContextKey: 'probe-context-1',
      targetEvidenceKind: 'same_probe_clipwide',
      ...overrides,
    }),
  };
}

test('registry is closed, versioned, research-only and review-gated', () => {
  const probes = listControlledProbes();
  assert.ok(probes.length >= 10);
  assert.equal(getControlledProbe('definitely-unknown'), null);
  for (const probe of probes) {
    assert.equal(probe.schema, 'transvoice.controlled_probe.v1');
    assert.equal(probe.researchOnly, true);
    assert.equal(probe.reviewStatus, 'clinical-review-required');
    assert.match(probe.probeId, /\.v1$/);
    assert.ok(probe.prompt.length > 10);
  }
});

test('same controlled vowel + same context + probe-conditioned target unlocks formant comparability', () => {
  const result = resolveProbeContextComparability(repContext('vowel.ee.steady.v1'));
  assert.equal(result.formants, true);
  assert.equal(result.verified, true);
  assert.equal(result.source, 'controlled_probe_pair');
  assert.equal(result.probeId, 'vowel.ee.steady.v1');
  assert.equal(result.comparisonContextKey, 'probe-context-1');
});

test('learner performing ee never unlocks arbitrary uploaded target speech', () => {
  const result = resolveProbeContextComparability(repContext('vowel.ee.steady.v1', {
    targetEvidenceKind: null,
  }));
  assert.equal(result.formants, false);
  assert.equal(result.verified, false);
  assert.equal(result.reason, 'target_evidence_not_probe_conditioned');
});

test('probe mismatch fails closed even when comparison keys happen to match', () => {
  const result = resolveProbeContextComparability(repContext('vowel.ee.steady.v1', {
    targetProbeId: 'vowel.oo.steady.v1',
  }));
  assert.equal(result.formants, false);
  assert.equal(result.reason, 'probe_mismatch');
});

test('comparison-context mismatch fails closed even for the same vowel', () => {
  const result = resolveProbeContextComparability(repContext('vowel.ee.steady.v1', {
    targetComparisonContextKey: 'some-other-context',
  }));
  assert.equal(result.formants, false);
  assert.equal(result.reason, 'comparison_context_mismatch');
});

test('transfer probes do not make clip-wide formants comparable', () => {
  for (const probeId of ['transfer.mmm-ee.v1', 'transfer.vvv-ee.v1']) {
    const result = resolveProbeContextComparability(repContext(probeId));
    assert.equal(result.formants, false, probeId);
    assert.equal(result.verified, false, probeId);
    assert.equal(result.reason, 'metric_not_supported_by_probe');
  }
});

test('matched phrase probe can prove phrase context without pretending it proves formants', () => {
  const result = resolveProbeContextComparability(repContext('phrase.matched-reference.v1'));
  assert.equal(result.phraseProsody, true);
  assert.equal(result.formants, false);
  assert.equal(result.verified, true);
});

test('metadata builder refuses unknown probe IDs', () => {
  assert.equal(buildProbeContextMetadata('not-a-probe', { comparisonContextKey: 'x' }), null);
});
