'use strict';

const LOOPBACK_ADDRESSES = new Set([
  '127.0.0.1',
  '::1',
  '::ffff:127.0.0.1',
]);

function normalizeAddress(value) {
  const address = typeof value === 'string' ? value.trim() : '';
  const ipv4Mapped = address.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i);
  return ipv4Mapped ? ipv4Mapped[1] : address;
}

function normalizeHeaderValue(value) {
  if (Array.isArray(value)) {
    return typeof value[0] === 'string' ? value[0].trim() : '';
  }
  return typeof value === 'string' ? value.trim() : '';
}

function parseIpv4Address(value) {
  const address = normalizeAddress(value);
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
    return null;
  }

  const parts = address.split('.').map((part) => Number(part));
  if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts;
}

function isLoopbackAddress(value) {
  const address = normalizeAddress(value);
  return LOOPBACK_ADDRESSES.has(address);
}

function isTailscaleAddress(value) {
  const parts = parseIpv4Address(value);
  if (!parts) {
    return false;
  }
  return parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127;
}

function isTrustedLocalAddress(value) {
  return isLoopbackAddress(value) || isTailscaleAddress(value);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!normalized) return fallback;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(normalized)) return false;
  return fallback;
}

function normalizeTrustMode(value, fallback = 'trusted-local') {
  const normalized = String(value || '').trim().toLowerCase();
  if (['off', 'none', 'token', 'token-only'].includes(normalized)) return 'off';
  if (['loopback', 'localhost', 'local-only'].includes(normalized)) return 'loopback';
  if (['trusted-local', 'trusted', 'tailscale', 'loopback-and-tailscale'].includes(normalized)) {
    return 'trusted-local';
  }
  return fallback;
}

function readAdminToken(req = {}) {
  const headerToken = normalizeHeaderValue(
    req.headers?.['x-sloane-admin-token'] || req.headers?.['x-admin-token'],
  );
  if (headerToken) {
    return headerToken;
  }

  const authorization = normalizeHeaderValue(req.headers?.authorization);
  if (!authorization) {
    return '';
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

function getResolvedClientAddress(req = {}) {
  if (typeof req.ip === 'string' && req.ip.trim()) {
    return req.ip.trim();
  }

  if (Array.isArray(req.ips)) {
    const forwardedAddress = req.ips.find((value) => typeof value === 'string' && value.trim());
    if (forwardedAddress) {
      return forwardedAddress.trim();
    }
  }

  if (typeof req.socket?.remoteAddress === 'string' && req.socket.remoteAddress.trim()) {
    return req.socket.remoteAddress.trim();
  }

  if (typeof req.connection?.remoteAddress === 'string' && req.connection.remoteAddress.trim()) {
    return req.connection.remoteAddress.trim();
  }

  return '';
}

function isLocalRequest(req = {}) {
  const resolvedClientAddress = getResolvedClientAddress(req);
  return resolvedClientAddress ? isTrustedLocalAddress(resolvedClientAddress) : false;
}

function requestMatchesTrustMode(req = {}, mode = 'trusted-local') {
  const normalizedMode = normalizeTrustMode(mode);
  if (normalizedMode === 'off') return false;
  const resolvedClientAddress = getResolvedClientAddress(req);
  if (!resolvedClientAddress) return false;
  if (normalizedMode === 'loopback') return isLoopbackAddress(resolvedClientAddress);
  return isTrustedLocalAddress(resolvedClientAddress);
}

function createSensitiveRouteGuard(options = {}) {
  const {
    adminToken = '',
    allowLocalRequests = true,
    localTrustMode = 'trusted-local',
    routeLabel = 'Sensitive route',
  } = options;
  const normalizedAdminToken = typeof adminToken === 'string' ? adminToken.trim() : '';
  const normalizedLocalTrustMode = normalizeTrustMode(localTrustMode);

  return function sensitiveRouteGuard(req, res, next) {
    if (allowLocalRequests && requestMatchesTrustMode(req, normalizedLocalTrustMode)) {
      next();
      return;
    }

    if (normalizedAdminToken && readAdminToken(req) === normalizedAdminToken) {
      next();
      return;
    }

    res.status(403).json({
      success: false,
      code: 'SENSITIVE_ROUTE_ACCESS_DENIED',
      error: `${routeLabel} requires a local request or valid admin token.`,
    });
  };
}

module.exports = {
  LOOPBACK_ADDRESSES,
  createSensitiveRouteGuard,
  getResolvedClientAddress,
  isLocalRequest,
  isLoopbackAddress,
  isTailscaleAddress,
  isTrustedLocalAddress,
  normalizeBoolean,
  normalizeTrustMode,
  requestMatchesTrustMode,
  readAdminToken,
};
