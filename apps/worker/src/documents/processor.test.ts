import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { insertPaidOrder, rebuildRollups, schema } from '@standing/db';
import { signTicket, verifyTicket } from '@standing/core';
import { asId } from '@standing/shared';
import { insertEventFixture, insertTicketDocument, makeBuyer, makeWorkerDb } from '../test-helpers';
import { processDocument } from './processor';
import { renderTicketPdf } from './ticket-pdf';

let t: Awaited<ReturnType<typeof makeWorkerDb>>;
const secret = 'worker-test-secret';
beforeAll(async () => {
  t = await makeWorkerDb();
});
afterAll(async () => {
  await t.close();
});
const deps = () => ({ clock: t.clock, ticketSecret: secret });
const load = async (id: string) => {
  const [d] = await t.db.select().from(schema.documents).where(eq(schema.documents.id, id));
  return d!;
};
const pages = (pdf: Buffer) => (pdf.toString('latin1').match(/\/Type \/Page\b(?!s)/g) ?? []).length;

describe('processDocument', () => {
  it('renders a ticket PDF with one page per ticket and marks the document ready', async () => {
    const { documentId } = await insertTicketDocument(t.db, { seats: 3, at: t.clock.now() });
    expect(await processDocument(t.db, deps(), documentId)).toBe('ready');
    const doc = await load(documentId);
    expect(doc.status).toBe('ready');
    const pdf = doc.content!;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.subarray(-6).toString()).toContain('%%EOF');
    expect(pages(pdf)).toBe(3);
  });

  it('renders a non-empty report PDF for an event with sales', async () => {
    const f = await insertEventFixture(t.db, { rows: 2, seatsPerRow: 10, priceCents: 1500 });
    const buyer = await makeBuyer(t.db, 'r');
    await insertPaidOrder(t.db, { eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer, seatIds: f.seatIds.slice(0, 4), at: t.clock.now() });
    await rebuildRollups(t.db, f.eventId);
    const [d] = await t.db.insert(schema.documents).values({
      tenantId: f.tenantId, kind: 'report_pdf', eventId: f.eventId, params: { eventId: f.eventId }, createdAt: t.clock.now(), updatedAt: t.clock.now(),
    }).returning({ id: schema.documents.id });
    expect(await processDocument(t.db, deps(), d!.id)).toBe('ready');
    const pdf = (await load(d!.id)).content!;
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it('is a no-op on ready and failed documents and never overwrites content', async () => {
    const { documentId } = await insertTicketDocument(t.db, { seats: 1, at: t.clock.now() });
    await processDocument(t.db, deps(), documentId);
    const first = (await load(documentId)).content!;
    expect(await processDocument(t.db, deps(), documentId)).toBe('skipped');
    expect(Buffer.compare((await load(documentId)).content!, first)).toBe(0);

    const failed = await insertTicketDocument(t.db, { seats: 1, at: t.clock.now(), status: 'failed' });
    expect(await processDocument(t.db, deps(), failed.documentId)).toBe('skipped');
    expect((await load(failed.documentId)).content).toBeNull();
    expect(await processDocument(t.db, deps(), '3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80')).toBe('skipped');
  });

  it('puts a retryable failure back to queued with the error, and fails permanently after 3 attempts', async () => {
    const { documentId } = await insertTicketDocument(t.db, { seats: 1, at: t.clock.now() });
    await t.db.update(schema.documents).set({ orderId: null }).where(eq(schema.documents.id, documentId)); // nothing to render
    await expect(processDocument(t.db, deps(), documentId)).rejects.toThrow();
    let doc = await load(documentId);
    expect([doc.status, doc.attempts]).toEqual(['queued', 1]);
    expect(doc.error).toBeTruthy();
    await expect(processDocument(t.db, deps(), documentId)).rejects.toThrow();
    expect(await processDocument(t.db, deps(), documentId)).toBe('failed');
    doc = await load(documentId);
    expect([doc.status, doc.attempts]).toEqual(['failed', 3]);
    expect(doc.content).toBeNull();
    expect(await processDocument(t.db, deps(), documentId)).toBe('skipped');
  });

  it('does not let a superseded run overwrite a newer claim (attempt fence)', async () => {
    const { documentId } = await insertTicketDocument(t.db, { seats: 1, at: t.clock.now() });
    // While the first run renders, a competing worker re-claims the row (attempts moves on).
    const slowRender: typeof renderTicketPdf = async (data) => {
      await t.db.execute(sql`update documents set attempts = attempts + 1 where id = ${documentId}::uuid`);
      return renderTicketPdf(data);
    };
    expect(await processDocument(t.db, { ...deps(), renderTicket: slowRender }, documentId)).toBe('skipped');
    const doc = await load(documentId);
    expect([doc.status, doc.attempts, doc.content]).toEqual(['running', 2, null]);
  });
});

describe('renderTicketPdf', () => {
  it('receives signed codes that verify with the secret', async () => {
    const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
    const codes = ids.map((i) => signTicket(secret, asId<'TicketId'>(i)));
    const pdf = await renderTicketPdf({
      eventName: 'Demo', startsAt: t.clock.now(), venueName: 'Hall', orderId: 'o1',
      tickets: codes.map((code, i) => ({ code, sectionName: 'Floor', rowLabel: 'A', number: i + 1, priceCents: 2500 })),
    });
    expect(pages(pdf)).toBe(2);
    expect(codes.map((c) => verifyTicket(secret, c))).toEqual(ids);
  });
});
