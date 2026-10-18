import { sql } from 'drizzle-orm';
import { verifyTicket } from '@standing/core';
import { asId, type EventId, type TicketId } from '@standing/shared';
import type { Deps } from '../app';
import { ApiError } from '../errors';

export type TicketInfo = { id: TicketId; eventId: EventId; eventName: string; sectionName: string; rowLabel: string; number: number };
export type ScanResult =
  | { result: 'admitted'; ticket: TicketInfo; scannedAt: string }
  | { result: 'already_scanned'; ticket: TicketInfo; firstScannedAt: string }
  | { result: 'wrong_event'; ticket: TicketInfo };

export async function scanTicket(
  deps: Pick<Deps, 'db' | 'clock' | 'config'>,
  o: { userId: string; code: string; eventId?: string | undefined },
): Promise<ScanResult> {
  // Signature check first: a forged code never reaches the database.
  const ticketId = verifyTicket(deps.config.ticketSecret, o.code);
  if (!ticketId) throw new ApiError(400, 'invalid_code', 'This code is not a valid ticket');
  return deps.db.transaction(async (tx) => {
    // The row lock serializes concurrent scans: a loser re-reads scanned_at after the winner commits.
    const found = await tx.execute(sql`
      select t.id, t.event_id, t.scanned_at, e.name as event_name, e.tenant_id,
             sec.name as section_name, s.row_label, s.number
      from tickets t
      join events e on e.id = t.event_id
      join seats s on s.id = t.seat_id
      join sections sec on sec.id = s.section_id
      where t.id = ${ticketId}::uuid
      for update of t`);
    const row = found.rows[0];
    if (!row) throw new ApiError(404, 'not_found', 'Not found');
    const member = await tx.execute(sql`
      select 1 from memberships where tenant_id = ${String(row.tenant_id)}::uuid and user_id = ${o.userId}::uuid`);
    if (member.rows.length === 0) throw new ApiError(404, 'not_found', 'Not found');
    const ticket: TicketInfo = {
      id: ticketId,
      eventId: asId<'EventId'>(String(row.event_id)) as EventId,
      eventName: String(row.event_name),
      sectionName: String(row.section_name),
      rowLabel: String(row.row_label),
      number: Number(row.number),
    };
    if (o.eventId && o.eventId.toLowerCase() !== String(row.event_id)) return { result: 'wrong_event', ticket };
    if (row.scanned_at) return { result: 'already_scanned', ticket, firstScannedAt: new Date(row.scanned_at as string).toISOString() };
    const now = deps.clock.now();
    await tx.execute(sql`update tickets set scanned_at = ${now}::timestamptz, scanned_by = ${o.userId}::uuid where id = ${ticketId}::uuid`);
    await tx.execute(sql`
      insert into outbox (kind, tenant_id, event_id, payload, dedupe_key, created_at)
      values ('ticket.scanned', ${String(row.tenant_id)}::uuid, ${String(row.event_id)}::uuid,
              ${JSON.stringify({ ticketId, at: now.toISOString() })}::jsonb, ${`ticket.scanned:${ticketId}`}, ${now}::timestamptz)`);
    return { result: 'admitted', ticket, scannedAt: now.toISOString() };
  });
}
