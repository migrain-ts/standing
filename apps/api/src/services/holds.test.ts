import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertEventFixture } from '@standing/db';
import { ApiError } from '../errors';
import { makeApp, makeUser, type TestApp } from '../test-helpers';
import { cancelHold, createHold } from './holds';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

const heldCount = async (eventId: string) =>
  Number((await t.db.execute(sql`select count(*)::int as n from event_seats where event_id = ${eventId}::uuid and status = 'held'`)).rows[0]?.n);

/** Every held seat must belong to a hold that holds exactly seat_count seats: no partial holds, ever. */
async function expectNoPartialHolds(eventId: string) {
  const r = await t.db.execute(sql`
    select h.id, h.seat_count, count(*)::int as n
    from holds h join event_seats es on es.hold_id = h.id and es.status = 'held'
    where h.event_id = ${eventId}::uuid and h.status = 'active'
    group by h.id, h.seat_count having count(*) <> h.seat_count`);
  expect(r.rows).toEqual([]);
  const orphan = await t.db.execute(sql`
    select es.seat_id from event_seats es left join holds h on h.id = es.hold_id and h.status = 'active'
    where es.event_id = ${eventId}::uuid and es.status = 'held' and h.id is null`);
  expect(orphan.rows).toEqual([]);
}

describe('createHold', () => {
  it('holds the seats until now + ttl and prices them from the tier', async () => {
    const f = await insertEventFixture(t.db, { rows: 2, seatsPerRow: 4, priceCents: 7000 });
    const buyer = await makeUser(t, 'b1');
    const hold = await createHold(t.deps, { buyerId: buyer.id, eventId: f.eventId, seatIds: f.seatIds.slice(0, 2) });
    expect(hold.totalCents).toBe(14000);
    expect(hold.expiresAt).toBe(new Date(t.clock.now().getTime() + 600_000).toISOString());
    expect(await heldCount(f.eventId)).toBe(2);
  });

  it('is all or nothing: one taken seat rejects the whole request and holds none of the others', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 4 });
    const a = await makeUser(t, 'a');
    const b = await makeUser(t, 'b');
    await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[1]!] });
    const err = await createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[0]!, f.seatIds[1]!] }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 409, code: 'seats_unavailable', details: { taken: [f.seatIds[1]] } });
    expect(await heldCount(f.eventId)).toBe(1);
  });

  it('gives exactly one winner per seat when 200 buyers race for 50 seats, 4 per seat', async () => {
    const f = await insertEventFixture(t.db, { rows: 5, seatsPerRow: 10 });
    const buyers = await Promise.all(Array.from({ length: 200 }, (_, i) => makeUser(t, `r${i}`)));
    const results = await Promise.allSettled(
      buyers.map((b, i) => createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[i % 50]!] })),
    );
    const ok = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(ok).toHaveLength(50);
    expect(rejected.every((r) => r.reason instanceof ApiError && r.reason.status === 409)).toBe(true);
    expect(await heldCount(f.eventId)).toBe(50);
    await expectNoPartialHolds(f.eventId);
  });

  it('never leaves a partial hold or a 500 when 60 buyers request overlapping pairs in opposite orders', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 6 });
    const pairs = [[0, 1], [1, 0], [1, 2], [2, 1], [2, 3], [3, 2], [4, 5], [5, 4]] as const;
    let fulfilled = 0;
    for (let round = 0; round < 5 && fulfilled === 0; round++) {
      const buyers = await Promise.all(Array.from({ length: 60 }, (_, i) => makeUser(t, `p${round}-${i}`)));
      const results = await Promise.allSettled(
        buyers.map((b, i) => {
          const [x, y] = pairs[i % pairs.length]!;
          return createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[x]!, f.seatIds[y]!] });
        }),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') fulfilled++;
        else {
          expect(r.reason).toMatchObject({ status: 409 });
          expect((r.reason as ApiError).details?.taken).toEqual(expect.any(Array));
          expect(((r.reason as ApiError).details?.taken as unknown[]).length).toBeGreaterThan(0);
        }
      }
    }
    expect(fulfilled).toBeGreaterThan(0);
    await expectNoPartialHolds(f.eventId);
    const seatsPerHold = await t.db.execute(sql`select count(distinct hold_id)::int as holds, count(*)::int as seats from event_seats where event_id = ${f.eventId}::uuid and status = 'held'`);
    expect(Number(seatsPerHold.rows[0]?.seats)).toBe(Number(seatsPerHold.rows[0]?.holds) * 2);
  });

  it('serializes concurrent requests from the same buyer: one active hold, no orphan seats', async () => {
    for (let i = 0; i < 20; i++) {
      const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 8 });
      const a = await makeUser(t, `same${i}`);
      if (i % 2 === 1) await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[7]!] });
      const results = await Promise.allSettled([
        createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[0]!, f.seatIds[1]!] }),
        createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[2]!, f.seatIds[3]!] }),
      ]);
      for (const r of results) {
        if (r.status === 'rejected') {
          expect(r.reason).toBeInstanceOf(ApiError);
          expect(['hold_in_progress', 'seats_unavailable']).toContain((r.reason as ApiError).code);
        }
      }
      expect(results.some((r) => r.status === 'fulfilled')).toBe(true);
      const active = await t.db.execute(sql`select count(*)::int as n from holds where buyer_id = ${a.id}::uuid and event_id = ${f.eventId}::uuid and status = 'active'`);
      expect(Number(active.rows[0]?.n)).toBe(1);
      await expectNoPartialHolds(f.eventId);
    }
  });

  it('keeps the race exact when every first hold has expired mid-run (lazy expiry, no cleanup)', async () => {
    const f = await insertEventFixture(t.db, { rows: 5, seatsPerRow: 10 });
    const first = await Promise.all(Array.from({ length: 50 }, (_, i) => makeUser(t, `x${i}`)));
    const firstHolds = await Promise.all(
      first.map((b, i) => createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[i]!] })),
    );
    t.clock.advanceMs(600_001);
    const buyers = await Promise.all(Array.from({ length: 200 }, (_, i) => makeUser(t, `y${i}`)));
    const results = await Promise.allSettled(
      buyers.map((b, i) => createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[i % 50]!] })),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(50);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(rejected.every((r) => r.reason instanceof ApiError && r.reason.status === 409)).toBe(true);
    const old = new Set(firstHolds.map((h) => h.id));
    const rows = await t.db.execute(sql`select hold_id from event_seats where event_id = ${f.eventId}::uuid and status = 'held'`);
    expect(rows.rows).toHaveLength(50);
    expect(rows.rows.every((r) => !old.has(String(r.hold_id) as (typeof firstHolds)[number]['id']))).toBe(true);
    await expectNoPartialHolds(f.eventId);
  });

  it('lets another buyer take seats whose hold has expired, without any cleanup running', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    const a = await makeUser(t, 'ea');
    const b = await makeUser(t, 'eb');
    await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[0]!] });
    await expect(createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[0]!] })).rejects.toMatchObject({ status: 409 });
    t.clock.advanceMs(600_001);
    await expect(createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[0]!] })).resolves.toBeTruthy();
  });

  it('replaces the buyer previous hold for the same event', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 4 });
    const a = await makeUser(t, 'rep');
    const first = await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[0]!, f.seatIds[1]!] });
    await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[2]!] });
    expect(await heldCount(f.eventId)).toBe(1);
    const old = await t.db.execute(sql`select status from holds where id = ${first.id}::uuid`);
    expect(old.rows[0]?.status).toBe('cancelled');
  });

  it('keeps the previous hold when the replacement fails', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 3 });
    const a = await makeUser(t, 'keep');
    const b = await makeUser(t, 'other');
    await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[0]!] });
    await createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[1]!] });
    await expect(createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[1]!] })).rejects.toMatchObject({ status: 409 });
    expect(await heldCount(f.eventId)).toBe(2);
  });

  it('rejects seats that are not part of the event and events that are not published', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    const other = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    const a = await makeUser(t, 'val');
    await expect(createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [other.seatIds[0]!] })).rejects.toMatchObject({ status: 400, code: 'unknown_seat' });
    const draft = await insertEventFixture(t.db, { status: 'draft' });
    await expect(createHold(t.deps, { buyerId: a.id, eventId: draft.eventId, seatIds: [draft.seatIds[0]!] })).rejects.toMatchObject({ status: 404 });
  });
});

describe('cancelHold', () => {
  it('releases the seats, and only the owner can cancel', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    const a = await makeUser(t, 'c1');
    const b = await makeUser(t, 'c2');
    const hold = await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [f.seatIds[0]!] });
    await expect(cancelHold(t.deps, { buyerId: b.id, holdId: hold.id })).rejects.toMatchObject({ status: 404 });
    await cancelHold(t.deps, { buyerId: a.id, holdId: hold.id });
    expect(await heldCount(f.eventId)).toBe(0);
  });
});
