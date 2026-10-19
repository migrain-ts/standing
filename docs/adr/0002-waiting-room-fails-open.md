# ADR 0002: The waiting room fails open, and admission runs inside the API through one Lua script

Status: accepted (2026-10-18), amended by Task 16 (release endpoint)

## Context

During a Rush the waiting room keeps a bounded number of buyers (`events.admission_limit`, default 200) in the purchase flow at once and queues the rest in arrival order. It lives in Redis. Redis may be down or flushed (ADR 0001), and the question is what the hold endpoint does then.

## Decision

- **Fail open.** If Redis errors, `checkGate` (`apps/api/src/services/waiting-room.ts`) returns `open` and the hold goes through. The queue routes answer a `degraded` ticket (`open`, admitted). Overselling stays impossible because Postgres decides every seat (ADR 0001); what is lost is arrival order.
- **Admission inside the API, in one Lua script.** There is no admission loop in a background process. Every join and every status poll runs the same `ADMIT` script atomically: drop expired admissions from the active sorted set, then move the head of the queue into the active set until the limit is reached. Keys: `wr:<event>:q` (queue), `wr:<event>:a` (active, scored by expiry), `wr:<event>:seq` (arrival counter).
- **Releasing a slot.** A successful payment releases the buyer's admission (the `X-Queue-Ticket` header on `POST /holds/:id/pay`). Task 16 added `DELETE /public/events/:eventId/queue/:ticket` (always 204) for every other ending. Before that fix, a buyer who abandoned or found the venue sold out kept the slot for the whole active TTL (5 minutes): a Rush at the default limit of 200 stalled once 200 such buyers had gone through. The simulator now releases in a `try/finally` (`apps/simulator/src/buyer.ts`), and the Rush integration test runs at the default limit to catch a regression (with the release removed, it times out).

## Consequences

- `apps/api/src/services/waiting-room.test.ts` pins admission order, capacity under 200 concurrent joins, expiry, and "fails open when Redis errors". `apps/simulator/src/rush.integration.test.ts` runs a full Rush with Redis erroring on every call.
- Fail open applies to Redis **errors**. After a **flush** (Redis reachable but empty) the gate fails closed for each admitted buyer: the ticket becomes `unknown`, the hold endpoint answers 403 `queue_required`, and the buyer joins again (the simulator counts these re-joins as `requeued`). Fairness is reset, sales go on: `rush.integration.test.ts` asserts that orders keep growing after a mid-run flush.
- An admitted browser buyer who simply closes the tab still holds a slot until the TTL; only the simulator calls the release endpoint today.
- The waiting room is not an anti-bot measure (out of scope). Admission tickets are bearer tokens, not bound to the user who joined: anyone holding an admitted ticket can use it.
- The fail-open Rush test runs with `noDocumentQueue` (no BullMQ client), so it proves the purchase path without Redis, not the PDF queue.

## Alternatives rejected

- **Admission loop in the worker**: a second moving part whose failure stops admissions (fail closed by accident), plus a polling delay between "slot free" and "next buyer admitted".
- **Fail closed** (no Redis, no sales): turns a cache outage into a sales outage, for no correctness gain.
