import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { asId, type TenantId } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { requireTenantRole } from '../authz';
import { loadTenantEvent } from '../services/events';
import { loadSnapshot } from '../services/live';

const BASE = '/tenants/:tenantId/events/:eventId/live';

export function liveRoutes() {
  const tenant = (c: { get(k: 'tenantId'): string }) => asId<'TenantId'>(c.get('tenantId')) as TenantId;
  return new Hono<Env>()
    .use(BASE, requireAuth)
    .use(`${BASE}/*`, requireAuth)
    .get(`${BASE}/snapshot`, requireTenantRole('manager'), async (c) => {
      const svc = c.get('svc');
      const ev = await loadTenantEvent(c.get('deps').db, tenant(c), c.req.param('eventId'));
      return c.json(await loadSnapshot(c.get('deps'), tenant(c), ev.id, await svc.totals.get(ev.id)));
    })
    .get(BASE, requireTenantRole('manager'), async (c) => {
      const deps = c.get('deps');
      const svc = c.get('svc');
      const ev = await loadTenantEvent(deps.db, tenant(c), c.req.param('eventId'));
      const tickMs = deps.liveTickMs ?? 1000;
      c.header('Cache-Control', 'no-cache');
      return streamSSE(c, async (stream) => {
        await stream.write('retry: 2000\n\n');
        const off = svc.liveBus.subscribe(ev.id, (d) => {
          stream.writeSSE({ event: 'delta', data: JSON.stringify(d) }).catch(() => undefined);
        });
        stream.onAbort(off);
        try {
          while (!stream.aborted) {
            const totals = await svc.totals.get(ev.id);
            await stream.writeSSE({ event: 'tick', data: JSON.stringify({ totals, at: deps.clock.now().toISOString() }) });
            await stream.sleep(tickMs);
          }
        } finally {
          off();
        }
      });
    });
}
