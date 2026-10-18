import { Worker } from 'bullmq';
import type { Redis } from 'ioredis';
import type { Db } from '@standing/db';
import { DOCUMENT_QUEUE } from '@standing/core';
import type { Clock } from '@standing/shared';
import { processDocument } from './processor';

/** `redis` must be created with `maxRetriesPerRequest: null` (BullMQ requirement for workers). */
export function startDocumentWorker(db: Db, redis: Redis, deps: { clock: Clock; ticketSecret: string }): Worker {
  const worker = new Worker<{ documentId: string }>(
    DOCUMENT_QUEUE,
    async (job) => processDocument(db, deps, job.data.documentId),
    { connection: redis, concurrency: 2 },
  );
  worker.on('error', (err) => console.error('[documents] worker error', err.message));
  return worker;
}
