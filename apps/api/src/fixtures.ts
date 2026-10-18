import { inArray } from 'drizzle-orm';
import { insertEvent, insertEventFixture, schema } from '@standing/db';
import { makeUser, type TestApp } from './test-helpers';

export type TenantFixture = Awaited<ReturnType<typeof makeTenantFixture>>;

export async function makeTenantFixture(t: Pick<TestApp, 'db' | 'clock'>) {
  const base = await insertEventFixture(t.db, { rows: 4, seatsPerRow: 5, tenantName: 'Fixture Tenant' });
  const draftEventId = await insertEvent(t.db, {
    tenantId: base.tenantId, venueId: base.venueId, sectionId: base.sectionId, status: 'draft', priceCents: 5000, name: 'Draft event',
  });
  const other = await insertEventFixture(t.db, { rows: 2, seatsPerRow: 2, tenantName: 'Other Tenant' });
  const owner = await makeUser(t, 'owner');
  const manager = await makeUser(t, 'manager');
  const door = await makeUser(t, 'door');
  const outsider = await makeUser(t, 'outsider');
  // insertEventFixture adds its own owner; the named people below are the only members.
  await t.db.delete(schema.memberships).where(inArray(schema.memberships.tenantId, [base.tenantId, other.tenantId]));
  await t.db.insert(schema.memberships).values([
    { tenantId: base.tenantId, userId: owner.id, role: 'owner' },
    { tenantId: base.tenantId, userId: manager.id, role: 'manager' },
    { tenantId: base.tenantId, userId: door.id, role: 'door' },
    { tenantId: other.tenantId, userId: outsider.id, role: 'owner' },
  ]);
  return {
    tenantId: base.tenantId, venueId: base.venueId, sectionId: base.sectionId, eventId: base.eventId,
    draftEventId, seatIds: base.seatIds, owner, manager, door, outsider,
    outsiderTenantId: other.tenantId, outsiderEventId: other.eventId,
  };
}
