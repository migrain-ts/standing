import { describe, expect, it } from 'vitest';
import { eventCreateSchema, eventUpdateSchema } from './schemas';

describe('event schemas', () => {
  it('update parses without inventing an admissionLimit', () => {
    expect(eventUpdateSchema.parse({ name: 'x' })).toEqual({ name: 'x' });
    expect('admissionLimit' in eventUpdateSchema.parse({})).toBe(false);
  });
  it('create still defaults admissionLimit to 200', () => {
    const v = eventCreateSchema.parse({ venueId: '3f2b8d2e-9d57-4f0a-8f3e-2a1c5d6e7f80', name: 'x', startsAt: '2027-01-01T00:00:00Z' });
    expect(v.admissionLimit).toBe(200);
  });
});
