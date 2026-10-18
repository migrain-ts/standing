import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { schema, uuidList, type Tx } from '@standing/db';
import { asId, UUID_RE, type EventId, type HoldId, type SeatId, type SectionId } from '@standing/shared';
import type { Deps } from '../app';
import { ApiError } from '../errors';

export type HoldView = {
  id: HoldId;
  eventId: EventId;
  expiresAt: string;
  totalCents: number;
  seats: { seatId: SeatId; idx: number; sectionId: SectionId; priceCents: number }[];
};

const notFound = () => new ApiError(404, 'not_found', 'Not found');

/**
 * The only place a seat becomes `held`. Candidate rows are locked with SKIP LOCKED so a request never waits behind
 * another buyer; a seat is claimable when available or when its hold has expired (lazy expiry). Returns the seat ids
 * actually claimed. The caller decides whether a short claim is acceptable and rolls back the transaction if not.
 */
export async function claimSeats(
  tx: Tx,
  o: { eventId: EventId; holdId: HoldId; seatIds: readonly SeatId[]; now: Date; expiresAt: Date },
): Promise<string[]> {
  const r = await tx.execute(sql`
    with c as (
      select seat_id from event_seats
      where event_id = ${o.eventId}::uuid
        and seat_id = any(${uuidList(o.seatIds)})
        and (status = 'available' or (status = 'held' and held_until < ${o.now}::timestamptz))
      order by seat_id
      for update skip locked
    )
    update event_seats e
    set status = 'held', hold_id = ${o.holdId}::uuid, held_until = ${o.expiresAt}::timestamptz
    from c
    where e.event_id = ${o.eventId}::uuid and e.seat_id = c.seat_id
    returning e.seat_id`);
  return r.rows.map((x) => String(x.seat_id));
}

async function viewOf(tx: Tx, holdId: string): Promise<HoldView> {
  const [hold] = await tx.select().from(schema.holds).where(eq(schema.holds.id, holdId));
  if (!hold) throw notFound();
  const r = await tx.execute(sql`
    select es.seat_id, s.idx, s.section_id, pt.price_cents
    from event_seats es
    join seats s on s.id = es.seat_id
    join price_tiers pt on pt.event_id = es.event_id and pt.section_id = s.section_id
    where es.hold_id = ${holdId}::uuid and es.status = 'held'
    order by s.idx`);
  const seats = r.rows.map((x) => ({
    seatId: asId<'SeatId'>(String(x.seat_id)),
    idx: Number(x.idx),
    sectionId: asId<'SectionId'>(String(x.section_id)),
    priceCents: Number(x.price_cents),
  }));
  return {
    id: asId<'HoldId'>(hold.id),
    eventId: asId<'EventId'>(hold.eventId),
    expiresAt: hold.expiresAt.toISOString(),
    totalCents: seats.reduce((n, s) => n + s.priceCents, 0),
    seats,
  };
}

export async function createHold(
  deps: Pick<Deps, 'db' | 'clock' | 'config'>,
  o: { buyerId: string; eventId: string; seatIds: readonly string[] },
): Promise<HoldView> {
  const now = deps.clock.now();
  const expiresAt = new Date(now.getTime() + deps.config.holdTtlSeconds * 1000);
  const seatIds = o.seatIds.map((s) => asId<'SeatId'>(s.toLowerCase()));
  const eventId = asId<'EventId'>(o.eventId.toLowerCase());
  return deps.db.transaction(async (tx) => {
    // One reservation at a time per buyer and event. Never wait: a second concurrent request is told to retry.
    const lock = await tx.execute(
      sql`select pg_try_advisory_xact_lock(hashtextextended(${`${o.buyerId}:${eventId}`}, 0)) as ok`,
    );
    if (lock.rows[0]?.ok !== true) {
      throw new ApiError(409, 'hold_in_progress', 'Another reservation request is in progress, try again');
    }
    const [event] = await tx.select({ status: schema.events.status }).from(schema.events).where(eq(schema.events.id, eventId));
    if (!event || event.status !== 'published') throw notFound();

    // Lock order rule (shared with cancelHold and payHold): the hold row first, then its seats. Without it, a
    // concurrent cancel or pay of the previous hold (hold, then seats) deadlocks against this release (seats, then hold).
    await tx.execute(sql`
      select id from holds where buyer_id = ${o.buyerId}::uuid and event_id = ${eventId}::uuid and status = 'active'
      order by id for update`);
    // Replace the buyer's previous active hold for this event. If the new claim fails, the rollback restores it.
    await tx.execute(sql`
      update event_seats set status = 'available', hold_id = null, held_until = null
      where event_id = ${eventId}::uuid and status = 'held'
        and hold_id in (select id from holds where buyer_id = ${o.buyerId}::uuid and event_id = ${eventId}::uuid and status = 'active')`);
    await tx.execute(sql`
      update holds set status = 'cancelled'
      where buyer_id = ${o.buyerId}::uuid and event_id = ${eventId}::uuid and status = 'active'`);

    const holdId = asId<'HoldId'>(randomUUID());
    await tx.insert(schema.holds).values({ id: holdId, buyerId: o.buyerId, eventId, seatCount: seatIds.length, expiresAt });
    const claimed = new Set(await claimSeats(tx, { eventId, holdId, seatIds, now, expiresAt }));
    if (claimed.size !== seatIds.length) {
      const known = await tx.execute(sql`
        select seat_id from event_seats where event_id = ${eventId}::uuid and seat_id = any(${uuidList(seatIds)})`);
      const knownIds = new Set(known.rows.map((x) => String(x.seat_id)));
      // Throwing inside the transaction callback rolls everything back: no partial hold, previous hold kept.
      if (seatIds.some((s) => !knownIds.has(s))) throw new ApiError(400, 'unknown_seat', 'Some seats are not part of this event');
      throw new ApiError(409, 'seats_unavailable', 'Some seats are no longer available', {
        taken: seatIds.filter((s) => !claimed.has(s)),
      });
    }
    return viewOf(tx, holdId);
  });
}

export async function getHold(deps: Pick<Deps, 'db'>, o: { buyerId: string; holdId: string }): Promise<HoldView> {
  if (!UUID_RE.test(o.holdId)) throw notFound();
  return deps.db.transaction(async (tx) => {
    const [hold] = await tx
      .select({ id: schema.holds.id })
      .from(schema.holds)
      .where(and(eq(schema.holds.id, o.holdId.toLowerCase()), eq(schema.holds.buyerId, o.buyerId), eq(schema.holds.status, 'active')));
    if (!hold) throw notFound();
    return viewOf(tx, hold.id);
  });
}

export async function cancelHold(deps: Pick<Deps, 'db'>, o: { buyerId: string; holdId: string }): Promise<void> {
  if (!UUID_RE.test(o.holdId)) throw notFound();
  const holdId = o.holdId.toLowerCase();
  await deps.db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      select id from holds where id = ${holdId}::uuid and buyer_id = ${o.buyerId}::uuid and status = 'active' for update`);
    if (locked.rows.length === 0) throw notFound();
    await tx.execute(sql`
      update event_seats set status = 'available', hold_id = null, held_until = null
      where hold_id = ${holdId}::uuid and status = 'held'`);
    await tx.update(schema.holds).set({ status: 'cancelled' }).where(eq(schema.holds.id, holdId));
  });
}
