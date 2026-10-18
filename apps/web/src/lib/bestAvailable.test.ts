import { describe, expect, it } from 'vitest';
import { bestAvailable } from './bestAvailable';
import type { Status } from './seatmap';
import type { VenueMap } from './seatmap';

/** rows: array of [section, rowLabel, count]; idx runs consecutively. */
function build(rows: [number, string, number][]): VenueMap['seats'] {
  const seats: VenueMap['seats'] = [];
  for (const [sec, row, n] of rows) for (let i = 1; i <= n; i++) seats.push([i * 20, row.charCodeAt(0) * 20, sec, row, i]);
  return seats;
}
const allFree = (n: number): Status[] => Array.from({ length: n }, () => 'free');

describe('bestAvailable', () => {
  it('returns consecutive free seats centred in the row', () => {
    const seats = build([[0, 'A', 10]]);
    expect(bestAvailable(seats, allFree(10), 2)).toEqual([4, 5]);
  });
  it('skips rows without a long enough run', () => {
    const seats = build([[0, 'A', 4], [0, 'B', 4]]);
    const st = allFree(8);
    st[1] = 'sold';
    st[2] = 'held'; // row A has runs of 1 only
    expect(bestAvailable(seats, st, 2)).toEqual([5, 6]);
  });
  it('falls back to the nearest free seats across rows', () => {
    const seats = build([[0, 'A', 2], [0, 'B', 2]]);
    const st: Status[] = ['free', 'sold', 'sold', 'free'];
    expect(bestAvailable(seats, st, 2)).toEqual([0, 3]);
  });
  it('returns [] when fewer than count seats are free', () => {
    const seats = build([[0, 'A', 3]]);
    expect(bestAvailable(seats, ['free', 'sold', 'free'], 3)).toEqual([]);
  });
  it('never returns a non-free seat', () => {
    const seats = build([[0, 'A', 6], [1, 'A', 6]]);
    const st = allFree(12).map((_, i): Status => (i % 3 === 0 ? 'selected' : i % 3 === 1 ? 'mine' : 'free'));
    for (const n of [1, 2, 3]) for (const i of bestAvailable(seats, st, n)) expect(st[i]).toBe('free');
  });
  it('prefers the requested section when it has a run', () => {
    const seats = build([[0, 'A', 4], [1, 'B', 4]]);
    expect(bestAvailable(seats, allFree(8), 2, 1)).toEqual([5, 6]);
    expect(bestAvailable(seats, allFree(8), 2)).toEqual([1, 2]);
  });
  it('orders rows A..Z before AA', () => {
    const seats = build([[0, 'AA', 3]]);
    const a = [...seats, ...build([[0, 'Z', 3]])];
    expect(bestAvailable(a, allFree(6), 3)).toEqual([3, 4, 5]);
  });
});
