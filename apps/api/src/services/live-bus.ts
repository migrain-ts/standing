import type { Redis } from 'ioredis';
import { z } from 'zod';
import { LIVE_CHANNEL_PATTERN, type EventDelta } from '@standing/core';

const deltaSchema = z.object({
  eventId: z.string(),
  tenantId: z.string(),
  tickets: z.number(),
  revenueCents: z.number(),
  seats: z.array(z.object({ idx: z.number(), sectionId: z.string() })),
  scanned: z.number(),
  at: z.string(),
});
const PREFIX = LIVE_CHANNEL_PATTERN.slice(0, -1); // 'ev:'

/** Fans Redis pub/sub deltas out to in-process listeners. One pattern subscription serves every viewer. */
export class LiveBus {
  private listeners = new Map<string, Set<(d: EventDelta) => void>>();
  private stopped = false;
  private started = false;

  constructor(
    private sub: Redis | undefined,
    private log: (line: string) => void = console.error,
  ) {}

  /**
   * Never blocks boot: the pattern subscription is issued on every 'ready' (first connect and reconnects).
   * ioredis' autoResubscribe (default true) only restores subscriptions that once succeeded, so the
   * 'ready' hook is what covers Redis being down at boot. Repeated psubscribe is idempotent.
   */
  async start(): Promise<void> {
    const sub = this.sub;
    if (!sub || this.started) return;
    this.started = true;
    sub.on('pmessage', this.onMessage);
    const subscribe = () => {
      sub.psubscribe(LIVE_CHANNEL_PATTERN).catch((err: unknown) =>
        this.log(`[live-bus] psubscribe failed: ${err instanceof Error ? err.message : String(err)}`));
    };
    sub.on('ready', subscribe);
    if (sub.status === 'ready') subscribe();
    else this.log('[live-bus] Redis not ready yet; live deltas are degraded to ticks until it connects');
  }

  private onMessage = (_pattern: string, channel: string, message: string): void => this.dispatch(channel, message);

  private dispatch(channel: string, message: string): void {
    const fns = this.listeners.get(channel.slice(PREFIX.length));
    let delta: EventDelta;
    try {
      delta = deltaSchema.parse(JSON.parse(message));
    } catch (err) {
      this.log(`[live-bus] ignoring malformed message on ${channel}: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    for (const fn of [...(fns ?? [])]) fn(delta);
  }

  subscribe(eventId: string, fn: (d: EventDelta) => void): () => void {
    let set = this.listeners.get(eventId);
    if (!set) this.listeners.set(eventId, (set = new Set()));
    set.add(fn);
    return () => {
      const s = this.listeners.get(eventId);
      s?.delete(fn);
      if (s?.size === 0) this.listeners.delete(eventId);
    };
  }

  listenerCount(eventId: string): number {
    return this.listeners.get(eventId)?.size ?? 0;
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    this.listeners.clear();
    const sub = this.sub;
    if (!sub) return;
    sub.removeAllListeners('pmessage');
    sub.removeAllListeners('ready');
    if (sub.status === 'ready') await sub.quit().catch(() => undefined);
    else sub.disconnect();
  }
}
