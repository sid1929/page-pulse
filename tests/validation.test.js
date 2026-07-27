'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateUrl, ValidationError } = require('../src/utils/validation');

test('accepts a well-formed https URL', () => {
  const parsed = validateUrl('https://example.com/page');
  assert.equal(parsed.hostname, 'example.com');
});

test('accepts http URLs too', () => {
  const parsed = validateUrl('http://example.com');
  assert.equal(parsed.protocol, 'http:');
});

test('rejects empty string', () => {
  assert.throws(() => validateUrl(''), ValidationError);
});

test('rejects missing input', () => {
  assert.throws(() => validateUrl(undefined), ValidationError);
});

test('rejects non-string input', () => {
  assert.throws(() => validateUrl(12345), ValidationError);
});

test('rejects malformed URL', () => {
  assert.throws(() => validateUrl('not a url'), ValidationError);
});

test('rejects non-http(s) protocols', () => {
  assert.throws(() => validateUrl('ftp://example.com'), ValidationError);
  assert.throws(() => validateUrl('file:///etc/passwd'), ValidationError);
});

test('rejects loopback and private hosts (SSRF guard)', () => {
  assert.throws(() => validateUrl('http://localhost:3000'), ValidationError);
  assert.throws(() => validateUrl('http://127.0.0.1'), ValidationError);
  assert.throws(() => validateUrl('http://192.168.1.5'), ValidationError);
  assert.throws(() => validateUrl('http://10.0.0.1'), ValidationError);
  assert.throws(() => validateUrl('http://169.254.169.254'), ValidationError); // cloud metadata endpoint
});

test('rejects URLs over the max length', () => {
  const longUrl = 'https://example.com/' + 'a'.repeat(2100);
  assert.throws(() => validateUrl(longUrl), ValidationError);
});
