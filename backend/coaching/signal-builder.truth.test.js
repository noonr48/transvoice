'use strict';

// Truth wave: (a) no praise without data — acknowledge_win requires a fresh,
// measured take, else a neutral present-focused intent; (b) detectIssues'
// strain/breathy bars align to the canonical warn thresholds; (c) the
// consecutiveMisses adapt path is wired through buildSignal -> resolvePolicy.
// Prediction: all assertions pass.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSignal,
  buildHistory,
  detectIssues,
  assessTakeEvidence,
  deriveConsecutiveMisses,
  FRESH_TAKE_MAX_AGE_MS,
} = require('./signal-builder');

const NOW = 1_800_000_000_000;

function freshVoiceState({ ageMs = 1000, withTimestamp = true } = {}) {
  return {
    lastSummary: { metrics: { meanPitchHz: 190, targetHitPct: 82 } },
    lastAttemptArtifact: withTimestamp ? { finalizedAt: NOW - ageMs } : {},
  };
}

test('acknowledge_win: NO data -> neutral intent, never "keep that same quality"', () => {
  const signal = buildSignal({ voiceState: {}, userMessage: '', now: NOW });
  assert.notEqual(signal.coachMove.intent, 'acknowledge_win');
  assert.equal(signal.coachMove.intent, 'continue_conversation');
  assert.ok(!/keep that same quality/i.test(signal.coachMove.cue));
  assert.equal(signal.decisionWitness.intent.praiseGuard, 'suppressed:no_metrics');
});

test('acknowledge_win: fresh measured take with no issues -> praise allowed', () => {
  const signal = buildSignal({ voiceState: freshVoiceState(), userMessage: '', now: NOW });
  assert.equal(signal.coachMove.intent, 'acknowledge_win');
  assert.equal(signal.decisionWitness.intent.praiseGuard, 'granted');
});

test('acknowledge_win: STALE take -> suppressed with reason', () => {
  const stale = freshVoiceState({ ageMs: FRESH_TAKE_MAX_AGE_MS + 60_000 });
  const signal = buildSignal({ voiceState: stale, userMessage: '', now: NOW });
  assert.equal(signal.coachMove.intent, 'continue_conversation');
  assert.equal(signal.decisionWitness.intent.praiseGuard, 'suppressed:stale');
});

test('acknowledge_win: metrics without any artifact timestamp -> fail closed', () => {
  const untimed = freshVoiceState({ withTimestamp: false });
  const signal = buildSignal({ voiceState: untimed, userMessage: '', now: NOW });
  assert.equal(signal.coachMove.intent, 'continue_conversation');
  assert.equal(signal.decisionWitness.intent.praiseGuard, 'suppressed:no_timestamp');
});

test('assessTakeEvidence unit: reasons + freshness edges', () => {
  assert.deepEqual(
    assessTakeEvidence({}, NOW),
    { hasMetrics: false, measuredAt: null, ageMs: null, usable: false, reason: 'no_metrics' },
  );
  const fresh = assessTakeEvidence(freshVoiceState({ ageMs: 5000 }), NOW);
  assert.equal(fresh.usable, true);
  assert.equal(fresh.ageMs, 5000);
  const edge = assessTakeEvidence(freshVoiceState({ ageMs: FRESH_TAKE_MAX_AGE_MS }), NOW);
  assert.equal(edge.usable, true, 'exactly at the age limit still counts');
});

test('detectIssues: strain/breathy bars use the canonical warn thresholds', () => {
  const make = (quality) => ({ lastSummary: { metrics: { advanced: { quality } } } });
  // Below warn (would have fired under the old 0.10/0.12 magic): no issue.
  assert.equal(detectIssues(make({ strainRisk: 0.3 }), 'active_drill').primaryIssue, null);
  assert.equal(detectIssues(make({ breathyRisk: 0.5 }), 'active_drill').primaryIssue, null);
  // At/above warn: issues fire.
  assert.equal(detectIssues(make({ strainRisk: 0.55 }), 'active_drill').primaryIssue, 'strain_risk');
  assert.equal(detectIssues(make({ breathyRisk: 0.7 }), 'active_drill').primaryIssue, 'breathy_quality');
});

test('deriveConsecutiveMisses: trailing non-improving pairs, newest-last', () => {
  const attempts = (hits) => ({ recentAttempts: hits.map((h) => ({ targetHitPct: h })) });
  assert.equal(deriveConsecutiveMisses(null), 0);
  assert.equal(deriveConsecutiveMisses(attempts([])), 0);
  assert.equal(deriveConsecutiveMisses(attempts([60])), 0);
  assert.equal(deriveConsecutiveMisses(attempts([60, 55, 50])), 2);
  assert.equal(deriveConsecutiveMisses(attempts([50, 60])), 0, 'improving take breaks the run');
  // 2026-07-28 noise floor: a flat pair is noise, not a miss — at ~0% hit rates
  // pure wiggle used to saturate the counter (it caps at 6).
  assert.equal(deriveConsecutiveMisses(attempts([60, 60])), 0, 'flat pair is noise, not a miss');
  assert.equal(deriveConsecutiveMisses(attempts([50, 49])), 0, 'sub-floor wiggle is noise');
  assert.equal(deriveConsecutiveMisses(attempts([50, 40, 41])), 1, 'noise pair is skipped, the real decline before it still counts');
  assert.equal(deriveConsecutiveMisses(attempts([40, 60, 55, 50])), 2, 'run stops at the improvement');
  // Preset filter: other-preset entries are ignored.
  const mixed = {
    recentAttempts: [
      { targetHitPct: 80, targetPreset: 'masc-natural' },
      { targetHitPct: 60, targetPreset: 'cute-feminine' },
      { targetHitPct: 55, targetPreset: 'cute-feminine' },
      { targetHitPct: 50, targetPreset: 'cute-feminine' },
    ],
  };
  assert.equal(deriveConsecutiveMisses(mixed, 'cute-feminine'), 2);
});

test('deriveConsecutiveMisses: session scoping drops cross-session and unplaced takes', () => {
  const withTimes = {
    recentAttempts: [
      { targetHitPct: 60, recordedAt: 1000 },
      { targetHitPct: 50, recordedAt: 2000 },
      { targetHitPct: 40, recordedAt: 3000 },
    ],
  };
  assert.equal(deriveConsecutiveMisses(withTimes, null, null), 2, 'legacy path (no session start) is unchanged');
  assert.equal(deriveConsecutiveMisses(withTimes, null, 1500), 1, 'only this session\'s takes count');
  assert.equal(deriveConsecutiveMisses(withTimes, null, 2500), 0, 'a fresh session does not inherit the stall');
  const noTimes = { recentAttempts: [{ targetHitPct: 60 }, { targetHitPct: 50 }] };
  assert.equal(deriveConsecutiveMisses(noTimes, null, 1000), 0, 'entries without recordedAt drop out when scoping (fail safe)');
});

test('buildHistory: trend window is session-scoped, baseline still uses the latest take overall', () => {
  const learnerContext = {
    recentAttempts: [
      { targetHitPct: 60, meanPitchHz: 170, recordedAt: 1000 },
      { targetHitPct: 55, meanPitchHz: 170, recordedAt: 2000 },
      { targetHitPct: 55, meanPitchHz: 170, recordedAt: 3000 },
    ],
  };
  assert.equal(buildHistory(learnerContext).trend, 'flat', 'legacy path spans the ring');
  const freshSession = buildHistory(learnerContext, null, null, 4000);
  assert.equal(freshSession.trend, 'uncertain');
  assert.equal(freshSession.last3TakeSummary, 'No prior takes in this session.');
  assert.equal(buildHistory(learnerContext, null, null, 2500).trend, 'uncertain', 'one take this session cannot trend');
});

test('consecutiveMisses wiring: declining takes flip the live policy to adapt', () => {
  const learnerContext = {
    recentAttempts: [
      { targetHitPct: 70, targetPreset: 'cute-feminine' },
      { targetHitPct: 62, targetPreset: 'cute-feminine' },
      { targetHitPct: 55, targetPreset: 'cute-feminine' },
    ],
  };
  // reflection mode resolves coach-vs-adapt at the POLICY level (coachOrAdapt),
  // so this isolates the count path from the flat-trend refinement.
  const signal = buildSignal({
    voiceState: {}, learnerContext, practiceMode: 'reflection', userMessage: '', now: NOW,
  });
  assert.equal(signal.policy.coachingAction, 'adapt');
  assert.equal(signal.decisionWitness.consecutiveMisses, 2);
  assert.equal(signal.decisionWitness.missesSource, 'derived');
  // Improving takes: count 0, reflection coaches normally.
  const improving = {
    recentAttempts: [
      { targetHitPct: 55, targetPreset: 'cute-feminine' },
      { targetHitPct: 62, targetPreset: 'cute-feminine' },
      { targetHitPct: 70, targetPreset: 'cute-feminine' },
    ],
  };
  const coachSignal = buildSignal({
    voiceState: {}, learnerContext: improving, practiceMode: 'reflection', userMessage: '', now: NOW,
  });
  assert.equal(coachSignal.policy.coachingAction, 'coach');
  assert.equal(coachSignal.decisionWitness.consecutiveMisses, 0);
  // Explicit caller value wins over derivation: improving attempts derive 0,
  // but an explicit 3 must still reach resolvePolicy and flip it to adapt.
  const explicit = buildSignal({
    voiceState: {}, learnerContext: improving, practiceMode: 'reflection', userMessage: '', consecutiveMisses: 3, now: NOW,
  });
  assert.equal(explicit.policy.coachingAction, 'adapt');
  assert.equal(explicit.decisionWitness.consecutiveMisses, 3);
  assert.equal(explicit.decisionWitness.missesSource, 'explicit');
});

test('decisionWitness rides the signal with threshold + strike context', () => {
  const voiceState = {
    lastSummary: { metrics: { advanced: { quality: { strainRisk: 0.6 } } } },
    strainWatch: { recentFlags: 2, sessionMinutes: 4 },
  };
  const signal = buildSignal({ voiceState, userMessage: '', now: NOW });
  assert.equal(signal.decisionWitness.safety.strain.tier, 'warn-fired');
  assert.equal(signal.decisionWitness.safety.strain.warn, 0.52);
  assert.equal(signal.decisionWitness.safety.strain.stop, 0.7);
  assert.equal(signal.decisionWitness.safety.strain.strikes, 2);
  // And the policy holds the cue (breather) because the warn tier fired.
  assert.equal(signal.policy.coachingAction, 'breather');
});

// 2026-07-28 capture-latch usability gate (the phone-test bug): an ASR-side
// capture fault (low transcript confidence) latches safety capture_only while
// the ACOUSTIC measurement came through clean and usable. The old code forced
// shouldCorrect:false + breather + repair_capture on every such turn, hid the
// misses, and left the model praising unmeasured takes. Now the turn falls
// through to the normal policy — including the misses>=2 adapt path.
function asrLatchedUsableTake() {
  const advanced = {
    measurementAvailable: true,
    scoreConfidence: 0.9,
    voicedFramePct: 0.85,
    confidentFramePct: 0.8,
    captureReliability: 0.9,
    pitchValidFrameCount: 120,
    snrDb: 24,
    clippingPct: 0,
  };
  return {
    lastSummary: { metrics: { meanPitchHz: 168, targetHitPct: 5, advanced } },
    lastAttemptArtifact: { finalizedAt: NOW - 1000, metrics: { advanced }, summary: { metrics: { advanced } } },
    voiceInputRuntime: { lastTranscriptConfidence: 0.3 },
  };
}

test('capture_only latch on a USABLE take: falls through, never repair_capture', () => {
  const signal = buildSignal({ voiceState: asrLatchedUsableTake(), userMessage: '', now: NOW });
  assert.equal(signal.decisionWitness.safetyState, 'capture_only', 'the latch itself is unchanged');
  assert.equal(signal.takeQuality.usable, true);
  assert.notEqual(signal.coachMove.intent, 'repair_capture');
  assert.equal(signal.policy.shouldCorrect, true);
  assert.ok(
    signal.policy.coachingAction === 'coach' || signal.policy.coachingAction === 'adapt',
    `expected coach/adapt, got ${signal.policy.coachingAction}`,
  );
  // The misses>=2 adapt path is reachable again under the latch.
  const stalling = buildSignal({
    voiceState: asrLatchedUsableTake(), userMessage: '', consecutiveMisses: 3, now: NOW,
  });
  assert.equal(stalling.policy.coachingAction, 'adapt');
});

test('capture_only latch on an UNUSABLE take still holds (breather + repair_capture)', () => {
  const voiceState = asrLatchedUsableTake();
  voiceState.lastSummary.metrics.advanced.scoreConfidence = 0.2;
  voiceState.lastAttemptArtifact.metrics.advanced.scoreConfidence = 0.2;
  voiceState.lastAttemptArtifact.summary.metrics.advanced.scoreConfidence = 0.2;
  const signal = buildSignal({ voiceState, userMessage: '', now: NOW });
  assert.equal(signal.decisionWitness.safetyState, 'capture_only');
  assert.equal(signal.takeQuality.usable, false);
  assert.equal(signal.policy.coachingAction, 'breather');
  assert.equal(signal.policy.shouldCorrect, false);
  assert.equal(signal.coachMove.intent, 'repair_capture');
});

test('praise guard records suppression on hold turns (was praise_guard: null)', () => {
  // Text-driven breather hold: praise never licensed, and the witness says so.
  const breather = buildSignal({
    voiceState: freshVoiceState(),
    userMessage: 'Honestly I am spent, I just need a minute',
    now: NOW,
  });
  assert.equal(breather.policy.coachingAction, 'breather');
  assert.notEqual(breather.coachMove.intent, 'acknowledge_win');
  assert.equal(breather.decisionWitness.intent.praiseGuard, 'suppressed:breather_hold');
  // Safety hold (strain warn second strike): same suppression, same mechanism.
  const strainHold = buildSignal({
    voiceState: {
      lastSummary: { metrics: { advanced: { quality: { strainRisk: 0.6 } } } },
      strainWatch: { recentFlags: 2, sessionMinutes: 4 },
    },
    userMessage: '',
    now: NOW,
  });
  assert.equal(strainHold.coachMove.intent, 'stop_and_reset');
  assert.equal(strainHold.decisionWitness.intent.praiseGuard, 'suppressed:safety_hold');
});

test('decisionWitness carries the capture-latch context for the journal', () => {
  const signal = buildSignal({ voiceState: asrLatchedUsableTake(), userMessage: '', now: NOW });
  assert.equal(signal.decisionWitness.captureReliability, 'good');
  assert.ok(
    signal.decisionWitness.safetyReasons.some((reason) => /speech input confidence/i.test(reason)),
    `expected the ASR latch reason, got ${JSON.stringify(signal.decisionWitness.safetyReasons)}`,
  );
});

// 2026-07-28 FIX A: on a take-bearing turn userMessage is the ASR transcript of
// the TAKE, and the line library is full of question-form drill lines. The
// casual/chat classifiers must not read them as chit-chat and small-talk the
// take away.
test('a question-form drill line on a take-bearing turn is coached, not chatted', () => {
  const signal = buildSignal({
    voiceState: freshVoiceState(),
    userMessage: 'how was your day',
    now: NOW,
  });
  assert.equal(signal.policy.shouldCorrect, true);
  assert.ok(
    signal.policy.coachingAction === 'coach' || signal.policy.coachingAction === 'adapt',
    `expected coach/adapt, got ${signal.policy.coachingAction}`,
  );
  // Same words with NO take: still ordinary chat.
  const chat = buildSignal({ voiceState: {}, userMessage: 'how was your day', now: NOW });
  assert.equal(chat.policy.coachingAction, 'converse');
});

// 2026-07-28 FIX B: the adapt machinery (miss counter + flat trend) is scoped
// to the CURRENT session — a declining cross-session ring must not open a fresh
// session in adapt before any cue was given this session.
test('fresh session does not open in adapt on cross-session misses', () => {
  const learnerContext = {
    recentAttempts: [
      { targetHitPct: 70, targetPreset: 'cute-feminine', recordedAt: 1000 },
      { targetHitPct: 62, targetPreset: 'cute-feminine', recordedAt: 2000 },
      { targetHitPct: 55, targetPreset: 'cute-feminine', recordedAt: 3000 },
    ],
  };
  const fresh = buildSignal({
    voiceState: { sessionStartedAt: 4000 },
    learnerContext, practiceMode: 'reflection', userMessage: '', now: NOW,
  });
  assert.equal(fresh.decisionWitness.consecutiveMisses, 0);
  assert.equal(fresh.history.trend, 'uncertain');
  assert.equal(fresh.policy.coachingAction, 'coach');
  // The same declining ring with takes INSIDE the session still adapts.
  const inSession = buildSignal({
    voiceState: { sessionStartedAt: 500 },
    learnerContext, practiceMode: 'reflection', userMessage: '', now: NOW,
  });
  assert.equal(inSession.decisionWitness.consecutiveMisses, 2);
  assert.equal(inSession.policy.coachingAction, 'adapt');
});
