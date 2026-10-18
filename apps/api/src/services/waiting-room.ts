import { randomBytes } from 'node:crypto';
import type { Redis } from 'ioredis';
import type { Clock } from '@standing/shared';

export type AdmissionState =
  | { state: 'admitted'; expiresAt: number }
  | { state: 'waiting'; position: number; queueLength: number }
  | { state: 'unknown' };
export type Gate = 'open' | 'admitted' | 'denied';

// Atomically drops expired admissions, then moves the head of the queue into the active set until `capacity` is reached.
const ADMIT = `
redis.call('ZREMRANGEBYSCORE', KEYS[2], '-inf', ARGV[1])
local free = tonumber(ARGV[2]) - redis.call('ZCARD', KEYS[2])
if free <= 0 then return 0 end
local ids = redis.call('ZRANGE', KEYS[1], 0, free - 1)
for _, id in ipairs(ids) do
  redis.call('ZREM', KEYS[1], id)
  redis.call('ZADD', KEYS[2], tonumber(ARGV[1]) + tonumber(ARGV[3]), id)
end
return #ids`;

const q = (e: string) => `wr:${e}:q`;
const a = (e: string) => `wr:${e}:a`;
const seq = (e: string) => `wr:${e}:seq`;

export class WaitingRoom {
  private activeTtlMs: number;
  constructor(
    private redis: Redis,
    private clock: Clock,
    opts: { activeTtlMs?: number } = {},
  ) {
    this.activeTtlMs = opts.activeTtlMs ?? 300_000;
  }

  private async admit(eventId: string, capacity: number): Promise<void> {
    await this.redis.eval(ADMIT, 2, q(eventId), a(eventId), this.clock.now().getTime(), capacity, this.activeTtlMs);
  }

  async join(eventId: string, capacity: number): Promise<{ ticket: string } & AdmissionState> {
    const ticket = randomBytes(12).toString('base64url');
    const n = await this.redis.incr(seq(eventId));
    await this.redis.zadd(q(eventId), 'NX', n, ticket);
    return { ticket, ...(await this.status(eventId, ticket, capacity)) };
  }

  async status(eventId: string, ticket: string, capacity: number): Promise<AdmissionState> {
    await this.admit(eventId, capacity);
    const now = this.clock.now().getTime();
    const expiresAt = await this.redis.zscore(a(eventId), ticket);
    if (expiresAt !== null && Number(expiresAt) > now) return { state: 'admitted', expiresAt: Number(expiresAt) };
    const rank = await this.redis.zrank(q(eventId), ticket);
    if (rank === null) return { state: 'unknown' };
    return { state: 'waiting', position: rank + 1, queueLength: await this.redis.zcard(q(eventId)) };
  }

  async isAdmitted(eventId: string, ticket: string): Promise<boolean> {
    const score = await this.redis.zscore(a(eventId), ticket);
    return score !== null && Number(score) > this.clock.now().getTime();
  }

  async release(eventId: string, ticket: string): Promise<void> {
    await this.redis.zrem(a(eventId), ticket);
    await this.redis.zrem(q(eventId), ticket);
  }

  async stats(eventId: string): Promise<{ waiting: number; active: number }> {
    return { waiting: await this.redis.zcard(q(eventId)), active: await this.redis.zcard(a(eventId)) };
  }
}

/** Fails open: a missing or broken Redis never blocks a purchase, because Postgres alone prevents overselling. */
export async function checkGate(
  room: WaitingRoom | undefined,
  eventId: string,
  ticket: string | undefined,
  admissionLimit: number,
  log: (line: string) => void = console.error,
): Promise<Gate> {
  if (!room || admissionLimit <= 0) return 'open';
  if (!ticket) return 'denied';
  try {
    return (await room.isAdmitted(eventId, ticket)) ? 'admitted' : 'denied';
  } catch (err) {
    log(`[queue] gate open because Redis failed: ${err instanceof Error ? err.message : String(err)}`);
    return 'open';
  }
}
