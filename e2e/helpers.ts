import { expect, request, type APIRequestContext, type Page } from '@playwright/test';

export type Persona = 'organizer' | 'buyer' | 'door';
export const BASE_URL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:3200';

/** Signs the persona in through the demo endpoint; the cookie lands in the browser context of `page`. */
export async function loginAs(page: Page, persona: Persona): Promise<void> {
  const res = await page.request.post('/api/auth/demo', { data: { persona } });
  expect(res.ok(), `demo login as ${persona}`).toBe(true);
}

/** A standalone API client (own cookie jar) signed in as the persona. */
export async function apiAs(persona: Persona, baseURL = BASE_URL): Promise<APIRequestContext> {
  const api = await request.newContext({ baseURL });
  const res = await api.post('/api/auth/demo', { data: { persona } });
  expect(res.ok(), `demo login as ${persona}`).toBe(true);
  return api;
}

async function json<T>(res: Awaited<ReturnType<APIRequestContext['get']>>): Promise<T> {
  if (!res.ok()) throw new Error(`${res.url()} answered ${res.status()}: ${await res.text()}`);
  return (await res.json()) as T;
}

export type FreshEvent = { tenantId: string; eventId: string; name: string; capacity: number };

/**
 * Creates and publishes a brand new event (starting in 3 days, every section priced) through the organizer API.
 * Rush runs and door checks use it, so the suite never depends on how much of a seeded event is already sold.
 */
export async function createFreshEvent(
  organizer: APIRequestContext,
  opts: { tenant?: string; venue?: string; label?: string } = {},
): Promise<FreshEvent> {
  const { tenants } = await json<{ tenants: { id: string; name: string }[] }>(await organizer.get('/api/tenants'));
  const tenant = tenants.find((t) => t.name === (opts.tenant ?? 'Blue Note Live'));
  if (!tenant) throw new Error('Demo tenant not found: is the stack seeded?');
  const { venues } = await json<{ venues: { id: string; name: string; seatCount: number }[] }>(
    await organizer.get(`/api/tenants/${tenant.id}/venues`),
  );
  const venue = venues.find((v) => v.name === (opts.venue ?? 'Blue Note Hall'));
  if (!venue) throw new Error('Demo venue not found');
  const detail = await json<{ venue: { sections: { id: string }[] } }>(
    await organizer.get(`/api/tenants/${tenant.id}/venues/${venue.id}`),
  );
  const name = `${opts.label ?? 'Rush Night'} ${new Date().toISOString().slice(0, 19).replace('T', ' ')}`;
  const startsAt = new Date(Date.now() + 3 * 24 * 3600_000).toISOString();
  const base = `/api/tenants/${tenant.id}/events`;
  const { event } = await json<{ event: { id: string } }>(
    await organizer.post(base, { data: { venueId: venue.id, name, startsAt } }),
  );
  await json(
    await organizer.put(`${base}/${event.id}/tiers`, {
      data: detail.venue.sections.map((s, i) => ({ sectionId: s.id, priceCents: 4000 + i * 1500 })),
    }),
  );
  await json(await organizer.post(`${base}/${event.id}/publish`));
  return { tenantId: tenant.id, eventId: event.id, name, capacity: venue.seatCount };
}

/** Moves a keyboard-driven slider to `target` (Home, then ArrowRight until it reaches or stops moving). */
export async function setSlider(page: Page, name: string, target: number): Promise<void> {
  const slider = page.getByRole('slider', { name });
  await slider.focus();
  await slider.press('Home');
  for (let v = Number(await slider.getAttribute('aria-valuenow')); v < target; ) {
    await slider.press('ArrowRight');
    const next = Number(await slider.getAttribute('aria-valuenow'));
    if (next === v) break;
    v = next;
  }
  await expect(slider).toHaveAttribute('aria-valuenow', String(target));
}

/** Holds `count` seats of a published event as the buyer and pays; returns the order with its tickets. */
export async function buyTickets(
  buyer: APIRequestContext,
  eventId: string,
  count: number,
  offset = 0,
): Promise<{ id: string; documentId: string | null; tickets: { id: string; code: string }[] }> {
  const map = await json<{ seatIds: string[] }>(await buyer.get(`/api/public/events/${eventId}/map`));
  const seatIds = map.seatIds.slice(offset, offset + count);
  // The waiting room admits the first buyers at once on a quiet event; the ticket then travels in a header.
  const joined = await json<{ ticket?: string; state?: string }>(await buyer.post(`/api/public/events/${eventId}/queue`));
  const gate: Record<string, string> = joined.ticket ? { 'x-queue-ticket': joined.ticket } : {};
  const { hold } = await json<{ hold: { id: string } }>(
    await buyer.post(`/api/public/events/${eventId}/holds`, { data: { seatIds }, headers: gate }),
  );
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = await buyer.post(`/api/holds/${hold.id}/pay`, {
      headers: { 'idempotency-key': `e2e-${hold.id}-${attempt}`, ...gate },
    });
    if (res.status() === 402) continue; // the simulated gateway declines about 5% of attempts
    return (await json<{ order: { id: string; documentId: string | null; tickets: { id: string; code: string }[] } }>(res)).order;
  }
  throw new Error('payment was declined six times in a row');
}
