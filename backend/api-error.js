'use strict';

function normalizeText(value) {
  return typeof value === 'string' && value.trim()
    ? value.trim()
    : '';
}

function resolveStatusCode(options = {}) {
  if (Number.isInteger(options.statusCode)) {
    return options.statusCode;
  }
  if (Number.isInteger(options.status)) {
    return options.status;
  }
  return 500;
}

function createFallbackApiError(message, options = {}) {
  const error = new Error(message || 'Request failed');
  const statusCode = resolveStatusCode(options);
  error.status = statusCode;
  error.statusCode = statusCode;

  const code = normalizeText(options.code);
  error.code = code || 'REQUEST_FAILED';

  if (options.payload && typeof options.payload === 'object') {
    error.payload = options.payload;
  }
  if (options.details && typeof options.details === 'object') {
    error.details = { ...options.details };
  }

  return error;
}

function getErrorStatusCode(error, fallbackStatus = 500) {
  if (Number.isInteger(error?.statusCode)) {
    return error.statusCode;
  }
  if (Number.isInteger(error?.status)) {
    return error.status;
  }
  return fallbackStatus;
}

function getErrorPayload(error, fallbackMessage = 'Request failed') {
  if (error?.payload && typeof error.payload === 'object') {
    return error.payload;
  }
  return {
    error: error?.message || fallbackMessage,
  };
}

module.exports = {
  createFallbackApiError,
  getErrorPayload,
  getErrorStatusCode,
};

