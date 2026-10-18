import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';
import type { Clock } from '@standing/shared';

/** Housekeeping only: correctness never depends on it, because claimSeats reclaims expired holds on its own. */
export async function releaseExpiredHolds(db: Db, clock: Clock): Promise<{ seats: number; holds: number }> {
  const now = clock.now();
  return db.transaction(async (tx) => {
    const seats = await tx.execute(sql`
      update event_seats set status = 'available', hold_id = null, held_until = null
      where status = 'held' and held_until < ${now}::timestamptz returning seat_id`);
    const holds = await tx.execute(sql`
      update holds set status = 'cancelled' where status = 'active' and expires_at < ${now}::timestamptz returning id`);
    return { seats: seats.rows.length, holds: holds.rows.length };
  });
}
