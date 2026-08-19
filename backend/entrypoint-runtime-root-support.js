'use strict';

function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function resolveInteractionRuntimeRoot(runtime, groupKey = null) {
  if (!isRecord(runtime)) {
    return {};
  }

  if (groupKey && isRecord(runtime[groupKey])) {
    return runtime[groupKey];
  }

  if (isRecord(runtime.serverInteractionRuntimeGraph)) {
    return runtime.serverInteractionRuntimeGraph;
  }

  return runtime;
}

module.exports = {
  isRecord,
  resolveInteractionRuntimeRoot,
};
