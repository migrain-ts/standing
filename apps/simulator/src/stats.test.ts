import { describe, expect, it } from 'vitest';
import { createStats, percentile } from './stats';

const params = { eventId: 'e', buyers: 1, maxSeatsPerBuyer: 1, durationSeconds: 1 };

describe('percentile', () => {
  it('reads p50 and p95 from a sorted sample', () => {
    const sample = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(sample, 0.5)).toBe(50);
    expect(percentile(sample, 0.95)).toBe(95);
    expect(percentile([7], 0.95)).toBe(7);
  });
  it('gives 0 for an empty sample', () => {
    expect(percentile([], 0.5)).toBe(0);
  });
});

describe('createStats', () => {
  it('increments counters and reports latency percentiles', async () => {
    const s = createStats(params, new Date('2026-01-01T00:00:00Z'));
    await Promise.all(Array.from({ length: 500 }, async () => s.inc('started')));
    s.inc('paid');
    for (const ms of [30, 10, 20]) s.recordHold(ms);
    s.recordPay(5);
    s.request();
    const snap = s.snapshot('running');
    expect(snap.counters.started).toBe(500);
    expect(snap.counters.paid).toBe(1);
    expect(snap.latencyMs.holdP50).toBe(20);
    expect(snap.latencyMs.payP95).toBe(5);
    expect(snap.requests).toBe(1);
    expect(snap.status).toBe('running');
    expect(snap.finishedAt).toBeUndefined();
    expect(s.snapshot('finished', new Date('2026-01-01T00:01:00Z')).finishedAt).toBe('2026-01-01T00:01:00.000Z');
  });
});
