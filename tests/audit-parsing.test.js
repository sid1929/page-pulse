'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { _internal } = require('../src/services/audit');
const { runAudit } = _internal;
const {
  extractTitle,
  extractMetaDescription,
  extractHeadingCounts,
  isHtmlContentType,
  analyzeSecurityHeaders,
  analyzeCookies,
  calculateRiskScore,
  generateFindings,
} = _internal;

test('extracts title', () => {
  const html = '<html><head><title>  My Page  </title></head></html>';
  assert.equal(extractTitle(html), 'My Page');
});

test('returns null when no title present', () => {
  assert.equal(extractTitle('<html></html>'), null);
});

test('extracts meta description', () => {
  const html = '<meta name="description" content="A great page about testing">';
  assert.equal(extractMetaDescription(html), 'A great page about testing');
});

test('returns null when no meta description present', () => {
  assert.equal(extractMetaDescription('<html></html>'), null);
});

test('counts headings by level', () => {
  const html = '<h1>A</h1><h2>B</h2><h2>C</h2><h3>D</h3>';
  const counts = extractHeadingCounts(html);
  assert.equal(counts.h1, 1);
  assert.equal(counts.h2, 2);
  assert.equal(counts.h3, 1);
  assert.equal(counts.h4, 0);
});

test('accepts text/html content type', () => {
  assert.equal(isHtmlContentType('text/html'), true);
});

test('accepts HTML with charset parameter', () => {
  assert.equal(
    isHtmlContentType('text/html; charset=utf-8'),
    true
  );
});

test('accepts application/xhtml+xml', () => {
  assert.equal(
    isHtmlContentType('application/xhtml+xml'),
    true
  );
});

test('rejects JSON content type for HTML parsing', () => {
  assert.equal(isHtmlContentType('application/json'), false);
});

test('rejects PDF and image content types', () => {
  assert.equal(isHtmlContentType('application/pdf'), false);
  assert.equal(isHtmlContentType('image/png'), false);
});

test('safely rejects missing and malformed content types', () => {
  assert.equal(isHtmlContentType(undefined), false);
  assert.equal(isHtmlContentType(null), false);
  assert.equal(isHtmlContentType(''), false);
  assert.equal(isHtmlContentType('not-a-valid-type'), false);
});
test('returns zero score when all security headers are missing', () => {
  const result = analyzeSecurityHeaders({});

  assert.equal(result.score, 0);
  assert.equal(result.total, 6);
  assert.equal(result.passed, 0);
  assert.equal(result.missing, 6);
});

test('returns 100 score when all six security headers are present', () => {
  const headers = {
    'content-security-policy': "default-src 'self'",
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'strict-origin-when-cross-origin',
    'permissions-policy': 'camera=(), microphone=()',
  };

  const result = analyzeSecurityHeaders(headers);

  assert.equal(result.score, 100);
  assert.equal(result.total, 6);
  assert.equal(result.passed, 6);
  assert.equal(result.missing, 0);
});

test('calculates a partial security-header score correctly', () => {
  const headers = {
    'content-security-policy': "default-src 'self'",
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'strict-origin-when-cross-origin',
  };

  const result = analyzeSecurityHeaders(headers);

  assert.equal(result.score, 50);
  assert.equal(result.total, 6);
  assert.equal(result.passed, 3);
  assert.equal(result.missing, 3);
});

test('recognizes security headers regardless of header-name casing', () => {
  const headers = {
    'Content-Security-Policy': "default-src 'self'",
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
  };

  const result = analyzeSecurityHeaders(headers);

  assert.equal(result.passed, 3);
  assert.equal(result.score, 50);
});
test('rejects HSTS when max-age is zero', () => {
  const result = analyzeSecurityHeaders({
    'strict-transport-security': 'max-age=0',
  });

  assert.equal(
    result.checks.strictTransportSecurity.present,
    false
  );
});

test('rejects HSTS when max-age is missing', () => {
  const result = analyzeSecurityHeaders({
    'strict-transport-security': 'includeSubDomains',
  });

  assert.equal(
    result.checks.strictTransportSecurity.present,
    false
  );
});

test('accepts HSTS with a one-year max-age', () => {
  const result = analyzeSecurityHeaders({
    'strict-transport-security': 'max-age=31536000; includeSubDomains',
  });

  assert.equal(
    result.checks.strictTransportSecurity.present,
    true
  );
});
test('rejects an empty Content Security Policy', () => {
  const result = analyzeSecurityHeaders({
    'content-security-policy': '',
  });

  assert.equal(
    result.checks.contentSecurityPolicy.present,
    false
  );
});

test('rejects CSP without a default-src or other source directive', () => {
  const result = analyzeSecurityHeaders({
    'content-security-policy': 'upgrade-insecure-requests',
  });

  assert.equal(
    result.checks.contentSecurityPolicy.present,
    false
  );
});

test('recognizes a restrictive default-src policy', () => {
  const result = analyzeSecurityHeaders({
    'content-security-policy': "default-src 'self'",
  });

  assert.equal(
    result.checks.contentSecurityPolicy.present,
    true
  );
});
test('rejects invalid X-Frame-Options values', () => {
  const result = analyzeSecurityHeaders({
    'x-frame-options': 'ALLOWALL',
  });

  assert.equal(
    result.checks.xFrameOptions.present,
    false
  );
});

test('accepts DENY and SAMEORIGIN X-Frame-Options values', () => {
  const deny = analyzeSecurityHeaders({
    'x-frame-options': 'DENY',
  });

  const sameOrigin = analyzeSecurityHeaders({
    'x-frame-options': 'SAMEORIGIN',
  });

  assert.equal(deny.checks.xFrameOptions.present, true);
  assert.equal(sameOrigin.checks.xFrameOptions.present, true);
});

test('rejects empty X-Frame-Options values', () => {
  const result = analyzeSecurityHeaders({
    'x-frame-options': '',
  });

  assert.equal(
    result.checks.xFrameOptions.present,
    false
  );
});
test('rejects invalid Referrer-Policy values', () => {
  const result = analyzeSecurityHeaders({
    'referrer-policy': 'invalid-policy',
  });

  assert.equal(
    result.checks.referrerPolicy.present,
    false
  );
});

test('accepts valid Referrer-Policy values', () => {
  const policies = [
    'no-referrer',
    'no-referrer-when-downgrade',
    'origin',
    'origin-when-cross-origin',
    'same-origin',
    'strict-origin',
    'strict-origin-when-cross-origin',
    'unsafe-url',
  ];

  for (const policy of policies) {
    const result = analyzeSecurityHeaders({
      'referrer-policy': policy,
    });

    assert.equal(
      result.checks.referrerPolicy.present,
      true,
      `Expected ${policy} to be accepted`
    );
  }
});
test('rejects invalid Permissions-Policy values', () => {
  const result = analyzeSecurityHeaders({
    'permissions-policy': 'this-is-invalid',
  });

  assert.equal(
    result.checks.permissionsPolicy.present,
    false
  );
});

test('accepts valid Permissions-Policy configurations', () => {
  const policies = [
    'camera=()',
    'microphone=()',
    'geolocation=(self)',
    'camera=(self), microphone=()',
  ];

  for (const policy of policies) {
    const result = analyzeSecurityHeaders({
      'permissions-policy': policy,
    });

    assert.equal(
      result.checks.permissionsPolicy.present,
      true,
      `Expected ${policy} to be accepted`
    );
  }
});
test('includes TLS information in the audit result', async () => {
  const mockTls = {
    protocol: 'TLSv1.3',
    authorized: true,
    authorizationError: null,
    certificate: {
      subject: { CN: 'example.com' },
      issuer: { CN: 'Test CA' },
      validFrom: 'Nov 20 00:00:00 2026 GMT',
      validTo: 'Nov 20 00:00:00 2027 GMT',
      fingerprint256: 'AA:BB:CC:DD',
    },
  };

  const result = await runAudit('https://example.com', {
    requestFn: async () => ({
      status: 200,
      ok: true,
      redirected: false,
      url: 'https://example.com/',
      headers: {
        'content-type': 'text/html',
      },
      body: Buffer.from('<html><title>Test</title></html>'),
      tls: mockTls,
    }),
  });

  assert.deepEqual(result.tls, mockTls);
  assert.equal(result.tls.protocol, 'TLSv1.3');
  assert.equal(result.tls.authorized, true);
});
test('returns null TLS information for HTTP audit results', async () => {
  const result = await runAudit('http://example.com', {
    requestFn: async () => ({
      status: 200,
      ok: true,
      redirected: false,
      url: 'http://example.com/',
      headers: {
        'content-type': 'text/html',
      },
      body: Buffer.from('<html><title>HTTP Test</title></html>'),
      tls: null,
    }),
  });

  assert.equal(result.tls, null);
});
test('includes cookie security analysis in audit results', async () => {
  const result = await runAudit('https://example.com', {
    requestFn: async () => ({
      status: 200,
      ok: true,
      redirected: false,
      url: 'https://example.com/',
      headers: {
        'content-type': 'text/html',
        'set-cookie': [
          'sessionId=abc123; HttpOnly; Secure; SameSite=Strict; Path=/',
          'theme=dark; Path=/; SameSite=Lax',
        ],
      },
      body: Buffer.from('<html><title>Cookie Test</title></html>'),
      tls: null,
    }),
  });

  assert.equal(result.cookieAnalysis.total, 2);
  assert.ok(result.riskAssessment);
assert.ok(result.findings);
assert.equal(typeof result.findings.summary.total, 'number');
assert.ok(Array.isArray(result.findings.findings));

  assert.equal(result.cookieAnalysis.cookies[0].name, 'sessionId');
  assert.equal(result.cookieAnalysis.cookies[0].checks.httpOnly, true);
  assert.equal(result.cookieAnalysis.cookies[0].checks.secure, true);

  assert.equal(result.cookieAnalysis.cookies[1].name, 'theme');
  assert.equal(result.cookieAnalysis.cookies[1].checks.httpOnly, false);
  assert.equal(result.cookieAnalysis.cookies[1].checks.secure, false);
});
test('parses cookie name and security attributes', () => {
  const result = analyzeCookies([
    'sessionId=abc123; HttpOnly; Secure; SameSite=Strict; Path=/',
  ]);

  assert.equal(result.total, 1);
  assert.equal(result.cookies[0].name, 'sessionId');
  assert.equal(result.cookies[0].checks.httpOnly, true);
  assert.equal(result.cookies[0].checks.secure, true);
});

test('detects cookies missing HttpOnly and Secure flags', () => {
  const result = analyzeCookies([
    'sessionId=abc123; Path=/; SameSite=Lax',
  ]);

  assert.equal(result.cookies[0].checks.httpOnly, false);
  assert.equal(result.cookies[0].checks.secure, false);
});

test('supports multiple Set-Cookie headers', () => {
  const result = analyzeCookies([
    'sessionId=abc123; HttpOnly; Secure',
    'preferences=dark; Secure; SameSite=Lax',
  ]);

  assert.equal(result.total, 2);
  assert.equal(result.cookies[0].name, 'sessionId');
  assert.equal(result.cookies[1].name, 'preferences');
});
test('accepts valid SameSite values', () => {
  const values = ['Strict', 'Lax', 'None'];

  for (const value of values) {
    const result = analyzeCookies([
      `session=abc; SameSite=${value}; Secure`,
    ]);

    assert.equal(
      result.cookies[0].checks.sameSite,
      true
    );
  }
});

test('rejects invalid SameSite values', () => {
  const result = analyzeCookies([
    'session=abc; SameSite=Invalid',
  ]);

  assert.equal(
    result.cookies[0].checks.sameSite,
    false
  );
});

test('flags SameSite=None cookies without Secure', () => {
  const result = analyzeCookies([
    'session=abc; SameSite=None',
  ]);

  assert.equal(
    result.cookies[0].checks.sameSiteNoneRequiresSecure,
    false
  );
});
test('parses valid Max-Age values', () => {
  const result = analyzeCookies([
    'session=abc; Max-Age=3600',
  ]);

  assert.equal(result.cookies[0].checks.maxAge, true);
  assert.equal(result.cookies[0].attributes.maxAge, 3600);
});

test('rejects invalid Max-Age values', () => {
  const result = analyzeCookies([
    'session=abc; Max-Age=invalid',
  ]);

  assert.equal(result.cookies[0].checks.maxAge, false);
});

test('parses valid Expires dates', () => {
  const result = analyzeCookies([
    'session=abc; Expires=Wed, 21 Oct 2030 07:28:00 GMT',
  ]);

  assert.equal(result.cookies[0].checks.expires, true);
  assert.ok(result.cookies[0].attributes.expires);
});
test('parses cookie Domain and Path attributes', () => {
  const result = analyzeCookies([
    'session=abc; Domain=example.com; Path=/app',
  ]);

  assert.equal(result.cookies[0].checks.domain, true);
  assert.equal(result.cookies[0].checks.path, true);
  assert.equal(result.cookies[0].attributes.domain, 'example.com');
  assert.equal(result.cookies[0].attributes.path, '/app');
});

test('detects cookies missing Domain and Path attributes', () => {
  const result = analyzeCookies([
    'session=abc; HttpOnly; Secure',
  ]);

  assert.equal(result.cookies[0].checks.domain, false);
  assert.equal(result.cookies[0].checks.path, false);
});
test('accepts a valid __Host- cookie', () => {
  const result = analyzeCookies([
    '__Host-session=abc123; Secure; Path=/; HttpOnly',
  ]);

  assert.equal(result.cookies[0].checks.hostPrefix, true);
});

test('rejects an invalid __Host- cookie', () => {
  const result = analyzeCookies([
    '__Host-session=abc123; Secure; Path=/; Domain=example.com',
  ]);

  assert.equal(result.cookies[0].checks.hostPrefix, false);
});

test('accepts a __Secure- cookie with Secure attribute', () => {
  const result = analyzeCookies([
    '__Secure-session=abc123; Secure; Path=/',
  ]);

  assert.equal(result.cookies[0].checks.securePrefix, true);
});

test('rejects a __Secure- cookie without Secure attribute', () => {
  const result = analyzeCookies([
    '__Secure-session=abc123; Path=/',
  ]);

  assert.equal(result.cookies[0].checks.securePrefix, false);
});
test('calculates overall cookie security score', () => {
  const result = analyzeCookies([
    'session=abc; HttpOnly; Secure; SameSite=Strict; Path=/',
  ]);

  assert.equal(result.total, 1);
  assert.equal(result.secureCookies, 1);
  assert.equal(result.insecureCookies, 0);
  assert.equal(result.score, 100);
});

test('identifies cookies with failed security checks', () => {
  const result = analyzeCookies([
    'session=abc; HttpOnly; Secure; SameSite=Strict; Path=/',
    'theme=dark; Path=/',
  ]);

  assert.equal(result.total, 2);
  assert.equal(result.secureCookies, 1);
  assert.equal(result.insecureCookies, 1);
  assert.ok(result.score < 100);
});

test('returns null score when no cookies are detected', () => {
  const result = analyzeCookies([]);

  assert.equal(result.total, 0);
  assert.equal(result.secureCookies, 0);
  assert.equal(result.insecureCookies, 0);
  assert.equal(result.score, null);
});
test('classifies a website as Low risk', () => {
  const result = calculateRiskScore({
    url: 'https://example.com',
    securityHeaders: { score: 95 },
    cookieAnalysis: { score: 95 },
    tls: { authorized: true },
  });

  assert.equal(result.score, 96);
  assert.equal(result.riskLevel, 'Low');
});

test('classifies a website as Medium risk', () => {
  const result = calculateRiskScore({
    url: 'https://example.com',
    securityHeaders: { score: 80 },
    cookieAnalysis: { score: 80 },
    tls: { authorized: true },
  });

  assert.equal(result.score, 85);
  assert.equal(result.riskLevel, 'Medium');
});

test('classifies a website as High risk', () => {
  const result = calculateRiskScore({
    url: 'https://example.com',
    securityHeaders: { score: 50 },
    cookieAnalysis: { score: 50 },
    tls: { authorized: true },
  });

  assert.equal(result.score, 63);
  assert.equal(result.riskLevel, 'High');
});

test('classifies a website as Critical risk', () => {
  const result = calculateRiskScore({
    url: 'https://example.com',
    securityHeaders: { score: 20 },
    cookieAnalysis: { score: 20 },
    tls: { authorized: true },
  });

  assert.equal(result.score, 40);
  assert.equal(result.riskLevel, 'High');
});
test('generates findings for missing security headers', () => {
  const result = generateFindings({
    securityHeaders: {
      checks: {
        contentSecurityPolicy: {
          header: 'content-security-policy',
          present: false,
          description: 'Helps protect against XSS.',
        },
      },
    },
    cookieAnalysis: { cookies: [] },
    tls: { authorized: true },
    url: 'https://example.com',
  });

  assert.equal(result.summary.total, 1);
assert.equal(result.findings.length, 1);
assert.equal(result.findings[0].severity, 'High');
assert.equal(result.findings[0].category, 'Security Headers');
assert.equal(result.summary.high, 1);
});

test('generates findings for cookies missing HttpOnly', () => {
  const result = generateFindings({
    securityHeaders: { checks: {} },
    cookieAnalysis: {
      cookies: [{
        name: 'session',
        checks: {
          httpOnly: false,
          secure: true,
          sameSite: true,
          sameSiteNoneRequiresSecure: true,
          hostPrefix: true,
          securePrefix: true,
        },
      }],
    },
    tls: { authorized: true },
    url: 'https://example.com',
  });

  assert.ok(result.findings.some((finding) =>
  finding.id === 'cookie-session-httponly'
));
assert.equal(result.summary.medium, 1);
});

test('generates Critical finding for HTTP websites', () => {
  const result = generateFindings({
    securityHeaders: { checks: {} },
    cookieAnalysis: { cookies: [] },
    tls: null,
    url: 'http://example.com',
  });

  assert.ok(result.findings.some((finding) =>
  finding.id === 'tls-no-https' &&
  finding.severity === 'Critical'
));
assert.equal(result.summary.critical, 1);
});

test('generates Critical finding for invalid TLS certificates', () => {
  const result = generateFindings({
    securityHeaders: { checks: {} },
    cookieAnalysis: { cookies: [] },
    tls: { authorized: false },
    url: 'https://example.com',
  });

 assert.ok(result.findings.some((finding) =>
  finding.id === 'tls-certificate-invalid' &&
  finding.severity === 'Critical'
));
assert.equal(result.summary.critical, 1);
});