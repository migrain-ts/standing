import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertEventFixture, insertPaidOrder, rebuildRollups } from '@standing/db';
import { makeTenantFixture } from '../fixtures';
import { call, makeApp, makeUser, type TestApp } from '../test-helpers';

type Overview = {
  days: { day: string; tickets: number; revenueCents: number }[];
  events: { id: string; name: string; startsAt: string; status: string; capacity: number; sold: number; revenueCents: number }[];
  totals: { tickets: number; revenueCents: number };
};
let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ noDocumentQueue: true }); // FakeClock: 2026-01-05T08:00:00Z
});
afterAll(async () => {
  await t.close();
});

describe('GET /tenants/:t/overview', () => {
  it('is manager-only', async () => {
    const f = await makeTenantFixture(t);
    const url = `/tenants/${f.tenantId}/overview`;
    expect((await call(t.app, null, 'GET', url)).status).toBe(401);
    expect((await call(t.app, f.outsider.cookie, 'GET', url)).status).toBe(404);
    expect((await call(t.app, f.door.cookie, 'GET', url)).status).toBe(403);
    expect((await call(t.app, f.manager.cookie, 'GET', url)).status).toBe(200);
  });

  it('returns a zero-filled 30-day series, totals equal to raw sums, events with rollups, and only this tenant', async () => {
    const f = await makeTenantFixture(t);
    const buyer = await makeUser(t, 'buyer');
    const sale = (ids: number[], at: string) =>
      insertPaidOrder(t.db, { eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer.id, seatIds: ids.map((n) => f.seatIds[n]!), at: new Date(at) });
    await sale([0, 1], '2026-01-03T10:00:00Z'); // 2 x 5000
    await sale([2], '2026-01-03T22:00:00Z');
    await sale([3], '2026-01-05T07:00:00Z');
    await sale([4], '2025-11-01T07:00:00Z'); // outside the 30-day window, still in totals
    const other = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 3, tenantName: 'Rival' });
    await insertPaidOrder(t.db, { eventId: other.eventId, tenantId: other.tenantId, buyerId: buyer.id, seatIds: other.seatIds, at: new Date('2026-01-03T10:00:00Z') });
    await rebuildRollups(t.db, f.eventId);
    await t.db.execute(sql`refresh materialized view daily_sales_mv`);

    const res = await call(t.app, f.owner.cookie, 'GET', `/tenants/${f.tenantId}/overview`);
    const body = (await res.json()) as Overview;
    expect(body.days).toHaveLength(30);
    expect(body.days[0]?.day).toBe('2025-12-07');
    expect(body.days[29]?.day).toBe('2026-01-05');
    const byDay = new Map(body.days.map((d) => [d.day, d]));
    expect(byDay.get('2026-01-03')).toEqual({ day: '2026-01-03', tickets: 3, revenueCents: 15000 });
    expect(byDay.get('2026-01-05')).toEqual({ day: '2026-01-05', tickets: 1, revenueCents: 5000 });
    expect(byDay.get('2026-01-04')).toEqual({ day: '2026-01-04', tickets: 0, revenueCents: 0 });

    const raw = await t.db.execute(sql`
      select count(*)::int as n, coalesce(sum(oi.price_cents), 0)::int as c from order_items oi join orders o on o.id = oi.order_id
      where o.tenant_id = ${f.tenantId}::uuid and o.status = 'paid'`);
    expect(body.totals).toEqual({ tickets: Number(raw.rows[0]?.n), revenueCents: Number(raw.rows[0]?.c) });
    expect(body.totals).toEqual({ tickets: 5, revenueCents: 25000 });

    expect(body.events.map((e) => e.id).sort()).toEqual([f.eventId, f.draftEventId].sort());
    expect(body.events.find((e) => e.id === f.eventId)).toMatchObject({ status: 'published', capacity: 20, sold: 5, revenueCents: 25000 });
    expect(body.events.find((e) => e.id === f.draftEventId)).toMatchObject({ status: 'draft', sold: 0, revenueCents: 0 });
  });
});
