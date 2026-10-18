import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { enqueueDocument } from '@standing/core';
import { schema } from '@standing/db';
import type { Queue, Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import { connectQueueRedis, insertTicketDocument, makeDocQueue, makeWorkerDb } from '../test-helpers';
import { startDocumentWorker } from './queue';
import { sweepDocuments } from './sweeper';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
let redis: Redis;
let queue: Queue;
let worker: Worker;
beforeAll(async () => {
  t = await makeWorkerDb();
  redis = await connectQueueRedis();
  queue = makeDocQueue(redis);
  worker = startDocumentWorker(t.db, redis, { clock: t.clock, ticketSecret: 'integration-secret' });
  await worker.waitUntilReady();
});
afterAll(async () => {
  await worker.close();
  await queue.close();
  redis.disconnect();
  await t.close();
});
const waitReady = async (id: string) => {
  for (let i = 0; i < 100; i++) {
    const [d] = await t.db.select({ status: schema.documents.status }).from(schema.documents).where(eq(schema.documents.id, id));
    if (d?.status === 'ready') return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('document did not become ready within 10 s');
};

describe('document queue', () => {
  it('renders an enqueued ticket document', async () => {
    const d = await insertTicketDocument(t.db, { seats: 2, at: t.clock.now() });
    expect(await enqueueDocument(queue, d.documentId)).toBe(true);
    await waitReady(d.documentId);
  });

  it('recovers a sale after Redis lost the queue (sweeper re-adds)', async () => {
    await redis.flushdb();
    const d = await insertTicketDocument(t.db, { seats: 1, at: t.clock.now() }); // never enqueued
    t.clock.advanceMs(31_000);
    expect(await sweepDocuments(t.db, queue, t.clock)).toBe(1);
    await waitReady(d.documentId);
  });
});
