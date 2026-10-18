'use client';
import { useEffect, useRef, type Dispatch, type RefObject } from 'react';
import { Progress } from '@/components/ui/progress';
import { api, ApiClientError } from '@/lib/api';
import type { CheckoutAction, CheckoutState } from '@/lib/checkoutMachine';
import { backoffMs, nextQueueAction, type QueueResponse } from '@/lib/queue';

const POLL_MS = 1500;
const noResponse = (): QueueResponse | null => null; // keeps `res` typed as the union, not narrowed to null
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Best-effort release of a waiting-room slot; safe to call on page hide (keepalive). */
export function releaseTicket(eventId: string, ticket: string | null): void {
  if (!ticket) return;
  api(`/public/events/${eventId}/queue/${encodeURIComponent(ticket)}`, { method: 'DELETE', keepalive: true }).catch(() => undefined);
}

/**
 * Joins the waiting room while the machine is `queued`, polls until admitted, then dispatches `admit`.
 * Returns a ref holding the ticket that must be released when the buyer leaves without paying.
 */
export function useWaitingRoom(eventId: string, phase: CheckoutState['phase'], dispatch: Dispatch<CheckoutAction>): RefObject<string | null> {
  const ticketRef = useRef<string | null>(null);

  useEffect(() => {
    if (phase !== 'queued') return;
    let cancelled = false;
    void (async () => {
      let res = noResponse();
      let failures = 0;
      while (!cancelled) {
        let err: ApiClientError | null = null;
        try {
          const prev: QueueResponse | null = res;
          res =
            prev?.state === 'waiting'
              ? await api<QueueResponse>(`/public/events/${eventId}/queue/${encodeURIComponent(prev.ticket)}`)
              : await api<QueueResponse>(`/public/events/${eventId}/queue`, { method: 'POST' });
          failures = 0;
        } catch (e) {
          err = e instanceof ApiClientError ? e : new ApiClientError(0, 'network', 'Network error');
          if (err.status === 401 || err.status === 404) return;
          failures++;
        }
        if (cancelled) {
          if (res && res.ticket !== 'open') releaseTicket(eventId, res.ticket);
          return;
        }
        if (res && res.ticket !== 'open') ticketRef.current = res.ticket;
        const action = nextQueueAction(res, err);
        if (action === 'proceed' && res) {
          dispatch({ type: 'admit', ticket: 'degraded' in res && res.degraded ? null : res.ticket });
          return;
        }
        if (action === 'rejoin') {
          res = noResponse();
          await sleep(500);
        } else {
          if (res?.state === 'waiting') dispatch({ type: 'queue', position: res.position, queueLength: res.queueLength });
          await sleep(err ? backoffMs(failures - 1) : POLL_MS);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [eventId, phase, dispatch]);

  // Leaving the page (route change or tab close) frees the slot.
  useEffect(() => {
    const leave = () => {
      releaseTicket(eventId, ticketRef.current);
      ticketRef.current = null;
    };
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      leave();
    };
  }, [eventId]);

  return ticketRef;
}

/** Position in the waiting room. Rendered only while the machine is `queued`. */
export function QueuePanel({ state }: { state: CheckoutState }) {
  if (state.phase !== 'queued') return null;
  const { position, queueLength } = state;
  const known = position !== undefined && queueLength !== undefined && queueLength > 0;
  const value = known ? Math.round(((queueLength - position + 1) / queueLength) * 100) : null;
  return (
    <div className="space-y-2" role="status" aria-live="polite">
      <p className="text-sm font-medium">{known ? `You are number ${position} of ${queueLength}` : 'Joining the waiting room'}</p>
      <Progress value={value} aria-label="Your place in the waiting room" />
      <p className="text-sm text-muted-foreground">Reserving opens when it is your turn. Keep this tab open.</p>
    </div>
  );
}
