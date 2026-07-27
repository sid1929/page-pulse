'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { RateLimiter } = require('../src/middleware/rateLimit');

function fakeReq(ip = '1.2.3.4') {
  return { clientIp: ip };
}

test('allows requests within capacity', () => {
  const limiter = new RateLimiter({ capacity: 3, refillPerSec: 0 });
  const req = fakeReq();
  assert.equal(limiter.consume(req).allowed, true);
  assert.equal(limiter.consume(req).allowed, true);
  assert.equal(limiter.consume(req).allowed, true);
});

test('blocks once capacity is exhausted', () => {
  const limiter = new RateLimiter({ capacity: 2, refillPerSec: 0 });
  const req = fakeReq();
  limiter.consume(req);
  limiter.consume(req);
  const result = limiter.consume(req);
  assert.equal(result.allowed, false);
  assert.ok(result.retryAfterMs === Infinity || result.retryAfterMs >= 0);
});

test('tracks separate clients independently', () => {
  const limiter = new RateLimiter({ capacity: 1, refillPerSec: 0 });
  const a = fakeReq('1.1.1.1');
  const b = fakeReq('2.2.2.2');
  assert.equal(limiter.consume(a).allowed, true);
  assert.equal(limiter.consume(a).allowed, false);
  assert.equal(limiter.consume(b).allowed, true);
});

test('refills over time', () => {
  const limiter = new RateLimiter({ capacity: 1, refillPerSec: 100 });
  const req = fakeReq();
  const key = limiter.keyFn(req);
  limiter.consume(req);
  const bucket = limiter.buckets.get(key);
  bucket.lastRefill -= 20; // simulate 20ms elapsed -> 2 tokens refilled
  const result = limiter.consume(req);
  assert.equal(result.allowed, true);
});
