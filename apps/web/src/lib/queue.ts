import type { ApiClientError } from './api';

/** Shape returned by POST /public/events/:id/queue and GET .../queue/:ticket. */
export type QueueResponse =
  | { ticket: string; state: 'admitted'; expiresAt?: number; degraded?: true }
  | { ticket: string; state: 'waiting'; position: number; queueLength: number }
  | { ticket: string; state: 'unknown' };

export type QueueView = { phase: 'joining' | 'waiting' | 'admitted' | 'open'; position?: number; queueLength?: number; ticket?: string };
export type QueueAction = 'rejoin' | 'poll' | 'proceed';

export function nextQueueAction(res: QueueResponse | null, error: ApiClientError | null): QueueAction {
  if (error) return 'poll';
  if (!res) return 'rejoin';
  switch (res.state) {
    case 'unknown':
      return 'rejoin';
    case 'waiting':
      return 'poll';
    case 'admitted':
      return 'proceed';
    default: {
      const never: never = res;
      return never;
    }
  }
}

export function queueViewOf(res: QueueResponse | null): QueueView {
  if (!res || res.state === 'unknown') return { phase: 'joining' };
  if (res.state === 'waiting') return { phase: 'waiting', position: res.position, queueLength: res.queueLength, ticket: res.ticket };
  if (res.degraded) return { phase: 'open' };
  return { phase: 'admitted', ticket: res.ticket };
}

/** Poll delay after `attempt` consecutive network errors: 1 s doubling up to 8 s. */
export function backoffMs(attempt: number): number {
  return Math.min(8000, 1000 * 2 ** Math.max(0, attempt));
}
