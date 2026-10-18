import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertPaidOrder } from '@standing/db';
import { releaseExpiredHolds } from './cleanup';
import { insertEventFixture, makeBuyer, makeWorkerDb } from './test-helpers';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
beforeAll(async () => {
  t = await makeWorkerDb();
});
afterAll(async () => {
  await t.close();
});

const minutes = (n: number) => new Date(t.clock.now().getTime() + n * 60_000);

async function hold(eventId: string, buyerId: string, seatId: string, expiresAt: Date) {
  const r = await t.db.execute(sql`
    insert into holds (buyer_id, event_id, seat_count, status, expires_at)
    values (${buyerId}::uuid, ${eventId}::uuid, 1, 'active', ${expiresAt}::timestamptz) returning id`);
  const id = String(r.rows[0]?.id);
  await t.db.execute(sql`
    update event_seats set status = 'held', hold_id = ${id}::uuid, held_until = ${expiresAt}::timestamptz
    where event_id = ${eventId}::uuid and seat_id = ${seatId}::uuid`);
  return id;
}

const seatRow = async (eventId: string, seatId: string) =>
  (await t.db.execute(sql`select status, hold_id, held_until from event_seats where event_id = ${eventId}::uuid and seat_id = ${seatId}::uuid`)).rows[0];

describe('releaseExpiredHolds', () => {
  it('frees expired holds only, and a second run releases nothing', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 5 });
    const buyer = await makeBuyer(t.db, 'b');
    const expired = await hold(f.eventId, buyer, f.seatIds[0]!, minutes(-5));
    const live = await hold(f.eventId, buyer, f.seatIds[1]!, minutes(5));
    await insertPaidOrder(t.db, { eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: [f.seatIds[2]!], at: minutes(-10) });

    expect(await releaseExpiredHolds(t.db, t.clock)).toEqual({ seats: 1, holds: 1 });
    expect(await seatRow(f.eventId, f.seatIds[0]!)).toMatchObject({ status: 'available', hold_id: null, held_until: null });
    expect(await seatRow(f.eventId, f.seatIds[1]!)).toMatchObject({ status: 'held', hold_id: live });
    expect(await seatRow(f.eventId, f.seatIds[2]!)).toMatchObject({ status: 'sold' });
    const holds = await t.db.execute(sql`select id, status from holds where event_id = ${f.eventId}::uuid`);
    const byId = new Map(holds.rows.map((r) => [String(r.id), String(r.status)]));
    expect(byId.get(expired)).toBe('cancelled');
    expect(byId.get(live)).toBe('active');
    expect([...byId.values()]).toContain('paid');

    expect(await releaseExpiredHolds(t.db, t.clock)).toEqual({ seats: 0, holds: 0 });
  });

  it('never frees a seat that was reclaimed concurrently (30 iterations)', async () => {
    const f = await insertEventFixture(t.db, { rows: 3, seatsPerRow: 10 });
    const buyer = await makeBuyer(t.db, 'b');
    for (let i = 0; i < 30; i++) {
      const seatId = f.seatIds[i]!;
      await hold(f.eventId, buyer, seatId, minutes(-5));
      const fresh = await t.db.execute(sql`
        insert into holds (buyer_id, event_id, seat_count, status, expires_at)
        values (${buyer}::uuid, ${f.eventId}::uuid, 1, 'active', ${minutes(10)}::timestamptz) returning id`);
      const newHold = String(fresh.rows[0]?.id);
      await Promise.all([
        releaseExpiredHolds(t.db, t.clock),
        t.db.execute(sql`
          update event_seats set status = 'held', hold_id = ${newHold}::uuid, held_until = ${minutes(10)}::timestamptz
          where event_id = ${f.eventId}::uuid and seat_id = ${seatId}::uuid
            and (status = 'available' or (status = 'held' and held_until < ${t.clock.now()}::timestamptz))`),
      ]);
      const row = await seatRow(f.eventId, seatId);
      // Reclaim either won (held, new hold) or cleanup freed it first and the reclaim found it available; both end held.
      expect(row).toMatchObject({ status: 'held', hold_id: newHold });
    }
  });
});
