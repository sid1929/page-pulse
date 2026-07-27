'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TtlCache } = require('../src/services/cache');

test('stores and retrieves a value', () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  cache.set('key', { hello: 'world' });
  assert.deepEqual(cache.get('key'), { hello: 'world' });
});

test('returns undefined for missing key', () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  assert.equal(cache.get('missing'), undefined);
});

test('expires entries after ttl', () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  let fakeNow = 0;
  cache._now = () => fakeNow;
  cache.set('key', 'value');
  fakeNow = 500;
  assert.equal(cache.get('key'), 'value');
  fakeNow = 1500;
  assert.equal(cache.get('key'), undefined);
});

test('per-key ttl override', () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  let fakeNow = 0;
  cache._now = () => fakeNow;
  cache.set('short', 'value', 100);
  fakeNow = 200;
  assert.equal(cache.get('short'), undefined);
});

test('clear removes everything', () => {
  const cache = new TtlCache({ ttlMs: 1000 });
  cache.set('a', 1);
  cache.set('b', 2);
  cache.clear();
  assert.equal(cache.size(), 0);
});
