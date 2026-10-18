import { Hono } from 'hono';
import type { Db } from '@standing/db';
import type { Clock, TenantRoleName } from '@standing/shared';
import { authRoutes } from './auth/routes';
import { errorHandler } from './errors';
import { tenantRoutes } from './routes/tenants';
import { venueRoutes } from './routes/venues';

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
export type Env = {
  Variables: { user: AuthUser; deps: Deps; tenantId: string; tenantRole: TenantRoleName };
};

export function createApp(deps: Deps) {
  return new Hono<Env>()
    .use('*', async (c, next) => {
      c.set('deps', deps);
      await next();
    })
    .onError(errorHandler)
    .notFound((c) => c.json({ error: { code: 'not_found', message: 'Not found' } }, 404))
    .route('/auth', authRoutes(deps))
    .route('/', tenantRoutes())
    .route('/', venueRoutes());
}

export type AppType = ReturnType<typeof createApp>;
