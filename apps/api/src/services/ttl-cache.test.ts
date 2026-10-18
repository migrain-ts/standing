import { describe, expect, it } from 'vitest';
import { FakeClock } from '@standing/shared';
import { TtlCache } from './ttl-cache';

type Sample = { at: string; held: number[]; sold: number[] };
const sample = (n: number): Sample => ({ at: `t${n}`, held: [n], sold: [] });

describe('TtlCache', () => {
  it('shares one load between concurrent callers', async () => {
    let calls = 0;
    const cache = new TtlCache(async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return sample(calls); }, new FakeClock(new Date(0)));
    const results = await Promise.all(Array.from({ length: 50 }, () => cache.get('e1')));
    expect(calls).toBe(1);
    expect(new Set(results.map((r) => r.at)).size).toBe(1);
  });
  it('reuses a result for the ttl of clock time, then reloads', async () => {
    const clock = new FakeClock(new Date(0));
    let calls = 0;
    const cache = new TtlCache(async () => sample(++calls), clock, 500);
    await cache.get('e1');
    clock.advanceMs(499);
    await cache.get('e1');
    expect(calls).toBe(1);
    clock.advanceMs(2);
    await cache.get('e1');
    expect(calls).toBe(2);
  });
  it('keeps events apart and does not cache a failure', async () => {
    let fail = true;
    const cache = new TtlCache(async (id) => { if (fail) throw new Error('boom'); return { at: id, held: [], sold: [] }; }, new FakeClock(new Date(0)));
    await expect(cache.get('a')).rejects.toThrow('boom');
    fail = false;
    expect((await cache.get('a')).at).toBe('a');
    expect((await cache.get('b')).at).toBe('b');
  });
});
