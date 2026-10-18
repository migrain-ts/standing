import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

describe('loadConfig', () => {
  it('uses defaults', () => {
    expect(loadConfig({})).toMatchObject({ holdTtlSeconds: 600, paymentLatencyMs: 150, paymentFailureRate: 0.05, demoLogin: false });
  });
  it('reads overrides and clamps the failure rate to 0..1', () => {
    const c = loadConfig({ HOLD_TTL_SECONDS: '30', PAYMENT_LATENCY_MS: '0', PAYMENT_FAILURE_RATE: '7', DEMO_LOGIN: '1' });
    expect(c).toMatchObject({ holdTtlSeconds: 30, paymentLatencyMs: 0, paymentFailureRate: 1, demoLogin: true });
  });
  it('refuses to run in production without a ticket secret', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow('TICKET_SECRET');
  });
});
