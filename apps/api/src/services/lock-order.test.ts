import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertEventFixture } from '@standing/db';
import { releaseExpiredHolds } from '@standing/worker';
import { ApiError } from '../errors';
import { makeApp, makeUser, type TestApp } from '../test-helpers';
import { cancelHold, createHold } from './holds';
import { payHold } from './payments';

// Lock-order rule: every path that touches a hold and its seats locks the hold row first, then the seats; the cleanup
// never waits (SKIP LOCKED). These tests overlap the paths for real and fail with a 40P01 deadlock when the rule breaks.

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

/** A rejection is fine only when it is a deliberate ApiError; a driver error (40P01 deadlock) fails the test. */
function expectOnlyApiErrors(results: PromiseSettledResult<unknown>[]) {
  const unexpected = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .filter((r) => !(r.reason instanceof ApiError))
    .map((r) => {
      const e = r.reason as { name?: string; cause?: { code?: string } };
      return `${e.name ?? 'Error'} ${e.cause?.code ?? ''}`;
    });
  expect(unexpected).toEqual([]);
}

async function expectConsistent(eventId: string) {
  const partial = await t.db.execute(sql`
    select h.id from holds h join event_seats es on es.hold_id = h.id and es.status = 'held'
    where h.event_id = ${eventId}::uuid and h.status = 'active'
    group by h.id, h.seat_count having count(*) <> h.seat_count`);
  expect(partial.rows).toEqual([]);
  const orphan = await t.db.execute(sql`
    select es.seat_id from event_seats es left join holds h on h.id = es.hold_id and h.status = 'active'
    where es.event_id = ${eventId}::uuid and es.status = 'held' and h.id is null`);
  expect(orphan.rows).toEqual([]);
  const sold = await t.db.execute(sql`
    select count(*)::int as n from event_seats es left join order_items oi on oi.event_id = es.event_id and oi.seat_id = es.seat_id
    where es.event_id = ${eventId}::uuid and es.status = 'sold' and oi.id is null`);
  expect(Number(sold.rows[0]?.n)).toBe(0);
}

const BUYERS = 4;
const ROUNDS = 100;

describe('lock order: hold row first, then seats', () => {
  it('cancelHold racing a replacing createHold of the same buyer never deadlocks', { timeout: 120_000 }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const f = await insertEventFixture(t.db, { rows: 2, seatsPerRow: BUYERS * 4 });
      const buyers = await Promise.all(Array.from({ length: BUYERS }, (_, i) => makeUser(t, `cc${round}-${i}`)));
      const holds = await Promise.all(
        buyers.map((b, i) => createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: f.seatIds.slice(i * 8, i * 8 + 4) })),
      );
      const results = await Promise.allSettled(
        buyers.flatMap((b, i) => [
          cancelHold(t.deps, { buyerId: b.id, holdId: holds[i]!.id }),
          createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: f.seatIds.slice(i * 8 + 4, i * 8 + 8) }),
        ]),
      );
      expectOnlyApiErrors(results);
      await expectConsistent(f.eventId);
    }
  });

  it('payHold racing a replacing createHold of the same buyer never deadlocks', { timeout: 120_000 }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const f = await insertEventFixture(t.db, { rows: 2, seatsPerRow: BUYERS * 4 });
      const buyers = await Promise.all(Array.from({ length: BUYERS }, (_, i) => makeUser(t, `pc${round}-${i}`)));
      const holds = await Promise.all(
        buyers.map((b, i) => createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: f.seatIds.slice(i * 8, i * 8 + 4) })),
      );
      const results = await Promise.allSettled(
        buyers.flatMap((b, i) => [
          payHold(t.deps, { buyerId: b.id, holdId: holds[i]!.id, idempotencyKey: `k${round}-${i}` }),
          createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: f.seatIds.slice(i * 8 + 4, i * 8 + 8) }),
        ]),
      );
      expectOnlyApiErrors(results);
      await expectConsistent(f.eventId);
    }
  });

  it('the cleanup racing cancelHold on expired, not yet cleaned holds never deadlocks', { timeout: 120_000 }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const f = await insertEventFixture(t.db, { rows: 2, seatsPerRow: BUYERS * 4 });
      const buyers = await Promise.all(Array.from({ length: BUYERS }, (_, i) => makeUser(t, `xc${round}-${i}`)));
      const holds = await Promise.all(
        buyers.map((b, i) => createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: f.seatIds.slice(i * 8, i * 8 + 8) })),
      );
      t.clock.advanceMs(600_001);
      try {
        const results = await Promise.allSettled([
          releaseExpiredHolds(t.db, t.clock),
          ...buyers.map((b, i) => cancelHold(t.deps, { buyerId: b.id, holdId: holds[i]!.id })),
          releaseExpiredHolds(t.db, t.clock),
        ]);
        expectOnlyApiErrors(results);
      } finally {
        t.clock.advanceMs(-600_001);
      }
      await expectConsistent(f.eventId);
    }
  });

  it('the cleanup racing the release inside a replacing createHold over the same expired seats never deadlocks', { timeout: 120_000 }, async () => {
    for (let round = 0; round < ROUNDS; round++) {
      const f = await insertEventFixture(t.db, { rows: 4, seatsPerRow: BUYERS * 4 });
      const buyers = await Promise.all(Array.from({ length: BUYERS }, (_, i) => makeUser(t, `xr${round}-${i}`)));
      // Seats interleaved across buyers and claimed in reverse, so heap order and seat id order differ.
      await Promise.all(
        buyers.map((b, i) =>
          createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: f.seatIds.filter((_, s) => s < 32 && s % BUYERS === i).reverse() }),
        ),
      );
      t.clock.advanceMs(600_001);
      try {
        const results = await Promise.allSettled([
          releaseExpiredHolds(t.db, t.clock),
          ...buyers.map((b, i) => createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [f.seatIds[32 + i]!] })),
          releaseExpiredHolds(t.db, t.clock),
        ]);
        expectOnlyApiErrors(results);
      } finally {
        t.clock.advanceMs(-600_001);
      }
      await expectConsistent(f.eventId);
    }
  });
});
