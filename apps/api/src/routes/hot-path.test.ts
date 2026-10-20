import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { makeTenantFixture } from '../fixtures';
import { call, makeApp, makeUser, type TestApp } from '../test-helpers';

// Availability polls, queue joins and polls and holds run on every buyer's every few hundred milliseconds during a
// Rush. They resolve the event with a light lookup; only the cached availability loader reads event_seats.

let t: TestApp;
beforeAll(async () => {
  t = await makeApp();
});
afterAll(async () => {
  await t.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Records the SQL text of every query while `fn` runs. Patching Client.prototype.query sees pool queries and the
 * queries of Drizzle transactions (which run on a checked-out client), so no route body is invisible to it.
 */
async function capture(fn: () => Promise<void>): Promise<string[]> {
  const texts: string[] = [];
  const original = pg.Client.prototype.query as (this: pg.Client, ...args: unknown[]) => unknown;
  vi.spyOn(pg.Client.prototype, 'query').mockImplementation(function (this: pg.Client, ...args: unknown[]) {
    const q = args[0];
    texts.push(typeof q === 'string' ? q : String((q as { text?: unknown }).text ?? ''));
    return original.apply(this, args);
  } as unknown as typeof pg.Client.prototype.query);
  await fn();
  return texts;
}

const hotRoutes = (eventId: string, seatId: string) =>
  [
    ['GET', `/public/events/${eventId}/availability`, undefined],
    ['GET', `/public/events/${eventId}/map`, undefined],
    ['POST', `/public/events/${eventId}/queue`, undefined],
    ['GET', `/public/events/${eventId}/queue/open`, undefined],
    ['POST', `/public/events/${eventId}/holds`, { seatIds: [seatId] }],
  ] as const;

describe('hot paths', () => {
  it('availability, map, queue and hold routes run no aggregate over event_seats', async () => {
    const f = await makeTenantFixture(t);
    const buyer = await makeUser(t, 'hot');
    const statuses: number[] = [];
    const texts = await capture(async () => {
      for (const [method, path, body] of hotRoutes(f.eventId, f.seatIds[0]!)) {
        const res = await call(t.app, buyer.cookie, method, path, body);
        statuses.push(res.status);
        await res.arrayBuffer();
      }
    });
    expect(statuses).toEqual([200, 200, 200, 200, 201]);
    expect(texts.some((q) => /insert into\s+"?holds/i.test(q))).toBe(true); // the hold transaction body was seen
    expect(texts.filter((q) => /count\s*\(/i.test(q))).toEqual([]);
  });

  it('still answers 404 for a draft, a started and an unknown event', async () => {
    const f = await makeTenantFixture(t);
    const started = await makeTenantFixture(t);
    await t.db.execute(sql`update events set starts_at = ${new Date(t.clock.now().getTime() - 60_000)}::timestamptz where id = ${started.eventId}::uuid`);
    const buyer = await makeUser(t, 'hot404');
    for (const eventId of [f.draftEventId, started.eventId, '3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80', 'not-a-uuid']) {
      for (const [method, path, body] of hotRoutes(eventId, f.seatIds[0]!)) {
        const res = await call(t.app, buyer.cookie, method, path, body);
        expect(res.status, `${method} ${path}`).toBe(404);
      }
    }
  });
});
