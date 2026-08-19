'use strict';

// 2026-07-19 zero-friction wave: takeKind + kindMetrics (the per-kind metric
// contract). Resolution order drill kind/tags/id -> practiceMode -> 'phrase';
// each kind carries ONLY the metrics honest for it; per-kind doNotSay entries
// ride the existing buildDoNotSay path; the decision witness names all of it.
// Prediction: all assertions pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSignal,
  resolveTakeKind,
  buildKindMetrics,
  detectIssues,
  TAKE_KIND_DO_NOT_SAY,
  TAKE_KINDS,
} = require('./signal-builder');
const { isValidCoachingSignal } = require('./signal-schema');

function voiceStateWithMetrics(overrides = {}) {
  return {
    lastSummary: {
      metrics: {
        meanPitchHz: 180,
        resonancePct: 48,
        weightPct: 40,
        pitchRangeSt: 14.2,
        advanced: {
          pitchP10Hz: 140,
          pitchP90Hz: 320,
          pitchStdSt: 1.4,
          spectralCentroidMeanHz: 1900,
          glideSmoothness: 0.81,
          f2RangeHz: 420,
          trillRateHz: 24.5,
          trillDurationMs: 900,
          phraseEndDropHz: 18,
          scoreConfidence: 0.9,
          formantLite: { f2MedianHz: 1750, frontnessScore: 0.62 },
          quality: { strainRisk: 0.3, breathyRisk: 0.2, cppsLike: 14.1, harmonicStrength: 18.4, jitterLocal: 0.012 },
        },
      },
    },
    lastAttemptArtifact: { finalizedAt: Date.now() },
    targetVoiceProfile: {
      resonancePct: 60,
      weightPct: 38,
      advancedBands: { pitchP90HzCeiling: 300 },
    },
    ...overrides,
  };
}

test('resolveTakeKind: drill kind -> tag -> id -> mode -> default order', () => {
  assert.deepEqual(resolveTakeKind({ drill: { kind: 'siren' } }, 'active_drill'), { kind: 'siren', source: 'drill-kind' });
  assert.deepEqual(resolveTakeKind({ drill: { tags: ['warmup', 'hum'] } }, 'active_drill'), { kind: 'hum_sovt', source: 'drill-tag' });
  assert.deepEqual(resolveTakeKind({ drill: { id: 'starter-lip-trill-2' } }, 'active_drill'), { kind: 'trill', source: 'drill-id' });
  assert.deepEqual(resolveTakeKind(null, 'conversation_practice'), { kind: 'spontaneous', source: 'mode' });
  assert.deepEqual(resolveTakeKind(null, 'active_drill'), { kind: 'phrase', source: 'default' });
  // aliases normalize (dash/space forms; B-FLOW kind spellings)
  assert.equal(resolveTakeKind({ kind: 'hum-sovt' }, 'active_drill').kind, 'hum_sovt');
  assert.equal(resolveTakeKind({ drill: { tags: ['sovt'] } }, 'active_drill').kind, 'hum_sovt');
  assert.equal(resolveTakeKind({ drill: { kind: 'Resonance Play' } }, 'active_drill').kind, 'resonance_play');
  // junk shapes never crash and fall through
  assert.equal(resolveTakeKind({ drill: { kind: 42, tags: 'nope' } }, 'active_drill').kind, 'phrase');
});

test('kindMetrics table: each kind carries only its honest metrics', () => {
  const vs = voiceStateWithMetrics();
  const metrics = vs.lastSummary.metrics;
  const advanced = metrics.advanced;
  const parts = {
    metrics,
    advanced,
    quality: advanced.quality,
    formantLite: advanced.formantLite,
    targetProfile: vs.targetVoiceProfile,
    strainThresholds: { warn: 0.62, stop: 0.7 },
  };

  const siren = buildKindMetrics('siren', parts);
  assert.deepEqual(Object.keys(siren).sort(), ['glideSmoothness', 'hitPitchCeiling', 'rangeSt', 'topNoteStrainFlag']);
  assert.equal(siren.rangeSt, 14.2);
  assert.equal(siren.glideSmoothness, 0.81);
  assert.equal(siren.hitPitchCeiling, true); // p90 320 >= ceiling 300
  assert.equal(siren.topNoteStrainFlag, false); // 0.3 < lenient warn 0.62

  const sustained = buildKindMetrics('sustained', parts);
  assert.deepEqual(Object.keys(sustained).sort(), ['cppsLike', 'hnr', 'jitterLocal', 'pitchStdSt']);
  assert.equal(sustained.hnr, 18.4); // quality.harmonicStrength (dB)

  const hum = buildKindMetrics('hum_sovt', parts);
  assert.deepEqual(Object.keys(hum).sort(), ['centroidHz', 'hnr', 'pitchStdSt']);
  // The law: NO F2/frontness on a hum — the resonance read would lie.
  assert.ok(!('f2MedianHz' in hum) && !('frontnessScore' in hum) && !('f2RangeHz' in hum));

  const resonance = buildKindMetrics('resonance_play', parts);
  assert.deepEqual(Object.keys(resonance).sort(), ['f2MedianHz', 'f2RangeHz', 'frontnessScore']);
  assert.equal(resonance.f2RangeHz, 420); // B-DSP proxy

  const trill = buildKindMetrics('trill', parts);
  assert.deepEqual(Object.keys(trill).sort(), ['trillDetected', 'trillDurationMs', 'trillRateHz']);
  assert.equal(trill.trillDetected, true);
  assert.equal(trill.trillRateHz, 24.5);

  assert.deepEqual(buildKindMetrics('ear_training', parts), {});
  assert.deepEqual(buildKindMetrics('silent', parts), {});
  assert.deepEqual(buildKindMetrics('phrase', parts), {});

  // Null-tolerant: an artifact with none of the proxies yields nulls, no crash.
  const empty = buildKindMetrics('siren', {});
  assert.equal(empty.rangeSt, null);
  assert.equal(empty.glideSmoothness, null);
  assert.equal(empty.hitPitchCeiling, false);

  // B-DSP proxies are EXPLICITLY nullable: a null must stay null, never
  // become 0 (the Number(null)===0 trap).
  const nullTrill = buildKindMetrics('trill', { advanced: { trillRateHz: null, trillDurationMs: null } });
  assert.equal(nullTrill.trillRateHz, null);
  assert.equal(nullTrill.trillDurationMs, null);
  assert.equal(nullTrill.trillDetected, false);
  const nullSiren = buildKindMetrics('siren', { advanced: { glideSmoothness: null } });
  assert.equal(nullSiren.glideSmoothness, null);
});

test('buildSignal: takeKind + kindMetrics + witness ride the signal', () => {
  const signal = buildSignal({
    voiceState: voiceStateWithMetrics(),
    repContext: { drill: { id: 'glide-1', kind: 'siren' } },
  });
  assert.equal(signal.takeKind, 'siren');
  assert.equal(signal.kindMetrics.hitPitchCeiling, true);
  assert.ok(isValidCoachingSignal(signal));
  // witness: kind + source + which fields resolved + strain interpretation
  assert.equal(signal.decisionWitness.takeKind.kind, 'siren');
  assert.equal(signal.decisionWitness.takeKind.source, 'drill-kind');
  assert.ok(signal.decisionWitness.takeKind.metricsFields.includes('rangeSt'));
  assert.equal(signal.decisionWitness.strainInterpretation, 'vocalise-lenient');
  assert.equal(signal.decisionWitness.sessionScope.tier, 'full');
  // schema guard: an out-of-vocabulary takeKind fails validation
  assert.ok(!isValidCoachingSignal({ ...signal, takeKind: 'interpretive_dance' }));
  assert.ok(TAKE_KINDS.includes('siren'));
});

test('spontaneous drops the contour-fit audioMetrics fields; phrase keeps them', () => {
  const spontaneous = buildSignal({
    voiceState: voiceStateWithMetrics(),
    repContext: { kind: 'spontaneous' },
  });
  assert.equal(spontaneous.takeKind, 'spontaneous');
  assert.equal(spontaneous.audioMetrics.phraseFinalDropHz, null);
  assert.equal(spontaneous.audioMetrics.phraseFinalDropSemitones, null);

  const phrase = buildSignal({ voiceState: voiceStateWithMetrics() });
  assert.equal(phrase.takeKind, 'phrase');
  assert.equal(phrase.audioMetrics.phraseFinalDropHz, 18);
});

test('per-kind doNotSay: hum bans resonance/brightness numbers, trill bans stability/strain talk, siren bans NOTHING that could under-report', () => {
  const hum = buildSignal({ voiceState: voiceStateWithMetrics(), repContext: { kind: 'hum_sovt' } });
  assert.ok(hum.doNotSay.includes('frontness'));
  assert.ok(hum.doNotSay.includes('f2'));
  assert.ok(hum.doNotSay.includes('resonance percent'));

  const trill = buildSignal({ voiceState: voiceStateWithMetrics(), repContext: { kind: 'trill' } });
  assert.ok(trill.doNotSay.includes('jitter'));
  assert.ok(trill.doNotSay.includes('strain'));
  assert.ok(trill.doNotSay.includes('pitch stability'));

  const siren = buildSignal({ voiceState: voiceStateWithMetrics(), repContext: { kind: 'siren' } });
  // honest mirror: nothing in the siren ban list may suppress ceiling/range talk
  assert.ok(!siren.doNotSay.some((p) => /range|ceiling|top note/i.test(p)));
  assert.equal(TAKE_KIND_DO_NOT_SAY.siren, undefined);
});

test('honest-mirror issue suppression per kind (trill wobble, hum resonance, silent everything)', () => {
  // trill: pitch spread over ceiling would flag pitch_unstable on a phrase — not on a trill
  const wobbly = voiceStateWithMetrics();
  wobbly.lastSummary.metrics.advanced.pitchStdSt = 5.0;
  wobbly.targetVoiceProfile.advancedBands.pitchStdStCeiling = 1.5;
  const phraseIssues = detectIssues(wobbly, 'active_drill');
  assert.equal(phraseIssues.primaryIssue, 'pitch_unstable');
  const trillIssues = detectIssues(wobbly, 'active_drill', { takeKind: 'trill' });
  assert.notEqual(trillIssues.primaryIssue, 'pitch_unstable');
  assert.notEqual(trillIssues.secondaryIssue, 'pitch_unstable');

  // hum_sovt: a resonance delta must not become a resonance issue on a hum
  const dark = voiceStateWithMetrics();
  const humIssues = detectIssues(dark, 'active_drill', { takeKind: 'hum_sovt' });
  assert.ok(!/resonance/.test(humIssues.primaryIssue || ''));

  // silent/ear_training: nothing to critique at all
  assert.equal(detectIssues(wobbly, 'active_drill', { takeKind: 'silent' }).primaryIssue, null);
  assert.equal(detectIssues(wobbly, 'active_drill', { takeKind: 'ear_training' }).primaryIssue, null);
});
