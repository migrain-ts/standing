import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertEventFixture, insertPaidOrder, rebuildRollups } from '@standing/db';
import { makeUser, makeApp, type TestApp } from '../test-helpers';
import { loadSnapshot, oversold } from './live';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

async function fixture() {
  const f = await insertEventFixture(t.db, { rows: 4, seatsPerRow: 5, tenantName: 'Live Tenant' });
  const buyer = await makeUser(t, 'buyer');
  return { f, buyer };
}
const priceOf = async (eventId: string) => {
  const r = await t.db.execute(sql`select price_cents from price_tiers where event_id = ${eventId}::uuid`);
  return Number(r.rows[0]?.price_cents);
};

describe('live snapshot', () => {
  it('computes totals, per-section figures and the minute series from projected sales', async () => {
    const { f, buyer } = await fixture();
    const base = { tenantId: f.tenantId, eventId: f.eventId, buyerId: buyer.id };
    await insertPaidOrder(t.db, { ...base, seatIds: [f.seatIds[0] ?? '', f.seatIds[1] ?? ''], at: t.clock.now() });
    await insertPaidOrder(t.db, { ...base, seatIds: [f.seatIds[2] ?? ''], at: new Date(t.clock.now().getTime() + 120_000) });
    await rebuildRollups(t.db, f.eventId);
    const price = await priceOf(f.eventId);
    const s = await loadSnapshot(t.deps, f.tenantId, f.eventId);
    expect(s.totals).toMatchObject({ sold: 3, held: 0, revenueCents: 3 * price, scanned: 0, oversold: 0, queue: null });
    expect(s.capacity).toBe(f.seatIds.length);
    expect(s.totals.available).toBe(s.capacity - 3);
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0]).toMatchObject({ sold: 3, priceCents: price, capacity: f.seatIds.length });
    expect(s.byMinute).toHaveLength(2);
    expect(s.byMinute.reduce((n, m) => n + m.tickets, 0)).toBe(3);
    expect(s.byMinute.reduce((n, m) => n + m.revenueCents, 0)).toBe(s.totals.revenueCents);
    expect(s.byMinute[0]?.bucket && s.byMinute[1]?.bucket && s.byMinute[0].bucket < s.byMinute[1].bucket).toBe(true);
    expect(s.event.id).toBe(f.eventId);
  });

  it('counts expired holds as available and live holds as held', async () => {
    const { f, buyer } = await fixture();
    const now = t.clock.now();
    const [hold] = (
      await t.db.execute(sql`insert into holds (buyer_id, event_id, seat_count, status, expires_at)
        values (${buyer.id}::uuid, ${f.eventId}::uuid, 2, 'active', ${now}::timestamptz) returning id`)
    ).rows;
    const holdId = String(hold?.id);
    await t.db.execute(sql`update event_seats set status='held', hold_id=${holdId}::uuid, held_until=${new Date(now.getTime() + 60_000)}::timestamptz
      where event_id=${f.eventId}::uuid and seat_id=${f.seatIds[0]}::uuid`);
    await t.db.execute(sql`update event_seats set status='held', hold_id=${holdId}::uuid, held_until=${new Date(now.getTime() - 60_000)}::timestamptz
      where event_id=${f.eventId}::uuid and seat_id=${f.seatIds[1]}::uuid`);
    const s = await loadSnapshot(t.deps, f.tenantId, f.eventId);
    expect(s.totals.held).toBe(1);
    expect(s.totals.sold).toBe(0);
    expect(s.totals.available).toBe(s.capacity - 1);
  });

  it('detects an inconsistency independently of the application code', async () => {
    const { f, buyer } = await fixture();
    await insertPaidOrder(t.db, { tenantId: f.tenantId, eventId: f.eventId, buyerId: buyer.id, seatIds: [f.seatIds[0] ?? ''], at: t.clock.now() });
    expect(await oversold(t.db, f.eventId)).toBe(0);
    await t.db.execute(sql`update event_seats set status='available', order_id=null
      where event_id=${f.eventId}::uuid and seat_id=${f.seatIds[0]}::uuid`);
    expect(await oversold(t.db, f.eventId)).toBe(1);
    expect((await loadSnapshot(t.deps, f.tenantId, f.eventId)).totals.oversold).toBe(1);
  });

  it('reports 0 oversold on a consistent event', async () => {
    const { f, buyer } = await fixture();
    expect(await oversold(t.db, f.eventId)).toBe(0);
    await insertPaidOrder(t.db, { tenantId: f.tenantId, eventId: f.eventId, buyerId: buyer.id, seatIds: [f.seatIds[3] ?? '', f.seatIds[4] ?? ''], at: t.clock.now() });
    expect(await oversold(t.db, f.eventId)).toBe(0);
  });
});
