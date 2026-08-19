'use strict';

// Regression for the "no-audio turn collapses to breather" bug.
//
// A missing measurement (null/undefined telemetry) must NOT be read as a real bad
// measurement. `Number(null) === 0` is finite, so normalizeMetric() (and the
// voiceInputRuntime normalizers) once turned a default/unset snrDb / transcriptConfidence
// / captureReliability into a real 0. The capture-reliability checks use `< threshold`
// tests (snr<12, confidence<0.4, captureReliability<0.3), so 0 tripped them =>
// safetyState 'capture_only' / capture 'unusable' => resolvePolicy forced breather on
// EVERY turn that had no real audio capture (the eval all-breather collapse, and a
// latent production false-positive on typed/pre-audio turns). The fix: null/undefined
// stays null end-to-end (normalizeMetric + the two voiceInputRuntime normalizers).

const { test } = require('node:test');
const assert = require('node:assert');

const { assessSafetyState, assessCaptureReliability, collectAnalyzerSafetyReasons } = require('./safety-gates');

test('null/default telemetry => normal safety, good capture, no capture reasons', () => {
  const vs = {
    voiceInputRuntime: {
      lastSnrDb: null,
      lastTranscriptConfidence: null,
      lastCaptureReliability: null,
      lastClippingPct: null,
      lastOutcome: 'idle',
    },
  };
  assert.strictEqual(assessSafetyState(vs).state, 'normal');
  assert.strictEqual(assessCaptureReliability(vs), 'good');
  assert.deepStrictEqual(collectAnalyzerSafetyReasons(vs), []);
});

test('empty voiceState => normal safety / good capture', () => {
  assert.strictEqual(assessSafetyState({}).state, 'normal');
  assert.strictEqual(assessCaptureReliability({}), 'good');
});

test('a real bad SNR (5 dB) still trips capture_only', () => {
  const vs = { voiceInputRuntime: { lastSnrDb: 5, lastOutcome: 'ok' } };
  assert.strictEqual(assessSafetyState(vs).state, 'capture_only');
});

test('a real low captureReliability (0.2) still reports unusable', () => {
  const vs = { lastSummary: { metrics: { advanced: { captureReliability: 0.2 } } } };
  assert.strictEqual(assessCaptureReliability(vs), 'unusable');
});

test('real acoustic strain (0.8) still trips a hold/stop (voice-safety intact)', () => {
  const vs = { lastSummary: { metrics: { advanced: { quality: { strainRisk: 0.8 } } } } };
  const state = assessSafetyState(vs).state;
  assert.ok(state === 'stop' || state === 'fatigue_or_strain', `expected stop/fatigue, got ${state}`);
});

test('an EXPLICIT zero is a real (bad) measurement, not spared by the null-guard', () => {
  // The fix only spares null/undefined "no measurement". A genuine 0 dB SNR is silence
  // and must still be treated as a capture failure.
  const vs = { voiceInputRuntime: { lastSnrDb: 0, lastOutcome: 'ok' } };
  assert.strictEqual(assessSafetyState(vs).state, 'capture_only');
});

// ---------------------------------------------------------------------------
// Consumer-hardware capture wave (2026-07-19): the analyzer now PRODUCES
// attempt-level advanced.snrDb / clippingPct / captureReliability, so the
// artifact path (lastSummary/lastAttemptArtifact.summary -> metrics.advanced —
// the same read strainRisk uses) must actually fire, and the clipping bar is
// sustained-clipping (>=2%), not the old 0.1% hair-trigger.
// ---------------------------------------------------------------------------

test('artifact advanced.snrDb below 12 dB fires a capture reason via lastSummary', () => {
  const vs = { lastSummary: { metrics: { advanced: { snrDb: 8.2 } } } };
  const reasons = collectAnalyzerSafetyReasons(vs);
  assert.ok(reasons.some((r) => r.kind === 'capture' && /signal-to-noise/.test(r.label)), JSON.stringify(reasons));
  assert.strictEqual(assessSafetyState(vs).state, 'capture_only');
});

test('natural pauses with at least 20 valid pitch frames do not fabricate degraded capture', () => {
  const ample = {
    lastSummary: {
      metrics: {
        advanced: {
          voicedFramePct: 0.32,
          pitchValidFrameCount: 80,
          scoreConfidence: 0.8,
          captureReliability: 0.8,
        },
      },
    },
  };
  assert.strictEqual(assessCaptureReliability(ample), 'good');
  assert.ok(!collectAnalyzerSafetyReasons(ample).some((reason) => /voiced coverage/.test(reason.label)));

  const sparse = {
    lastSummary: {
      metrics: {
        advanced: {
          voicedFramePct: 0.32,
          pitchValidFrameCount: 19,
          scoreConfidence: 0.8,
          captureReliability: 0.8,
        },
      },
    },
  };
  assert.strictEqual(assessCaptureReliability(sparse), 'degraded');
  assert.ok(collectAnalyzerSafetyReasons(sparse).some((reason) => /voiced coverage/.test(reason.label)));
});

test('artifact advanced metrics fire via the lastAttemptArtifact.summary fallback too', () => {
  const vs = { lastAttemptArtifact: { summary: { metrics: { advanced: { snrDb: 6.0, captureReliability: 0.35 } } } } };
  const reasons = collectAnalyzerSafetyReasons(vs);
  assert.ok(reasons.some((r) => /signal-to-noise/.test(r.label)), JSON.stringify(reasons));
  assert.ok(reasons.some((r) => /capture reliability/.test(r.label)), JSON.stringify(reasons));
  assert.strictEqual(assessCaptureReliability(vs), 'low');
});

test('clipping below the sustained bar (1%) no longer fires; 2%+ does', () => {
  const mild = { lastSummary: { metrics: { advanced: { clippingPct: 0.01 } } } };
  assert.deepStrictEqual(
    collectAnalyzerSafetyReasons(mild).filter((r) => /clipping/.test(r.label)),
    [],
  );
  const sustained = { lastSummary: { metrics: { advanced: { clippingPct: 0.025 } } } };
  const reasons = collectAnalyzerSafetyReasons(sustained);
  assert.ok(reasons.some((r) => r.kind === 'capture' && /clipping/.test(r.label)), JSON.stringify(reasons));
});

test('capture faults are capture_only holds — never a stop, all reasons capture-kind resets', () => {
  const vs = {
    lastSummary: { metrics: { advanced: { snrDb: 4, clippingPct: 0.3, captureReliability: 0.1 } } },
    voiceInputRuntime: { lastOutcome: 'ok' },
  };
  const reasons = collectAnalyzerSafetyReasons(vs);
  assert.ok(reasons.length >= 3, JSON.stringify(reasons));
  assert.ok(reasons.every((r) => r.kind === 'capture' && r.severity === 'reset'), JSON.stringify(reasons));
  const state = assessSafetyState(vs);
  assert.strictEqual(state.state, 'capture_only');
  assert.strictEqual(state.captureOnly, true);
});

test('mic-check runtime fields (lastClippingPct/lastCaptureReliability) reach the gates', () => {
  const vs = {
    voiceInputRuntime: { lastClippingPct: 0.05, lastCaptureReliability: 0.4, lastOutcome: 'ok' },
  };
  const reasons = collectAnalyzerSafetyReasons(vs);
  assert.ok(reasons.some((r) => /clipping/.test(r.label)), JSON.stringify(reasons));
  assert.ok(reasons.some((r) => /capture reliability/.test(r.label)), JSON.stringify(reasons));
  assert.strictEqual(assessCaptureReliability(vs), 'low');
});
