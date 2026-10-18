import { Hono } from 'hono';
import type { Env } from '../app';
import { getPublicEvent, listPublicEvents } from '../services/events';
import { loadVenueMap } from '../services/venues';

export function publicRoutes() {
  return new Hono<Env>()
    .get('/public/events', async (c) => {
      const d = c.get('deps');
      return c.json({ events: await listPublicEvents(d.db, d.clock) });
    })
    .get('/public/events/:eventId', async (c) => {
      const d = c.get('deps');
      return c.json({ event: await getPublicEvent(d.db, d.clock, c.req.param('eventId')) });
    })
    .get('/public/events/:eventId/map', async (c) => {
      const d = c.get('deps');
      const event = await getPublicEvent(d.db, d.clock, c.req.param('eventId'));
      c.header('Cache-Control', 'public, max-age=300');
      return c.json(await loadVenueMap(d.db, event.venueId));
    })
    .get('/public/events/:eventId/availability', async (c) => {
      const d = c.get('deps');
      const event = await getPublicEvent(d.db, d.clock, c.req.param('eventId'));
      return c.json(await c.get('svc').availability.get(event.id));
    });
}
