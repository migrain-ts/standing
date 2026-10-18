import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { makeTenantFixture } from '../fixtures';
import { call, makeApp, type TestApp } from '../test-helpers';

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});

const body = { name: 'Arena', sections: [{ name: 'Pit', rows: 3, seatsPerRow: 4 }, { name: 'Tier', rows: 2, seatsPerRow: 5 }] };

describe('venues', () => {
  it('creates a venue with one seat per row x column, stable idx and unique coordinates', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, f.manager.cookie, 'POST', `/tenants/${f.tenantId}/venues`, body);
    expect(res.status).toBe(201);
    const { venue } = (await res.json()) as { venue: { id: string; seatCount: number } };
    expect(venue.seatCount).toBe(22);
    const rows = await t.db.execute(sql`select idx, x, y from seats where venue_id = ${venue.id}::uuid order by idx`);
    expect(rows.rows.map((r) => Number(r.idx))).toEqual(Array.from({ length: 22 }, (_, i) => i));
    expect(new Set(rows.rows.map((r) => `${r.x},${r.y}`)).size).toBe(22);
  });
  it('rejects more than 6000 seats, more than 12 sections and empty venues with 400', async () => {
    const f = await makeTenantFixture(t);
    const post = (b: unknown) => call(t.app, f.manager.cookie, 'POST', `/tenants/${f.tenantId}/venues`, b);
    expect((await post({ name: 'Huge', sections: [{ name: 'A', rows: 60, seatsPerRow: 80 }, { name: 'B', rows: 60, seatsPerRow: 80 }] })).status).toBe(400);
    expect((await post({ name: 'Many', sections: Array.from({ length: 13 }, (_, i) => ({ name: `S${i}`, rows: 1, seatsPerRow: 1 })) })).status).toBe(400);
    expect((await post({ name: 'Empty', sections: [] })).status).toBe(400);
  });
  it('lists only this tenant venues with their seat counts', async () => {
    const f = await makeTenantFixture(t);
    const list = (await (await call(t.app, f.manager.cookie, 'GET', `/tenants/${f.tenantId}/venues`)).json()) as { venues: { id: string; seatCount: number }[] };
    expect(list.venues.map((v) => v.id)).toContain(f.venueId);
    expect(list.venues.map((v) => v.id)).not.toContain((await makeTenantFixture(t)).venueId);
  });
  it('hides a venue of another tenant even when the caller uses their own tenant id', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, f.outsider.cookie, 'GET', `/tenants/${f.outsiderTenantId}/venues/${f.venueId}`);
    expect(res.status).toBe(404);
  });
});
