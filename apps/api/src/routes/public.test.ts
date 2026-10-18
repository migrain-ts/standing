import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTenantFixture } from '../fixtures';
import { call, makeApp, type TestApp } from '../test-helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

type Listed = { id: string; minPriceCents: number; capacity: number; available: number };

describe('public catalog', () => {
  it('lists the published event with price, capacity and availability, without a session', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, null, 'GET', '/public/events');
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as { events: Listed[] };
    expect(events.find((e) => e.id === f.eventId)).toMatchObject({ minPriceCents: 5000, capacity: 20, available: 20 });
    expect(events.map((e) => e.id)).not.toContain(f.draftEventId);
  });
  it('excludes events that already started', async () => {
    const f = await makeTenantFixture(t);
    await t.db.execute(sql`update events set starts_at = ${new Date('2026-01-01T00:00:00Z')}::timestamptz where id = ${f.eventId}::uuid`);
    const { events } = (await (await call(t.app, null, 'GET', '/public/events')).json()) as { events: Listed[] };
    expect(events.map((e) => e.id)).not.toContain(f.eventId);
  });
  it('detail: sections with prices; 404 for a draft and a malformed id', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, null, 'GET', `/public/events/${f.eventId}`);
    expect(res.status).toBe(200);
    const { event } = (await res.json()) as { event: { sections: { id: string; priceCents: number }[]; capacity: number; admissionLimit: number } };
    expect(event.sections).toMatchObject([{ id: f.sectionId, priceCents: 5000 }]);
    expect(event.capacity).toBe(20);
    expect((await call(t.app, null, 'GET', `/public/events/${f.draftEventId}`)).status).toBe(404);
    expect((await call(t.app, null, 'GET', '/public/events/not-a-uuid')).status).toBe(404);
  });
  it('map: seatIds parallel to seats, cacheable, 404 for drafts', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, null, 'GET', `/public/events/${f.eventId}/map`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=300');
    const map = (await res.json()) as { seats: unknown[]; seatIds: string[] };
    expect(map.seats.length).toBe(f.seatIds.length);
    expect(map.seatIds.length).toBe(f.seatIds.length);
    f.seatIds.forEach((id, i) => expect(map.seatIds[i]).toBe(id));
    expect((await call(t.app, null, 'GET', `/public/events/${f.draftEventId}/map`)).status).toBe(404);
  });
  it('availability: reports sold and live holds, not expired holds', async () => {
    const f = await makeTenantFixture(t);
    const u = f.owner.id;
    const hold = await t.db.execute(sql`
      insert into holds (buyer_id, event_id, seat_count, expires_at)
      values (${u}::uuid, ${f.eventId}::uuid, 3, ${new Date('2026-01-05T09:00:00Z')}::timestamptz) returning id`);
    const holdId = String(hold.rows[0]?.id);
    const order = await t.db.execute(sql`
      insert into orders (buyer_id, event_id, tenant_id, hold_id, total_cents)
      values (${u}::uuid, ${f.eventId}::uuid, ${f.tenantId}::uuid, ${holdId}::uuid, 5000) returning id`);
    const orderId = String(order.rows[0]?.id);
    const set = (idx: number, status: string, until: string | null, ord: string | null) =>
      t.db.execute(sql`
        update event_seats set status = ${status}::seat_status, hold_id = ${until ? holdId : null}::uuid,
          held_until = ${until}::timestamptz, order_id = ${ord}::uuid
        where event_id = ${f.eventId}::uuid and seat_id = ${f.seatIds[idx] ?? ''}::uuid`);
    await set(0, 'sold', null, orderId);
    await set(1, 'held', '2026-01-05T08:10:00Z', null);
    await set(2, 'held', '2026-01-05T07:00:00Z', null);
    const res = await call(t.app, null, 'GET', `/public/events/${f.eventId}/availability`);
    expect(res.status).toBe(200);
    const a = (await res.json()) as { held: number[]; sold: number[]; at: string };
    expect(a.sold).toEqual([0]);
    expect(a.held).toEqual([1]);
    expect((await call(t.app, null, 'GET', `/public/events/${f.draftEventId}/availability`)).status).toBe(404);
  });
});
