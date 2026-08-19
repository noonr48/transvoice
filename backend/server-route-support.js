const fs = require('fs');

const {
  createFallbackApiError,
  getErrorPayload,
  getErrorStatusCode,
} = require('./api-error');

function cloneObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? { ...value }
    : {};
}

function isPromiseLike(value) {
  return Boolean(value)
    && (typeof value === 'object' || typeof value === 'function')
    && typeof value.then === 'function';
}

function cleanupUploadedFile(filePath, deps = {}) {
  const fsImpl = deps.fs || fs;
  if (typeof filePath !== 'string' || !filePath) {
    return false;
  }
  try {
    fsImpl.unlinkSync(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseOptionalJsonObject(value, fallback = {}) {
  const normalizedFallback = cloneObject(fallback);
  if (value == null || value === '') {
    return normalizedFallback;
  }
  if (typeof value === 'object' && !Array.isArray(value)) {
    return {
      ...normalizedFallback,
      ...value,
    };
  }
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? {
        ...normalizedFallback,
        ...parsed,
      }
      : normalizedFallback;
  } catch {
    return normalizedFallback;
  }
}

function isAsyncRagUpload(file, metadata = {}, deps = {}) {
  const detectFileType = typeof deps.detectFileType === 'function'
    ? deps.detectFileType
    : deps.ragService && typeof deps.ragService.detectFileType === 'function'
      ? deps.ragService.detectFileType.bind(deps.ragService)
      : null;
  if (!detectFileType) {
    return false;
  }

  const originalName = typeof file?.originalname === 'string' ? file.originalname : '';
  const fileType = detectFileType(originalName);
  if (fileType === 'pdf') {
    return metadata?.forceSync !== true;
  }
  return false;
}

function buildPdfMcpJobKey(datasetId, originalName) {
  const normalizedDatasetId = typeof datasetId === 'string' ? datasetId.trim() : String(datasetId || '');
  const normalizedOriginalName = typeof originalName === 'string' ? originalName : String(originalName || '');
  return `${normalizedDatasetId}::${normalizedOriginalName}`;
}

function createDefaultRouteErrorSender() {
  return function sendDefaultRouteError(res, error, label = null) {
    if (label) {
      console.error(label, error);
    }
    res.status(getErrorStatusCode(error)).json(getErrorPayload(error));
  };
}

function createPayloadRouteErrorSender() {
  return function sendPayloadRouteError(res, error) {
    res.status(error.status || error.statusCode || 500).json(
      error.payload || { success: false, error: error.message },
    );
  };
}

function createDefaultPayloadRouteErrorSender() {
  return createPayloadRouteErrorSender();
}

function normalizeRouteMiddlewares(middlewares) {
  if (Array.isArray(middlewares)) {
    return middlewares;
  }
  return middlewares ? [middlewares] : [];
}

function resolveRouteErrorLabel(req, errorLabel, errorLabelForRequest) {
  return typeof errorLabelForRequest === 'function'
    ? errorLabelForRequest(req)
    : errorLabel;
}

function hasRouteResponseEnded(res, responseEndedKey = 'headersSent') {
  if (typeof responseEndedKey === 'function') {
    return responseEndedKey(res);
  }
  return Boolean(res?.[responseEndedKey]);
}

function registerJsonRoute(app, method, path, handler, options = {}) {
  const {
    middlewares = [],
    sendRouteError = createDefaultRouteErrorSender(),
    errorLabel = null,
    errorLabelForRequest = null,
    isAsync = false,
  } = options;
  const routeMiddlewares = normalizeRouteMiddlewares(middlewares);
  void isAsync;

  app[method](path, ...routeMiddlewares, (req, res) => {
    const label = resolveRouteErrorLabel(req, errorLabel, errorLabelForRequest);
    let result;
    try {
      result = handler(req, res);
    } catch (error) {
      sendRouteError(res, error, label);
      return undefined;
    }

    if (isPromiseLike(result)) {
      return result.then((payload) => {
        res.json(payload);
        return payload;
      }).catch((error) => {
        sendRouteError(res, error, label);
        return undefined;
      });
    }

    res.json(result);
    return result;
  });
}

function registerPayloadRoute(app, method, path, handler, options = {}) {
  const {
    middlewares = [],
    sendRouteError = createDefaultRouteErrorSender(),
    errorLabel = null,
    errorLabelForRequest = null,
  } = options;
  const routeMiddlewares = normalizeRouteMiddlewares(middlewares);

  app[method](path, ...routeMiddlewares, async (req, res) => {
    try {
      const result = await handler(req, res);
      res.status(result.statusCode).json(result.payload);
    } catch (error) {
      sendRouteError(
        res,
        error,
        resolveRouteErrorLabel(req, errorLabel, errorLabelForRequest),
      );
    }
  });
}

function registerVoidRoute(app, method, path, handler, options = {}) {
  const {
    middlewares = [],
    sendRouteError = createDefaultRouteErrorSender(),
    errorLabel = null,
    errorLabelForRequest = null,
    ignoreErrorIfResponseEnded = false,
    responseEndedKey = 'headersSent',
    isAsync = false,
  } = options;
  const routeMiddlewares = normalizeRouteMiddlewares(middlewares);
  const shouldSendError = (res) => (
    !ignoreErrorIfResponseEnded || !hasRouteResponseEnded(res, responseEndedKey)
  );
  void isAsync;

  app[method](path, ...routeMiddlewares, (req, res) => {
    const label = resolveRouteErrorLabel(req, errorLabel, errorLabelForRequest);
    let result;
    try {
      result = handler(req, res);
    } catch (error) {
      if (shouldSendError(res)) {
        sendRouteError(res, error, label);
      }
      return undefined;
    }

    if (isPromiseLike(result)) {
      return result.catch((error) => {
        if (shouldSendError(res)) {
          sendRouteError(res, error, label);
        }
        return undefined;
      });
    }

    return result;
  });
}

function buildApiErrorPayload(error, fallbackCode = 'REQUEST_FAILED') {
  const message = error?.message || 'Request failed';
  return {
    success: false,
    code: error?.code || fallbackCode,
    error: message,
    message,
    ...(error?.details ? { details: error.details } : {}),
  };
}

function createApiError(message, options = {}) {
  return createFallbackApiError(message, options);
}

function isRequestEntityTooLargeError(error) {
  return error?.type === 'entity.too.large'
    || error?.status === 413
    || error?.statusCode === 413;
}

function sendApiErrorResponse(res, error, fallbackCode = 'REQUEST_FAILED') {
  const statusCode = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  return res.status(statusCode).json(buildApiErrorPayload(error, fallbackCode));
}

module.exports = {
  buildApiErrorPayload,
  buildPdfMcpJobKey,
  cleanupUploadedFile,
  createApiError,
  createDefaultPayloadRouteErrorSender,
  createDefaultRouteErrorSender,
  createPayloadRouteErrorSender,
  isAsyncRagUpload,
  isRequestEntityTooLargeError,
  parseOptionalJsonObject,
  registerJsonRoute,
  registerPayloadRoute,
  registerVoidRoute,
  sendApiErrorResponse,
};
