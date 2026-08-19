'use strict';

// Payload honesty: coachingTurn must flag every deterministic-fallback reply
// (fallbackReply: true + reason) and record it on a provided TurnTelemetry.
// Prediction: model_error / empty_content / no_model branches all flag; a
// healthy model reply does not.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { coachingTurn } = require('./index');
const { TurnTelemetry } = require('./turn-telemetry');

test('model throw -> fallbackReply true, reason model_error, telemetry recorded', async () => {
  const telemetry = new TurnTelemetry({ turnId: 'turn-test-1' });
  const result = await coachingTurn({
    voiceState: {},
    userMessage: 'how was that?',
    callModel: async () => { throw new Error('offline'); },
    telemetry,
  });
  assert.equal(result.fallbackReply, true);
  assert.equal(result.fallbackReason, 'model_error');
  assert.equal(telemetry.getFallback(), 'model_error');
  assert.ok(typeof result.sanitizedReply === 'string' && result.sanitizedReply.trim().length > 0);
});

test('empty model content -> fallbackReply true, reason empty_content', async () => {
  const result = await coachingTurn({
    voiceState: {},
    userMessage: 'how was that?',
    callModel: async () => '',
  });
  assert.equal(result.fallbackReply, true);
  assert.equal(result.fallbackReason, 'empty_content');
});

test('no model wired -> fallbackReply true, reason no_model', async () => {
  const result = await coachingTurn({ voiceState: {}, userMessage: 'hello' });
  assert.equal(result.fallbackReply, true);
  assert.equal(result.fallbackReason, 'no_model');
});

test('healthy model reply -> fallbackReply false, no telemetry fallback', async () => {
  const telemetry = new TurnTelemetry({ turnId: 'turn-test-2' });
  const result = await coachingTurn({
    voiceState: {},
    userMessage: 'how was that?',
    // 2026-07-27 cue-vocabulary law: was 'Keep the vowels bright and easy.'
    // MEASURED — that reply is now stripped by CUE_VOCABULARY_RULES
    // (quality_bright) before it reaches the assertion, so the fixture no
    // longer represented a healthy model reply. Same shape, body register.
    callModel: async () => 'Keep the tongue high and forward through the vowels.',
    telemetry,
  });
  assert.equal(result.fallbackReply, false);
  assert.equal(result.fallbackReason, null);
  assert.equal(telemetry.getFallback(), null);
  assert.match(result.sanitizedReply, /vowels/i);
});

test('realtime renderer is hard-bounded and records buffered model latency stages', async () => {
  let generationOptions = null;
  let clock = 1_000;
  const telemetry = new TurnTelemetry({
    turnId: 'turn-latency-contract',
    now: () => {
      clock += 25;
      return clock;
    },
  });

  await coachingTurn({
    voiceState: {},
    userMessage: 'hi?',
    telemetry,
    callModel: async (_messages, options) => {
      generationOptions = options;
      return 'Hi there. Keep it bright and easy.';
    },
  });

  assert.ok(generationOptions.maxTokens <= 256, 'a two-sentence tutor must not have a 1,024-token tail');
  const { timestamps, latency } = telemetry.getSummary();
  assert.equal(typeof timestamps.coaching_signal_done_at, 'number');
  assert.equal(typeof timestamps.llm_request_at, 'number');
  assert.equal(typeof timestamps.llm_done_at, 'number');
  assert.ok(latency.llm_ms >= 0);
});
