'use strict';

const { TtlCache } = require('./cache');
const { Semaphore } = require('./semaphore');
const logger = require('../utils/logger');

const DEFAULT_TIMEOUT_MS = Number(process.env.AUDIT_TIMEOUT_MS) || 8000;
const DEFAULT_CACHE_TTL_MS = Number(process.env.CACHE_TTL_MS) || 5 * 60 * 1000;
const DEFAULT_MAX_CONCURRENCY = Number(process.env.AUDIT_MAX_CONCURRENCY) || 10;

const cache = new TtlCache({ ttlMs: DEFAULT_CACHE_TTL_MS });
const semaphore = new Semaphore(DEFAULT_MAX_CONCURRENCY);

class UpstreamError extends Error {
  constructor(message, statusCode = 502) {
    super(message);
    this.name = 'UpstreamError';
    this.statusCode = statusCode;
  }
}

function extractTitle(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return match ? match[1].trim().slice(0, 300) : null;
}

function extractMetaDescription(html) {
  const match = /<meta\s+[^>]*name=["']description["'][^>]*>/i.exec(html);
  if (!match) return null;
  const contentMatch = /content=["']([\s\S]*?)["']/i.exec(match[0]);
  return contentMatch ? contentMatch[1].trim().slice(0, 500) : null;
}

function extractHeadingCounts(html) {
  const counts = {};
  for (let level = 1; level <= 6; level += 1) {
    const re = new RegExp(`<h${level}[\\s>]`, 'gi');
    counts[`h${level}`] = (html.match(re) || []).length;
  }
  return counts;
}

/**
 * Runs a single audit pass against `url`. Not exported directly — always
 * go through `auditUrl` so caching + concurrency limiting are applied.
 */
async function runAudit(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const release = await semaphore.acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'follow',
      headers: { 'User-Agent': 'PagePulse-Audit/1.0 (+https://digitalheroesco.com)' },
    });

    const responseTimeMs = Date.now() - startedAt;
    const contentType = response.headers.get('content-type') || '';
    const isHtml = contentType.includes('text/html');
    const html = isHtml ? await response.text() : '';

    if (!response.ok) {
      throw new UpstreamError(`Upstream responded with status ${response.status}`, 502);
    }

    return {
      url,
      auditedAt: new Date().toISOString(),
      status: {
        code: response.status,
        ok: response.ok,
        redirected: response.redirected,
        finalUrl: response.url,
      },
      performance: {
        responseTimeMs,
      },
      content: isHtml
        ? {
            title: extractTitle(html),
            metaDescription: extractMetaDescription(html),
            headingCounts: extractHeadingCounts(html),
            sizeBytes: Buffer.byteLength(html, 'utf8'),
          }
        : { note: `Non-HTML content-type (${contentType || 'unknown'}); content checks skipped` },
      headers: {
        contentType: contentType || null,
        server: response.headers.get('server') || null,
        cacheControl: response.headers.get('cache-control') || null,
      },
      fromCache: false,
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new UpstreamError(`Request to upstream timed out after ${timeoutMs}ms`, 504);
    }
    if (err instanceof UpstreamError) throw err;
    throw new UpstreamError(`Failed to reach upstream: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
    release();
  }
}

/**
 * Public entry point: cache-aware, concurrency-limited audit.
 * `cacheWindowMs` lets a caller override the TTL per request; otherwise
 * the service default (env-configurable) applies.
 */
async function auditUrl(rawUrl, { cacheWindowMs, requestId } = {}) {
  const cacheKey = rawUrl;
  const cached = cache.get(cacheKey);
  if (cached) {
    logger.info('cache hit', { requestId, url: rawUrl });
    return { ...cached, fromCache: true };
  }

  logger.info('cache miss, running audit', { requestId, url: rawUrl });
  const result = await runAudit(rawUrl);
  cache.set(cacheKey, result, cacheWindowMs);
  return result;
}

module.exports = { auditUrl, UpstreamError, cache, _internal: { extractTitle, extractMetaDescription, extractHeadingCounts } };
