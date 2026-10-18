import type { Db } from '@standing/db';
import type { Clock } from '@standing/shared';
import { releaseExpiredHolds } from './cleanup';
import { refreshDailySales } from './matview';
import { projectOutbox, type Publisher } from './projector';

export type CycleState = { lastRefreshAt: number };

export async function runCycle(
  db: Db,
  deps: { clock: Clock; publish?: Publisher; state: CycleState; refreshEveryMs?: number; batchSize?: number },
) {
  const batchSize = deps.batchSize ?? 200;
  let projected = 0;
  for (let i = 0; i < 20; i++) {
    const r = await projectOutbox(db, { clock: deps.clock, batchSize, ...(deps.publish ? { publish: deps.publish } : {}) });
    projected += r.processed;
    if (r.processed < batchSize) break;
  }
  const released = await releaseExpiredHolds(db, deps.clock);
  const now = deps.clock.now().getTime();
  if (now - deps.state.lastRefreshAt >= (deps.refreshEveryMs ?? 60_000)) {
    await refreshDailySales(db);
    deps.state.lastRefreshAt = now;
  }
  return { projected, released };
}
