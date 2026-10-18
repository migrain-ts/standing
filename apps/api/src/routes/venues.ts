import { Hono } from 'hono';
import { UUID_RE, venueCreateSchema } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { requireTenantRole } from '../authz';
import { ApiError } from '../errors';
import { createVenue, getVenue, listVenues } from '../services/venues';
import { validator } from '../validate';

export function venueRoutes() {
  return new Hono<Env>()
    .use('/tenants/:tenantId/venues', requireAuth)
    .use('/tenants/:tenantId/venues/*', requireAuth)
    .get('/tenants/:tenantId/venues', requireTenantRole('manager'), async (c) =>
      c.json({ venues: await listVenues(c.get('deps').db, c.get('tenantId')) }))
    .post('/tenants/:tenantId/venues', requireTenantRole('manager'), validator('json', venueCreateSchema), async (c) => {
      const venue = await createVenue(c.get('deps').db, { tenantId: c.get('tenantId'), ...c.req.valid('json') });
      return c.json({ venue }, 201);
    })
    .get('/tenants/:tenantId/venues/:venueId', requireTenantRole('manager'), async (c) => {
      const venueId = c.req.param('venueId');
      if (!UUID_RE.test(venueId)) throw new ApiError(404, 'not_found', 'Not found');
      return c.json({ venue: await getVenue(c.get('deps').db, c.get('tenantId'), venueId.toLowerCase()) });
    });
}
