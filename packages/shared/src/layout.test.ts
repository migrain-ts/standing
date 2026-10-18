import { describe, expect, it } from 'vitest';
import { generateLayout, rowLabelFor, SEAT_PITCH } from './layout';

describe('rowLabelFor', () => {
  it('counts A..Z then AA..', () => {
    expect([0, 1, 25, 26, 27, 51, 52].map(rowLabelFor)).toEqual(['A', 'B', 'Z', 'AA', 'AB', 'AZ', 'BA']);
  });
});

describe('generateLayout', () => {
  const seats = generateLayout([
    { name: 'Floor', rows: 3, seatsPerRow: 4 },
    { name: 'Balcony', rows: 2, seatsPerRow: 5 },
  ]);
  it('creates rows x seatsPerRow seats per section with consecutive idx from 0', () => {
    expect(seats).toHaveLength(3 * 4 + 2 * 5);
    expect(seats.map((s) => s.idx)).toEqual(Array.from({ length: 22 }, (_, i) => i));
    expect(seats.filter((s) => s.sectionIndex === 1)).toHaveLength(10);
  });
  it('never places two seats on the same point and keeps sections apart', () => {
    expect(new Set(seats.map((s) => `${s.x},${s.y}`)).size).toBe(seats.length);
    const floorMaxX = Math.max(...seats.filter((s) => s.sectionIndex === 0).map((s) => s.x));
    const balconyMinX = Math.min(...seats.filter((s) => s.sectionIndex === 1).map((s) => s.x));
    expect(balconyMinX - floorMaxX).toBeGreaterThan(SEAT_PITCH);
  });
  it('labels rows and numbers seats from 1 within a row', () => {
    expect(seats[0]).toMatchObject({ rowLabel: 'A', number: 1 });
    expect(seats[3]).toMatchObject({ rowLabel: 'A', number: 4 });
    expect(seats[4]).toMatchObject({ rowLabel: 'B', number: 1 });
  });
});
