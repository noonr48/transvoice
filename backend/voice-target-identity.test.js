'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  isVoiceRecordComparableToTarget,
  resolveVoiceTargetIdentity,
} = require('./voice-target-identity');

function customIdentity(overrides = {}) {
  return resolveVoiceTargetIdentity({
    targetSource: 'custom-handmade',
    targetPreset: 'cute-feminine',
    targetProfileId: 'custom-a',
    direction: 'feminine',
    analysisVersion: 'voice-target-v2',
    pitchFloorHz: 80,
    pitchCeilingHz: 400,
    resonanceFloor: 0,
    resonanceCeiling: 1,
    weightFloor: 0,
    weightCeiling: 1,
    ...overrides,
  });
}

test('built-in preset aliases resolve to one stable opaque identity', () => {
  const preset = resolveVoiceTargetIdentity({ targetSource: 'preset', targetPreset: 'masculine' });
  const builtIn = resolveVoiceTargetIdentity({ targetSource: 'built-in', targetPreset: 'masculine' });
  assert.equal(preset.valid, true);
  assert.equal(preset.targetKey, builtIn.targetKey);
  assert.match(preset.targetKey, /^vt1:[a-f0-9]{64}$/);
});

test('custom identity is exact, deterministic, and ignores display-only metadata', () => {
  const base = customIdentity();
  const numericStrings = customIdentity({
    pitchFloorHz: '80', pitchCeilingHz: '400.0', resonanceFloor: '0', resonanceCeiling: '1',
  });
  const renamed = customIdentity({ name: 'Renamed', stylePrompt: 'new prose', notes: ['display only'] });
  assert.equal(base.valid, true);
  assert.equal(base.targetKey, numericStrings.targetKey);
  assert.equal(base.targetKey, renamed.targetKey);

  for (const changed of [
    customIdentity({ targetProfileId: 'custom-b' }),
    customIdentity({ targetSource: 'custom-reference' }),
    customIdentity({ pitchFloorHz: 81 }),
    customIdentity({ analysisVersion: 'voice-target-v3' }),
  ]) {
    assert.equal(changed.valid, true);
    assert.notEqual(changed.targetKey, base.targetKey);
  }
});

test('custom identity accepts exact zero endpoints and rejects incomplete or invalid bands', () => {
  assert.equal(customIdentity().valid, true);
  for (const identity of [
    customIdentity({ pitchFloorHz: null }),
    customIdentity({ pitchFloorHz: Number.NaN }),
    customIdentity({ pitchFloorHz: 401 }),
    customIdentity({ resonanceFloor: 0.8, resonanceCeiling: 0.2 }),
    customIdentity({ weightCeiling: Number.POSITIVE_INFINITY }),
    customIdentity({ targetProfileId: '' }),
  ]) {
    assert.equal(identity.valid, false);
    assert.equal(identity.targetKey, null);
  }
  assert.equal(customIdentity({ analysisVersion: '' }).valid, true);
  assert.notEqual(customIdentity({ analysisVersion: '' }).targetKey, customIdentity().targetKey);
});

test('reference clip fallback is reference-only and comparison fails closed for custom legacy rows', () => {
  const reference = customIdentity({
    targetSource: 'reference', targetProfileId: '', referenceClipId: 'reference-a',
  });
  const handmade = customIdentity({ targetProfileId: '', referenceClipId: 'reference-a' });
  assert.equal(reference.valid, true);
  assert.equal(handmade.valid, false);
  assert.equal(isVoiceRecordComparableToTarget({
    targetKey: reference.targetKey, targetPreset: 'cute-feminine', targetSource: 'reference',
  }, reference), true);
  assert.equal(isVoiceRecordComparableToTarget({
    targetPreset: 'cute-feminine', targetSource: 'custom-reference',
  }, reference), false);

  const builtIn = resolveVoiceTargetIdentity({ targetSource: 'built-in', targetPreset: 'cute-feminine' });
  assert.equal(isVoiceRecordComparableToTarget({ targetPreset: 'cute-feminine' }, builtIn), true);
  assert.equal(isVoiceRecordComparableToTarget({
    targetPreset: 'cute-feminine', targetSource: 'custom-handmade',
  }, builtIn), false);
});
