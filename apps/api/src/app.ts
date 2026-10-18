import { Queue } from 'bullmq';
import { Hono } from 'hono';
import type { Redis } from 'ioredis';
import type { Db } from '@standing/db';
import type { Clock, TenantRoleName } from '@standing/shared';
import { DOCUMENT_QUEUE } from '@standing/core';
import { authRoutes } from './auth/routes';
import { errorHandler } from './errors';
import { tenantRoutes } from './routes/tenants';
import { doorRoutes } from './routes/door';
import { documentRoutes } from './routes/documents';
import { eventRoutes } from './routes/events';
import { exportRoutes } from './routes/exports';
import { overviewRoutes } from './routes/overview';
import { holdRoutes } from './routes/holds';
import { orderRoutes } from './routes/orders';
import { publicRoutes } from './routes/public';
import { queueRoutes } from './routes/queue';
import { rushRoutes } from './routes/rush';
import { liveRoutes } from './routes/live';
import { venueRoutes } from './routes/venues';
import { availabilityLoader, type Availability } from './services/availability';
import { LiveBus } from './services/live-bus';
import { totalsLoader, type Totals } from './services/live';
import { TtlCache } from './services/ttl-cache';
import { WaitingRoom } from './services/waiting-room';

export type AppConfig = {
  holdTtlSeconds: number;
  paymentLatencyMs: number;
  paymentFailureRate: number;
  ticketSecret: string;
  demoLogin: boolean;
  simulatorUrl?: string | undefined;
  simulatorToken?: string | undefined;
  /** The URL at which the simulator reaches this API. */
  simulatorApiUrl: string;
};
export type Deps = {
  db: Db;
  clock: Clock;
  config: AppConfig;
  appUrl: string;
  secureCookies?: boolean;
  trustProxy?: boolean;
  redis?: Redis;
  random?: () => number;
  liveTickMs?: number;
  /** Dedicated Redis connection for pattern subscribe (redis.duplicate()); without it the live bus never delivers. */
  liveSub?: Redis;
};
export type AuthUser = { id: string; email: string; name: string };
export type Services = {
  availability: TtlCache<Availability>;
  waitingRoom?: WaitingRoom;
  liveBus: LiveBus;
  totals: TtlCache<Totals>;
  documentQueue?: Queue;
};
export type AppOptions = {
  /** Test seam: skip building the BullMQ queue (for stub Redis clients that cannot back a real queue). */
  noDocumentQueue?: boolean;
  /** Test seam: wraps the totals loader (e.g. to count computations). */
  wrapTotalsLoader?: (load: (eventId: string) => Promise<Totals>) => (eventId: string) => Promise<Totals>;
};
export type Env = {
  Variables: { user: AuthUser; deps: Deps; svc: Services; tenantId: string; tenantRole: TenantRoleName };
};

export function createApp(deps: Deps, opts: AppOptions = {}) {
  return createAppWithServices(deps, opts).app;
}

export function createAppWithServices(deps: Deps, opts: AppOptions = {}) {
  const wrap = opts.wrapTotalsLoader ?? ((l) => l);
  const waitingRoom = deps.redis ? new WaitingRoom(deps.redis, deps.clock) : undefined;
  const documentQueue = deps.redis && !opts.noDocumentQueue ? new Queue(DOCUMENT_QUEUE, { connection: deps.redis }) : undefined;
  documentQueue?.on('error', () => {}); // Redis outages are expected: the sweeper recovers unenqueued documents
  const svc: Services = {
    availability: new TtlCache(availabilityLoader(deps.db, deps.clock), deps.clock),
    ...(waitingRoom ? { waitingRoom } : {}),
    ...(documentQueue ? { documentQueue } : {}),
    liveBus: new LiveBus(deps.liveSub),
    totals: new TtlCache(wrap(totalsLoader(deps, waitingRoom)), deps.clock, 1000),
  };
  const app = new Hono<Env>()
    .use('*', async (c, next) => {
      c.set('deps', deps);
      c.set('svc', svc);
      await next();
    })
    .onError(errorHandler)
    .notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))
    .route('/auth', authRoutes(deps))
    .route('/', tenantRoutes())
    .route('/', venueRoutes())
    .route('/', eventRoutes())
    .route('/', publicRoutes())
    .route('/', queueRoutes(deps))
    .route('/', holdRoutes(deps))
    .route('/', orderRoutes(deps))
    .route('/', documentRoutes())
    .route('/', doorRoutes())
    .route('/', liveRoutes())
    .route('/', exportRoutes())
    .route('/', overviewRoutes())
    .route('/', rushRoutes());
  return { app, svc };
}

export type AppType = ReturnType<typeof createApp>;
