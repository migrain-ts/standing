import type { Redis } from 'ioredis';
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

describe('LiveBus', () => {
  it('delivers only to subscribers of that event, and unsubscribe removes the listener', async () => {
    const bus = new LiveBus(redis.duplicate());
    await bus.start();
    const a: EventDelta[] = [];
    const b: EventDelta[] = [];
    const offA = bus.subscribe('ev-a', (d) => a.push(d));
    bus.subscribe('ev-b', (d) => b.push(d));
    expect(bus.listenerCount('ev-a')).toBe(1);
    await redis.publish(liveChannel('ev-a'), JSON.stringify(delta('ev-a')));
    await until(() => a.length === 1);
    expect(a).toEqual([delta('ev-a')]);
    expect(b).toEqual([]);
    offA();
    expect(bus.listenerCount('ev-a')).toBe(0);
    await redis.publish(liveChannel('ev-a'), JSON.stringify(delta('ev-a')));
    await new Promise((r) => setTimeout(r, 100));
    expect(a).toHaveLength(1);
    await bus.stop();
  });

  it('ignores and logs malformed messages and keeps delivering', async () => {
    const log = vi.fn();
    const bus = new LiveBus(redis.duplicate(), log);
    await bus.start();
    const got: EventDelta[] = [];
    bus.subscribe('ev-c', (d) => got.push(d));
    await redis.publish(liveChannel('ev-c'), '{not json');
    await redis.publish(liveChannel('ev-c'), JSON.stringify({ nope: 1 }));
    await redis.publish(liveChannel('ev-c'), JSON.stringify(delta('ev-c')));
    await until(() => got.length === 1);
    expect(got).toHaveLength(1);
    expect(log).toHaveBeenCalledTimes(2);
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
});
