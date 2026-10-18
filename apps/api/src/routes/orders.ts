import { desc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { enqueueDocument } from '@standing/core';
import { schema } from '@standing/db';
import type { AuthUser, Deps, Env } from '../app';
import { requireAuth } from '../auth/middleware';
import { ApiError } from '../errors';
import { redisRateLimit } from '../redis-rate-limit';
import { loadOrderView, payHold } from '../services/payments';

export function orderRoutes(deps: Pick<Deps, 'redis' | 'clock'>) {
  const payLimit = redisRateLimit({
    redis: deps.redis,
    clock: deps.clock,
    prefix: 'pay',
    windowMs: 60_000,
    max: 30,
    key: (c) => {
      const user: AuthUser = c.get('user');
      return user.id;
    },
  });
  return new Hono<Env>()
    .post('/holds/:holdId/pay', requireAuth, payLimit, async (c) => {
      const d = c.get('deps');
      const key = c.req.header('idempotency-key');
      if (!key || key.length > 100) throw new ApiError(400, 'invalid_request', 'Idempotency-Key header (1 to 100 characters) is required');
      const res = await payHold(d, { holdId: c.req.param('holdId'), buyerId: c.get('user').id, idempotencyKey: key });
      if (res.kind === 'declined') throw new ApiError(402, 'payment_declined', 'The payment was declined, try again');
      const ticket = c.req.header('x-queue-ticket');
      const room = c.get('svc').waitingRoom;
      if (!res.replayed && ticket && room) {
        try {
          await room.release(res.order.eventId, ticket);
        } catch {
          // best effort: the admission expires on its own
        }
      }
      if (!res.replayed && res.order.documentId) await enqueueDocument(c.get('svc').documentQueue, res.order.documentId); // after commit; the sweeper recovers failures
      return c.json({ order: res.order }, 201);
    })
    .get('/me/orders', requireAuth, async (c) => {
      const rows = await c
        .get('deps')
        .db.select({
          id: schema.orders.id,
          eventId: schema.orders.eventId,
          eventName: schema.events.name,
          totalCents: schema.orders.totalCents,
          createdAt: schema.orders.createdAt,
        })
        .from(schema.orders)
        .innerJoin(schema.events, eq(schema.events.id, schema.orders.eventId))
        .where(eq(schema.orders.buyerId, c.get('user').id))
        .orderBy(desc(schema.orders.createdAt), desc(schema.orders.id));
      return c.json({ orders: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) });
    })
    .get('/orders/:orderId', requireAuth, async (c) => {
      const d = c.get('deps');
      return c.json({ order: await loadOrderView(d.db, d.config.ticketSecret, c.req.param('orderId'), c.get('user').id) });
    });
}
