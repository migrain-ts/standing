import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';
import { signTicket } from '@standing/core';
import { asId, type Clock } from '@standing/shared';
import { renderReportPdf, type ReportPdfData } from './report-pdf';
import { renderTicketPdf, type TicketPdfData } from './ticket-pdf';

export const MAX_ATTEMPTS = 3;
export type ProcessResult = 'ready' | 'skipped' | 'failed';
type Claimed = { id: string; kind: 'ticket_pdf' | 'report_pdf'; orderId: string | null; eventId: string | null; attempts: number };

async function loadTicketData(db: Db, secret: string, c: Claimed): Promise<TicketPdfData> {
  if (!c.orderId) throw new Error('Ticket document has no order');
  const head = await db.execute(sql`
    select e.name, e.starts_at, v.name as venue_name
    from orders o join events e on e.id = o.event_id join venues v on v.id = e.venue_id
    where o.id = ${c.orderId}::uuid`);
  const h = head.rows[0];
  if (!h) throw new Error('Order not found');
  const rows = await db.execute(sql`
    select t.id, s.row_label, s.number, sec.name as section_name, oi.price_cents
    from tickets t
    join order_items oi on oi.id = t.order_item_id
    join seats s on s.id = t.seat_id
    join sections sec on sec.id = s.section_id
    where t.order_id = ${c.orderId}::uuid order by s.idx`);
  return {
    eventName: String(h.name),
    startsAt: new Date(h.starts_at as string | Date),
    venueName: String(h.venue_name),
    orderId: c.orderId,
    tickets: rows.rows.map((r) => ({
      code: signTicket(secret, asId<'TicketId'>(String(r.id))),
      sectionName: String(r.section_name),
      rowLabel: String(r.row_label),
      number: Number(r.number),
      priceCents: Number(r.price_cents),
    })),
  };
}

async function loadReportData(db: Db, clock: Clock, c: Claimed): Promise<ReportPdfData> {
  if (!c.eventId) throw new Error('Report document has no event');
  const ev = await db.execute(sql`select name from events where id = ${c.eventId}::uuid`);
  if (!ev.rows[0]) throw new Error('Event not found');
  const sections = await db.execute(sql`
    select sec.name, count(*)::int as capacity,
           count(*) filter (where es.status = 'sold')::int as sold,
           coalesce(sum(oi.price_cents) filter (where es.status = 'sold'), 0)::bigint as revenue
    from event_seats es
    join seats s on s.id = es.seat_id
    join sections sec on sec.id = s.section_id
    left join order_items oi on oi.order_id = es.order_id and oi.seat_id = es.seat_id
    where es.event_id = ${c.eventId}::uuid
    group by sec.id, sec.name, sec.ord order by sec.ord`);
  const days = await db.execute(sql`
    select to_char(date_trunc('day', bucket at time zone 'UTC'), 'YYYY-MM-DD') as day, sum(tickets)::int as tickets
    from sales_by_minute where event_id = ${c.eventId}::uuid group by 1 order by 1`);
  const secs = sections.rows.map((r) => ({
    name: String(r.name), capacity: Number(r.capacity), sold: Number(r.sold), revenueCents: Number(r.revenue),
  }));
  return {
    eventName: String(ev.rows[0].name),
    generatedAt: clock.now(),
    ticketsSold: secs.reduce((n, s) => n + s.sold, 0),
    revenueCents: secs.reduce((n, s) => n + s.revenueCents, 0),
    capacity: secs.reduce((n, s) => n + s.capacity, 0),
    days: days.rows.map((r) => ({ day: String(r.day), tickets: Number(r.tickets) })),
    sections: secs,
  };
}

function assertNever(x: never): never {
  throw new Error(`Unhandled document kind: ${String(x)}`);
}

/**
 * At-least-once safe: the claim bumps `attempts`, and every later write is fenced on the attempt number,
 * so a slow superseded run cannot overwrite a newer one. ready/failed rows are never touched.
 * A retryable failure rethrows so BullMQ backs off and retries.
 */
export async function processDocument(
  db: Db,
  deps: { clock: Clock; ticketSecret: string },
  documentId: string,
): Promise<ProcessResult> {
  const now = deps.clock.now();
  const claim = await db.execute(sql`
    update documents set status = 'running', attempts = attempts + 1, updated_at = ${now}::timestamptz
    where id = ${documentId}::uuid and status in ('queued', 'running')
    returning id, kind, order_id, event_id, attempts`);
  const row = claim.rows[0];
  if (!row) return 'skipped';
  const c: Claimed = {
    id: String(row.id),
    kind: row.kind === 'ticket_pdf' ? 'ticket_pdf' : 'report_pdf',
    orderId: row.order_id ? String(row.order_id) : null,
    eventId: row.event_id ? String(row.event_id) : null,
    attempts: Number(row.attempts),
  };
  try {
    const content =
      c.kind === 'ticket_pdf'
        ? await renderTicketPdf(await loadTicketData(db, deps.ticketSecret, c))
        : c.kind === 'report_pdf'
          ? await renderReportPdf(await loadReportData(db, deps.clock, c))
          : assertNever(c.kind);
    const done = await db.execute(sql`
      update documents set status = 'ready', content = ${content}, error = null, updated_at = ${deps.clock.now()}::timestamptz
      where id = ${documentId}::uuid and status = 'running' and attempts = ${c.attempts}`);
    return done.rowCount === 0 ? 'skipped' : 'ready';
  } catch (err) {
    const final = c.attempts >= MAX_ATTEMPTS;
    const message = err instanceof Error ? err.message : String(err);
    await db.execute(sql`
      update documents set status = ${final ? 'failed' : 'queued'}, error = ${message}, updated_at = ${deps.clock.now()}::timestamptz
      where id = ${documentId}::uuid and status = 'running' and attempts = ${c.attempts}`);
    if (!final) throw err;
    return 'failed';
  }
}
