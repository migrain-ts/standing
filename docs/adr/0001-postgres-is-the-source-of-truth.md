# ADR 0001: Postgres is the source of truth, Redis is disposable

Status: accepted (2026-10-18)

## Context

A Rush puts thousands of buyers on the same few hundred seats within seconds. The system needs a fast waiting room, rate limits, a job queue and a live feed, which Redis does well. It also needs a guarantee that no seat is sold twice, which only holds if exactly one store decides.

## Decision

Postgres decides every seat, hold, order and ticket. `event_seats.status` becomes `held` only inside `claimSeats` (`apps/api/src/services/holds.ts`) and `sold` only inside `payHold` (`apps/api/src/services/payments.ts`). No code path reads Redis to decide whether a seat is free.

Redis holds only things that can be lost: the waiting room, rate-limit counters, the BullMQ document queue and the pub/sub channel for live deltas. Each one has a defined behaviour when Redis is empty or unreachable (see the table in [ARCHITECTURE.md](../ARCHITECTURE.md#source-of-truth-rule)).

## Consequences

- Flushing Redis mid-Rush cannot oversell or lose a sale. `apps/simulator/src/rush.integration.test.ts` flushes Redis 1.5 s into a Rush while seats are still free and asserts that orders keep growing after the flush and that buyers re-joined the waiting room; a second test runs a whole Rush with Redis erroring on every call. Neither proves arrival order after the flush (it is reset).
- Every seat decision costs a Postgres transaction. The benchmark (`docs/bench/latest.md`) shows that this is fast enough for one laptop. It is not a capacity claim.
- Losing Redis degrades fairness (arrival order) and freshness (live view), never correctness.
- Sales stop in Postgres too: `payHold` reads the event's status and `starts_at` (bound clock) under the hold lock and refuses a closed or started event (409 `event_closed`).
- The payment gateway is simulated and decides before the transaction validates the hold. With a real gateway this order would charge for a hold that turns out expired or closed; a real integration needs authorize, then the Postgres commit, then capture (or a payment record written outside the transaction and reconciled).

## Alternatives rejected

- **Seat locks in Redis** (SETNX per seat, Postgres written later): two sources of truth that can disagree after a crash or a flush. Reconciling them is exactly the bug this project wants to make impossible.
- **Redis as a write-behind cache of inventory**: same problem, plus a durability window.
