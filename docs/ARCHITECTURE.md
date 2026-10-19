# Standing architecture

This document describes how Standing works and where each claim is proven. File paths are relative to the repository root. Decisions are recorded in [docs/adr](adr/).

## Purpose and non-goals

Standing is a multi-tenant ticketing SaaS built as a portfolio project. Organizers publish events on a seat map, buyers hold and buy seats, door staff scan tickets, and a **Rush** button sends up to 5,000 simulated buyers at the real API while a live dashboard shows sales and an independently computed `Oversold` figure.

Non-goals (v1): real payments (the gateway is simulated), refunds, e-mail, i18n, a native app, anti-bot protection, hosting. All data is fictional.

## Components

```mermaid
flowchart LR
  browser[Browser]
  web["web<br/>Next.js, port 3200"]
  api["api<br/>Hono, port 4100"]
  worker["worker<br/>outbox projector, PDFs, cleanup"]
  sim["simulator<br/>virtual buyers, internal port 4200"]
  pg[("Postgres 17<br/>source of truth")]
  redis[("Redis 7<br/>disposable")]

  browser -- "HTTP pages, /api/* and SSE" --> web
  web -- "HTTP rewrite of /api/*, SSE passthrough" --> api
  api -- "SQL over pg" --> pg
  api -- "Lua waiting room, INCR rate limits, BullMQ add, PSUBSCRIBE ev:*" --> redis
  api -- "HTTP start/stop a run, bearer token" --> sim
  sim -- "HTTP buyer calls: queue, map, hold, pay" --> api
  sim -- "SQL: insert simulated buyers and sessions" --> pg
  worker -- "SQL: outbox, rollups, documents, expired holds" --> pg
  worker -- "PUBLISH ev:eventId, BullMQ consume" --> redis
```

| Path | Role |
| --- | --- |
| `apps/api` | Hono HTTP API: auth, tenants, venues, events, storefront, holds, payment, door scan, exports, live SSE, Rush control |
| `apps/worker` | Loop every second (`CYCLE_MS`): project the outbox into rollups and publish deltas, release expired holds, refresh the daily materialized view once a minute; BullMQ consumer that renders ticket and report PDFs; document sweeper every 10 s |
| `apps/simulator` | Load generator: virtual buyers that make the same HTTP calls as a browser; also `npm run bench` |
| `apps/web` | Next.js App Router: storefront, organizer console, live dashboard, door page (shadcn/ui on Base UI, Pulse design tokens, MingCute icons) |
| `packages/db` | Drizzle schema, SQL migrations, test database helpers |
| `packages/shared` | Zod schemas, branded ids, `Clock`, constants |
| `packages/core` | Redis client factory, channel names, ticket signing, outbox payload schemas, document enqueue |

## Source of truth rule

Postgres decides every seat, order and ticket. `event_seats.status` becomes `held` only inside `claimSeats` and `sold` only inside `payHold`. Nothing in Redis is ever read to decide whether a seat is free ([ADR 0001](adr/0001-postgres-is-the-source-of-truth.md)).

What Redis holds and what happens when it disappears:

| Redis structure | Keys | Used for | When Redis is flushed or down | Test that pins it |
| --- | --- | --- | --- | --- |
| Waiting room | `wr:<event>:q`, `wr:<event>:a`, `wr:<event>:seq` (sorted sets, counter) | Arrival order and bounded admission; the hold endpoint requires an admitted ticket | Fails open on Redis errors: holds go through without a ticket, queue routes answer a `degraded` ticket. After a flush (Redis reachable but empty) it fails closed for each admitted buyer: the ticket becomes `unknown`, the hold endpoint answers 403 `queue_required`, and the buyer re-joins | `apps/api/src/services/waiting-room.test.ts` ("fails open when Redis errors", "forgets everything when Redis is flushed"), `apps/api/src/routes/queue.test.ts`, `apps/simulator/src/rush.integration.test.ts` |
| Rate limits | `rl:<prefix>:<user>:<window>` | Fixed windows per user: 60 holds/min, 30 payments/min, 30 queue joins/min | Fails open: no limit while Redis errors; a flush resets the windows | `apps/api/src/redis-rate-limit.test.ts` ("fails open when Redis throws") |
| BullMQ queue | `documents` queue | Ticket and report PDF jobs (jobId = document id) | The `documents` row in Postgres stays `queued`; the sweeper re-adds it after 30 s | `apps/worker/src/documents/sweeper.test.ts` ("puts the job back after Redis was flushed"), `apps/worker/src/documents/queue.integration.test.ts` ("recovers a sale after Redis lost the queue"), `apps/worker/src/documents/queue.exhaustion.test.ts` |
| Pub/sub | channel `ev:<eventId>`, API subscribes to `ev:*` | Live deltas (seats sold, revenue, scans) from the worker to the API's SSE streams | Deltas are lost; the SSE stream keeps sending one `tick` per second with totals from Postgres, and clients reload snapshots | `apps/api/src/routes/live.test.ts` ("still ticks without Redis"), `apps/api/src/services/live-bus.test.ts`, `apps/worker/src/projector.test.ts` ("a failing publisher does not undo the projection") |

## Data model

The main tables (sessions, the rollup tables and the materialized view are left out of the drawing):

```mermaid
erDiagram
  tenants ||--o{ memberships : has
  users ||--o{ memberships : has
  tenants ||--o{ venues : owns
  venues ||--o{ sections : has
  sections ||--o{ seats : has
  tenants ||--o{ events : owns
  venues ||--o{ events : hosts
  events ||--o{ price_tiers : prices
  events ||--o{ event_seats : inventory
  seats ||--o{ event_seats : "one row per event"
  users ||--o{ holds : places
  holds ||--o{ event_seats : claims
  holds ||--o| orders : "becomes"
  orders ||--o{ order_items : contains
  order_items ||--|| tickets : issues
  holds ||--o{ payments : attempts
  events ||--o{ outbox : emits
  tenants ||--o{ documents : owns

  event_seats {
    uuid event_id PK
    uuid seat_id PK
    seat_status status "available, held or sold"
    uuid hold_id "CHECK held needs hold_id and held_until"
    timestamptz held_until
    uuid order_id "CHECK sold needs order_id"
  }
  holds {
    uuid id PK
    uuid buyer_id FK
    uuid event_id FK
    int seat_count
    hold_status status "active, paid or cancelled"
    timestamptz expires_at
  }
  orders {
    uuid id PK
    uuid tenant_id FK
    uuid event_id FK
    uuid hold_id UK
    int total_cents
  }
  order_items {
    uuid id PK
    uuid order_id FK
    uuid event_id "UNIQUE event_id, seat_id"
    uuid seat_id
    int price_cents
  }
  tickets {
    uuid id PK
    uuid order_item_id UK
    timestamptz scanned_at
    uuid scanned_by
  }
  payments {
    uuid hold_id "UNIQUE hold_id, idempotency_key"
    text idempotency_key
    payment_status status
  }
  outbox {
    bigserial id PK
    text kind
    jsonb payload
    text dedupe_key UK
    timestamptz processed_at
  }
```

What makes overselling impossible at the database level:

- `event_seats_held_ck`: `status <> 'held' or (hold_id is not null and held_until is not null)`.
- `event_seats_sold_ck`: `status <> 'sold' or order_id is not null`.
- `order_items_event_seat_uq`: unique index on `order_items(event_id, seat_id)`. A second sale of the same seat fails at insert even if the application code were wrong.

`packages/db/src/schema.test.ts` pins all three. Inventory is materialized: one `event_seats` row per seat per event, created at publication ([ADR 0004](adr/0004-materialized-seat-inventory.md)). Money is integer cents everywhere; formatting happens only in the web app.

## Purchase flow

```mermaid
sequenceDiagram
  autonumber
  participant B as Browser or simulated buyer
  participant A as api
  participant R as Redis
  participant P as Postgres
  participant W as worker
  participant O as Organizer dashboard

  B->>A: POST /public/events/:id/queue
  A->>R: ZADD queue, then ADMIT Lua script
  A-->>B: ticket, waiting or admitted
  B->>A: GET /public/events/:id/availability
  A->>P: read event_seats (cached 500 ms in process)
  B->>A: POST /public/events/:id/holds with X-Queue-Ticket
  A->>R: is the ticket admitted? (fails open)
  A->>P: advisory lock per buyer, claimSeats FOR UPDATE SKIP LOCKED
  A-->>B: 201 hold, or 409 seats_unavailable
  B->>A: POST /holds/:id/pay with Idempotency-Key
  Note over A: simulated gateway delay and decision, outside the transaction
  A->>P: one transaction: order, order_items, tickets, seats sold, payment, outbox row, document row
  A->>R: release admission, enqueue ticket PDF (best effort)
  A-->>B: 201 order with signed ticket codes
  W->>P: claim outbox FOR UPDATE SKIP LOCKED, upsert rollups, mark processed (one transaction)
  W->>R: PUBLISH ev:eventId delta (after commit, best effort)
  R-->>A: pmessage
  A-->>O: SSE delta, plus a tick with Postgres totals every second
```

## Holds: the claim SQL

`claimSeats` in `apps/api/src/services/holds.ts` is the only place a seat becomes `held`:

```sql
with c as (
  select seat_id from event_seats
  where event_id = $event
    and seat_id = any($seats)
    and (status = 'available' or (status = 'held' and held_until < $now))
  order by seat_id
  for update skip locked
)
update event_seats e
set status = 'held', hold_id = $hold, held_until = $expires
from c
where e.event_id = $event and e.seat_id = c.seat_id
returning e.seat_id
```

- **`SKIP LOCKED`**: a row another transaction is claiming is skipped instead of waited for. A request never queues behind another buyer, so there is no convoy and no deadlock between concurrent claims.
- **Lock order rule (hold row first, then seats)**: every path that touches an existing hold and its seats locks the `holds` row first. `cancelHold` and `payHold` lock the hold `FOR UPDATE`, then its seats; `createHold`, after its advisory lock, locks the buyer's active holds for the event (`order by id for update`) before releasing their seats. The worker's `releaseExpiredHolds` never waits: it frees expired seats and cancels expired holds through sorted `FOR UPDATE SKIP LOCKED` subqueries, and rows a request is busy with are left for the next cycle. Before this rule, a cancel or a pay racing a replacing hold of the same buyer, and the cleanup racing a cancel, deadlocked (Postgres 40P01). A residual 40P01 or 40001 answers 409 `conflict_retry` ("Please try again") instead of a 500 (`apps/api/src/errors.ts`).
- **All or nothing**: `createHold` compares the claimed count with the requested count. If short, it throws inside the transaction (rollback) and answers 409 `seats_unavailable` with the taken seats. The buyer's previous hold for that event, released at the start of the same transaction, is restored by the rollback.
- **Lazy expiry**: `held_until < $now` lets the next buyer reclaim an expired hold. `$now` comes from the injected `Clock`, never from SQL `now()`, so tests move time with a `FakeClock`. The worker's `releaseExpiredHolds` is housekeeping only.
- **Per-buyer serialization**: `createHold` first takes `pg_try_advisory_xact_lock(hashtextextended('<buyer>:<event>', 0))`; a concurrent second request of the same buyer gets 409 `hold_in_progress` at once.
- **Accepted trade-off**: because skipped rows may belong to a transaction that later rolls back, two overlapping multi-seat requests can both lose. The seat stays free and the client retries ([ADR 0006](adr/0006-skip-locked-holds.md)).

Proven by `apps/api/src/services/holds.test.ts`: 200 buyers on 50 seats give exactly one winner per seat; overlapping pairs in opposite orders never leave a partial hold or a 500; same-buyer concurrency leaves one active hold; the race stays exact after every first hold expired (the clock is moved before the race). `apps/api/src/services/lock-order.test.ts` overlaps cancel with a replacing create, pay with a replacing create, the cleanup with cancels of expired holds, and the cleanup with the release inside a replacing create (100 rounds each, real `Promise.all` overlap): no deadlock, no partial hold, no orphan seat.

## Payment and idempotency

`payHold` (`apps/api/src/services/payments.ts`):

1. The simulated gateway sleeps `PAYMENT_LATENCY_MS` (default 150) and draws the decline (`PAYMENT_FAILURE_RATE`, default 0.05) **before** the transaction, so no row lock is held while "calling the bank".
2. In one transaction: lock the hold row (`FOR UPDATE`), look up a previous payment with the same `(hold_id, idempotency_key)` and replay its result if there is one; refuse a paid hold under a new key (409 `already_paid`); refuse when the event is no longer on sale, closed or already started against the bound clock (409 `event_closed`, nothing written, the hold stays); refuse an expired hold or one whose seats were reclaimed (410 `hold_expired`); store a declined attempt (402, the hold stays and a new key may retry); otherwise create the order, order items, tickets, mark the seats `sold`, store the payment, an outbox row and a queued ticket document.
3. The unique index `payments_hold_key_uq` and `orders_hold_id_unique` back the idempotency at the database level.

Ticket codes are HMAC-signed (`packages/core/src/ticket-code.ts`); verification requires the canonical encoding, so an edited code is rejected.

Proven by `apps/api/src/services/payments.test.ts`: the same key in parallel creates one order; two different keys in parallel pay once; 410 after expiry and after another buyer reclaimed a seat; a decline is stored and a retry under a new key succeeds; 409 `event_closed` after the event was closed or started, with no order and the seats still held.

The gateway is simulated and "charges" before the transaction validates the hold, so a declined or refused payment costs nothing here. A real integration needs authorize, then commit, then capture (or a payment record written outside the transaction) so a charge is never taken for a hold that turns out expired or closed.

## Outbox and projector

Sales and scans write an `outbox` row in the same transaction as the change. The worker's `projectOutbox` (`apps/worker/src/projector.ts`) claims up to 200 unprocessed rows `FOR UPDATE SKIP LOCKED`, upserts `sales_by_minute` and `sales_by_section` in sorted key order (event, bucket; event, section), and sets `processed_at` in the same transaction. Rollups are therefore exactly-once even with several workers, and two workers whose batches touch the same rollup rows lock them in the same order (no deadlock). After the commit it publishes one aggregated delta per event on Redis; that part is best effort ([ADR 0003](adr/0003-outbox-and-exactly-once-rollups.md)).

The dashboard client (`apps/web/src/lib/live.ts`) combines a Postgres snapshot (on open, on reconnect, every 15 s), one SSE `tick` per second with Postgres totals, and deltas. Sold and revenue are never displayed lower than before (a lower tick is stale); `derived` and `ahead` track what deltas and ticks already counted so nothing is counted twice; older snapshots are merged, not applied over newer deltas. This "never lower" rule assumes there are no refunds.

Proven by `apps/worker/src/projector.test.ts` (rollups equal a raw recompute, idempotent re-run, 500 rows × two concurrent projectors each projected once, two projectors whose batches touch events X and Y in opposite orders never deadlock) and `apps/web/src/lib/live.test.ts` (tick, delta and snapshot interleavings, including a seeded scripted sequence in which displayed sold never decreases).

## Documents and the sweeper

Ticket PDFs (one per order, created in the payment transaction) and report PDFs (requested by an organizer) are rows in `documents` with status `queued | running | ready | failed`, rendered by the worker (`pdfkit`, QR codes with `qrcode`) and stored as `bytea`.

- The API enqueues a BullMQ job after the commit, with `jobId = documentId` so a double enqueue is a no-op. A Redis failure there is logged and ignored.
- The worker claims the row by bumping `attempts`, and writes the result only if `attempts` is unchanged (a fence against a competing claim).
- The **sweeper** (`apps/worker/src/documents/sweeper.ts`, every 10 s) re-adds every document still `queued` after 30 s and first resets `running` rows with no update for 2 minutes. Postgres is the queue of record; Redis only speeds it up.
- **`removeOnFail: true`** (`packages/core/src/channels.ts`): a failed BullMQ job is not retained. A retained failed job with the same jobId would make the sweeper's re-add a silent no-op and leave the document `queued` forever. The failure reason is kept in `documents.error` instead. `queue.exhaustion.test.ts` exhausts BullMQ's 3 attempts and checks that the sweeper can then recover the document.

## Exports and flat memory

`GET /tenants/:tenantId/exports/sales.csv` and `sales.xlsx` (manager role; optional `eventId`, and an optional day range `from` and `to`: both or neither, at most 366 days, else 400) stream from a Postgres cursor (`pg-query-stream`, batches of 1,000 rows) through a Node stream: CSV in 32 KB chunks, XLSX through the exceljs streaming `WorkbookWriter` with each row committed. Backpressure comes from the HTTP response, so the process never holds the whole result. The tenant filter is mandatory in the query builder; cells that look like formulas are neutralized. A cancelled download destroys the stream and releases the pooled connection.

Proven by `apps/api/src/services/exports.test.ts`: 200,000 CSV rows stream with heap growth under 80 MB (measured with `--expose-gc`); early destroy releases the pooled client. `apps/api/src/routes/exports.test.ts`: first bytes arrive before the whole result is read, other tenants' rows never appear. The memory ceiling is measured for CSV only; XLSX has no memory test.

## Tenant isolation

- `requireTenantRole(min)` (`apps/api/src/authz.ts`) is the only authorization point for `/tenants/:tenantId/*`. Roles: `owner` > `manager` > `door`. Non-member: 404 (never 403, so a tenant's existence is not revealed). Member with too low a role: 403.
- Handlers that load a child row (event, venue, document) filter on `tenant_id` as well as the id. The root aggregates (`venues`, `events`, `orders`, `documents`, `outbox`) carry `tenant_id`; child tables (`sections`, `seats`, `price_tiers`, `event_seats`, `holds`, `order_items`, `tickets`, ...) do not and inherit the tenant through their foreign keys.
- Routes outside `/tenants/*` that touch tenant data check membership themselves (for example `POST /door/scan` checks that the scanner belongs to the ticket's tenant; `GET /documents/:id` checks visibility).
- `apps/api/src/authz.matrix.test.ts` runs every tenant route × anonymous × each role × a member of another tenant, and fails when a registered route is neither in the matrix nor explicitly exempt, or when a matrix row is stale. For every row whose URL holds an event or venue id, a manager of tenant A also calls A's URL with tenant B's event or venue id and must get 404 with B's events, tiers and venues unchanged (removing the tenant filter from `lockEvent` makes four rows fail).
- No Postgres row-level security in v1 ([ADR 0005](adr/0005-no-row-level-security-in-v1.md)): there is no database-level backstop if a handler forgets a filter.

## Door scan

`POST /door/scan` (`apps/api/src/services/scan.ts`) verifies the HMAC signature first (a forged code never reaches the database), then locks the ticket row `FOR UPDATE`, checks tenant membership and the event, and sets `scanned_at` (bound clock) if it is still null. Concurrent scans of the same code are serialized by the row lock: exactly one wins, the others answer `already_scanned` with the first scan time. `apps/api/src/services/scan.test.ts` runs 20 simultaneous scans of one code. The door page uses `BarcodeDetector` for the camera when the browser has it, with manual code entry as the fallback.

## The Rush simulator, and what it is not

`apps/simulator` creates N simulated buyer accounts with sessions directly in Postgres, then starts each buyer at a random time within the chosen duration (at most 400 in flight). Each buyer does what a browser does: join the waiting room and poll until admitted, read availability, pick 1 to N consecutive free seats, hold (up to 3 attempts on 409), think 200 to 1,500 ms, abandon with probability 0.08 (the API default; the benchmark uses 0), pay with a fresh idempotency key (one retry after a decline), and release the admission slot on every ending except a payment. The `oversold` figure is computed in SQL (tickets issued minus seats sold, plus seats sold twice), never counted by the simulator.

What it is not: a distributed load test. It runs in one Node process on the same machine as the API and the database, so its numbers describe one laptop (`docs/bench/latest.md`). It has no network latency between components, no think-time model fitted on real users and no bot behaviour.

## Commands

| Command | What it does |
| --- | --- |
| `docker compose -p standing up --build` | Builds and starts Postgres, Redis, api (runs migrations and the demo seed), worker, simulator and web. Add `-d --wait` to run detached and wait for health checks |
| `docker compose -p standing down -v` | Stops the stack and deletes its database volume (a fresh seed on the next `up`) |
| `npm ci` | Installs dependencies (Node 22 or later) |
| `npm run lint` | ESLint over the repository (`apps/web/src/components/ui` excluded) |
| `npm run typecheck` | `tsc` in every workspace, then `e2e/` and `scripts/` |
| `npm test` | Vitest in every workspace, against real Postgres (`TEST_ADMIN_DATABASE_URL`, default `localhost:5441`) and Redis database 15 (`TEST_REDIS_URL`, default `localhost:6380/15`). Tests create throwaway databases from a migrated template |
| `npm run e2e` | Playwright against the running compose stack (`http://127.0.0.1:3200`); first run `npx playwright install chromium` |
| `npm run bench` | 5,000 simulated buyers over 60 s on a fresh event in the largest demo venue; rewrites `docs/bench/latest.md` |
| `DATABASE_URL=postgres://standing:standing@localhost:5441/standing npm run seed -w @standing/api` | Runs migrations and the demo seed by hand (idempotent: skipped when the demo organizer exists). The compose api does this on start |
| `npm run media` | Re-records the README screenshots and GIF against the running stack (needs ffmpeg) |

## Known limitations

- **Simulated payment only.** No real card data anywhere; the gateway is a sleep and a random draw.
- **One-machine benchmark.** `docs/bench/latest.md` measures one laptop running everything; pay latency is dominated by the simulated 150 ms gateway delay.
- **The Rush simulator is not a distributed load test** (see above).
- **False conflicts.** Two overlapping multi-seat holds can both get 409 under `SKIP LOCKED`; clients retry.
- **In-process SSE fan-out.** Each API instance relays Redis pub/sub to its own SSE clients. Several instances work (each subscribes to `ev:*`), but there is no sticky session handling or other shared bus. Next's gzip is disabled (`compress: false` in `apps/web/next.config.ts`) because it buffered the SSE stream behind the `/api` rewrite; production needs compression at a reverse proxy, with proxy buffering disabled for `/api/**/live`.
- **Single Postgres.** No replica, no partitioning, no failover.
- **No refunds.** The live view's "never lower" rule depends on it.
- **Camera scanning depends on `BarcodeDetector`**, which not every browser implements; manual entry is the fallback. The real camera path was not tested headless.
- **Tenant isolation has no database backstop** (no RLS).
- **Redis-flush test scope.** `rush.integration.test.ts` flushes Redis 1.5 s into an 8 s Rush of 3,000 buyers on 900 seats and asserts that seats were still free at the flush (held + sold below capacity), that orders kept growing after it, and that buyers re-joined the waiting room (`requeued > 0`). It does not prove arrival order or fairness after the flush (both are reset), and one run is one timing. The fail-open Rush runs with `noDocumentQueue`, so it does not exercise the PDF queue.
- **Waiting-room slots of browser buyers** who close the tab are held until the active TTL (5 minutes); only the simulator calls the release endpoint. Browsing the event page consumes a slot while the page is open.
- **Admission tickets are bearer tokens**, not bound to the user who joined; anti-bot is out of scope ([ADR 0002](adr/0002-waiting-room-fails-open.md)).
- **Login rate limit behind `TRUST_PROXY=1`.** The compose API trusts `X-Forwarded-For` and is published on 127.0.0.1, so a direct local caller can rotate that header and bypass the login limiter (local demo only).
- **Child tables carry no `tenant_id`** (`order_items`, `tickets`, `event_seats`, ...); they inherit the tenant through foreign keys from the root aggregates.
- **Ids are plain strings in most service signatures**; branded types are used in `packages/shared`, `packages/core` and some services only.
- **Exports**: an export that fails after the 200 headers were sent ends as a truncated file.
- **PDFs show amounts without a currency symbol** (`money()` in `apps/worker/src/documents/ticket-pdf.ts`, used by the report too).
- **Simulated gateway ordering**: the gateway "charges" before the hold is validated (see Payment and idempotency).
- **Node images run as root** (`docker/node.Dockerfile`, `docker/web.Dockerfile`); acceptable for a local demo only.
- **Generated UI kit.** `apps/web/src/components/ui` holds 278 generated shadcn/Pulse registry files, most of them unused; the folder is excluded from ESLint and from the `tsc` roots (files imported by the app are still type-checked through their imports). `dropdown-menu.tsx` carries one local patch, marked at the top of the file; `shadcn add -o` would revert it.
