import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db } from '@standing/db';
import { asId, generateLayout, type VenueCreateInput, type VenueId } from '@standing/shared';
import { ApiError } from '../errors';

export type VenueMap = {
  sections: { id: string; name: string; ord: number }[];
  seats: [x: number, y: number, sectionOrd: number, row: string, number: number][];
  seatIds: string[];
  width: number;
  height: number;
};

const CHUNK = 2000;

export async function createVenue(
  db: Db,
  o: { tenantId: string } & VenueCreateInput,
): Promise<{ id: VenueId; name: string; seatCount: number }> {
  return db.transaction(async (tx) => {
    const [venue] = await tx
      .insert(schema.venues)
      .values({ tenantId: o.tenantId, name: o.name })
      .returning({ id: schema.venues.id, name: schema.venues.name });
    if (!venue) throw new Error('venue insert failed');
    const sectionRows = await tx
      .insert(schema.sections)
      .values(o.sections.map((s, ord) => ({ venueId: venue.id, name: s.name, ord, rows: s.rows, seatsPerRow: s.seatsPerRow })))
      .returning({ id: schema.sections.id, ord: schema.sections.ord });
    const idByOrd = new Map(sectionRows.map((r) => [r.ord, r.id]));
    const layout = generateLayout(o.sections);
    for (let i = 0; i < layout.length; i += CHUNK) {
      await tx.insert(schema.seats).values(
        layout.slice(i, i + CHUNK).map((p) => {
          const sectionId = idByOrd.get(p.sectionIndex);
          if (!sectionId) throw new Error('section missing');
          return { venueId: venue.id, sectionId, idx: p.idx, rowLabel: p.rowLabel, number: p.number, x: p.x, y: p.y };
        }),
      );
    }
    return { id: asId<'VenueId'>(venue.id), name: venue.name, seatCount: layout.length };
  });
}

export async function listVenues(db: Db, tenantId: string) {
  const r = await db.execute(sql`
    select v.id, v.name, count(s.id)::int as seat_count
    from venues v left join seats s on s.venue_id = v.id
    where v.tenant_id = ${tenantId}::uuid group by v.id order by v.name`);
  return r.rows.map((x) => ({ id: String(x.id), name: String(x.name), seatCount: Number(x.seat_count) }));
}

export async function getVenue(db: Db, tenantId: string, venueId: string) {
  const [venue] = await db
    .select()
    .from(schema.venues)
    .where(and(eq(schema.venues.id, venueId), eq(schema.venues.tenantId, tenantId)));
  if (!venue) throw new ApiError(404, 'not_found', 'Not found');
  const sections = await db.select().from(schema.sections).where(eq(schema.sections.venueId, venue.id)).orderBy(schema.sections.ord);
  return { id: venue.id, name: venue.name, sections };
}

export async function loadVenueMap(db: Db, venueId: string): Promise<VenueMap> {
  const sections = await db
    .select({ id: schema.sections.id, name: schema.sections.name, ord: schema.sections.ord })
    .from(schema.sections)
    .where(eq(schema.sections.venueId, venueId))
    .orderBy(schema.sections.ord);
  const ordById = new Map(sections.map((s) => [s.id, s.ord]));
  const rows = await db
    .select({ id: schema.seats.id, x: schema.seats.x, y: schema.seats.y, sectionId: schema.seats.sectionId, row: schema.seats.rowLabel, number: schema.seats.number })
    .from(schema.seats)
    .where(eq(schema.seats.venueId, venueId))
    .orderBy(schema.seats.idx);
  const seats = rows.map((r): VenueMap['seats'][number] => [r.x, r.y, ordById.get(r.sectionId) ?? 0, r.row, r.number]);
  return {
    sections,
    seats,
    seatIds: rows.map((r) => r.id),
    width: rows.reduce((m, r) => Math.max(m, r.x), 0) + 20,
    height: rows.reduce((m, r) => Math.max(m, r.y), 0) + 20,
  };
}
