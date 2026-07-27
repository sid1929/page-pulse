# Observability and Rollback

## What to monitor and alert on

| Metric | Why it matters | Alert threshold (starting point) |
|---|---|---|
| Request rate & error rate by status code | Baseline health; a spike in 5xx is the first sign of an upstream or infra problem | Error rate > 2% over 5 min |
| p50/p95/p99 response time for `/audit` | The SLA is a latency promise; p99 catches tail problems averages hide | p95 > SLA target for 5 min |
| Cache hit rate | Directly affects both cost (fewer outbound fetches) and load on target sites | Sudden drop >20% from rolling baseline |
| Queue depth (once the job queue exists) | Leading indicator of worker capacity falling behind demand — this moves faster than user-visible latency | Depth growing for >2 min without plateauing |
| Rate-limit rejection rate (429s) | Distinguishes "we're protecting ourselves correctly" from "our limits are miscalibrated and blocking real traffic" | Sudden spike, or sustained >5% of traffic |
| Per-hostname timeout rate | Feeds the circuit breaker in `FAILURE-MODES.md`; also flags when *our* timeout config is wrong vs. the target being genuinely down | N consecutive timeouts per host |

Structured JSON logs (already in Task A) carry `requestId` end-to-end,
so any of the above can be traced back to individual requests without
grepping — that's the reason request IDs were built in from the start
rather than added later.

## Rolling back a bad deploy

1. **Deploy strategy:** rolling/blue-green across API instances behind
   the load balancer — never all-at-once. New instances join, old ones
   drain (finish in-flight requests, then stop accepting new ones)
   before being terminated.
2. **Health-check gate:** the load balancer only routes to instances
   passing `/health`; a bad deploy that fails to boot never receives
   traffic in the first place.
3. **Rollback trigger:** if error rate or p95 latency crosses the
   alert thresholds above within the first N minutes of a deploy,
   that's the signal to roll back — not to "wait and see." Automated
   rollback on this signal is the target state; manual rollback (re-
   deploy the previous known-good image/tag) is the fallback if
   automation isn't in place yet.
4. **Stateful risk:** because cache and rate-limit state live in Redis
   (external to the API process, per `ARCHITECTURE.md`), rolling back
   the API doesn't lose that state — a genuine advantage of moving it
   out of in-process memory beyond just horizontal scaling.
5. **Post-rollback:** the bad deploy's logs/traces stay queryable
   (they weren't on the box that got torn down) since logs ship to the
   external log store rather than living only on disk.
