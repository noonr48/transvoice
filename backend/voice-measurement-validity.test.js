'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  MAX_CLIPPING_PCT,
  MIN_PITCH_VALID_FRAME_COUNT,
  MIN_SNR_DB,
  resolveVoiceMeasurementUsability,
} = require('./voice-measurement-validity');

function validAdvanced(overrides = {}) {
  return {
    measurementAvailable: true,
    measurementRejectionReasons: [],
    scoreConfidence: 0.8,
    voicedFramePct: 0.8,
    confidentFramePct: 0.8,
    captureReliability: 0.8,
    pitchValidFrameCount: 80,
    snrDb: 24,
    clippingPct: 0,
    ...overrides,
  };
}

test('low SNR and sustained clipping are observable but never coachable or learnable', () => {
  const noisy = resolveVoiceMeasurementUsability(validAdvanced({ snrDb: MIN_SNR_DB - 0.01 }));
  assert.equal(noisy.usableForScoring, false);
  assert.ok(noisy.reasons.includes('low_snr'));

  const clipped = resolveVoiceMeasurementUsability(validAdvanced({ clippingPct: MAX_CLIPPING_PCT }));
  assert.equal(clipped.usableForScoring, false);
  assert.ok(clipped.reasons.includes('sustained_clipping'));

  assert.equal(resolveVoiceMeasurementUsability(validAdvanced({ snrDb: MIN_SNR_DB })).usableForScoring, true);
  assert.equal(resolveVoiceMeasurementUsability(validAdvanced({ clippingPct: 0.0199 })).usableForScoring, true);
});

test('analyzer-supplied capture rejections fail closed even when numeric fields are absent', () => {
  for (const reason of ['low_snr', 'sustained_clipping']) {
    const validity = resolveVoiceMeasurementUsability(validAdvanced({
      measurementRejectionReasons: [reason],
      snrDb: null,
      clippingPct: null,
    }));
    assert.equal(validity.usableForScoring, false, reason);
    assert.ok(validity.reasons.includes(reason));
  }
});

test('natural pauses do not invalidate long-form speech with ample pitch evidence', () => {
  const longForm = resolveVoiceMeasurementUsability(validAdvanced({
    voicedFramePct: 0.32,
    pitchValidFrameCount: MIN_PITCH_VALID_FRAME_COUNT,
  }));
  assert.equal(longForm.usableForScoring, true);
  assert.ok(!longForm.reasons.includes('low_voiced_coverage'));

  const tooSparse = resolveVoiceMeasurementUsability(validAdvanced({
    voicedFramePct: 0.32,
    pitchValidFrameCount: MIN_PITCH_VALID_FRAME_COUNT - 1,
  }));
  assert.equal(tooSparse.usableForScoring, false);
  assert.ok(tooSparse.reasons.includes('low_voiced_coverage'));
});
