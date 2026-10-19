# Standing: design

Date: 2026-10-18. Status: awaiting review.

## 1. Purpose

- **What**: a multi-tenant ticketing SaaS. Organizers publish events on a seat map, buyers hold and buy seats, door staff scan tickets. A "Rush" button launches thousands of simulated buyers against the real API while a live dashboard shows sales and a verified `oversold: 0`.
- **Why**: GitHub showcase for a senior backend/database engineer. The target reader is a recruiter, not a CTO: 30 seconds after `docker compose up` they should see something move and think "that is strong". Not a product launch.
- **Constraints**: everything free, no hosted demo, fictional data only, simulated payment only, UI and README in English, one-click demo logins for local use only (known password, documented).
- **Success**:
  1. `docker compose up` starts the full stack with a rich seed; the organizer dashboard opens on a half-sold concert.
  2. The Rush runs from the UI with no oversell, proven by an independent SQL check and by tests on real Postgres and Redis.
  3. Exports (CSV, XLSX, PDF) work, including a large dataset with bounded memory.
  4. CI configuration is present and green when run (the GitHub account is currently billing-locked, so CI may not run until that is fixed).
  5. README explains the architecture, states the weaknesses, and justifies decisions in ADRs.

## 2. Scope of v1

In: organizers (multi-tenant: venues, seat maps, events, price tiers, roles); buyer storefront (seat map, 10-minute hold, simulated payment, PDF ticket with QR); door scan (anti-duplicate); live dashboard; Rush simulator; reports and exports (CSV, XLSX, PDF); waiting room.

Out: real payments, refunds, emails, i18n, native mobile app, anti-bot, ClickHouse, hosting.

## 3. Repository layout (npm workspaces monorepo)

```
apps/api         Hono + Zod + OpenAPI; buyer, organizer and door surfaces; SSE
apps/worker      BullMQ consumer: ticket and report PDFs, outbox projection, hold cleanup
apps/simulator   load generator: virtual buyers making real HTTP calls
apps/web         Next.js + shadcn/ui + Tailwind (Pulse design system): storefront, console, scan page
packages/db      Drizzle schema, migrations, client
packages/shared  Zod schemas, branded ids, shared types
docker-compose.yml, .env.example, docs/adr/, docs/ARCHITECTURE.md
```

Stack: TypeScript everywhere (strict; `typescript-pro` guidance applies: branded ids for seats, holds, orders and tickets; discriminated unions for hold and order states; Zod schemas shared by API and web; no tRPC unless decided later), Hono, Drizzle, Zod, PostgreSQL, Redis, BullMQ, Next.js App Router, shadcn/ui (Base UI) with the Pulse design system from Better Design and MingCute icons (decided 2026-10-18; Ant Design dropped because the catalog systems are shadcn-native), exceljs (streaming), a PDF library chosen in the plan, Vitest, Playwright.

Local ports (verified free on 2026-10-18, bound to 127.0.0.1): Postgres 5441, Redis 6380, API 4100, web 3200 (container port 3000).

**Source of truth rule**: Postgres decides every seat, order and ticket. Redis is never authoritative. Flushing Redis mid-Rush must not lose or double-sell a seat.

## 4. Data model

- Access: `tenants`, `users`, `memberships(tenant_id, user_id, role)` with role `owner | manager | door`. Buyers are plain accounts without a tenant.
- Venues: `venues`, `sections`, `seats` (row, number, x/y for the map). A venue is a reusable template.
- Events: `events` (venue, starts_at, status), `price_tiers` (price per section per event).
- Inventory: `event_seats(event_id, seat_id, status, held_until, hold_id, order_id)`, status `available | held | sold`. One row per seat per event, created at publication. A 5,000-seat venue means 5,000 rows per event, which is small for Postgres and keeps the locking easy to prove.
- Holds: `holds(id, buyer_id, event_id, expires_at)`.
- Orders: `orders` (`paid | cancelled`; an order exists only after a successful payment, the hold is the pending state), `order_items` with a unique constraint on `(event_id, seat_id)`, `tickets` (HMAC-signed QR code, `scanned_at`).
- Outbox: `outbox(kind, payload, dedupe_key)`, written in the same transaction as the change it describes (sales, scans).
- Rollups: `sales_by_minute(event_id, bucket, tickets, revenue)`, `sales_by_section`, plus one materialized view `daily_sales_mv` keyed by tenant, event and day for reports.
- The root aggregates (`venues`, `events`, `orders`, `documents`, `outbox`) carry `tenant_id`; child tables (`sections`, `seats`, `price_tiers`, `event_seats`, `holds`, `order_items`, `tickets`, `payments`, rollups) carry none and inherit the tenant through their foreign keys.

Decision: inventory is materialized, not computed.

## 5. Purchase flow, waiting room, Rush

**Hold** (`POST /events/:id/holds`, 1 to 8 seats), one transaction:

```sql
SELECT ... FROM event_seats
WHERE id = ANY($1) AND (status = 'available' OR held_until < now())
ORDER BY id FOR UPDATE SKIP LOCKED
```

If fewer rows come back than requested: rollback and 409 listing the taken seats. Otherwise mark them `held` with `held_until`. All or nothing, no lock waiting, so no deadlock. Expiry is claimed lazily through `held_until`; the worker only cleans up, correctness does not depend on it.

**Payment** (`POST /holds/:id/pay`, idempotency key): latency and failure rate are configurable (5% by default). One transaction: check the event is still on sale, published and not started (else 409 `event_closed`, nothing written, the hold stays), check the hold has not expired (else 410), mark seats `sold`, create order, signed tickets and an outbox row. The unique constraint on `order_items(event_id, seat_id)` makes a double sale impossible even if application code is wrong. The ticket PDF is an asynchronous job.

**Waiting room** (Redis): sorted set by arrival order. An admission controller admits N buyers at a time and hands out a time-limited token required by the hold endpoint. The buyer sees their position and an estimate. If Redis errors, the API runs without a queue (fail open): arrival order is lost, but no seat can be oversold because Postgres decides. If Redis is flushed (reachable but empty), admitted tokens become unknown and the hold endpoint fails closed for that buyer (403 `queue_required`) until they re-join the queue.

**Rush**: the organizer picks buyers (up to 5,000), seats per buyer and duration. The simulator starts virtual buyers that make the same HTTP calls as a browser (queue, admission, read seat map, hold, pay), with random abandonment and payment failures. The `oversold` counter is an independent SQL query (tickets issued minus seats sold), never incremented by the simulator.

**Honest limits** (stated in README): simulator and API share one machine, so measured throughput reflects a laptop, not a cluster. No real payment, no anti-bot.

## 6. Live, rollups, exports, multi-tenant, scan

**Realtime**: the worker consumes the outbox (`FOR UPDATE SKIP LOCKED`), updates rollups, publishes a delta on Redis pub/sub. The API relays it as SSE per event: seats sold per section (map colors), sales per minute, revenue, queue size, oversold. On load or reconnect the client reads a full snapshot from Postgres, then applies deltas. Redis is never the source of truth.

**Rollups**: idempotent upserts keyed by processed outbox id. A test compares rollups with a raw recompute from orders.

**Exports**:
- CSV and XLSX stream from a Postgres cursor (exceljs streaming writer), constant memory on 100,000 rows.
- Report PDF (summary, chart, per-section table) and ticket PDF are asynchronous jobs with status `queued | running | ready | failed` and a download when ready.

**Multi-tenant and roles**: a single middleware filters by `tenant_id`, in the same spirit as DoseCare's `requireRole`. `owner` (everything, members), `manager` (events, exports, Rush), `door` (scan only). A foreign tenant gets 404, never 403. Table-driven test route × role × other tenant that fails when a route has no check. Postgres row-level security (RLS) is out of v1: the single middleware and the matrix test are the isolation guarantees. An ADR records that RLS was considered and rejected (extra complexity: transaction-scoped `SET LOCAL`, non-owner DB role, and the buyer flow crosses tenants), and that the matrix test is what catches a missing filter.

**Door scan**: `POST /scan {code}` verifies the HMAC signature, then locks the ticket row (`SELECT ... FOR UPDATE`), checks the tenant and the event, and sets `scanned_at` (bound clock) only if it is still null. Concurrent scans are serialized by the row lock, so exactly one wins; the others answer already scanned with the first scan time. Mobile web page using `BarcodeDetector` when available, manual code entry as fallback.

## 7. Demo, tests, infrastructure

**First minute**: `docker compose up` loads a seed: 3 fictional tenants, venues of 800 to 5,000 seats, about 15 events, 30 days of sales history. The login page has one button per role (Organizer, Buyer, Door staff). Landing on the organizer dashboard of a half-sold concert with a large Rush button. README has a Rush GIF (recorded by a Playwright script, planned in the plan, not left to the end), screenshots and a Mermaid diagram.

**Tests** (Vitest, real Postgres and Redis):
- Concurrency: 200 buyers on 50 seats gives exactly 50 sales, no duplicate, the rest get 409; same with holds expiring mid-run.
- Payment idempotency (same key twice gives one order); expired hold gives 410.
- Redis flushed during a Rush: no oversell, orders equal paid buyers, and sales continue after the flush.
- Outbox: two workers, each event projected once, rollups equal raw recompute.
- Authorization matrix; scan: double scan, forged signature.
- Exports: CSV/XLSX content, memory ceiling on a large set; PDFs valid and non-empty.
- One Playwright e2e: demo login, Rush, `oversold` is 0.
- `npm run bench` with numbers and machine description in the README.

**Infrastructure**: Docker Compose (Postgres, Redis, api, worker, simulator, web), migrations and seed automatic, ports on 127.0.0.1. GitHub Actions with Postgres and Redis services. ADRs: Postgres is the source of truth, waiting room fails open, at-least-once delivery, materialized inventory, RLS rejected for v1.

## 8. Known risks

- Streaming XLSX and PDF libraries: behavior confirmed during implementation; fallback is CSV-only streaming plus a bounded XLSX size.
- Rush throughput on a laptop: the simulator caps concurrency; numbers are reported as measured, not promised.
- Tenant isolation relies on application code plus the matrix test; no database-level backstop (RLS rejected, see section 6).
- CI cannot be proven green until the GitHub billing lock is resolved.
