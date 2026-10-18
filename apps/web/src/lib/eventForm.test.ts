import { describe, expect, it } from 'vitest';
import { canPublish, tiersComplete, validateEvent } from './eventForm';

const now = new Date('2026-10-18T12:00:00Z');
const input = (over: Partial<{ name: string; startsAt: string; admissionLimit: number }> = {}) => ({
  name: 'Opening night',
  startsAt: '2026-12-01T20:00',
  admissionLimit: 200,
  ...over,
});
function errorsOf(i: ReturnType<typeof input>): Record<string, string> {
  const r = validateEvent(i, now);
  if (r.ok) throw new Error('expected errors');
  return r.errors;
}

describe('validateEvent', () => {
  it('accepts a valid event and returns an ISO start', () => {
    const r = validateEvent(input(), now);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.name).toBe('Opening night');
      expect(r.value.admissionLimit).toBe(200);
      expect(r.value.startsAt).toBe(new Date('2026-12-01T20:00').toISOString());
    }
  });
  it('rejects an empty or 121 character name', () => {
    expect(errorsOf(input({ name: ' ' }))['name']).toBeTruthy();
    expect(errorsOf(input({ name: 'x'.repeat(121) }))['name']).toBeTruthy();
    expect(validateEvent(input({ name: 'x'.repeat(120) }), now).ok).toBe(true);
  });
  it('rejects a past date relative to the injected now, and an empty or invalid one', () => {
    expect(errorsOf(input({ startsAt: '2026-10-18T11:00' }))['startsAt']).toBeTruthy();
    expect(errorsOf(input({ startsAt: '' }))['startsAt']).toBeTruthy();
    expect(errorsOf(input({ startsAt: 'nope' }))['startsAt']).toBeTruthy();
  });
  it('bounds the admission limit to 0..2000 integers', () => {
    expect(validateEvent(input({ admissionLimit: 0 }), now).ok).toBe(true);
    expect(validateEvent(input({ admissionLimit: 2000 }), now).ok).toBe(true);
    expect(errorsOf(input({ admissionLimit: -1 }))['admissionLimit']).toBeTruthy();
    expect(errorsOf(input({ admissionLimit: 2001 }))['admissionLimit']).toBeTruthy();
    expect(errorsOf(input({ admissionLimit: 1.5 }))['admissionLimit']).toBeTruthy();
    expect(errorsOf(input({ admissionLimit: Number.NaN }))['admissionLimit']).toBeTruthy();
  });
});

const sections = [{ id: 's1' }, { id: 's2' }];
const tiers = [
  { sectionId: 's1', priceCents: 5000 },
  { sectionId: 's2', priceCents: 0 },
];

describe('tiersComplete', () => {
  it('is true when every section has a price (zero counts)', () => {
    expect(tiersComplete(sections, tiers)).toBe(true);
  });
  it('is false when one section lacks a price, or there are no sections', () => {
    expect(tiersComplete(sections, tiers.slice(0, 1))).toBe(false);
    expect(tiersComplete([], [])).toBe(false);
  });
});

describe('canPublish', () => {
  const draft = { status: 'draft', startsAt: '2026-12-01T20:00:00.000Z' };
  it('is ok for a complete future draft', () => {
    expect(canPublish(draft, sections, tiers, now)).toEqual({ ok: true });
  });
  it('explains a non draft', () => {
    expect(canPublish({ ...draft, status: 'published' }, sections, tiers, now)).toEqual({ ok: false, reason: 'Only draft events can be published' });
  });
  it('explains a past date', () => {
    expect(canPublish({ ...draft, startsAt: '2026-10-01T20:00:00.000Z' }, sections, tiers, now)).toEqual({ ok: false, reason: 'Event date is in the past' });
  });
  it('explains missing prices', () => {
    expect(canPublish(draft, sections, tiers.slice(0, 1), now)).toEqual({ ok: false, reason: 'Set a price for every section' });
  });
});
