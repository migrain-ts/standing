import type { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertPaidOrder, rebuildRollups } from '@standing/db';
import { liveChannel, type EventDelta } from '@standing/core';
import { makeTenantFixture, type TenantFixture } from '../fixtures';
import { call, connectTestRedis, makeApp, makeUser, type TestApp } from '../test-helpers';

let t: TestApp;
let f: TenantFixture;
let redis: Redis;
beforeAll(async () => {
  redis = await connectTestRedis();
  t = await makeApp({ redis });
  f = await makeTenantFixture(t);
  const buyer = await makeUser(t, 'buyer');
  await insertPaidOrder(t.db, { tenantId: f.tenantId, eventId: f.eventId, buyerId: buyer.id, seatIds: [f.seatIds[0] ?? ''], at: t.clock.now() });
  await rebuildRollups(t.db, f.eventId);
});
afterAll(async () => {
  await t.close();
  await redis.quit();
});

const snap = (tenant: string, ev: string) => `/tenants/${tenant}/events/${ev}/live/snapshot`;
const live = (tenant: string, ev: string) => `/tenants/${tenant}/events/${ev}/live`;

type Snap = { totals: { sold: number; queue: unknown }; capacity: number };

describe('GET live/snapshot', () => {
  it('is 200 for a manager with real data (positive control)', async () => {
    const res = await call(t.app, f.manager.cookie, 'GET', snap(f.tenantId, f.eventId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Snap;
    expect(body.totals.sold).toBe(1);
    expect(body.capacity).toBe(f.seatIds.length);
    expect(body.totals.queue).toEqual({ waiting: 0, active: 0 });
  });
  it('is 403 for door, 404 for an outsider, 401 anonymous', async () => {
    expect((await call(t.app, f.door.cookie, 'GET', snap(f.tenantId, f.eventId))).status).toBe(403);
    expect((await call(t.app, f.outsider.cookie, 'GET', snap(f.tenantId, f.eventId))).status).toBe(404);
    expect((await call(t.app, null, 'GET', snap(f.tenantId, f.eventId))).status).toBe(401);
  });
  it('404s a foreign event id under your own tenant path, while the owner of that event gets 200', async () => {
    expect((await call(t.app, f.manager.cookie, 'GET', snap(f.tenantId, f.outsiderEventId))).status).toBe(404);
    expect((await call(t.app, f.manager.cookie, 'GET', live(f.tenantId, f.outsiderEventId))).status).toBe(404);
    expect((await call(t.app, f.outsider.cookie, 'GET', snap(f.outsiderTenantId, f.outsiderEventId))).status).toBe(200);
  });
});

async function readUntil(reader: ReadableStreamDefaultReader<Uint8Array>, needle: string, acc = { text: '' }, ms = 2000) {
  const dec = new TextDecoder();
  const end = Date.now() + ms;
  while (!acc.text.includes(needle) && Date.now() < end) {
    const r = await Promise.race([reader.read(), new Promise<null>((res) => setTimeout(() => res(null), 200))]);
    if (r === null) continue;
    if (r.done) break;
    acc.text += dec.decode(r.value);
  }
  return acc.text;
}
const waitFor = async (fn: () => boolean, ms = 500) => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
};

describe('GET live (SSE)', () => {
  it('rejects door and outsider before opening a stream', async () => {
    expect((await call(t.app, f.door.cookie, 'GET', live(f.tenantId, f.eventId))).status).toBe(403);
    expect((await call(t.app, f.outsider.cookie, 'GET', live(f.tenantId, f.eventId))).status).toBe(404);
  });

  it('sends retry first, ticks, relays deltas, and unsubscribes on cancel', async () => {
    const w = await makeApp({ redis, liveSub: true });
    const f2 = await makeTenantFixture(w);
    w.deps.liveTickMs = 50;
    const bus = w.svc.liveBus;
    await bus.start();
    const res = await call(w.app, f2.manager.cookie, 'GET', live(f2.tenantId, f2.eventId));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    expect(res.headers.get('cache-control')).toBe('no-cache');
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const acc = { text: '' };
    await readUntil(reader, 'event: tick', acc);
    expect(acc.text.startsWith('retry: 2000')).toBe(true);
    expect(acc.text).toContain('event: tick');
    expect(bus.listenerCount(f2.eventId)).toBe(1);
    const d: EventDelta = { eventId: f2.eventId, tenantId: f2.tenantId, tickets: 1, revenueCents: 5, seats: [], scanned: 0, at: w.clock.now().toISOString() };
    await redis.publish(liveChannel(f2.eventId), JSON.stringify(d));
    await readUntil(reader, 'event: delta', acc);
    expect(acc.text).toContain('event: delta');
    await reader.cancel();
    await waitFor(() => bus.listenerCount(f2.eventId) === 0);
    expect(bus.listenerCount(f2.eventId)).toBe(0);
    await bus.stop();
    await w.close();
  });

  it('still ticks without Redis', async () => {
    const w = await makeApp();
    const f2 = await makeTenantFixture(w);
    w.deps.liveTickMs = 50;
    const res = await call(w.app, f2.manager.cookie, 'GET', live(f2.tenantId, f2.eventId));
    const reader = res.body?.getReader();
    if (!reader) throw new Error('no body');
    const text = await readUntil(reader, 'event: tick');
    expect(text).toContain('event: tick');
    await reader.cancel();
    await w.close();
  });

  it('shares one totals computation between viewers within the TTL window', async () => {
    let loads = 0;
    const w = await makeApp({ wrapTotalsLoader: (load) => (k) => { loads++; return load(k); } });
    const f2 = await makeTenantFixture(w);
    const rs = await Promise.all([
      call(w.app, f2.manager.cookie, 'GET', snap(f2.tenantId, f2.eventId)),
      call(w.app, f2.owner.cookie, 'GET', snap(f2.tenantId, f2.eventId)),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect(loads).toBe(1);
    w.clock.advanceMs(1500);
    expect((await call(w.app, f2.manager.cookie, 'GET', snap(f2.tenantId, f2.eventId))).status).toBe(200);
    expect(loads).toBe(2);
    await w.close();
  });
});
