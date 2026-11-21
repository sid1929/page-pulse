'use strict';

const { TtlCache } = require('./cache');
const { Semaphore } = require('./semaphore');
const logger = require('../utils/logger');
const { requestPinned } = require('./pinnedRequest');

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

function isHtmlContentType(contentType) {
  if (typeof contentType !== 'string') {
    return false;
  }

  const mimeType = contentType
    .split(';')[0]
    .trim()
    .toLowerCase();

  return [
    'text/html',
    'application/xhtml+xml',
  ].includes(mimeType);
}

function analyzeSecurityHeaders(headers = {}) {
  const normalized = Object.fromEntries(
    Object.entries(headers).map(([key, value]) => [
      key.toLowerCase(),
      value,
    ])
  );

  const checks = {
   contentSecurityPolicy: {
  header: 'content-security-policy',
  present: (() => {
    const value = String(
      normalized['content-security-policy'] || ''
    ).trim();

    if (!value) {
      return false;
    }

    const sourceDirectives = [
      'default-src',
      'script-src',
      'style-src',
      'img-src',
      'connect-src',
      'font-src',
      'object-src',
      'media-src',
      'frame-src',
      'child-src',
      'manifest-src',
      'worker-src',
      'base-uri',
      'form-action',
      'frame-ancestors',
    ];

    return value.split(';').some((directive) => {
      const name = directive.trim().split(/\s+/)[0]?.toLowerCase();
      return sourceDirectives.includes(name);
    });
  })(),
  description: 'Helps protect against cross-site scripting and content injection.',
},
    strictTransportSecurity: {
  header: 'strict-transport-security',
  present: (() => {
    const value = String(
      normalized['strict-transport-security'] || ''
    );

    const match = value.match(/(?:^|;)\s*max-age\s*=\s*(\d+)/i);

    if (!match) {
      return false;
    }

    const maxAge = Number(match[1]);

    return Number.isSafeInteger(maxAge) && maxAge >= 31536000;
  })(),
  description: 'Enforces HTTPS connections.',
},
    xContentTypeOptions: {
      header: 'x-content-type-options',
      present:
        String(normalized['x-content-type-options'] || '')
          .trim()
          .toLowerCase() === 'nosniff',
      description: 'Prevents MIME-type sniffing.',
    },
    xFrameOptions: {
      header: 'x-frame-options',
      present: ['deny', 'sameorigin'].includes(
        String(normalized['x-frame-options'] || '')
          .trim()
          .toLowerCase()
      ),
      description: 'Helps protect against clickjacking.',
    },
    referrerPolicy: {
  header: 'referrer-policy',
  present: (() => {
    const validPolicies = [
      'no-referrer',
      'no-referrer-when-downgrade',
      'origin',
      'origin-when-cross-origin',
      'same-origin',
      'strict-origin',
      'strict-origin-when-cross-origin',
      'unsafe-url',
    ];

    const value = String(
      normalized['referrer-policy'] || ''
    );

    const policies = value
      .split(',')
      .map((policy) => policy.trim().toLowerCase())
      .filter(Boolean);

    return (
      policies.length > 0 &&
      validPolicies.includes(policies[policies.length - 1])
    );
  })(),
  description: 'Controls referrer information shared with other sites.',
},
    permissionsPolicy: {
  header: 'permissions-policy',
  present: (() => {
    const value = String(
      normalized['permissions-policy'] || ''
    ).trim();

    if (!value) {
      return false;
    }

    const directives = value.split(',');

    return directives.every((directive) => {
      const match = directive.trim().match(
        /^([a-z][a-z0-9-]*)\s*=\s*\(([^)]*)\)$/i
      );

      if (!match) {
        return false;
      }

      const feature = match[1];
      const allowlist = match[2].trim();

      // Empty allowlists, such as camera=(), are valid.
      if (!allowlist) {
        return true;
      }

      // Validate common allowlist entries.
      const entries = allowlist.split(/\s+/);

      return entries.every((entry) =>
        entry === '*' ||
        entry === 'self' ||
        entry === 'src' ||
        /^https?:\/\/[^\s]+$/i.test(entry)
      );
    });
  })(),
  description: 'Controls access to browser features.',
},};

  const results = Object.fromEntries(
    Object.entries(checks).map(([key, check]) => [
      key,
      {
        header: check.header,
        present: check.present,
        description: check.description,
        status: check.present ? 'present' : 'missing',
      },
    ])
  );

  const total = Object.keys(results).length;
  const passed = Object.values(results).filter(
    (item) => item.present
  ).length;

  return {
    score: Math.round((passed / total) * 100),
    total,
    passed,
    missing: total - passed,
    checks: results,
  };
}
function analyzeCookies(setCookieHeaders = []) {
  if (!Array.isArray(setCookieHeaders)) {
    setCookieHeaders = setCookieHeaders
      ? [setCookieHeaders]
      : [];
  }

  const cookies = setCookieHeaders.map((cookieString) => {
    const parts = String(cookieString).split(';');

    const [nameValue = ''] = parts;
    const separatorIndex = nameValue.indexOf('=');

    const name = separatorIndex > 0
      ? nameValue.slice(0, separatorIndex).trim()
      : null;

    const attributes = {};

    for (const part of parts.slice(1)) {
      const separator = part.indexOf('=');

      const attributeName = (
        separator === -1 ? part : part.slice(0, separator)
      ).trim().toLowerCase();

      const attributeValue = separator === -1
        ? true
        : part.slice(separator + 1).trim();

      if (attributeName) {
        attributes[attributeName] = attributeValue;
      }
    }

    const sameSite = typeof attributes.samesite === 'string'
      ? attributes.samesite.toLowerCase()
      : null;

    const maxAge = attributes['max-age'] !== undefined
      ? Number(attributes['max-age'])
      : null;

    const expires = attributes.expires
      ? Date.parse(attributes.expires)
      : null;
    const isHostPrefix = name?.startsWith('__Host-') || false;
const isSecurePrefix = name?.startsWith('__Secure-') || false;

const hostPrefixValid =
  !isHostPrefix ||
  (
    attributes.secure === true &&
    attributes.path === '/' &&
    attributes.domain === undefined
  );

const securePrefixValid =
  !isSecurePrefix || attributes.secure === true;

    const checks = {
      httpOnly: attributes.httponly === true,
      secure: attributes.secure === true,
      sameSite: ['strict', 'lax', 'none'].includes(sameSite),
      sameSiteNoneRequiresSecure:
        sameSite !== 'none' || attributes.secure === true,
      maxAge: maxAge !== null && Number.isInteger(maxAge),
      expires: expires !== null && Number.isFinite(expires),
      domain: typeof attributes.domain === 'string',
      path: typeof attributes.path === 'string',
      hostPrefix: hostPrefixValid,
      securePrefix: securePrefixValid,
    };

    const passed = Object.values(checks).filter(Boolean).length;

    return {
      name,
      checks,
      score: Math.round((passed / Object.keys(checks).length) * 100),
      attributes: {
        sameSite,
        maxAge,
        expires: expires !== null && Number.isFinite(expires)
          ? new Date(expires).toISOString()
          : null,
        domain: attributes.domain || null,
        path: attributes.path || null,
      },
    };
  });

const securityChecks = [
  'httpOnly',
  'secure',
  'sameSite',
  'sameSiteNoneRequiresSecure',
  'hostPrefix',
  'securePrefix',
];

const totalChecks = cookies.length * securityChecks.length;
const passedChecks = cookies.reduce(
  (total, cookie) =>
    total + securityChecks.filter((check) => cookie.checks[check]).length,
  0
);

const secureCookies = cookies.filter((cookie) => {
  const checks = cookie.checks;

  return (
    checks.httpOnly &&
    checks.secure &&
    checks.sameSite &&
    checks.sameSiteNoneRequiresSecure &&
    checks.hostPrefix &&
    checks.securePrefix
  );
}).length;

const insecureCookies = cookies.length - secureCookies;

const score = totalChecks === 0
  ? null
  : Math.round((passedChecks / totalChecks) * 100);

return {
  total: cookies.length,
  secureCookies,
  insecureCookies,
  score,
  cookies,
};}

function calculateRiskScore({
  url,
  securityHeaders,
  cookieAnalysis,
  tls,
}) {
  const categories = [];

  // Security headers: 40% weight
  if (typeof securityHeaders?.score === 'number') {
    categories.push({
      name: 'securityHeaders',
      score: securityHeaders.score,
      weight: 40,
    });
  }

  // Cookie security: 35% weight
  if (typeof cookieAnalysis?.score === 'number') {
    categories.push({
      name: 'cookies',
      score: cookieAnalysis.score,
      weight: 35,
    });
  }

  // TLS security: 25% weight
  if (url.startsWith('http://')) {
    categories.push({
      name: 'tls',
      score: 0,
      weight: 25,
    });
  } else if (tls && typeof tls.authorized === 'boolean') {
    categories.push({
      name: 'tls',
      score: tls.authorized ? 100 : 0,
      weight: 25,
    });
  }

  const totalWeight = categories.reduce(
    (total, category) => total + category.weight,
    0
  );

  if (totalWeight === 0) {
    return {
      score: null,
      riskLevel: 'Unknown',
      categories,
    };
  }

  const weightedScore = categories.reduce(
    (total, category) =>
      total + category.score * category.weight,
    0
  );

  const score = Math.round(weightedScore / totalWeight);

  let riskLevel;

  if (score >= 90) {
    riskLevel = 'Low';
  } else if (score >= 70) {
    riskLevel = 'Medium';
  } else if (score >= 40) {
    riskLevel = 'High';
  } else {
    riskLevel = 'Critical';
  }

  return {
    score,
    riskLevel,
    categories,
  };
}
function generateFindings({ securityHeaders, cookieAnalysis, tls, url }) {
  const findings = [];

  // Security header findings
  if (securityHeaders?.checks) {
    for (const [key, check] of Object.entries(securityHeaders.checks)) {
      if (!check.present) {
        findings.push({
          id: `header-${key}`,
          title: `Missing ${check.header}`,
          severity: key === 'contentSecurityPolicy' ||
            key === 'strictTransportSecurity'
              ? 'High'
              : 'Medium',
          category: 'Security Headers',
          description: check.description,
          impact: `The website does not have a valid ${check.header} configuration.`,
          remediation: `Configure the ${check.header} HTTP response header with an appropriate security policy.`,
        });
      }
    }
  }

  // Cookie findings
  if (cookieAnalysis?.cookies) {
    for (const cookie of cookieAnalysis.cookies) {
      const checks = cookie.checks;

      if (!checks.httpOnly) {
        findings.push({
          id: `cookie-${cookie.name}-httponly`,
          title: `Cookie ${cookie.name} missing HttpOnly`,
          severity: 'Medium',
          category: 'Cookie Security',
          description: 'The cookie does not have the HttpOnly attribute.',
          impact: 'Client-side JavaScript may be able to access this cookie.',
          remediation: 'Add the HttpOnly attribute to sensitive cookies.',
        });
      }

      if (!checks.secure) {
        findings.push({
          id: `cookie-${cookie.name}-secure`,
          title: `Cookie ${cookie.name} missing Secure`,
          severity: 'High',
          category: 'Cookie Security',
          description: 'The cookie does not have the Secure attribute.',
          impact: 'The cookie may be transmitted over an unencrypted HTTP connection.',
          remediation: 'Add the Secure attribute and serve the website exclusively over HTTPS.',
        });
      }

      if (!checks.sameSite) {
        findings.push({
          id: `cookie-${cookie.name}-samesite`,
          title: `Cookie ${cookie.name} has invalid or missing SameSite`,
          severity: 'Medium',
          category: 'Cookie Security',
          description: 'The cookie does not have a recognized SameSite policy.',
          impact: 'Cross-site requests may include the cookie depending on browser behavior.',
          remediation: 'Configure SameSite=Lax or SameSite=Strict where appropriate.',
        });
      }

      if (!checks.sameSiteNoneRequiresSecure) {
        findings.push({
          id: `cookie-${cookie.name}-samesite-secure`,
          title: `Cookie ${cookie.name} uses SameSite=None without Secure`,
          severity: 'High',
          category: 'Cookie Security',
          description: 'SameSite=None requires the Secure attribute in modern browsers.',
          impact: 'Browsers may reject the cookie.',
          remediation: 'Add the Secure attribute when using SameSite=None.',
        });
      }

      if (!checks.hostPrefix) {
        findings.push({
          id: `cookie-${cookie.name}-host-prefix`,
          title: `Cookie ${cookie.name} violates __Host- prefix requirements`,
          severity: 'High',
          category: 'Cookie Security',
          description: 'The cookie does not satisfy the __Host- prefix requirements.',
          impact: 'The browser may reject the cookie or its intended host restrictions may not apply.',
          remediation: 'Use Secure, Path=/, and omit Domain for __Host- cookies.',
        });
      }

      if (!checks.securePrefix) {
        findings.push({
          id: `cookie-${cookie.name}-secure-prefix`,
          title: `Cookie ${cookie.name} violates __Secure- prefix requirements`,
          severity: 'High',
          category: 'Cookie Security',
          description: 'The cookie uses the __Secure- prefix without Secure.',
          impact: 'The browser may reject the cookie.',
          remediation: 'Add the Secure attribute to __Secure- cookies.',
        });
      }
    }
  }

  // TLS findings
  if (url.startsWith('http://')) {
    findings.push({
      id: 'tls-no-https',
      title: 'Website does not use HTTPS',
      severity: 'Critical',
      category: 'TLS Security',
      description: 'The website uses an unencrypted HTTP connection.',
      impact: 'Data exchanged with the website may be intercepted or modified in transit.',
      remediation: 'Configure HTTPS with a valid TLS certificate and redirect HTTP traffic to HTTPS.',
    });
  } else if (tls && tls.authorized === false) {
    findings.push({
      id: 'tls-certificate-invalid',
      title: 'TLS certificate validation failed',
      severity: 'Critical',
      category: 'TLS Security',
      description: 'The TLS connection was not successfully authorized.',
      impact: 'The website identity or certificate trust could not be verified.',
      remediation: 'Investigate the certificate chain, hostname, validity period, and trust configuration.',
    });
  }

  const severityOrder = {
  Critical: 4,
  High: 3,
  Medium: 2,
  Low: 1,
};

findings.sort(
  (a, b) => severityOrder[b.severity] - severityOrder[a.severity]
);

const summary = {
  total: findings.length,
  critical: findings.filter(
    (finding) => finding.severity === 'Critical'
  ).length,
  high: findings.filter(
    (finding) => finding.severity === 'High'
  ).length,
  medium: findings.filter(
    (finding) => finding.severity === 'Medium'
  ).length,
  low: findings.filter(
    (finding) => finding.severity === 'Low'
  ).length,
};

return {
  summary,
  findings,
};
}

/**
 * Runs a single audit pass against `url`. Not exported directly — always
 * go through `auditUrl` so caching + concurrency limiting are applied.
 */
async function runAudit(url, { timeoutMs = DEFAULT_TIMEOUT_MS,requestFn = requestPinned, } = {}) {
  const release = await semaphore.acquire();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await requestFn(url, {
  signal: controller.signal,
  timeoutMs,
  maxBytes: 2 * 1024 * 1024,
});

const responseTimeMs = Date.now() - startedAt;
const contentType = response.headers['content-type'] || '';
const isHtml = isHtmlContentType(contentType);
const securityHeaders = analyzeSecurityHeaders(response.headers);
const cookieAnalysis = analyzeCookies(
  response.headers['set-cookie'] || []
);
const riskAssessment = calculateRiskScore({
  url,
  securityHeaders,
  cookieAnalysis,
  tls: response.tls,
});
const findings = generateFindings({
  securityHeaders,
  cookieAnalysis,
  tls: response.tls,
  url,
});
const html = isHtml ? response.body.toString('utf8') : '';
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
  server: response.headers.server || null,
  cacheControl: response.headers['cache-control'] || null,
},
securityHeaders,
cookieAnalysis,
riskAssessment,
findings,
tls: response.tls,
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

module.exports = { auditUrl, UpstreamError, cache, _internal: { extractTitle, extractMetaDescription, extractHeadingCounts, isHtmlContentType, analyzeSecurityHeaders, analyzeCookies, calculateRiskScore, generateFindings, runAudit } };
