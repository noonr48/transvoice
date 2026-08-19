'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { targetDistance, isUsableObservation } = require('./metric-observations');
const { decideTargetCoaching, verifyCueEffect } = require('./target-coaching-engine');
const { emptyMotorMap, recordCueOutcome, cueEffectMultiplier } = require('./motor-map');
const { legacyObservationsFromVoiceState } = require('./legacy-observation-adapter');
const {
  activationEligibility,
  applyTargetMetricDecision,
  buildTargetMetricBridge,
  legacyFocusForDecision,
} = require('./target-metric-bridge');

function obs(dimension, value, low, high, extra = {}) {
  return {
    metricId: extra.metricId || dimension,
    dimension,
    value,
    unit: extra.unit || 'score',
    confidence: { signal: 0.95, segmentation: 0.95, extractor: 0.95, target: 0.95 },
    target: {
      low,
      high,
      scale: extra.scale || 0.1,
      source: 'reference',
      targetKey: extra.targetKey || 'target-1',
      confidence: 0.95,
    },
    attemptArtifactId: extra.attemptArtifactId || 'attempt-1',
    taskId: extra.taskId || 'task-1',
    takeKind: extra.takeKind || 'phrase',
    contextKind: extra.contextKind || 'utterance',
    persistenceCount: 2,
    importance: extra.importance ?? 0.7,
    controllability: extra.controllability ?? 0.8,
    metadata: extra.metadata || {},
    flags: extra.flags || [],
  };
}

function canonicalVoiceState(overrides = {}) {
  const version = 'voice-metrics-v4-formants';
  const target = {
    source: 'reference',
    targetPreset: 'cute-feminine',
    targetProfileId: 'profile-1',
    direction: 'feminine',
    pitchFloorHz: 180,
    pitchCeilingHz: 220,
    resonanceFloor: 0.4,
    resonanceCeiling: 0.65,
    weightFloor: 0.2,
    weightCeiling: 0.45,
    referenceF2MedianHz: 2100,
  };
  const advanced = {
    measurementAvailable: true,
    scoreConfidence: 0.9,
    captureReliability: 0.9,
    voicedFramePct: 0.9,
    confidentFramePct: 0.9,
    pitchValidFrameCount: 60,
    snrDb: 24,
    clippingPct: 0,
    medianPitchHz: 140,
    formantLite: { f2MedianHz: 1800 },
    ...(overrides.advanced || {}),
  };
  return {
    targetPreset: 'cute-feminine',
    targetSource: 'reference',
    referenceClipId: 'ref-1',
    referenceAnalysis: {
      clipId: 'ref-1',
      analysisVersion: version,
      quality: { verdict: 'good' },
    },
    targetVoiceProfile: {
      profileId: 'profile-1',
      clipId: 'ref-1',
      targetPreset: 'cute-feminine',
      analysisVersion: version,
      pitchFloorHz: 180,
      pitchCeilingHz: 220,
      resonanceFloor: 0.4,
      resonanceCeiling: 0.65,
      weightFloor: 0.2,
      weightCeiling: 0.45,
      metrics: { advanced: { formantLite: { f2MedianHz: 2100 } } },
    },
    lastSummary: {
      analysisVersion: version,
      targetPreset: 'cute-feminine',
      referenceClipId: 'ref-1',
      target,
      metrics: {
        meanPitchHz: 140,
        resonanceMean: 0.5,
        weightMean: 0.35,
        advanced,
      },
    },
    lastAttemptArtifact: {
      attemptArtifactId: 'attempt-1',
      finalizedAt: Date.now(),
      repContext: { kind: 'phrase', drillId: 'task-1' },
      selfReport: overrides.selfReport || null,
    },
    ...overrides.voiceState,
  };
}

function activatableSignal(overrides = {}) {
  return {
    mode: 'active_drill',
    policy: { safetyState: 'normal', shouldCorrect: true, coachingAction: 'coach' },
    capture: { reliability: 'good' },
    takeQuality: { usable: true },
    sessionScope: { tier: 'full' },
    history: { trend: 'flat' },
    coachingDecision: { primaryFocus: 'pitch_floor', intent: 'correct', avoidCues: [] },
    coachMove: { cue: 'legacy cue' },
    ...overrides,
  };
}

test('target distance is zero inside band and signed outside', () => {
  assert.equal(targetDistance(obs('x', 0.5, 0.4, 0.6)).absoluteDistance, 0);
  assert.equal(targetDistance(obs('x', 0.3, 0.4, 0.6)).direction, 'below');
  assert.equal(targetDistance(obs('x', 0.7, 0.4, 0.6)).direction, 'above');
});

test('weakest confidence stage gates an otherwise plausible metric', () => {
  const item = obs('resonance.global_scale', 0.2, 0.4, 0.6);
  item.confidence.segmentation = 0.2;
  assert.equal(isUsableObservation(item), false);
});

test('capture-invalid flags fail closed', () => {
  const item = obs('pitch.register', 120, 180, 220, {
    unit: 'Hz', scale: 1, metadata: { targetScaleUnit: 'semitone' },
  });
  item.flags = ['low_snr'];
  assert.equal(isUsableObservation(item), false);
});

test('resonance gap chooses ee experiment without asking to raise pitch', () => {
  const decision = decideTargetCoaching({ observations: [
    obs('pitch.register', 200, 185, 220, {
      unit: 'Hz', scale: 1, metadata: { targetScaleUnit: 'semitone' },
    }),
    obs('resonance.global_scale', 0.2, 0.4, 0.6),
  ], stage: 'phrase' });
  assert.equal(decision.status, 'coach');
  assert.equal(decision.focus.dimension, 'resonance.global_scale');
  assert.match(decision.action.cueId, /ee-anchor/);
  assert.doesNotMatch(decision.action.instruction, /raise|higher pitch/i);
  assert.ok(decision.action.protectedMetrics.includes('pitch.register'));
});

test('pitch gap chooses a concrete small-glide action, not generic raise pitch prose', () => {
  const decision = decideTargetCoaching({ observations: [obs('pitch.register', 140, 180, 220, {
    unit: 'Hz', scale: 1, metadata: { targetScaleUnit: 'semitone' },
  })], stage: 'phrase' });
  assert.equal(decision.status, 'coach');
  assert.match(decision.action.cueId, /small-glide-up/);
  assert.match(decision.action.instruction, /hum/i);
  assert.match(decision.action.instruction, /small step/i);
});

test('pain vetoes target chasing when explicit pain data is present', () => {
  const decision = decideTargetCoaching({
    observations: [obs('pitch.register', 120, 180, 220, {
      unit: 'Hz', scale: 1, metadata: { targetScaleUnit: 'semitone' },
    })],
    selfReport: { pain: true },
  });
  assert.equal(decision.status, 'stop_for_safety');
  assert.equal(decision.action, null);
});

test('one-focus policy emits one action even with several target gaps', () => {
  const decision = decideTargetCoaching({ observations: [
    obs('resonance.global_scale', 0.1, 0.4, 0.6, { importance: 0.8 }),
    obs('phonation.source_weight', 0.9, 0.3, 0.5, { importance: 0.7 }),
    obs('pitch.register', 150, 185, 220, {
      unit: 'Hz', scale: 1, metadata: { targetScaleUnit: 'semitone' },
    }),
  ] });
  assert.equal(decision.status, 'coach');
  assert.ok(decision.focus);
  assert.ok(decision.action);
  assert.equal(Array.isArray(decision.action), false);
});

test('focus improvement with missing protected channels is partial, not success', () => {
  const before = [obs('resonance.global_scale', 0.2, 0.4, 0.6)];
  const decision = decideTargetCoaching({ observations: before });
  const after = [obs('resonance.global_scale', 0.35, 0.4, 0.6, { attemptArtifactId: 'attempt-2' })];
  const verification = verifyCueEffect(decision, before, after);
  assert.equal(verification.targetMovement, 'improved');
  assert.equal(verification.result, 'movement_observed_partial');
  assert.ok(verification.missingProtectedEvidence.length > 0);
});

test('wrong-way focus movement is rejected even when protection is incomplete', () => {
  const before = [obs('resonance.global_scale', 0.2, 0.4, 0.6)];
  const decision = decideTargetCoaching({ observations: before });
  const after = [obs('resonance.global_scale', 0.1, 0.4, 0.6, { attemptArtifactId: 'attempt-2' })];
  assert.equal(verifyCueEffect(decision, before, after).result, 'moved_wrong_way');
});

test('target changes invalidate cue verification rather than learning across targets', () => {
  const before = [obs('resonance.global_scale', 0.2, 0.4, 0.6)];
  const decision = decideTargetCoaching({ observations: before });
  const after = [obs('resonance.global_scale', 0.35, 0.4, 0.6, {
    targetKey: 'target-2', attemptArtifactId: 'attempt-2',
  })];
  const verification = verifyCueEffect(decision, before, after);
  assert.equal(verification.status, 'invalidated');
  assert.equal(verification.result, 'target_changed');
});

test('motor map can reward a verified cue when no protected channels are declared', () => {
  const before = [obs('custom.dimension', 0.2, 0.4, 0.6)];
  const after = [obs('custom.dimension', 0.38, 0.4, 0.6, { attemptArtifactId: 'attempt-2' })];
  const cueId = 'test.cue';
  let map = emptyMotorMap();
  const neutral = cueEffectMultiplier(map, cueId, 'custom.dimension');
  map = recordCueOutcome(map, {
    cueId,
    focusDimension: 'custom.dimension',
    beforeObservations: before,
    afterObservations: after,
    protectedDimensions: [],
    verification: { status: 'verified', result: 'worked_verified' },
  });
  assert.equal(map.byCue[cueId].successes, 1);
  assert.ok(cueEffectMultiplier(map, cueId, 'custom.dimension') > neutral);
});

test('legacy adapter keeps coarse resonance/weight as proxies but clip-wide F2 is non-rankable by default', () => {
  const observations = legacyObservationsFromVoiceState(canonicalVoiceState());
  const resonance = observations.find((item) => item.dimension === 'resonance.legacy_proxy');
  const f2 = observations.find((item) => item.dimension === 'resonance.global_scale');
  assert.equal(resonance.metadata.proxy, true);
  assert.equal(resonance.target.low, 0.4);
  assert.equal(f2.metadata.needsVowelConditioning, true);
  assert.ok(f2.flags.includes('context_not_comparable'));
  assert.equal(isUsableObservation(f2), false);
});

test('shadow apply is side-effect free', () => {
  const bridge = buildTargetMetricBridge({ voiceState: canonicalVoiceState() });
  const signal = activatableSignal();
  applyTargetMetricDecision(signal, bridge);
  assert.equal(bridge.mode, 'shadow');
  assert.equal(signal.coachMove.cue, 'legacy cue');
  assert.equal(signal.targetMetricV3, undefined);
});

test('explicit experimental activation requires every positive runtime gate', () => {
  const bridge = buildTargetMetricBridge({
    voiceState: canonicalVoiceState(),
    mode: 'active',
    allowUnreviewedCues: true,
  });
  const signal = activatableSignal();
  const eligibility = activationEligibility(signal, bridge);
  assert.equal(eligibility.eligible, true);
  applyTargetMetricDecision(signal, bridge);
  assert.equal(signal.coachingDecision.primaryFocus, 'pitch_floor');
  assert.match(signal.coachMove.cue, /hum/i);
});

test('active bridge is blocked when policy is not correcting', () => {
  const bridge = buildTargetMetricBridge({
    voiceState: canonicalVoiceState(), mode: 'active', allowUnreviewedCues: true,
  });
  const signal = activatableSignal({
    policy: { safetyState: 'normal', shouldCorrect: false, coachingAction: 'converse' },
  });
  const eligibility = activationEligibility(signal, bridge);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('policy_not_correcting'));
  applyTargetMetricDecision(signal, bridge);
  assert.equal(signal.coachMove.cue, 'legacy cue');
});

test('unreviewed cues cannot become learner-facing merely by setting active mode', () => {
  const bridge = buildTargetMetricBridge({ voiceState: canonicalVoiceState(), mode: 'active' });
  const signal = activatableSignal();
  const eligibility = activationEligibility(signal, bridge);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('cue_not_approved'));
  applyTargetMetricDecision(signal, bridge);
  assert.equal(signal.coachMove.cue, 'legacy cue');
});

test('activation maps rich dimensions onto existing CoachingSignal focus values', () => {
  assert.equal(legacyFocusForDecision({ focus: { dimension: 'pitch.register', direction: 'below' } }), 'pitch_floor');
  assert.equal(legacyFocusForDecision({ focus: { dimension: 'pitch.register', direction: 'above' } }), 'pitch_lower');
  assert.equal(legacyFocusForDecision({ focus: { dimension: 'resonance.global_scale', direction: 'below' } }), 'resonance_forward');
  assert.equal(legacyFocusForDecision({ focus: { dimension: 'resonance.global_scale', direction: 'above' } }), null);
});
