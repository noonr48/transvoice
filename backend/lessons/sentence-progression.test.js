'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  beginSentenceProgression,
  resolveSentenceProgressionTurn,
  normalizeSentenceProgression,
  MAX_CONSECUTIVE_NONLEXICAL,
} = require('./sentence-progression');

const RETURN_SENTENCE = 'It should be an easy morning today.';

function begin(overrides = {}) {
  return beginSentenceProgression({
    returnLineId: 'line-1',
    returnText: RETURN_SENTENCE,
    cueFamilyId: 'tongue_contact',
    cueText: 'Keep the sides of your tongue touching your upper back teeth',
    startedAt: 1_700_000_000_000,
    ...overrides,
  });
}

function usableTurn(progression, takeKind, overrides = {}) {
  const nonlexical = ['hum_sovt', 'resonance_play', 'siren', 'sustained', 'trill'].includes(takeKind);
  return resolveSentenceProgressionTurn({
    progression,
    takeKind,
    evidence: {
      resolution: nonlexical ? 'measured_only' : 'semantic_measured',
      measurementUsable: true,
      safety: 'safe',
      // A SOUND rung produces no words, so its realistic transcript is empty.
      // This used to hand the full practice sentence to a hum take, which is
      // physically impossible and, since the 2026-07-29 sound-rung check, is
      // read as "the learner read the line instead of humming" — see the
      // dedicated test for that case below.
      transcript: progression.expectedUnit === 'nonlexical'
        ? ''
        : (progression.expectedUnit === 'phrase'
          ? progression.bridgeText
          : progression.returnText),
      ...overrides,
    },
  });
}

test('a nonlexical scaffold retains an exact sentence return pointer', () => {
  const progression = begin();

  assert.equal(progression.returnLineId, 'line-1');
  assert.equal(progression.returnText, RETURN_SENTENCE);
  assert.equal(progression.phase, 'acquire');
  assert.equal(progression.eligibleAttemptCount, 0);
  assert.equal(progression.consecutiveNonlexical, 0);
});

test('one usable sound bridges to words, then the whole sentence is due by eligible turn four', () => {
  const sound = usableTurn(begin(), 'hum_sovt');
  assert.equal(sound.transition, 'bridge');
  assert.equal(sound.progression.phase, 'stabilise');
  assert.equal(sound.progression.expectedUnit, 'phrase');
  assert.equal(sound.progression.consecutiveNonlexical, 1);
  assert.match(sound.coachLine, /easy morning/i);
  assert.doesNotMatch(sound.coachLine, /\b(resonance|placement|formant|metric)\b/i);

  const bridge = usableTurn(sound.progression, 'phrase');
  assert.equal(bridge.transition, 'return_sentence');
  assert.equal(bridge.progression.phase, 'transfer');
  assert.equal(bridge.progression.expectedUnit, 'sentence');
  assert.match(bridge.coachLine, /It should be an easy morning today\./);

  const sentence = usableTurn(bridge.progression, 'phrase');
  assert.equal(sentence.transition, 'sentence_attempt');
  assert.equal(sentence.completed, true);
  assert.equal(sentence.lexicalAccuracy, 'exact');
  assert.equal(sentence.progression, null);
  assert.ok(bridge.progression.eligibleAttemptCount < 4, 'the sentence is prescribed before attempt four');
});

test('unrelated words cannot complete either lexical step', () => {
  const sound = usableTurn(begin(), 'hum_sovt');
  const wrongBridge = usableTurn(sound.progression, 'phrase', {
    transcript: 'banana banana',
  });
  assert.equal(wrongBridge.transition, 'lexical_retry');
  assert.equal(wrongBridge.lexicalAccuracy, 'mismatch');
  assert.deepEqual(wrongBridge.progression, sound.progression);
  assert.match(wrongBridge.coachLine, /easy morning/i);

  const bridge = usableTurn(sound.progression, 'phrase');
  const wrongSentence = usableTurn(bridge.progression, 'phrase', {
    transcript: 'I said something completely different',
  });
  assert.equal(wrongSentence.transition, 'lexical_retry');
  assert.equal(wrongSentence.completed, false);
  assert.deepEqual(wrongSentence.progression, bridge.progression);
  assert.match(wrongSentence.coachLine, /It should be an easy morning today\./);
});

test('a third consecutive nonlexical prescription is impossible', () => {
  const first = usableTurn(begin(), 'hum_sovt');
  const corrupt = {
    ...first.progression,
    expectedUnit: 'nonlexical',
    consecutiveNonlexical: MAX_CONSECUTIVE_NONLEXICAL,
  };
  const next = usableTurn(corrupt, 'sustained');

  assert.equal(next.transition, 'return_sentence');
  assert.equal(next.progression.expectedUnit, 'sentence');
  assert.equal(next.progression.consecutiveNonlexical, MAX_CONSECUTIVE_NONLEXICAL);
  assert.match(next.coachLine, /It should be an easy morning today\./);
});

test('capture failure and safety interruption freeze counters and preserve the sentence', () => {
  const first = usableTurn(begin(), 'hum_sovt');

  for (const evidence of [
    { resolution: 'unresolved', measurementUsable: false, safety: 'safe' },
    { resolution: 'silent', measurementUsable: false, safety: 'safe' },
    { resolution: 'measured_only', measurementUsable: true, safety: 'stop' },
  ]) {
    const held = resolveSentenceProgressionTurn({
      progression: first.progression,
      takeKind: 'phrase',
      evidence,
    });
    assert.equal(held.transition, 'hold');
    assert.deepEqual(held.progression, first.progression);
    assert.equal(held.progression.returnText, RETURN_SENTENCE);
    assert.equal(held.coachLine, null);
  }
});

test('normalization fails closed on partial state and clamps attacker-sized counters', () => {
  assert.equal(normalizeSentenceProgression({ phase: 'acquire' }), null);

  const normalized = normalizeSentenceProgression({
    ...begin(),
    eligibleAttemptCount: 999,
    consecutiveNonlexical: 999,
  });
  assert.equal(normalized.eligibleAttemptCount, 4);
  assert.equal(normalized.consecutiveNonlexical, MAX_CONSECUTIVE_NONLEXICAL);
});

test('normalization canonicalizes dependent fields from the progression phase', () => {
  const base = begin();
  const acquire = normalizeSentenceProgression({
    ...base,
    phase: 'acquire',
    expectedUnit: 'sentence',
    requiredTakeKind: 'phrase',
  });
  assert.equal(acquire.expectedUnit, 'nonlexical');
  assert.equal(acquire.requiredTakeKind, null);

  const transfer = normalizeSentenceProgression({
    ...base,
    phase: 'transfer',
    expectedUnit: 'nonlexical',
    requiredTakeKind: null,
  });
  assert.equal(transfer.expectedUnit, 'sentence');
  assert.equal(transfer.requiredTakeKind, 'phrase');
});
