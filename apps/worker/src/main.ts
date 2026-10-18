import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { createRedis, DOCUMENT_QUEUE, liveChannel } from '@standing/core';
import { createDb } from '@standing/db';
import { numberFromEnv, SystemClock } from '@standing/shared';
import { runCycle, type CycleState } from './cycle';
import { startDocumentWorker } from './documents/queue';
import { sweepDocuments } from './documents/sweeper';
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

// Document jobs: BullMQ needs its own connection (maxRetriesPerRequest null); the sweeper re-adds anything Redis lost.
const ticketSecret = process.env.TICKET_SECRET ?? (process.env.NODE_ENV === 'production' ? undefined : 'dev-only-ticket-secret-change-me');
if (process.env.REDIS_URL && !ticketSecret) throw new Error('TICKET_SECRET is required in production');
const queueRedis = process.env.REDIS_URL && ticketSecret ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null }) : undefined;
const docs = queueRedis && ticketSecret
  ? { queue: new Queue(DOCUMENT_QUEUE, { connection: queueRedis }), worker: startDocumentWorker(db, queueRedis, { clock, ticketSecret }) }
  : undefined;
const sweepTimer = docs
  ? setInterval(() => {
      sweepDocuments(db, docs.queue, clock).catch((err) => console.error('[worker] document sweep failed', err));
    }, 10_000)
  : undefined;

const lifecycle = createLifecycle({
  pool: {
    end: async () => {
      if (sweepTimer) clearInterval(sweepTimer);
      await docs?.worker.close();
      await docs?.queue.close();
      queueRedis?.disconnect();
      redis?.disconnect();
      await pool.end();
    },
  },
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
