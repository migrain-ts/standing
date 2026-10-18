import { sql } from 'drizzle-orm';
import type { Db } from '@standing/db';
import { UUID_RE, asId, type DocumentId, type TenantId, type UserId } from '@standing/shared';
import { enqueueDocument, type DocumentQueue } from '@standing/core';
import type { Clock } from '@standing/shared';
import { ApiError } from '../errors';
import { loadTenantEvent } from './events';

export type DocumentView = {
  id: DocumentId;
  kind: 'ticket_pdf' | 'report_pdf';
  status: 'queued' | 'running' | 'ready' | 'failed';
  error?: string;
};

const notFound = () => new ApiError(404, 'not_found', 'Not found');

/**
 * One query decides visibility: a ticket_pdf belongs to the buyer of its order, a report_pdf to manager/owner of its
 * tenant. Any miss (unknown id, other user, wrong role) is the same 404, so existence never leaks.
 */
export async function loadVisibleDocument(db: Db, userId: UserId | string, documentId: string, withContent = false) {
  if (!UUID_RE.test(documentId)) throw notFound();
  const res = await db.execute(sql`
    select d.id, d.kind, d.status, d.error, d.event_id, ${withContent ? sql`d.content` : sql`null::bytea`} as content
    from documents d
    where d.id = ${documentId.toLowerCase()}::uuid
      and (
        (d.kind = 'ticket_pdf' and exists (select 1 from orders o where o.id = d.order_id and o.buyer_id = ${userId}::uuid))
        or (d.kind = 'report_pdf' and exists (
          select 1 from memberships m where m.tenant_id = d.tenant_id and m.user_id = ${userId}::uuid and m.role in ('manager', 'owner')))
      )`);
  const r = res.rows[0];
  if (!r) throw notFound();
  const view: DocumentView = {
    id: asId<'DocumentId'>(String(r.id)),
    kind: r.kind === 'ticket_pdf' ? 'ticket_pdf' : 'report_pdf',
    status: r.status === 'running' || r.status === 'ready' || r.status === 'failed' ? r.status : 'queued',
    ...(r.error ? { error: String(r.error) } : {}),
  };
  return { view, content: Buffer.isBuffer(r.content) ? r.content : null };
}

export async function requestReport(
  deps: { db: Db; clock: Clock },
  queue: DocumentQueue | undefined,
  o: { tenantId: TenantId; eventId: string; userId: UserId | string },
) {
  const event = await loadTenantEvent(deps.db, o.tenantId, o.eventId);
  const now = deps.clock.now();
  const [row] = await deps.db.execute<{ id: string }>(sql`
    insert into documents (tenant_id, kind, event_id, requested_by, params, created_at, updated_at)
    values (${o.tenantId}::uuid, 'report_pdf', ${event.id}::uuid, ${o.userId}::uuid,
            ${JSON.stringify({ eventId: event.id })}::jsonb, ${now}::timestamptz, ${now}::timestamptz)
    returning id`).then((r) => r.rows);
  if (!row) throw new Error('document insert failed');
  await enqueueDocument(queue, row.id);
  return { id: asId<'DocumentId'>(row.id), status: 'queued' as const };
}
