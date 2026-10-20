import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { and, count, eq, sql } from 'drizzle-orm';
import { insertEventFixture, rebuildRollups, schema, type Db } from '@standing/db';
import { projectOutbox } from '@standing/worker';
import { connectTestRedis, makeApp, type TestApp } from '@standing/api/src/test-helpers';
import { oversold } from '@standing/api/src/services/live';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRush } from './run';

// Observed over 5 runs (flush 1.5 s into an 8 s Rush): taken at the flush 368..406 of 900, orders 65..77 at the
// flush and 510..540 at the end, requeued 219..241, taken at the end 880..889.
const CAPACITY = 900;
const FLUSH_AFTER_MS = 1500;
// 90% of the venue: leaves a wide margin yet fails on a stalled queue.
const COVERAGE_MIN = 810;
let redis: Redis;
const servers: ReturnType<typeof serve>[] = [];
const apps: TestApp[] = [];

async function serveApp(t: TestApp): Promise<string> {
  apps.push(t);
  const server = serve({ fetch: t.app.fetch, port: 0, hostname: '127.0.0.1' });
  servers.push(server);
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

beforeAll(async () => {
  redis = await connectTestRedis();
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 500)); // handlers of aborted requests may still be finishing
  for (const s of servers) await new Promise<void>((resolve) => s.close(() => resolve()));
  for (const t of apps) await t.close();
  redis.disconnect();
});

const sections = async (db: Db, eventId: string) =>
  (await db.execute(sql`select section_id, tickets, revenue_cents from sales_by_section where event_id = ${eventId}::uuid order by section_id`)).rows.map(
    (r) => [r.section_id, Number(r.tickets), Number(r.revenue_cents)],
  );

async function drainOutbox(t: TestApp): Promise<void> {
  for (let processed = 1; processed > 0; ) processed = (await projectOutbox(t.db, { clock: t.clock })).processed;
}

async function takenAndOrders(db: Db, eventId: string): Promise<{ taken: number; orders: number }> {
  const r = await db.execute(sql`
    select (select count(*)::int from event_seats where event_id = ${eventId}::uuid and status in ('held', 'sold')) as taken,
      (select count(*)::int from orders where event_id = ${eventId}::uuid) as orders`);
  return { taken: Number(r.rows[0]?.taken), orders: Number(r.rows[0]?.orders) };
}

async function expectConsistent(t: TestApp, eventId: string, paid: number): Promise<number> {
  await drainOutbox(t);
  expect(await oversold(t.db, eventId)).toBe(0);
  const [sold] = await t.db.select({ n: count() }).from(schema.eventSeats).where(and(eq(schema.eventSeats.eventId, eventId), eq(schema.eventSeats.status, 'sold')));
  const [orders] = await t.db.select({ n: count() }).from(schema.orders).where(eq(schema.orders.eventId, eventId));
  const tickets = await t.db.execute(sql`select count(*)::int as n from tickets where order_id in (select id from orders where event_id = ${eventId}::uuid)`);
  expect(tickets.rows[0]?.n).toBe(sold?.n);
  expect(orders?.n).toBe(paid);
  const projected = await sections(t.db, eventId);
  await rebuildRollups(t.db, eventId);
  expect(await sections(t.db, eventId)).toEqual(projected);
  expect(sold?.n).toBeLessThanOrEqual(CAPACITY);
  return sold?.n ?? 0;
}

describe('rush integration', () => {
  it('survives a Redis flush in the middle of a Rush: no oversell, sales continue after it, rollups equal the raw recompute', async () => {
    const t = await makeApp({ redis, config: { paymentLatencyMs: 0, paymentFailureRate: 0.05 } });
    const apiUrl = await serveApp(t);
    const fx = await insertEventFixture(t.db, { rows: 30, seatsPerRow: 30 }); // 900 seats, default admissionLimit 200
    const rush = startRush({ apiUrl, db: t.db }, { eventId: fx.eventId, buyers: 3000, maxSeatsPerBuyer: 3, durationSeconds: 8 });
    await new Promise((r) => setTimeout(r, FLUSH_AFTER_MS));
    await redis.flushdb(); // queue, admissions, rate limits and BullMQ keys vanish
    const atFlush = await takenAndOrders(t.db, fx.eventId);
    const stats = await rush.done;
    expect(stats.status).toBe('finished');
    const c = stats.counters;
    const sold = await expectConsistent(t, fx.eventId, c.paid);
    const atEnd = await takenAndOrders(t.db, fx.eventId);
    // The flush hit a live sale: seats were still free, and buyers who lost their admission re-joined and kept buying.
    expect(atFlush.taken).toBeLessThan(CAPACITY);
    expect(atEnd.orders).toBeGreaterThan(atFlush.orders);
    // Held seats never expire under the FakeClock, so more taken seats proves a hold was created after the flush.
    expect(atEnd.taken).toBeGreaterThan(atFlush.taken);
    expect(c.requeued).toBeGreaterThan(0);
    expect(c.paid).toBeGreaterThan(0);
    expect(sold).toBeGreaterThan(0);
    // No stall: the venue ran out. Held seats stay held under the API's FakeClock (abandoned holds never expire).
    expect(atEnd.taken).toBeGreaterThanOrEqual(COVERAGE_MIN);
    expect(c.soldOut).toBeGreaterThan(0);
    expect(c.started).toBe(3000);
    expect(c.errors / c.started).toBeLessThan(0.05);
  }, 180_000);

  it('keeps selling when Redis is unreachable for the whole run (fail open)', async () => {
    const broken = new Proxy({}, { get: (_t, prop) => (prop === 'then' ? undefined : async () => { throw new Error('redis down'); }) }) as unknown as Redis;
    const t = await makeApp({ redis: broken, noDocumentQueue: true, config: { paymentLatencyMs: 0, paymentFailureRate: 0.05 } });
    const apiUrl = await serveApp(t);
    const fx = await insertEventFixture(t.db, { rows: 10, seatsPerRow: 10 });
    const stats = await startRush({ apiUrl, db: t.db }, { eventId: fx.eventId, buyers: 300, maxSeatsPerBuyer: 2, durationSeconds: 3 }).done;
    expect(stats.status).toBe('finished');
    expect(stats.counters.paid).toBeGreaterThan(0);
    expect(stats.counters.errors / stats.counters.started).toBeLessThan(0.05);
    await expectConsistent(t, fx.eventId, stats.counters.paid);
  }, 180_000);
});
