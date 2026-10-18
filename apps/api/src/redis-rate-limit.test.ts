import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import { FakeClock } from '@standing/shared';
import { errorHandler } from './errors';
import { redisRateLimit } from './redis-rate-limit';
import { connectTestRedis } from './test-helpers';

let redis: Redis;
let clock: FakeClock;
beforeAll(async () => {
  redis = await connectTestRedis();
});
afterAll(async () => {
  await redis.quit();
});
beforeEach(async () => {
  await redis.flushdb();
  clock = new FakeClock(new Date('2026-01-05T08:00:00Z'));
});

const appWith = (r: Redis | undefined) =>
  new Hono()
    .onError(errorHandler)
    .get('/x', redisRateLimit({ redis: r, clock, prefix: 't', windowMs: 60_000, max: 3, key: (c) => c.req.header('x-k') ?? 'k' }), (c) =>
      c.json({ ok: true }),
    );
const hit = (app: ReturnType<typeof appWith>, k = 'a') => app.request('/x', { headers: { 'x-k': k } });

describe('redisRateLimit', () => {
  it('allows max requests per window then answers 429 with the standard body', async () => {
    const app = appWith(redis);
    for (let i = 0; i < 3; i++) expect((await hit(app)).status).toBe(200);
    const res = await hit(app);
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: { code: 'rate_limited', message: 'Too many requests, slow down' } });
  });
  it('resets when the window passes', async () => {
    const app = appWith(redis);
    for (let i = 0; i < 4; i++) await hit(app);
    clock.advanceMs(60_000);
    expect((await hit(app)).status).toBe(200);
  });
  it('keeps keys independent', async () => {
    const app = appWith(redis);
    for (let i = 0; i < 4; i++) await hit(app, 'a');
    expect((await hit(app, 'b')).status).toBe(200);
  });
  it('fails open when Redis throws', async () => {
    const broken = { incr: async () => { throw new Error('down'); } } as unknown as Redis;
    const app = appWith(broken);
    for (let i = 0; i < 6; i++) expect((await hit(app)).status).toBe(200);
  });
});
