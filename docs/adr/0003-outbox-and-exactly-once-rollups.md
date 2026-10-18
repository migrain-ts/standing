# ADR 0003: Transactional outbox, exactly-once rollups, best-effort live deltas

Status: accepted (2026-10-18)

## Context

Every sale and scan must update the reporting rollups (`sales_by_minute`, `sales_by_section`) and push a live delta to the organizer dashboard. Writing to Postgres and Redis in the same request is a dual write: one can succeed while the other fails.

## Decision

- **Outbox in the same transaction.** `payHold` and `scanTicket` insert an `outbox` row (`ticket.sold`, `ticket.scanned`, unique `dedupe_key`) in the transaction that changes the seat or the ticket.
- **Rollups in the same transaction that marks the row processed.** The worker's `projectOutbox` (`apps/worker/src/projector.ts`) claims a batch with `FOR UPDATE SKIP LOCKED`, upserts the rollups and sets `processed_at`, all in one transaction. A row is therefore counted once or not at all, even with several workers or a crash mid-batch. Delivery is at least once; the effect is exactly once.
- **Redis deltas after commit, best effort.** One aggregated delta per event is published on `ev:<eventId>` after the commit. A failed publish is logged and dropped.
- **Snapshot resync in the client.** The dashboard loads a snapshot from Postgres on open, on every reconnect and every 15 s, and receives a `tick` with Postgres totals every second over SSE. `apps/web/src/lib/live.ts` reconciles the three sources: displayed sold and revenue never go down (a lower tick is stale), `derived` counts what deltas added since the last authoritative figure and `ahead` what a tick knew before its deltas arrived, so a delta is neither counted twice nor lost. Older snapshots are merged, not applied over newer deltas.

## Consequences

- `apps/worker/src/projector.test.ts` pins it: rollups equal a raw recompute, a second run changes nothing, 500 rows with two concurrent projectors are each projected once, a failing publisher does not undo the projection.
- A lost delta is a delay of at most one tick (seat colours on the map can lag until the next snapshot, up to 15 s), never a wrong total.
- "Never lower" assumes there are no refunds. Refunds are out of scope; adding them would need a signed delta.
- Rollups lag sales by up to one worker cycle (1 s by default).

## Alternatives rejected

- **Dual writes** (API writes Postgres, then Redis and rollups): partial failure leaves rollups wrong forever.
- **Rollups from triggers**: hides logic in the database and serialises every sale on hot rollup rows inside the payment transaction.
- **Live view straight from Redis counters**: Redis would become a second source of truth for totals.
