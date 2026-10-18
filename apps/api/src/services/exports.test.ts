import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { Readable } from 'node:stream';
import { insertEventFixture, insertPaidOrder } from '@standing/db';
import { salesRows, toCsv, toXlsx, type SalesRow } from './exports';
import { makeApp, makeUser, type TestApp } from '../test-helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp({ noDocumentQueue: true });
});
afterAll(async () => {
  await t.close();
});

const row = (o: Partial<SalesRow> = {}): SalesRow => ({
  orderId: 'o1', orderedAt: new Date('2026-01-02T03:04:05Z'), buyerName: 'Ann', buyerEmail: 'ann@example.com',
  eventName: 'Show', section: 'Floor', row: 'A', seat: 1, priceCents: 5000, scannedAt: null, ...o,
});
const text = async (r: Readable) => {
  const chunks: Buffer[] = [];
  for await (const c of r) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
};
/** Minimal RFC 4180 parser for the tests. */
function parseCsv(s: string): string[][] {
  const out: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (q) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { cur.push(cell); cell = ''; }
    else if (ch === '\r' && s[i + 1] === '\n') { cur.push(cell); out.push(cur); cur = []; cell = ''; i++; }
    else cell += ch;
  }
  if (cell || cur.length) { cur.push(cell); out.push(cur); }
  return out;
}

describe('toCsv', () => {
  it('writes a BOM, a header row, RFC 4180 quoting and neutralizes formula-looking cells', async () => {
    const names = ['=HYPERLINK("http://evil")', '+1', '-2', '@x', '\tTab', '\rCR', 'Smith, "Jo"', 'two\nlines', 'plain'];
    const buf = await text(toCsv(Readable.from(names.map((n) => row({ buyerName: n })))));
    expect([...buf.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const raw = buf.toString('utf8').slice(1);
    expect(raw.startsWith('order_id,ordered_at,buyer_name,buyer_email,event_name,section,row,seat,price_cents,scanned_at\r\n')).toBe(true);
    expect(raw).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(raw).toContain('"Smith, ""Jo"""');
    expect(raw).toContain('"two\nlines"');
    const rows = parseCsv(raw);
    expect(rows.map((r) => r[2]).slice(1)).toEqual([
      `'=HYPERLINK("http://evil")`, `'+1`, `'-2`, `'@x`, `'\tTab`, `'\rCR`, 'Smith, "Jo"', 'two\nlines', 'plain',
    ]);
    expect(rows[1]?.[1]).toBe('2026-01-02T03:04:05.000Z');
    expect(rows[1]?.[9]).toBe('');
  });
});

describe('toXlsx', () => {
  it('is a valid workbook whose rows equal the CSV rows, with formula-looking text kept as text', async () => {
    const data = [row(), row({ orderId: 'o2', buyerName: '=SUM(1)', seat: 2, priceCents: 1234, scannedAt: new Date('2026-01-03T00:00:00Z') })];
    const csv = parseCsv((await text(toCsv(Readable.from(data)))).toString('utf8').slice(1));
    const buf = await text(toXlsx(Readable.from(data)));
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const cells = (r: number) => (ws.getRow(r).values as unknown[]).slice(1);
    expect(cells(1).slice(0, 10)).toEqual(csv[0]);
    expect(cells(1)[10]).toBe('price');
    for (let i = 1; i <= 2; i++) {
      const c = cells(i + 1);
      const d = data[i - 1]!;
      expect(c[0]).toBe(d.orderId);
      expect((c[1] as Date).toISOString()).toBe(d.orderedAt.toISOString());
      expect(c[2]).toBe(d.buyerName); // a string cell, not a formula
      expect(c[7]).toBe(d.seat);
      expect(c[8]).toBe(d.priceCents);
      expect(c[10]).toBe(d.priceCents / 100);
      expect(csv[i]?.[0]).toBe(String(c[0]));
      if (d.scannedAt) expect((c[9] as Date).toISOString()).toBe(d.scannedAt.toISOString());
    }
    expect(ws.rowCount).toBe(3);
  });
  it('destroys cleanly when the consumer goes away', async () => {
    const src = Readable.from((async function* () { for (let i = 0; ; i++) {
        await new Promise((r) => setImmediate(r)); // a real source yields to the event loop on I/O
        yield row({ seat: i });
      } })());
    const out = toXlsx(src);
    await new Promise((r) => setTimeout(r, 50));
    out.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect(src.destroyed).toBe(true);
  });
});

describe('salesRows', () => {
  it('returns only the tenant rows, ordered, and releases the pooled client when destroyed early', async () => {
    const a = await insertEventFixture(t.db, { rows: 2, seatsPerRow: 5, tenantName: 'A' });
    const buyer = await makeUser(t, 'buyer');
    for (let i = 0; i < 6; i++)
      await insertPaidOrder(t.db, { eventId: a.eventId, tenantId: a.tenantId, buyerId: buyer.id, seatIds: [a.seatIds[i]!], at: new Date(Date.UTC(2026, 0, 1, 0, i)) });
    const all: SalesRow[] = [];
    for await (const r of salesRows(t.pool, a.tenantId, {})) all.push(r as SalesRow);
    expect(all).toHaveLength(6);
    expect(all.map((r) => r.orderedAt.getTime())).toEqual([...all.map((r) => r.orderedAt.getTime())].sort((x, y) => x - y));
    expect(all[0]).toMatchObject({ section: 'Floor', row: 'A', seat: 1, priceCents: 5000, scannedAt: null, buyerEmail: expect.stringContaining('buyer-') });

    const before = t.pool.totalCount - t.pool.idleCount;
    const s = salesRows(t.pool, a.tenantId, {});
    await s[Symbol.asyncIterator]().next();
    s.destroy();
    await new Promise((r) => setTimeout(r, 100));
    expect(t.pool.totalCount - t.pool.idleCount).toBe(before);
  });
});

describe('memory ceiling', () => {
  it('streams 200,000 rows within a memory ceiling', async () => {
    const gc = (globalThis as { gc?: () => void }).gc;
    if (!gc) throw new Error('run with --expose-gc (vitest execArgv)');
    // One venue with a 4000-seat section, 50 published events, every seat sold: 200,000 orders of one ticket each.
    const f = await insertEventFixture(t.db, { rows: 40, seatsPerRow: 100, status: 'draft', tenantName: 'Big' });
    const buyer = await makeUser(t, 'bulk');
    const c = await t.pool.connect();
    try {
      await c.query(
        `insert into events (tenant_id, venue_id, name, starts_at, status)
         select $1, $2, 'Bulk ' || n, '2027-01-01T20:00:00Z', 'published' from generate_series(1, 50) n`,
        [f.tenantId, f.venueId],
      );
      await c.query(
        `insert into price_tiers (event_id, section_id, price_cents) select id, $2, 2500 from events where tenant_id = $1 and name like 'Bulk %'`,
        [f.tenantId, f.sectionId],
      );
      await c.query(
        `create temp table gen as
         select gen_random_uuid() as hold_id, gen_random_uuid() as order_id, gen_random_uuid() as item_id,
                e.id as event_id, s.id as seat_id, row_number() over () as rn
         from (select id from events where tenant_id = $1 and name like 'Bulk %') e cross join seats s where s.venue_id = $2`,
        [f.tenantId, f.venueId],
      );
      const at = `timestamptz '2026-01-01T00:00:00Z' + ((rn * 7919) % 5000000) * interval '1 second'`;
      await c.query(
        `insert into holds (id, buyer_id, event_id, seat_count, status, expires_at, created_at)
         select hold_id, $1, event_id, 1, 'paid', ${at}, ${at} from gen`,
        [buyer.id],
      );
      await c.query(
        `insert into orders (id, buyer_id, event_id, tenant_id, hold_id, total_cents, status, created_at)
         select order_id, $1, event_id, $2, hold_id, 2500, 'paid', ${at} from gen`,
        [buyer.id, f.tenantId],
      );
      await c.query(
        `insert into order_items (id, order_id, event_id, seat_id, section_id, price_cents)
         select item_id, order_id, event_id, seat_id, $1, 2500 from gen`,
        [f.sectionId],
      );
      await c.query(`insert into tickets (order_item_id, order_id, event_id, seat_id) select item_id, order_id, event_id, seat_id from gen`);
      await c.query(
        `insert into event_seats (event_id, seat_id, status, order_id, hold_id) select event_id, seat_id, 'sold', order_id, hold_id from gen`,
      );
      await c.query('analyze orders; analyze order_items; analyze tickets');
    } finally {
      c.release();
    }

    gc();
    const baseline = process.memoryUsage().heapUsed;
    let peak = baseline;
    const timer = setInterval(() => { peak = Math.max(peak, process.memoryUsage().heapUsed); }, 25);
    let lines = 0;
    try {
      for await (const chunk of toCsv(salesRows(t.pool, f.tenantId, {}))) {
        const b = Buffer.from(chunk);
        for (let i = b.indexOf(10); i !== -1; i = b.indexOf(10, i + 1)) lines++;
      }
    } finally {
      clearInterval(timer);
    }
    peak = Math.max(peak, process.memoryUsage().heapUsed);
    expect(lines).toBe(200_001);
    expect(peak - baseline).toBeLessThan(80 * 1024 * 1024);
  }, 120_000);
});
