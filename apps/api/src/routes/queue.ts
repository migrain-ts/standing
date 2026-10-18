import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { Clock } from '@standing/shared';
import type { AuthUser, Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { redisRateLimit } from '../redis-rate-limit';
import { getPublicEvent } from '../services/events';

const DEGRADED = { ticket: 'open', state: 'admitted', degraded: true } as const;

export function queueRoutes(deps: { redis?: Redis | undefined; clock: Clock }) {
  const joinLimit = redisRateLimit({
    redis: deps.redis,
    clock: deps.clock,
    prefix: 'queue',
    windowMs: 60_000,
    max: 30,
    key: (c) => {
      const user: AuthUser = c.get('user');
      return user.id;
    },
  });
  return new Hono<Env>()
    .post('/public/events/:eventId/queue', requireAuth, joinLimit, async (c) => {
      const d = c.get('deps');
      const event = await getPublicEvent(d.db, d.clock, c.req.param('eventId'));
      const room = c.get('svc').waitingRoom;
      if (!room || event.admissionLimit <= 0) return c.json(DEGRADED);
      try {
        return c.json(await room.join(event.id, event.admissionLimit));
      } catch {
        return c.json(DEGRADED);
      }
    })
    .get('/public/events/:eventId/queue/:ticket', requireAuth, async (c) => {
      const d = c.get('deps');
      const event = await getPublicEvent(d.db, d.clock, c.req.param('eventId'));
      const room = c.get('svc').waitingRoom;
      if (!room || event.admissionLimit <= 0) return c.json(DEGRADED);
      const ticket = c.req.param('ticket');
      try {
        return c.json({ ticket, ...(await room.status(event.id, ticket, event.admissionLimit)) });
      } catch {
        return c.json(DEGRADED);
      }
    });
}
