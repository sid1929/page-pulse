# Page Pulse

A production-grade URL audit service. Given a URL, it fetches the page,
measures response time, and pulls out basic content/meta signals — built
to survive real traffic rather than just a demo.

**Built for Digital Heroes Training Task** — [digitalheroesco.com](https://digitalheroesco.com)

## Why no framework?

This runs on Node's built-in `http` and global `fetch` only — zero
runtime dependencies. That was a deliberate call: a URL-fetching service
under load benefits more from a small, auditable surface area than from
Express middleware I'd have to read the source of anyway. The tradeoff
is I hand-rolled routing, body parsing, and rate limiting instead of
pulling in `express` + `express-rate-limit`. For a bigger route surface
I'd revisit this — see `docs/TECH-DECISIONS.md`.

## Getting started

```bash
npm install    # no-op today, kept for when deps are added
npm start       # listens on PORT, default 3000
npm run dev     # restarts on file change
npm test        # runs the unit suite (node:test, no extra deps)
```

## Configuration (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `AUDIT_TIMEOUT_MS` | `8000` | Per-request timeout against the target URL |
| `CACHE_TTL_MS` | `300000` (5 min) | How long an audit result is cached before re-fetching |
| `AUDIT_MAX_CONCURRENCY` | `10` | Max audits in flight against upstream sites at once |
| `RATE_LIMIT_CAPACITY` | `20` | Token bucket size per client IP |
| `RATE_LIMIT_REFILL_PER_SEC` | `0.5` | Tokens refilled per second per client IP |

## API contract

### `GET /health`

Liveness check.

```json
{ "status": "ok", "service": "page-pulse", "requestId": "..." }
```

### `POST /audit`

**Request body**

```json
{
  "url": "https://example.com",
  "cacheWindowMs": 60000
}
```

- `url` (required) — must be a valid `http`/`https` URL. Loopback and
  private-network hosts (`localhost`, `127.0.0.1`, `10.x`, `192.168.x`,
  `172.16-31.x`, `169.254.x`) are rejected as a basic SSRF guard.
- `cacheWindowMs` (optional) — overrides the default cache TTL for this
  specific URL.

**Success — `200`**

```json
{
  "requestId": "b6d6...",
  "result": {
    "url": "https://example.com",
    "auditedAt": "2026-07-27T06:00:00.000Z",
    "status": { "code": 200, "ok": true, "redirected": false, "finalUrl": "https://example.com/" },
    "performance": { "responseTimeMs": 214 },
    "content": {
      "title": "Example Domain",
      "metaDescription": null,
      "headingCounts": { "h1": 1, "h2": 0, "h3": 0, "h4": 0, "h5": 0, "h6": 0 },
      "sizeBytes": 1256
    },
    "headers": { "contentType": "text/html; charset=UTF-8", "server": null, "cacheControl": null },
    "fromCache": false
  }
}
```

**Errors** — every failure returns the same shape:

```json
{ "error": { "code": "ValidationError", "message": "...", "requestId": "..." } }
```

| Status | Code | When |
|---|---|---|
| 400 | `ValidationError` | Bad or missing `url`, malformed JSON body, private/loopback host |
| 413 | `PayloadTooLarge` | Request body over 10KB |
| 429 | `RateLimitExceeded` | Client exceeded their token bucket (see `Retry-After` header) |
| 502 | `UpstreamError` | Target site unreachable or returned a non-2xx status |
| 504 | `UpstreamError` | Target site didn't respond within `AUDIT_TIMEOUT_MS` |
| 500 | `InternalError` | Unexpected server-side failure |

## Deployment

Any Node 18+ host works (Render, Railway, Fly.io, a plain VPS). No
build step, no database. Example for Render: set the start command to
`npm start`, health check path to `/health`.

> ⚠️ **TODO before submission:** deploy this and put the live URL here,
> push this repo to GitHub (public), and confirm the `/health` response
> shows the "Built for Digital Heroes Training Task" credit line live.

## Testing

`npm test` runs 30+ unit tests over validation, caching, rate limiting,
and the HTML-parsing helpers, using Node's built-in test runner — no
extra dependency needed to keep this trivially reproducible in CI.

## Architecture, scaling, and design tradeoffs

See `docs/ARCHITECTURE.md`, `docs/TECH-DECISIONS.md`,
`docs/FAILURE-MODES.md`, and `docs/OBSERVABILITY-ROLLBACK.md` for the
scale-out design (10k audits/day, 500 concurrent bursts, SLA).

## AI usage disclosure

Ai usage is only for the guidance and for error handling
<!-- TODO: replace with your own paragraph before submitting — required by the brief.
Example structure: which parts you asked AI for, what you changed, and
why. e.g. "I used Claude to scaffold the rate limiter and cache classes
and to draft the architecture doc. I rewrote the SSRF guard after
realizing the initial version missed the 172.16-31.x private range, cut
the Redis section from the architecture doc because I disagreed with the
default TTL reasoning, and rewrote the tone of the tech-decisions doc in
my own voice." -->
