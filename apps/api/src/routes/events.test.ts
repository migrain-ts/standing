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

const future = '2026-03-01T20:00:00Z';
type Fx = Awaited<ReturnType<typeof makeTenantFixture>>;
const post = (f: Fx, path: string, body?: unknown) => call(t.app, f.manager.cookie, 'POST', `/tenants/${f.tenantId}${path}`, body);
const put = (f: Fx, path: string, body?: unknown) => call(t.app, f.manager.cookie, 'PUT', `/tenants/${f.tenantId}${path}`, body);

async function newDraft(f: Fx, startsAt = future, venueId = f.venueId) {
  const res = await post(f, '/events', { venueId, name: 'Gala', startsAt });
  expect(res.status).toBe(201);
  return ((await res.json()) as { event: { id: string; status: string } }).event;
}
const seatCount = async (eventId: string) =>
  Number((await t.db.execute(sql`select count(*)::int as n from event_seats where event_id = ${eventId}::uuid`)).rows[0]?.n);
const code = async (res: Response) => ((await res.json()) as { error: { code: string } }).error.code;

describe('events', () => {
  it('creates a draft event for the tenant venue', async () => {
    const f = await makeTenantFixture(t);
    expect((await newDraft(f)).status).toBe('draft');
  });
  it('404 when the venue belongs to another tenant', async () => {
    const f = await makeTenantFixture(t);
    const g = await makeTenantFixture(t);
    expect((await post(f, '/events', { venueId: g.venueId, name: 'X', startsAt: future })).status).toBe(404);
  });
  it('sets tiers then publishes: one available event_seat per venue seat', async () => {
    const f = await makeTenantFixture(t);
    const ev = await newDraft(f);
    expect((await put(f, `/events/${ev.id}/tiers`, [{ sectionId: f.sectionId, priceCents: 4000 }])).status).toBe(200);
    expect((await post(f, `/events/${ev.id}/publish`)).status).toBe(200);
    expect(await seatCount(ev.id)).toBe(f.seatIds.length);
    const avail = await t.db.execute(sql`select count(*)::int as n from event_seats where event_id = ${ev.id}::uuid and status = 'available'`);
    expect(Number(avail.rows[0]?.n)).toBe(f.seatIds.length);
    const got = await call(t.app, f.manager.cookie, 'GET', `/tenants/${f.tenantId}/events/${ev.id}`);
    expect(((await got.json()) as { event: { status: string } }).event.status).toBe('published');
  });
  it('409 missing_tiers without a price for every section', async () => {
    const f = await makeTenantFixture(t);
    const ev = await newDraft(f);
    const res = await post(f, `/events/${ev.id}/publish`);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('missing_tiers');
  });
  it('409 in_the_past when the date has passed', async () => {
    const f = await makeTenantFixture(t);
    const ev = await newDraft(f, '2025-12-01T20:00:00Z');
    await put(f, `/events/${ev.id}/tiers`, [{ sectionId: f.sectionId, priceCents: 1000 }]);
    const res = await post(f, `/events/${ev.id}/publish`);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('in_the_past');
  });
  it('second sequential publish is 409 not_draft', async () => {
    const f = await makeTenantFixture(t);
    const res = await post(f, `/events/${f.draftEventId}/publish`);
    expect(res.status).toBe(200);
    const again = await post(f, `/events/${f.draftEventId}/publish`);
    expect(again.status).toBe(409);
    expect(await code(again)).toBe('not_draft');
  });
  it('concurrent publishes: exactly one wins and seats are not doubled', async () => {
    const f = await makeTenantFixture(t);
    const results = await Promise.all([post(f, `/events/${f.draftEventId}/publish`), post(f, `/events/${f.draftEventId}/publish`)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await seatCount(f.draftEventId)).toBe(f.seatIds.length);
  });
  it('PATCH and PUT tiers on a published event are 409 not_draft', async () => {
    const f = await makeTenantFixture(t);
    const patch = await call(t.app, f.manager.cookie, 'PATCH', `/tenants/${f.tenantId}/events/${f.eventId}`, { name: 'New' });
    expect(patch.status).toBe(409);
    expect(await code(patch)).toBe('not_draft');
    const tiers = await put(f, `/events/${f.eventId}/tiers`, [{ sectionId: f.sectionId, priceCents: 1 }]);
    expect(tiers.status).toBe(409);
    expect(await code(tiers)).toBe('not_draft');
  });
  it('PATCH updates a draft', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, f.manager.cookie, 'PATCH', `/tenants/${f.tenantId}/events/${f.draftEventId}`, { name: 'Renamed', admissionLimit: 0 });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { event: { name: string; admissionLimit: number } }).event).toMatchObject({ name: 'Renamed', admissionLimit: 0 });
  });
  it('400 when a tier names a section of another venue', async () => {
    const f = await makeTenantFixture(t);
    const g = await makeTenantFixture(t);
    const res = await put(f, `/events/${f.draftEventId}/tiers`, [{ sectionId: g.sectionId, priceCents: 100 }]);
    expect(res.status).toBe(400);
  });
  it('cross-tenant access is 404', async () => {
    const f = await makeTenantFixture(t);
    expect((await call(t.app, f.outsider.cookie, 'GET', `/tenants/${f.outsiderTenantId}/events/${f.eventId}`)).status).toBe(404);
    expect((await call(t.app, f.manager.cookie, 'GET', `/tenants/${f.tenantId}/events/${f.outsiderEventId}`)).status).toBe(404);
    expect((await call(t.app, f.manager.cookie, 'GET', `/tenants/${f.tenantId}/events/nope`)).status).toBe(404);
  });
  it('lists tenant events with capacity and sold', async () => {
    const f = await makeTenantFixture(t);
    const res = await call(t.app, f.manager.cookie, 'GET', `/tenants/${f.tenantId}/events`);
    const { events } = (await res.json()) as { events: { id: string; capacity: number; sold: number; venueName: string }[] };
    const pub = events.find((e) => e.id === f.eventId);
    expect(pub).toMatchObject({ capacity: f.seatIds.length, sold: 0 });
    expect(events.find((e) => e.id === f.draftEventId)?.capacity).toBe(0);
  });
  it('close: published becomes closed, a draft is 409 not_published', async () => {
    const f = await makeTenantFixture(t);
    expect((await post(f, `/events/${f.eventId}/close`)).status).toBe(200);
    const row = await t.db.execute(sql`select status from events where id = ${f.eventId}::uuid`);
    expect(row.rows[0]?.status).toBe('closed');
    const res = await post(f, `/events/${f.draftEventId}/close`);
    expect(res.status).toBe(409);
    expect(await code(res)).toBe('not_published');
  });
});
