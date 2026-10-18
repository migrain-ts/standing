import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertPaidOrder } from '@standing/db';
import { runCycle, type CycleState } from './cycle';
import { insertEventFixture, makeBuyer, makeWorkerDb } from './test-helpers';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
beforeAll(async () => {
  t = await makeWorkerDb();
});
afterAll(async () => {
  await t.close();
});

describe('runCycle', () => {
  it('projects, releases expired holds and refreshes the view on schedule', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 8, priceCents: 300 });
    const buyer = await makeBuyer(t.db, 'b');
    for (const n of [0, 1, 2]) {
      await insertPaidOrder(t.db, {
        eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: [f.seatIds[n]!], at: new Date(t.clock.now().getTime() + n * 60_000),
      });
    }
    const expiredAt = new Date(t.clock.now().getTime() - 60_000);
    const h = await t.db.execute(sql`
      insert into holds (buyer_id, event_id, seat_count, status, expires_at)
      values (${buyer}::uuid, ${f.eventId}::uuid, 1, 'active', ${expiredAt}::timestamptz) returning id`);
    await t.db.execute(sql`
      update event_seats set status = 'held', hold_id = ${String(h.rows[0]?.id)}::uuid, held_until = ${expiredAt}::timestamptz
      where event_id = ${f.eventId}::uuid and seat_id = ${f.seatIds[5]!}::uuid`);

    const mvRows = async () =>
      Number((await t.db.execute(sql`select count(*)::int as n from daily_sales_mv where event_id = ${f.eventId}::uuid`)).rows[0]?.n);
    const state: CycleState = { lastRefreshAt: 0 };

    expect(await runCycle(t.db, { clock: t.clock, state, refreshEveryMs: 60_000 })).toEqual({ projected: 3, released: { seats: 1, holds: 1 } });
    const section = await t.db.execute(sql`select tickets, revenue_cents from sales_by_section where event_id = ${f.eventId}::uuid`);
    expect(section.rows[0]).toMatchObject({ tickets: 3, revenue_cents: '900' });
    expect(await mvRows()).toBe(1);

    // New sale, clock unchanged: projected, but the view is not refreshed again yet.
    await insertPaidOrder(t.db, { eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: [f.seatIds[6]!], at: t.clock.now() });
    const lastRefresh = state.lastRefreshAt;
    expect(await runCycle(t.db, { clock: t.clock, state, refreshEveryMs: 60_000 })).toEqual({ projected: 1, released: { seats: 0, holds: 0 } });
    expect(state.lastRefreshAt).toBe(lastRefresh);
    const tickets = async () =>
      Number((await t.db.execute(sql`select tickets from daily_sales_mv where event_id = ${f.eventId}::uuid`)).rows[0]?.tickets);
    expect(await tickets()).toBe(3);

    t.clock.advanceMs(61_000);
    await runCycle(t.db, { clock: t.clock, state, refreshEveryMs: 60_000 });
    expect(await tickets()).toBe(4);
  });
});
