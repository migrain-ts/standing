import { Hono } from 'hono';
import { holdCreateSchema } from '@standing/shared';
import type { AuthUser, Deps, Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { ApiError } from '../errors';
import { redisRateLimit } from '../redis-rate-limit';
import { getPublicEvent } from '../services/events';
import { cancelHold, createHold, getHold } from '../services/holds';
import { checkGate } from '../services/waiting-room';
import { validator } from '../validate';

export function holdRoutes(deps: Pick<Deps, 'redis' | 'clock'>) {
  const holdLimit = redisRateLimit({
    redis: deps.redis,
    clock: deps.clock,
    prefix: 'hold',
    windowMs: 60_000,
    max: 60,
    key: (c) => {
      const user: AuthUser = c.get('user');
      return user.id;
    },
  });
  return new Hono<Env>()
    .post('/public/events/:eventId/holds', requireAuth, holdLimit, validator('json', holdCreateSchema), async (c) => {
      const d = c.get('deps');
      const event = await getPublicEvent(d.db, d.clock, c.req.param('eventId'));
      const gate = await checkGate(c.get('svc').waitingRoom, event.id, c.req.header('x-queue-ticket'), event.admissionLimit);
      if (gate === 'denied') throw new ApiError(403, 'queue_required', 'Join the waiting room first');
      const hold = await createHold(d, { buyerId: c.get('user').id, eventId: event.id, seatIds: c.req.valid('json').seatIds });
      return c.json({ hold }, 201);
    })
    .get('/holds/:holdId', requireAuth, async (c) => {
      const hold = await getHold(c.get('deps'), { buyerId: c.get('user').id, holdId: c.req.param('holdId') });
      return c.json({ hold });
    })
    .delete('/holds/:holdId', requireAuth, async (c) => {
      await cancelHold(c.get('deps'), { buyerId: c.get('user').id, holdId: c.req.param('holdId') });
      return c.body(null, 204);
    });
}
