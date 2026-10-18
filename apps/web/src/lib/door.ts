'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

export type DoorEvent = { id: string; name: string; startsAt: string; tenantName: string; sold: number; scanned: number };

export const DOOR_EVENTS_KEY = ['door', 'events'] as const;
export const DOOR_REFRESH_MS = 5000;
export const HISTORY_LIMIT = 10;

export function useDoorEvents() {
  return useQuery({
    queryKey: DOOR_EVENTS_KEY,
    queryFn: () => api<{ events: DoorEvent[] }>('/door/events').then((r) => r.events),
    refetchInterval: DOOR_REFRESH_MS,
  });
}

/** Share of sold tickets already scanned, 0..100. */
export const scannedPercent = (scanned: number, sold: number): number =>
  sold <= 0 ? 0 : Math.min(100, Math.round((scanned / sold) * 100));
