# ADR 0006: `FOR UPDATE SKIP LOCKED` holds, a per-buyer advisory lock, lazy expiry

Status: accepted (2026-10-18), amended in Task 8 (per-buyer lock) and in the final fix wave (lock order rule)

## Context

Under a Rush, many buyers request overlapping seats at the same instant. A hold of 1 to 8 seats must be all or nothing, must never wait behind another buyer's transaction, and must not deadlock.

## Decision

- **Claim with `SKIP LOCKED`.** `claimSeats` (`apps/api/src/services/holds.ts`) selects the requested `event_seats` rows that are `available`, or `held` with `held_until < now`, ordered by `seat_id`, `FOR UPDATE SKIP LOCKED`, and updates them to `held` in the same statement. If fewer rows come back than were requested, the transaction rolls back and the API answers 409 `seats_unavailable` with the taken seats.
- **Lazy expiry.** An expired hold is reclaimed by the next `claimSeats` through `held_until < now`. The worker's `releaseExpiredHolds` is housekeeping only; correctness does not depend on it.
- **One reservation at a time per buyer and event.** `createHold` starts with `pg_try_advisory_xact_lock(hashtextextended('<buyer>:<event>', 0))`. If it is not granted, the API answers 409 `hold_in_progress` at once (no waiting). Without it, two concurrent requests of the same buyer could leave two active holds (the mutation check in Task 8 showed this: 3 failures out of 3 runs).
- **Accepted trade-off: false conflicts.** A row locked by a transaction that will finally roll back is skipped, so two overlapping multi-seat requests can both lose (each skipped a seat the other held for a moment). The seat stays free, the client retries. The Rush simulator retries up to 3 times; the storefront says the seats were just taken and lets the buyer pick again. (It also greys those seats out locally until the page is reloaded, even when the conflict was false: a known rough edge.)

## Consequences

- No lock waits between concurrent claims, so no convoy and no deadlock between them.
- **Lock order rule: the hold row first, then its seats.** The paths that touch an existing hold do wait: `cancelHold` and `payHold` lock the hold row, then its seats; `createHold` (after the advisory lock) locks the buyer's active holds for the event, `order by id for update`, before releasing their seats. Before this rule, a cancel or a pay racing a replacing hold of the same buyer deadlocked (40P01), as did the cleanup racing a cancel. The worker's `releaseExpiredHolds` never waits: sorted `FOR UPDATE SKIP LOCKED` subqueries, and skipped rows are handled on the next cycle. `apps/api/src/services/lock-order.test.ts` pins the four overlaps; a residual 40P01 or 40001 answers 409 `conflict_retry`, never a 500.
- `apps/api/src/services/holds.test.ts` pins: 200 buyers racing for 50 seats (4 per seat) give exactly one winner per seat; 60 buyers requesting overlapping pairs in opposite orders never leave a partial hold or a 500; concurrent requests from the same buyer leave one active hold; the race stays exact after every first hold expired (the clock moves before the race), with no cleanup running.
- Under heavy overlap some buyers see a 409 for a seat that ends up free. The benchmark reports conflicts (`docs/bench/latest.md`: 314 conflicts for 3,398 successful holds).

## Alternatives rejected

- **Plain `FOR UPDATE`**: correct, but requests queue behind each other on hot seats; under a Rush this becomes a convoy and lock waits grow with the crowd. Ordering by id avoids deadlocks but not the waiting.
- **Advisory locks per seat**: a second locking scheme next to the rows, keyed by hashes, easy to leak or to forget on one path. (The single per-buyer advisory lock above serialises one buyer's own requests, not seats.)