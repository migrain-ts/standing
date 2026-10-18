import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { eq } from 'drizzle-orm';
import { insertEventFixture, insertPaidOrder, schema } from '@standing/db';
import { makeTenantFixture, type TenantFixture } from '../fixtures';
import { call, makeApp, makeUser, type TestApp } from '../test-helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ noDocumentQueue: true });
});
afterAll(async () => {
  await t.close();
});

async function seed() {
  const f = await makeTenantFixture(t);
  const buyer = await makeUser(t, 'buyer');
  const sale = (ids: number[], at: string) =>
    insertPaidOrder(t.db, { eventId: f.eventId, tenantId: f.tenantId, buyerId: buyer.id, seatIds: ids.map((n) => f.seatIds[n]!), at: new Date(at) });
  await sale([0, 1], '2026-01-02T10:00:00Z');
  await sale([2], '2026-01-10T10:00:00Z');
  await sale([3], '2026-01-20T23:59:00Z');
  // A second tenant with its own sales.
  const other = await insertEventFixture(t.db, { rows: 2, seatsPerRow: 3, tenantName: 'Rival' });
  await t.db.update(schema.events).set({ name: 'Rival Gala' }).where(eq(schema.events.id, other.eventId));
  const rival = await makeUser(t, 'rival-buyer');
  await insertPaidOrder(t.db, { eventId: other.eventId, tenantId: other.tenantId, buyerId: rival.id, seatIds: other.seatIds.slice(0, 3), at: new Date('2026-01-10T10:00:00Z') });
  return { f, buyer, other, rival };
}
const csvUrl = (f: TenantFixture, qs = '') => `/tenants/${f.tenantId}/exports/sales.csv${qs}`;
const dataLines = (body: string) => body.replace(/^﻿/, '').trim().split('\r\n').slice(1);

describe('GET exports/sales.csv', () => {
  it('is manager-only: 401, 404 for outsiders, 403 for door', async () => {
    const { f } = await seed();
    expect((await call(t.app, null, 'GET', csvUrl(f))).status).toBe(401);
    expect((await call(t.app, f.outsider.cookie, 'GET', csvUrl(f))).status).toBe(404);
    expect((await call(t.app, f.door.cookie, 'GET', csvUrl(f))).status).toBe(403);
    expect((await call(t.app, f.manager.cookie, 'GET', csvUrl(f))).status).toBe(200);
  });

  it('streams a CSV attachment with the tenant rows only', async () => {
    const { f } = await seed();
    const res = await call(t.app, f.manager.cookie, 'GET', csvUrl(f));
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=/);
    const bytes = Buffer.from(await res.arrayBuffer()); // res.text() would strip the BOM
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const body = bytes.toString('utf8');
    expect(body.slice(1).startsWith('order_id,ordered_at,')).toBe(true);
    const lines = dataLines(body);
    expect(lines).toHaveLength(4);
    expect(lines.every((l) => l.includes('Fixture Tenant') === false && l.includes(',Floor,'))).toBe(true);
    expect(body).toContain('buyer-');
  });

  it('filters by from, to (inclusive days) and eventId', async () => {
    const { f } = await seed();
    const get = async (qs: string) => dataLines(await (await call(t.app, f.manager.cookie, 'GET', csvUrl(f, qs))).text());
    expect(await get('?from=2026-01-10')).toHaveLength(2);
    expect(await get('?to=2026-01-10')).toHaveLength(3);
    expect(await get('?from=2026-01-10&to=2026-01-10')).toHaveLength(1);
    expect(await get(`?eventId=${f.eventId}`)).toHaveLength(4);
    expect(await get(`?eventId=${f.draftEventId}`)).toHaveLength(0);
  });

  it('rejects a range wider than 366 days and malformed filters with 400', async () => {
    const { f } = await seed();
    const status = async (qs: string) => (await call(t.app, f.manager.cookie, 'GET', csvUrl(f, qs))).status;
    expect(await status('?from=2025-01-01&to=2026-02-06')).toBe(400); // 401 days
    expect(await status('?from=2025-01-01&to=2026-01-02')).toBe(200); // 366 days
    expect(await status('?from=2026-13-01')).toBe(400);
    expect(await status('?from=yesterday')).toBe(400);
    expect(await status('?eventId=nope')).toBe(400);
  });

  it('never returns another tenant rows, even with that tenant eventId', async () => {
    const { f, other } = await seed();
    const all = await (await call(t.app, f.manager.cookie, 'GET', csvUrl(f))).text();
    const rival = await (await call(t.app, f.manager.cookie, 'GET', csvUrl(f, `?eventId=${other.eventId}`))).text();
    expect(dataLines(rival)).toHaveLength(0);
    expect(all).not.toContain('rival-buyer');
    expect(all).not.toContain('Rival Gala');
    expect(dataLines(all)).toHaveLength(4);
  });

  it('sends the first bytes before the whole result is read, and frees the pooled client when the response is cancelled', async () => {
    const { f } = await seed();
    const res = await call(t.app, f.manager.cookie, 'GET', csvUrl(f));
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    expect(Buffer.from(first.value!).subarray(0, 3)).toEqual(Buffer.from([0xef, 0xbb, 0xbf]));
    await reader.cancel();
    await new Promise((r) => setTimeout(r, 200));
    expect(t.pool.totalCount - t.pool.idleCount).toBe(0);
  });
});

describe('GET exports/sales.xlsx', () => {
  it('is manager-only and streams a workbook with the tenant rows', async () => {
    const { f } = await seed();
    const url = `/tenants/${f.tenantId}/exports/sales.xlsx`;
    expect((await call(t.app, f.door.cookie, 'GET', url)).status).toBe(403);
    expect((await call(t.app, f.outsider.cookie, 'GET', url)).status).toBe(404);
    const res = await call(t.app, f.manager.cookie, 'GET', url);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    expect(res.headers.get('content-disposition')).toMatch(/^attachment; filename=.*\.xlsx/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await res.arrayBuffer()) as unknown as ArrayBuffer);
    expect(wb.worksheets[0]?.rowCount).toBe(5);
    const bad = await call(t.app, f.manager.cookie, 'GET', `${url}?from=2020-01-01&to=2026-01-01`);
    expect(bad.status).toBe(400);
  });
});
