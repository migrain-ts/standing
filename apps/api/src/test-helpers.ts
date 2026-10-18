import { createHash, randomBytes } from 'node:crypto';
import { createRedis } from '@standing/core';
import { createTestDb, schema } from '@standing/db';
import type { Redis } from 'ioredis';
import { FakeClock } from '@standing/shared';
import { createApp, type AppConfig, type Deps } from './app';
import { createSession } from './auth/sessions';

export const testConfig: AppConfig = {
  holdTtlSeconds: 600,
  paymentLatencyMs: 0,
  paymentFailureRate: 0,
  ticketSecret: 'test-ticket-secret',
  demoLogin: false,
};

export type TestApp = Awaited<ReturnType<typeof makeApp>>;

export async function makeApp(
  opts: Partial<Pick<Deps, 'trustProxy' | 'redis'>> & { config?: Partial<AppConfig> } = {},
) {
  const t = await createTestDb();
  const clock = new FakeClock(new Date('2026-01-05T08:00:00Z'));
  const deps: Deps = {
    db: t.db,
    clock,
    config: { ...testConfig, ...opts.config },
    appUrl: 'http://localhost:3200',
    ...(opts.trustProxy === undefined ? {} : { trustProxy: opts.trustProxy }),
    ...(opts.redis === undefined ? {} : { redis: opts.redis }),
  };
  const app = createApp(deps);
  return { app, deps, db: t.db, pool: t.pool, clock, close: t.close };
}

export function call(
  app: { request: (path: string, init?: RequestInit) => Response | Promise<Response> },
  cookie: string | null,
  method: string,
  path: string,
  body?: unknown,
  extraHeaders: Record<string, string> = {},
) {
  const headers: Record<string, string> = { ...extraHeaders };
  if (cookie) headers.cookie = cookie;
  if (body !== undefined) headers['content-type'] = 'application/json';
  return app.request(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

let counter = 0;
export async function register(
  app: Parameters<typeof call>[0],
  email = `user${++counter}@example.com`,
  name = 'Test User',
) {
  const res = await call(app, null, 'POST', '/auth/register', {
    email,
    password: 'correct horse battery',
    name,
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const cookie = res.headers.get('set-cookie')?.split(';')[0];
  if (!cookie) throw new Error('no session cookie');
  const body = (await res.json()) as { user: { id: string; email: string } };
  return { cookie, user: body.user };
}

/** A user with a live session, inserted directly (no password hashing). */
export async function makeUser(t: Pick<TestApp, 'db' | 'clock'>, name: string) {
  const [u] = await t.db
    .insert(schema.users)
    .values({
      email: `${name}-${randomBytes(4).toString('hex')}@example.com`,
      passwordHash: 'x',
      name,
    })
    .returning();
  if (!u) throw new Error('user insert failed');
  const token = await createSession(t.db, u.id, t.clock.now());
  return { id: u.id, cookie: `sid=${token}`, token };
}

export const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');

export async function connectTestRedis(): Promise<Redis> {
  const redis = createRedis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/15', () => {});
  if (redis.status !== 'ready')
    await new Promise<void>((resolve, reject) => {
      redis.once('ready', () => resolve());
      redis.once('end', () => reject(new Error('test Redis unavailable')));
    });
  await redis.flushdb(); // logical database 15 only; never db 0
  return redis;
}
