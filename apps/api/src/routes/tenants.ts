import { Hono } from 'hono';
import { memberAddSchema, memberUpdateSchema, tenantCreateSchema } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { requireTenantRole } from '../authz';
import { addMember, changeRole, createTenant, listMembers, listMyTenants, removeMember } from '../services/tenants';
import { validator } from '../validate';

export function tenantRoutes() {
  return new Hono<Env>()
    .use('/tenants', requireAuth)
    .use('/tenants/*', requireAuth)
    .get('/tenants', async (c) => c.json({ tenants: await listMyTenants(c.get('deps').db, c.get('user').id) }))
    .post('/tenants', validator('json', tenantCreateSchema), async (c) => {
      const tenant = await createTenant(c.get('deps').db, { ownerId: c.get('user').id, name: c.req.valid('json').name });
      return c.json({ tenant }, 201);
    })
    .get('/tenants/:tenantId/members', requireTenantRole('manager'), async (c) =>
      c.json({ members: await listMembers(c.get('deps').db, c.get('tenantId')) }))
    .post('/tenants/:tenantId/members', requireTenantRole('owner'), validator('json', memberAddSchema), async (c) => {
      const { email, role } = c.req.valid('json');
      return c.json({ member: await addMember(c.get('deps').db, { tenantId: c.get('tenantId'), email, role }) }, 201);
    })
    .patch('/tenants/:tenantId/members/:userId', requireTenantRole('owner'), validator('json', memberUpdateSchema), async (c) => {
      const member = await changeRole(c.get('deps').db, {
        tenantId: c.get('tenantId'), userId: (c.req.param('userId') ?? '').toLowerCase(), role: c.req.valid('json').role,
      });
      return c.json({ member });
    })
    .delete('/tenants/:tenantId/members/:userId', requireTenantRole('owner'), async (c) => {
      await removeMember(c.get('deps').db, { tenantId: c.get('tenantId'), userId: (c.req.param('userId') ?? '').toLowerCase() });
      return c.body(null, 204);
    });
}
