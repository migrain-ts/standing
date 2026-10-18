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
