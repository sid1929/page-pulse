'use strict';

/**
 * Per-client token bucket rate limiter.
 * Client identity = IP address by default; swap `keyFn` to rate-limit by
 * API key once auth exists.
 */
class RateLimiter {
  constructor({ capacity = 20, refillPerSec = 0.5, keyFn = (req) => req.clientIp } = {}) {
    this.capacity = capacity;
    this.refillPerSec = refillPerSec;
    this.keyFn = keyFn;
    this.buckets = new Map();
  }

  _refill(bucket) {
    const now = Date.now();
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSec * this.refillPerSec);
    bucket.lastRefill = now;
  }

  /** Returns { allowed, remaining, retryAfterMs } */
  consume(req, cost = 1) {
    const key = this.keyFn(req);
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: this.capacity, lastRefill: Date.now() };
      this.buckets.set(key, bucket);
    }
    this._refill(bucket);

    if (bucket.tokens >= cost) {
      bucket.tokens -= cost;
      return { allowed: true, remaining: Math.floor(bucket.tokens), retryAfterMs: 0 };
    }
    const deficit = cost - bucket.tokens;
    const retryAfterMs = Math.ceil((deficit / this.refillPerSec) * 1000);
    return { allowed: false, remaining: Math.floor(bucket.tokens), retryAfterMs };
  }
}

module.exports = { RateLimiter };
