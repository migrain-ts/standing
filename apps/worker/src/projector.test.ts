import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertPaidOrder, rebuildRollups } from '@standing/db';
import type { EventDelta } from '@standing/core';
import { projectOutbox } from './projector';
import { insertEventFixture, makeBuyer, makeWorkerDb } from './test-helpers';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
beforeAll(async () => {
  t = await makeWorkerDb();
});
afterAll(async () => {
  await t.close();
});

const rollups = async (eventId: string) => {
  const m = await t.db.execute(sql`select bucket, tickets, revenue_cents from sales_by_minute where event_id = ${eventId}::uuid order by bucket`);
  const s = await t.db.execute(sql`select section_id, tickets, revenue_cents from sales_by_section where event_id = ${eventId}::uuid order by section_id`);
  return { minute: m.rows.map((r) => [new Date(r.bucket as string).toISOString(), Number(r.tickets), Number(r.revenue_cents)]), section: s.rows.map((r) => [r.section_id, Number(r.tickets), Number(r.revenue_cents)]) };
};

async function sell(f: Awaited<ReturnType<typeof insertEventFixture>>, groups: number[][], minutesApart = 1) {
  const buyer = await makeBuyer(t.db, 'b');
  let i = 0;
  for (const g of groups) {
    await insertPaidOrder(t.db, {
      eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: g.map((n) => f.seatIds[n]!),
      at: new Date(t.clock.now().getTime() + i++ * minutesApart * 60_000 + 5_000),
    });
  }
}

describe('projectOutbox', () => {
  it('projects sales into per-minute and per-section rollups equal to a raw recompute', async () => {
    const f = await insertEventFixture(t.db, { rows: 2, seatsPerRow: 10, priceCents: 1000 });
    await sell(f, [[0, 1], [2], [3, 4, 5], [6]]);
    const res = await projectOutbox(t.db, { clock: t.clock });
    expect(res).toMatchObject({ processed: 4, skipped: 0 });
    const projected = await rollups(f.eventId);
    await rebuildRollups(t.db, f.eventId);
    expect(await rollups(f.eventId)).toEqual(projected);
    expect(projected.section).toEqual([[f.sectionId, 7, 7000]]);
  });

  it('is idempotent: a second run processes nothing and changes nothing', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 4 });
    await sell(f, [[0], [1]]);
    await projectOutbox(t.db, { clock: t.clock });
    const before = await rollups(f.eventId);
    expect(await projectOutbox(t.db, { clock: t.clock })).toMatchObject({ processed: 0 });
    expect(await rollups(f.eventId)).toEqual(before);
  });

  it('projects each of 500 rows exactly once when two projectors run concurrently', async () => {
    const f = await insertEventFixture(t.db, { rows: 25, seatsPerRow: 20, priceCents: 100 });
    await sell(f, Array.from({ length: 500 }, (_, i) => [i]), 0);
    const runs = await Promise.all([
      (async () => { let n = 0; for (let p = 1; p;) { p = (await projectOutbox(t.db, { clock: t.clock, batchSize: 50 })).processed; n += p; } return n; })(),
      (async () => { let n = 0; for (let p = 1; p;) { p = (await projectOutbox(t.db, { clock: t.clock, batchSize: 50 })).processed; n += p; } return n; })(),
    ]);
    expect(runs[0]! + runs[1]!).toBe(500);
    const projected = await rollups(f.eventId);
    await rebuildRollups(t.db, f.eventId);
    expect(await rollups(f.eventId)).toEqual(projected);
    expect(projected.section).toEqual([[f.sectionId, 500, 50_000]]);
  });

  it('never deadlocks when two projectors claim batches touching events X and Y in opposite orders', { timeout: 120_000 }, async () => {
    const x = await insertEventFixture(t.db, { rows: 10, seatsPerRow: 20, priceCents: 100 });
    const y = await insertEventFixture(t.db, { rows: 10, seatsPerRow: 20, priceCents: 100 });
    const buyer = await makeBuyer(t.db, 'xy');
    const at = new Date(t.clock.now().getTime() + 5_000); // one minute bucket shared by both events
    // Outbox order X, Y, Y, X, ...: with batches of 2, one projector sees [X, Y] while the other sees [Y, X].
    for (let i = 0; i < 400; i++) {
      const f = i % 4 === 0 || i % 4 === 3 ? x : y;
      await insertPaidOrder(t.db, { eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: [f.seatIds[i >> 1]!], at });
    }
    const drain = async () => { let n = 0; for (let p = 1; p;) { p = (await projectOutbox(t.db, { clock: t.clock, batchSize: 2 })).processed; n += p; } return n; };
    const runs = await Promise.all([drain(), drain()]);
    expect(runs[0]! + runs[1]!).toBe(400);
    for (const f of [x, y]) {
      const projected = await rollups(f.eventId);
      await rebuildRollups(t.db, f.eventId);
      expect(await rollups(f.eventId)).toEqual(projected);
      expect(projected.section).toEqual([[f.sectionId, 200, 20_000]]);
    }
  });

  it('publishes one aggregated delta per event after the commit, and a failing publisher does not undo the projection', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 6, priceCents: 500 });
    await sell(f, [[0, 1], [2]]);
    const deltas: EventDelta[] = [];
    await projectOutbox(t.db, { clock: t.clock, publish: async (d) => { deltas.push(d); } });
    expect(deltas).toHaveLength(1);
    expect(deltas[0]).toMatchObject({ eventId: f.eventId, tenantId: f.tenantId, tickets: 3, revenueCents: 1500, scanned: 0 });
    expect(deltas[0]!.seats.map((s) => s.idx).sort()).toEqual([0, 1, 2]);

    const g = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    await sell(g, [[0]]);
    const logged: string[] = [];
    await projectOutbox(t.db, { clock: t.clock, publish: async () => { throw new Error('redis down'); }, log: (l) => logged.push(l) });
    expect((await rollups(g.eventId)).section).toEqual([[g.sectionId, 1, 5000]]);
    expect(logged.join()).toContain('redis down');
  });

  it('counts scans in the delta and skips unknown kinds and malformed payloads without blocking the queue', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    await t.db.execute(sql`
      insert into outbox (kind, tenant_id, event_id, payload, dedupe_key) values
      ('ticket.scanned', ${f.tenantId}::uuid, ${f.eventId}::uuid, ${JSON.stringify({ ticketId: 'x', at: '2026-01-05T08:00:00Z' })}::jsonb, 'scan-1'),
      ('ticket.sold', ${f.tenantId}::uuid, ${f.eventId}::uuid, '{"nope":true}'::jsonb, 'bad-1'),
      ('mystery', ${f.tenantId}::uuid, ${f.eventId}::uuid, '{}'::jsonb, 'unknown-1')`);
    const deltas: EventDelta[] = [];
    const res = await projectOutbox(t.db, { clock: t.clock, publish: async (d) => { deltas.push(d); } });
    expect(res).toMatchObject({ processed: 3, skipped: 2 });
    expect(deltas[0]).toMatchObject({ scanned: 1, tickets: 0 });
    expect((await t.db.execute(sql`select count(*)::int as n from outbox where processed_at is null`)).rows[0]).toMatchObject({ n: 0 });
  });
});
