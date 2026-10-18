// Local-only demo data. Every name is fictional; emails use example.com or the demo domain.
// The demo password (DEMO_PASSWORD) is a local-development convenience and must never be used anywhere real.
import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { rebuildRollups, schema, uuidList, type Db } from '@standing/db';
import { asId, DEMO_PASSWORD, DEMO_USERS, type Clock, type TenantId } from '@standing/shared';
import { hashPassword } from './auth/password';
import { createEvent, publishEvent, setTiers } from './services/events';
import { createVenue } from './services/venues';
import { EVENTS, FIRST_NAMES, LAST_NAMES, TENANTS, type EventData } from './seed-data';

export type SeedSummary = { skipped: boolean; tenants: number; events: number; orders: number; tickets: number };

const CHUNK = 1000;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 24 * HOUR;
const CUSTOMERS = 80;

/** Tiny seeded PRNG (mulberry32). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function seedFromString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
function shuffle<T>(arr: T[], rnd: () => number): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    const a = arr[i] as T;
    arr[i] = arr[j] as T;
    arr[j] = a;
  }
}
function* chunks<T>(arr: readonly T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) yield arr.slice(i, i + size);
}

type SeatInfo = { id: string; sectionId: string; row: string; number: number; priceCents: number };
type Run = SeatInfo[];

/** Splits each row into runs of 1 to 4 consecutive seats. */
function buildRuns(seats: readonly SeatInfo[], rnd: () => number): Run[] {
  const runs: Run[] = [];
  let current: Run = [];
  let target = 1;
  let rowKey = '';
  for (const s of seats) {
    const key = `${s.sectionId}:${s.row}`;
    if (key !== rowKey || current.length >= target) {
      if (current.length > 0) runs.push(current);
      current = [];
      target = 1 + Math.floor(rnd() * 4);
      rowKey = key;
    }
    current.push(s);
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

async function insertChunked<T extends Record<string, unknown>>(
  rows: readonly T[],
  insert: (batch: T[]) => Promise<unknown>,
): Promise<void> {
  for (const batch of chunks(rows, CHUNK)) await insert(batch);
}

type HistoryOrder = { orderId: string; holdId: string; buyerId: string; at: Date; seats: Run };

export async function seedDemo(db: Db, clock: Clock): Promise<SeedSummary> {
  const existing = await db.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, DEMO_USERS.organizer));
  if (existing.length > 0) return { skipped: true, tenants: 0, events: 0, orders: 0, tickets: 0 };
  const now = clock.now();

  // Users
  const demoHash = await hashPassword(DEMO_PASSWORD);
  const demoRows = await db
    .insert(schema.users)
    .values([
      { email: DEMO_USERS.organizer, passwordHash: demoHash, name: 'Olivia Organizer' },
      { email: DEMO_USERS.buyer, passwordHash: demoHash, name: 'Ben Buyer' },
      { email: DEMO_USERS.door, passwordHash: demoHash, name: 'Dana Door' },
    ])
    .returning({ id: schema.users.id, email: schema.users.email });
  const demoId = (email: string): string => {
    const u = demoRows.find((r) => r.email === email);
    if (!u) throw new Error(`demo user missing: ${email}`);
    return u.id;
  };
  const organizerId = demoId(DEMO_USERS.organizer);
  const buyerId = demoId(DEMO_USERS.buyer);
  const doorId = demoId(DEMO_USERS.door);

  const customerEmails = new Set<string>();
  const customerValues: { email: string; passwordHash: string; name: string }[] = [];
  for (let i = 0; customerValues.length < CUSTOMERS; i++) {
    const first = FIRST_NAMES[i % FIRST_NAMES.length] as string;
    const last = LAST_NAMES[((i % FIRST_NAMES.length) * 3 + Math.floor(i / FIRST_NAMES.length)) % LAST_NAMES.length] as string;
    const email = `${first}.${last}@example.com`.toLowerCase();
    if (customerEmails.has(email)) continue;
    customerEmails.add(email);
    customerValues.push({ email, passwordHash: '!', name: `${first} ${last}` });
  }
  const customers = await db.insert(schema.users).values(customerValues).returning({ id: schema.users.id });
  const customerIds = customers.map((c) => c.id);

  // Tenants, memberships, venues (production createVenue path)
  const tenantByName = new Map<string, { id: TenantId; venueId: string; sections: { id: string; ord: number }[] }>();
  const roles: Record<string, { organizer: 'owner' | 'manager'; door: boolean }> = {
    'Blue Note Live': { organizer: 'owner', door: true },
    'Halcyon Arena': { organizer: 'manager', door: false },
    'Rue Cadet Comedy': { organizer: 'owner', door: true },
  };
  for (const t of TENANTS) {
    const [tenant] = await db.insert(schema.tenants).values({ name: t.name, slug: t.slug }).returning({ id: schema.tenants.id });
    if (!tenant) throw new Error('tenant insert failed');
    const role = roles[t.name];
    if (!role) throw new Error(`no roles for ${t.name}`);
    await db.insert(schema.memberships).values([
      { tenantId: tenant.id, userId: organizerId, role: role.organizer },
      ...(role.door ? [{ tenantId: tenant.id, userId: doorId, role: 'door' as const }] : []),
    ]);
    const venue = await createVenue(db, {
      tenantId: tenant.id,
      name: t.venue,
      sections: t.sections.map((s) => ({ name: s.name, rows: s.rows, seatsPerRow: s.seatsPerRow })),
    });
    const secs = await db.select({ id: schema.sections.id, ord: schema.sections.ord }).from(schema.sections).where(eq(schema.sections.venueId, venue.id));
    tenantByName.set(t.name, { id: asId<'TenantId'>(tenant.id), venueId: venue.id, sections: secs });
  }

  let orderCount = 0;
  let ticketCount = 0;
  const publishedIds: { eventId: string; ev: EventData; tenantId: string }[] = [];

  for (const ev of EVENTS) {
    const tenant = tenantByName.get(ev.tenant);
    const tenantData = TENANTS.find((t) => t.name === ev.tenant);
    if (!tenant || !tenantData) throw new Error(`unknown tenant ${ev.tenant}`);
    const created = await createEvent(db, tenant.id, {
      venueId: tenant.venueId,
      name: ev.name,
      startsAt: new Date(now.getTime() + ev.startsInHours * HOUR),
      admissionLimit: 200,
    });
    await setTiers(
      db,
      tenant.id,
      created.id,
      tenant.sections.map((s) => ({ sectionId: s.id, priceCents: tenantData.sections[s.ord]?.priceCents ?? 0 })),
    );
    if (ev.status === 'published') {
      await publishEvent(db, clock, tenant.id, created.id);
      publishedIds.push({ eventId: created.id, ev, tenantId: tenant.id });
    }
  }

  // History
  for (const { eventId, ev, tenantId } of publishedIds) {
    const tenant = tenantByName.get(ev.tenant);
    const tenantData = TENANTS.find((t) => t.name === ev.tenant);
    if (!tenant || !tenantData) throw new Error(`unknown tenant ${ev.tenant}`);
    const priceBySection = new Map(tenant.sections.map((s) => [s.id, tenantData.sections[s.ord]?.priceCents ?? 0]));
    const seatRows = await db
      .select({ id: schema.seats.id, sectionId: schema.seats.sectionId, row: schema.seats.rowLabel, number: schema.seats.number })
      .from(schema.seats)
      .where(eq(schema.seats.venueId, tenant.venueId))
      .orderBy(schema.seats.idx);
    const seats: SeatInfo[] = seatRows.map((r) => ({ ...r, priceCents: priceBySection.get(r.sectionId) ?? 0 }));

    const rnd = mulberry32(seedFromString(ev.name));
    const runs = buildRuns(seats, rnd);
    shuffle(runs, rnd);
    const target = Math.round(seats.length * ev.soldFraction);
    const picked: Run[] = [];
    let total = 0;
    for (const run of runs) {
      if (total >= target) break;
      const take = run.slice(0, target - total);
      picked.push(take);
      total += take.length;
    }

    const buyerRuns = ev.name === 'Skyline Tour: Hollow Pines' || ev.name === 'Velvet Sessions' ? 1 : 0;
    const recent = ev.recentOrders ?? 0;
    const orders: HistoryOrder[] = picked.map((run, i) => {
      // Orders at the front of the list are the recent burst (recent) or the buyer's (buyerRuns); never both.
      const isRecent = i >= buyerRuns && i < buyerRuns + recent;
      const age = isRecent ? 10 * MINUTE + rnd() * 45 * MINUTE : Math.max(10 * MINUTE, 30 * DAY * rnd() ** 1.8);
      const buyer = i < buyerRuns ? buyerId : (customerIds[Math.floor(rnd() * customerIds.length)] ?? buyerId);
      return { orderId: randomUUID(), holdId: randomUUID(), buyerId: buyer, at: new Date(now.getTime() - age), seats: run };
    });

    await insertChunked(orders, (batch) =>
      db.insert(schema.holds).values(
        batch.map((o) => ({ id: o.holdId, buyerId: o.buyerId, eventId, seatCount: o.seats.length, status: 'paid' as const, expiresAt: o.at, createdAt: o.at })),
      ),
    );
    await insertChunked(orders, (batch) =>
      db.insert(schema.orders).values(
        batch.map((o) => ({
          id: o.orderId, buyerId: o.buyerId, eventId, tenantId, holdId: o.holdId, status: 'paid' as const, createdAt: o.at,
          totalCents: o.seats.reduce((n, s) => n + s.priceCents, 0),
        })),
      ),
    );
    const items = orders.flatMap((o) => o.seats.map((s) => ({ id: randomUUID(), orderId: o.orderId, seatId: s.id, sectionId: s.sectionId, priceCents: s.priceCents })));
    await insertChunked(items, (batch) => db.insert(schema.orderItems).values(batch.map((i) => ({ ...i, eventId }))));
    await insertChunked(items, (batch) =>
      db.insert(schema.tickets).values(batch.map((i) => ({ orderItemId: i.id, orderId: i.orderId, eventId, seatId: i.seatId }))),
    );
    const flips = orders.flatMap((o) => o.seats.map((s) => ({ seatId: s.id, orderId: o.orderId, holdId: o.holdId })));
    for (const batch of chunks(flips, CHUNK)) {
      await db.execute(sql`
        update event_seats es set status = 'sold', order_id = v.order_id, hold_id = v.hold_id, held_until = null
        from unnest(${uuidList(batch.map((f) => f.seatId))}, ${uuidList(batch.map((f) => f.orderId))}, ${uuidList(batch.map((f) => f.holdId))}) as v(seat_id, order_id, hold_id)
        where es.event_id = ${eventId}::uuid and es.seat_id = v.seat_id`);
    }
    await rebuildRollups(db, eventId);
    orderCount += orders.length;
    ticketCount += items.length;

    if (ev.scannedFraction !== undefined) {
      const n = Math.round(items.length * ev.scannedFraction);
      await db.execute(sql`
        update tickets set scanned_at = ${now}::timestamptz - (random() * interval '30 minutes'), scanned_by = ${doorId}::uuid
        where id in (select id from tickets where event_id = ${eventId}::uuid order by random() limit ${n})`);
    }
  }

  await db.execute(sql`refresh materialized view daily_sales_mv`);
  return { skipped: false, tenants: tenantByName.size, events: EVENTS.length, orders: orderCount, tickets: ticketCount };
}
