import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@standing/db';
import { UUID_RE, type Clock, type EventCreateInput, type EventUpdateInput, type TenantId, type TiersInput } from '@standing/shared';
import { ApiError } from '../errors';

const notFound = () => new ApiError(404, 'not_found', 'Not found');
const notDraft = () => new ApiError(409, 'not_draft', 'Only draft events can be changed');
const parseId = (id: string) => {
  if (!UUID_RE.test(id)) throw notFound();
  return id.toLowerCase();
};

export async function loadTenantEvent(db: Db | Tx, tenantId: TenantId, eventId: string) {
  const [ev] = await db
    .select()
    .from(schema.events)
    .where(and(eq(schema.events.id, parseId(eventId)), eq(schema.events.tenantId, tenantId)));
  if (!ev) throw notFound();
  return ev;
}

/** Locks the tenant's event row for the rest of the transaction; serializes concurrent state changes. */
async function lockEvent(tx: Tx, tenantId: TenantId, eventId: string) {
  const r = await tx.execute(sql`
    select id, venue_id, status, starts_at from events
    where id = ${parseId(eventId)}::uuid and tenant_id = ${tenantId}::uuid for update`);
  const ev = r.rows[0] as { id: string; venue_id: string; status: string; starts_at: Date } | undefined;
  if (!ev) throw notFound();
  return ev;
}

export async function createEvent(db: Db | Tx, tenantId: TenantId, input: EventCreateInput) {
  const venueId = parseId(input.venueId);
  const [venue] = await db
    .select({ id: schema.venues.id })
    .from(schema.venues)
    .where(and(eq(schema.venues.id, venueId), eq(schema.venues.tenantId, tenantId)));
  if (!venue) throw notFound();
  const [ev] = await db
    .insert(schema.events)
    .values({ tenantId, venueId, name: input.name, startsAt: input.startsAt, admissionLimit: input.admissionLimit })
    .returning();
  if (!ev) throw new Error('event insert failed');
  return ev;
}

export async function updateEvent(db: Db, tenantId: TenantId, eventId: string, input: EventUpdateInput) {
  return db.transaction(async (tx) => {
    const ev = await lockEvent(tx, tenantId, eventId);
    if (ev.status !== 'draft') throw notDraft();
    const patch = {
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.startsAt === undefined ? {} : { startsAt: input.startsAt }),
      ...(input.admissionLimit === undefined ? {} : { admissionLimit: input.admissionLimit }),
    };
    if (Object.keys(patch).length === 0) return loadTenantEvent(tx, tenantId, eventId);
    const [updated] = await tx.update(schema.events).set(patch).where(eq(schema.events.id, ev.id)).returning();
    if (!updated) throw notFound();
    return updated;
  });
}

export async function setTiers(db: Db | Tx, tenantId: TenantId, eventId: string, tiers: TiersInput) {
  return db.transaction(async (tx) => {
    const ev = await lockEvent(tx, tenantId, eventId);
    if (ev.status !== 'draft') throw notDraft();
    const own = await tx.select({ id: schema.sections.id }).from(schema.sections).where(eq(schema.sections.venueId, ev.venue_id));
    const ownIds = new Set(own.map((s) => s.id));
    const rows = tiers.map((x) => ({ eventId: ev.id, sectionId: x.sectionId.toLowerCase(), priceCents: x.priceCents }));
    if (rows.some((x) => !ownIds.has(x.sectionId))) {
      throw new ApiError(400, 'invalid_section', 'A price names a section that is not in the venue');
    }
    await tx.delete(schema.priceTiers).where(eq(schema.priceTiers.eventId, ev.id));
    await tx.insert(schema.priceTiers).values(rows);
    return rows.map((x) => ({ sectionId: x.sectionId, priceCents: x.priceCents }));
  });
}

export async function publishEvent(db: Db | Tx, clock: Clock, tenantId: TenantId, eventId: string) {
  return db.transaction(async (tx) => {
    const ev = await lockEvent(tx, tenantId, eventId);
    if (ev.status !== 'draft') throw new ApiError(409, 'not_draft', 'Only draft events can be published');
    if (new Date(ev.starts_at) <= clock.now()) throw new ApiError(409, 'in_the_past', 'The event date must be in the future');
    const missing = await tx.execute(sql`
      select s.name from sections s
      where s.venue_id = ${ev.venue_id}::uuid
        and not exists (select 1 from price_tiers p where p.event_id = ${ev.id}::uuid and p.section_id = s.id)`);
    if (missing.rows.length > 0) {
      throw new ApiError(409, 'missing_tiers', `No price for: ${missing.rows.map((r) => String(r.name)).join(', ')}`);
    }
    await tx.execute(sql`
      insert into event_seats (event_id, seat_id)
      select ${ev.id}::uuid, id from seats where venue_id = ${ev.venue_id}::uuid`);
    await tx.update(schema.events).set({ status: 'published' }).where(eq(schema.events.id, ev.id));
  });
}

export async function closeEvent(db: Db, tenantId: TenantId, eventId: string) {
  return db.transaction(async (tx) => {
    const ev = await lockEvent(tx, tenantId, eventId);
    if (ev.status !== 'published') throw new ApiError(409, 'not_published', 'Only published events can be closed');
    await tx.update(schema.events).set({ status: 'closed' }).where(eq(schema.events.id, ev.id));
  });
}

export async function listTenantEvents(db: Db, tenantId: TenantId) {
  const r = await db.execute(sql`
    select e.id, e.name, e.starts_at, e.status, v.name as venue_name,
      count(es.seat_id)::int as capacity,
      (count(es.seat_id) filter (where es.status = 'sold'))::int as sold
    from events e
    join venues v on v.id = e.venue_id
    left join event_seats es on es.event_id = e.id
    where e.tenant_id = ${tenantId}::uuid
    group by e.id, v.name
    order by e.starts_at desc`);
  return r.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    startsAt: new Date(x.starts_at as string | Date).toISOString(),
    status: String(x.status),
    venueName: String(x.venue_name),
    capacity: Number(x.capacity),
    sold: Number(x.sold),
  }));
}

const availableCount = (now: Date) => sql`
  (count(es.seat_id) filter (where es.status = 'available'
    or (es.status = 'held' and es.held_until < ${now}::timestamptz)))::int`;

export async function listPublicEvents(db: Db, clock: Clock) {
  const now = clock.now();
  const r = await db.execute(sql`
    select e.id, e.name, e.starts_at, t.name as tenant_name, v.name as venue_name,
      (select min(p.price_cents) from price_tiers p where p.event_id = e.id)::int as min_price,
      count(es.seat_id)::int as capacity, ${availableCount(now)} as available
    from events e
    join tenants t on t.id = e.tenant_id
    join venues v on v.id = e.venue_id
    left join event_seats es on es.event_id = e.id
    where e.status = 'published' and e.starts_at > ${now}::timestamptz
    group by e.id, t.name, v.name
    order by e.starts_at, e.id
    limit 50`);
  return r.rows.map((x) => ({
    id: String(x.id),
    name: String(x.name),
    startsAt: new Date(x.starts_at as string | Date).toISOString(),
    tenantName: String(x.tenant_name),
    venueName: String(x.venue_name),
    minPriceCents: Number(x.min_price),
    capacity: Number(x.capacity),
    available: Number(x.available),
  }));
}

/**
 * Light lookup for the hot buyer routes (availability, map, queue, holds): a published, upcoming event or 404, read
 * by primary key with no aggregate over event_seats. The detail page uses getPublicEvent.
 */
export async function lookupOnSaleEvent(db: Db, clock: Clock, eventId: string) {
  const r = await db.execute(sql`
    select id, venue_id, admission_limit from events
    where id = ${parseId(eventId)}::uuid and status = 'published' and starts_at > ${clock.now()}::timestamptz`);
  const x = r.rows[0];
  if (!x) throw notFound();
  return { id: String(x.id), venueId: String(x.venue_id), admissionLimit: Number(x.admission_limit) };
}

/** Resolves a published, upcoming event with its counts and sections or throws 404 (the event detail page). */
export async function getPublicEvent(db: Db, clock: Clock, eventId: string) {
  const now = clock.now();
  const id = parseId(eventId);
  const r = await db.execute(sql`
    select e.id, e.name, e.starts_at, e.admission_limit, e.venue_id, t.name as tenant_name, v.name as venue_name,
      count(es.seat_id)::int as capacity, ${availableCount(now)} as available
    from events e
    join tenants t on t.id = e.tenant_id
    join venues v on v.id = e.venue_id
    left join event_seats es on es.event_id = e.id
    where e.id = ${id}::uuid and e.status = 'published' and e.starts_at > ${now}::timestamptz
    group by e.id, t.name, v.name`);
  const x = r.rows[0];
  if (!x) throw notFound();
  const sec = await db.execute(sql`
    select s.id, s.name, s.ord, p.price_cents from sections s
    join price_tiers p on p.section_id = s.id and p.event_id = ${id}::uuid
    where s.venue_id = ${String(x.venue_id)}::uuid order by s.ord`);
  return {
    id: String(x.id),
    venueId: String(x.venue_id),
    name: String(x.name),
    startsAt: new Date(x.starts_at as string | Date).toISOString(),
    admissionLimit: Number(x.admission_limit),
    tenantName: String(x.tenant_name),
    venueName: String(x.venue_name),
    capacity: Number(x.capacity),
    available: Number(x.available),
    sections: sec.rows.map((s) => ({ id: String(s.id), name: String(s.name), ord: Number(s.ord), priceCents: Number(s.price_cents) })),
  };
}
