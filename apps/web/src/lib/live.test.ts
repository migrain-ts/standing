import { describe, expect, it } from 'vitest';
import { applyDelta, applyDeltas, applySnapshot, applyTick, staleness, FLASH_MS, STALE_MS, type LiveDelta, type LiveSnapshot } from './live';

const snapshot: LiveSnapshot = {
  event: { id: 'e1', name: 'Aurora Night', status: 'published', startsAt: '2026-11-01T19:00:00.000Z' },
  capacity: 10,
  totals: { sold: 2, held: 1, available: 7, revenueCents: 5000, scanned: 0, oversold: 0, queue: null },
  sections: [
    { id: 's1', name: 'Floor', capacity: 6, sold: 1, priceCents: 2500 },
    { id: 's2', name: 'Balcony', capacity: 4, sold: 1, priceCents: 2500 },
  ],
  byMinute: [{ bucket: '2026-10-18T10:00:00.000Z', tickets: 2, revenueCents: 5000 }],
  at: '2026-10-18T10:00:30.000Z',
};
const NOW = Date.parse('2026-10-18T10:01:10.000Z');
const fresh = () => applySnapshot(snapshot, { held: [4], sold: [0, 1] });
const delta = (seats: { idx: number; sectionId: string }[], revenueCents = seats.length * 2500): LiveDelta => ({
  eventId: 'e1', tenantId: 't1', tickets: seats.length, revenueCents, seats, scanned: 0, at: '2026-10-18T10:01:05.000Z',
});

describe('applyDelta', () => {
  it('counts sold, revenue, section and the minute bucket once per seat', () => {
    const s = applyDelta(fresh(), delta([{ idx: 2, sectionId: 's1' }, { idx: 3, sectionId: 's2' }]), NOW);
    expect(s.soldIdx.has(2) && s.soldIdx.has(3)).toBe(true);
    expect(s.snapshot.totals.sold).toBe(4);
    expect(s.snapshot.totals.available).toBe(5);
    expect(s.snapshot.totals.revenueCents).toBe(10000);
    expect(s.snapshot.sections.map((x) => x.sold)).toEqual([2, 2]);
    const last = s.snapshot.byMinute.at(-1);
    expect(last).toEqual({ bucket: '2026-10-18T10:01:00.000Z', tickets: 2, revenueCents: 5000 });
    expect(s.snapshot.byMinute).toHaveLength(2);
  });

  it('is idempotent for a repeated seat idx', () => {
    const d = delta([{ idx: 2, sectionId: 's1' }]);
    const once = applyDelta(fresh(), d, NOW);
    const twice = applyDelta(once, d, NOW + 10);
    expect(twice.snapshot.totals.sold).toBe(once.snapshot.totals.sold);
    expect(twice.snapshot.totals.revenueCents).toBe(once.snapshot.totals.revenueCents);
    expect(twice.snapshot.byMinute.at(-1)?.tickets).toBe(1);
    expect(twice.soldIdx.size).toBe(3);
  });

  it('counts a seat once when it repeats inside one delta or one batch', () => {
    const d = delta([{ idx: 2, sectionId: 's1' }, { idx: 2, sectionId: 's1' }]);
    const s = applyDeltas(fresh(), [d, d], NOW);
    expect(s.snapshot.totals.sold).toBe(3);
    expect(s.snapshot.sections[0]?.sold).toBe(2);
  });

  it('never lets soldIdx exceed the capacity', () => {
    const seats = Array.from({ length: 20 }, (_, i) => ({ idx: i, sectionId: 's1' }));
    const s = applyDelta(fresh(), delta(seats), NOW);
    expect(s.soldIdx.size).toBeLessThanOrEqual(10);
    expect(s.snapshot.totals.sold).toBeLessThanOrEqual(10);
    expect(s.soldIdx.has(-1)).toBe(false);
  });

  it('turns a held seat into sold and marks new seats as flashing for 900 ms', () => {
    const s = applyDelta(fresh(), delta([{ idx: 4, sectionId: 's1' }]), NOW);
    expect(s.heldIdx.has(4)).toBe(false);
    expect(s.flashing.get(4)).toBe(NOW + FLASH_MS);
    expect(FLASH_MS).toBe(900);
  });

  it('does not mutate the previous state', () => {
    const before = fresh();
    applyDelta(before, delta([{ idx: 2, sectionId: 's1' }]), NOW);
    expect(before.soldIdx.size).toBe(2);
    expect(before.snapshot.totals.sold).toBe(2);
  });
});

describe('applyTick', () => {
  it('overrides drifted totals with the authoritative ones and marks the stream connected', () => {
    const drifted = applyDelta(fresh(), delta([{ idx: 2, sectionId: 's1' }]), NOW);
    const totals = { ...snapshot.totals, sold: 9, revenueCents: 99900, oversold: 0 };
    const s = applyTick(drifted, { totals, at: '2026-10-18T10:01:06.000Z' }, NOW + 100);
    expect(s.snapshot.totals).toEqual(totals);
    expect(s.lastTickAt).toBe(NOW + 100);
    expect(s.connected).toBe(true);
  });

  it('does not count twice the seats the tick already knew about when their deltas arrive', () => {
    const totals = { ...snapshot.totals, sold: 5, revenueCents: 12500, available: 4 };
    const ticked = applyTick(fresh(), { totals, at: '' }, NOW);
    const three = delta([{ idx: 2, sectionId: 's1' }, { idx: 3, sectionId: 's1' }, { idx: 5, sectionId: 's2' }]);
    const caught = applyDelta(ticked, three, NOW + 10);
    expect(caught.snapshot.totals.sold).toBe(5);
    expect(caught.snapshot.totals.revenueCents).toBe(12500);
    const more = applyDelta(caught, delta([{ idx: 6, sectionId: 's2' }]), NOW + 20);
    expect(more.snapshot.totals.sold).toBe(6);
    expect(more.snapshot.totals.revenueCents).toBe(15000);
  });

  it('clears flashes that have expired and keeps the others', () => {
    const a = applyDelta(fresh(), delta([{ idx: 2, sectionId: 's1' }]), NOW);
    const b = applyDelta(a, delta([{ idx: 3, sectionId: 's1' }]), NOW + 500);
    const s = applyTick(b, { totals: b.snapshot.totals, at: '' }, NOW + FLASH_MS);
    expect(s.flashing.has(2)).toBe(false);
    expect(s.flashing.has(3)).toBe(true);
  });
});

describe('staleness', () => {
  it('is stale before any tick, live within 5 s and stale from 5 s', () => {
    const s0 = fresh();
    expect(staleness(s0, NOW)).toBe('stale');
    const s = applyTick(s0, { totals: snapshot.totals, at: '' }, NOW);
    expect(staleness(s, NOW + STALE_MS - 1)).toBe('live');
    expect(staleness(s, NOW + STALE_MS)).toBe('stale');
  });
});
