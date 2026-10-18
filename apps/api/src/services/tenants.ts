import { randomBytes } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db, type TenantRole } from '@standing/db';
import { ApiError } from '../errors';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const slugify = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export async function createTenant(db: Db, o: { ownerId: string; name: string }) {
  return db.transaction(async (tx) => {
    const [tenant] = await tx
      .insert(schema.tenants)
      .values({ name: o.name, slug: `${slugify(o.name) || 'tenant'}-${randomBytes(3).toString('hex')}` })
      .returning({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug });
    if (!tenant) throw new Error('tenant insert failed');
    await tx.insert(schema.memberships).values({ tenantId: tenant.id, userId: o.ownerId, role: 'owner' });
    return tenant;
  });
}

export const listMyTenants = (db: Db, userId: string) =>
  db
    .select({ id: schema.tenants.id, name: schema.tenants.name, slug: schema.tenants.slug, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.memberships.tenantId))
    .where(eq(schema.memberships.userId, userId))
    .orderBy(schema.tenants.name);

export const listMembers = (db: Db, tenantId: string) =>
  db
    .select({ userId: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.memberships.role })
    .from(schema.memberships)
    .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
    .where(eq(schema.memberships.tenantId, tenantId))
    .orderBy(schema.users.name);

export async function addMember(db: Db, o: { tenantId: string; email: string; role: TenantRole }) {
  const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, o.email));
  if (!user) throw new ApiError(404, 'user_not_found', 'No account with this email');
  const inserted = await db
    .insert(schema.memberships)
    .values({ tenantId: o.tenantId, userId: user.id, role: o.role })
    .onConflictDoNothing()
    .returning({ userId: schema.memberships.userId });
  if (inserted.length === 0) throw new ApiError(409, 'already_member', 'Already a member');
  return { userId: user.id, role: o.role };
}

/** Locks the tenant's membership rows so two concurrent changes cannot both remove the last owner. */
async function withOwnerGuard<T>(
  db: Db,
  tenantId: string,
  userId: string,
  change: (tx: Tx) => Promise<T>,
  leavesOwner: (current: TenantRole) => boolean,
) {
  return db.transaction(async (tx) => {
    const rows = await tx.execute(sql`select user_id, role from memberships where tenant_id = ${tenantId}::uuid for update`);
    const members = rows.rows as { user_id: string; role: TenantRole }[];
    const target = members.find((m) => m.user_id === userId);
    if (!target) throw new ApiError(404, 'not_found', 'Not found');
    const owners = members.filter((m) => m.role === 'owner').length;
    if (target.role === 'owner' && leavesOwner(target.role) && owners <= 1) {
      throw new ApiError(409, 'last_owner', 'A tenant must keep at least one owner');
    }
    return change(tx);
  });
}

export const changeRole = (db: Db, o: { tenantId: string; userId: string; role: TenantRole }) =>
  withOwnerGuard(
    db, o.tenantId, o.userId,
    async (tx) => {
      await tx.update(schema.memberships).set({ role: o.role })
        .where(and(eq(schema.memberships.tenantId, o.tenantId), eq(schema.memberships.userId, o.userId)));
      return { userId: o.userId, role: o.role };
    },
    () => o.role !== 'owner',
  );

export const removeMember = (db: Db, o: { tenantId: string; userId: string }) =>
  withOwnerGuard(
    db, o.tenantId, o.userId,
    async (tx) => {
      await tx.delete(schema.memberships)
        .where(and(eq(schema.memberships.tenantId, o.tenantId), eq(schema.memberships.userId, o.userId)));
    },
    () => true,
  );
