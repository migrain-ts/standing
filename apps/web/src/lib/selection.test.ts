import { describe, expect, it } from 'vitest';
import { selectionReducer } from './selection';

const empty: ReadonlySet<number> = new Set();

describe('selectionReducer', () => {
  it('adds a free seat', () => {
    expect([...selectionReducer(empty, { type: 'toggle', idx: 4, free: true })]).toEqual([4]);
  });
  it('removes a selected seat', () => {
    expect(selectionReducer(new Set([4]), { type: 'toggle', idx: 4, free: true }).size).toBe(0);
  });
  it('caps at max', () => {
    let s: ReadonlySet<number> = empty;
    for (let i = 0; i < 12; i++) s = selectionReducer(s, { type: 'toggle', idx: i, free: true });
    expect(s.size).toBe(8);
    expect(selectionReducer(new Set([1, 2]), { type: 'toggle', idx: 9, free: true }, 2).size).toBe(2);
  });
  it('ignores non-free seats', () => {
    expect(selectionReducer(empty, { type: 'toggle', idx: 4, free: false }).size).toBe(0);
  });
  it('clear empties', () => {
    expect(selectionReducer(new Set([1, 2]), { type: 'clear' }).size).toBe(0);
  });
  it('set replaces and respects max', () => {
    expect([...selectionReducer(new Set([1]), { type: 'set', idxs: [5, 6] })]).toEqual([5, 6]);
    expect(selectionReducer(empty, { type: 'set', idxs: [1, 2, 3] }, 2).size).toBe(2);
  });
});
