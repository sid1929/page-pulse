'use strict';

const MAX_URL_LENGTH = 2048;

class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
  }
}

/**
 * Validates that `raw` is a well-formed, publicly-fetchable http(s) URL.
 * Rejects private/loopback hosts to stop the service being used as an
 * internal-network probe (basic SSRF guard).
 */
function validateUrl(raw) {
  if (typeof raw !== 'string' || raw.trim().length === 0) {
    throw new ValidationError('"url" is required and must be a non-empty string');
  }
  if (raw.length > MAX_URL_LENGTH) {
    throw new ValidationError(`"url" exceeds max length of ${MAX_URL_LENGTH} characters`);
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new ValidationError('"url" is not a valid URL');
  }

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new ValidationError('"url" must use http or https');
  }

  const hostname = parsed.hostname.toLowerCase();
  const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  const isPrivateIp =
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(hostname) ||
    /^169\.254\./.test(hostname);

  if (blockedHosts.includes(hostname) || isPrivateIp) {
    throw new ValidationError('"url" resolves to a private or loopback address, which is not allowed');
  }

  return parsed;
}

module.exports = { validateUrl, ValidationError };
