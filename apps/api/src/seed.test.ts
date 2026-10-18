import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { call, makeApp, type TestApp } from './test-helpers';
import { seedDemo } from './seed';
import { oversold } from './services/live';
import { DEMO_USERS } from '@standing/shared';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ config: { demoLogin: true } });
}, 60_000);
afterAll(async () => {
  await t.close();
});

describe('seedDemo', () => {
  it('creates 3 tenants, 15 published and 2 draft events and a realistic amount of history', async () => {
    const res = await seedDemo(t.db, t.clock);
    expect(res).toMatchObject({ skipped: false, tenants: 3, events: 17 });
    expect(res.tickets).toBeGreaterThan(14_000);
    const published = await t.db.execute(sql`select count(*)::int as n from events where status = 'published'`);
    expect(Number(published.rows[0]?.n)).toBe(15);
  }, 120_000);

  it('is idempotent', async () => {
    expect(await seedDemo(t.db, t.clock)).toMatchObject({ skipped: true });
  });

  it('leaves every event consistent: oversold 0, rollups equal the raw recompute', async () => {
    const events = await t.db.execute(sql`select id from events where status = 'published'`);
    for (const e of events.rows) {
      const id = String(e.id);
      expect(await oversold(t.db, id), id).toBe(0);
      const projected = await t.db.execute(sql`select coalesce(sum(tickets),0)::int as n, coalesce(sum(revenue_cents),0)::bigint as r from sales_by_minute where event_id = ${id}::uuid`);
      const raw = await t.db.execute(sql`select count(*)::int as n, coalesce(sum(price_cents),0)::bigint as r from order_items where event_id = ${id}::uuid`);
      expect(projected.rows[0]).toMatchObject({ n: raw.rows[0]?.n });
      expect(String(projected.rows[0]?.r)).toBe(String(raw.rows[0]?.r));
    }
  });

  it('puts the hero event around half sold, the door event with scans, and a populated materialized view', async () => {
    const hero = await t.db.execute(sql`
      select count(*) filter (where es.status = 'sold')::float / count(*) as frac
      from event_seats es join events e on e.id = es.event_id where e.name = 'Aurora Night'`);
    expect(Number(hero.rows[0]?.frac)).toBeGreaterThan(0.45);
    expect(Number(hero.rows[0]?.frac)).toBeLessThan(0.55);
    const scanned = await t.db.execute(sql`
      select count(*) filter (where t.scanned_at is not null)::float / count(*) as frac
      from tickets t join events e on e.id = t.event_id where e.name = 'Late Night Laughs'`);
    expect(Number(scanned.rows[0]?.frac)).toBeGreaterThan(0.25);
    expect(Number(scanned.rows[0]?.frac)).toBeLessThan(0.35);
    const mv = await t.db.execute(sql`select count(*)::int as n from daily_sales_mv`);
    expect(Number(mv.rows[0]?.n)).toBeGreaterThan(100);
  });

  it('lets the three personas sign in with one click and gives them the right access', async () => {
    const organizer = await call(t.app, null, 'POST', '/auth/demo', { persona: 'organizer' });
    const cookie = organizer.headers.get('set-cookie')?.split(';')[0] ?? null;
    const mine = (await (await call(t.app, cookie, 'GET', '/tenants')).json()) as { tenants: { name: string; role: string }[] };
    expect(mine.tenants.map((x) => `${x.name}:${x.role}`).sort()).toEqual(['Blue Note Live:owner', 'Halcyon Arena:manager', 'Rue Cadet Comedy:owner']);
    const door = await call(t.app, null, 'POST', '/auth/demo', { persona: 'door' });
    const doorCookie = door.headers.get('set-cookie')?.split(';')[0] ?? null;
    const doorTenants = (await (await call(t.app, doorCookie, 'GET', '/tenants')).json()) as { tenants: { role: string }[] };
    expect(doorTenants.tenants.every((x) => x.role === 'door')).toBe(true);
    const login = await call(t.app, null, 'POST', '/auth/login', { email: DEMO_USERS.buyer, password: 'standing-demo-1' });
    expect(login.status).toBe(200);
    const orders = (await (await call(t.app, (await call(t.app, null, 'POST', '/auth/demo', { persona: 'buyer' })).headers.get('set-cookie')?.split(';')[0] ?? null, 'GET', '/me/orders')).json()) as { orders: unknown[] };
    expect(orders.orders.length).toBe(2);
  });
});
