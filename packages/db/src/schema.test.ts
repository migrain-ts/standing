import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { createTestDb, insertEventFixture, schema } from './index';

let t: Awaited<ReturnType<typeof createTestDb>>;
beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});

describe('schema', () => {
  it('migrates every table and the materialized view', async () => {
    const tables = await t.db.execute(sql`select table_name from information_schema.tables where table_schema = 'public'`);
    const names = tables.rows.map((r) => String(r.table_name));
    for (const n of ['users', 'sessions', 'tenants', 'memberships', 'venues', 'sections', 'seats', 'events', 'price_tiers',
      'holds', 'orders', 'order_items', 'event_seats', 'tickets', 'payments', 'outbox', 'sales_by_minute',
      'sales_by_section', 'documents']) expect(names, n).toContain(n);
    await expect(t.db.execute(sql`select * from daily_sales_mv`)).resolves.toBeTruthy();
  });

  it('rejects a held seat without a hold and a sold seat without an order', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    await expect(
      t.db.execute(sql`update event_seats set status = 'held' where event_id = ${f.eventId}::uuid and seat_id = ${f.seatIds[0]}::uuid`),
    ).rejects.toThrow();
    await expect(
      t.db.execute(sql`update event_seats set status = 'sold' where event_id = ${f.eventId}::uuid and seat_id = ${f.seatIds[0]}::uuid`),
    ).rejects.toThrow();
  });

  it('refuses to sell the same seat twice for one event', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 1 });
    const [buyer] = await t.db.insert(schema.users).values({ email: 'b@example.com', passwordHash: 'x', name: 'B' }).returning();
    const mkOrder = async () => {
      const [hold] = await t.db.insert(schema.holds).values({ buyerId: buyer!.id, eventId: f.eventId, seatCount: 1, expiresAt: new Date() }).returning();
      const [order] = await t.db.insert(schema.orders).values({ buyerId: buyer!.id, eventId: f.eventId, tenantId: f.tenantId, holdId: hold!.id, totalCents: 100 }).returning();
      return order!.id;
    };
    const item = (orderId: string) =>
      t.db.insert(schema.orderItems).values({ orderId, eventId: f.eventId, seatId: f.seatIds[0]!, sectionId: f.sectionId, priceCents: 100 });
    await item(await mkOrder());
    await expect(item(await mkOrder())).rejects.toThrow();
  });

  it('gives each test database its own data', async () => {
    const other = await createTestDb();
    const a = await t.db.execute(sql`select count(*)::int as n from tenants`);
    const b = await other.db.execute(sql`select count(*)::int as n from tenants`);
    expect(Number(b.rows[0]?.n)).toBe(0);
    expect(Number(a.rows[0]?.n)).toBeGreaterThan(0);
    await other.close();
  });
});
