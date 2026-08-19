'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createVoiceStandaloneRuntime } = require('./voice-standalone-runtime');

test('streaming exposes only categorical progress and the sanitized final coach line', async () => {
  const sessions = new Map([[
    'stream-sanitization-session',
    {
      id: 'stream-sanitization-session',
      agentId: 'voice',
      studentId: 'stream-learner',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: 'voice',
      voiceState: {
        status: 'idle',
        targetPreset: 'cute-feminine',
        targetSource: 'built-in',
      },
    },
  ]]);
  const rawModelText = 'Squeeze your throat and take a break before you come back later.';
  const modelStream = [
    `data: ${JSON.stringify({ choices: [{ delta: { content: rawModelText } }] })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const runtime = createVoiceStandaloneRuntime({
    sessions,
    learnerContextService: {
      getVoiceStudentModelSnapshot: async () => ({ learnerContext: {} }),
    },
    logger: false,
    fetchImpl: async () => new Response(modelStream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }),
  });
  const writes = [];
  const res = {
    writeHead() {},
    write(value) { writes.push(String(value)); },
    end() {},
  };

  await runtime.generateRealtimeCoachReplyStreaming(
    sessions.get('stream-sanitization-session'),
    'How am I doing?',
    res,
  );

  const wire = writes.join('');
  assert.doesNotMatch(wire, /Squeeze your throat|take a break|come back later/i);
  const events = writes
    .filter((value) => value.startsWith('data: '))
    .map((value) => JSON.parse(value.slice(6)));
  assert.equal(events.some((event) => Object.hasOwn(event, 'chunk')), false);
  assert.equal(events.some((event) => event.progress === 'generating'), true);
  const done = events.find((event) => event.done === true);
  assert.ok(done);
  assert.match(done.session.coachMessage, /start the next sound softly|one setting|loose jaw|clean contact/i);
});
