import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { asId, generateLayout, type EventId, type SeatId, type SectionId, type TenantId, type UserId, type VenueId } from '@standing/shared';
import type { Db, Tx } from './client';
import * as s from './schema';
import { uuidList } from './sql';

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

export async function insertPaidOrder(
  db: Db,
  o: { eventId: string; tenantId: string; buyerId: string; seatIds: readonly string[]; at: Date; withOutbox?: boolean },
): Promise<{ orderId: string; ticketIds: string[] }> {
  return db.transaction(async (tx) => {
    const [hold] = await tx
      .insert(s.holds)
      .values({ buyerId: o.buyerId, eventId: o.eventId, seatCount: o.seatIds.length, status: 'paid', expiresAt: o.at, createdAt: o.at })
      .returning({ id: s.holds.id });
    const priced = await tx.execute(sql`
      select st.id as seat_id, st.section_id, st.idx, pt.price_cents
      from seats st join price_tiers pt on pt.section_id = st.section_id and pt.event_id = ${o.eventId}::uuid
      where st.id = any(${uuidList(o.seatIds)}) order by st.idx`);
    const total = priced.rows.reduce((n, r) => n + Number(r.price_cents), 0);
    const orderId = randomUUID();
    await tx.insert(s.orders).values({
      id: orderId, buyerId: o.buyerId, eventId: o.eventId, tenantId: o.tenantId, holdId: hold!.id, totalCents: total, createdAt: o.at,
    });
    await tx.insert(s.orderItems).values(
      priced.rows.map((r) => ({ orderId, eventId: o.eventId, seatId: String(r.seat_id), sectionId: String(r.section_id), priceCents: Number(r.price_cents) })),
    );
    await tx.execute(sql`
      insert into tickets (order_item_id, order_id, event_id, seat_id)
      select id, order_id, event_id, seat_id from order_items where order_id = ${orderId}::uuid`);
    const sold = await tx.execute(sql`
      update event_seats set status = 'sold', order_id = ${orderId}::uuid, hold_id = ${hold!.id}::uuid, held_until = null
      where event_id = ${o.eventId}::uuid and seat_id = any(${uuidList(o.seatIds)}) and status = 'available' returning seat_id`);
    if (sold.rows.length !== o.seatIds.length) throw new Error('insertPaidOrder: some seats were not available');
    if (o.withOutbox !== false) {
      await tx.insert(s.outbox).values({
        kind: 'ticket.sold', tenantId: o.tenantId, eventId: o.eventId, dedupeKey: `ticket.sold:${orderId}`, createdAt: o.at,
        payload: {
          orderId, at: o.at.toISOString(), revenueCents: total,
          seats: priced.rows.map((r) => ({ seatId: String(r.seat_id), idx: Number(r.idx), sectionId: String(r.section_id), priceCents: Number(r.price_cents) })),
        },
      });
    }
    const t = await tx.execute(sql`select id from tickets where order_id = ${orderId}::uuid`);
    return { orderId, ticketIds: t.rows.map((r) => String(r.id)) };
  });
}

/** Independent recompute of the rollups from orders and order items. */
export async function rebuildRollups(db: Db | Tx, eventId: string): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.execute(sql`delete from sales_by_minute where event_id = ${eventId}::uuid`);
    await tx.execute(sql`delete from sales_by_section where event_id = ${eventId}::uuid`);
    await tx.execute(sql`
      insert into sales_by_minute (event_id, bucket, tickets, revenue_cents)
      select oi.event_id, date_trunc('minute', o.created_at), count(*)::int, sum(oi.price_cents)
      from order_items oi join orders o on o.id = oi.order_id
      where oi.event_id = ${eventId}::uuid and o.status = 'paid' group by 1, 2`);
    await tx.execute(sql`
      insert into sales_by_section (event_id, section_id, tickets, revenue_cents)
      select oi.event_id, oi.section_id, count(*)::int, sum(oi.price_cents)
      from order_items oi join orders o on o.id = oi.order_id
      where oi.event_id = ${eventId}::uuid and o.status = 'paid' group by 1, 2`);
  });
}
