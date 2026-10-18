import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import { FakeClock } from '@standing/shared';
import { connectTestRedis } from '../test-helpers';
import { checkGate, WaitingRoom } from './waiting-room';

let redis: Redis;
let clock: FakeClock;
let room: WaitingRoom;
beforeAll(async () => {
  redis = await connectTestRedis();
});
afterAll(async () => {
  await redis.quit();
});
beforeEach(async () => {
  await redis.flushdb();
  clock = new FakeClock(new Date('2026-01-05T08:00:00Z'));
  room = new WaitingRoom(redis, clock, { activeTtlMs: 60_000 });
});

describe('WaitingRoom', () => {
  it('admits up to capacity in arrival order and queues the rest with positions', async () => {
    const a = await room.join('e1', 2);
    const b = await room.join('e1', 2);
    const c = await room.join('e1', 2);
    const d = await room.join('e1', 2);
    expect([a.state, b.state, c.state, d.state]).toEqual(['admitted', 'admitted', 'waiting', 'waiting']);
    expect(c).toMatchObject({ state: 'waiting', position: 1, queueLength: 1 });
    expect(d).toMatchObject({ state: 'waiting', position: 2, queueLength: 2 });
  });
  it('admits the next in line when a place is released', async () => {
    const a = await room.join('e1', 1);
    const b = await room.join('e1', 1);
    expect(b.state).toBe('waiting');
    await room.release('e1', a.ticket);
    expect(await room.status('e1', b.ticket, 1)).toMatchObject({ state: 'admitted' });
  });
  it('lets an admission expire after the active ttl so the queue keeps moving', async () => {
    const a = await room.join('e1', 1);
    const b = await room.join('e1', 1);
    clock.advanceMs(60_001);
    expect(await room.isAdmitted('e1', a.ticket)).toBe(false);
    expect((await room.status('e1', b.ticket, 1)).state).toBe('admitted');
  });
  it('does not admit unknown tickets and forgets everything when Redis is flushed', async () => {
    const a = await room.join('e1', 1);
    expect(await room.isAdmitted('e1', 'forged')).toBe(false);
    await redis.flushdb();
    expect(await room.status('e1', a.ticket, 1)).toEqual({ state: 'unknown' });
    expect(await room.isAdmitted('e1', a.ticket)).toBe(false);
  });
  it('keeps events independent', async () => {
    await room.join('e1', 1);
    expect((await room.join('e2', 1)).state).toBe('admitted');
  });
  it('under 200 simultaneous joins admits exactly the capacity and numbers the rest 1..N without gaps', async () => {
    const joined = await Promise.all(Array.from({ length: 200 }, () => room.join('e1', 50)));
    const final = await Promise.all(joined.map((j) => room.status('e1', j.ticket, 50)));
    expect(final.filter((s) => s.state === 'admitted')).toHaveLength(50);
    const positions = final.flatMap((s) => (s.state === 'waiting' ? [s.position] : [])).sort((x, y) => x - y);
    expect(positions).toEqual(Array.from({ length: 150 }, (_, i) => i + 1));
    expect(await room.stats('e1')).toEqual({ waiting: 150, active: 50 });
  });
});

describe('checkGate', () => {
  it('is open without a room or with admissionLimit 0', async () => {
    expect(await checkGate(undefined, 'e1', undefined, 200)).toBe('open');
    expect(await checkGate(room, 'e1', undefined, 0)).toBe('open');
  });
  it('admits an admitted ticket and denies a missing, forged or waiting one', async () => {
    const a = await room.join('e1', 1);
    const b = await room.join('e1', 1);
    expect(await checkGate(room, 'e1', a.ticket, 1)).toBe('admitted');
    expect(await checkGate(room, 'e1', b.ticket, 1)).toBe('denied');
    expect(await checkGate(room, 'e1', undefined, 1)).toBe('denied');
    expect(await checkGate(room, 'e1', 'forged', 1)).toBe('denied');
  });
  it('fails open when Redis errors', async () => {
    const broken = { zscore: async () => { throw new Error('down'); } } as unknown as Redis;
    const logged: string[] = [];
    expect(await checkGate(new WaitingRoom(broken, clock), 'e1', 'x', 1, (l) => logged.push(l))).toBe('open');
    expect(logged.length).toBe(1);
  });
});
