import { createRedis, liveChannel } from '@standing/core';
import { createDb } from '@standing/db';
import { numberFromEnv, SystemClock } from '@standing/shared';
import { runCycle, type CycleState } from './cycle';
import { createLifecycle } from './lifecycle';
import { redisPublisher } from './projector';

const url = process.env.DATABASE_URL;
if (!url) throw new Error('DATABASE_URL is required');
const { db, pool } = createDb(url);
const redis = process.env.REDIS_URL ? createRedis(process.env.REDIS_URL) : undefined;
const publish = redis ? redisPublisher(redis, liveChannel) : undefined;
const clock = new SystemClock();
const everyMs = numberFromEnv(process.env.CYCLE_MS, 1000);
const state: CycleState = { lastRefreshAt: 0 };

const lifecycle = createLifecycle({
  pool: { end: async () => { redis?.disconnect(); await pool.end(); } },
  cycle: async () => {
    const r = await runCycle(db, { clock, state, ...(publish ? { publish } : {}) });
    return r;
  },
  everyMs,
  log: (line) => {
    const r = JSON.parse(line) as { projected: number; released: { seats: number } };
    if (r.projected > 0 || r.released.seats > 0) console.log(`[worker] ${clock.now().toISOString()} ${line}`);
  },
  logError: (msg, err) => console.error(msg, err),
});

for (const sig of ['SIGTERM', 'SIGINT'] as const) {
  process.on(sig, () => void lifecycle.stop().then(() => process.exit(0)));
}
lifecycle.start();
