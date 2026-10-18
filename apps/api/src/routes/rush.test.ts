import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { makeTenantFixture } from '../fixtures';
import { call, connectTestRedis, makeApp, type TestApp } from '../test-helpers';
import type { Redis } from 'ioredis';

type Seen = { method: string; path: string; token: string | undefined; body: unknown };
let seen: Seen[] = [];
let reply: { status: number; body: unknown } = { status: 202, body: {} };
let stub: ReturnType<typeof serve>;
let stubUrl: string;
let t: TestApp;
let down: TestApp;
let off: TestApp;
let redis: Redis;

// the simulator answers { id, stats }; the API flattens it to RunStats & { id }
const simRun = { id: 'run-1', stats: { status: 'running', counters: { started: 0 } } };
const run = { id: 'run-1', status: 'running', counters: { started: 0 } };

beforeAll(async () => {
  const sim = new Hono().all('*', async (c) => {
    const text = await c.req.text();
    seen.push({ method: c.req.method, path: new URL(c.req.url).pathname + new URL(c.req.url).search, token: c.req.header('x-simulator-token'), body: text ? JSON.parse(text) : null });
    return c.json(reply.body, reply.status as 200);
  });
  stub = serve({ fetch: sim.fetch, port: 0, hostname: '127.0.0.1' });
  await new Promise<void>((r) => stub.once('listening', () => r()));
  stubUrl = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
  const cfg = { simulatorToken: 'tok', simulatorApiUrl: 'http://api.internal:4100' };
  t = await makeApp({ config: { ...cfg, simulatorUrl: stubUrl } });
  down = await makeApp({ config: { ...cfg, simulatorUrl: 'http://127.0.0.1:1' } });
  off = await makeApp();
  redis = await connectTestRedis();
});
afterAll(async () => {
  await new Promise<void>((r) => stub.close(() => r()));
  await t.close();
  await down.close();
  await off.close();
  redis.disconnect();
});
beforeEach(() => {
  seen = [];
  reply = { status: 202, body: simRun };
});

const url = (tenantId: string, eventId: string) => `/tenants/${tenantId}/events/${eventId}/rush`;

describe('rush routes', () => {
  it('forwards the validated parameters with the token and the API url, defaults applied', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, f.manager.cookie, 'POST', url(f.tenantId, f.eventId), { buyers: 100 });
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ run });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({
      method: 'POST', path: '/runs', token: 'tok',
      body: { eventId: f.eventId, buyers: 100, maxSeatsPerBuyer: 2, durationSeconds: 30, apiUrl: 'http://api.internal:4100' },
    });
  });
  it('rejects 0 and more than 5000 buyers with 400, without calling the simulator', async () => {
    const f = await makeTenantFixture(t);
    for (const buyers of [0, 5001]) expect((await call(t.app, f.manager.cookie, 'POST', url(f.tenantId, f.eventId), { buyers })).status).toBe(400);
    expect((await call(t.app, f.manager.cookie, 'POST', url(f.tenantId, f.eventId), { buyers: 5000 })).status).toBe(202);
    expect(seen).toHaveLength(1);
  });
  it('409 not_published for a draft event, 404 for another tenant\'s event id', async () => {
    const f = await makeTenantFixture(t);
    const draft = await call(t.app, f.manager.cookie, 'POST', url(f.tenantId, f.draftEventId), { buyers: 10 });
    expect(draft.status).toBe(409);
    expect(((await draft.json()) as { error: { code: string } }).error.code).toBe('not_published');
    expect((await call(t.app, f.manager.cookie, 'POST', url(f.tenantId, f.outsiderEventId), { buyers: 10 })).status).toBe(404);
    expect((await call(t.app, f.manager.cookie, 'GET', url(f.tenantId, f.outsiderEventId))).status).toBe(404);
    expect((await call(t.app, f.manager.cookie, 'DELETE', url(f.tenantId, f.outsiderEventId))).status).toBe(404);
    expect(seen).toHaveLength(0);
  });
  it('503 simulator_unavailable when unconfigured or unreachable', async () => {
    for (const app of [off, down]) {
      const f = await makeTenantFixture(app);
      const res = await call(app.app, f.manager.cookie, 'POST', url(f.tenantId, f.eventId), { buyers: 10 });
      expect(res.status).toBe(503);
      expect(((await res.json()) as { error: { code: string } }).error.code).toBe('simulator_unavailable');
    }
  });
  it('passes the simulator\'s 409 rush_running through', async () => {
    const f = await makeTenantFixture(t);
    reply = { status: 409, body: { error: { code: 'rush_running', message: 'A rush is already running for this event' } } };
    const res = await call(t.app, f.manager.cookie, 'POST', url(f.tenantId, f.eventId), { buyers: 10 });
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('rush_running');
  });
  it('GET returns the latest run or null; DELETE stops it with 202', async () => {
    const f = await makeTenantFixture(t);
    const got = await call(t.app, f.manager.cookie, 'GET', url(f.tenantId, f.eventId));
    expect(got.status).toBe(200);
    expect(await got.json()).toEqual({ run });
    expect(seen[0]).toMatchObject({ method: 'GET', path: `/runs?eventId=${f.eventId}`, token: 'tok' });
    reply = { status: 404, body: { error: { code: 'not_found', message: 'No run for this event' } } };
    expect(await (await call(t.app, f.manager.cookie, 'GET', url(f.tenantId, f.eventId))).json()).toEqual({ run: null });
    seen = [];
    reply = { status: 200, body: simRun };
    // DELETE first looks up the latest run, then stops it by id
    const del = await call(t.app, f.manager.cookie, 'DELETE', url(f.tenantId, f.eventId));
    expect(del.status).toBe(202);
    expect(seen.map((s) => `${s.method} ${s.path}`)).toEqual([`GET /runs?eventId=${f.eventId}`, 'DELETE /runs/run-1']);
  });
});

describe('DELETE /public/events/:eventId/queue/:ticket', () => {
  it('releases the admission slot, idempotently, and answers 204 for unknown tickets', async () => {
    const r = await makeApp({ redis });
    try {
      const f = await makeTenantFixture(r);
      const q = `/public/events/${f.eventId}/queue`;
      const a = (await (await call(r.app, f.door.cookie, 'POST', q)).json()) as { ticket: string; state: string };
      expect(a.state).toBe('admitted');
      expect(await redis.zscore(`wr:${f.eventId}:a`, a.ticket)).not.toBeNull();
      expect((await call(r.app, f.door.cookie, 'DELETE', `${q}/${a.ticket}`)).status).toBe(204);
      expect(await redis.zscore(`wr:${f.eventId}:a`, a.ticket)).toBeNull();
      expect((await call(r.app, f.door.cookie, 'DELETE', `${q}/${a.ticket}`)).status).toBe(204);
      expect((await call(r.app, f.door.cookie, 'DELETE', `${q}/never-issued`)).status).toBe(204);
      expect((await call(r.app, null, 'DELETE', `${q}/x`)).status).toBe(401);
    } finally {
      await r.close();
    }
  });
  it('answers 204 without Redis', async () => {
    const f = await makeTenantFixture(off);
    expect((await call(off.app, f.door.cookie, 'DELETE', `/public/events/${f.eventId}/queue/x`)).status).toBe(204);
  });
});
