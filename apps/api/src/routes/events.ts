import { Hono } from 'hono';
import { asId, eventCreateSchema, eventUpdateSchema, reportRequestSchema, tiersSchema, type TenantId } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { requireTenantRole } from '../authz';
import { closeEvent, createEvent, listTenantEvents, loadTenantEvent, publishEvent, setTiers, updateEvent } from '../services/events';
import { requestReport } from '../services/documents';
import { validator } from '../validate';

const BASE = '/tenants/:tenantId/events';

export function eventRoutes() {
  const tenant = (c: { get(k: 'tenantId'): string }) => asId<'TenantId'>(c.get('tenantId')) as TenantId;
  return new Hono<Env>()
    .use(BASE, requireAuth)
    .use(`${BASE}/*`, requireAuth)
    .get(BASE, requireTenantRole('manager'), async (c) =>
      c.json({ events: await listTenantEvents(c.get('deps').db, tenant(c)) }))
    .post(BASE, requireTenantRole('manager'), validator('json', eventCreateSchema), async (c) =>
      c.json({ event: await createEvent(c.get('deps').db, tenant(c), c.req.valid('json')) }, 201))
    .get(`${BASE}/:eventId`, requireTenantRole('manager'), async (c) => {
      const db = c.get('deps').db;
      const event = await loadTenantEvent(db, tenant(c), c.req.param('eventId'));
      const tiers = await db.query.priceTiers.findMany({ where: (p, { eq }) => eq(p.eventId, event.id) });
      return c.json({ event, tiers: tiers.map((x) => ({ sectionId: x.sectionId, priceCents: x.priceCents })) });
    })
    .patch(`${BASE}/:eventId`, requireTenantRole('manager'), validator('json', eventUpdateSchema), async (c) =>
      c.json({ event: await updateEvent(c.get('deps').db, tenant(c), c.req.param('eventId'), c.req.valid('json')) }))
    .put(`${BASE}/:eventId/tiers`, requireTenantRole('manager'), validator('json', tiersSchema), async (c) =>
      c.json({ tiers: await setTiers(c.get('deps').db, tenant(c), c.req.param('eventId'), c.req.valid('json')) }))
    .post(`${BASE}/:eventId/publish`, requireTenantRole('manager'), async (c) => {
      const d = c.get('deps');
      await publishEvent(d.db, d.clock, tenant(c), c.req.param('eventId'));
      return c.json({ ok: true });
    })
    .post(`${BASE}/:eventId/reports`, requireTenantRole('manager'), validator('json', reportRequestSchema), async (c) => {
      const d = c.get('deps');
      const document = await requestReport(d, c.get('svc').documentQueue, {
        tenantId: tenant(c), eventId: c.req.param('eventId'), userId: c.get('user').id,
      });
      return c.json({ document }, 202);
    })
    .post(`${BASE}/:eventId/close`, requireTenantRole('manager'), async (c) => {
      await closeEvent(c.get('deps').db, tenant(c), c.req.param('eventId'));
      return c.json({ ok: true });
    });
}
