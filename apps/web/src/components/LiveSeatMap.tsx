'use client';
import { useMemo } from 'react';
import { SeatMap } from '@/components/SeatMap';
import type { LiveState } from '@/lib/live';
import { statusArray, type VenueMap } from '@/lib/seatmap';

const NONE: ReadonlySet<number> = new Set();
const noop = () => undefined;

/** Organizer view of the seat map: sold seats in section colour, held muted, new sales flash. */
export function LiveSeatMap({ map, state }: { map: VenueMap; state: LiveState }) {
  const status = useMemo(
    () => statusArray(map.seats.length, { held: [...state.heldIdx], sold: [...state.soldIdx] }, NONE, NONE),
    [map.seats.length, state.heldIdx, state.soldIdx],
  );
  const flash = useMemo(() => new Set(state.flashing.keys()), [state.flashing]);
  const priceByOrd = useMemo(() => {
    const byId = new Map(state.snapshot.sections.map((s) => [s.id, s.priceCents]));
    return new Map(map.sections.map((s) => [s.ord, byId.get(s.id) ?? 0]));
  }, [map.sections, state.snapshot.sections]);
  return <SeatMap map={map} status={status} priceByOrd={priceByOrd} onToggle={noop} variant="organizer" flash={flash} />;
}
