import { Hono } from 'hono';
import type { Db } from '@standing/db';
import type { Clock } from '@standing/shared';
import { rushParamsSchema, startRush, type Rush } from './run';

export type SimulatorDeps = { token: string; apiUrl: string; db: Db; clock?: Clock };

const err = (code: string, message: string) => ({ error: { code, message } });

export function createSimulatorServer(deps: SimulatorDeps): Hono {
  const runs = new Map<string, { rush: Rush; eventId: string }>();
  const latestByEvent = new Map<string, string>();
  const view = (rush: Rush) => ({ id: rush.id, stats: rush.stats() });

  return new Hono()
    .use('*', async (c, next) => {
      if (c.req.header('x-simulator-token') !== deps.token) return c.json(err('unauthorized', 'Wrong simulator token'), 401);
      await next();
    })
    .post('/runs', async (c) => {
      const raw: unknown = await c.req.json().catch(() => null);
      const parsed = rushParamsSchema.safeParse(raw);
      if (!parsed.success) return c.json(err('invalid_request', parsed.error.message), 400);
      const params = parsed.data;
      const prev = runs.get(latestByEvent.get(params.eventId) ?? '');
      if (prev && prev.rush.stats().status === 'running') return c.json(err('rush_running', 'A rush is already running for this event'), 409);
      const rush = startRush(deps, params);
      runs.set(rush.id, { rush, eventId: params.eventId });
      latestByEvent.set(params.eventId, rush.id);
      return c.json(view(rush), 202);
    })
    .get('/runs/:id', (c) => {
      const run = runs.get(c.req.param('id'));
      return run ? c.json(view(run.rush)) : c.json(err('not_found', 'Unknown run'), 404);
    })
    .get('/runs', (c) => {
      const eventId = c.req.query('eventId');
      const run = eventId ? runs.get(latestByEvent.get(eventId) ?? '') : undefined;
      return run ? c.json(view(run.rush)) : c.json(err('not_found', 'No run for this event'), 404);
    })
    .delete('/runs/:id', (c) => {
      const run = runs.get(c.req.param('id'));
      if (!run) return c.json(err('not_found', 'Unknown run'), 404);
      run.rush.stop();
      return c.json(view(run.rush));
    });
}
