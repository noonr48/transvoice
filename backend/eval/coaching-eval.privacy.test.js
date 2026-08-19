'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  createTurnRecord,
  deleteSessionTurns,
  readTurnRecords,
} = require('./coaching-eval');
const { resolveVoiceStandaloneConfig } = require('../voice-standalone-config');

function makeRecord(studentId, sessionId, options = {}) {
  return createTurnRecord({
    studentId,
    sessionId,
    turnIndex: 1,
    userMessage: 'PRIVATE USER WORDS',
    rawReply: 'PRIVATE RAW REPLY',
    sanitizedReply: 'PRIVATE SAFE REPLY',
    rendererMessages: [
      { role: 'system', content: 'PRIVATE SYSTEM PROMPT' },
      { role: 'user', content: 'PRIVATE RENDERER USER' },
    ],
    signal: {
      mode: 'conversation',
      policy: {
        shouldCorrect: true,
        safetyState: 'normal',
        avoidTopics: ['PRIVATE AVOID TOPIC'],
      },
      capture: { reliability: 'usable' },
      coachMove: {
        intent: 'coach',
        cue: 'PRIVATE COACH CUE',
        nextAction: 'PRIVATE NEXT ACTION',
      },
    },
  }, options);
}

test('turn records are categorical unless both isolated-eval capabilities are explicit', () => {
  for (const options of [
    {},
    { captureText: true },
    { isolatedEvaluation: true },
  ]) {
    const record = makeRecord('learner-a', 'session-a', options);
    assert.equal(record.userMessage, '[redacted]');
    assert.equal(record.rawReply, '[redacted]');
    assert.equal(record.sanitizedReply, '[redacted]');
    assert.equal(record.rendererSystemPrompt, '[redacted]');
    assert.equal(record.rendererUserMessage, '[redacted]');
    assert.equal(record.signal.avoidTopicCount, 1);
    assert.equal(record.signal.cuePresent, true);
    assert.equal(record.signal.nextActionPresent, true);
    assert.doesNotMatch(JSON.stringify(record), /PRIVATE/);
  }

  const isolated = makeRecord('learner-a', 'session-a', {
    captureText: true,
    isolatedEvaluation: true,
  });
  assert.equal(isolated.rendererSystemPrompt, 'PRIVATE SYSTEM PROMPT');
  assert.equal(isolated.rawReply, 'PRIVATE RAW REPLY');
  assert.equal(typeof isolated.learnerKey, 'string');
  assert.equal(isolated.learnerKey.length, 64);
});

test('eval deletion removes one learner and unattributed legacy rows while preserving another', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-eval-privacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evalPath = path.join(root, 'turns.jsonl');
  const target = makeRecord('learner-a', 'session-a');
  const other = makeRecord('learner-b', 'session-b');
  fs.writeFileSync(evalPath, [
    JSON.stringify(target),
    JSON.stringify(other),
    JSON.stringify({ sessionId: 'legacy-session', rawReply: 'LEGACY_PRIVATE_TEXT' }),
  ].join('\n') + '\n', { mode: 0o600 });

  const receipt = deleteSessionTurns(evalPath, {
    sessionIds: ['session-a'],
    learnerKeys: [target.learnerKey],
    removeUnattributed: true,
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.remainingTargetRecords, 0);
  const remaining = readTurnRecords(evalPath);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0].sessionId, 'session-b');
  assert.doesNotMatch(fs.readFileSync(evalPath, 'utf8'), /LEGACY_PRIVATE_TEXT|session-a/);
});

test('unreadable eval storage is removed because ownership cannot be proved', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tv-eval-privacy-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const evalPath = path.join(root, 'turns.jsonl');
  fs.writeFileSync(evalPath, '{ malformed PRIVATE text\n', 'utf8');

  const receipt = deleteSessionTurns(evalPath, {
    learnerKeys: ['a'.repeat(64)],
  });

  assert.equal(receipt.success, true);
  assert.equal(receipt.removedFile, true);
  assert.equal(fs.existsSync(evalPath), false);
});

test('live eval storage defaults off and requires an explicit enable or isolated path', () => {
  const defaultConfig = resolveVoiceStandaloneConfig({
    stateRoot: '/tmp/transvoice-config-default',
    env: {},
  });
  assert.equal(defaultConfig.evalPath, null);
  assert.equal(
    defaultConfig.evalStorePath,
    '/tmp/transvoice-config-default/eval-turns.jsonl',
  );
  const dormantConfig = resolveVoiceStandaloneConfig({
    stateRoot: '/tmp/transvoice-config-test',
    env: { VOICE_STANDALONE_EVAL_PATH: '/tmp/ignored-eval.jsonl' },
  });
  assert.equal(dormantConfig.evalPath, null);
  assert.equal(dormantConfig.evalStorePath, '/tmp/ignored-eval.jsonl');
  const enabledConfig = resolveVoiceStandaloneConfig({
    env: {
      VOICE_STANDALONE_EVAL_ENABLED: 'true',
      VOICE_STANDALONE_EVAL_PATH: '/tmp/explicit-eval.jsonl',
    },
  });
  assert.equal(enabledConfig.evalPath, '/tmp/explicit-eval.jsonl');
  assert.equal(enabledConfig.evalStorePath, '/tmp/explicit-eval.jsonl');
  const isolatedConfig = resolveVoiceStandaloneConfig({
    env: {},
    evalPath: '/tmp/isolated-eval.jsonl',
  });
  assert.equal(isolatedConfig.evalPath, '/tmp/isolated-eval.jsonl');
  assert.equal(isolatedConfig.evalStorePath, '/tmp/isolated-eval.jsonl');
});
