'use client';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { api } from './api';
import { applyDeltas, applyLoad, applyTick, parseDelta, parseTick, pruneFlashes, staleness, type LiveDelta, type LiveSnapshot, type LiveState, type LiveTick } from './live';
import { joinPath, tenantApi } from './paths';
import type { RushForm, RushRunView } from './rush';
import type { DocumentDto } from './storefront';
import type { Availability, VenueMap } from './seatmap';

const SAFETY_REFRESH_MS = 15_000;
const FALLBACK_POLL_MS = 3_000;

type Action =
  | { type: 'load'; snapshot: LiveSnapshot; availability: Availability }
  | { type: 'deltas'; deltas: LiveDelta[]; now: number }
  | { type: 'tick'; tick: LiveTick; now: number }
  | { type: 'prune'; now: number }
  | { type: 'reset' }
  | { type: 'disconnected' };

function reducer(state: LiveState | null, a: Action): LiveState | null {
  switch (a.type) {
    case 'load': {
      return applyLoad(state, a.snapshot, a.availability);
    }
    case 'deltas':
      return state && applyDeltas(state, a.deltas, a.now);
    case 'tick':
      return state && applyTick(state, a.tick, a.now);
    case 'prune':
      return state && pruneFlashes(state, a.now);
    case 'reset':
      return null;
    case 'disconnected':
      return state && { ...state, connected: false };
    default: {
      const never: never = a;
      return never;
    }
  }
}

export type LiveStatus = 'connecting' | 'live' | 'reconnecting';

/** Snapshot + availability, then SSE deltas batched per animation frame, with snapshot polling as the fallback. */
export function useLive(tenantId: string, eventId: string, enabled: boolean) {
  const [state, dispatch] = useReducer(reducer, null);
  const [clock, setClock] = useState(() => Date.now());
  const [loadError, setLoadError] = useState<Error | null>(null);
  const queue = useRef<LiveDelta[]>([]);
  /** Bumped whenever the stream applies a delta or tick and whenever the event changes. */
  const applied = useRef(0);
  const generation = useRef(0);
  const frame = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const map = useQuery({
    queryKey: ['map', eventId],
    queryFn: () => api<VenueMap>(joinPath('public', 'events', eventId, 'map')),
    enabled,
    staleTime: Infinity,
  });

  const load = useCallback(async () => {
    // A response that started before the stream last changed the state may be older than it: drop it (the next tick
    // converges, and applyLoad merges rather than replaces as a second guard). The first load is always taken.
    const gen = generation.current;
    const startedAt = applied.current;
    try {
      const [snapshot, availability] = await Promise.all([
        api<LiveSnapshot>(tenantApi(tenantId, 'events', eventId, 'live', 'snapshot')),
        api<Availability>(joinPath('public', 'events', eventId, 'availability')),
      ]);
      if (gen !== generation.current) return; // another event is open now
      if (stateRef.current && applied.current !== startedAt) return;
      dispatch({ type: 'load', snapshot, availability });
      setLoadError(null);
    } catch (e) {
      setLoadError(e instanceof Error ? e : new Error('Could not load the live figures'));
    }
  }, [tenantId, eventId]);

  useEffect(() => {
    if (!enabled) return;
    let closed = false;
    generation.current++;
    applied.current = 0;
    dispatch({ type: 'reset' });
    stateRef.current = null;
    let fallback: ReturnType<typeof setInterval> | null = null;
    const stopFallback = () => {
      if (fallback) clearInterval(fallback);
      fallback = null;
    };
    const flush = () => {
      frame.current = 0;
      const batch = queue.current;
      queue.current = [];
      if (!closed && batch.length > 0) {
        applied.current++;
        dispatch({ type: 'deltas', deltas: batch, now: Date.now() });
      }
    };

    void load();
    const es = new EventSource(`/api${tenantApi(tenantId, 'events', eventId, 'live')}`, { withCredentials: true });
    es.onopen = () => {
      stopFallback();
      void load();
    };
    es.onerror = () => {
      dispatch({ type: 'disconnected' });
      if (!fallback && !closed) fallback = setInterval(() => void load(), FALLBACK_POLL_MS);
    };
    es.addEventListener('delta', (ev) => {
      const d = ev instanceof MessageEvent ? parseDelta(ev.data) : null;
      if (!d) return;
      queue.current.push(d);
      if (frame.current === 0) frame.current = requestAnimationFrame(flush);
    });
    es.addEventListener('tick', (ev) => {
      const t = ev instanceof MessageEvent ? parseTick(ev.data) : null;
      if (!t) return;
      applied.current++;
      dispatch({ type: 'tick', tick: t, now: Date.now() });
    });
    const safety = setInterval(() => void load(), SAFETY_REFRESH_MS);
    // Wall clock for staleness and for expiring flashes.
    const timer = setInterval(() => {
      const now = Date.now();
      setClock(now);
      const s = stateRef.current;
      if (s && s.flashing.size > 0) dispatch({ type: 'prune', now });
    }, 250);

    return () => {
      closed = true;
      es.close();
      stopFallback();
      clearInterval(safety);
      clearInterval(timer);
      if (frame.current) cancelAnimationFrame(frame.current);
      frame.current = 0;
      queue.current = [];
    };
  }, [enabled, load, tenantId, eventId]);

  const status: LiveStatus = !state ? 'connecting' : state.connected && staleness(state, clock) === 'live' ? 'live' : 'reconnecting';
  return { state, map: map.data ?? null, mapError: map.error, loadError, status, reload: load };
}

type RushResponse = { run: RushRunView | null };

/** Rush control: polls the run once a second while it is running. */
export function useRush(tenantId: string, eventId: string, enabled: boolean) {
  const qc = useQueryClient();
  const key = ['rush', tenantId, eventId] as const;
  const path = tenantApi(tenantId, 'events', eventId, 'rush');
  const run = useQuery({
    queryKey: key,
    queryFn: async () => (await api<RushResponse>(path)).run,
    enabled,
    // A run started from another tab or a previous visit is noticed within 5 s.
    refetchInterval: (q) => (q.state.data?.status === 'running' ? 1000 : 5000),
    retry: false,
  });
  const start = useMutation({
    mutationFn: (form: RushForm) => api<RushResponse>(path, { method: 'POST', json: form }),
    onSuccess: (r) => qc.setQueryData(key, r.run),
  });
  const stop = useMutation({
    mutationFn: () => api<void>(path, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: key }),
  });
  return { run: run.data ?? null, unavailable: run.isError ? run.error : null, start, stop };
}

/** Requests the PDF report, then polls its document until it is ready or failed. */
export function useReport(tenantId: string, eventId: string) {
  const [documentId, setDocumentId] = useState<string | null>(null);
  const request = useMutation({
    mutationFn: () => api<{ document: DocumentDto }>(tenantApi(tenantId, 'events', eventId, 'reports'), { method: 'POST', json: { kind: 'report_pdf' } }),
    onSuccess: (r) => setDocumentId(r.document.id),
  });
  const doc = useQuery({
    queryKey: ['document', documentId],
    queryFn: () => api<{ document: DocumentDto }>(joinPath('documents', documentId ?? '')),
    enabled: documentId !== null,
    refetchInterval: (q) => {
      const s = q.state.data?.document.status;
      return s === 'ready' || s === 'failed' ? false : 1500;
    },
  });
  return { request, documentId, status: doc.data?.document.status ?? null };
}
