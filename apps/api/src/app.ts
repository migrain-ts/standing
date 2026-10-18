import { Hono } from 'hono';
import type { Db } from '@standing/db';
import type { Clock, TenantRoleName } from '@standing/shared';
import { authRoutes } from './auth/routes';
import { errorHandler } from './errors';
import { tenantRoutes } from './routes/tenants';
import { eventRoutes } from './routes/events';
import { publicRoutes } from './routes/public';
import { venueRoutes } from './routes/venues';
import { availabilityLoader, type Availability } from './services/availability';
import { TtlCache } from './services/ttl-cache';

export type AppConfig = {
  holdTtlSeconds: number;
  paymentLatencyMs: number;
  paymentFailureRate: number;
  ticketSecret: string;
  demoLogin: boolean;
  simulatorUrl?: string | undefined;
  simulatorToken?: string | undefined;
};
export type Deps = {
  db: Db;
  clock: Clock;
  config: AppConfig;
  appUrl: string;
  secureCookies?: boolean;
  trustProxy?: boolean;
};
export type AuthUser = { id: string; email: string; name: string };
export type Services = { availability: TtlCache<Availability> };
export type Env = {
  Variables: { user: AuthUser; deps: Deps; svc: Services; tenantId: string; tenantRole: TenantRoleName };
};

export function createApp(deps: Deps) {
  const svc: Services = { availability: new TtlCache(availabilityLoader(deps.db, deps.clock), deps.clock) };
  return new Hono<Env>()
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
    .route('/', publicRoutes());
}

export type AppType = ReturnType<typeof createApp>;
