import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { sql } from 'drizzle-orm';
import { insertEventFixture } from '@standing/db';
import { WaitingRoom } from '../services/waiting-room';
import { call, connectTestRedis, makeApp, makeUser, type TestApp } from '../test-helpers';

let t: TestApp;
let redis: Redis;
beforeAll(async () => {
  redis = await connectTestRedis();
  t = await makeApp({ redis });
});
afterAll(async () => {
  await t.close();
  await redis.quit();
});

type Err = { error: { code: string } };
type OrderBody = { order: { id: string; tickets: { code: string }[] } };

async function hold(name: string, app: TestApp = t) {
  const f = await insertEventFixture(app.db, { rows: 1, seatsPerRow: 4, priceCents: 1800 });
  await app.db.execute(sql`update events set admission_limit = 0 where id = ${f.eventId}::uuid`);
  const u = await makeUser(app, name);
  const res = await call(app.app, u.cookie, 'POST', `/public/events/${f.eventId}/holds`, { seatIds: [f.seatIds[0], f.seatIds[1]] });
  if (res.status !== 201) throw new Error(`hold failed ${res.status}`);
  const { hold: h } = (await res.json()) as { hold: { id: string } };
  return { f, u, holdId: h.id };
}
const pay = (cookie: string | null, holdId: string, key: string | null = 'k', headers: Record<string, string> = {}, app: TestApp['app'] = t.app) =>
  call(app, cookie, 'POST', `/holds/${holdId}/pay`, undefined, { ...(key ? { 'idempotency-key': key } : {}), ...headers });

describe('order routes', () => {
  it('is 401 without a session and 400 without an Idempotency-Key', async () => {
    const { u, holdId } = await hold('a');
    expect((await pay(null, holdId)).status).toBe(401);
    const res = await pay(u.cookie, holdId, null);
    expect(res.status).toBe(400);
    expect(((await res.json()) as Err).error.code).toBe('invalid_request');
    expect((await pay(u.cookie, holdId, 'x'.repeat(101))).status).toBe(400);
  });

  it('pays (201 { order } with ticket codes) and replays the same key', async () => {
    const { u, holdId } = await hold('b');
    const res = await pay(u.cookie, holdId);
    expect(res.status).toBe(201);
    const body = (await res.json()) as OrderBody;
    expect(body.order.tickets).toHaveLength(2);
    expect(body.order.tickets[0]?.code).toMatch(/^STD1\./);
    const again = (await (await pay(u.cookie, holdId)).json()) as OrderBody;
    expect(again.order.id).toBe(body.order.id);
    const other = await pay(u.cookie, holdId, 'different');
    expect(other.status).toBe(409);
  });

  it('answers 402 payment_declined when the gateway fails', async () => {
    const bad = await makeApp({ config: { paymentFailureRate: 1 } });
    const { u, holdId } = await hold('c', bad);
    const res = await pay(u.cookie, holdId, 'k', {}, bad.app);
    expect(res.status).toBe(402);
    expect(((await res.json()) as Err).error.code).toBe('payment_declined');
    await bad.close();
  });

  it('shows an order to its buyer only, and lists only own orders', async () => {
    const one = await hold('d');
    const two = await hold('e');
    const o1 = ((await (await pay(one.u.cookie, one.holdId)).json()) as OrderBody).order;
    await pay(two.u.cookie, two.holdId);
    expect((await call(t.app, one.u.cookie, 'GET', `/orders/${o1.id}`)).status).toBe(200);
    expect((await call(t.app, two.u.cookie, 'GET', `/orders/${o1.id}`)).status).toBe(404);
    expect((await call(t.app, null, 'GET', `/orders/${o1.id}`)).status).toBe(401);
    const list = (await (await call(t.app, one.u.cookie, 'GET', '/me/orders')).json()) as { orders: { id: string; eventName: string }[] };
    expect(list.orders.map((o) => o.id)).toEqual([o1.id]);
    expect(list.orders[0]?.eventName).toBeTruthy();
    expect((await call(t.app, null, 'GET', '/me/orders')).status).toBe(401);
  });

  it('releases the admitted queue ticket after payment', async () => {
    const { f, u, holdId } = await hold('f');
    const room = new WaitingRoom(redis, t.clock);
    await redis.zadd(`wr:${f.eventId}:a`, t.clock.now().getTime() + 60_000, 'tkt');
    expect(await room.isAdmitted(f.eventId, 'tkt')).toBe(true);
    expect((await pay(u.cookie, holdId, 'k', { 'x-queue-ticket': 'tkt' })).status).toBe(201);
    expect(await room.isAdmitted(f.eventId, 'tkt')).toBe(false);
  });
});
