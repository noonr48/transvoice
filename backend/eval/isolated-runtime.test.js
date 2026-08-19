'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');

const { createIsolatedEvalRuntime } = require('./lib/isolated-runtime');

test('evaluation runtime owns temporary learner/session/eval stores and removes them', async () => {
  const harness = createIsolatedEvalRuntime({
    fetchImpl: async () => new Response(JSON.stringify({ data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }),
  });
  const { tempRoot, learnerContextRoot, sessionStorePath, evalPath } = harness.paths;
  assert.match(tempRoot, /transvoice-eval-/);
  assert.ok(learnerContextRoot.startsWith(tempRoot));
  assert.ok(sessionStorePath.startsWith(tempRoot));
  assert.ok(evalPath.startsWith(tempRoot));

  harness.learnerContextService.updateLearnerProfile('eval-person', {
    displayName: 'Eval',
  });
  await harness.runtime.appCompatibilityRouteHandlers.startSession({
    studentId: 'eval-person',
    activate: false,
  });
  assert.equal(fs.existsSync(harness.learnerContextService.getProfilePath('eval-person')), true);
  assert.equal(fs.existsSync(sessionStorePath), true);

  await harness.dispose();
  assert.equal(fs.existsSync(tempRoot), false);
});
