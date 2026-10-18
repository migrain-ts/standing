import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { enqueueDocument } from '@standing/core';
import { schema, type Db } from '@standing/db';
import type { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { connectQueueRedis, insertTicketDocument, makeDocQueue, makeWorkerDb } from '../test-helpers';
import { startDocumentWorker } from './queue';
import { sweepDocuments } from './sweeper';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
let redis: Redis;
let queue: Queue;
const workers: Worker[] = [];
beforeAll(async () => {
  t = await makeWorkerDb();
  redis = await connectQueueRedis();
  queue = makeDocQueue(redis);
});
afterAll(async () => {
  await Promise.all(workers.map((w) => w.close()));
  await queue.close();
  redis.disconnect();
  await t.close();
});
const rowStatus = async (id: string) =>
  (await t.db.select({ status: schema.documents.status }).from(schema.documents).where(eq(schema.documents.id, id)))[0]?.status;

describe('BullMQ-level job failure', () => {
  it('leaves no retained job behind, so the sweeper can re-add a document that stayed queued', async () => {
    // A Postgres blip: every claim throws outside processDocument's fenced catch, so BullMQ exhausts its 3 attempts.
    const broken = new Proxy(t.db, {
      get: (target, prop, recv) => (prop === 'execute' ? () => Promise.reject(new Error('postgres blip')) : Reflect.get(target, prop, recv)),
    }) as Db;
    const d = await insertTicketDocument(t.db, { seats: 1, at: t.clock.now() });
    const failing = startDocumentWorker(broken, redis, { clock: t.clock, ticketSecret: 's' });
    workers.push(failing);
    const exhausted = new Promise<void>((resolve) => failing.on('failed', (job) => job && job.attemptsMade >= 3 && resolve()));
    await enqueueDocument(queue, d.documentId);
    await exhausted;
    await failing.close();
    await new Promise((r) => setTimeout(r, 300));

    expect(await queue.getJob(d.documentId)).toBeUndefined();
    expect(await rowStatus(d.documentId)).toBe('queued');

    const good = startDocumentWorker(t.db, redis, { clock: t.clock, ticketSecret: 's' });
    workers.push(good);
    t.clock.advanceMs(31_000);
    expect(await sweepDocuments(t.db, queue, t.clock)).toBe(1);
    for (let i = 0; i < 100 && (await rowStatus(d.documentId)) !== 'ready'; i++) await new Promise((r) => setTimeout(r, 100));
    expect(await rowStatus(d.documentId)).toBe('ready');
  });
});
