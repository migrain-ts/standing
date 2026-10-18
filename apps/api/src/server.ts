import { serve } from '@hono/node-server';
import { createRedis } from '@standing/core';
import { createDb, runMigrations } from '@standing/db';
import { numberFromEnv, SystemClock } from '@standing/shared';
import { createAppWithServices } from './app';
import { loadConfig } from './config';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db } = createDb(url);
await runMigrations(db);
const config = loadConfig();
if (process.env.SEED_DEMO === '1') {
  // @ts-expect-error seed arrives in Task 17
  const { seedDemo } = await import('./seed');
  console.log('[api] demo seed', await seedDemo(db, new SystemClock()));
}
const redis = process.env.REDIS_URL ? createRedis(process.env.REDIS_URL) : undefined;
const { app, svc } = createAppWithServices({
  db,
  clock: new SystemClock(),
  config,
  appUrl: process.env.APP_URL ?? 'http://localhost:3200',
  secureCookies: process.env.NODE_ENV === 'production' && process.env.INSECURE_COOKIES !== '1',
  trustProxy: process.env.TRUST_PROXY === '1',
  ...(redis ? { redis, liveSub: redis.duplicate() } : {}),
});
await svc.liveBus.start();
const port = numberFromEnv(process.env.API_PORT, 4100);
serve({ fetch: app.fetch, port }, () => console.log(`[api] listening on :${port}`));
