import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';
import type { Deps } from '../app';
import type { WaitingRoom } from './waiting-room';
import { loadTenantEvent } from './events';
import type { TenantId } from '@standing/shared';

export type Totals = {
  sold: number;
  held: number;
  available: number;
  revenueCents: number;
  scanned: number;
  oversold: number;
  queue: { waiting: number; active: number } | null;
};
export type Snapshot = {
  event: { id: string; name: string; status: string; startsAt: string };
  capacity: number;
  totals: Totals;
  sections: { id: string; name: string; capacity: number; sold: number; priceCents: number }[];
  byMinute: { bucket: string; tickets: number; revenueCents: number }[];
  at: string;
};

/** Independent of every other figure: tickets issued vs seats sold, plus seats sold on more than one order item. */
export async function oversold(db: Db, eventId: string): Promise<number> {
  const r = await db.execute(sql`
    select
      (select count(*) from tickets where event_id = ${eventId}::uuid)::int as tickets,
      (select count(*) from event_seats where event_id = ${eventId}::uuid and status = 'sold')::int as sold,
      (select count(*) from (select seat_id from order_items where event_id = ${eventId}::uuid group by seat_id having count(*) > 1) d)::int as dup`);
  const row = r.rows[0];
  return Math.abs(Number(row?.tickets) - Number(row?.sold)) + Number(row?.dup);
}

export async function loadTotals(deps: Deps, eventId: string, waitingRoom?: WaitingRoom): Promise<Totals> {
  const now = deps.clock.now();
  const r = await deps.db.execute(sql`
    select
      count(*)::int as capacity,
      (count(*) filter (where status = 'sold'))::int as sold,
      (count(*) filter (where status = 'held' and held_until > ${now}::timestamptz))::int as held,
      (select coalesce(sum(revenue_cents), 0) from sales_by_section where event_id = ${eventId}::uuid)::bigint as revenue,
      (select count(*) from tickets where event_id = ${eventId}::uuid and scanned_at is not null)::int as scanned
    from event_seats where event_id = ${eventId}::uuid`);
  const row = r.rows[0];
  const capacity = Number(row?.capacity ?? 0);
  const sold = Number(row?.sold ?? 0);
  const held = Number(row?.held ?? 0);
  let queue: Totals['queue'] = null;
  try {
    queue = (await waitingRoom?.stats(eventId)) ?? null;
  } catch {
    queue = null;
  }
  return {
    sold,
    held,
    available: capacity - sold - held,
    revenueCents: Number(row?.revenue ?? 0),
    scanned: Number(row?.scanned ?? 0),
    oversold: await oversold(deps.db, eventId),
    queue,
  };
}

export const totalsLoader = (deps: Deps, waitingRoom: WaitingRoom | undefined) => (eventId: string) =>
  loadTotals(deps, eventId, waitingRoom);

export async function loadSnapshot(deps: Deps, tenantId: TenantId, eventId: string, totals?: Totals): Promise<Snapshot> {
  const ev = await loadTenantEvent(deps.db, tenantId, eventId);
  const t = totals ?? (await loadTotals(deps, ev.id));
  const sections = await deps.db.execute(sql`
    select sc.id, sc.name, count(es.seat_id)::int as capacity,
      (count(es.seat_id) filter (where es.status = 'sold'))::int as sold,
      coalesce(pt.price_cents, 0) as price_cents
    from event_seats es
    join seats st on st.id = es.seat_id
    join sections sc on sc.id = st.section_id
    left join price_tiers pt on pt.event_id = es.event_id and pt.section_id = sc.id
    where es.event_id = ${ev.id}::uuid
    group by sc.id, sc.name, sc.ord, pt.price_cents
    order by sc.ord`);
  const minutes = await deps.db.execute(sql`
    select bucket, tickets, revenue_cents from (
      select bucket, tickets, revenue_cents from sales_by_minute
      where event_id = ${ev.id}::uuid order by bucket desc limit 60) m
    order by bucket`);
  return {
    event: { id: ev.id, name: ev.name, status: ev.status, startsAt: ev.startsAt.toISOString() },
    capacity: t.sold + t.held + t.available,
    totals: t,
    sections: sections.rows.map((s) => ({
      id: String(s.id), name: String(s.name), capacity: Number(s.capacity), sold: Number(s.sold), priceCents: Number(s.price_cents),
    })),
    byMinute: minutes.rows.map((m) => ({
      bucket: new Date(m.bucket as string).toISOString(), tickets: Number(m.tickets), revenueCents: Number(m.revenue_cents),
    })),
    at: deps.clock.now().toISOString(),
  };
}
