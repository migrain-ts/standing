import { serve } from '@hono/node-server';
import type { AddressInfo } from 'node:net';
import { and, count, eq } from 'drizzle-orm';
import { insertEventFixture, schema } from '@standing/db';
import { makeApp, connectTestRedis, type TestApp } from '@standing/api/src/test-helpers';
import { oversold } from '@standing/api/src/services/live';
import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startRush } from './run';
import { createSimulatorServer } from './server';

let t: TestApp;
let redis: Redis;
let apiUrl: string;
let httpServer: ReturnType<typeof serve>;

beforeAll(async () => {
  redis = await connectTestRedis();
  t = await makeApp({ redis, config: { paymentLatencyMs: 0, paymentFailureRate: 0.1 } });
  httpServer = serve({ fetch: t.app.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((resolve) => httpServer.once('listening', () => resolve()));
  apiUrl = `http://127.0.0.1:${(httpServer.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => setTimeout(r, 300)); // handlers of requests aborted by stop() may still be finishing
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await t.close();
  redis.disconnect();
});

describe('rush simulator', () => {
  it('sells out a small event with 300 buyers: no oversell, counters match the database', async () => {
    const fx = await insertEventFixture(t.db, { rows: 5, seatsPerRow: 10 });
    // The API clock is fake and never advances, so admissions never lapse: admit everybody to avoid a stuck queue.
    await t.db.update(schema.events).set({ admissionLimit: 400 }).where(eq(schema.events.id, fx.eventId));
    const rush = startRush(
      { apiUrl, db: t.db },
      { eventId: fx.eventId, buyers: 300, maxSeatsPerBuyer: 2, durationSeconds: 3, abandonRate: 0, thinkMs: [0, 50] },
    );
    const stats = await rush.done;
    expect(stats.status).toBe('finished');
    const c = stats.counters;
    expect(c.started).toBe(300);
    expect(c.paid + c.expired + c.abandoned + c.soldOut + c.errors).toBe(c.started);
    expect(c.soldOut).toBeGreaterThan(0);
    expect(c.paid).toBeGreaterThan(0);
    const [orders] = await t.db.select({ n: count() }).from(schema.orders).where(eq(schema.orders.eventId, fx.eventId));
    expect(c.paid).toBe(orders?.n);
    expect(await oversold(t.db, fx.eventId)).toBe(0);
    const [sold] = await t.db
      .select({ n: count() })
      .from(schema.eventSeats)
      .where(and(eq(schema.eventSeats.eventId, fx.eventId), eq(schema.eventSeats.status, 'sold')));
    expect(sold?.n).toBeGreaterThan(0);
    expect(sold?.n).toBeLessThanOrEqual(50);
    expect(stats.latencyMs.holdP95).toBeGreaterThanOrEqual(stats.latencyMs.holdP50);
    expect(stats.requests).toBeGreaterThan(300);
  }, 120_000);

  it('stops on request and reports status stopped', async () => {
    const fx = await insertEventFixture(t.db, { rows: 5, seatsPerRow: 10 });
    const rush = startRush({ apiUrl, db: t.db }, { eventId: fx.eventId, buyers: 50, maxSeatsPerBuyer: 1, durationSeconds: 60 });
    await new Promise((r) => setTimeout(r, 500));
    rush.stop();
    const stats = await rush.done;
    expect(stats.status).toBe('stopped');
    expect(stats.finishedAt).toBeDefined();
    expect(rush.stats().status).toBe('stopped');
  }, 120_000);

  it('rejects a second run for the same event while one is active, through the server', async () => {
    const fx = await insertEventFixture(t.db, { rows: 5, seatsPerRow: 10 });
    const sim = createSimulatorServer({ token: 'secret', apiUrl, db: t.db });
    const body = JSON.stringify({ eventId: fx.eventId, buyers: 20, maxSeatsPerBuyer: 1, durationSeconds: 60 });
    const headers = { 'x-simulator-token': 'secret', 'content-type': 'application/json' };
    const first = await sim.request('/runs', { method: 'POST', headers, body });
    expect(first.status).toBe(202);
    const { id } = (await first.json()) as { id: string };
    const second = await sim.request('/runs', { method: 'POST', headers, body });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: { code: string } }).error.code).toBe('rush_running');
    const latest = await sim.request(`/runs?eventId=${fx.eventId}`, { headers });
    expect(((await latest.json()) as { id: string }).id).toBe(id);
    const bad = await sim.request('/runs', { method: 'POST', headers, body: JSON.stringify({ eventId: fx.eventId, buyers: 0 }) });
    expect(bad.status).toBe(400);
    const del = await sim.request(`/runs/${id}`, { method: 'DELETE', headers });
    expect(del.status).toBe(200);
    let status = 'running';
    for (let i = 0; i < 50 && status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      const got = await sim.request(`/runs/${id}`, { headers });
      status = ((await got.json()) as { stats: { status: string } }).stats.status;
    }
    expect(status).toBe('stopped');
  }, 120_000);

  it('refuses requests without the simulator token', async () => {
    const sim = createSimulatorServer({ token: 'secret', apiUrl, db: t.db });
    expect((await sim.request('/runs', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await sim.request('/runs/x', { headers: { 'x-simulator-token': 'wrong' } })).status).toBe(401);
  });
});
