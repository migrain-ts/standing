import { Hono } from 'hono';
import { asId, rushSchema, type TenantId } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { requireTenantRole } from '../authz';
import { ApiError } from '../errors';
import { loadTenantEvent } from '../services/events';
import { rushStatus, startRush, stopRush } from '../services/rush';
import { validator } from '../validate';

const BASE = '/tenants/:tenantId/events/:eventId/rush';

export function rushRoutes() {
  const tenant = (c: { get(k: 'tenantId'): string }) => asId<'TenantId'>(c.get('tenantId')) as TenantId;
  return new Hono<Env>()
    .use(BASE, requireAuth)
    .post(BASE, requireTenantRole('manager'), validator('json', rushSchema), async (c) => {
      const deps = c.get('deps');
      const ev = await loadTenantEvent(deps.db, tenant(c), c.req.param('eventId'));
      if (ev.status !== 'published') throw new ApiError(409, 'not_published', 'Only a published event can receive a rush');
      return c.json({ run: await startRush(deps.config, ev.id, c.req.valid('json')) }, 202);
    })
    .get(BASE, requireTenantRole('manager'), async (c) => {
      const deps = c.get('deps');
      const ev = await loadTenantEvent(deps.db, tenant(c), c.req.param('eventId'));
      return c.json({ run: await rushStatus(deps.config, ev.id) });
    })
    .delete(BASE, requireTenantRole('manager'), async (c) => {
      const deps = c.get('deps');
      const ev = await loadTenantEvent(deps.db, tenant(c), c.req.param('eventId'));
      await stopRush(deps.config, ev.id);
      return c.body(null, 202);
    });
}
