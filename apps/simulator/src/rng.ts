import { createHash } from 'node:crypto';

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A run id always yields the same seed, so a failing run can be replayed. */
export function seedFromId(id: string): number {
  return createHash('sha256').update(id).digest().readUInt32BE(0);
}

export const between = (rng: Rng, lo: number, hi: number): number => lo + rng() * (hi - lo);

/** `k` consecutive idx values that are all in `free`, chosen at random among every such run, or null. */
export function pickRun(free: readonly number[], k: number, rng: Rng): number[] | null {
  const set = new Set(free);
  const starts = free.filter((s) => {
    for (let i = 1; i < k; i++) if (!set.has(s + i)) return false;
    return true;
  });
  const start = starts[Math.floor(rng() * starts.length)];
  return start === undefined ? null : Array.from({ length: k }, (_, i) => start + i);
}
