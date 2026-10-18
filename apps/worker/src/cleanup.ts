import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';
import type { Clock } from '@standing/shared';

/**
 * Housekeeping only: correctness never depends on it, because claimSeats reclaims expired holds on its own.
 * It never waits for a row lock (sorted, SKIP LOCKED): a seat or hold that a request is busy with is skipped and
 * handled on the next cycle, so the cleanup cannot deadlock against createHold, cancelHold or payHold.
 */
export async function releaseExpiredHolds(db: Db, clock: Clock): Promise<{ seats: number; holds: number }> {
  const now = clock.now();
  return db.transaction(async (tx) => {
    const seats = await tx.execute(sql`
      update event_seats set status = 'available', hold_id = null, held_until = null
      where (event_id, seat_id) in (
        select event_id, seat_id from event_seats
        where status = 'held' and held_until < ${now}::timestamptz
        order by event_id, seat_id for update skip locked)
      returning seat_id`);
    const holds = await tx.execute(sql`
      update holds set status = 'cancelled'
      where id in (
        select id from holds where status = 'active' and expires_at < ${now}::timestamptz
        order by id for update skip locked)
      returning id`);
    return { seats: seats.rows.length, holds: holds.rows.length };
  });
}
