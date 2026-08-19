'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSignal,
  buildTargetFit,
  buildHistory,
  deriveConsecutiveMisses,
  detectIssues,
  resolveMetricContract,
} = require('./signal-builder');
const { buildRendererMessages, buildRendererUserMessage } = require('./renderer-client');

const NOW = 1_800_000_000_000;

function pythonSummary(overrides = {}) {
  return {
    ...overrides,
    targetPreset: 'everyday-feminine',
    metrics: {
      meanPitchHz: 130,
      pitchRangeSt: 2.8,
      resonanceMean: 0.2,
      weightMean: 0.7,
      targetHitPct: 0.1,
      similarityScore: 0.4,
      advanced: {
        measurementAvailable: true,
        measurementRejectionReasons: [],
        voicedFramePct: 0.9,
        scoreConfidence: 0.9,
        pitchP10Hz: 125,
        pitchP90Hz: 135,
        pitchTargetOccupancyPct: 90,
        phraseFinalDropSemitones: -1.5,
        reliabilityFlags: [],
      },
    },
    target: {
      source: 'custom-handmade',
      targetPreset: 'everyday-feminine',
      targetProfileId: 'custom-low',
      direction: 'feminine',
      pitchFloorHz: 120,
      pitchCeilingHz: 140,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
      minTargetHitPct: 0.25,
      pitchPlacement: 'in_band',
      ...overrides.target,
    },
    targetPreset: overrides.targetPreset || 'everyday-feminine',
  };
}

test('real Python metric names and custom bands drive target fit', () => {
  const summary = pythonSummary();
  const fit = buildTargetFit({}, summary, summary.metrics.advanced, {}, {});

  assert.equal(fit.pitch.status, 'in_band');
  assert.equal(fit.pitch.percentInBand, 90);
  assert.equal(fit.resonance.status, 'target');
  assert.equal(fit.weight.status, 'target');
  assert.match(fit.resonance.evidence, /20%/);
  assert.match(fit.weight.evidence, /70%/);
});

// 2026-07-26 MTF-ONLY: RETAINED, not re-pointed. These fixtures deliberately keep
// the RETIRED `direction: 'masculine'` value, because their invariant is exactly
// the one the retirement had to preserve: when a custom target supplies EXACT
// bands, the fit is computed from the bands and the direction field is not
// consulted at all. That makes them the regression pin proving a stored FTM
// session's dark/heavy target is still scored target-relatively — never
// re-scored as if the learner had wanted a brighter, lighter voice.
test('a dark/heavy custom target keeps coordinate-side semantics from its exact bands', () => {
  const masculine = pythonSummary({
    targetPreset: 'masculine',
    target: {
      source: 'custom-handmade',
      targetPreset: 'masculine',
      direction: 'masculine',
      pitchFloorHz: 95,
      pitchCeilingHz: 145,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
      pitchPlacement: 'in_band',
    },
  });
  masculine.metrics.meanPitchHz = 120;
  masculine.metrics.resonanceMean = 0.42;
  masculine.metrics.weightMean = 0.45;
  const mascFit = buildTargetFit({}, masculine, masculine.metrics.advanced, {}, {});
  assert.equal(mascFit.resonance.status, 'too_bright');
  assert.equal(mascFit.weight.status, 'too_light');

  const neutral = pythonSummary({
    targetPreset: 'gender-neutral',
    target: {
      source: 'custom-handmade',
      targetPreset: 'gender-neutral',
      direction: 'neutral',
      pitchFloorHz: 150,
      pitchCeilingHz: 170,
      resonanceFloor: 0.25,
      resonanceCeiling: 0.35,
      weightFloor: 0.4,
      weightCeiling: 0.5,
      pitchPlacement: 'in_band',
    },
  });
  neutral.metrics.meanPitchHz = 160;
  neutral.metrics.resonanceMean = 0.2;
  neutral.metrics.weightMean = 0.55;
  const neutralFit = buildTargetFit({}, neutral, neutral.metrics.advanced, {}, {});
  assert.equal(neutralFit.resonance.status, 'too_dark');
  assert.equal(neutralFit.weight.status, 'too_heavy');
});

test('a dark/heavy custom target coaches toward its exact bands, never with feminizing fallback copy', () => {
  const summary = pythonSummary({
    targetPreset: 'masculine',
    target: {
      source: 'custom-handmade',
      targetPreset: 'masculine',
      direction: 'masculine',
      pitchFloorHz: 95,
      pitchCeilingHz: 145,
      resonanceFloor: 0.1,
      resonanceCeiling: 0.3,
      weightFloor: 0.6,
      weightCeiling: 0.8,
      pitchPlacement: 'in_band',
    },
  });
  summary.metrics.meanPitchHz = 120;
  summary.metrics.resonanceMean = 0.42;
  summary.metrics.weightMean = 0.7;
  summary.metrics.targetHitPct = 0.8;
  summary.metrics.similarityScore = 0.8;
  const signal = buildSignal({
    voiceState: {
      targetPreset: 'masculine',
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });

  assert.equal(signal.coachingDecision.primaryFocus, 'resonance_forward');
  assert.equal(signal.coachingDecision.recommendedDrill.id, 'starter-settle-back');
  // 2026-07-26: the cue is now stated as an ARTICULATOR action. The direction
  // invariant is unchanged — it must move BACK/darker and never feminize.
  assert.match(signal.coachMove.cue, /settle back|back of the mouth/i);
  assert.match(signal.coachMove.cue, /\btongue\b/i);
  assert.doesNotMatch(signal.coachMove.cue, /brighten|lighter|smile/i);
  assert.doesNotMatch(signal.coachingDecision.successCriteria.join(' | '), /forward|lighter|bright|smile/i);
});

test('canonical targetHit fractions render and trend as percentages', () => {
  const history = buildHistory({
    recentAttempts: [
      { meanPitchHz: 180, targetHitPct: 0.55 },
      { meanPitchHz: 182, targetHitPct: 0.70 },
      { meanPitchHz: 184, targetHitPct: 0.82 },
    ],
  });
  assert.match(history.last3TakeSummary, /55%/);
  assert.match(history.last3TakeSummary, /70%/);
  assert.match(history.last3TakeSummary, /82%/);
  assert.equal(history.trend, 'improving');
});

test('canonical resonance and weight fields generate a real issue, not a default', () => {
  const summary = pythonSummary();
  summary.metrics.resonanceMean = 0.45;
  const issues = detectIssues({ lastSummary: summary }, 'active_drill');
  assert.equal(issues.primaryIssue, 'resonance_too_forward');
  assert.match(issues.plainEvidence, /45%/);
});

test('unavailable measurement cannot create praise, focus, drill, target fit, or Fable contradiction', () => {
  const summary = pythonSummary();
  summary.metrics.advanced = {
    measurementAvailable: false,
    measurementRejectionReasons: ['no_voiced_frames'],
    voicedFramePct: 0,
    scoreConfidence: 0,
    phraseFinalDropSemitones: 0,
    reliabilityFlags: ['no_voiced_frames', 'low_voiced_coverage'],
  };
  const voiceState = {
    lastSummary: summary,
    lastAttemptArtifact: { finalizedAt: NOW - 1000 },
  };
  const signal = buildSignal({ voiceState, now: NOW });
  const prompt = buildRendererUserMessage(signal);

  assert.equal(signal.takeQuality.usable, false);
  assert.equal(signal.coachingDecision.primaryFocus, 'none');
  assert.equal(signal.coachingDecision.reason, '');
  assert.equal(signal.coachingDecision.recommendedDrill.instruction, '');
  assert.equal(signal.decisionWitness.intent.takeEvidence.reason, 'measurement_unavailable');
  assert.ok(signal.decisionWitness.metricContract.failures.includes('measurement_unavailable'));
  assert.match(prompt, /TakeQuality: not usable/);
  assert.doesNotMatch(prompt, /TargetFit:/);
  assert.doesNotMatch(prompt, /Focus:/);
  assert.doesNotMatch(prompt, /Reason:/);
  assert.doesNotMatch(prompt, /Drill:/);
  assert.doesNotMatch(prompt, /phrase_ending|dropping or wavering/i);
});

test('successful no-issue take has no fabricated phrase-ending correction', () => {
  const summary = pythonSummary();
  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });
  const prompt = buildRendererUserMessage(signal);
  assert.equal(signal.coachMove.intent, 'acknowledge_win');
  assert.equal(signal.coachingDecision.primaryFocus, 'none');
  assert.doesNotMatch(prompt, /Focus:/);
  assert.doesNotMatch(prompt, /Drill:/);
  assert.doesNotMatch(prompt, /phrase_ending|dropping or wavering/i);
});

test('phrase-final semitones pass through without treating an Hz delta as a frequency', () => {
  const summary = pythonSummary();
  summary.metrics.advanced.phraseEndDropHz = 4;
  summary.metrics.advanced.phraseFinalDropSemitones = -1.5;
  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });
  assert.equal(signal.audioMetrics.phraseFinalDropSemitones, -1.5);
});

test('healthy complete target contract has zero contract-failure witnesses', () => {
  const summary = pythonSummary();
  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });
  assert.deepEqual(signal.decisionWitness.metricContract.failures, []);
  assert.equal(signal.decisionWitness.metricContract.targetSource, 'custom-handmade');
  assert.equal(signal.decisionWitness.metricContract.targetProfileId, 'custom-low');
  assert.equal(signal.decisionWitness.metricContract.legacyMetricFields.length, 0);
});

test('optional custom profile identity does not invalidate current exact-band scoring', () => {
  const summary = pythonSummary({ target: { targetProfileId: null } });
  const contract = resolveMetricContract({ lastSummary: summary }, summary);
  const fit = buildTargetFit({}, summary, summary.metrics.advanced, {}, {});
  assert.equal(contract.hasTargetContract, true);
  assert.deepEqual(contract.targetValidationFailures, []);
  assert.deepEqual(contract.targetIdentityFailures, ['missing_target_profile_identity']);
  assert.equal(contract.target.targetKey, null);
  assert.notEqual(fit.pitch.status, 'uncertain');

  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    learnerContext: {
      recentAttempts: [{
        targetPreset: summary.targetPreset,
        targetSource: 'custom-handmade',
        targetHitPct: 0.9,
      }],
    },
    now: NOW,
  });
  assert.equal(signal.decisionWitness.metricContract.targetContractPresent, true);
  assert.equal(signal.decisionWitness.metricContract.targetIdentityPresent, false);
  assert.deepEqual(signal.decisionWitness.metricContract.failures, []);
  assert.equal(signal.history.last3TakeSummary, 'No prior takes in this session.');
});

test('missing metric and target fields remain null instead of becoming zero', () => {
  const contract = resolveMetricContract({
    targetPreset: 'everyday-feminine',
    lastSummary: {
      targetPreset: 'everyday-feminine',
      metrics: {
        advanced: { measurementAvailable: true },
      },
      target: {
        source: 'preset',
        targetPreset: 'everyday-feminine',
        direction: 'feminine',
      },
    },
  });

  assert.deepEqual(contract.values, {
    meanPitchHz: null,
    resonanceMean: null,
    weightMean: null,
    targetHitFraction: null,
  });
  assert.equal(contract.target.pitchFloorHz, null);
  assert.equal(contract.target.resonanceFloor, null);
  assert.equal(contract.target.weightCeiling, null);
  assert.equal(contract.hasTargetContract, false);
});

test('degraded one-frame-like capture cannot coach, trend, or attach audio', () => {
  const summary = pythonSummary();
  Object.assign(summary.metrics.advanced, {
    measurementAvailable: true,
    scoreConfidence: 0.05,
    voicedFramePct: 0.01,
    pitchValidFrameCount: 1,
    reliabilityFlags: ['low_voiced_coverage', 'low_score_confidence'],
    glideSmoothness: 0.91,
  });
  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000, repContext: { kind: 'siren' } },
      referenceAnalysis: {
        clipId: 'reference-should-not-align',
        filename: 'reference.wav',
        metrics: { meanPitchHz: 205, resonanceMean: 0.61, weightMean: 0.31 },
      },
    },
    repContext: { kind: 'siren' },
    now: NOW,
  });
  const prompt = buildRendererUserMessage(signal);
  const messages = buildRendererMessages(signal, [], { audioBase64: 'AAAA', audioFormat: 'wav' });

  assert.equal(signal.takeQuality.usable, false);
  assert.deepEqual(signal.kindMetrics, {});
  assert.equal(signal.targetFit.pitch.status, 'uncertain');
  assert.equal(signal.targetFit.resonance.status, 'uncertain');
  assert.equal(signal.targetFit.weight.status, 'uncertain');
  assert.equal(signal.referenceFit.enabled, false);
  assert.equal(signal.referenceFit.alignmentScore, null);
  assert.equal(signal.coachingDecision.primaryFocus, 'none');
  assert.ok(signal.decisionWitness.metricContract.failures.includes('measurement_unusable_for_scoring'));
  assert.ok(signal.decisionWitness.metricContract.failures.includes('low_score_confidence'));
  assert.match(prompt, /CardOps: DISABLED/);
  assert.doesNotMatch(prompt, /KindMetrics:|TargetFit:|Focus:|Drill:/);
  assert.equal(messages.some((message) => Array.isArray(message.content)), false);
});

test('no-voice rejection reason is fatal even when all numeric quality fields look healthy', () => {
  const summary = pythonSummary();
  Object.assign(summary.metrics.advanced, {
    measurementAvailable: true,
    measurementRejectionReasons: ['no_voiced_frames'],
    reliabilityFlags: [],
    scoreConfidence: 0.9,
    voicedFramePct: 0.9,
    confidentFramePct: 0.9,
    captureReliability: 0.9,
  });
  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });

  assert.equal(signal.takeQuality.usable, false);
  assert.equal(signal.coachingDecision.primaryFocus, 'none');
  assert.equal(signal.targetFit.pitch.status, 'uncertain');
  assert.ok(signal.decisionWitness.metricContract.failures.includes('no_voiced_frames'));

  summary.metrics.advanced.measurementRejectionReasons = [];
  summary.metrics.advanced.rejectionReasons = ['no_voiced_frames'];
  const legacyAliasSignal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });
  assert.equal(legacyAliasSignal.takeQuality.usable, false);
  assert.ok(legacyAliasSignal.decisionWitness.metricContract.failures.includes('no_voiced_frames'));
});

test('target source is a closed category in the coaching contract and witnesses', () => {
  const summary = pythonSummary();
  summary.target.source = 'TARGET_IDENTIFIER_SECRET';
  const contract = resolveMetricContract({ lastSummary: summary }, summary);
  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });

  assert.equal(contract.target.source, 'unknown');
  assert.ok(contract.targetValidationFailures.includes('invalid_target_source'));
  assert.equal(signal.decisionWitness.metricContract.targetSource, 'unknown');
  assert.ok(signal.decisionWitness.metricContract.failures.includes('invalid_target_source'));
  assert.doesNotMatch(JSON.stringify(signal), /TARGET_IDENTIFIER_SECRET/);
});

test('rejected learner attempts cannot create Fable history, wins, or misses', () => {
  const learnerContext = {
    recentAttempts: [
      { meanPitchHz: 180, targetHitPct: 0.7, usableForLearning: true },
      {
        meanPitchHz: 250,
        targetHitPct: 0.9,
        usableForLearning: false,
        measurementAvailable: false,
        rejectionReasons: ['no_voiced_frames'],
      },
      {
        meanPitchHz: 100,
        targetHitPct: 0.1,
        usableForLearning: false,
        measurementAvailable: false,
        rejectionReasons: ['no_voiced_frames'],
      },
    ],
  };
  const history = buildHistory(learnerContext);
  assert.equal(history.last3TakeSummary, 't1: 180Hz/70%');
  assert.equal(history.trend, 'uncertain');
  assert.equal(deriveConsecutiveMisses(learnerContext), 0);

  const summary = pythonSummary();
  summary.metrics.targetHitPct = 0.4;
  const signal = buildSignal({
    voiceState: {
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    learnerContext,
    now: NOW,
  });
  assert.notEqual(signal.personalization.recentWin, 'Target hit improved in the last few attempts.');
  assert.doesNotMatch(buildRendererUserMessage(signal), /250Hz|100Hz|90% ·|10%/);
});

test('malformed custom bands fail closed and produce named telemetry failures', () => {
  const summary = pythonSummary({
    target: {
      source: 'custom-handmade',
      targetProfileId: 'broken-custom',
      direction: 'masculine',
      pitchFloorHz: 5000,
      pitchCeilingHz: 50,
      resonanceFloor: 0.9,
      resonanceCeiling: 0.1,
      weightFloor: -3,
      weightCeiling: 2,
    },
  });
  const contract = resolveMetricContract({ targetPreset: 'masculine' }, summary);
  assert.equal(contract.hasTargetContract, false);
  assert.equal(contract.target.pitchFloorHz, null);
  assert.ok(contract.targetValidationFailures.includes('invalid_target_pitch_band_range'));
  assert.ok(contract.targetValidationFailures.includes('invalid_target_pitch_band_order'));
  assert.ok(contract.targetValidationFailures.includes('invalid_target_resonance_band_order'));
  assert.ok(contract.targetValidationFailures.includes('invalid_target_weight_band_range'));

  const signal = buildSignal({
    voiceState: {
      targetPreset: 'masculine',
      lastSummary: summary,
      lastAttemptArtifact: { finalizedAt: NOW - 1000 },
    },
    now: NOW,
  });
  assert.equal(signal.targetFit.pitch.status, 'uncertain');
  assert.equal(signal.targetFit.resonance.status, 'uncertain');
  assert.equal(signal.targetFit.weight.status, 'uncertain');
  assert.ok(signal.decisionWitness.metricContract.failures.includes('missing_target_contract'));
  assert.ok(signal.decisionWitness.metricContract.failures.includes('invalid_target_pitch_band_range'));
});
