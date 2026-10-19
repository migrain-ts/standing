import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { TenantRoleName } from '@standing/shared';
import { createApp } from './app';
import { makeTenantFixture, type TenantFixture } from './fixtures';
import { call, makeApp, type TestApp } from './test-helpers';

type Body = Record<string, unknown> | unknown[];
type Row = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  pattern: string;
  min: TenantRoleName;
  url: (f: TenantFixture) => string;
  body?: Body | ((f: TenantFixture) => Body);
};
const bodyOf = (row: Row, f: TenantFixture) => (typeof row.body === 'function' ? row.body(f) : row.body);

// Every route under /tenants/:tenantId/* MUST have a row here. Later tasks append their rows.
export const MATRIX: Row[] = [
  { method: 'GET', pattern: '/tenants/:tenantId/members', min: 'manager', url: (f) => `/tenants/${f.tenantId}/members` },
  { method: 'POST', pattern: '/tenants/:tenantId/members', min: 'owner', url: (f) => `/tenants/${f.tenantId}/members`, body: { email: 'nobody@example.com', role: 'door' } },
  { method: 'PATCH', pattern: '/tenants/:tenantId/members/:userId', min: 'owner', url: (f) => `/tenants/${f.tenantId}/members/${f.door.id}`, body: { role: 'door' } },
  { method: 'DELETE', pattern: '/tenants/:tenantId/members/:userId', min: 'owner', url: (f) => `/tenants/${f.tenantId}/members/${f.door.id}` },
  { method: 'GET', pattern: '/tenants/:tenantId/venues', min: 'manager', url: (f) => `/tenants/${f.tenantId}/venues` },
  { method: 'POST', pattern: '/tenants/:tenantId/venues', min: 'manager', url: (f) => `/tenants/${f.tenantId}/venues`, body: { name: 'V', sections: [{ name: 'A', rows: 1, seatsPerRow: 2 }] } },
  { method: 'GET', pattern: '/tenants/:tenantId/venues/:venueId', min: 'manager', url: (f) => `/tenants/${f.tenantId}/venues/${f.venueId}` },
  { method: 'GET', pattern: '/tenants/:tenantId/events', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events` },
  { method: 'POST', pattern: '/tenants/:tenantId/events', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events`, body: (f) => ({ venueId: f.venueId, name: 'E', startsAt: '2027-01-01T20:00:00Z' }) },
  { method: 'GET', pattern: '/tenants/:tenantId/events/:eventId', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}` },
  { method: 'PATCH', pattern: '/tenants/:tenantId/events/:eventId', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.draftEventId}`, body: { name: 'Renamed' } },
  { method: 'PUT', pattern: '/tenants/:tenantId/events/:eventId/tiers', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.draftEventId}/tiers`, body: (f) => [{ sectionId: f.sectionId, priceCents: 1000 }] },
  { method: 'POST', pattern: '/tenants/:tenantId/events/:eventId/publish', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.draftEventId}/publish` },
  { method: 'POST', pattern: '/tenants/:tenantId/events/:eventId/close', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}/close` },
  { method: 'POST', pattern: '/tenants/:tenantId/events/:eventId/reports', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}/reports`, body: { kind: 'report_pdf' } },
  { method: 'GET', pattern: '/tenants/:tenantId/events/:eventId/live/snapshot', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}/live/snapshot` },
  { method: 'GET', pattern: '/tenants/:tenantId/events/:eventId/live', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}/live` },
  { method: 'GET', pattern: '/tenants/:tenantId/exports/sales.csv', min: 'manager', url: (f) => `/tenants/${f.tenantId}/exports/sales.csv` },
  { method: 'GET', pattern: '/tenants/:tenantId/exports/sales.xlsx', min: 'manager', url: (f) => `/tenants/${f.tenantId}/exports/sales.xlsx` },
  { method: 'GET', pattern: '/tenants/:tenantId/overview', min: 'manager', url: (f) => `/tenants/${f.tenantId}/overview` },
  { method: 'POST', pattern: '/tenants/:tenantId/events/:eventId/rush', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}/rush`, body: { buyers: 10 } },
  { method: 'GET', pattern: '/tenants/:tenantId/events/:eventId/rush', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}/rush` },
  { method: 'DELETE', pattern: '/tenants/:tenantId/events/:eventId/rush', min: 'manager', url: (f) => `/tenants/${f.tenantId}/events/${f.eventId}/rush` },
];

/** Routes that need a session but no tenant role. They must answer 401 anonymously. */
export const AUTHED_ROUTES = new Set(['POST /auth/logout', 'GET /auth/me', 'GET /tenants', 'POST /tenants',
  'POST /public/events/:eventId/queue', 'GET /public/events/:eventId/queue/:ticket', 'DELETE /public/events/:eventId/queue/:ticket']);
/** Routes whose authorization is a row-level check inside the handler (own orders, door scan, ...). Later tasks add theirs. */
export const SELF_CHECKED_ROUTES = new Set(['POST /public/events/:eventId/holds', 'GET /holds/:holdId', 'DELETE /holds/:holdId',
  'POST /holds/:holdId/pay', 'GET /me/orders', 'GET /orders/:orderId',
  'POST /door/scan', 'GET /door/events', 'GET /documents/:documentId', 'GET /documents/:documentId/download']);
/** Routes open to everyone. */
export const PUBLIC_ROUTES = new Set([
  'POST /auth/register', 'POST /auth/login', 'POST /auth/demo',
  'GET /public/events', 'GET /public/events/:eventId', 'GET /public/events/:eventId/map', 'GET /public/events/:eventId/availability',
]);

const rank: Record<TenantRoleName, number> = { door: 1, manager: 2, owner: 3 };
let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

const concrete = (pattern: string) =>
  pattern.replace(/:[A-Za-z]+/g, '3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80');

describe('route coverage', () => {
  it('every registered route is in the matrix or explicitly exempt', () => {
    const app = createApp(t.deps);
    const registered = app.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`);
    const known = new Set([...MATRIX.map((r) => `${r.method} ${r.pattern}`), ...AUTHED_ROUTES, ...SELF_CHECKED_ROUTES, ...PUBLIC_ROUTES]);
    expect(registered.filter((r) => !known.has(r))).toEqual([]);
  });
  it('no exempt route is tenant-scoped (those must live in the matrix)', () => {
    const exempt = [...AUTHED_ROUTES, ...SELF_CHECKED_ROUTES, ...PUBLIC_ROUTES];
    expect(exempt.filter((k) => k.includes(':tenantId'))).toEqual([]);
  });
  it('every matrix row is a registered route (no stale rows)', () => {
    const app = createApp(t.deps);
    const registered = new Set(app.routes.map((r) => `${r.method} ${r.path}`));
    expect(MATRIX.map((r) => `${r.method} ${r.pattern}`).filter((k) => !registered.has(k))).toEqual([]);
  });
  it('every session-only and self-checked route rejects anonymous callers with 401', async () => {
    for (const key of [...AUTHED_ROUTES, ...SELF_CHECKED_ROUTES]) {
      const [method, pattern] = key.split(' ') as [string, string];
      const res = await call(t.app, null, method, concrete(pattern), method === 'GET' ? undefined : {});
      expect(res.status, key).toBe(401);
    }
  });
  it('unknown anonymous paths are 404, not 401', async () => {
    expect((await call(t.app, null, 'GET', '/nope')).status).toBe(404);
  });
});

for (const row of MATRIX) {
  describe(`${row.method} ${row.pattern}`, () => {
    it('401 when anonymous', async () => {
      const f = await makeTenantFixture(t);
      expect((await call(t.app, null, row.method, row.url(f), bodyOf(row, f))).status).toBe(401);
    });
    it('404 for a member of another tenant (never 403)', async () => {
      const f = await makeTenantFixture(t);
      expect((await call(t.app, f.outsider.cookie, row.method, row.url(f), bodyOf(row, f))).status).toBe(404);
    });
    for (const role of ['door', 'manager', 'owner'] as const) {
      it(`${role}: ${rank[role] < rank[row.min] ? '403' : 'allowed'}`, async () => {
        const f = await makeTenantFixture(t);
        const res = await call(t.app, f[role].cookie, row.method, row.url(f), bodyOf(row, f));
        if (rank[role] < rank[row.min]) expect(res.status).toBe(403);
        else {
          expect([401, 403]).not.toContain(res.status);
          // the rush rows end in 503 here: no simulator runs in the matrix test
          if (row.pattern.endsWith('/rush')) expect([202, 200, 503]).toContain(res.status);
          else expect(res.status).toBeLessThan(500);
          // SSE rows would keep streaming; cancelling a half-written XLSX stream throws later, so other bodies are drained
          if (row.pattern.endsWith('/live')) await res.body?.cancel();
          else await res.arrayBuffer();
        }
      });
    }
  });
}

/** Tenant B's events (with their tiers) and venues, to prove a request through tenant A's URL changed nothing of B's. */
async function tenantRows(tenantId: string) {
  const r = await t.db.execute(sql`
    select 'event' as kind, to_jsonb(e) as row from events e where e.tenant_id = ${tenantId}::uuid
    union all select 'tier', to_jsonb(p) from price_tiers p join events e on e.id = p.event_id where e.tenant_id = ${tenantId}::uuid
    union all select 'venue', to_jsonb(v) from venues v where v.tenant_id = ${tenantId}::uuid
    order by 1, 2`);
  return r.rows;
}

// A handler that loads a child row by id only (forgetting `tenant_id`) would let a manager of tenant A reach tenant
// B's event or venue through A's URL, which the membership middleware alone cannot see.
describe("child rows of another tenant through the caller's own tenant URL", () => {
  for (const row of MATRIX.filter((r) => /:eventId|:venueId/.test(r.pattern))) {
    it(`${row.method} ${row.pattern}: 404 with B's event or venue id, B unchanged`, async () => {
      const f = await makeTenantFixture(t);
      const url = row
        .url(f)
        .replace(f.draftEventId, f.outsiderDraftEventId)
        .replace(f.eventId, f.outsiderEventId)
        .replace(f.venueId, f.outsiderVenueId);
      expect(url).not.toBe(row.url(f));
      const before = await tenantRows(f.outsiderTenantId);
      const res = await call(t.app, f.manager.cookie, row.method, url, bodyOf(row, f));
      expect(res.status).toBe(404);
      await res.arrayBuffer();
      expect(await tenantRows(f.outsiderTenantId)).toEqual(before);
    });
  }
});
