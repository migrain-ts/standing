import { eq, sql } from 'drizzle-orm';
import { asId, generateLayout, type EventId, type SeatId, type SectionId, type TenantId, type UserId, type VenueId } from '@standing/shared';
import type { Db } from './client';
import * as s from './schema';

export const FIXTURE_NOW = new Date('2026-01-05T08:00:00Z');

export async function insertEvent(
  db: Db,
  o: {
    tenantId: string;
    venueId: string;
    sectionId: string;
    status: 'draft' | 'published';
    priceCents: number;
    name?: string;
    startsAt?: Date;
  },
): Promise<EventId> {
  const [event] = await db
    .insert(s.events)
    .values({
      tenantId: o.tenantId,
      venueId: o.venueId,
      name: o.name ?? 'Test event',
      startsAt: o.startsAt ?? new Date(FIXTURE_NOW.getTime() + 30 * 86_400_000),
      status: o.status,
    })
    .returning({ id: s.events.id });
  if (!event) throw new Error('event insert failed');
  await db.insert(s.priceTiers).values({ eventId: event.id, sectionId: o.sectionId, priceCents: o.priceCents });
  if (o.status === 'published') {
    await db.execute(sql`
      insert into event_seats (event_id, seat_id)
      select ${event.id}::uuid, id from seats where venue_id = ${o.venueId}::uuid`);
  }
  return asId<'EventId'>(event.id);
}

export async function insertEventFixture(
  db: Db,
  o: { rows?: number; seatsPerRow?: number; status?: 'draft' | 'published'; priceCents?: number; tenantName?: string } = {},
) {
  const { rows = 5, seatsPerRow = 10, status = 'published', priceCents = 5000, tenantName = 'Test Tenant' } = o;
  const tag = Math.random().toString(36).slice(2, 10);
  const [owner] = await db
    .insert(s.users)
    .values({ email: `owner-${tag}@example.com`, passwordHash: 'x', name: 'Owner' })
    .returning({ id: s.users.id });
  const [tenant] = await db.insert(s.tenants).values({ name: tenantName, slug: `tenant-${tag}` }).returning({ id: s.tenants.id });
  const [venue] = await db.insert(s.venues).values({ tenantId: tenant!.id, name: 'Main hall' }).returning({ id: s.venues.id });
  await db.insert(s.memberships).values({ tenantId: tenant!.id, userId: owner!.id, role: 'owner' });
  const [section] = await db
    .insert(s.sections)
    .values({ venueId: venue!.id, name: 'Floor', ord: 0, rows, seatsPerRow })
    .returning({ id: s.sections.id });
  const layout = generateLayout([{ name: 'Floor', rows, seatsPerRow }]);
  await db.insert(s.seats).values(
    layout.map((p) => ({
      venueId: venue!.id, sectionId: section!.id, idx: p.idx, rowLabel: p.rowLabel, number: p.number, x: p.x, y: p.y,
    })),
  );
  const eventId = await insertEvent(db, {
    tenantId: tenant!.id, venueId: venue!.id, sectionId: section!.id, status, priceCents,
  });
  const seatRows = await db.select({ id: s.seats.id }).from(s.seats).where(eq(s.seats.venueId, venue!.id)).orderBy(s.seats.idx);
  return {
    ownerId: asId<'UserId'>(owner!.id) as UserId,
    tenantId: asId<'TenantId'>(tenant!.id) as TenantId,
    venueId: asId<'VenueId'>(venue!.id) as VenueId,
    sectionId: asId<'SectionId'>(section!.id) as SectionId,
    eventId,
    seatIds: seatRows.map((r) => asId<'SeatId'>(r.id) as SeatId),
  };
}
