import { sql } from 'drizzle-orm';
import { Hono } from 'hono';
import { scanSchema } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { scanTicket } from '../services/scan';
import { validator } from '../validate';

export function doorRoutes() {
  return new Hono<Env>()
    .post('/door/scan', requireAuth, validator('json', scanSchema), async (c) => {
      const d = c.get('deps');
      const body = c.req.valid('json');
      return c.json(await scanTicket(d, { userId: c.get('user').id, code: body.code, eventId: body.eventId }));
    })
    .get('/door/events', requireAuth, async (c) => {
      const d = c.get('deps');
      const now = d.clock.now();
      const res = await d.db.execute(sql`
        select e.id, e.name, e.starts_at, tn.name as tenant_name,
          (select count(*)::int from event_seats es where es.event_id = e.id and es.status = 'sold') as sold,
          (select count(*)::int from tickets t where t.event_id = e.id and t.scanned_at is not null) as scanned
        from memberships m
        join events e on e.tenant_id = m.tenant_id
        join tenants tn on tn.id = e.tenant_id
        where m.user_id = ${c.get('user').id}::uuid
          and e.status = 'published'
          and e.starts_at >= ${now}::timestamptz - interval '12 hours'
        order by e.starts_at, e.id
        limit 50`);
      return c.json({
        events: res.rows.map((r) => ({
          id: String(r.id),
          name: String(r.name),
          startsAt: new Date(r.starts_at as string).toISOString(),
          tenantName: String(r.tenant_name),
          sold: Number(r.sold),
          scanned: Number(r.scanned),
        })),
      });
    });
}
