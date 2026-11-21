
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const { PassThrough } = require('node:stream');


const {
  isPublicIp,
  resolvePublicAddress,
  requestPinned,
  isExpectedSocketIp,
  requestOnce,
  readResponseBody,
  getTlsInfo,
} = require('../src/services/pinnedRequest');
const path = require('node:path');
const fs = require('node:fs');

const TEST_CERT = fs.readFileSync(
  path.join(__dirname, 'fixtures', 'test-cert.pem')
);

test('accepts known public IPv4 addresses', () => {
  assert.equal(isPublicIp('8.8.8.8'), true);
  assert.equal(isPublicIp('1.1.1.1'), true);
  assert.equal(isPublicIp('172.32.0.1'), true);
});

test('rejects private and special IPv4 addresses', () => {
  const blocked = [
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.0.2.1',
    '192.168.1.1',
    '198.51.100.1',
    '203.0.113.1',
    '224.0.0.1',
    '255.255.255.255',
  ];

  for (const ip of blocked) {
    assert.equal(isPublicIp(ip), false, `${ip} must be rejected`);
  }
});

test('accepts a known public IPv6 address', () => {
  assert.equal(isPublicIp('2606:4700:4700::1111'), true);
  assert.equal(isPublicIp('2001:4860:4860::8888'), true);
});

test('rejects private and special IPv6 addresses', () => {
  const blocked = [
    '::1',
    'fc00::1',
    'fe80::1',
    '2001:db8::1',
    '::ffff:127.0.0.1',
    '::ffff:8.8.8.8',
  ];

  for (const ip of blocked) {
    assert.equal(isPublicIp(ip), false, `${ip} must be rejected`);
  }
});

test('rejects malformed and non-IP address inputs', () => {
  assert.equal(isPublicIp('not-an-ip'), false);
  assert.equal(isPublicIp(''), false);
  assert.equal(isPublicIp('999.999.999.999'), false);
  assert.equal(isPublicIp('localhost'), false);
});

test('rejects IPv4-mapped IPv6 addresses conservatively', () => {
  assert.equal(isPublicIp('::ffff:127.0.0.1'), false);
  assert.equal(isPublicIp('::ffff:8.8.8.8'), false);
});

test('resolves a public hostname to a public address', async () => {
  const result = await resolvePublicAddress('example.com');

  assert.ok(result.address);
  assert.ok([4, 6].includes(result.family));
  assert.equal(isPublicIp(result.address), true);
});

test('rejects localhost during DNS resolution', async () => {
  await assert.rejects(
    resolvePublicAddress('localhost'),
    /not publicly routable|unsafe IP address/
  );
});

test('rejects a private IPv4 literal during DNS resolution', async () => {
  await assert.rejects(
    resolvePublicAddress('127.0.0.1'),
    /not publicly routable/
  );
});

test('rejects mixed public and private DNS answers', async () => {
  const fakeLookup = async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '127.0.0.1', family: 4 },
  ];

  await assert.rejects(
    resolvePublicAddress('rebinding.test', { lookup: fakeLookup }),
    /unsafe IP address/
  );
});

test('accepts DNS answers containing only public addresses', async () => {
  const fakeLookup = async () => [
    { address: '8.8.8.8', family: 4 },
    { address: '1.1.1.1', family: 4 },
  ];

  const result = await resolvePublicAddress(
    'public.test',
    { lookup: fakeLookup }
  );

  assert.equal(result.address, '8.8.8.8');
});

test('rejects empty DNS responses', async () => {
  const fakeLookup = async () => [];

  await assert.rejects(
    resolvePublicAddress('empty.test', { lookup: fakeLookup }),
    /did not resolve/
  );
});

test('rejects redirects from HTTPS to HTTP', async () => {
  let requestCount = 0;

  const fakeLookup = async () => [
    { address: '8.8.8.8', family: 4 },
  ];

  const fakeRequest = async () => {
    requestCount += 1;

    return {
      status: 302,
      headers: {
        location: 'http://example.com/redirected',
      },
      body: Buffer.from(''),
    };
  };

  await assert.rejects(
    requestPinned('https://example.com', {
      lookup: fakeLookup,
      request: fakeRequest,
    }),
    /HTTPS to HTTP redirect is not allowed/
  );

  assert.equal(requestCount, 1);
});

test('rejects redirects to localhost', async () => {
  const fakeLookup = async (hostname) => {
    if (hostname === 'localhost') {
      return [
        { address: '127.0.0.1', family: 4 },
      ];
    }

    return [
      { address: '8.8.8.8', family: 4 },
    ];
  };

  const fakeRequest = async () => ({
    status: 302,
    headers: {
      location: 'https://localhost:3000/admin',
    },
    body: Buffer.from(''),
  });

  await assert.rejects(
    requestPinned('https://example.com', {
      lookup: fakeLookup,
      request: fakeRequest,
    }),
    /not publicly routable|unsafe IP address/
  );
});

test('accepts a matching public socket IP', () => {
  assert.equal(
    isExpectedSocketIp('8.8.8.8', '8.8.8.8'),
    true
  );
});

test('rejects a mismatched socket IP', () => {
  assert.equal(
    isExpectedSocketIp('1.1.1.1', '8.8.8.8'),
    false
  );
});

test('rejects missing or invalid socket IP addresses', () => {
  assert.equal(isExpectedSocketIp(undefined, '8.8.8.8'), false);
  assert.equal(isExpectedSocketIp('8.8.8.8', undefined), false);
  assert.equal(isExpectedSocketIp('127.0.0.1', '127.0.0.1'), false);
  assert.equal(isExpectedSocketIp('invalid-ip', '8.8.8.8'), false);
});

test('times out when DNS resolution exceeds the total deadline', async () => {
  const slowLookup = () =>
    new Promise((resolve) => {
      setTimeout(() => {
        resolve([{ address: '8.8.8.8', family: 4 }]);
      }, 200);
    });

  await assert.rejects(
    requestPinned('https://example.com', {
      timeoutMs: 50,
      lookup: slowLookup,
    }),
    /Total request deadline exceeded/
  );
});

test('aborts the HTTP request when the total deadline expires', async () => {
  let receivedSignal;

  const fakeLookup = async () => [
    { address: '8.8.8.8', family: 4 },
  ];

  const slowRequest = (_url, _address, options) =>
    new Promise((resolve, reject) => {
      receivedSignal = options.signal;

      options.signal.addEventListener(
        'abort',
        () => reject(new Error('Request aborted')),
        { once: true }
      );
    });

  await assert.rejects(
    requestPinned('https://example.com', {
      timeoutMs: 50,
      lookup: fakeLookup,
      request: slowRequest,
    }),
    /Total request deadline exceeded/
  );

  assert.equal(receivedSignal.aborted, true);
});


test('rejects oversized Content-Length before reading the body', async () => {
  const res = new PassThrough();
  res.headers = { 'content-length': '5000' };

  const req = {
    destroy() {},
  };

  await assert.rejects(
    readResponseBody(res, req, 1024),
    /exceeds size limit/
  );
});

test('rejects streamed responses exceeding the size limit', async () => {
  const res = new PassThrough();
  res.headers = {};

  const req = {
    destroy() {},
  };

  const bodyPromise = readResponseBody(res, req, 4);

  res.end(Buffer.from('12345'));

  await assert.rejects(
    bodyPromise,
    /exceeds size limit/
  );
});

test('rejects interrupted upstream responses', async () => {
  const res = new PassThrough();
  res.headers = {};

  const req = {
    destroy() {},
  };

  const bodyPromise = readResponseBody(res, req, 1024);

  res.emit('aborted');

  await assert.rejects(
    bodyPromise,
    /response was interrupted/
  );
});

test('successfully collects a response within the size limit', async () => {
  const res = new PassThrough();
  res.headers = {};

  const req = {
    destroy() {},
  };

  const bodyPromise = readResponseBody(res, req, 1024);

  res.end(Buffer.from('Page Pulse'));

  const body = await bodyPromise;

  assert.equal(body.toString('utf8'), 'Page Pulse');
});
test('extracts TLS protocol and certificate information', () => {
  const mockSocket = {
    getProtocol: () => 'TLSv1.3',
    authorized: true,
    authorizationError: null,
    getPeerCertificate: () => ({
      subject: { CN: 'example.com' },
      issuer: { CN: 'Test CA' },
      valid_from: 'Nov 20 00:00:00 2026 GMT',
      valid_to: 'Nov 20 00:00:00 2027 GMT',
      fingerprint256: 'AA:BB:CC:DD',
    }),
  };

  const result = getTlsInfo(mockSocket);

  assert.equal(result.protocol, 'TLSv1.3');
  assert.equal(result.authorized, true);
  assert.equal(result.authorizationError, null);
  assert.equal(result.certificate.subject.CN, 'example.com');
  assert.equal(result.certificate.issuer.CN, 'Test CA');
  assert.ok(result.certificate.validFrom);
  assert.ok(result.certificate.validTo);
  assert.equal(result.certificate.fingerprint256, 'AA:BB:CC:DD');
});

test('captures TLS certificate authorization errors', () => {
  const mockSocket = {
    getProtocol: () => 'TLSv1.2',
    authorized: false,
    authorizationError: 'CERT_HAS_EXPIRED',
    getPeerCertificate: () => ({
      subject: { CN: 'example.com' },
    }),
  };

  const result = getTlsInfo(mockSocket);

  assert.equal(result.authorized, false);
  assert.equal(result.authorizationError, 'CERT_HAS_EXPIRED');
});

test('returns null when no TLS socket is available', () => {
  assert.equal(getTlsInfo(null), null);
  assert.equal(getTlsInfo(undefined), null);
});