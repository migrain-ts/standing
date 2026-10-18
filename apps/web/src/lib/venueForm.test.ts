import { describe, expect, it } from 'vitest';
import { generateLayout } from '@standing/shared';
import { previewSeats, SEAT_LIMIT_MESSAGE, validateVenue } from './venueForm';

const section = (over: Partial<{ name: string; rows: number; seatsPerRow: number }> = {}) => ({ name: 'Floor', rows: 10, seatsPerRow: 20, ...over });
const venue = (over: Partial<{ name: string; sections: ReturnType<typeof section>[] }> = {}) => ({ name: 'Hall', sections: [section()], ...over });

function errorsOf(input: unknown): Record<string, string> {
  const r = validateVenue(input);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

describe('validateVenue', () => {
  it('accepts a valid venue', () => {
    const r = validateVenue(venue({ name: ' Hall ' }));
    expect(r).toEqual({ ok: true, value: { name: 'Hall', sections: [section()] } });
  });
  it('flags an empty name', () => {
    expect(errorsOf(venue({ name: '  ' }))['name']).toBeTruthy();
  });
  it('flags zero sections', () => {
    expect(errorsOf(venue({ sections: [] }))['sections']).toBeTruthy();
  });
  it('flags 13 sections', () => {
    expect(errorsOf(venue({ sections: Array.from({ length: 13 }, () => section({ rows: 1, seatsPerRow: 1 })) }))['sections']).toBeTruthy();
  });
  it('flags rows 0 and 61 on the section field', () => {
    expect(errorsOf(venue({ sections: [section({ rows: 0 })] }))['sections.0.rows']).toBeTruthy();
    expect(errorsOf(venue({ sections: [section({ rows: 61 })] }))['sections.0.rows']).toBeTruthy();
  });
  it('flags 81 seats per row', () => {
    expect(errorsOf(venue({ sections: [section({ seatsPerRow: 81 })] }))['sections.0.seatsPerRow']).toBeTruthy();
  });
  it('flags a section without a name', () => {
    expect(errorsOf(venue({ sections: [section({ name: '' })] }))['sections.0.name']).toBeTruthy();
  });
  it('flags a total above 6,000 with the shared message', () => {
    const big = Array.from({ length: 4 }, () => section({ rows: 40, seatsPerRow: 40 }));
    expect(errorsOf(venue({ sections: big }))['sections']).toBe(SEAT_LIMIT_MESSAGE);
  });
  it('rejects garbage input without throwing', () => {
    expect(validateVenue(null).ok).toBe(false);
  });
});

describe('previewSeats', () => {
  it('returns the layout and its total', () => {
    const sections = [section({ rows: 3, seatsPerRow: 4 }), section({ name: 'Balcony', rows: 2, seatsPerRow: 5 })];
    const p = previewSeats(sections);
    expect(p.total).toBe(22);
    expect(p.seats).toEqual(generateLayout(sections));
  });
  it('is empty for no sections', () => {
    expect(previewSeats([])).toEqual({ seats: [], total: 0 });
  });
  it('totals without building seats when over the limit is irrelevant: counts are products', () => {
    expect(previewSeats([section({ rows: 2, seatsPerRow: 3 })]).total).toBe(6);
  });
});
