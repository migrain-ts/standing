import { and, eq, sql } from 'drizzle-orm';
import { schema, type Db, type Tx } from '@standing/db';
import { asId, UUID_RE, type DocumentId, type EventId, type OrderId, type SeatId, type TicketId } from '@standing/shared';
import { signTicket } from '@standing/core';
import type { Deps } from '../app';
import { ApiError } from '../errors';

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const notFound = () => new ApiError(404, 'not_found', 'Not found');
const expired = () => new ApiError(410, 'hold_expired', 'This reservation has expired');

export type OrderView = {
  id: OrderId;
  eventId: EventId;
  totalCents: number;
  createdAt: string;
  documentId: DocumentId | null;
  tickets: { id: TicketId; seatId: SeatId; rowLabel: string; number: number; sectionName: string; priceCents: number; code: string }[];
};
export type PayResult = { kind: 'paid'; replayed: boolean; order: OrderView } | { kind: 'declined' };

/** Loads an order with its tickets. Pass `buyerId` to hide orders of other buyers (404). */
export async function loadOrderView(db: Db | Tx, secret: string, orderId: string, buyerId?: string): Promise<OrderView> {
  if (!UUID_RE.test(orderId)) throw notFound();
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(and(eq(schema.orders.id, orderId.toLowerCase()), ...(buyerId ? [eq(schema.orders.buyerId, buyerId)] : [])));
  if (!order) throw notFound();
  const rows = await db.execute(sql`
    select t.id as ticket_id, t.seat_id, s.row_label, s.number, sec.name as section_name, oi.price_cents
    from tickets t
    join order_items oi on oi.id = t.order_item_id
    join seats s on s.id = t.seat_id
    join sections sec on sec.id = s.section_id
    where t.order_id = ${order.id}::uuid order by s.idx`);
  const [doc] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.orderId, order.id), eq(schema.documents.kind, 'ticket_pdf')));
  return {
    id: asId<'OrderId'>(order.id),
    eventId: asId<'EventId'>(order.eventId),
    totalCents: order.totalCents,
    createdAt: order.createdAt.toISOString(),
    documentId: doc ? asId<'DocumentId'>(doc.id) : null,
    tickets: rows.rows.map((r) => {
      const id = asId<'TicketId'>(String(r.ticket_id));
      return {
        id,
        seatId: asId<'SeatId'>(String(r.seat_id)),
        rowLabel: String(r.row_label),
        number: Number(r.number),
        sectionName: String(r.section_name),
        priceCents: Number(r.price_cents),
        code: signTicket(secret, id),
      };
    }),
  };
}

export async function payHold(
  deps: Pick<Deps, 'db' | 'clock' | 'config' | 'random'>,
  o: { holdId: string; buyerId: string; idempotencyKey: string },
): Promise<PayResult> {
  if (!UUID_RE.test(o.holdId)) throw notFound();
  const holdId = o.holdId.toLowerCase();
  // Simulated gateway: latency and the random decision happen before the transaction so no row lock is held while "calling the bank".
  if (deps.config.paymentLatencyMs > 0) await sleep(deps.config.paymentLatencyMs);
  const willFail = (deps.random ?? Math.random)() < deps.config.paymentFailureRate;

  return deps.db.transaction(async (tx): Promise<PayResult> => {
    const now = deps.clock.now();
    const locked = await tx.execute(sql`
      select h.id, h.event_id, h.seat_count, h.status, h.expires_at, e.tenant_id,
        (e.status = 'published' and e.starts_at > ${now}::timestamptz) as on_sale
      from holds h join events e on e.id = h.event_id
      where h.id = ${holdId}::uuid and h.buyer_id = ${o.buyerId}::uuid for update of h`);
    const hold = locked.rows[0] as
      | { id: string; event_id: string; seat_count: number; status: string; expires_at: Date | string; tenant_id: string; on_sale: boolean }
      | undefined;
    if (!hold) throw notFound();

    const [prior] = await tx
      .select()
      .from(schema.payments)
      .where(and(eq(schema.payments.holdId, holdId), eq(schema.payments.idempotencyKey, o.idempotencyKey)));
    if (prior) {
      if (prior.status === 'failed' || !prior.orderId) return { kind: 'declined' };
      return { kind: 'paid', replayed: true, order: await loadOrderView(tx, deps.config.ticketSecret, prior.orderId) };
    }
    if (hold.status === 'paid') throw new ApiError(409, 'already_paid', 'This reservation is already paid');
    // Sales stop when the event is closed or has started; nothing is written and the hold stays as it is.
    if (!hold.on_sale) throw new ApiError(409, 'event_closed', 'Sales are closed for this event');
    if (hold.status !== 'active' || new Date(hold.expires_at) <= now) throw expired();

    const seats = await tx.execute(sql`
      select es.seat_id from event_seats es
      where es.hold_id = ${holdId}::uuid and es.status = 'held' and es.held_until > ${now}::timestamptz
      for update of es`);
    if (seats.rows.length !== hold.seat_count) throw expired();

    if (willFail) {
      await tx.insert(schema.payments).values({ holdId, idempotencyKey: o.idempotencyKey, status: 'failed', createdAt: now });
      return { kind: 'declined' };
    }
    const totalRow = await tx.execute(sql`
      select coalesce(sum(pt.price_cents), 0)::int as total
      from event_seats es
      join seats s on s.id = es.seat_id
      join price_tiers pt on pt.event_id = es.event_id and pt.section_id = s.section_id
      where es.hold_id = ${holdId}::uuid and es.status = 'held'`);
    const total = Number(totalRow.rows[0]?.total ?? 0);
    const [order] = await tx
      .insert(schema.orders)
      .values({ buyerId: o.buyerId, eventId: hold.event_id, tenantId: hold.tenant_id, holdId, totalCents: total, createdAt: now })
      .returning({ id: schema.orders.id });
    if (!order) throw new Error('order insert failed');
    await tx.execute(sql`
      insert into order_items (order_id, event_id, seat_id, section_id, price_cents)
      select ${order.id}::uuid, es.event_id, es.seat_id, s.section_id, pt.price_cents
      from event_seats es
      join seats s on s.id = es.seat_id
      join price_tiers pt on pt.event_id = es.event_id and pt.section_id = s.section_id
      where es.hold_id = ${holdId}::uuid and es.status = 'held'`);
    await tx.execute(sql`
      insert into tickets (order_item_id, order_id, event_id, seat_id)
      select id, order_id, event_id, seat_id from order_items where order_id = ${order.id}::uuid`);
    const sold = await tx.execute(sql`
      update event_seats set status = 'sold', order_id = ${order.id}::uuid, held_until = null
      where hold_id = ${holdId}::uuid and status = 'held'
      returning seat_id`);
    if (sold.rows.length !== hold.seat_count) throw expired(); // throwing rolls the whole transaction back
    await tx.update(schema.holds).set({ status: 'paid' }).where(eq(schema.holds.id, holdId));
    await tx.insert(schema.payments).values({ holdId, idempotencyKey: o.idempotencyKey, status: 'succeeded', orderId: order.id, createdAt: now });
    const items = await tx.execute(sql`
      select oi.seat_id, s.idx, oi.section_id, oi.price_cents
      from order_items oi join seats s on s.id = oi.seat_id
      where oi.order_id = ${order.id}::uuid order by s.idx`);
    await tx.insert(schema.outbox).values({
      kind: 'ticket.sold',
      tenantId: hold.tenant_id,
      eventId: hold.event_id,
      dedupeKey: `ticket.sold:${order.id}`,
      createdAt: now,
      payload: {
        orderId: order.id,
        at: now.toISOString(),
        revenueCents: total,
        seats: items.rows.map((r) => ({
          seatId: String(r.seat_id),
          idx: Number(r.idx),
          sectionId: String(r.section_id),
          priceCents: Number(r.price_cents),
        })),
      },
    });
    await tx.insert(schema.documents).values({
      tenantId: hold.tenant_id,
      kind: 'ticket_pdf',
      orderId: order.id,
      eventId: hold.event_id,
      requestedBy: o.buyerId,
      createdAt: now,
      updatedAt: now,
    });
    return { kind: 'paid', replayed: false, order: await loadOrderView(tx, deps.config.ticketSecret, order.id) };
  });
}
