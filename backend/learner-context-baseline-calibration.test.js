'use strict';

// 2026-07-26 — BASELINE HONESTY across an analyzer calibration change.
//
// A frozen baseline is a promise that its numbers and a later take were produced
// by the same instrument. The formant repair at 8b0a19b broke that promise for
// every baseline frozen before it: front-vowel F2 had been reading ~798 Hz
// against a true 2761, so `resonance = 0.80*clamp((F2-1250)/900) + ...` collapsed
// to ~0.0 on exactly the vowels a feminine target is brightest on. Post-repair
// the SAME voice measures ~0.8. Subtracting a v3 baseline from a v4 take
// therefore reports roughly +78 percentage points of resonance "improvement" that
// nobody produced.
//
// The built-in-preset case is the one that had no defence at all: the targetKey
// for a built-in target hashes only ('vt1', 'built-in', targetPreset), with no
// analyzer version in it (voice-target-identity.js), so a pre-v4 baseline stays
// addressable and keeps being compared. Custom/reference targets fold the
// TARGET's analysisVersion into the key, so a re-analysis re-keys them; that is a
// side effect of identity, not a measurement-honesty guarantee, and it does not
// cover built-ins.
//
// Three behaviours are pinned here, matching the ruling:
//   1. pre-v4-stamped baseline + v4 take -> no numeric VsBaseline, and a refreeze
//   2. same-version baseline + take      -> unchanged numeric behaviour
//   3. missing stamp (legacy)            -> treated as a version mismatch

const test = require('node:test');
const assert = require('node:assert/strict');

const { createLearnerContextService } = require('./learner-context-service');
const {
  buildHistory,
  buildSignal,
  pickBaseline,
  BASELINE_RECALIBRATED_NOTE,
  isBaselineCalibrationComparable,
} = require('./coaching/signal-builder');
const { buildCoachingSignal } = require('./coaching/signal-schema');
const { buildRendererUserMessage } = require('./coaching/renderer-client');

const V4 = 'voice-metrics-v4-formants';
const V3 = 'voice-metrics-v3';
const TARGET_PRESET = 'cute-feminine';

// Measured v4 resonance for a front-vowel-leaning feminine take, and what the
// same voice read through the pre-v4 selector.
const V4_RESONANCE = 0.80;
const V3_RESONANCE = 0.02;

function makeMemFs() {
  const files = new Map();
  const dirs = new Set();
  return {
    files,
    existsSync: (p) => files.has(p) || dirs.has(p),
    mkdirSync: (p) => { dirs.add(p); },
    chmodSync: () => {},
    readFileSync: (p) => {
      if (!files.has(p)) throw new Error(`ENOENT ${p}`);
      return files.get(p);
    },
    writeFileSync: (p, data) => { files.set(p, data); },
    appendFileSync: (p, data) => { files.set(p, (files.get(p) || '') + data); },
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); },
    unlinkSync: (p) => { files.delete(p); },
    readdirSync: () => [],
    statSync: () => ({ size: 0, mtimeMs: 0 }),
    rmSync: (p) => { files.delete(p); },
  };
}

let clock = 1_700_000_000_000;
function makeService() {
  clock = 1_700_000_000_000;
  return createLearnerContextService({
    fsModule: makeMemFs(),
    logger: { warn() {} },
    now: () => (clock += 1000),
    storageRoot: '/tmp/lc-baseline-calibration-test',
  });
}

function takeSummary({ analysisVersion, resonanceMean, meanPitchHz = 205, targetHitPct = 0.6 }) {
  return {
    targetPreset: TARGET_PRESET,
    ...(analysisVersion === undefined ? {} : { analysisVersion }),
    metrics: {
      meanPitchHz,
      pitchRangeSt: 3,
      resonanceMean,
      weightMean: 0.2,
      targetHitPct,
      advanced: {
        measurementAvailable: true,
        scoreConfidence: 0.9,
        voicedFramePct: 0.9,
        confidentFramePct: 0.85,
        captureReliability: 0.9,
        reliabilityFlags: [],
      },
    },
  };
}

/** Record n takes at one calibration; returns the service. */
function recordTakes(svc, studentId, { analysisVersion, resonanceMean, count = 3, prefix, ...rest }) {
  for (let i = 0; i < count; i += 1) {
    svc.recordVoiceAttempt(studentId, {
      attemptId: `${prefix}-${i}`,
      summary: takeSummary({ analysisVersion, resonanceMean, ...rest }),
    });
  }
  return svc;
}

async function historyFor(svc, studentId) {
  const snapshot = await svc.getVoiceStudentModelSnapshot(studentId);
  return {
    snapshot,
    baseline: snapshot.learnerContext.baseline,
    history: buildHistory(snapshot, snapshot.learnerContext.baseline),
  };
}

function renderedLines(history) {
  const signal = buildCoachingSignal({ history });
  return buildRendererUserMessage(signal).split('\n');
}

// ---------------------------------------------------------------------------
// 1. SAME VERSION — unchanged numeric behaviour
// ---------------------------------------------------------------------------

test('same-calibration baseline and take render the numeric VsBaseline unchanged', async () => {
  const svc = makeService();
  const student = 'same-version-student';
  recordTakes(svc, student, {
    analysisVersion: V4, resonanceMean: 0.40, prefix: 'base', count: 3,
  });
  svc.recordVoiceAttempt(student, {
    attemptId: 'later',
    summary: takeSummary({ analysisVersion: V4, resonanceMean: 0.55, meanPitchHz: 215 }),
  });

  const { baseline, history } = await historyFor(svc, student);
  assert.equal(baseline.measurementAnalysisVersion, V4, 'the frozen baseline is stamped');
  assert.equal(history.baselineNote, '', 'no re-anchoring note on a comparable pair');
  assert.equal(history.baseline.resonanceDeltaPct, 15);
  assert.equal(history.baseline.pitchMedianDeltaHz, 10);

  const lines = renderedLines(history);
  const vsBaseline = lines.find((line) => line.startsWith('VsBaseline:'));
  assert.ok(vsBaseline, 'a numeric VsBaseline line is rendered');
  assert.match(vsBaseline, /resonance \+15%/);
});

// ---------------------------------------------------------------------------
// 2. VERSION MISMATCH — no numbers, one neutral line, and a refreeze
// ---------------------------------------------------------------------------

test('a pre-v4 baseline against a v4 take renders NO numeric comparison', async () => {
  const svc = makeService();
  const student = 'mismatch-student';
  // Three v3 takes freeze a v3 baseline...
  recordTakes(svc, student, {
    analysisVersion: V3, resonanceMean: V3_RESONANCE, prefix: 'v3', count: 3,
  });
  const frozen = (await historyFor(svc, student)).baseline;
  assert.equal(frozen.measurementAnalysisVersion, V3);
  assert.ok(Math.abs(frozen.resonanceMean - V3_RESONANCE) < 1e-9);

  // ...then the analyzer is repaired and one v4 take arrives.
  svc.recordVoiceAttempt(student, {
    attemptId: 'v4-first',
    summary: takeSummary({ analysisVersion: V4, resonanceMean: V4_RESONANCE }),
  });

  const { baseline, history } = await historyFor(svc, student);
  // The stale snapshot is KEPT (nothing is destroyed) but is not comparable.
  assert.equal(baseline.measurementAnalysisVersion, V3, 'the v3 snapshot survives');
  assert.equal(isBaselineCalibrationComparable(baseline, { measurementAnalysisVersion: V4 }), false);

  // Every delta is suppressed — not just resonance. The pitch delta would have
  // been honest, but a partial VsBaseline line reads as a complete one.
  assert.equal(history.baseline.resonanceDeltaPct, null);
  assert.equal(history.baseline.pitchMedianDeltaHz, null);
  assert.equal(history.baseline.pitchMedianDeltaSt, null);
  assert.equal(history.baseline.pitchRangeDeltaSt, null);
  assert.equal(history.baseline.weightDeltaPct, null);
  assert.equal(history.baseline.targetHitPctDelta, null);
  assert.equal(history.baselineNote, BASELINE_RECALIBRATED_NOTE);

  // Without the guard this line would have claimed roughly +78% resonance.
  const naiveClaim = Math.round((V4_RESONANCE - V3_RESONANCE) * 1000) / 10;
  assert.ok(naiveClaim > 70, `the suppressed fabrication was ~+${naiveClaim}%`);

  const lines = renderedLines(history);
  const vsBaseline = lines.find((line) => line.startsWith('VsBaseline:'));
  assert.equal(vsBaseline, `VsBaseline: ${BASELINE_RECALIBRATED_NOTE}`);
  assert.doesNotMatch(vsBaseline, /\d/, 'the re-anchoring line carries no number');
});

test('the baseline refreezes once enough same-calibration takes exist', async () => {
  const svc = makeService();
  const student = 'refreeze-student';
  recordTakes(svc, student, {
    analysisVersion: V3, resonanceMean: V3_RESONANCE, prefix: 'v3', count: 3,
  });

  // Two v4 takes are not yet enough for the existing freeze mechanics (3), so the
  // stale snapshot stays and the comparison stays silent.
  for (let i = 0; i < 2; i += 1) {
    svc.recordVoiceAttempt(student, {
      attemptId: `v4-${i}`,
      summary: takeSummary({ analysisVersion: V4, resonanceMean: V4_RESONANCE }),
    });
  }
  let state = await historyFor(svc, student);
  assert.equal(state.baseline.measurementAnalysisVersion, V3, 'no premature refreeze');
  assert.equal(state.history.baselineNote, BASELINE_RECALIBRATED_NOTE);

  // The third v4 take completes the refreeze.
  svc.recordVoiceAttempt(student, {
    attemptId: 'v4-2',
    summary: takeSummary({ analysisVersion: V4, resonanceMean: V4_RESONANCE }),
  });
  state = await historyFor(svc, student);
  assert.equal(state.baseline.measurementAnalysisVersion, V4, 'refrozen on the current calibration');
  assert.equal(state.baseline.frozen, true);
  // The refrozen averages must come from v4 takes ONLY — a snapshot that mixed
  // v3 and v4 samples would bake the instrument change into the baseline itself.
  assert.ok(
    Math.abs(state.baseline.resonanceMean - V4_RESONANCE) < 1e-9,
    `refrozen resonanceMean ${state.baseline.resonanceMean} is pure v4`,
  );
  assert.equal(state.baseline.attemptCount, 3);

  // And numbers come back, now honestly. (Math.abs absorbs the -0 that float
  // averaging produces when the take exactly equals the refrozen mean.)
  assert.equal(state.history.baselineNote, '');
  assert.equal(Math.abs(state.history.baseline.resonanceDeltaPct), 0);
  const vsBaseline = renderedLines(state.history).find((l) => l.startsWith('VsBaseline:'));
  assert.match(vsBaseline, /resonance \+?-?0%/);
});

test('a refrozen baseline never averages across calibrations', async () => {
  const svc = makeService();
  const student = 'no-mixing-student';
  recordTakes(svc, student, {
    analysisVersion: V3, resonanceMean: 0.10, prefix: 'v3', count: 3,
  });
  recordTakes(svc, student, {
    analysisVersion: V4, resonanceMean: 0.60, prefix: 'v4', count: 3,
  });
  const { baseline } = await historyFor(svc, student);
  assert.equal(baseline.measurementAnalysisVersion, V4);
  assert.ok(
    Math.abs(baseline.resonanceMean - 0.60) < 1e-9,
    `expected pure v4 0.60, got ${baseline.resonanceMean} (a mixed mean would be 0.35)`,
  );
});

// ---------------------------------------------------------------------------
// 3. LEGACY (missing stamp) — treated as a mismatch
// ---------------------------------------------------------------------------

test('an unstamped legacy baseline is treated as a version mismatch', async () => {
  const svc = makeService();
  const student = 'legacy-student';
  // No analysisVersion on the summaries at all — the pre-2026-07-26 shape.
  recordTakes(svc, student, {
    analysisVersion: undefined, resonanceMean: 0.30, prefix: 'legacy', count: 3,
  });
  let state = await historyFor(svc, student);
  assert.equal(state.baseline.measurementAnalysisVersion, null, 'unknown calibration, not assumed');

  svc.recordVoiceAttempt(student, {
    attemptId: 'v4-after-legacy',
    summary: takeSummary({ analysisVersion: V4, resonanceMean: V4_RESONANCE }),
  });
  state = await historyFor(svc, student);
  assert.equal(state.history.baseline.resonanceDeltaPct, null);
  assert.equal(state.history.baselineNote, BASELINE_RECALIBRATED_NOTE);
});

test('an unstamped baseline is not comparable even to an unstamped take', async () => {
  // Fail-closed: two unknowns are not a match. If a stamp ever stops arriving,
  // the app goes quiet about progress rather than silently comparing across an
  // unknown instrument change.
  const svc = makeService();
  const student = 'both-unstamped-student';
  recordTakes(svc, student, {
    analysisVersion: undefined, resonanceMean: 0.30, prefix: 'a', count: 3,
  });
  svc.recordVoiceAttempt(student, {
    attemptId: 'a-later',
    summary: takeSummary({ analysisVersion: undefined, resonanceMean: 0.50 }),
  });
  const { history } = await historyFor(svc, student);
  assert.equal(history.baseline.resonanceDeltaPct, null);
  assert.equal(history.baselineNote, BASELINE_RECALIBRATED_NOTE);
});

// ---------------------------------------------------------------------------
// The note itself
// ---------------------------------------------------------------------------

test('the re-anchoring note is one line, carries no number, and claims no progress', () => {
  assert.equal(BASELINE_RECALIBRATED_NOTE.includes('\n'), false);
  assert.doesNotMatch(BASELINE_RECALIBRATED_NOTE, /\d/);
  assert.doesNotMatch(BASELINE_RECALIBRATED_NOTE, /improv|better|progress|worse|gain/i);
});

test('no baseline at all still yields no note and no deltas', () => {
  const history = buildHistory({ recentAttempts: [] }, null);
  assert.equal(history.baselineNote, '');
  assert.equal(history.baseline.resonanceDeltaPct, null);
});

// ---------------------------------------------------------------------------
// CROSSING PROOF — through buildSignal, the entry point BOTH live coach paths
// use (coaching/index.js for the buffered turn, voice-standalone-runtime's SSE
// path for the streaming one). Both take their baseline from `pickBaseline`, so
// proving the suppression here proves it for both rather than for a test harness.
// ---------------------------------------------------------------------------

test('the real buildSignal entry point suppresses the numeric comparison end to end', async () => {
  const svc = makeService();
  const student = 'crossing-student';
  recordTakes(svc, student, {
    analysisVersion: V3, resonanceMean: V3_RESONANCE, prefix: 'v3', count: 3,
  });
  svc.recordVoiceAttempt(student, {
    attemptId: 'v4-live',
    summary: takeSummary({ analysisVersion: V4, resonanceMean: V4_RESONANCE }),
  });

  const snapshot = await svc.getVoiceStudentModelSnapshot(student);
  const lastSummary = takeSummary({ analysisVersion: V4, resonanceMean: V4_RESONANCE });
  const voiceState = {
    targetPreset: TARGET_PRESET,
    targetSource: 'built-in',
    lastSummary,
    lastSummaryAt: Date.now(),
  };
  const signal = buildSignal({
    voiceState,
    learnerContext: snapshot,
    userMessage: 'how did that sound',
    targetPreset: TARGET_PRESET,
    baseline: pickBaseline(snapshot),
  });

  assert.equal(signal.history.baselineNote, BASELINE_RECALIBRATED_NOTE);
  assert.equal(signal.history.baseline.resonanceDeltaPct, null);

  const vsBaseline = buildRendererUserMessage(signal)
    .split('\n')
    .find((line) => line.startsWith('VsBaseline:'));
  assert.equal(vsBaseline, `VsBaseline: ${BASELINE_RECALIBRATED_NOTE}`);
});

test('the real buildSignal entry point keeps numbers when the calibration matches', async () => {
  const svc = makeService();
  const student = 'crossing-ok-student';
  recordTakes(svc, student, {
    analysisVersion: V4, resonanceMean: 0.40, prefix: 'v4', count: 3,
  });
  svc.recordVoiceAttempt(student, {
    attemptId: 'v4-live',
    summary: takeSummary({ analysisVersion: V4, resonanceMean: 0.55 }),
  });

  const snapshot = await svc.getVoiceStudentModelSnapshot(student);
  const signal = buildSignal({
    voiceState: {
      targetPreset: TARGET_PRESET,
      targetSource: 'built-in',
      lastSummary: takeSummary({ analysisVersion: V4, resonanceMean: 0.55 }),
      lastSummaryAt: Date.now(),
    },
    learnerContext: snapshot,
    userMessage: 'how did that sound',
    targetPreset: TARGET_PRESET,
    baseline: pickBaseline(snapshot),
  });

  assert.equal(signal.history.baselineNote, '');
  assert.equal(signal.history.baseline.resonanceDeltaPct, 15);
  const vsBaseline = buildRendererUserMessage(signal)
    .split('\n')
    .find((line) => line.startsWith('VsBaseline:'));
  assert.match(vsBaseline, /resonance \+15%/);
});
