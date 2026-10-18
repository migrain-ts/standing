import { describe, expect, it } from 'vitest';
import { applyDelta, applyDeltas, applyLoad, applySnapshot, applyTick, parseDelta, parseTick, staleness, FLASH_MS, STALE_MS, type LiveDelta, type LiveSnapshot } from './live';

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

const tickOf = (sold: number): { totals: LiveSnapshot['totals']; at: string } => ({
  totals: { ...snapshot.totals, sold, revenueCents: sold * 2500, available: 10 - sold - snapshot.totals.held },
  at: '',
});
const seat = (idx: number) => ({ idx, sectionId: idx % 2 === 0 ? 's1' : 's2' });

describe('tick and delta interleavings', () => {
  it('repeated ticks without deltas are idempotent', () => {
    const a = applyTick(fresh(), tickOf(5), NOW);
    const b = applyTick(applyTick(a, tickOf(5), NOW + 1), tickOf(5), NOW + 2);
    expect(b.snapshot.totals).toEqual(a.snapshot.totals);
    expect(b.ahead).toEqual(a.ahead);
  });

  it('delta, tick(equal), delta again counts every seat once', () => {
    let s = applyDelta(fresh(), delta([seat(2)]), NOW); // 3
    s = applyTick(s, tickOf(3), NOW + 1);
    s = applyDelta(s, delta([seat(3)]), NOW + 2);
    expect(s.snapshot.totals.sold).toBe(4);
    expect(s.snapshot.totals.revenueCents).toBe(10000);
  });

  it('a tick LOWER than what the deltas already showed never lowers the display', () => {
    let s = applyDelta(fresh(), delta([seat(2), seat(3), seat(5)]), NOW); // 5 shown
    s = applyTick(s, tickOf(3), NOW + 1); // stale tick
    expect(s.snapshot.totals.sold).toBe(5);
    expect(s.snapshot.totals.revenueCents).toBe(12500);
    // and a later delta is added once, not swallowed or doubled
    s = applyDelta(s, delta([seat(6)]), NOW + 2);
    expect(s.snapshot.totals.sold).toBe(6);
    // the next tick that catches up is authoritative again
    s = applyTick(s, tickOf(6), NOW + 3);
    expect(s.snapshot.totals.sold).toBe(6);
  });

  it('replayed deltas after a reconnect do not touch a non-zero ahead', () => {
    const d = delta([seat(2)]);
    let s = applyTick(applyDelta(fresh(), d, NOW), tickOf(6), NOW + 1); // tick leads by 3 seats
    expect(s.ahead.sold).toBe(3);
    s = applyDelta(applyDelta(s, d, NOW + 2), d, NOW + 3); // replay x2
    expect(s.snapshot.totals.sold).toBe(6);
    expect(s.ahead.sold).toBe(3);
    s = applyDeltas(s, [delta([seat(3), seat(4), seat(5)])], NOW + 4); // the 3 missing seats arrive
    expect(s.snapshot.totals.sold).toBe(6);
    expect(s.ahead.sold).toBe(0);
  });
});

describe('applyLoad (snapshot refetch racing the stream)', () => {
  it('an older snapshot landing after newer deltas neither regresses sold nor drops seats', () => {
    let s = fresh(); // 2 sold: seats 0, 1
    s = applyDelta(s, delta([seat(2), seat(3), seat(5)]), NOW);
    const older = applyLoad(s, snapshot, { held: [4], sold: [0, 1] });
    expect(older.snapshot.totals.sold).toBe(5);
    expect(older.snapshot.totals.revenueCents).toBe(12500);
    for (const i of [0, 1, 2, 3, 5]) expect(older.soldIdx.has(i)).toBe(true);
    expect(older.snapshot.sections.map((x) => x.sold)).toEqual([2, 3]);
    // and the delta replayed afterwards is still not counted twice
    expect(applyDelta(older, delta([seat(2)]), NOW + 1).snapshot.totals.sold).toBe(5);
  });

  it('a newer snapshot raises sold and adds seats', () => {
    const newer: LiveSnapshot = { ...snapshot, totals: { ...snapshot.totals, sold: 4, revenueCents: 10000, available: 5 } };
    const s = applyLoad(fresh(), newer, { held: [], sold: [0, 1, 2, 3] });
    expect(s.snapshot.totals.sold).toBe(4);
    expect(s.soldIdx.size).toBe(4);
    expect(s.heldIdx.size).toBe(0);
  });

  it('ignores a snapshot of another event', () => {
    const other: LiveSnapshot = { ...snapshot, event: { ...snapshot.event, id: 'e2' } };
    const s = fresh();
    expect(applyLoad(s, other, { held: [], sold: [] })).toBe(s);
  });
});

describe('scripted mixed sequence', () => {
  it('sold never decreases, never exceeds capacity or the truth, and converges to the last tick', () => {
    const CAP = 120;
    const cap: LiveSnapshot = { ...snapshot, capacity: CAP, totals: { ...snapshot.totals, sold: 0, held: 0, available: CAP, revenueCents: 0 }, sections: [
      { id: 's1', name: 'A', capacity: 20, sold: 0, priceCents: 2500 }, { id: 's2', name: 'B', capacity: 20, sold: 0, priceCents: 2500 }], byMinute: [] };
    const snapAt = (n: number): LiveSnapshot => ({ ...cap, totals: { ...cap.totals, sold: n, revenueCents: n * 2500, available: CAP - n }, sections: cap.sections.map((x, k) => ({ ...x, sold: Array.from({ length: n }, (_, i) => i % 2).filter((v) => v === k).length })) });
    const tk = (n: number) => ({ totals: snapAt(n).totals, at: '' });
    for (let seed = 1; seed <= 25; seed++) {
      let r = seed * 7919;
      const rnd = (m: number) => ((r = (Math.imul(r, 1103515245) + 12345) & 0x7fffffff) >>> 12) % m;
      let s = applyLoad(null, snapAt(0), { held: [], sold: [] });
      let truth = 0;
      let delivered = 0;
      let shown = 0;
      let t = NOW;
      const check = () => {
        const v = s.snapshot.totals.sold;
        expect(v).toBeGreaterThanOrEqual(shown);
        expect(v).toBeLessThanOrEqual(CAP);
        expect(v).toBeLessThanOrEqual(truth);
        shown = v;
      };
      for (let step = 0; step < 120; step++) {
        t += 100;
        const op = rnd(4);
        if (op === 0) truth = Math.min(CAP, truth + 1 + rnd(3));
        else if (op === 1 && delivered < truth) {
          const k = 1 + rnd(truth - delivered);
          s = applyDelta(s, { ...delta(Array.from({ length: k }, (_, i) => seat(delivered + i))), revenueCents: k * 2500 }, t);
          delivered += k;
          if (rnd(3) === 0) s = applyDelta(s, { ...delta([seat(delivered - 1)]), revenueCents: 2500 }, t); // replay
        } else if (op === 2) s = applyTick(s, tk(rnd(2) === 0 ? truth : Math.max(0, delivered - rnd(4))), t); // leads, or is stale
        else if (op === 3) {
          const n = rnd(truth + 1);
          s = applyLoad(s, snapAt(n), { held: [], sold: Array.from({ length: n }, (_, i) => i) });
        }
        check();
      }
      s = applyDeltas(s, delivered < truth ? [{ ...delta(Array.from({ length: truth - delivered }, (_, i) => seat(delivered + i))), revenueCents: (truth - delivered) * 2500 }] : [], t + 1);
      s = applyTick(s, tk(truth), t + 2);
      check();
      expect(s.snapshot.totals).toEqual(tk(truth).totals);
      expect(s.ahead.sold).toBe(0);
    }
  });
});

describe('parsing boundary', () => {
  const good = { eventId: 'e1', tenantId: 't1', tickets: 1, revenueCents: 2500, scanned: 0, at: 'x', seats: [{ idx: 1, sectionId: 's1' }] };
  it('accepts a well formed delta and tick', () => {
    expect(parseDelta(JSON.stringify(good))?.seats).toHaveLength(1);
    expect(parseTick(JSON.stringify({ totals: snapshot.totals, at: 'x' }))?.totals.sold).toBe(2);
  });
  it('ignores seats: [null], a tick without sold, non-JSON and non-strings', () => {
    expect(parseDelta(JSON.stringify({ ...good, seats: [null] }))).toBeNull();
    expect(parseDelta(JSON.stringify({ ...good, seats: [{ idx: 'a', sectionId: 's1' }] }))).toBeNull();
    const noSold = { ...snapshot.totals, sold: undefined };
    expect(parseTick(JSON.stringify({ totals: noSold, at: 'x' }))).toBeNull();
    expect(parseTick('not json')).toBeNull();
    expect(parseDelta(undefined)).toBeNull();
    expect(parseDelta('{"seats":[]}')).toBeNull();
  });
});
