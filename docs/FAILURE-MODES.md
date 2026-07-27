# Failure Mode Analysis

Three most likely failure modes at 10k audits/day with 500-concurrent
bursts, and the mitigation for each.

## 1. A single slow or hanging upstream site starves capacity

**What happens:** a client repeatedly requests audits of a site that's
timing out (not down, just slow — the worst case, since a fast failure
is cheap and a hang consumes the full timeout budget). Under the Task A
design, this ties up a worker/connection for the full `AUDIT_TIMEOUT_MS`
per request; at volume, enough of these exhaust the concurrency pool
and every *other* audit queues behind them.

**Mitigation:**
- Per-target concurrency cap (not just a global one) — no single
  hostname can occupy more than e.g. 5% of total worker capacity.
- Circuit breaker per hostname: after N consecutive timeouts against
  the same host within a window, short-circuit further requests for
  that host with an immediate `503` for a cooldown period rather than
  re-attempting the full timeout each time.

## 2. Cache and rate-limit state inconsistency across instances

**What happens:** with multiple API instances and in-memory state (the
Task A design, unchanged), a client's requests land on different
instances behind the load balancer. Rate limiting becomes ineffective
(each instance thinks the client is under their own limit), and cache
hit rate drops because each instance independently re-fetches the same
URL.

**Mitigation:** covered in `ARCHITECTURE.md` — move both to Redis so
state is shared. Failure mode if Redis itself goes down: fail open on
rate limiting (allow requests, log a warning) rather than fail closed
(block all traffic) — a rate-limiter outage should degrade gracefully,
not turn into a full outage of its own.

## 3. Thundering herd on cache expiry for a popular URL

**What happens:** a URL with many concurrent requesters has its cache
entry expire. If nothing coordinates it, every one of those concurrent
requests sees a cache miss simultaneously and all trigger a fresh fetch
against the same upstream target at once — multiplying load on both our
workers and the target site right when the cache was supposed to
prevent exactly that.

**Mitigation:** single-flight / request coalescing — the first request
to miss the cache for a given key takes a short-lived lock (a Redis key
with a TTL) and performs the fetch; concurrent requests for the same
key wait on that in-flight result instead of firing their own fetch.
This is a well-known pattern (sometimes called "cache stampede
protection") and is worth adding before this ships at the target
volume, not after the first incident.
