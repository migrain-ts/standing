import { createTestDb, insertEventFixture } from '@standing/db';
import { FakeClock } from '@standing/shared';

export async function makeWorkerDb() {
  const t = await createTestDb();
  const clock = new FakeClock(new Date('2026-01-05T08:00:00Z'));
  return { ...t, clock };
}

export async function makeBuyer(db: Awaited<ReturnType<typeof makeWorkerDb>>['db'], name: string) {
  const { schema } = await import('@standing/db');
  const [u] = await db.insert(schema.users).values({ email: `${name}-${Math.random().toString(36).slice(2, 8)}@example.com`, passwordHash: 'x', name }).returning();
  return u!.id;
}

export { insertEventFixture };

import { Redis } from 'ioredis';
import { Queue } from 'bullmq';
import { DOCUMENT_QUEUE } from '@standing/core';

/** Test Redis (logical db 15 only), flushed; BullMQ-compatible (maxRetriesPerRequest null). */
export async function connectQueueRedis(): Promise<Redis> {
  const redis = new Redis(process.env.TEST_REDIS_URL ?? 'redis://localhost:6380/15', { maxRetriesPerRequest: null });
  await redis.flushdb();
  return redis;
}
export const makeDocQueue = (redis: Redis) => new Queue(DOCUMENT_QUEUE, { connection: redis });

export async function insertTicketDocument(
  db: Awaited<ReturnType<typeof makeWorkerDb>>['db'],
  o: { seats: number; at: Date; status?: 'queued' | 'running' | 'ready' | 'failed' },
) {
  const { insertPaidOrder, schema } = await import('@standing/db');
  const f = await insertEventFixture(db, { rows: 2, seatsPerRow: 10, priceCents: 2500 });
  const buyer = await makeBuyer(db, 'b');
  const { orderId } = await insertPaidOrder(db, {
    eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: f.seatIds.slice(0, o.seats), at: o.at,
  });
  const [doc] = await db.insert(schema.documents).values({
    tenantId: f.tenantId, kind: 'ticket_pdf', orderId, eventId: f.eventId, requestedBy: buyer,
    status: o.status ?? 'queued', createdAt: o.at, updatedAt: o.at,
  }).returning({ id: schema.documents.id });
  return { f, orderId, buyer, documentId: doc!.id };
}
