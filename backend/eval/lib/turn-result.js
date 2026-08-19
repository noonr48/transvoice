'use strict';

function normalizeFailureText(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text.slice(0, 240) : fallback;
}

/**
 * A model-behaviour evaluator may score only a real successful model turn.
 * Deterministic fallbacks are valid product recovery, but they are not evidence
 * about the model under test.
 */
function getEvalTurnFailure(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return 'invalid or missing turn response';
  }
  if (body.success === false) {
    return normalizeFailureText(body.error, 'turn response reported failure');
  }
  if (body.fallbackReply === true) {
    return normalizeFailureText(
      body.fallbackReason,
      'turn used a deterministic fallback reply',
    );
  }
  if (typeof body.error === 'string' && body.error.trim()) {
    return normalizeFailureText(body.error, 'turn response reported an error');
  }
  return null;
}

function resultHasEvalFailure(result) {
  return Boolean(
    result?.error
    || (Array.isArray(result?.turns) && result.turns.some((turn) => (
      turn?.error || turn?.fallbackReply === true
    ))),
  );
}

module.exports = {
  getEvalTurnFailure,
  resultHasEvalFailure,
};
