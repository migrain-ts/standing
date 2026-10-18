import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertPaidOrder } from '@standing/db';
import { signTicket } from '@standing/core';
import { asId } from '@standing/shared';
import { makeTenantFixture, type TenantFixture } from '../fixtures';
import { call, makeApp, makeUser, type TestApp } from '../test-helpers';

let t: TestApp;
let f: TenantFixture;
let code: string;
beforeAll(async () => {
  t = await makeApp();
  f = await makeTenantFixture(t);
  const buyer = await makeUser(t, 'buyer');
  const { ticketIds } = await insertPaidOrder(t.db, {
    tenantId: f.tenantId, eventId: f.eventId, buyerId: buyer.id, seatIds: [f.seatIds[0] ?? '', f.seatIds[1] ?? ''], at: t.clock.now(),
  });
  code = signTicket(t.deps.config.ticketSecret, asId<'TicketId'>(String(ticketIds[0])));
});
afterAll(async () => {
  await t.close();
});

type Err = { error: { code: string } };
type EventsBody = { events: { id: string; name: string; sold: number; scanned: number; tenantName: string; startsAt: string }[] };

describe('door routes', () => {
  it('requires a session', async () => {
    expect((await call(t.app, null, 'POST', '/door/scan', { code })).status).toBe(401);
    expect((await call(t.app, null, 'GET', '/door/events')).status).toBe(401);
  });

  it('validates the body', async () => {
    expect((await call(t.app, f.door.cookie, 'POST', '/door/scan', {})).status).toBe(400);
    expect((await call(t.app, f.door.cookie, 'POST', '/door/scan', { code: '' })).status).toBe(400);
    expect((await call(t.app, f.door.cookie, 'POST', '/door/scan', { code, eventId: 'nope' })).status).toBe(400);
  });

  it('answers invalid_code for a forged code and 404 for an outsider', async () => {
    const bad = await call(t.app, f.door.cookie, 'POST', '/door/scan', { code: 'STD1.nope.nope' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as Err).error.code).toBe('invalid_code');
    expect((await call(t.app, f.outsider.cookie, 'POST', '/door/scan', { code })).status).toBe(404);
  });

  it('scans: admitted then already_scanned, both 200', async () => {
    const a = await call(t.app, f.door.cookie, 'POST', '/door/scan', { code, eventId: f.eventId });
    expect(a.status).toBe(200);
    expect(await a.json()).toMatchObject({ result: 'admitted', scannedAt: t.clock.now().toISOString() });
    const b = await call(t.app, f.door.cookie, 'POST', '/door/scan', { code });
    expect(b.status).toBe(200);
    expect(await b.json()).toMatchObject({ result: 'already_scanned', firstScannedAt: t.clock.now().toISOString() });
  });

  it('lists the published events of the caller tenants with sold and scanned counts', async () => {
    const res = await call(t.app, f.door.cookie, 'GET', '/door/events');
    expect(res.status).toBe(200);
    const { events } = (await res.json()) as EventsBody;
    const mine = events.find((e) => e.id === f.eventId);
    expect(mine).toMatchObject({ sold: 2, scanned: 1, tenantName: 'Fixture Tenant' });
    expect(events.some((e) => e.id === f.outsiderEventId || e.id === f.draftEventId)).toBe(false);
    const other = (await (await call(t.app, f.outsider.cookie, 'GET', '/door/events')).json()) as EventsBody;
    expect(other.events.map((e) => e.id)).toEqual([f.outsiderEventId]);
  });
});
