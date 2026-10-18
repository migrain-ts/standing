import { Redis } from 'ioredis';

export function createRedis(url: string, log: (line: string) => void = console.error): Redis {
  const seen = new Set<string>();
  const redis = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    retryStrategy: (n) => Math.min(n * 200, 2000),
  });
  redis.on('error', (err: Error) => {
    if (seen.has(err.message)) return;
    seen.add(err.message);
    log(`[redis] ${err.message}`);
  });
  redis.on('ready', () => seen.clear());
  return redis;
}
