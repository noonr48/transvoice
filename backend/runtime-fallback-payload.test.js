'use strict';

// End-to-end payload honesty on the RUNTIME surface: with the model offline,
// BOTH coach paths (buffered processVoiceCoachRuntime + streaming
// generateRealtimeCoachReplyStreaming done-event) must carry
// `fallbackReply: true` on the session payload, with a non-empty coach line.
// Prediction: both flag true; the buffered telemetry names 'model_error'.

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');

function makeRuntime() {
  const sessions = new Map();
  sessions.set('sess-1', {
    id: 'sess-1',
    agentId: 'voice',
    studentId: 'tester',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    voiceState: {},
  });
  return createVoiceStandaloneRuntime({
    logger: false,
    sessions,
    // Model + trainer offline: every network call fails fast.
    fetchImpl: async () => { throw new Error('offline (test)'); },
    learnerContextService: {
      getVoiceStudentModelSnapshot: async () => null,
    },
  });
}

test('buffered path: session payload carries fallbackReply true when the model is down', async () => {
  const runtime = makeRuntime();
  const payload = await runtime.voiceOperationRouteHandlers.processVoiceCoachRuntime({
    sessionId: 'sess-1',
    message: 'How was that take?',
  });
  assert.equal(payload.fallbackReply, true);
  assert.ok(typeof payload.coachMessage === 'string' && payload.coachMessage.trim().length > 0);
  assert.equal(payload.telemetry.fallback_reason, 'model_error');
});

test('streaming path: done-event session payload carries fallbackReply true on stream error', async () => {
  const runtime = makeRuntime();
  const session = runtime.sessions.get('sess-1');
  const chunks = [];
  const res = {
    writeHead() {},
    write(chunk) { chunks.push(String(chunk)); },
    end() {},
  };
  await runtime.generateRealtimeCoachReplyStreaming(session, 'How was that take?', res);
  const doneLine = chunks
    .filter((c) => c.startsWith('data: '))
    .map((c) => JSON.parse(c.slice(6)))
    .find((evt) => evt.done === true);
  assert.ok(doneLine, 'a done event was streamed');
  assert.equal(doneLine.session.fallbackReply, true);
  assert.ok(typeof doneLine.session.coachMessage === 'string' && doneLine.session.coachMessage.trim().length > 0);
});
