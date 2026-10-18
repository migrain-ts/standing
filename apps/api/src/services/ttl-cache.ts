import type { Clock } from '@standing/shared';

/** Coalesces concurrent reads and reuses a result for `ttlMs` of clock time, so polling clients cannot overload Postgres. */
export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();
  constructor(
    private load: (key: string) => Promise<T>,
    private clock: Clock,
    private ttlMs = 500,
  ) {}

  get(key: string): Promise<T> {
    const now = this.clock.now().getTime();
    const hit = this.entries.get(key);
    if (hit && now - hit.at <= this.ttlMs) return hit.value;
    const value = this.load(key);
    this.entries.set(key, { at: now, value });
    value.catch(() => {
      if (this.entries.get(key)?.value === value) this.entries.delete(key);
    });
    return value;
  }
}
