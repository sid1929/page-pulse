# Technology Decision Record

## 1. Redis for cache + rate limiting (not Memcached, not Postgres)

**Chosen:** Redis.
**Rejected:** Memcached — no built-in data structures for atomic
token-bucket operations (would need a Lua-equivalent hack or a second
system for rate limiting). Postgres — durable and queryable, but adds
write latency to a hot path that doesn't need durability; a cache entry
disappearing on restart is fine, an audit result table growing forever
is not what we want here.
**Why Redis wins:** atomic operations (`INCR`, Lua scripting) make the
token-bucket rate limiter correct under concurrent access without a
distributed lock, and TTL support maps directly onto the cache's
existing `TtlCache` interface — the swap is close to drop-in.

## 2. Job queue for audits (not synchronous fetch-and-respond everywhere)

**Chosen:** Queue + worker pool (BullMQ/Redis, or SQS if infra is AWS).
**Rejected:** Keep every request synchronous, just add more API
instances. This looks simpler but couples "how fast we can accept a
request" to "how fast the slowest possible target website responds."
One slow upstream site (or one that's down and takes the full timeout)
occupies an API instance's request-handling capacity for the entire
timeout window — at 500 concurrent bursts, this is how the fast path
degrades for everyone, not just the client hitting a slow target.
**Why a queue wins:** separates request acceptance (fast, bounded) from
audit execution (variable, sometimes slow), and lets us scale workers
independently of API instances based on queue depth.

## 3. Node's built-in `fetch` + `http` (not Express, not Axios)

**Chosen:** stick with the Task A choice of zero framework dependencies
even at scale.
**Rejected:** Express (for the API layer), Axios (for outbound
fetches).
**Why keep it minimal:** the route surface is genuinely small — two
endpoints — and Express buys convenience (routing, middleware chaining)
we don't need enough to justify a dependency with its own security
surface and version-upgrade overhead. Axios adds interceptors and
config we don't use; the built-in `fetch` with `AbortController`
already gives us timeouts.
**Where I'd reconsider:** if the route surface grows past ~5–6 routes,
or once we're gluing in auth middleware, request validation schemas,
and the async job-status endpoints described in `ARCHITECTURE.md` —
at that point hand-rolled routing starts costing more than it saves,
and I'd bring in a minimal router (or Express) rather than keep
growing `app.js`'s if/else chain.

## 4. Structured JSON logs to stdout (not a logging library like Winston/Pino)

**Chosen:** a ~15-line logger that emits single-line JSON.
**Rejected:** Winston (flexible but heavier config surface than we
need), Pino (excellent performance profile, genuinely the better
choice at real production scale).
**Why the simple version for now:** at this stage the log volume and
performance requirements don't demand Pino's speed advantage, and one
less dependency to pin and patch is worth it below a certain scale.
**Where I'd reconsider:** the moment log volume becomes a cost or
latency concern, Pino is the upgrade — it's a near-drop-in given both
emit structured JSON.
