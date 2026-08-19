'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  activationEligibility,
  buildTargetMetricBridge,
  buildTargetMetricShadowWitness,
} = require('./target-metric-bridge');

test('shadow witness is compact and excludes learner transcript and cue prose', () => {
  const bridge = {
    schema: 'transvoice.target_metric_bridge.v2',
    mode: 'shadow',
    observations: [{ transcript: 'PRIVATE LEARNER WORDS', value: 123 }],
    decision: {
      status: 'coach',
      focus: {
        dimension: 'pitch.register',
        direction: 'below',
        confidence: 0.8,
        distance: 1.2,
      },
      action: {
        cueId: 'pitch.register.small-glide-up.v1',
        reviewStatus: 'clinical-review-required',
        instruction: 'PRIVATE CUE PROSE SHOULD NOT ENTER THE WITNESS',
      },
    },
    canonicalContext: {
      targetKey: 'target-1',
      targetSource: 'reference',
      takeKind: 'phrase',
      attemptArtifactId: 'attempt-1',
      freshness: { fresh: true },
      measurementUsable: true,
      measurementReasons: [],
    },
    error: null,
  };
  const signal = { coachingDecision: { primaryFocus: 'pitch_floor' } };
  const witness = buildTargetMetricShadowWitness(bridge, signal);
  const serialized = JSON.stringify(witness);

  assert.equal(witness.focus_dimension, 'pitch.register');
  assert.equal(witness.cue_id, 'pitch.register.small-glide-up.v1');
  assert.equal(witness.focus_agreement, true);
  assert.equal(witness.attempt_artifact_id, 'attempt-1');
  assert.doesNotMatch(serialized, /PRIVATE LEARNER WORDS/);
  assert.doesNotMatch(serialized, /PRIVATE CUE PROSE/);
  assert.equal(Object.hasOwn(witness, 'observations'), false);
  assert.equal(Object.hasOwn(witness, 'instruction'), false);
});

test('experimental bridge exceptions fail closed instead of escaping into legacy coaching', () => {
  const voiceState = {};
  Object.defineProperty(voiceState, 'lastSummary', {
    enumerable: true,
    get() {
      throw new Error('synthetic adapter failure');
    },
  });

  assert.doesNotThrow(() => buildTargetMetricBridge({ voiceState, mode: 'shadow' }));
  const bridge = buildTargetMetricBridge({ voiceState, mode: 'shadow' });
  assert.equal(bridge.error.code, 'target_metric_bridge_error');
  assert.equal(bridge.decision, null);
  assert.deepEqual(bridge.observations, []);

  const witness = buildTargetMetricShadowWitness(bridge, {
    coachingDecision: { primaryFocus: 'resonance_forward' },
  });
  assert.equal(witness.outcome, 'error');
  assert.equal(witness.error_code, 'target_metric_bridge_error');
});

test('a bridge error is categorically ineligible for learner-facing activation', () => {
  const bridge = {
    schema: 'transvoice.target_metric_bridge.v2',
    mode: 'active',
    decision: null,
    canonicalContext: null,
    error: { code: 'target_metric_bridge_error' },
    allowUnreviewedCues: true,
  };
  const signal = {
    mode: 'active_drill',
    policy: { shouldCorrect: true, safetyState: 'normal', coachingAction: 'coach' },
    takeQuality: { usable: true },
    capture: { reliability: 'good' },
    sessionScope: { tier: 'full' },
  };
  const eligibility = activationEligibility(signal, bridge);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('bridge_error'));
});
