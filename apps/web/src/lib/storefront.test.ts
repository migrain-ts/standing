import { describe, expect, it } from 'vitest';
import { isSellingFast, seatsLabel, takenSeatIds } from './storefront';

describe('storefront helpers', () => {
  it('flags selling fast only above 80% sold', () => {
    expect(isSellingFast(100, 20)).toBe(false); // exactly 80% sold
    expect(isSellingFast(100, 19)).toBe(true);
    expect(isSellingFast(0, 0)).toBe(false);
  });
  it('pluralises seats', () => {
    expect(seatsLabel(1)).toBe('1 seat');
    expect(seatsLabel(3)).toBe('3 seats');
  });
  it('reads taken seat ids from error details', () => {
    expect(takenSeatIds({ taken: ['a', 'b'] })).toEqual(['a', 'b']);
    expect(takenSeatIds(undefined)).toEqual([]);
    expect(takenSeatIds({ taken: 3 })).toEqual([]);
  });
});
