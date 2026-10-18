# ADR 0004: Materialized seat inventory (`event_seats`)

Status: accepted (2026-10-18)

## Context

A hold must lock exactly the seats it claims, and the system must be able to prove that no seat was sold twice. Availability could be computed (all seats of the venue minus seats in active holds and paid orders) or stored.

## Decision

One `event_seats` row per seat per event, created when the event is published, with `status` `available | held | sold`, `hold_id`, `held_until` and `order_id`. The primary key is `(event_id, seat_id)`. Two CHECK constraints keep the row coherent: a `held` row has a `hold_id` and a `held_until` (`event_seats_held_ck`), a `sold` row has an `order_id` (`event_seats_sold_ck`). Independently, the unique index `order_items_event_seat_uq` on `order_items(event_id, seat_id)` makes a second sale of the same seat fail at insert, even if application code were wrong.

## Consequences

- Holds lock real rows (`FOR UPDATE SKIP LOCKED`, ADR 0006), which is simple to reason about and to test.
- A 5,000-seat venue costs 5,000 small rows per event, which is small for Postgres.
- The `oversold` figure on the dashboard is an independent SQL check (tickets issued minus seats sold, plus seats with more than one order line; `apps/api/src/services/live.ts`), not a counter.
- `packages/db/src/schema.test.ts` pins the constraints: a held seat without a hold and a sold seat without an order are rejected, and the same seat cannot be sold twice for one event.
- The inventory is fixed at publication. The v1 API has no route to edit a venue after creation, so `event_seats` never has to follow a changed seat map.

## Alternatives rejected

- **Availability computed from holds and orders**: nothing to lock, so two buyers can both see a seat free and both insert. Preventing that needs a lock on something else (the event row, an advisory lock), which serialises the whole event.
