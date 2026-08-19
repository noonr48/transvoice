'use strict';

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function isTruthyFlag(value) {
  if (value === true) return true;
  const normalized = normalizeText(String(value || '')).toLowerCase();
  return ['1', 'true', 'yes', 'y', 'on', 'enabled'].includes(normalized);
}

function legacyRagflowRuntimeAllowed(env = process.env, extraEnvKeys = []) {
  void env;
  void extraEnvKeys;
  return false;
}

function createLegacyRagflowDisabledError(surface = 'legacy RAGFlow') {
  const error = new Error(`${surface} is not supported in this no-RAGFlow runtime. Use object-memory/SimpleMem workflows.`);
  error.statusCode = 410;
  error.code = 'LEGACY_RAGFLOW_DISABLED';
  return error;
}

function assertLegacyRagflowAllowed(options = {}) {
  const env = options.env || process.env;
  const extraEnvKeys = Array.isArray(options.extraEnvKeys) ? options.extraEnvKeys : [];
  if (legacyRagflowRuntimeAllowed(env, extraEnvKeys)) {
    return true;
  }
  throw createLegacyRagflowDisabledError(options.surface);
}

module.exports = {
  assertLegacyRagflowAllowed,
  createLegacyRagflowDisabledError,
  isTruthyFlag,
  legacyRagflowRuntimeAllowed,
};
