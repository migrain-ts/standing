# ADR 0001: Postgres is the source of truth, Redis is disposable

Status: accepted (2026-10-18)

## Context

A Rush puts thousands of buyers on the same few hundred seats within seconds. The system needs a fast waiting room, rate limits, a job queue and a live feed, which Redis does well. It also needs a guarantee that no seat is sold twice, which only holds if exactly one store decides.

## Decision

Postgres decides every seat, hold, order and ticket. `event_seats.status` becomes `held` only inside `claimSeats` (`apps/api/src/services/holds.ts`) and `sold` only inside `payHold` (`apps/api/src/services/payments.ts`). No code path reads Redis to decide whether a seat is free.

Redis holds only things that can be lost: the waiting room, rate-limit counters, the BullMQ document queue and the pub/sub channel for live deltas. Each one has a defined behaviour when Redis is empty or unreachable (see the table in [ARCHITECTURE.md](../ARCHITECTURE.md#source-of-truth-rule)).

## Consequences

- Flushing Redis mid-Rush cannot oversell or lose a sale. `apps/simulator/src/rush.integration.test.ts` flushes Redis during a Rush and checks the end state; a second test runs a whole Rush with Redis erroring on every call. The first test has a known gap, stated in the README: it does not prove that sales continue after the flush.
- Every seat decision costs a Postgres transaction. The benchmark (`docs/bench/latest.md`) shows that this is fast enough for one laptop. It is not a capacity claim.
- Losing Redis degrades fairness (arrival order) and freshness (live view), never correctness.

## Alternatives rejected

- **Seat locks in Redis** (SETNX per seat, Postgres written later): two sources of truth that can disagree after a crash or a flush. Reconciling them is exactly the bug this project wants to make impossible.
- **Redis as a write-behind cache of inventory**: same problem, plus a durability window.
