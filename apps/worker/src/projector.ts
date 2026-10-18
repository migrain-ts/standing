import { inArray, sql } from 'drizzle-orm';
import { schema, type Db } from '@standing/db';
import { liveChannel, ticketScannedPayload, ticketSoldPayload, type EventDelta } from '@standing/core';
import type { Clock } from '@standing/shared';

export type Publisher = (delta: EventDelta) => Promise<void>;
type OutboxRow = { id: number; kind: string; tenant_id: string; event_id: string; payload: unknown };

const minuteOf = (iso: string) => new Date(Math.floor(Date.parse(iso) / 60_000) * 60_000);

export async function projectOutbox(
  db: Db,
  o: { clock: Clock; batchSize?: number; publish?: Publisher; log?: (line: string) => void },
): Promise<{ processed: number; skipped: number }> {
  const log = o.log ?? console.error;
  const result = await db.transaction(async (tx) => {
    const claimed = await tx.execute(sql`
      select id, kind, tenant_id, event_id, payload from outbox
      where processed_at is null order by id limit ${o.batchSize ?? 200} for update skip locked`);
    const rows = claimed.rows as OutboxRow[];
    const minute = new Map<string, { eventId: string; bucket: Date; tickets: number; revenue: number }>();
    const section = new Map<string, { eventId: string; sectionId: string; tickets: number; revenue: number }>();
    const deltas = new Map<string, EventDelta>();
    const at = o.clock.now().toISOString();
    let skipped = 0;
    for (const row of rows) {
      const delta = deltas.get(row.event_id) ?? { eventId: row.event_id, tenantId: row.tenant_id, tickets: 0, revenueCents: 0, seats: [], scanned: 0, at };
      deltas.set(row.event_id, delta);
      if (row.kind === 'ticket.sold') {
        const p = ticketSoldPayload.safeParse(row.payload);
        if (!p.success) { skipped++; continue; }
        const bucket = minuteOf(p.data.at);
        const mk = `${row.event_id}|${bucket.toISOString()}`;
        const m = minute.get(mk) ?? { eventId: row.event_id, bucket, tickets: 0, revenue: 0 };
        m.tickets += p.data.seats.length;
        m.revenue += p.data.revenueCents;
        minute.set(mk, m);
        for (const seat of p.data.seats) {
          const sk = `${row.event_id}|${seat.sectionId}`;
          const s = section.get(sk) ?? { eventId: row.event_id, sectionId: seat.sectionId, tickets: 0, revenue: 0 };
          s.tickets += 1;
          s.revenue += seat.priceCents;
          section.set(sk, s);
          delta.seats.push({ idx: seat.idx, sectionId: seat.sectionId });
        }
        delta.tickets += p.data.seats.length;
        delta.revenueCents += p.data.revenueCents;
      } else if (row.kind === 'ticket.scanned') {
        if (!ticketScannedPayload.safeParse(row.payload).success) { skipped++; continue; }
        delta.scanned += 1;
      } else {
        skipped++;
      }
    }
    // Sorted upserts: two projectors whose batches touch the same rollup rows lock them in the same order (no deadlock).
    const byKey = <T>(m: Map<string, T>) => [...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, v]) => v);
    for (const m of byKey(minute)) {
      await tx.insert(schema.salesByMinute).values({ eventId: m.eventId, bucket: m.bucket, tickets: m.tickets, revenueCents: m.revenue })
        .onConflictDoUpdate({
          target: [schema.salesByMinute.eventId, schema.salesByMinute.bucket],
          set: { tickets: sql`${schema.salesByMinute.tickets} + excluded.tickets`, revenueCents: sql`${schema.salesByMinute.revenueCents} + excluded.revenue_cents` },
        });
    }
    for (const s of byKey(section)) {
      await tx.insert(schema.salesBySection).values({ eventId: s.eventId, sectionId: s.sectionId, tickets: s.tickets, revenueCents: s.revenue })
        .onConflictDoUpdate({
          target: [schema.salesBySection.eventId, schema.salesBySection.sectionId],
          set: { tickets: sql`${schema.salesBySection.tickets} + excluded.tickets`, revenueCents: sql`${schema.salesBySection.revenueCents} + excluded.revenue_cents` },
        });
    }
    if (rows.length > 0) {
      await tx.update(schema.outbox).set({ processedAt: o.clock.now() }).where(inArray(schema.outbox.id, rows.map((r) => r.id)));
    }
    return { processed: rows.length, skipped, deltas: [...deltas.values()].filter((d) => d.tickets > 0 || d.scanned > 0) };
  });
  // After commit: best effort. Clients resynchronise from a snapshot, so a lost delta is a delay, never a wrong number.
  if (o.publish) {
    for (const d of result.deltas) {
      try {
        await o.publish(d);
      } catch (err) {
        log(`[projector] publish failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  return { processed: result.processed, skipped: result.skipped };
}

export const redisPublisher =
  (redis: { publish(channel: string, message: string): Promise<number> }, channel: (eventId: string) => string = liveChannel): Publisher =>
  async (d) => {
    await redis.publish(channel(d.eventId), JSON.stringify(d));
  };
