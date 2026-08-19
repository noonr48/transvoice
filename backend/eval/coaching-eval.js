'use strict';

/**
 * CoachingEval — evaluation and replay tooling for coaching turns.
 *
 * Records explicitly enabled coaching turns as privacy-bounded structured
 * events for isolated regression testing and diagnostics.
 *
 * Storage: JSONL file (append-friendly, one line per turn).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { sanitizeTargetMetricShadowWitness } = require('./target-metric-shadow-analytics');

const EVAL_SCHEMA_VERSION = 'transvoice.eval_turn.v1';

// v6 PRIVACY: production/runtime eval records are categorical by default. Raw text
// may only be requested by an explicitly isolated evaluator; no process-global
// environment switch can silently turn it on for the live app.
const redactText = (value, captureText) => (
  captureText ? (value || '') : (value ? '[redacted]' : '')
);

/**
 * Create a coaching turn record.
 */
function createTurnRecord({
  sessionId,
  studentId,
  turnIndex,
  signal,
  targetMetricShadowWitness = null,
  rendererMessages,
  rawReply,
  sanitizedReply,
  userMessage,
  practiceMode,
  targetPreset,
  promptTokens,
  durationMs,
  modelUsed,
  error = null,
}, options = {}) {
  const captureText = options.captureText === true && options.isolatedEvaluation === true;
  const systemPrompt = rendererMessages?.[0]?.content || '';
  const rendererUserMessage = rendererMessages?.find((message) => message.role === 'user')?.content || '';
  const learnerKey = studentId
    ? crypto.createHash('sha256').update(String(studentId)).digest('hex')
    : null;
  return {
    schema: EVAL_SCHEMA_VERSION,
    recordedAt: new Date().toISOString(),
    sessionId: sessionId || null,
    learnerKey,
    turnIndex: turnIndex || 0,
    id: crypto.randomUUID(),

    // Input
    userMessage: redactText(userMessage, captureText),
    practiceMode: practiceMode || 'active_drill',
    targetPreset: targetPreset || 'cute-feminine',

    // Signal (the deterministic coaching decision)
    signal: signal ? {
      mode: signal.mode,
      intent: signal.coachMove?.intent,
      primaryIssue: signal.observation?.primaryIssue,
      shouldCorrect: signal.policy?.shouldCorrect,
      safetyState: signal.policy?.safetyState,
      captureReliability: signal.capture?.reliability,
      avoidTopicCount: Array.isArray(signal.policy?.avoidTopics)
        ? signal.policy.avoidTopics.length
        : 0,
      cuePresent: Boolean(signal.coachMove?.cue),
      nextActionPresent: Boolean(signal.coachMove?.nextAction),
    } : null,

    // Privacy-bounded v3 shadow record. Never persist the full bridge or observation vector.
    targetMetricShadow: sanitizeTargetMetricShadowWitness(targetMetricShadowWitness),

    // Model interaction
    promptTokens: promptTokens || 0,
    rendererMessageCount: rendererMessages?.length || 0,
    rendererSystemPrompt: redactText(systemPrompt.slice(0, 200), captureText),
    rendererUserMessage: redactText(rendererUserMessage.slice(0, 500), captureText),

    // Output
    rawReply: redactText(rawReply, captureText),
    sanitizedReply: redactText(sanitizedReply, captureText),
    replyChanged: (rawReply || '') !== (sanitizedReply || ''),

    // Performance
    durationMs: durationMs || 0,
    modelUsed: modelUsed || null,

    // Error
    error: error || null,
  };
}

/**
 * Remove every record belonging to the supplied session IDs.
 *
 * Privacy wins over diagnostics: if a JSONL file is unreadable, the whole file is
 * removed because an unparseable line cannot be proved unrelated to the learner.
 */
function deleteSessionTurns(filePath, options = {}) {
  const targets = new Set(
    Array.from(options.sessionIds || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const learnerKeys = new Set(
    Array.from(options.learnerKeys || [])
      .map((value) => String(value || '').trim())
      .filter(Boolean),
  );
  const removeUnattributed = options.removeUnattributed !== false;
  const fileExists = Boolean(filePath && fs.existsSync(filePath));
  if (
    !filePath
    || (targets.size === 0 && learnerKeys.size === 0)
    || !fileExists
  ) {
    return {
      success: true,
      inspected: fileExists ? 1 : 0,
      removedRecords: 0,
      removedFile: false,
      remainingTargetRecords: 0,
    };
  }

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.delete.tmp`;
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split('\n').filter((line) => line.trim());
    const records = [];
    for (const line of lines) {
      try {
        records.push(JSON.parse(line));
      } catch {
        fs.unlinkSync(filePath);
        return {
          success: true,
          inspected: 1,
          removedRecords: null,
          removedFile: true,
          reason: 'unreadable-eval-store',
          remainingTargetRecords: 0,
        };
      }
    }

    const shouldRemove = (record) => {
      const sessionId = String(record?.sessionId || '');
      const learnerKey = String(record?.learnerKey || '');
      return (
        targets.has(sessionId)
        || learnerKeys.has(learnerKey)
        || (removeUnattributed && !learnerKey)
      );
    };
    const kept = records.filter((record) => !shouldRemove(record));
    const removedRecords = records.length - kept.length;
    if (kept.length === 0) {
      fs.unlinkSync(filePath);
    } else {
      fs.writeFileSync(
        tempPath,
        `${kept.map((record) => JSON.stringify(record)).join('\n')}\n`,
        { encoding: 'utf8', mode: 0o600 },
      );
      fs.chmodSync?.(tempPath, 0o600);
      fs.renameSync(tempPath, filePath);
      fs.chmodSync?.(filePath, 0o600);
    }

    const remainingTargetRecords = fs.existsSync(filePath)
      ? readTurnRecords(filePath).filter(shouldRemove).length
      : 0;
    if (remainingTargetRecords > 0) {
      throw new Error('Eval deletion verification found learner session records.');
    }
    return {
      success: true,
      inspected: 1,
      removedRecords,
      removedFile: kept.length === 0,
      remainingTargetRecords,
    };
  } catch (error) {
    try { fs.unlinkSync(tempPath); } catch { /* best-effort cleanup */ }
    return {
      success: false,
      inspected: 1,
      removedRecords: 0,
      removedFile: false,
      remainingTargetRecords: null,
      reason: error?.message || String(error),
    };
  }
}

/**
 * Append a turn record to a JSONL file.
 */
function appendTurnRecord(filePath, record) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
}

/**
 * Read all turn records from a JSONL file.
 */
function readTurnRecords(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, 'utf8');
  return content
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      try { return JSON.parse(line); } catch { return null; }
    })
    .filter(Boolean);
}

/**
 * Read turns for a specific session.
 */
function readSessionTurns(filePath, sessionId) {
  return readTurnRecords(filePath).filter((r) => r.sessionId === sessionId);
}

/**
 * Generate a golden fixture from a turn record.
 * Used to convert real sessions into regression tests.
 */
function turnToGoldenFixture(record, name = '') {
  return {
    name: name || `Session ${record.sessionId} turn ${record.turnIndex} — ${record.signal?.intent || 'unknown'}`,
    input: {
      voiceState: {}, // Would need to be captured separately
      userMessage: record.userMessage,
      practiceMode: record.practiceMode,
      targetPreset: record.targetPreset,
    },
    expect: {
      'policy.shouldCorrect': record.signal?.shouldCorrect,
      'policy.safetyState': record.signal?.safetyState,
      'observation.primaryIssue': record.signal?.primaryIssue || null,
      'coachMove.intent': record.signal?.intent,
    },
    metadata: {
      source: 'replay',
      originalSessionId: record.sessionId,
      originalTurnIndex: record.turnIndex,
      recordedAt: record.recordedAt,
      rawReply: record.rawReply,
      sanitizedReply: record.sanitizedReply,
    },
  };
}

/**
 * Compute session-level analytics from turn records.
 */
function computeSessionAnalytics(turns) {
  if (!turns || turns.length === 0) return null;

  const intents = {};
  const issues = {};
  let totalDuration = 0;
  let correctionCount = 0;
  let safetyHits = 0;
  let replyChanges = 0;

  for (const turn of turns) {
    const intent = turn.signal?.intent || 'unknown';
    intents[intent] = (intents[intent] || 0) + 1;

    const issue = turn.signal?.primaryIssue;
    if (issue) issues[issue] = (issues[issue] || 0) + 1;

    totalDuration += turn.durationMs || 0;
    if (turn.signal?.shouldCorrect) correctionCount++;
    if (turn.signal?.safetyState && turn.signal.safetyState !== 'normal') safetyHits++;
    if (turn.replyChanged) replyChanges++;
  }

  return {
    turnCount: turns.length,
    intents,
    issues,
    avgDurationMs: Math.round(totalDuration / turns.length),
    totalDurationMs: totalDuration,
    correctionRate: (correctionCount / turns.length).toFixed(2),
    safetyHitRate: (safetyHits / turns.length).toFixed(2),
    replyChangeRate: (replyChanges / turns.length).toFixed(2),
    firstTurn: turns[0]?.recordedAt,
    lastTurn: turns[turns.length - 1]?.recordedAt,
  };
}

/**
 * Wrap a coaching turn function with eval recording.
 *
 * @param {Function} coachFn - async (session, question) => result
 * @param {Object} options
 * @param {string} options.evalPath - Path to JSONL file
 * @param {string} options.sessionId - Session ID
 * @returns {Function} Wrapped function that records each turn
 */
function withEvalRecording(coachFn, options = {}) {
  const {
    evalPath,
    sessionId,
    captureText = false,
    isolatedEvaluation = false,
  } = options;
  let turnIndex = 0;

  return async function recordedCoachTurn(session, question) {
    const start = Date.now();
    const result = await coachFn(session, question);
    const durationMs = Date.now() - start;

    if (evalPath) {
      const record = createTurnRecord({
        sessionId,
        studentId: session?.studentId || null,
        turnIndex,
        signal: result.coachingSignal || result.signal,
        targetMetricShadowWitness: result.targetMetricShadowWitness || null,
        rendererMessages: result.messages,
        rawReply: result.rawReply || result.coachMessage || result.message,
        sanitizedReply: result.sanitizedReply || result.coachMessage || result.message,
        userMessage: question,
        practiceMode: result.coachingSignal?.mode || 'active_drill',
        targetPreset: result.coachingSignal?.styleTarget,
        promptTokens: result.promptTokens,
        durationMs,
        modelUsed: session?.model || null,
      }, { captureText, isolatedEvaluation });
      appendTurnRecord(evalPath, record);
    }

    turnIndex++;
    return result;
  };
}

module.exports = {
  EVAL_SCHEMA_VERSION,
  createTurnRecord,
  appendTurnRecord,
  readTurnRecords,
  readSessionTurns,
  deleteSessionTurns,
  turnToGoldenFixture,
  computeSessionAnalytics,
  withEvalRecording,
};
