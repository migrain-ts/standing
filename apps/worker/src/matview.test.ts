import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertPaidOrder } from '@standing/db';
import { refreshDailySales } from './matview';
import { insertEventFixture, makeBuyer, makeWorkerDb } from './test-helpers';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
beforeAll(async () => {
  t = await makeWorkerDb();
});
afterAll(async () => {
  await t.close();
});

describe('refreshDailySales', () => {
  it('is empty until refreshed, then matches a raw group by, and refreshes concurrently with a reader', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 6, priceCents: 700 });
    const buyer = await makeBuyer(t.db, 'b');
    const sale = (ids: number[], at: string) =>
      insertPaidOrder(t.db, { eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: ids.map((n) => f.seatIds[n]!), at: new Date(at) });
    await sale([0, 1], '2026-01-03T10:00:00Z');
    await sale([2], '2026-01-03T22:00:00Z');
    await sale([3, 4, 5], '2026-01-04T09:00:00Z');

    const mv = () => t.db.execute(sql`select day::text as day, tickets, revenue_cents from daily_sales_mv where event_id = ${f.eventId}::uuid order by day`);
    expect((await mv()).rows).toHaveLength(0);
    await refreshDailySales(t.db);
    const raw = await t.db.execute(sql`
      select (date_trunc('day', o.created_at at time zone 'UTC'))::date::text as day, count(*)::int as tickets, sum(oi.price_cents)::bigint as revenue_cents
      from order_items oi join orders o on o.id = oi.order_id where oi.event_id = ${f.eventId}::uuid group by 1 order by 1`);
    const norm = (rows: Record<string, unknown>[]) => rows.map((r) => [r.day, Number(r.tickets), Number(r.revenue_cents)]);
    expect(norm((await mv()).rows)).toEqual(norm(raw.rows));
    expect(norm(raw.rows)).toEqual([['2026-01-03', 3, 2100], ['2026-01-04', 3, 2100]]);

    await expect(Promise.all([refreshDailySales(t.db), mv(), mv()])).resolves.toBeDefined();
  });
});
