import { documentJobOptions } from './channels';

/** The slice of a BullMQ Queue that enqueueing needs; keeps core free of the bullmq dependency. */
export type DocumentQueue = {
  add(name: string, data: { documentId: string }, opts: { jobId: string } & typeof documentJobOptions): Promise<unknown>;
};

/**
 * Adds the render job; jobId = documentId deduplicates a double enqueue.
 * Redis errors are swallowed and logged: the sweeper re-enqueues anything still queued in Postgres.
 */
export async function enqueueDocument(
  queue: DocumentQueue | undefined,
  documentId: string,
  log: (msg: string, err: unknown) => void = (m, e) => console.error(m, e),
): Promise<boolean> {
  if (!queue) return false;
  try {
    await queue.add('render', { documentId }, { jobId: documentId, ...documentJobOptions });
    return true;
  } catch (err) {
    log(`[documents] enqueue failed for ${documentId}`, err);
    return false;
  }
}
