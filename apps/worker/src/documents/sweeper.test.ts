import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { schema } from '@standing/db';
import type { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { connectQueueRedis, insertTicketDocument, makeDocQueue, makeWorkerDb } from '../test-helpers';
import { sweepDocuments } from './sweeper';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
let redis: Redis;
let queue: Queue;
beforeAll(async () => {
  t = await makeWorkerDb();
  redis = await connectQueueRedis();
  queue = makeDocQueue(redis);
});
afterAll(async () => {
  await queue.close();
  redis.disconnect();
  await t.close();
});
const reset = async () => {
  await queue.obliterate({ force: true });
  await t.db.delete(schema.documents); // other tests' stale rows would be swept too
};
const status = async (id: string) => (await t.db.select().from(schema.documents).where(eq(schema.documents.id, id)))[0]!.status;

describe('sweepDocuments', () => {
  it('adds queued documents older than 30 s and not younger ones', async () => {
    await reset();
    const old = await insertTicketDocument(t.db, { seats: 1, at: new Date(t.clock.now().getTime() - 31_000) });
    const young = await insertTicketDocument(t.db, { seats: 1, at: new Date(t.clock.now().getTime() - 5_000) });
    await sweepDocuments(t.db, queue, t.clock);
    expect(await queue.getJob(old.documentId)).toBeTruthy();
    expect(await queue.getJob(young.documentId)).toBeUndefined();
  });

  it('resets a running document stale for 2 minutes to queued and adds it; ignores ready ones', async () => {
    await reset();
    const stale = await insertTicketDocument(t.db, { seats: 1, at: new Date(t.clock.now().getTime() - 121_000), status: 'running' });
    const fresh = await insertTicketDocument(t.db, { seats: 1, at: new Date(t.clock.now().getTime() - 60_000), status: 'running' });
    const ready = await insertTicketDocument(t.db, { seats: 1, at: new Date(t.clock.now().getTime() - 999_000), status: 'ready' });
    await sweepDocuments(t.db, queue, t.clock);
    expect(await status(stale.documentId)).toBe('queued');
    expect(await queue.getJob(stale.documentId)).toBeTruthy();
    expect(await status(fresh.documentId)).toBe('running');
    expect(await queue.getJob(fresh.documentId)).toBeUndefined();
    expect(await queue.getJob(ready.documentId)).toBeUndefined();
  });

  it('adds each job once when run twice (jobId dedupe)', async () => {
    await reset();
    await insertTicketDocument(t.db, { seats: 1, at: new Date(t.clock.now().getTime() - 60_000) });
    await sweepDocuments(t.db, queue, t.clock);
    await sweepDocuments(t.db, queue, t.clock);
    const counts = await queue.getJobCounts();
    expect(counts.waiting).toBe(1);
  });

  it('puts the job back after Redis was flushed', async () => {
    await reset();
    const d = await insertTicketDocument(t.db, { seats: 1, at: new Date(t.clock.now().getTime() - 60_000) });
    await sweepDocuments(t.db, queue, t.clock);
    await redis.flushdb();
    expect(await queue.getJob(d.documentId)).toBeUndefined();
    await sweepDocuments(t.db, queue, t.clock);
    expect(await queue.getJob(d.documentId)).toBeTruthy();
  });
});
