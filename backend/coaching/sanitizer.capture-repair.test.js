'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { sanitizeCoachReply } = require('./sanitizer');

function repairSignal(reasons) {
  return {
    coachMove: { intent: 'repair_capture' },
    takeQuality: { usable: false, reasons },
    policy: { safetyState: 'capture_only' },
  };
}

test('repair_capture replaces invented connection blame with the measured low-voice cause', () => {
  const witness = {};
  const reply = sanitizeCoachReply(
    'That was a struggle with the connection. Try it again.',
    repairSignal(['no_voiced_frames', 'low_voiced_coverage']),
    { witness },
  );

  assert.equal(reply, "I didn't capture enough of your voice. Move a little closer and speak clearly when you're ready.");
  assert.doesNotMatch(reply, /connection/i);
  assert.equal(witness.captureRepairCause, 'not_enough_voice');
});

test('repair_capture explains clipping without blaming voice quality or connectivity', () => {
  const witness = {};
  const reply = sanitizeCoachReply(
    'Your voice sounded bad because the network dropped out.',
    repairSignal(['sustained_clipping', 'clipping 4.20%']),
    { witness },
  );

  assert.equal(reply, 'The recording came in too loud. Move slightly back from the mic when you’re ready.');
  assert.doesNotMatch(reply, /voice sounded bad|network|connection/i);
  assert.equal(witness.captureRepairCause, 'clipping');
});

test('repair_capture uses a neutral capture-only fallback for unknown rejection reasons', () => {
  const witness = {};
  const reply = sanitizeCoachReply(
    'The connection failed.',
    repairSignal(['measurement_unusable_for_scoring']),
    { witness },
  );

  assert.equal(reply, "I couldn't get a clear enough recording to assess. Check your mic distance and speak when you're ready.");
  assert.equal(witness.captureRepairCause, 'unclear_capture');
});

test('safety remains authoritative without taking session control from the learner', () => {
  const witness = {};
  const reply = sanitizeCoachReply(
    'Take a moment to rest.',
    {
      ...repairSignal(['no_voiced_frames']),
      safety: { shouldStop: true },
      policy: { safetyState: 'stop' },
    },
    { witness },
  );

  assert.equal(reply, 'Let the jaw hang loose and start the next sound softly, keeping it level all the way through.');
  assert.equal(witness.sessionControlHits.length, 1);
});
