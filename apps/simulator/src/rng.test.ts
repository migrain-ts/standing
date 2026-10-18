import { describe, expect, it } from 'vitest';
import { mulberry32, pickRun, seedFromId } from './rng';

describe('rng', () => {
  it('is deterministic for a seed and stays in [0, 1)', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 1000; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
    expect(mulberry32(1)()).not.toBe(mulberry32(2)());
  });

  it('derives the same seed from the same run id', () => {
    expect(seedFromId('run-1')).toBe(seedFromId('run-1'));
    expect(seedFromId('run-1')).not.toBe(seedFromId('run-2'));
  });

  it('pickRun returns k consecutive idx values that are all free', () => {
    const free = [0, 1, 2, 5, 6, 9];
    const rng = mulberry32(7);
    for (let i = 0; i < 200; i++) {
      const run = pickRun(free, 2, rng);
      expect(run).not.toBeNull();
      const [a, b] = run ?? [];
      expect(b).toBe((a ?? -1) + 1);
      expect(free).toContain(a);
      expect(free).toContain(b);
    }
  });

  it('pickRun returns null when no such run exists', () => {
    expect(pickRun([0, 2, 4], 2, mulberry32(1))).toBeNull();
    expect(pickRun([], 1, mulberry32(1))).toBeNull();
    expect(pickRun([3], 1, mulberry32(1))).toEqual([3]);
  });
});
