import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { schema } from '@standing/db';
import type { Redis } from 'ioredis';
import { makeTenantFixture } from '../fixtures';
import { createHold } from '../services/holds';
import { call, connectTestRedis, makeApp, makeUser, type TestApp } from '../test-helpers';

let t: TestApp;
let redis: Redis;
beforeAll(async () => {
  redis = await connectTestRedis();
  t = await makeApp({ redis });
});
afterAll(async () => {
  await t.close();
  redis.disconnect();
});

async function ticketDoc(f: Awaited<ReturnType<typeof makeTenantFixture>>, buyer: { id: string }, seatIdx: number) {
  const { insertPaidOrder } = await import('@standing/db');
  const { orderId } = await insertPaidOrder(t.db, {
    eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer.id, seatIds: [f.seatIds[seatIdx]!], at: t.clock.now(),
  });
  const [d] = await t.db.insert(schema.documents).values({
    tenantId: f.tenantId, kind: 'ticket_pdf', orderId, eventId: f.eventId, requestedBy: buyer.id, createdAt: t.clock.now(), updatedAt: t.clock.now(),
  }).returning({ id: schema.documents.id });
  return d!.id;
}
async function reportDoc(f: Awaited<ReturnType<typeof makeTenantFixture>>) {
  const [d] = await t.db.insert(schema.documents).values({
    tenantId: f.tenantId, kind: 'report_pdf', eventId: f.eventId, params: { eventId: f.eventId }, createdAt: t.clock.now(), updatedAt: t.clock.now(),
  }).returning({ id: schema.documents.id });
  return d!.id;
}
const ready = (id: string) =>
  t.db.execute(sql`update documents set status = 'ready', content = ${Buffer.from('%PDF-1.3 fake\n%%EOF')} where id = ${id}::uuid`);

describe('GET /documents/:id', () => {
  it('shows a ticket document to its buyer only', async () => {
    const f = await makeTenantFixture(t);
    const a = await makeUser(t, 'a');
    const b = await makeUser(t, 'b');
    const id = await ticketDoc(f, a, 0);
    const res = await call(t.app, a.cookie, 'GET', `/documents/${id}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ document: { id, kind: 'ticket_pdf', status: 'queued' } });
    expect((await call(t.app, b.cookie, 'GET', `/documents/${id}`)).status).toBe(404);
    expect((await call(t.app, f.owner.cookie, 'GET', `/documents/${id}`)).status).toBe(404); // staff do not see buyers' tickets
    expect((await call(t.app, null, 'GET', `/documents/${id}`)).status).toBe(401);
  });

  it('shows a report to manager and owner of its tenant, 404 to door, outsider and malformed ids', async () => {
    const f = await makeTenantFixture(t);
    const id = await reportDoc(f);
    for (const u of [f.manager, f.owner]) expect((await call(t.app, u.cookie, 'GET', `/documents/${id}`)).status).toBe(200);
    for (const u of [f.door, f.outsider]) expect((await call(t.app, u.cookie, 'GET', `/documents/${id}`)).status).toBe(404);
    expect((await call(t.app, f.owner.cookie, 'GET', '/documents/not-a-uuid')).status).toBe(404);
    expect((await call(t.app, f.owner.cookie, 'GET', '/documents/3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80')).status).toBe(404);
  });

  it('includes the error of a failed document', async () => {
    const f = await makeTenantFixture(t);
    const id = await reportDoc(f);
    await t.db.update(schema.documents).set({ status: 'failed', error: 'boom' }).where(eq(schema.documents.id, id));
    const body = (await (await call(t.app, f.owner.cookie, 'GET', `/documents/${id}`)).json()) as { document: { error?: string } };
    expect(body.document.error).toBe('boom');
  });
});

describe('GET /documents/:id/download', () => {
  it('409 not_ready while queued, 200 application/pdf when ready, 404 for others', async () => {
    const f = await makeTenantFixture(t);
    const a = await makeUser(t, 'dl');
    const id = await ticketDoc(f, a, 1);
    const early = await call(t.app, a.cookie, 'GET', `/documents/${id}/download`);
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: { code: string } }).error.code).toBe('not_ready');
    await ready(id);
    const res = await call(t.app, a.cookie, 'GET', `/documents/${id}/download`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=/);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 5).toString()).toBe('%PDF-');
    expect((await call(t.app, f.door.cookie, 'GET', `/documents/${id}/download`)).status).toBe(404);
  });
});

describe('POST /tenants/:t/events/:e/reports', () => {
  it('202 with a queued document carrying params.eventId, and a job in the queue', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, f.manager.cookie, 'POST', `/tenants/${f.tenantId}/events/${f.eventId}/reports`, { kind: 'report_pdf' });
    expect(res.status).toBe(202);
    const { document } = (await res.json()) as { document: { id: string; status: string } };
    expect(document.status).toBe('queued');
    const [row] = await t.db.select().from(schema.documents).where(eq(schema.documents.id, document.id));
    expect(row).toMatchObject({ kind: 'report_pdf', tenantId: f.tenantId, eventId: f.eventId, params: { eventId: f.eventId } });
    expect(await t.svc.documentQueue?.getJob(document.id)).toBeTruthy();
  });
  it('400 on a wrong kind, 404 for an event of another tenant', async () => {
    const f = await makeTenantFixture(t);
    expect((await call(t.app, f.manager.cookie, 'POST', `/tenants/${f.tenantId}/events/${f.eventId}/reports`, { kind: 'x' })).status).toBe(400);
    expect((await call(t.app, f.manager.cookie, 'POST', `/tenants/${f.tenantId}/events/${f.outsiderEventId}/reports`, { kind: 'report_pdf' })).status).toBe(404);
  });
});

describe('payment enqueues the ticket document', () => {
  async function pay(app: TestApp, name: string) {
    const f = await makeTenantFixture(app);
    const buyer = await makeUser(app, name);
    const hold = await createHold(app.deps, { buyerId: buyer.id, eventId: f.eventId, seatIds: f.seatIds.slice(0, 2) });
    const res = await call(app.app, buyer.cookie, 'POST', `/holds/${hold.id}/pay`, undefined, { 'idempotency-key': `k-${name}` });
    expect(res.status).toBe(201);
    return ((await res.json()) as { order: { documentId: string } }).order.documentId;
  }
  it('adds a job named by the document id after commit', async () => {
    const documentId = await pay(t, 'p1');
    expect(await t.svc.documentQueue?.getJob(documentId)).toBeTruthy();
  });
  it('still succeeds without a queue (no Redis)', async () => {
    const plain = await makeApp();
    try {
      expect(plain.svc.documentQueue).toBeUndefined();
      expect(await pay(plain, 'p2')).toBeTruthy();
    } finally {
      await plain.close();
    }
  });
});
