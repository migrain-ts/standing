import { and, eq } from 'drizzle-orm';
import type { Context, MiddlewareHandler } from 'hono';
import { schema, type TenantRole } from '@standing/db';
import { UUID_RE, type TenantRoleName } from '@standing/shared';
import type { Env } from './app';
import { ApiError } from './errors';

const ORDER: Record<TenantRole, number> = { door: 1, manager: 2, owner: 3 };

export type Resolver = (c: Context<Env>) => string | null;
export const fromParam = (name = 'tenantId'): Resolver => (c) => c.req.param(name) ?? null;

/** The only authorization point for /tenants/:tenantId/*. Non-members get 404, too-low roles 403. */
export function requireTenantRole(min: TenantRole, resolve: Resolver = fromParam()): MiddlewareHandler<Env> {
  return async (c, next) => {
    const resolved = resolve(c);
    if (!resolved || !UUID_RE.test(resolved)) throw new ApiError(404, 'not_found', 'Not found');
    const tenantId = resolved.toLowerCase();
    const [m] = await c
      .get('deps')
      .db.select({ role: schema.memberships.role })
      .from(schema.memberships)
      .where(and(eq(schema.memberships.tenantId, tenantId), eq(schema.memberships.userId, c.get('user').id)));
    if (!m) throw new ApiError(404, 'not_found', 'Not found');
    if (ORDER[m.role] < ORDER[min]) throw new ApiError(403, 'forbidden', 'Insufficient role');
    c.set('tenantRole', m.role);
    c.set('tenantId', tenantId);
    await next();
  };
}

/** Type-level guard: the shared role names must stay equal to the database enum. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
export const _rolesMatch: Same<TenantRole, TenantRoleName> = true;
