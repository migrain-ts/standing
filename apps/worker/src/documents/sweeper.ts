import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';
import { enqueueDocument, type DocumentQueue } from '@standing/core';
import type { Clock } from '@standing/shared';

/**
 * Postgres is the source of truth for documents; Redis may lose the queue. Re-adds every document that is still
 * queued after 30 s, and first resets crashed `running` ones (no update for 2 min) to queued. jobId = documentId dedupes.
 */
export async function sweepDocuments(
  db: Db,
  queue: DocumentQueue,
  clock: Clock,
  opts: { queuedAfterMs?: number; runningAfterMs?: number; limit?: number; log?: (msg: string, err: unknown) => void } = {},
): Promise<number> {
  const now = clock.now();
  const queuedBefore = new Date(now.getTime() - (opts.queuedAfterMs ?? 30_000));
  const runningBefore = new Date(now.getTime() - (opts.runningAfterMs ?? 120_000));
  const reset = await db.execute(sql`
    update documents set status = 'queued', updated_at = ${now}::timestamptz
    where status = 'running' and updated_at < ${runningBefore}::timestamptz returning id`);
  const stale = await db.execute(sql`
    select id from documents where status = 'queued' and updated_at < ${queuedBefore}::timestamptz
    order by created_at limit ${opts.limit ?? 100}`);
  const ids = new Set([...reset.rows, ...stale.rows].map((r) => String(r.id)));
  let added = 0;
  for (const id of ids) if (await enqueueDocument(queue, id, opts.log)) added++;
  return added;
}
