import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { insertPaidOrder } from '@standing/db';
import { signTicket } from '@standing/core';
import { asId, type TicketId } from '@standing/shared';
import { makeTenantFixture, type TenantFixture } from '../fixtures';
import { makeApp, makeUser, type TestApp } from '../test-helpers';
import { ApiError } from '../errors';
import { scanTicket } from './scan';

let t: TestApp;
let f: TenantFixture;
let buyerId: string;
let nextSeat = 0;
beforeAll(async () => {
  t = await makeApp();
  f = await makeTenantFixture(t);
  buyerId = (await makeUser(t, 'buyer')).id;
});
afterAll(async () => {
  await t.close();
});

async function newTicket() {
  const seatId = f.seatIds[nextSeat++];
  if (!seatId) throw new Error('out of seats');
  const { ticketIds } = await insertPaidOrder(t.db, { tenantId: f.tenantId, eventId: f.eventId, buyerId, seatIds: [seatId], at: t.clock.now() });
  const id = asId<'TicketId'>(String(ticketIds[0])) as TicketId;
  return { id, code: signTicket(t.deps.config.ticketSecret, id) };
}
const state = async (id: string) => {
  const r = await t.db.execute(sql`select scanned_at, scanned_by from tickets where id = ${id}::uuid`);
  return r.rows[0];
};
const outboxCount = async () => Number((await t.db.execute(sql`select count(*)::int as n from outbox where kind = 'ticket.scanned'`)).rows[0]?.n);

describe('scanTicket', () => {
  it('admits a valid ticket once: sets scanned_at and scanned_by and writes one outbox row', async () => {
    const { id, code } = await newTicket();
    const before = await outboxCount();
    const r = await scanTicket(t.deps, { userId: f.door.id, code });
    expect(r.result).toBe('admitted');
    if (r.result !== 'admitted') return;
    expect(r.scannedAt).toBe(t.clock.now().toISOString());
    expect(r.ticket.id).toBe(id);
    expect(r.ticket.eventName).toBeTruthy();
    const row = await state(id);
    expect(row?.scanned_by).toBe(f.door.id);
    expect(row?.scanned_at).toBeTruthy();
    expect(await outboxCount()).toBe(before + 1);
    const ob = await t.db.execute(sql`select payload, tenant_id, event_id from outbox where dedupe_key = ${`ticket.scanned:${id}`}`);
    expect(ob.rows[0]?.payload).toEqual({ ticketId: id, at: t.clock.now().toISOString() });
    expect(ob.rows[0]?.tenant_id).toBe(f.tenantId);
    expect(ob.rows[0]?.event_id).toBe(f.eventId);
  });

  it('reports already_scanned with the first scan time, without changing the row or the outbox', async () => {
    const { id, code } = await newTicket();
    const first = await scanTicket(t.deps, { userId: f.door.id, code });
    const firstAt = first.result === 'admitted' ? first.scannedAt : 'x';
    const count = await outboxCount();
    t.clock.advanceMs(60_000);
    const again = await scanTicket(t.deps, { userId: f.manager.id, code });
    expect(again).toMatchObject({ result: 'already_scanned', firstScannedAt: firstAt });
    expect(await outboxCount()).toBe(count);
    expect((await state(id))?.scanned_by).toBe(f.door.id);
  });

  it('lets exactly one of 20 simultaneous scans of the same code win', async () => {
    const { code } = await newTicket();
    const results = await Promise.all(Array.from({ length: 20 }, () => scanTicket(t.deps, { userId: f.door.id, code })));
    const won = results.filter((r) => r.result === 'admitted');
    const lost = results.filter((r) => r.result === 'already_scanned');
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(19);
    const winner = won[0];
    for (const l of lost) expect(l.result === 'already_scanned' && winner?.result === 'admitted' && l.firstScannedAt === winner.scannedAt).toBe(true);
  });

  it('rejects forged, truncated and foreign-secret codes with invalid_code before any database access', async () => {
    const { id, code } = await newTicket();
    const count = await outboxCount();
    const spy = vi.spyOn(t.db, 'execute');
    const txSpy = vi.spyOn(t.db, 'transaction');
    const bad = [code.slice(0, -3), code.replace(/.$/, code.endsWith('A') ? 'B' : 'A'), signTicket('other-secret', id), 'garbage', ''];
    for (const c of bad) {
      await expect(scanTicket(t.deps, { userId: f.door.id, code: c })).rejects.toMatchObject({ status: 400, code: 'invalid_code' });
    }
    expect(spy).not.toHaveBeenCalled();
    expect(txSpy).not.toHaveBeenCalled();
    spy.mockRestore();
    txSpy.mockRestore();
    expect((await state(id))?.scanned_at).toBeNull();
    expect(await outboxCount()).toBe(count);
  });

  it('answers wrong_event, without marking the ticket, when eventId does not match', async () => {
    const { id, code } = await newTicket();
    const count = await outboxCount();
    const r = await scanTicket(t.deps, { userId: f.door.id, code, eventId: f.outsiderEventId });
    expect(r.result).toBe('wrong_event');
    expect((await state(id))?.scanned_at).toBeNull();
    expect(await outboxCount()).toBe(count);
    expect((await scanTicket(t.deps, { userId: f.door.id, code, eventId: f.eventId })).result).toBe('admitted');
  });

  it('hides a ticket from users who are not members of its tenant (404, not 403)', async () => {
    const { id, code } = await newTicket();
    const buyer = await makeUser(t, 'plainbuyer');
    for (const userId of [f.outsider.id, buyer.id, buyerId]) {
      const err = await scanTicket(t.deps, { userId, code }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toMatchObject({ status: 404 });
    }
    expect((await state(id))?.scanned_at).toBeNull();
  });

  it('lets door, manager and owner members scan', async () => {
    for (const u of [f.door, f.manager, f.owner]) {
      const { code } = await newTicket();
      expect((await scanTicket(t.deps, { userId: u.id, code })).result).toBe('admitted');
    }
  });
});
