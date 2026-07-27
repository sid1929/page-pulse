'use strict';

const http = require('http');
const crypto = require('crypto');
const { auditUrl } = require('./services/audit');
const { validateUrl, ValidationError } = require('./utils/validation');
const { RateLimiter } = require('./middleware/rateLimit');
const { toErrorResponse } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const RATE_LIMIT_CAPACITY = Number(process.env.RATE_LIMIT_CAPACITY) || 20;
const RATE_LIMIT_REFILL_PER_SEC = Number(process.env.RATE_LIMIT_REFILL_PER_SEC) || 0.5;
const MAX_BODY_BYTES = 10 * 1024; // audit requests are tiny JSON bodies

const limiter = new RateLimiter({
  capacity: RATE_LIMIT_CAPACITY,
  refillPerSec: RATE_LIMIT_REFILL_PER_SEC,
});

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) return forwarded.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413, name: 'PayloadTooLarge' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(Object.assign(new Error('Body must be valid JSON'), { statusCode: 400, name: 'ValidationError' }));
      }
    });
    req.on('error', reject);
  });
}

function send(res, statusCode, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
    ...extraHeaders,
  });
  res.end(payload);
}

async function handleAudit(req, res, requestId) {
  const rateResult = limiter.consume(req);
  if (!rateResult.allowed) {
    return send(
      res,
      429,
      { error: { code: 'RateLimitExceeded', message: 'Too many requests, slow down', requestId } },
      { 'Retry-After': Math.ceil(rateResult.retryAfterMs / 1000).toString() }
    );
  }

  const body = await readJsonBody(req);
  const parsedUrl = validateUrl(body.url);
  const cacheWindowMs = body.cacheWindowMs !== undefined ? Number(body.cacheWindowMs) : undefined;

  const result = await auditUrl(parsedUrl.toString(), { cacheWindowMs, requestId });
  send(res, 200, { requestId, result });
}

function handleHealth(req, res, requestId) {
  send(res, 200, {
    status: 'ok',
    service: 'page-pulse',
    builtFor: 'Built for Digital Heroes Training Task — digitalheroesco.com',
    requestId,
  });
}

const server = http.createServer(async (req, res) => {
  const requestId = req.headers['x-request-id'] || crypto.randomUUID();
  req.clientIp = getClientIp(req);
  const startedAt = Date.now();

  res.on('finish', () => {
    logger.info('request completed', {
      requestId,
      method: req.method,
      path: req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - startedAt,
      clientIp: req.clientIp,
    });
  });

  try {
    if (req.method === 'GET' && req.url === '/health') {
      return handleHealth(req, res, requestId);
    }
    if (req.method === 'POST' && req.url === '/audit') {
      return await handleAudit(req, res, requestId);
    }
    return send(res, 404, { error: { code: 'NotFound', message: 'No such route', requestId } });
  } catch (err) {
    if (!(err instanceof ValidationError)) {
      logger.error('unhandled error', { requestId, error: err.message, stack: err.stack });
    }
    const { statusCode, body } = toErrorResponse(err, requestId);
    return send(res, statusCode, body);
  }
});

module.exports = { server, limiter };
