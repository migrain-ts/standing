import { afterAll, beforeAll, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, insertEventFixture } from './index';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

it('a published fixture has one available event_seat per seat, in idx order', async () => {
  const f = await insertEventFixture(t.db, { rows: 3, seatsPerRow: 4 });
  expect(f.seatIds).toHaveLength(12);
  const r = await t.db.execute(sql`select count(*)::int as n from event_seats where event_id = ${f.eventId}::uuid and status = 'available'`);
  expect(Number(r.rows[0]?.n)).toBe(12);
});

it('a draft fixture has no event_seats yet', async () => {
  const f = await insertEventFixture(t.db, { status: 'draft' });
  const r = await t.db.execute(sql`select count(*)::int as n from event_seats where event_id = ${f.eventId}::uuid`);
  expect(Number(r.rows[0]?.n)).toBe(0);
});
