import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';
import type { Clock } from '@standing/shared';

export type Availability = { at: string; held: number[]; sold: number[] };

export function availabilityLoader(db: Db, clock: Clock) {
  return async (eventId: string): Promise<Availability> => {
    const now = clock.now();
    const r = await db.execute(sql`
      select s.idx, es.status
      from event_seats es join seats s on s.id = es.seat_id
      where es.event_id = ${eventId}::uuid
        and (es.status = 'sold' or (es.status = 'held' and es.held_until > ${now}::timestamptz))
      order by s.idx`);
    const held: number[] = [];
    const sold: number[] = [];
    for (const row of r.rows) (row.status === 'sold' ? sold : held).push(Number(row.idx));
    return { at: now.toISOString(), held, sold };
  };
}
