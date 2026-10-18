import { numberFromEnv } from '@standing/shared';
import type { AppConfig } from './app';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const secret = env.TICKET_SECRET ?? (env.NODE_ENV === 'production' ? undefined : 'dev-only-ticket-secret-change-me');
  if (!secret) throw new Error('TICKET_SECRET is required in production');
  return {
    holdTtlSeconds: numberFromEnv(env.HOLD_TTL_SECONDS, 600, 1),
    paymentLatencyMs: numberFromEnv(env.PAYMENT_LATENCY_MS, 150, 0),
    paymentFailureRate: Math.min(1, numberFromEnv(env.PAYMENT_FAILURE_RATE, 0.05, 0)),
    ticketSecret: secret,
    demoLogin: env.DEMO_LOGIN === '1',
    simulatorUrl: env.SIMULATOR_URL,
    simulatorToken: env.SIMULATOR_TOKEN,
    simulatorApiUrl: env.SIMULATOR_API_URL ?? 'http://localhost:4100',
  };
}
