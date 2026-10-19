import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { liveChannel, type EventDelta } from '@standing/core';
import { connectTestRedis } from '../test-helpers';
import { LiveBus } from './live-bus';

let redis: Redis;
beforeAll(async () => {
  redis = await connectTestRedis();
});
afterAll(async () => {
  await redis.quit();
});

const delta = (eventId: string): EventDelta => ({ eventId, tenantId: 't', tickets: 1, revenueCents: 100, seats: [{ idx: 1, sectionId: 's' }], scanned: 0, at: '2026-01-05T08:00:00.000Z' });
const until = async (fn: () => boolean, ms = 1500) => {
  const end = Date.now() + ms;
  while (!fn() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
};

const waitFor = async (fn: () => boolean, what: string, ms = 5000) => {
  await until(fn, ms);
  if (!fn()) throw new Error(`timed out waiting for ${what}`);
};

/**
 * start() does not wait for the psubscribe, so wait until a probe message really comes through (no fixed sleep; a
 * slow CI machine just polls longer). PUBSUB NUMPAT is server-wide and would count other subscribers.
 */
async function ready(bus: LiveBus) {
  const probe = `probe-${Math.random().toString(36).slice(2)}`;
  let got = false;
  const off = bus.subscribe(probe, () => { got = true; });
  const end = Date.now() + 5000;
  while (!got && Date.now() < end) {
    await redis.publish(liveChannel(probe), JSON.stringify(delta(probe)));
    await until(() => got, 50);
  }
  off();
  if (!got) throw new Error('LiveBus never received the probe');
}

/** Messages of one connection arrive in order: once a later marker is delivered, every earlier message was too. */
async function barrier(bus: LiveBus) {
  const marker = `marker-${Math.random().toString(36).slice(2)}`;
  let got = false;
  const off = bus.subscribe(marker, () => { got = true; });
  await redis.publish(liveChannel(marker), JSON.stringify(delta(marker)));
  await waitFor(() => got, 'the marker');
  off();
}

describe('LiveBus', () => {
  it('delivers only to subscribers of that event, and unsubscribe removes the listener', async () => {
    const bus = new LiveBus(redis.duplicate());
    await bus.start();
    await ready(bus);
    const a: EventDelta[] = [];
    const b: EventDelta[] = [];
    const offA = bus.subscribe('ev-a', (d) => a.push(d));
    bus.subscribe('ev-b', (d) => b.push(d));
    expect(bus.listenerCount('ev-a')).toBe(1);
    await redis.publish(liveChannel('ev-a'), JSON.stringify(delta('ev-a')));
    await waitFor(() => a.length === 1, 'the ev-a delta');
    expect(a).toEqual([delta('ev-a')]);
    expect(b).toEqual([]);
    offA();
    expect(bus.listenerCount('ev-a')).toBe(0);
    await redis.publish(liveChannel('ev-a'), JSON.stringify(delta('ev-a')));
    await barrier(bus);
    expect(a).toHaveLength(1);
    await bus.stop();
  });

  it('ignores and logs malformed messages and keeps delivering', async () => {
    const log = vi.fn();
    const bus = new LiveBus(redis.duplicate(), log);
    await bus.start();
    await ready(bus);
    const got: EventDelta[] = [];
    bus.subscribe('ev-c', (d) => got.push(d));
    await redis.publish(liveChannel('ev-c'), '{not json');
    await redis.publish(liveChannel('ev-c'), JSON.stringify({ nope: 1 }));
    await redis.publish(liveChannel('ev-c'), JSON.stringify(delta('ev-c')));
    await waitFor(() => got.length === 1, 'the valid ev-c delta');
    expect(got).toHaveLength(1);
    expect(log.mock.calls.filter(([l]) => String(l).includes("malformed"))).toHaveLength(2);
    await bus.stop();
  });

  it('stop is idempotent', async () => {
    const bus = new LiveBus(redis.duplicate());
    await bus.start();
    await bus.stop();
    await expect(bus.stop()).resolves.toBeUndefined();
  });

  it('without Redis it starts and never delivers', async () => {
    const bus = new LiveBus(undefined);
    await bus.start();
    const got: EventDelta[] = [];
    const off = bus.subscribe('ev-d', (d) => got.push(d));
    expect(bus.listenerCount('ev-d')).toBe(1);
    await redis.publish(liveChannel('ev-d'), JSON.stringify(delta('ev-d')));
    await new Promise((r) => setTimeout(r, 100));
    expect(got).toEqual([]);
    off();
    await bus.stop();
  });

  it('start() returns quickly when Redis is unreachable, and subscribe still works', async () => {
    const dead = new Redis('redis://127.0.0.1:1', { enableOfflineQueue: false, maxRetriesPerRequest: 1, retryStrategy: () => 200 });
    dead.on('error', () => {});
    const bus = new LiveBus(dead, () => {});
    const t0 = Date.now();
    await bus.start();
    expect(Date.now() - t0).toBeLessThan(2000);
    const got: EventDelta[] = [];
    const off = bus.subscribe('ev-e', (d) => got.push(d));
    expect(bus.listenerCount('ev-e')).toBe(1);
    off();
    expect(got).toEqual([]);
    await bus.stop();
  });

  it('calling start() twice delivers each message exactly once', async () => {
    const bus = new LiveBus(redis.duplicate());
    await bus.start();
    await bus.start();
    const got: EventDelta[] = [];
    bus.subscribe('ev-f', (d) => got.push(d));
    expect(bus.listenerCount('ev-f')).toBe(1);
    await ready(bus);
    await redis.publish(liveChannel('ev-f'), JSON.stringify(delta('ev-f')));
    await waitFor(() => got.length >= 1, 'the ev-f delta');
    await barrier(bus); // a duplicate subscription would deliver its copy before the marker
    expect(got).toHaveLength(1);
    await bus.stop();
  });
});
