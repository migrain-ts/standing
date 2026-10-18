import { Hono } from 'hono';
import { sql } from 'drizzle-orm';
import { asId, type TenantId } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { requireTenantRole } from '../authz';

const BASE = '/tenants/:tenantId/overview';

export function overviewRoutes() {
  const tenant = (c: { get(k: 'tenantId'): string }) => asId<'TenantId'>(c.get('tenantId')) as TenantId;
  return new Hono<Env>()
    .use(BASE, requireAuth)
    .get(BASE, requireTenantRole('manager'), async (c) => {
      const { db, clock } = c.get('deps');
      const tenantId = tenant(c);
      const now = clock.now();
      const days = await db.execute(sql`
        select to_char(d, 'YYYY-MM-DD') as day, coalesce(m.tickets, 0) as tickets, coalesce(m.revenue_cents, 0) as revenue_cents
        from generate_series(((${now}::timestamptz at time zone 'UTC')::date - 29), (${now}::timestamptz at time zone 'UTC')::date, interval '1 day') as g(d)
        left join (
          select day, sum(tickets) as tickets, sum(revenue_cents) as revenue_cents
          from daily_sales_mv where tenant_id = ${tenantId}::uuid group by day
        ) m on m.day = g.d::date
        order by d`);
      const totals = await db.execute(sql`
        select coalesce(sum(tickets), 0) as tickets, coalesce(sum(revenue_cents), 0) as revenue_cents
        from daily_sales_mv where tenant_id = ${tenantId}::uuid`);
      const events = await db.execute(sql`
        select e.id, e.name, e.starts_at, e.status,
               (select count(*) from seats s where s.venue_id = e.venue_id) as capacity,
               coalesce(r.tickets, 0) as sold, coalesce(r.revenue_cents, 0) as revenue_cents
        from events e
        left join (select event_id, sum(tickets) as tickets, sum(revenue_cents) as revenue_cents from sales_by_section group by event_id) r
          on r.event_id = e.id
        where e.tenant_id = ${tenantId}::uuid
        order by e.starts_at, e.id`);
      const t = totals.rows[0];
      return c.json({
        days: days.rows.map((r) => ({ day: String(r.day), tickets: Number(r.tickets), revenueCents: Number(r.revenue_cents) })),
        events: events.rows.map((r) => ({
          id: String(r.id), name: String(r.name), startsAt: new Date(String(r.starts_at)).toISOString(), status: String(r.status),
          capacity: Number(r.capacity), sold: Number(r.sold), revenueCents: Number(r.revenue_cents),
        })),
        totals: { tickets: Number(t?.tickets ?? 0), revenueCents: Number(t?.revenue_cents ?? 0) },
      });
    });
}
