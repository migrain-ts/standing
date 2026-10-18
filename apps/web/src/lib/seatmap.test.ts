import { describe, expect, it } from 'vitest';
import { fitView, freeSeatSummary, hitTest, sectionToken, statusArray, type VenueMap } from './seatmap';

const seats: VenueMap['seats'] = [
  [0, 80, 0, 'A', 1],
  [20, 80, 0, 'A', 2],
  [0, 100, 1, 'B', 1],
];

describe('statusArray', () => {
  it('marks held and sold from the availability lists', () => {
    const s = statusArray(4, { held: [1], sold: [2] }, new Set(), new Set());
    expect(s).toEqual(['free', 'held', 'sold', 'free']);
  });
  it('overlays selected and mine', () => {
    const s = statusArray(4, { held: [3], sold: [] }, new Set([0]), new Set([3]));
    expect(s).toEqual(['selected', 'free', 'free', 'mine']);
  });
  it('prefers sold over selected', () => {
    expect(statusArray(2, { held: [], sold: [1] }, new Set([1]), new Set())[1]).toBe('sold');
  });
});

describe('hitTest', () => {
  const view = { scale: 1, offsetX: 0, offsetY: 0 };
  it('returns the nearest seat inside the radius', () => {
    expect(hitTest(seats, view, 3, 82)).toBe(0);
  });
  it('returns null outside the radius', () => {
    expect(hitTest(seats, view, 10, 90)).toBeNull();
  });
  it('respects scale and offset', () => {
    const v = { scale: 2, offsetX: 100, offsetY: 10 };
    expect(hitTest(seats, v, 140, 170)).toBe(1); // seat 1 at (20,80) -> (140,170)
    expect(hitTest(seats, view, 140, 170)).toBeNull();
  });
  it('picks the nearer of two seats', () => {
    expect(hitTest(seats, view, 12, 80, 20)).toBe(1);
    expect(hitTest(seats, view, 8, 80, 20)).toBe(0);
  });
});

describe('fitView', () => {
  it('keeps the whole map inside the canvas with a margin', () => {
    const map: VenueMap = { sections: [], seats, seatIds: [], width: 600, height: 300 };
    const wide: VenueMap['seats'] = [...seats, [580, 280, 1, 'Z', 9]];
    const v = fitView({ ...map, seats: wide }, 400, 300);
    for (const [x, y] of wide) {
      const sx = x * v.scale + v.offsetX;
      const sy = y * v.scale + v.offsetY;
      expect(sx).toBeGreaterThanOrEqual(8);
      expect(sx).toBeLessThanOrEqual(392);
      expect(sy).toBeGreaterThanOrEqual(8);
      expect(sy).toBeLessThanOrEqual(292);
    }
  });
});

describe('sectionToken', () => {
  it('maps to chart tokens and wraps after five', () => {
    expect(sectionToken(0)).toBe('--chart-1');
    expect(sectionToken(4)).toBe('--chart-5');
    expect(sectionToken(5)).toBe('--chart-1');
  });
});

describe('freeSeatSummary', () => {
  it('lists free seat numbers per section and row as ranges', () => {
    const rows: VenueMap['seats'] = [
      [0, 0, 0, 'A', 1],
      [0, 0, 0, 'A', 2],
      [0, 0, 0, 'A', 3],
      [0, 0, 0, 'A', 5],
      [0, 0, 1, 'A', 1],
    ];
    const out = freeSeatSummary(rows, ['free', 'free', 'sold', 'free', 'free']);
    expect(out).toEqual([
      { sectionOrd: 0, row: 'A', seats: '1-2, 5' },
      { sectionOrd: 1, row: 'A', seats: '1' },
    ]);
  });
});
