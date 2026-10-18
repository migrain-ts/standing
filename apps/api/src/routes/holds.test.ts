import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';
import { makeTenantFixture } from '../fixtures';
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
beforeEach(async () => {
  await redis.flushdb();
});

const setLimit = (eventId: string, n: number) => t.db.execute(sql`update events set admission_limit = ${n} where id = ${eventId}::uuid`);
const post = (cookie: string | null, eventId: string, seatIds: unknown, headers: Record<string, string> = {}, app: TestApp['app'] = t.app) =>
  call(app, cookie, 'POST', `/public/events/${eventId}/holds`, { seatIds }, headers);
const openFixture = async () => {
  const f = await makeTenantFixture(t);
  await setLimit(f.eventId, 0);
  return f;
};
type Err = { error: { code: string; message: string; details?: { taken: string[] } } };

describe('hold routes', () => {
  it('is 401 without a session', async () => {
    const f = await makeTenantFixture(t);
    expect((await post(null, f.eventId, [f.seatIds[0]])).status).toBe(401);
  });

  it('creates a hold (201 { hold })', async () => {
    const f = await openFixture();
    const u = await makeUser(t, 'u');
    const res = await post(u.cookie, f.eventId, [f.seatIds[0], f.seatIds[1]]);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { hold: { id: string; totalCents: number; seats: unknown[] } };
    expect(body.hold.totalCents).toBe(10000);
    expect(body.hold.seats).toHaveLength(2);
  });

  it('is 400 for 9 seats, duplicate seats and malformed ids', async () => {
    const f = await makeTenantFixture(t);
    const u = await makeUser(t, 'u');
    expect((await post(u.cookie, f.eventId, f.seatIds.slice(0, 9))).status).toBe(400);
    expect((await post(u.cookie, f.eventId, [f.seatIds[0], f.seatIds[0]!.toUpperCase()])).status).toBe(400);
    expect((await post(u.cookie, f.eventId, ['nope'])).status).toBe(400);
    expect((await post(u.cookie, f.eventId, [])).status).toBe(400);
  });

  it('is 409 with details.taken, 400 unknown_seat and 404 for a draft event', async () => {
    const f = await openFixture();
    const a = await makeUser(t, 'a');
    const b = await makeUser(t, 'b');
    expect((await post(a.cookie, f.eventId, [f.seatIds[0]])).status).toBe(201);
    const res = await post(b.cookie, f.eventId, [f.seatIds[0], f.seatIds[1]]);
    expect(res.status).toBe(409);
    const body = (await res.json()) as Err;
    expect(body.error.code).toBe('seats_unavailable');
    expect(body.error.details?.taken).toEqual([f.seatIds[0]]);
    const unknown = await post(b.cookie, f.eventId, [f.outsiderEventId]);
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as Err).error.code).toBe('unknown_seat');
    expect((await post(b.cookie, f.draftEventId, [f.seatIds[0]])).status).toBe(404);
  });

  it('gates on the waiting room ticket and fails closed after a Redis flush', async () => {
    const f = await makeTenantFixture(t);
    await setLimit(f.eventId, 1);
    const u = await makeUser(t, 'u');
    const denied = await post(u.cookie, f.eventId, [f.seatIds[0]]);
    expect(denied.status).toBe(403);
    expect(((await denied.json()) as Err).error.code).toBe('queue_required');
    const q = (await (await call(t.app, u.cookie, 'POST', `/public/events/${f.eventId}/queue`)).json()) as { ticket: string };
    expect((await post(u.cookie, f.eventId, [f.seatIds[0]], { 'x-queue-ticket': q.ticket })).status).toBe(201);
    await redis.flushdb();
    expect((await post(u.cookie, f.eventId, [f.seatIds[1]], { 'x-queue-ticket': q.ticket })).status).toBe(403);
  });

  it('fails open when Redis is broken', async () => {
    const broken = new Proxy({} as Redis, { get: () => () => Promise.reject(new Error('down')) });
    const bt = await makeApp({ redis: broken });
    const f = await makeTenantFixture(bt);
    await bt.db.execute(sql`update events set admission_limit = 1 where id = ${f.eventId}::uuid`);
    const u = await makeUser(bt, 'u');
    const res = await post(u.cookie, f.eventId, [f.seatIds[0]], { 'x-queue-ticket': 'whatever' }, bt.app);
    expect(res.status).toBe(201);
    await bt.close();
  });

  it('limits to 60 requests per minute per user', async () => {
    const f = await openFixture();
    const u = await makeUser(t, 'u');
    for (let i = 0; i < 60; i++) expect((await post(u.cookie, f.eventId, [f.seatIds[0]])).status).toBe(201);
    expect((await post(u.cookie, f.eventId, [f.seatIds[0]])).status).toBe(429);
  });

  it('GET and DELETE are buyer only', async () => {
    const f = await openFixture();
    const a = await makeUser(t, 'a');
    const b = await makeUser(t, 'b');
    const { hold } = (await (await post(a.cookie, f.eventId, [f.seatIds[0]])).json()) as { hold: { id: string } };
    expect((await call(t.app, b.cookie, 'GET', `/holds/${hold.id}`)).status).toBe(404);
    expect((await call(t.app, b.cookie, 'DELETE', `/holds/${hold.id}`)).status).toBe(404);
    expect((await call(t.app, a.cookie, 'GET', `/holds/${hold.id}`)).status).toBe(200);
    expect((await call(t.app, a.cookie, 'DELETE', `/holds/${hold.id}`)).status).toBe(204);
    expect((await call(t.app, a.cookie, 'GET', `/holds/${hold.id}`)).status).toBe(404);
  });
});
