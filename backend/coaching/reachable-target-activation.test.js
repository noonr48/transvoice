'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeObservation } = require('./metric-observations');
const {
  activationEligibility,
  applyTargetMetricDecision,
  buildTargetMetricShadowWitness,
} = require('./target-metric-bridge');

function observation({ reachable = false } = {}) {
  const raw = {
    metricId: 'pitch.median_hz',
    metricDefinitionVersion: 'voice-metrics-v4-formants',
    dimension: 'pitch.register',
    value: 160,
    unit: 'Hz',
    confidence: { signal: 0.95, extractor: 0.95, target: 0.95 },
    target: {
      low: reachable ? 165 : 190,
      high: reachable ? null : 230,
      scale: 1,
      source: 'reference',
      targetKey: 'target-1',
      confidence: 0.95,
    },
    attemptArtifactId: 'attempt-1',
    taskId: 'phrase-1',
    takeKind: 'phrase',
    analysisProfile: 'standard',
    flags: [],
    metadata: {
      targetScaleUnit: 'semitone',
      detectorFamily: 'yin',
      pitchValidFrameCount: 40,
      hitPitchCeiling: false,
      ...(reachable ? {
        trainingTargetApplied: true,
        trainingTargetStatus: 'reachable_step_ready',
        trainingTargetPolicyId: 'calibrated.pitch.step.v1',
        trainingTargetPolicyVersion: '2026-08-validation-1',
        aspirationalTarget: {
          low: 190,
          high: 230,
          source: 'reference',
          targetKey: 'target-1',
        },
      } : {
        trainingTargetApplied: false,
        trainingTargetStatus: 'aspirational_only',
      }),
    },
  };
  return normalizeObservation(raw);
}

function decisionFor(obs) {
  return {
    status: 'coach',
    focus: {
      metricId: obs.metricId,
      dimension: obs.dimension,
      direction: 'below',
      comparisonKey: obs.comparisonKey,
      targetKey: obs.target.targetKey,
      taskId: obs.taskId,
      takeKind: obs.takeKind,
    },
    reason: 'test',
    action: {
      cueId: 'pitch.register.small-glide-up.v1',
      instruction: 'test cue',
      successText: 'test success',
      reviewStatus: 'approved',
      protectedMetrics: [],
    },
  };
}

function bridgeFor(obs, { domain = 'feminization_v1', releaseValidated = false } = {}) {
  return {
    schema: 'transvoice.target_metric_bridge.v3',
    mode: 'active',
    observations: [obs],
    decision: decisionFor(obs),
    productPolicy: {
      domain,
      curriculumPhase: 'pitch_foundation',
      decisionObservationCount: 1,
      selectedDetectorAuthority: releaseValidated ? {
        authority: 'authoritative',
        reason: null,
        activeReleaseEligible: true,
        validationId: 'yin-v4-human-benchmark-test-v1',
        validationStatus: 'human_benchmark_validated',
        humanBenchmarkRequired: true,
      } : null,
    },
    canonicalContext: {
      freshness: { fresh: true },
      measurementUsable: true,
      measurementReasons: [],
      hasTargetContract: true,
      targetIdentityFailures: [],
      targetValidationFailures: [],
      targetKey: 'target-1',
      targetSource: 'reference',
      attemptArtifactId: 'attempt-1',
      taskId: 'phrase-1',
      takeKind: 'phrase',
      analysisProfile: 'standard',
    },
    allowUnreviewedCues: false,
    error: null,
  };
}

function safeSignal() {
  return {
    mode: 'active_drill',
    policy: {
      shouldCorrect: true,
      safetyState: 'normal',
      coachingAction: 'coach',
    },
    takeQuality: { usable: true },
    capture: { reliability: 'good' },
    sessionScope: { tier: 'full' },
    coachingDecision: {
      primaryFocus: 'pitch_floor',
      avoidCues: [],
    },
    coachMove: {},
  };
}

test('feminization_v1 aspirational gap cannot activate beginner coaching', () => {
  const obs = observation({ reachable: false });
  const eligibility = activationEligibility(safeSignal(), bridgeFor(obs));
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('reachable_training_target_not_ready'));
  assert.ok(eligibility.reasons.includes('reachable_training_target_policy_missing'));
  assert.equal(eligibility.trainingTarget.required, true);
  assert.equal(eligibility.trainingTarget.applied, false);
});

test('named and versioned reachable step can satisfy the target part of active eligibility', () => {
  const obs = observation({ reachable: true });
  const eligibility = activationEligibility(
    safeSignal(),
    bridgeFor(obs, { releaseValidated: true }),
  );
  assert.equal(eligibility.eligible, true);
  assert.deepEqual(eligibility.reasons, []);
  assert.equal(eligibility.trainingTarget.applied, true);
  assert.equal(eligibility.trainingTarget.status, 'reachable_step_ready');
  assert.equal(eligibility.trainingTarget.policyId, 'calibrated.pitch.step.v1');
  assert.equal(eligibility.trainingTarget.policyVersion, '2026-08-validation-1');
});

test('training target metadata must belong to the observation selected by comparison identity', () => {
  const selected = observation({ reachable: false });
  const unrelated = observation({ reachable: true });
  unrelated.taskId = 'other-task';
  unrelated.comparisonKey = normalizeObservation(unrelated).comparisonKey;
  const bridge = bridgeFor(selected);
  bridge.observations.push(unrelated);
  const eligibility = activationEligibility(safeSignal(), bridge);
  assert.equal(eligibility.eligible, false);
  assert.ok(eligibility.reasons.includes('reachable_training_target_not_ready'));
});

test('generic research domain is not forced through beginner reachable-step policy', () => {
  const obs = observation({ reachable: false });
  const eligibility = activationEligibility(
    safeSignal(),
    bridgeFor(obs, { domain: 'generic_research' }),
  );
  assert.equal(eligibility.trainingTarget.required, false);
  assert.equal(eligibility.eligible, true);
});

test('application does not mutate learner-facing signal when reachable target is absent', () => {
  const signal = safeSignal();
  const before = JSON.parse(JSON.stringify(signal));
  applyTargetMetricDecision(signal, bridgeFor(observation({ reachable: false })));
  assert.deepEqual(signal, before);
  assert.equal(Object.hasOwn(signal, 'targetMetricV3'), false);
});

test('successful active application records the reachable policy provenance', () => {
  const signal = safeSignal();
  applyTargetMetricDecision(
    signal,
    bridgeFor(observation({ reachable: true }), { releaseValidated: true }),
  );
  assert.equal(signal.targetMetricV3.activation.eligible, true);
  assert.equal(signal.targetMetricV3.activation.trainingTargetPolicyId, 'calibrated.pitch.step.v1');
  assert.equal(signal.targetMetricV3.activation.trainingTargetPolicyVersion, '2026-08-validation-1');
  assert.equal(signal.targetMetricV3.activation.detectorValidationId, 'yin-v4-human-benchmark-test-v1');
  assert.equal(signal.targetMetricV3.activation.detectorValidationStatus, 'human_benchmark_validated');
});

test('shadow witness exposes bounded reachable-target state for evaluation', () => {
  const witness = buildTargetMetricShadowWitness(
    bridgeFor(observation({ reachable: false })),
    safeSignal(),
  );
  assert.equal(witness.training_target_required, true);
  assert.equal(witness.training_target_applied, false);
  assert.equal(witness.training_target_status, 'aspirational_only');
  assert.equal(witness.training_target_policy_id, null);
});
