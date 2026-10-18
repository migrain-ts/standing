/** Pure live-dashboard state. No DOM, no timers: callers pass `now`. */
export type Totals = {
  sold: number;
  held: number;
  available: number;
  revenueCents: number;
  scanned: number;
  oversold: number;
  queue: { waiting: number; active: number } | null;
};
export type MinuteBucket = { bucket: string; tickets: number; revenueCents: number };
export type SectionFigure = { id: string; name: string; capacity: number; sold: number; priceCents: number };
export type LiveSnapshot = {
  event: { id: string; name: string; status: string; startsAt: string };
  capacity: number;
  totals: Totals;
  sections: SectionFigure[];
  byMinute: MinuteBucket[];
  at: string;
};
export type LiveDelta = {
  eventId: string;
  tenantId: string;
  tickets: number;
  revenueCents: number;
  seats: { idx: number; sectionId: string }[];
  scanned: number;
  at: string;
};
export type LiveTick = { totals: Totals; at: string };

export type LiveState = {
  snapshot: LiveSnapshot;
  soldIdx: Set<number>;
  heldIdx: Set<number>;
  /** Seat idx to the ms timestamp at which its flash ends. */
  flashing: Map<number, number>;
  connected: boolean;
  lastTickAt: number | null;
  /** What the snapshot plus the deltas add up to, independent of the ticks. */
  derived: { sold: number; revenueCents: number };
  /** Sales the last tick already counted whose deltas have not arrived yet: they must not be added twice. */
  ahead: { sold: number; revenueCents: number };
};

export const FLASH_MS = 900;
export const STALE_MS = 5000;
const MINUTES_KEPT = 60;

export function applySnapshot(snapshot: LiveSnapshot, availability: { held: readonly number[]; sold: readonly number[] }): LiveState {
  return {
    snapshot,
    soldIdx: new Set(availability.sold),
    heldIdx: new Set(availability.held),
    flashing: new Map(),
    connected: false,
    lastTickAt: null,
    derived: { sold: snapshot.totals.sold, revenueCents: snapshot.totals.revenueCents },
    ahead: { sold: 0, revenueCents: 0 },
  };
}

const minuteOf = (iso: string, fallback: number): string => {
  const t = Date.parse(iso);
  const ms = Number.isFinite(t) ? t : fallback;
  return new Date(Math.floor(ms / 60000) * 60000).toISOString();
};

/** Applies several deltas with one copy of the sets (one per animation frame). Each seat idx counts once. */
export function applyDeltas(state: LiveState, deltas: readonly LiveDelta[], now: number): LiveState {
  if (deltas.length === 0) return state;
  const capacity = state.snapshot.capacity;
  const soldIdx = new Set(state.soldIdx);
  const heldIdx = new Set(state.heldIdx);
  const flashing = new Map(state.flashing);
  const sections = state.snapshot.sections.map((s) => ({ ...s }));
  const byMinute = state.snapshot.byMinute.map((m) => ({ ...m }));
  let sold = state.snapshot.totals.sold;
  let revenue = state.snapshot.totals.revenueCents;
  const derived = { ...state.derived };
  const ahead = { ...state.ahead };

  for (const d of deltas) {
    const fresh = d.seats.filter(
      (s, i) => Number.isInteger(s.idx) && s.idx >= 0 && s.idx < capacity && !soldIdx.has(s.idx) && d.seats.findIndex((o) => o.idx === s.idx) === i,
    );
    if (fresh.length === 0) continue;
    const share = d.seats.length > 0 ? Math.round((d.revenueCents * fresh.length) / d.seats.length) : 0;
    for (const s of fresh) {
      soldIdx.add(s.idx);
      heldIdx.delete(s.idx);
      flashing.set(s.idx, now + FLASH_MS);
      const sec = sections.find((x) => x.id === s.sectionId);
      if (sec && sec.sold < sec.capacity) sec.sold++;
    }
    derived.sold += fresh.length;
    derived.revenueCents += share;
    const seen = Math.min(ahead.sold, fresh.length);
    const seenRevenue = Math.min(ahead.revenueCents, share);
    ahead.sold -= seen;
    ahead.revenueCents -= seenRevenue;
    sold = Math.min(capacity, sold + fresh.length - seen);
    revenue += share - seenRevenue;
    const bucket = minuteOf(d.at, now);
    const last = byMinute.at(-1);
    if (last && last.bucket === bucket) {
      last.tickets += fresh.length;
      last.revenueCents += share;
    } else {
      byMinute.push({ bucket, tickets: fresh.length, revenueCents: share });
      if (byMinute.length > MINUTES_KEPT) byMinute.splice(0, byMinute.length - MINUTES_KEPT);
    }
  }
  const t = state.snapshot.totals;
  return {
    ...state,
    soldIdx,
    heldIdx,
    flashing,
    derived,
    ahead,
    snapshot: {
      ...state.snapshot,
      sections,
      byMinute,
      totals: { ...t, sold, available: Math.max(0, t.available - (sold - t.sold)), revenueCents: revenue },
    },
  };
}

export const applyDelta = (state: LiveState, delta: LiveDelta, now: number): LiveState => applyDeltas(state, [delta], now);

/** Drops flashes whose time has come. Returns the same state when nothing expired. */
export function pruneFlashes(state: LiveState, now: number): LiveState {
  let expired = false;
  for (const end of state.flashing.values()) if (end <= now) expired = true;
  if (!expired) return state;
  return { ...state, flashing: new Map([...state.flashing].filter(([, end]) => end > now)) };
}

/** The tick carries the authoritative totals: they replace whatever the deltas accumulated. */
export function applyTick(state: LiveState, tick: LiveTick, now: number): LiveState {
  const pruned = pruneFlashes(state, now);
  const ahead = {
    sold: Math.max(0, tick.totals.sold - pruned.derived.sold),
    revenueCents: Math.max(0, tick.totals.revenueCents - pruned.derived.revenueCents),
  };
  return { ...pruned, ahead, snapshot: { ...pruned.snapshot, totals: tick.totals }, connected: true, lastTickAt: now };
}

export function staleness(state: LiveState, now: number): 'live' | 'stale' {
  return state.lastTickAt !== null && now - state.lastTickAt < STALE_MS ? 'live' : 'stale';
}
