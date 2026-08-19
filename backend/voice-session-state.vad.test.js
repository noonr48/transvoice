'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createVoiceSessionStateRuntime } = require('./voice-session-state');
const { beginSentenceProgression } = require('./lessons/sentence-progression');

function createRuntime() {
  return createVoiceSessionStateRuntime({
    appendVoiceCoachThreadMessage: () => [],
    buildVoiceCueSheet: () => ({}),
    buildVoiceStudentModelEvaluations: () => ({}),
    getCachedDefaultModelId: () => null,
    getRenderableVoicePhraseComparison: () => null,
    getVoiceDrillById: () => null,
    normalizeDeepTutorVoiceState: (value) => value || {},
    normalizeDifficultyPreference: (value) => value || 'adaptive',
    normalizeRequestedModel: () => null,
    normalizeVoiceCoachInputConfidence: () => null,
    normalizeVoiceCoachInputProvider: (value) => value === 'backend' ? 'backend' : 'browser',
    resolveActiveVoicePhrase: () => null,
    resolveValidatedSessionModel: async () => null,
  });
}

test('persisted voice state can never restore a silence hold below 4.5 seconds', () => {
  const runtime = createRuntime();
  assert.equal(runtime.normalizeVoiceAdvancedPanelState({}).vadSilenceHoldMs, 4500);
  assert.equal(runtime.normalizeVoiceAdvancedPanelState({ vadSilenceHoldMs: 900 }).vadSilenceHoldMs, 4500);
  assert.equal(runtime.normalizeVoiceAdvancedPanelState({ vadSilenceHoldMs: 9000 }).vadSilenceHoldMs, 4500);
});

test('sentence progression round-trips through persisted voice-state normalization', () => {
  const runtime = createRuntime();
  const progression = beginSentenceProgression({
    returnLineId: 'persisted-return-line',
    returnText: 'It should be an easy morning today.',
    cueFamilyId: 'steady_air',
    cueText: 'Keep your jaw loose and let the air move steadily',
    startedAt: 1_700_000_000_000,
  });

  const restored = runtime.normalizeVoiceState({ practiceProgression: progression });
  assert.deepEqual(restored.practiceProgression, progression);
  assert.equal(
    runtime.normalizeVoiceState({ practiceProgression: { phase: 'acquire' } })
      .practiceProgression,
    null,
  );
});

test('legacy take prescriptions without an exact identity fail closed on restore', () => {
  const runtime = createRuntime();
  assert.equal(
    runtime.normalizeVoiceState({
      pendingTakeKind: {
        kind: 'hum_sovt',
        lessonId: null,
        stampedAt: Date.now(),
      },
    }).pendingTakeKind,
    null,
  );

  const current = {
    prescriptionId: 'take-prescription-current',
    kind: 'hum_sovt',
    drillId: 'starter-easy-hum',
    lessonId: null,
    stampedAt: 1_700_000_000_000,
  };
  assert.deepEqual(
    runtime.normalizeVoiceState({ pendingTakeKind: current }).pendingTakeKind,
    current,
  );
});
