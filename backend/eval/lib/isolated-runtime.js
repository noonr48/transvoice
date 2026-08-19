'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { createLearnerContextService } = require('../../learner-context-service');
const { createVoiceStandaloneRuntime } = require('../../voice-standalone-runtime');

const TEMP_PREFIX = 'transvoice-eval-';

function isSyntheticEvalReferenceUrl(value) {
  try {
    const url = new URL(String(value));
    return /\/api\/v1\/voice\/reference\/eval-reference-[^/]+$/.test(url.pathname);
  } catch {
    return false;
  }
}

function createIsolatedEvalRuntime(options = {}) {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), TEMP_PREFIX));
  const learnerContextRoot = path.join(tempRoot, 'learner-context');
  const sessionStorePath = path.join(tempRoot, 'sessions.json');
  const evalPath = path.join(tempRoot, 'turns.jsonl');
  const upstreamFetch = options.fetchImpl || global.fetch;
  const fetchImpl = async (url, init) => {
    // Evaluation presets model an already-uploaded named reference. The coach
    // turn only asks for its cloneability metadata; keep that fixture entirely
    // inside the isolated harness while forwarding model calls unchanged.
    if (isSyntheticEvalReferenceUrl(url)) {
      return new Response(JSON.stringify({
        quality: { cloneable: true, cloneNote: null },
      }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    return upstreamFetch(url, init);
  };
  const learnerContextService = createLearnerContextService({
    storageRoot: learnerContextRoot,
    logger: options.logger === undefined ? { warn() {}, log() {} } : options.logger,
  });
  const runtime = createVoiceStandaloneRuntime({
    learnerContextService,
    learnerContextRoot,
    sessionStorePath,
    evalPath,
    isolatedEvaluation: true,
    // The evaluator needs the pre-sanitizer model response in its in-memory
    // return payload. This capability is structurally unavailable to a normal
    // live runtime, even if a process environment variable is set.
    evalExposeRaw: options.evalExposeRaw !== false,
    evalCaptureText: options.evalCaptureText === true,
    fetchImpl,
    logger: options.logger === undefined ? false : options.logger,
    env: options.env || process.env,
  });
  let disposed = false;

  async function modelIsUp(timeoutMs = 4000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await upstreamFetch(
        `${runtime.config.voiceTutorGgufBaseUrl.replace(/\/+$/, '')}/models`,
        {
          headers: runtime.config.voiceTutorGgufApiKey
            ? { Authorization: `Bearer ${runtime.config.voiceTutorGgufApiKey}` }
            : undefined,
          signal: controller.signal,
        },
      );
      return response.ok;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  async function deleteLearner(studentId) {
    return runtime.learnerContextRouteHandlers.forgetLearnerContext({
      studentId,
      operation: 'delete-all',
    });
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    try { runtime.voiceInputLiveService?.close?.(); } catch { /* best effort */ }
    try { await runtime.closeReferencePrewarms?.(); } catch { /* best effort */ }
    const resolved = path.resolve(tempRoot);
    const safePrefix = path.join(path.resolve(os.tmpdir()), TEMP_PREFIX);
    if (resolved.startsWith(safePrefix)) {
      fs.rmSync(resolved, { recursive: true, force: true });
    }
  }

  return {
    runtime,
    learnerContextService,
    paths: {
      tempRoot,
      learnerContextRoot,
      sessionStorePath,
      evalPath,
    },
    modelIsUp,
    deleteLearner,
    dispose,
  };
}

module.exports = {
  createIsolatedEvalRuntime,
  isSyntheticEvalReferenceUrl,
};
