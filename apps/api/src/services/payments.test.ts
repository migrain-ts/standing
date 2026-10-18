import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertEventFixture } from '@standing/db';
import { makeApp, makeUser, type TestApp } from '../test-helpers';
import { createHold } from './holds';
import { payHold } from './payments';
import { verifyTicket } from '@standing/core';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

const count = async (query: ReturnType<typeof sql>) => Number((await t.db.execute(query)).rows[0]?.n);

async function heldBy(name: string, seats = 2, opts: { rows?: number; seatsPerRow?: number } = {}) {
  const f = await insertEventFixture(t.db, { rows: opts.rows ?? 1, seatsPerRow: opts.seatsPerRow ?? 4, priceCents: 2500 });
  const buyer = await makeUser(t, name);
  const hold = await createHold(t.deps, { buyerId: buyer.id, eventId: f.eventId, seatIds: f.seatIds.slice(0, seats) });
  return { f, buyer, hold };
}

describe('payHold', () => {
  it('turns a hold into a paid order, sold seats, signed tickets, an outbox row and a queued ticket document', async () => {
    const { f, buyer, hold } = await heldBy('pay1');
    const res = await payHold(t.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'k1' });
    expect(res.kind).toBe('paid');
    if (res.kind !== 'paid') return;
    expect(res.order.totalCents).toBe(5000);
    expect(res.order.createdAt).toBe(t.clock.now().toISOString());
    expect(res.order.tickets).toHaveLength(2);
    for (const tk of res.order.tickets) expect(verifyTicket(t.deps.config.ticketSecret, tk.code)).toBe(tk.id);
    expect(await count(sql`select count(*)::int as n from event_seats where event_id = ${f.eventId}::uuid and status = 'sold' and order_id = ${res.order.id}::uuid`)).toBe(2);
    expect(await count(sql`select count(*)::int as n from holds where id = ${hold.id}::uuid and status = 'paid'`)).toBe(1);
    const ob = await t.db.execute(sql`select kind, dedupe_key, payload from outbox where dedupe_key = ${'ticket.sold:' + res.order.id}`);
    expect(ob.rows).toHaveLength(1);
    expect(ob.rows[0]).toMatchObject({ kind: 'ticket.sold' });
    const payload = ob.rows[0]?.payload as { orderId: string; at: string; revenueCents: number; seats: Record<string, unknown>[] };
    expect(payload.revenueCents).toBe(5000);
    expect(payload.orderId).toBe(res.order.id);
    expect(payload.at).toBe(t.clock.now().toISOString());
    expect(Object.keys(payload.seats[0] ?? {}).sort()).toEqual(['idx', 'priceCents', 'seatId', 'sectionId']);
    expect(await count(sql`select count(*)::int as n from documents where order_id = ${res.order.id}::uuid and kind = 'ticket_pdf' and status = 'queued'`)).toBe(1);
  });

  it('is idempotent: the same key returns the same order and creates nothing twice, even in parallel', async () => {
    const { buyer, hold } = await heldBy('idem');
    const results = await Promise.all(Array.from({ length: 5 }, () => payHold(t.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'same' })));
    const ids = new Set(results.map((r) => (r.kind === 'paid' ? r.order.id : 'declined')));
    expect(ids.size).toBe(1);
    expect(results.filter((r) => r.kind === 'paid' && !r.replayed)).toHaveLength(1);
    expect(await count(sql`select count(*)::int as n from orders where hold_id = ${hold.id}::uuid`)).toBe(1);
    expect(await count(sql`select count(*)::int as n from outbox where dedupe_key like ${'ticket.sold:%'} and payload->>'orderId' = ${[...ids][0] ?? ''}`)).toBe(1);
  });

  it('refuses a second payment of a paid hold under a different key, and runs two different keys in parallel exactly once', async () => {
    const { buyer, hold } = await heldBy('twice');
    const [a, b] = await Promise.allSettled([
      payHold(t.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'a' }),
      payHold(t.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'b' }),
    ]);
    const outcomes = [a, b].map((r) => (r.status === 'fulfilled' ? r.value.kind : (r.reason as { code: string }).code));
    expect(outcomes.sort()).toEqual(['already_paid', 'paid']);
  });

  it('answers 410 after the hold expired and leaves no order behind', async () => {
    const { f, buyer, hold } = await heldBy('late');
    t.clock.advanceMs(600_001);
    await expect(payHold(t.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'late' })).rejects.toMatchObject({ status: 410, code: 'hold_expired' });
    expect(await count(sql`select count(*)::int as n from orders where event_id = ${f.eventId}::uuid`)).toBe(0);
    t.clock.advanceMs(-600_001);
  });

  it('answers 410 when another buyer reclaimed an expired seat, sells it only to the new holder', async () => {
    const f = await insertEventFixture(t.db, { rows: 1, seatsPerRow: 2 });
    const a = await makeUser(t, 'old');
    const b = await makeUser(t, 'new');
    const seat = f.seatIds[0] ?? '';
    const holdA = await createHold(t.deps, { buyerId: a.id, eventId: f.eventId, seatIds: [seat] });
    t.clock.advanceMs(600_001);
    const holdB = await createHold(t.deps, { buyerId: b.id, eventId: f.eventId, seatIds: [seat] });
    await expect(payHold(t.deps, { holdId: holdA.id, buyerId: a.id, idempotencyKey: 'a' })).rejects.toMatchObject({ status: 410 });
    const paid = await payHold(t.deps, { holdId: holdB.id, buyerId: b.id, idempotencyKey: 'b' });
    expect(paid.kind).toBe('paid');
    expect(await count(sql`select count(*)::int as n from order_items where event_id = ${f.eventId}::uuid`)).toBe(1);
    t.clock.advanceMs(-600_001);
  });

  it('declines with a stored failure, keeps the hold, and accepts a retry under a new key', async () => {
    const flaky = await makeApp({ config: { paymentFailureRate: 0.5 } });
    const calls = [0.1, 0.9];
    flaky.deps.random = () => calls.shift() ?? 0.9;
    const f = await insertEventFixture(flaky.db, { rows: 1, seatsPerRow: 2 });
    const buyer = await makeUser(flaky, 'flaky');
    const hold = await createHold(flaky.deps, { buyerId: buyer.id, eventId: f.eventId, seatIds: [f.seatIds[0] ?? ''] });
    expect((await payHold(flaky.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'first' })).kind).toBe('declined');
    expect((await payHold(flaky.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'first' })).kind).toBe('declined');
    expect((await payHold(flaky.deps, { holdId: hold.id, buyerId: buyer.id, idempotencyKey: 'second' })).kind).toBe('paid');
    await flaky.close();
  });

  it('hides other buyers holds', async () => {
    const { hold } = await heldBy('mine');
    const stranger = await makeUser(t, 'stranger');
    await expect(payHold(t.deps, { holdId: hold.id, buyerId: stranger.id, idempotencyKey: 'x' })).rejects.toMatchObject({ status: 404 });
  });
});
