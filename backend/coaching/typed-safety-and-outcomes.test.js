'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveFeminizationV1Turn } = require('./feminization-v1-controller');
const { beginnerFeedback } = require('./beginner-feedback');
const { buildBeginnerSessionCard } = require('./beginner-session-card');
const coaching = require('./index');

function turn(safetyState) {
  return resolveFeminizationV1Turn({
    safetyState,
    captureState: { usable: true, reasons: [] },
    curriculumState: { phase: 'pitch_foundation' },
    observations: [],
    sessionContext: { sessionId: 's-1', stage: 'phrase' },
    mode: 'shadow',
  });
}

test('R1-005: stop_for_safety carries a TYPED reason naming the trigger', () => {
  const cases = [
    [{ pain: true }, 'pain'],
    [{ throatPain: true }, 'throat_pain'],
    [{ severeBreathlessness: true }, 'severe_breathlessness'],
    [{ severeDizziness: true }, 'severe_dizziness'],
    [{ voiceLoss: true }, 'voice_loss'],
    [{ suddenVoiceLoss: true }, 'sudden_voice_loss'],
    [{ restrictionConflict: true }, 'restriction_conflict'],
    [{ recentLaryngealSurgery: true }, 'recent_laryngeal_surgery'],
    [{ explicitStop: true }, 'explicit_stop'],
  ];
  for (const [safetyState, expectedReason] of cases) {
    const result = turn(safetyState);
    assert.equal(result.action, 'stop_for_safety', expectedReason);
    assert.equal(result.safetyReason, expectedReason, `typed reason for ${expectedReason}`);
  }
});

test('R1-005: stop copy is reason-specific, not pain-generic', () => {
  const pain = beginnerFeedback({ safety: { state: 'stop', reason: 'pain' } });
  assert.match(pain.message, /should not hurt/i);

  const breathless = beginnerFeedback({ safety: { state: 'stop', reason: 'severe_breathlessness' } });
  assert.ok(!/should not hurt/i.test(breathless.message), 'breathlessness must not get pain copy');
  assert.match(breathless.message, /breath|breathing/i);

  const voiceLoss = beginnerFeedback({ safety: { state: 'stop', reason: 'voice_loss' } });
  assert.match(voiceLoss.message, /voice.*today|rest|professional/i);

  const restriction = beginnerFeedback({ safety: { state: 'stop', reason: 'restriction_conflict' } });
  assert.match(restriction.message, /guidance|clinician|restriction/i);
});

test('R1-005: the card carries the typed safety reason through', () => {
  const card = buildBeginnerSessionCard({
    phase: 'pitch_foundation',
    feedback: { state: 'safety_stop', tone: 'stop', message: null, nextAction: null, safetyReason: 'severe_breathlessness' },
    focusLabel: null,
    trySteps: [],
    hasApprovedDemo: false,
  });
  assert.equal(card.result.state, 'safety_stop');
  assert.equal(card.safetyReason, 'severe_breathlessness');
  assert.match(card.result.message, /breath/i);
});

test('R1-005: verify_attempt maps to a checking state — NEVER a movement claim', () => {
  const feedback = beginnerFeedback({ controllerAction: 'verify_attempt' });
  assert.equal(feedback.state, 'checking_result');
  assert.ok(!/moved|similar|direction|verified/i.test(feedback.message), 'must not claim any acoustic outcome');
});

test('R1-005: advance_phase maps to a progression state — NEVER a verification claim', () => {
  const feedback = beginnerFeedback({ controllerAction: 'advance_phase' });
  assert.equal(feedback.state, 'next_step_ready');
  assert.ok(!/verified|worked/i.test(feedback.message), 'must not claim acoustic verification');
});

test('R1-005: shadow card adapter speaks typed outcomes end-to-end (barrel path)', async () => {
  // Pain stop through the full runtime: typed reason + pain copy
  const painTurn = await coaching.coachingTurn({
    voiceState: { lastAttemptArtifact: { selfReport: { pain: true } } },
    callModel: null,
  });
  assert.equal(painTurn.femV1BeginnerCard.result.state, 'safety_stop');
  assert.equal(painTurn.femV1BeginnerCard.safetyReason, 'pain');
  assert.match(painTurn.femV1BeginnerCard.result.message, /should not hurt/i);

  // Breathlessness stop: typed reason + breathlessness copy (NOT pain copy)
  const breathlessTurn = await coaching.coachingTurn({
    voiceState: { lastAttemptArtifact: { selfReport: { severeBreathlessness: true } } },
    callModel: null,
  });
  assert.equal(breathlessTurn.femV1BeginnerCard.safetyReason, 'severe_breathlessness');
  assert.ok(!/should not hurt/i.test(breathlessTurn.femV1BeginnerCard.result.message));
  assert.match(breathlessTurn.femV1BeginnerCard.result.message, /breath/i);
});
