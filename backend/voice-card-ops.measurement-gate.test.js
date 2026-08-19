'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');

test('rejected measurement strips but never applies card, focus, or replay operations', () => {
  const runtime = createVoiceStandaloneRuntime({ logger: false, disableSessionPersistence: true });
  const session = {
    id: 'measurement-gate-session',
    voiceState: { targetPreset: 'cute-feminine' },
  };
  runtime.sessions.set(session.id, session);
  const reply = [
    'Let us get a cleaner capture first.',
    '```card-ops',
    JSON.stringify({
      card_ops: [{
        op: 'create',
        phrase: 'Push the pitch much higher',
        focus: { axis: 'pitch', direction: 'higher' },
        difficulty: 'hard',
      }],
      focus_update: { axis: 'pitch', direction: 'higher' },
      replay: { attemptId: 'rejected-attempt', momentProgress: 0.5, reason: 'false evidence' },
    }),
    '```',
  ].join('\n');

  const result = runtime.processCoachReplyCardOps(session, reply, {
    targetPreset: 'cute-feminine',
    allowMeasurementDerivedOps: false,
  });

  assert.equal(result.say, 'Let us get a cleaner capture first.');
  assert.equal(result.cardOpsApplied, 0);
  assert.equal(result.cardOpsSuppressed, 'measurement_unusable');
  assert.equal(result.replayDirective, null);
  assert.equal(result.activeCard, null);
  assert.equal(runtime.practiceCards.getActiveCard(session.id), null);
});
