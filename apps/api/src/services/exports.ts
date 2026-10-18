import { PassThrough, Readable } from 'node:stream';
import type { Pool } from 'pg';
import QueryStream from 'pg-query-stream';
import ExcelJS from 'exceljs';
import type { ExportQuery, TenantId } from '@standing/shared';

export type SalesRow = {
  orderId: string;
  orderedAt: Date;
  buyerName: string;
  buyerEmail: string;
  eventName: string;
  section: string;
  row: string;
  seat: number;
  priceCents: number;
  scannedAt: Date | null;
};

export const SALES_COLUMNS = [
  'order_id', 'ordered_at', 'buyer_name', 'buyer_email', 'event_name', 'section', 'row', 'seat', 'price_cents', 'scanned_at',
] as const;

type RawRow = {
  order_id: string; ordered_at: Date; buyer_name: string; buyer_email: string; event_name: string;
  section: string; row: string; seat: number; price_cents: number; scanned_at: Date | null;
};
const fromRaw = (r: RawRow): SalesRow => ({
  orderId: r.order_id, orderedAt: r.ordered_at, buyerName: r.buyer_name, buyerEmail: r.buyer_email, eventName: r.event_name,
  section: r.section, row: r.row, seat: r.seat, priceCents: r.price_cents, scannedAt: r.scanned_at,
});

const DAY_MS = 86_400_000;

/** The tenant filter is mandatory; optional filters are appended with bound parameters only. */
export function salesQuery(tenantId: TenantId, q: ExportQuery): { text: string; values: unknown[] } {
  const values: unknown[] = [tenantId];
  let where = 'where o.tenant_id = $1';
  if (q.from) {
    values.push(new Date(`${q.from}T00:00:00Z`));
    where += ` and o.created_at >= $${values.length}`;
  }
  if (q.to) {
    values.push(new Date(Date.parse(`${q.to}T00:00:00Z`) + DAY_MS)); // `to` is an inclusive day
    where += ` and o.created_at < $${values.length}`;
  }
  if (q.eventId) {
    values.push(q.eventId);
    where += ` and oi.event_id = $${values.length}`;
  }
  const text = `
    select o.id as order_id, o.created_at as ordered_at, u.name as buyer_name, u.email as buyer_email,
           e.name as event_name, sec.name as section, s.row_label as row, s.number as seat,
           oi.price_cents, t.scanned_at
    from order_items oi
    join orders o on o.id = oi.order_id and o.status = 'paid'
    join users u on u.id = o.buyer_id
    join events e on e.id = oi.event_id
    join seats s on s.id = oi.seat_id
    join sections sec on sec.id = s.section_id
    join tickets t on t.order_item_id = oi.id
    ${where}
    order by o.created_at, t.id`;
  return { text, values };
}

async function* cursorRows(pool: Pool, text: string, values: unknown[]): AsyncGenerator<SalesRow> {
  const client = await pool.connect();
  const stream = client.query(new QueryStream(text, values, { batchSize: 1000 }));
  let clean = false;
  try {
    for await (const raw of stream) yield fromRaw(raw as RawRow);
    clean = true;
  } finally {
    // Wait for the cursor to close before the connection goes back; a connection that did not finish cleanly is discarded.
    if (!stream.closed) await new Promise<void>((resolve) => { stream.once('close', () => resolve()); stream.destroy(); });
    client.release(!clean);
  }
}

/** Object stream over a Postgres cursor. Destroying it (error, aborted response) releases the pooled client. */
export function salesRows(pool: Pool, tenantId: TenantId, q: ExportQuery): Readable {
  const { text, values } = salesQuery(tenantId, q);
  return Readable.from(cursorRows(pool, text, values), { objectMode: true });
}

const NEUTRALIZE = /^[=+\-@\t\r]/;
export function csvCell(v: string | number | Date | null): string {
  if (v === null) return '';
  if (typeof v === 'number') return String(v);
  const s = v instanceof Date ? v.toISOString() : NEUTRALIZE.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}
const csvLine = (r: SalesRow) =>
  [r.orderId, r.orderedAt, r.buyerName, r.buyerEmail, r.eventName, r.section, r.row, r.seat, r.priceCents, r.scannedAt].map(csvCell).join(',') + '\r\n';

const FLUSH_AT = 32 * 1024;
async function* csvChunks(rows: Readable): AsyncGenerator<string> {
  yield '﻿' + SALES_COLUMNS.join(',') + '\r\n';
  let buf = '';
  for await (const r of rows) {
    buf += csvLine(r as SalesRow);
    if (buf.length >= FLUSH_AT) {
      yield buf;
      buf = '';
    }
  }
  if (buf) yield buf;
}

/** UTF-8 CSV (BOM, header row, RFC 4180) as a byte stream. */
export function toCsv(rows: Readable): Readable {
  return Readable.from(csvChunks(rows), { objectMode: false });
}

const waitDrain = (out: PassThrough) =>
  new Promise<void>((resolve) => {
    out.once('drain', resolve);
    out.once('close', resolve);
  });

/** Streaming XLSX: rows are committed one by one, nothing is held in memory. Text cells stay text (never formulas). */
export function toXlsx(rows: Readable): Readable {
  const out = new PassThrough();
  const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  const sheet = workbook.addWorksheet('Sales');
  const dateFmt = 'yyyy-mm-dd hh:mm:ss';
  sheet.columns = [
    { header: 'order_id', key: 'orderId', width: 38 },
    { header: 'ordered_at', key: 'orderedAt', width: 20, style: { numFmt: dateFmt } },
    { header: 'buyer_name', key: 'buyerName', width: 24 },
    { header: 'buyer_email', key: 'buyerEmail', width: 30 },
    { header: 'event_name', key: 'eventName', width: 28 },
    { header: 'section', key: 'section', width: 14 },
    { header: 'row', key: 'row', width: 6 },
    { header: 'seat', key: 'seat', width: 6 },
    { header: 'price_cents', key: 'priceCents', width: 12 },
    { header: 'scanned_at', key: 'scannedAt', width: 20, style: { numFmt: dateFmt } },
    { header: 'price', key: 'price', width: 10, style: { numFmt: '0.00' } },
  ];
  out.once('close', () => rows.destroy()); // aborted download: stop reading, release the cursor
  void (async () => {
    for await (const r of rows) {
      const row = r as SalesRow;
      sheet.addRow({ ...row, scannedAt: row.scannedAt ?? undefined, price: row.priceCents / 100 }).commit();
      if (out.writableNeedDrain) await waitDrain(out);
      if (out.destroyed) return;
    }
    await sheet.commit();
    await workbook.commit();
  })().catch((err: unknown) => out.destroy(err instanceof Error ? err : new Error(String(err))));
  return out;
}
