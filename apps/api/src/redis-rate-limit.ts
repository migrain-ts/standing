import type { Context, MiddlewareHandler } from 'hono';
import type { Redis } from 'ioredis';
import type { Clock } from '@standing/shared';
import { ApiError } from './errors';

export function redisRateLimit(o: {
  redis: Redis | undefined;
  clock: Clock;
  prefix: string;
  windowMs: number;
  max: number;
  key: (c: Context) => string;
}): MiddlewareHandler {
  return async (c, next) => {
    const { redis } = o;
    if (redis) {
      let n = 0;
      try {
        const window = Math.floor(o.clock.now().getTime() / o.windowMs);
        const k = `rl:${o.prefix}:${o.key(c)}:${window}`;
        n = await redis.incr(k);
        if (n === 1) await redis.pexpire(k, o.windowMs * 2);
      } catch {
        n = 0; // Redis failure: fail open
      }
      if (n > o.max) throw new ApiError(429, 'rate_limited', 'Too many requests, slow down');
    }
    await next();
  };
}
