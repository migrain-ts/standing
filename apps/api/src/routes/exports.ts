import { Readable } from 'node:stream';
import { Hono } from 'hono';
import { Pool } from 'pg';
import type { Db } from '@standing/db';
import { asId, exportQuerySchema, type TenantId } from '@standing/shared';
import type { Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { requireTenantRole } from '../authz';
import { salesRows, toCsv, toXlsx } from '../services/exports';
import { validator } from '../validate';

const BASE = '/tenants/:tenantId/exports';
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** The streaming cursor needs a dedicated pooled connection, which the Drizzle handle exposes as $client. */
function poolOf(db: Db): Pool {
  const client: unknown = (db as Db & { $client?: unknown }).$client;
  if (!(client instanceof Pool)) throw new Error('exports need a pg Pool');
  return client;
}

export function exportRoutes() {
  const tenant = (c: { get(k: 'tenantId'): string }) => asId<'TenantId'>(c.get('tenantId')) as TenantId;
  const download = (body: Readable, type: string, filename: string) =>
    new Response(Readable.toWeb(body) as ReadableStream<Uint8Array>, {
      headers: { 'content-type': type, 'content-disposition': `attachment; filename=${filename}`, 'cache-control': 'private, no-store' },
    });
  return new Hono<Env>()
    .use(`${BASE}/*`, requireAuth)
    .get(`${BASE}/sales.csv`, requireTenantRole('manager'), validator('query', exportQuerySchema), (c) =>
      download(toCsv(salesRows(poolOf(c.get('deps').db), tenant(c), c.req.valid('query'))), 'text/csv; charset=utf-8', 'sales.csv'))
    .get(`${BASE}/sales.xlsx`, requireTenantRole('manager'), validator('query', exportQuerySchema), (c) =>
      download(toXlsx(salesRows(poolOf(c.get('deps').db), tenant(c), c.req.valid('query'))), XLSX, 'sales.xlsx'));
}
