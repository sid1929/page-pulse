'use strict';

/**
 * Simple in-memory TTL cache keyed by normalized URL.
 *
 * Swap-out note: this is intentionally an interface (get/set/size) rather
 * than direct Map usage elsewhere in the app, so it can be backed by Redis
 * in a multi-instance deployment without touching call sites — see
 * docs/ARCHITECTURE.md for why in-memory doesn't survive horizontal scale.
 */
class TtlCache {
  constructor({ ttlMs = 5 * 60 * 1000 } = {}) {
    this.ttlMs = ttlMs;
    this.store = new Map();
  }

  _now() {
    return Date.now();
  }

  get(key) {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this._now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key, value, ttlMsOverride) {
    const ttl = ttlMsOverride ?? this.ttlMs;
    this.store.set(key, { value, expiresAt: this._now() + ttl });
  }

  size() {
    return this.store.size;
  }

  clear() {
    this.store.clear();
  }
}

module.exports = { TtlCache };
