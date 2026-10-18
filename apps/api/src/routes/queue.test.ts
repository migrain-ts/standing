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
type Q = { ticket: string; state: string; degraded?: boolean; position?: number };

describe('queue routes', () => {
  it('join then poll reaches admitted', async () => {
    const f = await makeTenantFixture(t);
    await setLimit(f.eventId, 1);
    const u1 = await makeUser(t, 'u1');
    const u2 = await makeUser(t, 'u2');
    const a = (await (await call(t.app, u1.cookie, 'POST', `/public/events/${f.eventId}/queue`)).json()) as Q;
    const b = (await (await call(t.app, u2.cookie, 'POST', `/public/events/${f.eventId}/queue`)).json()) as Q;
    expect(a.state).toBe('admitted');
    expect(b).toMatchObject({ state: 'waiting', position: 1 });
    await redis.zrem(`wr:${f.eventId}:a`, a.ticket);
    const polled = (await (await call(t.app, u2.cookie, 'GET', `/public/events/${f.eventId}/queue/${b.ticket}`)).json()) as Q;
    expect(polled.state).toBe('admitted');
  });
  it('answers degraded when admissionLimit is 0 or there is no Redis', async () => {
    const f = await makeTenantFixture(t);
    await setLimit(f.eventId, 0);
    const u = await makeUser(t, 'u');
    const res = await call(t.app, u.cookie, 'POST', `/public/events/${f.eventId}/queue`);
    expect(await res.json()).toEqual({ ticket: 'open', state: 'admitted', degraded: true });
    const bare = await makeApp();
    const f2 = await makeTenantFixture(bare);
    const u2 = await makeUser(bare, 'u2');
    const res2 = await call(bare.app, u2.cookie, 'GET', `/public/events/${f2.eventId}/queue/whatever`);
    expect(await res2.json()).toEqual({ ticket: 'open', state: 'admitted', degraded: true });
    await bare.close();
  });
  it('is 401 without a session and 404 for an unknown event', async () => {
    const f = await makeTenantFixture(t);
    expect((await call(t.app, null, 'POST', `/public/events/${f.eventId}/queue`)).status).toBe(401);
    const u = await makeUser(t, 'u');
    expect((await call(t.app, u.cookie, 'POST', `/public/events/${f.draftEventId}/queue`)).status).toBe(404);
  });
  it('a flushed Redis turns a polled ticket into unknown', async () => {
    const f = await makeTenantFixture(t);
    await setLimit(f.eventId, 1);
    const u = await makeUser(t, 'u');
    const a = (await (await call(t.app, u.cookie, 'POST', `/public/events/${f.eventId}/queue`)).json()) as Q;
    await redis.flushdb();
    const res = await call(t.app, u.cookie, 'GET', `/public/events/${f.eventId}/queue/${a.ticket}`);
    expect(await res.json()).toEqual({ ticket: a.ticket, state: 'unknown' });
  });
  it('limits joins to 30 per minute per user', async () => {
    const f = await makeTenantFixture(t);
    await setLimit(f.eventId, 1000);
    const u = await makeUser(t, 'u');
    for (let i = 0; i < 30; i++) expect((await call(t.app, u.cookie, 'POST', `/public/events/${f.eventId}/queue`)).status).toBe(200);
    expect((await call(t.app, u.cookie, 'POST', `/public/events/${f.eventId}/queue`)).status).toBe(429);
  });
});
